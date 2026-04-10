# Section 08: Reclassification — 3D Viewport

The Reclassify Points tool lets you select a group of points in the 3D viewport and reassign them to a different semantic class. This is the core annotation workflow in CLAP. Two selection sub-modes are available: **Drag-Select** (rectangle) and **Polygon** (freehand shape). Both modes feed into the same class picker and produce the same reclassification result.

---

## Before You Start: Switch to Classification Color Mode

![Pre-step: Switching to Classification color mode](screenshots/01-classification-color-mode.png)

**What you see:**
The 3D viewport shows the Queens Campus point cloud. By default the cloud may be colored by RGB, Intensity, or Height. In these modes, reclassification still works, but you will not be able to see the color change that confirms a successful reclassification.

**What to do:**
Before using the reclassification tool, open the **sidebar Settings tab** and set the **Color Mode** to **Classification**. Each point is now colored according to its assigned class:

| Class | Default color |
|-------|--------------|
| Roads | Grey/dark brown |
| Sidewalks | Tan/beige |
| Buildings | Purple/magenta |
| Trees | Dark green |
| OtherVegetation | Light green |
| Noise | White |
| Other | Yellow |

With Classification color mode active, reclassified points change color immediately after you confirm a new class — providing instant visual feedback.

**Tips:**
- You can reclassify in any color mode; the mode only affects what you see, not the data written.
- For the clearest feedback, always use Classification color mode during annotation sessions.

---

## Part A: Drag-Select Mode

### Step 1: Activate the Reclassify Points Tool

![Step 1: Activating the Reclassify Points tool from the toolbar](screenshots/02-activate-reclassify.png)

**What you see:**
The top toolbar contains the **Reclassify Points** button. It is located alongside other mode buttons (Grab/Navigate, Select Points, Annotate, etc.).

**What to do:**
Click the **Reclassify Points** button in the toolbar. When active, the button appears highlighted. A sub-panel or secondary toolbar row appears below (or near) the main toolbar offering two sub-mode toggle buttons: **Drag-Select** and **Polygon**.

An overlay instruction appears in the 3D viewport.

**Tips:**
- Clicking any other toolbar mode (e.g., Grab/Navigate) exits the reclassification tool and clears any active selection.
- If no sub-panel appears, check that the point cloud is loaded and the tool is genuinely active (button highlighted).

---

### Step 2: Select Drag-Select Sub-Mode

![Step 2: Drag-Select sub-mode selected in the sub-panel](screenshots/03-drag-select-mode.png)

**What you see:**
The sub-panel below the toolbar shows two buttons: **Drag-Select** (rectangle icon) and **Polygon** (polygon icon). The overlay text in the viewport reads:

> *Drag to select points · Alt+drag to deselect · Esc to exit*

**What to do:**
Click **Drag-Select** if it is not already active (it is the default sub-mode). The cursor changes to a crosshair or selection cursor when hovering over the 3D viewport.

---

### Step 3: Draw a Selection Rectangle

![Step 3: Drawing a drag-select rectangle over a group of road points](screenshots/04-drag-select-rectangle.png)

**What you see:**
The cursor is in the 3D viewport. A dashed or solid rectangle appears as you click and drag, outlining the region being selected.

**What to do:**
**Click and drag** across the points you want to select. Release the mouse button to complete the selection. All points whose projected screen position falls inside the rectangle are selected and turn **yellow**.

**Tips:**
- The selection is based on the 2D screen projection of the points — points hidden behind other points at this camera angle are not selected.
- Rotate the camera first (middle-click + drag to orbit) to find an angle where your target points are visible and unobstructed.
- A small drag will select a compact cluster; a large drag captures a wide area.

---

### Step 4: Inspect the Selected Points (Yellow Highlight)

![Step 4: Selected points highlighted in yellow](screenshots/05-selected-points-yellow.png)

**What you see:**
The points that fall inside the drag rectangle are now colored **yellow**. All other points retain their Classification mode color. The selection boundary disappears after the drag is released.

**What to do:**
Inspect the yellow points to confirm you have selected the intended group. If the selection is not right, you can:
- Drag a new rectangle to replace the selection entirely.
- Use **Ctrl + drag** to add more points (Step 5).
- Use **Alt + drag** to remove unwanted points (Step 6).
- Press **Escape** to clear the selection and start over.

**Tips:**
- Zoom in (scroll wheel) before selecting to reduce the risk of accidentally capturing nearby points from a different class.
- Orbit to a view where the target points are visually separated from adjacent points.

---

### Step 5: Additive Selection with Ctrl+Drag

![Step 5: Adding more points to the selection with Ctrl+drag](screenshots/06-additive-selection.png)

**What you see:**
Some points are already yellow from a previous drag. A new rectangle is being drawn with the **Ctrl** key held, extending the yellow region.

**What to do:**
Hold **Ctrl** (Windows/Linux) or **Cmd** (macOS) and drag a new rectangle. Points inside the new rectangle are **added** to the existing selection rather than replacing it.

**Tips:**
- Use this to build up a complex selection in stages — for example, selecting road points across multiple passes of a road with gaps between them.
- You can Ctrl+drag as many times as needed before opening the class picker.

---

### Step 6: Subtractive Selection with Alt+Drag

![Step 6: Removing points from the selection with Alt+drag](screenshots/07-subtractive-selection.png)

**What you see:**
Some points are yellow (selected). A new rectangle is being drawn with **Alt** held. Points inside the Alt+drag rectangle that were previously selected will be deselected (returned to their Classification color).

**What to do:**
Hold **Alt** and drag a rectangle over points you want to **remove** from the current selection.

**Tips:**
- Alt+drag is useful when a broad Drag-Select has accidentally caught points from an adjacent class (e.g., a footpath point mixed in with road points). Deselect those specific points before reclassifying.
- The overlay reminder at the bottom of the viewport states: *"Alt+drag to deselect"*.

---

### Step 7: The Class Picker Appears

![Step 7: Class picker appearing after a selection is made](screenshots/08-class-picker.png)

**What you see:**
After completing a selection (yellow points are visible), a **class picker panel** appears. It contains:
- A **search field** at the top for filtering class names.
- A **scrollable list** of classification names with their codes.
- Keyboard navigation instructions.

The full class list:

| Code | Name |
|------|------|
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

**What to do:**
Type in the search field to filter the list, or scroll through the list to find the target class. Use **Arrow Up / Down** to navigate, then press **Enter** to confirm.

**Tips:**
- Typing "road" in the search field immediately filters to show Roads (2). Typing "veg" shows Trees, OtherVegetation, and TreeTrunks.
- The class picker appears near the selection or in a fixed panel position — it does not block the viewport.

---

### Step 8: Search and Navigate the Class List

![Step 8: Typing in the search field to filter the class list](screenshots/09-search-class.png)

**What you see:**
The search field in the class picker contains typed text (e.g., "road"). The list below is filtered to show only matching entries. The top match may be highlighted/focused automatically.

**What to do:**
- Type a partial class name to filter.
- Use **Arrow Down** to move focus to the first list item.
- Use **Arrow Up / Down** to move through the filtered list.
- Press **Enter** to select the highlighted class and confirm the reclassification.

**Tips:**
- Short abbreviations work: "bld" or "build" finds Buildings. "tw" finds TwoWheel.
- If you type a number (e.g., "2") the list filters to classes whose code or name contains that digit.

---

### Step 9: Confirm Reclassification — Points Change Color

![Step 9: Points reclassified — color change visible immediately in Classification mode](screenshots/10-reclassification-result.png)

**What you see:**
After pressing **Enter** to confirm the reclassification, the previously yellow points now display the color corresponding to the newly assigned class (for example, grey/dark brown if reclassified to Roads, or purple if reclassified to Buildings). The class picker closes. The selection is cleared.

**What to do:**
Inspect the result. If the reclassification is incorrect, press **Ctrl + Z** to undo. The points revert to their previous classification and color.

**Tips:**
- Reclassification is recorded in the session. Use **Ctrl + S** (or the Save toolbar button) to persist changes to disk.
- Undo (Ctrl+Z) steps back one reclassification at a time.
- After a successful reclassification the tool remains active — you can immediately draw another selection to continue working.

---

## Part B: Polygon Selection Mode

### Step 1: Switch to Polygon Sub-Mode

![Part B Step 1: Switching to Polygon sub-mode in the sub-panel](screenshots/11-polygon-mode.png)

**What you see:**
The reclassification sub-panel is visible (below or near the toolbar). Two buttons are shown: **Drag-Select** and **Polygon**. The Drag-Select button was previously active.

**What to do:**
Click the **Polygon** button. The overlay text in the 3D viewport updates to:

> *Click to place vertices · click first vertex to close*

The cursor changes to a crosshair indicating vertex placement mode.

**Tips:**
- Polygon mode is better than drag-select for irregularly shaped areas — for example, selecting the road surface around a curve, or selecting a building footprint that is not axis-aligned.
- Polygon mode works in the 3D viewport. For 2D polygon selection, see Section 09 (2D Editor Reclassification).

---

### Step 2: Click Vertices to Draw the Polygon

![Part B Step 2: Clicking to place polygon vertices one by one](screenshots/12-polygon-vertices.png)

**What you see:**
With each click in the 3D viewport, a vertex marker appears. Lines connect the vertices in order, forming the outline of the polygon as it grows. The first vertex has a distinct visual marker (often a larger circle or a different color) to make it easy to target for closing.

**What to do:**
Click at least three points to define the polygon shape. Work around the boundary of the area you want to select:
1. Click vertex 1 (start/closing marker appears).
2. Click vertex 2.
3. Click vertex 3.
4. Continue clicking to add more vertices.

**Editing vertices during placement:**
- Press **Backspace** or **Delete** to remove the last placed vertex.
- Press **Escape** to cancel the polygon entirely and return to an empty state.

**Tips:**
- Plan the polygon path before clicking so you do not need to backtrack.
- Fewer vertices are better — a 4–6 vertex polygon over a roughly rectangular road patch is cleaner and faster than a 20-vertex polygon.
- You do not need to trace the point cloud boundary exactly; any polygon that encloses the target points works.

---

### Step 3: Close the Polygon and Confirm

![Part B Step 3: Closing the polygon and the Confirm button appearing](screenshots/13-polygon-close-confirm.png)

**What you see:**
The polygon is nearly complete. To close it, the cursor is near the first vertex (which is highlighted to indicate it can be clicked to close). Alternatively a **Confirm selection** button is visible in the 3D viewport (typically as an overlay button in one corner of the viewport).

**What to do — two options:**

| Method | Action |
|--------|--------|
| **Click first vertex** | Move the cursor to the first placed vertex (the special marker) and click it. The polygon closes and the selection is confirmed. |
| **Press Enter** | Press **Enter** at any point after placing 3 or more vertices to close and confirm the polygon immediately. |

After closing, the polygon outline disappears and the enclosed points turn **yellow** (selected).

**Tips:**
- If your polygon misses some intended points, do not worry — you can Ctrl+drag additional points after closing (if you are in Drag-Select mode temporarily), or simply proceed with the class picker and then undo if the result is wrong.
- Press **Escape** before closing to cancel the polygon without making a selection.

---

### Step 4: Class Picker and Reclassification

![Part B Step 4: Class picker after polygon selection — reclassifying enclosed points](screenshots/14-polygon-class-picker.png)

**What you see:**
The polygon has been closed. The enclosed points are yellow. The class picker panel appears (identical to the one in Drag-Select mode).

**What to do:**
Use the search field or arrow keys to find and select the target class, then press **Enter** to confirm. The points reclassify and change to the new class color.

**Tips:**
- The class picker workflow is identical to the Drag-Select workflow (see Steps 7–9 in Part A above).
- If a **Confirm selection** button is visible in the 3D viewport, clicking it is equivalent to pressing Enter in the class picker — it confirms the currently highlighted class.

---

## General Tips

**Combine with a Region of Interest (ROI)**
Before reclassifying a large area, use the ROI tool (Section 06) to isolate just the neighborhood you want to work on. Fewer visible points means fewer accidental inclusions in your selection rectangle or polygon.

**Use Classification color mode throughout**
Working in any other color mode means you will not see the reclassification result until you switch back. Keep Classification mode active for the most immediate feedback loop.

**Undo is your safety net**
Ctrl+Z undoes the last reclassification. If you accidentally reclassify a large group of points to the wrong class, undo immediately before doing anything else.

**3D vs. 2D reclassification**
The 3D viewport reclassification tools described in this section operate on projected points — what you see on screen. For a more precise, height-aware selection (for example, selecting only road points within a specific elevation band), use the Profile Viewer's 2D reclassification mode described in Section 09.

**Save frequently**
Reclassification changes are not auto-saved. Press **Ctrl + S** or click the Save button in the toolbar regularly to write your changes to disk.
