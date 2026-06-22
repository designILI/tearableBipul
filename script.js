import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";

const canvas = document.querySelector("#artCanvas");
const resetButton = document.querySelector("#resetButton");
const layerStatus = document.querySelector("#layerStatus");
const tearSoundUrl = "assets/sounds/ripping-paper.mp3";
const tearSliceStarts = [0.35, 0.8, 1.2, 1.75, 2.4, 3.1, 3.8, 4.6, 5.4, 6.2, 7.1, 8, 8.9, 9.8, 10.7, 11.3];
const fallbackFinalTearSound = new Audio(tearSoundUrl);
const fallbackScratchTearSounds = Array.from({ length: 5 }, () => new Audio(tearSoundUrl));
fallbackFinalTearSound.preload = "auto";
fallbackScratchTearSounds.forEach((sound) => {
  sound.preload = "auto";
});
fallbackFinalTearSound.load();
fallbackScratchTearSounds.forEach((sound) => sound.load());
const tearAudioState = {
  context: null,
  buffer: null,
  loading: null,
  scratchIndex: 0,
  lastScratchAt: 0,
  scratchDistance: 0,
};
initializeTearAudio();

/*
  Replace these image paths with your own artwork files.
  The first item is the top layer. The last item is the deepest layer.
*/
const layerSources = [
  { image: "assets/layers/layer-01.jpeg", palette: ["#d9c4a0", "#7c725f", "#1a1714"], name: "Linen dusk" },
  { image: "assets/layers/layer-02.jpeg", palette: ["#9fc9ca", "#4f7f84", "#111f24"], name: "Blue mineral" },
  { image: "assets/layers/layer-03.jpeg", palette: ["#d7b2bc", "#965f70", "#24141b"], name: "Rose wash" },
  { image: "assets/layers/layer-04.jpeg", palette: ["#becb90", "#65764d", "#141b13"], name: "Olive field" },
  { image: "assets/layers/layer-05.jpeg", palette: ["#c9ac8f", "#8a5743", "#160f0c"], name: "Clay ember" },
];

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setClearColor(0x0f0e0c, 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 40);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);

scene.add(new THREE.AmbientLight(0xffffff, 1.25));

const keyLight = new THREE.DirectionalLight(0xffffff, 1.9);
keyLight.position.set(-2.5, 3.4, 7);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);

const sideLight = new THREE.DirectionalLight(0xbfdcff, 0.55);
sideLight.position.set(4, -1, 4);
scene.add(sideLight);

const state = {
  width: 1,
  height: 1,
  dpr: 1,
  worldWidth: 1,
  worldHeight: 1,
  layers: [],
  activeLayer: 0,
  pointers: new Map(),
  tearing: false,
  pointer: new THREE.Vector2(),
  head: new THREE.Vector2(),
  velocity: new THREE.Vector2(),
  lastHead: null,
  brush: 0.055,
  seam: [],
  tearPercent: 0,
  peelTransition: null,
};

const flap = {
  geometry: new THREE.BufferGeometry(),
  material: new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.96,
    side: THREE.DoubleSide,
    roughness: 0.92,
    metalness: 0,
    depthWrite: false,
  }),
  mesh: null,
};
flap.mesh = new THREE.Mesh(flap.geometry, flap.material);
flap.mesh.castShadow = true;
flap.mesh.renderOrder = 20;
flap.mesh.visible = false;
scene.add(flap.mesh);

function makeLayer(source, index) {
  const art = document.createElement("canvas");
  const mask = document.createElement("canvas");
  const artCtx = art.getContext("2d");
  const maskCtx = mask.getContext("2d");
  const artTexture = new THREE.CanvasTexture(art);
  const maskTexture = new THREE.CanvasTexture(mask);

  for (const texture of [artTexture, maskTexture]) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  const material = new THREE.MeshStandardMaterial({
    map: artTexture,
    alphaMap: maskTexture,
    transparent: true,
    alphaTest: 0.03,
    side: THREE.DoubleSide,
    roughness: 0.86,
    metalness: 0,
  });

  const geometry = new THREE.PlaneGeometry(2, 2, 96, 64);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = -index * 0.12;
  mesh.receiveShadow = true;
  mesh.castShadow = index === 0;
  mesh.renderOrder = layerSources.length - index;
  scene.add(mesh);

  return {
    ...source,
    index,
    art,
    artCtx,
    artTexture,
    mask,
    maskCtx,
    maskTexture,
    material,
    geometry,
    mesh,
    imageElement: null,
    hidden: false,
    peeling: false,
    peelStart: 0,
    basePositions: null,
  };
}

function setupLayers() {
  state.layers = layerSources.map(makeLayer);
  state.layers.forEach((layer) => {
    const image = new Image();
    image.onload = () => {
      layer.imageElement = image;
      paintLayer(layer);
      render();
    };
    image.onerror = () => {
      layer.imageElement = null;
      paintLayer(layer);
      render();
    };
    image.src = layer.image;
  });
}

function resize() {
  state.width = Math.max(1, window.innerWidth);
  state.height = Math.max(1, window.innerHeight);
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.worldWidth = state.width / state.height >= 1 ? state.width / state.height : 1;
  state.worldHeight = state.width / state.height >= 1 ? 1 : state.height / state.width;

  renderer.setPixelRatio(state.dpr);
  renderer.setSize(state.width, state.height, false);

  camera.left = -state.worldWidth;
  camera.right = state.worldWidth;
  camera.top = state.worldHeight;
  camera.bottom = -state.worldHeight;
  camera.updateProjectionMatrix();

  state.layers.forEach((layer) => {
    layer.art.width = Math.round(state.width * state.dpr);
    layer.art.height = Math.round(state.height * state.dpr);
    layer.mask.width = layer.art.width;
    layer.mask.height = layer.art.height;
    layer.artCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    layer.maskCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

    layer.geometry.dispose();
    layer.geometry = new THREE.PlaneGeometry(state.worldWidth * 2, state.worldHeight * 2, 112, 72);
    layer.mesh.geometry = layer.geometry;
    layer.basePositions = layer.geometry.attributes.position.array.slice();

    paintLayer(layer);
    resetMask(layer);
  });

  resetGesture();
  render();
}

function paintLayer(layer) {
  const ctx = layer.artCtx;
  ctx.clearRect(0, 0, state.width, state.height);

  if (layer.imageElement) {
    drawImageContain(ctx, layer.imageElement, state.width, state.height, layer.palette);
  } else {
    paintPlaceholder(ctx, layer);
  }

  addPaperFibers(ctx, layer.index);
  addVignette(ctx);
  layer.artTexture.needsUpdate = true;
}

function paintPlaceholder(ctx, layer) {
  const [light, mid, dark] = layer.palette;
  const gradient = ctx.createLinearGradient(0, 0, state.width, state.height);
  gradient.addColorStop(0, light);
  gradient.addColorStop(0.48, mid);
  gradient.addColorStop(1, dark);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);

  ctx.save();
  ctx.globalAlpha = 0.32;
  for (let i = 0; i < 18; i += 1) {
    const x = state.width * noise01(i * 13.71 + layer.index * 7.9);
    const y = state.height * noise01(i * 5.31 + layer.index * 11.4);
    const radius = Math.max(state.width, state.height) * (0.12 + noise01(i * 19.1) * 0.18);
    const wash = ctx.createRadialGradient(x, y, 0, x, y, radius);
    wash.addColorStop(0, "rgba(255, 250, 235, 0.42)");
    wash.addColorStop(1, "rgba(255, 250, 235, 0)");
    ctx.fillStyle = wash;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawImageContain(ctx, image, width, height, palette) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const [light, mid, dark] = palette;
  const matte = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.72);
  matte.addColorStop(0, light);
  matte.addColorStop(0.58, mid);
  matte.addColorStop(1, dark);
  ctx.fillStyle = matte;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function addPaperFibers(ctx, seed) {
  ctx.save();
  ctx.globalAlpha = 0.075;
  ctx.strokeStyle = "rgba(255, 248, 230, 0.48)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 42; i += 1) {
    const y = (state.height / 41) * i;
    ctx.beginPath();
    ctx.moveTo(-40, y);
    for (let x = -40; x < state.width + 80; x += 48) {
      ctx.lineTo(x, y + Math.sin(x * 0.011 + i * 0.77 + seed) * 8);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 0.055;
  for (let i = 0; i < 6000; i += 1) {
    const x = noise01(i * 16.93 + seed * 40.1) * state.width;
    const y = noise01(i * 8.17 + seed * 91.4) * state.height;
    ctx.fillStyle = "rgba(255, 248, 230, 0.52)";
    ctx.fillRect(x, y, 1, noise01(i * 0.41) > 0.72 ? 2 : 1);
  }
  ctx.restore();
}

function addVignette(ctx) {
  const gradient = ctx.createRadialGradient(
    state.width / 2,
    state.height / 2,
    Math.min(state.width, state.height) * 0.18,
    state.width / 2,
    state.height / 2,
    Math.max(state.width, state.height) * 0.75,
  );
  gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0.36)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);
}

function resetMask(layer) {
  layer.hidden = false;
  layer.peeling = false;
  layer.mesh.visible = true;
  layer.maskCtx.globalCompositeOperation = "source-over";
  layer.maskCtx.clearRect(0, 0, state.width, state.height);
  layer.maskCtx.fillStyle = "#fff";
  layer.maskCtx.fillRect(0, 0, state.width, state.height);
  layer.maskTexture.needsUpdate = true;
  restoreMesh(layer);
}

function pointerFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return new THREE.Vector2(event.clientX - rect.left, event.clientY - rect.top);
}

function beginPointer(event) {
  if (state.peelTransition || state.activeLayer >= state.layers.length - 1) return;

  unlockTearAudio();
  const point = pointerFromEvent(event);
  state.pointers.set(event.pointerId, point);
  state.pointer.copy(averagePointers());
  state.head.copy(state.pointer);
  state.velocity.set(0, 0);
  state.lastHead = null;
  state.seam = [];
  state.tearing = true;
  state.brush = clamp(Math.min(state.width, state.height) * 0.075, 44, 96);
  canvas.classList.add("is-tearing");
  canvas.setPointerCapture(event.pointerId);
}

function movePointer(event) {
  if (!state.pointers.has(event.pointerId)) return;
  state.pointers.set(event.pointerId, pointerFromEvent(event));
  state.pointer.copy(averagePointers());

  for (let i = 0; i < 3; i += 1) {
    advanceSpring();
    carveBetweenHeads();
  }
}

function endPointer(event) {
  state.pointers.delete(event.pointerId);
  if (state.pointers.size) {
    state.pointer.copy(averagePointers());
    return;
  }

  for (let i = 0; i < 10; i += 1) {
    advanceSpring();
    carveBetweenHeads();
  }
  state.tearing = false;
  canvas.classList.remove("is-tearing");
  maybeDropLayer();
  hideFlap();
}

function averagePointers() {
  const point = new THREE.Vector2();
  state.pointers.forEach((value) => point.add(value));
  return point.divideScalar(state.pointers.size || 1);
}

function animate() {
  requestAnimationFrame(animate);

  updatePeelTransition();

  if (state.tearing) {
    advanceSpring();
    carveBetweenHeads();
  }

  deformActiveMesh();
  updateFlap();
  render();
}

function render() {
  renderer.render(scene, camera);
}

function advanceSpring() {
  const pull = state.pointer.clone().sub(state.head).multiplyScalar(0.18);
  state.velocity.add(pull).multiplyScalar(0.72);
  state.head.add(state.velocity);
  const speed = state.velocity.length();
  state.brush = clamp(state.brush * 0.84 + (48 + Math.min(speed * 1.2, 58)) * 0.16, 40, 108);
}

function carveBetweenHeads() {
  const layer = state.layers[state.activeLayer];
  if (!layer || !state.tearing) return;

  if (!state.lastHead) {
    state.lastHead = state.head.clone();
    cutOrganicHole(layer, state.head, state.brush * 0.5);
    playScratchTearSound(state.brush);
    return;
  }

  const distance = state.head.distanceTo(state.lastHead);
  playScratchTearSound(distance);
  const steps = Math.max(1, Math.ceil(distance / 6));
  for (let i = 1; i <= steps; i += 1) {
    const point = state.lastHead.clone().lerp(state.head, i / steps);
    const radius = state.brush * (0.82 + Math.sin(point.x * 0.012 + point.y * 0.008) * 0.08);
    cutOrganicHole(layer, point, radius);
    addSeamPoint(point, radius);
  }
  state.lastHead.copy(state.head);
  layer.maskTexture.needsUpdate = true;
}

function cutOrganicHole(layer, point, radius) {
  const ctx = layer.maskCtx;
  const count = 36;

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  for (let i = 0; i <= count; i += 1) {
    const angle = (Math.PI * 2 * i) / count;
    const wobble = 0.94 + Math.sin(point.x * 0.009 + point.y * 0.011 + i * 0.7) * 0.06;
    const x = point.x + Math.cos(angle) * radius * wobble;
    const y = point.y + Math.sin(angle) * radius * wobble;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.38;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = radius * 0.95;
  ctx.strokeStyle = "#000";
  ctx.beginPath();
  ctx.moveTo(point.x - radius * 0.22, point.y);
  ctx.lineTo(point.x + radius * 0.22, point.y);
  ctx.stroke();

  const feather = ctx.createRadialGradient(point.x, point.y, radius * 0.48, point.x, point.y, radius * 1.35);
  feather.addColorStop(0, "rgba(0, 0, 0, 0.32)");
  feather.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.globalAlpha = 0.34;
  ctx.fillStyle = feather;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius * 1.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function addSeamPoint(point, radius) {
  const previous = state.seam[state.seam.length - 1] || point;
  const dx = point.x - previous.x;
  const dy = point.y - previous.y;
  const length = Math.hypot(dx, dy) || 1;
  const jitter = Math.sin(point.x * 0.015 + point.y * 0.013) * radius * 0.11;

  state.seam.push({
    x: point.x + (-dy / length) * jitter,
    y: point.y + (dx / length) * jitter,
    radius,
  });

  if (state.seam.length > 120) state.seam.splice(0, state.seam.length - 120);
}

function deformActiveMesh() {
  const layer = state.layers[state.activeLayer];
  if (!layer || !layer.basePositions) return;

  const positions = layer.geometry.attributes.position.array;
  const head = screenToWorld(state.head.x, state.head.y);
  const pointer = screenToWorld(state.pointer.x, state.pointer.y);
  const pull = pointer.clone().sub(head);
  const radius = state.brush * (state.worldWidth * 2 / state.width) * 4.2;

  for (let i = 0; i < positions.length; i += 3) {
    const baseX = layer.basePositions[i];
    const baseY = layer.basePositions[i + 1];
    const dx = baseX - head.x;
    const dy = baseY - head.y;
    const distance = Math.hypot(dx, dy);
    const influence = Math.max(0, 1 - distance / radius);
    const ease = influence * influence * (3 - 2 * influence);

    positions[i] = baseX + pull.x * ease * 0.18;
    positions[i + 1] = baseY + pull.y * ease * 0.18;
    positions[i + 2] = Math.sin(ease * Math.PI) * 0.18 + ease * 0.08;
  }

  layer.geometry.attributes.position.needsUpdate = true;
  layer.geometry.computeVertexNormals();
}

function restoreMesh(layer) {
  if (!layer.basePositions) return;
  layer.geometry.attributes.position.array.set(layer.basePositions);
  layer.geometry.attributes.position.needsUpdate = true;
  layer.geometry.computeVertexNormals();
}

function updateFlap() {
  const layer = state.layers[state.activeLayer];
  if (!state.tearing || !layer || state.seam.length < 4) {
    hideFlap();
    return;
  }

  const path = state.seam.slice(-46);
  const normal = recentNormal(path);
  const speed = state.velocity.length();
  const lift = clamp(speed * 0.006 + 0.08, 0.09, 0.34);
  const positions = [];
  const uvs = [];
  const indices = [];

  path.forEach((point, index) => {
    const world = screenToWorld(point.x, point.y);
    const width = (point.radius / state.width) * state.worldWidth * 2;
    const curl = Math.sin((index / Math.max(1, path.length - 1)) * Math.PI) * lift;
    const rough = Math.sin(point.x * 0.018 + point.y * 0.012) * width * 0.12;

    const inner = world.clone().addScaledVector(normal, -width * 0.38 + rough * 0.2);
    const outer = world.clone().addScaledVector(normal, width * 0.75 + curl + rough);
    const z = 0.34 + Math.sin(index * 0.45) * 0.018;

    positions.push(inner.x, inner.y, z * 0.45, outer.x, outer.y, z + curl * 0.55);
    uvs.push(point.x / state.width, 1 - point.y / state.height, point.x / state.width, 1 - point.y / state.height);

    if (index < path.length - 1) {
      const a = index * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });

  flap.geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  flap.geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  flap.geometry.setIndex(indices);
  flap.geometry.computeVertexNormals();
  flap.material.map = layer.artTexture;
  flap.material.needsUpdate = true;
  flap.mesh.visible = true;
}

function hideFlap() {
  flap.mesh.visible = false;
}

function recentNormal(path) {
  const first = screenToWorld(path[0].x, path[0].y);
  const last = screenToWorld(path[path.length - 1].x, path[path.length - 1].y);
  const direction = last.clone().sub(first);
  if (direction.lengthSq() < 0.0001) return new THREE.Vector2(0, 1);
  direction.normalize();

  const normal = new THREE.Vector2(-direction.y, direction.x);
  const toPointer = screenToWorld(state.pointer.x, state.pointer.y).sub(last);
  if (normal.dot(toPointer) < 0) normal.multiplyScalar(-1);
  return normal;
}

function maybeDropLayer() {
  const layer = state.layers[state.activeLayer];
  if (!layer || state.activeLayer >= state.layers.length - 1) {
    resetGesture();
    return;
  }

  state.tearPercent = estimateRevealed(layer);
  if (state.tearPercent > 0.35 || traveledSeamLength() > Math.max(state.width, state.height) * 1.2) {
    startCenterPeel(layer);
  }

  resetGesture();
}

function startCenterPeel(layer) {
  playFinalTearSound();
  layer.peeling = true;
  layer.peelStart = performance.now();
  state.peelTransition = { layer, startedAt: layer.peelStart, duration: 1100 };
  state.activeLayer += 1;
  updateStatus();
}

function playScratchTearSound(distance) {
  tearAudioState.scratchDistance += distance;
  const now = performance.now();
  if (tearAudioState.scratchDistance < 16 || now - tearAudioState.lastScratchAt < 55) return;

  tearAudioState.lastScratchAt = now;
  tearAudioState.scratchDistance = 0;

  playTearSlice({
    duration: 0.16 + Math.random() * 0.08,
    volume: 0.12 + Math.random() * 0.06,
    rate: 0.9 + Math.random() * 0.28,
  });
}

function playFinalTearSound() {
  playTearSlice({
    duration: 0.46 + Math.random() * 0.16,
    volume: 0.24,
    rate: 0.94 + Math.random() * 0.1,
  });
}

function unlockTearAudio() {
  initializeTearAudio();
  if (!tearAudioState.context) return;

  if (tearAudioState.context.state === "suspended") {
    tearAudioState.context.resume().catch(() => {});
  }
}

function initializeTearAudio() {
  if (!tearAudioState.context) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    tearAudioState.context = new AudioContextClass();
  }

  loadTearBuffer();
}

function loadTearBuffer() {
  if (tearAudioState.buffer || tearAudioState.loading || !tearAudioState.context) return;

  tearAudioState.loading = fetch(tearSoundUrl)
    .then((response) => response.arrayBuffer())
    .then((data) => tearAudioState.context.decodeAudioData(data))
    .then((buffer) => {
      tearAudioState.buffer = buffer;
    })
    .catch(() => {
      tearAudioState.loading = null;
    });
}

function playTearSlice({ duration, volume, rate }) {
  const context = tearAudioState.context;
  const buffer = tearAudioState.buffer;
  if (!context || !buffer || context.state !== "running") {
    playFallbackTearSlice({ duration, volume, rate });
    return;
  }

  const source = context.createBufferSource();
  const gain = context.createGain();
  const offset = pickTearSliceOffset(buffer.duration, duration);
  const now = context.currentTime;

  source.buffer = buffer;
  source.playbackRate.value = rate;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(gain).connect(context.destination);
  source.start(now, offset, duration);
}

function playFallbackTearSlice({ duration, volume, rate }) {
  const sound = duration > 0.3 ? fallbackFinalTearSound : fallbackScratchTearSounds[tearAudioState.scratchIndex];
  tearAudioState.scratchIndex = (tearAudioState.scratchIndex + 1) % fallbackScratchTearSounds.length;
  sound.pause();
  sound.currentTime = pickTearSliceOffset(12.24, duration);
  sound.volume = Math.min(volume, 0.3);
  sound.playbackRate = rate;
  sound
    .play()
    .then(() => {
      window.setTimeout(() => sound.pause(), duration * 1000 + 80);
    })
    .catch(() => {});
}

function pickTearSliceOffset(sourceDuration, sliceDuration) {
  const usableStarts = tearSliceStarts.filter((start) => start + sliceDuration < sourceDuration - 0.05);
  if (!usableStarts.length) return 0;
  return usableStarts[Math.floor(Math.random() * usableStarts.length)];
}

function updatePeelTransition() {
  const transition = state.peelTransition;
  if (!transition) return;

  const { layer, startedAt, duration } = transition;
  const progress = clamp((performance.now() - startedAt) / duration, 0, 1);
  const eased = easeInOutCubic(progress);
  const cx = state.width / 2;
  const cy = state.height / 2;
  const radius = Math.hypot(state.width, state.height) * (0.08 + eased * 0.74);

  layer.maskCtx.save();
  layer.maskCtx.globalCompositeOperation = "destination-out";
  const gradient = layer.maskCtx.createRadialGradient(cx, cy, radius * 0.62, cx, cy, radius);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.72)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  layer.maskCtx.fillStyle = gradient;
  layer.maskCtx.beginPath();
  layer.maskCtx.arc(cx, cy, radius, 0, Math.PI * 2);
  layer.maskCtx.fill();
  layer.maskCtx.restore();
  layer.maskTexture.needsUpdate = true;

  peelMeshFromCenter(layer, eased);

  if (progress >= 1) {
    layer.peeling = false;
    layer.hidden = true;
    layer.mesh.visible = false;
    state.peelTransition = null;
    restoreMesh(layer);
  }
}

function peelMeshFromCenter(layer, progress) {
  if (!layer.basePositions) return;

  const positions = layer.geometry.attributes.position.array;
  const maxDistance = Math.hypot(state.worldWidth, state.worldHeight);
  const opening = progress * maxDistance * 1.55;

  for (let i = 0; i < positions.length; i += 3) {
    const baseX = layer.basePositions[i];
    const baseY = layer.basePositions[i + 1];
    const distance = Math.hypot(baseX, baseY);
    const local = clamp((opening - distance + 0.28) / 0.56, 0, 1);
    const lift = local * local * (3 - 2 * local);
    const dirX = distance > 0.001 ? baseX / distance : 0;
    const dirY = distance > 0.001 ? baseY / distance : 0;

    positions[i] = baseX + dirX * lift * progress * 0.18;
    positions[i + 1] = baseY + dirY * lift * progress * 0.18;
    positions[i + 2] = lift * (0.16 + progress * 0.5);
  }

  layer.geometry.attributes.position.needsUpdate = true;
  layer.geometry.computeVertexNormals();
}

function estimateRevealed(layer) {
  const data = layer.maskCtx.getImageData(0, 0, layer.mask.width, layer.mask.height).data;
  const stride = Math.max(1, Math.floor((layer.mask.width * layer.mask.height) / 9000));
  let clear = 0;
  let total = 0;
  for (let i = 3; i < data.length; i += 4 * stride) {
    total += 1;
    if (data[i] < 20) clear += 1;
  }
  return total ? clear / total : 0;
}

function traveledSeamLength() {
  let total = 0;
  for (let i = 1; i < state.seam.length; i += 1) {
    total += Math.hypot(state.seam[i].x - state.seam[i - 1].x, state.seam[i].y - state.seam[i - 1].y);
  }
  return total;
}

function screenToWorld(x, y) {
  return new THREE.Vector2(
    (x / state.width - 0.5) * state.worldWidth * 2,
    (0.5 - y / state.height) * state.worldHeight * 2,
  );
}

function resetGesture() {
  state.tearing = false;
  state.pointers.clear();
  state.lastHead = null;
  state.seam = [];
  state.velocity.set(0, 0);
  tearAudioState.scratchDistance = 0;
  tearAudioState.lastScratchAt = 0;
  canvas.classList.remove("is-tearing");
  hideFlap();
  state.layers.forEach((layer) => {
    if (!layer.peeling) restoreMesh(layer);
  });
}

function resetArtwork() {
  state.peelTransition = null;
  state.activeLayer = 0;
  state.layers.forEach(resetMask);
  resetGesture();
  updateStatus();
}

function updateStatus() {
  layerStatus.textContent = `Layer ${Math.min(state.activeLayer + 1, state.layers.length)} of ${state.layers.length}`;
}

function noise01(value) {
  const result = Math.sin(value * 127.1 + 311.7) * 43758.5453123;
  return result - Math.floor(result);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function easeInOutCubic(value) {
  return value < 0.5 ? 4 * value ** 3 : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

window.addEventListener("resize", resize);
canvas.addEventListener("pointerdown", beginPointer);
canvas.addEventListener("pointermove", movePointer);
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
resetButton.addEventListener("click", resetArtwork);

setupLayers();
resize();
animate();
