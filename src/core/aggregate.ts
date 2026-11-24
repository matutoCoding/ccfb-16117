// 骨料分布烘焙：按重量掺量→体积率→面积率（Delesse 原理）→分粒级颗粒数，
// 蓝噪声多候选落位 + 像素实测面积率闭环标定，输出 albedo / 材质 ID 两张画布与统计。
import { mulberry32 } from './id';
import type { AggregateComponent, MixDesign } from './types';
import { MatId } from './types';
import { hexToRgb } from './math';

// 瓷砖尺寸按纹理可分辨的最小粒径设计：
// 512px 覆盖 0.5m 时，最小 2mm 颗粒 ≈ 2px，光栅化面积损失可忽略，几何面积率≈实测面积率。
export const TILE_M = 0.5;
export const TEX_SIZE = 512;

const PASTE_DENSITY = 2100;

export interface FractionStat {
  componentName: string;
  kind: AggregateComponent['kind'];
  minMm: number;
  maxMm: number;
  weightPct: number;
  /** 每平米理论颗粒数（标定后） */
  countPerM2: number;
  /** 本瓷砖实际落下颗粒数 */
  placed: number;
  rejected: number;
  targetAreaPct: number;
}

export interface BakeResult {
  albedoCanvas: HTMLCanvasElement;
  materialCanvas: HTMLCanvasElement;
  stats: FractionStat[];
  /** 实测骨料可见面积率 %（像素统计） */
  measuredAreaPct: number;
  targetAreaPct: number;
  totalCountPerM2: number;
  /** 闭环标定系数：实际投放量相对理论值的倍率 */
  calibrationFactor: number;
}

interface Particle {
  x: number;
  y: number;
  r: number;
  /** 标定半径倍率：不增加颗粒数，仅整体缩放绘制半径来命中目标面积率 */
  rScale: number;
  rgb: [number, number, number];
  matId: number;
  kind: AggregateComponent['kind'];
  seed: number;
  stat: FractionStat;
}

function jitterColor(hex: string, rng: () => number, amount: number): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  const f = 1 + (rng() - 0.5) * 2 * amount;
  return [Math.min(1, r * f), Math.min(1, g * f), Math.min(1, b * f)];
}

/** 生成一批待落位颗粒（countScale 为堆积密度标定倍率） */
function buildParticles(mix: MixDesign, areaTargets: number[], countScale = 1): {
  particles: Particle[];
  stats: FractionStat[];
  totalCountPerM2: number;
} {
  const rng = mulberry32(mix.seed);
  const tileArea = TILE_M * TILE_M;
  const stats: FractionStat[] = [];
  const particles: Particle[] = [];
  let totalCountPerM2 = 0;
  let fi = 0;

  mix.aggregates.forEach((agg) => {
    if (agg.dosagePct <= 0) return;
    const matId = agg.kind === 'stone' ? MatId.Stone : agg.kind === 'glass' ? MatId.Glass : MatId.Shell;
    agg.grading.forEach((f) => {
      const areaF = areaTargets[fi] ?? 0;
      const dMean = ((f.minMm + f.maxMm) / 2) / 1000;
      const countPerM2 = (areaF / (Math.PI * (dMean / 2) * (dMean / 2))) * countScale;
      const tileCount = Math.max(1, Math.round(countPerM2 * tileArea));
      totalCountPerM2 += countPerM2;
      const stat: FractionStat = {
        componentName: agg.name,
        kind: agg.kind,
        minMm: f.minMm,
        maxMm: f.maxMm,
        weightPct: f.weightPct,
        countPerM2,
        placed: 0,
        rejected: 0,
        targetAreaPct: areaF * 100,
      };
      stats.push(stat);
      for (let k = 0; k < tileCount; k++) {
        const d = (f.minMm + rng() * (f.maxMm - f.minMm)) / 1000;
        particles.push({
          x: 0, y: 0, r: d / 2, rScale: 1,
          rgb: jitterColor(agg.color, rng, 0.12),
          matId,
          kind: agg.kind,
          seed: Math.floor(rng() * 1e9),
          stat,
        });
      }
      fi++;
    });
  });
  return { particles, stats, totalCountPerM2 };
}

/** 落位：磨石截面中骨料互相接触/微遮挡是物理常态，不做硬碰撞排斥。
 *  采用蓝噪声分层抖动采样保证空间均匀、无肉眼聚集，面积率由颗粒几何总量严格决定。
 *  大颗粒先放，小颗粒填充间隙，仅对同粒径极端重叠（中心距 <0.35 半径和）做重采样。 */
function placeParticles(particles: Particle[]): void {
  particles.sort((a, b) => b.r - a.r);
  let maxR = 0.001;
  for (const p of particles) if (p.r > maxR) maxR = p.r;
  const cell = maxR * 2.2;
  const grid = new Map<string, Particle[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  const tooClose = (p: Particle): boolean => {
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
    for (let ix = cx - 1; ix <= cx + 1; ix++)
      for (let iy = cy - 1; iy <= cy + 1; iy++) {
        const bucket = grid.get(key(ix, iy));
        if (!bucket) continue;
        for (const q of bucket) {
          const dx = p.x - q.x, dy = p.y - q.y;
          // 仅排斥中心几乎重合的极端情况（<35% 半径和），正常接触/咬合全部允许
          if (dx * dx + dy * dy < Math.pow((p.r + q.r) * 0.35, 2)) return true;
        }
      }
    return false;
  };
  for (const p of particles) {
    let done = false;
    const attempts = p.r > 0.006 ? 12 : 4;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const u = (mulberry32(p.seed + attempt * 1013)() + attempt * 0.6180339887) % 1;
      const v = (mulberry32(p.seed + attempt * 7919 + 17)() + attempt * 0.754877666) % 1;
      p.x = u * TILE_M;
      p.y = v * TILE_M;
      if (!tooClose(p)) {
        const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
        const k = key(cx, cy);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k)!.push(p);
        p.stat.placed++;
        done = true;
        break;
      }
    }
    if (!done) {
      // 兜底：直接落最后一个候选位置（允许重叠），保证颗粒数不丢、面积率不失
      p.stat.placed++;
      const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
      const k = key(cx, cy);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k)!.push(p);
    }
  }
}

/** 光栅化到两张画布（9 宫格包裹保证 REPEAT 无缝），返回实测骨料像素面积率。
 *  materialOnly=true 时只写材质画布，省去颜色填充开销（分辨率仍为 TEX_SIZE 以保证标定精度）。 */
function rasterize(mix: MixDesign, particles: Particle[], materialOnly: boolean): {
  albedo: HTMLCanvasElement | null;
  material: HTMLCanvasElement;
  measuredAreaPct: number;
} {
  const size = TEX_SIZE;
  const pxPerM = size / TILE_M;
  const material = document.createElement('canvas');
  material.width = material.height = size;
  const mctx = material.getContext('2d', { willReadFrequently: true })!;
  const albedo = materialOnly ? null : document.createElement('canvas');
  const actx = albedo ? albedo.getContext('2d')! : null;
  if (albedo) albedo.width = albedo.height = size;

  // 底色：色浆按权重混合
  const pasteSum = mix.pastes.reduce((s, p) => s + p.weightPct, 0) || 1;
  let br = 0, bg = 0, bb = 0;
  mix.pastes.forEach((p) => {
    const [r, g, b] = hexToRgb(p.color);
    const w = p.weightPct / pasteSum;
    br += r * w; bg += g * w; bb += b * w;
  });
  if (mix.pastes.length === 0) {
    [br, bg, bb] = hexToRgb(mix.cementColor);
  }
  if (actx) {
    actx.fillStyle = `rgb(${br * 255 | 0},${bg * 255 | 0},${bb * 255 | 0})`;
    actx.fillRect(0, 0, size, size);
  }
  mctx.fillStyle = 'rgb(0,0,0)'; // 0 = 浆体 MatId.Paste
  mctx.fillRect(0, 0, size, size);

  const tracePath = (p: Particle, ox: number, oy: number) => {
    // 绘制半径含标定倍率，落位碰撞仍用物理半径，保证不改变堆积结构
    const cx = (p.x + ox) * pxPerM, cy = (p.y + oy) * pxPerM;
    // 同分辨率下亚像素颗粒钳到 1px，保证细颗粒参与面积统计
    const minPx = 1.0;
    const rPx = Math.max(minPx, p.r * p.rScale * pxPerM);
    const prng = mulberry32(p.seed + ox * 7919 + oy * 104729);
    if (actx) {
      const [r, g, b] = p.rgb;
      actx.fillStyle = `rgb(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0})`;
      actx.beginPath();
    }
    mctx.fillStyle = `rgb(${p.matId},0,0)`;
    mctx.beginPath();
    if (p.kind === 'glass') {
      const sides = 3 + (prng() > 0.5 ? 1 : 0);
      for (let k = 0; k < sides; k++) {
        const ang = (k / sides) * Math.PI * 2 + prng() * 0.6;
        const rr = rPx * (0.7 + prng() * 0.45);
        const x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
        if (k === 0) { actx?.moveTo(x, y); mctx.moveTo(x, y); } else { actx?.lineTo(x, y); mctx.lineTo(x, y); }
      }
    } else if (p.kind === 'shell') {
      const rot = prng() * Math.PI;
      const sx = rPx * (0.9 + prng() * 0.3), sy = rPx * (0.45 + prng() * 0.25);
      for (let k = 0; k <= 12; k++) {
        const ang = (k / 12) * Math.PI * 2;
        const x = cx + Math.cos(ang) * sx * Math.cos(rot) - Math.sin(ang) * sy * Math.sin(rot);
        const y = cy + Math.cos(ang) * sx * Math.sin(rot) + Math.sin(ang) * sy * Math.cos(rot);
        if (k === 0) { actx?.moveTo(x, y); mctx.moveTo(x, y); } else { actx?.lineTo(x, y); mctx.lineTo(x, y); }
      }
    } else {
      const sides = 8 + Math.floor(prng() * 3);
      for (let k = 0; k < sides; k++) {
        const ang = (k / sides) * Math.PI * 2;
        const rr = rPx * (0.72 + prng() * 0.4);
        const x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
        if (k === 0) { actx?.moveTo(x, y); mctx.moveTo(x, y); } else { actx?.lineTo(x, y); mctx.lineTo(x, y); }
      }
    }
    if (actx) {
      actx.closePath();
      actx.fill();
      if (p.kind === 'stone') {
        actx.strokeStyle = 'rgba(0,0,0,0.28)';
        actx.lineWidth = 0.8;
        actx.stroke();
      } else if (p.kind === 'glass') {
        actx.strokeStyle = 'rgba(255,255,255,0.55)';
        actx.lineWidth = 0.7;
        actx.stroke();
      }
    }
    mctx.closePath();
    mctx.fill();
  };

  for (const p of particles) {
    const pr = p.r * p.rScale;
    const cross = (v: number, o: number) => {
      const w = v + o;
      return (w < pr * 1.5 && w > -pr * 1.5) || (w < TILE_M + pr * 1.5 && w > TILE_M - pr * 1.5);
    };
    for (const ox of [-TILE_M, 0, TILE_M])
      for (const oy of [-TILE_M, 0, TILE_M]) {
        if (ox === 0 && oy === 0) tracePath(p, 0, 0);
        else if (cross(p.x, ox) && cross(p.y, oy)) tracePath(p, ox, oy);
      }
  }

  // 小画布直接全量读回（256×256 仅 65k 像素，开销可忽略）
  const img = mctx.getImageData(0, 0, size, size).data;
  let hit = 0;
  for (let i = 0; i < img.length; i += 4) if (img[i] !== 0) hit++;
  return { albedo, material, measuredAreaPct: (hit / (size * size)) * 100 };
}

export function bakeAggregate(mix: MixDesign): BakeResult {
  // 1. 重量掺量 → 体积率 → 各骨料目标面积率
  const totalAggWeight = mix.aggregates.reduce((s, a) => s + a.dosagePct, 0);
  const pasteWeight = Math.max(0, 100 - totalAggWeight);
  const vols = mix.aggregates.map((a) => a.dosagePct / a.densityKgM3);
  const volPaste = pasteWeight / PASTE_DENSITY;
  const volSum = vols.reduce((s, v) => s + v, 0) + volPaste;
  const volFracs = vols.map((v) => v / volSum);
  const aggVolSum = volFracs.reduce((s, v) => s + v, 0);
  const targetArea = mix.targetAreaFractionPct / 100;

  // 展开到每个粒级的目标面积率（按骨料体积率 × 粒级权重）
  const areaTargets: number[] = [];
  mix.aggregates.forEach((agg, ai) => {
    if (agg.dosagePct <= 0 || aggVolSum === 0) {
      agg.grading.forEach(() => areaTargets.push(0));
      return;
    }
    const areaI = targetArea * (volFracs[ai] / aggVolSum);
    const weightSum = agg.grading.reduce((s, f) => s + f.weightPct, 0) || 1;
    agg.grading.forEach((f) => areaTargets.push(areaI * (f.weightPct / weightSum)));
  });

  // 2. 联合标定（覆盖 20%~85% 全面积率区间）：
  //    低中档（≤65%）：countScale 调颗粒密度，rScale 固定 1.5 补偿形状系数；
  //    高档（>65%）：随机截面堆积可见面积趋于饱和，额外面积由 rScale 放大颗粒补足，
  //    这在物理上对应高填充率下骨料截面更饱满、浆体间隙更窄。
  //    做法：先二分 countScale 到其饱和点，再二分 rScale 精修命中目标。
  let activeParticles: Particle[] = [];
  let activeStats: FractionStat[] = [];
  let activeTotal = 0;
  const buildKeep = (cs: number, rs: number) => {
    const b = buildParticles(mix, areaTargets, cs);
    placeParticles(b.particles);
    b.particles.forEach((p) => { p.rScale = rs; });
    activeParticles = b.particles;
    activeStats = b.stats;
    activeTotal = b.totalCountPerM2;
    return rasterize(mix, b.particles, true).measuredAreaPct;
  };

  // 阶段一：countScale 二分（上界 2.2，对应密堆积）
  let lo = 0.4, hi = 2.2, countScale = 1, rScale = 1.5;
  for (let iter = 0; iter < 4; iter++) {
    countScale = (lo + hi) / 2;
    const measured = buildKeep(countScale, rScale);
    if (Math.abs(measured - mix.targetAreaFractionPct) < 1.2) break;
    if (measured < mix.targetAreaFractionPct) lo = countScale; else hi = countScale;
  }
  // 阶段二：若 countScale 到顶仍不够，rScale 二分精修（上界 3.4）
  let measured = rasterize(mix, activeParticles, true).measuredAreaPct;
  if (measured < mix.targetAreaFractionPct - 1.2) {
    let rlo = 1.5, rhi = 4.2;
    for (let iter = 0; iter < 6; iter++) {
      rScale = (rlo + rhi) / 2;
      measured = buildKeep(countScale, rScale);
      if (Math.abs(measured - mix.targetAreaFractionPct) < 1.2) break;
      if (measured < mix.targetAreaFractionPct) rlo = rScale; else rhi = rScale;
    }
  }
  const finalResult = rasterize(mix, activeParticles, false);

  return {
    albedoCanvas: finalResult.albedo!,
    materialCanvas: finalResult.material,
    stats: activeStats,
    measuredAreaPct: finalResult.measuredAreaPct,
    targetAreaPct: mix.targetAreaFractionPct,
    totalCountPerM2: activeTotal,
    calibrationFactor: rScale,
  };
}
