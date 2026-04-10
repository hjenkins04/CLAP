/**
 * Fix annotation coordinates based on actual DOM measurements.
 *
 * Measured values (1920×1080 viewport, DPR=1):
 *   Sidebar          : x=0   y=0  w=256  h=1080
 *   Canvas/Viewport  : x=256 y=0  w=1664 h=1080
 *   Toolbar bar      : x=256 y=0  w=1664 h=50
 *   Central tool grp : x=887 y=8  w=403  h=34   (12 buttons)
 *   Left tool grp    : x=268 y=8  w=67   h=34   (2 buttons)
 *   Right ctrl cont  : x=1740 y=8 w=172  h=204
 *   View cube area   : x=1740 y=8 w=172  h=168
 *   Viewport btns    : x=1785 y=178 w=72  h=90  (3 stacked 28×28)
 *
 *   Sidebar sections (cloud loaded, Coloring expanded):
 *     Point Cloud      : x=16 y=77  w=223 h=148
 *     Coloring & Pts   : x=16 y=289 w=223 h=195
 *       Color Mode sel : x=16 y=341 w=213 h=31
 *       Pt Size slider : x=16 y=406 w=213 h=16
 *       Pt Budget sldr : x=16 y=462 w=213 h=16
 *     EDL (expanded)   : x=16 y=500 w=223 h=164
 *     Camera (expanded): x=16 y=680 w=223 h=56
 *
 *   Toolbar buttons (y=11, w=28, h=28):
 *     Hand/Grab     x=892  Select     x=922
 *     Undo          x=959  Redo       x=989  Save x=1019
 *     Move          x=1056 Rotate     x=1086
 *     POI           x=1123
 *     Annotate      x=1160 Reclassify x=1190
 *     Scan Filter   x=1227 Point Info x=1257
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.resolve(__dirname, '..');

// ─── Lookup tables ────────────────────────────────────────────────────────────

// Map old approximate labels → corrected bboxes
// Each entry: [x, y, w, h]
const LABEL_MAP = {
  // Layout regions
  'Left sidebar (collapsed or expanded)':           [0, 0, 256, 1080],
  'Left sidebar panel':                             [0, 0, 256, 1080],
  'Left sidebar':                                   [0, 0, 256, 1080],
  'Collapsed sidebar strip':                        [0, 0, 18, 1080],
  'Main toolbar':                                   [256, 0, 1664, 50],
  'Toolbar — mode buttons':                         [887, 8, 403, 34],
  'Toolbar — all mode buttons':                     [887, 8, 403, 34],
  'Top-right viewport controls (Virtual Tiles, ROI, World Frame)': [1785, 178, 72, 90],
  'Top-right viewport controls':                   [1785, 178, 72, 90],
  'View Cube widget':                               [1740, 8, 172, 168],
  'View Cube — shows tilted orientation matching viewport': [1740, 8, 172, 168],
  'View Cube — shows current orientation':          [1740, 8, 172, 168],
  'View Cube — current orientation indicator':      [1740, 8, 172, 168],
  'View Cube — isometric orientation':              [1740, 8, 172, 168],
  'View Cube':                                      [1740, 8, 172, 168],

  // Viewport areas
  'Empty 3D viewport':                              [256, 50, 1664, 1030],
  '3D viewport — Queens Campus (Segmented) point cloud': [256, 50, 1664, 1030],
  '3D viewport — Queens Campus point cloud':        [256, 50, 1664, 1030],
  'Viewport — partial/low-detail point cloud tiles visible': [256, 50, 1664, 1030],
  'Viewport — point cloud offset after pan':        [256, 50, 1664, 1030],
  'Viewport — camera centred on double-clicked point': [256, 50, 1664, 1030],
  'Viewport — perspective distortion visible at tilted angle': [256, 50, 1664, 1030],
  '3D viewport (narrowed)':                         [256, 50, 960, 1030],
  '3D viewport — showing orbit result':             [256, 50, 1664, 1030],
  '3D viewport — Classification color mode':        [256, 50, 960, 1030],
  '3D viewport':                                    [256, 50, 960, 1030],

  // Status bar — actually "Visible: X pts" in sidebar; point here
  'Status bar — shows 0 points':                   [16, 205, 223, 20],
  'Status bar — 0 points':                         [16, 205, 223, 20],
  'Status bar — loading or low point count':        [16, 205, 223, 20],
  'Status bar — visible points count':              [16, 205, 223, 20],
  'Status bar — higher point count after zoom':     [16, 205, 223, 20],
  'Status bar — visible point count':               [16, 205, 223, 20],

  // Sidebar settings sections
  'Point Cloud section':                            [16, 77, 223, 148],
  'Point Cloud section — shows loaded dataset name':[16, 77, 223, 148],
  'Dropdown menu — list of available point clouds': [16, 77, 223, 200],
  'Color Mode section':                             [16, 315, 223, 57],
  'Color Mode section in Settings':                 [16, 315, 223, 57],
  'Color Mode section — Color Mode select':         [16, 315, 223, 57],
  'RGB selected':                                   [16, 341, 213, 31],
  'Height option selected':                         [16, 341, 213, 31],
  'Classification option selected':                 [16, 341, 213, 31],
  'Intensity option selected':                      [16, 341, 213, 31],
  'Point Size section':                             [16, 378, 223, 50],
  'Point Size section — slider at 0.5':             [16, 378, 223, 50],
  'Point Size section — slider at 4.0':             [16, 378, 223, 50],
  'Point Budget section':                           [16, 434, 223, 50],
  'Camera Projection section in Settings':          [16, 680, 223, 56],
  'EDL section — toggle + two sliders':             [16, 500, 223, 164],

  // Classification legend
  'Classification legend panel':                    [1620, 580, 280, 380],
  'Full classification legend — 17 classes':        [4, 4, 312, 432],

  // Coloring side-by-side comparison panels
  'RGB render — left panel':                        [256, 40, 820, 680],
  'Classification render — right panel':            [1076, 40, 820, 680],
  'EDL disabled — flat appearance, depth ambiguous':[256, 40, 820, 680],
  'EDL enabled — edges darkened, 3D structure immediately legible': [1076, 40, 820, 680],
  'Perspective projection — converging lines, natural depth': [256, 40, 820, 680],
  'Orthographic projection — parallel lines, consistent scale': [1076, 40, 820, 680],

  // Toolbar-specific
  'Top-center toolbar region':                      [887, 0, 403, 50],
  'Toolbar — Move POI and Delete POI appear here':  [1100, 0, 200, 50],
  'POI action buttons area':                        [1100, 0, 200, 50],
  'Active button highlight':                        [886, 5, 38, 40],

  // Profile viewer panels
  '2D profile viewport':                            [1200, 50, 720, 1030],
  '2D secondary viewport (orthographic)':           [1200, 0, 720, 1080],
  '2D secondary viewport':                          [1200, 0, 720, 1080],
  '2D viewport — navigation is independent of the 3D view': [1200, 0, 720, 1080],
  '2D viewport — points rendered at current size':  [1200, 150, 720, 900],
  '2D viewport updates at each trajectory step':    [1200, 0, 720, 1080],
  '2D viewport — crosshair cursor visible, ready for vertex clicks': [1200, 0, 720, 1080],
  '2D secondary viewport — polygon drawing in progress': [1200, 0, 720, 1080],
  '2D secondary viewport — selected points highlighted': [1200, 0, 720, 1080],
  '2D secondary viewport':                          [1200, 0, 720, 1080],
  'Profile view — elevation cross-section (Z vs. distance along line)': [1200, 150, 720, 900],
  '2D view — points inside the slab depth are shown': [1200, 150, 720, 900],
  '2D panel header/overlay area':                   [1200, 0, 720, 80],

  // ROI button
  'ROI button region':                              [1785, 206, 32, 32],
  'Shape type picker panel':                        [1700, 44, 210, 160],

  // 2D toolbar toggle
  '3D / 2D mode toggle button group':               [960, 4, 140, 42],
};

// ─── Patch function ───────────────────────────────────────────────────────────

function patchAnnotations(annotations) {
  return annotations.map(ann => {
    if (ann.type !== 'bbox') return ann;

    const key = ann.label?.trim();
    if (key && LABEL_MAP[key]) {
      const [x, y, w, h] = LABEL_MAP[key];
      return { ...ann, x, y, width: w, height: h };
    }

    // Systematic replacements even without a label match
    let { x, y, width, height } = ann;

    // Sidebar width: 240 → 256
    if (x === 0 && width === 240) width = 256;

    // Viewport x: 240 → 256, width: 1440 → 1664
    if (x === 240) { x = 256; if (width === 1440) width = 1664; }

    // Section x: 8 → 16, width 224 → 223
    if (x === 8 && width === 224) { x = 16; width = 223; }

    return { ...ann, x, y, width, height };
  });
}

// ─── Process all sections ─────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  CLAP Docs — Fix Annotation Coordinates  ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const entries = fs.readdirSync(DOCS_ROOT, { withFileTypes: true });
  const sections = entries
    .filter(e => e.isDirectory() && /^\d{2}-/.test(e.name))
    .map(e => e.name)
    .sort();

  let total = 0;
  let changed = 0;

  for (const section of sections) {
    const screenshotsDir = path.join(DOCS_ROOT, section, 'screenshots');
    if (!fs.existsSync(screenshotsDir)) continue;

    const metaFiles = fs.readdirSync(screenshotsDir).filter(f => f.endsWith('.meta.json'));

    for (const mf of metaFiles) {
      const filePath = path.join(screenshotsDir, mf);
      const original = fs.readFileSync(filePath, 'utf-8');
      const meta = JSON.parse(original);

      if (!Array.isArray(meta.annotations)) continue;

      const patched = patchAnnotations(meta.annotations);
      meta.annotations = patched;

      const newContent = JSON.stringify(meta, null, 2);
      if (newContent !== original) {
        fs.writeFileSync(filePath, newContent + '\n');
        console.log(`  ✓  Fixed: ${section}/${mf}`);
        changed++;
      }
      total++;
    }
  }

  console.log(`\n  Processed : ${total} files`);
  console.log(`  Updated   : ${changed} files\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
