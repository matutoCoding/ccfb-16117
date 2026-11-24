// 程序化商场中庭几何：地面 / 分格条 / 柱 / 吊顶灯带 / 店铺门头 / 扶梯 / 侧墙
import type { DividerLine, LayoutPlan } from '../core/types';
import { MatId } from '../core/types';
import { FLOATS_PER_VERTEX } from './gl-utils';

export interface MeshData {
  positions: number[];
  normals: number[];
  uvs: number[];
  matIds: number[];
  indices: number[];
}

export function emptyMesh(): MeshData {
  return { positions: [], normals: [], uvs: [], matIds: [], indices: [] };
}

function pushVertex(m: MeshData, x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, id: number): void {
  m.positions.push(x, y, z);
  m.normals.push(nx, ny, nz);
  m.uvs.push(u, v);
  m.matIds.push(id);
}

function box(m: MeshData, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, id: number): void {
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const y0 = cy - sy / 2, y1 = cy + sy / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  const face = (n: number[], verts: number[][]) => {
    const base = m.positions.length / 3;
    verts.forEach((p, i) => pushVertex(m, p[0], p[1], p[2], n[0], n[1], n[2], i & 1, i >> 1, id));
    m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  face([0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
  face([0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]);
  face([1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]);
  face([-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]);
  face([0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]);
  face([0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]);
}

/** 地面大平面：直接使用大厅正象限坐标 0~W / 0~D，与柱、分格条同坐标系 */
export function buildFloor(widthM: number, depthM: number): MeshData {
  const m = emptyMesh();
  const quad = [
    [0, 0, 0], [widthM, 0, 0], [widthM, 0, depthM], [0, 0, depthM],
  ];
  const n = [0, 1, 0];
  quad.forEach((p, i) => pushVertex(m, p[0], p[1], p[2], n[0], n[1], n[2], i & 1, i >> 1, MatId.Paste));
  m.indices.push(0, 1, 2, 0, 2, 3);
  return m;
}

function stripMatId(kind: DividerLine['kind']): number {
  return kind === 'copper' ? MatId.Copper : kind === 'aluminum' ? MatId.Aluminum : MatId.Stainless;
}

/** 分格条：沿折线扫掠矩形截面（宽 × 高），顶面微凸出地面 1.5mm */
export function buildDividers(lines: DividerLine[]): MeshData {
  const m = emptyMesh();
  for (const line of lines) {
    if (line.points.length < 2) continue;
    const halfW = line.widthMm / 1000 / 2;
    const h = 0.004; // 凸出 + 嵌固视觉高度
    const id = stripMatId(line.kind);
    for (let i = 0; i < line.points.length - 1; i++) {
      const a = line.points[i], b = line.points[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      const px = (-dz / len) * halfW, pz = (dx / len) * halfW;
      const base = m.positions.length / 3;
      const corners = [
        [a.x + px, 0, a.z + pz], [a.x - px, 0, a.z - pz],
        [b.x - px, 0, b.z - pz], [b.x + px, 0, b.z + pz],
        [a.x + px, h, a.z + pz], [a.x - px, h, a.z - pz],
        [b.x - px, h, b.z - pz], [b.x + px, h, b.z + pz],
      ];
      corners.forEach((p, k) => pushVertex(m, p[0], p[1], p[2], 0, k >= 4 ? 1 : 0, 0, 0, 0, id));
      // 顶面 + 两侧 + 端面
      m.indices.push(
        base + 4, base + 5, base + 6, base + 4, base + 6, base + 7,
        base + 0, base + 3, base + 2, base + 0, base + 2, base + 1,
        base + 1, base + 2, base + 6, base + 1, base + 6, base + 5,
        base + 0, base + 4, base + 7, base + 0, base + 7, base + 3,
      );
    }
  }
  return m;
}

export interface MallGeometry {
  floor: MeshData;
  dividers: MeshData;
  architecture: MeshData;
  emissive: MeshData;
  floorCenter: [number, number];
}

export function buildMall(layout: LayoutPlan): MallGeometry {
  const { hallWidthM: W, hallDepthM: D } = layout;
  const arch = emptyMesh();
  const emissive = emptyMesh();
  // 统一正象限坐标系：x∈[0,W]，z∈[0,D]，地面 y=0，吊顶 y≈5.4

  // 柱：柱网交点，0.7m 方柱，从地面到吊顶 5.2m
  for (let x = layout.columnGridX; x < W - 0.1; x += layout.columnGridX) {
    for (let z = layout.columnGridZ; z < D - 0.1; z += layout.columnGridZ) {
      box(arch, x, 2.6, z, 0.7, 5.2, 0.7, MatId.Architecture);
    }
  }

  // 吊顶板（深灰，弱化），厅中心上方
  box(arch, W / 2, 5.45, D / 2, W + 4, 0.12, D + 4, MatId.Architecture);

  // 灯带：沿柱网中线的长条自发光面，嵌入吊顶下方
  for (let x = layout.columnGridX / 2; x < W; x += layout.columnGridX) {
    box(emissive, x, 5.36, D / 2, 0.5, 0.04, D * 0.92, MatId.Emissive);
  }
  for (let z = layout.columnGridZ / 2; z < D; z += layout.columnGridZ) {
    box(emissive, W / 2, 5.35, z, W * 0.92, 0.04, 0.5, MatId.Emissive);
  }

  // 两侧店铺门头：背墙 + 店招自发光盒（x=0 与 x=W 两面）
  const shopsPerSide = Math.max(3, Math.floor(D / 5));
  for (const side of [0, W]) {
    const inward = side === 0 ? 1 : -1;
    box(arch, side, 2.4, D / 2, 0.2, 4.8, D + 2, MatId.Architecture);
    for (let i = 0; i < shopsPerSide; i++) {
      const z = (i + 0.5) * (D / shopsPerSide);
      const sx = side + inward * 0.1;
      box(arch, sx, 1.7, z, 0.08, 3.0, D / shopsPerSide - 0.6, MatId.Architecture);
      box(emissive, sx + inward * 0.02, 3.6, z, 0.1, 0.55, D / shopsPerSide - 1.0, MatId.Emissive);
    }
  }
  // 前后墙（z=0 与 z=D），封闭空间避免探针漏到无穷远
  box(arch, W / 2, 2.4, 0, W + 2, 4.8, 0.2, MatId.Architecture);
  box(arch, W / 2, 2.4, D, W + 2, 4.8, 0.2, MatId.Architecture);

  // 扶梯：靠 z=0 端头两台，斜梁 + 踏步块
  const escalator = (cx: number) => {
    const len = 9, rise = 4.2, z0 = 2;
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const z = z0 + t * len;
      const y = 0.25 + t * rise;
      box(arch, cx, y, z, 1.4, 0.12, 0.5, MatId.Architecture);
    }
    box(arch, cx - 0.78, (rise + 0.5) / 2, z0 + len / 2, 0.08, 0.9, len, MatId.Architecture);
    box(arch, cx + 0.78, (rise + 0.5) / 2, z0 + len / 2, 0.08, 0.9, len, MatId.Architecture);
  };
  escalator(W * 0.25);
  escalator(W * 0.75);

  return {
    floor: buildFloor(W, D),
    dividers: buildDividers(layout.lines),
    architecture: arch,
    emissive,
    floorCenter: [W / 2, D / 2],
  };
}

export function toFloatArrays(m: MeshData): { vertices: Float32Array; indices: Uint32Array } {
  const n = m.positions.length / 3;
  const vertices = new Float32Array(n * FLOATS_PER_VERTEX);
  for (let i = 0; i < n; i++) {
    vertices.set([
      m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2],
      m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2],
      m.uvs[i * 2], m.uvs[i * 2 + 1],
      m.matIds[i],
    ], i * FLOATS_PER_VERTEX);
  }
  return { vertices, indices: new Uint32Array(m.indices) };
}
