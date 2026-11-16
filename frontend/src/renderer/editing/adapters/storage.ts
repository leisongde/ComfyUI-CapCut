import type { MediaAsset } from '@/types/assets'
import type { TProject, TProjectMetadata } from '@/types/project'
import type { SerializedProject } from '@/services/storage/types'
import type {
  EditingMediaMetadata,
  EditingProjectDocument,
  EditingProjectSummary
} from '../../../shared/editing'
import { request } from '../bridge'
import { toast } from 'sonner'
import { createRemoteFile } from './remote-file'
import { inspectGeneratedDirectorMedia } from '../director-output-media'

const pendingMedia = new Set<Promise<void>>()
const failedMedia = new Map<string, () => Promise<void>>()
async function persistMedia(key: string, perform: () => Promise<void>): Promise<void> {
  const task = perform()
  pendingMedia.add(task)
  try {
    await task
    failedMedia.delete(key)
  } catch (error) {
    failedMedia.set(key, perform)
    toast.error('素材未能保存，保存工程时将重试')
    throw error
  } finally {
    pendingMedia.delete(task)
  }
}
export async function flushMedia(): Promise<void> {
  while (pendingMedia.size) await Promise.allSettled([...pendingMedia])
  for (const [key, perform] of [...failedMedia]) {
    await perform()
    failedMedia.delete(key)
  }
}

export const nativeStorageState: { error: Error | null } = { error: null }

const editingMediaUrl = (projectId: string, mediaId: string): string =>
  `${new URL('../studio/media/', location.href).pathname}${encodeURIComponent(projectId)}/${encodeURIComponent(mediaId)}?user=${encodeURIComponent(new URLSearchParams(location.hash.slice(1)).get('user') || 'default')}`

export const createStoredMediaAsset = (projectId: string, metadata: EditingMediaMetadata): MediaAsset => {
  const url = editingMediaUrl(projectId, metadata.id)
  return { ...metadata, file: createRemoteFile(metadata, url), url }
}

async function hydrateVideoThumbnail(
  projectId: string,
  asset: MediaAsset
): Promise<MediaAsset> {
  if (asset.type !== 'video' || asset.thumbnailUrl) return asset
  try {
    await inspectGeneratedDirectorMedia(asset)
    await operation('media:update-metadata', {
      projectId,
      id: asset.id,
      patch: { thumbnailUrl: asset.thumbnailUrl, duration: asset.duration, width: asset.width, height: asset.height }
    }).catch(() => undefined)
  } catch (error) {
    console.warn('Failed to generate stored video thumbnail:', error)
  }
  return asset
}

async function operation<T>(
  name: Parameters<typeof request>[0],
  payload: unknown,
  transfer: Transferable[] = []
): Promise<T> {
  try {
    const result = await request<T>(name, payload, transfer)
    nativeStorageState.error = null
    return result
  } catch (error) {
    nativeStorageState.error = error instanceof Error ? error : new Error(String(error))
    throw nativeStorageState.error
  }
}

function serialize(project: TProject): SerializedProject {
  return {
    ...project,
    metadata: {
      ...project.metadata,
      createdAt: project.metadata.createdAt.toISOString(),
      updatedAt: project.metadata.updatedAt.toISOString()
    },
    scenes: project.scenes.map((scene) => ({
      ...scene,
      createdAt: scene.createdAt.toISOString(),
      updatedAt: scene.updatedAt.toISOString(),
      tracks: scene.tracks.map((track) =>
        track.type === 'audio'
          ? { ...track, elements: track.elements.map(({ buffer: _buffer, ...element }) => element) }
          : track
      )
    }))
  }
}

function hydrate(project: SerializedProject): TProject {
  return {
    ...project,
    metadata: {
      ...project.metadata,
      createdAt: new Date(project.metadata.createdAt),
      updatedAt: new Date(project.metadata.updatedAt)
    },
    scenes: project.scenes.map((scene) => ({
      ...scene,
      createdAt: new Date(scene.createdAt),
      updatedAt: new Date(scene.updatedAt)
    }))
  }
}

export const storageService = {
  async saveProject({ project }: { project: TProject }): Promise<void> {
    await operation('projects:save', { project: serialize(project) })
  },
  async loadProject({ id }: { id: string }): Promise<{ project: TProject } | null> {
    const value = await operation<SerializedProject | null>('projects:load', { id })
    return value ? { project: hydrate(value) } : null
  },
  async loadAllProjectsMetadata(): Promise<TProjectMetadata[]> {
    const projects = await operation<EditingProjectSummary[]>('projects:list', {})
    return projects.map((project) => ({
      ...project,
      createdAt: new Date(project.createdAt),
      updatedAt: new Date(project.updatedAt)
    }))
  },
  async saveMediaAsset({
    projectId,
    mediaAsset
  }: {
    projectId: string
    mediaAsset: MediaAsset
  }): Promise<void> {
    const { file, url: _url, ...details } = mediaAsset
    const metadata: EditingMediaMetadata = {
      ...details,
      mimeType: file.type,
      size: file.size,
      lastModified: file.lastModified
    }
    await persistMedia(`${projectId}:${mediaAsset.id}`, async () => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await operation('media:save', { projectId, metadata, bytes }, [bytes.buffer])
    })
  },
  async loadMediaAsset({
    projectId,
    id
  }: {
    projectId: string
    id: string
  }): Promise<MediaAsset | null> {
    const items = await operation<EditingMediaMetadata[]>('media:list', { projectId })
    const metadata = items.find((item) => item.id === id)
    return metadata
      ? hydrateVideoThumbnail(projectId, createStoredMediaAsset(projectId, metadata))
      : null
  },
  async loadAllMediaAssets({ projectId }: { projectId: string }): Promise<MediaAsset[]> {
    const items = await operation<EditingMediaMetadata[]>('media:list', { projectId })
    return Promise.all(
      items.map((item) => hydrateVideoThumbnail(projectId, createStoredMediaAsset(projectId, item)))
    )
  },
  async deleteMediaAsset({ projectId, id }: { projectId: string; id: string }): Promise<void> {
    await persistMedia(`${projectId}:${id}`, () => operation('media:remove', { projectId, id }))
  },
  async deleteProjectMedia(_options: unknown): Promise<void> {
    throw new Error('请从剪辑首页管理工程')
  },
  async deleteProject(_options: unknown): Promise<void> {
    throw new Error('工程删除功能暂未开放')
  }
}
