import { Switch } from '@/components/ui/switch'

export function SamplingOptions({ values, defaultSeed, update }: {
  values: Record<string, unknown>
  defaultSeed: unknown
  update: (name: string, value: unknown) => void
}) {
  const randomSeed = values.seed_mode === 'random'
  const seed = Number(values.seed ?? -1) === -1 ? defaultSeed ?? 0 : values.seed
  return <>
    <div className="text-to-video-grid">
      <label>种子模式<select value={randomSeed ? 'random' : 'fixed'} onChange={event => update('seed_mode', event.target.value)}>
        <option value="fixed">固定种子</option>
        <option value="random">随机种子</option>
      </select>{randomSeed && <small>每次生成抽取 0–99,999,999 的整数。</small>}</label>
      {!randomSeed && <label>种子数<input type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} required value={String(seed)} onChange={event => update('seed', event.target.value)} /></label>}
    </div>
    <div className="text-to-video-grid">
      <label className="text-to-video-switch">SelfLift 渐进采样<Switch aria-label="SelfLift 渐进采样" checked={values.selflift_enabled === true} onCheckedChange={value => update('selflift_enabled', value)} /></label>
      <label className="text-to-video-switch">放大与二采<Switch aria-label="放大与二采" checked={values.refine_enabled === true} onCheckedChange={value => update('refine_enabled', value)} /></label>
    </div>
    {values.refine_enabled === true && <label>放大分辨率（百万像素 / MP）<input aria-label="放大分辨率（百万像素 / MP）" type="number" min={0.1} max={16} step="any" required value={String(values.refine_megapixels ?? 1)} onChange={event => update('refine_megapixels', event.target.value)} /></label>}
  </>
}
