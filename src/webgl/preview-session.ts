// 单个 WebGL 视口的会话：装配 Renderer，驱动渲染循环，响应项目状态
import { bakeAggregate, type BakeResult } from '../core/aggregate';
import { buildMall } from './scene-geometry';
import { CameraController } from './camera';
import { Renderer, type ErrorMetric, type RenderParams } from './renderer';
import type { Project } from '../core/types';

export interface SessionHud {
  fps: number;
  error: ErrorMetric | null;
  validation: boolean;
}

export class PreviewSession {
  renderer: Renderer;
  camera: CameraController;
  private raf = 0;
  private lastT = 0;
  private bake: BakeResult | null = null;
  private mixSig = '';
  private layoutSig = '';
  validation = false;
  onHud: ((h: SessionHud) => void) | null = null;
  private hudTimer = 0;
  private disposed = false;
  /** 强制粗糙度覆盖（对比页固定目数用），null 跟随项目 */
  roughnessOverride: number | null = null;

  constructor(canvas: HTMLCanvasElement, private project: Project) {
    this.renderer = new Renderer(canvas);
    this.camera = new CameraController(canvas, project.layout.hallWidthM, project.layout.hallDepthM);
    this.syncGeometry();
    this.syncAggregate(true);
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (this.disposed) return;
      const dt = Math.min(0.05, (t - this.lastT) / 1000);
      this.lastT = t;
      this.camera.update(dt);
      this.syncAggregate(false);
      this.syncGeometry();
      const stage = this.gritStage();
      const params: RenderParams = {
        roughness: this.roughnessOverride ?? stage.roughness,
        scene: this.project.scene,
        settings: this.settingsRef(),
        validation: this.validation,
      };
      this.renderer.render(this.camera, params);
      this.hudTimer += dt;
      if (this.hudTimer > 0.5) {
        this.hudTimer = 0;
        this.onHud?.({
          fps: this.renderer.fps,
          error: this.renderer.lastError,
          validation: this.validation,
        });
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private settingsRef() {
    // 每帧读 store 最新设置（设置页修改后自动生效）
    return store.settings;
  }

  private gritStage() {
    const table = store.settings.gritTable;
    return table.find((g) => g.grit === this.project.selectedGrit) ?? table[0];
  }

  private syncAggregate(force: boolean) {
    const m = this.project.mix;
    const sig = JSON.stringify({
      s: m.seed, p: m.pastes, c: m.cementColor, t: m.targetAreaFractionPct,
      a: m.aggregates.map((x) => ({ k: x.kind, d: x.dosagePct, g: x.grading, col: x.color, den: x.densityKgM3 })),
    });
    if (!force && sig === this.mixSig) return;
    this.mixSig = sig;
    this.bake = bakeAggregate(m);
    this.renderer.setAggregate(this.bake, this.project.layout.hallWidthM, this.project.layout.hallDepthM);
  }

  private syncGeometry() {
    const l = this.project.layout;
    const sig = JSON.stringify({ w: l.hallWidthM, d: l.hallDepthM, gx: l.columnGridX, gz: l.columnGridZ, lines: l.lines });
    if (sig === this.layoutSig) return;
    this.layoutSig = sig;
    const geo = buildMall(l);
    this.renderer.setGeometry(geo);
    this.camera.reset(l.hallWidthM, l.hallDepthM);
  }

  getBake(): BakeResult | null {
    return this.bake;
  }

  capture(): string {
    return this.renderer.capture();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.camera.dispose();
  }
}

// 设置是全局单例，会话每帧从 store 读取，避免与 store 循环依赖
import { store } from '../core/store';
