export interface SmartCutoutSettings {
  enabled: boolean
}

export const DEFAULT_SMART_CUTOUT: SmartCutoutSettings = {
  enabled: false
}

export function normalizeSmartCutout(value: unknown): SmartCutoutSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SMART_CUTOUT }
  return {
    enabled: (value as Partial<SmartCutoutSettings>).enabled === true
  }
}
