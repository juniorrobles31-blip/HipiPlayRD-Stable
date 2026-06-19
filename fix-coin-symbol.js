const fs = require("fs");

const files = [
  "C:\\hipiplay-app\\apps\\web\\src\\App.tsx",
  "C:\\hipiplay-app\\apps\\web\\src\\styles.css"
];

const replacements = [
  ["\u00f0\u0178\u00aa\u2122", "\u{1FA99}"], // ???? -> ??
  ["\u00f0\u0178\u2019\u00b0", "\u{1F4B0}"], // ???? -> ??
  ["\u00f0\u0178\u0092\u00b0", "\u{1F4B0}"]  // otra variante -> ??
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;

  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  fs.copyFileSync(file, `${file}.bak_coin_symbol_${stamp}`);

  let text = fs.readFileSync(file, "utf8");
  let before = text;

  for (const [from, to] of replacements) {
    text = text.split(from).join(to);
  }

  fs.writeFileSync(file, text, "utf8");

  console.log(text === before ? `Sin cambios: ${file}` : `Corregido: ${file}`);
}
