$Root = "C:\hipiplay-app\apps\api"
$Log = "$Root\logs\hipiplay-api.log"
$Node = "C:\Program Files\nodejs\node.exe"

New-Item -ItemType Directory -Path "$Root\logs" -Force | Out-Null

$alreadyRunning = Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue

if ($alreadyRunning) {
    Add-Content $Log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - HipiPlay API ya estaba corriendo en puerto 4001."
    exit 0
}

$env:PORT = "4001"
$env:WEB_ORIGIN = "https://uribepro2.ddns.net"
$env:WEBAUTHN_RP_ID = "uribepro2.ddns.net"
$env:WEBAUTHN_ORIGIN = "https://uribepro2.ddns.net"

$SecretFile = "$Root\data\transfer-passkey-secret.txt"
if (Test-Path $SecretFile) {
    $env:HIPIPLAY_TRANSFER_PASSKEY_SECRET = (Get-Content $SecretFile -Raw).Trim()
}

Set-Location $Root
Add-Content $Log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - Iniciando HipiPlay API puerto 4001..."

& $Node "$Root\dist\index.js" >> $Log 2>&1
