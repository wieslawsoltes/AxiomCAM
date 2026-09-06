import { entityRing, normalizeRegion, offsetRegion, rasterSegments, nearestLoop, dist, area, bounds } from './geometry.js';
import { validateProject, projectSignature } from './project.js';
export const ENGINE_VERSION = 'AxiomCAM-kernel-1.0';
export function depthPasses(top, depth, stepdown) {
    if (![top, depth, stepdown].every(Number.isFinite) || depth >= top || stepdown <= 0)
        throw new Error('Depth must be below top; stepdown must be positive.');
    const n = Math.ceil((top - depth) / stepdown - 1e-10);
    if (n > 500)
        throw new Error('More than 500 depth passes requested.');
    return Array.from({ length: n }, (_, i) => Math.max(depth, top - stepdown * (i + 1)));
}
export function feedsAndSpeeds(tool, vc = tool.vc, chipload = tool.chipload, machineMax = Infinity) {
    if (!(vc > 0 && chipload > 0 && tool.diameter > 0))
        throw new Error('Surface speed, chip load, and diameter must be positive.');
    const rpm = Math.min(Math.round(1000 * vc / (Math.PI * tool.diameter)), tool.maxRPM, machineMax);
    return { rpm, feed: Math.round(rpm * tool.flutes * chipload), plunge: Math.round(rpm * tool.flutes * chipload * .2) };
}
export function validateOperation(p, op) {
    const tool = p.tools.find(t => t.id === op.toolId);
    if (!tool)
        throw new Error('Select an existing tool.');
    if (!['face', 'pocket', 'profile', 'drill'].includes(op.type))
        throw new Error('Unknown operation type.');
    for (const k of ['top', 'depth', 'stepdown', 'stepover', 'allowance', 'clearance', 'retract', 'rpm', 'feed', 'plunge', 'peck', 'angle'])
        if (!Number.isFinite(op[k]))
            throw new Error(`Invalid ${k}.`);
    if (op.feed <= 0 || op.plunge <= 0 || op.feed > 50000 || op.plunge > 50000)
        throw new Error('Feeds must be 0–50,000 mm/min, excluding zero.');
    if (op.rpm <= 0 || op.rpm > Math.min(tool.maxRPM, p.machine.maxRPM))
        throw new Error('Spindle speed exceeds tool or machine limit.');
    if (op.stepdown > tool.maxStepdown)
        throw new Error(`Stepdown exceeds the configured ${tool.maxStepdown} mm tool limit.`);
    if (op.stepover < 5 || op.stepover > 65)
        throw new Error('Stepover must be 5–65% of cutter diameter.');
    if (op.allowance < 0 || op.allowance > 100)
        throw new Error('Stock allowance must be 0–100 mm.');
    if (op.depth < p.stock.bottom - p.tolerance)
        throw new Error('Tool tip goes below stock bottom. Through-cuts need a modeled sacrificial setup.');
    if (op.top > p.stock.top + p.tolerance || op.top < op.depth)
        throw new Error('Operation top must not exceed stock top or lie below final depth.');
    if (p.stock.top - op.depth > tool.fluteLength)
        throw new Error('Required cutting depth exceeds flute length.');
    if (op.retract <= p.tolerance || op.clearance < Math.max(p.stock.top, ...p.fixtures.map(f => f.top)) + op.retract)
        throw new Error('Clearance must exceed all stock/fixtures by at least the retract amount.');
    if (p.machine.safeZ < op.clearance)
        throw new Error('Tool-change safe Z must be at or above every operation clearance.');
    if (op.type === 'drill' && tool.kind !== 'drill')
        throw new Error('Drilling requires a drill tool.');
    if (op.type !== 'drill' && tool.kind !== 'flat')
        throw new Error('Milling requires a flat end/face mill.');
    if (!tool.centerCutting && op.type !== 'face')
        throw new Error('This plunge-entry strategy requires a center-cutting tool.');
    if (!['inside', 'outside', 'center'].includes(op.side))
        throw new Error('Invalid compensation side.');
    if (op.peck <= 0)
        throw new Error('Peck depth must be positive.');
    if (op.type === 'drill' && op.peck > tool.maxStepdown)
        throw new Error('Peck depth exceeds the configured tool stepdown limit.');
    if (!Array.isArray(op.geometryIds))
        throw new Error('Invalid contour selection.');
    const selected = op.geometryIds.map(id => { const e = p.geometry.find(g => g.id === id); if (!e)
        throw new Error(`Missing selected entity: ${id}`); return e; });
    if (op.type !== 'face' && !selected.length)
        throw new Error('Select at least one contour or drill location.');
    depthPasses(op.top, op.depth, op.stepdown);
    return { tool, selected };
}
function compileOperation(p, op) {
    const { tool, selected } = validateOperation(p, op), tol = p.tolerance, r = tool.diameter / 2;
    const moves = [], warnings = [];
    let first = true;
    const move = (pt, kind = 'cut', feed = op.feed) => {
        if (moves.length >= 200000)
            throw new Error('Operation exceeds 200,000 moves.');
        if (!pt.every(Number.isFinite))
            throw new Error('Nonfinite toolpath coordinate.');
        const last = moves.at(-1);
        if (last && Math.hypot(last.x - pt[0], last.y - pt[1], last.z - pt[2]) < 1e-8)
            return;
        moves.push({ x: pt[0], y: pt[1], z: pt[2], kind, feed: kind === 'rapid' ? p.machine.rapid : feed, opId: op.id, toolId: tool.id, rpm: op.rpm, coolant: op.coolant });
    };
    const cutPath = (path, z) => {
        if (!path.length)
            return;
        const a = path[0];
        if (first) {
            move([a[0], a[1], p.machine.safeZ], 'rapid');
            first = false;
        }
        else {
            const last = moves.at(-1);
            move([last.x, last.y, op.clearance], 'rapid');
        }
        move([a[0], a[1], op.clearance], 'rapid');
        move([a[0], a[1], p.stock.top + op.retract], 'rapid');
        move([a[0], a[1], z], 'plunge', op.plunge);
        for (let i = 1; i < path.length; i++)
            move([path[i][0], path[i][1], z]);
        const last = moves.at(-1);
        move([last.x, last.y, op.clearance], 'rapid');
    };
    const depths = depthPasses(op.top, op.depth, op.stepdown);
    let contourCount = 0;
    if (op.type === 'face') {
        const s = p.stock, spacing = tool.diameter * op.stepover / 100;
        const rows = Math.max(1, Math.ceil(s.height / spacing)), margin = r + 1;
        if (rows > 3000)
            throw new Error('Facing has too many rows.');
        for (const z of depths)
            for (let row = 0; row <= rows; row++) {
                const y = s.y + s.height * row / rows;
                const path = [[s.x - margin, y], [s.x + s.width + margin, y]];
                if (row % 2)
                    path.reverse();
                cutPath(path, z);
            }
        warnings.push('Facing deliberately overtravels stock in X by cutter radius + 1 mm. Fixtures are checked.');
    }
    else if (op.type === 'drill') {
        const centers = selected.map(e => {
            if (e.type === 'point')
                return [e.x, e.y];
            if (e.type === 'circle') {
                if (Math.abs(e.radius * 2 - tool.diameter) > tol)
                    throw new Error(`Hole ${e.name} diameter does not match drill diameter.`);
                return [e.cx, e.cy];
            }
            throw new Error('Drilling accepts circles and point entities only.');
        });
        let remaining = [...centers], from = [p.stock.x, p.stock.y];
        while (remaining.length) {
            remaining.sort((a, b) => dist(a, from) - dist(b, from));
            const c = remaining.shift();
            from = c;
            if (first) {
                move([c[0], c[1], p.machine.safeZ], 'rapid');
                first = false;
            }
            move([c[0], c[1], op.clearance], 'rapid');
            move([c[0], c[1], p.stock.top + op.retract], 'rapid');
            const pecks = depthPasses(op.top, op.depth, op.peck);
            for (let k = 0; k < pecks.length; k++) {
                if (k > 0)
                    move([c[0], c[1], pecks[k - 1] + Math.min(.5, op.retract)], 'plunge', op.plunge);
                move([c[0], c[1], pecks[k]], 'plunge', op.plunge);
                move([c[0], c[1], p.stock.top + op.retract], 'rapid');
            }
            move([c[0], c[1], op.clearance], 'rapid');
        }
        contourCount = centers.length;
        warnings.push('Drill depths are tip depths. Preview uses a flat cylindrical drill; no conical point or breakthrough compensation.');
    }
    else {
        const region = normalizeRegion(selected.map(e => entityRing(e, tol)), tol);
        if (op.type === 'pocket') {
            // The guard exceeds tessellation and offset chord error. It leaves a small,
            // intentional radial skin in addition to the user allowance.
            const allowed = offsetRegion(region, -(r + op.allowance + tol), tol);
            if (!allowed.length)
                throw new Error('Cutter cannot fit in the selected pocket.');
            const raster = rasterSegments(allowed, tool.diameter * op.stepover / 100, op.angle * Math.PI / 180);
            if (!raster.length || raster.length > 15000)
                throw new Error('Pocket raster is empty or exceeds 15,000 traverses.');
            contourCount = allowed.length;
            for (const z of depths) {
                for (const pair of raster)
                    cutPath(pair, z);
                let from = [moves.at(-1).x, moves.at(-1).y];
                for (const loop of allowed) {
                    const path = nearestLoop(loop, from, op.clockwise);
                    cutPath(path, z);
                    from = path.at(-1);
                }
            }
            warnings.push('Pocket: even/odd nested islands; clipped raster plus boundary finish. Independent traverses use full clearance retracts.');
            warnings.push(`Radial tolerance guard ${tol.toFixed(3)} mm is retained in addition to ${op.allowance.toFixed(3)} mm allowance.`);
        }
        else {
            const d = op.side === 'inside' ? -(r + op.allowance + tol) : op.side === 'outside' ? (r + op.allowance + tol) : 0;
            const contours = offsetRegion(region, d, tol);
            if (!contours.length)
                throw new Error('Profile offset collapsed.');
            contourCount = contours.length;
            for (const z of depths)
                for (const loop of contours)
                    cutPath(nearestLoop(loop, [p.stock.x, p.stock.y], op.clockwise), z);
            warnings.push('No holding tabs or lead arcs. The operation uses plunge entry; workholding must retain both part and offcut.');
        }
    }
    if (moves.length) {
        const last = moves.at(-1);
        move([last.x, last.y, p.machine.safeZ], 'rapid');
    }
    return { opId: op.id, moves, warnings, depths, contourCount };
}
/** Per-operation content-addressed cache. Reordering does not reuse linking or verification. */
export function generateProject(project, cache = new Map(), progress = () => { }) {
    validateProject(project);
    const startTime = performance.now(), operations = [], errors = [];
    let all = [{ x: project.stock.x, y: project.stock.y, z: project.machine.safeZ, kind: 'start', feed: project.machine.rapid, opId: null, toolId: null }];
    let cacheHits = 0;
    for (const op of project.operations.filter(o => o.enabled)) {
        progress({ opId: op.id, name: op.name });
        try {
            const signature = JSON.stringify([ENGINE_VERSION, op, project.tolerance, project.stock, project.fixtures, project.machine, project.tools.find(t => t.id === op.toolId), op.geometryIds.map(id => project.geometry.find(g => g.id === id))]);
            let result = cache.get(signature);
            if (result)
                cacheHits++;
            else {
                result = compileOperation(project, op);
                cache.set(signature, result);
            }
            if (cache.size > 200)
                cache.delete(cache.keys().next().value);
            if (all.length + result.moves.length > 300000)
                throw new Error('Project exceeds 300,000 motion blocks.');
            const first = all.length;
            for (const move of result.moves)
                all.push({ ...move });
            operations.push({ ...result, moves: undefined, start: first, end: all.length });
        }
        catch (error) {
            errors.push({ severity: 'error', code: 'GENERATION', opId: op.id, message: `${op.name}: ${error.message}` });
        }
    }
    if (all.length > 300000)
        throw new Error('Project exceeds 300,000 motion blocks.');
    let seconds = 0, cutLength = 0, rapidLength = 0;
    const times = new Float64Array(all.length);
    for (let i = 1; i < all.length; i++) {
        const a = all[i - 1], b = all[i], len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        seconds += len / b.feed * 60;
        times[i] = seconds;
        if (b.kind === 'rapid')
            rapidLength += len;
        else
            cutLength += len;
    }
    return { engine: ENGINE_VERSION, projectSignature: projectSignature(project), moves: all, times, operations, errors, cacheHits, seconds, cutLength, rapidLength, generationMs: performance.now() - startTime };
}
