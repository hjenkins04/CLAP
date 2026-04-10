/**
 * CLAP Documentation — PDF Generator
 *
 * Combines all section guide.md files into a single polished PDF.
 * Uses Puppeteer to render an HTML document with embedded screenshots.
 *
 * Usage:
 *   node generate-pdf.js
 *
 * Prerequisites:
 *   cd docs/scripts && npm install
 *   Run annotate.js first to produce annotated screenshots.
 *
 * Output:
 *   docs/CLAP-User-Guide.pdf
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.resolve(__dirname, '..');
const OUTPUT_PDF = path.join(DOCS_ROOT, 'CLAP-User-Guide.pdf');

// ─── Simple Markdown → HTML converter ────────────────────────────────────────
// Handles headings, bold, italic, code, images, lists, tables, blockquotes, hr.

function markdownToHtml(md, baseDir) {
  let html = md;

  // Escape for safety inside code blocks — protect them first
  const codeBlocks = [];
  html = html.replace(/```[\s\S]*?```/g, (m) => {
    codeBlocks.push(m.replace(/```(\w*)\n?/, '').replace(/```$/, ''));
    return `%%CODE_BLOCK_${codeBlocks.length - 1}%%`;
  });
  const inlineCode = [];
  html = html.replace(/`([^`]+)`/g, (_, c) => {
    inlineCode.push(c);
    return `%%INLINE_CODE_${inlineCode.length - 1}%%`;
  });

  // Images — resolve to annotated path if available, fallback to raw
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    const raw = path.resolve(baseDir, src);
    const annotated = path.resolve(
      baseDir,
      src.replace('screenshots/', 'screenshots/annotated/'),
    );
    const resolved = fs.existsSync(annotated)
      ? annotated
      : fs.existsSync(raw)
        ? raw
        : null;
    if (!resolved) {
      return `<figure class="missing-img"><div class="missing-placeholder">📸 ${alt}</div><figcaption>${alt}</figcaption></figure>`;
    }
    const dataUrl = imageToDataUrl(resolved);
    return `<figure><img src="${dataUrl}" alt="${alt}" loading="lazy"/><figcaption>${alt}</figcaption></figure>`;
  });

  // Headings
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // HR
  html = html.replace(/^---$/gm, '<hr/>');

  // Bold/italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Tables
  html = html.replace(
    /(^\|.+\|\n)(^\|[-| :]+\|\n)((?:^\|.+\|\n?)*)/gm,
    (_, header, _sep, body) => {
      const headCells = header
        .trim()
        .slice(1, -1)
        .split('|')
        .map((c) => `<th>${c.trim()}</th>`)
        .join('');
      const rows = body
        .trim()
        .split('\n')
        .map((row) => {
          const cells = row
            .trim()
            .slice(1, -1)
            .split('|')
            .map((c) => `<td>${c.trim()}</td>`)
            .join('');
          return `<tr>${cells}</tr>`;
        })
        .join('');
      return `<table><thead><tr>${headCells}</tr></thead><tbody>${rows}</tbody></table>`;
    },
  );

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // Unordered lists
  html = html.replace(/(^[-*] .+\n?)+/gm, (block) => {
    const items = block
      .trim()
      .split('\n')
      .map((l) => `<li>${l.replace(/^[-*] /, '')}</li>`)
      .join('');
    return `<ul>${items}</ul>`;
  });

  // Ordered lists
  html = html.replace(/(^\d+\. .+\n?)+/gm, (block) => {
    const items = block
      .trim()
      .split('\n')
      .map((l) => `<li>${l.replace(/^\d+\. /, '')}</li>`)
      .join('');
    return `<ol>${items}</ol>`;
  });

  // Links
  html = html.replace(/\[([^\]]+)\]\([^)]+\)/g, '<span class="link">$1</span>');

  // Restore code blocks
  codeBlocks.forEach((code, i) => {
    html = html.replace(
      `%%CODE_BLOCK_${i}%%`,
      `<pre><code>${escapeHtml(code)}</code></pre>`,
    );
  });
  inlineCode.forEach((code, i) => {
    html = html.replace(
      `%%INLINE_CODE_${i}%%`,
      `<code>${escapeHtml(code)}</code>`,
    );
  });

  // Paragraphs — wrap bare text lines
  html = html.replace(/^(?!<[a-z]|%%)(.*\S.*)$/gm, '<p>$1</p>');

  return html;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function imageToDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  const data = fs.readFileSync(filePath).toString('base64');
  return `data:${mime};base64,${data}`;
}

// ─── CSS stylesheet ───────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');

  :root {
    --accent: #E8303A;
    --accent-light: #FFF0F1;
    --text: #1A1A1A;
    --text-muted: #6B7280;
    --border: #E5E7EB;
    --bg-code: #F3F4F6;
    --bg-blockquote: #FFF8E7;
    --page-width: 210mm;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.7;
    color: var(--text);
    background: white;
  }

  /* ── Cover page ── */
  .cover {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    min-height: 100vh;
    padding: 60mm 20mm;
    background: linear-gradient(160deg, #0F0F0F 0%, #1C1C2E 60%, #2D1B6E 100%);
    page-break-after: always;
  }
  .cover-logo {
    font-size: 11pt;
    font-weight: 700;
    letter-spacing: 0.25em;
    color: var(--accent);
    text-transform: uppercase;
    margin-bottom: 16mm;
  }
  .cover h1 {
    font-size: 36pt;
    font-weight: 700;
    color: white;
    line-height: 1.15;
    margin-bottom: 6mm;
    border: none;
  }
  .cover-sub {
    font-size: 15pt;
    color: rgba(255,255,255,0.55);
    margin-bottom: 20mm;
  }
  .cover-meta {
    font-size: 9pt;
    color: rgba(255,255,255,0.35);
    line-height: 2;
  }
  .cover-stripe {
    width: 48px;
    height: 5px;
    background: var(--accent);
    border-radius: 3px;
    margin-bottom: 8mm;
  }

  /* ── TOC page ── */
  .toc-page {
    padding: 20mm 20mm;
    page-break-after: always;
  }
  .toc-page h2 { font-size: 20pt; margin-bottom: 8mm; }
  .toc-entry {
    display: flex;
    align-items: baseline;
    gap: 0;
    margin-bottom: 3mm;
    font-size: 10.5pt;
  }
  .toc-num { color: var(--accent); font-weight: 600; min-width: 28px; }
  .toc-title { flex: 1; }
  .toc-dots { flex: 1; border-bottom: 1.5px dotted var(--border); margin: 0 6px; position: relative; top: -3px; }
  .toc-page-num { color: var(--text-muted); font-size: 9pt; }

  /* ── Section pages ── */
  .section {
    padding: 16mm 20mm 12mm;
    page-break-before: always;
  }

  h1 {
    font-size: 22pt;
    font-weight: 700;
    color: var(--text);
    border-bottom: 3px solid var(--accent);
    padding-bottom: 4mm;
    margin-bottom: 8mm;
  }
  h2 {
    font-size: 14pt;
    font-weight: 700;
    color: var(--text);
    margin-top: 8mm;
    margin-bottom: 4mm;
    padding-left: 12px;
    border-left: 4px solid var(--accent);
  }
  h3 {
    font-size: 11pt;
    font-weight: 600;
    color: var(--text);
    margin-top: 5mm;
    margin-bottom: 2mm;
  }
  h4 {
    font-size: 10pt;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-top: 4mm;
    margin-bottom: 2mm;
  }

  p { margin-bottom: 3mm; }

  ul, ol {
    margin: 2mm 0 4mm 6mm;
    padding-left: 5mm;
  }
  li { margin-bottom: 1.5mm; }
  li::marker { color: var(--accent); }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 4mm 0;
    font-size: 9.5pt;
  }
  th {
    background: #1A1A1A;
    color: white;
    padding: 3mm 4mm;
    text-align: left;
    font-weight: 600;
  }
  td {
    padding: 2.5mm 4mm;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  tr:nth-child(even) td { background: #FAFAFA; }

  code {
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 9pt;
    background: var(--bg-code);
    padding: 1px 5px;
    border-radius: 4px;
    color: #C7254E;
  }
  pre {
    background: var(--bg-code);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4mm;
    margin: 3mm 0;
    overflow: hidden;
  }
  pre code { background: none; padding: 0; color: var(--text); font-size: 8.5pt; }

  blockquote {
    background: var(--bg-blockquote);
    border-left: 4px solid #F59E0B;
    padding: 3mm 5mm;
    margin: 3mm 0;
    border-radius: 0 4px 4px 0;
    font-style: italic;
  }

  hr {
    border: none;
    border-top: 1.5px solid var(--border);
    margin: 6mm 0;
  }

  .link { color: var(--accent); text-decoration: underline; }

  /* ── Figures / screenshots ── */
  figure {
    margin: 5mm 0;
    text-align: center;
    page-break-inside: avoid;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    background: #F9FAFB;
  }
  figure img {
    max-width: 100%;
    height: auto;
    display: block;
  }
  figcaption {
    font-size: 8.5pt;
    color: var(--text-muted);
    padding: 2.5mm 4mm;
    background: #F3F4F6;
    text-align: left;
    border-top: 1px solid var(--border);
    font-style: italic;
  }
  .missing-placeholder {
    background: #F0F0F0;
    color: #9CA3AF;
    font-size: 9pt;
    padding: 10mm;
    text-align: center;
    font-style: italic;
  }
  .missing-img figcaption { color: #9CA3AF; }

  /* ── Tip/note boxes ── */
  p:has(strong:first-child) {
    background: #EFF6FF;
    border-left: 4px solid #3B82F6;
    padding: 2.5mm 4mm;
    border-radius: 0 4px 4px 0;
    margin: 3mm 0;
  }

  /* ── Page header/footer (via @page) ── */
  @page {
    size: A4;
    margin: 18mm 15mm 15mm;
  }
  @page :first { margin: 0; }

  @media print {
    .cover { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    figure { break-inside: avoid; }
    h1, h2 { break-after: avoid; }
  }
`;

// ─── HTML assembler ───────────────────────────────────────────────────────────

function buildHtml(sections) {
  const sectionHtml = sections
    .map(({ name, html }) => `<div class="section">${html}</div>`)
    .join('\n');

  const tocEntries = sections
    .map(({ number, title }, i) => {
      const n = String(i + 1).padStart(2, '0');
      return `
      <div class="toc-entry">
        <span class="toc-num">${n}</span>
        <span class="toc-title">${title}</span>
        <span class="toc-dots"></span>
      </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <style>${CSS}</style>
</head>
<body>

<!-- Cover -->
<div class="cover">
  <div class="cover-logo">CLAP</div>
  <div class="cover-stripe"></div>
  <h1>User Guide</h1>
  <div class="cover-sub">Cloud LiDAR Annotation Platform</div>
  <div class="cover-meta">
    Comprehensive reference for point cloud segmentation,<br/>
    classification, and annotation workflows.<br/><br/>
    Version 0.1.0 &nbsp;·&nbsp; ${new Date().getFullYear()}
  </div>
</div>

<!-- Table of Contents -->
<div class="toc-page">
  <h2>Contents</h2>
  ${tocEntries}
</div>

<!-- Sections -->
${sectionHtml}

</body>
</html>`;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  CLAP Docs — PDF Generator               ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const entries = fs.readdirSync(DOCS_ROOT, { withFileTypes: true });
  const sectionDirs = entries
    .filter((e) => e.isDirectory() && /^\d{2}-/.test(e.name))
    .map((e) => e.name)
    .sort();

  const sections = [];
  for (const dir of sectionDirs) {
    const guidePath = path.join(DOCS_ROOT, dir, 'guide.md');
    if (!fs.existsSync(guidePath)) {
      console.log(`  ⚠  No guide.md in ${dir} — skipping`);
      continue;
    }
    const md = fs.readFileSync(guidePath, 'utf-8');
    const baseDir = path.join(DOCS_ROOT, dir);
    const html = markdownToHtml(md, baseDir);

    // Extract title from first H1
    const titleMatch = md.match(/^# (.+)$/m);
    const title = titleMatch ? titleMatch[1] : dir;
    const number = dir.slice(0, 2);

    sections.push({ name: dir, number, title, html });
    console.log(`  ✓  Processed: ${dir}`);
  }

  const fullHtml = buildHtml(sections);
  const htmlPath = path.join(DOCS_ROOT, 'CLAP-User-Guide.html');
  fs.writeFileSync(htmlPath, fullHtml, 'utf-8');
  console.log(`\n  HTML written: ${htmlPath}`);

  console.log('  Launching Puppeteer...');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(fullHtml, { waitUntil: 'networkidle0' });

  await page.pdf({
    path: OUTPUT_PDF,
    format: 'A4',
    printBackground: true,
    margin: { top: '18mm', right: '15mm', bottom: '15mm', left: '15mm' },
    displayHeaderFooter: true,
    headerTemplate: `<div style="font-size:8px;color:#9CA3AF;width:100%;text-align:right;padding-right:15mm;">CLAP User Guide</div>`,
    footerTemplate: `<div style="font-size:8px;color:#9CA3AF;width:100%;text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
  });

  await browser.close();
  console.log(`\n  ✅ PDF saved: ${OUTPUT_PDF}\n`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
