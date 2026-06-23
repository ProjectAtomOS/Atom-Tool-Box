@echo off
reg add "HKLM\SOFTWARE\Microsoft\PolicyManager\current\device\Stickers" /v EnableStickers /t REG_DWORD /d 0 /f
exit /b %errorlevel%