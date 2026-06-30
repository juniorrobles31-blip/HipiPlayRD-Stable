$ErrorActionPreference = "Continue"

$ModuleRoot = $PSScriptRoot
$StackScript = Join-Path $ModuleRoot "hipiplay-stack-watchdog.ps1"
$ServerRoot = Resolve-Path (Join-Path $ModuleRoot "..")
$LogsDir = Join-Path $ServerRoot "logs"
$LoopLog = Join-Path $LogsDir "hipiplay-stack-watchdog-loop.log"

New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null

function LogLoop {
    param([string]$Message)

    $Line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $LoopLog -Value $Line -Encoding UTF8
}

LogLoop "Watchdog loop iniciado."

while ($true) {
    try {
        if (Test-Path $StackScript) {
            powershell.exe -NoProfile -ExecutionPolicy Bypass -File $StackScript
            LogLoop "Watchdog ejecutado correctamente."
        }
        else {
            LogLoop ("No se encontro StackScript: {0}" -f $StackScript)
        }
    }
    catch {
        LogLoop ("ERROR: {0}" -f $_.Exception.Message)
    }

    Start-Sleep -Seconds 300
}