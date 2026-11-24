// WebGL2 基础工具：着色器编译、程序、VAO、纹理、FBO

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const compile = (type: number, src: string): WebGLShader => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(`着色器编译失败:\n${log}\n--- 源码 ---\n${src}`);
    }
    return sh;
  };
  const v = compile(gl.VERTEX_SHADER, vs);
  const f = compile(gl.FRAGMENT_SHADER, fs);
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`程序链接失败: ${gl.getProgramInfoLog(p)}`);
  }
  return p;
}

export function uniformLocations(gl: WebGL2RenderingContext, p: WebGLProgram, names: string[]): Record<string, WebGLUniformLocation | null> {
  const out: Record<string, WebGLUniformLocation | null> = {};
  for (const n of names) out[n] = gl.getUniformLocation(p, n);
  return out;
}

export interface Mesh {
  vao: WebGLVertexArrayObject;
  vertexCount: number;
  indexCount: number;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer | null;
}

/** 交叉顶点：pos(3) normal(3) uv(2) matId(1) = 9 floats */
export const FLOATS_PER_VERTEX = 9;

export function createMesh(gl: WebGL2RenderingContext, data: Float32Array, indices: Uint32Array | null): Mesh {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const stride = FLOATS_PER_VERTEX * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 6 * 4);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribIPointer(3, 1, gl.INT, stride, 8 * 4);
  let ibo: WebGLBuffer | null = null;
  if (indices) {
    ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  }
  gl.bindVertexArray(null);
  return { vao, vertexCount: data.length / FLOATS_PER_VERTEX, indexCount: indices?.length ?? 0, vbo, ibo };
}

export function drawMesh(gl: WebGL2RenderingContext, mesh: Mesh): void {
  gl.bindVertexArray(mesh.vao);
  if (mesh.ibo) gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);
  else gl.drawArrays(gl.TRIANGLES, 0, mesh.vertexCount);
}

export function textureFromCanvas(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  repeat: boolean,
): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const anisExt = gl.getExtension('EXT_texture_filter_anisotropic') as
    | { TEXTURE_MAX_ANISOTROPY_EXT: number; MAX_TEXTURE_MAX_ANISOTROPY_EXT: number } | null;
  if (anisExt) {
    gl.texParameteri(
      gl.TEXTURE_2D,
      anisExt.TEXTURE_MAX_ANISOTROPY_EXT,
      Math.min(8, gl.getParameter(anisExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) ?? 1),
    );
  }
  return t;
}

export interface RTSet {
  fbo: WebGLFramebuffer;
  textures: WebGLTexture[];
  width: number;
  height: number;
}

/** 多渲染目标（带深度附件） */
export function createMRT(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormats: number[],
  depthTexture = false,
): RTSet {
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const textures = internalFormats.map((fmt, i) => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
    return t;
  });
  if (depthTexture) {
    const dt = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, dt);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT32F, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, dt, 0);
    textures.push(dt);
  } else {
    const rb = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
  }
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`FBO 不完整: 0x${status.toString(16)}`);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, textures, width, height };
}

/** 可作为 Hi-Z 金字塔的纹理（全 mip 层预分配） */
export function createHiZTexture(gl: WebGL2RenderingContext, width: number, height: number): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  const levels = Math.floor(Math.log2(Math.max(width, height))) + 1;
  let w = width, h = height;
  for (let i = 0; i < levels; i++) {
    gl.texImage2D(gl.TEXTURE_2D, i, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, null);
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** 颜色 mip 链纹理（探针卷积/粗糙度模糊共用） */
export function createColorMipChain(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  levels: number,
  internal = gl.RGBA16F,
): { texture: WebGLTexture; fbos: WebGLFramebuffer[] } {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  let w = width, h = height;
  for (let i = 0; i < levels; i++) {
    gl.texImage2D(gl.TEXTURE_2D, i, internal, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbos = Array.from({ length: levels }, () => gl.createFramebuffer()!);
  fbos.forEach((fbo, i) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, i);
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, fbos };
}

export function checkError(gl: WebGL2RenderingContext, where: string): void {
  const e = gl.getError();
  if (e !== gl.NO_ERROR) console.warn(`GL error 0x${e.toString(16)} @ ${where}`);
}
