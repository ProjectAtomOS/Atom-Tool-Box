@echo off
reg add "HKLM\Software\Policies\Microsoft\Edge" /v HubsSidebarEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Policies\Microsoft\Edge" /v ShowRecommendationsEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Policies\Microsoft\Edge" /v EdgeCollectionsEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Policies\Microsoft\Edge" /v EdgeShoppingAssistantEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Policies\Microsoft\Edge" /v PersonalizationEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Policies\Microsoft\Edge" /v EdgeDropEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Policies\Microsoft\Edge" /v ShowMicrosoftRewards /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Policies\Microsoft\Edge" /v StartupBoostEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Policies\Microsoft\Edge" /v EdgeWorkspacesEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Policies\Microsoft\Edge" /v EdgeSidebarEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Policies\Microsoft\Edge" /v EdgeFollowEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Policies\Microsoft\Edge" /v EdgeCloudBrowserEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Policies\Microsoft\Edge" /v SyncDisabled /t REG_DWORD /d 1 /f
reg add "HKLM\Software\Policies\Microsoft\Edge" /v BackgroundModeEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Policies\Microsoft\Edge" /v EdgeSearchEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Policies\Microsoft\Edge" /v WalletDonationEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Policies\Microsoft\Edge" /v EdgePasswordGeneratorEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Policies\Microsoft\Edge" /v EdgePasswordMonitorEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Policies\Microsoft\Edge" /v EdgeTyposquattingCheckerEnabled /t REG_DWORD /d 0 /f
reg add "HKLM\Software\Policies\Microsoft\Edge" /v EdgeMSDefenderSmartScreenEnabled /t REG_DWORD /d 0 /f
exit /b %errorlevel%