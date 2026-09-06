import { projectSignature, motionSignature } from './project.js';
/** Explicit generic metric 3-axis linear post. NOT a validated machine post. */
export const POST_CONTRACT = Object.freeze({ axes: ['X', 'Y', 'Z'], units: 'mm', distance: 'absolute', feed: 'mm/min', plane: 'XY', moves: ['G0', 'G1'], arcFitting: false, controllerCompensation: false, toolLength: 'G43 H(tool number)', toolChange: 'Tn M6', spindle: 'M3', coolant: 'M8 / M9', workOffsets: ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'], precision: 4 });
const comment = s => String(s).replace(/[^a-zA-Z0-9 .,:_+\/-]/g, ' ').slice(0, 110);
export function postprocess(project, result, verification, { acknowledged = false } = {}) {
    if (!acknowledged)
        throw new Error('Acknowledge the machine-specific review requirements before exporting.');
    if (result.errors.length || !verification || verification.errors)
        throw new Error('Export blocked: regenerate and resolve all verification errors.');
    if (result.projectSignature !== projectSignature(project) || verification.projectSignature !== result.projectSignature || verification.motionSignature !== motionSignature(result.moves))
        throw new Error('Export blocked: project or motion stream changed after generation/verification.');
    if (result.moves.length < 2)
        throw new Error('No generated toolpaths.');
    const tools = new Map(project.tools.map(t => [t.id, t])), ops = new Map(project.operations.map(o => [o.id, o]));
    const f = x => { if (!Number.isFinite(x))
        throw new Error('Nonfinite output number.'); return (Math.abs(x) < .00005 ? 0 : x).toFixed(4); };
    const lines = ['%', `O${String(project.post.programNumber).padStart(4, '0')}`, `(AXIOMCAM - ${comment(project.name)})`,
        '(GENERIC LINEAR POST - NOT MACHINE VALIDATED)',
        '(VERIFY WORK OFFSET TOOL LENGTHS SAFE RETRACTS AND M6)',
        'G17 G21 G40 G49 G80 G90 G94', project.post.workOffset,
        'G61', 'M0 (REVIEW SETUP AND CONTROLLER COMPATIBILITY)'];
    let activeTool = null, activeOp = null;
    for (const b of result.moves.slice(1)) {
        const tool = tools.get(b.toolId), op = ops.get(b.opId);
        if (!tool || !op)
            throw new Error('Invalid tool or operation reference.');
        if (activeOp !== op.id) {
            lines.push(`(${comment(op.name)} - ${comment(tool.name)})`);
            if (activeTool !== tool.id) {
                lines.push('M5', 'M9', `T${tool.number} M6`);
                if (project.post.lengthComp)
                    lines.push(`G43 H${tool.number}`);
                else
                    lines.push('(NO LENGTH COMPENSATION - TIP-COORDINATE SETUP REQUIRED)');
                // First commanded motion after a tool change is Z only, before XY.
                lines.push(`G0 Z${f(project.machine.safeZ)}`);
                activeTool = tool.id;
            }
            lines.push(`S${Math.round(op.rpm)} M3`, op.coolant ? 'M8' : 'M9');
            activeOp = op.id;
        }
        lines.push(`${b.kind === 'rapid' ? 'G0' : 'G1'} X${f(b.x)} Y${f(b.y)} Z${f(b.z)}${b.kind === 'rapid' ? '' : ` F${f(b.feed)}`}`);
    }
    lines.push(`G0 Z${f(project.machine.safeZ)}`, 'M9', 'M5', 'M30', '%');
    return lines.join('\n') + '\n';
}
