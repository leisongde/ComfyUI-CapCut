Cutie tracking inference modules and `vos_runner.py` copied from the desktop
editor's `resources/inference-runners/custom-cutout`. Upstream:
https://github.com/hkchengrex/Cutie (MIT, see CUTIE-LICENSE.txt).

Only the modules used by tracking are included. The desktop's annotation-only
OmegaConf shim avoids requiring Hydra/OmegaConf. The worker adds its directory
to Python's import path for ComfyUI portable Python, uses the existing disabled
gradient setting, and selects CPU when CUDA has less than 2 GiB free or ComfyUI
was launched with `--cpu`. Tracking state lives only for the worker session.
Weights are downloaded by the plugin on the first tracking request.

Mask serialization uses an out-of-place clamp because the returned probability
tensor shares storage with Cutie's temporal state. Scaling that view in place
corrupts subsequent frames.
