@echo off
powershell -NoProfile -Command "$devices = Get-PnpDevice -Class 'Display','Net' -ErrorAction SilentlyContinue; foreach ($d in $devices) { $path = 'HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\' + $d.InstanceId + '\\Device Parameters\\Interrupt Management\\MessageSignaledInterruptProperties'; if (Test-Path $path) { Set-ItemProperty -Path $path -Name 'MSISupported' -Value 0 -ErrorAction SilentlyContinue } }"
exit /b %errorlevel%
