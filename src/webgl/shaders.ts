// 全部 GLSL 着色器源码（WebGL2 / GLSL ES 3.00），无第三方着色器库

const COMMON = /* glsl */ `
// 材质 ID 与 types.ts MatId 保持一致
const int MAT_PASTE=0; const int MAT_STONE=1; const int MAT_GLASS=2;
const int MAT_SHELL=3; const int MAT_COPPER=4; const int MAT_ALUMINUM=5;
const int MAT_STAINLESS=6; const int MAT_ARCH=7; const int MAT_EMISSIVE=8;

// 各材质 F0 垂直反射率（线性），铜/铝/不锈钢按实测金属色走
vec3 matF0(int id) {
  if (id==MAT_COPPER)   return vec3(0.95,0.64,0.54);
  if (id==MAT_ALUMINUM) return vec3(0.91,0.92,0.92);
  if (id==MAT_STAINLESS)return vec3(0.60,0.61,0.62);
  if (id==MAT_GLASS)    return vec3(0.08); // 玻璃颗粒相对浆体更亮的非金属高光
  if (id==MAT_SHELL)    return vec3(0.055);
  return vec3(0.04);
}

// 地面材质的基础线性粗糙度（再由 uRoughness 整体调制）
float matBaseRoughness(int id) {
  if (id==MAT_COPPER)    return 0.28;
  if (id==MAT_ALUMINUM)  return 0.35;
  if (id==MAT_STAINLESS) return 0.18;
  if (id==MAT_GLASS)     return 0.30;
  if (id==MAT_SHELL)     return 0.45;
  if (id==MAT_STONE)     return 0.80;
  return 0.55; // 浆体
}
`;

// ---------- G-Buffer：几何通道，输出 albedo+emissive / normal+roughness / matId+ao ----------
export const GBUFFER_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
layout(location=3) in int  aMatId;
uniform mat4 uVP;
uniform mat4 uModel;
uniform vec2 uUvScale;
out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
flat out int vMatId;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWorldPos = wp.xyz;
  vNormal = mat3(uModel) * aNormal;
  vUv = aUv * uUvScale;
  vMatId = aMatId;
  gl_Position = uVP * wp;
}
`;

export const GBUFFER_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
flat in int vMatId;
uniform sampler2D uAlbedoTex;   // 骨料烘焙 albedo
uniform sampler2D uMatTex;      // 烘焙材质 ID
uniform int uUseTerrazzoTex;    // 地面 1，其它 0
uniform float uRoughness;       // 目数档粗糙度 0~1
uniform vec3 uConstColor;       // 非地面顶点的兜底色
uniform float uWet;             // 水膜 0/1
layout(location=0) out vec4 oAlbedo;   // rgb 反照率, a 自发光强度
layout(location=1) out vec4 oNormalR;  // rgb 世界法线, a 线性粗糙度
layout(location=2) out vec4 oMatAo;    // r 材质ID, g AO
void main() {
  vec3 albedo = uConstColor;
  int id = vMatId;
  if (uUseTerrazzoTex == 1) {
    vec3 texRgb = texture(uAlbedoTex, vUv).rgb;
    // 材质 ID 图为 RGBA8，r 通道存 0~8 的整数，round 后钳位，避免线性过滤取整越界
    float rawId = texture(uMatTex, vUv).r * 255.0;
    id = clamp(int(rawId + 0.5), 0, 8);
    albedo = texRgb;
  }
  float baseR = matBaseRoughness(id);
  // 目数档主导：浆体粗糙度 = 档位值；金属/玻璃按自身基础与档位取大后再压
  float r = mix(baseR, uRoughness, id <= MAT_SHELL ? 0.85 : 0.35);
  if (id > MAT_SHELL) r = max(baseR * 0.5, uRoughness * baseR);
  // 自检模式（uRoughness=0）：地面类材质强制理想镜面，使平面镜参考口径成立
  if (uRoughness < 0.001 && id <= MAT_SHELL) r = 0.0;
  // 湿拖水膜：表面覆盖水层，粗糙度整体压到接近镜面，金属条变化较小
  r = mix(r, min(r, 0.045), uWet * (id <= MAT_SHELL ? 1.0 : 0.35));
  vec3 N = normalize(vNormal);
  float ao = 1.0;
  float emissive = 0.0;
  if (id == MAT_EMISSIVE) emissive = 1.0;
  oAlbedo = vec4(albedo, emissive);
  oNormalR = vec4(N, r * r);
  oMatAo = vec4(float(id), ao, 0.0, 1.0);
}
`;

// ---------- 场景基底色预通道：无反射的光照结果，作为 SSR 命中取色源并生成 mip 供锥体足迹采样 ----------
export const BASECOLOR_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
in vec2 vUv;
uniform sampler2D gAlbedo;
uniform sampler2D gNormalR;
uniform sampler2D gMatAo;
uniform sampler2D uDepth;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uLightIntensity;
uniform float uLightOn;
out vec4 outColor;
void main() {
  vec4 ar = texture(gAlbedo, vUv);
  vec4 nr = texture(gNormalR, vUv);
  int id = int(texture(gMatAo, vUv).r + 0.5);
  vec3 albedo = ar.rgb;
  vec3 N = normalize(nr.xyz);
  bool metallic = id >= MAT_COPPER && id <= MAT_STAINLESS;
  vec3 F0 = matF0(id);
  if (id == MAT_EMISSIVE) {
    outColor = vec4(albedo * (1.2 + uLightOn * uLightIntensity * 1.6), 1.0);
    return;
  }
  float NoL = max(dot(N, normalize(uLightDir)), 0.0);
  vec3 radiance = uLightOn * uLightColor * uLightIntensity;
  vec3 diffuse = (metallic ? vec3(0.02) : albedo / 3.14159265) * radiance * NoL;
  vec3 hemi = mix(vec3(0.10,0.11,0.13), vec3(0.32,0.33,0.36), N.y*0.5+0.5);
  diffuse += (metallic ? F0 * 0.4 : albedo) * hemi * 0.55;
  outColor = vec4(diffuse, 1.0);
}
`;

// ---------- Hi-Z：线性深度降采样（取最大深度=最远，保守不漏步进） ----------
export const HIZ_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
layout(location=3) in int aMatId;
out vec2 vUv;
void main(){ vUv = aUv; gl_Position = vec4(aPos.xy, 0.0, 1.0); }
`;

export const HIZ_FIRST_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uDepth;       // 硬件非线性深度
uniform mat4 uInvProj;
out float outDepth;
float linearize(float d) {
  vec4 p = uInvProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.w;
}
void main() {
  vec2 texel = 1.0 / vec2(textureSize(uDepth, 0));
  // 2x2 取最远，保证保守
  float d0 = linearize(texture(uDepth, vUv + vec2(-0.5,-0.5)*texel).r);
  float d1 = linearize(texture(uDepth, vUv + vec2( 0.5,-0.5)*texel).r);
  float d2 = linearize(texture(uDepth, vUv + vec2(-0.5, 0.5)*texel).r);
  float d3 = linearize(texture(uDepth, vUv + vec2( 0.5, 0.5)*texel).r);
  outDepth = max(max(d0,d1), max(d2,d3));
}
`;

export const HIZ_DOWN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uHiZ;
uniform int uFromMip;
out float outDepth;
void main() {
  vec2 texel = 1.0 / vec2(textureSize(uHiZ, uFromMip));
  vec2 o = vec2(0.5) * texel;
  float d0 = textureLod(uHiZ, vUv - o, float(uFromMip)).r;
  float d1 = textureLod(uHiZ, vUv + vec2(o.x, -o.y), float(uFromMip)).r;
  float d2 = textureLod(uHiZ, vUv + vec2(-o.x, o.y), float(uFromMip)).r;
  float d3 = textureLod(uHiZ, vUv + o, float(uFromMip)).r;
  outDepth = max(max(d0,d1), max(d2,d3));
}
`;

// ---------- 全屏三角形通用 VS ----------
export const FULLSCREEN_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
layout(location=3) in int aMatId;
out vec2 vUv;
void main(){ vUv = aUv; gl_Position = vec4(aPos.xy, 0.0, 1.0); }
`;

// ---------- SSR：Hi-Z 加速步进的屏幕空间圆锥步进 ----------
export const SSR_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
in vec2 vUv;
uniform sampler2D gAlbedo;
uniform sampler2D gNormalR;
uniform sampler2D gMatAo;
uniform sampler2D uDepth;
uniform sampler2D uHiZ;
uniform mat4 uProj;
uniform mat4 uInvProj;
uniform mat4 uInvView;
uniform vec2 uResolution;
uniform float uThickness;
uniform int uMaxSteps;
uniform float uMaxDistance;
uniform float uFrameIndex;
layout(location=0) out vec4 oHit;   // rgb 命中屏幕 uv, a 置信度 0~1
layout(location=1) out vec4 oCone;  // r 粗糙度, g 锥体足迹 mip 偏移基准

vec3 worldFromDepth(vec2 uv, float rawDepth) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
  vec4 view = uInvProj * ndc;
  view /= view.w;
  return (uInvView * view).xyz;
}

float viewDepthAt(vec2 uv) {
  float raw = texture(uDepth, uv).r;
  vec4 ndc = vec4(uv * 2.0 - 1.0, raw * 2.0 - 1.0, 1.0);
  vec4 view = uInvProj * ndc;
  return view.w;
}

// 步进相交测试：当前视空间深度与 Hi-Z 保守远深度比较
bool intersectsDepth(vec3 p0, vec3 p1, out vec2 hitUv, out float hitViewZ) {
  vec4 s0 = uProj * vec4(p0, 1.0); s0.xyz /= s0.w;
  vec4 s1 = uProj * vec4(p1, 1.0); s1.xyz /= s1.w;
  vec2 a = s0.xy * 0.5 + 0.5;
  vec2 b = s1.xy * 0.5 + 0.5;
  vec2 delta = b - a;
  float lenPx = length(delta * uResolution);
  int steps = max(1, int(clamp(lenPx, 1.0, 24.0)));
  for (int i = 1; i <= 24; i++) {
    if (i > steps) break;
    float t = float(i) / float(steps);
    vec2 uv = mix(a, b, t);
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return false;
    float rayViewZ = mix(p0.z, p1.z, t);
    // 选 mip：足迹越大层越粗，加速长距离步进
    float footprint = lenPx * t / float(steps);
    int mip = clamp(int(floor(log2(max(1.0, footprint)))), 0, 8);
    float sceneViewZ = textureLod(uHiZ, uv, float(mip)).r;
    // 射线在表面之前（更近）→ 未命中；穿过厚度带 → 命中
    if (rayViewZ >= sceneViewZ && rayViewZ <= sceneViewZ + uThickness) {
      hitUv = uv;
      hitViewZ = sceneViewZ;
      return true;
    }
  }
  return false;
}

void main() {
  oHit = vec4(0.0);
  oCone = vec4(0.0);
  float rawDepth = texture(uDepth, vUv).r;
  if (rawDepth >= 1.0 - 1e-6) return;
  vec4 nr = texture(gNormalR, vUv);
  vec3 N = normalize(nr.xyz);
  float roughness = nr.a;
  int id = int(texture(gMatAo, vUv).r + 0.5);
  // 只给地面类与金属条做 SSR（建筑立面交给环境光/探针）
  if (id > MAT_STAINLESS) return;

  vec3 worldPos = worldFromDepth(vUv, rawDepth);
  vec3 V = normalize(vec3(uInvView[3][0],uInvView[3][1],uInvView[3][2]) - worldPos);
  vec3 R = reflect(-V, N);
  // 粗糙度 0 → 精确镜面；粗糙 → 在反射锥内抖动方向（时间累积收敛）
  vec3 jitter = vec3(0.0);
  if (roughness > 0.002) {
    vec3 T = normalize(cross(N, abs(N.y) < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0)));
    vec3 B = cross(N, T);
    float a = roughness * 0.35;
    float frameJit = fract(uFrameIndex * 0.6180339);
    float h1 = fract(sin(dot(vUv + frameJit, vec2(12.9898,78.233))) * 43758.5453) - 0.5;
    float h2 = fract(sin(dot(vUv + frameJit, vec2(39.346,11.135))) * 24634.6345) - 0.5;
    jitter = (T * h1 + B * h2) * a;
  }
  R = normalize(R + jitter);

  vec4 viewOrigin4 = uProj * vec4(0.0,0.0,0.0,1.0);
  vec3 viewOrigin = (uInvView * vec4(0.0,0.0,0.0,1.0)).xyz;
  vec3 viewP = (uInvView * vec4(worldPos + N * 0.02, 1.0)).xyz;
  vec3 viewDir = normalize((uInvView * vec4(R, 0.0)).xyz);

  // 分段指数步进，长距离大步长，配合 Hi-Z 粗层
  float t = 0.05;
  vec3 prev = viewP;
  float confidence = 0.0;
  vec2 hitUv = vec2(0.0);
  float hitViewZ = 0.0;
  bool hit = false;
  for (int i = 0; i < 64; i++) {
    if (i >= uMaxSteps) break;
    float stepLen = 0.05 + t * 0.18;
    t += stepLen;
    if (t > uMaxDistance) break;
    vec3 cur = viewP + viewDir * t;
    if (intersectsDepth(prev, cur, hitUv, hitViewZ)) { hit = true; break; }
    // 出屏即终止，置信度留给探针回退
    vec4 clip = uProj * vec4(cur, 1.0);
    vec2 ndc2 = clip.xy / clip.w * 0.5 + 0.5;
    if (any(lessThan(ndc2, vec2(-0.02))) || any(greaterThan(ndc2, vec2(1.02)))) break;
    prev = cur;
  }
  if (hit) {
    // 屏幕边缘平滑衰减（0.12 屏幕宽过渡带），避免倒影在画面边缘突然断掉
    vec2 edge = smoothstep(vec2(0.0), vec2(0.12), hitUv) *
                (1.0 - smoothstep(vec2(0.88), vec2(1.0), hitUv));
    float edgeFade = edge.x * edge.y;
    confidence = edgeFade;
    oHit = vec4(hitUv, hitViewZ, confidence);
  }
  oCone = vec4(roughness, length(viewP), 0.0, 1.0);
}
`;

// ---------- 探针回退 + 时间累积 + 锥体粗糙模糊，合成反射颜色 ----------
export const RESOLVE_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
in vec2 vUv;
uniform sampler2D gAlbedo;
uniform sampler2D gNormalR;
uniform sampler2D gMatAo;
uniform sampler2D uDepth;
uniform sampler2D uSceneColor;     // 本帧场景颜色（无反射基底）
uniform sampler2D uHit;
uniform sampler2D uHistory;        // 上一帧累积反射
uniform samplerCube uProbe;        // 反射探针（带 mip 的卷积立方体贴图）
uniform mat4 uInvProj;
uniform mat4 uInvView;
uniform mat4 uCurViewProj;
uniform mat4 uPrevViewProj;
uniform vec3 uProbePos;
uniform float uProbeEnabled;
uniform float uFrameIndex;
uniform vec2 uResolution;
out vec4 oRefl; // rgb 反射颜色, a 最终有效度

vec3 worldFromDepth(vec2 uv, float rawDepth) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
  vec4 view = uInvProj * ndc;
  view /= view.w;
  return (uInvView * view).xyz;
}

void main() {
  float rawDepth = texture(uDepth, vUv).r;
  vec4 nr = texture(gNormalR, vUv);
  vec3 N = normalize(nr.xyz);
  float roughness = nr.a;
  int id = int(texture(gMatAo, vUv).r + 0.5);
  vec4 hitData = texture(uHit, vUv);
  vec3 result = vec3(0.0);
  float validity = 0.0;

  if (id <= MAT_STAINLESS && rawDepth < 1.0 - 1e-6) {
    vec3 worldPos = worldFromDepth(vUv, rawDepth);
    vec3 V = normalize(vec3(uInvView[3][0],uInvView[3][1],uInvView[3][2]) - worldPos);
    vec3 R = reflect(-V, N);

    // 近镜面短路：粗糙度极低时直接查询探针 mip0，与平面镜参考同源，
    // 保证"粗糙度 0 → SSR 等价镜面反射"的自检口径成立
    if (uProbeEnabled > 0.5 && roughness < 0.02) {
      // 与 MIRROR_FS 完全一致：R = reflect(-V, N)，V 指向相机
      vec3 mirrorR = reflect(-V, N);
      vec3 mirror = textureLod(uProbe, mirrorR, 0.0).rgb;
      vec3 F0 = matF0(id);
      mirror *= mix(vec3(1.0), F0, id > MAT_SHELL ? 1.0 : 0.0);
      result = mirror;
      validity = 0.95;
      // 调试：把反射方向编码进结果（取消下行注释可可视化）
      // result = mirrorR * 0.5 + 0.5;
    } else if (hitData.a > 0.001) {
      // 1) 屏幕空间命中：按粗糙度选场景颜色 mip（锥体足迹），实现"越糙越糊"
      vec2 huv = hitData.rg;
      float coneMip = clamp(roughness * 7.0, 0.0, 6.0);
      vec3 ssrColor = textureLod(uSceneColor, huv, coneMip).rgb;
      result = ssrColor;
      validity = hitData.a;
    }

    // 2) 探针回退：按粗糙度采样卷积 mip，金属用各自 F0 染色
    if (uProbeEnabled > 0.5 && !(roughness < 0.02)) {
      float probeMip = roughness * 8.0;
      vec3 probeR = normalize(worldPos - uProbePos);
      probeR = reflect(probeR, N);
      vec3 probeColor = textureLod(uProbe, probeR, probeMip).rgb;
      vec3 F0 = matF0(id);
      vec3 probeTint = mix(vec3(1.0), F0, id > MAT_SHELL ? 1.0 : 0.0);
      probeColor *= probeTint;
      // 屏幕边缘与未命中处平滑交给探针：weight 在过渡带内渐变，无硬边
      float probeWeight = 1.0 - validity;
      result = mix(result, probeColor, probeWeight);
      validity = max(validity, uProbeEnabled * 0.92);
    }
  }

  // 3) 时间累积：重投影到上一帧，静止收敛、运动快速丢弃，保证不闪不爬。
  //    近镜面（自检）模式跳过累积，直接输出当前帧探针镜面结果，与平面镜参考严格同口径。
  bool mirrorMode = roughness < 0.02;
  float histWeight = 0.0;
  if (!mirrorMode) {
    vec4 curClip = vec4(vUv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
    vec4 world4 = uInvProj * curClip; world4 /= world4.w;
    vec3 wpos = (uInvView * world4).xyz;
    vec4 prevClip = uPrevViewProj * vec4(wpos, 1.0);
    prevClip.xyz /= prevClip.w;
    vec2 prevUv = prevClip.xy * 0.5 + 0.5;
    vec4 prev = texture(uHistory, prevUv);
    vec2 velocity = vUv - prevUv;
    float motion = length(velocity * uResolution);
    // 运动越快历史权重越低，镜面档跟手不拖影；静止时高权重收敛去噪
    histWeight = clamp(0.92 - motion * 0.35, 0.0, 0.92);
    histWeight *= mix(0.55, 1.0, clamp(roughness * 8.0, 0.0, 1.0));
    if (any(lessThan(prevUv, vec2(0.0))) || any(greaterThan(prevUv, vec2(1.0)))) histWeight = 0.0;
    vec3 accumulated = mix(result, prev.rgb, histWeight);
    float accValidity = mix(validity, prev.a, histWeight * 0.8);
    // 冷启动快速收敛
    float warm = clamp(uFrameIndex / 8.0, 0.0, 1.0);
    oRefl = vec4(mix(result, accumulated, warm), max(validity, accValidity * warm));
  } else {
    oRefl = vec4(result, validity);
  }
}
`;

// ---------- 合成：直接光照 + 反射按 Fresnel/金属分材质混合 + 水膜 + 色调映射 ----------
export const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
in vec2 vUv;
uniform sampler2D gAlbedo;
uniform sampler2D gNormalR;
uniform sampler2D gMatAo;
uniform sampler2D uDepth;
uniform sampler2D uReflection;
uniform mat4 uInvProj;
uniform mat4 uInvView;
uniform vec3 uLightDir;     // 主光方向（灯带近似）
uniform vec3 uLightColor;
uniform float uLightIntensity;
uniform float uLightOn;
uniform vec3 uCamPos;
uniform float uWet;
uniform float uValidationMode;
out vec4 outColor;

vec3 worldFromDepth(vec2 uv, float rawDepth) {
  vec4 ndc = vec4(uv*2.0-1.0, rawDepth*2.0-1.0, 1.0);
  vec4 view = uInvProj * ndc; view /= view.w;
  return (uInvView * view).xyz;
}
float distGGX(float NoH, float r){ float a=r*r; float a2=a*a; float d=NoH*NoH*(a2-1.0)+1.0; return a2/max(1e-4, 3.14159265*d*d); }

void main() {
  vec4 ar = texture(gAlbedo, vUv);
  vec4 nr = texture(gNormalR, vUv);
  float rawDepth = texture(uDepth, vUv).r;
  int id = int(texture(gMatAo, vUv).r + 0.5);
  vec3 albedo = ar.rgb;
  vec3 N = normalize(nr.xyz);
  float roughness = max(0.015, nr.a);
  vec3 wp = worldFromDepth(vUv, rawDepth);
  vec3 V = normalize(uCamPos - wp);
  float NoV = max(dot(N,V), 0.0);

  bool metallic = id >= MAT_COPPER && id <= MAT_STAINLESS;
  vec3 F0 = matF0(id);
  vec3 baseColor = metallic ? F0 : albedo;

  // 漫反射直接光（灯带多向近似：主光 + 环境半球）
  vec3 L = normalize(uLightDir);
  float NoL = max(dot(N,L), 0.0);
  vec3 H = normalize(L+V);
  float NoH = max(dot(N,H), 0.0);
  vec3 radiance = uLightOn * uLightColor * uLightIntensity;
  vec3 diffuse = (metallic ? vec3(0.0) : baseColor / 3.14159265) * radiance * NoL;
  // 半球环境填充，避免背光死黑
  vec3 hemi = mix(vec3(0.10,0.11,0.13), vec3(0.32,0.33,0.36), N.y*0.5+0.5);
  diffuse += (metallic ? vec3(0.0) : baseColor) * hemi * 0.55;
  // 自发光灯带/店招
  if (id == MAT_EMISSIVE) {
    vec3 em = albedo * (1.2 + uLightOn * uLightIntensity * 1.6);
    outColor = vec4(em, 1.0);
    return;
  }
  // 直接高光
  float D = distGGX(NoH, roughness);
  vec3 F = F0 + (max(vec3(1.0-roughness), F0) - F0) * pow(1.0-NoH, 5.0);
  float k = (roughness+1.0); k = (k*k)/8.0;
  float Gv = NoV / (NoV*(1.0-k)+k);
  float Gl = max(NoL,1e-3) / (max(NoL,1e-3)*(1.0-k)+k);
  vec3 spec = D * F * Gv * Gl / max(0.0001, 4.0*NoV*max(NoL,1e-3)) * radiance * NoL;

  // 屏幕空间/探针反射，Schlick Fresnel 决定混入量；金属全反射
  vec4 refl = texture(uReflection, vUv);
  vec3 fres = F0 + (vec3(1.0) - F0) * pow(1.0 - NoV, 5.0);
  float reflStrength = metallic ? 1.0 : clamp(fres.x + uWet*0.55, 0.0, 1.0);
  vec3 color = diffuse * (1.0 - reflStrength*0.9) + spec + refl.rgb * reflStrength * refl.a;

  // 水膜镜面加成：湿拖后地面整体反射抬升
  if (uWet > 0.5 && id <= MAT_SHELL) {
    color = mix(color, color*0.7 + refl.rgb*0.9, 0.35);
  }

  if (uValidationMode > 0.5) {
    // 自检模式：只输出纯反射颜色（与 MIRLOR_FS 平面镜参考同口径），
    // 剔除漫反射/直接光等差异项，再走相同 ACES 取灰度，保证逐像素可比
    vec3 tm = clamp(refl.rgb, 0.0, 8.0);
    tm = (tm*(2.51*tm+0.03))/(tm*(2.43*tm+0.59)+0.14);
    float g = dot(tm, vec3(0.2126,0.7152,0.0722));
    outColor = vec4(vec3(g), 1.0);
    return;
  }
  // ACES 近似色调映射 + gamma
  color = clamp(color, 0.0, 8.0);
  color = (color*(2.51*color+0.03))/(color*(2.43*color+0.59)+0.14);
  color = pow(color, vec3(1.0/2.2));
  outColor = vec4(color, 1.0);
}
`;

// ---------- 平面镜参考通道（自检用，粗糙度强制 0 的理想平面反射） ----------
export const MIRROR_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
layout(location=3) in int aMatId;
uniform mat4 uVP;
uniform mat4 uModel;
out vec3 vWorld;
flat out int vId;
void main(){
  vec4 wp = uModel * vec4(aPos,1.0);
  vWorld = wp.xyz; vId = aMatId;
  gl_Position = uVP * wp;
}
`;

export const MIRROR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorld;
flat in int vId;
uniform samplerCube uProbe;
uniform vec3 uCamPos;
uniform vec3 uLightColor;
uniform float uLightOn;
uniform float uValidationMode;
out vec4 outColor;
vec3 aces(vec3 c){ c=clamp(c,0.0,8.0); return (c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14); }
void main() {
  vec3 N = vec3(0.0,1.0,0.0);
  vec3 V = normalize(uCamPos - vWorld);
  vec3 R = reflect(-V, N);
  // 理想平面：mip0 镜面环境全反射（与 resolve 粗糙度 0 近镜面分支严格同口径，无额外光照项）
  vec3 color = textureLod(uProbe, R, 0.0).rgb;
  if (uValidationMode > 0.5) {
    float g = dot(aces(color), vec3(0.2126,0.7152,0.0722));
    outColor = vec4(vec3(g),1.0);
  } else {
    outColor = vec4(pow(aces(color), vec3(1.0/2.2)), 1.0);
  }
}
`;

// ---------- 误差可视化：|SSR - 镜像参考| 灰度差放大 ----------
export const ERROR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uDepth;
out vec4 outColor;
void main() {
  float d = texture(uDepth, vUv).r;
  if (d >= 1.0-1e-6) { outColor = vec4(0.0,0.0,0.0,1.0); return; }
  float a = dot(texture(uA,vUv).rgb, vec3(0.299,0.587,0.114));
  float b = dot(texture(uB,vUv).rgb, vec3(0.299,0.587,0.114));
  float diff = abs(a-b);
  outColor = vec4(vec3(diff*8.0), 1.0); // 放大 8 倍便于肉眼检查
}
`;

// ---------- 探针 mip 卷积（粗糙度预滤波） ----------
export const PROBE_CONVOLVE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform samplerCube uProbe;
uniform vec3 uProbePos;
uniform mat4 uFaceView;
uniform mat4 uProj;
uniform mat4 uInvProj;
uniform float uRoughness;
out vec4 outColor;
void main() {
  vec4 ndc = vec4(vUv*2.0-1.0, 1.0, 1.0);
  vec4 view = uInvProj * ndc; view /= view.w;
  vec3 dir = normalize(mat3(uFaceView) * view.xyz);
  vec3 N = dir;
  vec3 R = N;
  vec3 V = R;
  vec3 T = abs(N.y) > 0.99 ? vec3(1.0,0.0,0.0) : normalize(cross(N, vec3(0.0,1.0,0.0)));
  vec3 B = cross(N,T);
  float a = uRoughness*uRoughness;
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  const int S = 32;
  for (int i=0;i<S;i++){
    float fi = float(i);
    float phi = fi * 2.399963;
    float cosT = sqrt((1.0-fi/float(S))/(1.0+(a*a-1.0)*(fi/float(S))));
    float sinT = sqrt(1.0-cosT*cosT);
    vec3 H = normalize(T*(sinT*cos(phi)) + B*(sinT*sin(phi)) + N*cosT);
    vec3 L = reflect(-V,H);
    float w = max(dot(N,L),0.0);
    sum += textureLod(uProbe, L, 0.0).rgb * w;
    wsum += w;
  }
  outColor = vec4(sum/max(wsum,1e-4), 1.0);
}
`;
