// 相机：环绕模式（鸟瞰/平视预览）与行走模式（人眼高度看倒影）
import { mat4LookAt } from '../core/math';
import type { Mat4, Vec3 } from '../core/math';

export type CameraMode = 'orbit' | 'walk';

export class CameraController {
  mode: CameraMode = 'orbit';
  // 环绕参数
  target: Vec3 = [0, 0, 0];
  yaw = 0.7;
  pitch = 0.85;
  distance = 20;
  // 行走参数（世界坐标，y 锁定人眼高度）
  walkX = -6;
  walkZ = 8;
  walkYaw = 0;
  walkPitch = 0.02;
  eyeHeight = 1.6;
  fovy = (55 * Math.PI) / 180;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private keys = new Set<string>();
  private el: HTMLElement;
  private bounds: [number, number];

  constructor(el: HTMLElement, hallW: number, hallD: number) {
    this.el = el;
    this.bounds = [hallW / 2 - 0.5, hallD / 2 - 0.5];
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  private onDown = (e: PointerEvent) => {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };
  private onUp = () => {
    this.dragging = false;
  };
  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (this.mode === 'orbit') {
      this.yaw -= dx * 0.006;
      this.pitch = Math.min(1.45, Math.max(0.08, this.pitch + dy * 0.005));
    } else {
      this.walkYaw -= dx * 0.004;
      this.walkPitch = Math.min(0.6, Math.max(-0.8, this.walkPitch + dy * 0.003));
    }
  };
  private onKey = (e: KeyboardEvent) => {
    this.keys.add(e.key.toLowerCase());
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  /** 行走模式每帧推进，dt 秒 */
  update(dt: number): void {
    if (this.mode !== 'walk') return;
    const speed = (this.keys.has('shift') ? 4.2 : 1.8) * dt;
    let mx = 0, mz = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) mz += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) mz -= 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) mx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) mx += 1;
    const sin = Math.sin(this.walkYaw), cos = Math.cos(this.walkYaw);
    this.walkX += (cos * mx + sin * mz) * speed;
    this.walkZ += (-sin * mx + cos * mz) * speed;
    // 大厅为正象限 0~W / 0~D，留 0.5m 边距
    const [bx, bz] = this.bounds;
    this.walkX = Math.max(0.5, Math.min(bx * 2, this.walkX));
    this.walkZ = Math.max(0.5, Math.min(bz * 2, this.walkZ));
  }

  get position(): Vec3 {
    if (this.mode === 'walk') return [this.walkX, this.eyeHeight, this.walkZ];
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + this.distance * cp * Math.sin(this.yaw),
      this.target[1] + this.distance * Math.sin(this.pitch),
      this.target[2] + this.distance * cp * Math.cos(this.yaw),
    ];
  }

  get lookAt(): Vec3 {
    if (this.mode === 'walk') {
      const cp = Math.cos(this.walkPitch);
      return [
        this.walkX + Math.sin(this.walkYaw) * cp * 4,
        this.eyeHeight + Math.sin(this.walkPitch) * 4,
        this.walkZ + Math.cos(this.walkYaw) * cp * 4,
      ];
    }
    return this.target;
  }

  viewMatrix(): Mat4 {
    return mat4LookAt(this.position, this.lookAt, [0, 1, 0]);
  }

  reset(hallW: number, hallD: number): void {
    this.bounds = [hallW / 2 - 0.5, hallD / 2 - 0.5];
    this.target = [hallW / 2, 0.3, hallD / 2];
    // 目标相机高度 4.2m（吊顶 5.45 之下），由 distance 反推 pitch
    this.distance = Math.max(12, Math.max(hallW, hallD) * 0.45);
    this.pitch = Math.asin(Math.min(0.95, (4.2 - this.target[1]) / this.distance));
    // 行走起点放在大厅偏内侧，朝向大厅中心，避免开局贴墙
    this.walkX = hallW * 0.35;
    this.walkZ = hallD * 0.62;
    const dx = hallW / 2 - this.walkX;
    const dz = hallD / 2 - this.walkZ;
    // lookAt 前向 = (sin(yaw)·cos(pitch), sin(pitch), cos(yaw)·cos(pitch))
    this.walkYaw = Math.atan2(dx, dz);
    this.walkPitch = 0;
  }
}
