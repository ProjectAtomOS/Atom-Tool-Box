@echo off
:: Check if Ultimate Performance already exists before duplicating
powercfg /list | findstr "e9a42b02-d5df-448d-aa00-03f14749eb61" >nul 2>&1
if %errorlevel% neq 0 (
  powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61
)
powercfg /setactive e9a42b02-d5df-448d-aa00-03f14749eb61
exit /b %errorlevel%
