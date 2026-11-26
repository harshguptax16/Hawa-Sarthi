import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ArrowLeft, Eye, EyeOff, RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { AqiBriefing, ThemeMode } from '../types.ts';

interface SmogScene3DProps {
  city: string;
  briefing: AqiBriefing | null;
  theme: ThemeMode;
  onExit: () => void;
}

type CameraPresetId = 'overview' | 'purifier' | 'windowSeal' | 'inversion';

interface CameraPreset {
  id: CameraPresetId;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}

const CAMERA_PRESETS: CameraPreset[] = [
  { id: 'overview', label: 'Overview', position: [7.8, 5.2, 8.6], target: [0.2, 1.3, 0] },
  { id: 'purifier', label: 'HEPA Tower', position: [3.2, 2.2, 3.6], target: [-1.4, 1.15, 0.7] },
  { id: 'windowSeal', label: 'Window Seal', position: [4.2, 2.7, 3.9], target: [1.5, 1.65, -1.6] },
  { id: 'inversion', label: 'Inversion Layer', position: [10.5, 7.6, 10.5], target: [0, 2.1, 0] },
];

function detectSoftwareGl(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return true;
    const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugExt
      ? String(gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|WARP|Software|Basic Render/i.test(renderer);
  } catch {
    return true;
  }
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(15, 23, 42, 0.48)');
    grad.addColorStop(0.5, 'rgba(15, 23, 42, 0.18)');
    grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function createDeckTextures(isDark: boolean, maxAnisotropy: number) {
  const size = 512;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d');

  if (cCtx && bCtx) {
    cCtx.fillStyle = isDark ? '#1e293b' : '#e2e8f0';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, size, size);

    // Architectural stone tile grid + fine organic speckle
    const step = 64;
    cCtx.strokeStyle = isDark ? 'rgba(51, 65, 85, 0.7)' : 'rgba(148, 163, 184, 0.55)';
    cCtx.lineWidth = 2;
    bCtx.strokeStyle = '#525252';
    bCtx.lineWidth = 2;

    for (let i = 0; i <= size; i += step) {
      cCtx.beginPath();
      cCtx.moveTo(i, 0);
      cCtx.lineTo(i, size);
      cCtx.stroke();
      cCtx.beginPath();
      cCtx.moveTo(0, i);
      cCtx.lineTo(size, i);
      cCtx.stroke();

      bCtx.beginPath();
      bCtx.moveTo(i, 0);
      bCtx.lineTo(i, size);
      bCtx.stroke();
      bCtx.beginPath();
      bCtx.moveTo(0, i);
      bCtx.lineTo(size, i);
      bCtx.stroke();
    }

    for (let n = 0; n < 1600; n++) {
      const x = ((n * 73) % 509) + 1;
      const y = ((n * 137) % 509) + 1;
      const shade = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.035)';
      cCtx.fillStyle = shade;
      cCtx.fillRect(x, y, 2, 2);
      bCtx.fillStyle = n % 2 === 0 ? '#969696' : '#6c6c6c';
      bCtx.fillRect(x, y, 2, 2);
    }
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(6, 6);
  map.anisotropy = maxAnisotropy;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(6, 6);
  bumpMap.anisotropy = maxAnisotropy;

  return { map, bumpMap };
}

function createRoundedRectShape(width: number, height: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

export const SmogScene3D: React.FC<SmogScene3DProps> = ({
  city,
  briefing,
  theme,
  onExit,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  const baselineOutdoorPm = briefing?.pm25Estimate ?? 240;
  const [fanSpeed, setFanSpeed] = useState(75); // 0 - 100
  const [windowSeal, setWindowSeal] = useState(82); // 0 - 100
  const [outdoorPm, setOutdoorPm] = useState<number>(baselineOutdoorPm);
  const [activePreset, setActivePreset] = useState<CameraPresetId>('overview');
  const [controlsVisible, setControlsVisible] = useState(true);
  const [contextLost, setContextLost] = useState(false);

  // Sync outdoor PM2.5 when city briefing updates
  useEffect(() => {
    setOutdoorPm(briefing?.pm25Estimate ?? 240);
  }, [briefing?.pm25Estimate, city]);

  // Live physics simulation metrics for HUD
  const simulatedMetrics = useMemo(() => {
    const infiltrationFactor = 0.72 * (1 - (windowSeal / 100) * 0.84);
    const cadRRemoval = 0.08 + (fanSpeed / 100) * 0.74;
    const rawIndoor = outdoorPm * infiltrationFactor * (1 - cadRRemoval);
    const indoorPm = Math.max(8, Math.round(rawIndoor));
    const reductionPct = Math.max(0, Math.min(96, Math.round(((outdoorPm - indoorPm) / Math.max(outdoorPm, 1)) * 100)));
    return { indoorPm, reductionPct };
  }, [fanSpeed, windowSeal, outdoorPm]);

  // Ref bridge so render loop reads latest slider/preset states without tearing down WebGL
  const simStateRef = useRef({
    fanSpeed,
    windowSeal,
    outdoorPm,
    indoorPm: simulatedMetrics.indoorPm,
    presetTarget: CAMERA_PRESETS[0],
    transitionActive: false,
  });

  useEffect(() => {
    simStateRef.current.fanSpeed = fanSpeed;
    simStateRef.current.windowSeal = windowSeal;
    simStateRef.current.outdoorPm = outdoorPm;
    simStateRef.current.indoorPm = simulatedMetrics.indoorPm;
  }, [fanSpeed, windowSeal, outdoorPm, simulatedMetrics.indoorPm]);

  const handleSelectPreset = (id: CameraPresetId) => {
    setActivePreset(id);
    const found = CAMERA_PRESETS.find((p) => p.id === id) ?? CAMERA_PRESETS[0];
    simStateRef.current.presetTarget = found;
    simStateRef.current.transitionActive = true;
  };

  // Hotkey H toggles HUD dock
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'h' || ev.key === 'H') {
        const tag = (ev.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        setControlsVisible((v) => !v);
      } else if (ev.key === 'Escape') {
        onExit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onExit]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    const isDark = theme === 'dark';

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = isDark ? 1.08 : 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSoftwareGl ? 1 : 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const handleContextLost = (ev: Event) => {
      ev.preventDefault();
      setContextLost(true);
    };
    const handleContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    const scene = new THREE.Scene();
    const baseSkyHex = isDark ? 0x0b1322 : 0xdde5ee;
    scene.background = new THREE.Color(baseSkyHex);
    scene.fog = new THREE.FogExp2(baseSkyHex, 0.022);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = isDark ? 0.55 : 0.72;
    roomEnv.dispose();
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(
      44,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.1,
      120
    );
    camera.position.set(...CAMERA_PRESETS[0].position);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(...CAMERA_PRESETS[0].target);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2.6;
    controls.maxDistance = 22;
    controls.maxPolarAngle = Math.PI * 0.485;
    controls.update();

    const cancelPresetTransition = () => {
      simStateRef.current.transitionActive = false;
    };
    controls.addEventListener('start', cancelPresetTransition);

    // Studio Key + Cool Fill Lighting
    const keyLight = new THREE.DirectionalLight(0xfff4e0, isDark ? 2.4 : 2.9);
    keyLight.position.set(7.5, 11.5, 6.5);
    keyLight.castShadow = true;
    const shadowRes = isSoftwareGl ? 1024 : 2048;
    keyLight.shadow.mapSize.set(shadowRes, shadowRes);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 32;
    keyLight.shadow.camera.left = -9;
    keyLight.shadow.camera.right = 9;
    keyLight.shadow.camera.top = 9;
    keyLight.shadow.camera.bottom = -9;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const fillLight = new THREE.HemisphereLight(
      isDark ? 0x64748b : 0xcbd5e1,
      isDark ? 0x0f172a : 0x94a3b8,
      isDark ? 0.65 : 0.9
    );
    scene.add(fillLight);

    // Ground Courtyard Deck with procedural CanvasTexture
    const maxAnisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    const { map: deckMap, bumpMap: deckBump } = createDeckTextures(isDark, maxAnisotropy);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(44, 44),
      new THREE.MeshStandardMaterial({
        map: deckMap,
        bumpMap: deckBump,
        bumpScale: 0.025,
        roughness: 0.88,
        metalness: 0.04,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const contactShadowTex = createContactShadowTexture();
    const addContactShadow = (parent: THREE.Object3D, radius: number, opacity = 0.55) => {
      const shadowMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(radius * 2, radius * 2),
        new THREE.MeshBasicMaterial({
          map: contactShadowTex,
          transparent: true,
          opacity,
          depthWrite: false,
        })
      );
      shadowMesh.rotation.x = -Math.PI / 2;
      shadowMesh.position.y = 0.006;
      parent.add(shadowMesh);
    };

    // === COMPOSITE MODEL 1: Smart HEPA Air Purifier Tower (9 procedural parts) ===
    const purifierGroup = new THREE.Group();
    purifierGroup.position.set(-1.45, 0, 0.7);
    scene.add(purifierGroup);

    const matteBodyMat = new THREE.MeshStandardMaterial({
      color: isDark ? 0xe2e8f0 : 0xf8fafc,
      roughness: 0.42,
      metalness: 0.08,
    });
    const darkMetalMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.34,
      metalness: 0.78,
    });
    const brushedAlloyMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.28,
      metalness: 0.82,
    });
    const copperConduitMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.3,
      metalness: 0.85,
    });
    const aqiRingMat = new THREE.MeshStandardMaterial({
      color: 0x14b8a6,
      emissive: 0x14b8a6,
      emissiveIntensity: 1.4,
      roughness: 0.25,
      metalness: 0.2,
    });

    // 1. Beveled Plinth Base (ExtrudeGeometry)
    const plinthShape = createRoundedRectShape(1.18, 1.18, 0.24);
    const plinthGeo = new THREE.ExtrudeGeometry(plinthShape, {
      depth: 0.14,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.025,
      bevelSegments: 3,
    });
    plinthGeo.rotateX(-Math.PI / 2);
    const plinthMesh = new THREE.Mesh(plinthGeo, darkMetalMat);
    plinthMesh.position.y = 0.025;
    plinthMesh.castShadow = true;
    plinthMesh.receiveShadow = true;
    purifierGroup.add(plinthMesh);

    // 2. Lathe Ribbed Lower Intake Drum (LatheGeometry)
    const lathePts = [
      new THREE.Vector2(0.01, 0.16),
      new THREE.Vector2(0.46, 0.16),
      new THREE.Vector2(0.48, 0.26),
      new THREE.Vector2(0.44, 0.42),
      new THREE.Vector2(0.47, 0.62),
      new THREE.Vector2(0.44, 0.84),
      new THREE.Vector2(0.46, 1.04),
      new THREE.Vector2(0.43, 1.24),
      new THREE.Vector2(0.01, 1.24),
    ];
    const intakeBody = new THREE.Mesh(new THREE.LatheGeometry(lathePts, 32), matteBodyMat);
    intakeBody.castShadow = true;
    intakeBody.receiveShadow = true;
    purifierGroup.add(intakeBody);

    // 3. HEPA Filter Mesh Core Ring (dark perforated inner core visible at collar)
    const hepaCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.455, 0.455, 0.16, 32),
      darkMetalMat
    );
    hepaCollar.position.y = 1.32;
    hepaCollar.castShadow = true;
    purifierGroup.add(hepaCollar);

    // 4. Brushed Alloy Upper Venturi Shroud
    const upperShroud = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.46, 0.48, 32),
      brushedAlloyMat
    );
    upperShroud.position.y = 1.64;
    upperShroud.castShadow = true;
    upperShroud.receiveShadow = true;
    purifierGroup.add(upperShroud);

    // 5. Glowing AQI Telemetry Ring
    const aqiRing = new THREE.Mesh(new THREE.TorusGeometry(0.435, 0.026, 14, 48), aqiRingMat);
    aqiRing.rotation.x = Math.PI / 2;
    aqiRing.position.y = 1.41;
    purifierGroup.add(aqiRing);

    // 6. Spinning Turbine Rotor + 5 Blades
    const fanRotor = new THREE.Group();
    fanRotor.position.y = 1.84;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.08, 16), darkMetalMat);
    fanRotor.add(hub);
    for (let b = 0; b < 5; b++) {
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.02, 0.085),
        brushedAlloyMat
      );
      const angle = (b / 5) * Math.PI * 2;
      blade.position.set(Math.cos(angle) * 0.2, 0, Math.sin(angle) * 0.2);
      blade.rotation.y = -angle;
      blade.rotation.x = 0.36;
      fanRotor.add(blade);
    }
    purifierGroup.add(fanRotor);

    // 7. Top Concentric Safety Grille Rings
    for (let r = 0; r < 3; r++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.14 + r * 0.11, 0.012, 8, 36),
        darkMetalMat
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 1.9;
      purifierGroup.add(ring);
    }

    // 8. PM2.5 Laser Sensor Pod + Copper Conduit (TubeGeometry)
    const sensorPod = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.28, 0.16),
      darkMetalMat
    );
    sensorPod.position.set(0.56, 0.92, 0);
    sensorPod.castShadow = true;
    purifierGroup.add(sensorPod);

    const conduitCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.45, 0.28, 0),
      new THREE.Vector3(0.62, 0.45, 0.08),
      new THREE.Vector3(0.56, 0.78, 0),
    ]);
    const conduit = new THREE.Mesh(
      new THREE.TubeGeometry(conduitCurve, 18, 0.024, 10, false),
      copperConduitMat
    );
    conduit.castShadow = true;
    purifierGroup.add(conduit);
    addContactShadow(purifierGroup, 0.95, 0.58);

    // === COMPOSITE MODEL 2: Clean-Air Shelter Cutaway & Window Seal (8 procedural parts) ===
    const homeGroup = new THREE.Group();
    homeGroup.position.set(1.35, 0, -1.2);
    scene.add(homeGroup);

    const wallMat = new THREE.MeshStandardMaterial({
      color: isDark ? 0x334155 : 0xf1f5f9,
      roughness: 0.78,
      metalness: 0.04,
    });
    const timberMat = new THREE.MeshStandardMaterial({
      color: isDark ? 0x78350f : 0xb45309,
      roughness: 0.68,
      metalness: 0.04,
    });
    const gasketMat = new THREE.MeshStandardMaterial({
      color: 0x0f766e,
      roughness: 0.45,
      metalness: 0.15,
    });
    const glassMat = isSoftwareGl
      ? new THREE.MeshStandardMaterial({
          color: 0xbae6fd,
          roughness: 0.12,
          metalness: 0.1,
          transparent: true,
          opacity: 0.42,
        })
      : new THREE.MeshPhysicalMaterial({
          color: 0xe0f2fe,
          roughness: 0.08,
          metalness: 0.0,
          transmission: 0.72,
          thickness: 0.08,
          transparent: true,
          opacity: 0.85,
        });

    // 1. Interior Timber Platform Slab (flush y=0)
    const floorShape = createRoundedRectShape(4.4, 3.2, 0.18);
    const floorGeo = new THREE.ExtrudeGeometry(floorShape, {
      depth: 0.12,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 2,
    });
    floorGeo.rotateX(-Math.PI / 2);
    const floorSlab = new THREE.Mesh(floorGeo, timberMat);
    floorSlab.position.y = 0.02;
    floorSlab.receiveShadow = true;
    homeGroup.add(floorSlab);

    // 2. Back Architectural Wall Left + Right + Sill + Lintel around Window Opening
    const wallLeft = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.9, 0.24), wallMat);
    wallLeft.position.set(-1.55, 1.55, -1.38);
    wallLeft.castShadow = true;
    wallLeft.receiveShadow = true;
    homeGroup.add(wallLeft);

    const wallRight = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.9, 0.24), wallMat);
    wallRight.position.set(1.55, 1.55, -1.38);
    wallRight.castShadow = true;
    wallRight.receiveShadow = true;
    homeGroup.add(wallRight);

    const wallSill = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.95, 0.26), wallMat);
    wallSill.position.set(0, 0.58, -1.38);
    wallSill.castShadow = true;
    wallSill.receiveShadow = true;
    homeGroup.add(wallSill);

    const wallLintel = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 0.26), wallMat);
    wallLintel.position.set(0, 2.72, -1.38);
    wallLintel.castShadow = true;
    wallLintel.receiveShadow = true;
    homeGroup.add(wallLintel);

    // 3. Sliding Dual Window Sash + Glass (moves smoothly with windowSeal slider!)
    const windowFrameOuter = new THREE.Mesh(new THREE.BoxGeometry(2.02, 1.42, 0.08), darkMetalMat);
    windowFrameOuter.position.set(0, 1.76, -1.4);
    homeGroup.add(windowFrameOuter);

    // Cutaway glass sash that slides open/closed based on windowSeal
    const windowSashGroup = new THREE.Group();
    windowSashGroup.position.set(0, 1.76, -1.35);
    const sashGlass = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.3, 0.03), glassMat);
    const sashMullion = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.32, 0.06), darkMetalMat);
    windowSashGroup.add(sashGlass, sashMullion);
    homeGroup.add(windowSashGroup);

    // 4. Weather-strip Seal Gasket Frame (scales/highlights with Window Seal %)
    const sealGasket = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.06, 0.14), gasketMat);
    sealGasket.position.set(0, 1.07, -1.35);
    homeGroup.add(sealGasket);

    // 5. Roof Overhang Canopy + Solar Louver
    const roofOverhang = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.12, 3.45), darkMetalMat);
    roofOverhang.position.set(0, 3.04, 0.05);
    roofOverhang.castShadow = true;
    roofOverhang.receiveShadow = true;
    homeGroup.add(roofOverhang);

    // 6. Kitchen Exhaust Duct Pipe (TubeGeometry)
    const exhaustCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(1.5, 1.65, -0.55),
      new THREE.Vector3(1.5, 2.45, -0.55),
      new THREE.Vector3(1.5, 2.7, -1.45),
      new THREE.Vector3(1.5, 2.7, -1.9),
    ]);
    const exhaustPipe = new THREE.Mesh(
      new THREE.TubeGeometry(exhaustCurve, 20, 0.12, 12, false),
      brushedAlloyMat
    );
    exhaustPipe.castShadow = true;
    homeGroup.add(exhaustPipe);

    addContactShadow(homeGroup, 2.8, 0.35);

    // === COMPOSITE MODEL 3: Courtyard Urban Trees (3 multi-part trees) ===
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x573b26,
      roughness: 0.9,
      metalness: 0.02,
    });
    const foliageMat = new THREE.MeshStandardMaterial({
      color: isDark ? 0x15803d : 0x16a34a,
      roughness: 0.82,
      metalness: 0.02,
    });
    const treePositions: [number, number, number][] = [
      [-4.2, 0, -2.5],
      [4.5, 0, -2.9],
      [-3.8, 0, 2.7],
    ];
    treePositions.forEach(([tx, ty, tz], idx) => {
      const tree = new THREE.Group();
      tree.position.set(tx, ty, tz);
      const scale = 0.88 + idx * 0.14;
      tree.scale.setScalar(scale);

      const trunkPts = [
        new THREE.Vector2(0.01, 0),
        new THREE.Vector2(0.19, 0),
        new THREE.Vector2(0.13, 0.85),
        new THREE.Vector2(0.09, 1.65),
        new THREE.Vector2(0.01, 1.75),
      ];
      const trunk = new THREE.Mesh(new THREE.LatheGeometry(trunkPts, 12), trunkMat);
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      tree.add(trunk);

      const crownA = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1), foliageMat);
      crownA.position.set(0, 2.1, 0);
      crownA.castShadow = true;
      const crownB = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), foliageMat);
      crownB.position.set(0.38, 1.75, 0.22);
      crownB.castShadow = true;
      const crownC = new THREE.Mesh(new THREE.IcosahedronGeometry(0.58, 1), foliageMat);
      crownC.position.set(-0.34, 1.85, -0.2);
      crownC.castShadow = true;
      tree.add(crownA, crownB, crownC);

      addContactShadow(tree, 0.95, 0.45);
      scene.add(tree);
    });

    // === INSTANCED PM2.5 PARTICLES (260 instanced spheres driven by scratch math) ===
    const PARTICLE_COUNT = 260;
    const particleGeo = new THREE.SphereGeometry(0.048, 8, 8);
    const particleMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xd97706,
      emissiveIntensity: 0.4,
      roughness: 0.5,
      metalness: 0.1,
    });
    const particlesMesh = new THREE.InstancedMesh(particleGeo, particleMat, PARTICLE_COUNT);
    particlesMesh.frustumCulled = false;
    scene.add(particlesMesh);

    const particleSeeds = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const isIndoor = i < 110;
      return {
        isIndoor,
        x: isIndoor ? ((i * 37) % 100) / 100 * 5.2 - 2.3 : ((i * 53) % 100) / 100 * 14 - 7,
        y: isIndoor ? 0.25 + ((i * 29) % 100) / 100 * 2.5 : 0.35 + ((i * 41) % 100) / 100 * 5.4,
        z: isIndoor ? ((i * 61) % 100) / 100 * 3.4 - 2.1 : -2.6 - ((i * 19) % 100) / 100 * 5.2,
        speed: 0.4 + ((i * 17) % 100) / 120,
        phase: i * 0.47,
      };
    });

    // Pre-allocated scratch helpers (zero per-frame allocations)
    const scratchDummy = new THREE.Object3D();
    const scratchColor = new THREE.Color();
    const scratchPos = new THREE.Vector3();
    const scratchTarget = new THREE.Vector3();
    const cleanTeal = new THREE.Color(0x14b8a6);
    const hazeAmber = new THREE.Color(0xf59e0b);
    const severeRed = new THREE.Color(0xef4444);
    const baseSkyColor = new THREE.Color(baseSkyHex);
    const smogTintColor = new THREE.Color(isDark ? 0x2b2116 : 0xd6c3a5);

    let rafId = 0;
    let drawTimerId: number | null = null;
    let lastTime = performance.now();
    let disposed = false;

    const afterDraw = (tick: FrameRequestCallback) => {
      if (disposed) return;
      if (isSoftwareGl) {
        drawTimerId = window.setTimeout(() => {
          if (!disposed) rafId = requestAnimationFrame(tick);
        }, 16);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    const animate = (now: number) => {
      if (disposed) return;
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      const elapsed = now * 0.001;

      const sim = simStateRef.current;

      // 1. Spin HEPA fan blades proportional to fanSpeed
      const spinRate = 1.2 + (sim.fanSpeed / 100) * 18.0;
      fanRotor.rotation.y += spinRate * dt;

      // 2. Slide window sash open/closed & thicken seal visual
      const gapOffset = ((100 - sim.windowSeal) / 100) * 0.85;
      windowSashGroup.position.x = gapOffset;
      sealGasket.scale.y = 0.6 + (sim.windowSeal / 100) * 1.1;

      // 3. Color AQI ring based on simulated indoor PM2.5
      if (sim.indoorPm <= 35) {
        scratchColor.copy(cleanTeal);
      } else if (sim.indoorPm <= 90) {
        scratchColor.copy(hazeAmber);
      } else {
        scratchColor.copy(severeRed);
      }
      aqiRingMat.color.copy(scratchColor);
      aqiRingMat.emissive.copy(scratchColor);

      // 4. Modulate horizon-matched fog density with outdoor PM2.5
      const smogRatio = Math.min(Math.max((sim.outdoorPm - 40) / 360, 0), 1);
      if (scene.fog instanceof THREE.FogExp2 && scene.background instanceof THREE.Color) {
        scene.fog.color.copy(baseSkyColor).lerp(smogTintColor, smogRatio * 0.72);
        scene.background.copy(scene.fog.color);
        scene.fog.density = 0.012 + smogRatio * 0.036;
      }

      // 5. Update 260 instanced PM2.5 particulates cleanly
      const indoorDensity = Math.min(Math.max(sim.indoorPm / 140, 0.06), 1.1);
      const outdoorDensity = Math.min(Math.max(sim.outdoorPm / 220, 0.25), 1.4);

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p = particleSeeds[i];
        if (p.isIndoor) {
          // Swirl toward HEPA intake (-1.45, 0.8, 0.7) when fan speed is high
          const swirlAngle = elapsed * p.speed * (0.4 + (sim.fanSpeed / 100) * 1.4) + p.phase;
          const pullRadius = 0.55 + ((i % 7) * 0.55) * (1.15 - (sim.fanSpeed / 100) * 0.45);
          const px = THREE.MathUtils.lerp(p.x, -1.45 + Math.cos(swirlAngle) * pullRadius, 0.45);
          const pz = THREE.MathUtils.lerp(p.z, 0.7 + Math.sin(swirlAngle) * pullRadius, 0.45);
          const py = 0.3 + ((p.y + elapsed * 0.22 * p.speed) % 2.4);

          const activeFraction = i / 110;
          const scale = activeFraction < indoorDensity ? 0.65 + 0.35 * Math.sin(elapsed * 2 + p.phase) : 0.001;
          scratchDummy.position.set(px, py, pz);
          scratchDummy.scale.setScalar(scale);
        } else {
          const driftX = ((p.x + elapsed * 0.35 * p.speed + 7) % 14) - 7;
          const driftY = p.y + Math.sin(elapsed * 0.7 + p.phase) * 0.22;
          const activeFraction = (i - 110) / (PARTICLE_COUNT - 110);
          const scale = activeFraction < outdoorDensity ? 0.9 + 0.3 * Math.cos(elapsed + p.phase) : 0.001;
          scratchDummy.position.set(driftX, driftY, p.z);
          scratchDummy.scale.setScalar(scale);
        }
        scratchDummy.updateMatrix();
        particlesMesh.setMatrixAt(i, scratchDummy.matrix);
      }
      particlesMesh.instanceMatrix.needsUpdate = true;

      // 6. Smooth exponential camera preset transition
      if (sim.transitionActive) {
        const damp = 1 - Math.exp(-5.5 * dt);
        scratchPos.set(...sim.presetTarget.position);
        scratchTarget.set(...sim.presetTarget.target);
        camera.position.lerp(scratchPos, damp);
        controls.target.lerp(scratchTarget, damp);
        if (camera.position.distanceTo(scratchPos) < 0.03 && controls.target.distanceTo(scratchTarget) < 0.03) {
          sim.transitionActive = false;
        }
      }

      controls.update();
      renderer.render(scene, camera);
      afterDraw(animate);
    };

    rafId = requestAnimationFrame(animate);

    const handleResize = () => {
      if (!container || disposed) return;
      const w = container.clientWidth;
      const h = Math.max(container.clientHeight, 1);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      if (drawTimerId !== null) window.clearTimeout(drawTimerId);
      window.removeEventListener('resize', handleResize);
      controls.removeEventListener('start', cancelPresetTransition);
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);

      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => {
            if (!m) return;
            const std = m as THREE.MeshStandardMaterial;
            std.map?.dispose();
            std.bumpMap?.dispose();
            m.dispose();
          });
        }
      });
      envTarget.dispose();
      contactShadowTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [theme]);

  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-slate-950 select-none">
      {/* Dedicated WebGL Mount Layer */}
      <div ref={mountRef} className="absolute inset-0 h-full w-full" />

      {contextLost && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/90 p-6 text-center text-sm text-slate-200">
          WebGL rendering context was paused by the browser. Return to workspace or reload to restore the 3D scene.
        </div>
      )}

      {/* Minimal Top-Left Header Bar (solid rgba, no backdrop-blur over WebGL) */}
      <div className="pointer-events-none absolute top-4 left-4 right-4 z-10 flex items-start justify-between gap-4">
        <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl border border-slate-300/80 bg-white/95 px-4 py-2.5 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/95">
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Workspace</span>
          </button>

          <div className="text-xs text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              Airview 3D Simulation
            </span>
            <span className="mx-2 text-slate-400" aria-hidden="true">·</span>
            <span>{city}</span>
            <span className="mx-2 text-slate-400" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              Outdoor {outdoorPm} µg/m³ → Indoor{' '}
              <strong className="text-teal-700 dark:text-teal-400">
                {simulatedMetrics.indoorPm} µg/m³
              </strong>{' '}
              (-{simulatedMetrics.reductionPct}%)
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setControlsVisible((v) => !v)}
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-300/80 bg-white/95 px-3 py-2 text-xs font-medium text-slate-800 shadow-sm transition-colors hover:bg-slate-100 dark:border-slate-700/80 dark:bg-slate-900/95 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
        >
          {controlsVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          <span>{controlsVisible ? 'Hide Controls (H)' : 'Show Controls (H)'}</span>
        </button>
      </div>

      {/* Compact Collapsible Bottom Control Dock (<= 15% viewport footprint) */}
      {controlsVisible && (
        <div className="pointer-events-auto absolute bottom-4 left-1/2 z-10 w-[min(920px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-slate-300/80 bg-white/95 p-3.5 shadow-lg dark:border-slate-700/80 dark:bg-slate-900/95">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2.5 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200">
              <SlidersHorizontal className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
              <span>Drag to orbit · Scroll to zoom</span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {CAMERA_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    activePreset === preset.id
                      ? 'bg-teal-600 text-white dark:bg-teal-500 dark:text-slate-950'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleSelectPreset('overview')}
                aria-label="Reset camera view"
                className="rounded-md bg-slate-100 p-1.5 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="mt-2.5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block space-y-1 text-xs">
              <div className="flex items-center justify-between text-slate-700 dark:text-slate-300">
                <span>HEPA Fan Speed</span>
                <span className="font-mono font-semibold tabular-nums text-teal-700 dark:text-teal-400">
                  {fanSpeed}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={fanSpeed}
                onChange={(e) => setFanSpeed(Number(e.target.value))}
                className="w-full accent-teal-600 dark:accent-teal-400"
              />
            </label>

            <label className="block space-y-1 text-xs">
              <div className="flex items-center justify-between text-slate-700 dark:text-slate-300">
                <span>Window Draft Seal</span>
                <span className="font-mono font-semibold tabular-nums text-teal-700 dark:text-teal-400">
                  {windowSeal}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={windowSeal}
                onChange={(e) => setWindowSeal(Number(e.target.value))}
                className="w-full accent-teal-600 dark:accent-teal-400"
              />
            </label>

            <label className="block space-y-1 text-xs">
              <div className="flex items-center justify-between text-slate-700 dark:text-slate-300">
                <span>Outdoor Smog PM2.5</span>
                <span className="font-mono font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                  {outdoorPm} µg/m³
                </span>
              </div>
              <input
                type="range"
                min={25}
                max={420}
                value={outdoorPm}
                onChange={(e) => setOutdoorPm(Number(e.target.value))}
                className="w-full accent-amber-600 dark:accent-amber-400"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
};
