$ErrorActionPreference = "Continue"

$Bcv2 = "C:\hipiplay-server-windows-v7-db-balance\hipiplay-server-windows-v7-db-balance\blockchain-v2"
$CleanupJs = Join-Path $Bcv2 "custody-unpaid-cleanup.js"
$DeleteAvailableJs = Join-Path $Bcv2 "custody-delete-available-deposits.js"
$ConfigFile = Join-Path $Bcv2 "custody-unpaid-cleanup.config.json"
$LogFile = Join-Path $Bcv2 "custody-unpaid-cleanup-loop.log"

while ($true) {
    try {
        $Config = Get-Content $ConfigFile -Raw | ConvertFrom-Json
        $Sleep = [int]$Config.runEverySeconds

        if ($Sleep -lt 10) {
            $Sleep = 10
        }

        $Now = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Add-Content -Path $LogFile -Value "$Now Ejecutando limpieza unpaid/on-demand..."

        Push-Location $Bcv2

        node.exe $CleanupJs | Add-Content -Path $LogFile
        node.exe $DeleteAvailableJs | Add-Content -Path $LogFile

        Pop-Location

        Start-Sleep -Seconds $Sleep
    }
    catch {
        Add-Content -Path $LogFile -Value ("ERROR: " + $_.Exception.Message)
        Start-Sleep -Seconds 30
    }
}