from comfy_api.latest import ComfyExtension, io

from .api import register_routes
from .nodes import CapCutMainConsole, CapCutMiniMaxH3Workflow, CapCutMiniMaxH3CharacterSwapWorkflow, CapCutBodyRenderWorkflow, CapCutMotionTransferWorkflow, CapCutRelayVSRWorkflow
from .sampling import CapCutRefineSampler, CapCutSelfLiftSampler
from .studio import register_studio_routes

WEB_DIRECTORY = "./web"


class CapCutExtension(ComfyExtension):
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [CapCutMainConsole, CapCutMiniMaxH3Workflow, CapCutMiniMaxH3CharacterSwapWorkflow, CapCutBodyRenderWorkflow, CapCutMotionTransferWorkflow, CapCutRelayVSRWorkflow, CapCutSelfLiftSampler, CapCutRefineSampler]


async def comfy_entrypoint():
    register_routes()
    register_studio_routes()
    return CapCutExtension()
