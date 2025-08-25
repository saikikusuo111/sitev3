// main.js — Glass Cards v3.5
// Объёмные рёбра (top+right), цвет берём из карточки, артефакты прибиты, картинки снова на месте.

(function(){
'use strict';

const NEAR=0.1, FAR=1000, BASE_FOV_DEG=5, ZOOM_FOV_ADD=1.2;
const root=document.getElementById('app')||document.body;

const renderer=new THREE.WebGLRenderer({antialias:true, alpha:false, powerPreference:'high-performance'});
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.setPixelRatio(window.devicePixelRatio||1);
renderer.setClearColor(0xf3f3f3,1);
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.2;
root.appendChild(renderer.domElement);

const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(BASE_FOV_DEG,1,NEAR,FAR);
camera.position.set(0,0,0); camera.lookAt(0,0,-1);

scene.add(new THREE.AmbientLight(0xffffff,0.7));
const key=new THREE.DirectionalLight(0xffffff,0.65); key.position.set(3,3,2); scene.add(key);
const fill=new THREE.DirectionalLight(0xffffff,0.35); fill.position.set(-3,2,1); scene.add(fill);

function resize(){ renderer.setSize(window.innerWidth,window.innerHeight,true); camera.aspect=window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); }
window.addEventListener('resize',resize); resize();

// ===== геометрия «поезда» =====
const BASE=new THREE.Vector3(3.945,2.867638,-44.981224);
const STEP=new THREE.Vector3(-0.375,-0.272589,0.715546);
const ROT=new THREE.Quaternion(0.174819586,-0.254544801,-0.046842770,0.949974111);
const RIGHT_NUDGE=0.0, DOWN_NUDGE=0.0, BASE_Z_PULL=+8.0, WRAP_SPAN=3, EPS_Z=0.0008;

// ===== навигация =====
const V_TAU=0.18, ZOOM_T_ON=0.10, ZOOM_T_OFF=0.16;
const WHEEL_SENS=0.0020, DRAG_SENS=0.0100;

// ===== вспомогательные карты =====
function makeRoundedMask(size=1024,radiusNorm=0.045){
  const c=document.createElement('canvas'); c.width=c.height=size;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  const r=radiusNorm*size;
  ctx.fillStyle='#fff'; ctx.beginPath();
  ctx.moveTo(r,0); ctx.lineTo(size-r,0); ctx.quadraticCurveTo(size,0,size,r);
  ctx.lineTo(size,size-r); ctx.quadraticCurveTo(size,size,size-r,size);
  ctx.lineTo(r,size); ctx.quadraticCurveTo(0,size,0,size-r);
  ctx.lineTo(0,r); ctx.quadraticCurveTo(0,0,r,0); ctx.closePath(); ctx.fill();
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.NoColorSpace; t.minFilter=THREE.LinearMipmapLinearFilter; t.magFilter=THREE.LinearFilter; t.generateMipmaps=true; return t;
}
function makeCenterFalloffMask(size=1024,edge=0.10,feather=0.22){
  const c=document.createElement('canvas'); c.width=c.height=size;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  const img=ctx.createImageData(size,size),d=img.data; const S=(a,b,x)=>{x=Math.min(1,Math.max(0,(x-a)/(b-a)));return x*x*(3-2*x);};
  for(let y=0;y<size;y++){const v=(y+0.5)/size;
    for(let x=0;x<size;x++){const u=(x+0.5)/size;
      const dist=Math.min(u,v,1-u,1-v); let a=S(edge,edge+feather,dist);
      const R=Math.hypot(u-0.5,v-0.5), corner=S(0.30,0.75,R); a=Math.max(0,Math.min(1,a*(1-0.12*corner)));
      const g=(a*255)|0, k=(y*size+x)*4; d[k]=d[k+1]=d[k+2]=g; d[k+3]=255;}}
  ctx.putImageData(img,0,0);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.NoColorSpace; t.minFilter=THREE.LinearMipmapLinearFilter; t.magFilter=THREE.LinearFilter; t.generateMipmaps=true; return t;
}
function multiplyAlphaMaps(aTex,bTex,size=1024){
  const c=document.createElement('canvas'); c.width=c.height=size; const ctx=c.getContext('2d',{willReadFrequently:true});
  const ca=document.createElement('canvas'); ca.width=ca.height=size; const xa=ca.getContext('2d',{willReadFrequently:true}); xa.drawImage(aTex.image,0,0,size,size);
  const cb=document.createElement('canvas'); cb.width=cb.height=size; const xb=cb.getContext('2d',{willReadFrequently:true}); xb.drawImage(bTex.image,0,0,size,size);
  const ia=xa.getImageData(0,0,size,size).data, ib=xb.getImageData(0,0,size,size).data;
  const out=ctx.createImageData(size,size), d=out.data;
  for(let i=0;i<d.length;i+=4){const g=Math.max(0,Math.min(1,(ia[i]/255)*(ib[i]/255))); const v=(g*255)|0; d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;}
  ctx.putImageData(out,0,0);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.NoColorSpace; t.minFilter=THREE.LinearMipmapLinearFilter; t.magFilter=THREE.LinearFilter; t.generateMipmaps=true; return t;
}
function remapAlpha(tex,minAlpha=0.75,size=1024){
  const src=tex.image; const c=document.createElement('canvas'); c.width=c.height=size;
  const ctx=c.getContext('2d',{willReadFrequently:true}); ctx.drawImage(src,0,0,size,size);
  const img=ctx.getImageData(0,0,size,size),d=img.data; const A=minAlpha,B=1-minAlpha;
  for(let i=0;i<d.length;i+=4){const r=A+B*(d[i]/255); const v=(r*255)|0; d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;}
  ctx.putImageData(img,0,0);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.NoColorSpace; t.minFilter=THREE.LinearMipmapLinearFilter; t.magFilter=THREE.LinearFilter; t.generateMipmaps=true; return t;
}
// маска «сверху+справа»
function makeEdgeMaskTopRight(size=1024,band=0.16,feather=0.18,offset=0){
  const c=document.createElement('canvas'); c.width=c.height=size;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  const img=ctx.createImageData(size,size), d=img.data; const S=(a,b,x)=>{x=Math.min(1,Math.max(0,(x-a)/(b-a)));return x*x*(3-2*x);};
  for(let y=0;y<size;y++){const v=(y+0.5)/size;
    for(let x=0;x<size;x++){const u=(x+0.5)/size;
      const t0=1-band-feather-offset, t1=1-band-offset, t2=1-feather-offset, t3=1-offset;
      const top=S(t0,t1,v)*S(t2,t3,v);
      const r0=1-band-feather-offset, r1=1-band-offset, r2=1-feather-offset, r3=1-offset;
      const right=S(r0,r1,u)*S(r2,r3,u);
      const a=Math.max(top,right);
      const g=(a*255)|0, k=(y*size+x)*4; d[k]=d[k+1]=d[k+2]=g; d[k+3]=255;}}
  ctx.putImageData(img,0,0);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.NoColorSpace; t.minFilter=THREE.LinearMipmapLinearFilter; t.magFilter=THREE.LinearFilter; t.generateMipmaps=true; return t;
}

const ROUNDED=makeRoundedMask(1024,0.045);
const CENTER =makeCenterFalloffMask(1024,0.10,0.22);
const ALPHA_SOFT = remapAlpha(multiplyAlphaMaps(ROUNDED,CENTER,1024),0.78,1024);

// две карты: внешняя подсветка и внутренняя тень (для объёма)
const EDGE_HILIGHT = makeEdgeMaskTopRight(1024,0.14,0.16,0.00);
const EDGE_SHADOW  = makeEdgeMaskTopRight(1024,0.18,0.18,0.10);

// ===== материалы =====
const planeGeo=new THREE.PlaneGeometry(1,1);
const texLoader=new THREE.TextureLoader();
function loadTexture(url,ok,err){ if(!url){err&&err();return;} texLoader.load(url,(t)=>{t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=4; t.minFilter=THREE.LinearMipmapLinearFilter; ok&&ok(t);},undefined,()=>err&&err()); }

function matImage(){ return new THREE.MeshBasicMaterial({ map:null, transparent:true, alphaMap:ALPHA_SOFT, depthTest:true, depthWrite:true }); }

function matGlassFront(){ return new THREE.MeshPhysicalMaterial({
  color:0xffffff, metalness:0, roughness:0.05, transmission:1, thickness:0.07, ior:1.45,
  clearcoat:1, clearcoatRoughness:0.03, attenuationColor:new THREE.Color(0xEEF3F7),
  attenuationDistance:6, envMapIntensity:1, transparent:true, opacity:0.11,
  alphaMap:ALPHA_SOFT, depthWrite:false
});}
function matGlassBack(){  return new THREE.MeshPhysicalMaterial({
  color:0xffffff, metalness:0, roughness:0.08, transmission:1, thickness:0.10, ior:1.45,
  clearcoat:1, clearcoatRoughness:0.05, attenuationColor:new THREE.Color(0xEEF3F7),
  attenuationDistance:6, envMapIntensity:1, transparent:true, opacity:0.08,
  alphaMap:ALPHA_SOFT, depthWrite:false
});}

// ——— ОБЪЁМНЫЕ РЁБРА ———
function matEdgeHighlight(color=0xffffff){
  return new THREE.MeshBasicMaterial({
    color,
    transparent:true,
    opacity:0.30,
    alphaMap:EDGE_HILIGHT,
    blending:THREE.AdditiveBlending,
    depthWrite:false
  });
}
function matEdgeShadow(){
  return new THREE.MeshBasicMaterial({
    color:0x000000,
    transparent:true,
    opacity:0.22,
    alphaMap:EDGE_SHADOW,
    blending:THREE.MultiplyBlending,
    depthWrite:false
  });
}

// ===== толщина/порядок (без артефактов) =====
const EDGE_SHIFT=0.008;
const Z_OFF_FRONT=+0.0022, Z_OFF_BACK=-0.0026;
const FRONT_SCALE=0.9925;
const BACK_SCALE =1.0200;
const HILIGHT_Z  =+0.0032;
const SHADOW_Z   =+0.0026;
const HILIGHT_SCALE=1.012;
const SHADOW_SCALE =1.006;

// ===== выбор доминирующего цвета по правому и верхнему краю =====
function sampleEdgeColor(tex){
  const img=tex.image;
  const w=img.naturalWidth||img.videoWidth||img.width;
  const h=img.naturalHeight||img.videoHeight||img.height;
  const can=document.createElement('canvas'); can.width=w; can.height=h;
  const ctx=can.getContext('2d',{willReadFrequently:true}); ctx.drawImage(img,0,0,w,h);
  const s=Math.max(2,Math.round(Math.min(w,h)*0.01));
  const right=ctx.getImageData(w-s,0,s,h).data;
  const top  =ctx.getImageData(0,0,w,s).data;
  let r=0,g=0,b=0,cnt=0;
  for(let i=0;i<right.length;i+=4){ r+=right[i]; g+=right[i+1]; b+=right[i+2]; cnt++; }
  for(let i=0;i<top.length;i+=4){ r+=top[i]; g+=top[i+1]; b+=top[i+2]; cnt++; }
  r/=cnt; g/=cnt; b/=cnt;
  const srgbToLin=x=>{x/=255; return (x<=0.04045)? x/12.92 : Math.pow((x+0.055)/1.055,2.4);};
  const linToSrgb=x=>{return (x<=0.0031308)? 12.92*x : 1.055*Math.pow(x,1/2.4)-0.055;};
  let rl=srgbToLin(r), gl=srgbToLin(g), bl=srgbToLin(b);
  const avg=(rl+gl+bl)/3, sat=0.45;
  rl = avg*(1-sat) + rl*sat;
  gl = avg*(1-sat) + gl*sat;
  bl = avg*(1-sat) + bl*sat;
  r = linToSrgb(rl); g = linToSrgb(gl); b = linToSrgb(bl);
  return new THREE.Color(r,g,b);
}

function makeCard(url){
  const g=new THREE.Group(); g.quaternion.copy(ROT);

  const mImg=matImage(); const img=new THREE.Mesh(new THREE.PlaneGeometry(1,1),mImg); img.position.z=0; g.add(img);

  const glassF=new THREE.Mesh(new THREE.PlaneGeometry(1,1),matGlassFront());
  glassF.position.set(-EDGE_SHIFT,-EDGE_SHIFT,Z_OFF_FRONT);
  glassF.scale.set(FRONT_SCALE,FRONT_SCALE,1); g.add(glassF);

  const glassB=new THREE.Mesh(new THREE.PlaneGeometry(1,1),matGlassBack());
  glassB.position.set(+EDGE_SHIFT,+EDGE_SHIFT,Z_OFF_BACK);
  glassB.scale.set(BACK_SCALE,BACK_SCALE,1); g.add(glassB);

  const hi=new THREE.Mesh(new THREE.PlaneGeometry(1,1),matEdgeHighlight(0xffffff));
  hi.position.set(-EDGE_SHIFT*0.55,-EDGE_SHIFT*0.55,HILIGHT_Z);
  hi.scale.set(HILIGHT_SCALE,HILIGHT_SCALE,1); g.add(hi);

  const sh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),matEdgeShadow());
  sh.position.set(-EDGE_SHIFT*0.50,-EDGE_SHIFT*0.50,SHADOW_Z);
  sh.scale.set(SHADOW_SCALE,SHADOW_SCALE,1); g.add(sh);

  glassB.renderOrder = 0;
  img.renderOrder    = 1;
  sh.renderOrder     = 2;
  hi.renderOrder     = 3;
  glassF.renderOrder = 4;

  loadTexture(url,(tex)=>{
    mImg.map=tex; mImg.needsUpdate=true; tex.needsUpdate=true;
    const w=tex.image?.width||1, h=tex.image?.height||1; g.scale.set((w/h)||1,1,1);
    const edgeColor = sampleEdgeColor(tex);
    hi.material.color.copy(edgeColor);
  });

  return g;
}

// ===== загрузка карточек =====
fetch('./cards.json')
  .then(r=>r.json())
  .then(j=>init(Array.isArray(j.cards)?j.cards:[]))
  .catch(()=>init([]));

function pickCardUrl(item){
  // Не ломаем твой формат: поддержка {url}, {src}, или просто строка
  if(typeof item==='string') return item;
  return item?.url ?? item?.src ?? null;
}

function init(cards){
  const dir=STEP.clone().normalize(); const stepLen=STEP.length();
  const baseNudged=new THREE.Vector3(BASE.x+RIGHT_NUDGE,BASE.y+DOWN_NUDGE,BASE.z+BASE_Z_PULL);

  const train=new THREE.Group(); scene.add(train);
  const items=[]; const tmp=new THREE.Vector3(), tmp2=new THREE.Vector3();

  for(let i=0;i<cards.length;i++){
    const url=pickCardUrl(cards[i]);                 // <-- фикс, чтобы картинки подгружались всегда
    const card=makeCard(url);

    const basePos=tmp.copy(baseNudged).addScaledVector(STEP,i);
    const fromBase=tmp2.copy(basePos).sub(baseNudged);
    const s0=fromBase.dot(dir);
    const perp=fromBase.addScaledVector(dir,-s0).clone();
    const epsAlong=-EPS_Z*i;

    card.position.copy(baseNudged).add(perp).addScaledVector(dir, s0+epsAlong);

    const roBase=i*10;
    card.traverse(o=>{ if(o.isMesh){ o.renderOrder += roBase; } });

    train.add(card); items.push({mesh:card,s0,perp,epsAlong});
  }

  const sValues=items.map(it=>it.s0).sort((a,b)=>a-b);
  const firstS=sValues.length?sValues[0]:0;
  const wrapLen=stepLen*Math.max(1,items.length);
  const sStart=firstS-wrapLen*((WRAP_SPAN-1)/2);
  const sTotal=wrapLen*WRAP_SPAN;
  const mod=(a,n)=>((a%n)+n)%n;

  let offset=0, v=0, dragging=false, lastY=0, lastDY=0, activity=0, lastWheelTime=0;
  window.addEventListener('wheel',(e)=>{v+=e.deltaY*WHEEL_SENS; lastWheelTime=performance.now();},{passive:true});
  window.addEventListener('pointerdown',(e)=>{dragging=true; lastY=e.clientY; lastDY=0;});
  window.addEventListener('pointermove',(e)=>{ if(!dragging)return; const dy=e.clientY-lastY; lastY=e.clientY; lastDY=dy; offset+=dy*DRAG_SENS; });
  window.addEventListener('pointerup',()=>{ if(!dragging)return; dragging=false; v+=lastDY*DRAG_SENS*0.4; });

  const clock=new THREE.Clock();
  renderer.setAnimationLoop(()=>{
    const dt=Math.min(clock.getDelta(),0.05);
    offset+=v*dt; v*=Math.exp(-dt/V_TAU);

    const now=performance.now();
    const targetActivity=(dragging||(now-lastWheelTime<120)||Math.abs(v)>0.002)?1:0;
    const k=(targetActivity>activity)?(1-Math.exp(-dt/ZOOM_T_ON)):(1-Math.exp(-dt/ZOOM_T_OFF));
    activity+=(targetActivity-activity)*k;

    const fov=BASE_FOV_DEG+ZOOM_FOV_ADD*activity;
    if(Math.abs(camera.fov-fov)>1e-4){ camera.fov=fov; camera.updateProjectionMatrix(); }

    const sShift=offset*stepLen;
    for(const it of items){
      const s=it.s0-sShift;
      const sWrapped=sStart+mod(s-sStart,sTotal);
      const along=sWrapped+it.epsAlong;
      it.mesh.position.copy(baseNudged).add(it.perp).addScaledVector(STEP.clone().normalize(),along);
    }
    renderer.render(scene,camera);
  });
}

})(); // IIFE end
