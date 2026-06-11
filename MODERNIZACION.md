# Decisión técnica

El proyecto PHP legacy muestra muchos warnings y errores por incompatibilidad con PHP 8.2. Aunque se pueden ocultar o parchar, el costo técnico sube demasiado porque cada pantalla depende de variables globales, includes dinámicos, funciones legacy, jQuery Mobile y lógica mezclada.

Por eso esta entrega reconstruye el sistema en una plataforma moderna:

- React + Vite + TypeScript para frontend.
- Node.js + Express + TypeScript para API.
- PWA real con manifest y service worker.
- Juegos reimplementados como módulos.
- Balance demo y real separados.
- Auditoría con cadena de hashes.
- Pool de invitación integrado.
- Contrato Solidity listo para registrar hashes.

## Próximo paso recomendado

Validar con el cliente las reglas exactas de pago de cada juego heredado. Esta versión ya tiene reglas funcionales, pero las cuotas/multiplicadores pueden ajustarse a las reglas comerciales originales.
