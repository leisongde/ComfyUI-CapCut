import type { EditingMediaMetadata } from '../../../shared/editing'

// BlobSource opens streams extending to EOF, then reads only what its decoder needs.
// Fetch bounded ranges on pull so unused video bytes never accumulate in the renderer.
const STREAM_CHUNK_BYTES = 1024 * 1024

function normalizeRange(start: number | undefined, end: number | undefined, size: number) {
  const normalize = (value: number | undefined, fallback: number): number => {
    if (value === undefined) return fallback
    const integer = Math.trunc(Number(value) || 0)
    return integer < 0 ? Math.max(size + integer, 0) : Math.min(integer, size)
  }
  const from = normalize(start, 0)
  return [from, Math.max(from, normalize(end, size))] as const
}

async function readRange(
  url: string,
  start: number,
  end: number,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  if (start === end) return new ArrayBuffer(0)
  const response = await fetch(url, {
    headers: { Range: `bytes=${start}-${end - 1}` },
    signal
  })
  if (response.status !== 206) {
    await response.body?.cancel()
    throw new Error(`读取剪辑素材失败：服务器未返回请求的范围 (${response.status})`)
  }
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength !== end - start) throw new Error('剪辑素材不完整，请重新打开工程')
  return bytes
}

function rangeMethods(url: string, start: number, end: number) {
  return {
    size: { configurable: true, value: end - start },
    arrayBuffer: { configurable: true, value: () => readRange(url, start, end) },
    text: {
      configurable: true,
      value: async () => new TextDecoder().decode(await readRange(url, start, end))
    },
    stream: {
      configurable: true,
      value: () => {
        let position = start
        const abort = new AbortController()
        return new ReadableStream<Uint8Array>(
          {
            async pull(controller) {
              if (position >= end) {
                controller.close()
                return
              }
              try {
                const next = Math.min(position + STREAM_CHUNK_BYTES, end)
                const bytes = await readRange(url, position, next, abort.signal)
                if (abort.signal.aborted) return
                position = next
                controller.enqueue(new Uint8Array(bytes))
                if (position === end) controller.close()
              } catch (error) {
                if (!abort.signal.aborted) controller.error(error)
              }
            },
            cancel() {
              abort.abort()
            }
          },
          { highWaterMark: 0 }
        )
      }
    },
    slice: {
      configurable: true,
      value: (nestedStart?: number, nestedEnd?: number, nestedType = '') => {
        const [from, to] = normalizeRange(nestedStart, nestedEnd, end - start)
        return Object.defineProperties(
          new Blob([], { type: nestedType }),
          rangeMethods(url, start + from, start + to)
        )
      }
    }
  }
}

/** File interface for Cutia's decoders; HTML media elements use the URL directly. */
export function createRemoteFile(metadata: EditingMediaMetadata, url: string): File {
  const file = new File([], metadata.name, {
    type: metadata.mimeType,
    lastModified: Number.isFinite(metadata.lastModified) ? metadata.lastModified : Date.now()
  })
  const size = Math.max(0, Number(metadata.size) || 0)
  return Object.defineProperties(file, rangeMethods(url, 0, size))
}
