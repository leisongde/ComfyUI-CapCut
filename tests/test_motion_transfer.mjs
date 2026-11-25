import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const sourceUrl = new URL("../web/motion-transfer.js", import.meta.url);
const template = JSON.parse(await readFile(new URL("../web/workflows/motion_transfer.json", import.meta.url), "utf8"));
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
    values.source_video = [file("driver.mp4")];
    values.character_images = [file("character.png")];
    return { ...module.namespace, provider: providers.get("CapCutMotionTransferWorkflow"), values };
}

test("motion model choices load only their node schema and reuse it on reopen", async () => {
    const paths = [];
    const { provider } = await adapter({ fetchApi: async path => {
        paths.push(path);
        assert.equal(path, "/object_info/ChatGPTImagePromptReverseGW");
        return { ok: true, json: async () => ({ ChatGPTImagePromptReverseGW: { input: {
            required: { model: [["installed-model"], {}] }
        } } }) };
    } });
    const [fields, reopened] = await Promise.all([provider.getFields(), provider.getFields()]);
    assert.equal(fields.find(field => field.name === "prompt_model").default, "installed-model");
    assert.equal(reopened.find(field => field.name === "prompt_model").options[0], "installed-model");
    await provider.getFields();
    assert.deepEqual(paths, ["/object_info/ChatGPTImagePromptReverseGW"]);
});

test("motion transfer preserves the original LoRA order, sparse attention, AV sampling and 17k+5 frame alignment", async () => {
    const { buildMotionTransferPrompt, values } = await adapter();
    const prompt = buildMotionTransferPrompt(template, {}, values);
    for (const [id, upstream] of [["7", "5"], ["8", "7"], ["9", "8"], ["6", "9"], ["13", "6"], ["11", "13"], ["314", "11"]])
        assert.deepEqual(Array.from(prompt[id].inputs.model), [upstream, 0]);
    assert.equal(prompt["6"].inputs.lora_name, "minimax\\Motion_Repair_V2.safetensors");
    assert.equal(prompt["6"].inputs.strength_model, 0.35);
    assert.equal(prompt["27"].inputs.steps, 8);
    assert.equal(prompt["314"].inputs.cfg, 1);
    assert.equal(prompt["13"].class_type, "ModelPreviewOverrideKJ");
    assert.equal(prompt["13"].inputs.tiny_vae, "taeh3.safetensors");
    assert.deepEqual(Array.from(prompt["13"].inputs.preview_frames), ["218", 1]);
    assert.deepEqual(Array.from(prompt["314"].inputs.latent_image), ["12", 1]);
    assert.equal(prompt["218"].inputs.expression, "max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17");
    assert.equal(prompt["175"].inputs.value, 5);
    assert.equal(prompt["117"].inputs.format, "None");
    assert.equal(prompt["346"].inputs.save_metadata, false);
    assert.equal(prompt["346"].inputs.save_output, true);
    assert.equal(prompt["382"].class_type, "easy cleanGpuUsed");
    assert.deepEqual(Array.from(prompt["382"].inputs.anything), ["36", 0]);
    assert.deepEqual(Array.from(prompt["346"].inputs.images), ["382", 0]);
    assert.deepEqual(Array.from(prompt["346"].inputs.audio), ["49", 0]);
    assert.ok(!Object.values(prompt).some(node => /GPT|MoGe|RMBG|showAnything/.test(node.class_type)));
});

test("all supplied references stay ordered and every submitted node belongs to the selected output", async () => {
    const { buildMotionTransferPrompt, values } = await adapter();
    const original = JSON.stringify(template);
    for (const count of [1, 2, 6, 9]) for (const enhance_prompt of ["off", "on"]) for (const audio_mode of ["source", "mute"]) for (const sparse_attention of [true, false]) {
        const prompt = buildMotionTransferPrompt(template, { sparse_attention }, { ...values, character_images: Array.from({ length: count }, (_, i) => file(`${i}.png`)), enhance_prompt, audio_mode, prompt_api_key: "test-placeholder" });
        const refs = Object.entries(prompt["12"].inputs).filter(([key]) => key.startsWith("ref_images."));
        assert.equal(refs.length, count);
        for (const [index, [key, [scaleId]]] of refs.entries()) {
            assert.equal(key, `ref_images.ref_image_${index}`);
            const imageId = prompt[scaleId].inputs.image[0];
            assert.equal(prompt[imageId].inputs.image, `CapCut/default/project/${index}.png`);
        }
        assert.equal(Object.values(prompt).filter(node => node.class_type === "ChatGPTImagePromptReverseGW").length, enhance_prompt === "on" ? count : 0);
        assert.equal(Boolean(prompt["376"]), enhance_prompt === "on");
        assert.equal(Boolean(prompt["11"]), sparse_attention);
        if (!sparse_attention) {
            assert.deepEqual(Array.from(prompt["314"].inputs.model), ["13", 0]);
            assert.deepEqual(Array.from(prompt["27"].inputs.model), ["13", 0]);
        }
        assert.equal(Boolean(prompt["49"]), audio_mode === "source");
        assert.equal(Object.values(prompt).filter(node => node.class_type === "VHS_VideoCombine").length, 1);
        const needed = new Set();
        const visit = id => {
            assert.ok(prompt[id], `Dangling link ${id}`);
            if (needed.has(id)) return;
            needed.add(id);
            for (const value of Object.values(prompt[id].inputs)) if (Array.isArray(value)) visit(value[0]);
        };
        visit("346");
        assert.equal(needed.size, Object.keys(prompt).length);
    }
    assert.equal(JSON.stringify(template), original);
});

test("the six reference slots map to their original upload nodes and keep source colors across gaps", async () => {
    const { buildMotionTransferPrompt, values } = await adapter();
    const full = buildMotionTransferPrompt(template, {}, { ...values, character_images: Array.from({ length: 6 }, (_, i) => file(`${i}.png`)) });
    for (const [index, id] of ["228", "29", "244", "246", "248", "250"].entries())
        assert.equal(full[id].inputs.image, `CapCut/default/project/${index}.png`);
    const sparse = buildMotionTransferPrompt(template, {}, { ...values, character_images: [file("red.png"), file("yellow.png")], character_slots: [1, 5] });
    assert.equal(sparse["29"].inputs.image, "CapCut/default/project/red.png");
    assert.equal(sparse["250"].inputs.image, "CapCut/default/project/yellow.png");
    assert.equal(sparse["228"], undefined);
    assert.ok(sparse["12"].inputs.prompt.includes("<Picture 1>, replacing the RED source performer (fixed source slot 2)"));
    assert.ok(sparse["12"].inputs.prompt.includes("<Picture 2>, replacing the YELLOW source performer (fixed source slot 6)"));
    assert.ok(!sparse["12"].inputs.prompt.includes("BLUE source performer"));
    assert.equal(Object.keys(sparse["12"].inputs).filter(key => key.startsWith("ref_images.")).length, 2);
    assert.ok(!Object.values(sparse).some(node => /GPT/.test(node.class_type)));
});

test("node 314 uses the template's fixed seed for new and old drafts", async () => {
    const { buildMotionTransferPrompt, values } = await adapter();
    const fixed = template["314"].inputs.noise_seed;
    assert.equal(values.seed, fixed);
    for (const seed of [values.seed, undefined, -1, "-1"])
        assert.equal(buildMotionTransferPrompt(template, {}, { ...values, seed })["314"].inputs.noise_seed, fixed);
});

test("caption numbering and the six source colors match the ordered images without unused character text", async () => {
    const { buildMotionTransferPrompt, buildMotionTransferText, values } = await adapter();
    const prompt = buildMotionTransferPrompt(template, {}, { ...values, character_images: Array.from({ length: 6 }, () => file("ref.png")), enhance_prompt: "on", prompt_api_key: "test-placeholder", prompt_model: "gpt-5.5" });
    for (const [index, color] of ["BLUE", "RED", "GREEN", "MAGENTA", "CYAN", "YELLOW"].entries()) {
        const caption = prompt[`character_caption_${index}`].inputs;
        assert.ok(caption.reverse_instruction.includes(`<Subject ${index + 1}> is Character ${index + 1} from <Picture ${index + 1}>`));
        assert.ok(caption.reverse_instruction.includes(`${color} source performer (fixed source slot ${index + 1})`));
        assert.equal(caption.model, "gpt-5.5");
        assert.equal(caption.api_key, "test-placeholder");
    }
    assert.equal(prompt["376"].inputs.api_key, "test-placeholder");
    assert.equal(template["368"].inputs.api_key, "");
    assert.equal(template["376"].inputs.api_key, "");
    const text = buildMotionTransferText(1, "Use a forest background.");
    assert.ok(!text.includes("<Picture 2>"));
    assert.ok(text.includes("Use a forest background."));
    let last = -1;
    for (const section of ["subject_definitions:", "summary:", "retention_analysis:", "detailed_description:", "overall_soundscape:", "non_diegetic_music:"]) {
        const index = text.indexOf(section);
        assert.ok(index > last);
        last = index;
    }
});

test("settings reach loaders, sparse selection, image scaling, timing and output resolution", async () => {
    const { buildMotionTransferPrompt, values } = await adapter();
    const configuration = { model_name: "video.safetensors", clip_name: "text.safetensors", video_vae: "v.safetensors", audio_vae: "a.safetensors", motion_lora: "motion.safetensors", motion_strength: 0.6, turbo_lora: "turbo.safetensors", turbo_strength: 0.8, steps: 12, shift_video: 10, shift_audio: 2, attention: "pytorch attention", sparse_threshold: 1.5, reference_longest_side: 1024, tiny_vae: "none" };
    const prompt = buildMotionTransferPrompt(template, configuration, { ...values, start_time: 2.5, duration: 6.3, seed: 42, megapixels: 0.8, aspect_ratio: "16:9 (Widescreen)", longest_side: 960 });
    for (const [id, key, expected] of [["5", "unet_name", configuration.model_name], ["3", "clip_name", configuration.clip_name], ["2", "vae_name", configuration.video_vae], ["4", "vae_name", configuration.audio_vae], ["6", "lora_name", configuration.motion_lora], ["6", "strength_model", 0.6], ["9", "lora_name", configuration.turbo_lora], ["9", "strength_model", 0.8], ["27", "steps", 12], ["7", "shift_video", 10], ["7", "shift_audio", 2], ["8", "attention", configuration.attention], ["11", "selection.tau", 1.5], ["229", "scale_to_length", 1024], ["32", "scale_to_length", 960], ["175", "value", 6.3], ["117", "skip_first_frames", 60], ["314", "noise_seed", 42], ["39", "megapixels", 0.8], ["39", "aspect_ratio", "16:9 (Widescreen)"]])
        assert.equal(prompt[id].inputs[key], expected);
    assert.equal(prompt["13"].inputs.tiny_vae, "none");
});

test("missing files, non-imported files and unexecutable numeric inputs fail before submission", async () => {
    const { buildMotionTransferPrompt, values } = await adapter();
    for (const change of [{ source_video: [] }, { character_images: [] }, { source_video: [{ ...file("video.mp4"), type: "output" }] }, { character_images: [{ ...file("ref.png"), type: "output" }] }, { duration: 0 }, { start_time: -1 }, { megapixels: NaN }, { longest_side: 0 }, { enhance_prompt: "on", prompt_api_key: "" }])
        assert.throws(() => buildMotionTransferPrompt(template, {}, { ...values, ...change }));
});

test("provider checks only active dependencies and returns the result belonging to its prompt and output", async () => {
    let submitted;
    const { provider, values } = await adapter({
        getNodeDefs: async () => Object.fromEntries(Object.values(template).filter(node => !node.class_type.startsWith("ChatGPT")).map(node => [node.class_type, {}])),
        queuePrompt: async (position, payload) => { submitted = payload; return { prompt_id: "motion-task" }; },
        fetchApi: async path => {
            assert.equal(path, "/history/motion-task");
            return { ok: true, json: async () => ({ "motion-task": { status: { completed: true }, outputs: {
                "346": { gifs: [{ filename: "motion.mp4", type: "output", subfolder: "CapCut/MotionTransfer" }] },
                "111": { gifs: [file("unrelated.mp4")] },
            } } }) };
        },
    });
    const result = await provider.run({ node: { widgets: [], graph: { serialize: () => ({ nodes: [] }) } }, values });
    assert.ok(submitted.output["346"]);
    assert.equal(result.length, 1);
    assert.equal(result[0].filename, "motion.mp4");
    await assert.rejects(() => provider.run({ node: { widgets: [] }, values: { ...values, enhance_prompt: "on", prompt_api_key: "test-placeholder" } }), /缺少动作迁移节点/);
});

test("the unified workflow preserves the project and connects motion transfer", async () => {
    const workflow = JSON.parse(await readFile(new URL("../examples/MiniMax_剪辑版.json", import.meta.url), "utf8"));
    const console = workflow.nodes.find(node => node.type === "CapCutMainConsole");
    const module = workflow.nodes.find(node => node.type === "CapCutMotionTransferWorkflow");
    assert.ok(console);
    assert.ok(module);
    assert.match(console.properties.capcut_project_id, /^[a-f0-9]{32}$/);
    const link = workflow.links.find(entry => entry[1] === module.id && entry[3] === console.id);
    assert.ok(link);
    assert.equal(console.inputs.find(input => input.name === "workflows.workflow_3").link, link[0]);
    assert.equal(link[5], "CAPCUT_WORKFLOW");
    assert.ok(!/sk-[A-Za-z0-9_-]{16,}|videopreview|fullpath|cos_url/.test(JSON.stringify(workflow)));
});
