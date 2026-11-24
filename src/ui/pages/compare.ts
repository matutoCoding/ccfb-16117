import { store } from '../../core/store';
import { clone } from '../../core/id';
import { h, toast } from '../dom';
import { PreviewSession } from '../../webgl/preview-session';
import type { Project } from '../../core/types';

type CompareMode = 'grit' | 'mix';

export function renderComparePage(root: HTMLElement): void {
  const base = store.current!;
  let mode: CompareMode = 'grit';
  let leftGrit = base.selectedGrit;
  let rightGrit = store.settings.gritTable.find((g) => g.grit !== leftGrit)?.grit ?? leftGrit;
  let walkLinked = true;

  const projectB: Project = clone(base);
  projectB.id = `${base.id}__compareB`;
  projectB.name = `${base.name}｜对比方案 B`;
  // 配比对比时给 B 一套微调默认（玻璃掺量翻倍、种子不同）
  projectB.mix.seed = base.mix.seed + 777;
  projectB.mix.aggregates.forEach((a) => { if (a.kind === 'glass') a.dosagePct = Math.min(30, a.dosagePct * 2); });

  const root2 = h('div', { class: 'compare-root' });
  root.append(root2);

  // 控制条
  const bar = h('div', {
    style: 'display:flex;gap:14px;align-items:center;padding:10px 14px;background:var(--panel);border-bottom:1px solid var(--line);flex-wrap:wrap',
  });
  const modeToggle = h('div', { class: 'mode-toggle', style: 'width:260px' },
    h('button', { class: 'active', text: '两种目数对比', onClick: (e: Event) => { mode = 'grit'; mark(e); applyConfig(); } }),
    h('button', { text: '两套配比对比', onClick: (e: Event) => { mode = 'mix'; mark(e); applyConfig(); } }),
  );
  const gritSelect = (side: 'L' | 'R') => h('select', {
    onChange: (e: Event) => {
      const v = Number((e.target as HTMLSelectElement).value);
      if (side === 'L') leftGrit = v; else rightGrit = v;
      applyConfig();
    },
  }, ...store.settings.gritTable.map((g) => h('option', {
    value: g.grit, text: g.label,
    selected: side === 'L' ? g.grit === leftGrit : g.grit === rightGrit,
  })));
  const leftSel = gritSelect('L');
  const rightSel = gritSelect('R');
  const walkSwitch = h('label', { class: 'switch' },
    h('input', { type: 'checkbox', checked: true, onChange: (e: Event) => { walkLinked = (e.target as HTMLInputElement).checked; } }),
    h('span', { text: '人眼行走视角联动' }));
  bar.append(
    modeToggle,
    h('span', { style: 'color:var(--muted)', text: '左屏' }), leftSel,
    h('span', { style: 'color:var(--muted)', text: '右屏' }), rightSel,
    walkSwitch,
    h('div', { style: 'flex:1' }),
    h('button', { class: 'btn secondary', text: '双屏截图', onClick: () => {
      const a = sessionL?.capture();
      const b = sessionR?.capture();
      if (a && b) {
        const ca = document.createElement('canvas');
        const ia = new Image(), ib = new Image();
        Promise.all([
          new Promise((r) => { ia.onload = r; ia.src = a; }),
          new Promise((r) => { ib.onload = r; ib.src = b; }),
        ]).then(() => {
          ca.width = ia.width + ib.width;
          ca.height = Math.max(ia.height, ib.height);
          const cx = ca.getContext('2d')!;
          cx.drawImage(ia, 0, 0);
          cx.drawImage(ib, ia.width, 0);
          ca.toBlob((blob) => {
            const url = URL.createObjectURL(blob!);
            const a2 = h('a', { href: url, download: `${base.name}-分屏对比.png` }) as HTMLAnchorElement;
            a2.click();
            URL.revokeObjectURL(url);
          });
        });
      }
    } }),
  );
  root2.append(bar);
  function mark(e: Event) {
    modeToggle.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    (e.target as HTMLElement).classList.add('active');
  }

  // 双视口
  const stage = h('div', { class: 'compare-canvases' });
  const leftBox = h('div', {});
  const rightBox = h('div', {});
  const canvasL = h('canvas') as HTMLCanvasElement;
  const canvasR = h('canvas') as HTMLCanvasElement;
  const labelL = h('div', { class: 'compare-label' });
  const labelR = h('div', { class: 'compare-label' });
  leftBox.append(canvasL, labelL);
  rightBox.append(canvasR, labelR);
  stage.append(leftBox, h('div', { class: 'divider-line-v' }), rightBox);
  root2.append(stage);

  let sessionL: PreviewSession | null = null;
  let sessionR: PreviewSession | null = null;
  try {
    sessionL = new PreviewSession(canvasL, base);
    sessionR = new PreviewSession(canvasR, projectB);
  } catch (err) {
    stage.append(h('div', { class: 'empty', text: `WebGL2 初始化失败：${(err as Error).message}` }));
    return;
  }

  const applyConfig = () => {
    if (!sessionL || !sessionR) return;
    if (mode === 'grit') {
      // 同配比、不同目数
      sessionL.roughnessOverride = store.settings.gritTable.find((g) => g.grit === leftGrit)?.roughness ?? 0;
      sessionR.roughnessOverride = store.settings.gritTable.find((g) => g.grit === rightGrit)?.roughness ?? 0;
      labelL.textContent = `左：${store.settings.gritTable.find((g) => g.grit === leftGrit)?.label}`;
      labelR.textContent = `右：${store.settings.gritTable.find((g) => g.grit === rightGrit)?.label}`;
    } else {
      // 同目数、不同配比（roughnessOverride 清空，跟随各自项目）
      sessionL.roughnessOverride = null;
      sessionR.roughnessOverride = null;
      base.selectedGrit = leftGrit;
      projectB.selectedGrit = leftGrit;
      labelL.textContent = '左：原配比 A';
      labelR.textContent = '右：配比 B（玻璃×2 / 换种子）';
    }
  };
  applyConfig();

  // 相机联动：每帧把左相机姿态拷给右相机（行走模式下尤为直观）
  const sync = () => {
    if (!sessionL || !sessionR || !document.body.contains(canvasL)) return;
    if (walkLinked) {
      const a = sessionL.camera, b = sessionR.camera;
      b.mode = a.mode;
      b.yaw = a.yaw; b.pitch = a.pitch; b.distance = a.distance;
      b.walkX = a.walkX; b.walkZ = a.walkZ; b.walkYaw = a.walkYaw; b.walkPitch = a.walkPitch;
      b.eyeHeight = a.eyeHeight;
    }
    requestAnimationFrame(sync);
  };
  requestAnimationFrame(sync);

  toast('提示：在左屏拖拽/行走，右屏自动跟随同一视角');
}
