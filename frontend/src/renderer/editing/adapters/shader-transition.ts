type CanvasLike = OffscreenCanvas | HTMLCanvasElement
type RenderContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

type ShaderRuntime = {
  canvas: HTMLCanvasElement
  gl: WebGLRenderingContext
  program: WebGLProgram
  position: number
  progress: WebGLUniformLocation | null
  ratio: WebGLUniformLocation | null
  from: WebGLUniformLocation | null
  to: WebGLUniformLocation | null
  uniforms: Map<string, WebGLUniformLocation | null>
  uniformTypes: Map<string, string>
}

type ShaderUniformValue = number | boolean | number[]

const runtimes = new WeakMap<object, Map<string, ShaderRuntime>>()

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('无法创建 WebGL Shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Shader 编译失败'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

function createRuntime(source: string, width: number, height: number): ShaderRuntime {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const gl = canvas.getContext('webgl', { premultipliedAlpha: false, antialias: false })
  if (!gl) throw new Error('当前设备不支持 WebGL 转场预览')
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)

  const vertex = compile(
    gl,
    gl.VERTEX_SHADER,
    `attribute vec2 position;
varying vec2 uv;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  uv = 0.5 * (position + 1.0);
}`
  )
  const fragment = compile(
    gl,
    gl.FRAGMENT_SHADER,
    `precision highp float;
varying vec2 uv;
uniform sampler2D from;
uniform sampler2D to;
uniform float progress;
uniform float ratio;
vec4 getFromColor(vec2 value) { return texture2D(from, value); }
vec4 getToColor(vec2 value) { return texture2D(to, value); }
${source}
void main() { gl_FragColor = transition(uv); }`
  )
  const program = gl.createProgram()
  if (!program) throw new Error('无法创建 WebGL 转场程序')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || '转场程序链接失败'
    gl.deleteProgram(program)
    throw new Error(message)
  }
  gl.useProgram(program)

  const buffer = gl.createBuffer()
  if (!buffer) throw new Error('无法创建 WebGL 顶点缓冲')
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 3, 3, -1]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'position')
  if (position < 0) throw new Error('转场 Shader 缺少 position 属性')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

  const uniforms = new Map<string, WebGLUniformLocation | null>()
  const uniformTypes = new Map<string, string>()
  const uniformPattern = /uniform\s+(bool|int|float|vec2|vec3|vec4|ivec2|ivec3|ivec4|sampler2D)\s+(\w+)/g
  let match: RegExpExecArray | null
  while ((match = uniformPattern.exec(source))) {
    uniforms.set(match[2], gl.getUniformLocation(program, match[2]))
    uniformTypes.set(match[2], match[1])
  }
  return {
    canvas,
    gl,
    program,
    position,
    progress: gl.getUniformLocation(program, 'progress'),
    ratio: gl.getUniformLocation(program, 'ratio'),
    from: gl.getUniformLocation(program, 'from'),
    to: gl.getUniformLocation(program, 'to'),
    uniforms,
    uniformTypes
  }
}

function getRuntime(context: RenderContext, source: string, width: number, height: number): ShaderRuntime {
  let bySource = runtimes.get(context)
  if (!bySource) {
    bySource = new Map()
    runtimes.set(context, bySource)
  }
  let runtime = bySource.get(source)
  if (!runtime) {
    runtime = createRuntime(source, width, height)
    bySource.set(source, runtime)
  }
  if (runtime.canvas.width !== width) runtime.canvas.width = width
  if (runtime.canvas.height !== height) runtime.canvas.height = height
  return runtime
}

function uploadTexture(gl: WebGLRenderingContext, unit: number, canvas: CanvasLike): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('无法创建 WebGL 纹理')
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
  return texture
}

function applyUniforms(
  gl: WebGLRenderingContext,
  uniforms: Map<string, WebGLUniformLocation | null>,
  uniformTypes: Map<string, string>,
  values: Record<string, ShaderUniformValue> | undefined
): void {
  if (!values) return
  for (const [name, value] of Object.entries(values)) {
    const location = uniforms.get(name)
    if (!location) continue
    const type = uniformTypes.get(name) || ''
    if (typeof value === 'boolean') {
      gl.uniform1i(location, value ? 1 : 0)
      continue
    }
    if (typeof value === 'number') {
      if (type === 'int' || type === 'bool') gl.uniform1i(location, value)
      else gl.uniform1f(location, value)
      continue
    }
    if (type === 'ivec2') gl.uniform2iv(location, value)
    else if (type === 'ivec3') gl.uniform3iv(location, value)
    else if (type === 'ivec4') gl.uniform4iv(location, value)
    else if (value.length === 2) gl.uniform2fv(location, value)
    else if (value.length === 3) gl.uniform3fv(location, value)
    else if (value.length === 4) gl.uniform4fv(location, value)
  }
}

export async function applyShaderTransition({
  context,
  canvasA,
  canvasB,
  width,
  height,
  progress,
  source,
  uniforms
}: {
  context: RenderContext
  canvasA: CanvasLike
  canvasB: CanvasLike
  width: number
  height: number
  progress: number
  source: string
  uniforms?: Record<string, ShaderUniformValue>
}): Promise<void> {
  const runtime = getRuntime(context, source, width, height)
  const { gl } = runtime
  gl.useProgram(runtime.program)
  const textureA = uploadTexture(gl, 0, canvasA)
  const textureB = uploadTexture(gl, 1, canvasB)
  if (runtime.from) gl.uniform1i(runtime.from, 0)
  if (runtime.to) gl.uniform1i(runtime.to, 1)
  if (runtime.progress) gl.uniform1f(runtime.progress, progress)
  if (runtime.ratio) gl.uniform1f(runtime.ratio, width / Math.max(1, height))
  applyUniforms(gl, runtime.uniforms, runtime.uniformTypes, uniforms)
  gl.viewport(0, 0, width, height)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  context.drawImage(runtime.canvas, 0, 0, width, height)
  gl.deleteTexture(textureA)
  gl.deleteTexture(textureB)
}
