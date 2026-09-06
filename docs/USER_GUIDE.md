# Working in AxiomCAM

## Start with the computed example

Launch the app and let the four operations finish generating. The initial view shows the computed final stock and toolpath overlay. The timeline is at the end, so choose **Reset stock** or the leftmost playback control to inspect machining from the beginning. The status bar identifies WebGPU or Canvas fallback; either mode uses the same computed geometry and toolpaths.

The left pane contains ordered machining operations and the geometry hierarchy. Selecting an operation shows its parameters and selected chains. Selecting geometry switches the right pane to geometric properties. The bottom pane switches between stock simulation, verification and individual motion blocks.

## Define stock, tools and fixtures

**Machine → Stock & WCS** edits project name, material label, rectangular stock, geometry tolerance, sampling cell size, work-coordinate bounds, safe Z, rapid rate, spindle ceiling and post settings. Z values are absolute in the selected work coordinates. In the example, stock top is zero and the bottom is -18 mm.

**Tool library** adds or edits flat mills and drills. Diameter, flute length, stickout, holder diameter/length and maximum stepdown have actual planning or verification effects. Tool numbers must be unique. Reassign an operation before deleting its referenced tool. Center-cutting is a user declaration required by the implemented plunge-entry strategy.

The feed calculator uses surface speed, chip load, flute count and spindle limits to fill RPM/feed values. The sample values are illustrative and must not be treated as qualified tooling recommendations.

**Fixtures** adds axis-aligned boxes with an XY position/size and bottom/top Z. These boxes participate in collision checks and clearance validation. Keep their modeled dimensions and placement consistent with the actual setup; unentered bolts/clamps and workholding strength are not inferred.

## Create and modify XY geometry

Switch to **Wireframe**, then **Top view**. Rectangle and Circle are two-click tools: opposite corners for a rectangle, center then radius point for a circle. Polygon accepts successive vertices and closes with Enter or a double click. Point places a drilling location with each click. Escape cancels creation and returns to selection.

Select an entity in the geometry tree or viewport. Its numeric properties appear in the inspector. Rectangles have a corner radius; entering a positive valid radius creates a rounded rectangle. Polygon vertices have editable XY coordinates. Selected entities expose handles for corner/vertex/center/radius editing. Drag an entity to translate it. A drag becomes one undoable transaction on pointer release.

Grid snapping uses 1 mm spacing; endpoint/center snapping activates within a screen-space threshold. Hold Alt to disable snapping. Ctrl, Command or Shift toggles additional geometry selections. Visibility changes affect display, not whether a referenced contour participates in machining.

**Transform** translates or rotates selected geometry about the center of the selection bounds and optionally keeps originals. Rotated rectangles become explicit polygon contours. **Duplicate** creates translated copies. Geometry **Delete** removes selected entities; operations still referencing them report errors until reassigned.

The measurement tool reports XY delta and distance between two picked points. It is a session measurement overlay, not a persistent dimensional constraint. SVG export writes the current wireframe; it is not a solid or machining exchange format.

## Select chains and create operations

Select the desired closed contours in the geometry tree or viewport, then use **Toolpaths → Pocket**, **Contour** or **Drill**. Facing uses the stock rectangle and needs no contour selection.

For a pocket with an island, select both the outer pocket contour and the nested island contour. Separate rings must not cross or touch. An even/odd nesting rule controls accessible regions. A circle selected for drilling is a hole definition and must match the selected drill diameter; points carry locations only.

To reassign an existing operation, select the operation first, then select the desired geometry. Click the **Operation** mode switch in the inspector, without clicking the operation row again, and choose **Use selected geometry**. Clicking an operation row intentionally reloads that operation's existing chain selection.

The operation inspector edits tool, top, final depth, maximum stepdown, stepover, allowance, raster angle, direction, spindle, cutting/plunge feeds, clearance/retract and drilling peck values as applicable. Geometry and stock use absolute work coordinates. A depth of -7 means Z=-7, not a 7 mm increment from the previous operation.

Profile direction is explicitly clockwise/counterclockwise. Do not equate that toggle with a universal climb/conventional selection independently of inside/outside side, spindle rotation and contour topology. The compensation side is a separate setting.

## Order, regenerate and diagnose

Select an operation and use the up/down manager buttons to change execution order. The enable checkbox suppresses it without deleting it. Duplicate and delete are also available. Reordering recomputes inter-operation linking, ideal time and verification, even when local operation paths are reused from cache.

Automatic regeneration is debounced; F9 or **Regenerate** requests it immediately. Editing clears the old derived result immediately, so it cannot be posted while a replacement is being calculated. The busy overlay offers cancellation. Repeating generation with unchanged parameters can reuse the operation cache; it still verifies the ordered program.

The **Verification** panel distinguishes blocking errors from retained model-limit warnings. Click an issue with a motion index to inspect that point in the program. Errors can include invalid contours, a tool that does not fit, insufficient flute reach, unsafe clearances, boundary gouges, fixture collisions or sampled remaining-stock violations. Fix the project rather than trying to acknowledge past an error.

## Backplot and stock simulation

Reset reconstructs the original stock. Play advances according to ideal feed/rapid travel time; speed changes only playback rate. Pause, step, drag the timeline or jump to an operation segment. Rewinding rebuilds the stock prefix from its initial state. The displayed cutter, shank and holder follow the computed stream.

Turn rapid lines on for linking inspection. Toggle stock, toolpaths, geometry, fixtures and grid independently under View. Right-drag orbits; middle-drag or Shift/right-drag pans; the wheel zooms about the cursor. F fits the stock. The 1 and 2 keys select top and isometric views.

The stock is sampled, not a target solid. Read VERIFICATION.md before using thin features or interpreting the apparent remaining material. Displayed time excludes acceleration, tool change, spindle run-up and control effects.

## Save, restore, report and post

Ctrl/Command+S exports an editable `.axiomcam.json` file and updates local autosave. Ctrl/Command+O opens a versioned project JSON file. Autosave uses the browser's storage where allowed and is not a backup. Opening or creating a project remains undoable during the current session.

The File menu provides an empty project and a reloadable demonstration project. An empty project keeps a useful initial stock/tool setup, but removes geometry and operations. Export the current work before replacing it when a separate durable copy is needed.

**Report** exports source setup, operation metadata, statistics, issues and limitations in JSON. **Post code** requires a current generated/verified project and an explicit acknowledgement. It opens the actual linear NC text and a `.nc` download action. This acknowledgement does not qualify the program for a controller. Read POSTPROCESSOR.md and independently review/prove out a machine-specific adaptation before physical machining.

## Keyboard reference

| Command | Key |
|---|---|
| Undo / redo | Ctrl/Command+Z, Ctrl/Command+Y or Shift+Z |
| Save / open project | Ctrl/Command+S / O |
| Regenerate | F9 |
| Play / pause | Space |
| Fit / top / isometric | F / 1 / 2 |
| Finish polygon / cancel creation | Enter / Escape |
| Delete selected geometry | Delete, in geometry mode |
| Disable snap | Hold Alt |

Keyboard shortcuts do not override active numeric/text input or an open dialog. The interface is intended for a desktop-size viewport, with a minimum layout width of 800 px.
