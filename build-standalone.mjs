/** Build a no-dependency, no-network single HTML distribution from the ES modules.
 * This build helper only rewrites this repository's constrained named-import form.
 * It is not a general JavaScript bundler. No third-party build tool is required.
 */
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('./', import.meta.url);
const order = ['geometry', 'project', 'cam', 'simulation', 'post', 'renderer'];
async function wrap(name) {
    let source = await readFile(new URL(`src/${name}.js`, root), 'utf8');
    const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/g)].map(m => m[1]);
    source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/(\w+)\.js['"];?/g, (_, names, dep) => `const {${names}} = __${dep};`);
    source = source.replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let)\b)/g, '');
    if (/\bimport\s*[{*]/.test(source))
        throw new Error(`Unhandled import in ${name}`);
    return `const __${name} = (() => {\n${source}\nreturn {${names.join(',')}};\n})();\n`;
}
const modules = await Promise.all(order.map(wrap));
let worker = await readFile(new URL('src/worker.js', root), 'utf8');
worker = worker.replace(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/(\w+)\.js['"];?/g, (_, names, dep) => `const {${names}} = __${dep};`);
const workerCode = modules.slice(0, 4).join('\n') + worker;
let app = await readFile(new URL('src/app.js', root), 'utf8');
app = app.replace(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/(\w+)\.js['"];?/g, (_, names, dep) => `const {${names}} = __${dep};`);
const workerConstructor = /new Worker\(\s*new URL\(\s*['"]\.\/worker\.js['"]\s*,\s*import\.meta\.url\s*\)\s*,\s*\{\s*type\s*:\s*['"]module['"]\s*\}\s*\)/;
if (!workerConstructor.test(app))
    throw new Error('Worker constructor was not found; standalone build stopped.');
app = app.replace(workerConstructor, "new Worker(__workerURL)");
let html = await readFile(new URL('index.html', root), 'utf8');
const css = await readFile(new URL('styles/app.css', root), 'utf8');
const source = modules.join('\n') + `\nconst __workerURL=URL.createObjectURL(new Blob([${JSON.stringify(workerCode)}],{type:'text/javascript'}));\n` + app;
html = html.replace('<link rel="stylesheet" href="styles/app.css">', () => `<style>${css}</style>`).replace('<script type="module" src="src/app.js"></script>', () => `<script type="module">${source.replace(/<\/script/gi, '<\\/script')}</script>`);
await writeFile(new URL('AxiomCAM.html', root), html);
console.log(`Built AxiomCAM.html: ${(Buffer.byteLength(html) / 1024).toFixed(1)} KiB, no external dependencies.`);
