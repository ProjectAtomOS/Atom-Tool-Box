@echo off
sc config Fax start=demand
sc config WbioSrvc start=demand
sc config icssvc start=demand
sc config WalletService start=demand
sc config lfsvc start=demand
sc config MapsBroker start=demand
sc config SmsRouter start=demand
sc config PhoneSvc start=demand
sc config PrintNotify start=demand
sc config RemoteRegistry start=demand
sc config TapiSrv start=demand
sc config TextInputManagementService start=demand
sc config WMPNetworkSvc start=demand
sc config WpcMonSvc start=demand
exit /b %errorlevel%