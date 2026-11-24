import type { AppSettings, GritStage, Project } from './types';
import { uid } from './id';

/**
 * 磨光工序默认表：50 目 → 3000 目 + 晶面。
 * 光泽度 GU 为常见无机/水泥基磨石现场参考值，可在设置页按实测表覆盖。
 * 粗糙度为喂给 PBR 的线性粗糙度（roughness²），与 GU 反向单调对应。
 */
export function defaultGritTable(): GritStage[] {
  return [
    { grit: 50, label: '50# 粗磨', roughness: 0.62, gloss60: 8, crystal: false },
    { grit: 150, label: '150# 细磨', roughness: 0.48, gloss60: 18, crystal: false },
    { grit: 300, label: '300# 中磨', roughness: 0.34, gloss60: 32, crystal: false },
    { grit: 500, label: '500# 精磨', roughness: 0.24, gloss60: 48, crystal: false },
    { grit: 1000, label: '1000# 抛光', roughness: 0.15, gloss60: 63, crystal: false },
    { grit: 2000, label: '2000# 精抛', roughness: 0.09, gloss60: 76, crystal: false },
    { grit: 3000, label: '3000# 镜面抛', roughness: 0.05, gloss60: 86, crystal: false },
    { grit: 3001, label: '晶面处理', roughness: 0.02, gloss60: 94, crystal: true },
  ];
}

export function defaultSettings(): AppSettings {
  return {
    gritTable: defaultGritTable(),
    probeFallback: true,
    ssrQuality: 'high',
    showValidation: true,
    probeVersion: 1,
  };
}

export function createSampleProject(): Project {
  const now = Date.now();
  return {
    id: uid('prj'),
    name: '示例·城南天街中庭',
    client: '示例商业管理公司',
    venue: '商场中庭',
    areaM2: 2600,
    createdAt: now,
    updatedAt: now,
    selectedGrit: 1000,
    mix: {
      id: uid('mix'),
      name: '浅灰底三骨料配比',
      cementColor: '#b9b6af',
      pastes: [
        { id: uid('pst'), name: '浅灰浆', color: '#c8c5bd', weightPct: 80 },
        { id: uid('pst'), name: '米白浆', color: '#ddd8cc', weightPct: 20 },
      ],
      aggregates: [
        {
          id: uid('agg'),
          name: '浅灰石子',
          kind: 'stone',
          color: '#8f8d87',
          densityKgM3: 2650,
          dosagePct: 38,
          grading: [
            { id: uid('fr'), minMm: 3, maxMm: 6, weightPct: 30 },
            { id: uid('fr'), minMm: 6, maxMm: 10, weightPct: 45 },
            { id: uid('fr'), minMm: 10, maxMm: 16, weightPct: 25 },
          ],
        },
        {
          id: uid('agg'),
          name: '白玻璃颗粒',
          kind: 'glass',
          color: '#eef3f4',
          densityKgM3: 2500,
          dosagePct: 8,
          grading: [
            { id: uid('fr'), minMm: 2, maxMm: 4, weightPct: 55 },
            { id: uid('fr'), minMm: 4, maxMm: 8, weightPct: 45 },
          ],
        },
        {
          id: uid('agg'),
          name: '珍珠白贝壳',
          kind: 'shell',
          color: '#f2ead9',
          densityKgM3: 1300,
          dosagePct: 4,
          grading: [
            { id: uid('fr'), minMm: 2, maxMm: 5, weightPct: 60 },
            { id: uid('fr'), minMm: 5, maxMm: 10, weightPct: 40 },
          ],
        },
      ],
      targetAreaFractionPct: 62,
      layerThicknessMm: 18,
      seed: 20261124,
    },
    layout: {
      id: uid('lay'),
      name: '8.4m 柱网标准排版',
      hallWidthM: 33.6,
      hallDepthM: 25.2,
      columnGridX: 8.4,
      columnGridZ: 8.4,
      lines: [],
    },
    scene: {
      lightOn: true,
      colorTempK: 4000,
      lightIntensity: 1.0,
      wetFilm: false,
      eyeHeightM: 1.6,
    },
  };
}
