// 反射探针：立方体贴图捕获场景 + 粗糙度 mip 卷积（双 cube 乒乓，杜绝纹理反馈循环）
import { createProgram, drawMesh, uniformLocations, type Mesh } from './gl-utils';
import { PROBE_CONVOLVE_FS } from './shaders';
import { mat4Invert, mat4LookAt, mat4Perspective, type Mat4 } from '../core/math';
import { MatId } from '../core/types';

const FACE_DIRS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
const FACE_UPS: [number, number, number][] = [
  [0, 1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0], [0, 1, 0],
];

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

const PROBE_CAPTURE_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
layout(location=3) in int aMatId;
uniform mat4 uVP;
uniform mat4 uModel;
flat out int vMatId;
void main() {
  vMatId = aMatId;
  gl_Position = uVP * uModel * vec4(aPos, 1.0);
}
`;

const CAPTURE_FS = /* glsl */ `#version 300 es
precision highp float;
flat in int vMatId;
uniform float uLightOn;
out vec4 o;
void main() {
  vec3 col = vec3(0.35);
  if (vMatId == ${MatId.Architecture}) col = vec3(0.42,0.43,0.46);
  if (vMatId == ${MatId.Emissive}) col = vec3(1.0,0.95,0.85) * (1.0 + uLightOn * 2.2);
  o = vec4(col, 1.0);
}
`;

function makeCube(gl: WebGL2RenderingContext, size: number): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
  const levels = Math.floor(Math.log2(size)) + 1;
  // 显式分配每个 mip 层的六个面，保证任意层作为渲染目标时 FBO 完整
  let dim = size;
  for (let m = 0; m < levels; m++) {
    for (let i = 0; i < 6; i++) {
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, m, gl.RGBA16F, dim, dim, 0, gl.RGBA, gl.HALF_FLOAT, null);
    }
    dim = Math.max(1, dim >> 1);
  }
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  return t;
}

export class ReflectionProbe {
  /** 最终供 SSR/合成采样的卷积结果 cube */
  cube: WebGLTexture;
  private scratch: WebGLTexture;
  private fbo: WebGLFramebuffer;
  private depthRb: WebGLRenderbuffer;
  private mipCount: number;
  private size: number;
  private captureProgram: WebGLProgram;
  private captureU: Record<string, WebGLUniformLocation | null>;
  private convolveProgram: WebGLProgram;
  private convolveU: Record<string, WebGLUniformLocation | null>;
  private fullscreen: Mesh;

  constructor(private gl: WebGL2RenderingContext, size = 256) {
    this.size = size;
    this.mipCount = Math.floor(Math.log2(size)) + 1;
    this.cube = makeCube(gl, size);
    this.scratch = makeCube(gl, size);
    this.fbo = gl.createFramebuffer()!;
    this.depthRb = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, size, size);

    this.captureProgram = createProgram(gl, PROBE_CAPTURE_VS, CAPTURE_FS);
    this.captureU = uniformLocations(gl, this.captureProgram, ['uVP', 'uModel', 'uLightOn']);
    this.convolveProgram = createProgram(gl, FULLSCREEN_VS_SRC, PROBE_CONVOLVE_FS);
    this.convolveU = uniformLocations(gl, this.convolveProgram, [
      'uProbe', 'uProbePos', 'uFaceView', 'uProj', 'uInvProj', 'uRoughness',
    ]);
    this.fullscreen = makeFullscreen(gl);
  }

  /** 拍摄六面（只画建筑与自发光，地面不进探针，避免自反射回环） */
  capture(
    pos: [number, number, number],
    drawables: { mesh: Mesh; model: Mat4; emissive?: boolean }[],
    lightOn: number,
  ): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb);
    gl.viewport(0, 0, this.size, this.size);
    const proj = mat4Perspective(Math.PI / 2, 1, 0.1, 80);
    gl.useProgram(this.captureProgram);
    gl.uniform1f(this.captureU.uLightOn, lightOn);
    gl.uniformMatrix4fv(this.captureU.uModel, false, IDENTITY);
    for (let face = 0; face < 6; face++) {
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, this.cube, 0,
      );
      gl.clearColor(0.05, 0.06, 0.08, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const view = mat4LookAt(pos, [
        pos[0] + FACE_DIRS[face][0], pos[1] + FACE_DIRS[face][1], pos[2] + FACE_DIRS[face][2],
      ], FACE_UPS[face]);
      const vp = mat4Mul(proj, view);
      gl.uniformMatrix4fv(this.captureU.uVP, false, vp);
      for (const d of drawables) {
        gl.uniformMatrix4fv(this.captureU.uModel, false, d.model);
        drawMesh(gl, d.mesh);
      }
    }
    // mip0 就位，生成 mip 链作为卷积的初始低粗糙度数据源
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.cube);
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    this.convolve(pos, proj);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * 逐 mip 粗糙度卷积，双 cube 乒乓：
   * 读 src 的上一 mip，写 dst 当前 mip，再交换，杜绝同纹理读写反馈循环。
   */
  private convolve(pos: [number, number, number], proj: Mat4): void {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    // 卷积是全屏三角形，不需要深度；解绑深度附件，避免与小尺寸 mip 颜色附件尺寸冲突
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
    gl.useProgram(this.convolveProgram);
    const invProj = mat4Invert(proj);
    gl.uniformMatrix4fv(this.convolveU.uProj, false, proj);
    gl.uniformMatrix4fv(this.convolveU.uInvProj, false, invProj);
    gl.uniform3fv(this.convolveU.uProbePos, pos);

    let src = this.cube;
    let dst = this.scratch;
    for (let m = 1; m < this.mipCount; m++) {
      const roughness = m / (this.mipCount - 1);
      const dim = Math.max(1, this.size >> m);
      gl.uniform1f(this.convolveU.uRoughness, roughness);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, src); // 只读 src
      gl.uniform1i(this.convolveU.uProbe, 0);
      for (let face = 0; face < 6; face++) {
        const view = mat4LookAt(pos, [
          pos[0] + FACE_DIRS[face][0], pos[1] + FACE_DIRS[face][1], pos[2] + FACE_DIRS[face][2],
        ], FACE_UPS[face]);
        gl.uniformMatrix4fv(this.convolveU.uFaceView, false, view);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, dst, m, // 只写 dst，与 src 不同纹理
        );
        gl.viewport(0, 0, dim, dim);
        drawMesh(gl, this.fullscreen);
      }
      // 生成 dst 该层之上的 mip，供下一层采样
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, dst);
      gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
      // 交换：下一轮读现在的 dst
      [src, dst] = [dst, src];
    }
    // 卷积结束后最终结果在 src；直接交换两个纹理对象的身份，外部始终采样 this.cube
    if (src !== this.cube) {
      const tmp = this.cube;
      this.cube = this.scratch;
      this.scratch = tmp;
    }
    gl.enable(gl.DEPTH_TEST);
  }
}

function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      out[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return out;
}

const FULLSCREEN_VS_SRC = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
layout(location=3) in int aMatId;
out vec2 vUv;
void main(){ vUv = aUv; gl_Position = vec4(aPos.xy,0.0,1.0); }
`;

function makeFullscreen(gl: WebGL2RenderingContext): Mesh {
  const data = new Float32Array([
    -1, -1, 0, 0, 0, 1, 0, 0, 0,
     3, -1, 0, 0, 0, 1, 2, 0, 0,
    -1,  3, 0, 0, 0, 1, 0, 2, 0,
  ]);
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const stride = 9 * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 6 * 4);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribIPointer(3, 1, gl.INT, stride, 8 * 4);
  gl.bindVertexArray(null);
  return { vao, vertexCount: 3, indexCount: 0, vbo, ibo: null };
}
