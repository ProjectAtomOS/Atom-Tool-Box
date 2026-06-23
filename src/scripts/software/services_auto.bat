@echo off
sc config Fax start=auto
sc config WbioSrvc start=auto
sc config icssvc start=auto
sc config WalletService start=auto
sc config lfsvc start=auto
sc config MapsBroker start=auto
sc config SmsRouter start=auto
sc config PhoneSvc start=auto
sc config PrintNotify start=auto
sc config RemoteRegistry start=auto
sc config TapiSrv start=auto
sc config TextInputManagementService start=auto
sc config WMPNetworkSvc start=auto
sc config WpcMonSvc start=auto
exit /b %errorlevel%