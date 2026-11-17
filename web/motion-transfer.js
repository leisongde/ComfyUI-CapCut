import { api } from "../../scripts/api.js";
import { registerCapCutWorkflow } from "./editor.js";
import { getWorkflowNodeInputs, waitForVideo } from "./minimax.js";

export const fields = [
    { name: "source_video", label: "驱动视频（必选，可使用人体白模结果）", type: "media", kind: "video", default: "" },
    { name: "character_images", label: "角色参考图（按顺序对应蓝、红、绿、品红、青、黄）", type: "media", kind: "image", multiple: true, default: [] },
    { name: "prompt", label: "补充要求（可留空）", type: "textarea", default: "" },
    { name: "enhance_prompt", label: "提示词处理", type: "select", default: "off", options: [
        { value: "off", label: "使用角色对应模板与补充要求" }, { value: "on", label: "原流程 GPT 看图描述并编排提示词" },
    ] },
    { name: "prompt_api_key", label: "GPT 看图与编排 API 密钥", type: "password", default: "" },
    { name: "prompt_model", label: "GPT 看图与编排模型", type: "select", default: "gpt-5.6-sol", options: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"] },
    { name: "start_time", label: "驱动视频起始位置（秒）", type: "number", default: 0, min: 0, step: 0.1 },
    { name: "duration", label: "生成时长（秒，24 fps，自动对齐 H3 帧数）", type: "number", default: 5, step: 0.1 },
    { name: "aspect_ratio", label: "输出比例", type: "select", default: "9:16 (Portrait Widescreen)", options: [
        "16:9 (Widescreen)", "9:16 (Portrait Widescreen)", "1:1 (Square)", "4:3 (Standard)",
        "3:4 (Portrait Standard)", "3:2 (Photo)", "2:3 (Portrait Photo)", "21:9 (Ultrawide)",
    ] },
    { name: "megapixels", label: "输出分辨率（百万像素）", type: "number", default: 0.4, step: 0.1 },
    { name: "longest_side", label: "驱动视频处理长边（像素，保持原比例）", type: "number", default: 736, min: 32, step: 32 },
    { name: "seed", label: "种子（-1 为随机）", type: "number", default: -1 },
    { name: "audio_mode", label: "声音处理", type: "select", default: "source", options: [
        { value: "source", label: "保留驱动视频原声（需含音轨）" }, { value: "mute", label: "静音（无音轨视频请选择此项）" },
    ] },
];

const colors = ["BLUE", "RED", "GREEN", "MAGENTA", "CYAN", "YELLOW"];

export function buildMotionTransferText(count, extra = "", slots = Array.from({ length: count }, (_, index) => index)) {
    const subjects = Array.from({ length: count }, (_, index) => {
        const number = index + 1;
        const slot = slots[index];
        const performer = colors[slot] ? `${colors[slot]} source performer (fixed source slot ${slot + 1})` : `source performer in slot ${slot + 1}, counted from left to right at the opening`;
        return `<Subject ${number}> is the character from <Picture ${number}>, replacing the ${performer} in <Video 1>. Preserve this reference character's identity, visual style, original body proportions, clothing and colors throughout the performance.`;
    });
    return `subject_definitions:
${subjects.join("\n")}
<Video 1> is the driving video supplying the performers' continuous movements, timing, initial positions, floor locations, depth, trajectories, framing and camera movement.

summary:
[video editing + reference generation] The target video is an edited version of <Video 1>. All ${count} reference characters perform together from the opening, each following their own assigned source performer throughout the clip.

retention_analysis:
${subjects.map((_, index) => `<Subject ${index + 1}> (appears in [Shot 1]): attribute_transfer - Transfer appearance from <Picture ${index + 1}> while inheriting the assigned source performer's complete movement and position.`).join("\n")}
<Video 1> ([Shot 1]): partially_preserved - Preserve motion, choreography, spatial relationships, timing and camera; replace the assigned performers with the reference characters.

detailed_description:
[Shot 1] All ${count} distinct reference characters are visible simultaneously, occupying their corresponding performers' original positions and depth in <Video 1>. Each follows that performer's gestures, full-body movement, foot contacts, direction changes and continuous trajectory in synchrony with the driving video. Keep the characters' reference proportions, materials, faces and outfits consistent during motion. Maintain one coherent scene and continuous lighting. The source colors identify performers; the target characters retain their own appearance from the pictures. ${extra.trim()}

overall_soundscape:
No additional speech or sound effects.

non_diegetic_music:
N/A`;
}

export function buildMotionTransferPrompt(template, configuration, values) {
    const filePath = (file, label) => {
        if (!file) throw new Error(`请选择${label}`);
        if (file.type !== "input") throw new Error(`${label}需要先导入当前工程`);
        return [file.subfolder, file.filename].filter(Boolean).join("/");
    };
    const video = filePath(values.source_video?.[0], "驱动视频");
    const images = values.character_images ?? [];
    if (!images.length) throw new Error("请至少选择一张角色参考图");
    const slots = images.map((_, index) => values.character_slots?.[index] ?? index);
    if (slots.some(slot => !Number.isInteger(slot) || slot < 0) || new Set(slots).size !== slots.length) throw new Error("角色参考图位置无效，请重新选择");
    const duration = Number(values.duration), start = Number(values.start_time), megapixels = Number(values.megapixels), size = Number(values.longest_side);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("生成时长需要大于 0 秒");
    if (!Number.isFinite(start) || start < 0) throw new Error("驱动视频起始位置需要大于或等于 0 秒");
    if (!Number.isFinite(megapixels) || megapixels <= 0) throw new Error("输出分辨率需要大于 0");
    if (!Number.isInteger(size) || size < 32) throw new Error("驱动视频处理长边需要为大于或等于 32 的整数");
    const prompt = structuredClone(template);
    for (const [name, id, input] of [
        ["model_name", "5", "unet_name"], ["clip_name", "3", "clip_name"],
        ["video_vae", "2", "vae_name"], ["audio_vae", "4", "vae_name"],
        ["motion_lora", "6", "lora_name"], ["motion_strength", "6", "strength_model"],
        ["turbo_lora", "9", "lora_name"], ["turbo_strength", "9", "strength_model"],
        ["steps", "27", "steps"], ["shift_video", "7", "shift_video"], ["shift_audio", "7", "shift_audio"],
        ["attention", "8", "attention"], ["sparse_threshold", "11", "selection.tau"],
        ["reference_longest_side", "229", "scale_to_length"],
        ["tiny_vae", "13", "tiny_vae"],
    ]) if (configuration[name] !== undefined) prompt[id].inputs[input] = configuration[name];
    prompt["117"].inputs.video = video;
    prompt["117"].inputs.skip_first_frames = Math.round(start * 24);
    prompt["175"].inputs.value = duration;
    prompt["39"].inputs.aspect_ratio = values.aspect_ratio;
    prompt["39"].inputs.megapixels = megapixels;
    prompt["32"].inputs.scale_to_length = size;
    prompt["314"].inputs.noise_seed = Number(values.seed) === -1 ? Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) : Number(values.seed);
    if (configuration.sparse_attention === false) {
        prompt["27"].inputs.model = ["13", 0];
        prompt["314"].inputs.model = ["13", 0];
    }
    const text = buildMotionTransferText(images.length, values.prompt, slots);
    const enhance = values.enhance_prompt === "on";
    if (enhance && !values.prompt_api_key?.trim()) throw new Error("请填写 GPT 看图与编排 API 密钥，或选择使用角色对应模板");
    const imageScale = structuredClone(prompt["229"]), caption = structuredClone(prompt["368"]);
    let descriptions = text;
    for (const [index, file] of images.entries()) {
        const slot = slots[index];
        const imageId = ["228", "29", "244", "246", "248", "250"][slot] ?? `character_image_${slot}`;
        const scaleId = ["229", "30", "245", "247", "249", "251"][slot] ?? `character_scale_${slot}`;
        const captionId = `character_caption_${index}`;
        prompt[imageId] = { class_type: "LoadImage", inputs: { image: filePath(file, `角色参考图 ${index + 1}`) } };
        prompt[scaleId] = structuredClone(imageScale);
        prompt[scaleId].inputs.image = [imageId, 0];
        prompt["12"].inputs[`ref_images.ref_image_${index}`] = [scaleId, 0];
        if (enhance) {
            prompt[captionId] = structuredClone(caption);
            Object.assign(prompt[captionId].inputs, { image: [imageId, 0], api_key: values.prompt_api_key, model: values.prompt_model });
            prompt[captionId].inputs.reverse_instruction = caption.inputs.reverse_instruction
                .replaceAll("<Subject 1>", `<Subject ${index + 1}>`).replaceAll("<Picture 1>", `<Picture ${index + 1}>`)
                .replaceAll("Character 1", `Character ${index + 1}`).replaceAll("slot 1", `slot ${slot + 1}`)
                .replaceAll("BLUE source performer", colors[slot] ? `${colors[slot]} source performer` : `source performer in opening position ${slot + 1} from left to right`);
            const joinId = `join_caption_${index}`;
            prompt[joinId] = { class_type: "StringConcatenate", inputs: { string_a: descriptions, string_b: [captionId, 0], delimiter: "\n\n" } };
            descriptions = [joinId, 0];
        }
    }
    if (enhance) {
        Object.assign(prompt["376"].inputs, { api_key: values.prompt_api_key, user_prompt: descriptions, model: values.prompt_model });
        prompt["376"].inputs.system_prompt = prompt["376"].inputs.system_prompt.replaceAll("1–6", "1–9")
            + `\n本轮有 ${images.length} 张实际角色图。优先沿用驱动视频中对应人物的真实站位与轨迹，不按人数重新排列。第七个及以后的角色按开场从左到右的位置对应，不虚构六色表以外的颜色。`;
        prompt["12"].inputs.prompt = ["376", 0];
    } else prompt["12"].inputs.prompt = text;
    if (values.audio_mode === "mute") delete prompt["346"].inputs.audio;
    const needed = new Set(), pending = ["346"];
    while (pending.length) {
        const id = pending.pop();
        if (needed.has(id)) continue;
        needed.add(id);
        for (const value of Object.values(prompt[id].inputs)) if (Array.isArray(value)) pending.push(value[0]);
    }
    return Object.fromEntries(Object.entries(prompt).filter(([id]) => needed.has(id)));
}

registerCapCutWorkflow("CapCutMotionTransferWorkflow", {
    label: "MiniMax H3 动作迁移",
    fields,
    async getFields() {
        const inputs = await getWorkflowNodeInputs("ChatGPTImagePromptReverseGW");
        const options = inputs?.required?.model?.[0];
        return fields.map(field => field.name === "prompt_model" && Array.isArray(options) && options.length
            ? { ...field, options, default: options.includes(field.default) ? field.default : options[0] } : field);
    },
    async run({ node, values, onProgress }) {
        const response = await fetch(new URL("./workflows/motion_transfer.json", import.meta.url));
        if (!response.ok) throw new Error("无法读取内置动作迁移工作流，请刷新页面后重试");
        const configuration = Object.fromEntries(node.widgets.map(widget => [widget.name, widget.value]));
        const output = buildMotionTransferPrompt(await response.json(), configuration, values);
        const definitions = await api.getNodeDefs();
        const missing = [...new Set(Object.values(output).map(item => item.class_type))].filter(type => !definitions[type]);
        if (missing.length) throw new Error(`缺少动作迁移节点：${missing.join("、")}。请安装原工作流依赖并重启 ComfyUI`);
        let promptId;
        const stages = { "117": "读取驱动视频", "5": "加载视频模型", "6": "加载动作修复 LoRA", "376": "GPT 编排动作迁移提示词", "12": "准备角色与动作条件", "314": "动作迁移采样", "36": "视频解码", "382": "清理显存", "346": "保存视频" };
        const executing = event => {
            if (!promptId || event.detail.prompt_id !== promptId) return;
            const id = String(event.detail.node);
            const stage = id.startsWith("character_caption_") ? `GPT 分析角色 ${Number(id.slice(18)) + 1}` : stages[id];
            if (stage) onProgress({ status: "running", stage });
        };
        const progress = event => {
            const data = event.detail;
            if (!promptId || data.prompt_id !== promptId || String(data.node) !== "314" || !(data.max > 0)) return;
            onProgress({ status: "running", percent: Math.round(data.value / data.max * 100), stage: `动作迁移 ${data.value}/${data.max} 步` });
        };
        if (onProgress) {
            api.addEventListener("executing", executing);
            api.addEventListener("progress", progress);
        }
        try {
            const result = await api.queuePrompt(0, { output, workflow: node.graph.serialize() });
            promptId = result.prompt_id;
            onProgress?.({ status: "queued", stage: "等待 ComfyUI 执行动作迁移" });
            const videos = await waitForVideo(promptId, onProgress, "346");
            onProgress?.({ status: "running", percent: 100, stage: "动作迁移视频已保存" });
            return videos;
        } finally {
            if (onProgress) {
                api.removeEventListener("executing", executing);
                api.removeEventListener("progress", progress);
            }
        }
    },
});
