// 全局数据模型：项目 / 配比 / 分格 / 工序 / 场景

export type AggregateKind = 'stone' | 'glass' | 'shell';
export type StripKind = 'copper' | 'aluminum' | 'stainless';
export type SsrQuality = 'balanced' | 'high';

export interface GradingFraction {
  id: string;
  /** 粒径下限 mm（筛孔） */
  minMm: number;
  /** 粒径上限 mm */
  maxMm: number;
  /** 该粒级在本骨料内部的重量分配权重，% ，同组件内合计 100 */
  weightPct: number;
}

export interface AggregateComponent {
  id: string;
  name: string;
  kind: AggregateKind;
  /** 骨料主色 hex */
  color: string;
  /** 密度 kg/m³，用于由重量掺量换算体积占比 */
  densityKgM3: number;
  /** 掺量：占全部干混料重量的 % */
  dosagePct: number;
  grading: GradingFraction[];
}

export interface ColorPaste {
  id: string;
  name: string;
  color: string;
  /** 占色浆部分的重量 % ，合计 100 */
  weightPct: number;
}

export interface MixDesign {
  id: string;
  name: string;
  /** 底色（色浆混合后兜底颜色，也用于无色浆时） */
  cementColor: string;
  pastes: ColorPaste[];
  aggregates: AggregateComponent[];
  /** 目标可见骨料面积率 % */
  targetAreaFractionPct: number;
  /** 磨石层厚度 mm */
  layerThicknessMm: number;
  /** 随机种子，换种子重排骨料 */
  seed: number;
}

export interface GritStage {
  /** 磨片目数 */
  grit: number;
  label: string;
  /** 线性粗糙度 0~1，喂给着色器 */
  roughness: number;
  /** 60° 光泽度 GU（现场实测可改） */
  gloss60: number;
  /** 是否晶面处理档 */
  crystal: boolean;
}

export interface PlanPoint {
  x: number;
  z: number;
}

export interface DividerLine {
  id: string;
  name: string;
  kind: StripKind;
  /** 平面折线顶点（米）；直线 2 点，弧线离散为多点 */
  points: PlanPoint[];
  /** 条宽 mm */
  widthMm: number;
  /** 条高（厚度）mm */
  heightMm: number;
  curved: boolean;
}

export interface LayoutPlan {
  id: string;
  name: string;
  hallWidthM: number;
  hallDepthM: number;
  columnGridX: number;
  columnGridZ: number;
  lines: DividerLine[];
}

export interface SceneSettings {
  lightOn: boolean;
  /** 色温 K，2700~6500 */
  colorTempK: number;
  /** 灯带照度倍率 */
  lightIntensity: number;
  /** 湿拖水膜 */
  wetFilm: boolean;
  /** 人眼高度 m（行走相机） */
  eyeHeightM: number;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  venue: string;
  areaM2: number;
  createdAt: number;
  updatedAt: number;
  mix: MixDesign;
  layout: LayoutPlan;
  /** 当前选用的目数档（grit 值） */
  selectedGrit: number;
  scene: SceneSettings;
}

export interface AppSettings {
  gritTable: GritStage[];
  probeFallback: boolean;
  ssrQuality: SsrQuality;
  showValidation: boolean;
  /** 反射探针刷新令牌（自增触发重拍） */
  probeVersion: number;
}

/** 材质 ID：写进 G-Buffer，SSR/光照按材质分算 */
export const MatId = {
  Paste: 0,
  Stone: 1,
  Glass: 2,
  Shell: 3,
  Copper: 4,
  Aluminum: 5,
  Stainless: 6,
  Architecture: 7,
  Emissive: 8,
} as const;
