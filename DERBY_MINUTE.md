# Derby Minute — Juego de Caballos Sincrónico Global

Esta versión convierte el juego de Caballos en un evento global de 60 segundos.

## Reglas implementadas

- Carrera global única cada 60 segundos.
- 6 caballos numerados del 1 al 6.
- El usuario puede seleccionar un solo caballo por carrera y por modo.
- Ventana de apuestas abierta hasta 5 segundos antes de revelar el resultado.
- Resultado global idéntico para todos los usuarios.
- Si el caballo elegido queda en 1.º, 2.º o 3.º lugar, el usuario cobra 2x.
- Si queda en 4.º, 5.º o 6.º lugar, la apuesta se pierde y se registra como quema de fichas.
- Cada carrera genera hash de auditoría listo para blockchain.
- El “Dueño del Minuto” se calcula con el ranking del Pool de Invitación y recibe 10% del volumen real de la carrera como crédito de regalo bloqueado.

## Endpoints nuevos

```txt
GET  /api/races/current
POST /api/races/bet
GET  /api/races/history
```

## Variables de entorno opcionales

En `apps/api/.env` puedes configurar:

```env
RACE_DURATION_MS=60000
BET_CLOSE_BEFORE_REVEAL_MS=5000
MINUTE_OWNER_PERCENTAGE=10
DERBY_SERVER_SECRET=cambia-este-secreto-en-produccion
```

## Auditoría blockchain-ready

Se generan auditorías para:

```txt
DERBY_RACE_CREATED
DERBY_BET_PLACED
DERBY_RACE_REVEALED
```

Estas auditorías aparecen en el módulo **Auditoría** y pueden enviarse posteriormente a blockchain con el script de ejemplo incluido.

## Nota técnica

El frontend no genera el resultado. El resultado lo genera el backend de forma determinística, usando una semilla del servidor, y lo revela cuando termina la carrera. La PWA solo muestra la carrera, el contador, la selección del usuario y el resultado global.
