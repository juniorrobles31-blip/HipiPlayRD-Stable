const fs = require("fs");

const file = "C:\\hipiplay-app\\apps\\web\\src\\App.tsx";

const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
fs.copyFileSync(file, `${file}.bak_close_x_safe_${stamp}`);

let text = fs.readFileSync(file, "utf8");

let count = 0;

text = text.replace(
  /(<button[^>]*onClick=\{onClose\}[^>]*>)([\s\S]*?)(<\/button>)/g,
  function (_, open, inner, close) {
    count++;
    return `${open}X${close}`;
  }
);

fs.writeFileSync(file, text, "utf8");

console.log(`Botones onClose corregidos: ${count}`);
