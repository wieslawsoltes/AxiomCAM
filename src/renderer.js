import { entityRing, clamp } from './geometry.js';
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
const rgb = (r, g, b, a = 1) => [r / 255, g / 255, b / 255, a];
const COLORS = { cut: rgb(24, 181, 172, .8), plunge: rgb(119, 109, 224, .7), rapid: rgb(222, 153, 70, .6), sketch: rgb(64, 87, 111), selected: rgb(27, 198, 191), grid: rgb(142, 159, 174, .17), fixture: rgb(64, 76, 92), tool: rgb(80, 201, 175) };
function cubeMesh() {
    const data = [];
    const faces = [[[1, 0, 0], [[.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5], [.5, -.5, .5]]], [[-1, 0, 0], [[-.5, .5, -.5], [-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, .5]]], [[0, 1, 0], [[.5, .5, -.5], [-.5, .5, -.5], [-.5, .5, .5], [.5, .5, .5]]], [[0, -1, 0], [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5]]], [[0, 0, 1], [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]]], [[0, 0, -1], [[-.5, .5, -.5], [.5, .5, -.5], [.5, -.5, -.5], [-.5, -.5, -.5]]]];
    for (const [n, q] of faces)
        for (const i of [0, 1, 2, 0, 2, 3])
            data.push(...q[i], ...n);
    return new Float32Array(data);
}
function cylinderMesh(n = 40) { const d = []; for (let i = 0; i < n; i++) {
    const a = i * 2 * Math.PI / n, b = (i + 1) * 2 * Math.PI / n, na = [Math.cos(a), Math.sin(a), 0], nb = [Math.cos(b), Math.sin(b), 0], p = [na[0] / 2, na[1] / 2, -.5], q = [nb[0] / 2, nb[1] / 2, -.5], P = [...p.slice(0, 2), .5], Q = [...q.slice(0, 2), .5];
    for (const [v, norm] of [[p, na], [q, nb], [Q, nb], [p, na], [Q, nb], [P, na]])
        d.push(...v, ...norm);
    for (const v of [[0, 0, .5], P, Q])
        d.push(...v, 0, 0, 1);
    for (const v of [[0, 0, -.5], q, p])
        d.push(...v, 0, 0, -1);
} return new Float32Array(d); }
const MESH_SHADER = `
struct Camera { vp: mat4x4f };
@group(0) @binding(0) var<uniform> camera: Camera;
struct Out { @builtin(position) position: vec4f, @location(0) normal: vec3f, @location(1) color: vec4f };
@vertex fn vs(@location(0) position:vec3f,@location(1) normal:vec3f,@location(2) center:vec3f,@location(3) size:vec3f,@location(4) color:vec4f)->Out {
 var o:Out; o.position=camera.vp*vec4f(center+position*size,1);o.normal=normal;o.color=color;return o;
}
@fragment fn fs(o:Out)->@location(0) vec4f {
 let light=normalize(vec3f(-0.35,-0.4,0.85));let diffuse=max(0.0,dot(normalize(o.normal),light));
 return vec4f(o.color.rgb*(0.48+0.52*diffuse),o.color.a);
}`;
const LINE_SHADER = `
struct Camera { vp: mat4x4f }; @group(0) @binding(0) var<uniform> camera: Camera;
struct Out { @builtin(position) position:vec4f,@location(0) color:vec4f };
@vertex fn vs(@location(0) position:vec3f,@location(1) color:vec4f)->Out {var o:Out;o.position=camera.vp*vec4f(position,1);o.color=color;return o;}
@fragment fn fs(o:Out)->@location(0) vec4f {return o.color;}`;
export class Renderer {
    constructor(gpuCanvas, fallback, overlay, onStatus = () => { }) {
        this.canvas = gpuCanvas;
        this.fallback = fallback;
        this.overlay = overlay;
        this.onStatus = onStatus;
        this.mode = 'initializing';
        this.dirty = true;
        this.camera = { az: -.95, el: .85, scale: 4, target: [70, 50, -3] };
        this.width = 1;
        this.height = 1;
        this.options = { stock: true, paths: true, rapids: false, geometry: true, fixtures: true, grid: true };
        this.selected = new Set();
        this.toolPosition = null;
        this.buffers = new Map();
        this.lastFieldRevision = -1;
        this.lastProject = null;
        this.lastLineKey = '';
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(overlay.parentElement);
    }
    async init() {
        try {
            if (!navigator.gpu)
                throw new Error('WebGPU unavailable');
            const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
            if (!adapter)
                throw new Error('No WebGPU adapter');
            this.device = await adapter.requestDevice();
            const d = this.device;
            this.context = this.canvas.getContext('webgpu');
            this.format = navigator.gpu.getPreferredCanvasFormat();
            this.context.configure({ device: d, format: this.format, alphaMode: 'opaque' });
            this.uniform = d.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            const bindLayout = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }] });
            const layout = d.createPipelineLayout({ bindGroupLayouts: [bindLayout] });
            this.bind = d.createBindGroup({ layout: bindLayout, entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
            const meshModule = d.createShaderModule({ code: MESH_SHADER }), lineModule = d.createShaderModule({ code: LINE_SHADER });
            for (const module of [meshModule, lineModule]) {
                const info = await module.getCompilationInfo();
                const errors = info.messages.filter(m => m.type === 'error');
                if (errors.length)
                    throw new Error(errors.map(e => e.message).join('\n'));
            }
            const blend = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
            this.meshPipeline = await d.createRenderPipelineAsync({ layout, vertex: { module: meshModule, entryPoint: 'vs', buffers: [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] }, { arrayStride: 40, stepMode: 'instance', attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x3' }, { shaderLocation: 3, offset: 12, format: 'float32x3' }, { shaderLocation: 4, offset: 24, format: 'float32x4' }] }] }, fragment: { module: meshModule, entryPoint: 'fs', targets: [{ format: this.format, blend }] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' } });
            this.linePipeline = await d.createRenderPipelineAsync({ layout, vertex: { module: lineModule, entryPoint: 'vs', buffers: [{ arrayStride: 28, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x4' }] }] }, fragment: { module: lineModule, entryPoint: 'fs', targets: [{ format: this.format, blend }] }, primitive: { topology: 'line-list' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' } });
            this.cube = cubeMesh();
            this.cylinder = cylinderMesh();
            this.upload('cube', this.cube);
            this.upload('cylinder', this.cylinder);
            d.addEventListener('uncapturederror', e => { this.onStatus(`WebGPU validation: ${e.error.message}`); console.error(e.error); });
            d.lost.then(info => { this.mode = 'canvas'; this.canvas.hidden = true; this.fallback.hidden = false; this.onStatus(`GPU lost (${info.reason}); Canvas fallback`); this.dirty = true; });
            this.mode = 'webgpu';
            this.canvas.hidden = false;
            this.fallback.hidden = true;
            this.onStatus('WebGPU · instanced');
        }
        catch (error) {
            this.mode = 'canvas';
            this.canvas.hidden = true;
            this.fallback.hidden = false;
            this.onStatus(`Canvas 2D fallback · ${error.message}`);
        }
        this.resize();
        this.dirty = true;
    }
    resize() {
        const r = this.overlay.parentElement.getBoundingClientRect();
        this.width = Math.max(1, r.width);
        this.height = Math.max(1, r.height);
        this.dpr = Math.min(devicePixelRatio || 1, 2);
        for (const c of [this.canvas, this.fallback, this.overlay]) {
            c.width = Math.floor(this.width * this.dpr);
            c.height = Math.floor(this.height * this.dpr);
        }
        if (this.device) {
            this.depth?.destroy();
            this.depth = this.device.createTexture({ size: [this.canvas.width, this.canvas.height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
        }
        this.dirty = true;
    }
    basis() { const c = this.camera, ca = Math.cos(c.az), sa = Math.sin(c.az), ce = Math.cos(c.el), se = Math.sin(c.el); return { right: [-sa, ca, 0], up: [-se * ca, -se * sa, ce], dir: [ce * ca, ce * sa, se] }; }
    matrix() { const { right: r, up: u, dir: d } = this.basis(), c = this.camera, sx = 2 * c.scale / this.width, sy = 2 * c.scale / this.height, far = 20000; return new Float32Array([r[0] * sx, u[0] * sy, -d[0] / far, 0, r[1] * sx, u[1] * sy, -d[1] / far, 0, r[2] * sx, u[2] * sy, -d[2] / far, 0, -dot(c.target, r) * sx, -dot(c.target, u) * sy, .5 + dot(c.target, d) / far, 1]); }
    project(p) { const { right, up, dir } = this.basis(), c = this.camera, q = p.map((x, i) => x - c.target[i]); return [this.width / 2 + dot(q, right) * c.scale, this.height / 2 - dot(q, up) * c.scale, dot(q, dir)]; }
    unproject(x, y, z = 0) { const c = this.camera, { right: r, up: u } = this.basis(), xx = (x - this.width / 2) / c.scale + dot(c.target, r) - r[2] * z, yy = -(y - this.height / 2) / c.scale + dot(c.target, u) - u[2] * z, den = r[0] * u[1] - r[1] * u[0]; if (Math.abs(den) < 1e-7)
        return null; return [(xx * u[1] - r[1] * yy) / den, (r[0] * yy - xx * u[0]) / den]; }
    setView(name) { if (name === 'top') {
        this.camera.az = -Math.PI / 2;
        this.camera.el = Math.PI / 2;
    }
    else if (name === 'front') {
        this.camera.az = -Math.PI / 2;
        this.camera.el = .05;
    }
    else {
        this.camera.az = -.95;
        this.camera.el = .85;
    } this.dirty = true; }
    fit(project) { const s = project.stock; this.camera.target = [s.x + s.width / 2, s.y + s.height / 2, (s.top + s.bottom) / 2]; this.camera.scale = Math.min(this.width / (s.width * 1.55), this.height / (s.height * 1.7)); this.dirty = true; }
    upload(name, data) { const size = Math.max(4, data.byteLength); let entry = this.buffers.get(name); if (!entry || entry.size < size) {
        entry?.buffer.destroy();
        entry = { buffer: this.device.createBuffer({ size: Math.ceil(size / 256) * 256, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }), size: Math.ceil(size / 256) * 256 };
        this.buffers.set(name, entry);
    } if (data.byteLength)
        this.device.queue.writeBuffer(entry.buffer, 0, data); return entry.buffer; }
    stockColor(z, top, bottom) { const cut = Math.max(0, top - z), t = clamp(cut / 12, 0, 1); return cut < .05 ? rgb(168, 181, 193) : rgb(130 - 26 * t, 180 - 15 * t, 184 + 2 * t); }
    makeInstances(project, field) {
        const a = [], s = project.stock;
        if (this.options.stock)
            for (let j = 0; j < field.ny; j++)
                for (let i = 0; i < field.nx; i++) {
                    const z = field.heights[j * field.nx + i], h = Math.max(.002, z - s.bottom);
                    a.push(s.x + (i + .5) * field.dx, s.y + (j + .5) * field.dy, s.bottom + h / 2, field.dx, field.dy, h, ...this.stockColor(z, s.top, s.bottom));
                }
        if (this.options.fixtures)
            for (const f of project.fixtures)
                a.push(f.x + f.width / 2, f.y + f.height / 2, (f.top + f.bottom) / 2, f.width, f.height, f.top - f.bottom, ...COLORS.fixture);
        return new Float32Array(a);
    }
    makeLines(project, result) {
        const v = [];
        this.lineSegments = [];
        const add = (a, b, color) => { v.push(...a, ...color, ...b, ...color); this.lineSegments.push({ a, b, color }); };
        const s = project.stock;
        if (this.options.grid)
            for (let x = Math.floor((s.x - 50) / 10) * 10; x <= s.x + s.width + 50; x += 10)
                add([x, s.y - 50, s.bottom - .1], [x, s.y + s.height + 50, s.bottom - .1], COLORS.grid);
        if (this.options.grid)
            for (let y = Math.floor((s.y - 50) / 10) * 10; y <= s.y + s.height + 50; y += 10)
                add([s.x - 50, y, s.bottom - .1], [s.x + s.width + 50, y, s.bottom - .1], COLORS.grid);
        this.gridVertexCount = v.length / 7;
        if (this.options.geometry)
            for (const e of project.geometry.filter(g => g.visible !== false)) {
                const color = this.selected.has(e.id) ? COLORS.selected : COLORS.sketch;
                if (e.type === 'point') {
                    for (const a of [0, 1]) {
                        const p = [e.x, e.y, s.top + .2], q = [...p];
                        p[a] -= 1.5;
                        q[a] += 1.5;
                        add(p, q, color);
                    }
                    continue;
                }
                try {
                    const ring = entityRing(e, Math.max(project.tolerance, .05));
                    for (let i = 0; i < ring.length; i++)
                        add([...ring[i], s.top + .15], [...ring[(i + 1) % ring.length], s.top + .15], color);
                }
                catch { }
            }
        if (result && this.options.paths)
            for (let i = 1; i < result.moves.length; i++) {
                const a = result.moves[i - 1], b = result.moves[i];
                if (b.kind === 'rapid' && !this.options.rapids)
                    continue;
                if (this.pathOperation && b.opId !== this.pathOperation)
                    continue;
                add([a.x, a.y, a.z + .05], [b.x, b.y, b.z + .05], COLORS[b.kind] || COLORS.cut);
            }
        return new Float32Array(v);
    }
    update(project, field, result, selected = this.selected) { this.projectData = project; this.field = field; this.result = result; this.selected = selected; this.dirty = true; this.rebuild = true; }
    draw() {
        if (!this.dirty || !this.projectData || !this.field || this.mode === 'initializing')
            return;
        const start = performance.now(), p = this.projectData, field = this.field;
        if (this.mode === 'webgpu')
            this.drawGPU(p, field);
        else
            this.drawCanvas(p, field);
        this.drawOverlay(p);
        this.dirty = false;
        this.rebuild = false;
        this.frameMs = performance.now() - start;
    }
    drawGPU(p, field) {
        const d = this.device;
        if (this.rebuild || this.lastFieldRevision !== field.revision) {
            this.instances = this.makeInstances(p, field);
            this.upload('instances', this.instances);
            this.lastFieldRevision = field.revision;
        }
        if (this.rebuild) {
            this.lines = this.makeLines(p, this.result);
            this.upload('lines', this.lines);
        }
        d.queue.writeBuffer(this.uniform, 0, this.matrix());
        const encoder = d.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), clearValue: { r: .89, g: .915, b: .94, a: 1 }, loadOp: 'clear', storeOp: 'store' }], depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
        pass.setBindGroup(0, this.bind);
        if (this.gridVertexCount) {
            pass.setPipeline(this.linePipeline);
            pass.setVertexBuffer(0, this.buffers.get('lines').buffer);
            pass.draw(this.gridVertexCount);
        }
        pass.setPipeline(this.meshPipeline);
        pass.setVertexBuffer(0, this.buffers.get('cube').buffer);
        pass.setVertexBuffer(1, this.buffers.get('instances').buffer);
        pass.draw(36, this.instances.length / 10);
        if (this.toolPosition) {
            const { tool, pos } = this.toolPosition, parts = [[0, tool.fluteLength, tool.diameter, rgb(41, 171, 155)], [tool.fluteLength, tool.stickout, tool.diameter * .96, rgb(186, 203, 215)], [tool.stickout, tool.stickout + tool.holderLength, tool.holderDiameter, rgb(66, 82, 102)]];
            const td = new Float32Array(parts.flatMap(([a, b, w, color]) => [pos.x, pos.y, pos.z + (a + b) / 2, w, w, b - a, ...color]));
            this.upload('tool', td);
            pass.setVertexBuffer(0, this.buffers.get('cylinder').buffer);
            pass.setVertexBuffer(1, this.buffers.get('tool').buffer);
            pass.draw(this.cylinder.length / 6, 3);
        }
        if (this.lines?.length) {
            pass.setPipeline(this.linePipeline);
            pass.setVertexBuffer(0, this.buffers.get('lines').buffer);
            pass.draw(this.lines.length / 7 - this.gridVertexCount, 1, this.gridVertexCount);
        }
        pass.end();
        d.queue.submit([encoder.finish()]);
    }
    drawCanvas(p, field) {
        const ctx = this.fallback.getContext('2d');
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, this.width, this.height);
        const bg = ctx.createLinearGradient(0, 0, 0, this.height);
        bg.addColorStop(0, '#e9eff4');
        bg.addColorStop(1, '#dbe4ec');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, this.width, this.height);
        if (this.rebuild || !this.lineSegments)
            this.makeLines(p, this.result);
        const drawLine = ({ a, b, color }) => { const aa = this.project(a), bb = this.project(b); ctx.strokeStyle = `rgba(${color.slice(0, 3).map(c => Math.round(c * 255)).join(',')},${color[3]})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(aa[0], aa[1]); ctx.lineTo(bb[0], bb[1]); ctx.stroke(); };
        this.lineSegments.slice(0, this.gridVertexCount / 2).forEach(drawLine);
        const faces = [], s = p.stock, { dir } = this.basis();
        const face = (quad, color, shade = 1) => { const pts = quad.map(v => this.project(v)); faces.push({ pts, depth: pts.reduce((n, v) => n + v[2], 0) / 4, color: `rgb(${color.slice(0, 3).map(x => Math.round(x * 255 * shade)).join(',')})` }); };
        if (this.options.stock)
            for (let j = 0; j < field.ny; j++)
                for (let i = 0; i < field.nx; i++) {
                    const z = field.heights[j * field.nx + i], x = s.x + i * field.dx, y = s.y + j * field.dy, X = x + field.dx, Y = y + field.dy, color = this.stockColor(z, s.top, s.bottom);
                    face([[x, y, z], [X, y, z], [X, Y, z], [x, Y, z]], color, .95);
                    const iz = dir[0] > 0 ? (i === field.nx - 1 ? s.bottom : field.heights[j * field.nx + i + 1]) : (i === 0 ? s.bottom : field.heights[j * field.nx + i - 1]);
                    if (z > iz + .01) {
                        const xx = dir[0] > 0 ? X : x;
                        face([[xx, y, iz], [xx, Y, iz], [xx, Y, z], [xx, y, z]], color, .67);
                    }
                    const jz = dir[1] > 0 ? (j === field.ny - 1 ? s.bottom : field.heights[(j + 1) * field.nx + i]) : (j === 0 ? s.bottom : field.heights[(j - 1) * field.nx + i]);
                    if (z > jz + .01) {
                        const yy = dir[1] > 0 ? Y : y;
                        face([[x, yy, jz], [X, yy, jz], [X, yy, z], [x, yy, z]], color, .78);
                    }
                }
        if (this.options.fixtures)
            for (const f of p.fixtures) {
                const x = f.x, y = f.y, X = x + f.width, Y = y + f.height, z = f.top, b = f.bottom, c = COLORS.fixture;
                face([[x, y, z], [X, y, z], [X, Y, z], [x, Y, z]], c, 1.2);
                const xx = dir[0] > 0 ? X : x, yy = dir[1] > 0 ? Y : y;
                face([[xx, y, b], [xx, Y, b], [xx, Y, z], [xx, y, z]], c, .7);
                face([[x, yy, b], [X, yy, b], [X, yy, z], [x, yy, z]], c, .9);
            }
        faces.sort((a, b) => a.depth - b.depth);
        for (const f of faces) {
            ctx.beginPath();
            f.pts.forEach((v, i) => i ? ctx.lineTo(v[0], v[1]) : ctx.moveTo(v[0], v[1]));
            ctx.closePath();
            ctx.fillStyle = f.color;
            ctx.fill();
            ctx.strokeStyle = f.color;
            ctx.lineWidth = .6;
            ctx.stroke();
        }
        this.lineSegments.slice(this.gridVertexCount / 2).forEach(drawLine);
        if (this.toolPosition) {
            const { tool, pos } = this.toolPosition;
            for (const [lo, hi, r, color] of [[0, tool.fluteLength, tool.diameter / 2, '#1eaa97'], [tool.fluteLength, tool.stickout, tool.diameter / 2, '#a1b4c4'], [tool.stickout, tool.stickout + tool.holderLength, tool.holderDiameter / 2, '#405268']]) {
                const a = this.project([pos.x, pos.y, pos.z + lo]), b = this.project([pos.x, pos.y, pos.z + hi]);
                ctx.strokeStyle = color;
                ctx.lineWidth = Math.max(2, r * this.camera.scale * 2);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(...a.slice(0, 2));
                ctx.lineTo(...b.slice(0, 2));
                ctx.stroke();
            }
            ctx.lineCap = 'butt';
        }
    }
    drawOverlay(p) {
        const ctx = this.overlay.getContext('2d');
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, this.width, this.height);
        ctx.font = '11px ui-monospace, monospace';
        const origin = [58, this.height - 60], { right, up } = this.basis();
        for (const [v, color, label] of [[[1, 0, 0], '#d06866', 'X'], [[0, 1, 0], '#419c85', 'Y'], [[0, 0, 1], '#5f8bc6', 'Z']]) {
            const x = origin[0] + dot(v, right) * 34, y = origin[1] - dot(v, up) * 34;
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(...origin);
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.fillText(label, x + 4, y - 3);
        }
        ctx.fillStyle = '#6e8193';
        ctx.fillText('WCS', 39, this.height - 23);
        if (this.draft?.length) {
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#139e9e';
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            this.draft.forEach((v, i) => { const q = this.project([...v, p.stock.top + .3]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
            ctx.stroke();
            ctx.setLineDash([]);
        }
        if (this.handles)
            for (const h of this.handles) {
                const q = this.project([h.p[0], h.p[1], p.stock.top + .3]);
                ctx.fillStyle = '#fff';
                ctx.strokeStyle = '#00a7a5';
                ctx.lineWidth = 1.5;
                ctx.fillRect(q[0] - 3, q[1] - 3, 6, 6);
                ctx.strokeRect(q[0] - 3, q[1] - 3, 6, 6);
            }
        const s = p.stock, aa = this.project([s.x, s.y - 7, s.bottom]), bb = this.project([s.x + s.width, s.y - 7, s.bottom]);
        ctx.strokeStyle = '#8c9daa';
        ctx.fillStyle = '#62788c';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(aa[0], aa[1]);
        ctx.lineTo(bb[0], bb[1]);
        ctx.stroke();
        ctx.fillText(`${s.width.toFixed(0)} mm`, (aa[0] + bb[0]) / 2 - 17, (aa[1] + bb[1]) / 2 + 15);
    }
    dispose() { this.resizeObserver.disconnect(); for (const b of this.buffers.values())
        b.buffer.destroy(); this.depth?.destroy(); this.uniform?.destroy(); this.device?.destroy(); }
}
