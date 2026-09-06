import { demoProject, defaultOperation, validateProject, History, uid, clone, projectSignature } from './project.js';
import { entityRing, roundedRect, circle, contains, pointSegment, bounds, dist, clamp, lerp } from './geometry.js';
import { feedsAndSpeeds } from './cam.js';
import { StockField } from './simulation.js';
import { postprocess, POST_CONTRACT } from './post.js';
import { Renderer } from './renderer.js';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (n, d = 2) => Number.isFinite(n) ? n.toFixed(d) : '—';
const timeFormat = s => { if (!Number.isFinite(s))
    return '—'; const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const symbols = { face: '▱', pocket: '▣', profile: '◇', drill: '⦿' };
const typeNames = { face: 'Facing', pocket: 'Pocketing', profile: 'Profiling', drill: 'Peck drilling' };
const SAVE_KEY = 'axiomcam.project.v1';
let initial = demoProject();
let restoreError = '';
try {
    const text = localStorage.getItem(SAVE_KEY);
    if (text)
        initial = validateProject(JSON.parse(text));
}
catch (e) {
    restoreError = e.name === 'SecurityError' ? 'Browser storage is unavailable. Export your project to keep a copy.' : `Saved project was not loaded: ${e.message}`;
}
const history = new History(initial);
let selectedOp = initial.operations[1]?.id || initial.operations[0]?.id || null;
let selected = new Set(initial.operations.find(o => o.id === selectedOp)?.geometryIds || []), inspectorMode = 'operation';
let ribbonTab = 'toolpaths', bottomTab = 'simulation', mode = 'select', drawPoints = [], hoverWorld = null;
let result = null, verification = null, generatedRevision = -1, busy = false, requestId = 0, worker = null, regenTimer = 0, autoRegenerate = true;
let field = new StockField(initial.stock, initial.simulation.cellSize), playing = false, simTime = 0, cursor = 0, speed = 50, lastFrame = 0;
let toastTimer, drag = null, transientProject = null, contextPoint = null;
const getProject = () => history.present;
const renderer = new Renderer($('#gpu-canvas'), $('#fallback-canvas'), $('#overlay-canvas'), status => { $('#engine-status').textContent = status; });
const icons = {
    select: 'M5 3v17l4-5 5 5 3-3-5-5 6-3z', rect: 'M3 6h22v16H3z M7 3v6 M0 10h6', circle: 'M25 14a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M15 1v5 M15 22v5 M2 14h5 M23 14h5', polygon: 'm4 21 3-15 15-2 5 16-12 6z M4 21h1 M7 6h1 M22 4h1', point: 'M15 2v24 M3 14h24 M19 14a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    face: 'm2 20 12-7 13 7-12 7z M4 17l10-6 11 6 M5 13l9-6 9 6 M12 2h5v9h-5z', pocket: 'm2 11 12-7 13 7v11l-13 7-12-7z M2 11l12 7 13-7 M8 13v7l6 3 7-4v-6 M14 18v5', profile: 'm3 10 11-7 12 7v12l-12 7-11-7z M8 10l6-4 7 4 M26 10l-12 7-11-7 M14 17v12', drill: 'M12 1h6v13l-3 4-3-4z M12 6h6 M12 10h6 M3 20l12-7 12 7-12 7z M21 22h1 M8 22h1',
    generate: 'M24 12A10 10 0 1 0 25 18 M24 4v8h-8', verify: 'M15 2 26 6v9c0 5-6 9-11 12C10 24 4 20 4 15V6z M9 14l4 4 8-9', play: 'M9 3v22l17-11z', stock: 'm3 9 12-7 12 7v14l-12 7-12-7z M3 9l12 7 12-7 M15 16v14', tool: 'M12 2h7v14l-3.5 6-3.5-6z M12 7h7 M12 11h7 M12 15h7 M5 24h21', fixture: 'm2 19 9-5 16 5-9 6z M8 17V8l8-4 6 3v11 M8 8l7 4 7-5 M15 12v9', post: 'M6 2h13l6 6v19H6z M19 2v7h6 M10 14h11 M10 18h8 M10 22h10', save: 'M4 3h20l3 3v21H4z M9 3v8h12V3 M9 18h13v9', open: 'M2 7h10l3 4h13l-4 15H3z M3 7V3h8l4 4h10v4', undo: 'M11 4 3 11l8 7 M3 11h12c10 0 12 13 2 14', redo: 'M19 4 8 11l11 7 M8 11h9', fit: 'M3 11V3h8 M19 3h8v8 M27 19v8h-8 M11 27H3v-8 M10 10h10v10H10z', iso: 'm3 9 12-7 12 7v14l-12 7-12-7z M3 9l12 7 12-7 M15 16v14', top: 'M4 4h22v22H4z M9 9h12v12H9z', measure: 'm3 21 19-19 7 7-19 19z M9 15l4 4 M14 10l4 4 M19 5l4 4', transform: 'M6 8h13v13H6z M16 3h11v11 M23 7 12 18 M3 25h19', delete: 'M7 7h16l-2 20H9z M4 7h22 M12 3h6 M12 11v11 M18 11v11', report: 'M6 2h16l4 5v22H6z M10 12h12 M10 16h9 M10 20h12 M10 24h7', grid: 'M3 3h24v24H3z M11 3v24 M19 3v24 M3 11h24 M3 19h24', paths: 'M2 24h24V4H6v16h16V8H10v8h8 M2 20v4h4', new: 'M7 2h14l6 6v19H7z M21 2v7h6 M12 17h10 M17 12v10', help: 'M15 21h.1 M11 10c0-7 12-7 10 1-1 3-6 3-6 7 M28 15a13 13 0 1 1-26 0 13 13 0 0 1 26 0'
};
function icon(name) { return `<svg viewBox="0 0 30 32" aria-hidden="true"><path d="${icons[name] || icons.help}"/></svg>`; }
function ribbonButton(action, name, label, cls = '') { return `<button class="ribbon-button ${cls}" data-action="${action}" title="${escapeHTML(label)}">${icon(name)}<span>${label}</span></button>`; }
function group(label, content) { return `<div class="ribbon-group">${content}<small>${label}</small></div>`; }
function renderRibbon() {
    let content = '';
    if (ribbonTab === 'toolpaths')
        content = group('2.5D milling', ribbonButton('add-face', 'face', 'Face') + ribbonButton('add-profile', 'profile', 'Contour') + ribbonButton('add-pocket', 'pocket', 'Pocket', 'accent') + ribbonButton('add-drill', 'drill', 'Drill')) +
            group('Toolpath control', ribbonButton('generate', 'generate', 'Regenerate', 'primary') + ribbonButton('verify', 'verify', 'Verify') + ribbonButton('play', 'play', 'Backplot')) +
            group('Machine setup', ribbonButton('setup', 'stock', 'Stock setup') + ribbonButton('tools', 'tool', 'Tool library') + ribbonButton('fixtures', 'fixture', 'Fixtures')) +
            group('NC output', ribbonButton('post', 'post', 'Post code', 'accent') + ribbonButton('report', 'report', 'Report')) +
            group('Display', ribbonButton('fit', 'fit', 'Fit model') + `<div class="ribbon-small"><button data-action="top"><span>▧</span>Top / sketch</button><button data-action="iso"><span>◇</span>Isometric</button></div>`);
    else if (ribbonTab === 'wireframe')
        content = group('Selection', ribbonButton('select', 'select', 'Select', mode === 'select' ? 'active' : '') + ribbonButton('clear-selection', 'select', 'Clear')) +
            group('Create geometry', ribbonButton('draw-rect', 'rect', 'Rectangle', mode === 'rect' ? 'active' : '') + ribbonButton('draw-circle', 'circle', 'Circle', mode === 'circle' ? 'active' : '') + ribbonButton('draw-polygon', 'polygon', 'Polygon', mode === 'polygon' ? 'active' : '') + ribbonButton('draw-point', 'point', 'Point', mode === 'point' ? 'active' : '')) +
            group('Modify', ribbonButton('transform', 'transform', 'Transform') + ribbonButton('geo-duplicate', 'open', 'Duplicate') + ribbonButton('geo-delete', 'delete', 'Delete')) +
            group('Construction', ribbonButton('measure', 'measure', 'Measure') + ribbonButton('top', 'top', 'Top view') + ribbonButton('fit', 'fit', 'Fit')) +
            group('Exchange', ribbonButton('export-sketch', 'save', 'Export SVG'));
    else if (ribbonTab === 'machine')
        content = group('Workholding', ribbonButton('setup', 'stock', 'Stock & WCS', 'accent') + ribbonButton('fixtures', 'fixture', 'Fixtures') + ribbonButton('tools', 'tool', 'Tool library')) + group('Project', ribbonButton('save', 'save', 'Save project') + ribbonButton('open', 'open', 'Open project') + ribbonButton('new', 'new', 'New project')) + group('Validation', ribbonButton('generate', 'generate', 'Regenerate') + ribbonButton('verify', 'verify', 'Verify setup') + ribbonButton('report', 'report', 'Report'));
    else if (ribbonTab === 'verify')
        content = group('Material removal', ribbonButton('play', 'play', 'Run / pause', 'primary') + ribbonButton('sim-reset', 'undo', 'Reset stock') + ribbonButton('sim-end', 'stock', 'Final stock')) + group('Verification', ribbonButton('verify', 'verify', 'Check paths', 'accent') + ribbonButton('report', 'report', 'Export report') + ribbonButton('limits', 'help', 'Model limits')) + group('Display', ribbonButton('toggle-rapids', 'paths', 'Rapid moves') + ribbonButton('toggle-paths', 'paths', 'Toolpaths') + ribbonButton('fit', 'fit', 'Fit model'));
    else
        content = group('Orientation', ribbonButton('iso', 'iso', 'Isometric', 'accent') + ribbonButton('top', 'top', 'Top') + ribbonButton('front', 'profile', 'Front') + ribbonButton('fit', 'fit', 'Fit model')) + group('Visibility', ribbonButton('toggle-stock', 'stock', 'Stock') + ribbonButton('toggle-paths', 'paths', 'Toolpaths') + ribbonButton('toggle-rapids', 'paths', 'Rapid moves') + ribbonButton('toggle-geometry', 'polygon', 'Geometry') + ribbonButton('toggle-fixtures', 'fixture', 'Fixtures') + ribbonButton('toggle-grid', 'grid', 'Grid')) + group('Inspect', ribbonButton('measure', 'measure', 'Measure') + ribbonButton('help', 'help', 'Help'));
    $('#ribbon').innerHTML = content;
    $$('[data-tab]').forEach(e => e.classList.toggle('active', e.dataset.tab === ribbonTab));
}
function notify(message, error = false) { const el = $('#toast'); clearTimeout(toastTimer); el.textContent = message; el.hidden = false; el.classList.toggle('error', error); toastTimer = setTimeout(() => el.hidden = true, error ? 6500 : 3600); $('#status-message').textContent = message; }
function persist() { try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(getProject()));
    $('#save-status').textContent = 'All changes saved locally';
}
catch {
    $('#save-status').textContent = 'Local storage full — export project';
} }
function download(name, text, type = 'application/json') { const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
function fileName(ext) { return `${getProject().name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'AxiomCAM'}.${ext}`; }
function edit(label, fn) { try {
    history.commit(label, fn);
    changed();
    return true;
}
catch (error) {
    notify(error.message, true);
    refreshScene();
    return false;
} }
function changed() {
    // Invalidate in-flight replies immediately, not after the debounce timer.
    requestId++;
    busy = false;
    $('#busy').hidden = true;
    clearTimeout(regenTimer);
    playing = false;
    simTime = 0;
    cursor = 0;
    renderer.toolPosition = null;
    transientProject = null;
    selected = new Set([...selected].filter(id => getProject().geometry.some(g => g.id === id)));
    if (!getProject().operations.some(o => o.id === selectedOp))
        selectedOp = getProject().operations[0]?.id || null;
    field = new StockField(getProject().stock, getProject().simulation.cellSize);
    result = null;
    verification = null;
    generatedRevision = -1;
    persist();
    renderAll();
    refreshScene();
    if (autoRegenerate)
        scheduleGenerate();
}
function renderManagers() {
    const p = getProject();
    $('#project-title').textContent = p.name;
    $('#setup-coordinate-summary').textContent = `${p.post.workOffset} · Metric · XY plane`;
    $('#document-name').textContent = p.name.split('·')[0].trim();
    $('#op-count').textContent = p.operations.length;
    $('#geometry-count').textContent = p.geometry.length;
    $('#stock-summary').textContent = `${p.stock.width} × ${p.stock.height} × ${f(p.stock.top - p.stock.bottom, 0)} mm stock`;
    $('#material-name').textContent = p.material.split('—')[0].trim();
    $('#tolerance-status').textContent = `TOL ${p.tolerance.toFixed(3)} mm`;
    $('#operations').innerHTML = p.operations.map((op, index) => {
        const path = result?.operations.find(o => o.opId === op.id), tool = p.tools.find(t => t.id === op.toolId), bad = verification?.issues.some(i => i.severity === 'error' && i.opId === op.id) || result?.errors.some(e => e.opId === op.id);
        const duration = path ? result.times[path.end - 1] - result.times[Math.max(0, path.start - 1)] : 0;
        return `<div class="op-card ${op.id === selectedOp ? 'selected' : ''}" data-op="${op.id}"><input type="checkbox" data-op-enabled="${op.id}" ${op.enabled ? 'checked' : ''} aria-label="Enable ${escapeHTML(op.name)}"><span class="op-symbol">${symbols[op.type]}</span><div class="op-details"><strong>${escapeHTML(op.name)}</strong><small>T${tool?.number || '?'} · ${escapeHTML(tool?.name || 'Missing tool')}</small><div class="op-tags"><span class="${bad ? 'error' : path ? '' : 'dirty'}">${!op.enabled ? 'SUPPRESSED' : bad ? 'CHECK' : path ? 'GENERATED' : 'DIRTY'}</span><span>Z ${f(op.depth, 1)}</span></div></div><span class="op-time">${path ? timeFormat(duration) : '—'}</span></div>`;
    }).join('') || '<div class="empty">Create a machining operation from the ribbon. Draw or select geometry first.</div>';
    $('#geometry-list').innerHTML = p.geometry.map(g => `<div class="geometry-row ${selected.has(g.id) ? 'selected' : ''}" data-geometry="${g.id}"><span>${{ circle: '○', rect: '▱', polygon: '◇', point: '+' }[g.type]}</span><span>${escapeHTML(g.name)}</span><input type="checkbox" ${g.visible !== false ? 'checked' : ''} data-geometry-visible="${g.id}" aria-label="Visibility"></div>`).join('') || '<div class="empty">Switch to Wireframe to create sketch geometry.</div>';
    $('#selection-pill').textContent = `${selected.size} ${selected.size === 1 ? 'chain' : 'chains'} selected`;
}
function numericRow(label, key, value, unit = '', prefix = 'op') { return `<div class="parameter-row"><label>${label}</label><div class="input-unit"><input type="number" step="any" data-${prefix}-field="${key}" value="${value}" aria-label="${escapeHTML(label)}">${unit ? `<span>${unit}</span>` : ''}</div></div>`; }
function selectRow(label, key, value, options, prefix = 'op') { return `<div class="parameter-row"><label>${label}</label><select data-${prefix}-field="${key}" aria-label="${escapeHTML(label)}">${options.map(([v, t]) => `<option value="${v}" ${value === v ? 'selected' : ''}>${escapeHTML(t)}</option>`).join('')}</select></div>`; }
function section(label, content, extra = '') { return `<section class="parameter-section"><div class="section-label">${label}<span>${extra || '⌄'}</span></div>${content}</section>`; }
function renderInspector() {
    const p = getProject(), op = p.operations.find(o => o.id === selectedOp), geos = p.geometry.filter(g => selected.has(g.id));
    $('#inspector-mode').textContent = inspectorMode === 'geometry' ? 'Operation' : 'Geometry';
    $('#inspector-heading').textContent = inspectorMode === 'geometry' ? 'GEOMETRY PROPERTIES' : 'OPERATION PARAMETERS';
    if (inspectorMode === 'geometry' && geos.length) {
        renderGeometryInspector(geos);
        return;
    }
    if (!op) {
        $('#inspector-content').innerHTML = '<div class="empty">Select an operation, or create one using Face, Contour, Pocket, or Drill.</div>';
        return;
    }
    const tool = p.tools.find(t => t.id === op.toolId), entry = result?.operations.find(o => o.opId === op.id);
    $('#inspector-content').innerHTML = `<div class="inspector-intro"><div class="eyebrow">${typeNames[op.type]?.toUpperCase()} / MILL</div><input class="rename-input" aria-label="Operation name" data-op-field="name" value="${escapeHTML(op.name)}"><p style="margin-top:7px">${op.type === 'pocket' ? 'Nested islands · clipped raster · boundary finish' : op.type === 'profile' ? 'Compensated closed contour · layered depth' : op.type === 'drill' ? 'Explicit peck moves · full chip-clear retract' : 'Bidirectional raster · full stock coverage'}</p></div>` +
        section('TOOL', `<div class="tool-preview"><div class="tool-drawing"></div><div><strong>T${tool?.number} · ${escapeHTML(tool?.name)}</strong><small>${tool?.flutes} flutes · ${tool?.kind === 'drill' ? 'Twist drill' : 'Flat / center cutting'}<br>${tool?.fluteLength} mm flute · ${tool?.stickout} mm stickout</small></div><button data-action="tools" title="Edit tool library">↗</button></div>` + selectRow('Tool', 'toolId', op.toolId, p.tools.map(t => [t.id, `T${t.number} · ${t.name}`]))) +
        section('CHAIN SELECTION', `<div class="chain-pills">${op.geometryIds.map(id => `<span>${escapeHTML(p.geometry.find(g => g.id === id)?.name || 'Missing chain')}</span>`).join('') || `<span>${op.type === 'face' ? 'Stock boundary' : 'No chains selected'}</span>`}</div>${op.type !== 'face' ? '<button class="inline-button" data-action="assign-chains">Use selected geometry</button>' : ''}`) +
        section('CUT PARAMETERS', numericRow('Top of operation', 'top', op.top, 'mm') + numericRow('Final depth', 'depth', op.depth, 'mm') + numericRow('Maximum stepdown', 'stepdown', op.stepdown, 'mm') + (op.type === 'drill' ? numericRow('Peck increment', 'peck', op.peck, 'mm') : numericRow('Stepover', 'stepover', op.stepover, '%') + numericRow('Wall allowance', 'allowance', op.allowance, 'mm')) + (op.type === 'profile' ? selectRow('Cutter compensation', 'side', op.side, [['outside', 'Outside'], ['inside', 'Inside'], ['center', 'Centerline']]) : '') + (op.type === 'pocket' ? numericRow('Raster angle', 'angle', op.angle, '°') : '') + (op.type === 'pocket' || op.type === 'profile' ? selectRow('Boundary direction', 'clockwise', String(op.clockwise), [['true', 'Clockwise'], ['false', 'Counterclockwise']]) : '')) +
        section('FEEDS & SPEEDS', numericRow('Spindle', 'rpm', op.rpm, 'rpm') + numericRow('Cutting feed', 'feed', op.feed, 'mm/m') + numericRow('Plunge feed', 'plunge', op.plunge, 'mm/m') + '<button class="inline-button secondary" data-action="calculate-feeds">Calculate from tool Vc / chip load</button><p class="parameter-note">Illustrative settings. Validate for your cutter, material, machine, and workholding.</p>') +
        section('LINKING & CLEARANCE', numericRow('Clearance Z', 'clearance', op.clearance, 'mm') + numericRow('Above-stock retract', 'retract', op.retract, 'mm') + `<div class="parameter-row checkbox"><label>Flood coolant</label><input type="checkbox" data-op-field="coolant" ${op.coolant ? 'checked' : ''}></div><p class="parameter-note">Plunge entry. Every disconnected cutting traverse retracts to clearance. No low-Z linking.</p>`) +
        `<div class="inspector-actions"><button class="button primary full" data-action="generate">⟳ Regenerate toolpaths</button></div><label class="auto-label"><input type="checkbox" id="auto-regenerate" ${autoRegenerate ? 'checked' : ''}> Automatically regenerate after edits</label>` +
        (entry ? section('COMPUTATION', `<p class="parameter-note">${entry.depths.length} depth passes · ${entry.contourCount || 'stock'} boundaries<br>${entry.warnings.map(escapeHTML).join('<br>')}</p>`) : '');
}
function renderGeometryInspector(geos) {
    const g = geos[0];
    let fields = '';
    if (geos.length === 1) {
        fields = `<div class="parameter-row full"><label>Entity name</label><input data-geo-field="name" value="${escapeHTML(g.name)}"></div>`;
        if (g.type === 'rect')
            for (const [k, label] of [['x', 'Origin X'], ['y', 'Origin Y'], ['width', 'Width'], ['height', 'Height'], ['radius', 'Corner radius']])
                fields += numericRow(label, k, g[k] || 0, 'mm', 'geo');
        if (g.type === 'circle')
            for (const [k, label] of [['cx', 'Center X'], ['cy', 'Center Y'], ['radius', 'Radius']])
                fields += numericRow(label, k, g[k], 'mm', 'geo');
        if (g.type === 'point')
            for (const k of ['x', 'y'])
                fields += numericRow(k.toUpperCase(), k, g[k], 'mm', 'geo');
        if (g.type === 'polygon')
            fields += `<table class="vertices-table"><thead><tr><th>POINT</th><th>X / mm</th><th>Y / mm</th></tr></thead><tbody>${g.points.map((p, i) => `<tr><td>${i + 1}</td>${p.map((v, axis) => `<td><input type="number" step="any" data-vertex="${i}" data-axis="${axis}" value="${v}" aria-label="Vertex ${i + 1} ${axis ? 'Y' : 'X'}"></td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
    else
        fields = `<p class="parameter-note">${geos.length} entities selected. Transform and duplicate act on the whole selection.</p>`;
    $('#inspector-content').innerHTML = `<div class="inspector-intro"><div class="eyebrow">WIRE­FRAME / XY PLANE</div><h2>${geos.length === 1 ? escapeHTML(g.name) : `${geos.length} selected entities`}</h2><p>Persistent identity · editable geometry</p></div>` + section('DEFINITION', fields) + section('MODIFY', '<button class="inline-button" data-action="transform">Translate / rotate selection</button><button class="inline-button secondary" data-action="geo-duplicate">Duplicate selection</button><button class="inline-button secondary" data-action="top">Edit in top view</button><p class="parameter-note">Drag square handles to edit vertices or dimensions. Drag a selected entity to move it. The grid snaps to 1 mm; hold Alt for unsnapped input.</p>') + section('CREATE TOOLPATH', `<button class="inline-button" data-action="add-pocket">Pocket selected contours</button><button class="inline-button secondary" data-action="add-profile">Profile selected contours</button><button class="inline-button secondary" data-action="add-drill">Drill selected centers</button>`) + `<div class="inspector-actions"><button class="button danger full" data-action="geo-delete">Delete selected geometry</button></div>`;
}
function renderBottom() {
    $$('[data-bottom]').forEach(b => b.classList.toggle('active', b.dataset.bottom === bottomTab));
    if (bottomTab === 'simulation') {
        $('#bottom-content').innerHTML = `<div class="simulation-controls"><button data-action="sim-reset" title="Reset stock">|◀</button><button class="play" id="play-button" data-action="play" title="Run/pause (Space)">${playing ? 'Ⅱ' : '▶'}</button><button data-action="sim-step" title="Next motion block">▸|</button><select id="sim-speed" aria-label="Simulation speed">${[1, 10, 50, 200, 1000].map(v => `<option value="${v}" ${speed === v ? 'selected' : ''}>${v}×</option>`).join('')}</select><input type="range" id="timeline-slider" min="0" max="1000" value="${result?.seconds ? Math.round(simTime / result.seconds * 1000) : 0}" aria-label="Simulation position"><span class="time" id="sim-time">${timeFormat(simTime)} / ${timeFormat(result?.seconds)}</span><button data-action="sim-end" title="Final stock">▶|</button></div><div class="timeline">${getProject().operations.filter(o => o.enabled).map(op => { const c = result?.operations.find(r => r.opId === op.id), duration = c ? result.times[c.end - 1] - result.times[c.start - 1] : 1; return `<button data-seek-op="${op.id}" style="flex:${Math.max(.15, duration / (result?.seconds || 1))}" title="Jump to ${escapeHTML(op.name)}">${escapeHTML(op.name)}</button>`; }).join('')}</div><div class="readouts"><span><label>X</label><b id="read-x">0.000</b></span><span><label>Y</label><b id="read-y">0.000</b></span><span><label>Z</label><b id="read-z">0.000</b></span><span><label>F</label><b id="read-feed">—</b></span><span class="readout-right" id="read-tool">No active tool</span></div>`;
    }
    else if (bottomTab === 'verification') {
        const issues = verification?.issues || result?.errors || [];
        $('#bottom-content').innerHTML = `<div class="issues">${issues.length ? issues.map(i => `<div class="issue ${i.severity}"><span class="issue-icon">${i.severity === 'error' ? '✕' : '△'}</span><div><strong>${escapeHTML(i.code)}</strong>${escapeHTML(i.message)}</div>${i.move ? `<button data-seek-move="${i.move}">Show move ${i.move}</button>` : ''}</div>`).join('') : '<div class="empty">Regenerate toolpaths to run fixture and stock verification.</div>'}</div>`;
    }
    else {
        const moves = result?.moves || [];
        const start = Math.max(1, Math.min(cursor - 5, moves.length - 45));
        $('#bottom-content').innerHTML = `<div class="motion-table"><table><thead><tr><th>BLOCK</th><th>TYPE</th><th>X</th><th>Y</th><th>Z</th><th>F mm/min</th></tr></thead><tbody>${moves.slice(start, start + 45).map((m, i) => `<tr data-seek-move="${start + i}" style="cursor:pointer"><td>${start + i}</td><td>${m.kind.toUpperCase()}</td><td>${f(m.x, 3)}</td><td>${f(m.y, 3)}</td><td>${f(m.z, 3)}</td><td>${f(m.feed, 0)}</td></tr>`).join('')}</tbody></table></div>`;
    }
    updateReadouts();
}
function renderMetrics() {
    $('#kpi-time').textContent = result ? timeFormat(result.seconds) : '—';
    $('#kpi-moves').textContent = result ? result.moves.length.toLocaleString() : '—';
    $('#kpi-removed').textContent = verification ? `${f(field.removed / 1000, 1)} cm³` : '—';
    $('#verification-badge').textContent = verification ? verification.errors ? `${verification.errors} errors` : `${verification.warningCount} limits` : '—';
    $('#verification-status').textContent = busy ? 'COMPUTING' : verification ? (verification.errors ? `${verification.errors} ERRORS · POST BLOCKED` : 'CHECKS PASSED · MODEL LIMITS APPLY') : 'NOT VERIFIED';
    $('#verification-status').classList.toggle('error', !!verification?.errors);
}
function renderAll() { renderRibbon(); renderManagers(); renderInspector(); renderBottom(); renderMetrics(); }
function entityHandles() {
    const p = transientProject || getProject();
    if (selected.size !== 1 || inspectorMode !== 'geometry')
        return [];
    const g = p.geometry.find(e => selected.has(e.id));
    if (!g)
        return [];
    if (g.type === 'polygon')
        return g.points.map((v, i) => ({ p: v, index: i, kind: 'vertex' }));
    if (g.type === 'circle')
        return [{ p: [g.cx, g.cy], kind: 'center' }, { p: [g.cx + g.radius, g.cy], kind: 'radius' }];
    if (g.type === 'rect')
        return [[g.x, g.y], [g.x + g.width, g.y], [g.x + g.width, g.y + g.height], [g.x, g.y + g.height]].map((p, i) => ({ p, index: i, kind: 'corner' }));
    return [{ p: [g.x, g.y], kind: 'center' }];
}
function refreshScene() { renderer.handles = entityHandles(); renderer.update(transientProject || getProject(), field, result, selected); }
function scheduleGenerate() { clearTimeout(regenTimer); regenTimer = setTimeout(generate, 250); }
function createWorker() {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => {
        const data = e.data;
        if (data.id !== requestId)
            return;
        if (data.type === 'progress') {
            $('#busy-text').textContent = `Computing ${data.name}…`;
            return;
        }
        busy = false;
        $('#busy').hidden = true;
        if (data.type === 'error') {
            notify(data.message, true);
            renderMetrics();
            return;
        }
        if (data.result.projectSignature !== projectSignature(getProject())) {
            notify('Discarded toolpaths for an older project revision.');
            renderMetrics();
            return;
        }
        result = data.result;
        verification = data.verification;
        generatedRevision = history.revision;
        field = new StockField(getProject().stock, getProject().simulation.cellSize);
        field.heights.set(verification.heights);
        field.removed = verification.removed;
        field.revision++;
        simTime = result.seconds;
        cursor = result.moves.length - 1;
        playing = false;
        renderer.toolPosition = null;
        renderManagers();
        renderInspector();
        renderBottom();
        renderMetrics();
        refreshScene();
        $('#simulation-state').textContent = 'Computed final stock';
        $('#view-heading').textContent = 'MACHINED STOCK';
        $('#status-message').textContent = `${result.operations.length} operations · ${f(result.generationMs, 0)} ms generation · ${f(verification.verificationMs, 0)} ms verification · ${result.cacheHits} cached`;
        if (verification.errors) {
            bottomTab = 'verification';
            renderBottom();
            notify(`${verification.errors} verification error(s). G-code export is blocked.`, true);
        }
    };
    worker.onerror = e => { busy = false; $('#busy').hidden = true; notify(`Worker failed: ${e.message}. Serve this folder over HTTP, not file://.`, true); };
}
function generate() { clearTimeout(regenTimer); playing = false; requestId++; if (!worker)
    createWorker(); busy = true; $('#busy').hidden = false; $('#busy-text').textContent = 'Generating and verifying toolpaths…'; renderMetrics(); worker.postMessage({ id: requestId, project: getProject() }); }
function cancelGenerate() { requestId++; worker?.terminate(); worker = null; busy = false; $('#busy').hidden = true; notify('Generation cancelled. Existing results remain unavailable for changed geometry.'); renderMetrics(); }
function selectedOperation() { return getProject().operations.find(o => o.id === selectedOp); }
function chooseOperation(id) { selectedOp = id; inspectorMode = 'operation'; selected = new Set(selectedOperation()?.geometryIds || []); renderManagers(); renderInspector(); refreshScene(); }
function chooseGeometry(id, additive = false) { inspectorMode = 'geometry'; if (additive) {
    selected.has(id) ? selected.delete(id) : selected.add(id);
}
else
    selected = new Set([id]); renderManagers(); renderInspector(); refreshScene(); }
function addOperation(type) {
    const p = getProject();
    const tool = p.tools.find(t => type === 'drill' ? t.kind === 'drill' : t.kind === 'flat' && (type !== 'face' ? t.diameter <= 10 : true)) || p.tools.find(t => t.kind === 'flat');
    if (!tool) {
        notify('Create an appropriate tool first.', true);
        return;
    }
    const op = defaultOperation(type, type === 'face' ? [] : [...selected], tool.id);
    op.top = p.stock.top;
    op.depth = Math.max(p.stock.bottom + .5, type === 'face' ? p.stock.top - .5 : p.stock.top - 5);
    op.clearance = Math.max(25, p.stock.top + 10, ...p.fixtures.map(f => f.top + 5));
    op.stepdown = Math.min(op.stepdown, tool.maxStepdown);
    op.rpm = Math.min(op.rpm, tool.maxRPM, p.machine.maxRPM);
    op.name = `${String(p.operations.length + 1).padStart(2, '0')} · ${op.name}`;
    selectedOp = op.id;
    inspectorMode = 'operation';
    closeDialog();
    edit(`Add ${type} operation`, p => p.operations.push(op));
}
function setMode(next) {
    mode = next;
    drawPoints = [];
    renderer.draft = null;
    $('#measure-result').hidden = true;
    if (next !== 'select') {
        renderer.setView('top');
        ribbonTab = next === 'measure' ? 'view' : 'wireframe';
    }
    $('#overlay-canvas').style.cursor = next === 'select' ? 'default' : 'crosshair';
    $('#mode-hint').textContent = { select: 'Select geometry to edit or assign to an operation', rect: 'Rectangle: click two opposite corners', circle: 'Circle: click center, then radius', polygon: 'Polygon: click vertices · Enter / double-click to close', point: 'Point: click to add drilling locations', measure: 'Measure: click two points' }[next];
    renderRibbon();
    refreshScene();
}
function addEntity(entity) { entity.id = uid('geo'); entity.visible = true; selected = new Set([entity.id]); inspectorMode = 'geometry'; edit(`Create ${entity.type}`, p => p.geometry.push(entity)); }
function finishPolygon() { if (drawPoints.length < 3) {
    notify('A closed polygon needs at least three points.', true);
    return;
} const points = drawPoints.slice(); drawPoints = []; renderer.draft = null; addEntity({ type: 'polygon', name: `Polygon ${getProject().geometry.length + 1}`, points }); refreshScene(); }
function resetSimulation() { if (!result)
    return; playing = false; simTime = 0; cursor = 0; field = new StockField(getProject().stock, getProject().simulation.cellSize); renderer.toolPosition = null; $('#view-heading').textContent = 'STOCK SIMULATION'; $('#simulation-state').textContent = 'Ready to run'; renderBottom(); renderMetrics(); refreshScene(); }
function seekTime(target) {
    if (!result)
        return;
    target = clamp(target, 0, result.seconds);
    if (target < simTime - 1e-8) {
        field = new StockField(getProject().stock, getProject().simulation.cellSize);
        cursor = 0;
    }
    const moves = result.moves, times = result.times, tools = new Map(getProject().tools.map(t => [t.id, t]));
    let index = cursor;
    while (index + 1 < times.length && times[index + 1] <= target + 1e-9)
        index++;
    for (let i = cursor + 1; i <= index; i++) {
        const a = moves[i - 1], b = moves[i];
        field.apply(a, b, tools.get(b.toolId));
    }
    cursor = index;
    simTime = target;
    let pos = moves[index], tool = tools.get(pos.toolId);
    if (index + 1 < moves.length) {
        const b = moves[index + 1], duration = times[index + 1] - times[index], t = duration ? clamp((target - times[index]) / duration, 0, 1) : 1;
        const xyz = lerp([pos.x, pos.y, pos.z], [b.x, b.y, b.z], t);
        const partial = { ...b, x: xyz[0], y: xyz[1], z: xyz[2] };
        tool = tools.get(b.toolId);
        field.apply(pos, partial, tool);
        pos = partial;
    }
    renderer.toolPosition = tool ? { tool, pos } : null;
    renderer.dirty = true;
    $('#simulation-state').textContent = target >= result.seconds ? 'Simulation complete' : playing ? 'Running · feed-based time' : 'Paused · feed-based time';
    $('#view-heading').textContent = 'STOCK SIMULATION';
    const slider = $('#timeline-slider');
    if (slider)
        slider.value = result.seconds ? Math.round(target / result.seconds * 1000) : 0;
    const timer = $('#sim-time');
    if (timer)
        timer.textContent = `${timeFormat(target)} / ${timeFormat(result.seconds)}`;
    $('#kpi-removed').textContent = `${f(field.removed / 1000, 1)} cm³`;
    updateReadouts();
}
function updateReadouts() { const p = renderer.toolPosition?.pos; for (const axis of ['x', 'y', 'z']) {
    const el = $(`#read-${axis}`);
    if (el)
        el.textContent = p ? f(p[axis], 3) : '0.000';
} const feed = $('#read-feed'); if (feed)
    feed.textContent = p ? f(p.feed, 0) : '—'; const tool = $('#read-tool'); if (tool)
    tool.textContent = renderer.toolPosition ? renderer.toolPosition.tool.name : 'No active tool'; const pb = $('#play-button'); if (pb)
    pb.textContent = playing ? 'Ⅱ' : '▶'; }
function play() { if (!result || busy) {
    notify('Generate toolpaths before running the simulation.', true);
    return;
} if (!playing && simTime >= result.seconds)
    resetSimulation(); playing = !playing; bottomTab = 'simulation'; renderBottom(); }
function showDialog(title, html) { $('#dialog-title').textContent = title; $('#dialog-content').innerHTML = html; if (!$('#dialog').open)
    $('#dialog').showModal(); }
function closeDialog() { $('#dialog').close(); }
$('#dialog-close').onclick = closeDialog;
$('#dialog').addEventListener('click', e => { if (e.target === $('#dialog')) {
    const r = e.target.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        closeDialog();
} });
function formNumber(label, name, value, unit = 'mm') { return `<div class="parameter-row"><label>${label}</label><div class="input-unit"><input name="${name}" type="number" step="any" required value="${value}"><span>${unit}</span></div></div>`; }
function setupDialog() {
    const p = getProject(), s = p.stock, m = p.machine;
    showDialog('Machine group setup', `<form id="setup-form"><div class="parameter-row full"><label>Project name</label><input name="name" value="${escapeHTML(p.name)}" required></div><div class="parameter-row full"><label>Material / setup note</label><input name="material" value="${escapeHTML(p.material)}"></div><div class="notice info" style="margin-top:15px">All geometry and post coordinates use millimeters in the selected work offset. Z is the tool-tip coordinate; stock top defaults to Z0. This is a work-coordinate envelope, not full machine kinematics.</div><div class="dialog-grid"><fieldset><legend>Rectangular stock</legend>${[['x', 'Origin X'], ['y', 'Origin Y'], ['width', 'Width X'], ['height', 'Width Y'], ['top', 'Top Z'], ['bottom', 'Bottom Z']].map(([k, l]) => formNumber(l, `stock.${k}`, s[k])).join('')}</fieldset><fieldset><legend>Accuracy & post</legend>${formNumber('Machining tolerance', 'tolerance', p.tolerance)}${formNumber('Stock cell size', 'cellSize', p.simulation.cellSize)}${formNumber('Safe tool-change Z', 'machine.safeZ', m.safeZ)}${formNumber('Rapid feed', 'machine.rapid', m.rapid, 'mm/m')}${formNumber('Spindle maximum', 'machine.maxRPM', m.maxRPM, 'rpm')}<div class="parameter-row"><label>Work offset</label><select name="workOffset">${['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].map(x => `<option ${p.post.workOffset === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>${formNumber('Program number', 'programNumber', p.post.programNumber, '')}<label class="check-notice"><input type="checkbox" name="lengthComp" ${p.post.lengthComp ? 'checked' : ''}> Emit G43 H(tool number)</label></fieldset><fieldset><legend>Tool-tip XY travel limits</legend>${['minX', 'maxX', 'minY', 'maxY'].map(k => formNumber(k, `machine.${k}`, m[k])).join('')}</fieldset><fieldset><legend>Tool-tip Z limits</legend>${['minZ', 'maxZ'].map(k => formNumber(k, `machine.${k}`, m[k])).join('')}<p>Every disconnected traverse retracts to the operation clearance. Tool changes use safe Z.</p></fieldset></div><div class="dialog-actions"><button type="button" class="button" data-action="dialog-close">Cancel</button><button class="button primary" type="submit">Apply setup</button></div></form>`);
    $('#setup-form').onsubmit = e => { e.preventDefault(); const data = new FormData(e.target); if (edit('Edit machine setup', p => { p.name = data.get('name'); p.material = data.get('material'); for (const [key, val] of data) {
        if (key.startsWith('stock.') || key.startsWith('machine.')) {
            const [group, name] = key.split('.');
            p[group][name] = Number(val);
        }
    } p.tolerance = Number(data.get('tolerance')); p.simulation.cellSize = Number(data.get('cellSize')); p.post.workOffset = data.get('workOffset'); p.post.programNumber = Number(data.get('programNumber')); p.post.lengthComp = data.has('lengthComp'); }))
        closeDialog(); };
}
function toolsDialog() { showDialog('Tool library', `<p>Tool dimensions drive offsets, feed calculation, stock removal, and separate cutter / shank / holder collision checks. Limits are user-defined, not manufacturer recommendations.</p><div class="modal-list">${getProject().tools.map(t => `<div class="modal-item"><div class="tool-drawing"></div><div><strong>T${t.number} · ${escapeHTML(t.name)}</strong><small>Ø${t.diameter} · ${t.flutes} flutes · ${t.fluteLength} mm cutting length · ${t.maxRPM.toLocaleString()} rpm limit</small></div><div class="modal-item-actions"><button class="button" data-edit-tool="${t.id}">Edit</button><button class="button danger" data-delete-tool="${t.id}">×</button></div></div>`).join('')}</div><div class="dialog-actions"><button class="button primary" data-action="new-tool">＋ Add tool</button></div>`); }
function toolDialog(id) {
    const isNew = !id, t = id ? getProject().tools.find(x => x.id === id) : { id: uid('tool'), number: Math.max(0, ...getProject().tools.map(t => t.number)) + 1, name: 'Flat end mill', kind: 'flat', diameter: 6, flutes: 3, fluteLength: 20, stickout: 40, holderDiameter: 24, holderLength: 30, centerCutting: true, maxRPM: 12000, maxStepdown: 2, vc: 180, chipload: .03 };
    showDialog(isNew ? 'Add tool' : `Edit T${t.number}`, `<form id="tool-form"><div class="parameter-row full"><label>Tool name</label><input name="name" value="${escapeHTML(t.name)}" required></div><div class="dialog-grid" style="margin-top:16px"><fieldset><legend>Cutting geometry</legend>${formNumber('Tool number', 'number', t.number, '')}<div class="parameter-row"><label>Tool type</label><select name="kind"><option value="flat" ${t.kind === 'flat' ? 'selected' : ''}>Flat mill</option><option value="drill" ${t.kind === 'drill' ? 'selected' : ''}>Drill</option></select></div>${[['diameter', 'Diameter', 'mm'], ['flutes', 'Flutes', ''], ['fluteLength', 'Flute length', 'mm'], ['stickout', 'Stickout', 'mm'], ['holderDiameter', 'Holder diameter', 'mm'], ['holderLength', 'Holder length', 'mm']].map(([k, l, u]) => formNumber(l, k, t[k], u)).join('')}<label class="check-notice"><input type="checkbox" name="centerCutting" ${t.centerCutting ? 'checked' : ''}> Center-cutting / plunge capable</label></fieldset><fieldset><legend>User-defined process limits</legend>${[['maxRPM', 'Maximum spindle', 'rpm'], ['maxStepdown', 'Maximum stepdown', 'mm'], ['vc', 'Surface speed Vc', 'm/min'], ['chipload', 'Chip load', 'mm/z']].map(([k, l, u]) => formNumber(l, k, t[k], u)).join('')}<p>RPM = 1000 × Vc / (π × D).<br>Feed = RPM × flutes × chip load.<br>Plunge default = 20% of calculated feed.</p><div class="notice">The simulated drill has a flat bottom. Conical tip geometry and compensation are not modeled.</div></fieldset></div><div class="dialog-actions"><button type="button" class="button" data-action="tools">Back to library</button><button class="button primary">Save tool</button></div></form>`);
    $('#tool-form').onsubmit = e => { e.preventDefault(); const data = new FormData(e.target), next = { ...t }; for (const [k, v] of data)
        next[k] = ['name', 'kind'].includes(k) ? v : Number(v); next.centerCutting = data.has('centerCutting'); if (edit('Edit tool library', p => { if (isNew)
        p.tools.push(next);
    else
        p.tools[p.tools.findIndex(x => x.id === id)] = next; }))
        toolsDialog(); };
}
function fixturesDialog() { showDialog('Fixture definition', `<p>Fixtures are axis-aligned boxes in work coordinates. The verifier sweeps the cutter, shank, and holder continuously along each linear move against these boxes.</p><div class="modal-list">${getProject().fixtures.map(f => `<div class="modal-item"><span style="font-size:24px;color:#8ba8bc">▰</span><div><strong>${escapeHTML(f.name)}</strong><small>X ${f.x} · Y ${f.y} · ${f.width} × ${f.height} mm · Z ${f.bottom} to ${f.top}</small></div><div class="modal-item-actions"><button class="button" data-edit-fixture="${f.id}">Edit</button><button class="button danger" data-delete-fixture="${f.id}">×</button></div></div>`).join('') || '<div class="notice">No fixtures are defined. An empty scene is not evidence of safe workholding.</div>'}</div><div class="dialog-actions"><button class="button primary" data-action="new-fixture">＋ Add fixture</button></div>`); }
function fixtureDialog(id) {
    const isNew = !id, s = getProject().stock, t = id ? getProject().fixtures.find(f => f.id === id) : { id: uid('fixture'), name: 'Fixture', x: s.x + 20, y: s.y - 25, width: 30, height: 12, bottom: s.bottom, top: 8 };
    showDialog(isNew ? 'Add fixture' : 'Edit fixture', `<form id="fixture-form"><div class="parameter-row full"><label>Name</label><input name="name" value="${escapeHTML(t.name)}" required></div><div class="dialog-grid" style="margin-top:15px"><fieldset><legend>XY extent</legend>${[['x', 'Origin X'], ['y', 'Origin Y'], ['width', 'Width'], ['height', 'Height']].map(([k, l]) => formNumber(l, k, t[k])).join('')}</fieldset><fieldset><legend>Vertical extent</legend>${formNumber('Bottom Z', 'bottom', t.bottom)}${formNumber('Top Z', 'top', t.top)}<p>Touching a modeled fixture within the machining tolerance is reported as a collision.</p></fieldset></div><div class="dialog-actions"><button type="button" class="button" data-action="fixtures">Cancel</button><button class="button primary">Save fixture</button></div></form>`);
    $('#fixture-form').onsubmit = e => { e.preventDefault(); const data = new FormData(e.target), next = { ...t }; for (const [k, v] of data)
        next[k] = k === 'name' ? v : Number(v); if (edit('Edit fixture', p => { if (isNew)
        p.fixtures.push(next);
    else
        p.fixtures[p.fixtures.findIndex(f => f.id === id)] = next; }))
        fixturesDialog(); };
}
function transformEntity(g, dx, dy, angle, center) {
    const c = Math.cos(angle), s = Math.sin(angle), map = p => { const x = p[0] - center[0], y = p[1] - center[1]; return [center[0] + x * c - y * s + dx, center[1] + x * s + y * c + dy]; };
    if (g.type === 'circle') {
        [g.cx, g.cy] = map([g.cx, g.cy]);
    }
    else if (g.type === 'point') {
        [g.x, g.y] = map([g.x, g.y]);
    }
    else if (g.type === 'rect' && Math.abs(angle) < 1e-12) {
        g.x += dx;
        g.y += dy;
    }
    else {
        const points = entityRing(g, getProject().tolerance).map(map);
        g.type = 'polygon';
        g.points = points;
        delete g.x;
        delete g.y;
        delete g.width;
        delete g.height;
        delete g.radius;
    }
}
function transformDialog() {
    if (!selected.size) {
        notify('Select geometry to transform.', true);
        return;
    }
    showDialog('Transform selected geometry', `<form id="transform-form"><p>Rotation is about the center of the selection bounds. Rotated rectangles become explicit closed polygon contours.</p>${formNumber('Translate X', 'dx', 0)}${formNumber('Translate Y', 'dy', 0)}${formNumber('Rotation', 'angle', 0, '°')}<label class="check-notice"><input type="checkbox" name="copy"> Keep originals and create transformed copies</label><div class="dialog-actions"><button class="button primary">Apply transform</button></div></form>`);
    $('#transform-form').onsubmit = e => {
        e.preventDefault();
        const data = new FormData(e.target), dx = Number(data.get('dx')), dy = Number(data.get('dy')), angle = Number(data.get('angle')) * Math.PI / 180, ids = [...selected], copy = data.has('copy');
        const geometry = getProject().geometry.filter(g => selected.has(g.id)), bb = bounds(geometry.map(g => g.type === 'point' ? [[g.x, g.y]] : entityRing(g, getProject().tolerance))), center = [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2], newIds = [];
        if (edit('Transform geometry', p => { for (const id of ids) {
            let g = p.geometry.find(g => g.id === id);
            if (copy) {
                g = clone(g);
                g.id = uid('geo');
                g.name += ' copy';
                p.geometry.push(g);
                newIds.push(g.id);
            }
            transformEntity(g, dx, dy, angle, center);
        } })) {
            if (copy) {
                selected = new Set(newIds);
                renderManagers();
                refreshScene();
            }
            closeDialog();
        }
    };
}
function postDialog() {
    if (busy || !result || generatedRevision !== history.revision) {
        notify('Regenerate the current project before posting.', true);
        return;
    }
    if (verification?.errors) {
        bottomTab = 'verification';
        renderBottom();
        notify('G-code export is blocked by verification errors.', true);
        return;
    }
    showDialog('Postprocessor · Generic metric 3-axis', `<div class="notice">This is a generic linear NC post, not a validated machine configuration. Review M6 behavior, G43/H offsets, ${escapeHTML(getProject().post.workOffset)}, G61 support, tool-change Z, spindle direction, coolant, and every move. Prove out in a separate machine/control simulator, then follow your shop’s dry-run and single-block procedure.</div><div class="diagnostic-summary"><span><b>${result.moves.length - 1}</b> moves</span><span><b>${result.operations.length}</b> operations</span><span><b>G21</b> millimeters</span><span><b>${getProject().post.workOffset}</b> work offset</span></div><p>Absolute XYZ · G0 / G1 only · computed cutter-center coordinates · G40 · optional G43 Hn · M3 · M8/M9 · explicit peck moves · G61 exact-path mode. No machine-coordinate home or automatic spindle warm-up is inserted.</p><label class="check-notice"><input type="checkbox" id="post-ack"> I understand that model verification is limited and that this program requires machine-specific review and independent prove-out.</label><div class="dialog-actions"><button class="button" data-action="limits">Verification limits</button><button id="post-generate" class="button primary" disabled>Generate NC program</button></div>`);
    $('#post-ack').onchange = e => $('#post-generate').disabled = !e.target.checked;
    $('#post-generate').onclick = () => { try {
        const nc = postprocess(getProject(), result, verification, { acknowledged: true });
        showDialog(`NC program · O${getProject().post.programNumber}`, `<div class="notice info">${nc.split('\n').length} lines generated from the verified motion stream. Initial motion before the modeled start and controller-side tool changes are not simulated.</div><textarea class="code" id="nc-preview" readonly aria-label="Generated G-code"></textarea><div class="dialog-actions"><button class="button" data-action="report">Export verification report</button><button class="button primary" id="download-nc">Download .nc</button></div>`);
        $('#nc-preview').value = nc;
        $('#download-nc').onclick = () => download(fileName('nc'), nc, 'text/plain');
    }
    catch (e) {
        notify(e.message, true);
    } };
}
function exportReport() {
    if (!result || !verification || generatedRevision !== history.revision) {
        notify('Generate the current project before exporting a verification report.', true);
        return;
    }
    const p = getProject();
    download(fileName('verification.json'), JSON.stringify({ schema: 'axiomcam-verification', version: 1, createdAt: new Date().toISOString(), project: p, engine: result.engine, postContract: POST_CONTRACT, statistics: { moves: result.moves.length, secondsIdealFeed: result.seconds, cutLength: result.cutLength, rapidLength: result.rapidLength, removedVolume: verification.removed, generationMs: result.generationMs, verificationMs: verification.verificationMs }, operations: result.operations, issues: verification.issues, stockGrid: { nx: verification.nx, ny: verification.ny, dx: verification.dx, dy: verification.dy }, limits: ['No machine kinematics or controller tool-change simulation', 'Stock center-sampled XY heightfield; thin remaining features may be missed', 'Flat-bottom cylindrical cutters and drills only', 'No cutting forces, deflection, fixture strength, flute helix, coolant dynamics or thermal effects', 'Offset kernel fails closed on ambiguous topology; finite lattice and chord tolerance are not exact CAD surfaces', 'Ideal feed time excludes acceleration, spindle run-up, M6 and dwell time', 'Generic post must be adapted and independently proved out'] }, null, 2));
    notify('Verification report exported with the complete source setup and limitations.');
}
function helpDialog(limits = false) { showDialog(limits ? 'Verification contract & limits' : 'AxiomCAM · Command guide', limits ? `<div class="notice">A passing verification result means only that no modeled checks failed. It does not establish that the setup or exported program is safe to machine.</div><p><strong>Geometry:</strong> closed, simple, disjoint or nested XY contours. Coordinates are quantized to 0.00001 mm. Valid machining tolerance is 0.002–0.5 mm. The offset kernel resolves raw-boundary intersections and reconstructs the offset region; ambiguous topology is rejected. Avoid features and gaps below 4× tolerance.</p><p><strong>Toolpaths:</strong> flat-bottom 2.5D operations with direct plunge entry, layered depths, and full-clearance linking. Pockets use clipped raster sweeps plus boundary passes. No helical entry, tabs, adaptive engagement, rest-machining optimization, or machine acceleration model.</p><p><strong>Collisions:</strong> continuous swept vertical cylinders for cutter, shank, and holder against axis-aligned fixtures. Shank and holder checks against original stock are conservative. Rapid-versus-stock tests and removed volume use only heightfield cell centers. Between-cell collisions, undercuts, conical drill tips, and full machine assemblies are not modeled.</p><p><strong>Post:</strong> generic metric, absolute XYZ, linear moves, G61, G40, optional G43 Hn, G54–G59, M3, M6 and M8/M9. No machine home move. The controller’s M6 motion and initial position are outside the verified stream. Set and verify real machine offsets independently.</p><p>The source package contains docs/VERIFICATION.md with the full numerical contract and docs/POSTPROCESSOR.md with the output specification.</p>` : `<p>A local-first CAD/CAM workstation. Every visible cutting path is generated from the editable project; stock removal is computed from that motion stream.</p><div class="help-grid"><kbd>Right drag</kbd><span>Orbit the 3D view. Shift + right drag pans.</span><kbd>Middle drag</kbd><span>Pan. Scroll wheel zooms around the cursor.</span><kbd>Click / Ctrl</kbd><span>Select a contour; Ctrl or Shift toggles multi-selection.</span><kbd>Wireframe</kbd><span>Create rectangles, circles, polygons, and drill points in XY.</span><kbd>Drag handles</kbd><span>Edit geometry in top view. Drag a selected entity to translate.</span><kbd>Alt</kbd><span>Disable 1 mm grid and endpoint snapping while editing.</span><kbd>Enter</kbd><span>Close the polygon currently being drawn.</span><kbd>Esc</kbd><span>Cancel sketch creation and return to selection.</span><kbd>F / 1 / 2</kbd><span>Fit / top view / isometric view.</span><kbd>F9</kbd><span>Regenerate and verify all enabled operations.</span><kbd>Space</kbd><span>Play or pause the feed-based stock simulation.</span><kbd>Ctrl Z / Y</kbd><span>Undo / redo transactional project edits.</span><kbd>Ctrl S / O</kbd><span>Export project JSON / open project JSON.</span><kbd>Delete</kbd><span>Delete selected geometry in geometry editing mode.</span></div><div class="notice info" style="margin-top:20px">Workflow: define stock and tools → draw and select contours → create operations → adjust depths and feeds → regenerate → inspect verification and simulation → review the generic post → export.</div><button class="button" data-action="limits">Read verification limits</button>`); }
function toggleDisplay(name) { if (!(name in renderer.options))
    return; renderer.options[name] = !renderer.options[name]; $$('[data-toggle]').forEach(b => b.classList.toggle('active', renderer.options[b.dataset.toggle])); $('#view-subheading').textContent = renderer.options.paths ? 'Toolpath overlay' : 'Solid model'; refreshScene(); }
function deleteGeometry() { if (!selected.size)
    return; const ids = new Set(selected); edit('Delete geometry', p => { p.geometry = p.geometry.filter(g => !ids.has(g.id)); for (const op of p.operations)
    op.geometryIds = op.geometryIds.filter(id => !ids.has(id)); }); selected.clear(); renderAll(); refreshScene(); }
function operationReorder(delta) { const index = getProject().operations.findIndex(o => o.id === selectedOp); if (index < 0 || index + delta < 0 || index + delta >= getProject().operations.length)
    return; edit('Reorder operation', p => { const [op] = p.operations.splice(index, 1); p.operations.splice(index + delta, 0, op); }); }
function saveProject() { persist(); download(fileName('axiomcam.json'), JSON.stringify(getProject(), null, 2)); notify('Editable project exported.'); }
function exportSketch() { const p = getProject(), s = p.stock; const markup = p.geometry.map(g => { if (g.type === 'circle')
    return `<circle cx="${g.cx}" cy="${g.cy}" r="${g.radius}"/>`; if (g.type === 'point')
    return `<circle cx="${g.x}" cy="${g.y}" r="0.5"/>`; return `<polygon points="${entityRing(g, p.tolerance).map(v => v.join(',')).join(' ')}"/>`; }).join('\n'); download(fileName('svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="${s.width}mm" height="${s.height}mm" viewBox="${s.x} ${s.y} ${s.width} ${s.height}"><g transform="translate(0 ${2 * s.y + s.height}) scale(1 -1)" fill="none" stroke="#223d51" stroke-width="0.15">${markup}</g></svg>`, 'image/svg+xml'); }
const actions = {
    'toggle-inspector': () => {
        if (inspectorMode === 'operation' && !selected.size) { notify('Select geometry to inspect.'); return; }
        inspectorMode = inspectorMode === 'operation' ? 'geometry' : 'operation';
        renderInspector(); refreshScene();
    },
    'generate': generate, 'cancel-generate': cancelGenerate, 'select': () => setMode('select'),
    'draw-rect': () => setMode('rect'), 'draw-circle': () => setMode('circle'), 'draw-polygon': () => setMode('polygon'), 'draw-point': () => setMode('point'), 'measure': () => setMode('measure'),
    'top': () => { renderer.setView('top'); refreshScene(); }, 'iso': () => { renderer.setView('iso'); refreshScene(); }, 'front': () => { renderer.setView('front'); refreshScene(); }, 'fit': () => renderer.fit(getProject()),
    'play': play, 'sim-reset': resetSimulation, 'sim-end': () => { if (!result)
        return; playing = false; seekTime(result.seconds); renderBottom(); }, 'sim-step': () => { if (!result)
        return; playing = false; seekTime(result.times[Math.min(cursor + 1, result.times.length - 1)]); renderBottom(); },
    'verify': () => { bottomTab = 'verification'; renderBottom(); if (!result || generatedRevision !== history.revision)
        generate(); },
    'setup': setupDialog, 'tools': toolsDialog, 'new-tool': () => toolDialog(null), 'fixtures': fixturesDialog, 'new-fixture': () => fixtureDialog(null),
    'add-face': () => addOperation('face'), 'add-pocket': () => addOperation('pocket'), 'add-profile': () => addOperation('profile'), 'add-drill': () => addOperation('drill'),
    'add-menu': () => showDialog('Create machining operation', `<div class="operation-add-grid">${[['face', 'Face stock', 'Planar stock cleanup with bidirectional sweeps.'], ['pocket', 'Pocket', 'Clear closed contours and preserve nested islands.'], ['profile', 'Contour', 'Inside, outside, or centerline compensation.'], ['drill', 'Drill', 'Explicit peck cycles at circles and points.']].map(([type, name, desc]) => `<button data-action="add-${type}"><strong>${symbols[type]} ${name}</strong><small>${desc}</small></button>`).join('')}</div>`),
    'assign-chains': () => { const op = selectedOperation(); if (op)
        edit('Assign operation contours', p => p.operations.find(o => o.id === op.id).geometryIds = [...selected]); },
    'clear-selection': () => { selected.clear(); renderManagers(); renderInspector(); refreshScene(); },
    'calculate-feeds': () => { const op = selectedOperation(), p = getProject(), tool = p.tools.find(t => t.id === op?.toolId); if (!op || !tool)
        return; try {
        const v = feedsAndSpeeds(tool, tool.vc, tool.chipload, p.machine.maxRPM);
        edit('Calculate feeds and speeds', p => Object.assign(p.operations.find(o => o.id === op.id), v));
    }
    catch (e) {
        notify(e.message, true);
    } },
    'op-up': () => operationReorder(-1), 'op-down': () => operationReorder(1), 'op-delete': () => { const id = selectedOp; if (!id)
        return; edit('Delete operation', p => p.operations = p.operations.filter(o => o.id !== id)); },
    'op-duplicate': () => { const op = selectedOperation(); if (!op)
        return; const copy = clone(op); copy.id = uid('op'); copy.name += ' copy'; selectedOp = copy.id; edit('Duplicate operation', p => p.operations.push(copy)); },
    'geo-delete': deleteGeometry, 'geo-duplicate': () => { if (!selected.size)
        return; const copies = getProject().geometry.filter(g => selected.has(g.id)).map(g => { g = clone(g); g.id = uid('geo'); g.name += ' copy'; transformEntity(g, 10, 10, 0, [0, 0]); return g; }); if (edit('Duplicate geometry', p => p.geometry.push(...copies))) {
        selected = new Set(copies.map(g => g.id));
        inspectorMode = 'geometry';
        renderAll();
        refreshScene();
    } },
    'transform': transformDialog, 'save': saveProject, 'open': () => { $('#file-input').value = ''; $('#file-input').click(); },
    'undo': () => { if (history.undo())
        changed(); }, 'redo': () => { if (history.redo())
        changed(); },
    'new': () => { if (!confirm('Start an empty project? Your current project stays in undo history; export it to keep a separate file.'))
        return; const p = demoProject(); p.name = 'Untitled machining project'; p.geometry = []; p.operations = []; history.replace(p); selected.clear(); selectedOp = null; inspectorMode = 'geometry'; closeDialog(); changed(); renderer.fit(p); },
    'demo': () => { if (!confirm('Load the demonstration mounting plate? Current state remains in undo history.'))
        return; history.replace(demoProject()); selectedOp = getProject().operations[1].id; selected = new Set(['pocket', 'island']); inspectorMode = 'operation'; closeDialog(); changed(); renderer.fit(getProject()); },
    'file': () => showDialog('Project files', `<p>Projects are stored locally in this browser. Export JSON to back up and transfer the complete editable setup. No account or remote service is used.</p><div class="file-actions"><button class="button" data-action="new">＋ New project</button><button class="button" data-action="open">Open project</button><button class="button primary" data-action="save">Export project</button><button class="button" data-action="demo">Load demo part</button><button class="button" data-action="export-sketch">Export sketch SVG</button></div>`),
    'post': postDialog, 'report': exportReport, 'export-sketch': exportSketch, 'help': () => helpDialog(false), 'limits': () => helpDialog(true), 'dialog-close': closeDialog
};
for (const key of Object.keys(renderer.options))
    actions[`toggle-${key}`] = () => toggleDisplay(key);
document.addEventListener('click', event => {
    const t = event.target;
    if (!(t instanceof Element))
        return;
    const action = t.closest('[data-action]');
    if (action) {
        event.preventDefault();
        try {
            actions[action.dataset.action]?.();
        }
        catch (e) {
            notify(e.message, true);
            console.error(e);
        }
        return;
    }
    const tab = t.closest('[data-tab]');
    if (tab) {
        ribbonTab = tab.dataset.tab;
        renderRibbon();
        return;
    }
    const bottom = t.closest('[data-bottom]');
    if (bottom) {
        bottomTab = bottom.dataset.bottom;
        renderBottom();
        return;
    }
    const toggle = t.closest('[data-toggle]');
    if (toggle) {
        toggleDisplay(toggle.dataset.toggle);
        return;
    }
    if (t.matches('[data-op-enabled],[data-geometry-visible]'))
        return;
    const op = t.closest('[data-op]');
    if (op) {
        chooseOperation(op.dataset.op);
        return;
    }
    const geo = t.closest('[data-geometry]');
    if (geo) {
        chooseGeometry(geo.dataset.geometry, event.ctrlKey || event.metaKey || event.shiftKey);
        return;
    }
    const tool = t.closest('[data-edit-tool]');
    if (tool) {
        toolDialog(tool.dataset.editTool);
        return;
    }
    const fixture = t.closest('[data-edit-fixture]');
    if (fixture) {
        fixtureDialog(fixture.dataset.editFixture);
        return;
    }
    const dt = t.closest('[data-delete-tool]');
    if (dt) {
        const id = dt.dataset.deleteTool;
        if (getProject().operations.some(o => o.toolId === id)) {
            notify('Reassign operations before deleting a referenced tool.', true);
            return;
        }
        if (edit('Delete tool', p => p.tools = p.tools.filter(t => t.id !== id)))
            toolsDialog();
        return;
    }
    const df = t.closest('[data-delete-fixture]');
    if (df) {
        if (edit('Delete fixture', p => p.fixtures = p.fixtures.filter(f => f.id !== df.dataset.deleteFixture)))
            fixturesDialog();
        return;
    }
    const sm = t.closest('[data-seek-move]');
    if (sm && result) {
        playing = false;
        seekTime(result.times[Number(sm.dataset.seekMove)]);
        if (bottomTab === 'blocks')
            renderBottom();
        return;
    }
    const so = t.closest('[data-seek-op]');
    if (so && result) {
        const op = result.operations.find(o => o.opId === so.dataset.seekOp);
        if (op) {
            playing = false;
            seekTime(result.times[op.start]);
            chooseOperation(op.opId);
        }
    }
});
document.addEventListener('change', event => {
    const el = event.target;
    try {
        if (el.matches('[data-op-field]')) {
            const id = selectedOp, key = el.dataset.opField;
            let value = el.type === 'checkbox' ? el.checked : el.type === 'number' ? el.valueAsNumber : el.value;
            if (key === 'clockwise')
                value = value === 'true';
            if (el.type === 'number' && !Number.isFinite(value))
                throw new Error('Enter a finite numeric value.');
            edit('Edit operation ' + key, p => p.operations.find(o => o.id === id)[key] = value);
        }
        else if (el.matches('[data-geo-field]')) {
            const id = [...selected][0], key = el.dataset.geoField, value = el.type === 'number' ? el.valueAsNumber : el.value;
            if (el.type === 'number' && !Number.isFinite(value))
                throw new Error('Enter a finite numeric value.');
            edit('Edit geometry ' + key, p => p.geometry.find(g => g.id === id)[key] = value);
        }
        else if (el.matches('[data-vertex]')) {
            const id = [...selected][0], index = Number(el.dataset.vertex), axis = Number(el.dataset.axis), value = el.valueAsNumber;
            if (!Number.isFinite(value))
                throw new Error('Enter a finite coordinate.');
            edit('Edit polygon vertex', p => p.geometry.find(g => g.id === id).points[index][axis] = value);
        }
        else if (el.matches('[data-op-enabled]'))
            edit('Enable / suppress operation', p => p.operations.find(o => o.id === el.dataset.opEnabled).enabled = el.checked);
        else if (el.matches('[data-geometry-visible]'))
            edit('Toggle geometry visibility', p => p.geometry.find(g => g.id === el.dataset.geometryVisible).visible = el.checked);
        else if (el.id === 'auto-regenerate') {
            autoRegenerate = el.checked;
            if (autoRegenerate && generatedRevision !== history.revision)
                scheduleGenerate();
        }
        else if (el.id === 'sim-speed')
            speed = Number(el.value);
    }
    catch (e) {
        notify(e.message, true);
        renderInspector();
    }
});
document.addEventListener('input', event => { if (event.target.id === 'timeline-slider' && result) {
    playing = false;
    seekTime(Number(event.target.value) / 1000 * result.seconds);
} });
$('#file-input').addEventListener('change', async (e) => { const file = e.target.files[0]; if (!file)
    return; try {
    if (file.size > 10 * 1024 * 1024)
        throw new Error('Project file exceeds 10 MiB.');
    const p = validateProject(JSON.parse(await file.text()));
    history.replace(p);
    selected.clear();
    selectedOp = p.operations[0]?.id || null;
    inspectorMode = 'operation';
    closeDialog();
    changed();
    renderer.fit(p);
    notify('Project restored. Toolpaths are regenerated from source geometry.');
}
catch (error) {
    notify(`Could not open project: ${error.message}`, true);
} });
function screenPoint(e) { const r = $('#overlay-canvas').getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function snappedWorld(e) {
    const [x, y] = screenPoint(e), p = renderer.unproject(x, y, getProject().stock.top);
    if (!p)
        return null;
    if (e.altKey)
        return p;
    let best = null, bestDistance = 8;
    for (const g of getProject().geometry.filter(g => g.visible !== false)) {
        const candidates = g.type === 'point' ? [[g.x, g.y]] : g.type === 'circle' ? [[g.cx, g.cy], [g.cx + g.radius, g.cy], [g.cx - g.radius, g.cy], [g.cx, g.cy + g.radius], [g.cx, g.cy - g.radius]] : g.type === 'rect' ? [[g.x, g.y], [g.x + g.width, g.y], [g.x + g.width, g.y + g.height], [g.x, g.y + g.height]] : g.points;
        for (const q of candidates) {
            const sp = renderer.project([...q, getProject().stock.top]), d = Math.hypot(x - sp[0], y - sp[1]);
            if (d < bestDistance) {
                bestDistance = d;
                best = q;
            }
        }
    }
    return best ? [...best] : p.map(v => Math.round(v));
}
function hitGeometry(x, y) {
    const p = renderer.unproject(x, y, getProject().stock.top);
    if (!p)
        return null;
    let best = null, bestD = 7, bestArea = Infinity, inside = null;
    for (const g of getProject().geometry.filter(g => g.visible !== false)) {
        if (g.type === 'point') {
            const q = renderer.project([g.x, g.y, getProject().stock.top]), d = Math.hypot(q[0] - x, q[1] - y);
            if (d < bestD) {
                bestD = d;
                best = g;
            }
            continue;
        }
        const ring = entityRing(g, Math.max(getProject().tolerance, .05));
        for (let i = 0; i < ring.length; i++) {
            const a = renderer.project([...ring[i], getProject().stock.top]), b = renderer.project([...ring[(i + 1) % ring.length], getProject().stock.top]), d = pointSegment([x, y], a, b).distance;
            if (d < bestD) {
                bestD = d;
                best = g;
            }
        }
        if (contains(p, ring)) {
            const bb = bounds([ring]), a = bb.width * bb.height;
            if (a < bestArea) {
                bestArea = a;
                inside = g;
            }
        }
    }
    return best || inside;
}
function updateDraft() {
    if (!drawPoints.length) {
        renderer.draft = null;
        renderer.dirty = true;
        return;
    }
    const end = hoverWorld || drawPoints.at(-1), start = drawPoints[0];
    if (mode === 'rect')
        renderer.draft = [...roundedRect(Math.min(start[0], end[0]), Math.min(start[1], end[1]), Math.max(.001, Math.abs(end[0] - start[0])), Math.max(.001, Math.abs(end[1] - start[1]))), [Math.min(start[0], end[0]), Math.min(start[1], end[1])]];
    else if (mode === 'circle') {
        const r = Math.max(.01, dist(start, end)), ring = circle(start[0], start[1], r, .1);
        renderer.draft = [...ring, ring[0]];
    }
    else
        renderer.draft = [...drawPoints, end];
    renderer.dirty = true;
}
function drawingClick(p) {
    if (mode === 'point') {
        addEntity({ type: 'point', name: `Drill point ${getProject().geometry.length + 1}`, x: p[0], y: p[1] });
        return;
    }
    if (mode === 'polygon') {
        if (!drawPoints.length || dist(p, drawPoints.at(-1)) > .001)
            drawPoints.push(p);
        updateDraft();
        return;
    }
    drawPoints.push(p);
    if (drawPoints.length < 2) {
        updateDraft();
        return;
    }
    const [a, b] = drawPoints;
    drawPoints = [];
    renderer.draft = null;
    if (mode === 'measure') {
        const distance = dist(a, b);
        $('#measure-result').textContent = `ΔX ${f(b[0] - a[0], 3)}  ΔY ${f(b[1] - a[1], 3)}  L ${f(distance, 3)} mm`;
        $('#measure-result').hidden = false;
        renderer.draft = [a, b];
        renderer.dirty = true;
        return;
    }
    if (dist(a, b) < .05) {
        notify('Geometry is too small.', true);
        return;
    }
    if (mode === 'rect')
        addEntity({ type: 'rect', name: `Rectangle ${getProject().geometry.length + 1}`, x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]), radius: 0 });
    if (mode === 'circle')
        addEntity({ type: 'circle', name: `Circle ${getProject().geometry.length + 1}`, cx: a[0], cy: a[1], radius: dist(a, b) });
    refreshScene();
}
const overlay = $('#overlay-canvas');
overlay.addEventListener('contextmenu', e => e.preventDefault());
overlay.addEventListener('pointerdown', e => {
    overlay.focus();
    const [x, y] = screenPoint(e);
    contextPoint = [x, y];
    if (e.button === 1 || e.button === 2) {
        e.preventDefault();
        drag = { type: e.button === 1 || e.shiftKey ? 'pan' : 'orbit', screen: [x, y], camera: clone(renderer.camera) };
        overlay.setPointerCapture(e.pointerId);
        return;
    }
    if (e.button !== 0)
        return;
    const p = snappedWorld(e);
    if (!p) {
        notify('Use Top or Isometric view to edit XY geometry.', true);
        return;
    }
    if (mode !== 'select') {
        drawingClick(p);
        return;
    }
    for (const h of entityHandles()) {
        const q = renderer.project([...h.p, getProject().stock.top]);
        if (Math.hypot(x - q[0], y - q[1]) < 9) {
            drag = { type: 'handle', handle: h, world: p, screen: [x, y], base: clone(getProject()), moved: false };
            overlay.setPointerCapture(e.pointerId);
            return;
        }
    }
    const hit = hitGeometry(x, y);
    if (hit) {
        const additive = e.ctrlKey || e.metaKey || e.shiftKey;
        if (additive || !selected.has(hit.id))
            chooseGeometry(hit.id, additive);
        else {
            inspectorMode = 'geometry';
            renderInspector();
            refreshScene();
        }
        if (!additive) {
            drag = { type: 'translate', world: p, screen: [x, y], base: clone(getProject()), moved: false };
            overlay.setPointerCapture(e.pointerId);
        }
    }
    else {
        selected.clear();
        renderManagers();
        renderInspector();
        refreshScene();
    }
});
overlay.addEventListener('pointermove', e => {
    const [x, y] = screenPoint(e), world = snappedWorld(e);
    hoverWorld = world;
    if (world)
        $('#coordinate-status').textContent = `X ${f(world[0], 3)}   Y ${f(world[1], 3)}   Z ${f(getProject().stock.top, 3)}`;
    if (!drag) {
        if (mode !== 'select')
            updateDraft();
        return;
    }
    const dx = x - drag.screen[0], dy = y - drag.screen[1];
    if (drag.type === 'orbit') {
        renderer.camera.az = drag.camera.az - dx * .008;
        renderer.camera.el = clamp(drag.camera.el + dy * .008, .05, Math.PI / 2);
        renderer.dirty = true;
        return;
    }
    if (drag.type === 'pan') {
        const { right, up } = renderer.basis();
        renderer.camera.target = drag.camera.target.map((v, i) => v - right[i] * dx / renderer.camera.scale + up[i] * dy / renderer.camera.scale);
        renderer.dirty = true;
        return;
    }
    if (!world || Math.hypot(dx, dy) < 3 && !drag.moved)
        return;
    drag.moved = true;
    transientProject = clone(drag.base);
    if (drag.type === 'translate') {
        const tx = world[0] - drag.world[0], ty = world[1] - drag.world[1];
        for (const g of transientProject.geometry.filter(g => selected.has(g.id)))
            transformEntity(g, tx, ty, 0, [0, 0]);
    }
    else {
        const g = transientProject.geometry.find(g => selected.has(g.id)), h = drag.handle;
        if (h.kind === 'vertex')
            g.points[h.index] = world;
        if (h.kind === 'center') {
            if (g.type === 'circle') {
                g.cx = world[0];
                g.cy = world[1];
            }
            else {
                g.x = world[0];
                g.y = world[1];
            }
        }
        if (h.kind === 'radius')
            g.radius = Math.max(.01, dist([g.cx, g.cy], world));
        if (h.kind === 'corner') {
            const corners = [[g.x, g.y], [g.x + g.width, g.y], [g.x + g.width, g.y + g.height], [g.x, g.y + g.height]], opp = corners[(h.index + 2) % 4];
            g.x = Math.min(opp[0], world[0]);
            g.y = Math.min(opp[1], world[1]);
            g.width = Math.max(.01, Math.abs(opp[0] - world[0]));
            g.height = Math.max(.01, Math.abs(opp[1] - world[1]));
            g.radius = Math.min(g.radius || 0, g.width / 2, g.height / 2);
        }
    }
    refreshScene();
});
function endDrag(e, cancel = false) { if (!drag)
    return; const previous = drag; drag = null; if (overlay.hasPointerCapture(e.pointerId))
    overlay.releasePointerCapture(e.pointerId); if (previous.moved && transientProject && !cancel) {
    const geometry = transientProject.geometry;
    transientProject = null;
    edit('Drag geometry', p => p.geometry = geometry);
    renderInspector();
}
else {
    transientProject = null;
    refreshScene();
} }
overlay.addEventListener('pointerup', e => endDrag(e));
overlay.addEventListener('pointercancel', e => endDrag(e, true));
overlay.addEventListener('dblclick', () => { if (mode === 'polygon')
    finishPolygon(); });
overlay.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = screenPoint(e), before = renderer.unproject(x, y, getProject().stock.top), factor = Math.exp(-e.deltaY * .001); renderer.camera.scale = clamp(renderer.camera.scale * factor, .05, 1000); const after = renderer.unproject(x, y, getProject().stock.top); if (before && after) {
    renderer.camera.target[0] += before[0] - after[0];
    renderer.camera.target[1] += before[1] - after[1];
} renderer.dirty = true; }, { passive: false });
document.addEventListener('keydown', e => {
    const typing = e.target instanceof Element && e.target.matches('input,textarea,select,[contenteditable]');
    if (typing)
        return;
    if ($('#dialog').open)
        return;
    const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    if (mod && key === 'z') {
        e.preventDefault();
        actions[e.shiftKey ? 'redo' : 'undo']();
        return;
    }
    if (mod && key === 'y') {
        e.preventDefault();
        actions.redo();
        return;
    }
    if (mod && key === 's') {
        e.preventDefault();
        saveProject();
        return;
    }
    if (mod && key === 'o') {
        e.preventDefault();
        actions.open();
        return;
    }
    if (e.key === 'F9') {
        e.preventDefault();
        generate();
    }
    else if (e.key === 'Escape') {
        setMode('select');
    }
    else if (e.key === 'Enter' && mode === 'polygon') {
        e.preventDefault();
        finishPolygon();
    }
    else if (e.code === 'Space') {
        e.preventDefault();
        play();
    }
    else if (key === 'f')
        renderer.fit(getProject());
    else if (key === '1')
        actions.top();
    else if (key === '2')
        actions.iso();
    else if (e.key === 'Delete' && inspectorMode === 'geometry')
        deleteGeometry();
});
async function start() { renderAll(); refreshScene(); await renderer.init(); renderer.fit(getProject()); generate(); if (restoreError)
    notify(restoreError, true); }
function animate(now) {
    const dt = lastFrame ? Math.min(.1, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (playing && result) {
        seekTime(simTime + dt * speed);
        if (simTime >= result.seconds) {
            playing = false;
            updateReadouts();
        }
    }
    if (renderer.field !== field) {
        renderer.field = field;
        renderer.lastFieldRevision = -1;
        renderer.rebuild = true;
        renderer.dirty = true;
    }
    renderer.draw();
    requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
start();
// A deliberately read-only diagnostics surface for automated integration tests.
Object.defineProperty(window, 'axiomcam', { value: Object.freeze({ snapshot: () => ({ project: clone(getProject()), result: result ? { moves: result.moves.length, operations: result.operations.length, seconds: result.seconds, cacheHits: result.cacheHits } : null, verification: verification ? { errors: verification.errors, issues: verification.issues, removed: verification.removed } : null, renderer: renderer.mode, busy, revision: history.revision, generatedRevision, selection: [...selected], simTime, playing, fieldRemoved: field.removed }), ready: () => !!result && !busy && generatedRevision === history.revision }), writable: false });
