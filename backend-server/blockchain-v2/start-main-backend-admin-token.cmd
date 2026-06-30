@echo off
set "HIPIPLAY_ADMIN_TOKEN=hipi_admin_9b49d54f974d4824d1afe3734ccd29bf1173671593d34a7099d585284860d261"
cd /d "C:\hipiplay-server-windows-v7-db-balance\hipiplay-server-windows-v7-db-balance"
"C:\Program Files\nodejs\node.exe" "C:\hipiplay-server-windows-v7-db-balance\hipiplay-server-windows-v7-db-balance\server.js" 1>> "C:\hipiplay-server-windows-v7-db-balance\hipiplay-server-windows-v7-db-balance\logs\main-backend.out.log" 2>> "C:\hipiplay-server-windows-v7-db-balance\hipiplay-server-windows-v7-db-balance\logs\main-backend.err.log"