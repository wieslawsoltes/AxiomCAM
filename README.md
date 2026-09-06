# AxiomCAM

**Editable CAD. Computed 2.5D toolpaths. Explicit verification limits.**

A dependency-free, local-first CAD/CAM workstation built with plain HTML, CSS and JavaScript. The workspace combines a machining ribbon, ordered operation manager, editable XY geometry, parameter inspector, 3D stock view, feed-based backplot, verification diagnostics and a defined linear G-code postprocessor.

The implementation is original. Mastercam's general milling workflow is a reference for the organization of the workspace; no Mastercam code, assets, proprietary project formats or postprocessors are included. This is a functional, bounded 2.5D application, **not a claim of Mastercam feature parity, machine qualification or production machining safety**.

[Open the GitHub Pages app](https://wieslawsoltes.github.io/AxiomCAM/) · [Deployment instructions](docs/DEPLOYMENT.md)

The Pages app is available after the deployment workflow succeeds.

## Run

### Modular source — recommended

Use Node.js 20 or newer:

```sh
cd AxiomCAM
npm start
```

Open `http://localhost:8080`. There is **no npm install, framework, CDN, runtime package dependency or build step**. The server binds only to the local loopback interface.

An alternate port can be selected:

```sh
# macOS / Linux
PORT=8765 npm start

# PowerShell
$env:PORT=8765; npm start
```

Alternatively, any static server can serve this directory; for example:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

### Standalone distribution

`AxiomCAM.html` includes the application, geometry/CAM kernel, worker source, styles and shaders in one file. It makes no external resource requests. A browser that allows inline ES modules and Blob workers can run it without the source directory. Opening local files, browser storage and GPU availability depend on browser policy; serving the file on localhost is the most reproducible launch method.

The modular `index.html` must be served rather than opened as a `file:` URL because it loads ES modules and a module worker.

### Renderer

The app requests a native WebGPU adapter, compiles its WGSL shaders and uses instanced geometry, a depth buffer and batched toolpath lines. If WebGPU initialization is unavailable or fails, the application explicitly switches to **Canvas 2D fallback**. The status bar identifies the active renderer. Toolpath generation and verification are CPU algorithms running in a worker; this release does not present those computations as GPU compute.

WebGPU exposure is controlled by the browser and secure-context requirements. Use localhost for development or HTTPS for deployment. See the W3C and Chrome references below.

**Validation status:** the included automated browser run exercised the real application and worker through the Canvas fallback. This environment did not expose a usable WebGPU context, so the native WebGPU rendering path has not been runtime-validated or hardware-benchmarked here. The implementation includes asynchronous pipeline creation, shader diagnostics and a device-loss fallback so failures are visible rather than silently mislabeled.

## Included workflows

| Area | Working implementation |
|---|---|
| CAD | Rectangles, rounded rectangles, circles, closed polygons and points; numeric editing; vertex/size handles; dragging; translation, rotation and copies; grid/endpoint snapping; distance measurement; SVG sketch export |
| Selection | Geometry hierarchy, individual visibility, multi-selection and explicit operation-to-contour references; nested contours represent pocket islands |
| Setup | Rectangular stock, work-coordinate bounds, safe Z, rapid rate, spindle limit, editable axis-aligned fixtures, metric G54–G59 selection |
| Tools | Editable flat mills and drills; tool number, diameter, flute length/count, stickout, holder envelope, spindle/depth limits, center-cutting declaration and feed calculator |
| Facing | Computed depth layers and alternating raster passes over the stock rectangle; explicit cutter-radius overtravel |
| Profiling | Inside, outside or centerline compensation; layered closed contour passes; explicit clockwise/counterclockwise direction |
| Pocketing | Even/odd islands, radius/allowance/tolerance erosion, clipped raster passes, boundary finishing and independent clearance links |
| Drilling | Point/circle locations, diameter checks, nearest-next-hole ordering, explicit pecks and full chip retracts |
| Operation management | Add, duplicate, suppress, reorder, delete, edit parameters, regenerate; per-operation content-keyed cache with rebuilt linking and verification |
| Simulation | Feed-based play/pause, speed control, block stepping, seek/reset/final-stock reconstruction, moving cutter/shank/holder and a computed stock heightfield |
| Verification | Geometry/input diagnostics, boundary gouge checks, remaining-stock axial engagement, continuous cylinder/fixture collisions, holder/shank stock-envelope checks, rapid/stock tests and work-envelope checks |
| Output | Acknowledgement-gated G-code preview/download, JSON verification report, JSON project import/export and SVG sketch export |
| State | Stable IDs, 80-state transactional undo/redo, local browser autosave where permitted, stale-worker rejection and project/motion snapshot checks before posting |

Read [the user guide](docs/USER_GUIDE.md) for editing and programming commands.

## Computed demonstration

The initial mounting-plate project contains a 140 × 100 × 18 mm stock, two fixture boxes, seven geometry entities, three tools and four ordered operations: facing, island pocketing, four peck-drilled holes and an outside profile.

The shipped example is generated from those inputs, not an animation script:

| Measurement | Result |
|---|---:|
| Operations | 4 |
| Motion states, including the initial anchor | 2,123 |
| Emitted XYZ endpoint moves | 2,122 |
| Ideal feed/rapid travel time | 990.452 seconds, displayed as 16:30 |
| Estimated removed volume at 1 mm sampling | approximately 54,400 mm³ / 54.4 cm³ |
| Stock grid | 140 × 100 |
| Modeled verification errors | 0 |
| Persistent model-limit warnings | 2 |

The time is not a real machine cycle-time prediction. The volume is a sampled estimate, not an exact solid difference. Zero modeled errors is **not** a machining safety certificate. Feed/speed values are illustrative inputs, not recommendations for a particular cutter, spindle or material batch.

Examples:

- `examples/mounting-plate.axiomcam.json` — complete editable project.
- `examples/mounting-plate.verification.json` — computed statistics, source setup, operation warnings and model limits.
- `examples/mounting-plate.nc` — generic, unqualified NC output for inspection, **not direct machine use**.

## Core architecture

```text
Project / transaction
        │
        ├── immediate generation-token invalidation
        ├── validated local persistence
        └── debounced worker request
                 │
       validate → tessellate → normalize rings
                 │
           arrangement offset / raster clipping
                 │
          operation motion streams + cache
                 │
           rebuilt ordered global program
                 │
      independent boundary / collision / stock verification
                 │
          current-revision acceptance gate
                 │
       backplot + stock field + renderer
                 │
   exact project/motion snapshot check + acknowledgement
                 │
             linear NC post
```

The offset kernel is implemented in this repository; it is **not a bundled Clipper library**. It uses a 0.00001 mm lattice and exact `BigInt` orientation/intersection predicates for topology, with floating-point join/intersection construction and signed-distance classification. See the numerical contract before relying on its output for unfamiliar geometry.

The source is split into auditable modules:

```text
src/geometry.js       Lattice predicates, ring validation, offsets and raster clipping
src/project.js        Schema, stable IDs, transactions, exact snapshot serialization
src/cam.js            Toolpath compilation, operation cache and motion timing
src/simulation.js     Swept geometry, boundary checks and center-sampled stock field
src/post.js           Defined metric linear postprocessor and export gates
src/worker.js         Generation / verification worker with transferable arrays
src/renderer.js       Native WebGPU and explicitly labeled Canvas fallback
src/app.js            Editor, managers, dialogs, selection, playback and persistence
styles/app.css        Responsive workstation layout, no external fonts
```

[Architecture and APIs](docs/ARCHITECTURE.md) explain the numerical and concurrency decisions in more detail.

## Verification and postprocessor contract

Read **[VERIFICATION.md](docs/VERIFICATION.md)** and **[POSTPROCESSOR.md](docs/POSTPROCESSOR.md)** before interpreting the diagnostics or exporting NC.

Important boundaries: XY wireframe rather than a solid/NURBS CAD kernel; fixed vertical 2.5D tools rather than general 3D/rotary machining; center-sampled heightfield stock rather than exact CSG; entered boxes rather than a full machine assembly; direct plunge entries rather than ramps/helices; and a generic linear post rather than controller-specific machine qualification. There are no holding tabs, adaptive engagement strategy, cutting-force prediction, acceleration model or simulated toolchanger motions.

The NC post defines metric absolute XYZ, G0/G1, G17/G21/G40/G49/G80/G90/G94, G54–G59, G61, Tn/M6, optional G43/Hn, M3 and M8/M9. Machine-specific support and semantics still require independent review. Initial machine position, controller-side M6 motion and the first safe-Z positioning move are outside the modeled motion stream.

## Tests and rebuild

```sh
npm test                 # 31 dependency-free Node tests
npm run build            # rebuild the standalone HTML from modular source
npm run examples         # regenerate the editable example, report and generic NC
```

The build script rewrites only this repository's constrained named-import/export syntax. It is deliberately not advertised as a general-purpose JavaScript bundler.

Optional browser integration dependencies are separate from the application:

```sh
python -m pip install playwright
python -m playwright install chromium
npm start
# In another terminal:
python tests/browser-integration.py --url http://localhost:8080
```

The browser harness also supports an opaque-origin in-memory mode:

```sh
python tests/browser-integration.py --in-memory --chromium /path/to/chromium
```

The recorded run passed **31 core tests** and **29 browser checks**. Core coverage includes analytical offsets, nested islands, topology splitting, continuous collisions, stock sweeps, deterministic regeneration, stale snapshots and NC endpoint reconstruction. Browser checks include drawing, parameter edits, tool edits, operation ordering, collision blocking, worker race rejection, stock playback/scrubbing, actual downloads and restoration. See [TESTING.md](docs/TESTING.md), `tests/core-results.tap` and `tests/browser-results.json` for the scope and recorded outputs.

## Deployment and privacy

All application processing is local. The source contains no analytics, API keys, backend service or outbound data submission. Browser autosave is not a backup; export project files regularly. The application imports only its own versioned JSON schema, and exports JSON, SVG and text NC. STEP, IGES, DXF, STL and proprietary Mastercam imports are not implemented.

Serve the directory on an HTTPS static host, or serve `AxiomCAM.html` alone. A restrictive Content Security Policy must explicitly allow the chosen script/worker loading mode; the standalone distribution requires inline scripts/styles and Blob workers. No deployment, repository commit or public hosting has been performed as part of this source package.

## References

These are API/workflow references, not certification of this implementation:

- Mastercam, Mill Essentials: https://www.mastercam.com/support/product-training/courses/mill-essentials/
- W3C WebGPU: https://www.w3.org/TR/webgpu/
- W3C WGSL: https://www.w3.org/TR/WGSL/
- W3C Secure Contexts: https://www.w3.org/TR/secure-contexts/
- Chrome, WebGPU troubleshooting: https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips
- LinuxCNC, G-code reference: https://linuxcnc.org/docs/html/gcode/g-code.html
- LinuxCNC, G-code overview: https://linuxcnc.org/docs/html/gcode/overview.html

## License

Original application code is provided under the MIT license; see `LICENSE`. The license supplies no fitness, machining safety or controller-compatibility warranty. Mastercam is referenced only to identify the requested workflow inspiration; this project is not affiliated with or endorsed by its vendor.
