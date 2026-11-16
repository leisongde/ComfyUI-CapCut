import { api } from "../../scripts/api.js";
import { registerCapCutWorkflow } from "./editor.js";
import { waitForVideo } from "./minimax.js";

export const fields = [
    { name: "source_video", label: "原视频（必选）", type: "media", kind: "video", default: "" },
    { name: "subject_prompt", label: "跟踪人物描述（建议英文）", type: "textarea", default: "person" },
    { name: "output_mode", label: "输出内容", type: "select", default: "white", options: [
        { value: "white", label: "人体白模" }, { value: "colored", label: "彩色人物区分" },
        { value: "enhanced", label: "彩色人物区分（色彩增强）" },
    ] },
    { name: "start_time", label: "原视频起始位置（秒）", type: "number", default: 0, min: 0, step: 0.1 },
    { name: "duration", label: "处理时长（秒，0 为全部剩余视频）", type: "number", default: 0, min: 0, step: 0.1 },
    { name: "frame_rate", label: "处理帧率", type: "number", default: 24, min: 1, max: 60, step: 1 },
    { name: "longest_side", label: "处理长边（像素，保持原比例并对齐 32）", type: "number", default: 736, min: 4, step: 32 },
    { name: "audio_mode", label: "声音处理", type: "select", default: "source", options: [
        { value: "source", label: "保留原声（原视频需含音轨）" }, { value: "mute", label: "静音（无音轨视频请选择此项）" },
    ] },
];

const outputNodes = { white: "163", colored: "256", enhanced: "225" };

export function buildBodyRenderPrompt(template, configuration, values) {
    const file = values.source_video?.[0];
    if (!file) throw new Error("请选择原视频");
    if (file.type !== "input") throw new Error("原视频需要先导入当前工程");
    if (!Object.hasOwn(outputNodes, values.output_mode)) throw new Error("请选择人体白模、彩色人物区分或色彩增强输出");
    const fps = Number(values.frame_rate), start = Number(values.start_time), duration = Number(values.duration), size = Number(values.longest_side);
    if (!Number.isFinite(fps) || fps <= 0) throw new Error("处理帧率需要大于 0");
    if (!Number.isFinite(start) || start < 0) throw new Error("原视频起始位置需要大于或等于 0 秒");
    if (!Number.isFinite(duration) || duration < 0) throw new Error("处理时长需要大于或等于 0 秒");
    if (!Number.isInteger(size) || size < 4) throw new Error("处理长边需要为大于或等于 4 的整数");
    const prompt = structuredClone(template);
    for (const [name, id, input] of [
        ["sam_checkpoint", "14", "ckpt_name"], ["detector_model", "111", "unet_name"],
        ["moge_model", "115", "model_name"], ["body_model", "119", "model_file"],
        ["max_people", "18", "max_objects"], ["max_people", "109", "max_detections"],
        ["detection_threshold", "18", "detection_threshold"], ["detector_threshold", "109", "threshold"],
        ["detect_interval", "18", "detect_interval"], ["body_batch_size", "129", "batch_size"],
        ["moge_batch_size", "114", "batch_size"], ["hand_refinement", "129", "run_hand_refinement"],
        ["smoothing_window", "130", "window"], ["rmbg_sensitivity", "161", "sensitivity"], ["rmbg_resolution", "161", "process_res"],
    ]) if (configuration[name] !== undefined) prompt[id].inputs[input] = configuration[name];
    prompt["157"].inputs.video = [file.subfolder, file.filename].filter(Boolean).join("/");
    prompt["157"].inputs.force_rate = fps;
    prompt["157"].inputs.skip_first_frames = Math.round(start * fps);
    prompt["157"].inputs.frame_load_cap = duration === 0 ? 0 : Math.max(1, Math.round(duration * fps));
    prompt["145"].inputs.scale_to_length = size;
    prompt["15"].inputs.text = values.subject_prompt;
    const outputId = outputNodes[values.output_mode];
    prompt[outputId].inputs.frame_rate = fps;
    if (values.audio_mode !== "source") delete prompt[outputId].inputs.audio;
    const needed = new Set(), pending = [outputId];
    while (pending.length) {
        const id = pending.pop();
        if (needed.has(id)) continue;
        needed.add(id);
        for (const value of Object.values(prompt[id].inputs)) if (Array.isArray(value)) pending.push(value[0]);
    }
    return Object.fromEntries(Object.entries(prompt).filter(([id]) => needed.has(id)));
}

registerCapCutWorkflow("CapCutBodyRenderWorkflow", {
    label: "人体白模渲染",
    fields,
    async run({ node, values, onProgress }) {
        const response = await fetch(new URL("./workflows/body_render.json", import.meta.url));
        if (!response.ok) throw new Error("无法读取内置人体白模工作流，请刷新页面后重试");
        const configuration = Object.fromEntries(node.widgets.map(widget => [widget.name, widget.value]));
        const output = buildBodyRenderPrompt(await response.json(), configuration, values);
        const definitions = await api.getNodeDefs();
        const missing = [...new Set(Object.values(output).map(item => item.class_type))].filter(type => !definitions[type]);
        if (missing.length) throw new Error(`缺少人体白模节点：${missing.join("、")}。请安装原工作流依赖并重启 ComfyUI`);
        let promptId;
        const outputId = outputNodes[values.output_mode];
        const stages = { "157": "读取原视频", "161": "抠背景", "18": "SAM3 人物跟踪", "109": "检测人体", "114": "估计视角", "129": "预测人体姿态", "128": "提取面部表情", "130": "平滑人体姿态", "131": "渲染人体白模", [outputId]: "保存视频" };
        const executing = event => {
            if (!promptId || event.detail.prompt_id !== promptId) return;
            const stage = stages[String(event.detail.node)];
            if (stage) onProgress({ status: "running", stage });
        };
        if (onProgress) api.addEventListener("executing", executing);
        try {
            const result = await api.queuePrompt(0, { output, workflow: node.graph.serialize() });
            promptId = result.prompt_id;
            onProgress?.({ status: "queued", stage: "等待 ComfyUI 执行人体白模渲染" });
            const videos = await waitForVideo(promptId, onProgress, outputId);
            onProgress?.({ status: "running", percent: 100, stage: "人体渲染视频已保存" });
            return videos;
        } finally {
            if (onProgress) api.removeEventListener("executing", executing);
        }
    },
});
