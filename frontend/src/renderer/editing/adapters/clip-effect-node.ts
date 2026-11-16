import { CanvasRenderer } from '@cutia/services/renderer/canvas-renderer'
import { BaseNode } from '@cutia/services/renderer/nodes/base-node'
import type { DesktopClipEffect } from '../clip-effects'
import { clipEffectMode, normalizeClipEffects } from '../clip-effects'

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
uniform float u_mode;
varying vec2 v_uv;

float random2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(random2(i), random2(i + vec2(1.0, 0.0)), f.x),
             mix(random2(i + vec2(0.0, 1.0)), random2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float luminance(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}
vec4 sourceAt(vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return texture2D(u_texture, uv);
}
vec4 blurAt(vec2 uv, vec2 radius) {
  vec4 sum = sourceAt(uv) * 0.2;
  sum += sourceAt(uv + vec2(radius.x, 0.0)) * 0.12;
  sum += sourceAt(uv - vec2(radius.x, 0.0)) * 0.12;
  sum += sourceAt(uv + vec2(0.0, radius.y)) * 0.12;
  sum += sourceAt(uv - vec2(0.0, radius.y)) * 0.12;
  sum += sourceAt(uv + radius) * 0.08;
  sum += sourceAt(uv - radius) * 0.08;
  sum += sourceAt(uv + vec2(radius.x, -radius.y)) * 0.08;
  sum += sourceAt(uv + vec2(-radius.x, radius.y)) * 0.08;
  return sum;
}
float edgeAt(vec2 uv) {
  vec2 px = 1.0 / u_resolution;
  float left = luminance(sourceAt(uv - vec2(px.x, 0.0)).rgb);
  float right = luminance(sourceAt(uv + vec2(px.x, 0.0)).rgb);
  float up = luminance(sourceAt(uv - vec2(0.0, px.y)).rgb);
  float down = luminance(sourceAt(uv + vec2(0.0, px.y)).rgb);
  return clamp(length(vec2(right - left, down - up)) * 3.0, 0.0, 1.0);
}
vec2 rotateUv(vec2 uv, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c) * uv;
}

void main() {
  vec2 uv = v_uv;
  vec2 px = 1.0 / u_resolution;
  float amount = clamp(u_intensity, 0.0, 1.0);
  vec4 original = sourceAt(uv);
  vec4 color = original;
  float mode = floor(u_mode + 0.5);

  if (mode == 1.0 || mode == 4.0 || mode == 11.0) {
    float radius = mode == 1.0 ? 7.0 : (mode == 11.0 ? 5.0 : 3.0);
    vec4 glow = blurAt(uv, px * radius);
    glow.rgb *= mode == 1.0 ? 1.7 : 1.35;
    color.rgb = 1.0 - (1.0 - original.rgb) * (1.0 - glow.rgb * amount);
    color.a = max(original.a, glow.a * amount);
  } else if (mode == 2.0) {
    vec2 cell = vec2(7.0, 9.0);
    vec2 cellUv = (floor(gl_FragCoord.xy / cell) * cell + cell * 0.5) / u_resolution;
    vec4 sampled = sourceAt(vec2(cellUv.x, 1.0 - cellUv.y));
    float value = luminance(sampled.rgb);
    vec2 glyph = mod(gl_FragCoord.xy, cell) - cell * 0.5;
    float ink = 1.0 - step(mix(0.8, 3.1, value), length(glyph));
    color = vec4(sampled.rgb * mix(0.16, 1.25, ink), sampled.a);
  } else if (mode == 3.0 || mode == 9.0) {
    vec3 a = sourceAt(uv - px * 1.5).rgb;
    vec3 b = sourceAt(uv + px * 1.5).rgb;
    vec3 relief = vec3(0.5) + (a - b) * (mode == 9.0 ? 1.8 : 1.1);
    color.rgb = mix(original.rgb, relief, amount);
  } else if (mode == 5.0) {
    vec2 p = uv - 0.5;
    float radius = length(p);
    float strength = (1.0 - smoothstep(0.0, 0.55, radius)) * 0.42 * amount;
    color = sourceAt(0.5 + p * (1.0 - strength));
  } else if (mode == 6.0) {
    float value = luminance(original.rgb);
    vec2 coord = gl_FragCoord.xy;
    float hatch = 1.0;
    if (value < 0.8) hatch *= step(1.4, mod(coord.x + coord.y, 6.0));
    if (value < 0.55) hatch *= step(1.4, mod(coord.x - coord.y, 6.0));
    if (value < 0.3) hatch *= step(1.0, mod(coord.x + coord.y * 0.5, 4.0));
    color.rgb = mix(original.rgb, vec3(hatch), amount * 0.9);
  } else if (mode == 7.0) {
    vec2 p = uv * 2.0 - 1.0;
    p *= 1.0 + dot(p, p) * 0.12 * amount;
    vec2 curved = p * 0.5 + 0.5;
    float split = 2.0 * px.x * amount;
    color.r = sourceAt(curved + vec2(split, 0.0)).r;
    color.g = sourceAt(curved).g;
    color.b = sourceAt(curved - vec2(split, 0.0)).b;
    color.a = sourceAt(curved).a;
    color.rgb *= 0.9 + 0.1 * sin(gl_FragCoord.y * 3.14159);
  } else if (mode == 8.0) {
    vec2 cell = vec2(8.0);
    vec2 center = (floor(gl_FragCoord.xy / cell) * cell + cell * 0.5) / u_resolution;
    vec4 sampled = sourceAt(vec2(center.x, 1.0 - center.y));
    float dotSize = mix(1.0, 3.7, luminance(sampled.rgb));
    float mask = 1.0 - smoothstep(dotSize, dotSize + 0.8, length(mod(gl_FragCoord.xy, cell) - cell * 0.5));
    color = vec4(sampled.rgb * mask, sampled.a);
  } else if (mode == 10.0 || mode == 42.0) {
    float line = floor(uv.y * (mode == 42.0 ? 52.0 : 90.0));
    float burst = step(0.72, random2(vec2(line, floor(u_time * 9.0))));
    float shift = (random2(vec2(line, floor(u_time * 17.0))) - 0.5) * 0.12 * burst * amount;
    float rgb = (mode == 42.0 ? 5.0 : 3.0) * px.x * amount;
    color.r = sourceAt(uv + vec2(shift + rgb, 0.0)).r;
    color.g = sourceAt(uv + vec2(shift, 0.0)).g;
    color.b = sourceAt(uv + vec2(shift - rgb, 0.0)).b;
    color.a = sourceAt(uv + vec2(shift, 0.0)).a;
    if (mode == 42.0) color.rgb *= 0.88 + 0.12 * sin(gl_FragCoord.y * 2.1 + u_time * 15.0);
  } else if (mode == 12.0) {
    vec2 lightPos = vec2(0.24, 0.18);
    vec2 direction = (lightPos - uv) * 0.055;
    vec4 rays = vec4(0.0);
    for (int i = 0; i < 10; i++) {
      rays += sourceAt(uv + direction * float(i));
    }
    rays /= 10.0;
    color.rgb = original.rgb + rays.rgb * 0.65 * amount * luminance(rays.rgb);
    color.a = max(original.a, rays.a * amount);
  } else if (mode == 13.0) {
    color = blurAt(uv, px * mix(2.0, 8.0, amount));
  } else if (mode == 14.0) {
    vec2 velocity = vec2(px.x * 18.0, px.y * 3.0) * amount;
    color = vec4(0.0);
    for (int i = 0; i < 9; i++) color += sourceAt(uv - velocity * float(i) / 8.0);
    color /= 9.0;
  } else if (mode == 15.0) {
    float gray = luminance(original.rgb);
    vec3 sepia = vec3(gray * 1.2, gray * 1.02, gray * 0.76);
    float grain = random2(gl_FragCoord.xy + floor(u_time * 20.0)) - 0.5;
    float scratch = step(0.996, random2(vec2(floor(gl_FragCoord.x), floor(u_time * 2.0))));
    color.rgb = mix(original.rgb, sepia + grain * 0.18 + scratch * 0.4, amount);
  } else if (mode == 16.0) {
    float edge = edgeAt(uv);
    color.rgb = mix(original.rgb, mix(original.rgb, vec3(1.0), edge), amount);
  } else if (mode == 17.0) {
    vec2 size = mix(vec2(2.0), vec2(24.0), amount);
    vec2 pixelUv = (floor(uv * u_resolution / size) + 0.5) * size / u_resolution;
    color = sourceAt(pixelUv);
  } else if (mode == 18.0 || mode == 25.0) {
    vec2 center = vec2(0.5);
    vec2 direction = (center - uv) * (mode == 25.0 ? 0.055 : 0.035) * amount;
    color = vec4(0.0);
    for (int i = 0; i < 10; i++) color += sourceAt(uv + direction * float(i));
    color /= 10.0;
  } else if (mode == 19.0) {
    if (uv.y > 0.52) {
      vec2 reflected = vec2(uv.x + sin(uv.y * 70.0 + u_time * 3.0) * 0.007 * amount, 1.04 - uv.y);
      color = sourceAt(reflected);
      color.rgb *= mix(1.0, 0.72, (uv.y - 0.52) * 1.9);
    }
  } else if (mode == 20.0) {
    vec2 split = vec2(px.x * 7.0 * amount, px.y * 2.0 * amount);
    color = vec4(sourceAt(uv + split).r, sourceAt(uv).g, sourceAt(uv - split).b, original.a);
  } else if (mode == 21.0) {
    vec2 p = uv - 0.5;
    float radius = length(p);
    float wave = sin((radius - fract(u_time * 0.35)) * 70.0) * exp(-abs(radius - fract(u_time * 0.35)) * 18.0);
    color = sourceAt(uv + normalize(p + 0.0001) * wave * 0.025 * amount);
  } else if (mode == 22.0 || mode == 36.0) {
    float grain = mode == 22.0 ? noise2(uv * 95.0 + u_time * 2.0) : random2(gl_FragCoord.xy + floor(u_time * 24.0));
    color.rgb = mix(original.rgb, original.rgb + (grain - 0.5) * 0.55, amount);
  } else if (mode == 23.0) {
    float distanceFromFocus = smoothstep(0.1, 0.46, abs(uv.y - 0.5));
    vec4 blurred = blurAt(uv, px * 8.0);
    color = mix(original, blurred, distanceFromFocus * amount);
  } else if (mode == 24.0) {
    vec2 p = uv - 0.5;
    float radius = length(p);
    float angle = (1.0 - smoothstep(0.0, 0.7, radius)) * 2.4 * amount;
    color = sourceAt(0.5 + rotateUv(p, angle));
  } else if (mode == 26.0) {
    vec2 warped = uv + vec2(sin(uv.y * 18.0 + u_time * 2.0), cos(uv.x * 15.0 - u_time * 1.7)) * 0.025 * amount;
    color = sourceAt(warped);
  } else if (mode == 27.0) {
    vec2 p = uv - 0.5;
    float radius = length(p);
    float angle = atan(p.y, p.x);
    float segments = 7.0;
    angle = abs(mod(angle, 6.283185 / segments) - 3.141592 / segments);
    color = sourceAt(0.5 + vec2(cos(angle), sin(angle)) * radius);
  } else if (mode == 28.0) {
    float band = floor(uv.y * 36.0);
    float shift = sin(band * 0.7 + u_time * 2.8) * 0.055 * amount;
    color = sourceAt(vec2(fract(uv.x + shift), uv.y));
  } else if (mode == 29.0) {
    float n = noise2(uv * 7.0 + vec2(u_time * 0.35, -u_time * 0.22));
    color = sourceAt(uv + vec2(n - 0.5, noise2(uv * 9.0) - 0.5) * 0.055 * amount);
  } else if (mode == 30.0) {
    vec4 ghostA = sourceAt(uv + vec2(0.018, 0.006) * amount);
    vec4 ghostB = sourceAt(uv - vec2(0.028, 0.01) * amount);
    color = original * 0.58 + ghostA * 0.27 + ghostB * 0.15;
  } else if (mode == 31.0) {
    float levels = 5.0;
    float dither = (random2(mod(gl_FragCoord.xy, 4.0)) - 0.5) / levels;
    color.rgb = mix(original.rgb, floor((original.rgb + dither) * levels) / levels, amount);
  } else if (mode == 32.0) {
    float edge = edgeAt(uv);
    color.rgb = mix(original.rgb, vec3(edge), amount);
  } else if (mode == 33.0) {
    vec2 size = vec2(18.0, 15.6) * mix(0.45, 1.0, amount);
    vec2 cell = floor(gl_FragCoord.xy / size);
    cell.x += mod(cell.y, 2.0) * 0.5;
    vec2 samplePixel = (cell * size + size * 0.5) / u_resolution;
    color = sourceAt(vec2(samplePixel.x, 1.0 - samplePixel.y));
  } else if (mode == 34.0) {
    color = sourceAt(vec2(abs(uv.x - 0.5) * 2.0, uv.y));
  } else if (mode == 35.0) {
    float value = luminance(original.rgb);
    float vignette = 1.0 - smoothstep(0.25, 0.75, length(uv - 0.5));
    float grain = random2(gl_FragCoord.xy + floor(u_time * 16.0)) * 0.16;
    color.rgb = mix(original.rgb, vec3(0.05, value * 1.25 + grain, 0.12) * vignette, amount);
  } else if (mode == 37.0) {
    vec2 p = uv - 0.5;
    float radius = length(p) * 2.0;
    float angle = atan(p.y, p.x) / 6.283185 + 0.5;
    color = sourceAt(vec2(angle, radius));
  } else if (mode == 38.0) {
    float repeats = mix(2.0, 5.0, amount);
    color = sourceAt(fract(uv * repeats));
  } else if (mode == 39.0) {
    vec2 p = uv - 0.5;
    float radius = length(p);
    float ripple = sin(radius * 65.0 - u_time * 5.0) * 0.012 * amount;
    color = sourceAt(uv + normalize(p + 0.0001) * ripple);
  } else if (mode == 40.0) {
    float lines = 0.78 + 0.22 * sin(gl_FragCoord.y * 3.141592);
    color.rgb = mix(original.rgb, original.rgb * lines, amount);
  } else if (mode == 41.0) {
    float gray = luminance(original.rgb);
    float edge = edgeAt(uv);
    vec3 paper = vec3(1.0 - edge * 1.7) * (0.82 + gray * 0.18);
    color.rgb = mix(original.rgb, paper, amount);
  }

  if (mode > 0.0 && mode != 1.0 && mode != 4.0 && mode != 11.0 && mode != 12.0) {
    color = mix(original, color, amount);
  }
  gl_FragColor = color;
}`

type EffectSource = HTMLCanvasElement | OffscreenCanvas

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('无法创建特效着色器')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader) || '未知着色器错误'
    gl.deleteShader(shader)
    throw new Error(`特效着色器编译失败: ${detail}`)
  }
  return shader
}

class EffectShaderPass {
  readonly canvas = document.createElement('canvas')
  private readonly gl: WebGLRenderingContext
  private readonly program: WebGLProgram
  private readonly texture: WebGLTexture
  private readonly buffer: WebGLBuffer

  constructor() {
    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true
    })
    if (!gl) throw new Error('当前设备无法创建 WebGL 特效上下文')
    this.gl = gl
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    const program = gl.createProgram()
    if (!program) throw new Error('无法创建特效程序')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`特效程序链接失败: ${gl.getProgramInfoLog(program) || '未知错误'}`)
    this.program = program

    const buffer = gl.createBuffer()
    const texture = gl.createTexture()
    if (!buffer || !texture) throw new Error('无法创建特效纹理')
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
  }

  render(input: {
    source: EffectSource
    width: number
    height: number
    effect: DesktopClipEffect
    time: number
  }): HTMLCanvasElement {
    const { gl } = this
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
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_texture'), 0)
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_resolution'), input.width, input.height)
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_time'), input.time)
    gl.uniform1f(
      gl.getUniformLocation(this.program, 'u_intensity'),
      Math.min(1, Math.max(0, input.effect.intensity))
    )
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_mode'), clipEffectMode(input.effect.id))
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    gl.flush()
    return this.canvas
  }
}

export class EffectNode extends BaseNode {
  private intermediate?: CanvasRenderer
  private passes?: [EffectShaderPass, EffectShaderPass]
  private warned = false

  constructor(
    private readonly input: {
      node: BaseNode
      effects: unknown
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

  private fallback(
    renderer: CanvasRenderer,
    source: EffectSource,
    effect: DesktopClipEffect
  ): void {
    renderer.context.save()
    const categoryFilters: Record<string, string> = {
      light: `brightness(${1 + effect.intensity * 0.35}) saturate(${1 + effect.intensity * 0.2})`,
      blur: `blur(${effect.intensity * 5}px)`,
      glitch: `contrast(${1 + effect.intensity * 0.35}) saturate(${1 + effect.intensity * 0.7})`,
      retro: `sepia(${effect.intensity * 0.75}) contrast(${1 + effect.intensity * 0.15})`,
      artistic: `contrast(${1 + effect.intensity * 0.4}) saturate(${1 + effect.intensity * 0.45})`,
      texture: `grayscale(${effect.intensity * 0.35}) contrast(${1 + effect.intensity * 0.35})`
    }
    renderer.context.filter = categoryFilters[effect.category] || 'none'
    renderer.context.drawImage(source, 0, 0, renderer.width, renderer.height)
    renderer.context.restore()
  }

  async render({ renderer, time }: { renderer: CanvasRenderer; time: number }): Promise<void> {
    const effects = normalizeClipEffects(this.input.effects).filter(
      (effect) => effect.enabled && clipEffectMode(effect.id) > 0
    )
    if (!effects.length) {
      await this.input.node.render({ renderer, time })
      return
    }

    const intermediate = this.ensureIntermediate(renderer)
    intermediate.context.save()
    intermediate.context.setTransform(1, 0, 0, 1, 0, 0)
    intermediate.context.clearRect(0, 0, intermediate.width, intermediate.height)
    intermediate.context.restore()
    await this.input.node.render({ renderer: intermediate, time })

    let source: EffectSource = intermediate.canvas
    try {
      this.passes ??= [new EffectShaderPass(), new EffectShaderPass()]
      for (let index = 0; index < effects.length; index += 1) {
        source = this.passes[index % 2].render({
          source,
          width: renderer.width,
          height: renderer.height,
          effect: effects[index],
          time
        })
      }
      renderer.context.drawImage(source, 0, 0, renderer.width, renderer.height)
    } catch (error) {
      if (!this.warned) {
        this.warned = true
        console.warn('WebGL 特效不可用，已回退到基础效果', error)
      }
      this.fallback(renderer, source, effects[effects.length - 1])
    }
  }
}
