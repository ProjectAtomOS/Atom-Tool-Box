@echo off
powershell -NoProfile -Command "$adapters = Get-NetAdapter -Physical -ErrorAction SilentlyContinue; foreach ($a in $adapters) { Set-DnsClientServerAddress -InterfaceIndex $a.InterfaceIndex -ResetServerAddresses -ErrorAction SilentlyContinue }"
exit /b %errorlevel%