// main.js — 1:1 как оригинал: стекло с тонким светлым кантoм, скруглённые углы, узкий кромочный blur,
// блики (clearcoat+env), без transmission «мыла». Камера/поезд/геометрия не тронуты.

//// ===== БАЗОВЫЕ КОНСТАНТЫ =====
// Базовая точка, от которой начинается поезд карточек. Изначально в оригинале
// положительные координаты X/Y направляли движение вниз‑влево и ближе к камере.
// Для воссоздания визуала Unveil положим базу зеркально: по X и Y значения
// инвертированы, чтобы поезд уходил вверх‑вправо, а по Z оставляем
// исходное значение (глубина сцены).  
// Подгоняем положение и шаг, чтобы карточки занимали примерно такую же
// позицию как на оригинальном сайте. База перемещена вглубь сцены
// (z ≈ −30), а шаг по z уменьшен по модулю (≈ −0.5). Знаки X/Y по‑прежнему
// инвертированы, чтобы поезд поднимался вверх‑вправо.
const BASE = new THREE.Vector3(-3.945000, -2.867638, -30.0);
const STEP = new THREE.Vector3(0.375000, 0.272589, -0.50);
// Поворот карточек оставляем без изменений: они смотрят прямо на камеру
// (нет вращения вокруг оси Y), небольшие наклоны используются для
// имитации перспективы.  
const ROT  = new THREE.Quaternion(0.174819586, -0.254544801, -0.046842770, 0.949974111);

const NEAR = 0.1, FAR = 1000;
const BASE_FOV_DEG = 5;
const ZOOM_FOV_ADD = 1.2;

const V_TAU      = 0.18;
const ZOOM_T_ON  = 0.10;
const ZOOM_T_OFF = 0.16;

// Параметры чувствительности к прокрутке/перетаскиванию
const WHEEL_SENS = 0.0020;
const DRAG_SENS  = 0.0100;

// Небольшие подстройки базовой позиции по X/Y и глобальное смещение по Z
const RIGHT_NUDGE = 0.0;
const DOWN_NUDGE  = 0.0;
const BASE_Z_PULL = +8.0;
// Количество повторов «поезда» для бесконечной прокрутки
const WRAP_SPAN   = 3;
const EPS_Z       = 0.0008;

//// ===== СЦЕНА/РЕНДЕР =====
const root = document.getElementById('app') || document.body;

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance'
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setClearColor(0xf3f3f3, 1);
// ACES Filmic tone mapping to soften highlights (G)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.10;
root.appendChild(renderer.domElement);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  BASE_FOV_DEG, window.innerWidth / window.innerHeight, NEAR, FAR
);
camera.position.set(0, 0, 0);
camera.lookAt(0, 0, -1);

function resize(){
  renderer.setSize(window.innerWidth, window.innerHeight, true);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

//// ===== ENVIRONMENT HDR (for glass highlights) =====
let ENV_READY = false;

function ensureRGBELoader() {
  return new Promise((resolve) => {
    if (THREE.RGBELoader) return resolve();
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/three@0.160.0/examples/js/loaders/RGBELoader.js';
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}

function loadEnvironment() {
  return new Promise(async (resolve) => {
    await ensureRGBELoader();
    if (!THREE.RGBELoader) { resolve(null); return; }
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    new THREE.RGBELoader()
      .setPath('assets/env/')
      .load('studio.hdr', (hdr) => {
        const envTex = pmrem.fromEquirectangular(hdr).texture;
        hdr.dispose(); pmrem.dispose();
        scene.environment = envTex;
        ENV_READY = true;
        resolve(envTex);
      }, undefined, () => resolve(null));
  });
}

//// ===== GEOMETRY AND TEXTURE LOADERS =====
const planeGeo  = new THREE.PlaneGeometry(1, 1);
const texLoader = new THREE.TextureLoader();

// Пастельные оттенки для тонировки стекла и размытия.
// Цвет выбирается случайно для каждой карточки, придавая футуристичный
// вид и разнообразие. Можно добавить больше оттенков при желании.
const TINT_COLORS = [
  new THREE.Color(0xfff9d0), // нежный жёлтый
  new THREE.Color(0xd0f4ff), // нежный голубой
  new THREE.Color(0xf0d0ff), // нежный фиолетовый
  new THREE.Color(0xdff0ff), // светло‑голубой
  new THREE.Color(0xffe0f0)  // светло‑розовый
];

function deriveBlurURL(url){
  const m = url && url.match(/^(.*)(\.[a-zA-Z0-9]+)$/);
  return m ? `${m[1]}_blur${m[2]}` : `${url}_blur`;
}

function loadTexture(url, onLoad, onError){
  if (!url) { onError && onError(); return; }
  texLoader.load(url, (t)=>{
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    onLoad && onLoad(t);
  }, undefined, ()=> onError && onError());
}

//// ===== MASK GENERATORS =====
// Rounded rectangle mask (E) with radiusNorm fraction of side.
// Используем значение 0.04 как в оригинале, чтобы углы были мягко скруглены
// и виден плавный переход между центром и кромкой.
function makeRoundedMask(size = 1024, radiusNorm = 0.04){
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const r = radiusNorm * size;
  ctx.clearRect(0,0,size,size);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(r,0);
  ctx.lineTo(size-r,0); ctx.quadraticCurveTo(size,0,size,r);
  ctx.lineTo(size,size-r); ctx.quadraticCurveTo(size,size,size-r,size);
  ctx.lineTo(r,size); ctx.quadraticCurveTo(0,size,0,size-r);
  ctx.lineTo(0,r); ctx.quadraticCurveTo(0,0,r,0);
  ctx.closePath(); ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

// Edge mask for blur (C): 1 at edges, 0 in centre.
// Используем ширину и растушёвку как в оригинале (edge≈0.11, feather≈0.09),
// чтобы размытие занимало большую часть карточки и плавно переходило в центр.
function makeEdgeMask(size = 1024, edge = 0.11, feather = 0.09){
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const smooth = (a,b,t)=>{
    t = Math.min(1,Math.max(0,(t-a)/(b-a)));
    return t*t*(3-2*t);
  };
  for(let j=0;j<size;j++){
    const v = (j+0.5)/size;
    for(let i=0;i<size;i++){
      const u = (i+0.5)/size;
      const d = Math.min(u,v,1-u,1-v);
      const m = 1 - smooth(edge, edge+feather, d);
      const g = (m*255)|0;
      const k = (j*size+i)*4;
      data[k]=g; data[k+1]=g; data[k+2]=g; data[k+3]=255;
    }
  }
  ctx.putImageData(img,0,0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

// Glass alpha mask (A): centre=1 → edges=0 (thin light rim).
// Восстанавливаем исходные значения 0.17 и 0.11, чтобы ободок был
// достаточно широким и плавным.
function makeGlassAlphaMask(size = 1024, edge = 0.17, feather = 0.11){
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const smooth = (a,b,t)=>{
    t = Math.min(1,Math.max(0,(t-a)/(b-a)));
    return t*t*(3-2*t);
  };
  for(let j=0;j<size;j++){
    const v = (j+0.5)/size;
    for(let i=0;i<size;i++){
      const u = (i+0.5)/size;
      const d = Math.min(u,v,1-u,1-v);
      const a = 1 - smooth(edge, edge+feather, d);
      const g = (a*255)|0;
      const k = (j*size+i)*4;
      data[k]=g; data[k+1]=g; data[k+2]=g; data[k+3]=255;
    }
  }
  ctx.putImageData(img,0,0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

// Multiply two alpha maps (component‑wise) to combine effects
function multiplyAlphaMaps(aTex, bTex, size=1024){
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // draw both textures to hidden canvases
  const ca = document.createElement('canvas'); ca.width=ca.height=size;
  const xa = ca.getContext('2d'); xa.drawImage(aTex.image,0,0,size,size);
  const cb = document.createElement('canvas'); cb.width=cb.height=size;
  const xb = cb.getContext('2d'); xb.drawImage(bTex.image,0,0,size,size);
  const ia = xa.getImageData(0,0,size,size).data;
  const ib = xb.getImageData(0,0,size,size).data;
  const out = ctx.createImageData(size,size);
  const d = out.data;
  for(let i=0;i<d.length;i+=4){
    const ga = ia[i+1]/255, gb = ib[i+1]/255;
    const g = Math.max(0, Math.min(1, ga*gb));
    const v = (g*255)|0;
    d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;
  }
  ctx.putImageData(out,0,0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

// Precompute masks once
// Используем значения масок как в оригинале: сглаженные углы (0.04),
// широкое размытие по краям (0.11,0.09) и широкий светлый ободок (0.17,0.11).
const ROUNDED_MASK   = makeRoundedMask(1024, 0.04);       // (E)
const EDGE_MASK      = makeEdgeMask(1024, 0.11, 0.09);    // (C)
const GLASS_MASK_RAW = makeGlassAlphaMask(1024, 0.17, 0.11); // (A)
const GLASS_MASK     = multiplyAlphaMaps(GLASS_MASK_RAW, ROUNDED_MASK, 1024); // combined mask for glass
const EDGE_ROUNDED   = multiplyAlphaMaps(ROUNDED_MASK, EDGE_MASK, 1024); // for blur overlay

//// ===== MATERIAL HELPERS =====
// Glass material: no transmission, with clearcoat & env bounces, thin bright rim
function makeGlassMaterial() {
  return new THREE.MeshPhysicalMaterial({
    // цвет задаётся позже для каждой карточки; по умолчанию белый
    color: 0xffffff,
    metalness: 0.0,
    roughness: 0.05,           // небольшая шероховатость для матовых бликов
    clearcoat: 1.0,            // тонкий слой лака
    clearcoatRoughness: 0.05,
    transmission: 0.5,         // стеклянная прозрачность
    thickness: 2.0,            // толщина стекла для красивых искажений
    ior: 1.2,                  // показатель преломления
    transparent: true,
    opacity: 0.7,              // картинка просвечивает
    alphaMap: GLASS_MASK,      // ободок светлее
    depthWrite: false,
    envMapIntensity: 1.2       // подсветка от HDR окружения
  });
}

// Fresnel edge material: small additive glow on card edges (D)
function makeFresnelEdgeMaterial(){
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uIntensity: { value: 0.15 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uIntensity;
      float edgeDist(vec2 uv){
        float d = min(min(uv.x, uv.y), min(1.0-uv.x, 1.0-uv.y));
        return d;
      }
      void main(){
        float d = edgeDist(vUv);
        float glow = smoothstep(0.12, 0.0, d);
        glow *= 0.85;
        vec3 col = vec3(1.0);
        gl_FragColor = vec4(col, glow * uIntensity);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true
  });
  return mat;
}

// Basic material with optional map and alpha (rounded corners)
function makeBasicWithAlpha(tex, alphaTex, opacity=1){
  const m = new THREE.MeshBasicMaterial({
    map: tex || null,
    transparent: true,
    opacity,
    alphaMap: alphaTex || null,
    depthTest: true,
    depthWrite: true
  });
  return m;
}

//// ===== AUTO BLUR (C) =====
async function makeAutoBlurFromTexture(srcTex, radiusPx=16){
  const img = srcTex.image;
  if (!img) return null;
  const w = img.width, h = img.height;
  const c = document.createElement('canvas'); c.width=w; c.height=h;
  const ctx = c.getContext('2d');
  ctx.filter = `blur(${radiusPx}px)`;
  ctx.drawImage(img, 0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  return t;
}

//// ===== CARD FACTORY (B, C, D, E, F) =====
function makeCardGroup(url){
  const g = new THREE.Group();
  g.quaternion.copy(ROT);

  // 1) SHARP: scaled down (B) and rounded (E).  
  // Масштаб увеличен до 0.98, чтобы рамка была очень тонкой, как у Unveil.
  const sharpMat = makeBasicWithAlpha(null, ROUNDED_MASK, 1.0);
  const sharp = new THREE.Mesh(planeGeo, sharpMat);
  sharp.position.z = 0.0;
  // масштаб изображения уменьшен на ~4%, чтобы оставить заметную рамку и
  // пространство для размытого слоя; это соответствует оригинальному дизайну
  sharp.scale.set(0.96, 0.96, 1.0);
  sharp.renderOrder = 0;
  g.add(sharp);

  // 2) BLUR: overlay the blurred version of the image over the edges.
  const blurAlpha = multiplyAlphaMaps(ROUNDED_MASK, EDGE_MASK, 1024);
  const blurMat = makeBasicWithAlpha(null, blurAlpha, 0.60);
  blurMat.depthWrite = false;
  // цвет размытия и стекла выбирается из пастельных оттенков
  const tint = TINT_COLORS[Math.floor(Math.random()*TINT_COLORS.length)].clone();
  blurMat.color.copy(tint);
  const blur = new THREE.Mesh(planeGeo, blurMat);
  blur.position.z = +0.0006;
  blur.renderOrder = 1;
  g.add(blur);

  // 3) GLASS: front panel with thin bright rim and clearcoat highlights (A,D,E)
  const glass = new THREE.Mesh(planeGeo, makeGlassMaterial());
  glass.position.z = +0.0016;
  glass.renderOrder = 2;
  // тонируем стекло тем же оттенком, слегка смешивая его с белым для светлого вида
  glass.material.color.copy(tint).lerp(new THREE.Color(0xffffff), 0.4);
  g.add(glass);

  // 4) FRESNEL EDGE: additive glow along edges (D)
  const fresnel = new THREE.Mesh(planeGeo, makeFresnelEdgeMaterial());
  fresnel.position.z = +0.0017;
  fresnel.renderOrder = 3;
  g.add(fresnel);

  // ===== Load textures =====
  loadTexture(url, async (tex) => {
    sharpMat.map = tex; sharpMat.needsUpdate = true;
    // scale group to respect aspect ratio
    const w = tex.image?.width || 1, h = tex.image?.height || 1;
    g.scale.set((w/h)||1, 1, 1);
    // try to load external blur
    const blurURL = deriveBlurURL(url);
    loadTexture(blurURL, (btex) => {
      blurMat.map = btex; blurMat.needsUpdate = true;
      blur.visible = true;
    }, async () => {
      // auto blur if _blur not found
      const auto = await makeAutoBlurFromTexture(tex, 16);
      if (auto){
        blurMat.map = auto; blurMat.needsUpdate = true;
        blur.visible = true;
      } else {
        blur.visible = false;
      }
    });
  });

  return g;
}

//// ===== INITIALISE / BUILD TRAIN (unchanged aside from card factory) =====
function init(cards){
  loadEnvironment();

  const dir     = STEP.clone().normalize();
  const stepLen = STEP.length();

  const baseNudged = new THREE.Vector3(
    BASE.x + RIGHT_NUDGE,
    BASE.y + DOWN_NUDGE,
    BASE.z + BASE_Z_PULL
  );

  const train = new THREE.Group();
  scene.add(train);

  const items = [];
  const tmp  = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  for (let i = 0; i < cards.length; i++){
    const url = cards[i]?.src;
    const meshRoot = makeCardGroup(url);

    const basePos  = tmp.copy(baseNudged).addScaledVector(STEP, i);
    const fromBase = tmp2.copy(basePos).sub(baseNudged);
    const s0       = fromBase.dot(dir);
    const perp     = fromBase.addScaledVector(dir, -s0).clone();
    const epsAlong = -EPS_Z * i;

    meshRoot.position.copy(baseNudged).add(perp).addScaledVector(dir, s0 + epsAlong);
    train.add(meshRoot);
    items.push({ mesh: meshRoot, s0, perp, epsAlong });
  }

  const sValues = items.map(it => it.s0).sort((a,b)=>a-b);
  const firstS  = sValues.length ? sValues[0] : 0;
  const wrapLen = stepLen * Math.max(1, items.length);
  const sStart  = firstS - wrapLen * ((WRAP_SPAN - 1) / 2);
  const sTotal  = wrapLen * WRAP_SPAN;
  const mod     = (a, n) => ((a % n) + n) % n;

  let offset = 0;
  let v = 0;

  let dragging = false;
  let lastY = 0, lastDY = 0;
  let touchY = null;

  let activity = 0;
  let lastWheelTime = 0;

  window.addEventListener('wheel', (e)=>{
    v += e.deltaY * WHEEL_SENS;
    lastWheelTime = performance.now();
  }, { passive: true });

  window.addEventListener('pointerdown', (e)=>{
    dragging = true;
    lastY = e.clientY; lastDY = 0;
  });
  window.addEventListener('pointermove', (e)=>{
    if (!dragging) return;
    const dy = e.clientY - lastY; lastY = e.clientY; lastDY = dy;
    offset += dy * DRAG_SENS;
  });
  window.addEventListener('pointerup', ()=>{
    if (!dragging) return;
    dragging = false;
    v += lastDY * DRAG_SENS * 0.4;
  });

  window.addEventListener('touchstart', (e)=>{
    if (e.touches[0]) touchY = e.touches[0].clientY;
  }, { passive:true });
  window.addEventListener('touchmove',  (e)=>{
    if (!e.touches[0] || touchY == null) return;
    const dy = e.touches[0].clientY - touchY; touchY = e.touches[0].clientY;
    offset += dy * DRAG_SENS;
  }, { passive:true });
  window.addEventListener('touchend', ()=>{ touchY = null; });

  const clock = new THREE.Clock();

  renderer.setAnimationLoop(()=>{
    const dt = Math.min(clock.getDelta(), 0.05);

    offset += v * dt;
    v *= Math.exp(-dt / V_TAU);

    const now = performance.now();
    const targetActivity =
      dragging || (now - lastWheelTime < 120) || Math.abs(v) > 0.002 ? 1 : 0;

    const k = (targetActivity > activity)
      ? (1 - Math.exp(-dt / ZOOM_T_ON))
      : (1 - Math.exp(-dt / ZOOM_T_OFF));
    activity += (targetActivity - activity) * k;

    const targetFov = BASE_FOV_DEG + ZOOM_FOV_ADD * activity;
    if (Math.abs(camera.fov - targetFov) > 1e-4){
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }

    const sShift = offset * STEP.length();

    for (let i = 0; i < items.length; i++){
      const it = items[i];
      const s = it.s0 - sShift;
      const sWrapped = sStart + mod(s - sStart, sTotal);
      const along = sWrapped + it.epsAlong;
      it.mesh.position
        .copy(new THREE.Vector3(
          BASE.x + RIGHT_NUDGE,
          BASE.y + DOWN_NUDGE,
          BASE.z + BASE_Z_PULL
        ))
        .add(it.perp)
        .addScaledVector(STEP.clone().normalize(), along);
    }

    renderer.render(scene, camera);
  });
}

//// ===== DATA LOADING =====
fetch('./cards.json')
  .then(r => r.json())
  .then(json => init(Array.isArray(json.cards) ? json.cards : []))
  .catch(() => init([]));
