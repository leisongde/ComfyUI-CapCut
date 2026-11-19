import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";

const CHANNEL = "raccoon-editing-v1";
let active;

async function responseJson(response) {
    if (!response.ok) throw new Error(await response.text());
    return response.json();
}

function download(url, name) {
    const anchor = document.createElement("a");
    anchor.href = api.apiURL(url) + "?" + new URLSearchParams({ user: api.user || "default" });
    anchor.download = name;
    anchor.click();
}

export async function openStudio(node, providers) {
    if (active) return active.focus();
    node.properties ??= {};
    const metadata = await responseJson(await api.fetchApi("/capcut/studio/open", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: node.properties.capcut_project_id, name: node.widgets?.find(item => item.name === "project_name")?.value }),
    }));
    const session = typeof crypto.randomUUID === "function" ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, "0")).join("");
    const graphCanvas = app.canvas;
    const graphWasPaused = graphCanvas.pause_rendering;
    const iframe = document.createElement("iframe");
    iframe.className = "cc-studio";
    iframe.title = "大众剪辑";
    iframe.allow = "fullscreen";
    iframe.src = api.apiURL("/capcut/editor/index.html") + "#" + new URLSearchParams({ project: metadata.id, session, user: api.user ?? "default" });
    const connections = () => (node.inputs ?? []).filter(input => input.link != null && input.type === "CAPCUT_WORKFLOW").map(input => {
        const link = node.graph.links.get(input.link);
        const source = link && node.graph.getNodeById(link.origin_id);
        return source && providers.has(source.type) ? { node: source, provider: providers.get(source.type) } : null;
    }).filter(Boolean);
    let trackingSession;
    const updateNode = value => {
        node.properties.capcut_project_id = value.id;
        const widget = node.widgets?.find(item => item.name === "project_name");
        if (widget) widget.value = value.name;
        node.graph?.setDirtyCanvas(true, true);
        node.graph?.change();
    };
    updateNode(metadata);
    const historyFiles = async () => {
        const history = await responseJson(await api.fetchApi("/history?max_items=30"));
        const files = new Map();
        const visit = value => {
            if (!value || typeof value !== "object") return;
            if (typeof value.filename === "string" && /\.(mp4|mov|webm|mkv|png|jpe?g|webp|gif|wav|mp3|flac|ogg|m4a)$/i.test(value.filename)) {
                const file = { filename: value.filename, subfolder: value.subfolder ?? "", type: value.type ?? "output" };
                files.set(JSON.stringify(file), file);
            } else for (const child of Object.values(value)) visit(child);
        };
        for (const entry of Object.values(history).reverse()) visit(entry.outputs);
        return [...files.values()];
    };
    const operate = async (operation, payload = {}, onProgress) => {
        if (operation === "capcut:workflows") return Promise.all(connections().map(async ({ node, provider }) => ({ id: String(node.id), nodeType: node.type, label: provider.label ?? node.title, fields: provider.getFields ? await provider.getFields() : provider.fields ?? [] })));
        if (operation === "capcut:workflow-models") {
            const connection = connections().find(item => String(item.node.id) === payload.id);
            if (!connection?.provider.loadModels) throw new Error("请连接 MiniMax H3 生视频模块");
            return connection.provider.loadModels(payload.key);
        }
        if (operation === "capcut:run-workflow") {
            const connection = connections().find(item => String(item.node.id) === payload.id);
            if (!connection) throw new Error("工作流已断开，请刷新连接");
            const settings = payload.settings;
            const usesMedia = connection.provider.usesMedia?.(payload.values) ?? true;
            const mediaFields = usesMedia ? (connection.provider.fields ?? []).filter(field => field.type === "media") : [];
            if (mediaFields.length) {
                const items = await operate("media:list", { projectId: payload.projectId });
                payload.values = { ...payload.values };
                for (const field of mediaFields) {
                    const ids = field.multiple ? payload.values[field.name] ?? [] : [payload.values[field.name]].filter(Boolean);
                    payload.values[field.name] = ids.map(id => {
                        const stored = items.find(item => item.id === id);
                        if (!stored || stored.type !== field.kind) throw new Error(`${field.label}素材不存在，请重新选择`);
                        return { filename: stored.fileName, subfolder: `CapCut/${api.user || "default"}/${payload.projectId}`, type: "input" };
                    });
                }
            }
            if (usesMedia && payload.asset) {
                const items = await operate("media:list", { projectId: payload.projectId });
                const stored = items.find(item => item.id === payload.asset.id);
                if (!stored) throw new Error("选中素材尚未保存，请保存后重试");
                payload.asset.file = stored.fileName;
                payload.asset.subfolder = `CapCut/${api.user || "default"}/${payload.projectId}`;
                payload.asset.type = "input";
            }
            const getConsolePrompt = async () => ({ consoleId: String(node.id), output: (await app.graphToPrompt(node.graph)).output });
            const result = await connection.provider.run({ node: connection.node, getConsolePrompt, values: payload.values, settings: { width: settings.canvasSize.width, height: settings.canvasSize.height, fps: settings.fps }, clip: usesMedia ? payload.clip ?? null : null, asset: usesMedia ? payload.asset ?? null : null, onProgress });
            return Array.isArray(result) ? result : [result];
        }
        if (operation === "capcut:results") return historyFiles();
        if (operation === "capcut:import-result") {
            const file = payload.file;
            if (!file || typeof file.filename !== "string") throw new Error("生成结果文件无效");
            const response = await api.fetchApi("/view?" + new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? "", type: file.type ?? "output" }));
            if (!response.ok) throw new Error("无法读取生成结果");
            return { name: file.filename, bytes: new Uint8Array(await response.arrayBuffer()), mimeType: response.headers.get("Content-Type") ?? "" };
        }
        if (operation === "library:list") {
            const files = await historyFiles();
            return files.map((file, index) => ({ id: String(index), name: file.filename, type: /\.(png|jpe?g|webp|gif)$/i.test(file.filename) ? "image" : /\.(wav|mp3|flac|ogg|m4a)$/i.test(file.filename) ? "audio" : "video", previewUrl: api.apiURL("/view?" + new URLSearchParams(file)), size: 0 }));
        }
        const data = { ...payload };
        let options;
        if (data.bytes instanceof Uint8Array) {
            const bytes = data.bytes;
            delete data.bytes;
            const body = new FormData();
            const mask = data.mask;
            if (mask instanceof Uint8Array) delete data.mask;
            body.append("payload", JSON.stringify(data));
            body.append("bytes", new Blob([bytes]), "resource.bin");
            if (mask instanceof Uint8Array) body.append("mask", new Blob([mask]), "mask.bin");
            options = { method: "POST", body };
        } else options = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
        const response = await api.fetchApi(`/capcut/studio/op/${encodeURIComponent(operation)}`, options);
        if (!response.ok) throw new Error(await response.text());
        if (operation === "media:fetch-url" || operation === "fonts:fetch-url") return { bytes: new Uint8Array(await response.arrayBuffer()), mimeType: response.headers.get("Content-Type") };
        if (operation === "custom-cutout:track:step") return {
            bytes: new Uint8Array(await response.arrayBuffer()),
            width: Number(response.headers.get("X-CapCut-Width")),
            height: Number(response.headers.get("X-CapCut-Height")),
            elapsedSeconds: Number(response.headers.get("X-CapCut-Elapsed")),
        };
        const result = await response.json();
        if (operation === "custom-cutout:track:start") trackingSession = result.sessionId;
        if (operation === "custom-cutout:track:end" && trackingSession === payload.sessionId) trackingSession = null;
        if (result?.fileUrl) {
            const file = await api.fetchApi(result.fileUrl);
            if (!file.ok) throw new Error("缓存素材读取失败");
            return { metadata: result.metadata, bytes: new Uint8Array(await file.arrayBuffer()) };
        }
        if (result?.downloadUrl) download(result.downloadUrl, result.name);
        return result;
    };
    const onMessage = async event => {
        const message = event.data;
        if (event.origin !== location.origin || event.source !== iframe.contentWindow || message?.channel !== CHANNEL || message.session !== session) return;
        if (message.type === "exit") {
            window.removeEventListener("message", onMessage);
            iframe.remove();
            active = null;
            if (trackingSession) void operate("custom-cutout:track:end", { sessionId: trackingSession }).catch(() => {});
            graphCanvas.pause_rendering = graphWasPaused;
            graphCanvas.setDirty(true, true);
            return;
        }
        if (message.type === "project") { updateNode(message.payload); return; }
        if (message.type !== "request") return;
        let result, error;
        try { result = await operate(message.operation, message.payload, payload => {
            if (iframe.isConnected) iframe.contentWindow.postMessage({ channel: CHANNEL, session, type: "progress", id: message.id, payload }, location.origin);
        }); } catch (failure) { error = failure.message; }
        if (!iframe.isConnected) {
            if (trackingSession) void operate("custom-cutout:track:end", { sessionId: trackingSession }).catch(() => {});
            return;
        }
        const transfer = result?.bytes instanceof Uint8Array ? [result.bytes.buffer] : [];
        iframe.contentWindow.postMessage({ channel: CHANNEL, session, type: "response", id: message.id, result, error }, location.origin, transfer);
    };
    window.addEventListener("message", onMessage);
    active = iframe;
    document.body.append(iframe);
    graphCanvas.pause_rendering = true;
    iframe.focus();
}
