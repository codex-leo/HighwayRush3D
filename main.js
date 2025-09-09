import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';

// === Scene Setup ===
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, -15);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const renderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight);
const renderScene = new THREE.Scene();
const renderCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const renderMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tDiffuse: { value: null },
    opacity: { value: 0.85 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float opacity;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      gl_FragColor = opacity * texel;
    }
  `,
  transparent: true,
});

const renderQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), renderMaterial);
renderScene.add(renderQuad);

const light = new THREE.HemisphereLight(0xffffff, 0x88bbff, 1.2);
scene.add(light);

// === Sunlight (DirectionalLight for shadows) ===
const sunLight = new THREE.DirectionalLight(0xfff6e0, 1.5);
sunLight.position.set(0, 50, -100);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 1024;
sunLight.shadow.mapSize.height = 1024;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 200;
scene.add(sunLight);

// === Sky ===
const sky = new Sky();
sky.scale.setScalar(450000);
scene.add(sky);

const skyUniforms = sky.material.uniforms;
// Beautiful sunrise parameters
skyUniforms["turbidity"].value = 18;         // More haze for sunrise
skyUniforms["rayleigh"].value = 4;           // Stronger blue scattering
skyUniforms["mieCoefficient"].value = 0.02;  // More sun glow
skyUniforms["mieDirectionalG"].value = 0.85; // Sun glow directionality

const sun = new THREE.Vector3();
// Set sun low on the horizon for sunrise
const phi = THREE.MathUtils.degToRad(90 - 8);    // 8 degrees above horizon
const theta = THREE.MathUtils.degToRad(100);     // East-ish direction
sun.setFromSphericalCoords(1, phi, theta);
sky.material.uniforms["sunPosition"].value.copy(sun);

// --- Sun mesh for visual effect ---
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(2, 32, 32),
  new THREE.MeshBasicMaterial({ color: 0xffbb66, emissive: 0xffbb66 })
);
sunMesh.position.set(
  30 * Math.sin(theta) * Math.sin(phi),
  30 * Math.cos(phi),
  30 * Math.cos(theta) * Math.sin(phi) - 100
);
scene.add(sunMesh);

// === Texture Loader ===
const textureLoader = new THREE.TextureLoader();
const roadTexture = textureLoader.load('assets/road_texture.png');
roadTexture.wrapS = roadTexture.wrapT = THREE.RepeatWrapping;
roadTexture.repeat.set(1, 20);
roadTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

const dustTexture = textureLoader.load('assets/dust.png');
dustTexture.wrapS = dustTexture.wrapT = THREE.RepeatWrapping;
dustTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

// === Motion Blur Material Helper ===
function createBlurredMaterial(baseMaterial, speedFactor) {
  const material = baseMaterial.clone();
  material.opacity = Math.max(1 + speedFactor * 100, 0.5);
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  return material;
}

// === Dust Trails Group ===
const dustGroup = new THREE.Group();
scene.add(dustGroup);

let wasSwitchingLane = false;
function createDustTrail() {
  const blurMaterial = new THREE.SpriteMaterial({
    map: dustTexture,
    transparent: true,
    opacity: THREE.MathUtils.randFloat(0.2, 0.4),
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const dust = new THREE.Sprite(blurMaterial);
  dust.scale.set(THREE.MathUtils.randFloat(0.5, 1.5), THREE.MathUtils.randFloat(0.5, 1.5), 1);
  dust.position.copy(playerCar.position).add(new THREE.Vector3(THREE.MathUtils.randFloat(-0.5, 0.5), 0.1, -1));
  dustGroup.add(dust);

  const fadeDuration = 500;
  const startTime = performance.now();
  function fadeOut() {
    const elapsed = performance.now() - startTime;
    const alpha = 1 - (elapsed / fadeDuration);
    if (alpha <= 0) {
      dustGroup.remove(dust);
    } else {
      dust.material.opacity = alpha * 0.4;
      requestAnimationFrame(fadeOut);
    }
  }
  fadeOut();
}

// === Road Edge Blur ===
const blurGeometry = new THREE.PlaneGeometry(3, 300);
const blurMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2 });
const leftBlur = new THREE.Mesh(blurGeometry, blurMaterial);
leftBlur.rotation.x = -Math.PI / 2;
leftBlur.position.set(-5.5, 0.01, 0);
scene.add(leftBlur);

const rightBlur = new THREE.Mesh(blurGeometry, blurMaterial);
rightBlur.rotation.x = -Math.PI / 2;
rightBlur.position.set(5.5, 0.01, 0);
scene.add(rightBlur);

// === Score Display ===
const scoreElement = document.createElement('div');
scoreElement.style.position = 'fixed';
scoreElement.style.top = '20px';
scoreElement.style.left = '20px';
scoreElement.style.fontSize = '2em';
scoreElement.style.color = '#fff';
scoreElement.style.fontFamily = 'Courier New, monospace';
document.body.appendChild(scoreElement);

// === Game State ===
let gameStarted = false;
let isGameOver = false;
let playerCar = null;
let playerCarLoaded = false;
let currentLane = 0;
const laneWidth = 2;
let score = 0;
let highScore = localStorage.getItem('highScore') || 0;
const trafficCars = [];
const lanes = [-2, 0, 2];
let spawnTimer = 0;
let spawnInterval = 60;
let roadSpeed = 0.5;
let gameSpeed = 0.5;
const laneSfx = new Audio('assets/-110063.mp3');
laneSfx.volume = 0.5;
// Play only a cropped portion (e.g., start at 0.1s, play 0.18s)
function playLaneSfxCropped() {
  try {
    laneSfx.currentTime = 0.8;
    laneSfx.play();
    // Stop after 0.18s for a short, crisp effect
    setTimeout(() => {
      laneSfx.pause();
      laneSfx.currentTime = 0;
    }, 180);
  } catch (err) {}
}

// === Start Menu ===
const startOverlay = document.createElement('div');
startOverlay.style.position = 'fixed';
startOverlay.style.top = '0';
startOverlay.style.left = '0';
startOverlay.style.width = '100%';
startOverlay.style.height = '100%';
startOverlay.style.background = 'rgba(0, 0, 0, 0.9)';
startOverlay.style.display = 'flex';
startOverlay.style.flexDirection = 'column';
startOverlay.style.justifyContent = 'center';
startOverlay.style.alignItems = 'center';
startOverlay.style.color = '#fff';
startOverlay.style.zIndex = '10';
startOverlay.className = 'start-overlay';
startOverlay.innerHTML = `
  <h1 style="font-size: 4em; margin-bottom: 20px;">HighwayRush</h1>
  <div class="subtitle">Race, Dodge, Survive!</div>
  <div class="developer-credit">by DSR STUDIOS</div>
  <button id="startBtn" style="padding: 15px 30px; font-size: 1.5em; background: #0f0; border: none; cursor: pointer;">Start Game</button>
`;
document.body.appendChild(startOverlay);

document.getElementById('startBtn').addEventListener('click', () => {
  if (playerCarLoaded) {
    gameStarted = true;
    startOverlay.remove();
  } else {
    const wait = setInterval(() => {
      if (playerCarLoaded) {
        gameStarted = true;
        startOverlay.remove();
        clearInterval(wait);
      }
    }, 100);
  }
});

// === Road ===
const roadGroup = new THREE.Group();
const roadSegments = [];
for (let i = 0; i < 3; i++) {
  const segment = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 100),
    new THREE.MeshPhongMaterial({ map: roadTexture })
  );
  segment.rotation.x = -Math.PI / 2;
  segment.position.z = i * -100;
  segment.receiveShadow = true;
  roadGroup.add(segment);
  roadSegments.push(segment);
}
scene.add(roadGroup);

// === Lane Lines (animated) ===
const lineMaterialBase = new THREE.MeshBasicMaterial({ color: 0xffffff });
const laneLines = [];
for (let z = -150; z <= 150; z += 5) {
  for (let x of [-2, 0, 2]) {
    const blurLineMat = createBlurredMaterial(lineMaterialBase, gameSpeed);
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.01, 1), blurLineMat);
    line.position.set(x, 0.01, z);
    roadGroup.add(line);
    laneLines.push(line);
  }
}

// === Load Player Car Model ===
const loader = new GLTFLoader();
loader.load('./assets/carModel.glb', (gltf) => {
  playerCar = gltf.scene;
  const box = new THREE.Box3().setFromObject(playerCar);
  const size = box.getSize(new THREE.Vector3());
  const targetSize = new THREE.Vector3(4, 1, 8);
  const scale = Math.min(
    targetSize.x / size.x,
    targetSize.y / size.y,
    targetSize.z / size.z
  );
  playerCar.scale.setScalar(scale);
  playerCar.position.set(0, 0,-10);
  playerCar.rotation.y = 90 * (Math.PI / 180);
  playerCar.traverse(obj => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      if (obj.material && obj.material.color) {
        obj.material.color.offsetHSL(0.05, 0.1, 0.1); // Slightly warm
        obj.material.shininess = 80;
      }
    }
  });
  scene.add(playerCar);
  playerCarLoaded = true;
  camera.lookAt(playerCar.position.x, 0, playerCar.position.z + 10);
}, undefined, () => {
  console.error('Failed to load player model. Using fallback box.');
  playerCar = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 2),
    new THREE.MeshPhongMaterial({ color: 0x00ff00, shininess: 100 })
  );
  playerCar.position.set(0, 0.5, -10);
  playerCar.castShadow = true;
  playerCar.receiveShadow = true;
  scene.add(playerCar);
  playerCarLoaded = true;
  camera.lookAt(playerCar.position.x, 0, playerCar.position.z + 10);
});

// === Controls ===
document.addEventListener('keydown', (e) => {
  const prevLane = currentLane;
  if (e.key === 'ArrowLeft' && currentLane < 1) currentLane++;
  if (e.key === 'ArrowRight' && currentLane > -1) currentLane--;
  if (currentLane !== prevLane) {
    wasSwitchingLane = true;
    playLaneSfxCropped();
  }
});

// === Mobile Controls Overlay ===
const mobileControls = document.createElement('div');
mobileControls.style.position = 'fixed';
mobileControls.style.bottom = '30px';
mobileControls.style.left = '50%';
mobileControls.style.transform = 'translateX(-50%)';
mobileControls.style.display = 'flex';
mobileControls.style.gap = '40vw';
mobileControls.style.zIndex = '1000';
mobileControls.style.pointerEvents = 'none';

const leftBtn = document.createElement('button');
leftBtn.textContent = '⬅️';
leftBtn.style.fontSize = '2.5em';
leftBtn.style.padding = '18px 32px';
leftBtn.style.borderRadius = '50%';
leftBtn.style.border = 'none';
leftBtn.style.background = 'rgba(0,0,0,0.7)';
leftBtn.style.color = '#0fffc1';
leftBtn.style.boxShadow = '0 2px 12px #0008';
leftBtn.style.pointerEvents = 'auto';
leftBtn.style.touchAction = 'none';

const rightBtn = document.createElement('button');
rightBtn.textContent = '➡️';
rightBtn.style.fontSize = '2.5em';
rightBtn.style.padding = '18px 32px';
rightBtn.style.borderRadius = '50%';
rightBtn.style.border = 'none';
rightBtn.style.background = 'rgba(0,0,0,0.7)';
rightBtn.style.color = '#0fffc1';
rightBtn.style.boxShadow = '0 2px 12px #0008';
rightBtn.style.pointerEvents = 'auto';
rightBtn.style.touchAction = 'none';

mobileControls.appendChild(leftBtn);
mobileControls.appendChild(rightBtn);
document.body.appendChild(mobileControls);

// Hide on desktop, show on mobile
function updateMobileControlsVisibility() {
  if (window.innerWidth < 800 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) {
    mobileControls.style.display = 'flex';
  } else {
    mobileControls.style.display = 'none';
  }
}
window.addEventListener('resize', updateMobileControlsVisibility);
updateMobileControlsVisibility();

// Touch event handlers for lane change
leftBtn.addEventListener('touchstart', function(e) {
  e.preventDefault();
  const prevLane = currentLane;
  if (currentLane < 1) currentLane++;
  if (currentLane !== prevLane) {
    wasSwitchingLane = true;
    playLaneSfxCropped();
  }
});
rightBtn.addEventListener('touchstart', function(e) {
  e.preventDefault();
  const prevLane = currentLane;
  if (currentLane > -1) currentLane--;
  if (currentLane !== prevLane) {
    wasSwitchingLane = true;
    playLaneSfxCropped();
  }
});

// Optional: also allow tap on left/right half of screen for lane change
window.addEventListener('touchstart', function(e) {
  if (e.target === leftBtn || e.target === rightBtn) return;
  if (e.touches.length === 1) {
    const x = e.touches[0].clientX;
    if (x < window.innerWidth / 2) {
      // Left half
      const prevLane = currentLane;
      if (currentLane < 1) currentLane++;
      if (currentLane !== prevLane) {
        wasSwitchingLane = true;
        playLaneSfxCropped();
      }
    } else {
      // Right half
      const prevLane = currentLane;
      if (currentLane > -1) currentLane--;
      if (currentLane !== prevLane) {
        wasSwitchingLane = true;
        playLaneSfxCropped();
      }
    }
  }
}, { passive: false });

// Prevent scrolling on mobile during game
document.body.addEventListener('touchmove', function(e) {
  if (gameStarted && !isGameOver) e.preventDefault();
}, { passive: false });

// === Spawn Traffic Cars ===
function spawnTrafficCar() {
  const baseMat = new THREE.MeshPhongMaterial({ color: Math.random() * 0xffffff, shininess: 50 });
  const blurredMat = createBlurredMaterial(baseMat, gameSpeed);
  const tCar = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 2), blurredMat);
  tCar.castShadow = true;
  tCar.receiveShadow = true;
  const lane = lanes[Math.floor(Math.random() * lanes.length)];
  tCar.position.set(lane, 0.5, 30);
  scene.add(tCar);
  trafficCars.push(tCar);
}

// === Game Over Screen ===
function showGameOver() {
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.background = 'rgba(0,0,0,0.9)';
  overlay.style.color = '#fff';
  overlay.style.fontSize = '2em';
  overlay.style.display = 'flex';
  overlay.style.flexDirection = 'column';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.zIndex = '999';
  overlay.innerHTML = `
    <h1>💥 GAME OVER 💥</h1>
    <p>Your Score: ${score}</p>
    <p>High Score: ${highScore}</p>
    <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 30px; font-size: 1em;">Restart</button>
  `;
  document.body.appendChild(overlay);
}

// === Background Music ===
const bgMusic = new Audio('assets/cyberpsycosis-187772.mp3');
bgMusic.loop = true;
bgMusic.volume = 0.4;

// Start music on user interaction (required by browsers)
function startMusicOnce() {
  if (bgMusic.paused) {
    bgMusic.play().catch(() => {}); // ignore autoplay errors
  }
  window.removeEventListener('pointerdown', startMusicOnce);
  window.removeEventListener('keydown', startMusicOnce);
}
window.addEventListener('pointerdown', startMusicOnce);
window.addEventListener('keydown', startMusicOnce);

// === Music Credit UI ===
const musicCredit = document.createElement('div');
musicCredit.style.position = 'fixed';
musicCredit.style.left = '18px';
musicCredit.style.bottom = '18px';
musicCredit.style.background = 'rgba(0,0,0,0.55)';
musicCredit.style.color = '#fff';
musicCredit.style.fontFamily = 'sans-serif';
musicCredit.style.fontSize = '1em';
musicCredit.style.padding = '8px 16px';
musicCredit.style.borderRadius = '8px';
musicCredit.style.zIndex = '20';
musicCredit.style.pointerEvents = 'none';
musicCredit.innerHTML = `<b>Music:</b> Cyberpsycosis<br><b>Artist:</b> <a href="https://pixabay.com/users/juniorsoundays-19205462/?utm_source=link-attribution&utm_medium=referral&utm_campaign=music&utm_content=187772" target="_blank" style="color:#0ff;text-decoration:underline;pointer-events:auto;">juniorsoundays</a><br><b>From:</b> <a href="https://pixabay.com//?utm_source=link-attribution&utm_medium=referral&utm_campaign=music&utm_content=187772" target="_blank" style="color:#0ff;text-decoration:underline;pointer-events:auto;">Pixabay</a>`;
document.body.appendChild(musicCredit);

// === Car Hit SFX ===
const hitSfx = new Audio('assets/accident-fall-drop-topple-94516.mp3');
hitSfx.volume = 0.7;

// === Main Loop ===
function animate() {
  requestAnimationFrame(animate);

  if (!gameStarted || isGameOver || !playerCarLoaded) return;

  roadSegments.forEach(segment => {
    segment.position.z -= roadSpeed;
    if (segment.position.z < -100) segment.position.z += 300;
  });

  laneLines.forEach(line => {
    line.position.z -= roadSpeed;
    if (line.position.z < -150) line.position.z += 300;
  });

  const targetX = currentLane * laneWidth;
  const dx = targetX - playerCar.position.x;
  playerCar.position.x += dx * 0.2;
  playerCar.rotation.z = dx * -0.1;

  if (wasSwitchingLane && Math.abs(dx) > 0.1 && Math.random() < 0.5) {
    createDustTrail();
  }
  if (Math.abs(dx) < 0.05) {
    wasSwitchingLane = false;
  }

  spawnTimer++;
  if (spawnTimer > spawnInterval) {
    spawnTrafficCar();
    spawnTimer = 0;
  }

  for (let i = trafficCars.length - 1; i >= 0; i--) {
    const tCar = trafficCars[i];
    tCar.position.z -= gameSpeed;

    const dx = Math.abs(tCar.position.x - playerCar.position.x);
    const dz = Math.abs(tCar.position.z - playerCar.position.z);
    if (dx < 0.5 && dz < 1.5) {
      isGameOver = true;
      // Play hit SFX and stop bg music
      try {
        hitSfx.currentTime = 1.2;
        hitSfx.play();
      } catch (err) {}
      if (!bgMusic.paused) {
        bgMusic.pause();
        bgMusic.currentTime = 0;
      }
      if (score > highScore) {
        highScore = score;
        localStorage.setItem('highScore', highScore);
      }
      showGameOver();
    }

    if (tCar.position.z < -20) {
      scene.remove(tCar);
      trafficCars.splice(i, 1);
    }
  }

  // Beautiful day sky update
  sky.material.uniforms['sunPosition'].value.copy(sun);
  renderer.setClearColor(new THREE.Color().setHSL(0.08, 0.7, 0.7)); // Warm sunrise sky
  sunLight.intensity = 1.2;
  sunLight.color.set(0xffbb66);
  light.intensity = 1.1;
  light.color.set(0xffeedd);

  score += 1;
  scoreElement.textContent = `Score: ${score} | High Score: ${highScore}`;

  camera.position.x += (playerCar.position.x - camera.position.x) * 0.05;
  camera.position.y += (5 - camera.position.y) * 0.02;
  camera.lookAt(playerCar.position.x, 0, playerCar.position.z + 10);

  renderer.setRenderTarget(renderTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);

  renderMaterial.uniforms.tDiffuse.value = renderTarget.texture;
  renderer.render(renderScene, renderCamera);
}

animate();