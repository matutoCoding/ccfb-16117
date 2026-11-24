// 分格排版：柱网生成、弧线分格、按条材料统计长度/用量
import { uid } from './id';
import type { DividerLine, LayoutPlan, PlanPoint, StripKind } from './types';

export const STRIP_NAME: Record<StripKind, string> = {
  copper: '铜条',
  aluminum: '铝条',
  stainless: '不锈钢条',
};

export const STRIP_DENSITY: Record<StripKind, number> = {
  copper: 8960,
  aluminum: 2700,
  stainless: 7930,
};

/** 折线长度（米），弧线已离散为多点 */
export function polylineLength(points: PlanPoint[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dz = points[i].z - points[i - 1].z;
    len += Math.hypot(dx, dz);
  }
  return len;
}

/** 按柱网生成正交分格（开间线 + 进深线） */
export function generateColumnGrid(layout: LayoutPlan, kind: StripKind, widthMm: number): DividerLine[] {
  const lines: DividerLine[] = [];
  const mk = (points: PlanPoint[], name: string, curved = false): DividerLine => ({
    id: uid('line'),
    name,
    kind,
    points,
    widthMm,
    heightMm: 3,
    curved,
  });
  const w = layout.hallWidthM, d = layout.hallDepthM;
  for (let x = 0; x <= w + 1e-6; x += layout.columnGridX) {
    lines.push(mk([{ x, z: 0 }, { x, z: d }], `进深分格 x=${x.toFixed(1)}`));
  }
  for (let z = 0; z <= d + 1e-6; z += layout.columnGridZ) {
    lines.push(mk([{ x: 0, z }, { x: w, z }], `开间分格 z=${z.toFixed(1)}`));
  }
  return lines;
}

/** 圆弧分格：圆心、半径、起止角（度），离散弦长 ≤0.25m */
export function generateArc(
  center: PlanPoint,
  radiusM: number,
  startDeg: number,
  endDeg: number,
  kind: StripKind,
  widthMm: number,
): DividerLine {
  const segLen = 0.25;
  const span = Math.abs(((endDeg - startDeg) * Math.PI) / 180);
  const n = Math.max(8, Math.ceil((radiusM * span) / segLen));
  const points: PlanPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((startDeg + ((endDeg - startDeg) * i) / n) * Math.PI) / 180;
    points.push({
      x: center.x + radiusM * Math.cos(a),
      z: center.z + radiusM * Math.sin(a),
    });
  }
  return {
    id: uid('line'),
    name: `圆弧分格 R${radiusM.toFixed(1)}m`,
    kind,
    points,
    widthMm,
    heightMm: 3,
    curved: true,
  };
}

export interface StripStatRow {
  kind: StripKind;
  kindName: string;
  widthMm: number;
  heightMm: number;
  /** 该规格总长度 m */
  totalLengthM: number;
  /** 含 8% 损耗的采购长度 m */
  purchaseLengthM: number;
  /** 单条 2.44m 折算根数 */
  bars: number;
  /** 理论重量 kg */
  weightKg: number;
  count: number;
}

/** 按材质×截面规格分组统计 */
export function stripStats(lines: DividerLine[]): StripStatRow[] {
  const groups = new Map<string, { line: DividerLine; len: number }[]>();
  for (const line of lines) {
    const key = `${line.kind}|${line.widthMm}|${line.heightMm}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ line, len: polylineLength(line.points) });
  }
  const rows: StripStatRow[] = [];
  for (const [, items] of groups) {
    const first = items[0].line;
    const total = items.reduce((s, it) => s + it.len, 0);
    const purchase = total * 1.08;
    const crossM2 = (first.widthMm / 1000) * (first.heightMm / 1000);
    rows.push({
      kind: first.kind,
      kindName: STRIP_NAME[first.kind],
      widthMm: first.widthMm,
      heightMm: first.heightMm,
      totalLengthM: total,
      purchaseLengthM: purchase,
      bars: Math.ceil(purchase / 2.44),
      weightKg: crossM2 * purchase * STRIP_DENSITY[first.kind],
      count: items.length,
    });
  }
  return rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.widthMm - b.widthMm);
}
