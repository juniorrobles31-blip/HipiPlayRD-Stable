const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const root = process.cwd();
const source = path.join(root, "apps", "web", "src", "assets", "hipiplay-logo.png");
const outDir = path.join(root, "apps", "web", "public", "icons");

fs.mkdirSync(outDir, { recursive: true });

if (!fs.existsSync(source)) {
  console.error("No se encontró el logo en:", source);
  process.exit(1);
}

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

async function run() {
  for (const size of sizes) {
    await sharp(source)
      .resize(size, size)
      .png()
      .toFile(path.join(outDir, `icon-${size}x${size}.png`));
  }

  await sharp(source)
    .resize(512, 512)
    .png()
    .toFile(path.join(outDir, "maskable-icon-512x512.png"));

  console.log("Iconos PWA generados correctamente.");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
