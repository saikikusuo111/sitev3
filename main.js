// main.js — Glass Cards v2.3
// — мягкая прозрачность к краю (контент не «тает»)
// — подчёркнутая «толщина» стекла на ВЕРХНЕМ и ПРАВОМ ребре
// — лёгкий бриллиантовый фасет вдоль правого ребра

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

const root = document.getElementById('app') || document.body;

const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false, powerPreference:'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setClearColor(0xf3f3f3, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
root.appendChild(renderer.domElement);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(BASE_FOV_DEG, window.innerWidth/window.innerHeight, NEAR, FAR);
camera.position.set(0,0,0); camera.lookAt(0,0,-1);

function resize(){
  renderer.setSize(window.innerWidth, window.innerHeight, true);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

fetch('./cards.json')
  .then(r=>r.json())
  .then(j=>init(Array.isArray(j.cards)?j.cards:[]))
  .catch(()=>init([]));

function ensureRGBELoader(){
  return new Promise((res)=>{
    if (THREE.RGBELoader) return res();
    const s=document.createElement('script');
    s.src='https://unpkg.com/three@0.160.0/examples/js/loaders/RGBELoader.js';
    s.onload=()=>res(); s.onerror=()=>res(); document.head.appendChild(s);
  });
}
function loadEnvironment(){
  return new Promise(async (resolve)=>{
    await ensureRGBELoader();
    if (!THREE.RGBELoader){ resolve(null); return; }
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    new THREE.RGBELoader().setPath('assets/env/').load('studio.hdr',(hdr)=>{
      const env = pmrem.fromEquirectangular(hdr).texture;
      hdr.dispose(); pmrem.dispose();
      scene.environment = env;
      resolve(env);
    }, undefined, ()=>resolve(null));
  });
}

// ---------- маски: скругления + мягкая прозрачность к краю ----------
function makeRoundedMask(size=1024, radiusNorm=0.045){
  const c=document.createElement('canvas'); c.width=c.height=size;
  const ctx=c.getContext('2d'); const r=radiusNorm*size;
  ctx.clearRect(0,0,size,size); ctx.fillStyle='#fff';
  ctx.beginPath();
  ctx.moveTo(r,0); ctx.lineTo(size-r,0); ctx.quadraticCurveTo(size,0,size,r);
  ctx.lineTo(size,size-r); ctx.quadraticCurveTo(size,size,size-r,size);
  ctx.lineTo(r,size); ctx.quadraticCurveTo(0,size,0,size-r);
  ctx.lineTo(0,r); ctx.quadraticCurveTo(0,0,r,0); ctx.closePath(); ctx.fill();
  const t=new THREE.CanvasTexture(c);
  t.colorSpace=THREE.NoColorSpace; t.minFilter=THREE.LinearMipmapLinearFilter;
  t.magFilter=THREE.LinearFilter; t.generateMipmaps=true; return t;
}
function makeCenterFalloffMask(size=1024, edge=0.10, feather=0.22){
  const c=document.createElement('canvas'); c.width=c.height=size;
  const ctx=c.getContext('2d');
  const img=ctx.createImageData(size,size), d=img.data;
  const smooth=(a,b,x)=>{ x=Math.min(1,Math.max(0,(x-a)/(b-a))); return x*x*(3.0-2.0*x); };
  for(let y=0;y<size;y++){
    const v=(y+0.5)/size;
    for(let x=0;x<size;x++){
      const u=(x+0.5)/size;
      const dist=Math.min(u,v,1-u,1-v);
      let a = smooth(edge, edge+feather, dist);
      const R = Math.hypot(u-0.5, v-0.5);
      const corner = smooth(0.30, 0.75, R);
      a = Math.max(0.0, Math.min(1.0, a * (1.0 - 0.12*corner)));
      const g=(a*255)|0; const k=(y*size+x)*4;
      d[k]=d[k+1]=d[k+2]=g; d[k+3]=255;
    }
  }
  ctx.putImageData(img,0,0);
  const t=new THREE.CanvasTexture(c);
  t.colorSpace=THREE.NoColorSpace; t.minFilter=THREE.LinearMipmapLinearFilter;
  t.magFilter=THREE.LinearFilter; t.generateMipmaps=true; return t;
}
function multiplyAlphaMaps(aTex,bTex,size=1024){
  const c=document.createElement('canvas'); c.width=c.height=size; const ctx=c.getContext('2d');
  const ca=document.createElement('canvas'); ca.width=ca.height=size; const xa=ca.getContext('2d'); xa.drawImage(aTex.image,0,0,size,size);
  const cb=document.createElement('canvas'); cb.width=cb.height=size; const xb=cb.getContext('2d'); xb.drawImage(bTex.image,0,0,size,size);
  const ia=xa.getImageData(0,0,size,size).data; const ib=xb.getImageData(0,0,size,size).data;
  const out=ctx.createImageData(size,size), d=out.data;
  for(let i=0;i<d.length;i+=4){
    const ga=ia[i]/255, gb=ib[i]/255;
    const g=Math.max(0,Math.min(1,ga*gb));
    const v=(g*255)|0; d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;
  }
  ctx.putImageData(out,0,0);
  const t=new THREE.CanvasTexture(c);
  t.colorSpace=THREE.NoColorSpace; t.minFilter=THREE.LinearMipmapLinearFilter;
  t.magFilter=THREE.LinearFilter; t.generateMipmaps=true; return t;
}
// ремап альфы: центр 1 → край minAlpha (не 0!)
function remapAlpha(tex, minAlpha=0.70, size=1024){
  const src = tex.image;
  const c=document.createElement('canvas'); c.width=c.height=size;
  const ctx=c.getContext('2d'); ctx.drawImage(src,0,0,size,size);
  const img=ctx.getImageData(0,0,size,size); const d=img.data;
  const A=minAlpha, B=1.0-minAlpha;
  for(let i=0;i<d.length;i+=4){
    const g=d[i]/255; const r=A + B*g; const v=(r*255)|0;
    d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;
  }
  ctx.putImageData(img,0,0);
  const t=new THREE.CanvasTexture(c);
  t.colorSpace=THREE.NoColorSpace; t.minFilter=THREE.LinearMipmapLinearFilter;
  t.magFilter=THREE.LinearFilter; t.generateMipmaps=true; return t;
}

// маска для фасета — плавно появляется к правому краю, мягкие верх/низ
function makeFacetMask(size=512){
  const c=document.createElement('canvas'); c.width=c.height=size;
  const ctx=c.getContext('2d');
  const img=ctx.createImageData(size,size), d=img.data;
  const smooth=(a,b,x)=>{ x=Math.min(1,Math.max(0,(x-a)/(b-a))); return x*x*(3.0-2.0*x); };
  for(let y=0;y<size;y++){
    const v=(y+0.5)/size;
    for(let x=0;x<size;x++){
      const u=(x+0.5)/size;
      const gx = smooth(0.35, 0.95, u);             // к правому краю → 1
      const gy = smooth(0.02, 0.14, v) * smooth(0.02, 0.14, 1.0-v); // вертикальная мягкость
      const a  = 0.60 + 0.40 * (gx*gy);            // мин. 0.6, макс. 1.0
      const g  = (a*255)|0; const k=(y*size+x)*4;
      d[k]=d[k+1]=d[k+2]=g; d[k+3]=255;
    }
  }
  ctx.putImageData(img,0,0);
  const t=new THREE.CanvasTexture(c);
  t.colorSpace=THREE.NoColorSpace;
  t.minFilter=THREE.LinearMipmapLinearFilter; t.magFilter=THREE.LinearFilter;
  t.generateMipmaps=true; return t;
}

const ROUNDED_MASK    = makeRoundedMask(1024, 0.045);
const CENTER_FALLOFF  = makeCenterFalloffMask(1024, 0.10, 0.22);
const ALPHA_SOFT_BASE = multiplyAlphaMaps(ROUNDED_MASK, CENTER_FALLOFF, 1024);
const ALPHA_SOFT      = remapAlpha(ALPHA_SOFT_BASE, 0.70, 1024); // край ~70%
const FACET_MASK      = makeFacetMask(512);

// ---------- материалы карточки ----------
const planeGeo  = new THREE.PlaneGeometry(1,1);
const texLoader = new THREE.TextureLoader();

function loadTexture(url, ok, err){
  if(!url){ err && err(); return; }
  texLoader.load(url,(t)=>{
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.minFilter  = THREE.LinearMipmapLinearFilter;
    ok && ok(t);
  }, undefined, ()=>err && err());
}

function makeImageMaterial(){
  return new THREE.MeshBasicMaterial({
    map: null,
    transparent: true,
    alphaMap: ALPHA_SOFT,
    depthTest: true,
    depthWrite: true
  });
}
function makeGlassMaterial({front=true}={}){
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0.0,
    roughness: front ? 0.038 : 0.055,
    transmission: 1.0,
    thickness: front ? 0.034 : 0.052, // ЧУТЬ толще
    ior: 1.33,
    clearcoat: 1.0,
    clearcoatRoughness: front ? 0.018 : 0.025,
    attenuationColor: new THREE.Color(0xF0F4F8),
    attenuationDistance: 6.5,
    envMapIntensity: 1.25,
    transparent: true,
    opacity: front ? 0.06 : 0.045,
    alphaMap: ALPHA_SOFT,
    depthWrite: false
  });
}
function makeFacetMaterial(){
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0.0,
    roughness: 0.08,         // лёгкая рассеянность — «бриллиантовый» отблеск
    transmission: 1.0,
    thickness: 0.08,
    ior: 1.5,                // немного выше — сильнее преломление
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    attenuationColor: new THREE.Color(0xF6FAFF),
    attenuationDistance: 5.5,
    envMapIntensity: 1.6,
    transparent: true,
    opacity: 0.20,           // фасет видим, но деликатен
    alphaMap: FACET_MASK,
    depthWrite: false
  });
}

// === Параметры «объёма» на верхнем и правом крае ===
const FRONT_SCALE = 0.9900;   // фронт меньше
const BACK_SCALE  = 1.0200;   // бэк больше
const Z_OFF_FRONT = +0.0018;
const Z_OFF_BACK  = -0.0022;
// фронт вниз-влево, бэк вверх-вправо => объём на верх/право
const EDGE_SHIFT  = 0.0120;

// фасет по правому ребру
const FACET_W       = 0.060;   // ширина полосы (от 0 до 1)
const FACET_Z       = +0.0012; // чтобы не мерцал с основным слоем
const FACET_TILT_Y  = -0.22;   // лёгкий разворот к зрителю
const FACET_TILT_X  = -0.03;   // тонкий наклон по X

function makeCardGroup(url){
  const g = new THREE.Group();
  g.quaternion.copy(ROT);

  // Контент
  const imgMat  = makeImageMaterial();
  const img     = new THREE.Mesh(planeGeo, imgMat);
  img.position.z = 0.0;
  g.add(img);

  // Стекло (front)
  const glassFront = new THREE.Mesh(planeGeo, makeGlassMaterial({front:true}));
  glassFront.position.set(-EDGE_SHIFT, -EDGE_SHIFT, Z_OFF_FRONT);
  glassFront.scale.set(FRONT_SCALE, FRONT_SCALE, 1);
  g.add(glassFront);

  // Стекло (back)
  const glassBack  = new THREE.Mesh(planeGeo, makeGlassMaterial({front:false}));
  glassBack.position.set(+EDGE_SHIFT, +EDGE_SHIFT, Z_OFF_BACK);
  glassBack.scale.set(BACK_SCALE, BACK_SCALE, 1);
  g.add(glassBack);

  // Бриллиантовый фасет по правому краю
  const facetGeo = new THREE.PlaneGeometry(FACET_W, 1);
  const facet    = new THREE.Mesh(facetGeo, makeFacetMaterial());
  // положим фасет вдоль правого ребра: центр полосы на x = 0.5 - FACET_W/2
  facet.position.set(0.5 - FACET_W*0.5 + EDGE_SHIFT*0.25, +EDGE_SHIFT*0.35, FACET_Z);
  facet.rotation.y = FACET_TILT_Y;
  facet.rotation.x = FACET_TILT_X;
  g.add(facet);

  loadTexture(url, (tex)=>{
    imgMat.map = tex; imgMat.needsUpdate = true;
    const w=tex.image?.width||1, h=tex.image?.height||1;
    g.scale.set((w/h)||1, 1, 1);
  });

  return g;
}

// ---------- инициализация/анимация ----------
function init(cards){
  loadEnvironment();

  const dir     = STEP.clone().normalize();
  const stepLen = STEP.length();
  const baseNudged = new THREE.Vector3(BASE.x+RIGHT_NUDGE, BASE.y+DOWN_NUDGE, BASE.z+BASE_Z_PULL);

  const train = new THREE.Group(); scene.add(train);

  const items = [];
  const tmp=new THREE.Vector3(), tmp2=new THREE.Vector3();

  for(let i=0;i<cards.length;i++){
    const url = cards[i]?.src;
    const root = makeCardGroup(url);

    const basePos  = tmp.copy(baseNudged).addScaledVector(STEP, i);
    const fromBase = tmp2.copy(basePos).sub(baseNudged);
    const s0       = fromBase.dot(dir);
    const perp     = fromBase.addScaledVector(dir, -s0).clone();
    const epsAlong = -EPS_Z * i;

    root.position.copy(baseNudged).add(perp).addScaledVector(dir, s0 + epsAlong);
    root.renderOrder = i;
    train.add(root);
    items.push({ mesh:root, s0, perp, epsAlong });
  }

  const sValues = items.map(it=>it.s0).sort((a,b)=>a-b);
  const firstS  = sValues.length ? sValues[0] : 0;
  const wrapLen = stepLen * Math.max(1, items.length);
  const sStart  = firstS - wrapLen * ((WRAP_SPAN - 1)/2);
  const sTotal  = wrapLen * WRAP_SPAN;
  const mod = (a,n)=>((a%n)+n)%n;

  let offset=0, v=0;
  let dragging=false, lastY=0, lastDY=0, touchY=null;
  let activity=0, lastWheelTime=0;

  window.addEventListener('wheel',(e)=>{ v+=e.deltaY*WHEEL_SENS; lastWheelTime=performance.now(); }, {passive:true});
  window.addEventListener('pointerdown',(e)=>{ dragging=true; lastY=e.clientY; lastDY=0; });
  window.addEventListener('pointermove',(e)=>{
    if(!dragging) return;
    const dy=e.clientY-lastY; lastY=e.clientY; lastDY=dy;
    offset+=dy*DRAG_SENS;
  });
  window.addEventListener('pointerup',()=>{
    if(!dragging) return;
    dragging=false; v+=lastDY*DRAG_SENS*0.4;
  });

  window.addEventListener('touchstart',(e)=>{ if(e.touches[0]) touchY=e.touches[0].clientY; }, {passive:true});
  window.addEventListener('touchmove',(e)=>{
    if(!e.touches[0]||touchY==null) return;
    const dy=e.touches[0].clientY-touchY; touchY=e.touches[0].clientY;
    offset+=dy*DRAG_SENS;
  }, {passive:true});
  window.addEventListener('touchend',()=>{ touchY=null; });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(()=>{
    const dt = Math.min(clock.getDelta(), 0.05);

    offset += v*dt;
    v *= Math.exp(-dt/V_TAU);

    const now=performance.now();
    const targetActivity = (dragging || (now-lastWheelTime<120) || Math.abs(v)>0.002) ? 1 : 0;
    const k = (targetActivity>activity) ? (1-Math.exp(-dt/ZOOM_T_ON)) : (1-Math.exp(-dt/ZOOM_T_OFF));
    activity += (targetActivity-activity)*k;

    const targetFov = BASE_FOV_DEG + ZOOM_FOV_ADD*activity;
    if (Math.abs(camera.fov-targetFov) > 1e-4){ camera.fov=targetFov; camera.updateProjectionMatrix(); }

    const sShift = offset*stepLen;
    for(const it of items){
      const s = it.s0 - sShift;
      const sWrapped = sStart + mod(s - sStart, sTotal);
      const along = sWrapped + it.epsAlong;

      it.mesh.position.copy(baseNudged).add(it.perp).addScaledVector(STEP.clone().normalize(), along);
    }

    renderer.render(scene, camera);
  });
}
