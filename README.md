# Juega123 Modern Platform

Reconstrucción moderna del proyecto legacy `juega123` usando arquitectura actual:

- Frontend PWA moderno con React + Vite + TypeScript.
- Backend API con Node.js + Express + TypeScript.
- Persistencia local en JSON para demo rápida sin MySQL.
- Arquitectura lista para cambiar a PostgreSQL/MySQL en producción.
- Juegos incluidos: Caballos, Dado Directo, Súper Dado, Dado Tripleta, Ruleta y Puntazo.
- Modo Demo y Real con contabilidades separadas.
- Auditoría por hashes tipo blockchain interna.
- Contrato Solidity para registrar hashes en blockchain.
- Pool de Invitación minuto a minuto con crédito de regalo bloqueado.

> Esta versión no intenta seguir parchando el PHP antiguo. Es una reconstrucción moderna para que puedas probar rápido y luego evolucionarla a producción.

## Requisitos

Instalar:

- Node.js LTS
- npm
- Git opcional

No necesitas XAMPP para probar esta versión moderna.

## Instalación rápida en Windows PowerShell

```powershell
cd C:\xampp\htdocs
# Descomprime esta carpeta como juega123_modern
cd juega123_modern
npm run install:all
npm run dev
```

Luego abre:

```text
http://localhost:5173
```

Backend API:

```text
http://localhost:4000/api/health
```

## Usuario de prueba

```text
Usuario: admin
Clave: admin123
```

## Estructura

```text
apps/api       Backend API moderno
apps/web       Frontend PWA moderno
contracts      Contrato Solidity de auditoría
scripts        Script de ejemplo para subir hashes a blockchain
```

## Flujo funcional

1. El usuario inicia sesión.
2. Entra a un juego.
3. Selecciona modo Demo o Real.
4. Realiza apuesta.
5. El backend calcula resultado.
6. Se actualiza el balance correspondiente.
7. Se genera hash de auditoría encadenado.
8. El hash queda listo para enviarse a blockchain.

## Pool de Invitación

- Cada usuario genera su link.
- Cuando un referido hace una compra, sube el contador del invitador.
- Cada 60 segundos puede cerrarse una ronda.
- El ganador recibe crédito de regalo bloqueado.
- Para liberar el crédito debe duplicar el monto jugando.

## Blockchain

Contrato:

```text
contracts/HorseAuditRegistry.sol
```

Script ejemplo:

```text
scripts/push-audits-example.js
```

La app no mueve dinero en blockchain en esta fase; registra hashes de auditoría.

## Producción recomendada

Para producción se recomienda cambiar:

- JSON local → PostgreSQL o MySQL.
- JWT secret fuerte en `.env`.
- HTTPS obligatorio.
- Logs centralizados.
- Reglas exactas de pago validadas por negocio.
- KYC/legal si el juego usa dinero real.


## Nuevo: Derby Minute

El juego de Caballos fue ajustado a modalidad sincrónica global:

- Una carrera mundial cada 60 segundos.
- Todos los usuarios reciben el mismo resultado.
- Se apuesta a un solo caballo.
- Top 3 paga 2x.
- Fuera del Top 3 pierde y se registra quema de fichas.
- Se genera auditoría hash lista para blockchain.
- El Dueño del Minuto recibe incentivo como crédito de regalo bloqueado.

Detalles técnicos en `DERBY_MINUTE.md`.
