import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const sourceUrl = new URL("../web/character-swap.js", import.meta.url);
const template = JSON.parse(await readFile(new URL("../web/workflows/character_swap.json", import.meta.url), "utf8"));
const file = filename => ({ filename, subfolder: "CapCut/default/project", type: "input" });

async function adapter(api = {}) {
    const providers = new Map();
    const context = vm.createContext({ structuredClone, URL, setTimeout: callback => { callback(); },
        fetch: async () => ({ ok: true, json: async () => structuredClone(template) }) });
    const editor = new vm.SyntheticModule(["registerCapCutWorkflow"], function () {
        this.setExport("registerCapCutWorkflow", (type, provider) => providers.set(type, provider));
    }, { context });
    const apiModule = new vm.SyntheticModule(["api"], function () { this.setExport("api", api); }, { context });
    const minimax = new vm.SourceTextModule(await readFile(new URL("../web/minimax.js", import.meta.url), "utf8"), { context });
    await minimax.link(specifier => specifier.endsWith("api.js") ? apiModule : editor);
    await minimax.evaluate();
    const module = new vm.SourceTextModule(await readFile(sourceUrl, "utf8"), { context,
        initializeImportMeta: meta => { meta.url = sourceUrl.href; } });
    await module.link(specifier => specifier.endsWith("minimax.js") ? minimax : specifier.endsWith("api.js") ? apiModule : editor);
    await module.evaluate();
    const values = Object.fromEntries(module.namespace.fields.map(field => [field.name, field.default]));
    values.source_video = [file("original.mp4")];
    values.character_image = [file("person.png")];
    return { ...module.namespace, provider: providers.get("CapCutMiniMaxH3CharacterSwapWorkflow"), providers, values };
}

test("the fixed graph retains tracking, masked AV sampling and uncrop without sample files", async () => {
    const { buildCharacterSwapPrompt, values } = await adapter();
    const prompt = buildCharacterSwapPrompt(template, {}, values);
    for (const [id, type] of Object.entries({ 53: "SAM3_VideoTrack", 56: "MVEx_MaskCleanup", 123: "MVEx_SubjectCrop",
        85: "MVEx_MaskToLatentSpace", 91: "LTXVConcatAVLatent", 21: "SamplerCustomAdvanced", 95: "MVEx_SubjectUncrop" }))
        assert.equal(prompt[id].class_type, type);
    assert.equal(prompt["121"].inputs.lora_name, "minimax\\h3_character_swap_v1.5.safetensors");
    assert.equal(prompt["122"].inputs.strength_model, 1);
    assert.equal(prompt["43"].inputs.video, "CapCut/default/project/original.mp4");
    assert.equal(prompt["43"].inputs.force_rate, 24);
    assert.equal(prompt["43"].inputs.format, "None");
    assert.equal(prompt["9"].inputs.image, "CapCut/default/project/person.png");
    assert.match(values.prompt, /^Replace only the woman in the foreground in <Video 1>/);
    assert.equal(prompt["2"].inputs.value, values.prompt);
    assert.equal(prompt["89"].inputs.value, 0);
    assert.deepEqual(Array.from(prompt["95"].inputs.bboxes), ["123", 2]);
    assert.deepEqual(Array.from(prompt["95"].inputs.original_images), ["46", 0]);
    assert.equal(prompt["42"].inputs.save_metadata, false);
    assert.equal(template["43"].inputs.video, "");
    assert.equal(template["9"].inputs.image, "");
    assert.ok(!/https?:|cos_url|fullpath|api.?key|10月28日/.test(JSON.stringify(template)));
    assert.ok(!Object.values(prompt).some(node => ["SetNode", "GetNode", "PreviewAnimation", "ModelPreviewOverrideKJ", "easy cleanGpuUsed"].includes(node.class_type)));
});

test("every sound mode has a complete reachable graph and does not mutate the template", async () => {
    const { buildCharacterSwapPrompt, values } = await adapter();
    const original = JSON.stringify(template);
    for (const audio_mode of ["source", "reconstruct", "mute"]) {
        const prompt = buildCharacterSwapPrompt(template, {}, { ...values, audio_mode });
        const visited = new Set();
        const visit = id => {
            assert.ok(prompt[id], `Dangling link ${id}`);
            if (visited.has(id)) return;
            visited.add(id);
            for (const value of Object.values(prompt[id].inputs)) if (Array.isArray(value)) visit(value[0]);
        };
        visit("42");
        assert.equal(visited.size, Object.keys(prompt).length, `${audio_mode} has unused nodes`);
        assert.deepEqual(Array.from(prompt["87"].inputs.mask), ["89", 0]);
        if (audio_mode === "source") assert.deepEqual(Array.from(prompt["42"].inputs.audio), ["43", 2]);
        if (audio_mode === "reconstruct") assert.deepEqual(Array.from(prompt["42"].inputs.audio), ["8", 0]);
        if (audio_mode === "mute") {
            assert.equal(prompt["42"].inputs.audio, undefined);
            assert.deepEqual(Array.from(prompt["86"].inputs.audio), ["silence", 0]);
            assert.deepEqual(Array.from(prompt.silence_duration.inputs["values.a"]), ["19", 1]);
        }
    }
    assert.equal(JSON.stringify(template), original);
});

test("source range, target description and replacement instructions stay separate", async () => {
    const { buildCharacterSwapPrompt, values } = await adapter();
    Object.assign(values, { start_time: 2.5, duration: 3, aspect_ratio: "16:9 (Widescreen)", subject_prompt: "man on the left", prompt: "替换为 <Picture 1> 中的人物", seed: 42 });
    const prompt = buildCharacterSwapPrompt(template, {}, values);
    assert.equal(prompt["43"].inputs.skip_first_frames, 60);
    assert.equal(prompt["17"].inputs.value, 3);
    assert.equal(prompt["20"].inputs.aspect_ratio, values.aspect_ratio);
    assert.equal(prompt["50"].inputs.text, values.subject_prompt);
    assert.equal(prompt["2"].inputs.value, values.prompt);
    assert.equal(prompt["31"].inputs.noise_seed, 42);
    assert.deepEqual(Array.from(prompt["43"].inputs.frame_load_cap), ["19", 1]);
    assert.match(prompt["19"].inputs.expression, /17/);
});

test("GPT enhancement feeds the replacement instructions while preserving the detector description", async () => {
    const { buildCharacterSwapPrompt, values } = await adapter();
    const original = JSON.stringify(template);
    const direct = buildCharacterSwapPrompt(template, {}, values);
    assert.equal(direct.prompt_enhance, undefined);
    values.enhance_prompt = "on";
    assert.throws(() => buildCharacterSwapPrompt(template, {}, values), /API 密钥/);
    Object.assign(values, { prompt_api_key: "test-key", system_prompt: "只替换人物，不改变镜头", prompt_model: "chosen-model",
        prompt_skill: "chosen-skill", prompt_director: "文戏表演", prompt_intensity: "R1 写实克制", subject_prompt: "man on the left" });
    const prompt = buildCharacterSwapPrompt(template, {}, values);
    const optimizer = prompt.prompt_enhance;
    assert.equal(optimizer.class_type, "MiniMaxH3PromptSkill");
    assert.deepEqual(Array.from(prompt["2"].inputs.value), ["prompt_enhance", 0]);
    assert.equal(optimizer.inputs["用户提示词"], `${values.system_prompt},${values.prompt}`);
    assert.equal(optimizer.inputs["API 密钥"], "test-key");
    assert.equal(optimizer.inputs["官方 Skill"], "chosen-skill");
    assert.equal(optimizer.inputs["模型"], "chosen-model");
    assert.equal(optimizer.inputs["动作强度"], "R1 写实克制");
    assert.equal(optimizer.inputs["H3 模式"], "Ref2VA");
    assert.match(optimizer.inputs["补充上下文"], /<Video 1>.*<Picture 1>.*man on the left/);
    assert.match(optimizer.inputs["额外要求"], /保持原视频/);
    assert.equal(prompt["50"].inputs.text, values.subject_prompt);
    assert.equal(JSON.stringify(template), original);
    assert.ok(!JSON.stringify(template).includes("test-key"));
});

test("character swap reuses the installed prompt options and model endpoint", async () => {
    const paths = [];
    const { provider, providers } = await adapter({
        fetchApi: async (path, options) => {
            paths.push(path);
            if (path === "/object_info/MiniMaxH3PromptSkill") return { ok: true, json: async () => ({ MiniMaxH3PromptSkill: { input: { required: {
                "官方 Skill": [["local-skill"], { default: "local-skill" }],
                "导演": [["local-director"], { default: "local-director" }],
            } } } }) };
            assert.equal(path, "/minimax-prompt/models");
            assert.equal(JSON.parse(options.body).api_key, "test-key");
            return { ok: true, json: async () => ({ models: ["chosen-model"] }) };
        },
    });
    const [fields, videoFields] = await Promise.all([provider.getFields(), providers.get("CapCutMiniMaxH3Workflow").getFields()]);
    assert.equal(fields.find(field => field.name === "prompt_skill").default, "local-skill");
    assert.equal(fields.find(field => field.name === "prompt_director").options[0], "local-director");
    assert.ok(fields.some(field => field.name === "source_video"));
    assert.ok(!videoFields.some(field => field.name === "source_video"));
    assert.equal(videoFields.find(field => field.name === "prompt_director").options[0], "local-director");
    await provider.getFields();
    assert.deepEqual(paths, ["/object_info/MiniMaxH3PromptSkill"]);
    assert.equal((await provider.loadModels("test-key"))[0], "chosen-model");
});

test("canvas configuration controls model, tracking, crop, latent mask and blend parameters", async () => {
    const { buildCharacterSwapPrompt, values } = await adapter();
    const configuration = { model_name: "model.safetensors", sam_checkpoint: "sam.safetensors", character_lora: "person.safetensors",
        character_strength: 0.7, turbo_strength: 0.8, attention: "pytorch attention", steps: 12, shift_video: 10,
        object_indices: "1,2", max_objects: 2, detection_threshold: 0.6, detect_interval: 3,
        cleanup_shrink: 5, cleanup_min_frames: 2, crop_scale: 2.0, grow_spatial: 24, feather: 8 };
    const prompt = buildCharacterSwapPrompt(template, configuration, values);
    assert.equal(prompt["30"].inputs.unet_name, configuration.model_name);
    assert.equal(prompt["48"].inputs.ckpt_name, configuration.sam_checkpoint);
    assert.equal(prompt["121"].inputs.strength_model, 0.7);
    assert.equal(prompt["122"].inputs.strength_model, 0.8);
    assert.equal(prompt["37"].inputs.attention, "pytorch attention");
    assert.equal(prompt["24"].inputs.steps, 12);
    assert.equal(prompt["38"].inputs.shift_video, 10);
    assert.equal(prompt["55"].inputs.object_indices, "1,2");
    assert.equal(prompt["53"].inputs.max_objects, 2);
    assert.equal(prompt["53"].inputs.detection_threshold, 0.6);
    assert.equal(prompt["53"].inputs.detect_interval, 3);
    assert.equal(prompt["56"].inputs["method.shrink"], 5);
    assert.equal(prompt["56"].inputs["method.min_frames"], 2);
    assert.equal(prompt["123"].inputs["mode.crop_scale"], 2.0);
    assert.equal(prompt["85"].inputs.grow_spatial, 24);
    assert.equal(prompt["95"].inputs.feather, 8);
});

test("missing media and invalid source ranges fail before queuing", async () => {
    const { buildCharacterSwapPrompt, values } = await adapter();
    assert.throws(() => buildCharacterSwapPrompt(template, {}, { ...values, source_video: [] }), /请选择原视频/);
    assert.throws(() => buildCharacterSwapPrompt(template, {}, { ...values, character_image: [] }), /请选择替换人物图片/);
    assert.throws(() => buildCharacterSwapPrompt(template, {}, { ...values, source_video: [{ ...file("output.mp4"), type: "output" }] }), /先导入当前工程/);
    assert.throws(() => buildCharacterSwapPrompt(template, {}, { ...values, duration: 0 }), /时长/);
    assert.throws(() => buildCharacterSwapPrompt(template, {}, { ...values, start_time: -1 }), /起始位置/);
});

test("the module submits the fixed graph and imports only its own output node", async () => {
    let queued;
    const { provider, values } = await adapter({
        getNodeDefs: async () => Object.fromEntries(Object.values(template).map(node => [node.class_type, {}])),
        queuePrompt: async (position, payload) => { queued = payload; return { prompt_id: "swap-task" }; },
        fetchApi: async path => {
            assert.equal(path, "/history/swap-task");
            return { ok: true, json: async () => ({ "swap-task": { status: { completed: true }, outputs: {
                "12": { gifs: [file("wrong-task.mp4")] }, "42": { gifs: [{ filename: "swapped.mp4", subfolder: "CapCut/CharacterSwap", type: "output" }] },
            } } }) };
        },
    });
    const result = await provider.run({ node: { widgets: [], graph: { serialize: () => ({ nodes: [] }) } }, values });
    assert.equal(queued.output["53"].class_type, "SAM3_VideoTrack");
    assert.equal(result.length, 1);
    assert.equal(result[0].filename, "swapped.mp4");
});

test("missing node dependencies stop before any generation task is submitted", async () => {
    let queued = false;
    const { provider, values } = await adapter({ getNodeDefs: async () => ({}), queuePrompt: async () => { queued = true; } });
    await assert.rejects(() => provider.run({ node: { widgets: [] }, values }), /缺少人物替换节点/);
    assert.equal(queued, false);
});

test("the unified workflow connects character replacement independently", async () => {
    const workflow = JSON.parse(await readFile(new URL("../examples/MiniMax_剪辑版.json", import.meta.url), "utf8"));
    const console = workflow.nodes.find(node => node.type === "CapCutMainConsole");
    const module = workflow.nodes.find(node => node.type === "CapCutMiniMaxH3CharacterSwapWorkflow");
    const link = workflow.links.find(link => link[1] === module.id);
    assert.equal(link[3], console.id);
    assert.equal(link[5], "CAPCUT_WORKFLOW");
    assert.equal(console.inputs[link[4]].link, link[0]);
    assert.ok(module.outputs[link[2]].links.includes(link[0]));
});
