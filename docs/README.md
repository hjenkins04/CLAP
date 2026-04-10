# CLAP — Cloud LiDAR Annotation Platform

**CLAP** is a desktop application for professional LiDAR point cloud segmentation and labeling. It provides an interactive 3D viewer, a suite of selection and annotation tools, and a classification workflow that lets teams assign semantic labels to millions of scan points with precision and efficiency.

---

## What is LiDAR annotation?

LiDAR (Light Detection and Ranging) scanners emit laser pulses and record the reflected returns as a dense cloud of 3D points. Each point carries a position in space, a return intensity, and optionally an RGB color from a co-mounted camera. Raw LiDAR data is unstructured — it does not know whether a cluster of points is a building, a tree, or a road surface.

**Annotation** is the process of assigning a semantic class label to each point (or group of points) so the data becomes machine-readable for downstream applications such as autonomous vehicle training, HD map construction, urban planning analysis, and infrastructure inspection. CLAP provides the tools to carry out that labeling work interactively, in 3D.

---

## System Requirements

| Mode | Requirements |
|------|-------------|
| **Desktop (Electron)** | Windows 10 or Windows 11 (64-bit), 8 GB RAM minimum (16 GB recommended), dedicated GPU with WebGL 2.0 support |
| **Web (browser mode)** | Any modern Chromium-based browser (Chrome 112+, Edge 112+), WebGL 2.0 enabled, served from `http://localhost:5173` |

A converted point cloud in Potree octree format (produced by PotreeConverter from a `.las` source file) is required. The folder must contain a `metadata.json` file at its root.

---

## Quick Start

Follow these five steps to go from a fresh launch to your first reclassification:

1. **Launch CLAP** — Open the desktop application or navigate to `http://localhost:5173` in your browser.
2. **Load a point cloud** — Open the left sidebar, click the **Settings** tab, find the **Point Cloud** section, and use **Open Folder** (desktop) or the dropdown selector (browser) to load *Queens Campus (Segmented)*.
3. **Navigate the scene** — Use scroll to zoom, left-drag to orbit, and right-drag to pan. The **Grab/Navigate** mode (toolbar, leftmost button) must be active.
4. **Activate Reclassify Points** — Click the **Reclassify Points** button in the toolbar (palette icon). The button highlights to confirm.
5. **Select and reclassify** — Drag a rubber-band rectangle over the points you want to change. The class picker appears — click the target class. Colors update immediately.

For a complete walkthrough of each step, start with [Section 01: Loading a Point Cloud](01-loading-a-project/guide.md).

---

## Table of Contents

| # | Section | Description |
|---|---------|-------------|
| 01 | [Loading a Point Cloud](01-loading-a-project/guide.md) | Launch CLAP, open the sidebar, load Queens Campus (Segmented), and verify the point cloud appears in the viewport |
| 02 | [Viewer Controls](02-viewer-controls/guide.md) | Mouse and keyboard navigation — orbit, pan, zoom, reset view, and use the View Cube |
| 03 | [Color Modes](03-color-modes/guide.md) | Switch between RGB, Height, Classification, and Intensity rendering modes |
| 04 | [Point Display Settings](04-point-display-settings/guide.md) | Adjust Point Size, Point Budget, Eye-Dome Lighting, and camera projection |
| 05 | [Points of Interest](05-points-of-interest/guide.md) | Place, move, and delete named 3D markers for navigation and reference |
| 06 | [Regions of Interest](06-regions-of-interest/guide.md) | Define 3D bounding volumes to focus rendering and export on a sub-region of the scan |
| 07 | [Profile Viewer](07-profile-viewer/guide.md) | Open the secondary 2D orthographic panel, adjust the slab position and thickness, and step through cross-sections |
| 08 | [Reclassification (3D)](08-reclassification/guide.md) | Use drag select and 3D polygon tools to select points in the perspective viewport and assign classification labels |
| 09 | [2D Editor Reclassification](09-2d-editor-reclassification/guide.md) | Use the 2D viewport's drag select, polygon select, and vertex editing tools for precise cross-section annotation |

---

## Keyboard Shortcuts Reference

### Navigation

| Shortcut | Action |
|----------|--------|
| Left-drag | Orbit camera |
| Right-drag | Pan camera |
| Scroll wheel | Zoom in / out |
| Double-click point cloud | Set orbit pivot to clicked point |
| **F** | Frame / reset view to point cloud bounds |

### Toolbar Modes

| Shortcut | Mode |
|----------|------|
| **G** | Grab / Navigate mode |
| **S** | Select Points mode |
| **R** | Reclassify Points mode |
| **Escape** | Cancel current mode / deselect |

### Selection (Reclassify / Select mode)

| Shortcut | Action |
|----------|--------|
| Drag | New rubber-band selection |
| **Ctrl** + drag | Additive selection (add to existing) |
| **Alt** + drag | Subtractive selection (remove from existing) |
| **Ctrl+Z** | Undo last reclassification |
| **Ctrl+Y** | Redo |

### 2D Viewport (Profile Viewer)

| Shortcut | Action |
|----------|--------|
| Scroll wheel | Zoom 2D viewport |
| Right-drag | Pan 2D viewport |
| **Ctrl+Shift+scroll** | Trackpad-style pan in 2D viewport |

### Polygon Drawing

| Shortcut | Action |
|----------|--------|
| Click | Place vertex |
| Click first vertex | Close polygon |
| **Ctrl+Z** | Undo last placed vertex (before closing) |
| **Escape** | Cancel polygon in progress |

### General

| Shortcut | Action |
|----------|--------|
| **Ctrl+S** | Save current annotation state |
| **Ctrl+Z** | Undo |
| **Ctrl+Y** / **Ctrl+Shift+Z** | Redo |

---

## Recommended Annotation Workflow

The following workflow produces consistent, high-quality annotations across an entire scan session:

### 1. Orient and inspect

Load the point cloud and spend a few minutes in **RGB** or **Classification** color mode navigating the entire scene. Identify areas of interest, note any obvious misclassifications from automated pre-processing, and drop a **Point of Interest** marker on the most complex area to return to later.

### 2. Coarse pass in 3D

Switch to **Classification** color mode so misclassified regions stand out. Use **Reclassify Points** in the 3D viewport with drag-select to fix large, obvious errors first — for example, an entire building side misclassified as vegetation, or a large ground patch labelled as road.

### 3. Fine pass with the Profile Viewer

Open the **Profile Viewer** (Section 07) and step through cross-sections perpendicular to roads or boundaries where precise per-class separation matters. Use the **2D Polygon** tool (Section 09) to isolate thin strips such as:

- Road markings (class 2 Roads vs. class 3 Sidewalks boundary)
- Sidewalk edges
- Mast or wire bases where they meet ground

### 4. Verify per-class

After each annotation pass, switch color modes to verify:
- **Classification mode** — confirms all expected classes are present with correct colors and no obviously wrong regions remain
- **Height mode** — reveals ground plane anomalies and confirms building heights are consistent

### 5. Save frequently

Press **Ctrl+S** after every meaningful set of changes. CLAP does not auto-save. Undo history (**Ctrl+Z**) is session-only and is lost on application restart.

### 6. Export or hand off

When the annotation pass is complete, use the export controls (if applicable for your build) to write the labeled data back to `.las` format or a project-specific output. Confirm that point counts per class are in expected ranges before closing the session.

---

## Classification Codes Reference

| Code | Label |
|------|-------|
| 1 | Other |
| 2 | Roads |
| 3 | Sidewalks |
| 4 | OtherGround |
| 5 | TrafficIslands |
| 6 | Buildings |
| 7 | Trees |
| 8 | OtherVegetation |
| 9 | TrafficLights |
| 10 | TrafficSigns |
| 11 | Wires |
| 12 | Masts |
| 13 | Pedestrians |
| 15 | TwoWheel |
| 16 | MobFourWheel |
| 17 | StaFourWheel |
| 18 | Noise |
| 40 | TreeTrunks |

---

*CLAP — Cloud LiDAR Annotation Platform*
