import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const directory = fileURLToPath(new URL('../frontend/src/renderer/editing/', import.meta.url));
const modules = new Map();
function load(name, parent = directory) {
    const base = resolve(parent, name);
    const path = existsSync(base + '.ts') ? base + '.ts' : resolve(base, 'index.ts');
    if (modules.has(path)) return modules.get(path);
    const exports = {};
    modules.set(path, exports);
    vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText, { exports, console, require: name => load(name, dirname(path)) });
    return exports;
}
const { getTrackingSourceCandidates, getTrackingFollowers, buildFollowerTracking } = load('./tracking-sources');
const { normalizeObjectLock, resolveObjectLockTransform, mapObjectLockSampleToCanvas, splitObjectLockAtTime } = load('./object-lock');
const { resolveVisualState } = load('./visual-keyframes');
const transform = { scale: 1, position: { x: 0, y: 0 }, rotate: 0 };
const sample = (time, centerX) => ({ time, centerX, centerY: 0.4, width: 0.15, height: 0.25, confidence: 1 });
function source(extra = {}) {
    return { id: 'video', type: 'video', name: 'Source', mediaId: 'asset', startTime: 5, duration: 1,
        trimStart: 0, trimEnd: 0, transform, opacity: 1, ...extra };
}
function tracking(extra = {}) {
    return { version: 3, subjectCenter: false, enabled: true, mode: 'position', anchor: 'current', smoothing: 0,
        maxScale: 1.35, sourceSize: { width: 320, height: 180 }, fitCanvasSize: { width: 640, height: 360 },
        seed: sample(0, 0.25), samples: [sample(0, 0.25), sample(1, 0.75)], lostFrames: 0,
        sourceElementId: 'video', sourceElementName: 'Source', sourceTrackId: 'main', ...extra };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test('a single selected main video can be its own tracking source', () => {
    const video = source();
    const result = getTrackingSourceCandidates({ tracks: [{ id: 'main', type: 'video', isMain: true, elements: [video] }],
        assets: [{ id: 'asset', type: 'video' }], follower: video, followerTrackId: 'main' });
    assert.equal(result.length, 1);
    assert.equal(result[0].element.id, video.id);
});

test('overlay tracking still requires an overlapping video below it', () => {
    const video = source(), text = { id: 'text', type: 'text', startTime: 5, duration: 1 };
    const tracks = [{ id: 'text', type: 'text', elements: [text] }, { id: 'main', type: 'video', isMain: true, elements: [video] }];
    const input = { tracks, assets: [{ id: 'asset', type: 'video' }], follower: text, followerTrackId: 'text' };
    assert.equal(getTrackingSourceCandidates(input)[0].element.id, 'video');
    assert.equal(getTrackingSourceCandidates({ ...input, follower: { ...text, startTime: 7 } }).length, 0);
    assert.equal(getTrackingSourceCandidates({ ...input, assets: [] }).length, 0);
});

test('binding lists visible overlapping visual elements above the source', () => {
    const video = source();
    const text = { id: 'text', type: 'text', startTime: 5, duration: 1 };
    const image = { id: 'image', type: 'image', startTime: 5, duration: 1 };
    const tracks = [{ id: 'overlay', type: 'video', elements: [image, { ...image, id: 'hidden', hidden: true },
        { ...image, id: 'adjustment', mediaId: '__desktop_adjustment_layer__' }] },
        { id: 'text', type: 'text', elements: [text, { ...text, id: 'outside', startTime: 9 }] },
        { id: 'audio', type: 'audio', elements: [{ id: 'audio', type: 'audio', startTime: 5, duration: 1 }] },
        { id: 'main', type: 'video', isMain: true, elements: [video] }];
    assert.deepEqual(Array.from(getTrackingFollowers(tracks, video, 'main'), item => item.element.id), ['image', 'text']);
});

test('analyzing a target alone preserves the original video transform', () => {
    const value = tracking();
    assert.equal(resolveObjectLockTransform({ value, localTime: 0.5, timelineTime: 100, transform }), transform);
    assert.equal(normalizeObjectLock(JSON.parse(JSON.stringify(value))).version, 3);
});

test('subject centering compensates position, scale, rotation and flips using local time', () => {
    const value = tracking({ subjectCenter: true });
    for (const localTime of [0, 0.25, 1]) {
        for (const rotate of [0, 40, 90]) {
            const base = { scale: 1.7, position: { x: 35, y: -12 }, rotate, flipX: true, flipY: true };
            const result = resolveObjectLockTransform({ value, localTime, timelineTime: 20 + localTime, transform: base });
            const target = mapObjectLockSampleToCanvas({ sample: sample(localTime, 0.25 + localTime * 0.5),
                sourceSize: value.sourceSize, fitCanvasSize: value.fitCanvasSize, transform: result });
            near(target.centerX, 0.5);
            near(target.centerY, 0.5);
            assert.equal(result.scale, base.scale);
        }
    }
});

test('source tracks bind followers at the actual timeline time', () => {
    const value = tracking(), video = source({ objectLock: value });
    const bound = buildFollowerTracking(video, 'main', value);
    assert.equal(bound.version, 2);
    near(bound.samples[0].time, 5);
    near(bound.samples[1].time, 6);
    const follower = { startTime: 5, duration: 1, transform, opacity: 1, objectLock: bound };
    near(resolveVisualState({ source: follower, timelineTime: 5 }).transform.position.x, -160);
    near(resolveVisualState({ source: follower, timelineTime: 6 }).transform.position.x, 160);
});

test('followers stay on the target when subject centering is also enabled', () => {
    const value = tracking({ subjectCenter: true, smoothing: 55 });
    const bound = buildFollowerTracking(source(), 'main', value);
    for (const s of bound.samples) {
        near(s.centerX, 0.5);
        near(s.centerY, 0.5);
    }
});

test('splitting source tracking keeps right-hand sample times relative to the new clip', () => {
    const value = tracking({ subjectCenter: true });
    const split = splitObjectLockAtTime({ value, splitTime: 0.5 });
    near(split.rightObjectLock.samples[0].time, 0);
    near(split.rightObjectLock.samples[0].centerX, 0.5);
    near(split.rightObjectLock.samples.at(-1).time, 0.5);
    near(split.rightObjectLock.seed.centerX, 0.5);
    assert.equal(split.rightObjectLock.subjectCenter, true);
});

test('existing version 2 follower settings keep their transform behavior', () => {
    const value = { ...tracking(), version: 2, anchor: 'current', samples: [sample(5, 0.25), sample(6, 0.75)], seed: sample(5, 0.25) };
    const result = resolveObjectLockTransform({ value, localTime: 0, timelineTime: 6, transform });
    near(result.position.x, 320);
    near(result.position.y, 0);
});
