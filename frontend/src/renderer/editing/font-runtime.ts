import type { EditingFontMetadata } from '../../shared/editing'
import {
  fetchFontResource,
  listDownloadedFonts,
  readDownloadedFont,
  saveDownloadedFont
} from './adapters/font-cache'
import type { OpenSourceFontDefinition } from './font-catalog'

const loadedFaces = new Map<string, FontFace>()
const loadingFonts = new Map<string, Promise<void>>()

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

async function registerFont(metadata: EditingFontMetadata, bytes: Uint8Array): Promise<void> {
  const current = loadedFaces.get(metadata.id)
  if (current) document.fonts.delete(current)
  const data = bytes.slice().buffer
  const face = new FontFace(metadata.family, data, {
    style: 'normal',
    weight: '100 900'
  })
  await face.load()
  document.fonts.add(face)
  loadedFaces.set(metadata.id, face)
  await document.fonts.ready
}

async function fetchFromMirrors(font: OpenSourceFontDefinition): Promise<Uint8Array> {
  let lastError: unknown
  for (const url of font.downloadUrls) {
    try {
      return await fetchFontResource(url)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('字体下载失败')
}

export async function initializeDownloadedFonts(): Promise<void> {
  let fonts: EditingFontMetadata[]
  try {
    fonts = await listDownloadedFonts()
  } catch (error) {
    console.warn('[editing-fonts] Failed to read the font cache', error)
    return
  }
  await Promise.all(
    fonts.map(async (metadata) => {
      try {
        const cached = await readDownloadedFont(metadata.id)
        if (cached) await registerFont(cached.metadata, cached.bytes)
      } catch (error) {
        console.warn(`[editing-fonts] Failed to load ${metadata.id}`, error)
      }
    })
  )
}

export async function downloadedFontHashes(): Promise<Map<string, string>> {
  return new Map((await listDownloadedFonts()).map((font) => [font.id, font.sha256]))
}

export function downloadAndRegisterFont(font: OpenSourceFontDefinition): Promise<void> {
  const existing = loadingFonts.get(font.id)
  if (existing) return existing
  const task = (async () => {
    const bytes = await fetchFromMirrors(font)
    if (bytes.byteLength !== font.sizeBytes) throw new Error('字体文件大小与目录记录不一致')
    const actualHash = await sha256(bytes)
    if (actualHash !== font.sha256) throw new Error('字体文件校验失败，请稍后重试')
    const metadata: EditingFontMetadata = {
      id: font.id,
      family: font.family,
      displayNameZh: font.displayNameZh,
      sourceUrl: `${font.sourceRepository}/blob/${font.sourceCommit}/${font.remotePath}`,
      sourceRepository: font.sourceRepository,
      sourceCommit: font.sourceCommit,
      remotePath: font.remotePath,
      sha256: actualHash,
      sizeBytes: bytes.byteLength,
      mimeType: font.mimeType,
      license: font.license,
      author: font.author,
      downloadedAt: new Date().toISOString()
    }
    await saveDownloadedFont(metadata, bytes)
    await registerFont(metadata, bytes)
  })().finally(() => loadingFonts.delete(font.id))
  loadingFonts.set(font.id, task)
  return task
}
