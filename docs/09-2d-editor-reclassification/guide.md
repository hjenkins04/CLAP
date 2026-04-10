# Section 09: 2D Editor Reclassification

The 2D editor is CLAP's secondary viewport mode. When the Profile Viewer is open, a second orthographic panel appears alongside the main 3D viewport. This panel provides a top-down or cross-section slice view of the point cloud — a different geometric projection that makes certain selections dramatically easier than working purely in perspective 3D.

This section covers all three capabilities of the 2D editor: drag selection, polygon selection, and vertex editing of existing polygon annotations.

---

## Prerequisites

Before using the 2D editor:

1. A point cloud must be loaded (e.g., **Queens Campus (Segmented)**). See [Section 01: Loading a Point Cloud](../01-loading-a-project/guide.md).
2. The **Profile Viewer** must be open. See [Section 07: Profile Viewer](../07-profile-viewer/guide.md). The 2D secondary viewport only exists while the Profile Viewer is active.
3. **Reclassify Points** mode must be active. Click the Reclassify Points button in the toolbar (the palette/label icon). The button highlights to confirm the mode.

When both conditions are met, the toolbar shows additional mode buttons that let you switch between 3D reclassification and 2D reclassification. The 2D viewport panel gains its own overlay controls.

![Prerequisites met: Profile Viewer open with Reclassify Points active](screenshots/01-profile-viewer-open-2d.png)

**Layout at this point:**

- **Left sidebar** (0–240 px): Layers and Settings tabs
- **3D primary viewport** (240–1200 px): full perspective 3D view of the point cloud
- **2D secondary viewport** (1200–1920 px): orthographic cross-section or plan view

---

## Part A — 2D Drag Select

Drag select in the 2D viewport works identically to the rubber-band selection in the 3D viewport, but operates on the orthographic projection plane. This makes it easy to draw a precise rectangular selection across a road cross-section or along a thin strip of points that would be difficult to isolate in perspective.

### Step A1: Activate Reclassify Points and Confirm 2D Mode

With the Profile Viewer open and Reclassify Points active, look for the mode toggle buttons that appear in the toolbar or in the 2D panel header. Click the **2D** (or **Drag Select in 2D**) button to ensure you are operating on the secondary viewport.

![Step A1: Toolbar showing 2D mode selection buttons](screenshots/02-toolbar-2d-mode-toggle.png)

The 2D viewport border highlights to confirm focus.

### Step A2: Draw a Drag Selection in the 2D Viewport

Click and drag inside the **2D viewport** (right panel). A rubber-band rectangle draws as you drag.

![Step A2: Rubber-band drag selection in the 2D viewport](screenshots/03-drag-select-2d-active.png)

**Modifier keys:**

| Action | Result |
|--------|--------|
| Drag (no modifier) | New selection — replaces any existing selection |
| **Ctrl** + drag | Additive — adds points inside the rectangle to the current selection |
| **Alt** + drag | Subtractive — removes points inside the rectangle from the current selection |

As you drag, the selected points highlight in **both** the 2D viewport and the 3D viewport simultaneously. This live cross-viewport feedback lets you verify that the selection covers the correct geometry before committing a class change.

### Step A3: Release and Inspect the Selection

Release the mouse button. The rubber-band rectangle disappears and the selected points remain highlighted (typically shown in a bright selection color) in both panels.

Review the 3D viewport to confirm the selection looks correct in three dimensions. If unwanted points are included, use **Alt+drag** to subtract them, or press **Escape** to cancel and start again.

### Step A4: Select a Classification from the Class Picker

After releasing the drag, the **class picker** appears in the 2D panel or as a floating overlay. It lists all available classification codes:

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

Click the target class. The selected points are immediately reclassified and their display color updates in both the 2D and 3D viewports to reflect the new class color.

![Step A4: Class picker after 2D drag selection](screenshots/04-class-picker-after-drag.png)

---

## Part B — 2D Polygon Select

Polygon selection lets you draw an arbitrary closed shape in the 2D viewport to capture exactly the points you need. This is the most precise selection method available in CLAP for irregular or non-rectangular areas.

### Step B1: Switch to Polygon Mode

In the toolbar or 2D panel header, click the **Polygon** mode button (polygon icon). The cursor changes to a crosshair with a polygon indicator when hovering over the 2D viewport.

![Step B1: Polygon mode button active in toolbar](screenshots/05-polygon-mode-2d.png)

### Step B2: Click Vertices in the 2D Viewport

Click once in the 2D viewport to place the first vertex. A dot appears at the click position. Continue clicking to add vertices — a polygon outline draws between each successive vertex.

![Step B2: Polygon vertices being placed in the 2D viewport](screenshots/06-polygon-vertices-drawing.png)

**Tips while drawing:**

- Each click places one vertex. There is no minimum vertex count limit, but at least three vertices are required to form a valid closed polygon.
- The polygon outline previews as you move the cursor between clicks.
- If you misplace a vertex, you can undo the last vertex using **Ctrl+Z** before closing the polygon.
- You can pan the 2D viewport while drawing: **right-drag** to pan, or **Ctrl+Shift+scroll** (trackpad pan).

### Step B3: Close the Polygon

To close the polygon, click on the **first vertex** (a snap indicator appears when your cursor is close enough). The polygon fills with a semi-transparent overlay showing the enclosed area.

![Step B3: Polygon closed — fill overlay visible in 2D viewport](screenshots/07-polygon-closed-2d.png)

### Step B4: Click "Confirm Selection" in the 2D Panel

After closing the polygon, a **"Confirm selection"** button appears in the **2D panel header/overlay** (not in the 3D toolbar). This button is specific to the 2D editor and confirms that you want to reclassify the points inside the polygon.

![Step B4: Confirm selection button in the 2D panel overlay](screenshots/08-confirm-selection-2d-panel.png)

> **Important:** The Confirm button is inside the 2D panel, not in the main 3D toolbar. Look for it at the top edge of the right-hand viewport panel.

Click **Confirm selection**. The class picker appears (same picker as in Part A). Select the target class — all points within the closed polygon area in the current 2D slab are reclassified immediately and both viewports update.

---

## Part C — 2D Vertex Editing

When polygon annotations already exist in the scene, the 2D editor provides tools for adjusting their vertices without redrawing from scratch. This is useful for correcting annotation boundaries after an initial pass.

### Step C1: Polygon Vertex Handles (Blue Dots)

When a polygon annotation is visible in the 2D viewport, **blue dots** appear at each vertex of the polygon. These handles are the primary way to select and move individual vertices.

![Step C1: Blue vertex dots visible on polygon annotation in 2D viewport](screenshots/09-vertex-editing-blue-dots.png)

**To select a vertex:** Click a blue dot. The selected vertex dot changes appearance (larger, or color changes) to indicate selection.

**Multiple selection:** Hold **Shift** while clicking additional blue dots to select more than one vertex at a time. All selected vertices move together when you use the gizmo.

### Step C2: Reposition with the Gizmo

After selecting a vertex (or multiple vertices), a **move gizmo** appears at the vertex position. Drag the gizmo to reposition the selected vertices:

- **Axis arrows** — constrain movement to the X or Y axis in the 2D plane
- **Center handle** — free movement in both X and Y

The polygon outline updates in real time as you drag. Release the mouse to confirm the new position.

### Step C3: Pierce Points (Orange Dots)

**Orange dots** appear where a 3D polygon annotation edge crosses the current 2D slab plane. These are called **pierce points** — they mark where a 3D edge intersects the 2D cross-section.

![Step C3: Orange pierce points on polygon edges in 2D viewport](screenshots/10-pierce-points-orange.png)

**To insert a new vertex at a pierce point:**

1. Click an orange dot. A context menu or inline button labelled **"Add vertex"** appears.
2. Click **Add vertex**. A new vertex is inserted at that position on the polygon edge.
3. The new vertex appears as a blue dot and can be dragged with the gizmo like any other vertex.

Using pierce points to add vertices is the most precise way to refine annotation boundaries at the exact location where a 3D edge crosses a cross-section plane.

---

## Navigation in the 2D Viewport

The 2D viewport uses a separate camera that can be panned and zoomed independently of the 3D view.

| Action | Result |
|--------|--------|
| **Scroll wheel** | Zoom in / zoom out centered on cursor |
| **Right-drag** | Pan the 2D view |
| **Ctrl+Shift+scroll** | Pan (trackpad-style: vertical scroll = vertical pan) |

The 3D and 2D views stay **synchronized for selections and annotations** — points you select or reclassify in the 2D view are immediately reflected in the 3D viewport and vice versa. Camera positions are independent; panning the 2D view does not move the 3D camera.

---

## When the 2D Editor Is Most Useful

| Scenario | Why 2D helps |
|----------|--------------|
| Road cross-section cleanup | Orthographic view eliminates perspective distortion, making thin road-marking strips easy to select |
| Sidewalk edge isolation | A tight drag or polygon in 2D captures only the edge points without accidentally selecting adjacent road or grass points |
| Per-cross-section verification | Step the Profile Viewer slice position along a road and check each cross-section independently |
| Correcting automated pre-classification | Misclassified thin strips (e.g., painted road markings classed as Sidewalks) are easiest to isolate and fix in the orthographic view |

---

## Summary

| Task | Steps |
|------|-------|
| **2D drag select** | Profile Viewer open → Reclassify Points → drag in 2D viewport → class picker → select class |
| **Add to selection** | Ctrl+drag in 2D viewport |
| **Remove from selection** | Alt+drag in 2D viewport |
| **2D polygon select** | Switch to Polygon mode → click vertices → close by clicking first vertex → Confirm in 2D panel → select class |
| **Edit vertex** | Click blue dot → drag gizmo |
| **Insert vertex at pierce point** | Click orange dot → Add vertex |
| **Pan 2D view** | Right-drag, or Ctrl+Shift+scroll |
| **Zoom 2D view** | Scroll wheel |

Continue to the next section or return to [Section 08: Reclassification (3D)](../08-reclassification/guide.md) to review 3D reclassification techniques.
