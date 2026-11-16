import en from '../../../../vendor/cutia/apps/web/public/locales/en/translation.json'
import zh from '../../../../vendor/cutia/apps/web/public/locales/zh/translation.json'

const translations = new Map(
  Object.entries(en).map(([key, value]) => [value, zh[key as keyof typeof zh] ?? value])
)
export const translate = (key: string, options: Record<string, unknown> = {}): string => {
  const value = translations.get(key) ?? key
  return value.replace(/\{\{\s*([^} ]+)\s*\}\}/g, (match, name: string) =>
    String(options[name] ?? match)
  )
}
export const useTranslation = () => ({
  t: translate,
  i18n: { language: 'zh', resolvedLanguage: 'zh' }
})
