param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('scan', 'remove')]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$NamesB64,

  [string]$ResultPath = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:ProvisionedScanError = ''

function Write-Result($Object) {
  $Object | ConvertTo-Json -Depth 8 -Compress
}

# Write an atomic progress file after each app. If the helper is killed by the
# app timeout or hits an unexpected error, the main process can still read the
# apps that were already processed instead of throwing the whole result away.
function Write-State($Results, [bool]$Complete, [string]$ErrorMessage = '') {
  if (-not $ResultPath) { return }
  try {
    $payload = [PSCustomObject]@{
      ok = $true
      complete = $Complete
      admin = $isAdmin
      error = $ErrorMessage
      results = @($Results)
    }
    $json = $payload | ConvertTo-Json -Depth 8 -Compress
    $tmp = $ResultPath + '.tmp'
    [System.IO.File]::WriteAllText($tmp, $json, $utf8NoBom)
    try {
      Move-Item -LiteralPath $tmp -Destination $ResultPath -Force -ErrorAction Stop
    } catch {
      [System.IO.File]::WriteAllText($ResultPath, $json, $utf8NoBom)
    }
  } catch {}
}

function Get-RequestedNames {
  try {
    $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($NamesB64))
    $parsed = $json | ConvertFrom-Json
    # Windows PowerShell 5.1 emits a top-level JSON array as one nested array
    # object. Unwrap it so the package-name filter sees individual strings.
    while ($parsed -is [System.Array] -and $parsed.Count -eq 1 -and $parsed[0] -is [System.Array]) {
      $parsed = $parsed[0]
    }
    return @($parsed | Where-Object {
      $_ -is [string] -and $_ -match '^[A-Za-z0-9._-]+$'
    } | Select-Object -Unique)
  } catch {
    return @()
  }
}

$isAdmin = $false
try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} catch {}

$names = @(Get-RequestedNames)
if ($names.Count -eq 0) {
  Write-Result ([PSCustomObject]@{ ok = $false; error = 'No valid package names were supplied.' })
  exit 0
}

if (-not $isAdmin) {
  Write-Result ([PSCustomObject]@{
    ok = $false
    error = 'ADMIN_REQUIRED'
    detail = 'This operation requires an elevated administrator token.'
  })
  exit 0
}

$nameSet = @{}
foreach ($name in $names) {
  $nameSet[$name.ToLowerInvariant()] = $true
}

function Get-InstalledPackages {
  $scope = 'all-users'
  $packages = @()
  try {
    $packages = @(Get-AppxPackage -AllUsers -ErrorAction Stop)
  } catch {
    $scope = 'current-user'
    try {
      $packages = @(Get-AppxPackage -ErrorAction Stop)
    } catch {
      $packages = @()
    }
  }
  return [PSCustomObject]@{ scope = $scope; packages = $packages }
}

function Get-MatchingPackages($Packages) {
  return @($Packages | Where-Object {
    $_.Name -and $nameSet.ContainsKey([string]$_.Name.ToLowerInvariant())
  } | Group-Object PackageFullName | ForEach-Object { $_.Group[0] })
}

function Get-MatchingProvisioned {
  $script:ProvisionedScanError = ''
  try {
    return @(Get-AppxProvisionedPackage -Online -ErrorAction Stop | Where-Object {
      $_.DisplayName -and $nameSet.ContainsKey([string]$_.DisplayName.ToLowerInvariant())
    } | Group-Object PackageName | ForEach-Object { $_.Group[0] })
  } catch {
    $script:ProvisionedScanError = $_.Exception.Message
    return @()
  }
}

function Group-PackagesByName($Packages) {
  $grouped = @{}
  foreach ($package in $Packages) {
    if (-not $package.Name) { continue }
    $key = ([string]$package.Name).ToLowerInvariant()
    if (-not $grouped.ContainsKey($key)) { $grouped[$key] = @() }
    $grouped[$key] = @($grouped[$key]) + @($package)
  }
  return $grouped
}

function Group-ProvisionedByName($Packages) {
  $grouped = @{}
  foreach ($package in $Packages) {
    if (-not $package.DisplayName) { continue }
    $key = ([string]$package.DisplayName).ToLowerInvariant()
    if (-not $grouped.ContainsKey($key)) { $grouped[$key] = @() }
    $grouped[$key] = @($grouped[$key]) + @($package)
  }
  return $grouped
}

if ($Action -eq 'scan') {
  $snapshot = Get-InstalledPackages
  $installed = @(Get-MatchingPackages $snapshot.packages | ForEach-Object {
    [PSCustomObject]@{
      name = [string]$_.Name
      packageFullName = [string]$_.PackageFullName
      packageFamilyName = [string]$_.PackageFamilyName
      version = [string]$_.Version
      nonRemovable = [bool]$_.NonRemovable
    }
  })
  $provisioned = @(Get-MatchingProvisioned | ForEach-Object {
    [PSCustomObject]@{
      name = [string]$_.DisplayName
      packageName = [string]$_.PackageName
    }
  })

  Write-Result ([PSCustomObject]@{
    ok = $true
    admin = $isAdmin
    scope = $snapshot.scope
    provisionedError = $script:ProvisionedScanError
    installed = $installed
    provisioned = $provisioned
  })
  exit 0
}

# Removal uses one package snapshot and one provisioned-package snapshot instead
# of re-enumerating the whole system for every selected app. That keeps the
# operation within the app's timeout even on slower Windows 10 devices.
$results = @()
try {
  $snapshot = Get-InstalledPackages
  $installedByName = Group-PackagesByName (Get-MatchingPackages $snapshot.packages)
  $provisionedByName = Group-ProvisionedByName (Get-MatchingProvisioned)
  $provisionedScanError = $script:ProvisionedScanError

  $protectedNames = @{}
  foreach ($key in $installedByName.Keys) {
    foreach ($package in $installedByName[$key]) {
      if ($package.NonRemovable) { $protectedNames[$key] = $true }
    }
  }

  foreach ($name in $names) {
    $key = $name.ToLowerInvariant()
    $result = [ordered]@{
      name = $name
      ok = $false
      removed = 0
      provisionedRemoved = 0
      skipped = 0
      remaining = 0
      provisionedRemaining = 0
      errors = @()
    }

    $packages = @()
    if ($installedByName.ContainsKey($key)) { $packages = @($installedByName[$key]) }
    foreach ($package in $packages) {
      if (-not $package.PackageFullName) { continue }
      if ($package.NonRemovable) {
        $result.skipped++
        continue
      }

      $removed = $false
      try {
        Remove-AppxPackage -Package $package.PackageFullName -AllUsers -ErrorAction Stop
        $removed = $true
      } catch {
        try {
          Remove-AppxPackage -Package $package.PackageFullName -ErrorAction Stop
          $removed = $true
        } catch {
          $result.errors += ($package.PackageFullName + ': ' + $_.Exception.Message)
        }
      }
      if ($removed) { $result.removed++ }
    }

    $provisioned = @()
    if ($provisionedByName.ContainsKey($key)) { $provisioned = @($provisionedByName[$key]) }
    if ($protectedNames.ContainsKey($key)) {
      $result.skipped += $provisioned.Count
    } else {
      foreach ($package in $provisioned) {
        try {
          Remove-AppxProvisionedPackage -Online -PackageName $package.PackageName -ErrorAction Stop
          $result.provisionedRemoved++
        } catch {
          $result.errors += ('Provisioned ' + $package.PackageName + ': ' + $_.Exception.Message)
        }
      }
    }

    $results += [PSCustomObject]$result
    Write-State $results $false
  }

  # Verify with one fresh snapshot. This is what makes the final status
  # trustworthy even when an individual Remove-AppxPackage call logged an error.
  $after = Get-InstalledPackages
  $afterInstalled = Group-PackagesByName (Get-MatchingPackages $after.packages)
  $afterProvisioned = Group-ProvisionedByName (Get-MatchingProvisioned)
  $afterProvisionedError = $script:ProvisionedScanError

  foreach ($result in $results) {
    $key = ([string]$result.name).ToLowerInvariant()
    $remainingInstalled = 0
    $remainingProvisioned = 0
    if ($afterInstalled.ContainsKey($key)) { $remainingInstalled = @($afterInstalled[$key]).Count }
    if ($afterProvisioned.ContainsKey($key)) { $remainingProvisioned = @($afterProvisioned[$key]).Count }

    $result.remaining = $remainingInstalled
    $result.provisionedRemaining = $remainingProvisioned
    if ($remainingInstalled -gt 0) {
      $result.errors += ($remainingInstalled.ToString() + ' installed package(s) still present.')
    }
    if ($remainingProvisioned -gt 0) {
      $result.errors += ($remainingProvisioned.ToString() + ' provisioned package(s) still present.')
    }
    if ($afterProvisionedError) {
      $result.errors += ('Provisioned-package verification failed: ' + $afterProvisionedError)
    }
    $result.ok = ($remainingInstalled -eq 0 -and $remainingProvisioned -eq 0 -and -not $afterProvisionedError)
    Write-State $results $false
  }

  Write-State $results $true
  Write-Result ([PSCustomObject]@{
    ok = $true
    admin = $isAdmin
    complete = $true
    scope = $after.scope
    provisionedError = $afterProvisionedError
    results = $results
  })
  exit 0
} catch {
  Write-State $results $false $_.Exception.Message
  Write-Result ([PSCustomObject]@{
    ok = $false
    admin = $isAdmin
    complete = $false
    error = $_.Exception.Message
    results = $results
  })
  exit 0
}
