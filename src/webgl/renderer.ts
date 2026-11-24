// 主渲染管线：G-Buffer → Hi-Z 深度金字塔 → Hi-Z 步进 SSR → 探针回退/时间累积
// → 合成色调映射；另含平面镜参考通道与逐像素灰度误差自检
import {
  createColorMipChain, createHiZTexture, createMesh, createMRT, createProgram,
  drawMesh, textureFromCanvas, uniformLocations, type Mesh, type RTSet,
} from './gl-utils';
import {
  BASECOLOR_FS, COMPOSITE_FS, ERROR_FS, FULLSCREEN_VS, GBUFFER_FS, GBUFFER_VS, HIZ_DOWN_FS,
  HIZ_FIRST_FS, HIZ_VS, MIRROR_FS, MIRROR_VS, RESOLVE_FS, SSR_FS,
} from './shaders';
import { mat4Identity, mat4Invert, mat4Multiply, mat4Perspective, mirrorViewAcrossY, type Mat4 } from '../core/math';
import { colorTempToRgb } from '../core/math';
import type { BakeResult } from '../core/aggregate';
import type { MallGeometry } from './scene-geometry';
import { toFloatArrays } from './scene-geometry';
import type { CameraController } from './camera';
import { ReflectionProbe } from './probe';
import type { AppSettings, SceneSettings } from '../core/types';
import { MatId } from '../core/types';

export interface RenderParams {
  roughness: number;
  scene: SceneSettings;
  settings: AppSettings;
  validation: boolean;
}

export interface ErrorMetric {
  meanGrayLevels: number;
  maxGrayLevels: number;
  coveragePct: number;
  samples: number;
}

export class Renderer {
  private gl: WebGL2RenderingContext;
  private programs: Record<string, WebGLProgram> = {};
  private u: Record<string, Record<string, WebGLUniformLocation | null>> = {};
  private fullscreen: Mesh;
  private meshes: Record<string, Mesh> = {};
  private albedoTex: WebGLTexture | null = null;
  private matTex: WebGLTexture | null = null;
  private floorModel: Mat4 = mat4Identity();
  private probe: ReflectionProbe;
  private gbuffer!: RTSet;
  private sceneColorMips!: { texture: WebGLTexture; fbos: WebGLFramebuffer[] };
  private hiZ!: WebGLTexture;
  private hiZScratch!: WebGLTexture;
  private hiZFbos: WebGLFramebuffer[] = [];
  private hiZScratchFbos: WebGLFramebuffer[] = [];
  private ssrRT!: RTSet;
  private reflA!: RTSet;
  private reflB!: RTSet;
  private mirrorRT!: RTSet;
  private errorRT!: RTSet;
  private width = 2;
  private height = 2;
  private frame = 0;
  private prevViewProj: Mat4 = mat4Identity();
  private lastProbeKey = '';
  fps = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  lastError: ErrorMetric | null = null;
  /** 最近的 GL 诊断标记（手动排查时填充，正常渲染不轮询 getError） */
  glMarks: string[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext;
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('缺少 EXT_color_buffer_float 浮点渲染目标支持');
    gl.getExtension('OES_texture_float_linear');
    this.gl = gl;
    this.fullscreen = this.makeFullscreen();
    this.probe = new ReflectionProbe(gl, 256);
    this.buildPrograms();
  }

  private buildPrograms(): void {
    const gl = this.gl;
    const def = (name: string, vs: string, fs: string, uniforms: string[]) => {
      const p = createProgram(gl, vs, fs);
      this.programs[name] = p;
      this.u[name] = uniformLocations(gl, p, uniforms);
    };
    def('gbuffer', GBUFFER_VS, GBUFFER_FS, [
      'uVP', 'uModel', 'uUvScale', 'uAlbedoTex', 'uMatTex', 'uUseTerrazzoTex',
      'uRoughness', 'uConstColor', 'uWet',
    ]);
    def('hizFirst', HIZ_VS, HIZ_FIRST_FS, ['uDepth', 'uInvProj']);
    def('hizDown', HIZ_VS, HIZ_DOWN_FS, ['uHiZ', 'uFromMip']);
    def('baseColor', FULLSCREEN_VS, BASECOLOR_FS, [
      'gAlbedo', 'gNormalR', 'gMatAo', 'uLightDir', 'uLightColor', 'uLightIntensity', 'uLightOn',
    ]);
    def('ssr', FULLSCREEN_VS, SSR_FS, [
      'gAlbedo', 'gNormalR', 'gMatAo', 'uDepth', 'uHiZ', 'uProj', 'uInvProj',
      'uInvView', 'uResolution', 'uThickness', 'uMaxSteps', 'uMaxDistance', 'uFrameIndex',
    ]);
    def('resolve', FULLSCREEN_VS, RESOLVE_FS, [
      'gAlbedo', 'gNormalR', 'gMatAo', 'uDepth', 'uSceneColor', 'uHit', 'uHistory',
      'uProbe', 'uInvProj', 'uInvView', 'uCurViewProj', 'uPrevViewProj', 'uProbePos',
      'uProbeEnabled', 'uFrameIndex', 'uResolution',
    ]);
    def('composite', FULLSCREEN_VS, COMPOSITE_FS, [
      'gAlbedo', 'gNormalR', 'gMatAo', 'uDepth', 'uReflection', 'uInvProj', 'uInvView',
      'uLightDir', 'uLightColor', 'uLightIntensity', 'uLightOn', 'uCamPos', 'uWet', 'uValidationMode',
    ]);
    def('mirror', MIRROR_VS, MIRROR_FS, [
      'uVP', 'uModel', 'uProbe', 'uCamPos', 'uLightColor', 'uLightOn', 'uValidationMode',
    ]);
    def('error', FULLSCREEN_VS, ERROR_FS, ['uA', 'uB', 'uDepth']);
  }

  private makeFullscreen(): Mesh {
    const gl = this.gl;
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

  /** 几何重建（分格/柱网变化时） */
  setGeometry(geo: MallGeometry): void {
    const gl = this.gl;
    Object.values(this.meshes).forEach((m) => {
      gl.deleteVertexArray(m.vao);
      gl.deleteBuffer(m.vbo);
      if (m.ibo) gl.deleteBuffer(m.ibo);
    });
    const mk = (data: ReturnType<typeof toFloatArrays>): Mesh => createMesh(gl, data.vertices, data.indices);
    this.meshes = {
      floor: mk(toFloatArrays(geo.floor)),
      dividers: mk(toFloatArrays(geo.dividers)),
      architecture: mk(toFloatArrays(geo.architecture)),
      emissive: mk(toFloatArrays(geo.emissive)),
    };
    // 几何统一使用大厅正象限坐标（0~W / 0~D），地面不再额外平移
    this.floorModel = mat4Identity();
  }

  /** 骨料烘焙纹理更新（配比变化时） */
  setAggregate(bake: BakeResult, hallW: number, hallD: number): void {
    const gl = this.gl;
    if (this.albedoTex) gl.deleteTexture(this.albedoTex);
    if (this.matTex) gl.deleteTexture(this.matTex);
    this.albedoTex = textureFromCanvas(gl, bake.albedoCanvas, true);
    this.matTex = textureFromCanvas(gl, bake.materialCanvas, true);
    // uv scale：每 TILE_M（0.5m）一块烘焙瓷砖
    this.uvScale = [hallW / 0.5, hallD / 0.5];
  }
  private uvScale: [number, number] = [10, 10];

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(2, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(2, Math.floor(this.canvas.clientHeight * dpr));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.allocateTargets();
    this.frame = 0;
  }

  private allocateTargets(): void {
    const gl = this.gl;
    const w = this.width, h = this.height;
    // G-Buffer：反照率(RGBA16F) / 法线粗糙度(RGBA16F) / 材质AO(RGBA8)，带深度纹理
    this.gbuffer = createMRT(gl, w, h, [gl.RGBA16F, gl.RGBA16F, gl.RGBA8], true);
    // 场景颜色 mip 链：SSR 锥体足迹按粗糙度取 mip（越糙越糊，非整屏高斯）
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    this.sceneColorMips = createColorMipChain(gl, w, h, levels);
    // Hi-Z 线性深度金字塔：双纹理乒乓，避免同一纹理既采样又挂载为渲染目标的反馈循环
    if (this.hiZ) gl.deleteTexture(this.hiZ);
    if (this.hiZScratch) gl.deleteTexture(this.hiZScratch);
    this.hiZ = createHiZTexture(gl, w, h);
    this.hiZScratch = createHiZTexture(gl, w, h);
    this.hiZFbos = [];
    this.hiZScratchFbos = [];
    let mw = w, mh = h;
    const hizLevels = levels;
    for (let i = 0; i < hizLevels; i++) {
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.hiZ, i);
      this.hiZFbos.push(fbo);
      const sbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, sbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.hiZScratch, i);
      this.hiZScratchFbos.push(sbo);
      mw = Math.max(1, mw >> 1);
      mh = Math.max(1, mh >> 1);
    }
    // SSR 命中 + 锥体参数
    this.ssrRT = createMRT(gl, w, h, [gl.RGBA16F, gl.RGBA16F], false);
    // 反射累积双缓冲
    this.reflA = createMRT(gl, w, h, [gl.RGBA16F], false);
    this.reflB = createMRT(gl, w, h, [gl.RGBA16F], false);
    // 镜面参考与误差图
    this.mirrorRT = createMRT(gl, w, h, [gl.RGBA16F], true);
    this.errorRT = createMRT(gl, w, h, [gl.RGBA8], false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private ensureProbe(scene: SceneSettings, settings: AppSettings): void {
    const key = `${scene.lightOn}|${scene.colorTempK}|${settings.probeVersion}`;
    if (key === this.lastProbeKey) return;
    const gl = this.gl;
    const pos: [number, number, number] = [0, 1.5, 0];
    const light = scene.lightOn ? 1 : 0;
    const drawables = [
      { mesh: this.meshes.architecture, model: mat4Identity() },
      { mesh: this.meshes.emissive, model: mat4Identity(), emissive: true },
    ];
    gl.getExtension('EXT_color_buffer_float');
    this.probe.capture(pos, drawables, light);
    this.lastProbeKey = key;
    this.frame = 0; // 探针变了，时间累积重新收敛
  }

  private drawGbuffer(vp: Mat4, roughness: number, wet: number): void {
    const gl = this.gl;
    const U = this.u.gbuffer;
    // 重置可能被前序 pass（探针卷积等）污染的全局状态，避免 INVALID_OPERATION
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    gl.useProgram(this.programs.gbuffer);
    gl.uniformMatrix4fv(U.uVP, false, vp);
    gl.uniform1f(U.uRoughness, roughness);
    gl.uniform1f(U.uWet, wet);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.albedoTex);
    gl.uniform1i(U.uAlbedoTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.matTex);
    gl.uniform1i(U.uMatTex, 1);

    const draw = (mesh: Mesh, model: Mat4, useTex: number, color: [number, number, number]) => {
      gl.uniformMatrix4fv(U.uModel, false, model);
      gl.uniform2fv(U.uUvScale, useTex ? this.uvScale : [1, 1]);
      gl.uniform1i(U.uUseTerrazzoTex, useTex);
      gl.uniform3fv(U.uConstColor, color);
      drawMesh(gl, mesh);
    };
    draw(this.meshes.floor, this.floorModel, 1, [0.5, 0.5, 0.5]);
    draw(this.meshes.dividers, mat4Identity(), 0, [0.8, 0.6, 0.4]);
    draw(this.meshes.architecture, mat4Identity(), 0, [0.42, 0.43, 0.46]);
    draw(this.meshes.emissive, mat4Identity(), 0, [1, 0.95, 0.85]);
  }

  private buildHiZ(invProj: Mat4): void {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    // level 0：硬件深度 → 线性视空间深度，写入 hiZ
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.hiZFbos[0]);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.programs.hizFirst);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.textures[3]);
    gl.uniform1i(this.u.hizFirst.uDepth, 0);
    gl.uniformMatrix4fv(this.u.hizFirst.uInvProj, false, invProj);
    drawMesh(gl, this.fullscreen);
    // 逐级降采样：hiZ(mip i-1) → scratch(mip i)，再 blit 回 hiZ(mip i)，乒乓避免反馈循环
    gl.useProgram(this.programs.hizDown);
    let w = this.width, h = this.height;
    for (let i = 1; i < this.hiZFbos.length; i++) {
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
      // 采样源：hiZ 的 i-1 层；渲染目标：scratch 的 i 层（不同纹理，合法）
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.hiZScratchFbos[i]);
      gl.viewport(0, 0, w, h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.hiZ);
      gl.uniform1i(this.u.hizDown.uHiZ, 0);
      gl.uniform1i(this.u.hizDown.uFromMip, i - 1);
      drawMesh(gl, this.fullscreen);
      // 同尺寸 blit 回 hiZ 第 i 层，保持 SSR 只采样单一金字塔纹理
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.hiZScratchFbos[i]);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.hiZFbos[i]);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    gl.enable(gl.DEPTH_TEST);
  }

  /** 场景基底色（无反射光照）写入 mip 链 level 0 并生成 mip，供 SSR 锥体足迹取色 */
  private buildSceneBase(params: RenderParams): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneColorMips.fbos[0]);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.programs.baseColor);
    const U = this.u.baseColor;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.textures[0]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.textures[1]);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.textures[2]);
    gl.uniform1i(U.gAlbedo, 0);
    gl.uniform1i(U.gNormalR, 1);
    gl.uniform1i(U.gMatAo, 2);
    const [lr, lg, lb] = colorTempToRgb(params.scene.colorTempK);
    gl.uniform3f(U.uLightColor, lr, lg, lb);
    gl.uniform3f(U.uLightDir, -0.35, -0.85, 0.4);
    gl.uniform1f(U.uLightIntensity, params.scene.lightIntensity);
    gl.uniform1f(U.uLightOn, params.scene.lightOn ? 1 : 0);
    drawMesh(gl, this.fullscreen);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneColorMips.texture);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  private runSSR(proj: Mat4, invProj: Mat4, invView: Mat4, quality: AppSettings['ssrQuality']): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ssrRT.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.programs.ssr);
    const U = this.u.ssr;
    gl.uniform1i(U.gAlbedo, 0);
    gl.uniform1i(U.gNormalR, 1);
    gl.uniform1i(U.gMatAo, 2);
    gl.uniform1i(U.uDepth, 3);
    gl.uniform1i(U.uHiZ, 4);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.textures[0]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.textures[1]);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.textures[2]);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.textures[3]);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.hiZ);
    gl.uniformMatrix4fv(U.uProj, false, proj);
    gl.uniformMatrix4fv(U.uInvProj, false, invProj);
    gl.uniformMatrix4fv(U.uInvView, false, invView);
    gl.uniform2f(U.uResolution, this.width, this.height);
    gl.uniform1f(U.uThickness, 0.6);
    gl.uniform1i(U.uMaxSteps, quality === 'high' ? 48 : 28);
    gl.uniform1f(U.uMaxDistance, 30);
    gl.uniform1f(U.uFrameIndex, this.frame);
    drawMesh(gl, this.fullscreen);
  }

  /** 探针回退 + 时间累积（ping-pong），输出最终反射纹理 */
  private resolveReflection(probeEnabled: boolean): void {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    const history = this.frame % 2 === 0 ? this.reflA : this.reflB;
    const dst = this.frame % 2 === 0 ? this.reflB : this.reflA;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.programs.resolve);
    const U = this.u.resolve;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.textures[0]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.textures[1]);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.textures[2]);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.textures[3]);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.sceneColorMips.texture);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.ssrRT.textures[0]);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, history.textures[0]);
    gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.probe.cube);
    gl.uniform1i(U.gAlbedo, 0);
    gl.uniform1i(U.gNormalR, 1);
    gl.uniform1i(U.gMatAo, 2);
    gl.uniform1i(U.uDepth, 3);
    gl.uniform1i(U.uSceneColor, 4);
    gl.uniform1i(U.uHit, 5);
    gl.uniform1i(U.uHistory, 6);
    gl.uniform1i(U.uProbe, 7);
    gl.uniformMatrix4fv(U.uInvProj, false, this.cachedInvProj);
    gl.uniformMatrix4fv(U.uInvView, false, this.cachedInvView);
    gl.uniformMatrix4fv(U.uCurViewProj, false, this.cachedViewProj);
    gl.uniformMatrix4fv(U.uPrevViewProj, false, this.prevViewProj);
    gl.uniform3f(U.uProbePos, 0, 1.5, 0);
    gl.uniform1f(U.uProbeEnabled, probeEnabled ? 1 : 0);
    gl.uniform1f(U.uFrameIndex, this.frame);
    gl.uniform2f(U.uResolution, this.width, this.height);
    drawMesh(gl, this.fullscreen);
    this.currentReflection = dst.textures[0];
  }
  private currentReflection: WebGLTexture | null = null;
  private cachedInvProj: Mat4 = mat4Identity();
  private cachedInvView: Mat4 = mat4Identity();
  private cachedViewProj: Mat4 = mat4Identity();

  private composite(cam: CameraController, params: RenderParams, toScreen: boolean): void {
    const gl = this.gl;
    if (toScreen) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.programs.composite);
    const U = this.u.composite;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.textures[0]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.textures[1]);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.textures[2]);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.textures[3]);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.currentReflection);
    gl.uniform1i(U.gAlbedo, 0);
    gl.uniform1i(U.gNormalR, 1);
    gl.uniform1i(U.gMatAo, 2);
    gl.uniform1i(U.uDepth, 3);
    gl.uniform1i(U.uReflection, 4);
    gl.uniformMatrix4fv(U.uInvProj, false, this.cachedInvProj);
    gl.uniformMatrix4fv(U.uInvView, false, this.cachedInvView);
    const [lr, lg, lb] = colorTempToRgb(params.scene.colorTempK);
    gl.uniform3f(U.uLightColor, lr, lg, lb);
    gl.uniform3f(U.uLightDir, -0.35, -0.85, 0.4);
    gl.uniform1f(U.uLightIntensity, params.scene.lightIntensity);
    gl.uniform1f(U.uLightOn, params.scene.lightOn ? 1 : 0);
    gl.uniform3fv(U.uCamPos, cam.position);
    gl.uniform1f(U.uWet, params.scene.wetFilm ? 1 : 0);
    gl.uniform1f(U.uValidationMode, params.validation ? 1 : 0);
    drawMesh(gl, this.fullscreen);
  }

  /** 平面镜参考：镜像相机下，地板片元从探针 mip0 取理想镜面环境，输出线性灰度 */
  private renderMirrorReference(cam: CameraController, params: RenderParams, proj: Mat4): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mirrorRT.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.programs.mirror);
    const U = this.u.mirror;
    // 相机关于 y=0 平面镜像，地板仍用原模型矩阵
    const mirrorView = mirrorViewAcrossY(cam.position, cam.lookAt, [0, 1, 0], 0);
    const vp = mat4Multiply(proj, mirrorView);
    gl.uniformMatrix4fv(U.uVP, false, vp);
    gl.uniformMatrix4fv(U.uModel, false, this.floorModel);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.probe.cube);
    gl.uniform1i(U.uProbe, 0);
    gl.uniform3fv(U.uCamPos, cam.position);
    const [lr, lg, lb] = colorTempToRgb(params.scene.colorTempK);
    gl.uniform3f(U.uLightColor, lr, lg, lb);
    gl.uniform1f(U.uLightOn, params.scene.lightOn ? 1 : 0);
    gl.uniform1f(U.uValidationMode, 1);
    drawMesh(gl, this.meshes.floor);
    gl.disable(gl.DEPTH_TEST);
  }

  /** 误差图 + CPU 读回平均灰度级差（仅地面材质区域，镜像参考非空处参与统计） */
  private computeError(): ErrorMetric {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.errorRT.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.programs.error);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.validationTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.mirrorRT.textures[0]);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.textures[2]);
    gl.uniform1i(this.u.error.uA, 0);
    gl.uniform1i(this.u.error.uB, 1);
    gl.uniform1i(this.u.error.uDepth, 2);
    drawMesh(gl, this.fullscreen);

    // 降采样读回：每 step 像素取 1 个样本，控制 CPU 回传量
    const step = 4;
    const w = Math.max(1, Math.floor(this.width / step));
    const h = Math.max(1, Math.floor(this.height / step));
    const aBuf = new Float32Array(w * h * 4);
    const bBuf = new Float32Array(w * h * 4);
    const idBuf = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.validationReadFbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, aBuf);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.mirrorRT.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, bBuf);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.gbuffer.fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT2);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, idBuf);
    let sum = 0, max = 0, count = 0;
    for (let i = 0; i < w * h; i++) {
      const matId = idBuf[i * 4];
      const b = bBuf[i * 4];
      // 仅地面材质（0~6）且镜像参考有内容的屏幕区域参与
      if (matId <= MatId.Stainless && b > 0.001) {
        const diff = Math.abs(aBuf[i * 4] - b) * 255;
        sum += diff;
        max = Math.max(max, diff);
        count++;
      }
    }
    const metric: ErrorMetric = {
      meanGrayLevels: count ? sum / count : 0,
      maxGrayLevels: max,
      coveragePct: count ? (count / (w * h)) * 100 : 0,
      samples: count,
    };
    this.lastError = metric;
    return metric;
  }

  private validationTex: WebGLTexture | null = null;
  private validationReadFbo: WebGLFramebuffer | null = null;
  private validationW = 0;
  private validationH = 0;

  /** 自检目标随分辨率重建（RGBA16F + 深度） */
  private setupValidationTargets(): void {
    const gl = this.gl;
    if (this.validationTex && this.validationW === this.width && this.validationH === this.height) return;
    if (this.validationTex) gl.deleteTexture(this.validationTex);
    if (this.validationReadFbo) gl.deleteFramebuffer(this.validationReadFbo);
    this.validationTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.validationTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, this.width, this.height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.validationReadFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.validationReadFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.validationTex, 0);
    const rb = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.width, this.height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    this.validationW = this.width;
    this.validationH = this.height;
  }

  render(cam: CameraController, params: RenderParams): void {
    const gl = this.gl;
    this.resize();
    const now = performance.now();
    this.fpsFrames++;
    if (now - this.fpsTime > 500) {
      this.fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsTime));
      this.fpsFrames = 0;
      this.fpsTime = now;
    }

    this.ensureProbe(params.scene, params.settings);
    const aspect = this.width / this.height;
    const proj = mat4Perspective(cam.fovy, aspect, 0.08, 90);
    const view = cam.viewMatrix();
    const viewProj = mat4Multiply(proj, view);
    const invProj = mat4Invert(proj);
    const invView = mat4Invert(view);
    this.cachedInvProj = invProj;
    this.cachedInvView = invView;
    this.cachedViewProj = viewProj;

    // 1) G-Buffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.gbuffer.fbo);
    // 探针等 pass 会改绘制缓冲，显式恢复 MRT 的 3 个颜色附件
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    gl.viewport(0, 0, this.width, this.height);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.08, 0.09, 0.11, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // 自检模式强制理想镜面粗糙度，确保 G-Buffer 粗糙度归零、与平面镜参考同口径
    const gbufRoughness = params.validation ? 0 : params.roughness;
    this.drawGbuffer(viewProj, gbufRoughness, params.scene.wetFilm ? 1 : 0);

    // 2) Hi-Z 深度金字塔
    this.buildHiZ(invProj);

    // 3) 场景基底色 mip 链（SSR 命中取色源，锥体足迹按粗糙度取 mip）
    this.buildSceneBase(params);

    // 4) Hi-Z 加速屏幕空间反射
    this.runSSR(proj, invProj, invView, params.settings.ssrQuality);

    // 5) 探针回退 + 时间累积
    this.resolveReflection(params.settings.probeFallback);

    // 6) 合成（validation 时先输出线性灰度到自检 RT）
    if (params.validation) {
      this.setupValidationTargets();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.validationReadFbo);
      this.composite(cam, params, false);
      // 理想平面镜参考通道
      this.renderMirrorReference(cam, params, proj);
      this.computeError();
      // 误差可视化上屏（差值放大 8 倍）
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.programs.error);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.validationTex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.mirrorRT.textures[0]);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.textures[2]);
      gl.uniform1i(this.u.error.uA, 0);
      gl.uniform1i(this.u.error.uB, 1);
      gl.uniform1i(this.u.error.uDepth, 2);
      drawMesh(gl, this.fullscreen);
    } else {
      this.composite(cam, params, true);
    }

    this.prevViewProj = viewProj;
    this.frame++;
  }

  /** 截图：从默认帧缓冲拷贝到 2D 画布导出 dataURL（在 render 当帧调用） */
  capture(): string {
    const gl = this.gl;
    const c = document.createElement('canvas');
    c.width = this.width;
    c.height = this.height;
    const ctx = c.getContext('2d')!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const bytes = new Uint8Array(this.width * this.height * 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    // GL 原点在左下，翻转 Y
    const img = ctx.createImageData(this.width, this.height);
    for (let y = 0; y < this.height; y++) {
      const src = (this.height - 1 - y) * this.width * 4;
      img.data.set(bytes.subarray(src, src + this.width * 4), y * this.width * 4);
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }

  get errorTexture(): WebGLTexture {
    return this.errorRT.textures[0];
  }
}
