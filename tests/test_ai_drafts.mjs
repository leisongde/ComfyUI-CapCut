import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const frontend = new URL('../frontend/', import.meta.url);
const editing = new URL('src/renderer/editing/', frontend);
const empty = () => ({ schemaVersion: 1, scenes: [], assetMap: {}, trackCount: 2 });
const values = { duration: 5.17, prompt: '雨后街道', system_prompt: '不要背景音乐', prompt_api_key: 'session-only-key' };

async function setup(draftValues = values, options = {}) {
    let finish, fail, report, submitted;
    const requested = new Promise(resolve => { submitted = resolve; });
    const result = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    const calls = [], assets = [];
    const context = vm.createContext({ crypto: options.crypto ?? globalThis.crypto, File, Uint8Array, CustomEvent,
        Math: options.random ? Object.assign(Object.create(Math), { random: options.random }) : Math,
        window: { dispatchEvent() {} }, console });
    const mocks = {
        [new URL('bridge.ts', editing).href]: { request: async (operation, payload, transfer, timeout, progress) => {
            calls.push({ operation, payload });
            if (operation === 'capcut:workflows') return options.modules ?? [{ id: 'module', nodeType: 'CapCutMiniMaxH3Workflow', fields: [] }];
            if (operation === 'capcut:minimax-key:get') return { key: options.key ?? 'session-only-key' };
            if (operation === 'capcut:motion-transfer-key:get') return { key: options.motionKey ?? '' };
            if (operation === 'capcut:run-workflow') { report = progress; submitted(); return options.onRun ? options.onRun(payload) : result; }
            if (operation === 'capcut:concat-ai-shots') return options.onConcat(payload);
            if (operation === 'capcut:shot-guide-file') return options.onResolveGuide(payload);
            assert.equal(operation, 'capcut:import-result');
            if (options.onImport) await options.onImport(payload);
            return { name: 'result.mp4', bytes: new Uint8Array([1]), mimeType: 'video/mp4' };
        } },
        [new URL('adapters/storage.ts', editing).href]: { nativeStorageState: { error: null } },
        '@/lib/media/processing': { processMediaAssets: async () => [{ type: 'video', name: 'result.mp4', duration: 5.8 }] },
        '@/constants/text-constants': { DEFAULT_TEXT_ELEMENT: {} },
        '@/constants/timeline-constants': { TIMELINE_CONSTANTS: { DEFAULT_ELEMENT_DURATION: 5 }, TRACK_COLORS: {}, TRACK_HEIGHTS: {}, TRACK_GAP: 4 },
        sonner: { toast: { success() {}, warning: (...args) => options.onWarning?.(...args) } },
        mediabunny: { ALL_FORMATS: [], BlobSource: class {}, Input: class { async getPrimaryAudioTrack() { return options.hasAudio ?? true; } dispose() {} } },
    };
    const modules = new Map();
    const load = (specifier, parent = new URL('text-to-video.ts', editing).href) => {
        const key = Object.hasOwn(mocks, specifier) ? specifier : specifier.startsWith('@/')
            ? new URL(`vendor/cutia/apps/web/src/${specifier.slice(2)}.ts`, frontend).href
            : new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, parent).href;
        if (modules.has(key)) return modules.get(key);
        const pending = (async () => {
            if (mocks[key]) return new vm.SyntheticModule(Object.keys(mocks[key]), function () {
                for (const [name, value] of Object.entries(mocks[key])) this.setExport(name, value);
            }, { context, identifier: key });
            const source = await readFile(fileURLToPath(key), 'utf8');
            return new vm.SourceTextModule(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext,
                target: ts.ScriptTarget.ES2022 } }).outputText, { context, identifier: key });
        })();
        modules.set(key, pending);
        return pending;
    };
    const module = await load('./text-to-video', new URL('entry.ts', editing).href);
    await module.link((specifier, parent) => load(specifier, parent.identifier));
    await module.evaluate();
    let project = { metadata: { id: 'project' }, settings: { fps: 24 }, directorPlanning: empty() };
    let tracks = [{ id: 'main', type: 'video', isMain: true, elements: [] }];
    const editor = {
        project: { getActive: () => project, getActiveOrNull: () => project, setActiveProject: value => { project = value.project; } },
        timeline: { getTracks: () => tracks, updateTracks: value => { tracks = value; } },
        save: { markDirty() {}, flush: async () => { if (options.onSave) await options.onSave(); } },
        media: { getAssets: () => options.media ?? [], addMediaAsset: async value => { if (options.onAdd) await options.onAdd(value); assets.push(value); return 'generated-asset'; } },
    };
    const api = module.namespace;
    const draft = api.saveTextToVideoDraft(empty(), { startTime: 2, trackIndex: 1 }, draftValues);
    project.directorPlanning = draft;
    const shotId = draft.selectedShotId;
    return { api, editor, calls, assets, requested, shotId, finish: () => finish([{ filename: 'result.mp4' }]), fail,
        report: value => report(value), shot: () => project.directorPlanning.scenes.flatMap(scene => scene.shots).find(shot => shot.id === shotId),
        planning: () => project.directorPlanning, setPlanning: value => { project.directorPlanning = value; },
        switchProject: () => { project = { ...project, metadata: { id: 'other-project' }, directorPlanning: empty() }; } };
}

test('completion saves a draft without a key, media, or a queued workflow', async () => {
    const env = await setup();
    assert.equal(env.shot().duration, 5.17);
    assert.equal(env.shot().startTime, 2);
    assert.equal(env.shot().generationStatus, 'idle');
    assert.equal(env.planning().scenes[0].settings.prompt, values.prompt);
    assert.ok(!JSON.stringify(env.planning()).includes(values.prompt_api_key));
    assert.equal(env.calls.length, 0);
    assert.equal(env.editor.timeline.getTracks()[0].elements.length, 0);
});

test('AI drafts and generation results work without crypto.randomUUID over LAN HTTP', async () => {
    const env = await setup(values, { crypto: { getRandomValues: bytes => globalThis.crypto.getRandomValues(bytes) } });
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', values);
    await env.requested;
    env.finish();
    await task;
    assert.equal(env.shot().generationStatus, 'succeeded');
    assert.equal(env.shot().outputVersions.length, 1);
    assert.equal(env.editor.timeline.getTracks().flatMap(track => track.elements)[0].mediaId, 'generated-asset');
});

test('moving and resizing keep 4–15 seconds, fix the opposite edge, and synchronize all duration fields', async () => {
    const { api, shotId, planning } = await setup();
    const left = api.textToVideoPlacement(2, 5.17, -100, 'left');
    assert.equal(left.startTime, 0);
    assert.equal(left.duration, 7.17);
    assert.equal(api.textToVideoPlacement(2, 5.17, 100, 'right').duration, 15);
    assert.equal(api.textToVideoPlacement(2, 5.17, -100, 'right').duration, 4);
    assert.equal(api.textToVideoPlacement(2, 5.17, -100, 'move').startTime, 0);
    const next = api.updateTextToVideoTiming(planning(), shotId, { startTime: 4.25, duration: 6.18 });
    const shot = next.scenes[0].shots[0];
    assert.equal(shot.startTime, 4.25);
    assert.equal(shot.duration, 6.18);
    assert.equal(shot.targetDuration, 6.18);
    assert.equal(shot.sourceSnapshot.duration, 6.18);
    assert.equal(next.scenes[0].settings.duration, 6.18);
});

test('editing reuses the same AI shot and duration participates in collision avoidance', async () => {
    const { api, shotId, planning } = await setup();
    const edited = api.saveTextToVideoDraft(planning(), { startTime: 999, trackIndex: 0 }, { ...values, duration: 4 }, shotId);
    assert.equal(edited.scenes.length, 1);
    assert.equal(edited.scenes[0].shots[0].id, shotId);
    assert.equal(edited.scenes[0].shots[0].startTime, 2);
    const adjacent = api.saveTextToVideoDraft(edited, { startTime: 6, trackIndex: 1 }, { ...values, duration: 15 });
    assert.equal(adjacent.scenes[1].shots[0].trackIndex, 1);
    const overlapping = api.saveTextToVideoDraft(edited, { startTime: 5, trackIndex: 1 }, values);
    assert.equal(overlapping.scenes[1].shots[0].trackIndex, 0);
});

test('moving to an existing AI row removes the emptied source without changing time or generation results', async () => {
    const env = await setup();
    const original = env.shot();
    original.generationStatus = 'succeeded';
    original.generationId = 'completed-generation';
    original.linkedVideoElementId = 'generated-video';
    const before = env.api.saveTextToVideoDraft(env.planning(), { startTime: 10, trackIndex: 0 }, values);
    const next = env.api.updateTextToVideoTiming(before, env.shotId, { startTime: 2, duration: 5.17, trackIndex: 0 });
    assert.equal(next.trackCount, 1);
    const shots = next.scenes.flatMap(scene => scene.shots);
    assert.ok(shots.every(shot => shot.trackIndex === 0));
    assert.equal(shots.find(shot => shot.id === env.shotId).generationId, original.generationId);
    assert.equal(shots.find(shot => shot.id === env.shotId).linkedVideoElementId, original.linkedVideoElementId);
    assert.equal(shots.find(shot => shot.id === env.shotId).startTime, 2);
    assert.equal(before.scenes[0].shots[0].trackIndex, 1);
    assert.equal(before.trackCount, 2);
    assert.equal(JSON.parse(JSON.stringify(next)).trackCount, 1);
});

test('moving out to a new bottom row retains occupied source rows and unrelated empty rows', async () => {
    const env = await setup();
    const before = env.api.saveTextToVideoDraft(env.planning(), { startTime: 10, trackIndex: 1 }, values);
    const next = env.api.updateTextToVideoTiming(before, env.shotId, { startTime: 2, duration: 5.17, trackIndex: 2 });
    assert.equal(next.trackCount, 3);
    assert.equal(next.scenes[0].shots[0].trackIndex, 2);
    assert.equal(next.scenes[1].shots[0].trackIndex, 1);
    const movedBack = env.api.updateTextToVideoTiming(next, env.shotId, { startTime: 2, duration: 5.17, trackIndex: 1 });
    assert.equal(movedBack.trackCount, 2);
    assert.ok(movedBack.scenes.every(scene => scene.shots[0].trackIndex === 1));
});

test('moving above the first row inserts a row and removes the old source with correct indexes', async () => {
    const env = await setup();
    const before = env.api.saveTextToVideoDraft(env.planning(), { startTime: 10, trackIndex: 0 }, values);
    const next = env.api.updateTextToVideoTiming(before, env.shotId, { startTime: 2, duration: 5.17, trackIndex: -1 });
    assert.equal(next.trackCount, 2);
    assert.equal(next.scenes[0].shots[0].trackIndex, 0);
    assert.equal(next.scenes[1].shots[0].trackIndex, 1);
});

test('cross-row drops still separate overlapping shots and clean the emptied source', async () => {
    const env = await setup();
    const before = env.api.saveTextToVideoDraft(env.planning(), { startTime: 2, trackIndex: 0 }, values);
    const next = env.api.updateTextToVideoTiming(before, env.shotId, { startTime: 2, duration: 5.17, trackIndex: 0 });
    assert.equal(next.trackCount, 2);
    assert.equal(next.scenes[0].shots[0].trackIndex, 0);
    assert.equal(next.scenes[1].shots[0].trackIndex, 1);
    assert.ok(next.scenes.every(scene => scene.shots[0].duration === 5.17));
});

test('generation reserves a video slot immediately, reports progress, and replaces that exact slot', async () => {
    const env = await setup();
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', values);
    const slot = env.editor.timeline.getTracks().flatMap(track => track.elements)[0];
    assert.equal(slot.startTime, 2);
    assert.equal(slot.duration, 5.17);
    assert.equal(env.shot().generationStatus, 'queued');
    await env.requested;
    env.report({ status: 'running', percent: 50, stage: '视频采样' });
    assert.equal(env.api.getTextToVideoSlot(env.editor, env.shotId).progress, 50);
    assert.equal(env.shot().generationStatus, 'running');
    assert.equal(env.calls[0].payload.values.duration, 5.17);
    env.finish();
    await task;
    const video = env.editor.timeline.getTracks().flatMap(track => track.elements)[0];
    assert.equal(video.id, slot.id);
    assert.equal(video.startTime, slot.startTime);
    assert.equal(video.mediaId, 'generated-asset');
    assert.equal(video.duration, 5.8);
    assert.equal(video.directorGeneration, undefined);
    assert.equal(env.shot().generationStatus, 'succeeded');
    assert.equal(env.shot().outputVersions.length, 1);
    assert.equal(env.shot().duration, 5.17);
});

test('a failed task keeps a retryable placeholder with its error', async () => {
    const env = await setup();
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', values);
    await env.requested;
    env.fail(new Error('模型加载失败'));
    await assert.rejects(task, /模型加载失败/);
    assert.equal(env.shot().generationStatus, 'failed');
    assert.equal(env.api.getTextToVideoSlot(env.editor, env.shotId).error, '模型加载失败');
});

test('image drafts preserve the uploaded first frame through reopening, editing and resizing', async () => {
    const imageValues = { ...values, task_type: 'I2VA', first_frame: 'uploaded-image' };
    const env = await setup(imageValues);
    const saved = JSON.parse(JSON.stringify(env.planning()));
    const edited = env.api.saveTextToVideoDraft(saved, { startTime: 99, trackIndex: 0 }, { ...imageValues, prompt: '镜头推进' }, env.shotId);
    const resized = env.api.updateTextToVideoTiming(edited, env.shotId, { startTime: 3, duration: 9 });
    const shot = resized.scenes[0].shots[0];
    assert.equal(shot.taskType, 'i2v');
    assert.equal(shot.title, '图生视频');
    assert.equal(shot.imageAssetId, 'uploaded-image');
    assert.equal(shot.sourceSnapshot.imageAssetId, 'uploaded-image');
    assert.equal(resized.scenes[0].settings.first_frame, 'uploaded-image');
    assert.equal(resized.scenes[0].settings.task_type, 'I2VA');
    assert.equal(resized.scenes[0].settings.duration, 9);
    assert.ok(!JSON.stringify(resized).includes(values.prompt_api_key));
    assert.equal(env.calls.length, 0);
});

test('image generation submits only its first frame and replaces the reserved video slot', async () => {
    const imageValues = { ...values, task_type: 'I2VA', first_frame: 'uploaded-image', last_frame: 'stale-tail', ref_images: ['stale-reference'] };
    const env = await setup(imageValues);
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', imageValues);
    const slot = env.editor.timeline.getTracks().flatMap(track => track.elements)[0];
    assert.equal(slot.name, '图生视频');
    await env.requested;
    const submitted = env.calls[0].payload.values;
    assert.equal(submitted.task_type, 'I2VA');
    assert.equal(submitted.first_frame, 'uploaded-image');
    assert.equal(submitted.last_frame, '');
    assert.equal(submitted.ref_images.length, 0);
    env.report({ status: 'running', percent: 75, stage: '视频采样 6/8 步' });
    assert.equal(env.api.getTextToVideoSlot(env.editor, env.shotId).progress, 75);
    env.finish();
    await task;
    const video = env.editor.timeline.getTracks().flatMap(track => track.elements)[0];
    assert.equal(video.id, slot.id);
    assert.equal(video.name, '图生视频');
    assert.equal(video.mediaId, 'generated-asset');
    assert.equal(env.shot().generationStatus, 'succeeded');
});

test('image generation requires a first frame and disconnected image tasks remain retryable', async () => {
    const imageValues = { ...values, task_type: 'I2VA', first_frame: '' };
    const env = await setup(imageValues);
    await assert.rejects(env.api.generateTextToVideo(env.editor, env.shotId, 'module', imageValues), /首帧图片/);
    assert.equal(env.calls.length, 0);
    assert.equal(env.editor.timeline.getTracks()[0].elements.length, 0);
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', { ...imageValues, first_frame: 'image' });
    await env.requested;
    const reopened = await setup(imageValues);
    reopened.setPlanning(structuredClone(env.planning()));
    reopened.editor.timeline.updateTracks(structuredClone(env.editor.timeline.getTracks()));
    reopened.api.recoverTextToVideoGenerations(reopened.editor);
    assert.equal(reopened.planning().scenes[0].shots[0].generationStatus, 'failed');
    assert.equal(reopened.api.getTextToVideoSlot(reopened.editor, env.shotId).status, 'failed');
    env.finish();
    await task;
});

test('first and last frame drafts preserve both images through reopening, editing and resizing', async () => {
    const frameValues = { ...values, task_type: 'FL2VA', first_frame: 'first-image', last_frame: 'last-image' };
    const env = await setup(frameValues);
    const saved = JSON.parse(JSON.stringify(env.planning()));
    const edited = env.api.saveTextToVideoDraft(saved, { startTime: 99, trackIndex: 0 }, { ...frameValues, prompt: '从首帧平滑过渡到尾帧' }, env.shotId);
    const resized = env.api.updateTextToVideoTiming(edited, env.shotId, { startTime: 4, duration: 12 });
    const shot = resized.scenes[0].shots[0];
    assert.equal(shot.taskType, 'fl2v');
    assert.equal(shot.title, '首尾帧生视频');
    assert.equal(shot.firstFrameAssetId, 'first-image');
    assert.equal(shot.lastFrameAssetId, 'last-image');
    assert.equal(shot.sourceSnapshot.firstFrameAssetId, 'first-image');
    assert.equal(shot.sourceSnapshot.lastFrameAssetId, 'last-image');
    assert.equal(resized.scenes[0].settings.first_frame, 'first-image');
    assert.equal(resized.scenes[0].settings.last_frame, 'last-image');
    assert.equal(resized.scenes[0].settings.task_type, 'FL2VA');
    assert.equal(resized.scenes[0].settings.duration, 12);
    assert.ok(!JSON.stringify(resized).includes(values.prompt_api_key));
    assert.equal(env.calls.length, 0);
});

test('first and last frame generation submits both images and replaces its own video slot', async () => {
    const frameValues = { ...values, task_type: 'FL2VA', first_frame: 'first-image', last_frame: 'last-image', ref_videos: ['stale-video'] };
    const env = await setup(frameValues);
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', frameValues);
    const slot = env.editor.timeline.getTracks().flatMap(track => track.elements)[0];
    assert.equal(slot.name, '首尾帧生视频');
    await env.requested;
    const submitted = env.calls[0].payload.values;
    assert.equal(submitted.task_type, 'FL2VA');
    assert.equal(submitted.first_frame, 'first-image');
    assert.equal(submitted.last_frame, 'last-image');
    assert.equal(submitted.ref_videos.length, 0);
    env.report({ status: 'running', percent: 50, stage: '视频采样 4/8 步' });
    assert.equal(env.api.getTextToVideoSlot(env.editor, env.shotId).progress, 50);
    env.finish();
    await task;
    const video = env.editor.timeline.getTracks().flatMap(track => track.elements)[0];
    assert.equal(video.id, slot.id);
    assert.equal(video.name, '首尾帧生视频');
    assert.equal(video.mediaId, 'generated-asset');
    assert.equal(env.shot().generationStatus, 'succeeded');
});

test('first and last frame generation requires both images and recovers disconnected tasks', async () => {
    const frameValues = { ...values, task_type: 'FL2VA', first_frame: 'first-image', last_frame: 'last-image' };
    const env = await setup(frameValues);
    for (const [name, message] of [['first_frame', /首帧图片/], ['last_frame', /尾帧图片/]])
        await assert.rejects(env.api.generateTextToVideo(env.editor, env.shotId, 'module', { ...frameValues, [name]: '' }), message);
    assert.equal(env.calls.length, 0);
    assert.equal(env.editor.timeline.getTracks()[0].elements.length, 0);
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', frameValues);
    await env.requested;
    const reopened = await setup(frameValues);
    reopened.setPlanning(structuredClone(env.planning()));
    reopened.editor.timeline.updateTracks(structuredClone(env.editor.timeline.getTracks()));
    reopened.api.recoverTextToVideoGenerations(reopened.editor);
    assert.equal(reopened.planning().scenes[0].shots[0].generationStatus, 'failed');
    assert.equal(reopened.api.getTextToVideoSlot(reopened.editor, env.shotId).status, 'failed');
    env.finish();
    await task;
});

test('reference drafts preserve ordered image, audio and video assets through editing and resizing', async () => {
    const referenceValues = { ...values, task_type: 'Ref2VA', ref_images: ['image-a', 'image-b'], ref_audios: ['voice'], ref_videos: ['video-a', 'video-b'] };
    const env = await setup(referenceValues);
    const saved = JSON.parse(JSON.stringify(env.planning()));
    const edited = env.api.saveTextToVideoDraft(saved, { startTime: 99, trackIndex: 0 }, { ...referenceValues, ref_images: ['image-b'] }, env.shotId);
    const resized = env.api.updateTextToVideoTiming(edited, env.shotId, { startTime: 4, duration: 12 });
    const shot = resized.scenes[0].shots[0];
    assert.equal(shot.taskType, 'r2v');
    assert.equal(shot.title, '多参考生视频');
    assert.equal(shot.refs.length, 1);
    assert.equal(shot.refs[0].assetId, 'image-b');
    assert.equal(shot.refs[0].index, 0);
    assert.equal(shot.refAudios[0].assetId, 'voice');
    assert.equal(shot.refVideos[1].assetId, 'video-b');
    assert.equal(shot.sourceSnapshot.refVideos[1].assetId, 'video-b');
    assert.equal(resized.scenes[0].settings.task_type, 'Ref2VA');
    assert.equal(resized.scenes[0].settings.ref_images[0], 'image-b');
    assert.equal(resized.scenes[0].settings.duration, 12);
    assert.ok(!JSON.stringify(resized).includes(values.prompt_api_key));
    assert.equal(env.calls.length, 0);
});

test('reference generation submits ordered references, reports progress and replaces its own slot', async () => {
    const referenceValues = { ...values, task_type: 'Ref2VA', ref_images: ['image-a', 'image-b'], ref_audios: ['voice'], ref_videos: ['video'],
        first_frame: 'stale-first', last_frame: 'stale-last', drive_audio: 'stale-drive', final_audio: 'stale-final' };
    const env = await setup(referenceValues);
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', referenceValues);
    const slot = env.editor.timeline.getTracks().flatMap(track => track.elements)[0];
    assert.equal(slot.name, '多参考生视频');
    await env.requested;
    const submitted = env.calls[0].payload.values;
    assert.equal(submitted.task_type, 'Ref2VA');
    for (const name of ['first_frame', 'last_frame', 'drive_audio', 'final_audio']) assert.equal(submitted[name], '');
    assert.deepEqual(Array.from(submitted.ref_images), ['image-a', 'image-b']);
    assert.deepEqual(Array.from(submitted.ref_audios), ['voice']);
    assert.deepEqual(Array.from(submitted.ref_videos), ['video']);
    env.report({ status: 'running', percent: 50, stage: '视频采样 4/8 步' });
    assert.equal(env.api.getTextToVideoSlot(env.editor, env.shotId).progress, 50);
    env.finish();
    await task;
    const video = env.editor.timeline.getTracks().flatMap(track => track.elements)[0];
    assert.equal(video.id, slot.id);
    assert.equal(video.mediaId, 'generated-asset');
    assert.equal(env.shot().generationStatus, 'succeeded');
});

test('reference generation permits an empty draft, requires media to run and recovers disconnected tasks', async () => {
    const referenceValues = { ...values, task_type: 'Ref2VA', ref_images: [], ref_audios: [], ref_videos: [] };
    const env = await setup(referenceValues);
    assert.equal(env.shot().taskType, 'r2v');
    await assert.rejects(env.api.generateTextToVideo(env.editor, env.shotId, 'module', referenceValues), /至少上传一项/);
    assert.equal(env.calls.length, 0);
    assert.equal(env.editor.timeline.getTracks()[0].elements.length, 0);
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', { ...referenceValues, ref_audios: ['voice'] });
    await env.requested;
    const reopened = await setup(referenceValues);
    reopened.setPlanning(structuredClone(env.planning()));
    reopened.editor.timeline.updateTracks(structuredClone(env.editor.timeline.getTracks()));
    reopened.api.recoverTextToVideoGenerations(reopened.editor);
    assert.equal(reopened.planning().scenes[0].shots[0].generationStatus, 'failed');
    assert.equal(reopened.api.getTextToVideoSlot(reopened.editor, env.shotId).status, 'failed');
    env.finish();
    await task;
});

test('video edit drafts keep one source video and preserve prompts through editing and resizing', async () => {
    const editValues = { ...values, task_type: 'V2VA', prompt: '把 <Video 1> 的背景改成雪景', ref_videos: ['source-a', 'stale-second'], ref_images: ['stale-image'], ref_audios: ['stale-audio'] };
    const env = await setup(editValues);
    assert.equal(env.shot().taskType, 'v2v');
    assert.equal(env.shot().title, '视频编辑');
    assert.equal(env.shot().refVideos.length, 1);
    assert.equal(env.shot().refVideos[0].assetId, 'source-a');
    assert.equal(env.shot().refs.length, 0);
    assert.equal(env.shot().refAudios.length, 0);
    const reopened = JSON.parse(JSON.stringify(env.planning()));
    const edited = env.api.saveTextToVideoDraft(reopened, { startTime: 99, trackIndex: 0 }, { ...editValues, ref_videos: ['source-b'] }, env.shotId);
    const resized = env.api.updateTextToVideoTiming(edited, env.shotId, { startTime: 4, duration: 12 });
    const shot = resized.scenes[0].shots[0];
    assert.equal(shot.sourceSnapshot.refVideos[0].assetId, 'source-b');
    assert.equal(shot.prompt, editValues.prompt);
    assert.equal(resized.scenes[0].settings.system_prompt, values.system_prompt);
    assert.equal(resized.scenes[0].settings.task_type, 'V2VA');
    assert.deepEqual(Array.from(resized.scenes[0].settings.ref_videos), ['source-b']);
    assert.equal(resized.scenes[0].settings.duration, 12);
    assert.ok(!JSON.stringify(resized).includes(values.prompt_api_key));
    assert.equal(env.calls.length, 0);
});

test('video editing submits only video 1, reports progress and replaces the reserved slot', async () => {
    const editValues = { ...values, task_type: 'V2VA', prompt: '编辑 <Video 1> 的背景', ref_videos: ['source-video', 'stale-second'],
        ref_images: ['stale-image'], ref_audios: ['stale-audio'], first_frame: 'stale-first', last_frame: 'stale-last', drive_audio: 'stale-drive', final_audio: 'stale-final' };
    const env = await setup(editValues);
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', editValues);
    const slot = env.editor.timeline.getTracks().flatMap(track => track.elements)[0];
    assert.equal(slot.name, '视频编辑');
    await env.requested;
    const submitted = env.calls[0].payload.values;
    assert.equal(submitted.task_type, 'V2VA');
    assert.equal(submitted.prompt, editValues.prompt);
    assert.equal(submitted.system_prompt, values.system_prompt);
    assert.deepEqual(Array.from(submitted.ref_videos), ['source-video']);
    for (const name of ['ref_images', 'ref_audios']) assert.equal(submitted[name].length, 0);
    for (const name of ['first_frame', 'last_frame', 'drive_audio', 'final_audio']) assert.equal(submitted[name], '');
    env.report({ status: 'running', percent: 50, stage: '视频采样 4/8 步' });
    assert.equal(env.api.getTextToVideoSlot(env.editor, env.shotId).progress, 50);
    env.finish();
    await task;
    const video = env.editor.timeline.getTracks().flatMap(track => track.elements)[0];
    assert.equal(video.id, slot.id);
    assert.equal(video.name, '视频编辑');
    assert.equal(video.mediaId, 'generated-asset');
    assert.equal(env.shot().generationStatus, 'succeeded');
});

test('video editing permits empty drafts, requires video 1 to run and recovers disconnected requests', async () => {
    const editValues = { ...values, task_type: 'V2VA', ref_videos: [], ref_images: ['unused-image'] };
    const env = await setup(editValues);
    assert.equal(env.shot().refVideos.length, 0);
    await assert.rejects(env.api.generateTextToVideo(env.editor, env.shotId, 'module', editValues), /上传视频 1/);
    assert.equal(env.calls.length, 0);
    assert.equal(env.editor.timeline.getTracks()[0].elements.length, 0);
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', { ...editValues, ref_videos: ['source'] });
    await env.requested;
    env.api.recoverTextToVideoGenerations(env.editor);
    assert.equal(env.shot().generationStatus, 'queued');
    const reopened = await setup(editValues);
    reopened.setPlanning(structuredClone(env.planning()));
    reopened.editor.timeline.updateTracks(structuredClone(env.editor.timeline.getTracks()));
    reopened.api.recoverTextToVideoGenerations(reopened.editor);
    assert.equal(reopened.planning().scenes[0].shots[0].generationStatus, 'failed');
    assert.equal(reopened.api.getTextToVideoSlot(reopened.editor, env.shotId).status, 'failed');
    env.finish();
    await task;
});

test('video reference drafts preserve one source and all ordered references through reopening and resizing', async () => {
    const editValues = { ...values, task_type: 'V2VARef', ref_videos: ['source', 'unused-second'],
        ref_images: Array.from({ length: 9 }, (_, i) => `image-${i}`), ref_audios: ['audio-a', 'audio-b', 'audio-c'] };
    const env = await setup(editValues);
    assert.equal(env.shot().taskType, 'v2v');
    assert.equal(env.shot().title, '视频+参考修改');
    assert.equal(env.shot().refs.length, 9);
    assert.equal(env.shot().refAudios.length, 3);
    assert.equal(env.shot().refVideos.length, 1);
    const reopened = JSON.parse(JSON.stringify(env.planning()));
    const edited = env.api.saveTextToVideoDraft(reopened, { startTime: 99, trackIndex: 0 },
        { ...editValues, ref_videos: ['changed-source'], ref_images: ['image-8', 'image-0'] }, env.shotId);
    const resized = env.api.updateTextToVideoTiming(edited, env.shotId, { startTime: 4, duration: 12 });
    const shot = resized.scenes[0].shots[0];
    assert.deepEqual(Array.from(shot.refs, ref => ref.assetId), ['image-8', 'image-0']);
    assert.equal(shot.refs[0].index, 0);
    assert.equal(shot.sourceSnapshot.refVideos[0].assetId, 'changed-source');
    assert.equal(shot.sourceSnapshot.refAudios[2].assetId, 'audio-c');
    assert.equal(resized.scenes[0].settings.task_type, 'V2VARef');
    assert.deepEqual(Array.from(resized.scenes[0].settings.ref_videos), ['changed-source']);
    assert.equal(resized.scenes[0].settings.duration, 12);
    assert.ok(!JSON.stringify(resized).includes(values.prompt_api_key));
    assert.equal(env.calls.length, 0);
});

test('video reference generation submits source and references, reports progress and replaces its slot', async () => {
    const editValues = { ...values, task_type: 'V2VARef', prompt: '用 <Picture 1> 和 <Audio 1> 修改 <Video 1>',
        ref_videos: ['source', 'unused-second'], ref_images: ['image-a', 'image-b'], ref_audios: ['audio'],
        first_frame: 'stale-first', last_frame: 'stale-last', drive_audio: 'stale-drive', final_audio: 'stale-final' };
    const env = await setup(editValues);
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', editValues);
    const slot = env.editor.timeline.getTracks().flatMap(track => track.elements)[0];
    assert.equal(slot.name, '视频+参考修改');
    await env.requested;
    const submitted = env.calls[0].payload.values;
    assert.equal(submitted.task_type, 'V2VARef');
    assert.equal(submitted.prompt, editValues.prompt);
    assert.deepEqual(Array.from(submitted.ref_videos), ['source']);
    assert.deepEqual(Array.from(submitted.ref_images), ['image-a', 'image-b']);
    assert.deepEqual(Array.from(submitted.ref_audios), ['audio']);
    for (const name of ['first_frame', 'last_frame', 'drive_audio', 'final_audio']) assert.equal(submitted[name], '');
    env.report({ status: 'running', percent: 50, stage: '视频采样 4/8 步' });
    assert.equal(env.api.getTextToVideoSlot(env.editor, env.shotId).progress, 50);
    env.finish();
    await task;
    const video = env.editor.timeline.getTracks().flatMap(track => track.elements)[0];
    assert.equal(video.id, slot.id);
    assert.equal(video.name, '视频+参考修改');
    assert.equal(video.mediaId, 'generated-asset');
    assert.equal(env.shot().generationStatus, 'succeeded');
});

test('video reference editing allows drafts without media, requires the source to run and recovers disconnection', async () => {
    const editValues = { ...values, task_type: 'V2VARef', ref_videos: [], ref_images: ['image'] };
    const env = await setup(editValues);
    await assert.rejects(env.api.generateTextToVideo(env.editor, env.shotId, 'module', editValues), /上传视频 1/);
    assert.equal(env.calls.length, 0);
    assert.equal(env.editor.timeline.getTracks()[0].elements.length, 0);
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', { ...editValues, ref_videos: ['source'] });
    await env.requested;
    env.api.recoverTextToVideoGenerations(env.editor);
    assert.equal(env.shot().generationStatus, 'queued');
    const reopened = await setup(editValues);
    reopened.setPlanning(structuredClone(env.planning()));
    reopened.editor.timeline.updateTracks(structuredClone(env.editor.timeline.getTracks()));
    reopened.api.recoverTextToVideoGenerations(reopened.editor);
    assert.equal(reopened.planning().scenes[0].shots[0].generationStatus, 'failed');
    assert.equal(reopened.api.getTextToVideoSlot(reopened.editor, env.shotId).status, 'failed');
    env.finish();
    await task;
});

test('character swap drafts preserve the video, replacement image, target and template through reopening and resizing', async () => {
    const swapValues = { task_type: 'CharacterSwap', duration: 6.25, source_video: 'source', character_image: 'person',
        subject_prompt: 'girl in pink dress', prompt: 'Replace the woman in <Video 1> with <Picture 1>.',
        aspect_ratio: '9:16 (Portrait Widescreen)', audio_mode: 'mute', megapixels: 0.4, seed: -1 };
    const env = await setup(swapValues);
    assert.equal(env.shot().title, '人物替换');
    assert.equal(env.shot().taskType, 'r2v');
    assert.equal(env.shot().refVideos[0].assetId, 'source');
    assert.equal(env.shot().refs[0].assetId, 'person');
    const reopened = JSON.parse(JSON.stringify(env.planning()));
    const edited = env.api.saveTextToVideoDraft(reopened, { startTime: 99, trackIndex: 0 }, { ...swapValues, character_image: 'other-person' }, env.shotId);
    const resized = env.api.updateTextToVideoTiming(edited, env.shotId, { startTime: 3, duration: 8 });
    const scene = resized.scenes[0], shot = scene.shots[0];
    assert.equal(shot.sourceSnapshot.refs[0].assetId, 'other-person');
    assert.equal(shot.sourceSnapshot.refVideos[0].assetId, 'source');
    assert.equal(scene.settings.task_type, 'CharacterSwap');
    assert.equal(scene.settings.subject_prompt, swapValues.subject_prompt);
    assert.equal(scene.settings.prompt, swapValues.prompt);
    assert.equal(scene.settings.character_image, 'other-person');
    assert.equal(scene.settings.duration, 8);
    assert.equal(env.calls.length, 0);
});

test('character swap submits its own media fields and sound mode, then replaces its reserved slot', async () => {
    const swapValues = { task_type: 'CharacterSwap', duration: 5, source_video: 'source', character_image: 'person',
        subject_prompt: 'man on the left', prompt: 'Replace <Video 1> with <Picture 1>.', audio_mode: 'mute',
        aspect_ratio: '16:9 (Widescreen)', megapixels: 0.4, seed: 42 };
    const env = await setup(swapValues);
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'character-swap-module', swapValues);
    const slot = env.editor.timeline.getTracks().flatMap(track => track.elements)[0];
    assert.equal(slot.name, '人物替换');
    await env.requested;
    assert.equal(env.calls[0].payload.id, 'character-swap-module');
    const submitted = env.calls[0].payload.values;
    for (const name of ['source_video', 'character_image', 'subject_prompt', 'prompt', 'audio_mode', 'aspect_ratio', 'megapixels', 'seed'])
        assert.equal(submitted[name], swapValues[name]);
    assert.equal(submitted.task_type, 'CharacterSwap');
    assert.equal(submitted.start_time, 0);
    assert.ok(!Object.hasOwn(submitted, 'enhance_prompt'));
    assert.ok(!Object.hasOwn(submitted, 'prompt_api_key'));
    env.report({ status: 'running', percent: 50, stage: '人物重绘 4/8 步' });
    assert.equal(env.api.getTextToVideoSlot(env.editor, env.shotId).progress, 50);
    env.finish();
    await task;
    const video = env.editor.timeline.getTracks().flatMap(track => track.elements)[0];
    assert.equal(video.id, slot.id);
    assert.equal(video.mediaId, 'generated-asset');
    assert.equal(env.shot().generationStatus, 'succeeded');
});

test('character swap requires both media inputs and recovers an interrupted generation', async () => {
    const swapValues = { task_type: 'CharacterSwap', duration: 5, source_video: '', character_image: '' };
    const env = await setup(swapValues);
    await assert.rejects(env.api.generateTextToVideo(env.editor, env.shotId, 'module', swapValues), /上传原视频/);
    await assert.rejects(env.api.generateTextToVideo(env.editor, env.shotId, 'module', { ...swapValues, source_video: 'source' }), /上传替换人物图片/);
    assert.equal(env.calls.length, 0);
    assert.equal(env.editor.timeline.getTracks()[0].elements.length, 0);
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', { ...swapValues, source_video: 'source', character_image: 'person' });
    await env.requested;
    const reopened = await setup(swapValues);
    reopened.setPlanning(structuredClone(env.planning()));
    reopened.editor.timeline.updateTracks(structuredClone(env.editor.timeline.getTracks()));
    reopened.api.recoverTextToVideoGenerations(reopened.editor);
    assert.equal(reopened.planning().scenes[0].shots[0].generationStatus, 'failed');
    assert.equal(reopened.api.getTextToVideoSlot(reopened.editor, env.shotId).status, 'failed');
    env.finish();
    await task;
});

test('character swap keeps GPT options in the draft and submits the key only with the generation request', async () => {
    const swapValues = { task_type: 'CharacterSwap', duration: 5, source_video: 'source', character_image: 'person',
        subject_prompt: 'man on the left', prompt: 'Replace the man with <Picture 1>.', enhance_prompt: 'on',
        system_prompt: 'Keep the background.', prompt_model: 'chosen-model', prompt_skill: 'chosen-skill',
        prompt_api_key: 'test-session-key', audio_mode: 'mute' };
    const env = await setup(swapValues);
    assert.ok(!JSON.stringify(env.planning()).includes(swapValues.prompt_api_key));
    assert.equal(env.planning().scenes[0].settings.enhance_prompt, 'on');
    assert.equal(env.planning().scenes[0].settings.prompt_model, 'chosen-model');
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'swap-module', swapValues);
    await env.requested;
    const submitted = env.calls[0].payload.values;
    for (const name of ['enhance_prompt', 'system_prompt', 'prompt_model', 'prompt_skill', 'prompt_api_key', 'audio_mode'])
        assert.equal(submitted[name], swapValues[name]);
    env.finish();
    await task;
    assert.ok(!JSON.stringify(env.planning()).includes(swapValues.prompt_api_key));
});

test('body render drafts preserve their source and tracking prompt through reopening', async () => {
    const bodyValues = { task_type: 'BodyRender', duration: 6.25, source_video: 'source', subject_prompt: 'man on the left', output_mode: 'colored' };
    const env = await setup(bodyValues);
    assert.equal(env.shot().title, '视频转白模');
    assert.equal(env.shot().taskType, 'r2v');
    assert.equal(env.shot().refVideos[0].assetId, 'source');
    assert.equal(env.shot().refs.length, 0);
    assert.equal(env.shot().refAudios.length, 0);
    assert.equal(env.shot().prompt, bodyValues.subject_prompt);
    const reopened = JSON.parse(JSON.stringify(env.planning()));
    const edited = env.api.saveTextToVideoDraft(reopened, { startTime: 99, trackIndex: 0 },
        { ...bodyValues, source_video: 'changed-source', subject_prompt: 'dancer' }, env.shotId);
    const scene = edited.scenes[0], shot = scene.shots[0];
    assert.equal(scene.settings.task_type, 'BodyRender');
    assert.equal(scene.settings.subject_prompt, 'dancer');
    assert.equal(shot.prompt, 'dancer');
    assert.equal(shot.sourceSnapshot.refVideos[0].assetId, 'changed-source');
    assert.equal(shot.sourceSnapshot.prompt, 'dancer');
    assert.equal(shot.id, env.shotId);
    assert.equal(shot.startTime, 2);
    assert.equal(env.calls.length, 0);
});

test('body rendering submits the full extracted clip to output 256 without GPT and fills its own slot', async () => {
    const bodyValues = { task_type: 'BodyRender', duration: 5.17, source_video: 'source', subject_prompt: 'person',
        output_mode: 'white', start_time: 2, frame_rate: 24, longest_side: 736,
        enhance_prompt: 'on', prompt_api_key: 'unused-key', prompt_model: 'unused-model', character_image: 'unused-image' };
    const env = await setup(bodyValues);
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'body-module', bodyValues);
    const slot = env.editor.timeline.getTracks().flatMap(track => track.elements)[0];
    assert.equal(slot.name, '视频转白模');
    await env.requested;
    assert.equal(env.calls[0].payload.id, 'body-module');
    const submitted = env.calls[0].payload.values;
    assert.equal(submitted.task_type, 'BodyRender');
    assert.equal(submitted.source_video, 'source');
    assert.equal(submitted.subject_prompt, 'person');
    assert.equal(submitted.output_mode, 'colored');
    assert.equal(submitted.start_time, 0);
    assert.equal(submitted.duration, 0);
    assert.equal(submitted.frame_rate, 24);
    assert.equal(submitted.longest_side, 736);
    assert.equal(submitted.audio_mode, 'source');
    for (const name of ['enhance_prompt', 'prompt_api_key', 'prompt_model', 'character_image', 'ref_images', 'ref_videos'])
        assert.ok(!Object.hasOwn(submitted, name));
    env.report({ status: 'running', percent: 60, stage: '渲染人体白模' });
    assert.equal(env.api.getTextToVideoSlot(env.editor, env.shotId).progress, 60);
    env.finish();
    await task;
    const video = env.editor.timeline.getTracks().flatMap(track => track.elements)[0];
    assert.equal(video.id, slot.id);
    assert.equal(video.mediaId, 'generated-asset');
    assert.equal(video.duration, 5.8);
    assert.equal(env.shot().generationStatus, 'succeeded');
});

test('body rendering permits an empty draft, requires its source and recovers disconnection', async () => {
    const bodyValues = { task_type: 'BodyRender', duration: 5, source_video: '', subject_prompt: 'person' };
    const env = await setup(bodyValues);
    await assert.rejects(env.api.generateTextToVideo(env.editor, env.shotId, 'module', bodyValues), /上传原视频/);
    assert.equal(env.calls.length, 0);
    assert.equal(env.editor.timeline.getTracks()[0].elements.length, 0);
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', { ...bodyValues, source_video: 'source' });
    await env.requested;
    const reopened = await setup(bodyValues);
    reopened.setPlanning(structuredClone(env.planning()));
    reopened.editor.timeline.updateTracks(structuredClone(env.editor.timeline.getTracks()));
    reopened.api.recoverTextToVideoGenerations(reopened.editor);
    assert.equal(reopened.planning().scenes[0].shots[0].generationStatus, 'failed');
    assert.equal(reopened.api.getTextToVideoSlot(reopened.editor, env.shotId).status, 'failed');
    env.finish();
    await task;
});

test('motion transfer drafts retain reference slots, resolution and timing through reopening', async () => {
    const motionValues = { task_type: 'MotionTransfer', duration: 6.25, source_video: 'driver',
        character_images: ['red', 'yellow'], character_slots: [1, 5], megapixels: 0.8, aspect_ratio: '16:9 (Widescreen)', seed: -1 };
    const env = await setup(motionValues);
    assert.equal(env.shot().title, '动作迁移');
    assert.equal(env.shot().taskType, 'r2v');
    assert.equal(env.shot().refVideos[0].assetId, 'driver');
    assert.deepEqual(Array.from(env.shot().refs, ref => [ref.assetId, ref.index]), [['red', 1], ['yellow', 5]]);
    assert.equal(env.shot().refAudios.length, 0);
    assert.equal(env.shot().prompt, '');
    const reopened = JSON.parse(JSON.stringify(env.planning()));
    const edited = env.api.saveTextToVideoDraft(reopened, { startTime: 99, trackIndex: 0 },
        { ...motionValues, character_images: ['yellow'], character_slots: [5] }, env.shotId);
    const resized = env.api.updateTextToVideoTiming(edited, env.shotId, { startTime: 3, duration: 8 });
    const scene = resized.scenes[0], shot = scene.shots[0];
    assert.equal(scene.settings.task_type, 'MotionTransfer');
    assert.equal(scene.settings.megapixels, 0.8);
    assert.equal(scene.settings.aspect_ratio, motionValues.aspect_ratio);
    assert.deepEqual(Array.from(shot.sourceSnapshot.refs, ref => [ref.assetId, ref.index]), [['yellow', 5]]);
    assert.equal(shot.sourceSnapshot.refVideos[0].assetId, 'driver');
    assert.equal(scene.settings.duration, 8);
    assert.equal(env.calls.length, 0);
});

test('motion transfer keeps supplied durations outside the H3 dialog range through saving, moving and submission', async () => {
    for (const duration of [1.5, 20.25]) {
        const motionValues = { task_type: 'MotionTransfer', duration, source_video: 'driver', character_images: ['person'] };
        const env = await setup(motionValues);
        assert.equal(env.shot().duration, duration);
        const timing = env.api.textToVideoPlacement(2, duration, 1, 'right', 'MotionTransfer');
        assert.equal(timing.duration, duration + 1);
        const moved = env.api.updateTextToVideoTiming(env.planning(), env.shotId, { startTime: 3, duration });
        env.setPlanning(moved);
        assert.equal(env.shot().duration, duration);
        assert.equal(env.shot().sourceSnapshot.duration, duration);
        const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', motionValues);
        await env.requested;
        assert.equal(env.calls[0].payload.values.duration, duration);
        env.finish();
        await task;
        assert.equal(env.shot().duration, duration);
    }
});

test('motion transfer uses its supplied key for automatic prompts and keeps the fixed seed and sound choice', async () => {
    for (const audio_mode of ['source', 'mute']) for (const key of ['', '  motion-test-key  ']) {
        const motionValues = { task_type: 'MotionTransfer', duration: 6.3, source_video: 'driver',
            character_images: ['red', 'yellow'], character_slots: [1, 5], megapixels: 0.8, aspect_ratio: '16:9 (Widescreen)',
            seed_mode: 'fixed', seed: '375540071883589', enhance_prompt: 'off', prompt_api_key: key, prompt_model: 'chosen-model', prompt: 'unused prompt', audio_mode };
        const env = await setup(motionValues, { random: () => assert.fail('a fixed seed must not draw a random number') });
        const task = env.api.generateTextToVideo(env.editor, env.shotId, 'motion-module', motionValues);
        const slot = env.editor.timeline.getTracks().flatMap(track => track.elements)[0];
        assert.equal(slot.name, '动作迁移');
        await env.requested;
        assert.equal(env.calls[0].payload.id, 'motion-module');
        const submitted = env.calls[0].payload.values;
        assert.equal(submitted.task_type, 'MotionTransfer');
        assert.equal(submitted.source_video, 'driver');
        assert.deepEqual(Array.from(submitted.character_images), ['red', 'yellow']);
        assert.deepEqual(Array.from(submitted.character_slots), [1, 5]);
        assert.equal(submitted.start_time, 0);
        assert.equal(submitted.duration, 6.3);
        assert.equal(submitted.megapixels, 0.8);
        assert.equal(submitted.aspect_ratio, motionValues.aspect_ratio);
        assert.equal(submitted.seed, 375540071883589);
        assert.ok(!Object.hasOwn(submitted, 'seed_mode'));
        assert.equal(submitted.prompt, '');
        assert.equal(submitted.enhance_prompt, key.trim() ? 'on' : 'off');
        assert.equal(submitted.prompt_api_key, key.trim());
        assert.equal(submitted.prompt_model, 'chosen-model');
        assert.equal(submitted.audio_mode, audio_mode);
        for (const name of ['ref_images', 'ref_videos']) assert.ok(!Object.hasOwn(submitted, name));
        assert.ok(!JSON.stringify(env.planning()).includes('motion-test-key'));
        env.report({ status: 'running', percent: 60, stage: '动作迁移 5/8 步' });
        assert.equal(env.api.getTextToVideoSlot(env.editor, env.shotId).progress, 60);
        env.finish();
        await task;
        const video = env.editor.timeline.getTracks().flatMap(track => track.elements)[0];
        assert.equal(video.id, slot.id);
        assert.equal(video.mediaId, 'generated-asset');
        assert.equal(env.shot().generationStatus, 'succeeded');
        assert.ok(!JSON.stringify(env.planning()).includes('motion-test-key'));
    }
});

test('saved motion shots use their separate local key for single and batch generation without putting it in the project', async () => {
    for (const key of ['', 'saved-motion-key']) for (const single of [true, false]) {
        const draft = { task_type: 'MotionTransfer', duration: 5, source_video: 'driver', character_images: ['person'], character_slots: [1],
            prompt_api_key: 'discard-this-key', enhance_prompt: 'off', selflift_enabled: true, refine_enabled: true, refine_megapixels: '1.2' };
        const env = await setup(draft, { key: 'other-provider-key', motionKey: key,
            modules: [{ id: 'motion', nodeType: 'CapCutMotionTransferWorkflow', fields: [{ name: 'prompt_model', default: 'chosen-model' }] }],
            media: [{ id: 'driver', type: 'video' }, { id: 'person', type: 'image' }],
            onRun: async () => [{ filename: 'result.mp4' }] });
        assert.equal((await env.api.generateAIShots(env.editor, single ? [env.shotId] : undefined)).completed, 1);
        const submitted = env.calls.find(call => call.operation === 'capcut:run-workflow').payload;
        assert.equal(submitted.id, 'motion');
        assert.equal(submitted.values.enhance_prompt, key ? 'on' : 'off');
        assert.equal(submitted.values.prompt_api_key, key);
        assert.equal(submitted.values.prompt_model, 'chosen-model');
        assert.equal(submitted.values.selflift_enabled, true);
        assert.equal(submitted.values.refine_enabled, true);
        assert.equal(submitted.values.refine_megapixels, '1.2');
        assert.ok(env.calls.some(call => call.operation === 'capcut:motion-transfer-key:get'));
        for (const secret of ['saved-motion-key', 'other-provider-key', 'discard-this-key'])
            assert.ok(!JSON.stringify(env.planning()).includes(secret));
    }
});

test('motion transfer requires a video and one reference, and recovers disconnected generation', async () => {
    const motionValues = { task_type: 'MotionTransfer', duration: 5, source_video: '', character_images: [], character_slots: [] };
    const env = await setup(motionValues);
    await assert.rejects(env.api.generateTextToVideo(env.editor, env.shotId, 'module', motionValues), /上传原视频/);
    await assert.rejects(env.api.generateTextToVideo(env.editor, env.shotId, 'module', { ...motionValues, source_video: 'driver' }), /至少上传一张/);
    assert.equal(env.calls.length, 0);
    assert.equal(env.editor.timeline.getTracks()[0].elements.length, 0);
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', { ...motionValues, source_video: 'driver', character_images: ['person'] });
    await env.requested;
    const reopened = await setup(motionValues);
    reopened.setPlanning(structuredClone(env.planning()));
    reopened.editor.timeline.updateTracks(structuredClone(env.editor.timeline.getTracks()));
    reopened.api.recoverTextToVideoGenerations(reopened.editor);
    assert.equal(reopened.planning().scenes[0].shots[0].generationStatus, 'failed');
    assert.equal(reopened.api.getTextToVideoSlot(reopened.editor, env.shotId).status, 'failed');
    env.finish();
    await task;
});

const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

test('batch generation waits for video retrieval, asset storage, timeline replacement and save before submitting the next shot', async () => {
    const importing = deferred(), imported = deferred(), storing = deferred(), stored = deferred(), saving = deferred(), saved = deferred();
    let env, firstId, firstSaved = false;
    const submissions = [], draws = [0, 0.999999999];
    const randomValues = { ...values, task_type: 'T2VA', seed_mode: 'random', seed: '71' };
    env = await setup({ ...randomValues, prompt: 'later shot' }, {
        random: () => draws.shift(),
        onRun: async payload => {
            submissions.push([payload.values.prompt, payload.values.seed]);
            assert.ok(!Object.hasOwn(payload.values, 'seed_mode'));
            if (submissions.length === 2) assert.equal(env.planning().scenes.flatMap(scene => scene.shots).find(shot => shot.id === firstId).generationStatus, 'succeeded');
            return [{ filename: 'result.mp4' }];
        },
        onImport: async () => { if (submissions.length === 1) { importing.resolve(); await imported.promise; } },
        onAdd: async () => { if (submissions.length === 1) { storing.resolve(); await stored.promise; } },
        onSave: async () => {
            if (firstId && !firstSaved && env.planning().scenes.flatMap(scene => scene.shots).find(shot => shot.id === firstId).generationStatus === 'succeeded') {
                firstSaved = true; saving.resolve(); await saved.promise;
            }
        },
    });
    const withFirst = env.api.saveTextToVideoDraft(env.planning(), { startTime: 0, trackIndex: 0 }, { ...randomValues, prompt: 'first shot' });
    assert.equal(draws.length, 2);
    firstId = withFirst.selectedShotId;
    env.setPlanning(withFirst);
    const progress = [];
    const task = env.api.generateAIShots(env.editor, undefined, value => progress.push(value));
    await importing.promise;
    assert.deepEqual(submissions, [['first shot', 0]]);
    assert.equal(draws.length, 1);
    assert.equal(env.assets.length, 0);
    await assert.rejects(env.api.generateAIShots(env.editor), /已有镜头正在生成/);
    await assert.rejects(env.api.generateTextToVideo(env.editor, env.shotId, 'module', values), /生成队列执行中/);
    imported.resolve();
    await storing.promise;
    assert.equal(submissions.length, 1);
    stored.resolve();
    await saving.promise;
    assert.equal(submissions.length, 1);
    assert.equal(env.assets.length, 1);
    assert.ok(env.editor.timeline.getTracks().flatMap(track => track.elements).some(element => element.mediaId === 'generated-asset'));
    saved.resolve();
    const result = await task;
    assert.equal(result.completed, 2);
    assert.deepEqual(submissions, [['first shot', 0], ['later shot', 99_999_999]]);
    for (const scene of env.planning().scenes) {
        assert.equal(scene.settings.seed_mode, 'random');
        assert.equal(scene.settings.seed, '71');
    }
    assert.deepEqual(progress.map(item => item.index), [0, 1]);
    assert.equal(progress[0].shotIds[0], firstId);
    assert.equal(env.assets.length, 2);
});

test('all H3 editors preserve the enhancement switch in drafts and submitted generation values', async () => {
    for (const [mode, media] of [
        ['T2VA', {}], ['I2VA', { first_frame: 'first' }], ['FL2VA', { first_frame: 'first', last_frame: 'last' }],
        ['Ref2VA', { ref_images: ['image'] }], ['V2VA', { ref_videos: ['source'] }],
        ['V2VARef', { ref_videos: ['source'], ref_images: ['image'], ref_audios: ['voice'] }],
    ]) for (const enhancement of ['off', undefined]) {
        const draft = { ...values, ...media, task_type: mode, ...(enhancement ? { enhance_prompt: enhancement } : {}) };
        const env = await setup(draft, { onRun: async () => [{ filename: 'result.mp4' }] });
        const restored = JSON.parse(JSON.stringify(env.planning()));
        env.setPlanning(env.api.updateTextToVideoTiming(restored, env.shotId, { startTime: 3, duration: 8 }));
        assert.equal(env.planning().scenes[0].settings.enhance_prompt, enhancement, mode);
        await env.api.generateTextToVideo(env.editor, env.shotId, 'module', draft);
        const submitted = env.calls.find(call => call.operation === 'capcut:run-workflow').payload.values;
        assert.equal(submitted.enhance_prompt, enhancement ?? 'on', mode);
        assert.equal(submitted.duration, 8);
        assert.equal(submitted.prompt, values.prompt);
        assert.equal(submitted.system_prompt, values.system_prompt);
    }
});

test('saved shots run without an API key when enhancement is off and default to on when unset', async () => {
    const draft = { ...values, task_type: 'T2VA', enhance_prompt: 'off', prompt_api_key: '' };
    const env = await setup(draft, { key: '', onRun: async () => [{ filename: 'result.mp4' }],
        modules: [{ id: 'module', nodeType: 'CapCutMiniMaxH3Workflow', fields: [{ name: 'enhance_prompt', default: 'off' }] }] });
    const next = env.api.saveTextToVideoDraft(env.planning(), { startTime: 10, trackIndex: 0 }, { ...draft, prompt: '第二个镜头' });
    env.setPlanning(next);
    assert.equal((await env.api.generateAIShots(env.editor)).completed, 2);
    assert.equal((await env.api.generateAIShots(env.editor, [env.shotId])).completed, 1);
    const runs = env.calls.filter(call => call.operation === 'capcut:run-workflow');
    assert.equal(runs.length, 3);
    assert.ok(runs.every(call => call.payload.values.enhance_prompt === 'off' && call.payload.values.prompt_api_key === ''));
    const restored = JSON.parse(JSON.stringify(env.planning()));
    delete restored.scenes[0].settings.enhance_prompt;
    env.setPlanning(restored);
    await assert.rejects(env.api.generateAIShots(env.editor, [env.shotId]), /API Key/);
    assert.equal(env.calls.filter(call => call.operation === 'capcut:run-workflow').length, 3);
});

test('current-shot generation runs only the clicked shot, restores live settings and permits explicit regeneration', async () => {
    const env = await setup({ ...values, task_type: 'T2VA', prompt: 'selected prompt', megapixels: 0.7, prompt_model: 'selected-model' }, {
        onRun: async () => [{ filename: 'result.mp4' }],
    });
    const other = env.api.saveTextToVideoDraft(env.planning(), { startTime: 0, trackIndex: 0 }, { ...values, task_type: 'T2VA', prompt: 'other prompt' });
    const otherId = other.selectedShotId;
    env.setPlanning(env.api.updateTextToVideoTiming(other, env.shotId, { startTime: 3, duration: 12 }));
    for (let i = 0; i < 2; i++) {
        const result = await env.api.generateAIShots(env.editor, [env.shotId]);
        assert.equal(result.completed, 1);
    }
    const runs = env.calls.filter(call => call.operation === 'capcut:run-workflow');
    assert.equal(runs.length, 2);
    assert.equal(runs[0].payload.values.prompt, 'selected prompt');
    assert.equal(runs[0].payload.values.duration, 12);
    assert.equal(runs[0].payload.values.megapixels, 0.7);
    assert.equal(runs[0].payload.values.prompt_model, 'selected-model');
    assert.equal(runs[0].payload.values.prompt_api_key, 'session-only-key');
    assert.equal(env.planning().scenes.flatMap(scene => scene.shots).find(shot => shot.id === otherId).generationStatus, 'idle');
    assert.ok(!JSON.stringify(env.planning()).includes('session-only-key'));
});

test('selected generation queues only checked shots in timeline order and waits for each result', async () => {
    const importing = deferred(), imported = deferred();
    const submissions = [];
    const env = await setup({ ...values, task_type: 'T2VA', prompt: '' }, {
        onRun: async payload => { submissions.push(payload.values.prompt); return [{ filename: 'result.mp4' }]; },
        onImport: async () => { if (submissions.length === 1) { importing.resolve(); await imported.promise; } },
    });
    let planning = env.api.saveTextToVideoDraft(env.planning(), { startTime: 10, trackIndex: 0 }, { ...values, task_type: 'T2VA', prompt: 'checked later' });
    const laterId = planning.selectedShotId;
    planning = env.api.saveTextToVideoDraft(planning, { startTime: 0, trackIndex: 1 }, { ...values, task_type: 'T2VA', prompt: 'checked first' });
    const firstId = planning.selectedShotId;
    planning.scenes.at(-1).shots[0].generationStatus = 'succeeded';
    env.setPlanning(planning);
    await assert.rejects(env.api.generateAIShots(env.editor, []), /选择一个 AI 镜头/);
    assert.equal(submissions.length, 0);
    const progress = [];
    const task = env.api.generateAIShots(env.editor, [laterId, firstId], value => progress.push(value));
    await importing.promise;
    assert.deepEqual(submissions, ['checked first']);
    assert.equal(env.shot().generationStatus, 'idle');
    imported.resolve();
    assert.equal((await task).completed, 2);
    assert.deepEqual(submissions, ['checked first', 'checked later']);
    assert.deepEqual(Array.from(progress[0].shotIds), [firstId, laterId]);
    assert.equal(env.shot().generationStatus, 'idle');
    assert.equal(env.shot().outputVersions.length, 0);
});

test('batch includes completed shots, retries failed shots and skips incomplete drafts with a reason', async () => {
    const env = await setup({ ...values, task_type: 'T2VA' }, { onRun: async () => [{ filename: 'result.mp4' }] });
    let planning = structuredClone(env.planning());
    planning.scenes[0].shots[0].generationStatus = 'succeeded';
    planning = env.api.saveTextToVideoDraft(planning, { startTime: 0, trackIndex: 0 }, { ...values, task_type: 'I2VA', first_frame: '' });
    planning = env.api.saveTextToVideoDraft(planning, { startTime: 10, trackIndex: 0 }, { ...values, task_type: 'T2VA', prompt: 'retry me' });
    planning.scenes.at(-1).shots[0].generationStatus = 'failed';
    env.setPlanning(planning);
    const result = await env.api.generateAIShots(env.editor);
    assert.equal(result.completed, 2);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0], /上传首帧图片/);
    const prompts = env.calls.filter(call => call.operation === 'capcut:run-workflow').map(call => call.payload.values.prompt);
    assert.deepEqual(prompts, [values.prompt, 'retry me']);
});

test('batch can regenerate a track when every shot has already succeeded', async () => {
    const env = await setup({ ...values, task_type: 'T2VA', prompt: 'first finished shot' }, { onRun: async () => [{ filename: 'result.mp4' }] });
    const planning = env.api.saveTextToVideoDraft(env.planning(), { startTime: 10, trackIndex: 0 }, { ...values, task_type: 'T2VA', prompt: 'second finished shot' });
    delete planning.selectedShotId;
    for (const scene of planning.scenes) for (const shot of scene.shots) shot.generationStatus = 'succeeded';
    env.setPlanning(planning);
    assert.equal((await env.api.generateAIShots(env.editor)).completed, 2);
    assert.deepEqual(env.calls.filter(call => call.operation === 'capcut:run-workflow').map(call => call.payload.values.prompt), ['first finished shot', 'second finished shot']);
    assert.ok(env.planning().scenes.every(scene => scene.shots.every(shot => shot.generationStatus === 'succeeded' && shot.outputVersions.length === 1)));
});

test('queue stops on a workflow or import failure, leaving subsequent shots unsubmitted and allowing retry', async () => {
    for (const stage of ['workflow', 'import', 'save']) {
        let fail = true, env;
        env = await setup({ ...values, task_type: 'T2VA' }, {
            onRun: async () => { if (fail && stage === 'workflow') throw new Error('GPU error'); return [{ filename: 'result.mp4' }]; },
            onImport: async () => { if (fail && stage === 'import') throw new Error('download failed'); },
            onSave: async () => { if (fail && stage === 'save' && env.assets.length) throw new Error('save failed'); },
        });
        const next = env.api.saveTextToVideoDraft(env.planning(), { startTime: 10, trackIndex: 0 }, { ...values, task_type: 'T2VA' });
        const nextId = next.selectedShotId;
        env.setPlanning(next);
        await assert.rejects(env.api.generateAIShots(env.editor), /队列已停止.*0\/2/);
        assert.equal(env.calls.filter(call => call.operation === 'capcut:run-workflow').length, 1);
        assert.equal(env.planning().scenes.flatMap(scene => scene.shots).find(shot => shot.id === nextId).generationStatus, 'idle');
        fail = false;
        assert.equal((await env.api.generateAIShots(env.editor, [env.shotId])).completed, 1);
    }
});

test('queue stops when the project switches, and does not submit or import into the new project', async () => {
    const entered = deferred(), finish = deferred();
    const env = await setup({ ...values, task_type: 'T2VA' }, { onRun: async () => { entered.resolve(); return finish.promise; } });
    env.setPlanning(env.api.saveTextToVideoDraft(env.planning(), { startTime: 10, trackIndex: 0 }, { ...values, task_type: 'T2VA' }));
    const task = env.api.generateAIShots(env.editor);
    await entered.promise;
    env.switchProject();
    finish.resolve([{ filename: 'result.mp4' }]);
    await assert.rejects(task, /工程已切换.*队列已停止/);
    assert.equal(env.assets.length, 0);
    assert.equal(env.calls.filter(call => call.operation === 'capcut:run-workflow').length, 1);
});

test('saved-shot generation routes every supported mode to its own module and validates saved references', async () => {
    const fields = [
        { name: 'first_frame', type: 'media', kind: 'image' }, { name: 'last_frame', type: 'media', kind: 'image' },
        { name: 'ref_images', type: 'media', kind: 'image', multiple: true }, { name: 'ref_videos', type: 'media', kind: 'video', multiple: true },
        { name: 'ref_audios', type: 'media', kind: 'audio', multiple: true },
    ];
    const modules = [
        { id: 'h3', nodeType: 'CapCutMiniMaxH3Workflow', fields },
        { id: 'swap', nodeType: 'CapCutMiniMaxH3CharacterSwapWorkflow', fields: [{ name: 'source_video', type: 'media', kind: 'video' }, { name: 'character_image', type: 'media', kind: 'image' }] },
        { id: 'body', nodeType: 'CapCutBodyRenderWorkflow', fields: [{ name: 'source_video', type: 'media', kind: 'video' }] },
        { id: 'motion', nodeType: 'CapCutMotionTransferWorkflow', fields: [{ name: 'source_video', type: 'media', kind: 'video' }, { name: 'character_images', type: 'media', kind: 'image', multiple: true }] },
    ];
    const media = [{ id: 'image', type: 'image' }, { id: 'tail', type: 'image' }, { id: 'video', type: 'video' }, { id: 'audio', type: 'audio' }];
    for (const mode of ['T2VA', 'I2VA', 'FL2VA', 'Ref2VA', 'V2VA', 'V2VARef', 'CharacterSwap', 'BodyRender', 'MotionTransfer']) {
        const draft = { ...values, task_type: mode, first_frame: 'image', last_frame: 'tail', ref_images: ['image'], ref_videos: ['video'],
            ref_audios: ['audio'], source_video: 'video', character_image: 'image', subject_prompt: 'person', character_images: ['image'], character_slots: [3] };
        const env = await setup(draft, { modules, media, hasAudio: false, onRun: async () => [{ filename: 'result.mp4' }] });
        assert.equal((await env.api.generateAIShots(env.editor, [env.shotId])).completed, 1);
        const run = env.calls.find(call => call.operation === 'capcut:run-workflow');
        assert.equal(run.payload.id, { CharacterSwap: 'swap', BodyRender: 'body', MotionTransfer: 'motion' }[mode] ?? 'h3');
        assert.equal(run.payload.values.task_type, mode);
        if (mode === 'MotionTransfer') {
            assert.equal(run.payload.values.audio_mode, 'mute');
            assert.deepEqual(Array.from(run.payload.values.character_slots), [3]);
        }
    }
    const missing = await setup({ ...values, task_type: 'I2VA', first_frame: 'deleted-image' }, { modules });
    await assert.rejects(missing.api.generateAIShots(missing.editor, [missing.shotId]), /素材已移除/);
    assert.equal(missing.calls.filter(call => call.operation === 'capcut:run-workflow').length, 0);
    const noModule = await setup({ ...values, task_type: 'T2VA' }, { modules: [] });
    await assert.rejects(noModule.api.generateAIShots(noModule.editor, [noModule.shotId]), /连接.*工作流模块/);
    const noKey = await setup({ ...values, task_type: 'T2VA' }, { key: '' });
    await assert.rejects(noKey.api.generateAIShots(noKey.editor, [noKey.shotId]), /API Key/);
});

test('reopening recovers disconnected generation slots while live requests stay active', async () => {
    const env = await setup();
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', values);
    await env.requested;
    env.api.recoverTextToVideoGenerations(env.editor);
    assert.equal(env.shot().generationStatus, 'queued');
    const reopened = await setup();
    reopened.setPlanning(structuredClone(env.planning()));
    reopened.editor.timeline.updateTracks(structuredClone(env.editor.timeline.getTracks()));
    reopened.api.recoverTextToVideoGenerations(reopened.editor);
    assert.equal(reopened.planning().scenes[0].shots[0].generationStatus, 'failed');
    assert.equal(reopened.api.getTextToVideoSlot(reopened.editor, env.shotId).status, 'failed');
    assert.match(reopened.api.getTextToVideoSlot(reopened.editor, env.shotId).error, /连接已断开/);
    env.finish();
    await task;
});

test('reopening does not take over reference jobs owned by another generation flow', async () => {
    const env = await setup({ ...values, task_type: 'Ref2VA', ref_images: ['image'] });
    const planning = structuredClone(env.planning());
    delete planning.scenes[0].settings.task_type;
    planning.scenes[0].shots[0].generationStatus = 'running';
    env.setPlanning(planning);
    env.api.recoverTextToVideoGenerations(env.editor);
    assert.equal(env.shot().generationStatus, 'running');
});

test('reopening does not take over video editing jobs owned by another generation flow', async () => {
    const env = await setup({ ...values, task_type: 'V2VA', ref_videos: ['source'] });
    const planning = structuredClone(env.planning());
    delete planning.scenes[0].settings.task_type;
    planning.scenes[0].shots[0].generationStatus = 'running';
    env.setPlanning(planning);
    env.api.recoverTextToVideoGenerations(env.editor);
    assert.equal(env.shot().generationStatus, 'running');
});

test('removing a reserved slot does not insert an unexpected clip on completion', async () => {
    const env = await setup();
    const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', values);
    await env.requested;
    env.editor.timeline.updateTracks(env.editor.timeline.getTracks().map(track => ({ ...track, elements: [] })));
    env.finish();
    await task;
    assert.equal(env.assets.length, 1);
    assert.ok(env.editor.timeline.getTracks().every(track => track.elements.length === 0));
    assert.equal(env.shot().generationStatus, 'succeeded');
});

test('switching projects or removing the AI draft cannot insert the old result', async () => {
    for (const action of ['switch', 'remove']) {
        const env = await setup();
        const task = env.api.generateTextToVideo(env.editor, env.shotId, 'module', values);
        await env.requested;
        if (action === 'switch') env.switchProject();
        else env.setPlanning(empty());
        env.finish();
        await task;
        assert.equal(env.assets.length, 0);
        assert.equal(env.calls.length, 1);
    }
});

test('all output exports one timeline clip in queue order and feeds the actual adjacent result to the next shot', async () => {
    const first = { filename: 'first.mp4', subfolder: 'MiniMaxH3', type: 'output' };
    const second = { ...first, filename: 'second.mp4' };
    const merged = { ...first, filename: 'merged.mp4' };
    let calls = 0, env;
    env = await setup({ ...values, task_type: 'T2VA', prompt: 'first' }, {
        onRun: ({ values: fields }) => {
            if (++calls === 1) {
                assert.equal(fields.continuity_video, undefined);
                return [first];
            }
            assert.equal(fields.prompt, 'second');
            assert.deepEqual(fields.continuity_video, first);
            assert.equal(fields.continuity_frames, 39);
            assert.equal(env.editor.timeline.getTracks().flatMap(track => track.elements).length, 1);
            return [second];
        },
        onConcat: ({ files }) => {
            assert.deepEqual(Array.from(files), [first, second]);
            return merged;
        },
    });
    const next = env.api.saveTextToVideoDraft(env.planning(), { startTime: 7.17, trackIndex: 1 }, { ...values, task_type: 'T2VA', prompt: 'second' });
    env.setPlanning({ ...next, aiTrackGuideEnabled: true, aiTrackOutputMode: 'all', scenes: next.scenes.map(scene => ({ ...scene,
        shots: scene.shots.map(shot => shot.id === next.selectedShotId ? { ...shot, aiTrackGuideFrames: 39 } : shot),
    })) });
    const result = await env.api.generateAIShots(env.editor, [next.selectedShotId, env.shotId]);
    assert.equal(result.completed, 2);
    assert.equal(result.outputMode, 'all');
    assert.equal(result.merged, 1);
    assert.equal(env.assets.length, 3);
    const clips = env.editor.timeline.getTracks().flatMap(track => track.elements);
    assert.equal(clips.length, 1);
    assert.equal(clips[0].name, 'AI 镜头 · 全部导出');
    assert.equal(clips[0].startTime, 2);
    assert.equal(clips[0].directorGeneration, undefined);
    assert.ok(env.planning().scenes.every(scene => scene.shots[0].outputVersions.length === 1));
});

test('only the immediately adjacent same-track shot can use saved continuity, and hard cut skips it', async () => {
    const video = { filename: 'saved.mp4', subfolder: 'CapCut/default/project', type: 'input' };
    const seen = [], frames = [];
    const env = await setup({ ...values, task_type: 'T2VA' }, {
        onRun: ({ values: fields }) => { seen.push(fields.continuity_video); frames.push(fields.continuity_frames); return [{ filename: 'out.mp4' }]; },
        onResolveGuide: ({ assetId }) => { assert.equal(assetId, 'generated-asset'); return video; },
    });
    await env.api.generateAIShots(env.editor, [env.shotId]);
    const next = env.api.saveTextToVideoDraft(env.planning(), { startTime: 7.17, trackIndex: 1 }, { ...values, task_type: 'T2VA', prompt: 'second' });
    const other = env.api.saveTextToVideoDraft(next, { startTime: 7.17, trackIndex: 0 }, { ...values, task_type: 'T2VA' });
    env.setPlanning({ ...other, aiTrackGuideEnabled: true });
    await env.api.generateAIShots(env.editor, [next.selectedShotId]);
    await env.api.generateAIShots(env.editor, [other.selectedShotId]);
    env.setPlanning({ ...env.planning(), scenes: env.planning().scenes.map(scene => ({ ...scene,
        shots: scene.shots.map(shot => shot.id === next.selectedShotId ? { ...shot, aiTrackTransition: 'cut' } : shot),
    })) });
    await env.api.generateAIShots(env.editor, [next.selectedShotId]);
    assert.deepEqual(seen, [undefined, video, undefined, undefined]);
    assert.deepEqual(frames, [undefined, 22, undefined, undefined]);
});

test('an interrupted all export leaves a failed merged slot and retains completed shot media', async () => {
    let runs = 0;
    const env = await setup({ ...values, task_type: 'T2VA' }, {
        onRun: () => { if (++runs > 1) throw new Error('GPU error'); return [{ filename: 'first.mp4' }]; },
        onConcat: () => assert.fail('incomplete queues cannot be concatenated'),
    });
    const next = env.api.saveTextToVideoDraft(env.planning(), { startTime: 7.17, trackIndex: 1 }, { ...values, task_type: 'T2VA' });
    env.setPlanning({ ...next, aiTrackOutputMode: 'all' });
    await assert.rejects(env.api.generateAIShots(env.editor), /GPU error.*1\/2/);
    assert.equal(env.assets.length, 1);
    const clips = env.editor.timeline.getTracks().flatMap(track => track.elements);
    assert.equal(clips.length, 1);
    assert.equal(clips[0].directorGeneration.status, 'failed');
    assert.equal(clips[0].directorGeneration.shotIds.length, 2);
    assert.equal(env.shot().generationStatus, 'succeeded');
});

test('all output merges each touching same-track chain and exports isolated clips separately', async () => {
    const concatenated = [], generated = [];
    const env = await setup({ ...values, task_type: 'T2VA', prompt: 'first' }, {
        onRun: ({ values: fields }) => {
            generated.push(fields.prompt);
            return [{ filename: `${fields.prompt}.mp4`, type: 'output' }];
        },
        onConcat: ({ files }) => {
            concatenated.push(Array.from(files, file => file.filename));
            return { filename: `merged-${concatenated.length}.mp4`, type: 'output' };
        },
    });
    let planning = env.planning();
    for (const [startTime, trackIndex, prompt] of [[7.17, 1, 'second'], [20, 1, 'third'], [25.17, 1, 'fourth'],
        [40, 1, 'isolated'], [12.34, 0, 'other-track']]) {
        planning = env.api.saveTextToVideoDraft(planning, { startTime, trackIndex }, { ...values, task_type: 'T2VA', prompt });
    }
    env.setPlanning({ ...planning, aiTrackOutputMode: 'all' });
    const result = await env.api.generateAIShots(env.editor);
    assert.deepEqual(generated, ['first', 'second', 'other-track', 'third', 'fourth', 'isolated']);
    assert.deepEqual(concatenated, [['first.mp4', 'second.mp4'], ['third.mp4', 'fourth.mp4']]);
    assert.equal(result.completed, 6);
    assert.equal(result.merged, 2);
    const clips = env.editor.timeline.getTracks().flatMap(track => track.elements);
    assert.equal(clips.length, 4);
    assert.deepEqual(Array.from(clips, clip => clip.startTime).sort((a, b) => a - b), [2, 12.34, 20, 40]);
    assert.equal(clips.filter(clip => clip.name === 'AI 镜头 · 全部导出').length, 2);
    assert.ok(clips.every(clip => !clip.directorGeneration));
});

test('all output does not merge across gaps, overlaps, tracks, or unselected clips', async () => {
    const env = await setup({ ...values, task_type: 'T2VA' }, {
        onRun: () => [{ filename: 'result.mp4', type: 'output' }],
        onConcat: () => assert.fail('disconnected clips must remain separate'),
    });
    let planning = env.api.saveTextToVideoDraft(env.planning(), { startTime: 7.17, trackIndex: 1 }, { ...values, task_type: 'T2VA' });
    planning = env.api.saveTextToVideoDraft(planning, { startTime: 12.34, trackIndex: 1 }, { ...values, task_type: 'T2VA' });
    const thirdId = planning.selectedShotId;
    planning = env.api.saveTextToVideoDraft(planning, { startTime: 17, trackIndex: 0 }, { ...values, task_type: 'T2VA' });
    const overlapId = planning.selectedShotId;
    planning = env.api.saveTextToVideoDraft(planning, { startTime: 22.17, trackIndex: 1 }, { ...values, task_type: 'T2VA' });
    env.setPlanning({ ...planning, aiTrackOutputMode: 'all' });
    const result = await env.api.generateAIShots(env.editor, [env.shotId, thirdId, overlapId, planning.selectedShotId]);
    assert.equal(result.merged, 0);
    assert.equal(env.editor.timeline.getTracks().flatMap(track => track.elements).length, 4);
});

test('segments stay separate and direct generation uses the saved seam frame count', async () => {
    const env = await setup({ ...values, task_type: 'T2VA' }, {
        onRun: () => [{ filename: 'result.mp4', type: 'output' }],
        onResolveGuide: () => ({ filename: 'previous.mp4', type: 'output' }),
        onConcat: () => assert.fail('segments output cannot concatenate'),
    });
    const next = env.api.saveTextToVideoDraft(env.planning(), { startTime: 7.17, trackIndex: 1 }, { ...values, task_type: 'T2VA' });
    env.setPlanning({ ...next, aiTrackGuideEnabled: true, scenes: next.scenes.map(scene => ({ ...scene,
        shots: scene.shots.map(shot => shot.id === next.selectedShotId ? { ...shot, aiTrackGuideFrames: 56 } : shot),
    })) });
    const result = await env.api.generateAIShots(env.editor);
    assert.equal(result.outputMode, 'segments');
    assert.equal(result.merged, 0);
    assert.equal(env.editor.timeline.getTracks().flatMap(track => track.elements).length, 2);
    await env.api.generateTextToVideo(env.editor, next.selectedShotId, 'module', { ...values, task_type: 'T2VA' });
    const submitted = env.calls.filter(call => call.operation === 'capcut:run-workflow').at(-1).payload.values;
    assert.equal(submitted.continuity_video.filename, 'previous.mp4');
    assert.equal(submitted.continuity_frames, 56);
    const edited = env.api.saveTextToVideoDraft(env.planning(), { startTime: 7.17, trackIndex: 1 },
        { ...values, task_type: 'T2VA', duration: 6 }, next.selectedShotId);
    assert.equal(edited.scenes.find(scene => scene.shots[0].id === next.selectedShotId).shots[0].aiTrackGuideFrames, 56);
});
