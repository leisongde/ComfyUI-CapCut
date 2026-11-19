import { api } from "../../scripts/api.js";
import { registerCapCutWorkflow } from "./editor.js";
import { fields as minimaxFields, getFields, loadModels, waitForVideo, samplingFields, applySamplingOptions, samplingPercent, fixedSeed } from "./minimax.js";

export const fields = [
    ...samplingFields,
    { name: "source_video", label: "原视频（必选）", type: "media", kind: "video", default: "" },
    { name: "character_image", label: "替换人物图片（必选）", type: "media", kind: "image", default: "" },
    { name: "subject_prompt", label: "原片中要替换的人（SAM3 定位描述，建议英文）", type: "textarea", default: "girl in pink dress" },
    { name: "prompt", label: "人物替换提示词", type: "textarea", default: "Replace only the woman in the foreground in <Video 1> with the character in <Picture 1>. Keep the replacement character's identity, outfit, and art style from <Picture 1>. Preserve the source video's camera, framing, background, lighting, objects, and all other people. Match the selected woman's position, scale, pose, and movement throughout the clip. Do not show the reference sheet or its background." },
    ...minimaxFields.filter(field => ["system_prompt", "prompt_skill", "prompt_director", "prompt_intensity", "prompt_model", "enhance_prompt", "prompt_api_key"].includes(field.name)),
    { name: "start_time", label: "原视频起始位置（秒）", type: "number", default: 0, min: 0, step: 0.1 },
    { name: "duration", label: "处理时长（秒，24 fps）", type: "number", default: 5, step: 0.1 },
    { name: "aspect_ratio", label: "输出比例（原视频会缩放裁切）", type: "select", default: "9:16 (Portrait Widescreen)", options: [
        "16:9 (Widescreen)", "9:16 (Portrait Widescreen)", "1:1 (Square)", "4:3 (Standard)",
        "3:4 (Portrait Standard)", "3:2 (Photo)", "2:3 (Portrait Photo)", "21:9 (Ultrawide)",
    ] },
    { name: "megapixels", label: "输出分辨率（百万像素）", type: "number", default: 0.4, step: 0.1 },
    { name: "seed", label: "固定种子", type: "number", default: 0, min: 0, step: 1 },
    { name: "audio_mode", label: "声音处理", type: "select", default: "source", options: [
        { value: "source", label: "保留原声（原视频需含音轨）" },
        { value: "reconstruct", label: "原工作流音轨（VAE 重建）" },
        { value: "mute", label: "静音（无音轨视频请选择此项）" },
    ] },
];

export function buildCharacterSwapPrompt(template, configuration, values) {
    const filePath = (file, label) => {
        if (!file) throw new Error(`请选择${label}`);
        if (file.type !== "input") throw new Error(`${label}需要先导入当前工程`);
        return [file.subfolder, file.filename].filter(Boolean).join("/");
    };
    const video = filePath(values.source_video?.[0], "原视频");
    const image = filePath(values.character_image?.[0], "替换人物图片");
    const duration = Number(values.duration), start = Number(values.start_time), megapixels = Number(values.megapixels);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("处理时长需要大于 0 秒");
    if (!Number.isFinite(start) || start < 0) throw new Error("原视频起始位置需要大于或等于 0 秒");
    if (!Number.isFinite(megapixels) || megapixels <= 0) throw new Error("输出分辨率需要大于 0");
    const prompt = structuredClone(template);
    for (const [name, id, input] of [
        ["model_name", "30", "unet_name"], ["clip_name", "15", "clip_name"],
        ["video_vae", "3", "vae_name"], ["audio_vae", "4", "vae_name"], ["sam_checkpoint", "48", "ckpt_name"],
        ["character_lora", "121", "lora_name"], ["character_strength", "121", "strength_model"],
        ["turbo_lora", "122", "lora_name"], ["turbo_strength", "122", "strength_model"],
        ["steps", "24", "steps"], ["shift_video", "38", "shift_video"], ["shift_audio", "38", "shift_audio"],
        ["attention", "37", "attention"], ["detection_threshold", "53", "detection_threshold"],
        ["max_objects", "53", "max_objects"], ["detect_interval", "53", "detect_interval"], ["object_indices", "55", "object_indices"],
        ["cleanup_threshold", "56", "threshold"], ["cleanup_shrink", "56", "method.shrink"],
        ["cleanup_min_frames", "56", "method.min_frames"], ["edge_grow", "56", "edge_grow"],
        ["crop_scale", "123", "mode.crop_scale"], ["grow_spatial", "85", "grow_spatial"],
        ["grow_temporal", "85", "grow_temporal"], ["feather", "95", "feather"],
    ]) if (configuration[name] !== undefined) prompt[id].inputs[input] = configuration[name];
    prompt["43"].inputs.video = video;
    prompt["43"].inputs.skip_first_frames = Math.round(start * 24);
    prompt["9"].inputs.image = image;
    prompt["50"].inputs.text = values.subject_prompt;
    prompt["2"].inputs.value = values.prompt;
    if (values.enhance_prompt === "on") {
        if (!values.prompt_api_key?.trim()) throw new Error("请填写提示词增强 API 密钥，或关闭 GPT 优化提示词");
        const defaults = Object.fromEntries(fields.map(field => [field.name, field.default]));
        prompt.prompt_enhance = { class_type: "MiniMaxH3PromptSkill", inputs: {
            "API 密钥": values.prompt_api_key,
            "官方 Skill": values.prompt_skill ?? defaults.prompt_skill,
            "导演": values.prompt_director ?? defaults.prompt_director,
            "动作强度": values.prompt_intensity ?? defaults.prompt_intensity,
            "模型": values.prompt_model ?? defaults.prompt_model,
            "H3 模式": "Ref2VA",
            "用户提示词": [values.system_prompt, values.prompt].filter(value => value?.trim()).join(","),
            "补充上下文": `${duration} 秒，24 fps，${values.aspect_ratio}。人物替换：<Video 1> 是原视频，<Picture 1> 是替换人物图片。原视频中要替换的人物特征：${values.subject_prompt}。`,
            "额外要求": "只优化人物替换指令，保留 <Video 1> 和 <Picture 1> 引用。仅替换指定人物，保持原视频的镜头、构图、背景、光照、其他人物以及被替换人物的位置、大小、姿态和动作。使用参考图片的人物身份、服装和画风，不展示参考图背景。不要扩写新剧情或添加镜头、动作。",
        } };
        prompt["2"].inputs.value = ["prompt_enhance", 0];
    }
    prompt["17"].inputs.value = duration;
    prompt["20"].inputs.aspect_ratio = values.aspect_ratio;
    prompt["20"].inputs.megapixels = megapixels;
    const noise = prompt["31"].inputs;
    noise.noise_seed = fixedSeed(values.seed, noise.noise_seed);
    if (values.audio_mode === "mute") {
        prompt.silence_duration = { class_type: "ComfyMathExpression", inputs: { expression: "a / 24", "values.a": ["19", 1] } };
        prompt.silence = { class_type: "EmptyAudio", inputs: { duration: ["silence_duration", 0], sample_rate: 44100, channels: 2 } };
        prompt["86"].inputs.audio = ["silence", 0];
        delete prompt["42"].inputs.audio;
    } else if (values.audio_mode !== "reconstruct") prompt["42"].inputs.audio = ["43", 2];
    if (values.audio_mode !== "reconstruct") delete prompt["8"];
    return prompt;
}

registerCapCutWorkflow("CapCutMiniMaxH3CharacterSwapWorkflow", {
    label: "MiniMax H3 人物替换",
    fields,
    getFields: () => getFields(fields),
    loadModels,
    async run({ node, values, onProgress, getConsolePrompt }) {
        const response = await fetch(new URL("./workflows/character_swap.json", import.meta.url));
        if (!response.ok) throw new Error("无法读取内置人物替换工作流，请刷新页面后重试");
        const configuration = Object.fromEntries(node.widgets.map(widget => [widget.name, widget.value]));
        const output = buildCharacterSwapPrompt(await response.json(), configuration, values);
        await applySamplingOptions(output, values, getConsolePrompt, "21", {
            latent: output["21"].inputs.latent_image, positive: ["11", 0], model: ["37", 0], video_vae: ["3", 0], sigmas: ["24", 0],
            seed: output["31"].inputs.noise_seed, shift_video: output["38"].inputs.shift_video, shift_audio: output["38"].inputs.shift_audio,
        }, { width: ["20", 0], height: ["20", 1], saveId: "42" });
        if (values.selflift_enabled === true) for (const id of ["18", "29", "31"]) delete output[id];
        const definitions = await api.getNodeDefs();
        const missing = [...new Set(Object.values(output).map(item => item.class_type))].filter(type => !definitions[type]);
        if (missing.length) throw new Error(`缺少人物替换节点：${missing.join("、")}。请安装原工作流依赖并重启 ComfyUI`);
        let promptId;
        const stages = { prompt_enhance: "GPT 优化人物替换提示词", "43": "读取原视频", "48": "加载 SAM3", "53": "跟踪目标人物", "56": "清理人物遮罩", "123": "裁剪人物区域", "30": "加载视频模型", "11": "准备替换条件", "21": values.selflift_enabled === true ? "SelfLift 渐进采样" : "人物重绘采样", capcut_refine: "放大与二采", "7": "视频解码", "95": "回贴原画面", "42": "保存视频" };
        const executing = event => {
            if (!promptId || event.detail.prompt_id !== promptId) return;
            const stage = stages[String(event.detail.node)];
            if (stage) onProgress({ status: "running", stage });
        };
        const progress = event => {
            const data = event.detail;
            if (!promptId || data.prompt_id !== promptId || !["21", "capcut_refine"].includes(String(data.node)) || !(data.max > 0)) return;
            onProgress({ status: "running", percent: samplingPercent(data, values), stage: `${stages[String(data.node)]} ${data.value}/${data.max} 步` });
        };
        if (onProgress) {
            api.addEventListener("executing", executing);
            api.addEventListener("progress", progress);
        }
        try {
            const result = await api.queuePrompt(0, { output, workflow: node.graph.serialize() });
            promptId = result.prompt_id;
            onProgress?.({ status: "queued", stage: "等待 ComfyUI 执行人物替换" });
            const videos = await waitForVideo(promptId, onProgress, "42");
            onProgress?.({ status: "running", percent: 100, stage: "人物替换视频已保存" });
            return videos;
        } finally {
            if (onProgress) {
                api.removeEventListener("executing", executing);
                api.removeEventListener("progress", progress);
            }
        }
    },
});
