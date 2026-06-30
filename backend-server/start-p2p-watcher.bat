@echo off
cd /d C:\hipiplay-server-windows-v7-db-balance\hipiplay-server-windows-v7-db-balance
set HIPIPLAY_SERVER_URL=http://localhost:4000
set BSC_RPC_URL=https://bsc-dataseed.bnbchain.org
set P2P_WATCHER_SECONDS=15
set P2P_CONFIRMATIONS=3
node tools\p2p-watcher-bsc.cjs
pause