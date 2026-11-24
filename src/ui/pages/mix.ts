import { store } from '../../core/store';
import { bakeAggregate, TILE_M } from '../../core/aggregate';
import { uid } from '../../core/id';
import type { AggregateComponent, AggregateKind, ColorPaste, GradingFraction } from '../../core/types';
import { h, fmt } from '../dom';

const KIND_LABEL: Record<AggregateKind, string> = { stone: '石子', glass: '玻璃', shell: '贝壳' };

export function renderMixPage(root: HTMLElement): void {
  const p = store.current!;
  const split = h('div', { class: 'split wide-left' });
  const left = h('div', { class: 'scroll' });
  const right = h('div', { class: 'scroll' });
  split.append(left, right);
  root.append(split);

  left.append(projectInfoCard(), pasteCard());
  for (const a of p.mix.aggregates) left.append(aggregateCard(a));
  left.append(addAggregateRow());

  const bake = bakeAggregate(p.mix);
  right.append(
    h('div', { class: 'card' },
      h('h3', { text: '骨料分布预览（2m × 2m 可重复瓷砖）' }),
      tileCanvas(bake.albedoCanvas),
      h('div', { class: 'legend' },
        h('span', {}, h('i', { style: 'background:#8f8d87' }), '石子'),
        h('span', {}, h('i', { style: 'background:#eef3f4' }), '玻璃'),
        h('span', {}, h('i', { style: 'background:#f2ead9' }), '贝壳'),
        h('span', {}, h('i', { style: 'background:#b9b6af' }), '浆体底色'),
      ),
      h('div', { class: 'stat-line' }, h('span', { text: '目标可见骨料面积率' }), h('b', { text: `${fmt(bake.targetAreaPct, 1)}%` })),
      h('div', { class: 'stat-line' }, h('span', { text: '烘焙实测面积率（像素统计）' }),
        h('b', {
          style: Math.abs(bake.measuredAreaPct - bake.targetAreaPct) >= 6 ? 'color:var(--warn)' : 'color:var(--ok)',
          text: `${fmt(bake.measuredAreaPct, 1)}%`,
        })),
      h('div', { class: 'stat-line' }, h('span', { text: '每平米颗粒总数（理论）' }), h('b', { text: fmt(bake.totalCountPerM2, 0) })),
      h('div', { class: 'stat-line' }, h('span', { text: '随机种子' }),
        h('span', { class: 'row' },
          h('input', {
            type: 'number', value: p.mix.seed,
            onChange: (e: Event) => {
              const v = Number((e.target as HTMLInputElement).value);
              store.updateCurrent((pr) => { pr.mix.seed = v; });
            },
          }),
          h('button', {
            class: 'icon-btn', text: '换种子',
            onClick: () => {
              store.updateCurrent((pr) => { pr.mix.seed = Math.floor(Math.random() * 1e9); });
            },
          }),
        )),
    ),
    h('div', { class: 'card' },
      h('h3', { text: '级配 × 掺量 落位核验' }),
      h('div', { class: 'tbl-wrap' },
        h('table', {},
          h('thead', {}, h('tr', {},
            h('th', { text: '骨料' }), h('th', { text: '粒级 mm' }),
            h('th', { class: 'num', text: '权重%' }), h('th', { class: 'num', text: '目标面积%' }),
            h('th', { class: 'num', text: '颗粒/㎡' }), h('th', { class: 'num', text: '落位/拒置' }),
          )),
          h('tbody', {},
            ...bake.stats.map((s) => h('tr', {},
              h('td', { text: `${s.componentName}（${KIND_LABEL[s.kind]}）` }),
              h('td', { text: `${s.minMm}~${s.maxMm}` }),
              h('td', { class: 'num', text: fmt(s.weightPct, 1) }),
              h('td', { class: 'num', text: fmt(s.targetAreaPct, 2) }),
              h('td', { class: 'num', text: fmt(s.countPerM2, 0) }),
              h('td', { class: 'num', text: `${s.placed} / ${s.rejected}` }),
            )),
          ),
        ),
      ),
      h('p', {
        style: 'color:var(--muted);font-size:12px;margin-bottom:0',
        text: `拒置率偏高说明该粒级在当前面积率下空间不足，可降低掺量或调小粒径；瓷砖边长 ${TILE_M}m，地面按此无缝平铺。`,
      }),
    ),
  );
}

function tileCanvas(source: HTMLCanvasElement): HTMLElement {
  const wrap = h('div', { style: 'border:1px solid var(--line);border-radius:6px;overflow:hidden' });
  const c = h('canvas', { width: 512, height: 512, style: 'width:100%;display:block' }) as HTMLCanvasElement;
  c.getContext('2d')!.drawImage(source, 0, 0, 512, 512);
  wrap.append(c);
  return wrap;
}

function numInput(value: number, onCommit: (v: number) => void): HTMLElement {
  return h('input', {
    type: 'number', value,
    onChange: (e: Event) => { onCommit(Number((e.target as HTMLInputElement).value)); },
  });
}
function textInput(value: string, onCommit: (v: string) => void): HTMLElement {
  return h('input', {
    type: 'text', value,
    onChange: (e: Event) => { onCommit((e.target as HTMLInputElement).value); },
  });
}

function projectInfoCard(): HTMLElement {
  const p = store.current!;
  return h('div', { class: 'card' },
    h('h3', { text: '项目与磨石层' }),
    h('label', { class: 'field' }, h('span', { text: '项目名称' }),
      textInput(p.name, (v) => store.updateCurrent((pr) => { pr.name = v; }))),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', { text: '甲方' }),
        textInput(p.client, (v) => store.updateCurrent((pr) => { pr.client = v; }))),
      h('label', { class: 'field' }, h('span', { text: '场所类型' }),
        textInput(p.venue, (v) => store.updateCurrent((pr) => { pr.venue = v; }))),
    ),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', { text: '面积 ㎡' }),
        numInput(p.areaM2, (v) => store.updateCurrent((pr) => { pr.areaM2 = v; }))),
      h('label', { class: 'field' }, h('span', { text: '磨石层厚度 mm' }),
        numInput(p.mix.layerThicknessMm, (v) => store.updateCurrent((pr) => { pr.mix.layerThicknessMm = v; }))),
    ),
    h('label', { class: 'field' }, h('span', { text: `目标可见骨料面积率：${p.mix.targetAreaFractionPct}%` }),
      h('input', {
        type: 'range', min: 20, max: 85, step: 1, value: p.mix.targetAreaFractionPct,
        onInput: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          store.updateCurrent((pr) => { pr.mix.targetAreaFractionPct = v; });
        },
      })),
  );
}

function pasteCard(): HTMLElement {
  const p = store.current!;
  const total = p.mix.pastes.reduce((s, x) => s + x.weightPct, 0);
  return h('div', { class: 'card' },
    h('h3', { text: '底色 / 色浆' }),
    h('div', { class: 'row' },
      h('span', { style: 'color:var(--muted);font-size:12px', text: '兜底底色' }),
      h('input', {
        type: 'color', value: p.mix.cementColor,
        onChange: (e: Event) => {
          const v = (e.target as HTMLInputElement).value;
          store.updateCurrent((pr) => { pr.mix.cementColor = v; });
        },
      }),
      h('span', {
        class: `pill ${Math.abs(total - 100) < 0.1 ? 'good' : 'warn'}`,
        text: `色浆权重合计 ${fmt(total, 1)}%`,
      }),
    ),
    h('div', { class: 'tbl-wrap', style: 'margin-top:10px' },
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: '色浆' }), h('th', { text: '颜色' }), h('th', { class: 'num', text: '权重%' }), h('th', { text: '' })),
        h('tbody', {},
          ...p.mix.pastes.map((ps: ColorPaste) => h('tr', {},
            h('td', textInput(ps.name, (v) => store.updateCurrent((pr) => {
              const t = pr.mix.pastes.find((x) => x.id === ps.id)!;
              t.name = v;
            }))),
            h('td', h('input', {
              type: 'color', value: ps.color,
              onChange: (e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                store.updateCurrent((pr) => { pr.mix.pastes.find((x) => x.id === ps.id)!.color = v; });
              },
            })),
            h('td', { class: 'num' }, numInput(ps.weightPct, (v) => store.updateCurrent((pr) => {
              pr.mix.pastes.find((x) => x.id === ps.id)!.weightPct = v;
            }))),
            h('td', h('button', {
              class: 'icon-btn', text: '删',
              onClick: () => {
                store.updateCurrent((pr) => { pr.mix.pastes = pr.mix.pastes.filter((x) => x.id !== ps.id); });
              },
            })),
          )),
        ),
      ),
    ),
    h('button', {
      class: 'btn secondary', style: 'margin-top:10px', text: '＋ 添加色浆',
      onClick: () => {
        store.updateCurrent((pr) => {
          pr.mix.pastes.push({ id: uid('pst'), name: '新色浆', color: '#c0bcb2', weightPct: 10 });
        });
      },
    }),
  ));
}

function aggregateCard(agg: AggregateComponent): HTMLElement {
  const weightSum = agg.grading.reduce((s, f) => s + f.weightPct, 0);
  const card = h('div', { class: 'card' });
  const header = h('div', { class: 'row' },
    textInput(agg.name, (v) => store.updateCurrent((pr) => {
      pr.mix.aggregates.find((x) => x.id === agg.id)!.name = v;
    })),
    h('select', {
      onChange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value as AggregateKind;
        store.updateCurrent((pr) => { pr.mix.aggregates.find((x) => x.id === agg.id)!.kind = v; });
      },
    },
      ...(['stone', 'glass', 'shell'] as AggregateKind[]).map((k) =>
        h('option', { value: k, text: KIND_LABEL[k], selected: k === agg.kind })),
    ),
    h('input', {
      type: 'color', value: agg.color,
      onChange: (e: Event) => {
        const v = (e.target as HTMLInputElement).value;
        store.updateCurrent((pr) => { pr.mix.aggregates.find((x) => x.id === agg.id)!.color = v; });
      },
    }),
    h('button', {
      class: 'btn danger', text: '删除',
      onClick: () => {
        store.updateCurrent((pr) => { pr.mix.aggregates = pr.mix.aggregates.filter((x) => x.id !== agg.id); });
      },
    }),
  );
  const params = h('div', { class: 'ag-grid', style: 'margin-top:10px' },
    h('label', { class: 'field' }, h('span', { text: '掺量（占干混料重量 %）' }),
      numInput(agg.dosagePct, (v) => store.updateCurrent((pr) => {
        pr.mix.aggregates.find((x) => x.id === agg.id)!.dosagePct = v;
      }))),
    h('label', { class: 'field' }, h('span', { text: '密度 kg/m³' }),
      numInput(agg.densityKgM3, (v) => store.updateCurrent((pr) => {
        pr.mix.aggregates.find((x) => x.id === agg.id)!.densityKgM3 = v;
      }))),
  );
  const gradingTable = h('table', { style: 'margin-top:8px' },
    h('thead', {}, h('tr', {},
      h('th', { text: '粒径下限 mm' }), h('th', { text: '上限 mm' }),
      h('th', { class: 'num', text: '粒级权重%' }), h('th', { text: '' })),
    h('tbody', {},
      ...agg.grading.map((f: GradingFraction) => h('tr', {},
        h('td', numInput(f.minMm, (v) => store.updateCurrent((pr) => {
          pr.mix.aggregates.find((x) => x.id === agg.id)!.grading.find((g) => g.id === f.id)!.minMm = v;
        }))),
        h('td', numInput(f.maxMm, (v) => store.updateCurrent((pr) => {
          pr.mix.aggregates.find((x) => x.id === agg.id)!.grading.find((g) => g.id === f.id)!.maxMm = v;
        }))),
        h('td', { class: 'num' }, numInput(f.weightPct, (v) => store.updateCurrent((pr) => {
          pr.mix.aggregates.find((x) => x.id === agg.id)!.grading.find((g) => g.id === f.id)!.weightPct = v;
        }))),
        h('td', h('button', {
          class: 'icon-btn', text: '删',
          onClick: () => {
            store.updateCurrent((pr) => {
              const t = pr.mix.aggregates.find((x) => x.id === agg.id)!;
              t.grading = t.grading.filter((g) => g.id !== f.id);
            });
          },
        })),
      )),
    ),
  ));
  const footer = h('div', { class: 'row', style: 'margin-top:8px' },
    h('span', {
      class: `pill ${Math.abs(weightSum - 100) < 0.1 ? 'good' : 'warn'}`,
      text: `粒级权重合计 ${fmt(weightSum, 1)}%`,
    }),
    h('button', {
      class: 'btn secondary', text: '＋ 添加粒级',
      onClick: () => {
        store.updateCurrent((pr) => {
          const t = pr.mix.aggregates.find((x) => x.id === agg.id)!;
          const last = t.grading[t.grading.length - 1];
          t.grading.push({ id: uid('fr'), minMm: last?.maxMm ?? 2, maxMm: (last?.maxMm ?? 2) + 4, weightPct: 10 });
        });
      },
    }),
  );
  card.append(header, params, gradingTable, footer);
  return card;
}

function addAggregateRow(): HTMLElement {
  return h('div', { class: 'card' },
    h('button', {
      class: 'btn', style: 'width:100%', text: '＋ 添加骨料（石子 / 玻璃 / 贝壳）',
      onClick: () => {
        store.updateCurrent((pr) => {
          if (pr.mix.aggregates.length >= 8) return;
          pr.mix.aggregates.push({
            id: uid('agg'), name: `新骨料 ${pr.mix.aggregates.length + 1}`,
            kind: 'stone', color: '#9a9892', densityKgM3: 2650, dosagePct: 10,
            grading: [
              { id: uid('fr'), minMm: 3, maxMm: 6, weightPct: 50 },
              { id: uid('fr'), minMm: 6, maxMm: 10, weightPct: 50 },
            ],
          });
        });
      },
    }),
  );
}
