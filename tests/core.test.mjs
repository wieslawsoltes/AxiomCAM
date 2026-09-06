import test from 'node:test';
import assert from 'node:assert/strict';
import { area, normalizeRegion, offsetRegion, roundedRect, circle, entityRing, validateRing, inRegion, orient } from '../src/geometry.js';
import { demoProject, validateProject, History } from '../src/project.js';
import { depthPasses, generateProject, feedsAndSpeeds } from '../src/cam.js';
import { verifyProject, StockField, sweptCylinderBox } from '../src/simulation.js';
import { postprocess } from '../src/post.js';
const rect = (w = 20, h = 10) => [[0, 0], [w, 0], [w, h], [0, h]];
const close = (a, b, e = .01) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
test('exact orientation on large lattice coordinates', () => assert.equal(orient([9999, 9999], [9999.00001, 9999], [9999, 9999.00001]), 1));
test('reject bow-tie and nonfinite contours', () => { assert.throws(() => validateRing([[0, 0], [20, 10], [0, 10], [20, 0]])); assert.throws(() => validateRing([[NaN, 0], [1, 1], [0, 1]])); });
test('rectangle erosion is analytical', () => { const out = offsetRegion(normalizeRegion([rect()]), -2, .01); assert.equal(out.length, 1); close(Math.abs(area(out[0])), 96); });
test('collapsed erosion is empty', () => assert.equal(offsetRegion(normalizeRegion([rect()]), -6, .01).length, 0));
test('rounded expansion area', () => { const out = offsetRegion(normalizeRegion([rect()]), 2, .01); close(Math.abs(area(out[0])), 200 + 60 * 2 + Math.PI * 4, .08); });
test('circular erosion radius', () => { const r = offsetRegion(normalizeRegion([circle(0, 0, 10, .02)]), -2, .02); close(Math.abs(area(r[0])), Math.PI * 64, .25); });
test('nested islands remain holes', () => { const r = normalizeRegion([rect(50, 50), circle(25, 25, 5, .02)], .02); const o = offsetRegion(r, -3, .02); assert.equal(o.length, 2); assert.equal(inRegion([25, 25], o), false); assert.equal(inRegion([10, 10], o), true); });
test('touching contours fail closed', () => assert.throws(() => normalizeRegion([rect(), [[20, 0], [30, 0], [30, 10], [20, 10]]])));
test('concave notch offset stays valid', () => { const poly = [[0, 0], [30, 0], [30, 20], [20, 20], [20, 10], [10, 10], [10, 20], [0, 20]]; const out = offsetRegion(normalizeRegion([poly]), -2, .02); assert.equal(out.length, 1); validateRing(out[0]); assert.equal(inRegion([15, 15], out), false); });
test('depth passes never overshoot', () => { assert.deepEqual(depthPasses(0, -7, 2), [-2, -4, -6, -7]); assert.throws(() => depthPasses(0, -7, 0)); });
test('feeds derive from capped spindle speed', () => { const t = demoProject().tools[1]; const f = feedsAndSpeeds(t, 180, .035, 5000); assert.equal(f.rpm, 5000); assert.equal(f.feed, 525); });
test('history is transactional and round trips', () => { const h = new History(demoProject()); h.commit('rename', p => p.name = 'B'); assert.equal(h.present.name, 'B'); h.undo(); assert.notEqual(h.present.name, 'B'); h.redo(); assert.equal(h.present.name, 'B'); assert.throws(() => h.commit('invalid', p => p.stock.width = -1)); assert.equal(h.present.stock.width, 140); });
test('continuous fixture collision catches crossing between endpoints', () => { const f = { x: 4, y: -1, width: 2, height: 2, bottom: 0, top: 5 }; assert.equal(sweptCylinderBox({ x: 0, y: 0, z: 1 }, { x: 10, y: 0, z: 1 }, .5, 0, 3, f), true); assert.equal(sweptCylinderBox({ x: 0, y: 0, z: 8 }, { x: 10, y: 0, z: 8 }, .5, 0, 3, f), false); });
test('swept stock cuts continuously and ignores rapids', () => { const stock = { x: 0, y: 0, width: 10, height: 10, top: 0, bottom: -10 }, field = new StockField(stock, 1), tool = { diameter: 2 }; field.sweep({ x: 1, y: 5, z: -2 }, { x: 9, y: 5, z: -2 }, tool); assert.ok(field.removed > 20); const previous = field.removed; field.apply({ x: 1, y: 5, z: -4 }, { x: 9, y: 5, z: -4, kind: 'rapid' }, tool); assert.equal(field.removed, previous); });
test('full demo generation, caching, verification, and NC post', () => {
    const p = demoProject(), cache = new Map(), r = generateProject(p, cache);
    assert.deepEqual(r.errors, []);
    assert.equal(r.operations.length, 4);
    assert.ok(r.moves.length > 200);
    assert.ok(r.seconds > 0);
    const v = verifyProject(p, r);
    assert.equal(v.errors, 0, JSON.stringify(v.issues));
    assert.ok(v.removed > 1000);
    assert.equal(generateProject(p, cache).cacheHits, 4);
    assert.throws(() => postprocess(p, r, v));
    const nc = postprocess(p, r, v, { acknowledged: true });
    assert.ok(nc.includes('G17 G21 G40 G49 G80 G90 G94'));
    assert.ok(nc.includes('G43 H2'));
    assert.ok(nc.endsWith('M30\n%\n'));
    assert.ok(!nc.includes('NaN'));
});
test('fixture collisions block post', () => { const p = demoProject(); p.fixtures.push({ id: 'bad', name: 'Obstruction', x: 50, y: 40, width: 10, height: 10, bottom: -18, top: 10 }); const r = generateProject(p), v = verifyProject(p, r); assert.ok(v.errors > 0); assert.throws(() => postprocess(p, r, v, { acknowledged: true })); });
test('invalid tool diameter mismatch fails drilling', () => { const p = demoProject(); p.tools[2].diameter = 8; assert.ok(generateProject(p).errors.some(e => e.message.includes('diameter'))); });
test('independent geometric verifier catches a corrupted pocket traverse', () => {
    const p = demoProject(), r = generateProject(p), i = r.moves.findIndex(m => m.opId === p.operations[1].id && m.kind === 'cut');
    r.moves[i] = { ...r.moves[i], x: 70, y: 50 };
    const v = verifyProject(p, r);
    assert.ok(v.issues.some(x => x.code === 'BOUNDARY_GOUGE'));
});
test('unsafe starting top is caught by remaining-stock engagement', () => {
    const p = demoProject();
    p.operations = p.operations.filter(o => o.type === 'pocket');
    p.operations[0].top = -5;
    p.operations[0].depth = -7;
    const r = generateProject(p), v = verifyProject(p, r);
    assert.ok(v.issues.some(x => x.code === 'AXIAL_ENGAGEMENT'));
});
test('dumbbell erosion splits a narrow connecting neck', () => {
    const shape = [[0, 0], [20, 0], [20, 8], [30, 8], [30, 0], [50, 0], [50, 20], [30, 20], [30, 12], [20, 12], [20, 20], [0, 20]];
    const out = offsetRegion(normalizeRegion([shape]), -3, .02);
    assert.equal(out.length, 2);
    assert.equal(inRegion([25, 10], out), false);
    assert.equal(inRegion([10, 10], out), true);
    assert.equal(inRegion([40, 10], out), true);
});
test('step count and geometry resource budgets fail explicitly', () => {
    assert.throws(() => depthPasses(0, -100, .01));
    const p = demoProject();
    p.simulation.cellSize = .2;
    assert.throws(() => validateProject(p));
});
test('project JSON round trip preserves stable identities and computed output', () => {
    const p = demoProject(), q = JSON.parse(JSON.stringify(p)), a = generateProject(p), b = generateProject(q);
    validateProject(q);
    assert.deepEqual(a.moves, b.moves);
    assert.equal(a.seconds, b.seconds);
});
test('linear G-code reconstructs every emitted cutting endpoint', () => {
    const p = demoProject(), r = generateProject(p), v = verifyProject(p, r), nc = postprocess(p, r, v, { acknowledged: true });
    const lines = nc.split('\n').filter(l => /^G[01] X/.test(l));
    assert.equal(lines.length, r.moves.length - 1);
    for (let i = 0; i < lines.length; i++) {
        for (const axis of ['x', 'y', 'z']) {
            const value = Number(lines[i].match(new RegExp(axis.toUpperCase() + '(-?[0-9.]+)'))[1]);
            close(value, r.moves[i + 1][axis], .000051);
        }
    }
});
test('changing the project after generation blocks verification and posting', () => {
    const p = demoProject(), r = generateProject(p), v = verifyProject(p, r);
    p.operations[1].depth = -6;
    assert.throws(() => postprocess(p, r, v, { acknowledged: true }), /changed/);
    assert.ok(verifyProject(p, r).issues.some(i => i.code === 'STALE_PROJECT'));
});
test('changing motion coordinates or feeds after verification blocks posting', () => {
    const p = demoProject(), r = generateProject(p), v = verifyProject(p, r);
    r.moves[20].feed += 1;
    assert.throws(() => postprocess(p, r, v, { acknowledged: true }), /changed/);
});
test('public motion edits do not corrupt operation cache entries', () => {
    const p = demoProject(), cache = new Map(), r = generateProject(p, cache), expected = r.moves[10].x;
    r.moves[10].x = 1234;
    assert.equal(generateProject(p, cache).moves[10].x, expected);
});
test('project parser rejects malformed metadata and operation schemas', () => {
    const p = demoProject();
    p.name = {};
    assert.throws(() => validateProject(p));
    p.name = 'A';
    p.operations[0].geometryIds = {};
    assert.throws(() => validateProject(p));
});
test('analytic rectangle erosion remains translation invariant across signed coordinates', () => {
    for (const [x, y, w, h, d] of [[-300, -20, 70, 90, 3], [1234, -800, 5, 12, .4], [-1, -1, 100, 30, 7]]) {
        const r = rect(w, h).map(([a, b]) => [a + x, b + y]), o = offsetRegion(normalizeRegion([r]), -d, .005);
        assert.equal(o.length, 1);
        close(Math.abs(area(o[0])), (w - 2 * d) * (h - 2 * d), .001);
    }
});
test('fixture sweep honors the time interval of vertical overlap', () => {
    const box = { x: 6, y: -1, width: 1, height: 2, bottom: 0, top: 2 };
    assert.equal(sweptCylinderBox({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 20 }, .5, 0, 2, box), false);
    assert.equal(sweptCylinderBox({ x: 0, y: 0, z: 20 }, { x: 10, y: 0, z: -10 }, .5, 0, 2, box), true);
});
test('G-code emits a Z-only safe move before every post-toolchange XY motion', () => {
    const p = demoProject(), r = generateProject(p), v = verifyProject(p, r), lines = postprocess(p, r, v, { acknowledged: true }).split('\n');
    for (let i = 0; i < lines.length; i++)
        if (/T\d+ M6/.test(lines[i])) {
            const move = lines.slice(i + 1).find(l => /^G[01] /.test(l));
            assert.equal(move, `G0 Z${p.machine.safeZ.toFixed(4)}`);
        }
});
test('history bounds imported snapshots as well as edits', () => {
    const p = demoProject(), h = new History(p, 3);
    for (let i = 0; i < 8; i++)
        h.replace({ ...p, name: `P${i}` });
    assert.equal(h.past.length, 3);
});
