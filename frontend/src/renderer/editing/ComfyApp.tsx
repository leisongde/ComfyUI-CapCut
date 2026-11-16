import { Component, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ArrowLeft, Folder, Headphones, Type, Smile, WandSparkles, ArrowRightLeft, Palette, SlidersHorizontal, Settings, Save, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { toast, Toaster } from 'sonner'
import { EditorCore } from '@/core'
import { useEditor } from '@/hooks/use-editor'
import { useEditorActions } from '@/hooks/actions/use-editor-actions'
import { useKeybindingsListener } from '@/hooks/use-keybindings'
import { _setGlobalTranslation } from '@/lib/i18n'
import { Timeline } from '@/components/editor/panels/timeline'
import { PreviewPanel } from '@/components/editor/panels/preview'
import { PropertiesPanel } from '@/components/editor/panels/properties'
import { MediaView } from '@/components/editor/panels/assets/views/media'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useAssetsPanelStore } from '@/stores/assets-panel-store'
import { processMediaAssets } from '@/lib/media/processing'
import { TextTemplatesView } from './TextTemplatesView'
import { StickersView } from './stickers/StickersView'
import { TransitionsView } from './TransitionsView'
import { EffectsView } from './EffectsView'
import { FiltersView } from './FiltersView'
import { AdjustmentView } from './AdjustmentView'
import { AudioView } from './AudioView'
import { ExportDialog } from './ExportDialog'
import { AITracksPanel } from './AITracksPanel'
import { translate } from './adapters/i18n'
import { nativeStorageState, flushMedia } from './adapters/storage'
import { initializeDownloadedFonts } from './font-runtime'
import { projectId, setFlushHandler, announceReady, request, send } from './bridge'
import type { SaveManager } from './adapters/save-manager'
import { EDITING_CANVAS_SIZE_PRESETS, type EditingProjectDocument, type EditingProjectSummary } from '../../shared/editing'

_setGlobalTranslation({ t: translate })
const engine = EditorCore.getInstance()
const save = engine.save as unknown as SaveManager
save.setBeforeSave(flushMedia)
async function flush() {
  await save.flush()
  if (nativeStorageState.error) throw nativeStorageState.error
  send({ type: 'project', payload: { id: engine.project.getActive().metadata.id, name: engine.project.getActive().metadata.name } } as never)
}
export class EditorErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() { return this.state.error ? <div className="desktop-message"><h2>剪辑工作区遇到问题</h2><p>{this.state.error}</p><button onClick={() => send({ type: 'exit' })}>返回 ComfyUI</button></div> : this.props.children }
}
export default function App() {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    announceReady()
    let active = true
    void initializeDownloadedFonts().then(() => engine.project.loadAllProjects()).then(() => engine.project.loadProject({ id: projectId })).then(() => {
      if (nativeStorageState.error) throw nativeStorageState.error
      setFlushHandler(flush)
      if (active) setLoaded(true)
    }).catch(error => setError(error.message))
    return () => { active = false; engine.playback.pause(); save.stop() }
  }, [])
  if (error) return <div className="desktop-message"><h2>工程打开失败</h2><p>{error}</p><button onClick={() => send({ type: 'exit' })}>返回 ComfyUI</button></div>
  if (!loaded) return <div className="desktop-message">正在打开剪辑工程…</div>
  return <TooltipProvider><Runtime /><Shell /><Toaster richColors position="bottom-right" /></TooltipProvider>
}
function Runtime() {
  useEditorActions(); useKeybindingsListener()
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void flush().catch(error => toast.error(error.message)) } }
    const unload = (event: BeforeUnloadEvent) => { if (save.getIsDirty()) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('keydown', key); window.addEventListener('beforeunload', unload)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('beforeunload', unload) }
  }, [])
  return null
}
function Shell() {
  const editor = useEditor(), project = editor.project.getActive()
  const status = useSyncExternalStore(save.subscribe, save.getSnapshot)
  const [busy, setBusy] = useState(false), [projects, setProjects] = useState<EditingProjectSummary[] | null>(null)
  const [deleting, setDeleting] = useState<EditingProjectSummary | null>(null)
  const action = async (perform: () => Promise<unknown>) => { setBusy(true); try { await perform() } catch (error) { toast.error((error as Error).message) } finally { setBusy(false) } }
  const open = async (id: string) => { await flush(); await editor.project.loadProject({ id }); setProjects(null); await flush() }
  const remove = async (id: string) => {
    await flush()
    if (id === editor.project.getActive().metadata.id) {
      editor.playback.pause()
      let next = projects?.find(item => item.id !== id)
      if (!next) next = (await request<EditingProjectDocument>('projects:create')).metadata
      await editor.project.loadProject({ id: next.id })
      await flush()
    }
    await request('projects:remove', { id })
    await editor.project.loadAllProjects()
    setProjects(await request<EditingProjectSummary[]>('projects:list'))
    setDeleting(null)
    toast.success('工程已删除')
  }
  return <div className="desktop-editor"><header className="desktop-header">
    <button aria-label="返回 ComfyUI 画布" disabled={busy} onClick={() => void action(async () => { await flush(); editor.playback.pause(); send({ type: 'exit' }) })}><ArrowLeft size={18} /></button><strong>大众剪辑</strong><span className="header-divider" />
    <input key={project.metadata.id + project.metadata.name} className="project-name" aria-label="工程名称" defaultValue={project.metadata.name} onBlur={event => { const name = event.target.value.trim(); if (name && name !== project.metadata.name) void action(async () => { await editor.project.renameProject({ id: project.metadata.id, name }); await flush() }) }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
    <span className={`save-status ${status.error ? 'save-error' : ''}`} role="status">{status.error || (status.saving ? '正在保存…' : status.dirty ? '有未保存修改' : '已保存')}</span><div className="header-actions">
    <button disabled={busy} onClick={() => void action(async () => { await flush(); const result = await request<any>('projects:create'); await open(result.metadata.id) })}><Plus size={16} />新建</button>
    <button disabled={busy} onClick={() => void action(async () => { await flush(); setProjects(await request('projects:list')) })}><FolderOpen size={16} />打开</button><button disabled={busy} onClick={() => void action(async () => { await flush(); toast.success('工程已保存到本机') })}><Save size={16} />保存</button><ExportDialog /></div></header>
    <div className="desktop-panels"><ResizablePanelGroup direction="vertical"><ResizablePanel defaultSize={50} minSize={30}><ResizablePanelGroup direction="horizontal"><ResizablePanel defaultSize={30} minSize={22}><AssetsPanel /></ResizablePanel><ResizableHandle withHandle /><ResizablePanel defaultSize={48} minSize={25}><PreviewPanel /></ResizablePanel><ResizableHandle withHandle /><ResizablePanel defaultSize={22} minSize={18}><PropertiesPanel /></ResizablePanel></ResizablePanelGroup></ResizablePanel><ResizableHandle withHandle /><ResizablePanel defaultSize={50} minSize={25}>
      <div className="desktop-timeline-stack"><ResizablePanelGroup direction="vertical">
        <ResizablePanel defaultSize={55} minSize={20}><AITracksPanel key={project.metadata.id} /></ResizablePanel>
        <ResizableHandle withHandle aria-label="调整 AI 与剪辑时间线高度" />
        <ResizablePanel defaultSize={45} minSize={25}><div className="desktop-native-timeline"><Timeline /></div></ResizablePanel>
      </ResizablePanelGroup></div>
    </ResizablePanel></ResizablePanelGroup></div>
    <Dialog open={projects !== null} onOpenChange={open => { if (!open && !busy) { setProjects(null); setDeleting(null) } }}><DialogContent><DialogHeader><DialogTitle>{deleting ? '删除工程' : '打开工程'}</DialogTitle><DialogDescription>{deleting ? `确定删除工程“${deleting.name}”？删除后无法恢复，素材文件和已导出的视频会保留。` : '工程与素材保存在当前 ComfyUI 中。'}</DialogDescription></DialogHeader>
      {deleting ? <div className="studio-project-delete-actions"><button disabled={busy} onClick={() => setDeleting(null)}>取消</button><button className="studio-project-delete" disabled={busy} onClick={() => void action(() => remove(deleting.id))}>{busy ? '正在删除…' : '确认删除'}</button></div> : <div className="studio-project-list">{projects?.map(item => <div className="studio-project-row" key={item.id}><button className="studio-project-open" disabled={busy} onClick={() => void action(() => open(item.id))}><span>{item.name}</span><small>{new Date(item.updatedAt).toLocaleString()}</small></button><button className="studio-project-delete" aria-label={`删除工程：${item.name}`} disabled={busy} onClick={() => setDeleting(item)}><Trash2 size={15} />删除</button></div>)}</div>}
    </DialogContent></Dialog></div>
}
function AssetsPanel() {
  const { activeTab: tab, setActiveTab: setTab } = useAssetsPanelStore()
  const tabs = [{ id: 'media', label: '素材', icon: Folder }, { id: 'sounds', label: '音频', icon: Headphones }, { id: 'text', label: '文字', icon: Type }, { id: 'stickers', label: '贴纸', icon: Smile }, { id: 'effects', label: '特效', icon: WandSparkles }, { id: 'transitions', label: '转场', icon: ArrowRightLeft }, { id: 'filters', label: '滤镜', icon: Palette }, { id: 'adjustment', label: '调节', icon: SlidersHorizontal }, { id: 'settings', label: '设置', icon: Settings }] as const
  return <div className="panel desktop-assets"><nav className="asset-tabs" aria-label="剪辑工具">{tabs.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} aria-label={item.label} title={item.label} onClick={() => setTab(item.id)}><item.icon size={21} /><span>{item.label}</span></button>)}</nav><div className="asset-view">{tab === 'media' ? <div className="desktop-media"><WorkflowPanel /><div className="desktop-media-body"><MediaView /></div></div> : tab === 'sounds' ? <AudioView /> : tab === 'text' ? <TextTemplatesView /> : tab === 'stickers' ? <StickersView /> : tab === 'transitions' ? <TransitionsView /> : tab === 'effects' ? <EffectsView /> : tab === 'filters' ? <FiltersView /> : tab === 'adjustment' ? <AdjustmentView /> : <ProjectSettings />}</div></div>
}
function WorkflowPanel() {
  const editor = useEditor()
  const [busy, setBusy] = useState(false), [results, setResults] = useState<any[] | null>(null)
  const importResult = async (file: any) => {
    const result = await request<any>('capcut:import-result' as never, { file, projectId: editor.project.getActive().metadata.id })
    const media = new File([result.bytes], result.name, { type: result.mimeType })
    const assets = await processMediaAssets({ files: [media] })
    for (const asset of assets) await editor.media.addMediaAsset({ projectId: editor.project.getActive().metadata.id, asset })
  }
  const run = async (perform: () => Promise<unknown>) => { setBusy(true); try { await perform() } catch (error) { toast.error((error as Error).message) } finally { setBusy(false) } }
  return <section className="studio-workflows"><button disabled={busy} onClick={() => void run(async () => setResults(await request('capcut:results' as never)))}>从 ComfyUI 生成结果添加</button>
    <Dialog open={results !== null} onOpenChange={open => { if (!open) setResults(null) }}><DialogContent><DialogHeader><DialogTitle>ComfyUI 生成结果</DialogTitle><DialogDescription>最近 30 次任务保存的图片、视频和音频。</DialogDescription></DialogHeader><div className="studio-project-list">{results?.length ? results.map((file, index) => <button key={index} disabled={busy} onClick={() => void run(async () => { await importResult(file); toast.success('已添加到素材库') })}>{file.filename}</button>) : <p>暂无可导入的生成结果。</p>}</div></DialogContent></Dialog></section>
}
function ProjectSettings() {
  const editor = useEditor(), { settings } = editor.project.getActive()
  return <div className="desktop-settings"><h2>项目设置</h2><label>画面尺寸<select aria-label="画面尺寸" value={`${settings.canvasSize.width}x${settings.canvasSize.height}`} onChange={event => { const [width, height] = event.target.value.split('x').map(Number); void editor.project.updateSettings({ settings: { canvasSize: { width, height } } }) }}>{!EDITING_CANVAS_SIZE_PRESETS.some(p => p.value === `${settings.canvasSize.width}x${settings.canvasSize.height}`) && <option value={`${settings.canvasSize.width}x${settings.canvasSize.height}`}>当前 · {settings.canvasSize.width} × {settings.canvasSize.height}</option>}{EDITING_CANVAS_SIZE_PRESETS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>帧率<input type="number" aria-label="帧率" value={settings.fps} min={1} onChange={event => { const fps = Number(event.target.value); if (fps > 0) void editor.project.updateSettings({ settings: { fps } }) }} /></label><label>背景颜色<input type="color" aria-label="背景颜色" value={settings.background.type === 'color' ? settings.background.color : '#000000'} onChange={event => void editor.project.updateSettings({ settings: { background: { type: 'color', color: event.target.value } } })} /></label><p>素材保存在 ComfyUI/input/CapCut/ 下的独立工程目录。工程自动保存到本机。</p></div>
}
