// 方案单导出：配比表、级配表、分格材料表、视角截图，组装为可打印 HTML
import { bakeAggregate } from './aggregate';
import { stripStats, STRIP_NAME } from './layout';
import type { Project } from './types';
import { fmt } from '../ui/dom';

export interface ProposalShot {
  title: string;
  dataUrl: string;
}

export function buildProposalHtml(p: Project, gritLabel: string, shots: ProposalShot[]): string {
  const bake = bakeAggregate(p.mix);
  const rows = stripStats(p.layout.lines);
  const totalAgg = p.mix.aggregates.reduce((s, a) => s + a.dosagePct, 0);

  const aggRows = p.mix.aggregates.map((a) => {
    const grading = a.grading.map((f) => `${f.minMm}~${f.maxMm}mm × ${fmt(f.weightPct, 1)}%`).join('；');
    return `<tr>
      <td>${a.name}</td><td>${a.kind === 'stone' ? '石子' : a.kind === 'glass' ? '玻璃' : '贝壳'}</td>
      <td class="num">${fmt(a.dosagePct, 1)}</td><td class="num">${a.densityKgM3}</td>
      <td>${grading}</td>
    </tr>`;
  }).join('');

  const statRows = rows.map((r) => `<tr>
    <td>${r.kindName}</td><td>${r.widthMm}×${r.heightMm}</td>
    <td class="num">${r.count}</td><td class="num">${fmt(r.totalLengthM, 1)}</td>
    <td class="num">${fmt(r.purchaseLengthM, 1)}</td><td class="num">${r.bars}</td>
    <td class="num">${fmt(r.weightKg, 1)}</td>
  </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:#888">暂无分格</td></tr>';

  const gritRows = bake.stats.map((s) => `<tr>
    <td>${s.componentName}</td><td>${s.minMm}~${s.maxMm}</td>
    <td class="num">${fmt(s.weightPct, 1)}</td><td class="num">${fmt(s.targetAreaPct, 2)}</td>
    <td class="num">${fmt(s.countPerM2, 0)}</td><td class="num">${s.placed} / ${s.rejected}</td>
  </tr>`).join('');

  const shotsHtml = shots.map((s) => `
    <figure style="margin:0 0 18px;break-inside:avoid">
      <img src="${s.dataUrl}" style="width:100%;border:1px solid #ccc;border-radius:6px" />
      <figcaption style="font-size:12px;color:#666;margin-top:6px">${s.title}</figcaption>
    </figure>`).join('');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${p.name}｜磨石地坪方案单</title>
<style>
  body{font-family:"Microsoft YaHei",sans-serif;color:#222;max-width:960px;margin:24px auto;padding:0 20px;font-size:13px}
  h1{font-size:22px;margin-bottom:4px} h2{font-size:16px;border-left:4px solid #c8a35c;padding-left:8px;margin-top:28px}
  table{width:100%;border-collapse:collapse;margin-top:8px} th,td{border:1px solid #bbb;padding:6px 8px;text-align:left}
  th{background:#f4f1ea} .num{text-align:right;font-variant-numeric:tabular-nums}
  .meta{color:#666;font-size:12px} .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .tile{width:100%;max-width:380px;border:1px solid #ccc;border-radius:6px}
  @media print{button{display:none} body{margin:0}}
</style></head><body>
<button onclick="window.print()" style="padding:10px 22px;background:#c8a35c;border:none;border-radius:6px;cursor:pointer;font-weight:700">打印 / 另存 PDF</button>
<h1>${p.name} — 磨石地坪方案单</h1>
<p class="meta">甲方：${p.client || '—'}　场所：${p.venue || '—'}　面积：${fmt(p.areaM2, 0)} ㎡　磨光档位：${gritLabel}　生成时间：${new Date().toLocaleString('zh-CN')}</p>

<h2>一、配比设计</h2>
<p>磨石层厚度 ${p.mix.layerThicknessMm} mm；目标可见骨料面积率 ${fmt(p.mix.targetAreaFractionPct, 1)}%；
骨料总掺量 ${fmt(totalAgg, 1)}%（占干混料重量）；随机种子 ${p.mix.seed}。</p>
<table><thead><tr><th>骨料</th><th>类型</th><th>掺量 wt%</th><th>密度 kg/m³</th><th>粒径级配（mm × 权重）</th></tr></thead>
<tbody>${aggRows}</tbody></table>
<div class="grid2" style="margin-top:14px">
  <div><b>骨料分布瓷砖（2m×2m 可重复平铺）</b><br/><img class="tile" src="${bake.albedoCanvas.toDataURL('image/png')}"/></div>
  <div>
    <b>级配落位核验</b>
    <table><thead><tr><th>骨料</th><th>粒级 mm</th><th>权重%</th><th>目标面积%</th><th>颗粒/㎡</th><th>落位/拒置</th></tr></thead>
    <tbody>${gritRows}</tbody></table>
    <p class="meta">烘焙实测骨料面积率 ${fmt(bake.measuredAreaPct, 1)}%，每平米颗粒总数 ${fmt(bake.totalCountPerM2, 0)}。</p>
  </div>
</div>

<h2>二、分格材料表（按条统计，含 8% 损耗）</h2>
<table><thead><tr><th>材质</th><th>截面 mm</th><th>条数</th><th>总长 m</th><th>采购长度 m</th><th>2.44m 折算根</th><th>理论重量 kg</th></tr></thead>
<tbody>${statRows}</tbody></table>
<p class="meta">材质密度：铜 ${STRIP_NAME.copper} 8960、铝 2700、不锈钢 7930 kg/m³；采购长度 = 设计总长 × 1.08。</p>

<h2>三、空间反射视角截图</h2>
${shotsHtml || '<p class="meta">未附截图，可在光泽对比页或空间预览页采集。</p>'}
</body></html>`;
}

/** 在新窗口打开方案单 */
export function openProposal(p: Project, gritLabel: string, shots: ProposalShot[]): void {
  const html = buildProposalHtml(p, gritLabel, shots);
  const w = window.open('', '_blank');
  if (!w) {
    alert('浏览器拦截了弹窗，请允许弹出窗口');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
