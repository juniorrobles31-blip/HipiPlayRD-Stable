@echo off
cd /d C:\hipiplay-server-windows-v7-db-balance\hipiplay-server-windows-v7-db-balance
set HIPIPLAY_SERVER_URL=http://localhost:4000
set BSC_RPC_URL=https://bsc-dataseed.bnbchain.org
set DEPOSIT_WATCHER_SECONDS=15
set DEPOSIT_CONFIRMATIONS=3
node tools\deposit-watcher-bsc.cjs
pause