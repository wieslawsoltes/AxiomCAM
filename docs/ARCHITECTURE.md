# Architecture and public APIs

## Design boundary

The editable project is the source of truth. Geometry, tools, fixtures and operations have persistent IDs; operations reference geometry/tool IDs rather than list positions. A renderer does not define machining semantics. The compiler outputs actual cutter-tip motion, and simulation, verification and posting consume that stream.

There is no framework, backend, third-party geometry package or native dependency. Browser APIs provide DOM controls, ES modules, workers, typed arrays, local storage and WebGPU. Node is only a convenient local server and test runner. The optional Playwright test harness is not part of the application runtime.

## Project model and transactions

`project.js` defines version 1 of the `axiomcam` JSON schema. Its top-level fields are `schema`, `version`, `name`, `units`, `material`, `tolerance`, `stock`, `machine`, `fixtures`, `tools`, `geometry`, `operations`, `simulation` and `post`.

The `History` class holds the current snapshot and bounded past/future stacks. `commit(label, mutator)` clones the project, applies the mutation, validates the result, then atomically advances the current state. An invalid mutation does not partially alter the live project. Undo/redo replace snapshots and increment a monotonically increasing revision. Loading a new valid project is also undoable. The default bound is 80 entries, including imported project replacements.

Schema validation handles structural safety, coordinate/numeric limits and collection sizes. Operation feasibility is handled separately by the CAM compiler, so a temporarily invalid machining parameter can produce a visible operation diagnostic instead of making the whole editor unusable. Deleting referenced geometry is permitted as an editable state; regeneration identifies the missing contour and blocks posting.

Autosave stores only the editable JSON project. Generated geometry, motions and stock are regenerated; stale derived data is not treated as authoritative after restoration. History and view camera state are session state, not part of the saved project.

## Generation concurrency

An edit immediately invalidates the active request token, clears derived results, stops playback and marks the generated revision unavailable. Automatic regeneration waits 250 ms to coalesce edits. This immediate invalidation matters: invalidating only when the debounce expires would let an old worker reply become accepted as a new project revision.

Each worker request has a monotonically increasing ID and a structured-cloned project. Progress/result messages carry that ID. The UI rejects mismatched IDs and additionally compares the returned exact project snapshot with the current project. Cancellation terminates the worker, abandoning its cache. A new worker is created for subsequent generation.

The worker's stages are:

```text
validateProject
  → compile enabled operations or return operation diagnostics
  → concatenate in the current operation order
  → recompute ideal movement times
  → independent verification and final stock field
  → transfer Float64 timing buffer and Float32 height buffer to UI
```

There is no cooperative cancellation in the synchronous geometry kernel; worker termination is the cancellation mechanism. Unrelated operation changes can reuse cached local paths, but global order, linking times and verification are always recomputed.

## Operation cache and motion IR

Each local operation cache key serializes engine version, operation parameters, machining tolerance, stock, fixtures, machine settings, referenced tool and selected geometry. Cache entries contain local motion and descriptive warnings. At most 200 entries are retained. Public generated motions are copied out of cached entries, preventing an external mutation of a returned motion object from corrupting the cache.

A motion endpoint has the following shape:

```js
{
  x: 42.5, y: 31.2, z: -4,
  kind: 'cut',          // 'rapid', 'plunge', 'cut'; initial anchor is 'start'
  feed: 850,            // mm/min; rapid uses the configured rapid rate
  opId: 'operation-id',
  toolId: 'tool-id',
  rpm: 8000,
  coolant: true
}
```

For endpoint `moves[i]`, the previous endpoint is the segment start. The first record is an anchor in work coordinates at safe Z. It is not a measured real machine state. Operation records provide start/end indices in this global stream, depth planes, contour counts and warnings.

`times[i]` is cumulative ideal time at endpoint `i`. The timeline interpolates a partial current segment and applies stock removal continuously at covered cell centers. Rewinding rebuilds stock from its initial rectangular prism; it does not attempt numerically unstable reverse cutting. Seeking therefore costs work proportional to the replayed prefix.

## Geometry and planning algorithms

`geometry.js` separates exact lattice predicates from floating construction. Ring normalization establishes even/odd region orientation. `offsetRegion` constructs and splits a parallel boundary arrangement, classifies fragments against the original signed distance and stitches surviving loops. `rasterSegments` rotates the region into a scan coordinate system, computes sorted line/ring intersections, forms even/odd intervals, then transforms them back.

For an inside tool-center region, the cutter radius, allowance and tolerance guard determine the erosion amount. Pocket raster spacing is cutter diameter multiplied by stepover percentage. Boundary loops are finished at each depth. Nearest-start selection and alternating raster directions are simple local heuristics; the planner is not a global cycle-time or engagement optimizer.

There is no BVH/R-tree in this release. Arrangement/validation uses bounding-box rejection and pairwise edge tests; stock sweeping restricts updates to an affected grid-index rectangle. These choices keep the implementation inspectable, but their worst-case cost is documented rather than hidden under an unsupported large-model performance claim.

## Verification and integrity binding

`verifyProject` independently checks the generated stream against the entered model. It reconstructs boundary regions, tests cylindrical tool envelopes, simulates center-sampled stock, and records first occurrences of repeated issue categories per operation/message. The final heightfield is returned as a transferable typed array.

Generation captures `projectSignature(project)`, and verification captures both the same project serialization and `motionSignature(moves)`. These are exact JSON strings, not lossy hashes. The post refuses output if any differ. This deliberately uses O(project size + motion count) extra memory and conservatively invalidates even metadata/property-order changes. It is an equality/integrity contract for normal API use, not cryptographic attestation against a malicious caller.

## Rendering

`Renderer` exposes an orthographic camera with explicit right/up/view basis vectors and a world-to-clip matrix. Geometry and machining coordinates stay independent of camera orientation. CPU projection and XY-plane unprojection provide picking and editing; picking is not a GPU ID-buffer feature in this version.

The WebGPU path has:

- A mesh pipeline using 24-byte position/normal vertices and 40-byte per-instance position/size/color records.
- One reusable cuboid mesh instanced for stock columns and fixture boxes.
- A reusable 40-segment cylinder mesh instanced for cutter, shank and holder.
- A separate batched line-list pipeline for grid, selected geometry and toolpaths.
- A 64-byte matrix uniform, a depth texture, alpha blending for path overlays, and grow/reuse vertex-buffer allocation.

Grid lines render before solids; geometry/toolpaths are intentional inspection overlays. Camera movement updates the matrix without rebuilding static line geometry. Stock changes rebuild the instance data. Native GPU resource failures and shader diagnostics are visible; device loss switches to Canvas. The Canvas implementation projects and depth-sorts stock faces, while using the same generated toolpaths and stock values.

The renderer is implemented but its native WebGPU execution has not been runtime-validated in the recorded environment. Do not infer frame rate from architectural choices. `renderer.frameMs` measures CPU draw-submission work, not hardware GPU elapsed time.

## Using the engine without the UI

```js
import { demoProject, validateProject } from './src/project.js';
import { generateProject } from './src/cam.js';
import { verifyProject } from './src/simulation.js';
import { postprocess } from './src/post.js';

const project = validateProject(demoProject());
const cache = new Map();
const program = generateProject(project, cache);
const verification = verifyProject(project, program);

if (program.errors.length || verification.errors) {
  console.error(verification.issues);
} else {
  // Demonstration of the API only. Machine-specific review is still required.
  const nc = postprocess(project, program, verification, {
    acknowledged: true,
  });
  console.log(nc);
}
```

Generation throws for invalid project schema; per-operation planning failures are collected in `program.errors`. Verification errors are a count with details in `verification.issues`. Posting throws on absent acknowledgement, stale snapshots, errors or nonfinite output. Do not mutate derived IR after verification; regenerate and reverify instead.

## Extension points

A new operation type belongs in schema defaults, operation validation, compiler strategy and UI parameter editing. It must also define its stock-removal/verification semantics and have regression tests. A new tool shape cannot be added only to rendering: collision envelopes and material removal must agree with it. A new post should consume the same verified IR but explicitly define controller-specific setup, tool change, retract, compensation and termination behavior.

Full solid CAD, adaptive machining, ramp/helix entry, exact stock CSG, fixture assemblies, machine kinematics and qualified controller posts are not implemented extension stubs. They are outside this release's executable scope. No UI button claims to execute them.
