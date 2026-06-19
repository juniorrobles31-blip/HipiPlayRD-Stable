cd "C:\hipiplay-app\apps\web"

$AppFile = "C:\hipiplay-app\apps\web\src\App.tsx"
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$AppBackup = "$AppFile.bak_logic_apuesta_visible_only_$stamp"
Copy-Item $AppFile $AppBackup -Force

$app = [System.IO.File]::ReadAllText($AppFile)

# ==========================================================
# 1) Agregar estados seguros para:
#    - saber si el usuario estÃ¡ realmente en pantalla de APUESTAS
#    - guardar apuesta pendiente para la prÃ³xima carrera
# ==========================================================

$stateMarker = "const resultHoldTimerRef = useRef<number | null>(null);"

if ($app -notmatch "pendingNextServerBet") {
  $newStates = @'
const resultHoldTimerRef = useRef<number | null>(null);
  const [raceScreenActive, setRaceScreenActive] = useState(false);
  const [pendingNextServerBet, setPendingNextServerBet] = useState<null | {
    horse: number;
    amount: number;
    queuedFromRoundId: number;
  }>(null);
  const pendingNextServerBetProcessingRef = useRef(false);
'@

  if (-not $app.Contains($stateMarker)) {
    throw "No encontrÃ© resultHoldTimerRef para insertar estados."
  }

  $app = $app.Replace($stateMarker, $newStates)
}

# ==========================================================
# 2) Escuchar cuando el usuario entra/sale de APUESTAS
#    Esto evita depender solo del servidor.
# ==========================================================

$cycleMarker = "const cycle = useMemo(() => getCycleInfo(now, undefined, sessionEpochRef.current), [now]);"

if ($app -notmatch "syncRaceScreenActive") {
  $raceScreenEffect = @'
const cycle = useMemo(() => getCycleInfo(now, undefined, sessionEpochRef.current), [now]);

  useEffect(() => {
    function syncRaceScreenActive(event?: Event) {
      const detail = event instanceof CustomEvent ? event.detail : undefined;

      if (detail?.view === 'race' || detail?.view === 'bet') {
        setRaceScreenActive(true);
        return;
      }

      if (detail?.view === 'home') {
        setRaceScreenActive(false);
        return;
      }

      setRaceScreenActive(
        document.body.classList.contains('hipiplay-race-mode') &&
        !document.body.classList.contains('hipiplay-home-mode')
      );
    }

    syncRaceScreenActive();

    window.addEventListener('hipiplay-view-change', syncRaceScreenActive as EventListener);

    return () => {
      window.removeEventListener('hipiplay-view-change', syncRaceScreenActive as EventListener);
    };
  }, []);
'@

  if (-not $app.Contains($cycleMarker)) {
    throw "No encontrÃ© const cycle para insertar syncRaceScreenActive."
  }

  $app = $app.Replace($cycleMarker, $raceScreenEffect)
}

# ==========================================================
# 3) Resultado del servidor solo se consulta si el usuario apostÃ³
# ==========================================================

$app = $app.Replace(
  "if (!serverOnline || !serverRaceState || serverRaceState.phase !== 'RESULTS') return;",
  "if (!serverOnline || !serverRaceState || serverRaceState.phase !== 'RESULTS' || !currentUserBet) return;"
)

# ==========================================================
# 4) Arreglar pantalla completa:
#    solo se activa si:
#    - estÃ¡ en APUESTAS
#    - el usuario apostÃ³ en esa ronda
#    - el servidor estÃ¡ en RACE o RESULTS
# ==========================================================

$phasePattern = "/\* HIPIPLAY_SERVER_FULLSCREEN_PHASE_CONTROL \*/[\s\S]*?\}, \[isFullscreenServerRacePhase, serverOnline, serverRaceState\?\.phase\]\);"

$newPhaseControl = @'
/* HIPIPLAY_SERVER_FULLSCREEN_PHASE_CONTROL */
  const hasVisibleBetInCurrentRound = Boolean(
    raceScreenActive &&
    serverOnline &&
    serverRaceState &&
    currentUserBet &&
    currentUserBet.raceId === `server-round-${serverRaceState.roundId}`
  );

  const isFullscreenServerRacePhase = Boolean(
    hasVisibleBetInCurrentRound &&
    serverRaceState &&
    (serverRaceState.phase === 'RACE' || serverRaceState.phase === 'RESULTS')
  );

  useEffect(() => {
    const isRace = Boolean(
      isFullscreenServerRacePhase &&
      serverRaceState?.phase === 'RACE'
    );

    const isResults = Boolean(
      isFullscreenServerRacePhase &&
      serverRaceState?.phase === 'RESULTS'
    );

    document.body.classList.toggle('hipiplay-race-fullscreen-phase', isFullscreenServerRacePhase);
    document.body.classList.toggle('hipiplay-server-race-phase', isRace);
    document.body.classList.toggle('hipiplay-server-results-phase', isResults);

    if (!isFullscreenServerRacePhase) {
      document.body.classList.remove(
        'hipiplay-race-fullscreen-phase',
        'hipiplay-server-race-phase',
        'hipiplay-server-results-phase',
        'hipiplay-race-running-phase',
        'hipiplay-race-result-phase',
        'hipiplay-race-live-phase',
        'hipiplay-race-results-phase'
      );
    }

    return () => {
      document.body.classList.remove(
        'hipiplay-race-fullscreen-phase',
        'hipiplay-server-race-phase',
        'hipiplay-server-results-phase',
        'hipiplay-race-running-phase',
        'hipiplay-race-result-phase',
        'hipiplay-race-live-phase',
        'hipiplay-race-results-phase'
      );
    };
  }, [
    isFullscreenServerRacePhase,
    raceScreenActive,
    hasVisibleBetInCurrentRound,
    serverRaceState?.phase,
    serverRaceState?.roundId
  ]);
'@

if (-not [regex]::IsMatch($app, $phasePattern)) {
  throw "No encontrÃ© el bloque HIPIPLAY_SERVER_FULLSCREEN_PHASE_CONTROL actual."
}

$app = [regex]::Replace($app, $phasePattern, $newPhaseControl, 1)

# ==========================================================
# 5) Evitar que RaceTrack local ponga fullscreen si no hay caballo apostado
# ==========================================================

$app = $app.Replace(
  "const shouldHideBottomNav = Boolean(running || resultPhase);",
  "const shouldHideBottomNav = Boolean(selectedHorse && (running || resultPhase));"
)

# ==========================================================
# 6) Reemplazar funciÃ³n bet():
#    - si estÃ¡ en RACE/RESULTS, guarda apuesta pendiente
#    - si vuelve BETTING, la procesa automÃ¡tica
# ==========================================================

$betStart = $app.IndexOf("async function bet()")
if ($betStart -lt 0) {
  throw "No encontrÃ© async function bet()."
}

$afterBetMarker = "const [walletAction, setWalletAction]"
$afterBetIndex = $app.IndexOf($afterBetMarker, $betStart)
if ($afterBetIndex -lt 0) {
  throw "No encontrÃ© const [walletAction, setWalletAction] despuÃ©s de bet()."
}

$newBetBlock = @'
async function placeServerBet(selectedHorse: number, selectedAmountRaw: number, queueIfClosed = true) {
    if (!serverOnline || !serverRaceState) {
      setMessage('No hay conexiÃ³n con el servidor. No se puede apostar.');
      return;
    }

    const safeAmount = Math.floor(Number(selectedAmountRaw || 0));

    if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
      setMessage('Ingresa una cantidad vÃ¡lida de monedas.');
      return;
    }

    if (serverRaceState.phase !== 'BETTING') {
      if (queueIfClosed) {
        setPendingNextServerBet({
          horse: selectedHorse,
          amount: safeAmount,
          queuedFromRoundId: Number(serverRaceState.roundId || 0)
        });

        setMessage('Hay una carrera en curso. Tu apuesta queda lista para la siguiente carrera.');
      } else {
        setMessage('Las apuestas todavÃ­a no estÃ¡n abiertas. Esperando la prÃ³xima ventana.');
      }

      return;
    }

    if (currentUserBet) {
      setMessage('Ya tienes un boleto generado en esta carrera.');
      return;
    }

    const balanceTotal = getCurrentWalletBalance();

    setLoading(true);
    setMessage('');

    try {
      const res = await sendServerBet({
        playerId: user.id,
        clientName: user.username,
        horseId: selectedHorse,
        amount: safeAmount,
        balanceApostado: safeAmount,
        balanceTotal
      });

      const roundId = res.bet?.roundId || res.bet?.raceNumber || serverRaceState.roundId;
      const betId = res.bet?.id || `SERVER-${roundId}-${Date.now()}`;

      const placedBet: UserRaceBet = {
        raceId: `server-round-${roundId}`,
        raceCode: `Carrera ${roundId}`,
        betId,
        selectedHorse,
        amount: safeAmount
      };

      setServerUserBet(placedBet);

      setUserBetsByRace(prev => ({
        ...prev,
        [placedBet.raceId]: placedBet
      }));

      const balanceAfterBet = Number(
        res.bet?.balanceAfterBet ??
        (res as any).balanceAfterBet ??
        (res as any).walletBalance ??
        (res as any).finalBalance
      );

      if (Number.isFinite(balanceAfterBet)) {
        await applyServerWalletBalance(balanceAfterBet);
      }

      if (res.state) {
        setServerRaceState(res.state);
      }

      setMessage(`Boleto enviado al servidor: ${betId}`);
    } catch (err) {
      setMessage(normalizeError(err));
    } finally {
      setLoading(false);
    }
  }

  async function bet() {
    await placeServerBet(horse, amount, true);
  }

  useEffect(() => {
    if (!pendingNextServerBet) return;
    if (pendingNextServerBetProcessingRef.current) return;
    if (!serverOnline || !serverRaceState) return;
    if (serverRaceState.phase !== 'BETTING') return;
    if (currentUserBet) return;

    const currentRoundId = Number(serverRaceState.roundId || 0);
    const queuedFromRoundId = Number(pendingNextServerBet.queuedFromRoundId || 0);

    if (currentRoundId && queuedFromRoundId && currentRoundId === queuedFromRoundId) {
      return;
    }

    pendingNextServerBetProcessingRef.current = true;

    const pendingHorse = Number(pendingNextServerBet.horse || horse);
    const pendingAmount = Number(pendingNextServerBet.amount || amount);

    setHorse(pendingHorse);
    setAmount(pendingAmount);
    setMessage('Procesando apuesta lista para la siguiente carrera...');

    window.setTimeout(async () => {
      try {
        await placeServerBet(pendingHorse, pendingAmount, false);
        setPendingNextServerBet(null);
      } finally {
        pendingNextServerBetProcessingRef.current = false;
      }
    }, 250);
  }, [
    pendingNextServerBet,
    serverOnline,
    serverRaceState?.phase,
    serverRaceState?.roundId,
    currentUserBet,
    user.id
  ]);

  '

$app = $app.Substring(0, $betStart) + $newBetBlock + $app.Substring($afterBetIndex)

# ==========================================================
# 7) El botÃ³n/input deben poder usarse durante RACE/RESULTS
#    para dejar la apuesta pendiente.
# ==========================================================

$app = $app.Replace(
  'disabled={!bettingOpen || loading}',
  'disabled={loading || Boolean(currentUserBet)}'
)

$app = $app.Replace(
  'disabled={loading || !bettingOpen}',
  'disabled={loading || Boolean(currentUserBet)}'
)

# ==========================================================
# 8) El player-screen solo entra en modo preparaciÃ³n si estÃ¡ en APUESTAS y hay apuesta
# ==========================================================

$app = $app.Replace(
  "return <div className={`player-screen ${currentUserBet && serverRaceState?.phase === 'BETTING' ? 'hipiplay-prep-screen' : ''}`}>",
  "return <div className={`player-screen ${raceScreenActive && currentUserBet && serverRaceState?.phase === 'BETTING' ? 'hipiplay-prep-screen' : ''}`}>"
)

# ==========================================================
# 9) Reemplazar render de carrera/resultados:
#    NO se monta nada si no estÃ¡ en APUESTAS.
#    NO se monta RACE/RESULTS si no hay currentUserBet.
# ==========================================================

$horsePanelIndex = $app.IndexOf('<div className="horse-bet-panel glass">')
if ($horsePanelIndex -lt 0) {
  throw "No encontrÃ© horse-bet-panel."
}

$raceStart = $app.IndexOf("{serverOnline && serverRaceState ? (", $horsePanelIndex)
if ($raceStart -lt 0) {
  throw "No encontrÃ© el bloque de render serverOnline && serverRaceState."
}

$messageStart = $app.IndexOf("{message &&", $raceStart)
if ($messageStart -lt 0) {
  throw "No encontrÃ© el bloque de message despuÃ©s de carrera."
}

$newRaceRender = @'
{raceScreenActive && serverOnline && serverRaceState ? (
      serverRaceState.phase === 'BETTING' ? (
        currentUserBet ? (
          <BettingHorsesPreview
            secondsLeft={serverRaceState.secondsRemaining}
            selectedHorse={currentUserBet.selectedHorse}
          />
        ) : null
      ) : currentUserBet && serverRaceState.phase === 'RACE' ? (
        <RaceVideoEngine
          key={`server-race-${serverRaceState.roundId}`}
          raceId={`server-round-${serverRaceState.roundId}`}
          winners={[]}
          selectedHorse={currentUserBet.selectedHorse}
          betAmount={currentUserBet.amount || 0}
          autoPlay
          startAtSeconds={Math.max(
            0,
            (serverRaceState.raceSeconds || 20) - serverRaceState.secondsRemaining
          )}
          onFinish={() => {
            console.log('Carrera visual local terminÃ³, esperando fase RESULTS del servidor:', serverRaceState.roundId);
          }}
        />
      ) : currentUserBet && serverRaceState.phase === 'RESULTS' ? (
        <ServerRaceResultPanel
          winners={serverRaceState.winners || []}
          selectedHorse={currentUserBet.selectedHorse}
          betAmount={currentUserBet.amount || 0}
          secondsLeft={serverRaceState.secondsRemaining}
          serverPlayerResult={serverPlayerResult}
        />
      ) : null
    ) : raceScreenActive && !serverOnline ? (
      <section className="server-required-panel glass">
        <strong>Sin conexiÃ³n con el servidor</strong>
        <span>
          Las apuestas, el cronÃ³metro, la carrera y los resultados se mostrarÃ¡n cuando la PWA sincronice con el servidor central.
        </span>
      </section>
    ) : null}
'@

$app = $app.Substring(0, $raceStart) + $newRaceRender + $app.Substring($messageStart)

[System.IO.File]::WriteAllText($AppFile, $app, $Utf8NoBom)

Write-Host "Ajuste aplicado solo en App.tsx. Compilando..." -ForegroundColor Green

npm.cmd run build

if ($LASTEXITCODE -ne 0) {
  Write-Host "FallÃ³ la compilaciÃ³n. Restaurando backup..." -ForegroundColor Red
  Copy-Item $AppBackup $AppFile -Force
  throw "Se restaurÃ³ el backup: $AppBackup"
}
