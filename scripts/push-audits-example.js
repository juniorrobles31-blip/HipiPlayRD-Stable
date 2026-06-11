/*
Ejemplo de script para enviar hashes pendientes a blockchain.

Uso futuro:
1. npm install ethers dotenv
2. Configurar RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS
3. Leer /api/audits/pending
4. Enviar cada hash al contrato HorseAuditRegistry
5. Marcarlo como enviado en /api/audits/:id/mark-sent
*/

console.log('Este es un script base. Configura ethers y variables .env antes de usarlo en testnet.');
