@echo off
powershell -NoProfile -Command "$adapters = Get-NetAdapter -Physical -ErrorAction SilentlyContinue; foreach ($a in $adapters) { Set-DnsClientServerAddress -InterfaceIndex $a.InterfaceIndex -ServerAddresses ('1.1.1.1','1.0.0.1') -ErrorAction SilentlyContinue }"
exit /b %errorlevel%