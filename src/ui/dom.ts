// 极简 DOM 构造 helper；第二个参数既可以是属性表，也可以直接传子节点（省略属性）
type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrsOrChild?: Attrs | Child,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const attrs: Attrs = !attrsOrChild || attrsOrChild instanceof Node || typeof attrsOrChild === 'string'
    ? {}
    : (attrsOrChild as Attrs);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false || v === null) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'value') {
      (el as HTMLInputElement).value = String(v);
    } else el.setAttribute(k, String(v));
  }
  const allChildren: Child[] = (attrsOrChild instanceof Node || typeof attrsOrChild === 'string')
    ? [attrsOrChild as Child, ...children]
    : children;
  for (const c of allChildren) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function toast(msg: string, ms = 2200): void {
  const t = h('div', { class: 'toast', text: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

export function fmt(n: number, digits = 1): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function download(filename: string, url: string): void {
  const a = h('a', { href: url, download: filename }) as HTMLAnchorElement;
  document.body.append(a);
  a.click();
  a.remove();
}
