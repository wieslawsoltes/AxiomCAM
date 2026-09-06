/** AxiomCAM bounded planar geometry kernel. Units: mm; topology lattice: 1e-5 mm.
 * Predicates on lattice coordinates are exact (BigInt). Constructed intersections
 * and joins are rounded to the lattice. See docs/VERIFICATION.md for the contract.
 */
export const SCALE = 100000;
export const GRID = 1 / SCALE;
export const MAX_COORD = 10000;
export const EPS = 1e-8;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const quantize = x => Math.round(x * SCALE) / SCALE;
export const point = (x, y) => [quantize(x), quantize(y)];
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
export const key = p => `${Math.round(p[0] * SCALE)},${Math.round(p[1] * SCALE)}`;
export const area = p => p.reduce((a, v, i) => a + cross(v, p[(i + 1) % p.length]), 0) / 2;
export function orient(a, b, c) {
    const ax = BigInt(Math.round(a[0] * SCALE)), ay = BigInt(Math.round(a[1] * SCALE));
    const bx = BigInt(Math.round(b[0] * SCALE)), by = BigInt(Math.round(b[1] * SCALE));
    const cx = BigInt(Math.round(c[0] * SCALE)), cy = BigInt(Math.round(c[1] * SCALE));
    const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    return d < 0n ? -1 : d > 0n ? 1 : 0;
}
export function bounds(paths) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of paths)
        for (const [x, y] of p) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
export function pointSegment(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], ll = dx * dx + dy * dy;
    const t = ll ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ll, 0, 1) : 0;
    return { distance: Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy), t };
}
export function contains(p, ring) {
    let yes = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0])
            yes = !yes;
    }
    return yes;
}
export function inRegion(p, rings) { let yes = false; for (const r of rings)
    if (contains(p, r))
        yes = !yes; return yes; }
export function boundaryDistance(p, rings) {
    let d = Infinity;
    for (const r of rings)
        for (let i = 0; i < r.length; i++)
            d = Math.min(d, pointSegment(p, r[i], r[(i + 1) % r.length]).distance);
    return d;
}
export function signedDistance(p, rings) { const d = boundaryDistance(p, rings); return inRegion(p, rings) ? -d : d; }
export function cleanRing(raw) {
    let out = [];
    for (const p of raw) {
        const q = point(p[0], p[1]);
        if (!out.length || key(q) !== key(out.at(-1)))
            out.push(q);
    }
    if (out.length > 1 && key(out[0]) === key(out.at(-1)))
        out.pop();
    let changed = true;
    while (changed && out.length > 3) {
        changed = false;
        out = out.filter((p, i) => {
            const a = out[(i + out.length - 1) % out.length], b = out[(i + 1) % out.length];
            if (orient(a, p, b) === 0 && pointSegment(p, a, b).distance < GRID) {
                changed = true;
                return false;
            }
            return true;
        });
    }
    return out;
}
function onSegment(p, a, b) { return orient(a, b, p) === 0 && p[0] >= Math.min(a[0], b[0]) - GRID / 2 && p[0] <= Math.max(a[0], b[0]) + GRID / 2 && p[1] >= Math.min(a[1], b[1]) - GRID / 2 && p[1] <= Math.max(a[1], b[1]) + GRID / 2; }
export function segmentsTouch(a, b, c, d) {
    const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
    return (o1 * o2 < 0 && o3 * o4 < 0) || (!o1 && onSegment(c, a, b)) || (!o2 && onSegment(d, a, b)) || (!o3 && onSegment(a, c, d)) || (!o4 && onSegment(b, c, d));
}
export function validateRing(raw, tolerance = .01) {
    if (!Array.isArray(raw) || raw.length < 3 || raw.length > 2000)
        throw new Error('A contour needs 3–2000 vertices.');
    for (const p of raw)
        if (!Array.isArray(p) || p.length !== 2 || p.some(v => !Number.isFinite(v) || Math.abs(v) > MAX_COORD))
            throw new Error('Coordinates must be finite and within ±10,000 mm.');
    const r = cleanRing(raw);
    if (r.length < 3 || Math.abs(area(r)) < tolerance * tolerance * 4)
        throw new Error('Degenerate contour: area is below the geometric tolerance.');
    for (let i = 0; i < r.length; i++) {
        if (dist(r[i], r[(i + 1) % r.length]) < GRID * 2)
            throw new Error('A contour has a zero-length edge.');
        for (let j = i + 1; j < r.length; j++) {
            if (j === i + 1 || (i === 0 && j === r.length - 1))
                continue;
            if (segmentsTouch(r[i], r[(i + 1) % r.length], r[j], r[(j + 1) % r.length]))
                throw new Error('Self-intersecting or self-touching contour.');
        }
    }
    return r;
}
export function normalizeRegion(raw, tolerance = .01) {
    const rings = raw.map(r => validateRing(r, tolerance));
    for (let i = 0; i < rings.length; i++)
        for (let j = i + 1; j < rings.length; j++) {
            const a = rings[i], b = rings[j];
            for (let k = 0; k < a.length; k++)
                for (let l = 0; l < b.length; l++) {
                    if (segmentsTouch(a[k], a[(k + 1) % a.length], b[l], b[(l + 1) % b.length]))
                        throw new Error('Selected contours cross or touch. Nested islands must be separate.');
                }
            if (Math.min(...a.map(p => boundaryDistance(p, [b])), ...b.map(p => boundaryDistance(p, [a]))) < tolerance * 4)
                throw new Error('Contour separation is below 4× tolerance.');
        }
    return rings.map((r, i) => {
        const depth = rings.reduce((n, other, j) => n + (i !== j && contains(r[0], other) ? 1 : 0), 0);
        return (area(r) > 0) === (depth % 2 === 0) ? r : r.slice().reverse();
    });
}
export function circle(cx, cy, r, tolerance = .01) {
    if (!Number.isFinite(r) || r <= 0)
        throw new Error('Radius must be positive.');
    const angle = 2 * Math.acos(clamp(1 - tolerance / (4 * r), -1, 1));
    const n = Math.max(24, Math.ceil(2 * Math.PI / angle));
    if (n > 2000)
        throw new Error('Circle needs more than 2000 segments at this tolerance.');
    return Array.from({ length: n }, (_, i) => point(cx + r * Math.cos(i * 2 * Math.PI / n), cy + r * Math.sin(i * 2 * Math.PI / n)));
}
export function roundedRect(x, y, w, h, r = 0, tolerance = .01) {
    if (w <= 0 || h <= 0 || r < 0 || r > Math.min(w, h) / 2)
        throw new Error('Invalid rectangle size or corner radius.');
    if (r < GRID)
        return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(p => point(...p));
    const n = Math.max(2, Math.ceil((Math.PI / 2) / (2 * Math.acos(clamp(1 - tolerance / (4 * r), -1, 1)))));
    if (4 * (n + 1) > 2000)
        throw new Error('Rounded rectangle needs more than 2000 segments at this tolerance.');
    const out = [];
    for (const [cx, cy, start] of [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]])
        for (let i = 0; i <= n; i++) {
            const a = start + i * Math.PI / 2 / n;
            out.push(point(cx + r * Math.cos(a), cy + r * Math.sin(a)));
        }
    return cleanRing(out);
}
export function entityRing(entity, tolerance = .01) {
    if (entity.type === 'circle')
        return circle(entity.cx, entity.cy, entity.radius, tolerance);
    if (entity.type === 'rect')
        return roundedRect(entity.x, entity.y, entity.width, entity.height, entity.radius || 0, tolerance);
    if (entity.type === 'polygon')
        return cleanRing(entity.points);
    throw new Error('Points are drilling locations, not closed contours.');
}
// Raw parallel boundary. Convex expansion joins are chord-bounded round joins.
function rawOffset(r, d, tolerance) {
    const out = [];
    for (let i = 0; i < r.length; i++) {
        const prev = r[(i + r.length - 1) % r.length], v = r[i], next = r[(i + 1) % r.length];
        const u = sub(v, prev), w = sub(next, v), ul = Math.hypot(...u), wl = Math.hypot(...w);
        const n1 = [u[1] / ul, -u[0] / ul], n2 = [w[1] / wl, -w[0] / wl];
        const a = [v[0] + d * n1[0], v[1] + d * n1[1]], b = [v[0] + d * n2[0], v[1] + d * n2[1]];
        const turn = cross(u, w), den = cross(u, w);
        if (turn * d > EPS) {
            const aa = Math.atan2(a[1] - v[1], a[0] - v[0]);
            let ab = Math.atan2(b[1] - v[1], b[0] - v[0]);
            let sweep = ab - aa;
            if (turn > 0) {
                while (sweep < 0)
                    sweep += 2 * Math.PI;
            }
            else {
                while (sweep > 0)
                    sweep -= 2 * Math.PI;
            }
            const step = 2 * Math.acos(clamp(1 - tolerance / (4 * Math.abs(d)), -1, 1));
            const count = Math.max(1, Math.ceil(Math.abs(sweep) / step));
            for (let k = 0; k <= count; k++) {
                const angle = aa + sweep * k / count;
                out.push(point(v[0] + Math.abs(d) * Math.cos(angle), v[1] + Math.abs(d) * Math.sin(angle)));
            }
        }
        else if (Math.abs(den) > EPS) {
            const t = cross(sub(b, a), w) / den;
            // Unbounded near-parallel joins are rejected rather than emitted.
            if (Math.abs(t) * ul > MAX_COORD * 2)
                throw new Error('Unstable offset join. Remove near-collinear spikes.');
            out.push(point(a[0] + u[0] * t, a[1] + u[1] * t));
        }
        else
            out.push(point(...a));
    }
    return cleanRing(out);
}
function boxesOverlap(a, b, c, d) { return Math.max(a[0], b[0]) + GRID >= Math.min(c[0], d[0]) && Math.max(c[0], d[0]) + GRID >= Math.min(a[0], b[0]) && Math.max(a[1], b[1]) + GRID >= Math.min(c[1], d[1]) && Math.max(c[1], d[1]) + GRID >= Math.min(a[1], b[1]); }
/** Morphological offset of an even/odd region. Positive expands; negative erodes.
 * Resolves self-crossing raw offsets by splitting a planar arrangement, classifying
 * against signed distance, and stitching oriented boundaries. Ambiguous junctions
 * fail closed. Features narrower than 4*tolerance are outside this kernel contract.
 */
export function offsetRegion(rings, delta, tolerance = .01) {
    if (!Number.isFinite(delta) || Math.abs(delta) > MAX_COORD)
        throw new Error('Offset is out of range.');
    if (Math.abs(delta) < GRID)
        return rings.map(r => r.map(p => p.slice()));
    const raw = rings.map(r => rawOffset(r, delta, tolerance)).filter(r => r.length >= 3);
    const edges = [];
    for (const r of raw)
        for (let i = 0; i < r.length; i++) {
            const a = r[i], b = r[(i + 1) % r.length];
            if (dist(a, b) > GRID)
                edges.push({ a, b, splits: [{ t: 0, p: a }, { t: 1, p: b }] });
        }
    if (edges.length > 12000)
        throw new Error('Offset complexity exceeds 12,000 edges. Increase tolerance.');
    for (let i = 0; i < edges.length; i++)
        for (let j = i + 1; j < edges.length; j++) {
            const e = edges[i], f = edges[j];
            if (!boxesOverlap(e.a, e.b, f.a, f.b))
                continue;
            const u = sub(e.b, e.a), v = sub(f.b, f.a);
            const toInt = p => p.map(x => BigInt(Math.round(x * SCALE))), ea = toInt(e.a), eb = toInt(e.b), fa = toInt(f.a), fb = toInt(f.b);
            const U = [eb[0] - ea[0], eb[1] - ea[1]], V = [fb[0] - fa[0], fb[1] - fa[1]], W = [fa[0] - ea[0], fa[1] - ea[1]], det = (a, b) => a[0] * b[1] - a[1] * b[0];
            const den = det(U, V), nt = det(W, V), ns = det(W, U);
            if (den !== 0n) {
                const between = n => den > 0n ? n >= 0n && n <= den : n <= 0n && n >= den;
                if (between(nt) && between(ns)) {
                    const t = Number(nt) / Number(den), s = Number(ns) / Number(den), p = point(e.a[0] + t * u[0], e.a[1] + t * u[1]);
                    e.splits.push({ t, p });
                    f.splits.push({ t: s, p });
                }
            }
            else {
                for (const p of [f.a, f.b])
                    if (onSegment(p, e.a, e.b))
                        e.splits.push({ t: pointSegment(p, e.a, e.b).t, p });
                for (const p of [e.a, e.b])
                    if (onSegment(p, f.a, f.b))
                        f.splits.push({ t: pointSegment(p, f.a, f.b).t, p });
            }
        }
    const segments = new Map(), probe = Math.max(tolerance * .6, GRID * 4);
    for (const e of edges) {
        e.splits.sort((a, b) => a.t - b.t);
        for (let i = 1; i < e.splits.length; i++) {
            let a = e.splits[i - 1].p, b = e.splits[i].p;
            const len = dist(a, b);
            if (len < GRID * 1.5)
                continue;
            const mid = lerp(a, b, .5), n = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
            const left = signedDistance([mid[0] + n[0] * probe, mid[1] + n[1] * probe], rings) < delta;
            const right = signedDistance([mid[0] - n[0] * probe, mid[1] - n[1] * probe], rings) < delta;
            if (left === right)
                continue;
            if (!left)
                [a, b] = [b, a];
            const k = key(a) + '>' + key(b);
            segments.set(k, { a, b, used: false });
        }
    }
    const outgoing = new Map();
    for (const e of segments.values()) {
        const k = key(e.a);
        if (!outgoing.has(k))
            outgoing.set(k, []);
        outgoing.get(k).push(e);
    }
    const loops = [];
    for (const start of segments.values()) {
        if (start.used)
            continue;
        let e = start, loop = [], closed = false;
        for (let count = 0; count <= segments.size; count++) {
            if (e.used)
                break;
            e.used = true;
            loop.push(e.a);
            if (key(e.b) === key(start.a)) {
                closed = true;
                break;
            }
            const next = (outgoing.get(key(e.b)) || []).filter(n => !n.used);
            if (next.length !== 1)
                throw new Error('Offset topology is ambiguous at this tolerance. Adjust geometry, cutter size, or tolerance.');
            e = next[0];
        }
        if (!closed)
            throw new Error('Offset produced an open boundary; toolpath generation stopped.');
        loop = cleanRing(loop);
        if (loop.length >= 3 && Math.abs(area(loop)) > tolerance * tolerance * 4)
            loops.push(loop);
    }
    return loops;
}
export function nearestLoop(loop, from, clockwise = false) {
    let ring = (area(loop) < 0) === clockwise ? loop.slice() : loop.slice().reverse();
    let best = 0, dd = Infinity;
    for (let i = 0; i < ring.length; i++) {
        const d = dist(from, ring[i]);
        if (d < dd) {
            dd = d;
            best = i;
        }
    }
    ring = [...ring.slice(best), ...ring.slice(0, best)];
    return [...ring, ring[0]];
}
export function rasterSegments(rings, step, angle = 0) {
    if (!(step > 0))
        throw new Error('Raster spacing must be positive.');
    const ca = Math.cos(angle), sa = Math.sin(angle), rotate = p => [p[0] * ca + p[1] * sa, -p[0] * sa + p[1] * ca], unrotate = p => [p[0] * ca - p[1] * sa, p[0] * sa + p[1] * ca];
    const rr = rings.map(r => r.map(rotate)), bb = bounds(rr), out = [];
    const n = Math.max(1, Math.ceil(bb.height / step));
    if (n > 15000)
        throw new Error('Pocket raster exceeds 15,000 rows. Increase stepover or cutter size.');
    for (let row = 0; row <= n; row++) {
        const y = bb.minY + Math.min(bb.height - 1e-7, Math.max(1e-7, row * bb.height / n));
        const xs = [];
        for (const r of rr)
            for (let i = 0; i < r.length; i++) {
                const a = r[i], b = r[(i + 1) % r.length];
                if ((a[1] > y) !== (b[1] > y))
                    xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
            }
        xs.sort((a, b) => a - b);
        const pairs = [];
        for (let j = 0; j + 1 < xs.length; j += 2)
            if (xs[j + 1] - xs[j] > GRID)
                pairs.push([unrotate([xs[j], y]), unrotate([xs[j + 1], y])]);
        if (row % 2)
            pairs.reverse().forEach(p => p.reverse());
        out.push(...pairs);
    }
    return out;
}
