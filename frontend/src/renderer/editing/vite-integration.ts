import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import type { Plugin } from 'vite'

function adaptTimelineElementResize(code: string): string {
  let adapted = code.replace(/\r\n/g, '\n')
  const importAnchor = 'import { useTimelineStore } from "@/stores/timeline-store";'
  const stateAnchor = '\tinitialPlaybackRate: number;'
  const resizeStartAnchor = '\t\tsetResizing({'
  const resizeStartPropertyAnchor = '\t\t\tinitialPlaybackRate: rate,\n\t\t});'
  const updateStart = adapted.indexOf('\tconst updateTrimFromMouseMove = useCallback(')
  const resizeEndStart = adapted.indexOf('\tconst handleResizeEnd = useCallback(() => {')
  const effectStart = adapted.indexOf('\n\tuseEffect(() => {', resizeEndStart)

  if (
    !adapted.includes(importAnchor) ||
    !adapted.includes(stateAnchor) ||
    !adapted.includes(resizeStartAnchor) ||
    !adapted.includes(resizeStartPropertyAnchor) ||
    updateStart < 0 ||
    resizeEndStart < 0 ||
    effectStart < 0
  ) {
    throw new Error('Cutia 时间线波纹拉伸适配需要检查上游版本')
  }

  adapted = adapted
    .replace(
      importAnchor,
      `${importAnchor}\nimport {\n\tcaptureFollowingElements,\n\tcreateRippleUpdates,\n\ttype RippleElementSnapshot,\n} from "@/lib/timeline/ripple-utils";`
    )
    .replace(stateAnchor, `${stateAnchor}\n\trippleElements: RippleElementSnapshot[];`)
    .replace(
      resizeStartAnchor,
      `\t\tconst rippleElements =\n\t\t\tside === "right" && track.type === "video"\n\t\t\t\t? captureFollowingElements({ track, elementId: element.id })\n\t\t\t\t: [];\n\n${resizeStartAnchor}`
    )
    .replace(
      resizeStartPropertyAnchor,
      `\t\t\tinitialPlaybackRate: rate,\n\t\t\trippleElements,\n\t\t});`
    )

  const movedUpdateStart = adapted.indexOf('\tconst updateTrimFromMouseMove = useCallback(')
  const movedResizeEndStart = adapted.indexOf('\tconst handleResizeEnd = useCallback(() => {')
  let updateBlock = adapted.slice(movedUpdateStart, movedResizeEndStart)
  const callbackClose = updateBlock.lastIndexOf('\n\t}, [')
  if (callbackClose < 0) {
    throw new Error('Cutia 时间线波纹拉伸预览适配需要检查上游版本')
  }
  updateBlock =
    updateBlock.slice(0, callbackClose) +
    `\n\t\tif (resizing.side === "right" && resizing.rippleElements.length > 0) {\n\t\t\tconst duration = currentDurationRef.current;\n\t\t\teditor.timeline.updateElements({\n\t\t\t\tupdates: createRippleUpdates({\n\t\t\t\t\ttrackId: track.id,\n\t\t\t\t\telements: resizing.rippleElements,\n\t\t\t\t\ttimeDelta: duration - resizing.initialDuration,\n\t\t\t\t\tminimumStartTime: resizing.initialStartTime + duration,\n\t\t\t\t}),\n\t\t\t\tpushHistory: false,\n\t\t\t});\n\t\t}\n` +
    updateBlock.slice(callbackClose)
  updateBlock = updateBlock.replace(
    'element.id, onSnapPointChange, canExtendElementDuration',
    'element.id, track.id, onSnapPointChange, canExtendElementDuration'
  )
  adapted = adapted.slice(0, movedUpdateStart) + updateBlock + adapted.slice(movedResizeEndStart)

  const finalResizeEndStart = adapted.indexOf('\tconst handleResizeEnd = useCallback(() => {')
  const finalEffectStart = adapted.indexOf('\n\tuseEffect(() => {', finalResizeEndStart)
  const resizeEndBlock = `\tconst handleResizeEnd = useCallback(() => {\n\t\tif (!resizing) return;\n\n\t\tconst finalTrimStart = currentTrimStartRef.current;\n\t\tconst finalTrimEnd = currentTrimEndRef.current;\n\t\tconst finalStartTime = currentStartTimeRef.current;\n\t\tconst finalDuration = currentDurationRef.current;\n\t\tconst elementChanged =\n\t\t\tfinalTrimStart !== resizing.initialTrimStart ||\n\t\t\tfinalTrimEnd !== resizing.initialTrimEnd ||\n\t\t\tfinalStartTime !== resizing.initialStartTime ||\n\t\t\tfinalDuration !== resizing.initialDuration;\n\t\tconst rippleUpdates =\n\t\t\tresizing.side === "right"\n\t\t\t\t? createRippleUpdates({\n\t\t\t\t\t\ttrackId: track.id,\n\t\t\t\t\t\telements: resizing.rippleElements,\n\t\t\t\t\t\ttimeDelta: finalDuration - resizing.initialDuration,\n\t\t\t\t\t\tminimumStartTime: resizing.initialStartTime + finalDuration,\n\t\t\t\t\t})\n\t\t\t\t: [];\n\n\t\tif (resizing.rippleElements.length > 0) {\n\t\t\teditor.timeline.updateElements({\n\t\t\t\tupdates: createRippleUpdates({\n\t\t\t\t\ttrackId: track.id,\n\t\t\t\t\telements: resizing.rippleElements,\n\t\t\t\t\ttimeDelta: 0,\n\t\t\t\t}),\n\t\t\t\tpushHistory: false,\n\t\t\t});\n\t\t}\n\n\t\tif (elementChanged) {\n\t\t\teditor.timeline.updateElements({\n\t\t\t\tupdates: [\n\t\t\t\t\t{\n\t\t\t\t\t\ttrackId: track.id,\n\t\t\t\t\t\telementId: element.id,\n\t\t\t\t\t\tupdates: {\n\t\t\t\t\t\t\ttrimStart: finalTrimStart,\n\t\t\t\t\t\t\ttrimEnd: finalTrimEnd,\n\t\t\t\t\t\t\tstartTime: finalStartTime,\n\t\t\t\t\t\t\tduration: finalDuration,\n\t\t\t\t\t\t},\n\t\t\t\t\t},\n\t\t\t\t\t...rippleUpdates,\n\t\t\t\t],\n\t\t\t});\n\t\t}\n\n\t\tsetResizing(null);\n\t\tonResizeStateChange?.({ isResizing: false });\n\t\tonSnapPointChange?.(null);\n\t}, [\n\t\tresizing,\n\t\teditor.timeline,\n\t\telement.id,\n\t\ttrack.id,\n\t\tonResizeStateChange,\n\t\tonSnapPointChange,\n\t]);\n`
  adapted = adapted.slice(0, finalResizeEndStart) + resizeEndBlock + adapted.slice(finalEffectStart)

  return adapted
}

export function cutiaDesktopIntegration(root: string): {
  aliases: Record<string, string>
  plugin: Plugin
} {
  const native = resolve(root, 'src/renderer/editing')
  const upstream = resolve(root, 'vendor/cutia/apps/web/src')
  const longpipe = resolve(root, 'vendor/longpipe/src')
  const aliases = {
    '@/services/video-cache/service': resolve(native, 'adapters/video-cache.ts'),
    '@/services/storage/service': resolve(native, 'adapters/storage.ts'),
    '@/services/storage/migrations': resolve(native, 'adapters/migrations.ts'),
    '@/stores/agent-store': resolve(native, 'adapters/agent-store.ts'),
    '@/lib/tts/service': resolve(native, 'adapters/speech.ts'),
    '@/lib/media/url-import': resolve(native, 'adapters/url-import.ts'),
    '@/hooks/use-container-size': resolve(native, 'adapters/use-container-size.ts'),
    '@/hooks/use-fullscreen': resolve(native, 'adapters/use-fullscreen.ts'),
    '@/components/ui/font-picker': resolve(native, 'FontPicker.tsx'),
    '@i18next-toolkit/nextjs-approuter': resolve(native, 'adapters/i18n.ts'),
    'next/image': resolve(native, 'adapters/image.tsx'),
    '@cutia-desktop/shader-transition': resolve(native, 'adapters/shader-transition.ts'),
    '@cutia-desktop/text-template-animation': resolve(native, 'text-template-animation.ts'),
    '@cutia-desktop/clip-effect-node': resolve(native, 'adapters/clip-effect-node.ts'),
    '@cutia-desktop/clip-filter-node': resolve(native, 'adapters/clip-filter-node.ts'),
    '@cutia-desktop/color-adjustment-node': resolve(native, 'adapters/color-adjustment-node.ts'),
    '@cutia-desktop/chroma-key-node': resolve(native, 'adapters/chroma-key-node.ts'),
    '@cutia-desktop/smart-cutout-node': resolve(native, 'adapters/smart-cutout-node.ts'),
    '@cutia-desktop/custom-cutout-node': resolve(native, 'adapters/custom-cutout-node.ts'),
    '@cutia-desktop/clip-mask-node': resolve(native, 'adapters/clip-mask-node.ts'),
    '@cutia-desktop/beauty-node': resolve(native, 'adapters/beauty-node.ts'),
    '@cutia-desktop/clip-effects-properties': resolve(native, 'ClipEffectsProperties.tsx'),
    '@cutia-desktop/clip-filter-properties': resolve(native, 'ClipFilterProperties.tsx'),
    '@cutia-desktop/cutout-properties': resolve(native, 'CutoutProperties.tsx'),
    '@cutia-desktop/mask-properties': resolve(native, 'MaskProperties.tsx'),
    '@cutia-desktop/beauty-properties': resolve(native, 'BeautyProperties.tsx'),
    '@cutia-desktop/timeline-effect-drop': resolve(native, 'adapters/timeline-effect-drop.ts'),
    '@cutia-desktop/adjustment-layer': resolve(native, 'adjustment-layer.ts'),
    '@cutia-desktop/color-adjustment': resolve(native, 'color-adjustment.ts'),
    '@cutia-desktop/adjustment-layer-node': resolve(native, 'adapters/adjustment-layer-node.ts'),
    '@cutia-desktop/adjustment-properties': resolve(native, 'AdjustmentProperties.tsx'),
    '@cutia-desktop/visual-keyframes': resolve(native, 'visual-keyframes.ts'),
    '@cutia-desktop/clip-crop': resolve(native, 'clip-crop.ts'),
    '@cutia-desktop/clip-crop-dialog': resolve(native, 'ClipCropDialog.tsx'),
    '@cutia-desktop/playback-time': resolve(native, 'playback-time.ts'),
    '@cutia-desktop/project-canvas-size-control': resolve(native, 'ProjectCanvasSizeControl.tsx'),
    '@cutia-desktop/scene-split-button': resolve(native, 'scene-split/SceneSplitButton.tsx'),
    '@cutia-desktop/preview-duration': resolve(native, 'preview-duration.ts'),
    '@cutia-desktop/director-preview-overlay': resolve(native, 'DirectorPreviewOverlay.tsx'),
    '@cutia-desktop/director-generation-placeholder': resolve(
      native,
      'DirectorGenerationPlaceholder.tsx'
    ),
    '@cutia-desktop/director-generation-placeholders': resolve(
      native,
      'director-generation-placeholders.ts'
    ),
    '@cutia-desktop/timeline-sync': resolve(native, 'timeline-sync.ts'),
    '@cutia-desktop/object-lock': resolve(native, 'object-lock.ts'),
    '@cutia-desktop/visual-keyframe-control': resolve(native, 'VisualKeyframeControl.tsx'),
    '@cutia-desktop/video-properties-categories': resolve(native, 'VideoPropertiesCategories.tsx'),
    '@cutia-desktop/audio-properties-categories': resolve(native, 'AudioPropertiesCategories.tsx'),
    '@cutia-desktop/tracking-properties-categories': resolve(
      native,
      'TrackingPropertiesCategories.tsx'
    ),
    '@cutia-desktop/audio-envelope': resolve(native, 'audio-envelope.ts'),
    '@cutia-desktop/audio-keyframes': resolve(native, 'audio-keyframes.ts'),
    '@cutia-desktop/timeline-track-edge-drop': resolve(
      native,
      'adapters/timeline-track-edge-drop.ts'
    ),
    '@cutia-desktop/timeline-track-cleanup': resolve(native, 'adapters/timeline-track-cleanup.ts'),
    '@cutia-desktop/timeline-start-time': resolve(native, 'adapters/timeline-start-time.ts'),
    '@cutia-desktop/sticker-runtime': resolve(native, 'stickers/runtime.ts'),
    '@cutia-desktop/sticker-track-drop': resolve(native, 'adapters/sticker-track-drop.ts'),
    '@cutia-desktop/freeze-frame': resolve(native, 'freeze-frame.ts'),
    '@cutia-desktop/image-ai': resolve(native, 'image-ai.ts'),
    '@cutia-desktop/video-ai': resolve(native, 'video-ai.ts'),
    '@cutia/ui/icons': resolve(root, 'vendor/cutia/packages/ui/src/icons/index.tsx'),
    '~': longpipe,
    '@cutia': upstream,
    '@': upstream
  }
  const previewDurationConsumers = new Set([
    'core/managers/playback-manager.ts',
    'hooks/timeline/use-timeline-playhead.ts',
    'hooks/actions/use-editor-actions.ts',
    'components/editor/panels/timeline/index.tsx',
    'components/editor/panels/timeline/timeline-playhead.tsx',
    'components/editor/panels/timeline/timeline-ruler.tsx',
    'components/editor/panels/timeline/timeline-track.tsx',
    'components/editor/panels/timeline/bookmarks.tsx'
  ])
  return {
    aliases,
    plugin: {
      name: 'cutia-desktop-integration',
      enforce: 'pre',
      resolveId(source, importer) {
        if (importer && source.startsWith('.')) {
          const target = resolve(dirname(importer.split('?')[0]), source)
            .replace(/\\/g, '/')
            .replace(/\.ts$/, '')
          if (target === `${upstream.replace(/\\/g, '/')}/core/managers/save-manager`)
            return resolve(native, 'adapters/save-manager.ts')
          if (target === `${upstream.replace(/\\/g, '/')}/core/managers/audio-manager`)
            return resolve(native, 'adapters/audio-manager.ts')
        }
        return null
      },
      load(id) {
        const file = id.split('?')[0]
        if (
          file.replace(/\\/g, '/').startsWith(longpipe.replace(/\\/g, '/')) &&
          /\.(?:wgsl|glsl)$/.test(file)
        ) {
          return `export default ${JSON.stringify(readFileSync(file, 'utf8'))}`
        }
        return null
      },
      transform(code, id) {
        const file = id.split('?')[0].replace(/\\/g, '/')
        const prefix = upstream.replace(/\\/g, '/')
        const usesPreviewDuration =
          file.startsWith(`${prefix}/`) &&
          previewDurationConsumers.has(file.slice(prefix.length + 1))
        if (usesPreviewDuration) {
          const durationAccess =
            /\b(this\.)?editor\.timeline\.getTotalDuration\(\)|\btimeline\.getTotalDuration\(\)/g
          if (!durationAccess.test(code)) {
            throw new Error('Cutia AI 规划预演时长适配需要检查上游版本')
          }
          code = code
            .replace(
              durationAccess,
              (_match, receiver) => `getPreviewDuration(${receiver ? 'this.editor' : 'editor'})`
            )
            .replace(
              /^import /m,
              'import { getPreviewDuration } from "@cutia-desktop/preview-duration";\nimport '
            )
        }
        // Keep the upstream clone intact. These small integration fixes apply only to compiled desktop code.
        if (file === `${prefix}/components/editor/panels/timeline/timeline-track.tsx`) {
          const anchor = '\t\t\t\t\t\t\treturn ('
          const normalized = code.replace(/\r\n/g, '\n')
          if (!normalized.includes(anchor)) throw new Error('Cutia 生成占位适配需要检查上游版本')
          return normalized
            .replace(
              /^import /m,
              'import { DirectorGenerationPlaceholder } from "@cutia-desktop/director-generation-placeholder";\nimport { isDirectorGenerationPlaceholder } from "@cutia-desktop/director-generation-placeholders";\nimport '
            )
            .replace(
              anchor,
              `\t\t\t\t\t\t\tif (isDirectorGenerationPlaceholder(element)) return (
\t\t\t\t\t\t\t\t<DirectorGenerationPlaceholder key={element.id} element={element} trackId={track.id} zoomLevel={zoomLevel} />
\t\t\t\t\t\t\t);
${anchor}`
            )
        }
        if (file === `${prefix}/core/managers/playback-manager.ts`) {
          const frameNotifyAnchor = `\t\t\tthis.currentTime = newTime;
\t\t\tthis.notify();

\t\t\twindow.dispatchEvent(`
          const normalized = code.replace(/\r\n/g, '\n')
          if (!normalized.includes(frameNotifyAnchor)) {
            throw new Error('Cutia 播放时间局部刷新适配需要检查上游版本')
          }
          return normalized.replace(
            frameNotifyAnchor,
            `\t\t\tthis.currentTime = newTime;

\t\t\twindow.dispatchEvent(`
          )
        }
        if (file === `${prefix}/components/editor/panels/timeline/timeline-playhead.tsx`) {
          const normalized = code.replace(/\r\n/g, '\n')
          const importAnchor = 'import { useEditor } from "@/hooks/use-editor";'
          const scrollEffect = `\tuseEffect(() => {
\t\tconst scrollContainer = tracksScrollRef.current;
\t\tconst playheadElement = playheadRef.current;
\t\tif (!scrollContainer || !playheadElement) return;

\t\tconst syncScrollOffset = () => {
\t\t\tplayheadElement.style.transform = \`translateX(\${-scrollContainer.scrollLeft}px)\`;
\t\t};

\t\tsyncScrollOffset();
\t\tscrollContainer.addEventListener("scroll", syncScrollOffset, {
\t\t\tpassive: true,
\t\t});
\t\treturn () =>
\t\t\tscrollContainer.removeEventListener("scroll", syncScrollOffset);
\t}, [tracksScrollRef, playheadRef]);`
          const positionAnchor = `\tconst timelinePosition =
\t\tplayheadPosition * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel;
`
          if (
            !normalized.includes(importAnchor) ||
            !normalized.includes(scrollEffect) ||
            !normalized.includes(positionAnchor) ||
            !normalized.includes('left: `${timelinePosition}px`,')
          ) {
            throw new Error('Cutia 播放头局部刷新适配需要检查上游版本')
          }
          return normalized
            .replace(
              importAnchor,
              `${importAnchor}\nimport { bindTimelinePlayhead } from "@cutia-desktop/playback-time";`
            )
            .replace(
              scrollEffect,
              `\tuseEffect(() => {
\t\tconst rulerViewport = rulerScrollRef.current;
\t\tconst tracksViewport = tracksScrollRef.current;
\t\tconst playheadElement = playheadRef.current;
\t\tif (!rulerViewport || !tracksViewport || !playheadElement) return;

\t\treturn bindTimelinePlayhead({
\t\t\telement: playheadElement,
\t\t\tplayback: editor.playback,
\t\t\tzoomLevel,
\t\t\tpixelsPerSecond: TIMELINE_CONSTANTS.PIXELS_PER_SECOND,
\t\t\trulerViewport,
\t\t\ttracksViewport,
\t\t});
\t}, [editor.playback, zoomLevel, rulerScrollRef, tracksScrollRef, playheadRef]);`
            )
            .replace(positionAnchor, '')
            .replace(
              'Math.min(duration, playheadPosition + direction * step)',
              'Math.min(duration, editor.playback.getCurrentTime() + direction * step)'
            )
            .replace('left: `${timelinePosition}px`,', 'left: 0,')
        }
        if (file === `${prefix}/services/renderer/canvas-renderer.ts`) {
          const normalized = code.replace(/\r\n/g, '\n')
          const paramsAnchor = '\timageSmoothingQuality?: ImageSmoothingQuality;'
          const propertyAnchor = '\tfps: number;'
          const constructorAnchor =
            '\tconstructor({ width, height, fps, imageSmoothingQuality = "low" }: CanvasRendererParams) {'
          const assignmentAnchor = '\t\tthis.fps = fps;'
          const constructorCanvasAnchor = `\t\ttry {
\t\t\tthis.canvas = new OffscreenCanvas(width, height);
\t\t} catch {
\t\t\tthis.canvas = document.createElement("canvas");
\t\t\tthis.canvas.width = width;
\t\t\tthis.canvas.height = height;
\t\t}`
          const resizeCanvasAnchor = `\t\tif (this.canvas instanceof OffscreenCanvas) {
\t\t\tthis.canvas = new OffscreenCanvas(width, height);
\t\t} else {
\t\t\tthis.canvas.width = width;
\t\t\tthis.canvas.height = height;
\t\t}`
          const smoothingAnchor = `\tprivate applySmoothing() {
\t\tthis.context.imageSmoothingEnabled = true;
\t\tthis.context.imageSmoothingQuality = this.smoothingQuality;
\t}`
          const clearAnchor = `\tprivate clear() {
\t\tthis.context.fillStyle = "black";
\t\tthis.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
\t}`
          if (
            !normalized.includes(paramsAnchor) ||
            !normalized.includes(propertyAnchor) ||
            !normalized.includes(constructorAnchor) ||
            !normalized.includes(assignmentAnchor) ||
            !normalized.includes(constructorCanvasAnchor) ||
            !normalized.includes(resizeCanvasAnchor) ||
            !normalized.includes(smoothingAnchor) ||
            !normalized.includes(clearAnchor)
          ) {
            throw new Error('Cutia 倒放预览解码尺寸适配需要检查上游版本')
          }
          return normalized
            .replace(
              paramsAnchor,
              `${paramsAnchor}\n\tvideoDecodeMaxDimension?: number;\n\tmaxBackingDimension?: number;`
            )
            .replace(
              propertyAnchor,
              `${propertyAnchor}\n\tvideoDecodeMaxDimension?: number;\n\tmaxBackingDimension?: number;`
            )
            .replace(
              constructorAnchor,
              '\tconstructor({ width, height, fps, imageSmoothingQuality = "low", videoDecodeMaxDimension, maxBackingDimension }: CanvasRendererParams) {'
            )
            .replace(
              assignmentAnchor,
              `${assignmentAnchor}\n\t\tthis.videoDecodeMaxDimension = videoDecodeMaxDimension;\n\t\tthis.maxBackingDimension = maxBackingDimension;`
            )
            .replace(
              constructorCanvasAnchor,
              `\t\tconst backingSize = this.getBackingSize({ width, height });
\t\ttry {
\t\t\tthis.canvas = new OffscreenCanvas(backingSize.width, backingSize.height);
\t\t} catch {
\t\t\tthis.canvas = document.createElement("canvas");
\t\t\tthis.canvas.width = backingSize.width;
\t\t\tthis.canvas.height = backingSize.height;
\t\t}`
            )
            .replace(
              resizeCanvasAnchor,
              `\t\tconst backingSize = this.getBackingSize({ width, height });
\t\tif (this.canvas instanceof OffscreenCanvas) {
\t\t\tthis.canvas = new OffscreenCanvas(backingSize.width, backingSize.height);
\t\t} else {
\t\t\tthis.canvas.width = backingSize.width;
\t\t\tthis.canvas.height = backingSize.height;
\t\t}`
            )
            .replace(
              smoothingAnchor,
              `\tprivate getBackingSize({ width, height }: { width: number; height: number }) {
\t\tconst maximum = this.maxBackingDimension;
\t\tif (!maximum || Math.max(width, height) <= maximum) {
\t\t\treturn { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
\t\t}
\t\tconst scale = maximum / Math.max(width, height);
\t\treturn {
\t\t\twidth: Math.max(1, Math.round(width * scale)),
\t\t\theight: Math.max(1, Math.round(height * scale)),
\t\t};
\t}

\tprivate applySmoothing() {
\t\tthis.context.imageSmoothingEnabled = true;
\t\tthis.context.imageSmoothingQuality = this.smoothingQuality;
\t\tthis.context.setTransform(
\t\t\tthis.canvas.width / Math.max(1, this.width),
\t\t\t0,
\t\t\t0,
\t\t\tthis.canvas.height / Math.max(1, this.height),
\t\t\t0,
\t\t\t0,
\t\t);
\t}`
            )
            .replace(
              clearAnchor,
              `\tprivate clear() {
\t\tthis.context.save();
\t\tthis.context.setTransform(1, 0, 0, 1, 0, 0);
\t\tthis.context.fillStyle = "black";
\t\tthis.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
\t\tthis.context.restore();
\t}`
            )
        }
        if (file === `${prefix}/components/ui/dropdown-menu.tsx`) {
          const normalized = code.replace(/\r\n/g, '\n')
          const propsAnchor = `\tReact.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>\n>`
          const signatureAnchor = '({ className, sideOffset = 4, ...props }, ref) => ('
          const portalAnchor = '<DropdownMenuPrimitive.Portal>'
          if (
            !normalized.includes(propsAnchor) ||
            !normalized.includes(signatureAnchor) ||
            !normalized.includes(portalAnchor)
          ) {
            throw new Error('Cutia 下拉菜单跨窗口适配需要检查上游版本')
          }
          return normalized
            .replace(
              propsAnchor,
              `\tReact.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> & {\n\t\tcontainer?: HTMLElement | null;\n\t}\n>`
            )
            .replace(
              signatureAnchor,
              '({ className, sideOffset = 4, container, ...props }, ref) => ('
            )
            .replace(portalAnchor, '<DropdownMenuPrimitive.Portal container={container}>')
        }
        if (file === `${prefix}/components/editor/panels/preview/index.tsx`) {
          const normalized = code.replace(/\r\n/g, '\n')
          const editorImportAnchor = 'import { useEditor } from "@/hooks/use-editor";'
          const previewRendererAnchor = `\t\treturn new CanvasRenderer({
\t\t\twidth: nativeWidth,
\t\t\theight: nativeHeight,
\t\t\tfps: activeProject.settings.fps,
\t\t});`
          const toolbarTimeAnchor = `\tconst isPlaying = editor.playback.getIsPlaying();
\tconst currentTime = editor.playback.getCurrentTime();`
          const toolbarRefAnchor = `\tconst { t } = useTranslation();
\tconst editor = useEditor();`
          const toolbarContainerAnchor =
            '\t\t<div className="grid grid-cols-[1fr_auto_1fr] items-center pb-3 pt-5 px-5">'
          const toolbarActionsAnchor = `\t\t\t<div className="flex items-center gap-1 justify-self-end">
\t\t\t\t<Button`
          const dropdownContainerAnchor = '<DropdownMenuContent align="end" side="top">'
          const dropdownRootAnchor = '<DropdownMenu>'
          const previewInteractionAnchor = '\t\t\t\t<PreviewInteractionOverlay'
          const exportFrameAnchor = `function exportCurrentFrame({
\teditor,
}: {
\teditor: ReturnType<typeof useEditor>;
}) {`
          const exportFrameCallAnchor =
            '<DropdownMenuItem onClick={() => exportCurrentFrame({ editor })}>'
          if (
            !normalized.includes(editorImportAnchor) ||
            !normalized.includes(previewRendererAnchor) ||
            !normalized.includes(toolbarTimeAnchor) ||
            !normalized.includes(toolbarRefAnchor) ||
            !normalized.includes(toolbarContainerAnchor) ||
            !normalized.includes(toolbarActionsAnchor) ||
            !normalized.includes(dropdownContainerAnchor) ||
            !normalized.includes(dropdownRootAnchor) ||
            !normalized.includes(previewInteractionAnchor) ||
            !normalized.includes(exportFrameAnchor) ||
            !normalized.includes(exportFrameCallAnchor)
          ) {
            throw new Error('Cutia 桌面预览倒放解码尺寸适配需要检查上游版本')
          }
          return normalized
            .replace(
              editorImportAnchor,
              `${editorImportAnchor}\nimport { usePlaybackTime } from "@cutia-desktop/playback-time";\nimport { getPreviewDuration } from "@cutia-desktop/preview-duration";\nimport { DirectorPreviewOverlay } from "@cutia-desktop/director-preview-overlay";\nimport { ProjectCanvasSizeControl } from "@cutia-desktop/project-canvas-size-control";`
            )
            .replace(
              'const totalDuration = editor.timeline.getTotalDuration();',
              'const totalDuration = getPreviewDuration(editor);'
            )
            .replace('duration: renderTree.duration,', 'duration: getPreviewDuration(editor),')
            .replace(
              toolbarTimeAnchor,
              `\tconst isPlaying = editor.playback.getIsPlaying();
\tconst currentTime = usePlaybackTime(editor.playback);`
            )
            .replace(
              toolbarRefAnchor,
              `${toolbarRefAnchor}
\tconst toolbarRef = useRef<HTMLDivElement>(null);`
            )
            .replace(
              toolbarContainerAnchor,
              '\t\t<div ref={toolbarRef} className="grid grid-cols-[1fr_auto_1fr] items-center pb-3 pt-5 px-5">'
            )
            .replace(
              toolbarActionsAnchor,
              `\t\t\t<div className="flex items-center gap-1 justify-self-end">
\t\t\t\t<ProjectCanvasSizeControl />
\t\t\t\t<Button`
            )
            .replace(dropdownRootAnchor, '<DropdownMenu modal={false}>')
            .replace(
              dropdownContainerAnchor,
              // Fullscreen hides portals outside its element. Keep this menu
              // inside the preview and avoid modal locks across documents.
              '<DropdownMenuContent align="end" side="top" container={toolbarRef.current?.closest<HTMLElement>(".panel") ?? undefined}>'
            )
            .replace(
              exportFrameAnchor,
              `function exportCurrentFrame({
\teditor,
\ttargetDocument = document,
}: {
\teditor: ReturnType<typeof useEditor>;
\ttargetDocument?: Document;
}) {
\tconst targetWindow = targetDocument.defaultView ?? window;`
            )
            .replace(
              'const tempCanvas = document.createElement("canvas");',
              'const tempCanvas = targetDocument.createElement("canvas");'
            )
            .replace(
              'const url = URL.createObjectURL(blob);',
              'const url = targetWindow.URL.createObjectURL(blob);'
            )
            .replace(
              'const a = document.createElement("a");',
              'const a = targetDocument.createElement("a");'
            )
            .replace('document.body.appendChild(a);', 'targetDocument.body.appendChild(a);')
            .replace('document.body.removeChild(a);', 'targetDocument.body.removeChild(a);')
            .replace('URL.revokeObjectURL(url);', 'targetWindow.URL.revokeObjectURL(url);')
            .replace(
              exportFrameCallAnchor,
              '<DropdownMenuItem onClick={() => exportCurrentFrame({ editor, targetDocument: toolbarRef.current?.ownerDocument })}>'
            )
            .replace(
              previewRendererAnchor,
              `\t\treturn new CanvasRenderer({
\t\t\twidth: nativeWidth,
\t\t\theight: nativeHeight,
\t\t\tfps: activeProject.settings.fps,
\t\t\tvideoDecodeMaxDimension: 540,
\t\t\tmaxBackingDimension: 960,
\t\t});`
            )
            .replace('width={nativeWidth}', 'width={renderer.canvas.width}')
            .replace('height={nativeHeight}', 'height={renderer.canvas.height}')
            .replace(
              previewInteractionAnchor,
              `\t\t\t\t<DirectorPreviewOverlay />\n${previewInteractionAnchor}`
            )
        }
        if (file === `${prefix}/components/editor/mobile/mobile-preview.tsx`) {
          const normalized = code.replace(/\r\n/g, '\n')
          const previewRendererAnchor = `\t\treturn new CanvasRenderer({
\t\t\twidth: nativeWidth,
\t\t\theight: nativeHeight,
\t\t\tfps: activeProject.settings.fps,
\t\t});`
          if (!normalized.includes(previewRendererAnchor)) {
            throw new Error('Cutia 移动预览倒放解码尺寸适配需要检查上游版本')
          }
          return normalized
            .replace(
              previewRendererAnchor,
              `\t\treturn new CanvasRenderer({
\t\t\twidth: nativeWidth,
\t\t\theight: nativeHeight,
\t\t\tfps: activeProject.settings.fps,
\t\t\tvideoDecodeMaxDimension: 540,
\t\t\tmaxBackingDimension: 720,
\t\t});`
            )
            .replace('width={nativeWidth}', 'width={renderer.canvas.width}')
            .replace('height={nativeHeight}', 'height={renderer.canvas.height}')
        }
        if (file === `${prefix}/core/managers/project-manager.ts`) {
          const anchor = 'console.error("Failed to save project:", error);'
          if (!code.includes(anchor)) throw new Error('Cutia 保存适配需要检查上游版本')
          let adapted = code.replace(anchor, `${anchor}\n\t\t\tthrow error;`)
          adapted = adapted
            .replace(
              'const scenes = this.editor.scenes.getScenes();',
              'const savingProject = this.active;\n\t\t\tconst scenes = this.editor.scenes.getScenes();'
            )
            .replace(
              /this\.active = updatedProject;\s*this\.updateMetadata\(updatedProject\);/,
              `if (this.active === savingProject) this.active = updatedProject;
            if (this.active?.metadata.id === updatedProject.metadata.id) this.updateMetadata(this.active);`
            )
          const thumbnailAnchor = 'private async updateThumbnailFromTimeline(): Promise<boolean> {'
          if (!adapted.includes(thumbnailAnchor))
            throw new Error('Cutia 缩略图适配需要检查上游版本')
          adapted = adapted.replace(
            thumbnailAnchor,
            `${thumbnailAnchor}
        // Avoid starting a second video decode/render pass while the desktop iframe is opening or closing.
        return false;`
          )
          const renameStart = adapted.indexOf('async renameProject(')
          const renameEnd = adapted.indexOf('async duplicateProjects(', renameStart)
          const rename = adapted.slice(renameStart, renameEnd).replace(
            'try {',
            `if (this.active?.metadata.id === id) {
            this.active = { ...this.active, metadata: { ...this.active.metadata, name, updatedAt: new Date() } };
            this.notify();
            this.editor.save.markDirty({ force: true });
            await this.editor.save.flush();
            return;
          }
          try {`
          )
          adapted = adapted.slice(0, renameStart) + rename + adapted.slice(renameEnd)
          return adapted
        }
        if (file === `${prefix}/core/managers/media-manager.ts`) {
          return code
            .replace(
              /this\.assets = this\.assets\.filter\(\(asset\) => asset\.id !== newAsset\.id\);\s*this\.notify\(\);/,
              (match) => `${match}\n\t\t\tthrow error;`
            )
            .replace(
              'console.error("Failed to load media assets:", error);',
              'console.error("Failed to load media assets:", error);\n\t\t\tthrow error;'
            )
        }
        if (file === `${prefix}/lib/timeline/track-utils.ts`) {
          const importAnchor = 'import { generateUUID } from "@/utils/id";'
          const functionAnchor = 'export function enforceMainTrackStart({'
          const upstreamRuleAnchor =
            '// main track must always start at time 0; if this element would'
          if (
            !code.includes(importAnchor) ||
            !code.includes(functionAnchor) ||
            !code.includes(upstreamRuleAnchor)
          ) {
            throw new Error('Cutia 主轨道起始时间适配需要检查上游版本')
          }

          const functionStart = code.indexOf(functionAnchor)
          const adaptedPrefix = code
            .slice(0, functionStart)
            .replace(
              importAnchor,
              `${importAnchor}\nimport { normalizeTimelineStartTime } from "@cutia-desktop/timeline-start-time";`
            )
          return `${adaptedPrefix}export function enforceMainTrackStart({
\trequestedStartTime,
}: {
\ttracks: TimelineTrack[];
\ttargetTrackId: string;
\trequestedStartTime: number;
\texcludeElementId?: string;
}): number {
\treturn normalizeTimelineStartTime(requestedStartTime);
}
`
        }
        if (file === `${prefix}/lib/timeline/drop-utils.ts`) {
          const importAnchor = 'import { isMainTrack, enforceMainTrackStart } from "./track-utils";'
          const targetAnchor =
            '\tconst trackAtMouse = getTrackAtY({ mouseY, tracks, verticalDragDirection });'
          const branchAnchor = '\n\tif (!trackAtMouse) {'
          if (
            !code.includes(importAnchor) ||
            !code.includes(targetAnchor) ||
            !code.includes(branchAnchor)
          ) {
            throw new Error('Cutia 单轨拖拽建轨适配需要检查上游版本')
          }

          return code
            .replace(
              importAnchor,
              `${importAnchor}\nimport { getInternalTrackEdgeDropTarget } from "@cutia-desktop/timeline-track-edge-drop";\nimport { getStickerTrackCreationIntent } from "@cutia-desktop/sticker-track-drop";`
            )
            .replace(
              targetAnchor,
              `${targetAnchor}
\tconst stickerTrackCreationIntent = elementType === "sticker"
\t\t? getStickerTrackCreationIntent({
\t\t\tmouseY,
\t\t\ttracks,
\t\t\ttrackHeights: TRACK_HEIGHTS,
\t\t\ttrackGap: TRACK_GAP,
\t\t})
\t\t: null;
\tif (stickerTrackCreationIntent) {
\t\tconst { index, position } = findInsertIndex({
\t\t\telementType,
\t\t\ttracks,
\t\t\tpreferredIndex: stickerTrackCreationIntent.preferredIndex,
\t\t\tinsertAbove: stickerTrackCreationIntent.insertAbove,
\t\t});
\t\treturn {
\t\t\ttrackIndex: index,
\t\t\tisNewTrack: true,
\t\t\tinsertPosition: position,
\t\t\txPosition,
\t\t};
\t}
\tconst totalTracksHeight = tracks.reduce(
\t\t(height, track, index) =>
\t\t\theight + TRACK_HEIGHTS[track.type] + (index > 0 ? TRACK_GAP : 0),
\t\t0,
\t);
\tconst edgeDropTarget = getInternalTrackEdgeDropTarget({
\t\tisExternalDrop,
\t\tmouseY,
\t\ttotalTracksHeight,
\t\ttrackCount: tracks.length,
\t\tverticalDragDirection,
\t});`
            )
            .replace(
              branchAnchor,
              `
\tif (!trackAtMouse) {
\t\tif (edgeDropTarget) {
\t\t\tconst { index, position } = findInsertIndex({
\t\t\t\telementType,
\t\t\t\ttracks,
\t\t\t\tpreferredIndex: edgeDropTarget.preferredIndex,
\t\t\t\tinsertAbove: edgeDropTarget.insertAbove,
\t\t\t});
\t\t\treturn {
\t\t\t\ttrackIndex: index,
\t\t\t\tisNewTrack: true,
\t\t\t\tinsertPosition: position,
\t\t\t\txPosition,
\t\t\t};
\t\t}`
            )
        }
        if (file === `${prefix}/lib/commands/timeline/element/insert-element.ts`) {
          const importAnchor =
            'import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";'
          if (!code.includes(importAnchor) || !code.includes('const existingTrack = tracks.find')) {
            throw new Error('Cutia 调节轨道插入适配需要检查上游版本')
          }
          let adapted = code.replace(
            'const isFirstElement = totalElementsInTimeline === 0;',
            'const isFirstElement = false; // Keep the output settings selected in the desktop project dialog.'
          )
          adapted = adapted.replace(
            importAnchor,
            `${importAnchor}\nimport { isAdjustmentCompatible } from "@cutia-desktop/adjustment-layer";`
          )
          adapted = adapted.replace(
            '\t\t\tconst validation = validateElementTrackCompatibility({',
            `\t\t\tif (!isAdjustmentCompatible({ element, track: targetTrack })) {
\t\t\t\tconsole.error("Adjustment layers and media clips must use separate tracks");
\t\t\t\treturn null;
\t\t\t}

\t\t\tconst validation = validateElementTrackCompatibility({`
          )
          adapted = adapted.replace(
            'const existingTrack = tracks.find((track) => {',
            `const existingTrack = tracks.find((track) => {
\t\t\tif (!isAdjustmentCompatible({ element, track })) return false;`
          )
          return adapted
        }
        if (file === `${prefix}/lib/commands/timeline/element/move-elements.ts`) {
          const importAnchor =
            'import { cleanupTransitionsForTrack } from "@/lib/timeline/transition-utils";'
          if (
            !code.includes(importAnchor) ||
            !code.includes('const newTrack = buildEmptyTrack({')
          ) {
            throw new Error('Cutia 调节轨道移动适配需要检查上游版本')
          }
          return code
            .replace(
              importAnchor,
              `${importAnchor}\nimport { isAdjustmentCompatible, isAdjustmentElement, markAdjustmentTrack } from "@cutia-desktop/adjustment-layer";`
            )
            .replace(
              /const newTrack = buildEmptyTrack\(\{\r?\n\t\t\t\tid: this\.targetTrackId,\r?\n\t\t\t\ttype: this\.createTrack\.type,\r?\n\t\t\t\}\);/,
              `const baseTrack = buildEmptyTrack({
\t\t\t\tid: this.targetTrackId,
\t\t\t\ttype: this.createTrack.type,
\t\t\t});
\t\t\tconst newTrack = isAdjustmentElement(element)
\t\t\t\t? markAdjustmentTrack(baseTrack)
\t\t\t\t: baseTrack;`
            )
            .replace(
              '\t\tconst validation = validateElementTrackCompatibility({',
              `\t\tif (!isAdjustmentCompatible({ element, track: targetTrack })) {
\t\t\tconsole.error("Adjustment layers and media clips must use separate tracks");
\t\t\treturn;
\t\t}

\t\tconst validation = validateElementTrackCompatibility({`
            )
        }
        if (file === `${prefix}/core/managers/timeline-manager.ts`) {
          const importAnchor = 'import type { EditorCore } from "@/core";'
          const updateAnchor = 'updateTracks(newTracks: TimelineTrack[]): void {'
          const updateBodyPattern =
            /\t\tthis\.editor\.scenes\.updateSceneTracks\(\{ tracks: newTracks \}\);\r?\n\t\tthis\.notify\(\);/
          if (
            !code.includes(importAnchor) ||
            !code.includes(updateAnchor) ||
            !updateBodyPattern.test(code)
          ) {
            throw new Error('Cutia 空轨道清理适配需要检查上游版本')
          }

          const adapted = code.replace(
            importAnchor,
            `${importAnchor}\nimport { removeEmptyTimelineTracks } from "@cutia-desktop/timeline-track-cleanup";`
          )

          return adapted.replace(
            updateBodyPattern,
            `$&\n\t\tqueueMicrotask(() => {\n\t\t\tconst currentTracks = this.getTracks();\n\t\t\tconst cleanedTracks = removeEmptyTimelineTracks(currentTracks);\n\t\t\tif (cleanedTracks.length === currentTracks.length) return;\n\t\t\tthis.editor.scenes.updateSceneTracks({ tracks: cleanedTracks });\n\t\t\tthis.notify();\n\t\t});`
          )
        }
        if (file === `${prefix}/core/managers/scenes-manager.ts`) {
          const importAnchor = 'import { ensureMainTrack } from "@/lib/timeline/track-utils";'
          const trackAnchor = 'const existingTracks = scene.tracks ?? [];'
          const trackPattern =
            /const existingTracks = scene\.tracks \?\? \[\];\r?\n\t\t\tconst updatedTracks = ensureMainTrack\(\{ tracks: existingTracks \}\);/
          if (
            !code.includes(importAnchor) ||
            !code.includes(trackAnchor) ||
            !trackPattern.test(code)
          ) {
            throw new Error('Cutia 加载项目空轨道清理适配需要检查上游版本')
          }

          return code
            .replace(
              importAnchor,
              `${importAnchor}\nimport { removeEmptyTimelineTracks } from "@cutia-desktop/timeline-track-cleanup";`
            )
            .replace(
              trackPattern,
              `${trackAnchor}\n\t\t\tconst cleanedTracks = removeEmptyTimelineTracks(existingTracks);\n\t\t\tconst updatedTracks = ensureMainTrack({ tracks: cleanedTracks });`
            )
        }
        if (file === `${prefix}/lib/commands/timeline/clipboard/paste.ts`) {
          const importAnchor = 'import { wouldElementOverlap } from "@/lib/timeline/element-utils";'
          if (!code.includes(importAnchor) || !code.includes('function buildTrackWithElements({')) {
            throw new Error('Cutia 调节层粘贴适配需要检查上游版本')
          }
          return code
            .replace(
              importAnchor,
              `${importAnchor}\nimport { isAdjustmentCompatible, isAdjustmentElement, markAdjustmentTrack } from "@cutia-desktop/adjustment-layer";`
            )
            .replace(
              /(function canPlaceElementsOnTrack\([\s\S]*?\}\): boolean \{\r?\n)/,
              `$1\tif (elements.some((element) => !isAdjustmentCompatible({ element, track }))) {
\t\treturn false;
\t}
`
            )
            .replace(
              /const newTrackBase = buildEmptyTrack\(\{ id: newTrackId, type: trackType \}\);\r?\n\treturn \{\r?\n\t\t\.\.\.newTrackBase,\r?\n\t\telements,\r?\n\t\} as TimelineTrack;/,
              `const newTrackBase = buildEmptyTrack({ id: newTrackId, type: trackType });
\tconst newTrack = elements.every(isAdjustmentElement)
\t\t? markAdjustmentTrack(newTrackBase)
\t\t: newTrackBase;
\treturn {
\t\t...newTrack,
\t\telements,
\t} as TimelineTrack;`
            )
        }
        if (file === `${prefix}/components/editor/panels/timeline/timeline-toolbar.tsx`) {
          const freezeFrameEndAnchor =
            'currentTime < selected.element.startTime + selected.element.duration;'
          const toolbarVisualImportAnchor = 'import { useEditor } from "@/hooks/use-editor";'
          const toolbarLucideImportAnchor = 'import { SplitSquareHorizontal } from "lucide-react";'
          const sceneSplitButtonAnchor = `\t\t\t\t<ToolbarButton
\t\t\t\t\ticon={<SplitSquareHorizontal />}
\t\t\t\t\ttooltip={t('Coming soon')}
\t\t\t\t\tdisabled={true}
\t\t\t\t\tonClick={({ event: _event }) => {}}
\t\t\t\t/>`
          const snowIconAnchor = '\tSnowIcon,'
          const freezeButtonAnchor = `\t\t\t\t<ToolbarButton
\t\t\t\t\ticon={<HugeiconsIcon icon={SnowIcon} />}
\t\t\t\t\ttooltip={t("Freeze frame")}
\t\t\t\t\tdisabled={!canFreezeFrame}
\t\t\t\t\tonClick={({ event }) =>
\t\t\t\t\t\thandleAction({ action: "freeze-frame", event })
\t\t\t\t\t}
\t\t\t\t/>`
          if (
            !code.includes(freezeFrameEndAnchor) ||
            !code.includes(toolbarVisualImportAnchor) ||
            !code.includes(toolbarLucideImportAnchor) ||
            !code.replace(/\r\n/g, '\n').includes(sceneSplitButtonAnchor) ||
            !code.includes(snowIconAnchor) ||
            !code.replace(/\r\n/g, '\n').includes(freezeButtonAnchor)
          ) {
            throw new Error('Cutia 倒放按钮适配需要检查上游版本')
          }
          return code
            .replace(/\r\n/g, '\n')
            .replace(
              toolbarVisualImportAnchor,
              `${toolbarVisualImportAnchor}\nimport { useState } from "react";\nimport { usePlaybackTime } from "@cutia-desktop/playback-time";\nimport { ClipCropDialog } from "@cutia-desktop/clip-crop-dialog";\nimport { SceneSplitButton } from "@cutia-desktop/scene-split-button";\nimport { createVisualTransformUpdate, rotateVisualSourceByQuarterTurn } from "@cutia-desktop/visual-keyframes";`
            )
            .replace(
              'const currentTime = editor.playback.getCurrentTime();',
              'const currentTime = usePlaybackTime(editor.playback);'
            )
            .replace(toolbarLucideImportAnchor, 'import { Crop } from "lucide-react";')
            .replace(sceneSplitButtonAnchor, '\t\t\t\t<SceneSplitButton />')
            .replace(
              freezeFrameEndAnchor,
              `currentTime <= selected.element.startTime + selected.element.duration + 1e-6;
\tconst canReverse = selected?.element.type === "video";
\tconst isReversed = canReverse && selected.element.reversed === true;
\tconst canFlip =
\t\tselected?.element.type === "video" || selected?.element.type === "image";
\tconst canRotate = selected?.element.type === "video";
\tconst canCrop = canFlip;
\tconst [cropOpen, setCropOpen] = useState(false);
\tconst [cropTimelineTime, setCropTimelineTime] = useState(0);
\tconst cropMedia =
\t\tcanCrop && selected && "mediaId" in selected.element
\t\t\t? editor.media.getAssets().find((asset) => asset.id === selected.element.mediaId) ?? null
\t\t\t: null;
\tconst isFlippedHorizontally =
\t\tcanFlip && selected.element.transform.flipX === true;
\tconst isFlippedVertically =
\t\tcanFlip && selected.element.transform.flipY === true;

\tconst toggleReverse = ({ event }: { event: React.MouseEvent }) => {
\t\tevent.stopPropagation();
\t\tif (!selected || selected.element.type !== "video") return;
\t\teditor.timeline.updateElements({
\t\t\tupdates: [
\t\t\t\t{
\t\t\t\t\ttrackId: selected.track.id,
\t\t\t\t\telementId: selected.element.id,
\t\t\t\t\tupdates: { reversed: !isReversed },
\t\t\t\t},
\t\t\t],
\t\t});
\t};

\tconst toggleFlip = ({
\t\taxis,
\t\tevent,
\t}: {
\t\taxis: "flipX" | "flipY";
\t\tevent: React.MouseEvent;
\t}) => {
\t\tevent.stopPropagation();
\t\tif (
\t\t\t!selected ||
\t\t\t(selected.element.type !== "video" && selected.element.type !== "image")
\t\t)
\t\t\treturn;
\t\tconst transform = selected.element.transform;
\t\teditor.timeline.updateElements({
\t\t\tupdates: [
\t\t\t\t{
\t\t\t\t\ttrackId: selected.track.id,
\t\t\t\t\telementId: selected.element.id,
\t\t\t\t\tupdates: {
\t\t\t\t\t\ttransform: {
\t\t\t\t\t\t\t...transform,
\t\t\t\t\t\t\t[axis]: transform[axis] !== true,
\t\t\t\t\t\t},
\t\t\t\t\t},
\t\t\t\t},
\t\t\t],
\t\t});
\t};

\tconst rotateClockwise = ({ event }: { event: React.MouseEvent }) => {
\t\tevent.stopPropagation();
\t\tif (!selected || selected.element.type !== "video") return;
\t\teditor.timeline.updateElements({
\t\t\tupdates: [
\t\t\t\t{
\t\t\t\t\ttrackId: selected.track.id,
\t\t\t\t\telementId: selected.element.id,
\t\t\t\t\tupdates: rotateVisualSourceByQuarterTurn(selected.element as any) as any,
\t\t\t\t},
\t\t\t],
\t\t});
\t};

\tconst openCrop = ({ event }: { event: React.MouseEvent }) => {
\t\tevent.stopPropagation();
\t\tif (!canCrop || !cropMedia) return;
\t\tsetCropTimelineTime(editor.playback.getCurrentTime());
\t\tsetCropOpen(true);
\t};

\tconst confirmCrop = ({ crop, transform }: { crop: unknown; transform: any }) => {
\t\tif (
\t\t\t!selected ||
\t\t\t(selected.element.type !== "video" && selected.element.type !== "image")
\t\t)
\t\t\treturn;
\t\teditor.timeline.updateElements({
\t\t\tupdates: [
\t\t\t\t{
\t\t\t\t\ttrackId: selected.track.id,
\t\t\t\t\telementId: selected.element.id,
\t\t\t\t\tupdates: {
\t\t\t\t\t\tcrop,
\t\t\t\t\t\t...createVisualTransformUpdate({
\t\t\t\t\t\t\tsource: selected.element as any,
\t\t\t\t\t\t\ttimelineTime: currentTime,
\t\t\t\t\t\t\ttransform,
\t\t\t\t\t\t}),
\t\t\t\t\t},
\t\t\t\t},
\t\t\t],
\t\t});
\t\tsetCropOpen(false);
\t};`
            )
            .replace(
              snowIconAnchor,
              `${snowIconAnchor}\n\tArrowTurnBackwardIcon,\n\tImageFlipHorizontalIcon,\n\tImageFlipVerticalIcon,\n\tRotateClockwiseIcon,`
            )
            .replace(
              freezeButtonAnchor,
              `${freezeButtonAnchor}

\t\t\t\t<ToolbarButton
\t\t\t\t\ticon={<HugeiconsIcon icon={ArrowTurnBackwardIcon} />}
\t\t\t\t\ttooltip={t("Reverse")}
\t\t\t\t\tdisabled={!canReverse}
\t\t\t\t\tisActive={isReversed}
\t\t\t\t\tonClick={toggleReverse}
\t\t\t\t/>

\t\t\t\t<ToolbarButton
\t\t\t\t\ticon={<HugeiconsIcon icon={ImageFlipHorizontalIcon} />}
\t\t\t\t\ttooltip="左右翻转"
\t\t\t\t\tdisabled={!canFlip}
\t\t\t\t\tisActive={isFlippedHorizontally}
\t\t\t\t\tonClick={({ event }) => toggleFlip({ axis: "flipX", event })}
\t\t\t\t/>

\t\t\t\t<ToolbarButton
\t\t\t\t\ticon={<HugeiconsIcon icon={ImageFlipVerticalIcon} />}
\t\t\t\t\ttooltip="上下翻转"
\t\t\t\t\tdisabled={!canFlip}
\t\t\t\t\tisActive={isFlippedVertically}
\t\t\t\t\tonClick={({ event }) => toggleFlip({ axis: "flipY", event })}
\t\t\t\t/>

\t\t\t\t<ToolbarButton
\t\t\t\t\ticon={<HugeiconsIcon icon={RotateClockwiseIcon} />}
\t\t\t\t\ttooltip="顺时针旋转 90°"
\t\t\t\t\tdisabled={!canRotate}
\t\t\t\t\tonClick={rotateClockwise}
\t\t\t\t/>

\t\t\t\t<ToolbarButton
\t\t\t\t\ticon={<Crop />}
\t\t\t\t\ttooltip="裁剪"
\t\t\t\t\tdisabled={!canCrop || !cropMedia}
\t\t\t\t\tonClick={openCrop}
\t\t\t\t/>`
            )
            .replace(
              '\treturn (\n\t\t<div className="flex items-center gap-1">',
              '\treturn (\n\t\t<>\n\t\t<div className="flex items-center gap-1">'
            )
            .replace(
              '\t\t</div>\n\t);\n}\n\nfunction ToolbarRightSection',
              `\t\t</div>
\t\t<ClipCropDialog
\t\t\topen={cropOpen && canCrop}
\t\t\tonOpenChange={setCropOpen}
\t\t\telement={canCrop && selected ? (selected.element as any) : null}
\t\t\tmedia={cropMedia}
\t\t\ttimelineTime={cropTimelineTime}
\t\t\tonConfirm={confirmCrop}
\t\t/>
\t\t</>
\t);
}

function ToolbarRightSection`
            )
            .replace(
              'onClick={(event) => onClick({ event })}',
              'aria-label={tooltip}\n\t\t\t\t\tonClick={(event) => onClick({ event })}'
            )
        }
        if (file === `${prefix}/hooks/actions/use-editor-actions.ts`) {
          const importAnchor = 'import { storageService } from "@/services/storage/service";'
          const freezeActionIndex = code.indexOf('"freeze-frame"')
          const pasteActionIndex = code.indexOf('"paste-copied"', freezeActionIndex)
          const freezeBlockStart = code.lastIndexOf('\tuseActionHandler(', freezeActionIndex)
          const freezeBlockEnd = code.lastIndexOf('\tuseActionHandler(', pasteActionIndex)
          if (
            !code.includes(importAnchor) ||
            freezeActionIndex < 0 ||
            pasteActionIndex < 0 ||
            freezeBlockStart < 0 ||
            freezeBlockEnd <= freezeBlockStart
          ) {
            throw new Error('Cutia 定格动作适配需要检查上游版本')
          }
          const adapted = code.replace(
            importAnchor,
            `${importAnchor}\nimport { executeDesktopFreezeFrame } from "@cutia-desktop/freeze-frame";\nimport { prepareReversePlayback } from "@/services/video-cache/service";`
          )
          const offset = adapted.length - code.length
          const action = `\tuseActionHandler(
\t\t"freeze-frame",
\t\t(args) => {
\t\t\tvoid executeDesktopFreezeFrame({
\t\t\t\teditor,
\t\t\t\tsourceRef:
\t\t\t\t\targs ??
\t\t\t\t\t(selectedElements.length === 1 ? selectedElements[0] : undefined),
\t\t\t\tinFlight: freezeFrameInFlight,
\t\t\t});
\t\t},
\t\tundefined,
\t);\n\n`
          const withFreezeAction =
            adapted.slice(0, freezeBlockStart + offset) +
            action +
            adapted.slice(freezeBlockEnd + offset)
          const togglePlaybackPattern =
            /\tuseActionHandler\(\s*"toggle-play",\s*\(\) => \{\s*useMediaPreviewStore\.getState\(\)\.clearSelection\(\);\s*editor\.playback\.toggle\(\);\s*\},\s*undefined,\s*\);/
          if (!togglePlaybackPattern.test(withFreezeAction)) {
            throw new Error('Cutia 倒放预览准备动作适配需要检查上游版本')
          }
          return withFreezeAction.replace(
            togglePlaybackPattern,
            `\tuseActionHandler(
\t\t"toggle-play",
\t\tasync () => {
\t\t\tuseMediaPreviewStore.getState().clearSelection();
\t\t\tif (editor.playback.getIsPlaying()) {
\t\t\t\teditor.playback.pause();
\t\t\t\treturn;
\t\t\t}
\t\t\tconst currentTime = editor.playback.getCurrentTime();
\t\t\tconst shouldPrepareReverse = editor.timeline.getTracks().some(
\t\t\t\t(track) =>
\t\t\t\t\ttrack.type === "video" &&
\t\t\t\t\ttrack.elements.some(
\t\t\t\t\t\t(element) =>
\t\t\t\t\t\t\telement.type === "video" &&
\t\t\t\t\t\t\telement.reversed === true &&
\t\t\t\t\t\t\tcurrentTime >= element.startTime &&
\t\t\t\t\t\t\tcurrentTime < element.startTime + element.duration,
\t\t\t\t\t),
\t\t\t);
\t\t\tlet loadingToast: string | number | undefined;
\t\t\ttry {
\t\t\t\tif (shouldPrepareReverse) {
\t\t\t\t\tawait prepareReversePlayback({
\t\t\t\t\t\tonPreparing: () => {
\t\t\t\t\t\t\tloadingToast = toast.loading("正在准备倒放预览...");
\t\t\t\t\t\t},
\t\t\t\t\t});
\t\t\t\t}
\t\t\t\teditor.playback.play();
\t\t\t} finally {
\t\t\t\tif (loadingToast !== undefined) toast.dismiss(loadingToast);
\t\t\t}
\t\t},
\t\tundefined,
\t);`
          )
        }
        if (file === `${prefix}/hooks/timeline/use-timeline-drag-drop.ts`) {
          const importAnchor = 'import type { MediaDragData, StickerDragData } from "@/types/drag";'
          const reactImportAnchor = 'import { useState, useCallback, type RefObject } from "react";'
          const dragDataImportAnchor = 'import { getDragData, hasDragData } from "@/lib/drag-data";'
          const dropStateAnchor =
            '\tconst [dragElementType, setElementType] = useState<ElementType | null>(null);'
          if (
            !code.includes(importAnchor) ||
            !code.includes(reactImportAnchor) ||
            !code.includes(dragDataImportAnchor) ||
            !code.includes(dropStateAnchor) ||
            !code.includes('const handleDrop = useCallback(')
          ) {
            throw new Error('Cutia 特效拖放适配需要检查上游版本')
          }
          let adapted = code
            .replace(
              reactImportAnchor,
              'import { useState, useCallback, useRef, type RefObject } from "react";'
            )
            .replace(
              dragDataImportAnchor,
              'import { clearDragData, getDragData, hasDragData } from "@/lib/drag-data";'
            )
            .replace(
              importAnchor,
              `${importAnchor}\nimport { applyTimelineAppearanceDrop, isTimelineAppearanceDragData } from "@cutia-desktop/timeline-effect-drop";\nimport { resolveStickerAsset } from "@cutia-desktop/sticker-runtime";`
            )
            .replace(
              dropStateAnchor,
              `${dropStateAnchor}\n\tconst dropTargetRef = useRef<DropTarget | null>(null);`
            )
            .replace(
              /\t\t\t\tzoomLevel,\r?\n\t\t\t\}\);/,
              `\t\t\t\tzoomLevel,
\t\t\t\tstartTimeOverride:
\t\t\t\t\t!isExternal &&
\t\t\t\t\t(elementType === "video" || elementType === "image" || elementType === "audio")
\t\t\t\t\t\t? getSnappedTime({ time: editor.playback.getCurrentTime() })
\t\t\t\t\t\t: undefined,
\t\t\t});`
            )
          adapted = adapted.replace(
            /const handleDragEnter = useCallback\(\(e: React\.DragEvent\) => \{\s*e\.preventDefault\(\);/,
            `const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        if (isTimelineAppearanceDragData(getDragData({ dataTransfer: e.dataTransfer }))) {
          setIsDragOver(false);
          return;
        }`
          )
          adapted = adapted.replace(
            /(const handleDragOver = useCallback\(\s*\(e: React\.DragEvent\) => \{\s*e\.preventDefault\(\);)/,
            `$1
          if (isTimelineAppearanceDragData(getDragData({ dataTransfer: e.dataTransfer }))) {
            const target = e.target instanceof Element
              ? e.target.closest("[data-timeline-track-id][data-timeline-element-id]")
              : null;
            e.dataTransfer.dropEffect = target ? "copy" : "none";
            return;
          }`
          )
          adapted = adapted.replace(
            /(const handleDrop = useCallback\(\s*async \(e: React\.DragEvent\) => \{\s*e\.preventDefault\(\);)/,
            `$1
          const appearanceDragData = getDragData({ dataTransfer: e.dataTransfer });
          if (isTimelineAppearanceDragData(appearanceDragData)) {
            clearDragData();
            dropTargetRef.current = null;
            setIsDragOver(false);
            setDropTarget(null);
            setElementType(null);
            const applied = applyTimelineAppearanceDrop({ editor, eventTarget: e.target, dragData: appearanceDragData });
            if (applied) toast.success(appearanceDragData.name + " 已应用到时间线");
            else toast.info("请把特效或滤镜拖到视频、图片或调节层上");
            return;
          }`
          )
          adapted = adapted
            .replace(
              '\t\t\tsetDropTarget(target);',
              `\t\t\tif (elementType === "sticker") {
\t\t\t\ttarget.xPosition = getSnappedTime({ time: editor.playback.getCurrentTime() });
\t\t\t}
\t\t\tdropTargetRef.current = target;
\t\t\tsetDropTarget(target);`
            )
            .replace(
              '\t\t\t\t\tsetDropTarget(null);',
              '\t\t\t\t\tdropTargetRef.current = null;\n\t\t\t\t\tsetDropTarget(null);'
            )
            .replace(
              '\t\t\tconst currentTarget = dropTarget;',
              '\t\t\tconst currentTarget = dropTargetRef.current ?? dropTarget;\n\t\t\tdropTargetRef.current = null;'
            )
            .replace(
              '\t\t\t\t\tconst dragData = getDragData({ dataTransfer: e.dataTransfer });\n\t\t\t\t\tif (!dragData) return;',
              '\t\t\t\t\tconst dragData = getDragData({ dataTransfer: e.dataTransfer });\n\t\t\t\t\tclearDragData();\n\t\t\t\t\tif (!dragData) return;'
            )
            .replace(
              'executeMediaDrop({ target: currentTarget, dragData });',
              `executeMediaDrop({
\t\t\t\t\t\ttarget:
\t\t\t\t\t\t\tdragData.type === "media"
\t\t\t\t\t\t\t\t? {
\t\t\t\t\t\t\t\t\t...currentTarget,
\t\t\t\t\t\t\t\t\t\txPosition: getSnappedTime({ time: editor.playback.getCurrentTime() }),
\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t: currentTarget,
\t\t\t\t\t\t\tdragData,
\t\t\t\t\t});`
            )
          const stickerDropStart = adapted.indexOf('\tconst executeStickerDrop = useCallback(')
          const mediaDropStart = adapted.indexOf(
            '\tconst executeMediaDrop = useCallback(',
            stickerDropStart
          )
          if (stickerDropStart < 0 || mediaDropStart < 0) {
            throw new Error('Cutia 贴纸拖放适配需要检查上游版本')
          }
          let stickerDropBlock = adapted.slice(stickerDropStart, mediaDropStart)
          if (
            !stickerDropBlock.includes('\t\t({') ||
            !stickerDropBlock.includes('\t\t\tlet trackId: string;') ||
            !stickerDropBlock.includes('\t\t\tconst element = buildStickerElement({')
          ) {
            throw new Error('Cutia 贴纸下载拖放适配需要检查上游版本')
          }
          stickerDropBlock = stickerDropBlock
            .replace('\t\t({', '\t\tasync ({')
            .replace(
              '\t\t\tlet trackId: string;',
              '\t\t\tconst downloaded = await resolveStickerAsset(dragData.id);\n\t\t\tlet trackId: string;'
            )
            .replace(
              '\t\t\teditor.timeline.insertElement({',
              `\t\t\t(element as typeof element & { sourceUrl: string; sourceRemoteUrl: string; sourceMimeType: string }).name = dragData.name;
\t\t\t(element as typeof element & { sourceUrl: string }).sourceUrl = downloaded.dataUrl;
\t\t\t(element as typeof element & { sourceRemoteUrl: string }).sourceRemoteUrl = downloaded.sourceUrl;
\t\t\t(element as typeof element & { sourceMimeType: string }).sourceMimeType = downloaded.mimeType;

\t\t\teditor.timeline.insertElement({`
            )
          adapted =
            adapted.slice(0, stickerDropStart) + stickerDropBlock + adapted.slice(mediaDropStart)
          adapted = adapted.replace(
            'executeStickerDrop({ target: currentTarget, dragData });',
            'await executeStickerDrop({ target: currentTarget, dragData });'
          )
          return adapted
        }
        if (file === `${prefix}/hooks/timeline/element/use-element-resize.ts`) {
          const extendableTypes = 'if (element.type === "text" || element.type === "image") {'
          if (!code.includes(extendableTypes)) {
            throw new Error('Cutia 贴纸时长适配需要检查上游版本')
          }
          return adaptTimelineElementResize(code).replace(
            extendableTypes,
            'if (element.type === "text" || element.type === "image" || element.type === "sticker") {'
          )
        }
        if (file === `${prefix}/hooks/timeline/use-track-reorder.ts`) {
          const dragStatePattern =
            /\t\t\tsetReorderState\(\{\r?\n\t\t\t\tisDragging: true,\r?\n\t\t\t\tdragTrackId: trackId,\r?\n\t\t\t\tdragOverIndex: null,\r?\n\t\t\t\}\);/
          const targetPattern =
            /\t\t\t\tconst targetIndex = getTargetIndex\(\{\r?\n\t\t\t\t\tmouseY: event\.clientY,\r?\n\t\t\t\t\ttracks,\r?\n\t\t\t\t\}\);/
          const stateUpdatePattern =
            /\t\t\t\tsetReorderState\(\(current\) => \{[\s\S]*?\n\t\t\t\t\}\);/
          if (
            !dragStatePattern.test(code) ||
            !targetPattern.test(code) ||
            !stateUpdatePattern.test(code)
          ) {
            throw new Error('Cutia 轨道重排适配需要检查上游版本')
          }

          return code
            .replace(dragStatePattern, '$&\n\t\t\tlet latestDragOverIndex: number | null = null;')
            .replace(targetPattern, '$&\n\t\t\t\tlatestDragOverIndex = targetIndex;')
            .replace(
              stateUpdatePattern,
              `\t\t\t\tconst dragOverIndex = latestDragOverIndex;
\t\t\t\tsetReorderState(INITIAL_STATE);
\t\t\t\tif (dragOverIndex === null) return;

\t\t\t\tconst tracks = editor.timeline.getTracks();
\t\t\t\tconst fromIndex = tracks.findIndex((track) => track.id === trackId);
\t\t\t\tif (fromIndex === -1 || fromIndex === dragOverIndex) return;

\t\t\t\tconst newOrder = tracks.map((track) => track.id);
\t\t\t\tconst [moved] = newOrder.splice(fromIndex, 1);
\t\t\t\tnewOrder.splice(dragOverIndex, 0, moved);
\t\t\t\teditor.timeline.reorderTracks({ trackIds: newOrder });`
            )
        }
        if (file === `${prefix}/components/editor/panels/assets/views/media.tsx`) {
          // Stored files are read lazily; use their native URL when downloading media.
          const anchor = 'const downloadUrl = URL.createObjectURL(item.file);'
          if (!code.includes(anchor)) throw new Error('Cutia 素材下载适配需要检查上游版本')
          return code.replace(
            anchor,
            'const downloadUrl = item.url || URL.createObjectURL(item.file);'
          )
        }
        if (file === `${prefix}/services/renderer/nodes/sticker-node.ts`) {
          const urlAnchor =
            'const url = `https://api.iconify.design/${this.params.iconName}.svg?width=200&height=200${color}`;'
          const renderVisualTimePattern = /(sourceHeight: 200,)(\r?\n)(\t+)(\}\);)/
          if (
            !code.includes(urlAnchor) ||
            !code.includes('color?: string;') ||
            !renderVisualTimePattern.test(code)
          )
            throw new Error('Cutia 贴纸渲染适配需要检查上游版本')
          return code
            .replace('color?: string;', 'color?: string;\n\tsourceUrl?: string;')
            .replace(urlAnchor, `const url = this.params.sourceUrl || ${urlAnchor.slice(12)}`)
            .replace(
              /image\.onerror = \(\) =>\s*reject\(new Error\(`Failed to load sticker: \$\{this\.params\.iconName\}`\)\);/,
              'image.onerror = () => resolve();'
            )
            .replace(
              'if (!this.image) {',
              'if (!this.image || !this.image.complete || !this.image.naturalWidth) {'
            )
            .replace(renderVisualTimePattern, '$1$2$3\ttime,$2$3$4')
        }
        if (file === `${prefix}/components/ui/context-menu.tsx`) {
          const layerAnchor =
            'bg-popover text-popover-foreground z-50 min-w-48 overflow-hidden rounded-lg border shadow-xl py-2.5'
          const layerCount = code.split(layerAnchor).length - 1
          const subContentPattern =
            /(<ContextMenuPrimitive\.SubContent[\s\S]*?\t\t\{\.\.\.props\})(\r?\n\t\/>)/
          const contentPattern =
            /(<ContextMenuPrimitive\.Content[\s\S]*?\t\t\t\{\.\.\.props\})(\r?\n\t\t\/>)/
          if (layerCount !== 2 || !subContentPattern.test(code) || !contentPattern.test(code)) {
            throw new Error('Cutia 右键菜单弹层适配需要检查上游版本')
          }
          return code
            .replace(subContentPattern, '$1\n\t\tstyle={{ ...props.style, zIndex: 2000 }}$2')
            .replace(contentPattern, '$1\n\t\t\tstyle={{ ...props.style, zIndex: 2000 }}$2')
        }
        if (file === `${prefix}/components/editor/panels/timeline/timeline-element.tsx`) {
          const source =
            'src={`https://api.iconify.design/${element.iconName}.svg?width=20&height=20`}'
          const videoDurationAnchor = '\t\t\t\t\tduration={element.duration}'
          const contextMenuLayerAnchor = '<ContextMenuContent className="z-200 w-64">'
          const videoEditMenuPattern =
            /(\t\t\t\t\{element\.type === "video" && selectedElements\.length === 1 && \(\r?\n\t\t\t\t\t<VideoEditSubmenu[\s\S]*?\r?\n\t\t\t\t\)\})/
          const iconImportPattern =
            /import \{ ([^}\r\n]*\bDownload\b[^}\r\n]*) \} from "lucide-react";/
          if (
            !code.includes(source) ||
            !code.includes(videoDurationAnchor) ||
            !code.includes(contextMenuLayerAnchor) ||
            !videoEditMenuPattern.test(code) ||
            !iconImportPattern.test(code)
          )
            throw new Error('Cutia 时间线调节层适配需要检查上游版本')
          let adapted = code
            .replace(
              source,
              'src={(element as typeof element & { sourceUrl?: string }).sourceUrl || `https://api.iconify.design/${element.iconName}.svg?width=20&height=20`}\n\t\t\t\t\tdraggable={false}'
            )
            .replace(
              iconImportPattern,
              'import { $1, Images, SlidersHorizontal, UserRound, WandSparkles, Video, Box, Activity, Maximize2 } from "lucide-react";\nimport { isAdjustmentElement } from "@cutia-desktop/adjustment-layer";\nimport { VisualKeyframeMarkers } from "@cutia-desktop/visual-keyframe-control";\nimport { openFirstLastFrameVideoDirector, openImageToVideoDirector } from "@cutia-desktop/image-ai";\nimport { openCharacterReplacementDirector, openMotionTransferDirector, openRelayVSRDirector, openVideoModificationDirector, openVideoReferenceModificationDirector, openWhiteBodyVideoDirector } from "@cutia-desktop/video-ai";'
            )
            .replace(
              videoDurationAnchor,
              `${videoDurationAnchor}\n\t\t\t\t\tplaybackRate={element.playbackRate}\n\t\t\t\t\treversed={element.reversed}`
            )
            .replace(contextMenuLayerAnchor, '<ContextMenuContent className="w-64">')
            .replace(
              videoEditMenuPattern,
              `{element.type === "video" && selectedElements.length === 1 && mediaAsset && (\n\t\t\t\t\t<ContextMenuSub>\n\t\t\t\t\t\t<ContextMenuSubTrigger>\n\t\t\t\t\t\t\t<WandSparkles className="size-4" />\n\t\t\t\t\t\t\tAI\n\t\t\t\t\t\t</ContextMenuSubTrigger>\n\t\t\t\t\t\t<ContextMenuSubContent className="w-48">\n\t\t\t\t\t\t\t<ContextMenuItem\n\t\t\t\t\t\t\t\ticon={<Video className="size-4" />}\n\t\t\t\t\t\t\t\tonClick={(event) => {\n\t\t\t\t\t\t\t\t\tevent.stopPropagation();\n\t\t\t\t\t\t\t\t\topenVideoModificationDirector({\n\t\t\t\t\t\t\t\t\t\teditor,\n\t\t\t\t\t\t\t\t\t\telement: element as VideoElement,\n\t\t\t\t\t\t\t\t\t\tmediaAsset,\n\t\t\t\t\t\t\t\t\t});\n\t\t\t\t\t\t\t\t}}\n\t\t\t\t\t\t\t>\n\t\t\t\t\t\t\t\t\u89c6\u9891\u4fee\u6539\n\t\t\t\t\t\t\t</ContextMenuItem>\n\t\t\t\t\t\t\t<ContextMenuItem\n\t\t\t\t\t\t\t\ticon={<Images className="size-4" />}\n\t\t\t\t\t\t\t\tonClick={(event) => {\n\t\t\t\t\t\t\t\t\tevent.stopPropagation();\n\t\t\t\t\t\t\t\t\topenVideoReferenceModificationDirector({\n\t\t\t\t\t\t\t\t\t\teditor,\n\t\t\t\t\t\t\t\t\t\telement: element as VideoElement,\n\t\t\t\t\t\t\t\t\t\tmediaAsset,\n\t\t\t\t\t\t\t\t\t});\n\t\t\t\t\t\t\t\t}}\n\t\t\t\t\t\t\t>\n\t\t\t\t\t\t\t\t\u591a\u53c2\u8003\u7f16\u8f91\n\t\t\t\t\t\t\t</ContextMenuItem>\n\t\t\t\t\t\t\t<ContextMenuItem\n\t\t\t\t\t\t\t\ticon={<UserRound className="size-4" />}\n\t\t\t\t\t\t\t\tonClick={(event) => {\n\t\t\t\t\t\t\t\t\tevent.stopPropagation();\n\t\t\t\t\t\t\t\t\topenCharacterReplacementDirector({\n\t\t\t\t\t\t\t\t\t\teditor,\n\t\t\t\t\t\t\t\t\t\telement: element as VideoElement,\n\t\t\t\t\t\t\t\t\t\tmediaAsset,\n\t\t\t\t\t\t\t\t\t});\n\t\t\t\t\t\t\t\t}}\n\t\t\t\t\t\t\t>\n\t\t\t\t\t\t\t\t\u4eba\u7269\u66ff\u6362\n\t\t\t\t\t\t\t</ContextMenuItem>\n\t\t\t\t\t\t\t<ContextMenuItem\n\t\t\t\t\t\t\t\ticon={<Box className="size-4" />}\n\t\t\t\t\t\t\t\tonClick={(event) => {\n\t\t\t\t\t\t\t\t\tevent.stopPropagation();\n\t\t\t\t\t\t\t\t\topenWhiteBodyVideoDirector({\n\t\t\t\t\t\t\t\t\t\teditor,\n\t\t\t\t\t\t\t\t\t\telement: element as VideoElement,\n\t\t\t\t\t\t\t\t\t\tmediaAsset,\n\t\t\t\t\t\t\t\t\t});\n\t\t\t\t\t\t\t\t}}\n\t\t\t\t\t\t\t>\n\t\t\t\t\t\t\t\t视频转白模\n\t\t\t\t\t\t\t</ContextMenuItem>\n\t\t\t\t\t\t\t<ContextMenuItem\n\t\t\t\t\t\t\t\ticon={<Activity className="size-4" />}\n\t\t\t\t\t\t\t\tonClick={(event) => {\n\t\t\t\t\t\t\t\t\tevent.stopPropagation();\n\t\t\t\t\t\t\t\t\topenMotionTransferDirector({\n\t\t\t\t\t\t\t\t\t\teditor,\n\t\t\t\t\t\t\t\t\t\telement: element as VideoElement,\n\t\t\t\t\t\t\t\t\t\tmediaAsset,\n\t\t\t\t\t\t\t\t\t});\n\t\t\t\t\t\t\t\t}}\n\t\t\t\t\t\t\t>\n\t\t\t\t\t\t\t\t动作迁移\n\t\t\t\t\t\t\t</ContextMenuItem>\n\t\t\t\t\t\t\t<ContextMenuItem\n\t\t\t\t\t\t\t\ticon={<Maximize2 className="size-4" />}\n\t\t\t\t\t\t\t\tonClick={(event) => {\n\t\t\t\t\t\t\t\t\tevent.stopPropagation();\n\t\t\t\t\t\t\t\t\topenRelayVSRDirector({ editor, element: element as VideoElement, mediaAsset });\n\t\t\t\t\t\t\t\t}}\n\t\t\t\t\t\t\t>\n\t\t\t\t\t\t\t\t视频放大\n\t\t\t\t\t\t\t</ContextMenuItem>\n\t\t\t\t\t\t</ContextMenuSubContent>\n\t\t\t\t\t</ContextMenuSub>\n\t\t\t\t)}\n\t\t\t\t$1`
            )
          const imageAiMenuAnchor =
            /(\t\t\t\t\{element\.type === "video" && selectedElements\.length === 1 && \(\r?\n\t\t\t\t\t<VideoEditSubmenu)/
          if (!imageAiMenuAnchor.test(adapted)) {
            throw new Error('Cutia 图片 AI 菜单适配需要检查上游版本')
          }
          adapted = adapted.replace(
            imageAiMenuAnchor,
            `{element.type === "image" && selectedElements.length === 1 && mediaAsset && (\n\t\t\t\t\t<ContextMenuSub>\n\t\t\t\t\t\t<ContextMenuSubTrigger>\n\t\t\t\t\t\t\t<WandSparkles className="size-4" />\n\t\t\t\t\t\t\tAI\n\t\t\t\t\t\t</ContextMenuSubTrigger>\n\t\t\t\t\t\t<ContextMenuSubContent className="w-48">\n\t\t\t\t\t\t\t<ContextMenuItem\n\t\t\t\t\t\t\t\ticon={<Images className="size-4" />}\n\t\t\t\t\t\t\t\tonClick={(event) => {\n\t\t\t\t\t\t\t\t\tevent.stopPropagation();\n\t\t\t\t\t\t\t\t\topenImageToVideoDirector({\n\t\t\t\t\t\t\t\t\t\teditor,\n\t\t\t\t\t\t\t\t\t\telement: element as import("@/types/timeline").ImageElement,\n\t\t\t\t\t\t\t\t\t\tmediaAsset,\n\t\t\t\t\t\t\t\t\t});\n\t\t\t\t\t\t\t\t}}\n\t\t\t\t\t\t\t>\n\t\t\t\t\t\t\t\t\u56fe\u751f\u89c6\u9891\n\t\t\t\t\t\t\t</ContextMenuItem>\n\t\t\t\t\t\t\t<ContextMenuItem\n\t\t\t\t\t\t\t\ticon={<Images className="size-4" />}\n\t\t\t\t\t\t\t\tonClick={(event) => {\n\t\t\t\t\t\t\t\t\tevent.stopPropagation();\n\t\t\t\t\t\t\t\t\topenFirstLastFrameVideoDirector({\n\t\t\t\t\t\t\t\t\t\teditor,\n\t\t\t\t\t\t\t\t\t\telement: element as import("@/types/timeline").ImageElement,\n\t\t\t\t\t\t\t\t\t\tmediaAsset,\n\t\t\t\t\t\t\t\t\t});\n\t\t\t\t\t\t\t\t}}\n\t\t\t\t\t\t\t>\n\t\t\t\t\t\t\t\t\u9996\u5c3e\u5e27\u751f\u89c6\u9891\n\t\t\t\t\t\t\t</ContextMenuItem>\n\t\t\t\t\t\t</ContextMenuSubContent>\n\t\t\t\t\t</ContextMenuSub>\n\t\t\t\t)}\n\t\t\t\t$1`
          )
          const elementRoot =
            /(\t\t\t\t<div\r?\n)(\t\t\t\t\t)(className=\{`absolute top-0 h-full select-none \$\{)/
          if (!elementRoot.test(adapted))
            throw new Error('Cutia 时间线特效目标适配需要检查上游版本')
          adapted = adapted.replace(
            elementRoot,
            '$1$2data-timeline-track-id={track.id}\n$2data-timeline-element-id={element.id}\n$2$3'
          )
          adapted = adapted.replace(
            /\$\{getTrackClasses\(\s*\{\s*type: track\.type,\s*\},\s*\)\}/,
            '${isAdjustmentElement(element) ? "desktop-adjustment-element" : getTrackClasses({ type: track.type })}'
          )
          adapted = adapted.replace(
            '\tif (element.type === "text") {',
            `\tif (isAdjustmentElement(element)) {
\t\treturn (
\t\t\t<div className="desktop-adjustment-content">
\t\t\t\t<SlidersHorizontal size={14} />
\t\t\t\t<span>{element.name || "调节层"}</span>
\t\t\t</div>
\t\t);
\t}

\tif (element.type === "text") {`
          )
          adapted = adapted.replace(
            'selectedElements.length === 1 && hasMediaId(element) && (',
            'selectedElements.length === 1 && hasMediaId(element) && !isAdjustmentElement(element) && ('
          )
          const elementContentPattern = /(\t\t\t\t\t<ElementInner[\s\S]*?\r?\n\t\t\t\t\t\/>)/
          if (!elementContentPattern.test(adapted)) {
            throw new Error('Cutia 时间线关键帧标记适配需要检查上游版本')
          }
          adapted = adapted.replace(
            elementContentPattern,
            '$1\n\t\t\t\t\t{isSelected && (element.type === "video" || element.type === "image" || element.type === "sticker" || element.type === "text") && (\n\t\t\t\t\t\t<VisualKeyframeMarkers editor={editor} element={element} />\n\t\t\t\t\t)}'
          )
          return adapted
        }
        if (file === `${prefix}/components/editor/panels/timeline/video-thumbnail-strip.tsx`) {
          const importAnchor =
            'import { timelineThumbnailCache } from "@/services/timeline-thumbnail/service";'
          const durationPropertyAnchor = '\tduration: number;'
          const durationArgumentAnchor = '\tduration,\n\telementWidth,'
          const frameTimeAnchor = `\t\t\t\tconst timeOffset = (i * tileWidth) / pixelsPerSecond;
\t\t\t\tconst videoTime = trimStart + timeOffset;
\t\t\t\tconst frameTime = Math.min(videoTime, trimStart + duration);`
          const dependencyAnchor = '\t\tduration,\n\t\telementWidth,'
          const normalized = code.replace(/\r\n/g, '\n')
          if (
            !normalized.includes(importAnchor) ||
            !normalized.includes(durationPropertyAnchor) ||
            !normalized.includes(durationArgumentAnchor) ||
            !normalized.includes(frameTimeAnchor) ||
            !normalized.includes(dependencyAnchor)
          ) {
            throw new Error('Cutia 倒放缩略图适配需要检查上游版本')
          }
          return normalized
            .replace(
              importAnchor,
              `${importAnchor}\nimport { getVisualSourceTime } from "@/lib/timeline/element-utils";`
            )
            .replace(
              durationPropertyAnchor,
              `${durationPropertyAnchor}\n\tplaybackRate?: number;\n\treversed?: boolean;`
            )
            .replace(
              durationArgumentAnchor,
              '\tduration,\n\tplaybackRate = 1,\n\treversed = false,\n\telementWidth,'
            )
            .replace(
              frameTimeAnchor,
              `\t\t\t\tconst timeOffset = (i * tileWidth) / pixelsPerSecond;
\t\t\t\tconst videoTime = getVisualSourceTime({
\t\t\t\t\ttimelineTime: timeOffset,
\t\t\t\t\tstartTime: 0,
\t\t\t\t\tduration,
\t\t\t\t\ttrimStart,
\t\t\t\t\tplaybackRate,
\t\t\t\t\treversed,
\t\t\t\t});
\t\t\t\tconst frameTime = Math.max(
\t\t\t\t\ttrimStart,
\t\t\t\t\tMath.min(videoTime, trimStart + duration * playbackRate),
\t\t\t\t);`
            )
            .replace(
              dependencyAnchor,
              '\t\tduration,\n\t\tplaybackRate,\n\t\treversed,\n\t\telementWidth,'
            )
        }
        if (file === `${prefix}/components/editor/panels/timeline/index.tsx`) {
          const iconAnchor = '\tTaskAdd02Icon,'
          const importAnchor = 'import { useTranslation } from "@i18next-toolkit/nextjs-approuter";'
          const timelineSyncAnchor = '\tconst timelineDuration = getPreviewDuration(editor) || 0;'
          const timelineZoomPattern =
            /\tconst \{ zoomLevel, setZoomLevel, handleWheel, saveScrollPosition \} =\r?\n\t\tuseTimelineZoom\(\{[\s\S]*?\r?\n\t\t\}\);/
          const timelineZoomAnchor = code.match(timelineZoomPattern)?.[0]
          const trackIconPattern =
            /function TrackIcon\(\{ track \}: \{ track: TimelineTrack \}\) \{\r?\n\treturn <>\{TRACK_ICONS\[track\.type\]\}<\/>;\r?\n\}/
          const trackIconAnchor = code.match(trackIconPattern)?.[0]
          if (
            !trackIconAnchor ||
            !code.includes(iconAnchor) ||
            !code.includes(importAnchor) ||
            !code.includes(timelineSyncAnchor) ||
            !timelineZoomAnchor
          ) {
            throw new Error('Cutia 调节轨道标识适配需要检查上游版本')
          }
          return code
            .replace(iconAnchor, `${iconAnchor}\n\tSlidersHorizontalIcon,`)
            .replace(
              importAnchor,
              `${importAnchor}\nimport { isAdjustmentTrack } from "@cutia-desktop/adjustment-layer";\nimport { useTimelineViewportSync } from "@cutia-desktop/timeline-sync";`
            )
            .replace(
              timelineZoomAnchor,
              `${timelineZoomAnchor}\n\n\tuseTimelineViewportSync(zoomLevel, tracksScrollRef, timelineDuration);`
            )
            .replace(
              '{canTracktHaveAudio(track) && (',
              '{canTracktHaveAudio(track) && !isAdjustmentTrack(track) && ('
            )
            .replace(
              trackIconAnchor,
              `function TrackIcon({ track }: { track: TimelineTrack }) {
\tif (isAdjustmentTrack(track)) {
\t\treturn (
\t\t\t<HugeiconsIcon
\t\t\t\ticon={SlidersHorizontalIcon}
\t\t\t\tclassName="text-[#d5ad54] size-4 shrink-0"
\t\t\t/>
\t\t);
\t}
\treturn <>{TRACK_ICONS[track.type]}</>;
}`
            )
        }
        if (file === `${prefix}/constants/transition-constants.ts`) {
          const labels: Record<string, string> = {
            Fade: '淡入淡出',
            Dissolve: '叠化',
            'Wipe Left': '向左擦除',
            'Wipe Right': '向右擦除',
            'Wipe Up': '向上擦除',
            'Wipe Down': '向下擦除',
            'Slide Left': '向左滑动',
            'Slide Right': '向右滑动',
            'Slide Up': '向上滑动',
            'Slide Down': '向下滑动',
            'Zoom In': '放大',
            'Zoom Out': '缩小',
            Wipe: '擦除',
            Slide: '滑动',
            Zoom: '缩放'
          }
          if (!code.includes('label: "Fade"') || !code.includes('label: "Zoom Out"')) {
            throw new Error('Cutia 转场名称适配需要检查上游版本')
          }
          return Object.entries(labels).reduce(
            (adapted, [english, chinese]) => adapted.replaceAll(`"${english}"`, `"${chinese}"`),
            code
          )
        }
        if (
          file === `${prefix}/components/editor/panels/timeline/timeline-transition-overlay.tsx`
        ) {
          const emptyJunctionStart = '\t// no transition: show a small "+" button at the junction'
          const transitionOverlayStart =
            '\t// has transition: show a resizable overlay centered on the junction'
          if (
            !code.includes('>Transitions</span>') ||
            !code.includes('Remove transition') ||
            !code.includes(emptyJunctionStart) ||
            !code.includes(transitionOverlayStart) ||
            !code.includes('function PlusIcon()')
          ) {
            throw new Error('Cutia 时间线转场菜单适配需要检查上游版本')
          }
          let adapted = code
            .replace('>Transitions</span>', '>转场</span>')
            .replace('Remove transition', '删除转场')
            .replace('Resize transition left', '调整转场左边界')
            .replace('Resize transition right', '调整转场右边界')
            .replace(
              '${transition.type} (${displayDuration.toFixed(1)}s)',
              '${(transition as any).shaderName || transition.type} (${displayDuration.toFixed(1)}s)'
            )
            .replace('<title>Transition</title>', '<title>转场</title>')

          const emptyJunctionIndex = adapted.indexOf(emptyJunctionStart)
          const transitionOverlayIndex = adapted.indexOf(transitionOverlayStart, emptyJunctionIndex)
          adapted = `${adapted.slice(0, emptyJunctionIndex)}\tif (!transition) return null;\n\n${adapted.slice(transitionOverlayIndex)}`

          const withoutUnusedPlusIcon = adapted.replace(
            /\r?\nfunction PlusIcon\(\) \{[\s\S]*?\r?\n\}\r?\n?$/,
            '\n'
          )
          if (withoutUnusedPlusIcon === adapted) {
            throw new Error('Cutia 时间线转场加号移除适配需要检查上游版本')
          }
          return withoutUnusedPlusIcon
        }
        if (file === `${prefix}/components/editable-timecode.tsx`) {
          // React's synthetic event methods require their event receiver.
          return code
            .replace(
              /\{\s*key,\s*preventDefault,\s*\}: React.KeyboardEvent<(HTMLInputElement|HTMLButtonElement)>/g,
              'event: React.KeyboardEvent<$1>'
            )
            .replaceAll('if (key ===', 'if (event.key ===')
            .replaceAll('|| key ===', '|| event.key ===')
            .replaceAll('preventDefault();', 'event.preventDefault();')
        }
        if (file === `${prefix}/components/editor/panels/properties/text-properties.tsx`) {
          const importAnchor = 'import { useEditor } from "@/hooks/use-editor";'
          const renderAnchor = '\tconst [, forceRender] = useReducer((x: number) => x + 1, 0);'
          const batchUpdatePattern =
            /\tconst buildBatchUpdates = \(updates: Partial<Record<string, unknown>>\) =>\r?\n\t\telementRefs\.map\(\(ref\) => \(\{\r?\n\t\t\ttrackId: ref\.trackId,\r?\n\t\t\telementId: ref\.element\.id,\r?\n\t\t\tupdates,\r?\n\t\t\}\)\);/
          if (
            !code.includes(importAnchor) ||
            !code.includes(renderAnchor) ||
            !batchUpdatePattern.test(code)
          ) {
            throw new Error('Cutia 文字关键帧属性适配需要检查上游版本')
          }

          let adapted = code
            .replace('import { TextSpeechPanel } from "./text-speech-panel";', '')
            .replace(/\s*<TabsTrigger value="speech">\{t\("Speech"\)\}<\/TabsTrigger>/, '')
            .replace(
              /\s*<TabsContent value="speech" className="mt-0 flex-1 overflow-auto">\s*<TextSpeechPanel elements=\{elementRefs\} \/>\s*<\/TabsContent>/,
              ''
            )
            .replace(
              importAnchor,
              `${importAnchor}\nimport { VisualKeyframeControl } from "@cutia-desktop/visual-keyframe-control";\nimport { createVisualPropertyUpdate, resolveTextVisualState, type VisualKeyframeProperty } from "@cutia-desktop/visual-keyframes";`
            )
            .replace(
              renderAnchor,
              `${renderAnchor}\n\tconst visualState = resolveTextVisualState({ source: element, timelineTime: editor.playback.getCurrentTime() });`
            )
            .replace(
              batchUpdatePattern,
              `\tconst buildBatchUpdates = (updates: Partial<Record<string, unknown>>) =>
\t\telementRefs.map((ref) => {
\t\t\tconst keys = Object.keys(updates);
\t\t\tconst property = keys.length === 1 && keys[0] === "fontSize"
\t\t\t\t? "fontSize"
\t\t\t\t: keys.length === 1 && keys[0] === "opacity"
\t\t\t\t\t? "opacity"
\t\t\t\t\t: null;
\t\t\treturn {
\t\t\t\ttrackId: ref.trackId,
\t\t\t\telementId: ref.element.id,
\t\t\t\tupdates: property
\t\t\t\t\t? createVisualPropertyUpdate({
\t\t\t\t\t\tsource: ref.element,
\t\t\t\t\t\tproperty,
\t\t\t\t\t\ttimelineTime: editor.playback.getCurrentTime(),
\t\t\t\t\t\tvalue: updates[property] as number,
\t\t\t\t\t})
\t\t\t\t\t: updates,
\t\t\t};
\t\t});`
            )

          const updateTransformPattern =
            /\tconst updateTransform = \(\{[\s\S]*?\n\t\};\r?\n\r?\n(?=\tconst strokeEnabled)/
          if (!updateTransformPattern.test(adapted)) {
            throw new Error('Cutia 文字变换关键帧更新适配需要检查上游版本')
          }
          adapted = adapted.replace(
            updateTransformPattern,
            `\tconst updateTransform = ({
\t\tupdates: transformUpdates,
\t\tpushHistory = true,
\t}: {
\t\tupdates: Partial<Transform>;
\t\tpushHistory?: boolean;
\t}) => {
\t\tlet property: VisualKeyframeProperty;
\t\tlet value: number;
\t\tif (transformUpdates.scale !== undefined) {
\t\t\tproperty = "scale";
\t\t\tvalue = transformUpdates.scale;
\t\t} else if (transformUpdates.rotate !== undefined) {
\t\t\tproperty = "rotation";
\t\t\tvalue = transformUpdates.rotate;
\t\t} else if (transformUpdates.position) {
\t\t\tconst editingY = isEditingPosY.current || initialPosYRef.current !== null;
\t\t\tproperty = editingY ? "positionY" : "positionX";
\t\t\tvalue = editingY ? transformUpdates.position.y : transformUpdates.position.x;
\t\t} else {
\t\t\treturn;
\t\t}
\t\teditor.timeline.updateElements({
\t\t\tupdates: elementRefs.map((ref) => ({
\t\t\t\ttrackId: ref.trackId,
\t\t\t\telementId: ref.element.id,
\t\t\t\tupdates: createVisualPropertyUpdate({
\t\t\t\t\tsource: ref.element,
\t\t\t\t\tproperty,
\t\t\t\t\ttimelineTime: editor.playback.getCurrentTime(),
\t\t\t\t\tvalue,
\t\t\t\t}),
\t\t\t})),
\t\t\tpushHistory,
\t\t});
\t};

`
          )

          const updateShadowPattern =
            /\tconst updateShadow = \(\{[\s\S]*?\n\t\};\r?\n\r?\n(?=\tconst handleFontSizeChange)/
          if (!updateShadowPattern.test(adapted)) {
            throw new Error('Cutia 文字阴影关键帧更新适配需要检查上游版本')
          }
          adapted = adapted.replace(
            updateShadowPattern,
            `\tconst updateShadow = ({
\t\tshadow,
\t\tproperty,
\t\tpushHistory = true,
\t}: {
\t\tshadow: TextShadow | undefined;
\t\tproperty?: "shadowOffsetX" | "shadowOffsetY" | "shadowBlur";
\t\tpushHistory?: boolean;
\t}) => {
\t\teditor.timeline.updateElements({
\t\t\tupdates: elementRefs.map((ref) => ({
\t\t\t\ttrackId: ref.trackId,
\t\t\t\telementId: ref.element.id,
\t\t\t\tupdates: property && shadow
\t\t\t\t\t? createVisualPropertyUpdate({
\t\t\t\t\t\tsource: ref.element,
\t\t\t\t\t\tproperty,
\t\t\t\t\t\ttimelineTime: editor.playback.getCurrentTime(),
\t\t\t\t\t\tvalue: property === "shadowOffsetX"
\t\t\t\t\t\t\t? shadow.offsetX
\t\t\t\t\t\t\t: property === "shadowOffsetY"
\t\t\t\t\t\t\t\t? shadow.offsetY
\t\t\t\t\t\t\t\t: shadow.blur,
\t\t\t\t\t})
\t\t\t\t\t: { shadow },
\t\t\t})),
\t\t\tpushHistory,
\t\t});
\t};

`
          )

          const shadowSections: Array<
            [string, string, 'shadowOffsetX' | 'shadowOffsetY' | 'shadowBlur']
          > = [
            [
              '<PropertyItemLabel>{t("Offset X")}</PropertyItemLabel>',
              '<PropertyItemLabel>{t("Offset Y")}</PropertyItemLabel>',
              'shadowOffsetX'
            ],
            [
              '<PropertyItemLabel>{t("Offset Y")}</PropertyItemLabel>',
              '<PropertyItemLabel>{t("Blur")}</PropertyItemLabel>',
              'shadowOffsetY'
            ],
            [
              '<PropertyItemLabel>{t("Blur")}</PropertyItemLabel>',
              '<PropertyGroup title={t("Transform")}>',
              'shadowBlur'
            ]
          ]
          for (const [startAnchor, endAnchor, property] of shadowSections) {
            const start = adapted.indexOf(startAnchor)
            const end = adapted.indexOf(endAnchor, start + startAnchor.length)
            if (start < 0 || end < 0) {
              throw new Error(`Cutia 文字${property}关键帧更新适配需要检查上游版本`)
            }
            const section = adapted
              .slice(start, end)
              .replaceAll('updateShadow({', `updateShadow({ property: "${property}",`)
            adapted = adapted.slice(0, start) + section + adapted.slice(end)
          }

          adapted = adapted
            .replaceAll('element.fontSize', 'visualState.fontSize')
            .replaceAll('element.opacity', 'visualState.opacity')
            .replaceAll('element.transform', 'visualState.transform')
            .replace(
              'const currentShadow: TextShadow = element.shadow ?? {',
              'const currentShadow: TextShadow = visualState.shadow ?? {'
            )

          const keyframeLabels: Array<[string, string, string]> = [
            ['Font size', 'fontSize', '字体大小'],
            ['Opacity', 'opacity', '不透明度'],
            ['Offset X', 'shadowOffsetX', '阴影偏移 X'],
            ['Offset Y', 'shadowOffsetY', '阴影偏移 Y'],
            ['Blur', 'shadowBlur', '阴影模糊'],
            ['Position X', 'positionX', '位置 X'],
            ['Position Y', 'positionY', '位置 Y'],
            ['Scale', 'scale', '缩放'],
            ['Rotation', 'rotation', '旋转']
          ]
          for (const [translationKey, property, label] of keyframeLabels) {
            const labelAnchor = `<PropertyItemLabel>{t("${translationKey}")}</PropertyItemLabel>`
            if (!adapted.includes(labelAnchor)) {
              throw new Error(`Cutia 文字${label}关键帧按钮适配需要检查上游版本`)
            }
            adapted = adapted.replace(
              labelAnchor,
              `<div className="flex items-center"><PropertyItemLabel>{t("${translationKey}")}</PropertyItemLabel><VisualKeyframeControl editor={editor} element={element} trackId={elementRefs[0].trackId} property="${property}" label="${label}" /></div>`
            )
          }
          return adapted
        }
        if (file === `${prefix}/components/editor/panels/properties/sticker-properties.tsx`) {
          const importAnchor = 'import { useEditor } from "@/hooks/use-editor";'
          const renderAnchor = '\tconst [, forceRender] = useReducer((x: number) => x + 1, 0);'
          if (!code.includes(importAnchor) || !code.includes(renderAnchor)) {
            throw new Error('Cutia 贴纸关键帧属性适配需要检查上游版本')
          }
          let adapted = code
            .replace(
              importAnchor,
              `${importAnchor}\nimport { VisualKeyframeControl } from "@cutia-desktop/visual-keyframe-control";\nimport { createVisualPropertyUpdate, resolveVisualState } from "@cutia-desktop/visual-keyframes";`
            )
            .replace(
              renderAnchor,
              `${renderAnchor}\n\tconst visualState = resolveVisualState({ source: element, timelineTime: editor.playback.getCurrentTime() });`
            )

          const updateTransformPattern =
            /\tconst updateTransform = \(\{[\s\S]*?\n\t\};\r?\n\r?\n(?=\tconst commitNumberField)/
          if (!updateTransformPattern.test(adapted)) {
            throw new Error('Cutia 贴纸关键帧变换更新适配需要检查上游版本')
          }
          adapted = adapted.replace(
            updateTransformPattern,
            `\tconst updateTransform = ({
\t\tupdates,
\t\tpushHistory = true,
\t}: {
\t\tupdates: Partial<typeof visualState.transform>;
\t\tpushHistory?: boolean;
\t}) => {
\t\tlet property: "positionX" | "positionY" | "scale" | "rotation";
\t\tlet value: number;
\t\tif (updates.scale !== undefined) {
\t\t\tproperty = "scale";
\t\t\tvalue = updates.scale;
\t\t} else if (updates.rotate !== undefined) {
\t\t\tproperty = "rotation";
\t\t\tvalue = updates.rotate;
\t\t} else if (updates.position) {
\t\t\tconst editingY = isEditingPosY.current || initialPosYRef.current !== null;
\t\t\tproperty = editingY ? "positionY" : "positionX";
\t\t\tvalue = editingY ? updates.position.y : updates.position.x;
\t\t} else {
\t\t\treturn;
\t\t}
\t\teditor.timeline.updateElements({
\t\t\tupdates: [{
\t\t\t\ttrackId,
\t\t\t\telementId: element.id,
\t\t\t\tupdates: createVisualPropertyUpdate({
\t\t\t\t\tsource: element,
\t\t\t\t\tproperty,
\t\t\t\t\ttimelineTime: editor.playback.getCurrentTime(),
\t\t\t\t\tvalue,
\t\t\t\t}),
\t\t\t}],
\t\t\tpushHistory,
\t\t});
\t};

\tconst updateOpacity = ({ value, pushHistory }: { value: number; pushHistory: boolean }) => {
\t\teditor.timeline.updateElements({
\t\t\tupdates: [{
\t\t\t\ttrackId,
\t\t\t\telementId: element.id,
\t\t\t\tupdates: createVisualPropertyUpdate({
\t\t\t\t\tsource: element,
\t\t\t\t\tproperty: "opacity",
\t\t\t\t\ttimelineTime: editor.playback.getCurrentTime(),
\t\t\t\t\tvalue,
\t\t\t\t}),
\t\t\t}],
\t\t\tpushHistory,
\t\t});
\t};

`
          )

          const opacityUpdatePattern =
            /updateElement\(\{\s*updates:\s*\{\s*opacity:\s*([^,}\r\n]+),?\s*\},\s*pushHistory:\s*(false|true),\s*\}\);/g
          const opacityUpdateCount = [...adapted.matchAll(opacityUpdatePattern)].length
          if (opacityUpdateCount !== 6) {
            throw new Error('Cutia 贴纸不透明度关键帧更新适配需要检查上游版本')
          }
          adapted = adapted.replace(
            opacityUpdatePattern,
            'updateOpacity({ value: $1, pushHistory: $2 });'
          )

          adapted = adapted
            .replaceAll('element.transform', 'visualState.transform')
            .replaceAll('element.opacity', 'visualState.opacity')

          const keyframeLabels: Array<[string, string, string]> = [
            ['Position X', 'positionX', '位置 X'],
            ['Position Y', 'positionY', '位置 Y'],
            ['Scale', 'scale', '缩放'],
            ['Rotation', 'rotation', '旋转'],
            ['Opacity', 'opacity', '不透明度']
          ]
          for (const [translationKey, property, label] of keyframeLabels) {
            const labelAnchor = `<PropertyItemLabel>{t("${translationKey}")}</PropertyItemLabel>`
            if (!adapted.includes(labelAnchor)) {
              throw new Error(`Cutia 贴纸${label}关键帧按钮适配需要检查上游版本`)
            }
            adapted = adapted.replace(
              labelAnchor,
              `<div className="flex items-center"><PropertyItemLabel>{t("${translationKey}")}</PropertyItemLabel><VisualKeyframeControl editor={editor} element={element} trackId={trackId} property="${property}" label="${label}" /></div>`
            )
          }

          return adapted
        }
        if (file === `${prefix}/components/editor/panels/properties/video-properties.tsx`) {
          const importAnchor = 'import { useEditor } from "@/hooks/use-editor";'
          const contentAnchor = '\t\t\t\t{isVideoElement && ('
          if (!code.includes(importAnchor) || !code.includes(contentAnchor)) {
            throw new Error('Cutia 片段特效属性适配需要检查上游版本')
          }
          let adapted = code.replace(
            importAnchor,
            `${importAnchor}\nimport { ClipEffectsProperties } from "@cutia-desktop/clip-effects-properties";\nimport { ClipFilterProperties } from "@cutia-desktop/clip-filter-properties";\nimport { CutoutProperties } from "@cutia-desktop/cutout-properties";\nimport { MaskProperties } from "@cutia-desktop/mask-properties";\nimport { BeautyProperties } from "@cutia-desktop/beauty-properties";\nimport { VisualKeyframeControl } from "@cutia-desktop/visual-keyframe-control";\nimport { createVisualPropertyUpdate, resolveVisualState } from "@cutia-desktop/visual-keyframes";\nimport { VideoPropertiesCategories } from "@cutia-desktop/video-properties-categories";`
          )
          const wrapCategories = (source: string): string => {
            const openingPattern = /\treturn \(\r?\n\t\t<div className="flex h-full flex-col">/
            const closingPattern = /\t\t<\/div>\r?\n\t\);\r?\n\}\r?\n?$/
            if (!openingPattern.test(source) || !closingPattern.test(source)) {
              throw new Error('Cutia 视频属性分类适配需要检查上游版本')
            }
            return source
              .replace(
                openingPattern,
                '\treturn (\n\t\t<VideoPropertiesCategories element={element} trackId={trackId}>\n\t\t<div className="flex h-full flex-col">'
              )
              .replace(closingPattern, '\t\t</div>\n\t\t</VideoPropertiesCategories>\n\t);\n}')
          }
          const markCategorySections = (source: string): string => {
            const sections = [
              {
                name: '基础变换',
                anchor:
                  '<PropertyGroup title={t("Transform")} hasBorderTop={false} collapsible={false}>',
                replacement:
                  '<PropertyGroup title={t("Transform")} hasBorderTop={false} collapsible={false} className="desktop-video-basic-properties">'
              },
              {
                name: '基础外观',
                anchor: '<PropertyGroup title={t("Appearance")} collapsible={false}>',
                replacement:
                  '<PropertyGroup title={t("Appearance")} collapsible={false} className="desktop-video-basic-properties">'
              },
              {
                name: '变速',
                anchor: '<PropertyGroup title={t("Speed")} collapsible={false}>',
                replacement:
                  '<PropertyGroup title={t("Speed")} collapsible={false} className="desktop-video-speed-properties">'
              }
            ]
            let marked = source
            for (const section of sections) {
              if (!marked.includes(section.anchor)) {
                throw new Error(`Cutia ${section.name}属性分类适配需要检查上游版本`)
              }
              marked = marked.replace(section.anchor, section.replacement)
            }
            return marked
          }
          const desktopAppearanceProperties =
            `        <div className="desktop-video-basic-properties">\n` +
            `          <ClipFilterProperties element={element} trackId={trackId} />\n` +
            `          <ClipEffectsProperties element={element} trackId={trackId} />\n` +
            `        </div>\n\n`
          const desktopCutoutProperties =
            `        <div className="desktop-video-cutout-properties h-full">\n` +
            `          <CutoutProperties element={element} trackId={trackId} />\n` +
            `        </div>\n\n`
          const desktopMaskProperties =
            `        <div className="desktop-video-mask-properties h-full">\n` +
            `          <MaskProperties element={element} trackId={trackId} />\n` +
            `        </div>\n\n`
          const desktopBeautyProperties =
            `        <div className="desktop-video-beauty-properties h-full">\n` +
            `          <BeautyProperties element={element} trackId={trackId} />\n` +
            `        </div>\n\n`
          const renderAnchor = '\tconst [, forceRender] = useReducer((x: number) => x + 1, 0);'
          if (!adapted.includes(renderAnchor)) {
            return wrapCategories(
              markCategorySections(
                adapted.replace(
                  contentAnchor,
                  `${desktopAppearanceProperties}${desktopCutoutProperties}${desktopMaskProperties}${desktopBeautyProperties}${contentAnchor}`
                )
              )
            )
          }
          adapted = adapted.replace(
            renderAnchor,
            `${renderAnchor}\n\tconst visualState = resolveVisualState({ source: element, timelineTime: editor.playback.getCurrentTime() });`
          )

          const updateTransformPattern =
            /\tconst updateTransform = \(\{[\s\S]*?\n\t\};\r?\n\r?\n(?=\tconst commitNumberField)/
          if (!updateTransformPattern.test(adapted)) {
            throw new Error('Cutia 视觉关键帧变换更新适配需要检查上游版本')
          }
          adapted = adapted.replace(
            updateTransformPattern,
            `\tconst updateTransform = ({
\t\tupdates,
\t\tpushHistory = true,
\t}: {
\t\tupdates: Partial<typeof visualState.transform>;
\t\tpushHistory?: boolean;
\t}) => {
\t\tlet property: "positionX" | "positionY" | "scale" | "rotation";
\t\tlet value: number;
\t\tif (updates.scale !== undefined) {
\t\t\tproperty = "scale";
\t\t\tvalue = updates.scale;
\t\t} else if (updates.rotate !== undefined) {
\t\t\tproperty = "rotation";
\t\t\tvalue = updates.rotate;
\t\t} else if (updates.position) {
\t\t\tconst editingY = isEditingPosY.current || initialPosYRef.current !== null;
\t\t\tproperty = editingY ? "positionY" : "positionX";
\t\t\tvalue = editingY ? updates.position.y : updates.position.x;
\t\t} else {
\t\t\treturn;
\t\t}
\t\teditor.timeline.updateElements({
\t\t\tupdates: [{
\t\t\t\ttrackId,
\t\t\t\telementId: element.id,
\t\t\t\tupdates: createVisualPropertyUpdate({
\t\t\t\t\tsource: element,
\t\t\t\t\tproperty,
\t\t\t\t\ttimelineTime: editor.playback.getCurrentTime(),
\t\t\t\t\tvalue,
\t\t\t\t}),
\t\t\t}],
\t\t\tpushHistory,
\t\t});
\t};

\tconst updateOpacity = ({ value, pushHistory }: { value: number; pushHistory: boolean }) => {
\t\teditor.timeline.updateElements({
\t\t\tupdates: [{
\t\t\t\ttrackId,
\t\t\t\telementId: element.id,
\t\t\t\tupdates: createVisualPropertyUpdate({
\t\t\t\t\tsource: element,
\t\t\t\t\tproperty: "opacity",
\t\t\t\t\ttimelineTime: editor.playback.getCurrentTime(),
\t\t\t\t\tvalue,
\t\t\t\t}),
\t\t\t}],
\t\t\tpushHistory,
\t\t});
\t};

`
          )

          const opacityUpdatePattern =
            /editor\.timeline\.updateElements\(\{\s*updates:\s*\[\s*\{\s*trackId,\s*elementId: element\.id,\s*updates: \{ opacity: ([^}\r\n]+) \},\s*\},\s*\],\s*pushHistory: (false|true),\s*\}\);/g
          const opacityUpdateCount = [...adapted.matchAll(opacityUpdatePattern)].length
          if (opacityUpdateCount !== 6) {
            throw new Error('Cutia 不透明度关键帧更新适配需要检查上游版本')
          }
          adapted = adapted.replace(
            opacityUpdatePattern,
            'updateOpacity({ value: $1, pushHistory: $2 });'
          )

          adapted = adapted
            .replaceAll('element.transform', 'visualState.transform')
            .replaceAll('element.opacity', 'visualState.opacity')

          const keyframeLabels: Array<[string, string, string]> = [
            ['Position X', 'positionX', '位置 X'],
            ['Position Y', 'positionY', '位置 Y'],
            ['Scale', 'scale', '缩放'],
            ['Rotation', 'rotation', '旋转'],
            ['Opacity', 'opacity', '不透明度']
          ]
          for (const [translationKey, property, label] of keyframeLabels) {
            const labelAnchor = `<PropertyItemLabel>{t("${translationKey}")}</PropertyItemLabel>`
            if (!adapted.includes(labelAnchor)) {
              throw new Error(`Cutia ${label}关键帧按钮适配需要检查上游版本`)
            }
            adapted = adapted.replace(
              labelAnchor,
              `<div className="flex items-center"><PropertyItemLabel>{t("${translationKey}")}</PropertyItemLabel><VisualKeyframeControl editor={editor} element={element} trackId={trackId} property="${property}" label="${label}" /></div>`
            )
          }

          return wrapCategories(
            markCategorySections(
              adapted.replace(
                contentAnchor,
                `${desktopAppearanceProperties}${desktopCutoutProperties}${desktopMaskProperties}${desktopBeautyProperties}${contentAnchor}`
              )
            )
          )
        }
        if (file === `${prefix}/components/editor/panels/properties/index.tsx`) {
          const audioPropertiesImportAnchor =
            'import { AudioProperties } from "./audio-properties";'
          const importAnchor =
            'import type { TimelineElement, TimelineTrack } from "@/types/timeline";'
          const groupAnchor = 'const key = item.element.type;'
          const renderAnchor = '\t\t\t\t\t{grouped.video && grouped.video.length > 0 && ('
          const textPropertiesPattern = /(<TextProperties[\s\S]*?\/>)/
          const stickerPropertiesPattern = /(<StickerProperties[\s\S]*?\/>)/
          if (
            !code.includes(audioPropertiesImportAnchor) ||
            !code.includes(importAnchor) ||
            !code.includes(groupAnchor) ||
            !code.includes(renderAnchor) ||
            !textPropertiesPattern.test(code) ||
            !stickerPropertiesPattern.test(code)
          ) {
            throw new Error('Cutia 属性面板适配需要检查上游版本')
          }
          let adapted = code
            .replace(
              audioPropertiesImportAnchor,
              'import { AudioPropertiesCategories as AudioProperties } from "@cutia-desktop/audio-properties-categories";'
            )
            .replace(
              importAnchor,
              `${importAnchor}\nimport { AdjustmentProperties } from "@cutia-desktop/adjustment-properties";\nimport { isAdjustmentElement } from "@cutia-desktop/adjustment-layer";\nimport { TrackingPropertiesCategories } from "@cutia-desktop/tracking-properties-categories";`
            )
            .replace(
              groupAnchor,
              'const key = isAdjustmentElement(item.element) ? "adjustment" : item.element.type;'
            )
            .replace(
              renderAnchor,
              `\t\t\t\t\t{grouped.adjustment && grouped.adjustment.length > 0 && (
\t\t\t\t\t\t<AdjustmentProperties
\t\t\t\t\t\t\telement={grouped.adjustment[0].element}
\t\t\t\t\t\t\ttrackId={grouped.adjustment[0].track.id}
\t\t\t\t\t\t/>
\t\t\t\t\t)}
${renderAnchor}`
            )
          adapted = adapted
            .replace(
              textPropertiesPattern,
              `<TrackingPropertiesCategories
\t\t\t\t\t\t\telement={grouped.text[0].element as import("@/types/timeline").TextElement}
\t\t\t\t\t\t\ttrackId={grouped.text[0].track.id}
\t\t\t\t\t\t\tlabel="文字"
\t\t\t\t\t\t\ttrackingAvailable={grouped.text.length === 1}
\t\t\t\t\t\t>
\t\t\t\t\t\t\t$1
\t\t\t\t\t\t</TrackingPropertiesCategories>`
            )
            .replace(
              stickerPropertiesPattern,
              `<TrackingPropertiesCategories
\t\t\t\t\t\t\telement={grouped.sticker[0].element as import("@/types/timeline").StickerElement}
\t\t\t\t\t\t\ttrackId={grouped.sticker[0].track.id}
\t\t\t\t\t\t\tlabel="贴图"
\t\t\t\t\t\t>
\t\t\t\t\t\t\t$1
\t\t\t\t\t\t</TrackingPropertiesCategories>`
            )
          return adapted
        }
        if (file === `${prefix}/lib/media/audio.ts`) {
          const adaptedAudio = code.replace(/\r\n/g, '\n')
          const importAnchor = 'import { mediaSupportsAudio } from "@/lib/media/media-utils";'
          const clipInterfaceAnchor =
            '\tmuted: boolean;\n\tvolume: number;\n\tplaybackRate: number;\n}'
          const reverseClipAnchor =
            '\t\tplaybackRate: getElementPlaybackRate({ element }),\n\t};\n}\n\nexport async function collectAudioMixSources'
          const fadeHelperAnchor = 'function getElementVolume({'
          const mixAnchor = 'outputData[outputIndex] += interpolated * volume;'
          if (
            !adaptedAudio.includes(importAnchor) ||
            !adaptedAudio.includes(clipInterfaceAnchor) ||
            !adaptedAudio.includes(reverseClipAnchor) ||
            !adaptedAudio.includes(fadeHelperAnchor) ||
            !adaptedAudio.includes(mixAnchor)
          ) {
            throw new Error('Cutia 音频淡入淡出适配需要检查上游版本')
          }

          return adaptedAudio
            .replace(
              importAnchor,
              `${importAnchor}\nimport { getAudioEnvelopeGain } from "@cutia-desktop/audio-envelope";\nimport { resolveAudioVolumeAtLocalTime, normalizeAudioVolumeKeyframes, type AudioKeyframes, type AudioVolumeKeyframe } from "@cutia-desktop/audio-keyframes";`
            )
            .replace(
              clipInterfaceAnchor,
              '\tmuted: boolean;\n\tvolume: number;\n\tvolumeKeyframes?: AudioVolumeKeyframe[];\n\tfadeIn?: number;\n\tfadeOut?: number;\n\tplaybackRate: number;\n\treversed?: boolean;\n}'
            )
            .replace(
              fadeHelperAnchor,
              `function getElementAudioVolumeKeyframes({
\telement,
}: {
\telement: TimelineElement;
}): AudioVolumeKeyframe[] | undefined {
\tconst keyframes = (element as TimelineElement & { audioKeyframes?: AudioKeyframes }).audioKeyframes?.volume;
\tconst normalized = normalizeAudioVolumeKeyframes(keyframes, element.duration);
\treturn normalized.length ? normalized : undefined;
}

function getElementFade({
\telement,
\tproperty,
}: {
\telement: TimelineElement;
\tproperty: "fadeIn" | "fadeOut";
}): number {
\tconst value = (element as TimelineElement & { fadeIn?: number; fadeOut?: number })[property];
\treturn typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

${fadeHelperAnchor}`
            )
            .replace(
              '\t\t\t\t\t\tvolume,\n\t\t\t\t\t\tmuted,',
              '\t\t\t\t\t\tvolume,\n\t\t\t\t\t\tvolumeKeyframes: getElementAudioVolumeKeyframes({ element }),\n\t\t\t\t\t\tfadeIn: getElementFade({ element, property: "fadeIn" }),\n\t\t\t\t\t\tfadeOut: getElementFade({ element, property: "fadeOut" }),\n\t\t\t\t\t\tmuted,'
            )
            .replace(
              '\t\t\t\t\t\tvolume: 1,\n\t\t\t\t\t\tmuted,',
              '\t\t\t\t\t\tvolume: getElementVolume({ element }),\n\t\t\t\t\t\tvolumeKeyframes: getElementAudioVolumeKeyframes({ element }),\n\t\t\t\t\t\tfadeIn: getElementFade({ element, property: "fadeIn" }),\n\t\t\t\t\t\tfadeOut: getElementFade({ element, property: "fadeOut" }),\n\t\t\t\t\t\tmuted,'
            )
            .replace(
              '\t\t\tvolume: element.volume ?? 1,\n\t\t\tplaybackRate:',
              '\t\t\tvolume: element.volume ?? 1,\n\t\t\tvolumeKeyframes: getElementAudioVolumeKeyframes({ element }),\n\t\t\tfadeIn: getElementFade({ element, property: "fadeIn" }),\n\t\t\tfadeOut: getElementFade({ element, property: "fadeOut" }),\n\t\t\tplaybackRate:'
            )
            .replace(
              '\t\tvolume: getElementVolume({ element }),\n\t\tplaybackRate:',
              '\t\tvolume: getElementVolume({ element }),\n\t\tvolumeKeyframes: getElementAudioVolumeKeyframes({ element }),\n\t\tfadeIn: getElementFade({ element, property: "fadeIn" }),\n\t\tfadeOut: getElementFade({ element, property: "fadeOut" }),\n\t\tplaybackRate:'
            )
            .replace(
              reverseClipAnchor,
              '\t\tplaybackRate: getElementPlaybackRate({ element }),\n\t\treversed: element.type === "video" && element.reversed === true,\n\t};\n}\n\nexport async function collectAudioMixSources'
            )
            .replace(
              '\t\tvolume,\n\t\tplaybackRate = 1,',
              '\t\tvolume,\n\t\tvolumeKeyframes = [],\n\t\tfadeIn = 0,\n\t\tfadeOut = 0,\n\t\tplaybackRate = 1,'
            )
            .replace(
              mixAnchor,
              `const envelopeGain = getAudioEnvelopeGain({
\t\t\t\tposition: i / sampleRate,
\t\t\t\tduration: elementDuration,
\t\t\t\tfadeIn,
\t\t\t\tfadeOut,
\t\t\t});
\t\t\tconst keyframedVolume = resolveAudioVolumeAtLocalTime({
\t\t\t\tvolume,
\t\t\t\tvolumeKeyframes,
\t\t\t\tlocalTime: i / sampleRate,
\t\t\t});
\t\t\toutputData[outputIndex] += interpolated * keyframedVolume * envelopeGain;`
            )
        }
        if (file === `${prefix}/lib/commands/timeline/element/split-elements.ts`) {
          const importAnchor = 'import { EditorCore } from "@/core";'
          const splitTimeAnchor =
            '\t\t\t\t\tconst relativeTime = this.splitTime - element.startTime;'
          const leftDurationPattern =
            /([ \t]*)duration: leftVisibleDuration,(\r?\n)([ \t]*)trimEnd:/g
          const rightDurationPattern =
            /([ \t]*)duration: rightVisibleDuration,(\r?\n)([ \t]*)trimStart:/g
          if (!code.includes(importAnchor) || !code.includes(splitTimeAnchor)) {
            throw new Error('Cutia 视觉关键帧切割适配需要检查上游版本')
          }
          if (
            [...code.matchAll(leftDurationPattern)].length !== 2 ||
            [...code.matchAll(rightDurationPattern)].length !== 2
          ) {
            throw new Error('Cutia 视觉关键帧切割片段结构需要检查上游版本')
          }
          return code
            .replace(
              importAnchor,
              `${importAnchor}\nimport { splitVisualKeyframesAtTime, type VisualKeyframes } from "@cutia-desktop/visual-keyframes";\nimport { splitAudioKeyframesAtTime, type AudioKeyframes } from "@cutia-desktop/audio-keyframes";\nimport { splitObjectLockAtTime, type ObjectLockSettings } from "@cutia-desktop/object-lock";\nimport { splitColorAdjustmentAtTime } from "@cutia-desktop/color-adjustment";`
            )
            .replace(
              splitTimeAnchor,
              `${splitTimeAnchor}\n\t\t\t\t\tconst splitVisualKeyframes = splitVisualKeyframesAtTime({\n\t\t\t\t\t\tvisualKeyframes: (element as typeof element & { visualKeyframes?: VisualKeyframes }).visualKeyframes,\n\t\t\t\t\t\tsplitTime: relativeTime,\n\t\t\t\t\t});\n\t\t\t\t\tconst splitAudioKeyframes = splitAudioKeyframesAtTime({\n\t\t\t\t\t\taudioKeyframes: (element as typeof element & { audioKeyframes?: AudioKeyframes }).audioKeyframes,\n\t\t\t\t\t\tsplitTime: relativeTime,\n\t\t\t\t\t});\n\t\t\t\t\tconst splitObjectLock = splitObjectLockAtTime({\n\t\t\t\t\t\tvalue: (element as typeof element & { objectLock?: ObjectLockSettings }).objectLock,\n\t\t\t\t\t\tsplitTime: relativeTime,\n\t\t\t\t\t});\n\t\t\t\t\tconst sourceColorAdjustment = (element as typeof element & { colorAdjustment?: unknown }).colorAdjustment;\n\t\t\t\t\tconst splitColorAdjustment = sourceColorAdjustment\n\t\t\t\t\t\t? splitColorAdjustmentAtTime({ value: sourceColorAdjustment, splitTime: relativeTime })\n\t\t\t\t\t\t: null;`
            )
            .replace(
              leftDurationPattern,
              '$1duration: leftVisibleDuration,$2$1visualKeyframes: splitVisualKeyframes.leftVisualKeyframes,$2$1audioKeyframes: splitAudioKeyframes.leftAudioKeyframes,$2$1objectLock: splitObjectLock.leftObjectLock,$2$1colorAdjustment: splitColorAdjustment?.left,$2$3trimEnd:'
            )
            .replace(
              rightDurationPattern,
              '$1duration: rightVisibleDuration,$2$1visualKeyframes: splitVisualKeyframes.rightVisualKeyframes,$2$1audioKeyframes: splitAudioKeyframes.rightAudioKeyframes,$2$1objectLock: splitObjectLock.rightObjectLock,$2$1colorAdjustment: splitColorAdjustment?.right,$2$3trimStart:'
            )
        }
        if (file === `${prefix}/services/renderer/nodes/visual-node.ts`) {
          const importAnchor = 'import type { TCanvasSize } from "@/types/project";'
          const stateAnchor = 'const { transform, opacity, fitCanvasSize } = this.params;'
          if (!code.includes(importAnchor) || !code.includes(stateAnchor)) {
            throw new Error('Cutia 视觉关键帧渲染适配需要检查上游版本')
          }
          let adapted = code
            .replace(
              importAnchor,
              `${importAnchor}\nimport { resolveVisualState, type ClipAnimations, type VisualKeyframes } from "@cutia-desktop/visual-keyframes";\nimport { getClipCropRenderLayout, type ClipCrop } from "@cutia-desktop/clip-crop";`
            )
            .replace(
              '\topacity: number;\n\tfitCanvasSize?: TCanvasSize;',
              '\topacity: number;\n\tcrop?: ClipCrop;\n\tvisualKeyframes?: VisualKeyframes;\n\tclipAnimations?: ClipAnimations;\n\tobjectLock?: unknown;\n\tfitCanvasSize?: TCanvasSize;'
            )
            .replace(
              /sourceHeight,\r?\n\t\}: \{\r?\n\t\trenderer: CanvasRenderer;\r?\n\t\tsource: CanvasImageSource;\r?\n\t\tsourceWidth: number;\r?\n\t\tsourceHeight: number;\r?\n\t\}\): void \{/,
              `sourceHeight,\n\t\ttime,\n\t}: {\n\t\trenderer: CanvasRenderer;\n\t\tsource: CanvasImageSource;\n\t\tsourceWidth: number;\n\t\tsourceHeight: number;\n\t\ttime: number;\n\t}): void {`
            )
            .replace(
              stateAnchor,
              'const { transform, opacity } = resolveVisualState({ source: this.params, timelineTime: time });\n\t\tconst { fitCanvasSize } = this.params;'
            )
          const visualLayoutPattern =
            /\t\tconst containScale = Math\.min\([\s\S]*?\t\tconst y = renderer\.height \/ 2 \+ transform\.position\.y - scaledHeight \/ 2;/
          if (!visualLayoutPattern.test(adapted)) {
            throw new Error('Cutia 裁剪渲染尺寸适配需要检查上游版本')
          }
          adapted = adapted
            .replace(
              visualLayoutPattern,
              `\t\tconst visualLayout = getClipCropRenderLayout({
\t\t\tcrop: this.params.crop,
\t\t\tsourceWidth,
\t\t\tsourceHeight,
\t\t\tcanvasWidth: renderer.width,
\t\t\tcanvasHeight: renderer.height,
\t\t\tfitCanvasWidth: fitCanvasSize?.width ?? renderer.width,
\t\t\tfitCanvasHeight: fitCanvasSize?.height ?? renderer.height,
\t\t\tscale: transform.scale,
\t\t\trotation: transform.rotate,
\t\t\tposition: transform.position,
\t\t});
\t\tconst { x, y, width: scaledWidth, height: scaledHeight } = visualLayout;`
            )
            .replace(
              '\t\trenderer.context.drawImage(source, x, y, scaledWidth, scaledHeight);',
              `\t\tif (this.params.crop) {
\t\t\trenderer.context.drawImage(
\t\t\t\tsource,
\t\t\t\tvisualLayout.sourceX,
\t\t\t\tvisualLayout.sourceY,
\t\t\t\tvisualLayout.sourceWidth,
\t\t\t\tvisualLayout.sourceHeight,
\t\t\t\tx,
\t\t\t\ty,
\t\t\t\tscaledWidth,
\t\t\t\tscaledHeight,
\t\t\t);
\t\t} else {
\t\t\t// SVG stickers may have no intrinsic pixel size; draw the full image.
\t\t\trenderer.context.drawImage(source, x, y, scaledWidth, scaledHeight);
\t\t}`
            )
          if (!adapted.includes('\t\ttime: number;')) {
            throw new Error('Cutia 视觉关键帧渲染时间适配需要检查上游版本')
          }
          return adapted
        }
        if (file === `${prefix}/lib/preview/element-bounds.ts`) {
          const importAnchor = 'import type { TCanvasSize } from "@/types/project";'
          const mediaBoundsPattern =
            /\t\tconst containScale = Math\.min\([\s\S]*?\t\treturn \{\r?\n\t\t\thalfWidth: \(mediaW \* containScale \* transform\.scale\) \/ 2,\r?\n\t\t\thalfHeight: \(mediaH \* containScale \* transform\.scale\) \/ 2,\r?\n\t\t\};/
          if (!code.includes(importAnchor) || !mediaBoundsPattern.test(code)) {
            throw new Error('Cutia 裁剪选区尺寸适配需要检查上游版本')
          }
          return code
            .replace(
              importAnchor,
              `${importAnchor}\nimport { getClipCropRenderLayout } from "@cutia-desktop/clip-crop";`
            )
            .replace(
              mediaBoundsPattern,
              `\t\tconst layout = getClipCropRenderLayout({
\t\t\tcrop: (element as typeof element & { crop?: unknown }).crop,
\t\t\tsourceWidth: mediaW,
\t\t\tsourceHeight: mediaH,
\t\t\tcanvasWidth,
\t\t\tcanvasHeight,
\t\t\tfitCanvasWidth: fitCanvasSize.width,
\t\t\tfitCanvasHeight: fitCanvasSize.height,
\t\t\tscale: transform.scale,
\t\t\trotation: transform.rotate,
\t\t});
\t\treturn {
\t\t\thalfWidth: layout.width / 2,
\t\t\thalfHeight: layout.height / 2,
\t\t};`
            )
        }
        if (file === `${prefix}/services/renderer/nodes/video-node.ts`) {
          const frameRequestAnchor = '\t\t\ttime: videoTime,\n\t\t});'
          const sourceHeightPattern = /(sourceHeight: [^,\r\n]+,)(\r?\n)(\t+)(\}\);)/
          const normalized = code.replace(/\r\n/g, '\n')
          if (!normalized.includes(frameRequestAnchor) || !sourceHeightPattern.test(normalized)) {
            throw new Error('Cutia 倒放分段缓存适配需要检查上游版本')
          }
          return normalized
            .replace(
              frameRequestAnchor,
              '\t\t\ttime: videoTime,\n\t\t\treversed: this.params.reversed === true,\n\t\t\tmaxDimension: renderer.videoDecodeMaxDimension,\n\t\t\tframeRate: renderer.fps,\n\t\t});'
            )
            .replace(sourceHeightPattern, '$1$2$3\ttime,$2$3$4')
        }
        if (file === `${prefix}/services/renderer/nodes/image-node.ts`) {
          const sourceHeightPattern = /(sourceHeight: [^,\r\n]+,)(\r?\n)(\t+)(\}\);)/
          if (!sourceHeightPattern.test(code)) {
            throw new Error('Cutia 视觉关键帧逐帧时间适配需要检查上游版本')
          }
          return code.replace(sourceHeightPattern, '$1$2$3\ttime,$2$3$4')
        }
        if (file === `${prefix}/lib/preview/hit-test.ts`) {
          const importAnchor = 'import { isMainTrack } from "@/lib/timeline";'
          const transformAnchor =
            'const transform = (element as { transform: Transform }).transform;'
          if (!code.includes(importAnchor) || !code.includes(transformAnchor)) {
            throw new Error('Cutia 视觉关键帧命中测试适配需要检查上游版本')
          }
          return code
            .replace(
              importAnchor,
              `${importAnchor}\nimport { resolveVisualState } from "@cutia-desktop/visual-keyframes";`
            )
            .replace(
              transformAnchor,
              'const transform = resolveVisualState({ source: element as any, timelineTime: currentTime }).transform;'
            )
        }
        if (file === `${prefix}/hooks/use-preview-interaction.ts`) {
          const importAnchor =
            'import { computePreviewSnap, type SnapGuide } from "@/lib/preview/snap";'
          const editorAnchor = '\tconst editor = useEditor();'
          const updateCall = 'editor.timeline.updateElements({'
          if (!code.includes(importAnchor) || !code.includes(editorAnchor)) {
            throw new Error('Cutia 视觉关键帧画布交互适配需要检查上游版本')
          }
          const updateCount = code.split(updateCall).length - 1
          if (updateCount !== 6) {
            throw new Error('Cutia 视觉关键帧画布更新适配需要检查上游版本')
          }
          let adapted = code
            .replace(
              importAnchor,
              `${importAnchor}\nimport { createVisualTransformUpdate, resolveVisualState } from "@cutia-desktop/visual-keyframes";`
            )
            .replaceAll(updateCall, 'updatePreviewElements({')
            .replace(
              /\(element as \{ transform: Transform \}\)\s*\.transform/g,
              'resolveVisualState({ source: element as any, timelineTime: currentTime }).transform'
            )
            .replaceAll(
              'const transform = (element as { transform: Transform }).transform;',
              'const transform = resolveVisualState({ source: element as any, timelineTime: currentTime }).transform;'
            )
          const logicalSizePattern =
            /\t\t\tconst logicalWidth = canvasRef\.current\.width;\r?\n\t\t\tconst logicalHeight = canvasRef\.current\.height;/
          const canvasSizePattern =
            /\t\t\tconst canvasWidth = canvasRef\.current\?\.width \?\? 0;\r?\n\t\t\tconst canvasHeight = canvasRef\.current\?\.height \?\? 0;/g
          const canvasSizeCount = [...adapted.matchAll(canvasSizePattern)].length
          if (!logicalSizePattern.test(adapted) || canvasSizeCount !== 2) {
            throw new Error('Cutia 预览物理画布坐标适配需要检查上游版本')
          }
          adapted = adapted
            .replace(
              logicalSizePattern,
              `\t\t\tconst { width: logicalWidth, height: logicalHeight } =
\t\t\t\teditor.project.getActive().settings.canvasSize;`
            )
            .replace(
              /\t\t\tconst canvasWidth = canvasRef\.current\?\.width \?\? 0;\r?\n\t\t\tconst canvasHeight = canvasRef\.current\?\.height \?\? 0;/g,
              `\t\t\tconst { width: canvasWidth, height: canvasHeight } =
\t\t\t\teditor.project.getActive().settings.canvasSize;`
            )
            .replace(
              '\t\t\tconst canvasHeight = canvasRef.current?.height ?? 0;',
              '\t\t\tconst canvasHeight = editor.project.getActive().settings.canvasSize.height;'
            )
            .replace('\t\t[canvasRef],', '\t\t[canvasRef, editor.project],')
          const tracksSnapshotAnchor = 'tracksSnapshot: editor.timeline.getTracks(),'
          const tracksSnapshotCount = adapted.split(tracksSnapshotAnchor).length - 1
          if (tracksSnapshotCount !== 2) {
            throw new Error('Cutia 画布交互轨道快照适配需要检查上游版本')
          }
          adapted = adapted.replaceAll(
            tracksSnapshotAnchor,
            'tracksSnapshot: structuredClone(editor.timeline.getTracks()),'
          )
          const pointerTracksAnchor = '\t\t\tconst tracks = editor.timeline.getTracks();'
          if (!adapted.includes(pointerTracksAnchor)) {
            throw new Error('Cutia 画布拖动轨道快照适配需要检查上游版本')
          }
          adapted = adapted.replace(
            pointerTracksAnchor,
            '\t\t\tconst tracks = structuredClone(editor.timeline.getTracks());'
          )
          const scaleStatePattern = /(\tanchorY: number;\r?\n)(})/
          const scaleStateMatch = adapted.match(scaleStatePattern)
          if (!scaleStateMatch) {
            throw new Error('Cutia 贴纸角点旋转状态适配需要检查上游版本')
          }
          adapted = adapted.replace(
            scaleStatePattern,
            '$1\trotateWithScale: boolean;\n\tlastPointerAngle: number;\n\trotationDelta: number;\n$2'
          )
          const hookAnchor = 'export function usePreviewInteraction({'
          if (!adapted.includes(hookAnchor)) {
            throw new Error('Cutia 贴纸角点旋转计算适配需要检查上游版本')
          }
          adapted = adapted.replace(
            hookAnchor,
            `function updateCornerRotation({
\tstate,
\tcurrentX,
\tcurrentY,
}: {
\tstate: ScaleState;
\tcurrentX: number;
\tcurrentY: number;
}) {
\tif (!state.rotateWithScale) return state.initialTransform.rotate;

\tconst currentAngle = Math.atan2(currentY - state.anchorY, currentX - state.anchorX);
\tlet angleStep = currentAngle - state.lastPointerAngle;
\tif (angleStep > Math.PI) angleStep -= Math.PI * 2;
\tif (angleStep < -Math.PI) angleStep += Math.PI * 2;

\tstate.lastPointerAngle = currentAngle;
\tstate.rotationDelta += (angleStep * 180) / Math.PI;
\treturn state.initialTransform.rotate + state.rotationDelta;
}

${hookAnchor}`
          )
          const scaleStateInitPattern = /(\t\t\t\tanchorY,\r?\n)(\t\t\t};)/
          if (!scaleStateInitPattern.test(adapted)) {
            throw new Error('Cutia 贴纸角点旋转初始化适配需要检查上游版本')
          }
          adapted = adapted.replace(
            scaleStateInitPattern,
            '$1\t\t\t\trotateWithScale: element.type === "sticker",\n\t\t\t\tlastPointerAngle: Math.atan2(startPos.y - anchorY, startPos.x - anchorX),\n\t\t\t\trotationDelta: 0,\n$2'
          )
          const currentDistancePattern =
            /(\t\t\t\tconst currentDist = Math\.hypot\(\r?\n\t\t\t\t\tcurrentPos\.x - state\.anchorX,\r?\n\t\t\t\t\tcurrentPos\.y - state\.anchorY,\r?\n\t\t\t\t\);)/g
          const currentDistanceCount = [...adapted.matchAll(currentDistancePattern)].length
          if (currentDistanceCount !== 2) {
            throw new Error('Cutia 贴纸角点旋转手势适配需要检查上游版本')
          }
          adapted = adapted.replace(
            currentDistancePattern,
            '$1\n\n\t\t\t\tconst newRotate = updateCornerRotation({\n\t\t\t\t\tstate,\n\t\t\t\t\tcurrentX: currentPos.x,\n\t\t\t\t\tcurrentY: currentPos.y,\n\t\t\t\t});'
          )
          const scaleValueAnchor = '\t\t\t\t\t\tscale: newScale,'
          const scaleValueCount = adapted.split(scaleValueAnchor).length - 1
          if (scaleValueCount !== 2) {
            throw new Error('Cutia 贴纸角点旋转更新适配需要检查上游版本')
          }
          adapted = adapted.replaceAll(
            scaleValueAnchor,
            `${scaleValueAnchor}\n\t\t\t\t\t\trotate: newRotate,`
          )
          const scaleCommitAnchor =
            '\t\t\t\tconst hasScaled = Math.abs(currentDist - initialDist) > 1;'
          const scaleCommitCondition = '\t\t\t\tif (hasScaled) {'
          if (!adapted.includes(scaleCommitAnchor) || !adapted.includes(scaleCommitCondition)) {
            throw new Error('Cutia 贴纸角点旋转提交适配需要检查上游版本')
          }
          adapted = adapted
            .replace(
              scaleCommitAnchor,
              `${scaleCommitAnchor}\n\t\t\t\tconst hasRotated = Math.abs(state.rotationDelta) > 0.25;\n\t\t\t\tconst hasTransformed = hasScaled || hasRotated;`
            )
            .replace(scaleCommitCondition, '\t\t\t\tif (hasTransformed) {')
          const snapshotCommitPattern =
            /(\t\t\t\t\t\t\],\r?\n\t\t\t\t\t)\}\);(\r?\n\t\t\t\t\} else \{)/g
          const snapshotCommitCount = [...adapted.matchAll(snapshotCommitPattern)].length
          if (snapshotCommitCount !== 2) {
            throw new Error('Cutia 视觉关键帧画布提交适配需要检查上游版本')
          }
          adapted = adapted.replace(snapshotCommitPattern, '$1}, state.tracksSnapshot);$2')
          const liveTransformPattern = /(\t\t\t\t\tpushHistory: false,\r?\n\t\t\t\t)\}\);/g
          const liveTransformCount = [...adapted.matchAll(liveTransformPattern)].length
          if (liveTransformCount !== 2) {
            throw new Error('Cutia 视觉关键帧画布实时变换适配需要检查上游版本')
          }
          adapted = adapted.replace(liveTransformPattern, '$1}, state.tracksSnapshot);')
          const liveDragAnchor = '\t\t\tupdatePreviewElements({ updates, pushHistory: false });'
          if (!adapted.includes(liveDragAnchor)) {
            throw new Error('Cutia 视觉关键帧画布实时拖动适配需要检查上游版本')
          }
          adapted = adapted.replace(
            liveDragAnchor,
            '\t\t\tupdatePreviewElements({ updates, pushHistory: false }, dragStateRef.current.tracksSnapshot);'
          )
          const dragCommitAnchor = '\t\t\tupdatePreviewElements({ updates });'
          if (!adapted.includes(dragCommitAnchor)) {
            throw new Error('Cutia 视觉关键帧画布拖动提交适配需要检查上游版本')
          }
          adapted = adapted.replace(
            dragCommitAnchor,
            '\t\t\tupdatePreviewElements({ updates }, dragStateRef.current.tracksSnapshot);'
          )
          const scaleStart = adapted.indexOf('\tconst handleScaleStart = useCallback(')
          const resizeStart = adapted.indexOf(
            '\tconst handleResizeStart = useCallback(',
            scaleStart
          )
          if (scaleStart < 0 || resizeStart < 0) {
            throw new Error('Cutia 画布缩放时间适配需要检查上游版本')
          }
          const scaleBlock = adapted
            .slice(scaleStart, resizeStart)
            .replaceAll(
              'timelineTime: currentTime',
              'timelineTime: editor.playback.getCurrentTime()'
            )
          adapted = adapted.slice(0, scaleStart) + scaleBlock + adapted.slice(resizeStart)
          adapted = adapted.replace(
            editorAnchor,
            `${editorAnchor}
\tconst updatePreviewElements = (
\t\tparams: Parameters<typeof editor.timeline.updateElements>[0],
\t\tsourceTracks = editor.timeline.getTracks(),
\t) => {
\t\tconst timelineTime = editor.playback.getCurrentTime();
\t\tconst updates = params.updates.map((update) => {
\t\t\tconst track = sourceTracks.find((item) => item.id === update.trackId);
\t\t\tconst element = track?.elements.find((item) => item.id === update.elementId);
\t\t\tconst transform = update.updates.transform as Transform | undefined;
\t\t\tif (!element || element.type === "audio" || !transform) return update;
\t\t\treturn {
\t\t\t\t...update,
\t\t\t\tupdates: {
\t\t\t\t\t...update.updates,
\t\t\t\t\t...createVisualTransformUpdate({ source: element as any, timelineTime, transform }),
\t\t\t\t},
\t\t\t};
\t\t});
\t\teditor.timeline.updateElements({ ...params, updates });
\t};`
          )
          return adapted
        }
        if (file === `${prefix}/components/editor/panels/preview/preview-interaction-overlay.tsx`) {
          const normalized = code.replace(/\r\n/g, '\n')
          const importAnchor = 'import { useRef } from "react";'
          const canvasSizeAnchor = `\tconst canvasWidth = canvasRef.current?.width ?? 0;
\tconst canvasHeight = canvasRef.current?.height ?? 0;`
          if (!normalized.includes(importAnchor) || !normalized.includes(canvasSizeAnchor)) {
            throw new Error('Cutia 预览辅助线逻辑坐标适配需要检查上游版本')
          }
          return normalized
            .replace(
              importAnchor,
              `${importAnchor}\nimport { useEditor } from "@/hooks/use-editor";`
            )
            .replace(
              canvasSizeAnchor,
              `\tconst editor = useEditor();
\tconst { width: canvasWidth, height: canvasHeight } =
\t\teditor.project.getActive().settings.canvasSize;`
            )
        }
        if (file === `${prefix}/components/editor/panels/preview/selection-overlay.tsx`) {
          const importAnchor = '} from "@/lib/preview/element-bounds";'
          const boundsAnchor = '\t\t\t\tconst bounds = computeElementBounds({'
          const mediaLayoutPattern =
            /\tconst containScale = Math\.min\([\s\S]*?\tconst scaledH = mediaH \* containScale \* element\.transform\.scale;/
          if (
            !code.includes(importAnchor) ||
            !code.includes(boundsAnchor) ||
            !mediaLayoutPattern.test(code)
          ) {
            throw new Error('Cutia 视觉关键帧选区适配需要检查上游版本')
          }
          return code
            .replace(
              importAnchor,
              `${importAnchor}\nimport { usePlaybackTime } from "@cutia-desktop/playback-time";\nimport { resolveVisualState } from "@cutia-desktop/visual-keyframes";\nimport { getClipCropRenderLayout } from "@cutia-desktop/clip-crop";`
            )
            .replace(
              'const currentTime = editor.playback.getCurrentTime();',
              'const currentTime = usePlaybackTime(editor.playback);'
            )
            .replace(
              mediaLayoutPattern,
              `\tconst layout = getClipCropRenderLayout({
\t\tcrop: (element as typeof element & { crop?: unknown }).crop,
\t\tsourceWidth: mediaW,
\t\tsourceHeight: mediaH,
\t\tcanvasWidth,
\t\tcanvasHeight,
\t\tfitCanvasWidth: fitCanvasSize.width,
\t\tfitCanvasHeight: fitCanvasSize.height,
\t\tscale: element.transform.scale,
\t\trotation: element.transform.rotate,
\t\tposition: element.transform.position,
\t});
\tconst scaledW = layout.width;
\tconst scaledH = layout.height;`
            )
            .replace(
              boundsAnchor,
              `\t\t\t\tconst visualState = resolveVisualState({ source: element as any, timelineTime: currentTime });\n\t\t\t\tconst displayedElement = { ...element, transform: visualState.transform, opacity: visualState.opacity } as typeof element;\n\n${boundsAnchor}`
            )
            .replace(
              /(const bounds = computeElementBounds\(\{\r?\n\s*)element,/,
              '$1element: displayedElement,'
            )
            .replace(
              /(\r?\n\s*)element,(\r?\n\s*trackId: track\.id,)/g,
              '$1element: displayedElement,$2'
            )
        }
        if (file === `${prefix}/services/renderer/scene-builder.ts`) {
          if (!code.includes('new TransitionNode({') || !code.includes('type: transition.type'))
            throw new Error('Cutia 自定义 Shader 转场适配需要检查上游版本')
          const stickerAnchor = 'iconName: element.iconName,'
          if (!code.includes(stickerAnchor)) throw new Error('Cutia 贴纸资源适配需要检查上游版本')
          let adapted = code.replace(
            'import type { BaseNode } from "./nodes/base-node";',
            'import { BaseNode } from "./nodes/base-node";\nimport { EffectNode } from "@cutia-desktop/clip-effect-node";\nimport { FilterNode } from "@cutia-desktop/clip-filter-node";\nimport { ColorAdjustmentNode } from "@cutia-desktop/color-adjustment-node";\nimport { ChromaKeyNode } from "@cutia-desktop/chroma-key-node";\nimport { SmartCutoutNode } from "@cutia-desktop/smart-cutout-node";\nimport { CustomCutoutNode } from "@cutia-desktop/custom-cutout-node";\nimport { ClipMaskNode } from "@cutia-desktop/clip-mask-node";\nimport { BeautyNode } from "@cutia-desktop/beauty-node";\nimport { AdjustmentLayerNode } from "@cutia-desktop/adjustment-layer-node";\nimport { getAdjustmentLayers, isAdjustmentElement } from "@cutia-desktop/adjustment-layer";'
          )
          const mediaPattern =
            /\tif \(!mediaAsset\?\.file \|\| !mediaAsset\?\.url\) \{\r?\n\t\treturn null;\r?\n\t\}/
          const mediaAnchor = adapted.match(mediaPattern)?.[0]
          if (!mediaAnchor) throw new Error('Cutia 片段特效渲染适配需要检查上游版本')
          adapted = adapted.replace(
            mediaPattern,
            `${mediaAnchor}

\tconst withDesktopEffects = (node: BaseNode): BaseNode => {
\t\tconst desktopElement = element as typeof element & { smartCutout?: unknown; customCutout?: unknown; chromaKey?: unknown; colorFilter?: unknown; colorAdjustment?: unknown; colorAdjustmentMask?: unknown; colorAdjustmentCustomMask?: unknown; effects?: unknown; clipMask?: unknown; beauty?: unknown };
\t\tlet processed = desktopElement.customCutout
\t\t\t? new CustomCutoutNode({ node, settings: desktopElement.customCutout })
\t\t\t: node;
\t\tif (desktopElement.smartCutout) {
\t\t\tprocessed = new SmartCutoutNode({ node: processed, settings: desktopElement.smartCutout });
\t\t}
\t\tif (desktopElement.chromaKey) {
\t\t\tprocessed = new ChromaKeyNode({ node: processed, settings: desktopElement.chromaKey });
\t\t}
\t\tif (desktopElement.colorFilter) {
\t\t\tprocessed = new FilterNode({ node: processed, filter: desktopElement.colorFilter });
\t\t}
\t\tif (Array.isArray(desktopElement.effects) && desktopElement.effects.length) {
\t\t\tprocessed = new EffectNode({ node: processed, effects: desktopElement.effects });
\t\t}
\t\tif (desktopElement.colorAdjustment) {
\t\t\tprocessed = new ColorAdjustmentNode({
\t\t\t\tnode: processed,
\t\t\t\tadjustment: desktopElement.colorAdjustment,
\t\t\t\tstartTime: element.startTime,
\t\t\t\tduration: element.duration,
\t\t\t\tshapeMask: desktopElement.colorAdjustmentMask,
\t\t\t\tcustomMask: desktopElement.colorAdjustmentCustomMask,
\t\t\t});
\t\t}
\t\tif (desktopElement.clipMask) {
\t\t\tprocessed = new ClipMaskNode({
\t\t\t\tnode: processed,
\t\t\t\tsettings: desktopElement.clipMask,
\t\t\t\tstartTime: element.startTime,
\t\t\t\tduration: element.duration,
\t\t\t});
\t\t}
\t\tif (desktopElement.beauty) {
\t\t\tprocessed = new BeautyNode({ node: processed, settings: desktopElement.beauty });
\t\t}
\t\treturn processed;
\t};`
          )
          adapted = adapted
            .replace(
              /\t\treturn new VideoNode\(\{/,
              '\t\treturn withDesktopEffects(new VideoNode({'
            )
            .replace(
              /\t\t\treversed: videoElement\.reversed,\r?\n\t\t\}\);/,
              '\t\t\treversed: videoElement.reversed,\n\t\t}));'
            )
            .replace(
              /\t\treturn new ImageNode\(\{/,
              '\t\treturn withDesktopEffects(new ImageNode({'
            )
            .replace(/\t\t\tfitCanvasSize,\r?\n\t\t\}\);/, '\t\t\tfitCanvasSize,\n\t\t}));')
          const visualStatePattern =
            /\t\t\ttransform: element\.transform,\r?\n\t\t\topacity: element\.opacity,\r?\n\t\t\tfitCanvasSize,/g
          const visualStateCount = [...adapted.matchAll(visualStatePattern)].length
          if (visualStateCount !== 2) {
            throw new Error('Cutia 视觉关键帧场景适配需要检查上游版本')
          }
          adapted = adapted.replace(
            visualStatePattern,
            '\t\t\ttransform: element.transform,\n\t\t\topacity: element.opacity,\n\t\t\tcrop: (element as any).crop,\n\t\t\tvisualKeyframes: (element as any).visualKeyframes,\n\t\t\tclipAnimations: (element as any).clipAnimations,\n\t\t\tobjectLock: (element as any).objectLock,\n\t\t\tfitCanvasSize,'
          )
          const visibleTracksPattern =
            /\tconst visibleTracks = tracks\.filter\(\r?\n\t\t\(track\) => !\("hidden" in track && track\.hidden\),\r?\n\t\);/
          const visibleTracksAnchor = adapted.match(visibleTracksPattern)?.[0]
          if (!visibleTracksAnchor) {
            throw new Error('Cutia 调节层场景适配需要检查上游版本')
          }
          adapted = adapted
            .replace(
              visibleTracksAnchor,
              `${visibleTracksAnchor}
\tconst adjustmentLayers = getAdjustmentLayers(visibleTracks);`
            )
            .replace(
              '.filter((element) => !("hidden" in element && element.hidden))',
              '.filter((element) => !("hidden" in element && element.hidden) && !isAdjustmentElement(element))'
            )
            .replace(
              /\r?\n\treturn rootNode;\r?\n\}/,
              `
\tif (adjustmentLayers.length) {
\t\tconst composed = new BaseNode();
\t\tfor (const child of rootNode.children) composed.add(child);
\t\trootNode.children = [];
\t\tlet adjusted: BaseNode = composed;
\t\tfor (const { element } of adjustmentLayers) {
\t\t\tadjusted = new AdjustmentLayerNode({
\t\t\t\tnode: adjusted,
\t\t\t\tstartTime: element.startTime,
\t\t\t\tduration: element.duration,
\t\t\t\tcolorFilter: element.colorFilter,
\t\t\t\tcolorAdjustment: element.colorAdjustment,
\t\t\t\tcolorAdjustmentMask: element.colorAdjustmentMask,
\t\t\t\tcolorAdjustmentCustomMask: element.colorAdjustmentCustomMask,
\t\t\t\teffects: element.effects,
\t\t\t});
\t\t}
\t\trootNode.add(adjusted);
\t}

\treturn rootNode;
}`
            )
          return adapted
            .replace(
              stickerAnchor,
              `${stickerAnchor}\n\t\t\t\t\t\tsourceUrl: (element as typeof element & { sourceUrl?: string }).sourceUrl,\n\t\t\t\t\t\tvisualKeyframes: (element as any).visualKeyframes,\n\t\t\t\t\t\tclipAnimations: (element as any).clipAnimations,\n\t\t\t\t\t\tobjectLock: (element as any).objectLock,`
            )
            .replace(
              /(new TransitionNode\(\{\s*type: transition\.type,)/,
              '$1\n\t\t\t\t\t\t\t\t\tshaderSource: (transition as any).shaderSource,\n\t\t\t\t\t\t\t\t\tshaderParams: (transition as any).shaderParams,'
            )
        }
        if (file.endsWith('/services/renderer/nodes/text-node.ts')) {
          if (!code.includes('TextNode') || !code.includes('scaledFontSize'))
            throw new Error('Cutia 文字模板适配需要检查上游版本')
          let adapted = code.replace(
            'import { FONT_SIZE_SCALE_REFERENCE } from "@/constants/text-constants";',
            'import { FONT_SIZE_SCALE_REFERENCE } from "@/constants/text-constants";\nimport { resolveTextTemplateAnimation } from "@cutia-desktop/text-template-animation";\nimport { resolveTextVisualState } from "@cutia-desktop/visual-keyframes";'
          )
          adapted = adapted.replace(
            'export class TextNode extends BaseNode<TextNodeParams> {',
            'export class TextNode extends BaseNode<TextNodeParams> {\n\tprivate resolvedShadow?: TextElement["shadow"];'
          )
          adapted = adapted.replace(
            /const x = this\.params\.transform\.position\.x \+ this\.params\.canvasCenter\.x;\s*const y = this\.params\.transform\.position\.y \+ this\.params\.canvasCenter\.y;/,
            'const visualState = resolveTextVisualState({ source: this.params as any, timelineTime: time });\n\t\tthis.resolvedShadow = visualState.shadow;\n\t\tconst animation = resolveTextTemplateAnimation(this.params as any, time);\n\n\t\tconst x = visualState.transform.position.x + this.params.canvasCenter.x + animation.x;\n\t\tconst y = visualState.transform.position.y + this.params.canvasCenter.y + animation.y;'
          )
          adapted = adapted.replace(
            'if (this.params.transform.rotate) {',
            'if (visualState.transform.rotate || animation.rotate) {'
          )
          adapted = adapted.replace(
            'renderer.context.rotate((this.params.transform.rotate * Math.PI) / 180);',
            'renderer.context.rotate(((visualState.transform.rotate + animation.rotate) * Math.PI) / 180);'
          )
          adapted = adapted.replace(
            /if \(this\.params\.transform\.scale !== 1\) \{\s*renderer\.context\.scale\(\s*this\.params\.transform\.scale,\s*this\.params\.transform\.scale,\s*\);\s*\}/,
            'const renderedScale = visualState.transform.scale * animation.scale;\n\t\tif (renderedScale !== 1) {\n\t\t\trenderer.context.scale(renderedScale, renderedScale);\n\t\t}'
          )
          adapted = adapted.replace(
            'fontSize: this.params.fontSize,',
            'fontSize: visualState.fontSize,'
          )
          adapted = adapted.replace(
            'renderer.context.fillStyle = this.params.color;',
            'renderer.context.fillStyle = animation.color ?? this.params.color;'
          )
          adapted = adapted.replace(
            'renderer.context.globalAlpha = this.params.opacity;',
            'renderer.context.globalAlpha = visualState.opacity * animation.opacity;'
          )
          adapted = adapted.replaceAll('this.params.shadow', 'this.resolvedShadow')
          return adapted
        }
        if (file === `${prefix}/services/renderer/nodes/transition-node.ts`) {
          if (
            !code.includes('function applyTransition({') ||
            !code.includes('type: this.params.type')
          )
            throw new Error('Cutia Shader 转场渲染适配需要检查上游版本')
          let adapted = code.replace(
            /(import type \{ TransitionType \} from ["']@\/types\/timeline["'];)/,
            '$1\nimport { applyShaderTransition } from "@cutia-desktop/shader-transition";'
          )
          adapted = adapted
            .replace('function applyTransition({', 'async function applyTransition({')
            .replace(
              /(async function applyTransition\(\{[\s\S]*?\n\s*type,)(\s*\}: \{)/,
              '$1\n\tshaderSource,\n\tshaderParams,$2'
            )
            .replace(
              /(private offscreenB\?: OffscreenCanvas \| HTMLCanvasElement;)/,
              '$1\n\tprivate shaderSource?: string;\n\tprivate shaderParams?: Record<string, number | boolean | number[]>;'
            )
            .replace(
              /(this\.incoming = params\.incomingNode;)/,
              '$1\n\t\tthis.shaderSource = (params as TransitionNodeParams & { shaderSource?: string }).shaderSource;\n\t\tthis.shaderParams = (params as TransitionNodeParams & { shaderParams?: Record<string, number | boolean | number[]> }).shaderParams;'
            )
            .replace(
              /(\s*)applyTransition\(\{\s*context: renderer\.context,/,
              '$1await applyTransition({\n$1\tcontext: renderer.context,'
            )
            .replace(
              /(type: this\.params\.type,)(\s*\}\);)/,
              '$1\n\t\t\tshaderSource: this.shaderSource,\n\t\t\tshaderParams: this.shaderParams,$2'
            )
            .replace(
              /(type: TransitionType;\s*\}\): void \{\s*const source = \{ canvasA, canvasB \} as const;)/,
              'type: TransitionType;\n\tshaderSource?: string;\n\tshaderParams?: Record<string, number | boolean | number[]>;\n}): Promise<void> {\n\tif (shaderSource && String(type).startsWith("shader:")) {\n\t\ttry {\n\t\t\tawait applyShaderTransition({ context, canvasA, canvasB, width, height, progress, source: shaderSource, uniforms: shaderParams });\n\t\t\treturn;\n\t\t} catch (error) {\n\t\t\tconsole.warn("Shader 转场渲染失败，回退到淡化转场", error);\n\t\t}\n\t}\n\tconst source = { canvasA, canvasB } as const;'
            )
          return adapted
        }
        return usesPreviewDuration ? code : null
      }
    }
  }
}
