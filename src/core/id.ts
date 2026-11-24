let counter = 0;

/** 短随机 id，带前缀便于辨认 */
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1_000_000;
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 0xffffff).toString(36);
  return `${prefix}_${t}${r}${counter.toString(36)}`;
}

/** 可种子化的确定性随机数（mulberry32），骨料分布要可复现 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 深度克隆（数据都是纯 JSON） */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
