import { api } from "../../scripts/api.js";
import { registerCapCutWorkflow } from "./editor.js";
import { waitForVideo } from "./minimax.js";

const models = {
    x2: ["RelayVSR\\relayvsr_x2_lightx2v_int8_convrot.safetensors", "RelayVSR\\relayvsr_flash_vae_x2_fp32.safetensors"],
    x4: ["RelayVSR\\relayvsr_x4_int8_convrot.safetensors", "RelayVSR\\relayvsr_flash_vae_x4_fp32.safetensors"],
};

registerCapCutWorkflow("CapCutRelayVSRWorkflow", {
    label: "Relay VSR 视频放大",
    fields: [
        { name: "source_video", label: "原视频", type: "media", kind: "video", default: "" },
        { name: "scale", label: "放大倍率", type: "select", default: "x2", options: [
            { value: "x2", label: "X2" }, { value: "x4", label: "X4" },
        ] },
        { name: "detail", label: "细节", type: "number", default: 0.8, min: 0, max: 1, step: 0.01 },
    ],
    async run({ node, values, onProgress }) {
        const file = values.source_video?.[0];
        if (!file || file.type !== "input") throw new Error("请选择工程中的原视频");
        const scale = values.scale ?? "x2";
        if (!Object.hasOwn(models, scale)) throw new Error("请选择 X2 或 X4");
        const detail = Number(values.detail ?? 0.8);
        if (values.detail === "" || !Number.isFinite(detail) || detail < 0 || detail > 1) throw new Error("细节需填写 0 到 1 之间的数字");
        const [unet, vae] = models[scale];
        const response = await fetch(new URL("./workflows/relay_vsr.json", import.meta.url));
        if (!response.ok) throw new Error("无法读取内置 Relay VSR 工作流，请刷新页面后重试");
        const output = await response.json();
        output[1].inputs.file = [file.subfolder, file.filename].filter(Boolean).join("/");
        output[3].inputs.unet_name = unet;
        output[4].inputs.vae_name = vae;
        output[6].inputs.seed = Math.floor(Math.random() * 100_000_000);
        output[7].inputs.detail = detail;
        const { prompt_id } = await api.queuePrompt(0, { output, workflow: node.graph.serialize() });
        onProgress?.({ status: "queued", stage: "等待 Relay VSR 视频放大" });
        return waitForVideo(prompt_id, onProgress, "9");
    },
});
