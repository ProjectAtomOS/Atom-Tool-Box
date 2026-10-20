@echo off
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v BraveRewardsDisabled /t REG_DWORD /d 1 /f
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v BraveWalletDisabled /t REG_DWORD /d 1 /f
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v BraveVPNDisabled /t REG_DWORD /d 1 /f
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v BraveAIChatEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v BraveStatsPingEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v MetricsReportingEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v SearchSuggestEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v AlternateErrorPagesEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v NetworkPredictionOptions /t REG_DWORD /d 2 /f
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v BackgroundModeEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v SyncDisabled /t REG_DWORD /d 1 /f
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v PasswordManagerEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v AutofillAddressEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v AutofillCreditCardEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v HomepageIsNewTabPage /t REG_DWORD /d 1 /f
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v RestoreOnStartup /t REG_DWORD /d 5 /f
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v SafeBrowsingEnabled /t REG_DWORD /d 1 /f
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v HttpsOnlyMode /t REG_SZ /d force_enabled /f
exit /b 0
