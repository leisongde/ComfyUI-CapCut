import folder_paths
from comfy_api.latest import io


class CapCutMiniMaxH3Workflow(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="CapCutMiniMaxH3Workflow",
            display_name="CapCut MiniMax H3 生视频",
            category="CapCut",
            description="封装固定的 MiniMax H3 混合模型音视频工作流。连接主控台后，在剪辑工作台选择素材并生成。此节点只提供配置，不加载模型。",
            inputs=[
                io.String.Input("base_model", default="minimax\\minimax_h3_fl2va_pruned_fp8_scaled.safetensors", display_name="基础模型"),
                io.String.Input("overlay_model", default="minimax\\minimax_h3_ref2va_pruned_fp8_scaled.safetensors", display_name="叠加模型"),
                io.String.Input("clip_name", default="qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", display_name="文本编码器"),
                io.String.Input("video_vae", default="minimax\\minimax_h3_video_vae_fp16.safetensors", display_name="视频 VAE"),
                io.String.Input("audio_vae", default="minimax\\minimax_h3_audio_vae_fp32.safetensors", display_name="音频 VAE"),
                io.String.Input("lora_name", default="minimax\\minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors", display_name="加速 LoRA"),
                io.Float.Input("lora_strength", default=1.0, min=-100.0, max=100.0, step=0.05, display_name="LoRA 强度"),
                io.Int.Input("steps", default=8, min=1, max=1000, display_name="采样步数"),
                io.Float.Input("shift_video", default=12.0, min=0.01, max=100.0, display_name="视频 Shift"),
                io.Float.Input("shift_audio", default=3.0, min=0.01, max=100.0, display_name="音频 Shift"),
            ],
            outputs=[io.Custom("CAPCUT_WORKFLOW").Output(display_name="工作流")],
        )

    @classmethod
    def execute(cls, **settings):
        return io.NodeOutput(settings)


class CapCutMiniMaxH3CharacterSwapWorkflow(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="CapCutMiniMaxH3CharacterSwapWorkflow",
            display_name="CapCut MiniMax H3 人物替换",
            category="CapCut",
            description="封装 SAM3 跟踪、人物裁剪、MiniMax H3 遮罩重绘和回贴工作流。连接主控台后选择原视频和人物图片。此节点只提供配置，不加载模型。",
            inputs=[
                io.String.Input("model_name", default="minimax\\minimax_h3_ref2va_pruned_fp8_scaled.safetensors", display_name="视频模型"),
                io.String.Input("clip_name", default="qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", display_name="文本编码器"),
                io.String.Input("video_vae", default="minimax\\minimax_h3_video_vae_fp16.safetensors", display_name="视频 VAE"),
                io.String.Input("audio_vae", default="minimax\\minimax_h3_audio_vae_fp32.safetensors", display_name="音频 VAE"),
                io.String.Input("sam_checkpoint", default="sam3.1_multiplex_fp16.safetensors", display_name="SAM3 模型"),
                io.String.Input("character_lora", default="minimax\\h3_character_swap_v1.5.safetensors", display_name="人物替换 LoRA"),
                io.Float.Input("character_strength", default=1.0, min=-100.0, max=100.0, step=0.05, display_name="人物 LoRA 强度"),
                io.String.Input("turbo_lora", default="minimax\\minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors", display_name="加速 LoRA"),
                io.Float.Input("turbo_strength", default=1.0, min=-100.0, max=100.0, step=0.05, display_name="加速 LoRA 强度"),
                io.Int.Input("steps", default=8, min=1, max=1000, display_name="采样步数"),
                io.Float.Input("shift_video", default=12.0, min=0.01, max=100.0, step=0.01, advanced=True, display_name="视频 Shift"),
                io.Float.Input("shift_audio", default=3.0, min=0.01, max=100.0, step=0.01, advanced=True, display_name="音频 Shift"),
                io.Combo.Input("attention", options=["pytorch attention", "comfy kitchen attention"], default="comfy kitchen attention", advanced=True, display_name="Attention 后端"),
                io.Float.Input("detection_threshold", default=0.5, min=0.0, max=1.0, step=0.01, advanced=True, display_name="跟踪检测阈值"),
                io.Int.Input("max_objects", default=1, min=0, max=64, advanced=True, display_name="最大跟踪人数"),
                io.Int.Input("detect_interval", default=1, min=1, advanced=True, display_name="检测间隔（帧）"),
                io.String.Input("object_indices", default="", advanced=True, display_name="人物索引（留空全部）"),
                io.Float.Input("cleanup_threshold", default=0.3, min=0.0, max=1.0, step=0.01, advanced=True, display_name="遮罩清理阈值"),
                io.Int.Input("cleanup_shrink", default=12, min=1, advanced=True, display_name="遮罩去噪收缩"),
                io.Int.Input("cleanup_min_frames", default=4, min=1, advanced=True, display_name="遮罩最少持续帧"),
                io.Int.Input("edge_grow", default=16, min=0, advanced=True, display_name="遮罩边缘扩展"),
                io.Float.Input("crop_scale", default=1.75, min=0.0, max=4.0, step=0.05, advanced=True, display_name="人物裁剪倍率"),
                io.Int.Input("grow_spatial", default=36, min=-256, max=256, advanced=True, display_name="重绘遮罩空间扩展"),
                io.Int.Input("grow_temporal", default=1, min=-64, max=64, advanced=True, display_name="重绘遮罩时间扩展"),
                io.Int.Input("feather", default=16, min=0, max=256, advanced=True, display_name="回贴边缘羽化"),
            ],
            outputs=[io.Custom("CAPCUT_WORKFLOW").Output(display_name="工作流")],
        )

    @classmethod
    def execute(cls, **settings):
        return io.NodeOutput(settings)


class CapCutBodyRenderWorkflow(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="CapCutBodyRenderWorkflow",
            display_name="CapCut 人体白模渲染",
            category="CapCut",
            description="封装 RMBG 抠背景、SAM3 跟踪、MoGe 视角估计和 SAM3D Body 人体渲染。连接主控台后选择视频。此节点只提供配置，不加载模型。",
            inputs=[
                io.String.Input("sam_checkpoint", default="sam3.1_multiplex_fp16.safetensors", display_name="SAM3 模型"),
                io.String.Input("detector_model", default="rt_detr_v4-x-hgnet_fp16.safetensors", display_name="人体检测模型"),
                io.String.Input("moge_model", default="moge_2_vitl_normal_fp16.safetensors", display_name="MoGe 模型"),
                io.String.Input("body_model", default="sam_3d_body_dinov3_bf16.safetensors", display_name="SAM3D Body 模型"),
                io.Int.Input("max_people", default=16, min=1, max=64, display_name="最大人数"),
                io.Float.Input("detection_threshold", default=0.5, min=0.0, max=1.0, step=0.01, advanced=True, display_name="SAM3 检测阈值"),
                io.Float.Input("detector_threshold", default=0.5, step=0.01, advanced=True, display_name="人体检测阈值"),
                io.Int.Input("detect_interval", default=1, min=1, advanced=True, display_name="跟踪检测间隔（帧）"),
                io.Int.Input("body_batch_size", default=64, min=1, max=512, advanced=True, display_name="人体预测批量"),
                io.Int.Input("moge_batch_size", default=4, min=1, max=64, advanced=True, display_name="MoGe 批量"),
                io.Boolean.Input("hand_refinement", default=True, advanced=True, display_name="手部细化"),
                io.Int.Input("smoothing_window", default=9, min=1, max=51, advanced=True, display_name="姿态平滑窗口"),
                io.Float.Input("rmbg_sensitivity", default=0.95, min=0.0, max=1.0, step=0.01, advanced=True, display_name="抠背景灵敏度"),
                io.Int.Input("rmbg_resolution", default=768, min=256, max=2048, step=128, advanced=True, display_name="抠背景处理尺寸"),
            ],
            outputs=[io.Custom("CAPCUT_WORKFLOW").Output(display_name="工作流")],
        )

    @classmethod
    def execute(cls, **settings):
        return io.NodeOutput(settings)


class CapCutMotionTransferWorkflow(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        preview_models = ["none"] + folder_paths.get_filename_list("vae_approx")
        return io.Schema(
            node_id="CapCutMotionTransferWorkflow",
            display_name="CapCut MiniMax H3 动作迁移",
            category="CapCut",
            description="封装角色参考图、驱动视频和 Motion Repair LoRA 动作迁移工作流。连接主控台后选择素材，可选原流程的 GPT 看图与提示词编排。此节点只提供配置，不加载模型。",
            inputs=[
                io.String.Input("model_name", default="minimax\\minimax_h3_ref2va_pruned_fp8_scaled.safetensors", display_name="视频模型"),
                io.String.Input("clip_name", default="qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", display_name="文本编码器"),
                io.String.Input("video_vae", default="minimax\\minimax_h3_video_vae_fp16.safetensors", display_name="视频 VAE"),
                io.String.Input("audio_vae", default="minimax\\minimax_h3_audio_vae_fp32.safetensors", display_name="音频 VAE"),
                io.String.Input("motion_lora", default="minimax\\Motion_Repair_V2.safetensors", display_name="动作修复 LoRA"),
                io.Float.Input("motion_strength", default=0.35, min=-100.0, max=100.0, step=0.05, display_name="动作修复强度"),
                io.String.Input("turbo_lora", default="minimax\\minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors", display_name="加速 LoRA"),
                io.Float.Input("turbo_strength", default=1.0, min=-100.0, max=100.0, step=0.05, display_name="加速 LoRA 强度"),
                io.Int.Input("steps", default=8, min=1, max=1000, display_name="采样步数"),
                io.Float.Input("shift_video", default=12.0, min=0.01, max=100.0, advanced=True, display_name="视频 Shift"),
                io.Float.Input("shift_audio", default=3.0, min=0.01, max=100.0, advanced=True, display_name="音频 Shift"),
                io.Combo.Input("attention", options=["pytorch attention", "comfy kitchen attention"], default="comfy kitchen attention", advanced=True, display_name="Attention 后端"),
                io.Boolean.Input("sparse_attention", default=True, advanced=True, display_name="启用原流程稀疏注意力"),
                io.Float.Input("sparse_threshold", default=1.1, min=0.0, max=4.0, step=0.05, advanced=True, display_name="稀疏注意力阈值"),
                io.Int.Input("reference_longest_side", default=1536, min=32, step=32, advanced=True, display_name="参考图处理长边"),
                io.Combo.Input("tiny_vae", options=preview_models, default="taeh3.safetensors" if "taeh3.safetensors" in preview_models else "none", display_name="预览模型（Tiny VAE）"),
            ],
            outputs=[io.Custom("CAPCUT_WORKFLOW").Output(display_name="工作流")],
        )

    @classmethod
    def execute(cls, **settings):
        return io.NodeOutput(settings)


class CapCutMainConsole(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="CapCutMainConsole",
            display_name="CapCut 主控台",
            category="CapCut",
            description="打开本地剪辑工作台。导入素材、编辑时间线和保存工程无需运行队列。",
            inputs=[
                io.String.Input("project_name", default="未命名工程", display_name="工程名称"),
                io.Autogrow.Input(
                    "workflows",
                    template=io.Autogrow.TemplatePrefix(io.Custom("CAPCUT_WORKFLOW").Input("workflow"), prefix="workflow_", min=0, max=100),
                    optional=True,
                    tooltip="连接后续接入的生图、生视频或视频处理模块。",
                ),
            ],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, project_name, workflows=None):
        return io.NodeOutput(ui={"capcut": [{"name": project_name, "workflows": list((workflows or {}).values())}]})
