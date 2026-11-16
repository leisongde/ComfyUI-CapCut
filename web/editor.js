import { openStudio } from "./studio.js";

const providers = new Map();
export function registerCapCutWorkflow(nodeType, provider) {
    if (typeof provider.run !== "function") throw new Error("工作流适配器需要提供 run 方法");
    providers.set(nodeType, provider);
    return () => providers.delete(nodeType);
}
let opening;
export function openEditor(node) {
    return opening ??= openStudio(node, providers).finally(() => { opening = null; });
}
