@echo off
rd /s /q %temp% 2>nul
md %temp% 2>nul
rd /s /q C:\Windows\Temp 2>nul
md C:\Windows\Temp 2>nul
rd /s /q C:\Windows\Prefetch 2>nul
md C:\Windows\Prefetch 2>nul
exit /b 0