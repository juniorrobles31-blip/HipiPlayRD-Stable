$ErrorActionPreference = "Stop"

$env:ADMIN_TOKEN = [Environment]::GetEnvironmentVariable(
    "ADMIN_TOKEN",
    "Machine"
)

if ([string]::IsNullOrWhiteSpace($env:ADMIN_TOKEN)) {
    throw "ADMIN_TOKEN no está configurado en las variables de máquina."
}

Set-Location "C:\hipiplay-server-windows-v7-db-balance\hipiplay-server-windows-v7-db-balance"

& "C:\Program Files\nodejs\node.exe" "C:\hipiplay-server-windows-v7-db-balance\hipiplay-server-windows-v7-db-balance\server.js" *>> "C:\hipiplay-server-windows-v7-db-balance\hipiplay-server-windows-v7-db-balance\backend-task.log"
