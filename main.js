// main.js — enhanced 3D gallery for saikikusuo111/sitev3
//
// This script rebuilds the card gallery to closely match the appearance of
// the unveil.fr portfolio. Each card consists of multiple layers: a sharp
// photograph with rounded corners and a slight inset, a blurred halo only
// around the edge tinted by the average colour of the image, a glass pane
// with a narrow bright rim and subtle reflections, and a fresnel glow to
// emphasise the acrylic feel. The gallery supports inertia scrolling and
// dynamically widens the camera FOV on mobile screens to keep cards fully
// visible. Tone mapping is enabled for cinematic lighting, and an HDR
// environment is loaded for realistic reflections.

// === Constants for card placement and camera ===
const BASE = new THREE.Vector3( 3.945000,  2.867638, -44.981224 );
const STEP = new THREE.Vector3(-0.375000, -0.272589,   0.715546 );
const ROT  = new THREE.Quaternion(0.174819586, -0.254544801, -0.046842770, 0.949974111);

const NEAR = 0.1;
const FAR  = 1000;

// Base FOV and zoom increments. These values are adapted for desktop and
// mobile at runtime: mobile screens get a wider view to prevent clipping.
const DESKTOP_BASE_FOV = 5.0;
const DESKTOP_ZOOM_ADD = 1.2;
const MOBILE_BASE_FOV  = 7.0;
const MOBILE_ZOOM_ADD  = 1.5;

// Inertia and zoom timing constants
const V_TAU      = 0.18;
const ZOOM_T_ON  = 0.10;
const ZOOM_T_OFF = 0.16;

// Input sensitivities
const WHEEL_SENS = 0.0020;
const DRAG_SENS  = 0.0100;

// Offsets for positioning the train relative to the camera
const RIGHT_NUDGE = 0.0;
const DOWN_NUDGE  = 0.0;
const BASE_Z_PULL = +8.0;

// Card spacing parameters
const WRAP_SPAN = 3;
const EPS_Z     = 0.0008;

// === Renderer and camera setup ===
const root = document.getElementById('app') || document.body;

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance'
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setClearColor(0xf3f3f3, 1);
// Use ACES filmic tone mapping for softer highlights
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.10;
root.appendChild(renderer.domElement);

const scene  = new THREE.Scene();

// Determine if we are on a mobile viewport (<768px wide) and choose FOVs
const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
let baseFov    = isMobile ? MOBILE_BASE_FOV : DESKTOP_BASE_FOV;
let zoomFovAdd = isMobile ? MOBILE_ZOOM_ADD  : DESKTOP_ZOOM_ADD;

const camera = new THREE.PerspectiveCamera(baseFov, window.innerWidth / window.innerHeight, NEAR, FAR);
camera.position.set(0, 0, 0);
camera.lookAt(0, 0, -1);

function resize(){
  renderer.setSize(window.innerWidth, window.innerHeight, true);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  // update dynamic FOV if crossing mobile threshold at resize
  const mob = window.innerWidth < 768;
  if (mob !== isMobile) {
    baseFov    = mob ? MOBILE_BASE_FOV : DESKTOP_BASE_FOV;
    zoomFovAdd = mob ? MOBILE_ZOOM_ADD  : DESKTOP_ZOOM_ADD;
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
  }
}
window.addEventListener('resize', resize);
resize();

// === Environment map loading ===
let ENV_READY = false;

function ensureRGBELoader() {
  return new Promise(resolve => {
    if (THREE.RGBELoader) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/three@0.160.0/examples/js/loaders/RGBELoader.js';
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}

function loadEnvironment() {
  return new Promise(async resolve => {
    await ensureRGBELoader();
    if (!THREE.RGBELoader) { resolve(null); return; }
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    new THREE.RGBELoader().setPath('assets/env/').load('studio.hdr', hdr => {
      const envTex = pmrem.fromEquirectangular(hdr).texture;
      hdr.dispose(); pmrem.dispose();
      scene.environment = envTex;
      ENV_READY = true;
      resolve(envTex);
    }, undefined, () => resolve(null));
  });
}

// === Helper functions for alpha masks and colours ===

// Create a rounded-rectangle mask: white inside, transparent outside. radiusNorm is fraction of width.
function makeRoundedMask(size = 1024, radiusNorm = 0.04) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const r = radiusNorm * size;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0); ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r); ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size); ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

// Edge mask: 1 on the border, 0 in the centre. Use for blur halos.
function makeEdgeMask(size = 1024, edge = 0.11, feather = 0.09) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const smooth = (a,b,t) => {
    t = Math.min(1, Math.max(0, (t - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let y=0; y<size; y++) {
    const v = (y + 0.5) / size;
    for (let x=0; x<size; x++) {
      const u = (x + 0.5) / size;
      const d = Math.min(u, v, 1 - u, 1 - v);
      const m = 1 - smooth(edge, edge + feather, d);
      const g = Math.round(255 * m);
      const i = (y * size + x) * 4;
      data[i] = data[i+1] = data[i+2] = g;
      data[i+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

// Glass alpha mask: 1 at centre, falls to 0 at edges to create a narrow rim.
function makeGlassAlphaMask(size = 1024, edge = 0.17, feather = 0.11) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const smooth = (a,b,t) => {
    t = Math.min(1, Math.max(0, (t - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let y=0; y<size; y++) {
    const v = (y + 0.5) / size;
    for (let x=0; x<size; x++) {
      const u = (x + 0.5) / size;
      const d = Math.min(u, v, 1 - u, 1 - v);
      const a = 1 - smooth(edge, edge + feather, d);
      const g = Math.round(255 * a);
      const i = (y * size + x) * 4;
      data[i] = data[i+1] = data[i+2] = g;
      data[i+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

// Multiply two alpha maps (using the green channel) into one new map. This is used
// to combine the rounded mask with the glass gradient for the glass pane.
function multiplyAlphaMaps(aTex, bTex, size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // draw first texture
  const ca = document.createElement('canvas'); ca.width = ca.height = size;
  const ctxA = ca.getContext('2d'); ctxA.drawImage(aTex.image, 0, 0, size, size);
  const cb = document.createElement('canvas'); cb.width = cb.height = size;
  const ctxB = cb.getContext('2d'); ctxB.drawImage(bTex.image, 0, 0, size, size);
  const ia = ctxA.getImageData(0, 0, size, size).data;
  const ib = ctxB.getImageData(0, 0, size, size).data;
  const out = ctx.createImageData(size, size);
  const d = out.data;
  for (let i=0; i<d.length; i += 4) {
    const ga = ia[i+1] / 255;
    const gb = ib[i+1] / 255;
    const g  = Math.max(0, Math.min(1, ga * gb));
    d[i] = d[i+1] = d[i+2] = Math.round(255 * g);
    d[i+3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

// Compute the average colour of an image. Lighten the colour by mixing with white.
function computeAverageColor(image) {
  if (!image) return new THREE.Color(1,1,1);
  const w = image.width;
  const h = image.height;
  const cw = 32, ch = 32;
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  // downsample the image to speed up average computation
  ctx.drawImage(image, 0, 0, cw, ch);
  const data = ctx.getImageData(0,0,cw,ch).data;
  let r=0, g=0, b=0, count=cw*ch;
  for (let i=0; i<data.length; i+=4) {
    r += data[i];
    g += data[i+1];
    b += data[i+2];
  }
  r /= count;
  g /= count;
  b /= count;
  // lighten by mixing with white (60%) to get a vibrant tint
  const mixFactor = 0.6;
  r = r + (255 - r) * mixFactor;
  g = g + (255 - g) * mixFactor;
  b = b + (255 - b) * mixFactor;
  return new THREE.Color(r / 255, g / 255, b / 255);
}

// Precreate masks for reuse
const ROUNDED_MASK   = makeRoundedMask(1024, 0.04);
const EDGE_MASK      = makeEdgeMask(1024, 0.11, 0.09);
const GLASS_RAW_MASK = makeGlassAlphaMask(1024, 0.17, 0.11);
const GLASS_MASK     = multiplyAlphaMaps(GLASS_RAW_MASK, ROUNDED_MASK, 1024);
// Combine edge and rounded for the blur halo
const EDGE_ROUNDED_MASK = multiplyAlphaMaps(EDGE_MASK, ROUNDED_MASK, 1024);

// Create the glass material with the appropriate properties (A, D)
function makeGlassMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0.0,
    roughness: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    transmission: 0.0,
    thickness: 0.0,
    ior: 1.0,
    transparent: true,
    opacity: 0.12,
    alphaMap: GLASS_MASK,
    depthWrite: false
  });
  mat.envMapIntensity = 1.3;
  return mat;
}

// Fresnel edge glow (D): adds a subtle glow along the card edges
function makeFresnelEdgeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uIntensity: { value: 0.20 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uIntensity;
      float edgeDist(vec2 uv) {
        float d = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
        return d;
      }
      void main() {
        float d = edgeDist(vUv);
        float glow = smoothstep(0.12, 0.0, d) * uIntensity;
        gl_FragColor = vec4(1.0, 1.0, 1.0, glow);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false
  });
}

// Generate an automatic blurred texture from a loaded image using canvas. This
// function returns a promise resolving to a THREE.CanvasTexture.
async function makeAutoBlurFromTexture(image, radius = 16) {
  if (!image) return null;
  const w = image.width;
  const h = image.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(image, 0, 0, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

// Create a card group with layered materials: sharp image, blur halo, glass pane and fresnel glow.
function makeCardGroup(url) {
  const g = new THREE.Group();
  g.quaternion.copy(ROT);

  // Sharp layer: slightly smaller with rounded mask
  const sharpMat = new THREE.MeshBasicMaterial({
    map: null,
    transparent: true,
    opacity: 1.0,
    alphaMap: ROUNDED_MASK,
    depthTest: true,
    depthWrite: true
  });
  const sharp = new THREE.Mesh(planeGeo, sharpMat);
  sharp.position.z = 0;
  sharp.scale.set(0.96, 0.96, 1.0);
  sharp.renderOrder = 0;
  g.add(sharp);

  // Blur halo: narrow halo around edges using combined edge and rounded mask
  const haloMat = new THREE.MeshBasicMaterial({
    map: null,
    transparent: true,
    opacity: 0.40,
    alphaMap: EDGE_ROUNDED_MASK,
    depthTest: true,
    depthWrite: false
  });
  // Colour will be set later based on average colour of blurred image
  haloMat.color = new THREE.Color(1,1,1);
  const halo = new THREE.Mesh(planeGeo, haloMat);
  halo.position.z = +0.0006;
  halo.renderOrder = 1;
  g.add(halo);

  // Glass layer: uses glass material with narrow rim and reflections
  const glass = new THREE.Mesh(planeGeo, makeGlassMaterial());
  glass.position.z = +0.0016;
  glass.renderOrder = 2;
  g.add(glass);

  // Fresnel glow: very subtle highlight at the very edge
  const fresnel = new THREE.Mesh(planeGeo, makeFresnelEdgeMaterial());
  fresnel.position.z = +0.0017;
  fresnel.renderOrder = 3;
  g.add(fresnel);

  // Load main texture
  loadTexture(url, async tex => {
    sharpMat.map = tex;
    sharpMat.needsUpdate = true;
    const w = tex.image?.width || 1;
    const h = tex.image?.height || 1;
    g.scale.set((w/h) || 1, 1, 1);
    // After base image loaded, attempt to load blurred version
    const blurURL = deriveBlurURL(url);
    loadTexture(blurURL, btex => {
      btex.minFilter = THREE.LinearMipmapLinearFilter;
      haloMat.map = btex;
      haloMat.needsUpdate = true;
      halo.visible = true;
      // compute tinted colour from blurred image
      const avgColor = computeAverageColor(btex.image);
      haloMat.color.copy(avgColor);
    }, async () => {
      // if no separate blur exists, generate from base
      const auto = await makeAutoBlurFromTexture(tex.image, 16);
      if (auto) {
        haloMat.map = auto;
        haloMat.needsUpdate = true;
        halo.visible = true;
        const avgColor2 = computeAverageColor(auto.image);
        haloMat.color.copy(avgColor2);
      } else {
        halo.visible = false;
      }
    });
  });

  return g;
}

// === Main initialisation ===
function init(cards) {
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
  for (let i=0; i<cards.length; i++) {
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
  const mod = (a,n) => ((a % n) + n) % n;
  // Variables for inertial scrolling and zoom
  let offset = 0;
  let v = 0;
  let dragging = false;
  let lastY = 0, lastDY = 0;
  let touchY = null;
  let activity = 0;
  let lastWheelTime = 0;
  // Wheel scroll
  window.addEventListener('wheel', e => {
    v += e.deltaY * WHEEL_SENS;
    lastWheelTime = performance.now();
  }, { passive: true });
  // Mouse drag
  window.addEventListener('pointerdown', e => {
    dragging = true;
    lastY = e.clientY; lastDY = 0;
  });
  window.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dy = e.clientY - lastY; lastY = e.clientY; lastDY = dy;
    offset += dy * DRAG_SENS;
  });
  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    v += lastDY * DRAG_SENS * 0.4;
  });
  // Touch drag
  window.addEventListener('touchstart', e => {
    if (e.touches[0]) touchY = e.touches[0].clientY;
  }, { passive: true });
  window.addEventListener('touchmove', e => {
    if (!e.touches[0] || touchY == null) return;
    const dy = e.touches[0].clientY - touchY; touchY = e.touches[0].clientY;
    offset += dy * DRAG_SENS;
  }, { passive: true });
  window.addEventListener('touchend', () => {
    touchY = null;
  });
  // Animation loop
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    offset += v * dt;
    v *= Math.exp(-dt / V_TAU);
    // Determine whether user is active (scrolling) to apply zooming
    const now = performance.now();
    const targetActivity = (dragging || (now - lastWheelTime < 120) || Math.abs(v) > 0.002) ? 1 : 0;
    const k = (targetActivity > activity)
      ? (1 - Math.exp(-dt / ZOOM_T_ON))
      : (1 - Math.exp(-dt / ZOOM_T_OFF));
    activity += (targetActivity - activity) * k;
    const targetFov = baseFov + zoomFovAdd * activity;
    if (Math.abs(camera.fov - targetFov) > 1e-3) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }
    // Position cards along the rail
    for (const it of items) {
      const s = it.s0 - offset * stepLen;
      const sWrapped = sStart + mod(s - sStart, sTotal);
      const along = sWrapped + it.epsAlong;
      it.mesh.position.set(
        BASE.x + RIGHT_NUDGE,
        BASE.y + DOWN_NUDGE,
        BASE.z + BASE_Z_PULL
      ).add(it.perp).addScaledVector(dir, along);
    }
    renderer.render(scene, camera);
  });
}

// === Entry point: load cards.json and start ===
fetch('./cards.json')
  .then(r => r.json())
  .then(json => init(Array.isArray(json.cards) ? json.cards : []))
  .catch(() => init([]));
