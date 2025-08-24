// main.js (classic script, THREE is global)

// ========= КОНСТАНТЫ И ПАРАМЕТРЫ (как в рабочей версии) =========
const BASE = new THREE.Vector3( 3.945000,  2.867638, -44.981224 );
const STEP = new THREE.Vector3(-0.375000, -0.272589,   0.715546 );
const ROT  = new THREE.Quaternion(0.174819586, -0.254544801, -0.046842770, 0.949974111);

const NEAR = 0.1, FAR = 1000;
const BASE_FOV_DEG = 5;
const ZOOM_FOV_ADD = 1.2;

const V_TAU      = 0.18;
const ZOOM_T_ON  = 0.10;
const ZOOM_T_OFF = 0.16;

const WHEEL_SENS = 0.0020;
const DRAG_SENS  = 0.0100;

const RIGHT_NUDGE = 0.0;
const DOWN_NUDGE  = 0.0;
const BASE_Z_PULL = +8.0;
const WRAP_SPAN   = 3;
const EPS_Z       = 0.0008;

// ========= СЦЕНА/РЕНДЕР =========
const root = document.getElementById('app') || document.body;

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance'
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setClearColor(0xf3f3f3, 1);
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

// ========= ДАННЫЕ =========
fetch('./cards.json')
  .then(r => r.json())
  .then(json => init(Array.isArray(json.cards) ? json.cards : []))
  .catch(()=> init([]));

// ========= ENV: HDR studio.hdr =========
let ENV_READY = false;

function ensureRGBELoader() {
  return new Promise((resolve) => {
    if (THREE.RGBELoader) return resolve();
    const s = document.createElement('script');
    // UMD-версия загрузчика
    s.src = 'https://unpkg.com/three@0.160.0/examples/js/loaders/RGBELoader.js';
    s.onload = () => resolve();
    s.onerror = () => resolve(); // просто работаем без env, если не загрузилось
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
        scene.environment = envTex; // физические материалы возьмут это автоматически
        ENV_READY = true;
        resolve(envTex);
      }, undefined, () => resolve(null));
  });
}

// ========= ФАБРИКА КАРТОЧКИ (sharp + blur + glass) =========
const planeGeo = new THREE.PlaneGeometry(1, 1);
const texLoader = new THREE.TextureLoader();

function deriveBlurURL(url){
  const m = url && url.match(/^(.*)(\.[a-zA-Z0-9]+)$/);
  return m ? `${m[1]}_blur${m[2]}` : `${url}_blur`;
}

function makeGlassMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0.0,
    roughness: 0.0,     // чтобы не давать micro-blur
    transmission: 0.0,  // убираем экранное размытие
    thickness: 0.0,
    ior: 1.0,
    transparent: true,
    opacity: 0.08,      // была проблема: 0.85 сильно темнит; 0.05–0.12 — норм
    depthWrite: false
  });
  mat.envMapIntensity = 1.0; // блик/объём от HDR остаются
  return mat;
}


function makeSharpMaterial(tex) {
  const m = new THREE.MeshBasicMaterial({ map: tex, depthTest: true, depthWrite: true });
  return m;
}

function loadTexture(url, onLoad, onError){
  if (!url) { onError && onError(); return; }
  texLoader.load(url, (t)=>{
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    onLoad && onLoad(t);
  }, undefined, ()=> onError && onError());
}

function makeCardGroup(url){
  // root-группа, чтобы перемещать как один объект (позиции остаются прежними)
  const g = new THREE.Group();
  g.quaternion.copy(ROT);

  // задний слой (blur)
  const blurMat = new THREE.MeshBasicMaterial({ depthTest: true, depthWrite: true });
  const blurMesh = new THREE.Mesh(planeGeo, blurMat);
  blurMesh.position.z = -0.003; // чуть дальше от камеры
  g.add(blurMesh);

  // средний слой (sharp)
  const sharpMat = new THREE.MeshBasicMaterial({ depthTest: true, depthWrite: true });
  const sharpMesh = new THREE.Mesh(planeGeo, sharpMat);
  // ровно в ноль
  g.add(sharpMesh);

  // фронт-стекло
  const glassMat = makeGlassMaterial();
  const glassMesh = new THREE.Mesh(planeGeo, glassMat);
  glassMesh.position.z = +0.0015; // чуть ближе к камере
  g.add(glassMesh);

  // загрузка текстур
  loadTexture(url, (tex)=>{
    sharpMat.map = tex; sharpMat.needsUpdate = true;
    // масштаб всей группы — по исходной текстуре (сохраняем прежнюю геометрию)
    const w = tex.image?.width || 1, h = tex.image?.height || 1;
    g.scale.set((w/h)||1, 1, 1);
  });

  const blurURL = deriveBlurURL(url);
  loadTexture(blurURL, (tex)=>{
    // мягкий внешний вид
    tex.minFilter = THREE.LinearMipMapLinearFilter;
    blurMat.map = tex; blurMat.needsUpdate = true;
  }, ()=>{
    // файла нет — просто скрываем слой
    blurMesh.visible = false;
  });

  return g;
}

// ========= ОСНОВНАЯ ИНИЦИАЛИЗАЦИЯ =========
function init(cards){
  // env грузим в фоне (материалы его подхватят автоматически)
  loadEnvironment();

  // подготовка «поезда» (геометрия расположения ровно как в твоей рабочей версии)
  const dir     = STEP.clone().normalize();
  const stepLen = STEP.length();

  const baseNudged = new THREE.Vector3(
    BASE.x + RIGHT_NUDGE,
    BASE.y + DOWN_NUDGE,
    BASE.z + BASE_Z_PULL
  );

  const train = new THREE.Group();
  scene.add(train);

  const items = []; // {mesh(root group), s0, perp, epsAlong}

  const tmp  = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  for (let i = 0; i < cards.length; i++){
    const url = cards[i]?.src;
    const meshRoot = makeCardGroup(url);

    // стартовая позиция/раскладка — идентична базовой логике
    const basePos  = tmp.copy(baseNudged).addScaledVector(STEP, i);
    const fromBase = tmp2.copy(basePos).sub(baseNudged);
    const s0       = fromBase.dot(dir);
    const perp     = fromBase.addScaledVector(dir, -s0).clone();
    const epsAlong = -EPS_Z * i;

    meshRoot.position.copy(baseNudged).add(perp).addScaledVector(dir, s0 + epsAlong);

    meshRoot.renderOrder = i;
    train.add(meshRoot);
    items.push({ mesh: meshRoot, s0, perp, epsAlong });
  }

  // параметры цикличности — как в рабочей версии
  const sValues = items.map(it => it.s0).sort((a,b)=>a-b);
  const firstS  = sValues.length ? sValues[0] : 0;
  const wrapLen = stepLen * Math.max(1, items.length);
  const sStart  = firstS - wrapLen * ((WRAP_SPAN - 1) / 2);
  const sTotal  = wrapLen * WRAP_SPAN;
  const mod     = (a, n) => ((a % n) + n) % n;

  // ввод/инерция/зуум — как в рабочей версии
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

    const sShift = offset * stepLen;

    for (let i = 0; i < items.length; i++){
      const it = items[i];
      const s = it.s0 - sShift;
      const sWrapped = sStart + mod(s - sStart, sTotal);
      const along = sWrapped + it.epsAlong;

      it.mesh.position
        .copy(BASE) // сразу перезапишем правильной формулой ниже (для ясности — без BASE)
        .copy(new THREE.Vector3(
          BASE.x + RIGHT_NUDGE,
          BASE.y + DOWN_NUDGE,
          BASE.z + BASE_Z_PULL
        ))
        .add(it.perp)
        .addScaledVector(dir, along);
    }

    renderer.render(scene, camera);
  });
}
