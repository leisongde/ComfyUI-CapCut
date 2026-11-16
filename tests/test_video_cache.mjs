import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const source = await readFile(new URL('../frontend/src/renderer/editing/adapters/video-cache.ts', import.meta.url), 'utf8');

function setup({ fps = 24, duration = 8, rounded = false } = {}) {
    const frames = Array.from({ length: fps * duration }, (_, index) => ({
        canvas: { width: 540, height: 304 },
        timestamp: rounded ? Math.round(index / fps * 1e6) / 1e6 : index / fps,
        duration: rounded ? Math.round(1 / fps * 1e6) / 1e6 : 1 / fps,
    }));
    const stats = { seeks: 0, reads: 0 };
    class CanvasSink {
        async *canvases(time) {
            stats.seeks++;
            let start = frames.findLastIndex(frame => frame.timestamp <= time);
            for (let index = Math.max(0, start); index < frames.length; index++) {
                stats.reads++;
                await Promise.resolve();
                yield frames[index];
            }
        }
    }
    class Input {
        async getPrimaryVideoTrack() {
            return { displayWidth: 1920, displayHeight: 1080, canDecode: async () => true,
                computePacketStats: async () => ({ averagePacketRate: fps }) };
        }
        dispose() {}
    }
    const exports = {};
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText, { exports, console, require: name => {
        if (name === 'mediabunny') return { CanvasSink, Input, BlobSource: class {}, ALL_FORMATS: [] };
        if (name === './reverse-frame-cache') return {};
        throw new Error(`Unexpected import: ${name}`);
    } });
    const cache = new exports.VideoCache();
    const file = {};
    return { stats, frames, cache, get: time => cache.getFrameAt({ mediaId: 'video', file, time, maxDimension: 540 }) };
}

test('continuous playback keeps the decoder after a dropped frame beyond two seconds', async () => {
    const { get, stats } = setup();
    for (let index = 0; index <= 96; index++) await get(index / 24 + 0.005);
    const frame = await get(4.2);
    assert.equal(frame.timestamp, 100 / 24);
    assert.equal(stats.seeks, 1);
});

test('rounded timestamps hold the preceding frame without decoding into the future', async () => {
    const { get, stats, frames } = setup({ fps: 30, rounded: true });
    for (let index = 0; index < 120; index++) {
        const time = index / 30;
        const frame = await get(time);
        assert.equal(frame.timestamp, frames.findLast(frame => frame.timestamp <= time).timestamp);
    }
    assert.equal(stats.seeks, 1);
    assert.ok(stats.reads <= 122, `Decoded ${stats.reads} frames for 120 requests`);
});

test('seeking backwards and forwards still returns the requested frame', async () => {
    const { get, cache } = setup();
    for (const time of [0, 4.21, 0.21, 6.21, 1.21, 1.22]) {
        const frame = await get(time);
        assert.equal(frame.timestamp, Math.floor(time * 24) / 24);
    }
    assert.ok(cache.getStats().cachedFrames <= 2);
    cache.clearAll();
    assert.equal(cache.getStats().totalSinks, 0);
});
