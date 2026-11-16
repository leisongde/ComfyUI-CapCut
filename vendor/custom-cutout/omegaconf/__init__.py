"""Small typing compatibility shim for Cutie's inference-only runtime.

The bundled Cutie modules use DictConfig only in type annotations. The desktop
runner builds its resolved configuration directly, so Hydra and OmegaConf are
not needed at runtime.
"""

from typing import Any

DictConfig = Any
