import { CanvasRenderer } from '@cutia/services/renderer/canvas-renderer'
import { BaseNode } from '@cutia/services/renderer/nodes/base-node'
import type { ClipFilterParameters, DesktopClipFilter } from '../clip-filters'
import { normalizeClipFilter } from '../clip-filters'

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
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_gamma;
uniform float u_hue;
uniform float u_temperature;
uniform float u_tint;
uniform float u_fade;
uniform float u_vignette;
uniform float u_grain;
uniform float u_cinematic;
uniform vec3 u_channels;
varying vec2 v_uv;

float luminance(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

float random2(vec2 point) {
  return fract(sin(dot(point, vec2(12.9898, 78.233))) * 43758.5453123);
}

vec3 rotateHue(vec3 color, float angle) {
  const mat3 rgbToYiq = mat3(
    0.299, 0.587, 0.114,
    0.596, -0.275, -0.321,
    0.212, -0.523, 0.311
  );
  const mat3 yiqToRgb = mat3(
    1.0, 0.956, 0.621,
    1.0, -0.272, -0.647,
    1.0, -1.106, 1.703
  );
  vec3 yiq = rgbToYiq * color;
  float hue = atan(yiq.z, yiq.y) + angle;
  float chroma = length(yiq.yz);
  return yiqToRgb * vec3(yiq.x, chroma * cos(hue), chroma * sin(hue));
}

void main() {
  vec4 sampled = texture2D(u_texture, v_uv);
  if (sampled.a <= 0.0001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 original = sampled.rgb / sampled.a;
  vec3 color = original * u_channels;
  color *= u_brightness;
  color = pow(max(color, vec3(0.0)), vec3(1.0 / max(u_gamma, 0.001)));
  color = (color - 0.5) * u_contrast + 0.5;
  float gray = luminance(color);
  color = mix(vec3(gray), color, u_saturation);
  color = rotateHue(color, u_hue);

  color += vec3(u_temperature * 0.10, u_temperature * 0.025, -u_temperature * 0.10);
  color += vec3(u_tint * 0.055, -u_tint * 0.07, u_tint * 0.055);

  float toneLuma = luminance(color);
  float shadows = 1.0 - smoothstep(0.18, 0.68, toneLuma);
  float highlights = smoothstep(0.32, 0.9, toneLuma);
  color += vec3(-0.025, 0.04, 0.075) * shadows * u_cinematic;
  color += vec3(0.085, 0.03, -0.035) * highlights * u_cinematic;

  color = mix(color, color * 0.72 + vec3(0.14), u_fade);
  float edge = smoothstep(0.28, 0.74, distance(v_uv, vec2(0.5)) * 1.22);
  color *= 1.0 - edge * u_vignette * 0.58;

  float grain = random2(gl_FragCoord.xy + vec2(floor(u_time * 24.0) * 17.0));
  color += (grain - 0.5) * u_grain * 0.13;

  vec3 result = mix(original, clamp(color, 0.0, 1.0), u_intensity);
  gl_FragColor = vec4(result * sampled.a, sampled.a);
}`

type FilterSource = HTMLCanvasElement | OffscreenCanvas

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('无法创建滤镜着色器')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader) || '未知着色器错误'
    gl.deleteShader(shader)
    throw new Error(`滤镜着色器编译失败: ${detail}`)
  }
  return shader
}

class FilterShaderPass {
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
    if (!gl) throw new Error('当前设备无法创建 WebGL 滤镜上下文')
    this.gl = gl
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    const program = gl.createProgram()
    if (!program) throw new Error('无法创建滤镜程序')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`滤镜程序链接失败: ${gl.getProgramInfoLog(program) || '未知错误'}`)
    this.program = program

    const buffer = gl.createBuffer()
    const texture = gl.createTexture()
    if (!buffer || !texture) throw new Error('无法创建滤镜纹理')
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
        'u_resolution',
        'u_time',
        'u_intensity',
        'u_brightness',
        'u_contrast',
        'u_saturation',
        'u_gamma',
        'u_hue',
        'u_temperature',
        'u_tint',
        'u_fade',
        'u_vignette',
        'u_grain',
        'u_cinematic',
        'u_channels'
      ].map((name) => [name, gl.getUniformLocation(program, name)])
    )
  }

  render(input: {
    source: FilterSource
    width: number
    height: number
    filter: DesktopClipFilter
    time: number
  }): HTMLCanvasElement {
    const { gl } = this
    if (gl.isContextLost()) throw new Error('WebGL 滤镜上下文已丢失')
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

    const params = input.filter.parameters
    gl.uniform1i(this.uniforms.u_texture, 0)
    gl.uniform2f(this.uniforms.u_resolution, input.width, input.height)
    gl.uniform1f(this.uniforms.u_time, input.time)
    gl.uniform1f(this.uniforms.u_intensity, input.filter.intensity)
    gl.uniform1f(this.uniforms.u_brightness, params.brightness)
    gl.uniform1f(this.uniforms.u_contrast, params.contrast)
    gl.uniform1f(this.uniforms.u_saturation, params.saturation)
    gl.uniform1f(this.uniforms.u_gamma, params.gamma)
    gl.uniform1f(this.uniforms.u_hue, (params.hue * Math.PI) / 180)
    gl.uniform1f(this.uniforms.u_temperature, params.temperature)
    gl.uniform1f(this.uniforms.u_tint, params.tint)
    gl.uniform1f(this.uniforms.u_fade, params.fade)
    gl.uniform1f(this.uniforms.u_vignette, params.vignette)
    gl.uniform1f(this.uniforms.u_grain, params.grain)
    gl.uniform1f(this.uniforms.u_cinematic, params.cinematic)
    gl.uniform3f(this.uniforms.u_channels, params.red, params.green, params.blue)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    gl.flush()
    return this.canvas
  }
}

function interpolate(neutral: number, value: number, intensity: number): number {
  return neutral + (value - neutral) * intensity
}

function canvasFilter(parameters: ClipFilterParameters, intensity: number): string {
  return [
    `brightness(${interpolate(1, parameters.brightness, intensity)})`,
    `contrast(${interpolate(1, parameters.contrast, intensity)})`,
    `saturate(${interpolate(1, parameters.saturation, intensity)})`,
    `hue-rotate(${parameters.hue * intensity}deg)`
  ].join(' ')
}

export class FilterNode extends BaseNode {
  private intermediate?: CanvasRenderer
  private pass?: FilterShaderPass
  private warned = false

  constructor(
    private readonly input: {
      node: BaseNode
      filter: unknown
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
    const filter = normalizeClipFilter(this.input.filter)
    if (!filter?.enabled || filter.intensity <= 0) {
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
      this.pass ??= new FilterShaderPass()
      const source = this.pass.render({
        source: intermediate.canvas,
        width: renderer.width,
        height: renderer.height,
        filter,
        time
      })
      renderer.context.drawImage(source, 0, 0, renderer.width, renderer.height)
    } catch (error) {
      this.pass = undefined
      if (!this.warned) {
        this.warned = true
        console.warn('WebGL 滤镜不可用，已回退到基础调色', error)
      }
      renderer.context.save()
      renderer.context.filter = canvasFilter(filter.parameters, filter.intensity)
      renderer.context.drawImage(intermediate.canvas, 0, 0, renderer.width, renderer.height)
      renderer.context.restore()
    }
  }
}
