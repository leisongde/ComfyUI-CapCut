import { CanvasRenderer } from '@cutia/services/renderer/canvas-renderer'
import { BaseNode } from '@cutia/services/renderer/nodes/base-node'
import {
  beautySkinToneToRgb,
  hasBeautyEffect,
  hasFaceReshapeEffect,
  normalizeBeautySettings,
  type BeautySettings
} from '../beauty'
import { detectFaceLandmarks } from '../face-landmarker'
import {
  buildFaceWarpPlan,
  stabilizeFaceLandmarks,
  type DetectedFaceLandmarks,
  type FaceWarpPlan
} from '../face-reshape'

const MAX_WARPS = 32
const MAX_REGIONS = 12
const EMPTY_WARP_PLAN: FaceWarpPlan = { warps: [], regions: [] }

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = vec2((a_position.x + 1.0) * 0.5, (1.0 - a_position.y) * 0.5);
  gl_Position = vec4(a_position, 0.0, 1.0);
}`

const FRAGMENT_SHADER = `
precision highp float;
#define MAX_WARPS ${MAX_WARPS}
#define MAX_REGIONS ${MAX_REGIONS}

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_smooth;
uniform float u_whiten;
uniform float u_even_skin;
uniform float u_plump;
uniform float u_blemish;
uniform float u_nasolabial;
uniform float u_dark_circles;
uniform float u_clarity;
uniform vec3 u_skin_tone;
uniform float u_tone_strength;
uniform int u_warp_count;
uniform vec4 u_warp_points[MAX_WARPS];
uniform vec2 u_warp_deltas[MAX_WARPS];
uniform int u_region_count;
uniform vec4 u_region_a[MAX_REGIONS];
uniform vec4 u_region_b[MAX_REGIONS];
uniform vec2 u_region_c[MAX_REGIONS];
varying vec2 v_uv;

float luma(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

vec3 straightColor(vec4 pixel) {
  return pixel.a > 0.0001 ? pixel.rgb / pixel.a : vec3(0.0);
}

float softRegionWeight(vec2 uv, vec2 center, vec2 radius) {
  float distanceFromCenter = length((uv - center) / max(radius, vec2(0.0001)));
  float weight = 1.0 - smoothstep(0.58, 1.0, distanceFromCenter);
  return weight * weight * (3.0 - 2.0 * weight);
}

float pointWarpWeight(vec2 uv, vec2 center, vec2 radius) {
  float distanceFromCenter = length((uv - center) / max(radius, vec2(0.0001)));
  float weight = clamp(1.0 - distanceFromCenter, 0.0, 1.0);
  return weight * weight * weight * (weight * (weight * 6.0 - 15.0) + 10.0);
}

vec2 applyRegionTransforms(vec2 uv) {
  vec2 result = uv;
  for (int i = 0; i < MAX_REGIONS; i++) {
    if (i < u_region_count) {
      vec4 geometry = u_region_a[i];
      vec4 transform = u_region_b[i];
      float angle = u_region_c[i].x;
      vec2 targetCenter = geometry.xy + transform.xy;
      vec2 local = result - targetCenter;
      float cosine = cos(-angle);
      float sine = sin(-angle);
      vec2 rotated = vec2(
        cosine * local.x - sine * local.y,
        sine * local.x + cosine * local.y
      );
      vec2 mapped = geometry.xy + rotated / max(transform.zw, vec2(0.2));
      float weight = softRegionWeight(result, targetCenter, geometry.zw);
      result = mix(result, mapped, weight);
    }
  }
  return result;
}

vec2 applyPointWarps(vec2 uv) {
  vec2 displacement = vec2(0.0);
  float totalWeight = 0.0;
  for (int i = 0; i < MAX_WARPS; i++) {
    if (i < u_warp_count) {
      vec4 pointData = u_warp_points[i];
      float weight = pointWarpWeight(uv, pointData.xy, pointData.zw);
      displacement += u_warp_deltas[i] * weight;
      totalWeight += weight;
    }
  }
  return uv - displacement / max(1.0, totalWeight);
}

float featureBrightness(vec2 uv) {
  float brightness = 0.0;
  for (int i = 0; i < MAX_REGIONS; i++) {
    if (i < u_region_count) {
      vec4 geometry = u_region_a[i];
      vec4 transform = u_region_b[i];
      float weight = softRegionWeight(uv, geometry.xy + transform.xy, geometry.zw);
      brightness = max(brightness, u_region_c[i].y * weight);
    }
  }
  return brightness;
}

float skinWeight(vec3 color) {
  float y = luma(color);
  float cb = -0.168736 * color.r - 0.331264 * color.g + 0.5 * color.b + 0.5;
  float cr = 0.5 * color.r - 0.418688 * color.g - 0.081312 * color.b + 0.5;
  vec2 ellipseAxis = vec2((cb - 0.43) / 0.115, (cr - 0.57) / 0.16);
  float ellipseGate = 1.0 - smoothstep(0.7, 1.45, dot(ellipseAxis, ellipseAxis));
  float lumaGate = smoothstep(0.055, 0.18, y) * (1.0 - smoothstep(0.94, 1.0, y));
  float channelGate = smoothstep(-0.08, 0.04, color.r - color.b);
  return clamp(ellipseGate * lumaGate * channelGate, 0.0, 1.0);
}

void addBilateralSample(
  inout vec3 total,
  inout float totalWeight,
  vec2 uv,
  vec3 center,
  float spatialWeight
) {
  vec4 pixel = texture2D(u_texture, clamp(uv, vec2(0.0), vec2(1.0)));
  if (pixel.a <= 0.0001) return;
  vec3 color = straightColor(pixel);
  vec3 delta = color - center;
  float edgeWeight = exp(-dot(delta, delta) * 28.0);
  float weight = spatialWeight * edgeWeight;
  total += color * weight;
  totalWeight += weight;
}

void main() {
  vec2 transformedUv = applyPointWarps(applyRegionTransforms(v_uv));
  vec2 sampleUv = clamp(transformedUv, vec2(0.0), vec2(1.0));
  vec4 sampled = texture2D(u_texture, sampleUv);
  if (sampled.a <= 0.0001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 original = straightColor(sampled);
  vec2 pixel = 1.0 / max(u_resolution, vec2(1.0));
  float radius = 1.0 + 7.0 * max(u_smooth, u_blemish * 0.75);
  vec2 horizontal = vec2(pixel.x * radius, 0.0);
  vec2 vertical = vec2(0.0, pixel.y * radius);
  vec2 diagonalA = vec2(pixel.x, pixel.y) * radius * 0.72;
  vec2 diagonalB = vec2(pixel.x, -pixel.y) * radius * 0.72;
  vec3 blurred = original * 0.24;
  float blurWeight = 0.24;
  addBilateralSample(blurred, blurWeight, sampleUv + horizontal, original, 0.12);
  addBilateralSample(blurred, blurWeight, sampleUv - horizontal, original, 0.12);
  addBilateralSample(blurred, blurWeight, sampleUv + vertical, original, 0.12);
  addBilateralSample(blurred, blurWeight, sampleUv - vertical, original, 0.12);
  addBilateralSample(blurred, blurWeight, sampleUv + diagonalA, original, 0.07);
  addBilateralSample(blurred, blurWeight, sampleUv - diagonalA, original, 0.07);
  addBilateralSample(blurred, blurWeight, sampleUv + diagonalB, original, 0.07);
  addBilateralSample(blurred, blurWeight, sampleUv - diagonalB, original, 0.07);
  blurred /= max(blurWeight, 0.0001);

  float skin = skinWeight(original);
  float originalLuma = luma(original);
  float blurredLuma = luma(blurred);
  vec3 detail = original - blurred;
  vec3 color = mix(original, blurred, skin * u_smooth * 0.76);

  float darkSpot = smoothstep(0.018, 0.12, blurredLuma - originalLuma);
  color = mix(color, blurred, skin * darkSpot * u_blemish * 0.82);

  float currentLuma = luma(color);
  vec3 evenTarget = vec3(blurredLuma) + (color - vec3(currentLuma)) * 0.82;
  color = mix(color, evenTarget, skin * u_even_skin * 0.48);

  vec3 whitened = vec3(1.0) - (vec3(1.0) - color) * (1.0 - u_whiten * 0.28);
  color = mix(color, whitened, skin);

  float midShadow = 1.0 - smoothstep(0.32, 0.66, originalLuma);
  float deepShadow = 1.0 - smoothstep(0.16, 0.46, originalLuma);
  color += vec3(0.055, 0.045, 0.04) * skin * midShadow * u_nasolabial;
  color += vec3(0.075, 0.06, 0.052) * skin * deepShadow * u_dark_circles;

  float colorLuma = luma(color);
  color = mix(vec3(colorLuma), color, 1.0 + u_plump * skin * 0.1);
  color += vec3(0.024, 0.008, -0.006) * u_plump * skin;
  color += detail * u_clarity * skin * 0.52;

  vec3 toneTarget = color * 0.76 + u_skin_tone * 0.24;
  color = mix(color, toneTarget, skin * u_tone_strength);
  float eyeBrightness = featureBrightness(v_uv);
  color = vec3(1.0) - (vec3(1.0) - color) * (1.0 - eyeBrightness);
  color = clamp(color, 0.0, 1.0);
  gl_FragColor = vec4(color * sampled.a, sampled.a);
}`

type BeautySource = HTMLCanvasElement | OffscreenCanvas

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('无法创建美颜着色器')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader) || '未知着色器错误'
    gl.deleteShader(shader)
    throw new Error(`美颜着色器编译失败: ${detail}`)
  }
  return shader
}

class BeautyShaderPass {
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
    if (!gl) throw new Error('当前设备无法创建 WebGL 美颜上下文')
    this.gl = gl
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    const program = gl.createProgram()
    if (!program) throw new Error('无法创建美颜程序')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`美颜程序链接失败: ${gl.getProgramInfoLog(program) || '未知错误'}`)
    this.program = program

    const buffer = gl.createBuffer()
    const texture = gl.createTexture()
    if (!buffer || !texture) throw new Error('无法创建美颜纹理')
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
        'u_smooth',
        'u_whiten',
        'u_even_skin',
        'u_plump',
        'u_blemish',
        'u_nasolabial',
        'u_dark_circles',
        'u_clarity',
        'u_skin_tone',
        'u_tone_strength',
        'u_warp_count',
        'u_warp_points[0]',
        'u_warp_deltas[0]',
        'u_region_count',
        'u_region_a[0]',
        'u_region_b[0]',
        'u_region_c[0]'
      ].map((name) => [name, gl.getUniformLocation(program, name)])
    )
  }

  render(input: {
    source: BeautySource
    width: number
    height: number
    settings: BeautySettings
    warpPlan: FaceWarpPlan
  }): HTMLCanvasElement {
    const { gl } = this
    if (gl.isContextLost()) throw new Error('WebGL 美颜上下文已丢失')
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

    const settings = input.settings
    const tone = beautySkinToneToRgb(settings.skinTone)
    gl.uniform1i(this.uniforms.u_texture, 0)
    gl.uniform2f(this.uniforms.u_resolution, input.width, input.height)
    gl.uniform1f(this.uniforms.u_smooth, settings.smooth)
    gl.uniform1f(this.uniforms.u_whiten, settings.whiten)
    gl.uniform1f(this.uniforms.u_even_skin, settings.evenSkin)
    gl.uniform1f(this.uniforms.u_plump, settings.plump)
    gl.uniform1f(this.uniforms.u_blemish, settings.blemish)
    gl.uniform1f(this.uniforms.u_nasolabial, settings.nasolabial)
    gl.uniform1f(this.uniforms.u_dark_circles, settings.darkCircles)
    gl.uniform1f(this.uniforms.u_clarity, settings.clarity)
    gl.uniform3f(this.uniforms.u_skin_tone, tone[0], tone[1], tone[2])
    gl.uniform1f(this.uniforms.u_tone_strength, settings.skinTone === 'none' ? 0 : 0.22)

    const warps = input.warpPlan.warps.slice(0, MAX_WARPS)
    const warpPoints = new Float32Array(MAX_WARPS * 4)
    const warpDeltas = new Float32Array(MAX_WARPS * 2)
    warps.forEach((warp, index) => {
      warpPoints.set([warp.centerX, warp.centerY, warp.radiusX, warp.radiusY], index * 4)
      warpDeltas.set([warp.deltaX, warp.deltaY], index * 2)
    })
    gl.uniform1i(this.uniforms.u_warp_count, warps.length)
    gl.uniform4fv(this.uniforms['u_warp_points[0]'], warpPoints)
    gl.uniform2fv(this.uniforms['u_warp_deltas[0]'], warpDeltas)

    const regions = input.warpPlan.regions.slice(0, MAX_REGIONS)
    const regionA = new Float32Array(MAX_REGIONS * 4)
    const regionB = new Float32Array(MAX_REGIONS * 4)
    const regionC = new Float32Array(MAX_REGIONS * 2)
    regions.forEach((region, index) => {
      regionA.set([region.centerX, region.centerY, region.radiusX, region.radiusY], index * 4)
      regionB.set(
        [region.translateX, region.translateY, region.scaleX, region.scaleY],
        index * 4
      )
      regionC.set([region.rotation, region.brightness], index * 2)
    })
    gl.uniform1i(this.uniforms.u_region_count, regions.length)
    gl.uniform4fv(this.uniforms['u_region_a[0]'], regionA)
    gl.uniform4fv(this.uniforms['u_region_b[0]'], regionB)
    gl.uniform2fv(this.uniforms['u_region_c[0]'], regionC)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    gl.flush()
    return this.canvas
  }
}

export class BeautyNode extends BaseNode {
  private intermediate?: CanvasRenderer
  private pass?: BeautyShaderPass
  private warned = false
  private faces: DetectedFaceLandmarks[] = []
  private lastAnalysisTime = Number.NaN
  private lastAnalysisSize = ''

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

  private async resolveWarpPlan(
    settings: BeautySettings,
    source: BeautySource,
    width: number,
    height: number,
    time: number
  ): Promise<FaceWarpPlan> {
    if (!hasFaceReshapeEffect(settings)) return EMPTY_WARP_PLAN
    const size = `${width}x${height}`
    const elapsed = Math.abs(time - this.lastAnalysisTime)
    if (!this.faces.length || size !== this.lastAnalysisSize || !Number.isFinite(elapsed) || elapsed >= 1 / 12) {
      const detected = await detectFaceLandmarks(source, width, height)
      const canSmooth = size === this.lastAnalysisSize && Number.isFinite(elapsed) && elapsed < 0.45
      this.faces = canSmooth ? stabilizeFaceLandmarks(this.faces, detected) : detected
      this.lastAnalysisTime = time
      this.lastAnalysisSize = size
    }
    return buildFaceWarpPlan(this.faces, settings.faceShape, settings.facialFeatures)
  }

  async render({ renderer, time }: { renderer: CanvasRenderer; time: number }): Promise<void> {
    const settings = normalizeBeautySettings(this.input.settings)
    if (!hasBeautyEffect(settings)) {
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
      const warpPlan = await this.resolveWarpPlan(
        settings,
        intermediate.canvas,
        renderer.width,
        renderer.height,
        time
      )
      this.pass ??= new BeautyShaderPass()
      const source = this.pass.render({
        source: intermediate.canvas,
        width: renderer.width,
        height: renderer.height,
        settings,
        warpPlan
      })
      renderer.context.drawImage(source, 0, 0, renderer.width, renderer.height)
    } catch (error) {
      this.pass = undefined
      if (!this.warned) {
        this.warned = true
        console.warn('WebGL 美颜不可用，已回退到基础亮肤效果', error)
      }
      renderer.context.save()
      renderer.context.filter = [
        `brightness(${1 + settings.whiten * 0.08 + settings.darkCircles * 0.025})`,
        `contrast(${1 + settings.clarity * 0.04 - settings.smooth * 0.025})`,
        `saturate(${1 + settings.plump * 0.08})`
      ].join(' ')
      renderer.context.drawImage(intermediate.canvas, 0, 0, renderer.width, renderer.height)
      renderer.context.restore()
    }
  }
}
