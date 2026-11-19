import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const sourceUrl = new URL("../web/minimax.js", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const template = JSON.parse(await readFile(new URL("../web/workflows/minimax_h3.json", import.meta.url), "utf8"));

async function adapter(api = {}) {
    let provider;
    const context = vm.createContext({
        structuredClone, URL,
        setTimeout: callback => { callback(); },
        fetch: async () => ({ ok: true, json: async () => structuredClone(template) }),
    });
    const module = new vm.SourceTextModule(source, { context, initializeImportMeta: meta => { meta.url = sourceUrl.href; } });
    await module.link(specifier => {
        const name = specifier.endsWith("api.js") ? "api" : "registerCapCutWorkflow";
        return new vm.SyntheticModule([name], function () {
            this.setExport(name, name === "api" ? api : (type, value) => {
                assert.equal(type, "CapCutMiniMaxH3Workflow");
                provider = value;
            });
        }, { context });
    });
    await module.evaluate();
    const values = Object.fromEntries(module.namespace.fields.map(field => [field.name, field.type === "media" ? [] : field.default]));
    return { ...module.namespace, provider, values };
}

const file = name => ({ filename: name, subfolder: "CapCut/default/project", type: "input" });

test("direct generation preserves the supplied model and sampling graph without sample media or credentials", async () => {
    const { buildMinimaxPrompt, values } = await adapter();
    const prompt = buildMinimaxPrompt(template, {}, values);
    assert.equal(prompt["7"].inputs.steps, 8);
    assert.equal(prompt["9"].inputs.noise_seed, template["9"].inputs.noise_seed);
    assert.equal(buildMinimaxPrompt(template, {}, { ...values, seed: -1 })["9"].inputs.noise_seed, template["9"].inputs.noise_seed);
    assert.equal(prompt["7"].inputs.sampler_name, "dual_clock_euler");
    assert.equal(prompt["62"].inputs.block_range_start, 25);
    assert.equal(prompt["62"].inputs.block_range_end, 49);
    assert.equal(prompt["14"].inputs.value, 15);
    assert.equal(prompt["16"].inputs.megapixels, 0.4);
    assert.equal(prompt["12"].inputs.frame_rate, 24);
    assert.equal(prompt["6"].inputs.task_type, "T2VA");
    assert.equal(prompt["6"].inputs.prompt, values.prompt);
    assert.equal(prompt["73"], undefined);
    assert.ok(!Object.values(prompt).some(node => ["LoadImage", "LoadAudio", "VHS_LoadVideo"].includes(node.class_type)));
    assert.ok(!/sk-[a-z0-9]{20}/i.test(JSON.stringify(template)));
    assert.equal(template["6"].inputs.prompt, "");
    for (const node of Object.values(prompt)) for (const value of Object.values(node.inputs)) {
        if (Array.isArray(value)) assert.ok(prompt[value[0]], `Dangling link ${value[0]}`);
    }
});

test("references keep selection order, use project files and 24 fps, and are not truncated", async () => {
    const { buildMinimaxPrompt, values } = await adapter();
    values.task_type = "Ref2VA";
    values.ref_images = Array.from({ length: 10 }, (_, index) => file(`${index}.png`));
    values.ref_videos = [file("reference.mp4")];
    values.ref_audios = [file("voice.flac")];
    values.final_audio = [file("final.wav")];
    const prompt = buildMinimaxPrompt(template, {}, values);
    assert.equal(prompt.ref_images_9.inputs.image, "CapCut/default/project/9.png");
    assert.equal(prompt["6"].inputs["ref_images.ref_image_9"][0], "ref_images_9");
    assert.equal(prompt["6"].inputs["ref_audios.ref_audio_0"][0], "63");
    assert.equal(prompt["66"].inputs.force_rate, 24);
    assert.equal(prompt["66"].inputs.format, "None");
    assert.equal(prompt["12"].inputs.audio[0], "6");
    assert.equal(prompt["12"].inputs.audio[1], 2);
});

test("multi-reference generation maps all original image, audio and video nodes and excludes keyframes", async () => {
    const { buildMinimaxPrompt, values } = await adapter();
    const groups = [
        ["ref_images", ["37", "40", "43", "38", "41", "44", "39", "42", "45"], "image", "png"],
        ["ref_audios", ["63", "69", "70"], "audio", "wav"],
        ["ref_videos", ["66", "67", "68"], "video", "mp4"],
    ];
    Object.assign(values, { task_type: "Ref2VA", enhance_prompt: "on", prompt_api_key: "test-key",
        first_frame: [{ type: "output", filename: "stale-first.png" }], last_frame: [{ type: "output", filename: "stale-last.png" }] });
    for (const [name, ids, , extension] of groups) values[name] = ids.map((_, index) => file(`${name}-${index + 1}.${extension}`));
    const original = structuredClone(template);
    original["71"] = { class_type: "LoadImage", inputs: { image: "stale-first.png" } };
    original["6"].inputs.first_frame = ["71", 0];
    original["6"].inputs["ref_images.ref_image_10"] = ["71", 0];
    const prompt = buildMinimaxPrompt(original, {}, values);
    assert.equal(prompt["6"].inputs.task_type, "Ref2VA");
    assert.equal(prompt["73"].inputs["H3 模式"], "Ref2VA");
    assert.equal(prompt["71"], undefined);
    assert.equal(prompt["72"], undefined);
    assert.equal(prompt["6"].inputs.first_frame, undefined);
    assert.equal(prompt["6"].inputs.last_frame, undefined);
    assert.equal(prompt["6"].inputs["ref_images.ref_image_10"], undefined);
    for (const [name, ids, input, extension] of groups) for (const [index, id] of ids.entries()) {
        assert.equal(prompt[id].inputs[input], `CapCut/default/project/${name}-${index + 1}.${extension}`);
        assert.equal(prompt["6"].inputs[`${name}.${name.slice(0, -1)}_${index}`][0], id);
        if (input === "video") assert.equal(prompt[id].inputs.force_rate, 24);
    }
    assert.equal(Object.values(prompt).filter(node => ["LoadImage", "LoadAudio", "VHS_LoadVideo"].includes(node.class_type)).length, 15);
    assert.equal(template["37"], undefined);
});

test("multi-reference generation requires a reference and accepts each media kind on its own", async () => {
    const { buildMinimaxPrompt, values } = await adapter();
    values.task_type = "Ref2VA";
    assert.throws(() => buildMinimaxPrompt(template, {}, values), /至少上传一项/);
    for (const [name, filename] of [["ref_images", "image.png"], ["ref_audios", "audio.wav"], ["ref_videos", "video.mp4"]]) {
        const prompt = buildMinimaxPrompt(template, {}, { ...values, [name]: [file(filename)] });
        assert.equal(prompt["6"].inputs.task_type, "Ref2VA");
        assert.ok(prompt["6"].inputs[`${name}.${name.slice(0, -1)}_0`]);
        assert.deepEqual(Array.from(prompt["12"].inputs.audio), ["11", 1]);
    }
});

test("video editing maps only video 1 to node 66 and passes edit prompts to the native reference mode", async () => {
    const { buildMinimaxPrompt, values } = await adapter();
    const unused = { type: 'output', filename: 'unused.bin' };
    Object.assign(values, { task_type: 'V2VA', prompt: '把背景改成雪景', system_prompt: '不要背景音乐', enhance_prompt: 'on', prompt_api_key: 'test-key',
        ref_videos: [file('source.mp4'), unused], audio_mode: 'lock_source' });
    for (const name of ['first_frame', 'last_frame', 'ref_images', 'ref_audios', 'drive_audio', 'final_audio']) values[name] = [unused];
    const original = structuredClone(template);
    original['67'] = { class_type: 'VHS_LoadVideo', inputs: { video: 'old.mp4' } };
    original['6'].inputs['ref_videos.ref_video_1'] = ['67', 0];
    const prompt = buildMinimaxPrompt(original, {}, values);
    assert.equal(prompt['6'].inputs.task_type, 'Ref2VA');
    assert.equal(prompt['6'].inputs.audio_mode, 'native');
    assert.deepEqual(Array.from(prompt['6'].inputs['ref_videos.ref_video_0']), ['66', 0]);
    assert.equal(prompt['6'].inputs['ref_videos.ref_video_1'], undefined);
    assert.equal(prompt['66'].inputs.video, 'CapCut/default/project/source.mp4');
    assert.equal(prompt['66'].inputs.force_rate, 24);
    assert.equal(prompt['67'], undefined);
    assert.equal(Object.values(prompt).filter(node => ['LoadImage', 'LoadAudio', 'VHS_LoadVideo'].includes(node.class_type)).length, 1);
    assert.deepEqual(Array.from(prompt['12'].inputs.audio), ['11', 1]);
    assert.equal(prompt['73'].inputs['H3 模式'], 'Ref2VA');
    assert.equal(prompt['73'].inputs['用户提示词'], '<Video 1> 不要背景音乐,把背景改成雪景');
    assert.match(prompt['73'].inputs['补充上下文'], /视频编辑.*<Video 1>/);
    assert.equal(values.prompt, '把背景改成雪景');
    assert.equal(original['67'].inputs.video, 'old.mp4');
});

test("video editing requires video 1 and preserves existing reference labels without duplication", async () => {
    const { buildMinimaxPrompt, values } = await adapter();
    Object.assign(values, { task_type: 'V2VA', ref_images: [file('unused.png')], ref_audios: [file('unused.wav')] });
    assert.throws(() => buildMinimaxPrompt(template, {}, values), /上传视频 1/);
    values.ref_videos = [file('source.mp4')];
    values.prompt = '编辑 <Video 1> 的背景';
    const prompt = buildMinimaxPrompt(template, {}, values);
    assert.equal(prompt['6'].inputs.prompt, values.prompt);
    assert.equal(prompt['73'], undefined);
    assert.equal((prompt['6'].inputs.prompt.match(/<Video 1>/g) ?? []).length, 1);
    assert.throws(() => buildMinimaxPrompt(template, {}, { ...values, ref_videos: [{ type: 'output', filename: 'source.mp4' }] }), /先导入当前工程/);
});

test("video editing with references maps one source, nine pictures and three audios to the agreed nodes", async () => {
    const { buildMinimaxPrompt, values } = await adapter();
    const unused = { type: 'output', filename: 'unused.bin' };
    Object.assign(values, { task_type: 'V2VARef', prompt: '按照 <Picture 9> 的风格修改 <Video 1>，参考 <Audio 3> 的声音',
        enhance_prompt: 'on', prompt_api_key: 'test-key', ref_videos: [file('source.mp4'), unused],
        ref_images: Array.from({ length: 9 }, (_, i) => file(`image-${i + 1}.png`)),
        ref_audios: Array.from({ length: 3 }, (_, i) => file(`audio-${i + 1}.wav`)),
        first_frame: [unused], last_frame: [unused], drive_audio: [unused], final_audio: [unused] });
    const original = structuredClone(template);
    original['67'] = { class_type: 'VHS_LoadVideo', inputs: { video: 'old.mp4' } };
    original['6'].inputs['ref_videos.ref_video_1'] = ['67', 0];
    original['6'].inputs.first_frame = ['71', 0];
    const prompt = buildMinimaxPrompt(original, {}, values);
    assert.equal(prompt['6'].inputs.task_type, 'Ref2VA');
    assert.equal(prompt['6'].inputs.audio_mode, 'native');
    assert.equal(prompt['66'].inputs.video, 'CapCut/default/project/source.mp4');
    assert.equal(prompt['66'].inputs.force_rate, 24);
    assert.deepEqual(Array.from(prompt['6'].inputs['ref_videos.ref_video_0']), ['66', 0]);
    for (const [name, ids, input] of [
        ['ref_images', ['37', '40', '43', '38', '41', '44', '39', '42', '45'], 'image'],
        ['ref_audios', ['63', '69', '70'], 'audio'],
    ]) for (const [index, id] of ids.entries()) {
        assert.equal(prompt[id].inputs[input], `CapCut/default/project/${input}-${index + 1}.${input === 'image' ? 'png' : 'wav'}`);
        assert.deepEqual(Array.from(prompt['6'].inputs[`${name}.${name.slice(0, -1)}_${index}`]), [id, 0]);
    }
    assert.equal(Object.values(prompt).filter(node => ['LoadImage', 'LoadAudio', 'VHS_LoadVideo'].includes(node.class_type)).length, 13);
    for (const name of ['first_frame', 'last_frame', 'drive_audio', 'final_audio', 'ref_videos.ref_video_1'])
        assert.equal(prompt['6'].inputs[name], undefined);
    assert.equal(prompt['67'], undefined);
    assert.deepEqual(Array.from(prompt['12'].inputs.audio), ['11', 1]);
    assert.equal(prompt['73'].inputs['H3 模式'], 'Ref2VA');
    assert.match(prompt['73'].inputs['补充上下文'], /视频\+参考修改.*<Video 1>.*<Picture 1>.*<Audio 1>/);
    assert.equal((prompt['73'].inputs['用户提示词'].match(/<Video 1>/g) ?? []).length, 1);
    assert.equal(values.task_type, 'V2VARef');
    assert.equal(original['67'].inputs.video, 'old.mp4');
});

test("video editing with references requires its source video and permits optional pictures and audio", async () => {
    const { buildMinimaxPrompt, values } = await adapter();
    Object.assign(values, { task_type: 'V2VARef', ref_images: [file('image.png')], ref_audios: [file('audio.wav')] });
    assert.throws(() => buildMinimaxPrompt(template, {}, values), /上传视频 1/);
    for (const references of [{}, { ref_images: [file('image.png')] }, { ref_audios: [file('audio.wav')] }]) {
        const prompt = buildMinimaxPrompt(template, {}, { ...values, ref_images: [], ref_audios: [], ...references, ref_videos: [file('source.mp4')] });
        assert.match(prompt['6'].inputs.prompt, /^<Video 1>/);
        assert.equal(Object.values(prompt).filter(node => node.class_type === 'VHS_LoadVideo').length, 1);
        assert.equal(prompt['73'], undefined);
    }
});

test("node settings, seed and keyframes reach the native workflow", async () => {
    const { buildMinimaxPrompt, values } = await adapter();
    values.seed = 123456;
    values.task_type = "FL2VA";
    values.first_frame = [file("first.png")];
    values.last_frame = [file("last.png")];
    const prompt = buildMinimaxPrompt(template, { steps: 12, base_model: "chosen.safetensors", lora_strength: 0.75 }, values);
    assert.equal(prompt["62"].inputs.base_model, "chosen.safetensors");
    assert.equal(prompt["78"].inputs.strength_model, 0.75);
    assert.equal(prompt["7"].inputs.steps, 12);
    assert.equal(prompt["9"].inputs.noise_seed, 123456);
    assert.equal(prompt["6"].inputs.first_frame[0], "71");
    assert.equal(prompt["6"].inputs.last_frame[0], "72");
});

test("image to video uses only node 71, sets I2VA, and ignores stale tail frames and references", async () => {
    const { buildMinimaxPrompt, provider, values } = await adapter();
    Object.assign(values, { task_type: "I2VA", first_frame: [file("first.png")], enhance_prompt: "on", prompt_api_key: "test-key" });
    for (const name of ["last_frame", "ref_images", "ref_videos", "ref_audios", "drive_audio", "final_audio"])
        values[name] = [{ filename: "removed-file", type: "output" }];
    const original = structuredClone(template);
    original["72"] = { class_type: "LoadImage", inputs: { image: "old-tail.png" } };
    original["6"].inputs.last_frame = ["72", 0];
    const prompt = buildMinimaxPrompt(original, {}, values);
    assert.equal(provider.usesMedia(values), true);
    assert.equal(prompt["6"].inputs.task_type, "I2VA");
    assert.equal(prompt["6"].inputs.first_frame[0], "71");
    assert.equal(prompt["71"].class_type, "LoadImage");
    assert.equal(prompt["71"].inputs.image, "CapCut/default/project/first.png");
    assert.equal(prompt["72"], undefined);
    assert.equal(prompt["6"].inputs.last_frame, undefined);
    assert.equal(Object.values(prompt).filter(node => node.class_type === "LoadImage").length, 1);
    assert.equal(prompt["73"].inputs["H3 模式"], "I2VA");
    assert.match(prompt["73"].inputs["补充上下文"], /一张首帧图片/);
    assert.deepEqual(Array.from(prompt["12"].inputs.audio), ["11", 1]);
    assert.throws(() => buildMinimaxPrompt(template, {}, { ...values, first_frame: [] }), /首帧图片/);
    assert.equal(template["71"], undefined);
});

test("first and last frame generation maps nodes 71 and 72, selects FL2VA and ignores other references", async () => {
    const { buildMinimaxPrompt, values } = await adapter();
    Object.assign(values, { task_type: "FL2VA", first_frame: [file("first.png")], last_frame: [file("last.png")],
        enhance_prompt: "on", prompt_api_key: "test-key", audio_mode: "lock_source" });
    for (const name of ["ref_images", "ref_videos", "ref_audios", "drive_audio", "final_audio"])
        values[name] = [{ filename: "removed-file", type: "output" }];
    const original = structuredClone(template);
    original.old_reference = { class_type: "LoadImage", inputs: { image: "old-reference.png" } };
    original["6"].inputs["ref_images.ref_image_0"] = ["old_reference", 0];
    const prompt = buildMinimaxPrompt(original, {}, values);
    assert.equal(prompt["6"].inputs.task_type, "FL2VA");
    assert.equal(prompt["6"].inputs.first_frame[0], "71");
    assert.equal(prompt["6"].inputs.last_frame[0], "72");
    assert.equal(prompt["71"].inputs.image, "CapCut/default/project/first.png");
    assert.equal(prompt["72"].inputs.image, "CapCut/default/project/last.png");
    assert.equal(Object.values(prompt).filter(node => node.class_type === "LoadImage").length, 2);
    assert.equal(prompt.old_reference, undefined);
    assert.equal(prompt["6"].inputs["ref_images.ref_image_0"], undefined);
    assert.equal(prompt["73"].inputs["H3 模式"], "FL2VA");
    assert.match(prompt["73"].inputs["补充上下文"], /首帧和尾帧图片/);
    assert.equal(prompt["6"].inputs.audio_mode, "native");
    assert.deepEqual(Array.from(prompt["12"].inputs.audio), ["11", 1]);
    assert.throws(() => buildMinimaxPrompt(template, {}, { ...values, first_frame: [] }), /首帧图片/);
    assert.throws(() => buildMinimaxPrompt(template, {}, { ...values, last_frame: [] }), /尾帧图片/);
    assert.equal(template["71"], undefined);
    assert.equal(template["72"], undefined);
});

test("prompt enhancement requires an explicit session key and never changes the template", async () => {
    const { buildMinimaxPrompt, values } = await adapter();
    values.enhance_prompt = "on";
    assert.throws(() => buildMinimaxPrompt(template, {}, values), /API 密钥/);
    values.prompt_api_key = "test-session-key";
    const prompt = buildMinimaxPrompt(template, {}, values);
    assert.equal(prompt["73"].inputs["API 密钥"], "test-session-key");
    assert.equal(prompt["73"].inputs["用户提示词"], values.prompt);
    assert.equal(prompt["6"].inputs.prompt[0], "73");
    assert.equal(template["73"].inputs["API 密钥"], "");
    assert.equal(prompt["12"].inputs.save_metadata, false);
});

test("disabling prompt enhancement bypasses node 73 and its key for every H3 generation mode", async () => {
    const { buildMinimaxPrompt, values } = await adapter();
    for (const [mode, media] of [
        ['T2VA', {}], ['I2VA', { first_frame: [file('first.png')] }],
        ['FL2VA', { first_frame: [file('first.png')], last_frame: [file('last.png')] }],
        ['Ref2VA', { ref_images: [file('reference.png')] }], ['V2VA', { ref_videos: [file('source.mp4')] }],
        ['V2VARef', { ref_videos: [file('source.mp4')], ref_images: [file('reference.png')], ref_audios: [file('voice.wav')] }],
    ]) {
        const original = structuredClone(template);
        original['6'].inputs.prompt = ['73', 0];
        const prompt = buildMinimaxPrompt(original, {}, { ...values, ...media, task_type: mode,
            enhance_prompt: 'off', prompt_api_key: '', system_prompt: '不要背景音乐', prompt: '修改画面' });
        assert.equal(prompt['73'], undefined, mode);
        assert.equal(prompt['6'].inputs.prompt, `${mode.startsWith('V2VA') ? '<Video 1> ' : ''}不要背景音乐,修改画面`, mode);
        assert.ok(!Object.values(prompt).some(node => node.class_type === 'MiniMaxH3PromptSkill'), mode);
        assert.deepEqual(original['6'].inputs.prompt, ['73', 0]);
    }
});

test("text to video ignores every reference, including stale or non-input media", async () => {
    const { buildMinimaxPrompt, provider, values } = await adapter();
    for (const name of ["first_frame", "last_frame", "ref_images", "ref_videos", "ref_audios", "drive_audio", "final_audio"]) {
        values[name] = [{ filename: "removed-file", type: "output" }];
    }
    values.audio_mode = "lock_source";
    const original = structuredClone(template);
    original["old_image"] = { class_type: "LoadImage", inputs: { image: "removed.png" } };
    original["6"].inputs.first_frame = ["old_image", 0];
    original["6"].inputs["ref_images.ref_image_0"] = ["old_image", 0];
    const prompt = buildMinimaxPrompt(original, {}, values);
    assert.equal(provider.usesMedia(values), false);
    assert.equal(prompt["6"].inputs.audio_mode, "native");
    assert.ok(!Object.keys(prompt["6"].inputs).some(name => /^(first_frame|last_frame|drive_audio|final_audio|ref_)/.test(name) && Array.isArray(prompt["6"].inputs[name])));
    assert.ok(!Object.values(prompt).some(node => ["LoadImage", "LoadAudio", "VHS_LoadVideo"].includes(node.class_type)));
    assert.deepEqual(Array.from(prompt["12"].inputs.audio), ["11", 1]);
    values.task_type = "Ref2VA";
    assert.equal(provider.usesMedia(values), true);
});

test("text to video maps system prompt, user prompt and all director choices to node 73", async () => {
    const { buildMinimaxPrompt, values } = await adapter();
    Object.assign(values, { system_prompt: "不要背景音乐", prompt: "雨后街道", enhance_prompt: "on", prompt_api_key: "test-key",
        prompt_skill: "selected-skill", prompt_director: "战斗导演", prompt_intensity: "R1 写实克制", prompt_model: "selected-model",
        duration: 4, aspect_ratio: "9:16 (Portrait Widescreen)", megapixels: 1 });
    const prompt = buildMinimaxPrompt(template, {}, values);
    assert.equal(prompt["73"].inputs["用户提示词"], "不要背景音乐,雨后街道");
    assert.equal(prompt["73"].inputs["官方 Skill"], "selected-skill");
    assert.equal(prompt["73"].inputs["导演"], "战斗导演");
    assert.equal(prompt["73"].inputs["动作强度"], "R1 写实克制");
    assert.equal(prompt["73"].inputs["模型"], "selected-model");
    assert.equal(prompt["73"].inputs["H3 模式"], "T2VA");
    assert.match(prompt["73"].inputs["补充上下文"], /没有图片、视频或音频/);
    assert.equal(prompt["14"].inputs.value, 4);
    assert.equal(prompt["16"].inputs.aspect_ratio, values.aspect_ratio);
    assert.equal(prompt["16"].inputs.megapixels, 1);
    assert.equal(prompt["6"].inputs.prompt[0], "73");
    assert.equal(template["73"].inputs["API 密钥"], "");
});

test("generation duration accepts 4 and 15 seconds and rejects values outside the requested range", async () => {
    const { buildMinimaxPrompt, values } = await adapter();
    for (const duration of [4, 4.1, 15]) assert.equal(buildMinimaxPrompt(template, {}, { ...values, duration })["14"].inputs.value, duration);
    for (const duration of [3.9, 15.1, "", NaN]) assert.throws(() => buildMinimaxPrompt(template, {}, { ...values, duration }), /4 到 15/);
});

test("director selectors use the installed prompt node schema", async () => {
    const { provider } = await adapter({ fetchApi: async path => {
        assert.equal(path, "/object_info/MiniMaxH3PromptSkill");
        return { ok: true, json: async () => ({ MiniMaxH3PromptSkill: { input: {
            required: { "官方 Skill": [["new-local-skill"], { default: "new-local-skill" }], "模型": [[""], {}] },
            optional: { "导演": [["new-director"], { default: "new-director" }] }
        } } }) };
    } });
    const fields = await provider.getFields();
    assert.equal(fields.find(field => field.name === "prompt_skill").default, "new-local-skill");
    assert.equal(fields.find(field => field.name === "prompt_director").options[0], "new-director");
    assert.equal(fields.find(field => field.name === "prompt_model").options[0], "gpt-6-sol");
});

test("failed option requests can be retried when reopening the dialog", async () => {
    let calls = 0;
    const { provider } = await adapter({ fetchApi: async () => {
        calls++;
        return calls === 1 ? { ok: false, status: 503 } : { ok: true, json: async () => ({ MiniMaxH3PromptSkill: { input: {
            required: { "导演": [["recovered-director"], {}] }
        } } }) };
    } });
    await assert.rejects(provider.getFields(), /503/);
    const fields = await provider.getFields();
    assert.equal(fields.find(field => field.name === "prompt_director").options[0], "recovered-director");
    assert.equal(calls, 2);
});

test("missing optional prompt nodes keep the built-in choices", async () => {
    const { provider, fields } = await adapter({ fetchApi: async () => ({ ok: true, json: async () => ({}) }) });
    assert.deepEqual(await provider.getFields(), fields);
});

test("model choices reuse the original prompt plugin endpoint", async () => {
    const { provider } = await adapter({ fetchApi: async (path, options) => {
        assert.equal(path, "/minimax-prompt/models");
        assert.equal(JSON.parse(options.body).api_key, "session-key");
        return { ok: true, json: async () => ({ models: ["chosen-model"] }) };
    } });
    assert.equal((await provider.loadModels("session-key"))[0], "chosen-model");
});

test("the studio bridge opens over LAN HTTP and skips stale media for text to video", async () => {
    let handler, response;
    const origin = "http://192.168.31.124:8188";
    const paths = [];
    const iframe = { contentWindow: { postMessage: value => { response = value; } }, isConnected: true, focus() {} };
    const window = { addEventListener: (name, listener) => { handler = listener; } };
    const context = vm.createContext({
        window, location: { origin }, crypto: { getRandomValues: bytes => globalThis.crypto.getRandomValues(bytes) },
        document: { createElement: () => iframe, body: { append() {} } },
        URLSearchParams, Uint8Array,
    });
    const source = await readFile(new URL("../web/studio.js", import.meta.url), "utf8");
    const studio = new vm.SourceTextModule(source, { context });
    const api = { apiURL: path => path, fetchApi: async path => {
        paths.push(path);
        assert.equal(path, "/capcut/studio/open");
        return { ok: true, json: async () => ({ id: "project", name: "Test" }) };
    } };
    await studio.link(specifier => new vm.SyntheticModule([specifier.endsWith("app.js") ? "app" : "api"], function () {
        if (specifier.endsWith("app.js")) this.setExport("app", { canvas: { pause_rendering: false } });
        else this.setExport("api", api);
    }, { context }));
    await studio.evaluate();
    const sourceNode = { id: 2, type: "CapCutMiniMaxH3Workflow" };
    const { provider } = await adapter();
    await studio.namespace.openStudio({ properties: {}, widgets: [], inputs: [{ link: 1, type: "CAPCUT_WORKFLOW" }], graph: {
        links: new Map([[1, { origin_id: 2 }]]), getNodeById: () => sourceNode, setDirtyCanvas() {}, change() {}
    } }, new Map([[sourceNode.type, { ...provider, run: async ({ values, clip, asset }) => {
        assert.equal(values.task_type, "T2VA");
        assert.equal(clip, null);
        assert.equal(asset, null);
        return [];
    } }]]));
    const session = new URLSearchParams(iframe.src.split("#")[1]).get("session");
    assert.match(session, /^[0-9a-f-]{32,36}$/);
    await handler({ origin, source: iframe.contentWindow, data: {
        channel: "raccoon-editing-v1", session, type: "request", id: "run", operation: "capcut:run-workflow",
        payload: { id: "2", values: { task_type: "T2VA", first_frame: "deleted-image", ref_videos: ["deleted-video"] },
            clip: { id: "selected-clip" }, asset: { id: "deleted-asset" }, settings: { canvasSize: { width: 1920, height: 1080 }, fps: 24 }, projectId: "project" }
    } });
    assert.equal(response.error, undefined);
    assert.equal(response.id, "run");
    assert.equal(paths.length, 1);
});

test("submission queues only the fixed prompt and returns only this task's saved video", async () => {
    let queued;
    const result = { filename: "result-audio.mp4", subfolder: "MiniMaxH3", type: "output" };
    const api = {
        getNodeDefs: async () => Object.fromEntries(Object.values(template).map(node => [node.class_type, {}])),
        queuePrompt: async (position, payload) => { assert.equal(position, 0); queued = payload; return { prompt_id: "our-task" }; },
        fetchApi: async path => {
            assert.equal(path, "/history/our-task");
            return { ok: true, json: async () => ({ "our-task": {
                status: { completed: true, status_str: "success" },
                outputs: { "12": { gifs: [result] }, other: { gifs: [{ ...result, filename: "wrong.mp4" }] } },
            } }) };
        },
    };
    const { provider, values } = await adapter(api);
    const files = await provider.run({ node: { widgets: [], graph: { serialize: () => ({ nodes: [] }) } }, values });
    assert.equal(files.length, 1);
    assert.equal(files[0].filename, result.filename);
    assert.equal(queued.output["6"].inputs.prompt, values.prompt);
    assert.equal(queued.output["73"], undefined);
});

test("sampling switches queue only the connected branches and route the refined result to decode", async () => {
    let queued, reads = 0;
    const graph = {
        "1": { class_type: "CapCutMainConsole", inputs: { selflift: [158, 0], refine: [165, 0] } },
        "158": { class_type: "MiniMaxH3DirectorSelfLift", inputs: { highres_steps: 2 } },
        "165": { class_type: "MiniMaxH3DirectorRefine", inputs: { mode: "upscale", sigmas: [163, 0], megapixels: 2, skip_fl2v: true, confirm_first_pass: true } },
        "163": { class_type: "BasicScheduler", inputs: { model: [168, 0], steps: 4 } },
        "168": { class_type: "UNETLoader", inputs: { unet_name: "refine.safetensors" } },
        "999": { class_type: "UnrelatedNode", inputs: {} },
    };
    const { provider, values } = await adapter({
        getNodeDefs: async () => Object.fromEntries([
            ...Object.values(template).map(node => node.class_type), ...Object.values(graph).map(node => node.class_type),
            "CapCutSelfLiftSampler", "CapCutRefineSampler", "LoadImage",
        ].map(type => [type, {}])),
        queuePrompt: async (_, payload) => { queued = payload.output; return { prompt_id: "sampling" }; },
        fetchApi: async () => ({ ok: true, json: async () => ({ sampling: { status: { completed: true }, outputs: { "12": { gifs: [{ filename: "result.mp4" }] } } } }) }),
    });
    assert.equal(values.refine_megapixels, 1);
    const node = { widgets: [], graph: { serialize: () => ({}) } };
    const getConsolePrompt = async () => { reads++; return { consoleId: "1", output: graph }; };
    for (const selflift of [false, true]) for (const refine of [false, true]) {
        await provider.run({ node, getConsolePrompt, values: { ...values, selflift_enabled: selflift, refine_enabled: refine,
            task_type: "FL2VA", first_frame: [file("first.png")], last_frame: [file("last.png")], refine_megapixels: refine && selflift ? 1.4 : undefined } });
        assert.equal(queued["16"].inputs.megapixels, 0.4);
        assert.equal(queued["10"].class_type, selflift ? "CapCutSelfLiftSampler" : "SamplerCustomAdvanced");
        assert.equal(Boolean(queued.capcut_sampling_158), selflift);
        assert.equal(Boolean(queued.capcut_sampling_165), refine);
        assert.equal(queued["11"].inputs.av_latent[0], refine ? "capcut_refine" : "10");
        assert.equal(queued.capcut_sampling_999, undefined);
        if (refine) {
            assert.equal(queued.capcut_sampling_165.inputs.megapixels, selflift ? 1.4 : 1);
            assert.equal(queued.capcut_sampling_165.inputs.skip_fl2v, false);
            assert.equal(queued.capcut_sampling_165.inputs.confirm_first_pass, false);
            assert.equal(queued.capcut_sampling_163.inputs.model[0], "capcut_sampling_168");
            assert.equal(queued.capcut_refine.inputs.latent[0], "10");
            assert.equal(queued.capcut_refine.inputs.first_frame[0], "71");
            assert.equal(queued.capcut_refine.inputs.last_frame[0], "72");
        }
        for (const item of Object.values(queued)) for (const input of Object.values(item.inputs)) {
            if (Array.isArray(input)) assert.ok(queued[input[0]], `Dangling link ${input[0]}`);
        }
    }
    assert.equal(reads, 3);
    assert.equal(graph["165"].inputs.megapixels, 2);
    await assert.rejects(provider.run({ node, values: { ...values, selflift_enabled: true },
        getConsolePrompt: async () => ({ consoleId: "1", output: {} }) }), /接到当前主控台/);
});

test("missing dependencies fail before submitting a generation task", async () => {
    let queued = false;
    const { provider, values } = await adapter({ getNodeDefs: async () => ({}), queuePrompt: async () => { queued = true; } });
    await assert.rejects(() => provider.run({ node: { widgets: [] }, values }), /缺少工作流节点/);
    assert.equal(queued, false);
});

test("concurrent generations receive only their own progress and remove listeners on completion", async () => {
    assert.equal(template['10'].class_type, 'SamplerCustomAdvanced');
    assert.equal(template['7'].class_type, 'MiniMaxH3DualClockSamplerT8');
    const listeners = new Map(), updates = [[], []];
    let queued = 0, reading = 0, ready, complete;
    const started = new Promise(resolve => { ready = resolve; });
    const finished = new Promise(resolve => { complete = resolve; });
    const api = {
        getNodeDefs: async () => Object.fromEntries(Object.values(template).map(node => [node.class_type, {}])),
        addEventListener: (name, listener) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
        removeEventListener: (name, listener) => listeners.get(name).delete(listener),
        queuePrompt: async () => ({ prompt_id: `task-${++queued}` }),
        fetchApi: async path => {
            if (++reading === 2) ready();
            await finished;
            const id = path.split('/').at(-1);
            return { ok: true, json: async () => ({ [id]: { status: { completed: true }, outputs: {
                '12': { gifs: [{ filename: `${id}.mp4`, type: 'output', subfolder: '' }] }
            } } }) };
        },
    };
    const { provider, values } = await adapter(api);
    const tasks = updates.map(events => provider.run({ node: { widgets: [], graph: { serialize: () => ({}) } }, values,
        onProgress: value => events.push(value) }));
    await started;
    const emit = (name, detail) => { for (const listener of listeners.get(name)) listener({ detail }); };
    emit('progress', { prompt_id: 'unrelated', node: '10', value: 7, max: 8 });
    emit('progress', { prompt_id: 'task-1', node: '7', value: 4, max: 8 });
    assert.equal(updates[0].at(-1).status, 'queued');
    emit('progress', { prompt_id: 'task-1', node: '10', value: 4, max: 8 });
    assert.equal(updates[0].at(-1).percent, 50);
    assert.equal(updates[1].at(-1).status, 'queued');
    emit('executing', { prompt_id: 'task-2', node: '11' });
    assert.equal(updates[1].at(-1).stage, '视频解码');
    assert.equal(updates[0].at(-1).stage, '视频采样 4/8 步');
    emit('progress_state', { prompt_id: 'task-2', nodes: { '10': { value: 6, max: 8, state: 'running' } } });
    assert.equal(updates[1].at(-1).percent, 75);
    assert.equal(updates[0].at(-1).percent, 50);
    emit('progress_state', { prompt_id: 'task-2', nodes: { '10': { value: 8, max: 8, state: 'finished' }, '11': { state: 'running' } } });
    assert.equal(updates[1].at(-1).stage, '视频解码');
    emit('progress', { prompt_id: 'task-1', node: '10', value: 8, max: 8 });
    assert.equal(updates[0].at(-1).percent, 100);
    emit('execution_cached', { prompt_id: 'task-2', nodes: ['10'] });
    assert.equal(updates[1].at(-1).percent, 100);
    complete();
    await Promise.all(tasks);
    assert.equal(updates[0].at(-1).stage, '视频已保存');
    assert.ok([...listeners.values()].every(items => items.size === 0));
});

test("cancelled and failed tasks stop waiting with an actionable error", async () => {
    const cancelled = await adapter({ fetchApi: async path => ({ ok: true, json: async () => path === "/queue" ? { queue_running: [], queue_pending: [] } : {} }) });
    await assert.rejects(() => cancelled.waitForVideo("cancelled"), /取消/);
    const failed = await adapter({ fetchApi: async () => ({ ok: true, json: async () => ({ bad: { status: { completed: false, status_str: "error", messages: [["execution_error", { exception_message: "Test model failed" }]] } } }) }) });
    await assert.rejects(() => failed.waitForVideo("bad"), /Test model failed/);
});

test("the unified workflow connects MiniMax generation to the main console", async () => {
    const workflow = JSON.parse(await readFile(new URL("../examples/MiniMax_剪辑版.json", import.meta.url), "utf8"));
    const console = workflow.nodes.find(node => node.type === "CapCutMainConsole");
    const module = workflow.nodes.find(node => node.type === "CapCutMiniMaxH3Workflow");
    assert.match(console.properties.capcut_project_id, /^[a-f0-9]{32}$/);
    const link = workflow.links.find(link => link[1] === module.id);
    assert.equal(console.inputs[link[4]].link, link[0]);
    assert.equal(link[3], console.id);
    assert.equal(link[5], "CAPCUT_WORKFLOW");
    assert.ok(module.outputs[link[2]].links.includes(link[0]));
});
