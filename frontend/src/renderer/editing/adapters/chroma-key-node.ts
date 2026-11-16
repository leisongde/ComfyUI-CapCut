import { CanvasRenderer } from '@cutia/services/renderer/canvas-renderer'
import { BaseNode } from '@cutia/services/renderer/nodes/base-node'
import { chromaColorToRgb, normalizeChromaKey, type ChromaKeySettings } from '../chroma-key'

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = vec2((a_position.x + 1.0) * 0.5, (1.0 - a_position.y) * 0.5);
  gl_Position = vec4(a_position, 0.0, 1.0);
}`

const FRAGMENT_SHADER = `
precision highp float;
uniform sampler2D u_texture;
uniform vec2 u_texel;
uniform vec3 u_key_color;
uniform float u_intensity;
uniform float u_shadow;
uniform float u_edge_smooth;
uniform float u_spill;
varying vec2 v_uv;

vec3 unpremultiply(vec4 sampled) {
  return sampled.a > 0.0001 ? sampled.rgb / sampled.a : vec3(0.0);
}

vec3 rgbToYuv(vec3 color) {
  return vec3(
    dot(color, vec3(0.299, 0.587, 0.114)),
    dot(color, vec3(-0.169, -0.331, 0.5)),
    dot(color, vec3(0.5, -0.419, -0.081))
  );
}

float keyAlphaAt(vec2 uv) {
  vec4 sampled = texture2D(u_texture, uv);
  if (sampled.a <= 0.0001) return 0.0;
  vec3 sourceYuv = rgbToYuv(unpremultiply(sampled));
  vec3 keyYuv = rgbToYuv(u_key_color);
  float chromaDistance = distance(sourceYuv.yz, keyYuv.yz);
  float lumaDistance = abs(sourceYuv.x - keyYuv.x);
  float colorDistance = chromaDistance + lumaDistance * (1.0 - u_shadow) * 0.35;
  float threshold = mix(0.018, 0.38, u_intensity);
  float softness = mix(0.006, 0.16, u_edge_smooth);
  return smoothstep(threshold, threshold + softness, colorDistance);
}

void main() {
  vec4 sampled = texture2D(u_texture, v_uv);
  if (sampled.a <= 0.0001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float centerAlpha = keyAlphaAt(v_uv);
  float neighborAlpha = (
    keyAlphaAt(v_uv + vec2(-u_texel.x, -u_texel.y)) +
    keyAlphaAt(v_uv + vec2(0.0, -u_texel.y)) +
    keyAlphaAt(v_uv + vec2(u_texel.x, -u_texel.y)) +
    keyAlphaAt(v_uv + vec2(-u_texel.x, 0.0)) +
    centerAlpha * 4.0 +
    keyAlphaAt(v_uv + vec2(u_texel.x, 0.0)) +
    keyAlphaAt(v_uv + vec2(-u_texel.x, u_texel.y)) +
    keyAlphaAt(v_uv + vec2(0.0, u_texel.y)) +
    keyAlphaAt(v_uv + vec2(u_texel.x, u_texel.y))
  ) / 12.0;
  float matte = mix(centerAlpha, neighborAlpha, u_edge_smooth);

  vec3 color = unpremultiply(sampled);
  float keyAverage = (u_key_color.r + u_key_color.g + u_key_color.b) / 3.0;
  vec3 keyDirection = u_key_color - vec3(keyAverage);
  float directionLength = max(dot(keyDirection, keyDirection), 0.0001);
  float spillProjection = max(0.0, dot(color - vec3(dot(color, vec3(0.333333))), keyDirection));
  vec3 cleaned = color - keyDirection * (spillProjection / directionLength) * u_spill * (1.0 - matte);

  float alpha = sampled.a * matte;
  gl_FragColor = vec4(clamp(cleaned, 0.0, 1.0) * alpha, alpha);
}`

type ChromaSource = HTMLCanvasElement | OffscreenCanvas

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('无法创建色度抠图着色器')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader) || '未知着色器错误'
    gl.deleteShader(shader)
    throw new Error(`色度抠图着色器编译失败: ${detail}`)
  }
  return shader
}

class ChromaKeyShaderPass {
  readonly canvas = document.createElement('canvas')
  private readonly gl: WebGLRenderingContext
  private readonly program: WebGLProgram
  private readonly texture: WebGLTexture
  private readonly buffer: WebGLBuffer
  private readonly uniforms: Record<string, WebGLUniformLocation | null>

  constructor() {
    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true
    })
    if (!gl) throw new Error('当前设备无法创建 WebGL 色度抠图上下文')
    this.gl = gl

    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    const program = gl.createProgram()
    if (!program) throw new Error('无法创建色度抠图程序')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`色度抠图程序链接失败: ${gl.getProgramInfoLog(program) || '未知错误'}`)
    }
    this.program = program

    const buffer = gl.createBuffer()
    const texture = gl.createTexture()
    if (!buffer || !texture) throw new Error('无法创建色度抠图纹理')
    this.buffer = buffer
    this.texture = texture
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    )
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    this.uniforms = Object.fromEntries(
      [
        'u_texture',
        'u_texel',
        'u_key_color',
        'u_intensity',
        'u_shadow',
        'u_edge_smooth',
        'u_spill'
      ].map((name) => [name, gl.getUniformLocation(program, name)])
    )
  }

  render(input: {
    source: ChromaSource
    width: number
    height: number
    settings: ChromaKeySettings
  }): HTMLCanvasElement {
    const { gl } = this
    if (gl.isContextLost()) throw new Error('WebGL 色度抠图上下文已丢失')
    if (this.canvas.width !== input.width || this.canvas.height !== input.height) {
      this.canvas.width = input.width
      this.canvas.height = input.height
    }
    gl.viewport(0, 0, input.width, input.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.program)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    const position = gl.getAttribLocation(this.program, 'a_position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, input.source)

    const [red, green, blue] = chromaColorToRgb(input.settings.color)
    gl.uniform1i(this.uniforms.u_texture, 0)
    gl.uniform2f(this.uniforms.u_texel, 1 / input.width, 1 / input.height)
    gl.uniform3f(this.uniforms.u_key_color, red, green, blue)
    gl.uniform1f(this.uniforms.u_intensity, input.settings.intensity)
    gl.uniform1f(this.uniforms.u_shadow, input.settings.shadow)
    gl.uniform1f(this.uniforms.u_edge_smooth, input.settings.edgeSmooth)
    gl.uniform1f(this.uniforms.u_spill, input.settings.spill)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    gl.flush()
    return this.canvas
  }
}

export class ChromaKeyNode extends BaseNode {
  private intermediate?: CanvasRenderer
  private pass?: ChromaKeyShaderPass
  private warned = false

  constructor(
    private readonly input: {
      node: BaseNode
      settings: unknown
    }
  ) {
    super()
  }

  private ensureIntermediate(renderer: CanvasRenderer): CanvasRenderer {
    if (!this.intermediate) {
      this.intermediate = new CanvasRenderer({
        width: renderer.width,
        height: renderer.height,
        fps: renderer.fps,
        imageSmoothingQuality: 'high'
      })
    } else if (
      this.intermediate.width !== renderer.width ||
      this.intermediate.height !== renderer.height
    ) {
      this.intermediate.setSize({ width: renderer.width, height: renderer.height })
    }
    return this.intermediate
  }

  async render({ renderer, time }: { renderer: CanvasRenderer; time: number }): Promise<void> {
    const settings = normalizeChromaKey(this.input.settings)
    if (!settings.enabled) {
      await this.input.node.render({ renderer, time })
      return
    }

    const intermediate = this.ensureIntermediate(renderer)
    intermediate.context.save()
    intermediate.context.setTransform(1, 0, 0, 1, 0, 0)
    intermediate.context.clearRect(0, 0, intermediate.width, intermediate.height)
    intermediate.context.restore()
    await this.input.node.render({ renderer: intermediate, time })

    try {
      this.pass ??= new ChromaKeyShaderPass()
      const keyed = this.pass.render({
        source: intermediate.canvas,
        width: renderer.width,
        height: renderer.height,
        settings
      })
      renderer.context.drawImage(keyed, 0, 0, renderer.width, renderer.height)
    } catch (error) {
      this.pass = undefined
      if (!this.warned) {
        this.warned = true
        console.warn('WebGL 色度抠图不可用，已显示原始画面', error)
      }
      renderer.context.drawImage(intermediate.canvas, 0, 0, renderer.width, renderer.height)
    }
  }
}
