const [playerId, clientName, amount, network = "BSC"] = process.argv.slice(2);
const baseUrl = "http://localhost:4000";

if (!playerId || !amount) {
  console.error('Uso: node tools/create-deposit-order.cjs cliente_001 "Cliente Nombre" 100 BSC');
  process.exit(1);
}

async function main() {
  const response = await fetch(`${baseUrl}/api/player/deposit/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerId,
      clientName: clientName || playerId,
      amount: Number(amount),
      network,
      token: "USDT"
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  console.log(JSON.stringify(data, null, 2));
  console.log("");
  console.log("INSTRUCCIÓN PARA EL CLIENTE:");
  console.log(`Enviar ${data.order.expectedAmount} USDT por red ${data.order.network} a:`);
  console.log(data.order.address);
  console.log("");
  console.log("Orden:", data.order.orderId);
}

main().catch((error) => {
  console.error("ERROR:", error.message);
  process.exit(1);
});