import { projectSignature, motionSignature } from './project.js';
import { clamp, lerp, pointSegment, segmentsTouch, entityRing, normalizeRegion, inRegion } from './geometry.js';
export function distanceSegmentBox(a, b, box) {
    const x = box.x, y = box.y, X = x + box.width, Y = y + box.height;
    const inside = p => p[0] >= x && p[0] <= X && p[1] >= y && p[1] <= Y;
    if (inside(a) || inside(b))
        return 0;
    const corners = [[x, y], [X, y], [X, Y], [x, Y]];
    let d = Infinity;
    for (let i = 0; i < 4; i++) {
        const c = corners[i], e = corners[(i + 1) % 4];
        if (segmentsTouch(a, b, c, e))
            return 0;
        d = Math.min(d, pointSegment(c, a, b).distance, pointSegment(a, c, e).distance, pointSegment(b, c, e).distance);
    }
    return d;
}
/** Continuous vertical cylinder versus box for a LINEAR tip motion. */
export function sweptCylinderBox(a, b, radius, low, high, box, tolerance = 0) {
    let t0 = 0, t1 = 1;
    const dz = b.z - a.z;
    const min = box.bottom - high - tolerance, max = box.top - low + tolerance;
    if (Math.abs(dz) < 1e-12) {
        if (a.z < min || a.z > max)
            return false;
    }
    else {
        let lo = (min - a.z) / dz, hi = (max - a.z) / dz;
        if (lo > hi)
            [lo, hi] = [hi, lo];
        t0 = Math.max(t0, lo);
        t1 = Math.min(t1, hi);
        if (t0 > t1)
            return false;
    }
    const aa = [a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0], bb = [a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1];
    return distanceSegmentBox(aa, bb, box) <= radius + tolerance;
}
export class StockField {
    constructor(stock, cellSize = 1) {
        this.stock = { ...stock };
        this.nx = Math.ceil(stock.width / cellSize);
        this.ny = Math.ceil(stock.height / cellSize);
        this.dx = stock.width / this.nx;
        this.dy = stock.height / this.ny;
        this.heights = new Float32Array(this.nx * this.ny);
        this.revision = 0;
        this.reset();
    }
    reset() { this.heights.fill(this.stock.top); this.removed = 0; this.revision++; }
    get cellArea() { return this.dx * this.dy; }
    /** Exact capsule membership at cell centers; Z is minimized over the interval
     * in which the swept disk covers that center. This avoids time-sampling holes. */
    sweep(a, b, tool, remove = true, tolerance = .001) {
        const radius = tool.diameter / 2, s = this.stock, dx = b.x - a.x, dy = b.y - a.y, ll = dx * dx + dy * dy;
        const minI = clamp(Math.floor((Math.min(a.x, b.x) - radius - s.x) / this.dx), 0, this.nx - 1), maxI = clamp(Math.floor((Math.max(a.x, b.x) + radius - s.x) / this.dx), 0, this.nx - 1);
        const minJ = clamp(Math.floor((Math.min(a.y, b.y) - radius - s.y) / this.dy), 0, this.ny - 1), maxJ = clamp(Math.floor((Math.max(a.y, b.y) + radius - s.y) / this.dy), 0, this.ny - 1);
        let hits = 0, changed = false;
        this.lastMaxDrop = 0;
        for (let j = minJ; j <= maxJ; j++)
            for (let i = minI; i <= maxI; i++) {
                const px = s.x + (i + .5) * this.dx, py = s.y + (j + .5) * this.dy, ux = px - a.x, uy = py - a.y;
                let t0 = 0, t1 = 1;
                if (ll < 1e-14) {
                    if (ux * ux + uy * uy > radius * radius)
                        continue;
                }
                else {
                    const t = (ux * dx + uy * dy) / ll, perp = Math.max(0, ux * ux + uy * uy - t * t * ll), rr = radius * radius - perp;
                    if (rr < 0)
                        continue;
                    const dt = Math.sqrt(rr / ll);
                    t0 = Math.max(0, t - dt);
                    t1 = Math.min(1, t + dt);
                    if (t0 > t1)
                        continue;
                }
                const z = Math.max(s.bottom, Math.min(a.z + (b.z - a.z) * t0, a.z + (b.z - a.z) * t1)), index = j * this.nx + i, old = this.heights[index];
                if (z < old - tolerance) {
                    hits++;
                    this.lastMaxDrop = Math.max(this.lastMaxDrop, old - z);
                    if (remove) {
                        this.heights[index] = z;
                        this.removed += (old - z) * this.cellArea;
                        changed = true;
                    }
                }
            }
        if (changed)
            this.revision++;
        return hits;
    }
    apply(a, b, tool) { if (b.kind !== 'rapid' && b.kind !== 'start')
        this.sweep(a, b, tool, true); }
}
function sweptBoundaryDistance(a, b, rings) {
    const A = [a.x, a.y], B = [b.x, b.y];
    let distance = Infinity;
    for (const ring of rings)
        for (let j = 0; j < ring.length; j++) {
            const C = ring[j], D = ring[(j + 1) % ring.length];
            const overlap = Math.max(A[0], B[0]) >= Math.min(C[0], D[0]) && Math.max(C[0], D[0]) >= Math.min(A[0], B[0]) && Math.max(A[1], B[1]) >= Math.min(C[1], D[1]) && Math.max(C[1], D[1]) >= Math.min(A[1], B[1]);
            if (overlap && segmentsTouch(A, B, C, D))
                return 0;
            distance = Math.min(distance, pointSegment(A, C, D).distance, pointSegment(B, C, D).distance, pointSegment(C, A, B).distance, pointSegment(D, A, B).distance);
        }
    return distance;
}
export function verifyProject(p, result, progress = () => { }) {
    const started = performance.now(), issues = [...result.errors], field = new StockField(p.stock, p.simulation.cellSize), seen = new Set(), moves = result.moves;
    const add = (code, message, i, opId, severity = 'error') => { const k = code + ':' + opId + ':' + message; if (seen.has(k))
        return; seen.add(k); issues.push({ code, message, move: i, opId, severity }); };
    if (result.projectSignature !== projectSignature(p))
        add('STALE_PROJECT', 'Toolpaths were generated for a different project snapshot', 0, null);
    const tools = new Map(p.tools.map(t => [t.id, t])), m = p.machine, tol = p.tolerance, opMap = new Map(p.operations.map(o => [o.id, o])), regions = new Map();
    for (const op of p.operations.filter(o => o.enabled && (o.type === 'pocket' || o.type === 'profile'))) {
        try {
            regions.set(op.id, normalizeRegion(op.geometryIds.map(id => entityRing(p.geometry.find(g => g.id === id), tol)), tol));
        }
        catch { }
    }
    for (let i = 1; i < moves.length; i++) {
        const a = moves[i - 1], b = moves[i], tool = tools.get(b.toolId);
        if (!tool) {
            add('TOOL', 'Unknown tool in motion stream', i, b.opId);
            continue;
        }
        if (![b.x, b.y, b.z, b.feed].every(Number.isFinite) || b.feed <= 0) {
            add('NUMERIC', 'Invalid motion coordinate/feed', i, b.opId);
            continue;
        }
        if (b.x < m.minX || b.x > m.maxX || b.y < m.minY || b.y > m.maxY || b.z < m.minZ || b.z > m.maxZ)
            add('ENVELOPE', 'Tool tip exceeds configured work-coordinate envelope', i, b.opId);
        for (const box of p.fixtures) {
            for (const [part, r, lo, hi] of [['cutter', tool.diameter / 2, 0, tool.fluteLength], ['shank', tool.diameter / 2, tool.fluteLength, tool.stickout], ['holder', tool.holderDiameter / 2, tool.stickout, tool.stickout + tool.holderLength]]) {
                if (sweptCylinderBox(a, b, r, lo, hi, box, tol))
                    add('FIXTURE', `${part} intersects ${box.name}`, i, b.opId);
            }
        }
        const stockBox = { ...p.stock };
        if (sweptCylinderBox(a, b, tool.holderDiameter / 2, tool.stickout, tool.stickout + tool.holderLength, stockBox, tol))
            add('HOLDER_STOCK', 'Holder intersects original stock envelope (conservative)', i, b.opId);
        if (Math.min(a.z, b.z) + tool.fluteLength < p.stock.top - tol && sweptCylinderBox(a, b, tool.diameter / 2, tool.fluteLength, tool.stickout, stockBox, tol))
            add('SHANK_STOCK', 'Shank intersects original stock envelope (conservative)', i, b.opId);
        if (b.kind === 'rapid') {
            if (field.sweep(a, b, tool, false, tol))
                add('RAPID_STOCK', 'Rapid move intersects remaining stock cell centers', i, b.opId);
        }
        else {
            const op = opMap.get(b.opId), region = regions.get(b.opId);
            if (region && op && (op.type === 'pocket' || op.side !== 'center')) {
                const expectedInside = op.type === 'pocket' || op.side === 'inside';
                const inside = inRegion([b.x, b.y], region), distance = sweptBoundaryDistance(a, b, region);
                if (inside !== expectedInside || distance < tool.diameter / 2 + op.allowance - tol)
                    add('BOUNDARY_GOUGE', 'Swept cutter violates the selected boundary / island allowance', i, b.opId);
            }
            field.sweep(a, b, tool, true, tol / 10);
            if (op && op.type !== 'drill' && field.lastMaxDrop > tool.maxStepdown + tol)
                add('AXIAL_ENGAGEMENT', 'Remaining-stock depth removed exceeds the configured tool stepdown limit (cell sampled)', i, b.opId);
        }
        if (i % 1000 === 0)
            progress({ checked: i, total: moves.length });
    }
    issues.push({ severity: 'warning', code: 'MODEL_LIMIT', message: `Stock is a ${field.nx} × ${field.ny} center-sampled heightfield (${field.dx.toFixed(3)} × ${field.dy.toFixed(3)} mm). Features between sample centers are not certified.` });
    issues.push({ severity: 'warning', code: 'MACHINE_LIMIT', message: 'No machine kinematics, control dynamics, toolchanger, spindle run-up, deflection, workholding strength, or fixture assembly beyond entered boxes.' });
    return { projectSignature: projectSignature(p), motionSignature: motionSignature(moves), issues, errors: issues.filter(i => i.severity === 'error').length, warningCount: issues.filter(i => i.severity === 'warning').length, removed: field.removed, heights: field.heights, nx: field.nx, ny: field.ny, dx: field.dx, dy: field.dy, verificationMs: performance.now() - started };
}
