// 轻量 4x4 列主序矩阵 / 向量数学（WebGL 风格，Float32Array 长度 16）

export type Mat4 = Float32Array;
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Perspective(fovyRad: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovyRad / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function mat4LookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let l = Math.hypot(zx, zy, zz) || 1;
  zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1;
  xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

/** 反射用：沿 y=h 平面镜像一个相机的世界矩阵（平移 x/z 不变，y 翻转，朝向翻转） */
export function mirrorViewAcrossY(eye: Vec3, center: Vec3, up: Vec3, h: number): Mat4 {
  const me: Vec3 = [eye[0], 2 * h - eye[1], eye[2]];
  const mc: Vec3 = [center[0], 2 * h - center[1], center[2]];
  const mu: Vec3 = [-up[0], -up[1], -up[2]];
  return mat4LookAt(me, mc, mu);
}

export function mat4Invert(a: Mat4): Mat4 {
  const out = new Float32Array(16);
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return mat4Identity();
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

/** 透视投影的视锥体 6 平面（世界空间，法线朝外），供 SSR 屏幕边界判断 */
export function frustumPlanes(viewProj: Mat4): { n: Vec3; d: number }[] {
  const inv = mat4Invert(viewProj);
  // 8 个 NDC 角点
  const corners: Vec3[] = [];
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1]) {
        const cx = inv[0] * x + inv[4] * y + inv[8] * z + inv[12];
        const cy = inv[1] * x + inv[5] * y + inv[9] * z + inv[13];
        const cz = inv[2] * x + inv[6] * y + inv[10] * z + inv[14];
        const cw = inv[3] * x + inv[7] * y + inv[11] * z + inv[15];
        corners.push([cx / cw, cy / cw, cz / cw]);
      }
  // 角点索引：000,100,010,110,001,101,011,111（x,y,z 循环顺序）
  const idx = (x: number, y: number, z: number) => x * 4 + y * 2 + z;
  const planes: { n: Vec3; d: number }[] = [];
  const face = (a: number, b: number, c: number) => {
    const pa = corners[a], pb = corners[b], pc = corners[c];
    const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2];
    const vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    // 法线朝外：取背离视锥中心的方向
    const cx = (corners[0][0] + corners[7][0]) / 2;
    const cy = (corners[0][1] + corners[7][1]) / 2;
    const cz = (corners[0][2] + corners[7][2]) / 2;
    if (nx * (pa[0] - cx) + ny * (pa[1] - cy) + nz * (pa[2] - cz) < 0) {
      nx = -nx; ny = -ny; nz = -nz;
    }
    planes.push({ n: [nx, ny, nz], d: -(nx * pa[0] + ny * pa[1] + nz * pa[2]) });
  };
  // near z=0,1 三角；far z=1；left x=0；right x=1；bottom y=0；top y=1
  face(idx(0, 0, 0), idx(0, 1, 0), idx(1, 0, 0));
  face(idx(1, 1, 1), idx(1, 0, 1), idx(0, 1, 1));
  face(idx(0, 0, 0), idx(1, 0, 0), idx(0, 0, 1));
  face(idx(1, 1, 0), idx(0, 1, 0), idx(1, 1, 1));
  face(idx(0, 0, 0), idx(0, 0, 1), idx(0, 1, 0));
  face(idx(1, 1, 0), idx(1, 1, 1), idx(1, 0, 0));
  return planes;
}

export function clamp(x: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, x));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 色温 K → 线性 RGB（Tanner Helland 近似），用于灯光开关/色温 */
export function colorTempToRgb(kelvin: number): [number, number, number] {
  const t = kelvin / 100;
  let r: number, g: number, b: number;
  r = t <= 66 ? 1 : clamp(1.292936 * Math.pow(t - 60, -0.1332047), 0, 1);
  g = t <= 66 ? clamp(0.3900816 * Math.log(t) - 0.6318414, 0, 1)
    : clamp(1.129891 * Math.pow(t - 60, -0.0755148), 0, 1);
  b = t >= 66 ? 1 : t <= 19 ? 0 : clamp(0.5432068 * Math.log(t - 10) - 1.196254, 0, 1);
  return [r, g, b];
}
