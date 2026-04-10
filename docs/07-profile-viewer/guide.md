# Section 07: The Profile Viewer

The Profile Viewer lets you slice through your point cloud along any arbitrary line, producing a precise 2D cross-section that sits alongside the main 3D viewport. This is the primary tool for verifying and correcting classifications on narrow features such as road surfaces, kerb lines, wires, or building facades — geometry that is easy to miss when working in full 3D perspective.

---

## What the Profile Viewer Is For

When annotating a large outdoor scan it can be difficult to distinguish nearby classes — for example, road points blending with sidewalk or ground vegetation points obscuring a kerb. The Profile Viewer lets you:

- **Inspect a thin slab** of the point cloud in an orthographic 2D view, free from perspective distortion.
- **Walk along a vehicle trajectory** using keyboard shortcuts, moving the slab step by step through the entire scan path.
- **Edit classifications directly in 2D** using the reclassification tools described in Section 09.
- **Verify cross-sections** of roads, footpaths, building walls, or any other linear feature.

The tool produces two complementary views of the same slab:

| View | Description |
|------|-------------|
| **Plan view** | Top-down orthographic projection — shows the slab as seen from directly above |
| **Profile view** | Side elevation along the drawn line — shows height (Z) on the vertical axis and distance along the line on the horizontal axis |

---

## Step 1: Activate the Plan/Profile Tool

![Step 1: Activating the Plan/Profile tool from the toolbar](screenshots/01-profile-tool-button.png)

**What you see:**
The main toolbar runs across the top of the window. The **Plan/Profile** button is located in the toolbar row.

**What to do:**
Click the **Plan/Profile** button in the toolbar. Alternatively, the same tool is accessible from the viewport control buttons on the right side of the 3D viewport.

Once activated, the cursor changes to indicate line-drawing mode and an instruction overlay appears in the 3D viewport: *"Click to place start point"*.

**Tips:**
- Make sure a point cloud is loaded before activating this tool. On an empty scene the tool will activate but no cross-section will be generated until points are present.
- If another tool is active (such as Reclassify Points or an annotation mode), the Plan/Profile button deactivates it automatically.

---

## Step 2: Draw the Profile Line

![Step 2: Clicking two points in the 3D viewport to define the slab center line](screenshots/02-draw-profile-line.png)

**What you see:**
The 3D viewport is in line-drawing mode. A prompt in the overlay reads *"Click to place start point"*. After placing the first point, the prompt updates to *"Click to place end point"*.

**What to do:**
1. **Click once** on the point cloud in the 3D viewport to place the **start point** of the profile line.
2. **Click a second time** at a different location to place the **end point**.

The line between these two clicks becomes the **slab center line** — the axis along which the 2D cross-section is generated. A visual line and two vertex handles appear in the 3D view.

**Tips:**
- For a road cross-section, draw the line perpendicular to the road direction (across the carriageway).
- For a wall or curb, draw the line parallel to the feature you want to inspect.
- You can redraw the line at any time by clicking two new points; the existing slab updates immediately.
- Orbit the 3D view first to position the camera so your click points land on the surface you intend.

---

## Step 3: The Secondary 2D Viewport

![Step 3: The secondary 2D viewport appearing alongside the 3D view](screenshots/03-secondary-viewport.png)

**What you see:**
As soon as both points are placed, the window layout changes. The 3D viewport narrows to occupy roughly the left two-thirds of the screen (approximately 240–1200 px). A new **2D viewport** appears on the right (approximately 1200–1920 px). The two panels sit side by side.

The 2D viewport contains:
- A rendered orthographic view of the slab contents.
- A **Plan / Profile** toggle at the top of the panel.
- A **Point Size** slider below the toggle.
- Zoom and pan behave independently from the 3D view.

**Tips:**
- If you cannot see any points in the 2D viewport, the slab may be too narrow for the area you clicked. Try increasing the **Slab Depth** (covered in Step 5) or redraw the line directly over a dense region of the cloud.
- The 2D viewport renders points using the same active color mode as the 3D view (e.g., Classification, Intensity, RGB).

---

## Step 4: Plan View vs. Profile View

![Step 4: Switching between Plan view and Profile view in the 2D panel](screenshots/04-plan-vs-profile.png)

**What you see:**
At the top of the 2D viewport there is a toggle with two options: **Plan** and **Profile**.

**What to do:**
Click **Plan** to see the slab from directly above (X–Y plane). Click **Profile** to switch to the elevation view (distance along line on X axis, height Z on Y axis).

| Toggle state | Best used for |
|--------------|---------------|
| **Plan** | Verifying which points fall inside the slab laterally; checking lane widths |
| **Profile** | Distinguishing road surface from kerb, sidewalk, or sub-surface noise by height |

**Tips:**
- Profile view is the most useful for classification work because it separates features by height.
- Plan view is useful for confirming the slab is centred correctly over the feature of interest.

---

## Step 5: Adjust the Slab Depth

![Step 5: Adjusting the slab depth control](screenshots/05-slab-depth.png)

**What you see:**
A **Slab Depth** (or thickness) control appears in the 2D viewport panel or in a floating settings panel associated with the Plan/Profile tool. It accepts a numeric value or has increment/decrement controls.

**What to do:**
Increase or decrease the slab depth to change how thick the cross-section slice is (measured in metres perpendicular to the slab center line).

- **Thin slab (e.g. 0.5 m):** Isolates a very narrow band of points — precise but may contain few points in sparse areas.
- **Thick slab (e.g. 5 m):** Captures many more points but may mix features that are close together laterally.

**Tips:**
- Start with a moderate depth (1–2 m) and adjust based on the density of the cloud and the width of the feature.
- A slab that is too thick can make the Profile view look cluttered; reduce it until the cross-section is legible.

---

## Step 6: Navigate the 2D Viewport

![Step 6: Navigating the 2D viewport with scroll, right-drag, and Ctrl+Shift](screenshots/06-2d-navigation.png)

**What you see:**
The 2D viewport is active and showing point cloud data. Navigation in this panel is completely independent of the 3D view.

**Controls:**

| Action | Input |
|--------|-------|
| Zoom in / out | Scroll wheel |
| Pan | Right-click + drag |
| Pan (trackpad) | Ctrl + Shift + two-finger scroll |

**What to do:**
- **Scroll** over the 2D viewport to zoom in on an area of interest.
- **Right-click and drag** to pan the view when zoomed in.
- On a trackpad, hold **Ctrl + Shift** and scroll to pan.

**Tips:**
- Zoom in enough to see individual point returns — at high zoom the gap between points becomes visible and you can judge density.
- After panning, scroll out to re-establish context before redrawing the profile line.

---

## Step 7: Adjust Point Size in the 2D View

![Step 7: Point size slider in the 2D viewport panel](screenshots/07-point-size-slider.png)

**What you see:**
Below the Plan/Profile toggle in the 2D viewport panel there is a **Point Size** slider. Its range is **0.5 – 10.0**.

**What to do:**
Drag the slider left to reduce point size (making individual returns easier to distinguish) or right to increase it (filling gaps in sparse data).

**Tips:**
- The 2D point size is independent from the global Point Size setting in the sidebar Settings tab.
- For classification work, a smaller point size (1.0–2.0) makes it easier to identify the boundaries between classes.
- For a quick visual overview, a larger point size (4.0–6.0) fills the cross-section and makes the shape of the surface obvious.

---

## Step 8: Edit the Slab Line in 3D

![Step 8: Dragging slab line endpoints in the 3D viewport](screenshots/08-edit-slab-line.png)

**What you see:**
In the 3D viewport, the slab center line is drawn with two visible **vertex handles** — small spheres or square markers — at each end of the line.

**What to do:**
Click and drag either vertex handle to move that endpoint. The slab repositions in real time as you drag, and the 2D viewport updates to reflect the new slab contents.

**What this is useful for:**
- Fine-tuning the profile line position without having to reclick two brand-new points.
- Extending the profile line to include a longer section of a road or wall.
- Rotating the line slightly to align perfectly with an angled feature.

**Tips:**
- You must be in the Plan/Profile tool mode for the handles to be interactive. Switching to Grab/Navigate mode deactivates handle dragging.
- Dragging a handle to an area with no point cloud data is allowed; the 2D view will simply show an empty slab until the handle is moved back.

---

## Step 9: Trajectory Following

![Step 9: Using < and > keys to move the slab along the vehicle trajectory](screenshots/09-trajectory-following.png)

**What you see:**
When a scan trajectory is available, the **< and > keys** move the slab along the vehicle path. Each keypress shifts the slab center line to the next (or previous) trajectory position, keeping the slab orientation perpendicular to the direction of travel.

**What to do:**
- Press **>** (greater-than / right angle bracket) to advance the slab forward along the trajectory.
- Press **<** (less-than / left angle bracket) to step backward.

The 3D viewport shows the slab moving along the trajectory line. The 2D viewport updates at each step.

**Tips:**
- This is the most efficient way to perform a full-scan review: draw the profile line once at the start of the trajectory, then press **>** repeatedly to walk through the entire route.
- The step size is determined by the trajectory point spacing in the scan data. Dense trajectories produce small steps; sparse trajectories produce larger jumps.
- Combine this with Classification color mode and the reclassification tools (Section 09) to inspect and correct every cross-section along the route.

---

## Step 10: Practical Workflow — Verifying a Road Cross-Section

![Step 10: Full workflow — profile view on a road cross-section with classifications visible](screenshots/10-road-crosssection-workflow.png)

**What you see:**
The 3D viewport shows the Queens Campus point cloud in **Classification** color mode. The profile line crosses a road section. The 2D viewport (Profile view) shows the cross-section with road points (grey/brown), sidewalk points (tan), and vegetation (green) separated clearly by height.

**Recommended workflow:**

1. **Set color mode to Classification** — open the sidebar Settings tab and select Classification under Color Mode. This colors each point by its assigned class, making it immediately obvious when a reclassification takes effect.

2. **Activate Plan/Profile** — click the toolbar button.

3. **Draw the line across the road** — click once on one side of the road, click again on the other side. The profile line should be roughly perpendicular to traffic flow.

4. **Switch to Profile view** — toggle the 2D panel to Profile. You should see a clear "U" or trapezoid shape representing the road camber, with ground and sidewalk points at slightly different heights on each side.

5. **Zoom in on the 2D view** — scroll to enlarge the cross-section until individual height layers are visible.

6. **Identify misclassified points** — look for points colored as Noise (white/grey) or Other Ground (orange) that are clearly sitting at road height. Note their approximate horizontal position.

7. **Use the 2D reclassification tool** — switch to the reclassification mode in the 2D viewport (covered in Section 09) to select and reclassify those points without leaving the profile view.

8. **Step forward along the trajectory** — press **>** to move to the next cross-section and repeat.

**Tips:**
- Keep the slab depth narrow (0.5–1.0 m) when doing precision reclassification; wider slabs mix points from different positions and make it harder to target specific points.
- Save your work regularly with Ctrl+S (or the Save button in the toolbar) — trajectory stepping does not auto-save.
- If you lose track of where the slab is in the 3D view, click somewhere in the 3D viewport to refocus the camera, or use the View Cube widget in the bottom-right corner to reset the orientation.
