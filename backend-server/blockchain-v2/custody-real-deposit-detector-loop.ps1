$ErrorActionPreference = "Continue"

$ModuleRoot = $PSScriptRoot
$ServerRoot = Resolve-Path (Join-Path $ModuleRoot "..")
$LogsDir = Join-Path $ServerRoot "logs"

$SyncFile = Join-Path $ModuleRoot "custody-balance-sync.js"
$DetectorFile = Join-Path $ModuleRoot "custody-real-deposit-detector.js"

$LoopLog = Join-Path $LogsDir "custody-real-deposit-detector-loop.log"
$SyncLog = Join-Path $LogsDir "custody-balance-sync-auto.log"
$DetectorLog = Join-Path $LogsDir "custody-real-deposit-detector-auto.log"

New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null

function Log {
    param([string]$Message)

    $Line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $LoopLog -Value $Line -Encoding UTF8
}

Log "Detector real loop iniciado."

while ($true) {
    try {
        if (Test-Path $SyncFile) {
            Log "Ejecutando sync real de balances."
            $SyncOutput = node $SyncFile sync 2>&1
            Add-Content -Path $SyncLog -Value ("`n[{0}] SYNC" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss")) -Encoding UTF8
            Add-Content -Path $SyncLog -Value $SyncOutput -Encoding UTF8
        }
        else {
            Log ("No existe SyncFile: {0}" -f $SyncFile)
        }

        if (Test-Path $DetectorFile) {
            Log "Ejecutando detector real de depositos."
            $DetectorOutput = node $DetectorFile scan 2>&1
            Add-Content -Path $DetectorLog -Value ("`n[{0}] SCAN" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss")) -Encoding UTF8
            Add-Content -Path $DetectorLog -Value $DetectorOutput -Encoding UTF8
        }
        else {
            Log ("No existe DetectorFile: {0}" -f $DetectorFile)
        }

        Log "Ciclo completado."
    }
    catch {
        Log ("ERROR: {0}" -f $_.Exception.Message)
    }

    Start-Sleep -Seconds 5
}
