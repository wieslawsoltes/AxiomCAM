import { entityRing, validateRing } from './geometry.js';
export const VERSION = 1;
/** Exact serialized snapshots, not hashes. Equality is deliberately conservative:
 * even a harmless metadata/property-order change requires regeneration. The
 * motion snapshot is O(block count) memory and protects against mutable IR reuse;
 * it is not a cryptographic signature or a security boundary. */
export const projectSignature = project => JSON.stringify(project);
export const motionSignature = moves => JSON.stringify(moves);
export const clone = globalThis.structuredClone || (v => JSON.parse(JSON.stringify(v)));
export const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
export function defaultOperation(type, geometryIds = [], toolId) {
    return { id: uid('op'), name: { face: 'Face stock', pocket: 'Pocket', profile: 'Profile', drill: 'Drill pattern' }[type], type, enabled: true, geometryIds: [...geometryIds], toolId,
        top: 0, depth: type === 'face' ? -.6 : type === 'drill' ? -14 : -7, stepdown: type === 'face' ? .6 : 2, stepover: 45, allowance: 0, clearance: 25, retract: 2,
        rpm: 8000, feed: 900, plunge: 180, peck: 3, side: 'outside', clockwise: true, coolant: true, angle: 0, entry: 'plunge' };
}
export function demoProject() {
    const tools = [
        { id: 't1', number: 1, name: 'Ø20 Face mill', kind: 'flat', diameter: 20, flutes: 3, fluteLength: 12, stickout: 42, holderDiameter: 32, holderLength: 30, centerCutting: true, maxRPM: 12000, maxStepdown: 2, vc: 220, chipload: .045 },
        { id: 't2', number: 2, name: 'Ø6 Flat end mill', kind: 'flat', diameter: 6, flutes: 3, fluteLength: 22, stickout: 38, holderDiameter: 24, holderLength: 30, centerCutting: true, maxRPM: 18000, maxStepdown: 3, vc: 180, chipload: .035 },
        { id: 't3', number: 3, name: 'Ø6 Twist drill', kind: 'drill', diameter: 6, flutes: 2, fluteLength: 32, stickout: 48, holderDiameter: 24, holderLength: 30, centerCutting: true, maxRPM: 10000, maxStepdown: 6, vc: 80, chipload: .025 }
    ];
    const geometry = [
        { id: 'outline', name: '01 · Mounting plate', type: 'polygon', points: [[12, 20], [20, 12], [120, 12], [128, 20], [128, 80], [120, 88], [20, 88], [12, 80]], visible: true },
        { id: 'pocket', name: '02 · Recess boundary', type: 'rect', x: 34, y: 28, width: 72, height: 44, radius: 9, visible: true },
        { id: 'island', name: '03 · Retained boss', type: 'circle', cx: 70, cy: 50, radius: 9, visible: true },
        ...[[23, 23], [117, 23], [117, 77], [23, 77]].map(([x, y], i) => ({ id: `hole${i}`, name: `04 · Hole ${i + 1}`, type: 'circle', cx: x, cy: y, radius: 3, visible: true }))
    ];
    const ops = [defaultOperation('face', [], 't1'), defaultOperation('pocket', ['pocket', 'island'], 't2'), defaultOperation('drill', ['hole0', 'hole1', 'hole2', 'hole3'], 't3'), defaultOperation('profile', ['outline'], 't2')];
    Object.assign(ops[0], { name: '01 · Face top', rpm: 6500, feed: 1200 });
    Object.assign(ops[1], { name: '02 · Pocket + island', depth: -7, stepdown: 2, feed: 850 });
    Object.assign(ops[2], { name: '03 · Drill 4 × Ø6', rpm: 4200, feed: 240, plunge: 240 });
    Object.assign(ops[3], { name: '04 · Outside contour', depth: -12, stepdown: 3, feed: 700 });
    return { schema: 'axiomcam', version: VERSION, name: 'Mounting plate · Rev A', units: 'mm', material: 'Aluminum 6061 — illustrative parameters', tolerance: .02,
        stock: { x: 0, y: 0, width: 140, height: 100, top: 0, bottom: -18 },
        machine: { rapid: 5000, safeZ: 45, maxRPM: 18000, minX: -250, maxX: 250, minY: -250, maxY: 250, minZ: -100, maxZ: 150 },
        fixtures: [{ id: 'f1', name: 'Rear fixture', x: 44, y: 112, width: 52, height: 12, bottom: -18, top: 8 }, { id: 'f2', name: 'Front fixture', x: 44, y: -24, width: 52, height: 12, bottom: -18, top: 8 }],
        tools, geometry, operations: ops, simulation: { cellSize: 1 }, post: { name: 'Generic metric 3-axis / linear', workOffset: 'G54', programNumber: 1001, lengthComp: true } };
}
export function validateProject(p) {
    if (!p || p.schema !== 'axiomcam' || p.version !== VERSION || p.units !== 'mm')
        throw new Error('Unsupported project schema, version, or units.');
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 240 || typeof p.material !== 'string' || p.material.length > 500)
        throw new Error('Invalid project name or material.');
    for (const k of ['geometry', 'operations', 'tools', 'fixtures'])
        if (!Array.isArray(p[k]) || p[k].length > 500)
            throw new Error(`Invalid ${k} collection (maximum 500).`);
    if (!Number.isFinite(p.tolerance) || p.tolerance < .002 || p.tolerance > .5)
        throw new Error('Tolerance must be 0.002–0.5 mm.');
    const number = (v, label, min = -10000, max = 10000) => { if (!Number.isFinite(v) || v < min || v > max)
        throw new Error(`Invalid ${label}.`); };
    const ids = new Set();
    for (const col of ['geometry', 'operations', 'tools', 'fixtures'])
        for (const x of p[col]) {
            if (!x || typeof x.id !== 'string' || !x.id || x.id.length > 200 || ids.has(x.id))
                throw new Error('Duplicate or missing persistent identity.');
            ids.add(x.id);
            if (typeof x.name !== 'string' || x.name.length > 240)
                throw new Error('Invalid entity, operation, tool, or fixture name.');
        }
    const s = p.stock;
    if (!s)
        throw new Error('Missing stock.');
    for (const k of ['x', 'y', 'width', 'height', 'top', 'bottom'])
        number(s[k], `stock ${k}`);
    if (s.width <= 0 || s.height <= 0 || s.top <= s.bottom || s.width > 1000 || s.height > 1000)
        throw new Error('Stock must be positive, with XY extents ≤1000 mm.');
    for (const g of p.geometry) {
        if (g.type === 'point') {
            number(g.x, 'point X');
            number(g.y, 'point Y');
        }
        else
            validateRing(entityRing(g, p.tolerance), p.tolerance);
    }
    for (const f of p.fixtures) {
        for (const k of ['x', 'y', 'width', 'height', 'top', 'bottom'])
            number(f[k], `fixture ${k}`);
        if (f.width <= 0 || f.height <= 0 || f.top <= f.bottom)
            throw new Error('Invalid fixture box.');
    }
    const tn = new Set();
    for (const t of p.tools) {
        for (const k of ['diameter', 'flutes', 'fluteLength', 'stickout', 'holderDiameter', 'holderLength', 'maxRPM', 'maxStepdown'])
            number(t[k], `tool ${k}`, GRID_MIN, 100000);
        if (!Number.isInteger(t.flutes) || t.flutes < 1 || t.flutes > 100 || typeof t.centerCutting !== 'boolean')
            throw new Error('Invalid flute count or center-cutting flag.');
        if (!['flat', 'drill'].includes(t.kind))
            throw new Error('Only flat mills and drills are supported.');
        if (!Number.isInteger(t.number) || t.number < 1 || t.number > 999 || tn.has(t.number))
            throw new Error('Tool numbers must be unique integers 1–999.');
        tn.add(t.number);
        if (t.fluteLength > t.stickout)
            throw new Error('Flute length exceeds tool stickout.');
    }
    for (const op of p.operations) {
        if (!['face', 'pocket', 'profile', 'drill'].includes(op.type) || typeof op.enabled !== 'boolean' || typeof op.toolId !== 'string' || !Array.isArray(op.geometryIds) || op.geometryIds.length > 500 || op.geometryIds.some(id => typeof id !== 'string'))
            throw new Error('Invalid operation schema or contour references.');
        if (op.entry !== 'plunge')
            throw new Error('Only explicit plunge-entry operations are supported.');
    }
    const m = p.machine;
    if (!m)
        throw new Error('Missing machine envelope.');
    for (const k of ['rapid', 'safeZ', 'maxRPM', 'minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'])
        number(m[k], `machine ${k}`, -100000, 100000);
    if (m.rapid <= 0 || m.maxRPM <= 0 || m.minX >= m.maxX || m.minY >= m.maxY || m.minZ >= m.maxZ)
        throw new Error('Invalid machine limits.');
    if (!p.simulation || !Number.isFinite(p.simulation.cellSize) || p.simulation.cellSize < .2 || p.simulation.cellSize > 5)
        throw new Error('Simulation cell size must be 0.2–5 mm.');
    if (Math.ceil(s.width / p.simulation.cellSize) * Math.ceil(s.height / p.simulation.cellSize) > 160000)
        throw new Error('Simulation grid exceeds 160,000 cells.');
    if (!p.post || !/^G5[4-9]$/.test(p.post.workOffset) || !Number.isInteger(p.post.programNumber) || p.post.programNumber < 1 || p.post.programNumber > 9999)
        throw new Error('Invalid postprocessor configuration.');
    return p;
}
const GRID_MIN = .001;
export class History {
    constructor(initial, limit = 80) { this.present = clone(initial); this.past = []; this.future = []; this.limit = limit; this.revision = 0; }
    commit(label, mutate) { const next = clone(this.present); mutate(next); validateProject(next); this.past.push({ state: this.present, label }); if (this.past.length > this.limit)
        this.past.shift(); this.present = next; this.future = []; this.revision++; return next; }
    replace(next) { validateProject(next); this.past.push({ state: this.present, label: 'Open project' }); if (this.past.length > this.limit)
        this.past.shift(); this.present = clone(next); this.future = []; this.revision++; return this.present; }
    undo() { if (!this.past.length)
        return false; const prev = this.past.pop(); this.future.push({ state: this.present, label: prev.label }); this.present = prev.state; this.revision++; return true; }
    redo() { if (!this.future.length)
        return false; const next = this.future.pop(); this.past.push({ state: this.present, label: next.label }); this.present = next.state; this.revision++; return true; }
}
