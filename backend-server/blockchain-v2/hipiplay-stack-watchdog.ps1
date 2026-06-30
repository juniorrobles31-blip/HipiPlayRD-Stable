$ErrorActionPreference = "Continue"

$ModuleRoot = $PSScriptRoot
$ServerRoot = Resolve-Path (Join-Path $ModuleRoot "..")
$LogsDir = Join-Path $ServerRoot "logs"

$StartMainCmd = Join-Path $ModuleRoot "start-main-backend-admin-token.cmd"
$StartPanelCmd = Join-Path $ModuleRoot "start-payment-console-4105.cmd"
$StartWatcherCmd = Join-Path $ModuleRoot "start-blockchain-v2-credit-watcher.cmd"
$WatcherFile = Join-Path $ModuleRoot "blockchain-v2-credit-watcher.js"

$LogFile = Join-Path $LogsDir "hipiplay-stack-watchdog.log"

New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null

function Log {
    param([string]$Message)

    $Line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $LogFile -Value $Line -Encoding UTF8
}

function Test-Port {
    param([int]$Port)

    $Item = Get-NetTCPConnection `
        -LocalPort $Port `
        -State Listen `
        -ErrorAction SilentlyContinue |
        Select-Object -First 1

    return $null -ne $Item
}

function Get-PortPid {
    param([int]$Port)

    $Item = Get-NetTCPConnection `
        -LocalPort $Port `
        -State Listen `
        -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if ($Item) {
        return $Item.OwningProcess
    }

    return $null
}

function Wait-Port {
    param(
        [int]$Port,
        [int]$Seconds = 45
    )

    for ($i = 1; $i -le $Seconds; $i++) {
        if (Test-Port -Port $Port) {
            return $true
        }

        Start-Sleep -Seconds 1
    }

    return $false
}

function Start-CmdDetached {
    param(
        [string]$Name,
        [string]$CmdPath
    )

    if (-not (Test-Path $CmdPath)) {
        Log ("{0} no existe: {1}" -f $Name, $CmdPath)
        return
    }

    Log ("Iniciando {0}: {1}" -f $Name, $CmdPath)

    Start-Process `
        -FilePath "cmd.exe" `
        -ArgumentList @("/c", "`"$CmdPath`"") `
        -WorkingDirectory (Split-Path $CmdPath -Parent) `
        -WindowStyle Hidden
}

try {
    Log "Watchdog iniciado."

    if (-not (Test-Port -Port 4000)) {
        Start-CmdDetached -Name "Backend principal 4000" -CmdPath $StartMainCmd
        Wait-Port -Port 4000 -Seconds 45 | Out-Null
    }
    else {
        Log ("Backend 4000 ya activo. PID: {0}" -f (Get-PortPid -Port 4000))
    }

    if (-not (Test-Port -Port 4105)) {
        Start-CmdDetached -Name "Panel Blockchain V2 4105" -CmdPath $StartPanelCmd
        Wait-Port -Port 4105 -Seconds 45 | Out-Null
    }
    else {
        Log ("Panel 4105 ya activo. PID: {0}" -f (Get-PortPid -Port 4105))
    }

    $WatcherProc =
        Get-CimInstance Win32_Process |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine -match [regex]::Escape($WatcherFile)
        } |
        Select-Object -First 1

    if (-not $WatcherProc) {
        if ((Test-Port -Port 4000) -and (Test-Port -Port 4105)) {
            Start-CmdDetached -Name "Watcher PAID a compradas" -CmdPath $StartWatcherCmd
            Start-Sleep -Seconds 3
        }
        else {
            Log "No se inicio watcher porque 4000 o 4105 no estan listos."
        }
    }
    else {
        Log ("Watcher ya activo. PID: {0}" -f $WatcherProc.ProcessId)
    }

    $MainPid = Get-PortPid -Port 4000
    $PanelPid = Get-PortPid -Port 4105

    $WatcherProc =
        Get-CimInstance Win32_Process |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine -match [regex]::Escape($WatcherFile)
        } |
        Select-Object -First 1

    $WatcherPid =
        if ($WatcherProc) { $WatcherProc.ProcessId } else { "" }

    Log ("Estado final | Backend4000={0} | Panel4105={1} | Watcher={2}" -f $MainPid, $PanelPid, $WatcherPid)
}
catch {
    Log ("ERROR: {0}" -f $_.Exception.Message)
}