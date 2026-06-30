const fs = require("fs");

const file = process.argv[2];
const baseUrl = process.argv[3] || "http://localhost:4000";

if (!file) {
  console.error("Uso: node tools/import-wallet-pool.cjs wallet-public\\archivo.json");
  process.exit(1);
}

async function main() {
  const wallets = JSON.parse(fs.readFileSync(file, "utf8"));

  let ok = 0;
  let fail = 0;

  for (const wallet of wallets) {
    try {
      const response = await fetch(`${baseUrl}/api/admin/wallet-pool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wallet)
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.ok === false) {
        fail++;
        console.log("ERROR:", wallet.address, data.error || response.status);
        continue;
      }

      ok++;
      console.log("OK:", wallet.address);
    } catch (error) {
      fail++;
      console.log("ERROR:", wallet.address, error.message);
    }
  }

  console.log("");
  console.log(`Importadas: ${ok}`);
  console.log(`Fallidas: ${fail}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});