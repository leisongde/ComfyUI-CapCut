import { CanvasRenderer } from '@cutia/services/renderer/canvas-renderer'
import { BaseNode } from '@cutia/services/renderer/nodes/base-node'
import {
  HSL_BAND_IDS,
  resolveColorAdjustment,
  type AdjustmentCurvePoint,
  type ColorAdjustment,
  type ColorWheelValue
} from '../color-adjustment'
import type { DesktopClipFilter } from '../clip-filters'
import { ClipMaskNode } from './clip-mask-node'
import { CustomCutoutNode } from './custom-cutout-node'

type CanvasSource = HTMLCanvasElement | OffscreenCanvas

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
uniform sampler2D u_rgbCurves;
uniform sampler2D u_hslCurves;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_basic[16];
uniform vec4 u_hslMeta[18];
uniform vec4 u_hslAdjust[18];
uniform vec4 u_primaryWheels[4];
uniform vec4 u_logWheels[4];
uniform vec4 u_wheelOptions;
uniform float u_lumaMix;
varying vec2 v_uv;

float luma(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

float random2(vec2 point) {
  return fract(sin(dot(point, vec2(12.9898, 78.233))) * 43758.5453123);
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -0.3333333333, 0.6666666667, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 0.6666666667, 0.3333333333)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

float hueDistance(float a, float b) {
  float distance = abs(a - b);
  return min(distance, 1.0 - distance);
}

vec3 wheelTint(vec4 wheel) {
  vec3 pure = hsv2rgb(vec3(fract(wheel.x), 1.0, 1.0));
  return (pure - vec3(luma(pure))) * wheel.y;
}

vec3 applyWheel(vec3 color, vec4 wheel, float weight) {
  if (wheel.w < 0.5 || weight <= 0.0001) return color;
  return color + (wheelTint(wheel) + vec3(wheel.z)) * weight;
}

void main() {
  vec4 sampled = texture2D(u_texture, v_uv);
  if (sampled.a <= 0.0001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 original = sampled.rgb / sampled.a;
  vec3 color = original;
  float temperature = u_basic[0];
  float tint = u_basic[1];
  float saturation = u_basic[2];
  float vibrance = u_basic[3];
  float brightness = u_basic[4];
  float contrast = u_basic[5];
  float highlights = u_basic[6];
  float shadows = u_basic[7];
  float whites = u_basic[8];
  float blacks = u_basic[9];
  float brilliance = u_basic[10];
  float sharpen = u_basic[11];
  float clarity = u_basic[12];
  float grain = u_basic[13];
  float fade = u_basic[14];
  float vignette = u_basic[15];

  color += vec3(temperature * 0.12, temperature * 0.025, -temperature * 0.12);
  color += vec3(tint * 0.065, -tint * 0.075, tint * 0.065);
  color *= exp2(brightness);
  color = (color - 0.5) * (1.0 + contrast) + 0.5;

  float tone = luma(color);
  float shadowWeight = 1.0 - smoothstep(0.05, 0.58, tone);
  float highlightWeight = smoothstep(0.42, 0.95, tone);
  color += vec3(shadows * 0.42 * shadowWeight + highlights * 0.34 * highlightWeight);
  color += vec3(blacks * 0.28 * (1.0 - smoothstep(0.0, 0.28, tone)));
  color += vec3(whites * 0.24 * smoothstep(0.72, 1.0, tone));
  color += (color - vec3(tone)) * brilliance * (0.28 + 0.55 * (1.0 - abs(tone - 0.5) * 2.0));

  float gray = luma(color);
  color = mix(vec3(gray), color, 1.0 + saturation);
  float currentSaturation = max(max(color.r, color.g), color.b) - min(min(color.r, color.g), color.b);
  color = mix(vec3(luma(color)), color, 1.0 + vibrance * (1.0 - currentSaturation));

  vec3 hsv = rgb2hsv(max(color, vec3(0.0)));
  for (int index = 0; index < 18; index++) {
    vec4 meta = u_hslMeta[index];
    vec4 adjustment = u_hslAdjust[index];
    float weight = (1.0 - smoothstep(meta.y * 0.45, meta.y, hueDistance(hsv.x, meta.x))) * meta.z;
    hsv.x = fract(hsv.x + adjustment.x * weight * 0.18 + 1.0);
    hsv.y = clamp(hsv.y * (1.0 + adjustment.y * weight), 0.0, 1.0);
    hsv.z = clamp(hsv.z + adjustment.z * weight * 0.45, 0.0, 1.0);
  }

  vec4 hueCurves = texture2D(u_hslCurves, vec2(hsv.x, 0.25));
  hsv.x = fract(hsv.x + (hueCurves.r - 0.5) * 0.5 + 1.0);
  hsv.y = clamp(hsv.y * (0.25 + hueCurves.g * 1.5), 0.0, 1.0);
  hsv.z = clamp(hsv.z + (hueCurves.b - 0.5) * 0.7, 0.0, 1.0);
  vec4 mixedCurves = texture2D(u_hslCurves, vec2(clamp(hsv.z, 0.0, 1.0), 0.75));
  float saturationCurve = texture2D(u_hslCurves, vec2(clamp(hsv.y, 0.0, 1.0), 0.75)).g;
  float saturationLightnessCurve = texture2D(u_hslCurves, vec2(clamp(hsv.y, 0.0, 1.0), 0.75)).b;
  hsv.y = clamp(hsv.y * (0.25 + mixedCurves.r * 1.5) * (0.25 + saturationCurve * 1.5), 0.0, 1.0);
  hsv.z = clamp(hsv.z + (saturationLightnessCurve - 0.5) * 0.7, 0.0, 1.0);
  color = hsv2rgb(hsv);

  float wheelLuma = luma(color);
  if (u_wheelOptions.x > 0.5) {
    color = applyWheel(color, u_primaryWheels[0], 1.0 - smoothstep(0.08, 0.62, wheelLuma));
    color = applyWheel(color, u_primaryWheels[1], 1.0 - abs(wheelLuma - 0.5) * 2.0);
    color = applyWheel(color, u_primaryWheels[2], smoothstep(0.38, 0.95, wheelLuma));
    color = applyWheel(color, u_primaryWheels[3], 1.0);
  }
  if (u_wheelOptions.y > 0.5) {
    float shadowRange = u_wheelOptions.z;
    float highlightRange = u_wheelOptions.w;
    color = applyWheel(color, u_logWheels[0], 1.0 - smoothstep(shadowRange * 0.45, shadowRange, wheelLuma));
    color = applyWheel(color, u_logWheels[1], smoothstep(shadowRange * 0.5, shadowRange, wheelLuma) * (1.0 - smoothstep(highlightRange, min(1.0, highlightRange + 0.28), wheelLuma)));
    color = applyWheel(color, u_logWheels[2], smoothstep(highlightRange, min(1.0, highlightRange + 0.32), wheelLuma));
    color = applyWheel(color, u_logWheels[3], 1.0);
  }

  if (u_wheelOptions.x > 0.5) {
    float changedLuma = max(0.0001, luma(color));
    vec3 preserved = color * (wheelLuma / changedLuma);
    color = mix(color, preserved, u_lumaMix);
  }

  vec4 rgbCurve = texture2D(u_rgbCurves, vec2(clamp(color.r, 0.0, 1.0), 0.5));
  float red = rgbCurve.r;
  rgbCurve = texture2D(u_rgbCurves, vec2(clamp(color.g, 0.0, 1.0), 0.5));
  float green = rgbCurve.g;
  rgbCurve = texture2D(u_rgbCurves, vec2(clamp(color.b, 0.0, 1.0), 0.5));
  float blue = rgbCurve.b;
  color = vec3(red, green, blue);

  vec2 pixel = 1.0 / max(u_resolution, vec2(1.0));
  vec3 north = texture2D(u_texture, v_uv + vec2(0.0, -pixel.y)).rgb;
  vec3 south = texture2D(u_texture, v_uv + vec2(0.0, pixel.y)).rgb;
  vec3 west = texture2D(u_texture, v_uv + vec2(-pixel.x, 0.0)).rgb;
  vec3 east = texture2D(u_texture, v_uv + vec2(pixel.x, 0.0)).rgb;
  vec3 neighbor = (north + south + west + east) * 0.25;
  color += (original - neighbor) * sharpen * 0.75;
  float localContrast = luma(original - neighbor);
  color += vec3(localContrast * clarity * 0.8);

  color = mix(color, color * 0.7 + vec3(0.15), fade);
  float edge = smoothstep(0.28, 0.78, distance(v_uv, vec2(0.5)) * 1.22);
  color *= 1.0 - edge * vignette * 0.62;
  color += (random2(gl_FragCoord.xy + vec2(floor(u_time * 24.0) * 17.0)) - 0.5) * grain * 0.14;

  vec3 result = mix(original, clamp(color, 0.0, 1.0), u_intensity);
  gl_FragColor = vec4(result * sampled.a, sampled.a);
}`

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('无法创建调色着色器')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader) || '未知着色器错误'
    gl.deleteShader(shader)
    throw new Error(`调色着色器编译失败: ${detail}`)
  }
  return shader
}

function sampleCurve(points: AdjustmentCurvePoint[], position: number): number {
  const rightIndex = points.findIndex((point) => point.x >= position)
  if (rightIndex <= 0) return points[0]?.y ?? position
  if (rightIndex < 0) return points.at(-1)?.y ?? position
  const left = points[rightIndex - 1]
  const right = points[rightIndex]
  const span = Math.max(0.0001, right.x - left.x)
  return left.y + (right.y - left.y) * ((position - left.x) / span)
}

function createRgbCurveData(adjustment: ColorAdjustment): Uint8Array {
  const data = new Uint8Array(256 * 4)
  for (let index = 0; index < 256; index += 1) {
    const input = index / 255
    const offset = index * 4
    data[offset] = Math.round(sampleCurve(adjustment.curves.rgb.master, sampleCurve(adjustment.curves.rgb.red, input)) * 255)
    data[offset + 1] = Math.round(sampleCurve(adjustment.curves.rgb.master, sampleCurve(adjustment.curves.rgb.green, input)) * 255)
    data[offset + 2] = Math.round(sampleCurve(adjustment.curves.rgb.master, sampleCurve(adjustment.curves.rgb.blue, input)) * 255)
    data[offset + 3] = 255
  }
  return data
}

function createHslCurveData(adjustment: ColorAdjustment): Uint8Array {
  const data = new Uint8Array(256 * 2 * 4)
  const upper = [
    adjustment.curves.hsl.hueHue,
    adjustment.curves.hsl.hueSaturation,
    adjustment.curves.hsl.hueLightness
  ]
  const lower = [
    adjustment.curves.hsl.lightnessSaturation,
    adjustment.curves.hsl.saturationSaturation,
    adjustment.curves.hsl.saturationLightness
  ]
  for (let index = 0; index < 256; index += 1) {
    const input = index / 255
    for (let channel = 0; channel < 3; channel += 1) {
      data[index * 4 + channel] = Math.round(sampleCurve(upper[channel], input) * 255)
      data[(256 + index) * 4 + channel] = Math.round(sampleCurve(lower[channel], input) * 255)
    }
    data[index * 4 + 3] = 255
    data[(256 + index) * 4 + 3] = 255
  }
  return data
}

function hexHue(color: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  if (!match) return 0
  const red = Number.parseInt(match[1], 16) / 255
  const green = Number.parseInt(match[2], 16) / 255
  const blue = Number.parseInt(match[3], 16) / 255
  const maximum = Math.max(red, green, blue)
  const minimum = Math.min(red, green, blue)
  const delta = maximum - minimum
  if (delta <= 0.0001) return 0
  const hue =
    maximum === red
      ? ((green - blue) / delta) % 6
      : maximum === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4
  return ((hue / 6) + 1) % 1
}

const HSL_CENTERS = [0, 0.083, 0.167, 0.333, 0.5, 0.667, 0.78, 0.9]

function packHslBands(adjustment: ColorAdjustment): { meta: Float32Array; values: Float32Array } {
  const meta = new Float32Array(18 * 4)
  const values = new Float32Array(18 * 4)
  HSL_BAND_IDS.forEach((band, index) => {
    meta.set([HSL_CENTERS[index], index === 0 ? 0.115 : 0.105, 1, 0], index * 4)
    const value = adjustment.hsl[band]
    values.set([value.hue, value.saturation, value.lightness, 0], index * 4)
  })
  adjustment.customHsl.slice(0, 10).forEach((band, customIndex) => {
    const index = HSL_BAND_IDS.length + customIndex
    meta.set([hexHue(band.color), 0.075, 1, 0], index * 4)
    values.set([band.hue, band.saturation, band.lightness, 0], index * 4)
  })
  return { meta, values }
}

function packWheels(wheels: ColorWheelValue[], enabled: boolean): Float32Array {
  const output = new Float32Array(16)
  wheels.forEach((wheel, index) => {
    output.set(
      [((wheel.hue / 360) % 1 + 1) % 1, wheel.saturation, wheel.luminance, enabled ? 1 : 0],
      index * 4
    )
  })
  if (!enabled) {
    for (let index = 0; index < 4; index += 1) output[index * 4 + 3] = 0
  }
  return output
}

class ColorAdjustmentPass {
  readonly canvas = document.createElement('canvas')
  private readonly gl: WebGLRenderingContext
  private readonly program: WebGLProgram
  private readonly sourceTexture: WebGLTexture
  private readonly rgbCurveTexture: WebGLTexture
  private readonly hslCurveTexture: WebGLTexture
  private readonly buffer: WebGLBuffer
  private readonly uniforms: Record<string, WebGLUniformLocation | null>

  constructor() {
    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true
    })
    if (!gl) throw new Error('当前设备无法创建 WebGL 调色上下文')
    this.gl = gl
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    const program = gl.createProgram()
    if (!program) throw new Error('无法创建调色程序')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`调色程序链接失败: ${gl.getProgramInfoLog(program) || '未知错误'}`)
    this.program = program
    const buffer = gl.createBuffer()
    const sourceTexture = gl.createTexture()
    const rgbCurveTexture = gl.createTexture()
    const hslCurveTexture = gl.createTexture()
    if (!buffer || !sourceTexture || !rgbCurveTexture || !hslCurveTexture)
      throw new Error('无法创建调色纹理')
    this.buffer = buffer
    this.sourceTexture = sourceTexture
    this.rgbCurveTexture = rgbCurveTexture
    this.hslCurveTexture = hslCurveTexture
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    )
    for (const texture of [sourceTexture, rgbCurveTexture, hslCurveTexture]) {
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    this.uniforms = Object.fromEntries(
      [
        'u_texture',
        'u_rgbCurves',
        'u_hslCurves',
        'u_resolution',
        'u_time',
        'u_intensity',
        'u_basic[0]',
        'u_hslMeta[0]',
        'u_hslAdjust[0]',
        'u_primaryWheels[0]',
        'u_logWheels[0]',
        'u_wheelOptions',
        'u_lumaMix'
      ].map((name) => [name, gl.getUniformLocation(program, name)])
    )
  }

  private uploadTexture(unit: number, texture: WebGLTexture, width: number, height: number, source: CanvasSource | Uint8Array): void {
    const { gl } = this
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    if (source instanceof Uint8Array)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  }

  render(input: {
    source: CanvasSource
    width: number
    height: number
    adjustment: ColorAdjustment
    time: number
  }): HTMLCanvasElement {
    const { gl } = this
    if (gl.isContextLost()) throw new Error('WebGL 调色上下文已丢失')
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
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
    this.uploadTexture(0, this.sourceTexture, input.width, input.height, input.source)
    this.uploadTexture(1, this.rgbCurveTexture, 256, 1, createRgbCurveData(input.adjustment))
    this.uploadTexture(2, this.hslCurveTexture, 256, 2, createHslCurveData(input.adjustment))

    const basic = input.adjustment.basic
    const packedBands = packHslBands(input.adjustment)
    gl.uniform1i(this.uniforms.u_texture, 0)
    gl.uniform1i(this.uniforms.u_rgbCurves, 1)
    gl.uniform1i(this.uniforms.u_hslCurves, 2)
    gl.uniform2f(this.uniforms.u_resolution, input.width, input.height)
    gl.uniform1f(this.uniforms.u_time, input.time)
    gl.uniform1f(this.uniforms.u_intensity, input.adjustment.intensity)
    gl.uniform1fv(
      this.uniforms['u_basic[0]'],
      new Float32Array([
        basic.temperature,
        basic.tint,
        basic.saturation,
        basic.vibrance,
        basic.brightness,
        basic.contrast,
        basic.highlights,
        basic.shadows,
        basic.whites,
        basic.blacks,
        basic.brilliance,
        basic.sharpen,
        basic.clarity,
        basic.grain,
        basic.fade,
        basic.vignette
      ])
    )
    gl.uniform4fv(this.uniforms['u_hslMeta[0]'], packedBands.meta)
    gl.uniform4fv(this.uniforms['u_hslAdjust[0]'], packedBands.values)
    gl.uniform4fv(
      this.uniforms['u_primaryWheels[0]'],
      packWheels(
        [
          input.adjustment.primaryWheels.lift,
          input.adjustment.primaryWheels.gamma,
          input.adjustment.primaryWheels.gain,
          input.adjustment.primaryWheels.offset
        ],
        input.adjustment.primaryWheels.enabled
      )
    )
    gl.uniform4fv(
      this.uniforms['u_logWheels[0]'],
      packWheels(
        [
          input.adjustment.logWheels.shadow,
          input.adjustment.logWheels.midtone,
          input.adjustment.logWheels.highlight,
          input.adjustment.logWheels.offset
        ],
        input.adjustment.logWheels.enabled
      )
    )
    gl.uniform4f(
      this.uniforms.u_wheelOptions,
      input.adjustment.primaryWheels.enabled ? 1 : 0,
      input.adjustment.logWheels.enabled ? 1 : 0,
      input.adjustment.logWheels.shadowRange,
      input.adjustment.logWheels.highlightRange
    )
    gl.uniform1f(this.uniforms.u_lumaMix, input.adjustment.primaryWheels.lumaMix)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    gl.flush()
    return this.canvas
  }
}

function ensureRenderer(current: CanvasRenderer | undefined, renderer: CanvasRenderer): CanvasRenderer {
  if (!current)
    return new CanvasRenderer({
      width: renderer.width,
      height: renderer.height,
      fps: renderer.fps,
      imageSmoothingQuality: 'high'
    })
  if (current.width !== renderer.width || current.height !== renderer.height)
    current.setSize({ width: renderer.width, height: renderer.height })
  return current
}

function clear(renderer: CanvasRenderer): void {
  renderer.context.save()
  renderer.context.setTransform(1, 0, 0, 1, 0, 0)
  renderer.context.globalAlpha = 1
  renderer.context.globalCompositeOperation = 'source-over'
  if ('filter' in renderer.context) renderer.context.filter = 'none'
  renderer.context.clearRect(0, 0, renderer.width, renderer.height)
  renderer.context.restore()
}

class CanvasNode extends BaseNode {
  constructor(
    readonly source: CanvasSource,
    params: BaseNode['params']
  ) {
    super(params)
  }

  async render({ renderer }: { renderer: CanvasRenderer; time: number }): Promise<void> {
    renderer.context.drawImage(this.source, 0, 0, renderer.width, renderer.height)
  }
}

export class ColorAdjustmentNode extends BaseNode {
  private original?: CanvasRenderer
  private overlay?: CanvasRenderer
  private pass?: ColorAdjustmentPass
  private warned = false

  constructor(
    private readonly input: {
      node: BaseNode
      adjustment: unknown
      legacyFilter?: DesktopClipFilter | null
      startTime: number
      duration: number
      shapeMask?: unknown
      customMask?: unknown
    }
  ) {
    super()
  }

  async render({ renderer, time }: { renderer: CanvasRenderer; time: number }): Promise<void> {
    const adjustment = resolveColorAdjustment({
      source: {
        colorAdjustment: this.input.adjustment,
        startTime: this.input.startTime,
        duration: this.input.duration
      },
      timelineTime: time,
      legacyFilter: this.input.legacyFilter
    })
    if (!adjustment.enabled || adjustment.intensity <= 0) {
      await this.input.node.render({ renderer, time })
      return
    }

    this.original = ensureRenderer(this.original, renderer)
    clear(this.original)
    await this.input.node.render({ renderer: this.original, time })

    try {
      this.pass ??= new ColorAdjustmentPass()
      const adjusted = this.pass.render({
        source: this.original.canvas,
        width: renderer.width,
        height: renderer.height,
        adjustment,
        time
      })
      if (!this.input.shapeMask && !this.input.customMask) {
        renderer.context.drawImage(adjusted, 0, 0, renderer.width, renderer.height)
        return
      }

      renderer.context.drawImage(this.original.canvas, 0, 0, renderer.width, renderer.height)
      let masked: BaseNode = new CanvasNode(adjusted, this.input.node.params)
      if (this.input.customMask)
        masked = new CustomCutoutNode({ node: masked, settings: this.input.customMask })
      if (this.input.shapeMask)
        masked = new ClipMaskNode({
          node: masked,
          settings: this.input.shapeMask,
          startTime: this.input.startTime,
          duration: this.input.duration
        })
      this.overlay = ensureRenderer(this.overlay, renderer)
      clear(this.overlay)
      await masked.render({ renderer: this.overlay, time })
      renderer.context.drawImage(this.overlay.canvas, 0, 0, renderer.width, renderer.height)
    } catch (error) {
      this.pass = undefined
      if (!this.warned) {
        this.warned = true
        console.warn('高级调色不可用，已显示原始画面', error)
      }
      renderer.context.drawImage(this.original.canvas, 0, 0, renderer.width, renderer.height)
    }
  }
}
