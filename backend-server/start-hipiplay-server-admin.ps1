$ErrorActionPreference = "Stop"

$env:HIPIPLAY_ADMIN_TOKEN = [Environment]::GetEnvironmentVariable(
    "HIPIPLAY_ADMIN_TOKEN",
    "Machine"
)

if ([string]::IsNullOrWhiteSpace($env:HIPIPLAY_ADMIN_TOKEN)) {
    throw "HIPIPLAY_ADMIN_TOKEN no está configurado."
}

Set-Location "C:\hipiplay-server-windows-v7-db-balance\hipiplay-server-windows-v7-db-balance"

& "C:\Program Files\nodejs\node.exe" `
  "C:\hipiplay-server-windows-v7-db-balance\hipiplay-server-windows-v7-db-balance\server.js"
