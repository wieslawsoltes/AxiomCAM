/** Regenerate the shipped example from the same public APIs used by the worker. */
import { writeFile, mkdir } from 'node:fs/promises';
import { demoProject } from './src/project.js';
import { generateProject } from './src/cam.js';
import { verifyProject } from './src/simulation.js';
import { postprocess, POST_CONTRACT } from './src/post.js';
const root = new URL('examples/', import.meta.url);
await mkdir(root, { recursive: true });
const project = demoProject();
// Stable example identities make subsequent example builds diffable.
project.operations.forEach((operation, index) => operation.id = `demo-operation-${index + 1}`);
const result = generateProject(project), verification = verifyProject(project, result);
if (result.errors.length || verification.errors)
    throw new Error(JSON.stringify(verification.issues));
const report = {
    schema: 'axiomcam-verification', version: 1, engine: result.engine,
    project, postContract: POST_CONTRACT,
    statistics: { motionStates: result.moves.length, emittedMoves: result.moves.length - 1, secondsIdealFeed: result.seconds,
        cutLengthMm: result.cutLength, rapidLengthMm: result.rapidLength, removedVolumeMm3: verification.removed },
    operations: result.operations, issues: verification.issues,
    stockGrid: { nx: verification.nx, ny: verification.ny, dx: verification.dx, dy: verification.dy },
    limits: [
        'Demonstration only. The generic NC post has not been qualified for any machine/controller.',
        'No machine kinematics, toolchanger motion, initial machine position, or control dynamics.',
        'Center-sampled 2.5D stock field; between-cell material and collisions can be missed.',
        'Flat cylindrical cutter and drill preview; no conical drill point or breakthrough compensation.',
        'No tool deflection, cutting force, workholding strength, or thermal prediction.',
        'Offsets use exact lattice predicates but floating constructions; near-degenerate geometry is outside the tested contract.',
        'Ideal feed time excludes acceleration, tool changes, spindle run-up and dwell.',
        'See docs/VERIFICATION.md and docs/POSTPROCESSOR.md before interpreting these results.'
    ]
};
await writeFile(new URL('mounting-plate.axiomcam.json', root), JSON.stringify(project, null, 2) + '\n');
await writeFile(new URL('mounting-plate.verification.json', root), JSON.stringify(report, null, 2) + '\n');
await writeFile(new URL('mounting-plate.nc', root), postprocess(project, result, verification, { acknowledged: true }));
console.log(JSON.stringify(report.statistics, null, 2));
