import { store } from '../../core/store';
import { h, fmt, toast, download } from '../dom';
import { PreviewSession, type SessionHud } from '../../webgl/preview-session';
import { openProposal, type ProposalShot } from '../../core/proposal';

export function renderPreviewPage(root: HTMLElement): void {
  const p = store.current!;
  const wrap = h('div', { class: 'viewport-wrap' });
  const canvas = h('canvas') as HTMLCanvasElement;
  wrap.append(canvas);
  const side = h('div', { class: 'side-panel' });
  const flex = h('div', { style: 'display:flex;height:100%' }, wrap, side);
  root.append(flex);

  let session: PreviewSession;
  try {
    session = new PreviewSession(canvas, p);
  } catch (err) {
    wrap.append(h('div', { class: 'empty', text: `WebGL2 初始化失败：${(err as Error).message}` }));
    return;
  }

  const stageLabel = () => {
    const g = store.settings.gritTable.find((x) => x.grit === p.selectedGrit);
    return g ? g.label : String(p.selectedGrit);
  };
  const currentRoughness = () =>
    store.settings.gritTable.find((x) => x.grit === p.selectedGrit)?.roughness ?? 0;
  const currentGloss = () =>
    store.settings.gritTable.find((x) => x.grit === p.selectedGrit)?.gloss60 ?? 0;

  // ---- HUD ----
  const hud = h('div', { class: 'hud' });
  wrap.append(hud);
  const updateHud = (data: SessionHud) => {
    const fpsClass = data.fps >= 50 ? 'fps-ok' : 'fps-bad';
    const e = data.error;
    hud.replaceChildren(
      h('div', {}, '帧率 ', h('b', { class: fpsClass, text: `${data.fps} FPS` }), ' （目标 ≥50 @1080p）'),
      h('div', { style: 'margin-top:4px' }, '当前目数 ', h('b', { text: stageLabel() })),
      h('div', { style: 'margin-top:4px' }, '粗糙度 ', h('b', { text: fmt(currentRoughness(), 3) }),
        '　60°光泽 ', h('b', { text: `${currentGloss()} GU` })),
      ...(data.validation && e ? [
        h('div', { style: 'margin-top:6px;border-top:1px solid var(--line);padding-top:6px' },
          h('div', {}, '镜面自检（屏幕可追区域）'),
          h('div', {}, '平均灰度差 ',
            h('b', {
              class: e.meanGrayLevels < 2 ? 'err-ok' : 'err-bad',
              text: fmt(e.meanGrayLevels, 2),
            }),
            ' 级（验收 <2）'),
          h('div', {}, '最大灰度差 ', h('b', { text: fmt(e.maxGrayLevels, 1) }), ' 级'),
          h('div', {}, '覆盖样本 ', h('b', { text: `${fmt(e.coveragePct, 1)}%（${e.samples} 点）` })),
        ),
      ] : []),
    );
  };
  session.onHud = updateHud;

  // ---- 目数 ----
  const gritCard = h('div', { class: 'card' },
    h('h3', { text: '磨光工序 / 目数' }),
    h('div', { class: 'grit-chips' },
      ...store.settings.gritTable.map((g) => h('button', {
        class: g.grit === p.selectedGrit ? 'active' : '',
        text: g.crystal ? '晶面' : `${g.grit}#`,
        title: `${g.label}｜光泽 ${g.gloss60}GU｜粗糙度 ${g.roughness}`,
        onClick: () => {
          store.updateCurrent((pr) => { pr.selectedGrit = g.grit; });
        },
      }))),
    h('div', { class: 'stat-line', style: 'margin-top:10px' },
      h('span', { text: '60° 光泽度 GU' }), h('b', { text: String(currentGloss()) })),
    h('div', { class: 'stat-line' },
      h('span', { text: '着色器线性粗糙度' }), h('b', { text: fmt(currentRoughness(), 3) })),
  );

  // ---- 相机 ----
  const camCard = h('div', { class: 'card' },
    h('h3', { text: '相机' }),
    h('div', { class: 'mode-toggle' },
      h('button', {
        class: 'active', text: '环绕鸟瞰',
        onClick: (e: Event) => {
          session.camera.mode = 'orbit';
          markMode(e);
        },
      }),
      h('button', {
        text: '人眼行走',
        onClick: (e: Event) => {
          session.camera.mode = 'walk';
          session.camera.eyeHeight = p.scene.eyeHeightM;
          markMode(e);
        },
      }),
    ),
    h('p', {
      style: 'color:var(--muted);font-size:12px;margin:8px 0 0',
      text: '行走模式：W/A/S/D 或方向键移动，Shift 加速，鼠标拖拽转向。',
    }),
    h('label', { class: 'field', style: 'margin-top:10px' },
      h('span', { text: `人眼高度 ${fmt(p.scene.eyeHeightM, 2)} m` }),
      h('input', {
        type: 'range', min: 1.4, max: 1.85, step: 0.01, value: p.scene.eyeHeightM,
        onInput: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          store.updateCurrent((pr) => { pr.scene.eyeHeightM = v; });
          session.camera.eyeHeight = v;
        },
      })),
  );
  function markMode(e: Event) {
    camCard.querySelectorAll('.mode-toggle button').forEach((b) => b.classList.remove('active'));
    (e.target as HTMLElement).classList.add('active');
  }

  // ---- 灯光 / 水膜 ----
  const lightCard = h('div', { class: 'card' },
    h('h3', { text: '灯光与地面状态' }),
    h('label', { class: 'switch' },
      h('input', {
        type: 'checkbox', checked: p.scene.lightOn,
        onChange: (e: Event) => {
          const v = (e.target as HTMLInputElement).checked;
          store.updateCurrent((pr) => { pr.scene.lightOn = v; });
        },
      }),
      h('span', { text: '吊顶灯带 / 店招电源' })),
    h('label', { class: 'field', style: 'margin-top:10px' },
      h('span', { text: `色温 ${p.scene.colorTempK} K` }),
      h('input', {
        type: 'range', min: 2700, max: 6500, step: 100, value: p.scene.colorTempK,
        onInput: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          store.updateCurrent((pr) => { pr.scene.colorTempK = v; });
        },
      })),
    h('label', { class: 'field' },
      h('span', { text: `照度倍率 ${fmt(p.scene.lightIntensity, 2)}×` }),
      h('input', {
        type: 'range', min: 0.3, max: 2, step: 0.05, value: p.scene.lightIntensity,
        onInput: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          store.updateCurrent((pr) => { pr.scene.lightIntensity = v; });
        },
      })),
    h('label', { class: 'switch', style: 'margin-top:6px' },
      h('input', {
        type: 'checkbox', checked: p.scene.wetFilm,
        onChange: (e: Event) => {
          const v = (e.target as HTMLInputElement).checked;
          store.updateCurrent((pr) => { pr.scene.wetFilm = v; });
        },
      }),
      h('span', { text: '湿拖后水膜状态' })),
  );

  // ---- 反射管线 ----
  const renderCard = h('div', { class: 'card' },
    h('h3', { text: '反射管线' }),
    h('label', { class: 'switch' },
      h('input', {
        type: 'checkbox', checked: store.settings.probeFallback,
        onChange: (e: Event) => {
          const v = (e.target as HTMLInputElement).checked;
          store.updateSettings((s) => { s.probeFallback = v; });
        },
      }),
      h('span', { text: '探针回退（出屏/遮挡处）' })),
    h('label', { class: 'field', style: 'margin-top:10px' }, h('span', { text: 'SSR 质量' }),
      h('select', {
        onChange: (e: Event) => {
          const v = (e.target as HTMLSelectElement).value as 'balanced' | 'high';
          store.updateSettings((s) => { s.ssrQuality = v; });
        },
      },
        h('option', { value: 'high', text: '高（48 步 / Hi-Z 步进）', selected: store.settings.ssrQuality === 'high' }),
        h('option', { value: 'balanced', text: '均衡（28 步）', selected: store.settings.ssrQuality === 'balanced' }))),
    h('button', {
      class: 'btn secondary', style: 'width:100%;margin-top:8px', text: '手动重拍反射探针',
      onClick: () => {
        store.updateSettings((s) => { s.probeVersion++; });
      },
    }),
    h('label', { class: 'switch', style: 'margin-top:10px' },
      h('input', {
        type: 'checkbox', checked: session.validation,
        onChange: (e: Event) => {
          session.validation = (e.target as HTMLInputElement).checked;
          toast(session.validation
            ? '已进入自检：画面为 8× 灰度差热力图，看左上角指标'
            : '已退出自检模式');
        },
      }),
      h('span', { text: '镜面误差自检模式（粗糙度归零对比）' })),
    h('button', {
      class: 'btn', style: 'width:100%;margin-top:10px', text: '保存当前视角截图',
      onClick: () => {
        const url = session.capture();
        download(`${p.name}-${stageLabel()}-${Date.now()}.png`, url);
        toast('截图已导出 PNG');
      },
    }),
    h('button', {
      class: 'btn secondary', style: 'width:100%;margin-top:8px', text: '出方案单（含当前视角截图）',
      onClick: () => {
        const shots: ProposalShot[] = [{ title: `空间预览｜${stageLabel()}`, dataUrl: session.capture() }];
        openProposal(store.current!, stageLabel(), shots);
      },
    }),
  );

  side.append(gritCard, camCard, lightCard, renderCard);

  // store 变更后同步目数高亮，页面销毁自动退订
  const unsubscribe = store.subscribe(() => {
    if (!document.body.contains(canvas)) { unsubscribe(); return; }
    gritCard.querySelectorAll('.grit-chips button').forEach((b, i) => {
      b.className = store.settings.gritTable[i].grit === store.current!.selectedGrit ? 'active' : '';
    });
  });
}
