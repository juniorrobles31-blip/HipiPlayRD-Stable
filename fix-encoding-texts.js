const fs = require("fs");

const files = [
  "C:\\hipiplay-app\\apps\\web\\src\\App.tsx",
  "C:\\hipiplay-app\\apps\\web\\src\\styles.css"
];

const replacements = [
  ["\u00c3\u00a1", "\u00e1"],
  ["\u00c3\u0081", "\u00c1"],
  ["\u00c3\u00a9", "\u00e9"],
  ["\u00c3\u0089", "\u00c9"],
  ["\u00c3\u00ad", "\u00ed"],
  ["\u00c3\u008d", "\u00cd"],
  ["\u00c3\u00b3", "\u00f3"],
  ["\u00c3\u0093", "\u00d3"],
  ["\u00c3\u00ba", "\u00fa"],
  ["\u00c3\u009a", "\u00da"],
  ["\u00c3\u00b1", "\u00f1"],
  ["\u00c3\u0091", "\u00d1"],
  ["\u00c2\u00bf", "\u00bf"],
  ["\u00c2\u00a1", "\u00a1"],
  ["\u00c2\u00a0", " "],
  ["\u00c2\u00b7", "\u00b7"],
  ["\u00c3\u0097", "\u00d7"],

  ["\u00e2\u20ac\u201d", "\u2014"],
  ["\u00e2\u20ac\u201c", "\u2013"],
  ["\u00e2\u20ac\u02dc", "\u2018"],
  ["\u00e2\u20ac\u2122", "\u2019"],
  ["\u00e2\u20ac\u0153", "\u201c"],
  ["\u00e2\u20ac\u009d", "\u201d"],
  ["\u00e2\u20ac\ufffd", "\u201d"],
  ["\u00e2\u20ac\u00a6", "\u2026"],
  ["\u00e2\u0153\u201c", "\u2713"]
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log("No existe:", file);
    continue;
  }

  const backup = `${file}.bak_encoding_fix_${stamp}`;
  fs.copyFileSync(file, backup);

  let text = fs.readFileSync(file, "utf8");
  let before = text;

  for (const [from, to] of replacements) {
    text = text.replace(new RegExp(escapeRegExp(from), "g"), to);
  }

  fs.writeFileSync(file, text, "utf8");

  console.log(text === before ? `Sin cambios: ${file}` : `Corregido: ${file}`);
  console.log(`Backup: ${backup}`);
}
