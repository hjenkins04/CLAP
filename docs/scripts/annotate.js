/**
 * CLAP Documentation — Image Annotation Script
 *
 * Reads raw screenshots + .meta.json files and produces Scribe-styled
 * annotated images with: red numbered circles, bounding boxes, hotkey badges, arrows.
 *
 * Usage:
 *   node annotate.js                     # Annotate all sections
 *   node annotate.js 01-loading-a-project  # Annotate one section
 *
 * Prerequisites:
 *   cd docs/scripts && npm install
 *
 * Screenshot placement:
 *   Place raw PNGs in docs/<section>/screenshots/<filename>.png
 *   The .meta.json files define what annotations to overlay.
 *
 * Output:
 *   Annotated images are written to docs/<section>/screenshots/annotated/<filename>.png
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.resolve(__dirname, '..');

// ─── Color palette (Scribe-inspired) ─────────────────────────────────────────
const RED       = '#E8303A';
const RED_FILL  = 'rgba(232,48,58,0.12)';
const BADGE_BG  = '#1C1C1E';
const BADGE_FG  = '#FFFFFF';
const BADGE_BD  = '#4A4A4A';
const STEP_BG   = '#E8303A';
const STEP_FG   = '#FFFFFF';
const FONT      = 'Arial, Helvetica, sans-serif';

// ─── SVG builders ─────────────────────────────────────────────────────────────

/** Red numbered circle highlighting a UI element */
function svgCircle(ann) {
  const { x, y, radius = 28, number, label } = ann;
  const r = radius;
  // Step badge (small circle top-left of the highlight ring)
  const bx = x - r - 2;
  const by = y - r - 2;
  const br = 13;
  const numStr = number !== undefined ? String(number) : '';

  return `
    <!-- Circle: ${label || ''} -->
    <circle cx="${x}" cy="${y}" r="${r}"
      fill="${RED_FILL}" stroke="${RED}" stroke-width="2.5"/>
    ${numStr ? `
    <circle cx="${bx}" cy="${by}" r="${br}" fill="${STEP_BG}"/>
    <text x="${bx}" y="${by + 4.5}" text-anchor="middle" dominant-baseline="middle"
      fill="${STEP_FG}" font-family="${FONT}" font-size="12" font-weight="700">${numStr}</text>
    ` : ''}
  `;
}

/** Red bounding box around a UI area */
function svgBbox(ann) {
  const { x, y, width, height, label } = ann;
  const lx = x + 6;
  const ly = y - 8;
  const textWidth = label ? label.length * 7.2 + 12 : 0;

  return `
    <!-- BBox: ${label || ''} -->
    <rect x="${x}" y="${y}" width="${width}" height="${height}"
      fill="${RED_FILL}" stroke="${RED}" stroke-width="2" rx="4"/>
    ${label ? `
    <rect x="${lx}" y="${ly - 11}" width="${textWidth}" height="18" rx="4" fill="${RED}"/>
    <text x="${lx + textWidth / 2}" y="${ly}" text-anchor="middle"
      fill="white" font-family="${FONT}" font-size="11" font-weight="600">${escapeXml(label)}</text>
    ` : ''}
  `;
}

/** Keyboard shortcut pill badges */
function svgHotkey(ann) {
  const { x, y, keys = [] } = ann;
  let cx = x;
  let parts = '';

  for (const key of keys) {
    const charW = Math.max(key.length * 8.5, 20);
    const kw = charW + 14;
    const kh = 26;
    parts += `
      <!-- Key: ${key} -->
      <rect x="${cx}" y="${y}" width="${kw}" height="${kh}" rx="5"
        fill="${BADGE_BG}" stroke="${BADGE_BD}" stroke-width="1.5"/>
      <rect x="${cx + 1}" y="${y + 1}" width="${kw - 2}" height="${kh / 2 - 2}" rx="4"
        fill="rgba(255,255,255,0.06)"/>
      <text x="${cx + kw / 2}" y="${y + 17}" text-anchor="middle"
        fill="${BADGE_FG}" font-family="${FONT}" font-size="12" font-weight="700">${escapeXml(key)}</text>
    `;
    cx += kw + 5;

    // "+" connector between keys
    if (keys.indexOf(key) < keys.length - 1) {
      parts += `
        <text x="${cx - 2}" y="${y + 17}" text-anchor="middle"
          fill="#888" font-family="${FONT}" font-size="13" font-weight="400">+</text>
      `;
      cx += 8;
    }
  }
  return parts;
}

/** Arrow from (x1,y1) to (x2,y2) */
function svgArrow(ann) {
  const { x1, y1, x2, y2, label } = ann;
  const id = `ah_${Math.random().toString(36).slice(2, 7)}`;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - 14;

  return `
    <!-- Arrow: ${label || ''} -->
    <defs>
      <marker id="${id}" markerWidth="10" markerHeight="7"
        refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="${RED}"/>
      </marker>
    </defs>
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
      stroke="${RED}" stroke-width="2.5" stroke-dasharray="6,3"
      marker-end="url(#${id})"/>
    ${label ? `
    <rect x="${mx - label.length * 3.5 - 4}" y="${my - 13}"
      width="${label.length * 7 + 8}" height="18" rx="4" fill="${RED}"/>
    <text x="${mx}" y="${my}" text-anchor="middle"
      fill="white" font-family="${FONT}" font-size="11" font-weight="600">${escapeXml(label)}</text>
    ` : ''}
  `;
}

/** Callout label box */
function svgLabel(ann) {
  const { x, y, text, number } = ann;
  const tw = text ? text.length * 7.5 + 20 : 60;
  return `
    <!-- Label: ${text || ''} -->
    ${number !== undefined ? `
    <circle cx="${x}" cy="${y}" r="13" fill="${STEP_BG}"/>
    <text x="${x}" y="${y + 4.5}" text-anchor="middle"
      fill="${STEP_FG}" font-family="${FONT}" font-size="12" font-weight="700">${number}</text>
    ` : ''}
    ${text ? `
    <rect x="${x + 18}" y="${y - 11}" width="${tw}" height="22" rx="5"
      fill="${BADGE_BG}" stroke="${BADGE_BD}" stroke-width="1"/>
    <text x="${x + 18 + tw / 2}" y="${y + 4}" text-anchor="middle"
      fill="${BADGE_FG}" font-family="${FONT}" font-size="12" font-weight="500">${escapeXml(text)}</text>
    ` : ''}
  `;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Core annotation function ──────────────────────────────────────────────────

async function annotateImage(screenshotPath, meta, outputPath) {
  const imgSharp = sharp(screenshotPath);
  const { width, height } = await imgSharp.metadata();

  const svgParts = [
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`,
  ];

  let autoStep = 1;
  for (const ann of meta.annotations || []) {
    switch (ann.type) {
      case 'circle': {
        const num = ann.number !== undefined ? ann.number : autoStep++;
        svgParts.push(svgCircle({ ...ann, number: num }));
        break;
      }
      case 'bbox':
        svgParts.push(svgBbox(ann));
        break;
      case 'hotkey':
        svgParts.push(svgHotkey(ann));
        break;
      case 'arrow':
        svgParts.push(svgArrow(ann));
        break;
      case 'label':
        svgParts.push(svgLabel(ann));
        break;
    }
  }

  svgParts.push('</svg>');
  const svg = svgParts.join('\n');

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await imgSharp
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toFile(outputPath);
}

// ─── Section scanner ──────────────────────────────────────────────────────────

async function processSection(sectionDir) {
  const screenshotsDir = path.join(sectionDir, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) return;

  const outputDir = path.join(screenshotsDir, 'annotated');
  const files = fs.readdirSync(screenshotsDir);
  const metaFiles = files.filter((f) => f.endsWith('.meta.json'));

  let processed = 0;
  let skipped = 0;

  for (const metaFile of metaFiles) {
    const meta = JSON.parse(
      fs.readFileSync(path.join(screenshotsDir, metaFile), 'utf-8'),
    );
    const pngName = meta.filename || metaFile.replace('.meta.json', '.png');
    const pngPath = path.join(screenshotsDir, pngName);
    const outPath = path.join(outputDir, pngName);

    if (!fs.existsSync(pngPath)) {
      console.log(`  ⚠  Screenshot not found — skipping: ${pngName}`);
      skipped++;
      continue;
    }

    try {
      await annotateImage(pngPath, meta, outPath);
      console.log(`  ✓  Annotated: ${pngName}`);
      processed++;
    } catch (err) {
      console.error(`  ✗  Failed: ${pngName} — ${err.message}`);
    }
  }

  return { processed, skipped };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const targetSection = process.argv[2];

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  CLAP Docs — Image Annotation Tool       ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const entries = fs.readdirSync(DOCS_ROOT, { withFileTypes: true });
  const sections = entries
    .filter((e) => e.isDirectory() && /^\d{2}-/.test(e.name))
    .map((e) => e.name)
    .filter((name) => !targetSection || name === targetSection)
    .sort();

  if (sections.length === 0) {
    console.error(`No matching section found: ${targetSection}`);
    process.exit(1);
  }

  let totalProcessed = 0;
  let totalSkipped = 0;

  for (const section of sections) {
    console.log(`\n📁 ${section}`);
    const result = await processSection(path.join(DOCS_ROOT, section));
    if (result) {
      totalProcessed += result.processed;
      totalSkipped += result.skipped;
    }
  }

  console.log(`\n─────────────────────────────────────────`);
  console.log(`  Annotated : ${totalProcessed} image(s)`);
  console.log(`  Skipped   : ${totalSkipped} (no screenshot yet)`);
  console.log(`\n  Annotated images → docs/<section>/screenshots/annotated/`);
  console.log(`  Place raw PNGs first, then re-run to annotate.\n`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
