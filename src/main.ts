import './ui/styles.css';
import { store } from './core/store';
import { h, clear, toast } from './ui/dom';
import { renderProjectsPage } from './ui/pages/projects';
import { renderMixPage } from './ui/pages/mix';
import { renderLayoutPage } from './ui/pages/layout';
import { renderPreviewPage } from './ui/pages/preview';
import { renderComparePage } from './ui/pages/compare';
import { renderSettingsPage } from './ui/pages/settings';

export type Route = 'projects' | 'mix' | 'layout' | 'preview' | 'compare' | 'settings';

const NAV: { id: Route; label: string }[] = [
  { id: 'projects', label: '项目列表' },
  { id: 'mix', label: '配比设计' },
  { id: 'layout', label: '分格排版' },
  { id: 'preview', label: '空间预览' },
  { id: 'compare', label: '光泽对比' },
  { id: 'settings', label: '设置' },
];

let route: Route = 'projects';

function topbar(): HTMLElement {
  const select = h('select', {
    class: 'project-select',
    onChange: (e: Event) => store.select((e.target as HTMLSelectElement).value),
  },
    ...store.projects.map((p) => h('option', { value: p.id, text: p.name, selected: p.id === store.currentId })),
  );
  return h('div', { class: 'topbar' },
    h('div', { class: 'brand', text: '磨石地坪工作室' },
      h('small', { text: '配比 · 分格 · 反射预览' })),
    select,
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'icon-btn', text: '新建项目',
      onClick: async () => {
        await store.createProject();
        go('mix');
      },
    }),
  );
}

function nav(): HTMLElement {
  return h('nav', { class: 'nav' },
    ...NAV.map((n) => h('button', {
      class: n.id === route ? 'active' : '',
      text: n.label,
      onClick: () => go(n.id),
    })),
  );
}

export function go(r: Route): void {
  route = r;
  render();
}

async function render(): Promise<void> {
  const app = document.getElementById('app')!;
  clear(app);
  app.append(topbar(), nav());
  const page = h('div', { class: route === 'preview' || route === 'compare' ? 'page nopad' : 'page' });
  app.append(page);
  if (!store.current && route !== 'projects') {
    page.append(h('div', { class: 'empty', text: '请先在项目列表中创建或选择一个项目' }));
    return;
  }
  try {
    switch (route) {
      case 'projects': renderProjectsPage(page); break;
      case 'mix': renderMixPage(page); break;
      case 'layout': renderLayoutPage(page); break;
      case 'preview': renderPreviewPage(page); break;
      case 'compare': renderComparePage(page); break;
      case 'settings': renderSettingsPage(page); break;
    }
  } catch (err) {
    console.error(err);
    page.append(h('div', { class: 'empty', text: `页面渲染失败：${(err as Error).message}` }));
    toast('出错了，详见控制台');
  }
}

// store 变化时重渲染当前页（渲染循环内部状态由各页面自管）
store.subscribe(() => {
  if (route !== 'preview' && route !== 'compare') void render();
});

void store.init().then(() => {
  void render();
});
