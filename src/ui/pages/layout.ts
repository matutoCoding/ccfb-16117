import { store } from '../../core/store';
import { generateArc, generateColumnGrid, polylineLength, stripStats, STRIP_NAME, type StripStatRow } from '../../core/layout';
import { uid } from '../../core/id';
import type { DividerLine, PlanPoint, StripKind } from '../../core/types';
import { h, clear, fmt, toast } from '../dom';

type Tool = 'select' | 'straight' | 'arc' | 'delete';

export function renderLayoutPage(root: HTMLElement): void {
  const p = store.current!;
  let tool: Tool = 'select';
  let kind: StripKind = 'copper';
  let widthMm = 8;
  let draft: PlanPoint[] = [];

  const split = h('div', { class: 'split' });
  const left = h('div', { class: 'scroll' });
  const right = h('div', { style: 'position:relative;min-height:520px' });
  split.append(left, right);
  root.append(split);

  const canvas = h('canvas', { class: 'plan-canvas' }) as HTMLCanvasElement;
  right.append(canvas);
  const ctx = canvas.getContext('2d')!;

  const fitCanvas = () => {
    const r = right.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(320, r.width) * dpr;
    canvas.height = Math.max(480, r.height) * dpr;
    canvas.style.width = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  };

  const draw = () => {
    const lay = store.current!.layout;
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    const pad = 40;
    const scale = Math.min((w - pad * 2) / lay.hallWidthM, (hgt - pad * 2) / lay.hallDepthM);
    const ox = (w - lay.hallWidthM * scale) / 2;
    const oz = (hgt - lay.hallDepthM * scale) / 2;
    const toPx = (pt: PlanPoint): [number, number] => [ox + pt.x * scale, oz + pt.z * scale];
    ctx.clearRect(0, 0, w, hgt);
    ctx.fillStyle = '#20242c';
    ctx.fillRect(ox, oz, lay.hallWidthM * scale, lay.hallDepthM * scale);
    ctx.fillStyle = '#6e7684';
    for (let x = lay.columnGridX; x < lay.hallWidthM - 0.1; x += lay.columnGridX) {
      for (let z = lay.columnGridZ; z < lay.hallDepthM - 0.1; z += lay.columnGridZ) {
        const [px, pz] = toPx({ x, z });
        ctx.fillRect(px - 4, pz - 4, 8, 8);
      }
    }
    const colorOf = (k: StripKind) => (k === 'copper' ? '#d49a5a' : k === 'aluminum' ? '#b9c2cc' : '#e8e8ec');
    for (const line of lay.lines) {
      ctx.strokeStyle = colorOf(line.kind);
      ctx.lineWidth = Math.max(1.5, line.widthMm / 4);
      ctx.beginPath();
      line.points.forEach((pt, i) => {
        const [px, pz] = toPx(pt);
        if (i === 0) ctx.moveTo(px, pz); else ctx.lineTo(px, pz);
      });
      ctx.stroke();
    }
    if (draft.length > 0) {
      ctx.strokeStyle = '#6ea8d8';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      draft.forEach((pt, i) => {
        const [px, pz] = toPx(pt);
        if (i === 0) ctx.moveTo(px, pz); else ctx.lineTo(px, pz);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = '#9aa3b2';
    ctx.font = '11px sans-serif';
    ctx.fillText(`${fmt(lay.hallWidthM, 1)} m`, ox + (lay.hallWidthM * scale) / 2 - 14, oz - 14);
    ctx.save();
    ctx.translate(14, oz + (lay.hallDepthM * scale) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${fmt(lay.hallDepthM, 1)} m`, 0, 0);
    ctx.restore();
  };

  const eventPoint = (e: MouseEvent): PlanPoint => {
    const lay = store.current!.layout;
    const r = canvas.getBoundingClientRect();
    const pad = 40;
    const scale = Math.min((r.width - pad * 2) / lay.hallWidthM, (r.height - pad * 2) / lay.hallDepthM);
    const ox = (r.width - lay.hallWidthM * scale) / 2;
    const oz = (r.height - lay.hallDepthM * scale) / 2;
    return {
      x: Math.max(0, Math.min(lay.hallWidthM, (e.clientX - r.left - ox) / scale)),
      z: Math.max(0, Math.min(lay.hallDepthM, (e.clientY - r.top - oz) / scale)),
    };
  };

  canvas.addEventListener('click', (e) => {
    const pt = eventPoint(e);
    if (tool === 'straight') {
      draft.push(pt);
      if (draft.length === 2) {
        const line: DividerLine = {
          id: uid('line'),
          name: `直线分格 ${store.current!.layout.lines.length + 1}`,
          kind, points: draft, widthMm, heightMm: 3, curved: false,
        };
        store.updateCurrent((pr) => { pr.layout.lines.push(line); });
        draft = [];
      }
      draw();
    } else if (tool === 'arc') {
      draft.push(pt);
      if (draft.length === 3) {
        const [c, a, b] = draft;
        const radius = Math.hypot(a.x - c.x, a.z - c.z);
        const startDeg = (Math.atan2(a.z - c.z, a.x - c.x) * 180) / Math.PI;
        let endDeg = (Math.atan2(b.z - c.z, b.x - c.x) * 180) / Math.PI;
        if (endDeg <= startDeg) endDeg += 360;
        const arc = generateArc(c, radius, startDeg, endDeg, kind, widthMm);
        store.updateCurrent((pr) => { pr.layout.lines.push(arc); });
        draft = [];
        toast('弧线分格已添加（圆心→起点→终点）');
      }
      draw();
    } else if (tool === 'delete') {
      const lay = store.current!.layout;
      let hit: DividerLine | null = null;
      const r = canvas.getBoundingClientRect();
      const pad = 40;
      const scale = Math.min((r.width - pad * 2) / lay.hallWidthM, (r.height - pad * 2) / lay.hallDepthM);
      const ox = (r.width - lay.hallWidthM * scale) / 2;
      const oz = (r.height - lay.hallDepthM * scale) / 2;
      for (const line of lay.lines) {
        for (let i = 1; i < line.points.length; i++) {
          const a = line.points[i - 1];
          const b = line.points[i];
          const d = distToSegment(e.clientX - r.left, e.clientY - r.top,
            [ox + a.x * scale, oz + a.z * scale], [ox + b.x * scale, oz + b.z * scale]);
          if (d < 8) { hit = line; break; }
        }
        if (hit) break;
      }
      if (hit) {
        const hitId = hit.id;
        store.updateCurrent((pr) => { pr.layout.lines = pr.layout.lines.filter((l) => l.id !== hitId); });
        toast('已删除分格条');
      }
    }
  });
  canvas.addEventListener('dblclick', () => { draft = []; draw(); });

  const hallCard = h('div', { class: 'card' },
    h('h3', { text: '大厅与柱网' }),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', { text: '厅宽 m' }),
        h('input', {
          type: 'number', value: p.layout.hallWidthM,
          onChange: (e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            store.updateCurrent((pr) => { pr.layout.hallWidthM = v; });
          },
        })),
      h('label', { class: 'field' }, h('span', { text: '厅深 m' }),
        h('input', {
          type: 'number', value: p.layout.hallDepthM,
          onChange: (e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            store.updateCurrent((pr) => { pr.layout.hallDepthM = v; });
          },
        })),
    ),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', { text: '柱网 X m' }),
        h('input', {
          type: 'number', value: p.layout.columnGridX,
          onChange: (e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            store.updateCurrent((pr) => { pr.layout.columnGridX = v; });
          },
        })),
      h('label', { class: 'field' }, h('span', { text: '柱网 Z m' }),
        h('input', {
          type: 'number', value: p.layout.columnGridZ,
          onChange: (e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            store.updateCurrent((pr) => { pr.layout.columnGridZ = v; });
          },
        })),
    ),
    h('button', {
      class: 'btn', style: 'width:100%', text: '按柱网生成正交分格',
      onClick: () => {
        const lines = generateColumnGrid(store.current!.layout, kind, widthMm);
        store.updateCurrent((pr) => { pr.layout.lines.push(...lines); });
        toast(`已生成 ${lines.length} 条分格线`);
      },
    }),
  );

  const toolbarCard = h('div', { class: 'card' });
  const refreshToolState = () => {
    const tools: Tool[] = ['select', 'straight', 'arc', 'delete'];
    toolbarCard.querySelectorAll('.plan-toolbar button').forEach((b, i) => {
      b.className = `btn ${tools[i] === tool ? '' : 'secondary'}`;
    });
  };
  const toolBtn = (t: Tool, label: string) => h('button', {
    class: `btn ${tool === t ? '' : 'secondary'}`, text: label,
    onClick: () => { tool = t; draft = []; refreshToolState(); draw(); },
  });
  toolbarCard.append(
    h('h3', { text: '绘制工具' }),
    h('div', { class: 'plan-toolbar' },
      toolBtn('select', '选择/查看'), toolBtn('straight', '直线（两点）'),
      toolBtn('arc', '弧线（三点）'), toolBtn('delete', '删除分格'),
    ),
    h('label', { class: 'field' }, h('span', { text: '分格条材质' }),
      h('select', {
        onChange: (e: Event) => { kind = (e.target as HTMLSelectElement).value as StripKind; },
      },
        ...(['copper', 'aluminum', 'stainless'] as StripKind[]).map((k) =>
          h('option', { value: k, text: STRIP_NAME[k] })))),
    h('label', { class: 'field' }, h('span', { text: '条宽 mm' }),
      h('select', {
        onChange: (e: Event) => { widthMm = Number((e.target as HTMLSelectElement).value); },
      },
        ...[5, 8, 10, 12, 15, 20].map((wv) =>
          h('option', { value: wv, text: `${wv} mm`, selected: wv === widthMm })))),
    h('p', { style: 'color:var(--muted);font-size:12px', text: '直线：依次点击两个端点；弧线：依次点击圆心、起点、终点（逆时针）；双击取消草稿。' }),
    h('button', {
      class: 'btn danger', style: 'width:100%', text: '清空全部分格',
      onClick: () => {
        if (confirm('确认清空全部分格线？')) {
          store.updateCurrent((pr) => { pr.layout.lines = []; });
        }
      },
    }),
  );

  const statsCard = h('div', { class: 'card' });
  const renderStats = () => {
    const rows: StripStatRow[] = stripStats(store.current!.layout.lines);
    const totalLen = store.current!.layout.lines.reduce((s, l) => s + polylineLength(l.points), 0);
    clear(statsCard);
    statsCard.append(
      h('h3', { text: '分格材料表（按条统计）' }),
      h('div', { class: 'stat-line' }, h('span', { text: '分格线总数' }), h('b', { text: `${store.current!.layout.lines.length} 条` })),
      h('div', { class: 'stat-line' }, h('span', { text: '折线总长' }), h('b', { text: `${fmt(totalLen, 1)} m` })),
      rows.length === 0
        ? h('div', { class: 'empty', style: 'padding:20px', text: '暂无分格线' })
        : h('div', { class: 'tbl-wrap' }, h('table', {},
          h('thead', {}, h('tr', {},
            h('th', { text: '材质' }), h('th', { text: '截面 mm' }),
            h('th', { class: 'num', text: '条数' }), h('th', { class: 'num', text: '总长 m' }),
            h('th', { class: 'num', text: '采购 m(含8%)' }), h('th', { class: 'num', text: '2.44m/根' }),
            h('th', { class: 'num', text: '重量 kg' }))),
          h('tbody', {}, ...rows.map((r) => h('tr', {},
            h('td', { text: r.kindName }),
            h('td', { text: `${r.widthMm}×${r.heightMm}` }),
            h('td', { class: 'num', text: String(r.count) }),
            h('td', { class: 'num', text: fmt(r.totalLengthM, 1) }),
            h('td', { class: 'num', text: fmt(r.purchaseLengthM, 1) }),
            h('td', { class: 'num', text: String(r.bars) }),
            h('td', { class: 'num', text: fmt(r.weightKg, 1) })),
          ))),
    ));
  };
  renderStats();
  left.append(hallCard, toolbarCard, statsCard);

  // store 变更后重绘 + 刷新材料表；页面销毁后自动退订
  const unsubscribe = store.subscribe(() => {
    if (!document.body.contains(canvas)) { unsubscribe(); return; }
    draw();
    renderStats();
  });

  requestAnimationFrame(fitCanvas);
  window.addEventListener('resize', fitCanvas);
}

function distToSegment(px: number, py: number, a: number[], b: number[]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  let t = ((px - a[0]) * dx + (py - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}
