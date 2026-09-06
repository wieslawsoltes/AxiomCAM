# Generic metric 3-axis linear postprocessor

Implementation: `src/post.js`. Public entry point:

```js
postprocess(project, generatedProgram, verification, { acknowledged: true })
```

This is an inspectable, deliberately small postprocessor contract. It is **not a validated Fanuc, Haas, Siemens, LinuxCNC or other machine-specific post**. Familiar code words do not establish compatibility with a controller or its tool-change macros.

## Preconditions and integrity

The program must have generated movements, no generation errors, and a matching zero-error verification result. The caller must explicitly acknowledge the limits. Before output, the post compares exact serialized snapshots of the project and motion array with those bound during generation/verification. Editing geometry, tool dimensions, parameters, output settings, coordinates or feeds invalidates the corresponding snapshot. The UI additionally checks the project revision and rejects stale worker responses.

Snapshots are equality guards rather than cryptographic authentication. Do not accept a fabricated verification object from an untrusted caller. The application does not expose a remote postprocessing API or accept imported verification as authorization.

## Coordinate convention

All coordinates describe the cutter tip in one metric, absolute, Cartesian work-coordinate system. The selected work offset is G54 through G59. The tool remains vertical along Z. Stock top is configurable; the example has top Z=0 and bottom Z=-18.

Cutter radius is accounted for by the CAM kernel before posting. The post emits G40 and no G41/G42. There are no arc fitting, G2/G3, rotary axes, canned drilling cycles, threading, feed-per-revolution, inverse-time feed, or machine-coordinate positioning moves.

The post rounds XYZ and feed words to four decimals. Values whose absolute magnitude is below 0.00005 are printed as zero, avoiding negative zero. Nonfinite values block output. A regression test reconstructs every emitted XYZ endpoint and compares it to the generated stream within 0.000051 mm.

## Output sequence

An abbreviated structural example—not a complete program—is:

```gcode
%
O1001
(AXIOMCAM - project name)
(GENERIC LINEAR POST - NOT MACHINE VALIDATED)
(VERIFY WORK OFFSET TOOL LENGTHS SAFE RETRACTS AND M6)
G17 G21 G40 G49 G80 G90 G94
G54
G61
M0 (REVIEW SETUP AND CONTROLLER COMPATIBILITY)
(operation name - tool name)
M5
M9
T1 M6
G43 H1
G0 Z45.0000
S6500 M3
M8
G0 X-11.0000 Y0.0000 Z45.0000
...
G0 Z45.0000
M9
M5
M30
%
```

The entire generated example is in `examples/mounting-plate.nc`. The ellipsis above is explanatory and is never emitted by the post.

### Preamble

The post explicitly selects the XY plane, millimeters, canceled cutter/length compensation and canned cycles, absolute distances and units-per-minute feed. It selects the configured work coordinate system and requests G61. The initial M0 requires a review stop; its exact behavior and support must be checked for the target control.

The LinuxCNC references describe these code words and modal categories for LinuxCNC. Other controls may differ. The preamble does **not** reset every possible machine state: rotation, scaling, mirroring, local offsets, inherited macros and other controller-specific modes require an adapted post and setup procedure.

### Tool changes

When the tool identity changes, the post emits spindle stop, coolant off, Tn M6, optional G43 Hn, and a **Z-only** rapid to the configured safe Z before any new XY move. Tool number and H index are the same by contract. M6 is not modeled; its control-side motion and any automatic compensation behavior require review.

No G53/G28/G30 home or tool-change position is guessed. Work-coordinate safe Z is not automatically safe in machine coordinates. The initial real tool position and the first post-toolchange Z-only positioning segment are outside the verified motion stream. Do not interpret the explicit Z-first ordering as proof that an arbitrary starting position or tool-change macro is safe.

If length compensation is disabled, the post emits a warning comment and requires an independently established tip-coordinate setup. It does not estimate a real tool length from the preview's stickout dimensions.

### Operation boundaries and movement

Every operation writes a sanitized operation/tool comment, spindle speed with M3 and coolant state M8/M9. Tool changes are not repeated when adjacent operations use the same tool. S is rounded to an integer. Nonrapid feed is emitted explicitly on every G1 block. All endpoint blocks include X, Y and Z, so axes are not omitted based on previous modal positions.

A rapid motion becomes G0; a cut or plunge becomes G1. Drilling is already expanded to peck moves by the compiler. There are no hidden path generators or geometry calculations in this post.

G61 is requested to avoid intentionally allowing a path-blending deviation, but it is not modeled dynamically and is not a universal controller guarantee. G0 interpolation can also differ by control. The compiler keeps XY rapid links at clearance rather than relying on a diagonal move to clear stock.

### End of program

The post emits a final safe-Z rapid, M9, M5, M30 and a closing `%`. It does not insert an end-of-job XY parking position, machine home, pallet change or additional return macro.

Comments are restricted to ASCII letters, digits, selected punctuation and spaces, with a length limit. User names cannot inject newline blocks through comments.

## Qualification required before machine use

Review the target control's supported modal words, G61 meaning, program-number format, line length, M6 sequence, tool table/H mapping, spindle direction, coolant commands, work offset, safe retracts and end-of-program behavior. Model actual clamps and fixtures with an appropriate margin. Validate setup datums and tool lengths independently.

Use a separate machine/control simulator and the site's established dry-run, single-block and prove-out procedures. Confirm that the part and offcut remain constrained; this application does not generate holding tabs or assess clamping strength. The sample's machining parameters are illustrative, not a tooling recommendation.

## Sources

- LinuxCNC G-code reference: https://linuxcnc.org/docs/html/gcode/g-code.html
- LinuxCNC modal overview: https://linuxcnc.org/docs/html/gcode/overview.html
- LinuxCNC quick reference: https://linuxcnc.org/docs/html/gcode.html

These sources document a controller dialect. They are not evidence that this post was tested on that controller.
