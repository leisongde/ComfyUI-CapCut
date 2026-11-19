import { app } from "../../scripts/app.js";
import { openEditor } from "./editor.js";
import "./minimax.js";
import "./character-swap.js";
import "./body-render.js";
import "./motion-transfer.js";
import "./relay-vsr.js";

const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = new URL("./editor.css", import.meta.url).href;
document.head.append(stylesheet);

app.registerExtension({
    name: "CapCut.MainConsole",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "CapCutMainConsole") return;
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            this.color = "#183a39";
            this.bgcolor = "#19282b";
            const button = this.addWidget("button", "打开剪辑工作台", null, () => openEditor(this).catch(error => {
                app.extensionManager.toast.add({ severity: "error", summary: "剪辑台打开失败", detail: error.message });
            }));
            button.options.serialize = false;
            this.setSize([350, Math.max(this.size[1], 145)]);
            return result;
        };
    },
});
