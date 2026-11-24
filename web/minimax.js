import { api } from "../../scripts/api.js";
import { registerCapCutWorkflow } from "./editor.js";

export const samplingFields = [
    { name: "selflift_enabled", label: "SelfLift 渐进采样", type: "boolean", default: false },
    { name: "refine_enabled", label: "放大与二采", type: "boolean", default: false },
    { name: "refine_megapixels", label: "放大分辨率（百万像素 / MP）", type: "number", default: 1, min: 0.1, max: 16, step: 0.1 },
];

export const fields = [
    ...samplingFields,
    { name: "system_prompt", label: "系统提示词", type: "textarea", default: "" },
    { name: "prompt", label: "提示词", type: "textarea", default: "一个女人，走在乌镇的石板路上，穿着旗袍，打着油纸伞。不要背景音乐。" },
    { name: "prompt_skill", label: "Skill", type: "select", default: "MiniMax H3 提示词编写 [write-seedance-video-prompts]", options: ["MiniMax H3 提示词编写 [write-seedance-video-prompts]"] },
    { name: "prompt_director", label: "导演", type: "select", default: "文戏表演", options: ["自动选择", "战斗导演", "文戏表演", "全流程导演"] },
    { name: "prompt_intensity", label: "动作强度", type: "select", default: "R2 商业高燃（默认）", options: ["R1 写实克制", "R2 商业高燃（默认）", "R3 玄幻大招"] },
    { name: "prompt_model", label: "模型", type: "select", default: "gpt-6-sol", options: ["gpt-6-sol"] },
    { name: "task_type", label: "生成方式", type: "select", default: "T2VA", options: [
        { value: "auto", label: "按所选素材自动选择" }, { value: "T2VA", label: "文生音视频" },
        { value: "I2VA", label: "首帧生视频" }, { value: "FL2VA", label: "首尾帧生视频" },
        { value: "L2VA", label: "尾帧生视频" }, { value: "Ref2VA", label: "多参考素材生视频" },
        { value: "V2VA", label: "视频编辑（单视频）" },
        { value: "V2VARef", label: "视频+参考修改" },
        { value: "Hybrid", label: "首尾帧与参考素材混合" },
    ] },
    { name: "duration", label: "时长（秒，24 fps）", type: "number", default: 15, min: 4, max: 15, step: 0.1 },
    { name: "aspect_ratio", label: "画面比例", type: "select", default: "16:9 (Widescreen)", options: [
        "16:9 (Widescreen)", "9:16 (Portrait Widescreen)", "1:1 (Square)", "4:3 (Standard)",
        "3:4 (Portrait Standard)", "3:2 (Photo)", "2:3 (Portrait Photo)", "21:9 (Ultrawide)",
    ] },
    { name: "megapixels", label: "生成分辨率（百万像素）", type: "number", default: 0.4, step: 0.1 },
    { name: "seed", label: "固定种子", type: "number", default: 375540071883589, min: 0, step: 1 },
    { name: "first_frame", label: "首帧图片", type: "media", kind: "image", default: "" },
    { name: "last_frame", label: "尾帧图片", type: "media", kind: "image", default: "" },
    { name: "ref_images", label: "参考图片（按下方编号对应 Picture）", type: "media", kind: "image", multiple: true, default: [] },
    { name: "ref_videos", label: "参考视频（按下方编号对应 Video）", type: "media", kind: "video", multiple: true, default: [] },
    { name: "ref_audios", label: "参考音频（按下方编号对应 Audio）", type: "media", kind: "audio", multiple: true, default: [] },
    { name: "audio_mode", label: "声音处理", type: "select", default: "native", options: [
        { value: "native", label: "生成声音" }, { value: "reference_only", label: "参考声音后生成" },
        { value: "lock_source", label: "保留驱动音频" }, { value: "remix_source", label: "重混驱动音频" },
    ] },
    { name: "drive_audio", label: "驱动音频", type: "media", kind: "audio", default: "" },
    { name: "final_audio", label: "最终音轨（可选）", type: "media", kind: "audio", default: "" },
    { name: "enhance_prompt", label: "提示词增强", type: "select", default: "off", options: [
        { value: "off", label: "直接使用提示词" }, { value: "on", label: "调用原工作流的提示词增强节点" },
    ] },
    { name: "prompt_api_key", label: "提示词增强 API 密钥", type: "password", default: "" },
];

const nodeInputs = new Map();

export function getWorkflowNodeInputs(nodeType) {
    if (!nodeInputs.has(nodeType)) {
        const pending = api.fetchApi(`/object_info/${encodeURIComponent(nodeType)}`).then(async response => {
            if (!response.ok) throw new Error(`无法读取工作流选项（${response.status}）`);
            return (await response.json())[nodeType]?.input;
        }).catch(error => {
            nodeInputs.delete(nodeType);
            throw error;
        });
        nodeInputs.set(nodeType, pending);
    }
    return nodeInputs.get(nodeType);
}

export async function getFields(sourceFields = fields) {
    const inputs = await getWorkflowNodeInputs("MiniMaxH3PromptSkill");
    const names = { prompt_skill: "官方 Skill", prompt_director: "导演", prompt_intensity: "动作强度", prompt_model: "模型" };
    return sourceFields.map(field => {
        const name = names[field.name];
        const schema = inputs?.required?.[name] ?? inputs?.optional?.[name];
        const options = schema?.[0];
        return Array.isArray(options) && options.some(Boolean)
            ? { ...field, options, default: options.includes(field.default) ? field.default : schema[1]?.default ?? options[0] }
            : field;
    });
}

const referenceNodes = {
    ref_images: ["37", "40", "43", "38", "41", "44", "39", "42", "45"],
    ref_audios: ["63", "69", "70"],
    ref_videos: ["66", "67", "68"],
};

export async function applySamplingOptions(prompt, values, getConsolePrompt, samplerId, inputs, uncrop) {
    if (values.selflift_enabled !== true && values.refine_enabled !== true) return;
    const { consoleId, output } = await getConsolePrompt();
    const consoleInputs = output[consoleId]?.inputs;
    const copied = new Map();
    const copyUpstream = ([id, slot]) => {
        if (!copied.has(id)) {
            const source = output[id];
            if (!source) throw new Error(`采样节点的上游接线无效：${id}`);
            const targetId = `capcut_sampling_${id}`;
            copied.set(id, targetId);
            prompt[targetId] = { class_type: source.class_type, inputs: Object.fromEntries(
                Object.entries(source.inputs).map(([name, value]) => [name, Array.isArray(value) ? copyUpstream(value) : value])
            ) };
        }
        return [copied.get(id), slot];
    };
    const connected = (port, type, label) => {
        const link = consoleInputs?.[port];
        if (!Array.isArray(link) || output[link[0]]?.class_type !== type) {
            throw new Error(`请把「${label}」节点接到当前主控台，并确认节点已启用`);
        }
        return copyUpstream(link);
    };
    const consumers = Object.values(prompt).flatMap(node => Object.entries(node.inputs)
        .filter(([, value]) => Array.isArray(value) && value[0] === samplerId)
        .map(([name]) => [node.inputs, name]));

    const { latent, sigmas, first_frame, last_frame, ...common } = inputs;
    if (values.selflift_enabled === true) {
        const selflift = connected("selflift", "MiniMaxH3DirectorSelfLift", "SelfLift 渐进采样");
        prompt[samplerId] = { class_type: "CapCutSelfLiftSampler", inputs: { ...common, latent, sigmas, selflift } };
        for (const [consumer, name] of consumers) consumer[name] = [samplerId, 0];
    }
    if (values.refine_enabled === true) {
        const megapixels = Number(values.refine_megapixels ?? 1);
        if (!Number.isFinite(megapixels) || megapixels < 0.1 || megapixels > 16) throw new Error("放大分辨率需要在 0.1 到 16 MP 之间");
        const refine = connected("refine", "MiniMaxH3DirectorRefine", "放大与二采");
        const config = prompt[refine[0]].inputs;
        if (!config.sigmas) throw new Error("请给放大与二采节点的 sigmas 输入接上调度器");
        Object.assign(config, { megapixels, mode: "upscale", skip_fl2v: false, confirm_first_pass: false });
        const sampled = consumers[0][0][consumers[0][1]];
        prompt.capcut_refine = { class_type: "CapCutRefineSampler", inputs: {
            ...common, latent: sampled, refine,
            ...(first_frame && { first_frame }), ...(last_frame && { last_frame }),
            ...(uncrop && { uncrop_width: uncrop.width, uncrop_height: uncrop.height }),
        } };
        for (const [consumer, name] of consumers) consumer[name] = ["capcut_refine", 0];
        if (uncrop) {
            const save = prompt[uncrop.saveId].inputs;
            prompt.capcut_refine_canvas = { class_type: "ImageScale", inputs: {
                image: save.images, width: ["capcut_refine", 1], height: ["capcut_refine", 2], upscale_method: "lanczos", crop: "disabled",
            } };
            save.images = ["capcut_refine_canvas", 0];
        }
    }
}

export function samplingPercent(data, values) {
    const share = Math.max(0, Math.min(1, data.value / data.max));
    if (values.refine_enabled !== true) return Math.round(share * 100);
    return Math.round(share * 50) + (String(data.node) === "capcut_refine" ? 50 : 0);
}

export function fixedSeed(value, fallback) {
    const seed = Number(value ?? -1);
    return seed === -1 ? fallback : seed;
}

export function buildMinimaxPrompt(template, configuration, values) {
    const prompt = structuredClone(template);
    const conditioning = prompt["6"].inputs;
    for (const [name, id, input] of [
        ["base_model", "62", "base_model"], ["overlay_model", "62", "overlay_model"],
        ["clip_name", "3", "clip_name"], ["video_vae", "4", "vae_name"], ["audio_vae", "5", "vae_name"],
        ["lora_name", "78", "lora_name"], ["lora_strength", "78", "strength_model"],
        ["steps", "7", "steps"], ["shift_video", "7", "shift_video"], ["shift_audio", "7", "shift_audio"],
    ]) if (configuration[name] !== undefined) prompt[id].inputs[input] = configuration[name];
    const duration = Number(values.duration);
    if (!Number.isFinite(duration) || duration < 4 || duration > 15) throw new Error("生成时长需要在 4 到 15 秒之间");
    prompt["14"].inputs.value = duration;
    prompt["16"].inputs.aspect_ratio = values.aspect_ratio;
    prompt["16"].inputs.megapixels = Number(values.megapixels);
    const noise = prompt["9"].inputs;
    noise.noise_seed = fixedSeed(values.seed, noise.noise_seed);
    const referenceEdit = values.task_type === "V2VARef";
    const videoEdit = values.task_type === "V2VA" || referenceEdit;
    let combinedPrompt = [values.system_prompt, values.prompt].filter(value => value?.trim()).join(",");
    if (videoEdit && !/<Video\s+1\s*>/i.test(combinedPrompt)) combinedPrompt = `<Video 1> ${combinedPrompt}`;
    conditioning.prompt = combinedPrompt;
    conditioning.task_type = videoEdit ? "Ref2VA" : values.task_type;
    const textOnly = values.task_type === "T2VA";
    const imageOnly = values.task_type === "I2VA";
    const firstLastFrames = values.task_type === "FL2VA";
    const referenceOnly = values.task_type === "Ref2VA" || videoEdit;
    const frameMode = imageOnly || firstLastFrames;
    if (frameMode && !values.first_frame?.length) throw new Error("请上传首帧图片");
    if (firstLastFrames && !values.last_frame?.length) throw new Error("请上传尾帧图片");
    if (videoEdit && !values.ref_videos?.[0]) throw new Error("请上传视频 1");
    if (referenceOnly && !Object.keys(referenceNodes).some(name => values[name]?.length)) throw new Error("请至少上传一项参考图片、音频或视频");
    conditioning.audio_mode = textOnly || frameMode || videoEdit ? "native" : values.audio_mode;
    if (textOnly || frameMode || referenceOnly) {
        for (const name of Object.keys(conditioning)) {
            if (/^(first_frame|last_frame|drive_audio|final_audio|ref_images\.|ref_videos\.|ref_audios\.|ref_video_audios\.)/.test(name)) delete conditioning[name];
        }
        for (const [id, item] of Object.entries(prompt)) {
            if (["LoadImage", "LoadAudio", "VHS_LoadVideo"].includes(item.class_type)) delete prompt[id];
        }
        prompt["12"].inputs.audio = ["11", 1];
    }
    for (const field of fields.filter(item => item.type === "media" && !textOnly && (!videoEdit || item.name === "ref_videos" || (referenceEdit && ["ref_images", "ref_audios"].includes(item.name))) && (!referenceOnly || !["first_frame", "last_frame"].includes(item.name)) && (!frameMode || item.name === "first_frame" || (firstLastFrames && item.name === "last_frame")))) {
        const files = videoEdit && field.name === "ref_videos" ? values.ref_videos.slice(0, 1) : values[field.name] ?? [];
        for (const [index, file] of files.entries()) {
            const id = index === 0 && field.name === "first_frame" ? "71" : index === 0 && field.name === "last_frame" ? "72" : referenceNodes[field.name]?.[index] ?? `${field.name}_${index}`;
            if (file.type !== "input") throw new Error("参考素材需要先导入当前工程");
            const path = [file.subfolder, file.filename].filter(Boolean).join("/");
            if (field.kind === "video") {
                prompt[id] = { class_type: "VHS_LoadVideo", inputs: {
                    video: path, force_rate: 24, custom_width: 0, custom_height: 0,
                    frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1, format: "None",
                } };
            } else {
                prompt[id] = { class_type: field.kind === "image" ? "LoadImage" : "LoadAudio", inputs: {
                    [field.kind === "image" ? "image" : "audio"]: path,
                } };
            }
            const input = field.multiple ? `${field.name}.${field.name.slice(0, -1)}_${index}` : field.name;
            conditioning[input] = [id, 0];
        }
    }
    if (!textOnly && !frameMode && !videoEdit && values.final_audio?.length) prompt["12"].inputs.audio = ["6", 2];
    if (values.enhance_prompt === "on") {
        if (!values.prompt_api_key?.trim()) throw new Error("请填写提示词增强 API 密钥，或选择直接使用提示词");
        const enhance = prompt["73"].inputs;
        enhance["API 密钥"] = values.prompt_api_key;
        enhance["用户提示词"] = combinedPrompt;
        enhance["官方 Skill"] = values.prompt_skill ?? enhance["官方 Skill"];
        enhance["导演"] = values.prompt_director ?? enhance["导演"];
        enhance["动作强度"] = values.prompt_intensity ?? enhance["动作强度"];
        enhance["模型"] = values.prompt_model ?? enhance["模型"];
        enhance["H3 模式"] = videoEdit || ["auto", "Hybrid"].includes(values.task_type) ? "Ref2VA" : values.task_type;
        enhance["补充上下文"] = `${duration} 秒，24 fps，${values.aspect_ratio}。${textOnly ? "纯文生视频，没有图片、视频或音频参考素材。" : imageOnly ? "使用一张首帧图片生成视频，没有尾帧或其他参考素材。" : firstLastFrames ? "使用首帧和尾帧图片生成视频，分别对应起始和结束画面，没有其他参考素材。" : referenceEdit ? "视频+参考修改：<Video 1> 是需要修改的原始视频；参考图片使用 <Picture 1> 等编号，参考音频使用 <Audio 1> 等编号。根据用户提示词和参考素材修改原始视频。" : videoEdit ? "视频编辑：仅上传一个待编辑视频，标记为 <Video 1>。根据用户提示词编辑源视频，没有参考图片或独立音频。" : "参考图片、视频、音频按选择顺序编号。"}`;
        conditioning.prompt = ["73", 0];
    } else delete prompt["73"];
    if (values.continuity_video) applyShotGuide(prompt, values, duration);
    return prompt;
}

function applyShotGuide(prompt, values, duration) {
    const file = values.continuity_video;
    if (!["T2VA", "Ref2VA"].includes(values.task_type) || prompt["6"].inputs.audio_mode !== "native" ||
        values.final_audio?.length || values.selflift_enabled === true || values.refine_enabled === true) {
        throw new Error("该生成模式不能使用段间引导");
    }
    if (typeof file.filename !== "string" || !["input", "output", "temp"].includes(file.type)) {
        throw new Error("前段成片无效");
    }
    const guideFrames = Number(values.continuity_frames ?? 22);
    const outputFrames = Math.round(duration * 24);
    const total = outputFrames + guideFrames;
    const aligned = total + (5 - total % 17 + 17) % 17;
    prompt["6"].inputs.length = aligned;
    delete prompt["14"];
    delete prompt["15"];
    prompt.capcut_guide_tail = { class_type: "CapCutShotGuideTail", inputs: {
        filename: file.filename, subfolder: file.subfolder ?? "", file_type: file.type,
        width: ["16", 0], height: ["16", 1], guide_frames: guideFrames,
    } };
    prompt.capcut_shot_guide = { class_type: "MiniMaxH3BranchGuideEXPT8", inputs: {
        positive: ["6", 0], latent: ["6", 1], frame_idx: 0, vae: ["4", 0], audio_vae: ["5", 0],
        image: ["capcut_guide_tail", 0], audio: ["capcut_guide_tail", 1],
    } };
    prompt["8"].inputs.conditioning = ["capcut_shot_guide", 0];
    prompt.capcut_trim_guide = { class_type: "CapCutTrimShotGuide", inputs: {
        images: ["11", 0], audio: ["11", 1], output_frames: outputFrames, guide_frames: guideFrames,
    } };
    Object.assign(prompt["12"].inputs, { images: ["capcut_trim_guide", 0], audio: ["capcut_trim_guide", 1] });
}

async function jsonRequest(path) {
    const response = await api.fetchApi(path);
    if (!response.ok) throw new Error(`无法读取生成任务：${response.status}`);
    return response.json();
}

export async function waitForVideo(promptId, onProgress, outputNodeId = "12") {
    const historyPath = `/history/${encodeURIComponent(promptId)}`;
    let started = false;
    for (;;) {
        let entry = (await jsonRequest(historyPath))[promptId];
        if (!entry) {
            const queue = await jsonRequest("/queue");
            if (!started && queue.queue_running.some(item => item[1] === promptId)) {
                started = true;
                onProgress?.({ status: "running", stage: "工作流执行中" });
            }
            const queued = [...queue.queue_running, ...queue.queue_pending].some(item => item[1] === promptId);
            if (!queued) {
                entry = (await jsonRequest(historyPath))[promptId];
                if (!entry) throw new Error("生成任务已从队列移除，可能已取消");
            }
        }
        if (entry) {
            const failure = entry.status?.messages?.find(item => ["execution_error", "execution_interrupted"].includes(item[0]));
            if (failure || entry.status?.status_str === "error") throw new Error(failure?.[1]?.exception_message ?? "生成任务失败或已中断，请查看 ComfyUI 队列");
            if (entry.status?.completed) {
                const output = entry.outputs?.[outputNodeId];
                const videos = [...(output?.gifs ?? []), ...(output?.images ?? [])].filter(file => /\.(mp4|webm|mov|mkv)$/i.test(file.filename));
                if (!videos.length) throw new Error("任务已完成，但没有保存的视频结果");
                return videos.map(({ filename, subfolder, type }) => ({ filename, subfolder, type }));
            }
        }
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
}

export async function loadModels(key) {
    const response = await api.fetchApi("/minimax-prompt/models", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: key }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "读取模型列表失败");
    if (!Array.isArray(result.models) || !result.models.length) throw new Error("没有可选模型，请检查 API Key");
    return result.models;
}

registerCapCutWorkflow("CapCutMiniMaxH3Workflow", {
    label: "MiniMax H3 生视频",
    fields,
    getFields,
    usesMedia: values => values.task_type !== "T2VA",
    loadModels,
    async run({ node, values, onProgress, getConsolePrompt }) {
        const response = await fetch(new URL("./workflows/minimax_h3.json", import.meta.url));
        if (!response.ok) throw new Error("无法读取内置 MiniMax 工作流，请刷新页面后重试");
        const configuration = Object.fromEntries(node.widgets.map(widget => [widget.name, widget.value]));
        const output = buildMinimaxPrompt(await response.json(), configuration, values);
        await applySamplingOptions(output, values, getConsolePrompt, "10", {
            latent: ["6", 1], positive: ["6", 0], model: ["78", 0], video_vae: ["4", 0], sigmas: ["7", 2],
            seed: output["9"].inputs.noise_seed, shift_video: output["7"].inputs.shift_video, shift_audio: output["7"].inputs.shift_audio,
            first_frame: output["6"].inputs.first_frame, last_frame: output["6"].inputs.last_frame,
        });
        if (values.selflift_enabled === true) {
            delete output["8"];
            delete output["9"];
        }
        const definitions = await api.getNodeDefs();
        const missing = [...new Set(Object.values(output).map(item => item.class_type))].filter(type => !definitions[type]);
        if (missing.length) throw new Error(`缺少工作流节点：${missing.join("、")}。请安装原工作流依赖并重启 ComfyUI`);
        let promptId;
        const stages = { "62": "加载视频模型", "3": "加载文本编码器", "73": "提示词增强", "6": "准备视频条件", capcut_guide_tail: "读取前段末尾", capcut_shot_guide: "应用段间引导", "7": "配置采样器", "10": values.selflift_enabled === true ? "SelfLift 渐进采样" : "视频采样", capcut_refine: "放大与二采", "11": "视频解码", "12": "保存视频" };
        const samplingNodes = ["10", "capcut_refine"];
        const executing = event => {
            if (event.detail.prompt_id !== promptId || !promptId) return;
            const stage = stages[String(event.detail.node)];
            if (stage) onProgress({ status: "running", stage });
        };
        const samplingProgress = data => {
            if (!(data.max > 0) || !Number.isFinite(data.value)) return;
            onProgress({ status: "running", percent: samplingPercent(data, values), stage: `${stages[String(data.node)]} ${data.value}/${data.max} 步` });
        };
        const progress = event => {
            const data = event.detail;
            if (data.prompt_id !== promptId || !promptId || !samplingNodes.includes(String(data.node))) return;
            samplingProgress(data);
        };
        const progressState = event => {
            const data = event.detail;
            if (data.prompt_id !== promptId || !promptId) return;
            const active = Object.entries(data.nodes ?? {}).find(([id, state]) => state.state === "running" && stages[id]);
            if (active && !samplingNodes.includes(active[0])) {
                onProgress({ status: "running", stage: stages[active[0]] });
                return;
            }
            if (active) samplingProgress({ ...active[1], node: active[0] });
        };
        const cached = event => {
            if (event.detail.prompt_id === promptId && promptId && event.detail.nodes?.map(String).includes("10"))
                onProgress({ status: "running", percent: values.refine_enabled === true ? 50 : 100, stage: "采样结果已从缓存读取" });
        };
        if (onProgress) {
            api.addEventListener("executing", executing);
            api.addEventListener("progress", progress);
            api.addEventListener("progress_state", progressState);
            api.addEventListener("execution_cached", cached);
        }
        try {
            const result = await api.queuePrompt(0, { output, workflow: node.graph.serialize() });
            promptId = result.prompt_id;
            onProgress?.({ status: "queued", stage: "等待 ComfyUI 执行" });
            const videos = await waitForVideo(promptId, onProgress);
            onProgress?.({ status: "running", percent: 100, stage: "视频已保存" });
            return videos;
        } finally {
            if (onProgress) {
                api.removeEventListener("executing", executing);
                api.removeEventListener("progress", progress);
                api.removeEventListener("progress_state", progressState);
                api.removeEventListener("execution_cached", cached);
            }
        }
    },
});
