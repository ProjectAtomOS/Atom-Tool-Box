@echo off
reg add "HKLM\Software\Policies\Microsoft\Power\PowerSettings\f15576e8-98b7-4186-b944-eafa664402d9" /v DCSettingIndex /t REG_DWORD /d 1 /f
exit /b %errorlevel%