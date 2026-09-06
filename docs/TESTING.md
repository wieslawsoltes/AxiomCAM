# Test record and reproducibility

Recorded for the delivered source on 2026-09-06. The results characterize these tests, not arbitrary machining correctness or hardware performance.

## Core tests

Command:

```sh
node --test tests/*.test.mjs
```

**31 tests passed, 0 failed.** The raw TAP output is `tests/core-results.tap`.

Coverage includes exact lattice orientation, invalid/self-touching geometry rejection, analytical rectangular/circular offsets, collapsed offsets, nested islands, concave geometry, split topology, translation invariance, bounded depth planes, capped feed calculations, transactional history, JSON determinism, cache isolation, resource guards, swept stock removal, continuous fixture collision intervals, full demo generation, wrong drill diameter, independent boundary-gouge detection, remaining-stock axial engagement, stale project/motion export blocking, explicit tool-change Z-first ordering and reconstruction of all emitted XYZ NC endpoints.

No external packages are required for the core suite. The recorded Node runtime was v22.16.0.

## Browser integration

Command used in the recorded environment:

```sh
python tests/browser-integration.py --in-memory --chromium /usr/bin/chromium
```

**29 checks passed, 0 unhandled page exceptions.** `tests/browser-results.json` contains the individual checks and renderer mode.

The browser was unable to navigate to a served secure origin under the available environment policy. The harness therefore used `page.set_content` to load the actual built single-file application in memory. The only substituted browser service was a small localStorage implementation for the opaque origin. The real DOM, event handlers, Blob worker, geometry/CAM algorithms, verification, Canvas rendering, file downloads and file import handler ran unchanged.

The integration suite covers initialization and calculated output; a same-event-loop generation/edit race; current-revision regeneration; operation parameter edits; undo/redo; geometry-property edits; two-click rectangle creation; geometry deletion; operation ordering; tool-diameter edits; a fixture placed into a toolpath; post blocking and recovery; stock reset, animated playback and backward seek; final stock volume; explicit export acknowledgement; NC preview and actual NC download; project download; persistence contents; actual project-file import; restoration with identity preservation; and absence of unhandled browser exceptions.

Restoration checks both the regenerated path count and the complete editable project, including its saved identities and imported name. It does not merely compare a restored page with an identical default demo.

To test the normal served distribution:

```sh
python -m pip install playwright
python -m playwright install chromium
npm start
# Separate terminal:
python tests/browser-integration.py --url http://localhost:8080
```

Use `--chromium /path/to/browser` for an existing installation. The harness enables headless software graphics where available; this is not a hardware GPU benchmark.

## Native WebGPU status

**Not runtime-validated in the recorded environment.** The successful UI tests used the explicitly labeled Canvas fallback. Neither successful hardware shader/pipeline execution nor a frame-rate/throughput claim is implied by those tests.

To validate on a WebGPU-capable workstation, serve the app through localhost/HTTPS, confirm `WebGPU · instanced` in the status bar, inspect the developer console for shader/pipeline/uncaptured errors, and repeat orbit, resize, path visibility, stock playback and device-loss scenarios. Compare the computed CPU results across renderers; they should be identical because the renderer does not generate machining paths. Record adapter/browser/driver versions and GPU timings separately before making performance claims.

## Computed reference project

`npm run examples` regenerates the project, report and generic NC in `examples/`. It uses stable example operation IDs and aborts if any modeled error is present. Current reference values are:

```text
4 operations
2,123 motion states, including the initial anchor
2,122 emitted XYZ endpoint moves
990.4520193760031 seconds ideal travel time
9,156.676751031688 mm nonrapid travel
8,996.410486080455 mm rapid travel
54,399.999874593996 mm³ sampled removed volume
140 × 100 stock grid, 1 × 1 mm cells
0 modeled errors, 2 global model-limit warnings
```

Wall-clock generation/verification timings are intentionally not fixed in the example report. Small floating-point differences across runtimes should be interpreted within the documented numerical model, not as new physical accuracy evidence.

## Not tested or certified

There has been no physical machining, target-controller execution, qualified machine-post validation, full-machine collision model, exhaustive/randomized geometry campaign, independent exact-solid comparison, formal proof, security audit, accessibility audit or hardware WebGPU benchmark. Boundary-condition tests are useful regression evidence but do not eliminate all possible offset/verification defects.

Application dependencies are zero at runtime. Playwright and its browser are optional test tools and are not shipped inside the source archive.
