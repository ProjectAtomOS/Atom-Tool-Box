@echo off
reg add "HKLM\System\CurrentControlSet\Control\Session Manager\Memory Management" /v FeatureSettings /t REG_DWORD /d 0 /f
exit /b %errorlevel%

