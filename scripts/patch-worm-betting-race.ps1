$ErrorActionPreference = "Stop"

$AppPath = "C:\hipiplay-app\apps\web\src\App.tsx"
$CssPath = "C:\hipiplay-app\apps\web\src\styles.css"
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"

Copy-Item $AppPath "$AppPath.bak_worm_$Stamp"
Copy-Item $CssPath "$CssPath.bak_worm_$Stamp"

$app = Get-Content $AppPath -Raw

# Quitar imports que ya no usaremos para evitar errores de TypeScript
$app = $app -replace "import\s+\{\s*RaceVideoEngine\s*\}\s+from\s+'\.\/components\/raceVideoEngine\/RaceVideoEngine';\r?\n", ""
$app = $app -replace "import\s+\{\s*BettingHorsesPreview\s*\}\s+from\s+'\.\/components\/raceVideoEngine\/BettingHorsesPreview';\r?\n", ""

# Agregar variables de fase justo después de bettingOpen
$oldBettingOpen = "const bettingOpen = Boolean(serverOnline && serverRaceState && serverRaceState.phase === 'BETTING' && !currentUserBet);"

$newBettingOpen = @"
const bettingOpen = Boolean(serverOnline && serverRaceState && serverRaceState.phase === 'BETTING' && !currentUserBet);

  const serverPhase = String(serverRaceState?.phase || '').toUpperCase();
  const isWaitingInCurrentRound = Boolean(
    serverOnline &&
    serverRaceState &&
    currentUserBet &&
    currentUserBet.raceId === `server-round-${serverRaceState.roundId}` &&
    ['BETTING', 'RACE'].includes(serverPhase)
  );
  const isServerResultsPhase = Boolean(
    serverOnline &&
    serverRaceState &&
    serverPhase.startsWith('RESULT')
  );
"@

if ($app -notlike "*const serverPhase = String(serverRaceState?.phase || '').toUpperCase();*") {
  $app = $app.Replace($oldBettingOpen, $newBettingOpen)
}

# Cambiar clase principal: antes solo activaba prep en BETTING, ahora en BETTING y RACE
$app = $app -replace "return <div className=\{`player-screen \$\{currentUserBet && serverRaceState\?\.phase === 'BETTING' \? 'hipiplay-prep-screen' : ''\}`\}>", "return <div className={`player-screen ${isWaitingInCurrentRound ? 'hipiplay-prep-screen hipiplay-worm-waiting-screen' : ''}`}>"

# Evitar cambio de caballo después de apostar mientras BETTING/RACE
$app = $app -replace "onSelect=\{\(selected\) => setHorse\(selected\)\}", "onSelect={(selected) => { if (!isWaitingInCurrentRound) setHorse(selected); }}"

# Fullscreen solamente para RESULTS, no para RACE
$oldFullscreen = @"
const isFullscreenServerRacePhase = Boolean(
    hasVisibleBetInCurrentRound &&
    serverRaceState &&
    (serverRaceState.phase === 'RACE' || serverRaceState.phase === 'RESULTS')
  );
"@

$newFullscreen = @"
const isFullscreenServerRacePhase = Boolean(
    hasVisibleBetInCurrentRound &&
    serverRaceState &&
    String(serverRaceState.phase || '').toUpperCase().startsWith('RESULT')
  );
"@

$app = $app.Replace($oldFullscreen, $newFullscreen)

# Cambiar lógica del bloque visual del servidor:
# BETTING/RACE ya no muestran imagen ni video.
# Solo RESULTS muestra resultados.
$oldRender = @"
{serverOnline && serverRaceState ? (
      serverRaceState.phase === 'BETTING' ? (
        <BettingHorsesPreview
          secondsLeft={serverRaceState.secondsRemaining}
          selectedHorse={currentUserBet?.selectedHorse}
        />
      ) : serverRaceState.phase === 'RACE' ? (
        <RaceVideoEngine
          key={`server-race-${serverRaceState.roundId}`}
          raceId={`server-round-${serverRaceState.roundId}`}
          winners={[]}
          selectedHorse={currentUserBet?.selectedHorse}
          betAmount={currentUserBet?.amount || 0}
          autoPlay
          startAtSeconds={Math.max(
            0,
            (serverRaceState.raceSeconds || 20) - serverRaceState.secondsRemaining
          )}
          onFinish={() => {
            console.log('Carrera visual local terminÃƒÂ³, esperando fase RESULTS del servidor:', serverRaceState.roundId);
          }}
        />
      ) : (
        <ServerRaceResultPanel
          winners={serverRaceState.winners || []}
          selectedHorse={currentUserBet?.selectedHorse}
          betAmount={currentUserBet?.amount || 0}
          secondsLeft={serverRaceState.secondsRemaining}
          serverPlayerResult={serverPlayerResult}
        />
      )
    ) : (
"@

$newRender = @"
{serverOnline && serverRaceState ? (
      isServerResultsPhase ? (
        <ServerRaceResultPanel
          winners={serverRaceState.winners || []}
          selectedHorse={currentUserBet?.selectedHorse}
          betAmount={currentUserBet?.amount || 0}
          secondsLeft={serverRaceState.secondsRemaining}
          serverPlayerResult={serverPlayerResult}
        />
      ) : currentUserBet ? (
        <section className="betting-wait-inline glass">
          <strong>Boleto confirmado</strong>
          <span>
            {serverPhase === 'RACE'
              ? 'Carrera en curso. Esperando resultado oficial del servidor.'
              : 'Apuesta registrada. Esperando cierre de apuestas.'}
          </span>
        </section>
      ) : null
    ) : (
"@

if ($app.Contains($oldRender)) {
  $app = $app.Replace($oldRender, $newRender)
} else {
  throw "No pude reemplazar el bloque BETTING/RACE/RESULTS. Hay que revisar el fragmento manualmente."
}

Set-Content -Path $AppPath -Value $app -Encoding UTF8

$css = Get-Content $CssPath -Raw

$cssBlock = @"

/* HIPIPLAY WORM WAITING ANIMATION - BETTING + RACE */
@property --hipi-worm-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

.hipiplay-worm-waiting-screen .horse-bet-card {
  position: relative;
  overflow: visible !important;
}

.hipiplay-worm-waiting-screen .horse-bet-card::before {
  content: "";
  position: absolute;
  inset: -3px;
  z-index: 5;
  border-radius: inherit;
  padding: 3px;
  pointer-events: none;
  background:
    conic-gradient(
      from var(--hipi-worm-angle),
      transparent 0deg,
      transparent 250deg,
      rgba(36, 255, 112, 0.10) 268deg,
      rgba(36, 255, 112, 0.55) 286deg,
      #e2ffec 303deg,
      rgba(36, 255, 112, 1) 318deg,
      rgba(36, 255, 112, 0.35) 338deg,
      transparent 356deg,
      transparent 360deg
    );
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  filter:
    drop-shadow(0 0 5px rgba(36, 255, 112, 0.95))
    drop-shadow(0 0 12px rgba(36, 255, 112, 0.65));
  animation: hipiplayWormAroundHorseCard 1.55s linear infinite;
}

.hipiplay-worm-waiting-screen .horse-bet-card:nth-child(1)::before {
  animation-duration: 1.46s;
}

.hipiplay-worm-waiting-screen .horse-bet-card:nth-child(2)::before {
  animation-duration: 1.72s;
}

.hipiplay-worm-waiting-screen .horse-bet-card:nth-child(3)::before {
  animation-duration: 1.58s;
}

.hipiplay-worm-waiting-screen .horse-bet-card:nth-child(4)::before {
  animation-duration: 1.86s;
}

.hipiplay-worm-waiting-screen .horse-bet-card:nth-child(5)::before {
  animation-duration: 1.63s;
}

.hipiplay-worm-waiting-screen .horse-bet-card:nth-child(6)::before {
  animation-duration: 1.78s;
}

.hipiplay-worm-waiting-screen .horse-bet-card-image,
.hipiplay-worm-waiting-screen img {
  position: relative;
}

.hipiplay-worm-waiting-screen .horse-bet-card-number {
  z-index: 8;
}

.betting-wait-inline {
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: 16px;
  border: 1px solid rgba(36, 255, 112, 0.38);
  background: rgba(0, 28, 12, 0.78);
  color: #eafff1;
  text-align: center;
  box-shadow: 0 0 18px rgba(36, 255, 112, 0.16);
}

.betting-wait-inline strong {
  display: block;
  font-size: 0.92rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.betting-wait-inline span {
  display: block;
  margin-top: 4px;
  font-size: 0.78rem;
  opacity: 0.86;
}

@keyframes hipiplayWormAroundHorseCard {
  from {
    --hipi-worm-angle: 0deg;
  }

  to {
    --hipi-worm-angle: 360deg;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hipiplay-worm-waiting-screen .horse-bet-card::before {
    animation-duration: 3s;
  }
}

"@

if ($css -notlike "*HIPIPLAY WORM WAITING ANIMATION - BETTING + RACE*") {
  Add-Content -Path $CssPath -Value $cssBlock -Encoding UTF8
}

Write-Host "LISTO: App.tsx y styles.css modificados con backup."
