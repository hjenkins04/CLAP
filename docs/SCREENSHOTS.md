# Screenshot Capture Guide

This file explains how to capture the raw screenshots that feed the annotation pipeline.

## Option A — Manual (Fastest)

1. Run the app: `npm run dev` (browser) or `npm run electron:dev` (desktop)
2. Load the **Queens Campus (Segmented)** point cloud
3. For each section folder, read the `.meta.json` files in `screenshots/`
4. Each file has `capture_instructions` and `ui_state` telling you exactly what to show
5. Use **Win + Shift + S** (Snip & Sketch) to capture the window
6. Save the PNG into `docs/<section>/screenshots/<filename>.png`
   - Filename must match the `"filename"` field in the .meta.json exactly

## Option B — Puppeteer MCP (Semi-automated)

Install the Puppeteer MCP in Claude Code settings:
```json
{
  "puppeteer": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-puppeteer"]
  }
}
```
Then run `npm run dev`, open a new Claude Code session, and ask Claude to:
- Navigate to `localhost:5173`
- Follow the steps in each guide.md
- Take screenshots and save them to the correct paths

## After Capturing Screenshots

Run the annotation script to add Scribe-style overlays:

```bash
cd docs/scripts
npm install
node annotate.js
```

This reads every `.meta.json`, finds the matching `.png`, composites:
- **Red numbered circles** — highlight specific UI elements
- **Red bounding boxes** — outline panels and sections
- **Keyboard badges** — show hotkey combinations
- **Arrows** — point to specific controls

Annotated images are saved to `docs/<section>/screenshots/annotated/`.

## Generating the PDF

After annotation:

```bash
cd docs/scripts
node generate-pdf.js
```

Output: `docs/CLAP-User-Guide.pdf`

## Screenshot Checklist

| Section | Screenshots needed | Status |
|---------|-------------------|--------|
| 01 — Loading a Project | 9 | ⬜ Not started |
| 02 — Viewer Controls | 10 | ⬜ Not started |
| 03 — Color Modes | 7 | ⬜ Not started |
| 04 — Point Display Settings | 7 | ⬜ Not started |
| 05 — Points of Interest | 7 | ⬜ Not started |
| 06 — Regions of Interest | 9 | ⬜ Not started |
| 07 — Profile Viewer | 10 | ⬜ Not started |
| 08 — Reclassification (3D) | 14 | ⬜ Not started |
| 09 — 2D Editor Reclassification | 10 | ⬜ Not started |
| **Total** | **83** | |

Change ⬜ to ✅ as you complete each section.

## Tips for Good Screenshots

- Use **1920×1080** window size for consistent coordinates
- Use **Dark theme** (it's the default and looks better in docs)
- Load the **Queens Campus (Segmented)** point cloud for every screenshot
- Switch to **Classification** color mode for reclassification screenshots
- Make sure the **point cloud is fully loaded** before screenshotting (wait for spinner to disappear)
- For toolbar screenshots, hover over the button so the tooltip shows
