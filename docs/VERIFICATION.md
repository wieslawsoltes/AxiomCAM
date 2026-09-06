# Numerical and verification contract

## Meaning of a passing result

AxiomCAM's verification is an explicitly bounded software model. A result with zero errors means that none of the implemented checks failed for the entered project, generated motion stream, configured tolerances and sampled stock. It does **not** establish manufacturability, dimensional accuracy, adequate workholding, controller compatibility or safe machine operation.

The app always retains model-limit warnings. It blocks NC export for generation or verification errors, stale project snapshots, a motion stream changed after verification, or missing user acknowledgement. Those gates are correctness safeguards, not a substitute for a qualified machine-specific post, independent NC/control simulation and shop prove-out.

## Coordinates and numerical representations

| Quantity | Representation / limit |
|---|---|
| Units | Millimeters only |
| Tool orientation | Fixed +Z axis; tool tip moves in XYZ |
| Sketch plane | XY; displayed at stock top |
| Sketch coordinate range | ±10,000 mm |
| Topology lattice | 0.00001 mm / 100,000 integer units per millimeter |
| Orientation tests | Exact signed `BigInt` determinant on quantized coordinates |
| Arrangement intersection inclusion | Exact integer determinant/numerator interval tests |
| Constructed joins/intersections | JavaScript floating point, then lattice quantization |
| Signed-distance classification | Floating-point distances and point-in-region tests |
| Machining tolerance | 0.002–0.5 mm; initial project 0.020 mm |
| Circle / rounded join chord target | Tolerance / 4 before quantization |
| Stock samples | Float32 heights on an XY grid |
| Stock cell size | Requested 0.2–5 mm; exact cell widths fit the stock rectangle |
| G-code coordinates | Four decimal places |
| Motion time | Float64 ideal distance / commanded feed |

**Machining tolerance and stock cell size are independent.** Setting a 0.020 mm geometry tolerance does not make a 1 mm stock preview accurate to 0.020 mm. The lattice spacing is not a claim of physical machining accuracy.

## Accepted geometry and offsets

The machining region consists of closed, simple XY contours. Separate rings may be disjoint or nested. An even/odd rule identifies material regions and islands: an outer ring is filled, its child is a hole/island exclusion, the next nested ring is filled again. Winding is normalized after nesting classification.

Input validation rejects self-intersections, self-touching contours, degenerate area, nonfinite/out-of-range coordinates, and selected rings that intersect or touch. Selected-ring clearance below four times the machining tolerance is rejected. Very narrow features within one contour, nearly coincident edges and near-collinear spikes are outside the suitable operating domain even where initial validation accepts them.

The custom offset algorithm performs the following operations:

1. Construct parallel edges. Expanding convex vertices use chord-bounded round joins; the complementary joins use line intersections.
2. Intersect raw offset edges and split them into an arrangement. Integer predicates decide intersection topology; shared intersection points are constructed in floating point and snapped.
3. Evaluate signed distance to the original region on both sides of each fragment. The probe distance is `max(0.6 × tolerance, 4 × lattice spacing)`.
4. Keep boundary fragments, orient their filled side consistently, and stitch loops. Open boundaries and ambiguous junctions stop the operation rather than emitting a guessed toolpath.
5. Discard collapsed/degenerate loops. A cutter that leaves no reachable pocket region produces a generation error.

Positive offset expands the filled region; negative offset erodes it. Nested holes expand during pocket erosion. Topological splitting is supported and tested with a narrow-neck/dumbbell region. This is not an exact rational-construction kernel, a formally proved offset library, or a general solid CAD kernel. The fixed classification probes and floating constructions can fail or discard features close to the tolerance scale. A successful result is not a proof for arbitrary adversarial geometry.

Milling compensation adds a radial guard equal to the machining tolerance:

```text
Pocket / inside profile erosion = tool radius + wall allowance + tolerance
Outside profile expansion       = tool radius + wall allowance + tolerance
Centerline profile              = selected contour, no radius compensation
```

The guard intentionally leaves a small radial skin. It is not removed by controller cutter compensation: the post emits G40 and precomputed cutter-center positions. Centerline profiling deliberately cuts along the selected centerline and does not enforce an inside/outside wall boundary.

## Toolpath behavior

Facing uses parallel raster rows over the stock rectangle and overtravels its X ends by the cutter radius plus 1 mm. Pocketing clips alternating raster sweeps to the eroded even/odd region and then follows all accessible boundary loops at each depth. Profiling follows compensated closed loops at layered depths. Drilling accepts points and circles; circle diameters must match the drill within machining tolerance.

Depth planes are computed without overshooting the final depth. Separate milling traverses fully retract to clearance, rapid in XY at clearance, approach to `stock.top + retract`, and then feed-plunge. The approach height is not based on an unverified assumption that earlier operations removed the operation's top stock. Direct plunges are the only entry strategy; milling tools that use them must be declared center-cutting. This declaration is a user input, not a validated cutter characteristic.

Drilling emits explicit pecks with chip retracts; there are no canned cycles or spindle dwell calculations. Drill depth refers to the idealized tip coordinate. The preview treats a drill as a flat-bottom cylinder and does not compute a conical point, breakthrough allowance or point-length compensation.

The compiler checks tool type, flute reach, RPM ceilings, positive feeds, allowed stepover/allowance, depth versus stock bottom, configured maximum stepdown/peck, contour references, clearances and safe Z. Feeds/speeds are not derived from a validated tooling/material database. Operation top is a programmer input; remaining-stock engagement verification helps identify an unsafe assumption about previously removed material.

## Implemented checks

### Continuous cutter / shank / holder against fixtures

Each tool is represented by three vertical cylinders: cutting portion, same-diameter shank, and a cylindrical holder. Fixtures are the entered axis-aligned boxes. For each linear tool-tip segment, the algorithm solves the interval during which the cylinder's vertical extent overlaps a fixture and tests XY segment-to-rectangle distance over that same interval. A cylinder grazing within the configured tolerance counts as a collision.

This check is continuous along the modeled segment; it does not depend on animation frames or toolpath endpoint sampling. It still uses finite-precision geometry and simplified cylinders/boxes. Flutes, tapered holders, collets, bolts, clamps not entered as boxes, and complete machine assemblies are not represented.

### Independent boundary gouge checks

For pocket cuts and inside/outside profile cuts, verification reconstructs the original selected region independently of the offset output. It checks the expected filled/unfilled side and minimum swept XY segment distance to every region boundary against tool radius plus allowance, with the tolerance band. This catches a corrupted traverse through an island or across a protected wall. It is not a full comparison against an independent 3D target solid, and it does not certify that all intended stock was removed.

### Stock-removal heightfield

Each XY cell stores the remaining material's top Z. The algorithm analytically computes the parameter interval in which a swept tool disk covers the **cell center**, then applies the minimum tool-tip Z within that interval. This avoids temporal sampling gaps at those sample centers, including fast or long moves. Cutting/plunge segments remove sampled material; rapid segments do not.

The volume is the sum of cell area times removed height. Float32 heights introduce additional small rounding effects. Between-cell material, thin ribs and small holes can be missed or overrepresented. A cell column is a visualization of its center sample, not an exact volume intersection. No universal volume-error bound is claimed.

A 2.5D heightfield cannot represent undercuts, side cavities, overhangs, disconnected chips or material below an overhanging surface. Stock starts as the configured rectangular prism; arbitrary initial mesh/solid stock is unsupported.

### Rapid-stock and axial engagement

Rapid segments are checked against the remaining stock at cell centers. A missed between-center obstruction can therefore produce a false negative. For milling, the maximum newly removed sampled depth per cut is checked against the tool's configured maximum stepdown. This is an axial-depth sanity check, **not** a cutting-force, instantaneous engagement-angle or material-removal-rate model. Drilling uses its explicit peck-depth limit instead.

### Shank/holder and original stock

The shank and holder are checked against the **original** stock envelope. This is intentionally conservative: it can report a collision even where earlier operations removed the offending stock. It must not be interpreted as an exact remaining-stock solid intersection.

### Configured work envelope

Tool-tip endpoints are checked against an axis-aligned box in the selected work-coordinate frame. A linear segment between endpoints inside a convex box stays inside that box. This check is not a machine travel model: holder extents, axis limits in machine coordinates, rotary geometry, head/table assemblies and toolchanger positions are absent.

## Time, NC output and unmodeled motion

Playback time is calculated from segment length divided by the segment's feed/rapid rate. There is no acceleration, jerk, blending, exact-stop dwell, tool-change time, spindle run-up, coolant delay or controller lookahead model. The displayed 16:30 demonstration time is an ideal travel-time estimate.

The post inserts controller commands outside the geometric stream, including M6 and the first Z-only safe positioning move. The initial actual machine location, tool-change macro trajectory and controller-dependent rapid interpolation are not verified. Existing rotations, scaling, local offsets and other controller modes beyond the emitted preamble require explicit machine-specific review. G61 is not universally interchangeable between controls. See POSTPROCESSOR.md.

## Resource bounds and performance boundaries

The UI caps imported JSON at 10 MiB. The project schema caps each principal collection at 500 entries, each validated contour at 2,000 vertices, stock XY dimensions at 1,000 mm, and the simulation grid at 160,000 samples. Additional compiler guards include 500 depth layers, 3,000 facing rows, 15,000 pocket raster rows/traverses, 12,000 raw offset edges, 200,000 moves per operation and 300,000 motion states per project. Over-budget generation produces diagnostics rather than a truncated NC program.

These are rejection bounds, not promised interactive performance at their maxima. Arrangement/validation work contains pairwise edge tests and can be quadratic. The stock sweep loops over affected sample bounding boxes. Generating and verifying run in a worker; cancellation terminates it. The UI drawing and interactive playback update remain main-thread tasks. No GPU throughput or large-job benchmark is claimed in this release.

## Regression evidence and remaining work

The included tests exercise analytical shapes, islands, a split topology, exact lattice orientation, fixture crossings between clear endpoints, Z-overlap intervals, stock sweeps, corrupted boundary paths, unsafe operation-top assumptions, cache isolation, snapshot integrity, deterministic JSON restoration and output-coordinate reconstruction.

The automated browser run covers UI/worker behavior through the Canvas fallback. Native WebGPU execution, controller simulation, physical machining, full adversarial geometry coverage and machine-specific post qualification have not been performed. The appropriate interpretation is a tested software foundation within the documented scope, not a certified manufacturing process.
