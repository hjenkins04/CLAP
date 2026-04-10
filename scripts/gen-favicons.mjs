/**
 * Generate favicons from assets/desktop-app-logo.png
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const sharp = require(path.join(ROOT, 'docs/scripts/node_modules/sharp'));

const SRC = path.join(ROOT, 'assets/desktop-app-logo.png');
const PUB = path.join(ROOT, 'public');

// ── PNG sizes ──────────────────────────────────────────────────────────────────
const pngJobs = [
  { size: 16,  out: path.join(PUB, 'favicon-16x16.png') },
  { size: 32,  out: path.join(PUB, 'favicon-32x32.png') },
  { size: 180, out: path.join(PUB, 'apple-touch-icon.png') },
  { size: 512, out: path.join(PUB, 'icon-512.png') },
];

for (const { size, out } of pngJobs) {
  await sharp(SRC).resize(size, size).png().toFile(out);
  console.log(`✓  ${path.relative(ROOT, out)}`);
}

// ── ICO (16, 32, 48 frames stored as PNG blobs inside ICO container) ──────────
async function buildIco(sizes) {
  const frames = await Promise.all(
    sizes.map(s => sharp(SRC).resize(s, s).png().toBuffer())
  );

  const HEADER = 6;
  const DIR_ENTRY = 16;
  const dataOffset = HEADER + DIR_ENTRY * frames.length;

  const offsets = [];
  let off = dataOffset;
  for (const f of frames) { offsets.push(off); off += f.length; }

  const ico = Buffer.alloc(off);
  ico.writeUInt16LE(0, 0);             // reserved
  ico.writeUInt16LE(1, 2);             // type = 1 (icon)
  ico.writeUInt16LE(frames.length, 4); // image count

  frames.forEach((f, i) => {
    const s = sizes[i];
    const b = HEADER + DIR_ENTRY * i;
    ico.writeUInt8(s === 256 ? 0 : s, b);      // width
    ico.writeUInt8(s === 256 ? 0 : s, b + 1);  // height
    ico.writeUInt8(0, b + 2);    // colour count
    ico.writeUInt8(0, b + 3);    // reserved
    ico.writeUInt16LE(1, b + 4); // planes
    ico.writeUInt16LE(32, b + 6);// bpp
    ico.writeUInt32LE(f.length, b + 8);   // data size
    ico.writeUInt32LE(offsets[i], b + 12); // data offset
  });

  let pos = dataOffset;
  for (const f of frames) { f.copy(ico, pos); pos += f.length; }
  return ico;
}

// public/favicon.ico — small sizes for browser tab
const faviconIco = await buildIco([16, 32, 48]);
fs.writeFileSync(path.join(PUB, 'favicon.ico'), faviconIco);
console.log(`✓  public/favicon.ico  (16, 32, 48 px)`);

// build/icon.ico — full Windows icon with all standard sizes
const BUILD = path.join(ROOT, 'build');
const appIco = await buildIco([16, 24, 32, 48, 64, 128, 256]);
fs.writeFileSync(path.join(BUILD, 'icon.ico'), appIco);
console.log(`✓  build/icon.ico  (16, 24, 32, 48, 64, 128, 256 px)`);

console.log('\nDone.');
