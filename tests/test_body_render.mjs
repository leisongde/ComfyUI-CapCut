import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const sourceUrl = new URL("../web/body-render.js", import.meta.url);
const template = JSON.parse(await readFile(new URL("../web/workflows/body_render.json", import.meta.url), "utf8"));
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
    return { ...module.namespace, provider: providers.get("CapCutBodyRenderWorkflow"), values };
}

test("white body rendering keeps the supplied tracking, FOV, face, smoothing and mesh pipeline", async () => {
    const { buildBodyRenderPrompt, values } = await adapter();
    const prompt = buildBodyRenderPrompt(template, {}, values);
    for (const [id, type] of Object.entries({ 161: "RMBG", 18: "SAM3_VideoTrack", 109: "RTDETR_detect", 114: "MoGeInference",
        126: "MoGeGeometryToFOV", 129: "SAM3DBody_Predict", 128: "SAM3DBody_FaceExpression", 130: "SAM3DBody_Smooth", 131: "SAM3DBody_Render" }))
        assert.equal(prompt[id].class_type, type);
    assert.equal(prompt["157"].inputs.video, "CapCut/default/project/original.mp4");
    assert.equal(prompt["157"].inputs.format, "None");
    assert.equal(prompt["145"].inputs.aspect_ratio, "original");
    assert.equal(prompt["145"].inputs.scale_to_length, 736);
    assert.equal(prompt["18"].inputs.max_objects, 16);
    assert.equal(prompt["129"].inputs.run_hand_refinement, true);
    assert.equal(prompt["131"].inputs["render_style.shader"], "default");
    assert.deepEqual(Array.from(prompt["131"].inputs.width), ["145", 3]);
    assert.deepEqual(Array.from(prompt["131"].inputs.height), ["145", 4]);
    assert.deepEqual(Array.from(prompt["129"].inputs.fov), ["126", 0]);
    assert.equal(prompt["163"].inputs.save_metadata, false);
    assert.equal(prompt["218"], undefined);
    assert.equal(template["157"].inputs.video, "");
    assert.ok(!/https?:|cos_url|fullpath|@流浪|api.?key|videopreview/.test(JSON.stringify(template)));
});

test("each output and audio choice queues only its required ancestors and one saved result", async () => {
    const { buildBodyRenderPrompt, values } = await adapter();
    const original = JSON.stringify(template);
    for (const [mode, id] of [["white", "163"], ["colored", "256"], ["enhanced", "225"]]) for (const audio_mode of ["source", "mute"]) {
        const prompt = buildBodyRenderPrompt(template, {}, { ...values, output_mode: mode, audio_mode });
        const visited = new Set();
        const visit = id => {
            assert.ok(prompt[id], `Dangling link ${id}`);
            if (visited.has(id)) return;
            visited.add(id);
            for (const value of Object.values(prompt[id].inputs)) if (Array.isArray(value)) visit(value[0]);
        };
        visit(id);
        assert.equal(visited.size, Object.keys(prompt).length);
        assert.equal(Object.values(prompt).filter(node => node.class_type === "VHS_VideoCombine").length, 1);
        assert.equal(Boolean(prompt["255"]), mode === "enhanced");
        assert.equal(Boolean(prompt["218"]), mode !== "white");
        if (audio_mode === "source") assert.deepEqual(Array.from(prompt[id].inputs.audio), ["157", 2]);
        else assert.equal(prompt[id].inputs.audio, undefined);
        assert.equal(prompt["169"], undefined);
        assert.equal(prompt["249"], undefined);
    }
    assert.equal(JSON.stringify(template), original);
});

test("source range and playback frame rate stay synchronized in loading and saving", async () => {
    const { buildBodyRenderPrompt, values } = await adapter();
    const prompt = buildBodyRenderPrompt(template, {}, { ...values, frame_rate: 30, start_time: 2.5, duration: 4, longest_side: 1024, subject_prompt: "dancer" });
    assert.equal(prompt["157"].inputs.force_rate, 30);
    assert.equal(prompt["157"].inputs.skip_first_frames, 75);
    assert.equal(prompt["157"].inputs.frame_load_cap, 120);
    assert.equal(prompt["163"].inputs.frame_rate, 30);
    assert.equal(prompt["15"].inputs.text, "dancer");
    assert.equal(prompt["145"].inputs.scale_to_length, 1024);
    assert.equal(buildBodyRenderPrompt(template, {}, values)["157"].inputs.frame_load_cap, 0);
    assert.equal(buildBodyRenderPrompt(template, {}, { ...values, duration: 0.001 })["157"].inputs.frame_load_cap, 1);
});

test("module settings reach model loading, both person caps and inference batch sizes", async () => {
    const { buildBodyRenderPrompt, values } = await adapter();
    const configuration = { sam_checkpoint: "sam.safetensors", detector_model: "detector.safetensors", moge_model: "geometry.safetensors",
        body_model: "body.safetensors", max_people: 3, detection_threshold: 0.6, detector_threshold: 0.7, detect_interval: 2,
        body_batch_size: 8, moge_batch_size: 2, hand_refinement: false, smoothing_window: 7, rmbg_sensitivity: 0.8, rmbg_resolution: 512 };
    const prompt = buildBodyRenderPrompt(template, configuration, values);
    assert.equal(prompt["14"].inputs.ckpt_name, configuration.sam_checkpoint);
    assert.equal(prompt["111"].inputs.unet_name, configuration.detector_model);
    assert.equal(prompt["115"].inputs.model_name, configuration.moge_model);
    assert.equal(prompt["119"].inputs.model_file, configuration.body_model);
    assert.equal(prompt["18"].inputs.max_objects, 3);
    assert.equal(prompt["109"].inputs.max_detections, 3);
    assert.equal(prompt["18"].inputs.detection_threshold, 0.6);
    assert.equal(prompt["109"].inputs.threshold, 0.7);
    assert.equal(prompt["18"].inputs.detect_interval, 2);
    assert.equal(prompt["129"].inputs.batch_size, 8);
    assert.equal(prompt["114"].inputs.batch_size, 2);
    assert.equal(prompt["129"].inputs.run_hand_refinement, false);
    assert.equal(prompt["130"].inputs.window, 7);
    assert.equal(prompt["161"].inputs.sensitivity, 0.8);
    assert.equal(prompt["161"].inputs.process_res, 512);
});

test("missing input, invalid ranges and unknown output modes fail before submission", async () => {
    const { buildBodyRenderPrompt, values } = await adapter();
    assert.throws(() => buildBodyRenderPrompt(template, {}, { ...values, source_video: [] }), /请选择原视频/);
    assert.throws(() => buildBodyRenderPrompt(template, {}, { ...values, source_video: [{ ...file("video.mp4"), type: "output" }] }), /先导入当前工程/);
    for (const output_mode of ["unknown", "toString", "__proto__"]) assert.throws(() => buildBodyRenderPrompt(template, {}, { ...values, output_mode }), /请选择人体白模/);
    assert.throws(() => buildBodyRenderPrompt(template, {}, { ...values, start_time: -1 }), /起始位置/);
    assert.throws(() => buildBodyRenderPrompt(template, {}, { ...values, duration: -1 }), /处理时长/);
    assert.throws(() => buildBodyRenderPrompt(template, {}, { ...values, frame_rate: 0 }), /帧率/);
    assert.throws(() => buildBodyRenderPrompt(template, {}, { ...values, longest_side: NaN }), /处理长边/);
});

test("each selected output returns only the saved video belonging to its prompt ID", async () => {
    for (const [output_mode, id] of [["white", "163"], ["colored", "256"], ["enhanced", "225"]]) {
        let submitted;
        const { provider, values } = await adapter({
            getNodeDefs: async () => Object.fromEntries(Object.values(template).map(node => [node.class_type, {}])),
            queuePrompt: async (position, payload) => { submitted = payload; return { prompt_id: "body-task" }; },
            fetchApi: async path => {
                assert.equal(path, "/history/body-task");
                return { ok: true, json: async () => ({ "body-task": { status: { completed: true }, outputs: {
                    [id]: { gifs: [{ filename: `${output_mode}.mp4`, subfolder: "CapCut/BodyRender", type: "output" }] },
                    "12": { gifs: [file("unrelated.mp4")] },
                } } }) };
            },
        });
        const result = await provider.run({ node: { widgets: [], graph: { serialize: () => ({ nodes: [] }) } }, values: { ...values, output_mode } });
        assert.ok(submitted.output[id]);
        assert.equal(result.length, 1);
        assert.equal(result[0].filename, `${output_mode}.mp4`);
    }
});

test("missing body-render dependencies stop before queue submission", async () => {
    let queued = false;
    const { provider, values } = await adapter({ getNodeDefs: async () => ({}), queuePrompt: async () => { queued = true; } });
    await assert.rejects(() => provider.run({ node: { widgets: [] }, values }), /缺少人体白模节点/);
    assert.equal(queued, false);
});

test("the unified workflow connects body rendering independently", async () => {
    const workflow = JSON.parse(await readFile(new URL("../examples/MiniMax_剪辑版.json", import.meta.url), "utf8"));
    const console = workflow.nodes.find(node => node.type === "CapCutMainConsole");
    const module = workflow.nodes.find(node => node.type === "CapCutBodyRenderWorkflow");
    const link = workflow.links.find(link => link[1] === module.id);
    assert.equal(link[3], console.id);
    assert.equal(link[5], "CAPCUT_WORKFLOW");
    assert.equal(console.inputs[link[4]].link, link[0]);
    assert.ok(module.outputs[link[2]].links.includes(link[0]));
});
