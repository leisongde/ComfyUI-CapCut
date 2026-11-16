import type { EditingTextTemplateMetadata } from '../../../shared/editing'
import { request } from '../bridge'

export async function fetchTextTemplateResource(url: string): Promise<Uint8Array> {
  const result = await request<{ bytes: Uint8Array }>('media:fetch-url', { url })
  if (!(result?.bytes instanceof Uint8Array) || result.bytes.byteLength === 0)
    throw new Error('在线文字模板资源为空')
  return result.bytes
}

export async function listDownloadedTextTemplates(): Promise<EditingTextTemplateMetadata[]> {
  return request<EditingTextTemplateMetadata[]>('text-templates:list')
}

export async function readDownloadedTextTemplate(
  id: string
): Promise<{ metadata: EditingTextTemplateMetadata; bytes: Uint8Array } | null> {
  return request<{ metadata: EditingTextTemplateMetadata; bytes: Uint8Array } | null>(
    'text-templates:read',
    { id }
  )
}

export async function saveDownloadedTextTemplate(
  metadata: EditingTextTemplateMetadata,
  bytes: Uint8Array
): Promise<void> {
  await request('text-templates:save', { metadata, bytes }, [bytes.buffer])
}
