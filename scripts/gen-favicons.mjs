/**
 * Generate favicons and Windows ICO from assets/desktop-app-logo.png.
 *
 * The Windows ICO uses BMP/DIB format for all frames < 256 px
 * (rcedit / electron-builder require this — PNG-in-ICO is rejected silently).
 * The 256×256 frame is stored as PNG per the Vista+ spec.
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
const BUILD = path.join(ROOT, 'build');

// ── PNG exports ────────────────────────────────────────────────────────────────
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

// ── ICO frame builders ─────────────────────────────────────────────────────────

/**
 * Build a BMP/DIB frame (no file header) for ICO embedding.
 * Uses 32-bit BGRA, bottom-up rows, with an all-zero AND mask.
 * Required for sizes < 256 px so rcedit / Windows APIs accept the file.
 */
async function bmpFrame(size) {
  // Get raw RGBA pixels (top-to-bottom)
  const { data } = await sharp(SRC)
    .resize(size, size)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rowBytes = size * 4; // 32-bit BGRA per row
  const pixelBytes = size * rowBytes;
  const andRowBytes = Math.ceil(size / 32) * 4; // AND mask row stride (DWORD aligned)
  const andBytes = andRowBytes * size;
  const dibSize = 40 + pixelBytes + andBytes;
  const buf = Buffer.alloc(dibSize, 0);

  // BITMAPINFOHEADER (40 bytes)
  buf.writeUInt32LE(40, 0);          // biSize
  buf.writeInt32LE(size, 4);         // biWidth
  buf.writeInt32LE(size * 2, 8);     // biHeight (doubled — XOR + AND planes)
  buf.writeUInt16LE(1, 12);          // biPlanes
  buf.writeUInt16LE(32, 14);         // biBitCount
  buf.writeUInt32LE(0, 16);          // biCompression (BI_RGB)
  buf.writeUInt32LE(pixelBytes, 20); // biSizeImage
  // biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant — all 0

  // XOR mask: 32-bit BGRA, rows bottom-to-top
  for (let row = 0; row < size; row++) {
    const srcRow = size - 1 - row; // flip vertical
    for (let col = 0; col < size; col++) {
      const srcIdx = (srcRow * size + col) * 4; // RGBA
      const dstIdx = 40 + row * rowBytes + col * 4;
      buf[dstIdx + 0] = data[srcIdx + 2]; // B
      buf[dstIdx + 1] = data[srcIdx + 1]; // G
      buf[dstIdx + 2] = data[srcIdx + 0]; // R
      buf[dstIdx + 3] = data[srcIdx + 3]; // A
    }
  }

  // AND mask is all zeros (alpha channel in XOR data controls transparency)

  return buf;
}

/** PNG frame for 256×256 (Vista+ spec allows PNG inside ICO at this size). */
async function pngFrame(size) {
  return sharp(SRC).resize(size, size).png().toBuffer();
}

/** Assemble an ICO file from an array of { size, data } frames. */
function assembleIco(frames) {
  const HEADER = 6;
  const DIR = 16;
  const dataOffset = HEADER + DIR * frames.length;

  const offsets = [];
  let off = dataOffset;
  for (const { data } of frames) { offsets.push(off); off += data.length; }

  const buf = Buffer.alloc(off);
  buf.writeUInt16LE(0, 0); // reserved
  buf.writeUInt16LE(1, 2); // type = 1 (icon)
  buf.writeUInt16LE(frames.length, 4);

  frames.forEach(({ size, data }, i) => {
    const b = HEADER + DIR * i;
    buf.writeUInt8(size === 256 ? 0 : size, b);     // width  (0 = 256)
    buf.writeUInt8(size === 256 ? 0 : size, b + 1); // height (0 = 256)
    buf.writeUInt8(0, b + 2);    // colour count
    buf.writeUInt8(0, b + 3);    // reserved
    buf.writeUInt16LE(1, b + 4); // planes
    buf.writeUInt16LE(32, b + 6);// bits per pixel
    buf.writeUInt32LE(data.length, b + 8);
    buf.writeUInt32LE(offsets[i], b + 12);
  });

  let pos = dataOffset;
  for (const { data } of frames) { data.copy(buf, pos); pos += data.length; }
  return buf;
}

// ── favicon.ico — PNG frames are fine for browsers ─────────────────────────────
async function buildBrowserIco(sizes) {
  const frames = await Promise.all(
    sizes.map(async s => ({ size: s, data: await pngFrame(s) }))
  );
  return assembleIco(frames);
}

// ── build/icon.ico — BMP for small, PNG for 256 (rcedit compatible) ───────────
async function buildWindowsIco(sizes) {
  const frames = await Promise.all(
    sizes.map(async s => ({
      size: s,
      data: s === 256 ? await pngFrame(s) : await bmpFrame(s),
    }))
  );
  return assembleIco(frames);
}

// ── Write outputs ──────────────────────────────────────────────────────────────

const faviconIco = await buildBrowserIco([16, 32, 48]);
fs.writeFileSync(path.join(PUB, 'favicon.ico'), faviconIco);
console.log(`✓  public/favicon.ico  (16, 32, 48 px — PNG frames)`);

const appIco = await buildWindowsIco([16, 24, 32, 48, 64, 128, 256]);
fs.writeFileSync(path.join(BUILD, 'icon.ico'), appIco);
console.log(`✓  build/icon.ico  (16–256 px — BMP frames + PNG@256, rcedit-compatible)`);

console.log('\nDone.');
