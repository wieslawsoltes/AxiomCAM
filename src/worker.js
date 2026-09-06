import { generateProject } from './cam.js';
import { verifyProject } from './simulation.js';
const cache = new Map();
self.onmessage = event => {
    const { id, project } = event.data;
    try {
        const result = generateProject(project, cache, p => self.postMessage({ id, type: 'progress', ...p }));
        const verification = verifyProject(project, result);
        self.postMessage({ id, type: 'result', result, verification }, [result.times.buffer, verification.heights.buffer]);
    }
    catch (error) {
        self.postMessage({ id, type: 'error', message: error.message, stack: error.stack });
    }
};
