import { store } from '../../core/store';
import { h, fmt, toast } from '../dom';
import { go } from '../../main';
import { openProposal } from '../../core/proposal';

export function renderProjectsPage(root: HTMLElement): void {
  root.append(
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('h3', { text: `项目库（${store.projects.length}）`, style: 'margin:0;flex:1' }),
        h('button', {
          class: 'btn', text: '＋ 新建项目',
          onClick: async () => {
            await store.createProject();
            go('mix');
          },
        }),
      ),
    ),
    h('div', { class: 'project-grid' },
      ...store.projects.map((p) =>
        h('div', {
          class: 'project-card',
          onClick: () => {
            store.select(p.id);
            go('preview');
          },
        },
          h('h3', { text: p.name }),
          h('div', { class: 'meta', text: `甲方：${p.client || '—'}` }),
          h('div', { class: 'meta', text: `场所：${p.venue || '—'}　面积：${fmt(p.areaM2, 0)} ㎡` }),
          h('div', { class: 'meta', text: `更新：${new Date(p.updatedAt).toLocaleString('zh-CN')}` }),
          h('div', { class: 'actions' },
            h('button', {
              class: 'btn', text: '方案单',
              onClick: (e: Event) => {
                e.stopPropagation();
                const grit = store.settings.gritTable.find((g) => g.grit === p.selectedGrit);
                openProposal(p, grit?.label ?? String(p.selectedGrit), []);
              },
            }),
            h('button', {
              class: 'btn secondary', text: '复制',
              onClick: (e: Event) => {
                e.stopPropagation();
                void store.duplicateProject(p.id).then(() => toast('项目已复制'));
              },
            }),
            h('button', {
              class: 'btn danger', text: '删除',
              onClick: (e: Event) => {
                e.stopPropagation();
                if (confirm(`确认删除项目「${p.name}」？该操作不可恢复。`)) void store.deleteProject(p.id);
              },
            }),
          ),
        ),
      ),
    ),
  );
}
