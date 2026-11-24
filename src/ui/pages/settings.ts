import { store } from '../../core/store';
import { defaultGritTable } from '../../core/defaults';
import { h, toast } from '../dom';

export function renderSettingsPage(root: HTMLElement): void {
  const s = store.settings;
  root.append(
    h('div', { class: 'card' },
      h('h3', { text: '磨光工序与光泽度实测表' }),
      h('p', {
        style: 'color:var(--muted);font-size:12px;margin-top:0',
        text: '每档目数对应线性粗糙度与 60° 光泽度 GU；光泽度按现场实测值直接覆盖，空间预览与方案单同步生效。',
      }),
      h('div', { class: 'tbl-wrap' },
        h('table', {},
          h('thead', {}, h('tr', {},
            h('th', { text: '工序' }), h('th', { class: 'num', text: '目数' }),
            h('th', { class: 'num', text: '粗糙度(0~1)' }), h('th', { class: 'num', text: '60° 光泽度 GU' }),
            h('th', { text: '晶面' })),
          h('tbody', {},
            ...s.gritTable.map((g) => h('tr', {},
              h('td', h('input', {
                type: 'text', value: g.label,
                onChange: (e: Event) => {
                  const v = (e.target as HTMLInputElement).value;
                  store.updateSettings((st) => { st.gritTable.find((x) => x.grit === g.grit)!.label = v; });
                },
              })),
              h('td', { class: 'num' }, h('input', {
                type: 'number', value: g.grit,
                onChange: (e: Event) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  store.updateSettings((st) => { st.gritTable.find((x) => x.grit === g.grit)!.grit = v; });
                },
              })),
              h('td', { class: 'num' }, h('input', {
                type: 'number', value: g.roughness, step: 0.01, min: 0, max: 1,
                onChange: (e: Event) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  store.updateSettings((st) => { st.gritTable.find((x) => x.grit === g.grit)!.roughness = v; });
                },
              })),
              h('td', { class: 'num' }, h('input', {
                type: 'number', value: g.gloss60, step: 1, min: 0, max: 100,
                onChange: (e: Event) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  store.updateSettings((st) => { st.gritTable.find((x) => x.grit === g.grit)!.gloss60 = v; });
                },
              })),
              h('td', h('span', {
                class: `pill ${g.crystal ? 'good' : ''}`,
                text: g.crystal ? '是' : '否',
              })),
            )),
          ),
        ),
      ),
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', {
          class: 'btn secondary', text: '恢复默认工序表',
          onClick: () => {
            if (confirm('确认恢复默认粗糙度与光泽度？')) {
              store.updateSettings((st) => { st.gritTable = defaultGritTable(); });
            }
          },
        }),
        h('button', {
          class: 'btn secondary', text: '立即保存到 IndexedDB',
          onClick: () => { void store.flush().then(() => toast('已落库保存')); },
        }),
      ),
    ),
    h('div', { class: 'card' },
      h('h3', { text: '反射引擎' }),
      h('label', { class: 'switch' },
        h('input', {
          type: 'checkbox', checked: s.probeFallback,
          onChange: (e: Event) => {
            const v = (e.target as HTMLInputElement).checked;
            store.updateSettings((st) => { st.probeFallback = v; });
          },
        }),
        h('span', { text: '射线出屏/被遮挡时回退反射探针（边缘平滑过渡）' })),
      h('label', { class: 'field', style: 'margin-top:10px' }, h('span', { text: 'SSR 步进质量' }),
        h('select', {
          onChange: (e: Event) => {
            const v = (e.target as HTMLSelectElement).value as 'balanced' | 'high';
            store.updateSettings((st) => { st.ssrQuality = v; });
          },
        },
          h('option', { value: 'high', text: '高：48 步 Hi-Z 圆锥步进', selected: s.ssrQuality === 'high' }),
          h('option', { value: 'balanced', text: '均衡：28 步（低配机）', selected: s.ssrQuality === 'balanced' }))),
      h('div', { class: 'stat-line' }, h('span', { text: '反射探针版本' }), h('b', { text: String(s.probeVersion) })),
      h('button', {
        class: 'btn secondary', text: '重拍探针',
        onClick: () => { store.updateSettings((st) => { st.probeVersion++; }); },
      }),
    ),
    h('div', { class: 'card' },
      h('h3', { text: '验收指标说明' }),
      h('ul', { style: 'color:var(--muted);font-size:12.5px;padding-left:18px;margin:0' },
        h('li', { text: '粗糙度调至 0 时，空间预览自检模式将 SSR 与理想平面镜参考图逐像素比对。' }),
        h('li', { text: '屏幕内可追踪区域平均灰度差验收线：< 2 个 8bit 灰度级；当前阈值口径见自检 HUD。' }),
        h('li', { text: '时间累积采用速度自适应历史权重，镜头平移/转动时倒影不闪不爬。' }),
        h('li', { text: '1080p 下 DPR 上限 1.5，目标帧率 ≥ 50 FPS，HUD 低于阈值会变色提示。' }),
      ),
    ),
  ));
}
