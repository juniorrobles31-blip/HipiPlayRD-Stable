$Root = "C:\hipiplay-server-windows-v7-db-balance\hipiplay-server-windows-v7-db-balance"
$Log = "$Root\logs\hipiplay-server.log"
$Node = "C:\Program Files\nodejs\node.exe"

New-Item -ItemType Directory -Path "$Root\logs" -Force | Out-Null

$alreadyRunning = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue

if ($alreadyRunning) {
    Add-Content $Log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - HipiPlay Server ya estaba corriendo en puerto 4000."
    exit 0
}

$TokenFile = "$Root\.secrets\admin-token.txt"
if (Test-Path $TokenFile) {
    $env:HIPIPLAY_ADMIN_TOKEN = (Get-Content $TokenFile -Raw).Trim()
}

Set-Location $Root
Add-Content $Log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - Iniciando HipiPlay Server puerto 4000 con node directo..."

& $Node "$Root\server.js" >> $Log 2>&1
