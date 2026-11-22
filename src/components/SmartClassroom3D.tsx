import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  Atom,
  Bot,
  Camera,
  ChevronDown,
  ChevronUp,
  Hand,
  MonitorPlay,
  Pointer,
  Volume2,
} from "lucide-react";
import type { UILanguage } from "../types.ts";
import {
  createClassroomMaterials,
  createSmartBoardCanvas,
  type SmartBoardMode,
} from "../three/classroomMaterials.ts";
import { buildSmartClassroomScene } from "../three/classroomModels.ts";

export type ClassroomCameraView = "overview" | "robot" | "board" | "student";
export type RobotGesture = "idle" | "wave" | "point_board";

interface SmartClassroom3DProps {
  uiLang: UILanguage;
  reducedMotion: boolean;
  isSpeaking: boolean;
  activeGesture: RobotGesture;
  onGestureChange: (gesture: RobotGesture) => void;
  onRobotClicked: () => void;
  onBoardOpenStudio?: () => void;
}

// Pre-allocated math helpers outside render loop (zero GC churn)
const _camGoalPos = new THREE.Vector3();
const _camGoalTarget = new THREE.Vector3();
const _pointerNdc = new THREE.Vector2();

const CAMERA_PRESETS: Record<
  ClassroomCameraView,
  { pos: [number, number, number]; target: [number, number, number]; labelAr: string; labelEn: string }
> = {
  overview: {
    pos: [1.15, 2.35, 5.25],
    target: [-0.25, 1.45, -1.7],
    labelAr: "نظرة شاملة",
    labelEn: "Full Class",
  },
  robot: {
    pos: [-1.15, 1.62, 0.55],
    target: [-2.25, 1.25, -2.55],
    labelAr: "الروبوت",
    labelEn: "Robot",
  },
  board: {
    pos: [0.85, 2.15, -0.35],
    target: [0.85, 2.15, -4.0],
    labelAr: "السبورة الذكية",
    labelEn: "Smart Board",
  },
  student: {
    pos: [0.0, 1.48, 3.85],
    target: [-0.35, 1.65, -2.8],
    labelAr: "مقعد الطالب",
    labelEn: "Student View",
  },
};

const BOARD_MODES: Array<{ id: SmartBoardMode; labelAr: string; labelEn: string }> = [
  { id: "atom", labelAr: "الذرة", labelEn: "Atom" },
  { id: "molecules", labelAr: "الجزيئات", labelEn: "Molecules" },
  { id: "solar", labelAr: "الكواكب", labelEn: "Planets" },
  { id: "waves", labelAr: "الموجات", labelEn: "Waves" },
];

export const SmartClassroom3D: React.FC<SmartClassroom3DProps> = ({
  uiLang,
  reducedMotion,
  isSpeaking,
  activeGesture,
  onGestureChange,
  onRobotClicked,
  onBoardOpenStudio,
}) => {
  const isAr = uiLang === "ar";
  const mountRef = useRef<HTMLDivElement>(null);

  const [cameraView, setCameraView] = useState<ClassroomCameraView>("overview");
  const [boardMode, setBoardMode] = useState<SmartBoardMode>("atom");
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [webglError, setWebglError] = useState(false);
  const [hoverHint, setHoverHint] = useState<string | null>(null);

  // Synced refs so React state updates never recreate WebGLRenderer
  const uiLangRef = useRef(uiLang);
  const reducedMotionRef = useRef(reducedMotion);
  const isSpeakingRef = useRef(isSpeaking);
  const gestureRef = useRef<RobotGesture>(activeGesture);
  const boardModeRef = useRef<SmartBoardMode>(boardMode);
  const onRobotClickedRef = useRef(onRobotClicked);
  const onGestureChangeRef = useRef(onGestureChange);

  const cameraTransitionRef = useRef<{
    active: boolean;
    pos: [number, number, number];
    target: [number, number, number];
  }>({
    active: false,
    pos: CAMERA_PRESETS.overview.pos,
    target: CAMERA_PRESETS.overview.target,
  });

  const gestureTimerRef = useRef<number>(0);
  const pointerWorldAimRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const scienceBoostRef = useRef<Record<string, number>>({});

  useEffect(() => {
    uiLangRef.current = uiLang;
  }, [uiLang]);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    gestureRef.current = activeGesture;
    if (activeGesture !== "idle") {
      gestureTimerRef.current = 4.2;
    }
  }, [activeGesture]);

  useEffect(() => {
    boardModeRef.current = boardMode;
  }, [boardMode]);

  useEffect(() => {
    onRobotClickedRef.current = onRobotClicked;
  }, [onRobotClicked]);

  useEffect(() => {
    onGestureChangeRef.current = onGestureChange;
  }, [onGestureChange]);

  const selectCameraPreset = (preset: ClassroomCameraView) => {
    setCameraView(preset);
    const cfg = CAMERA_PRESETS[preset];
    cameraTransitionRef.current = {
      active: true,
      pos: cfg.pos,
      target: cfg.target,
    };
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Software WebGL detection from GPU renderer string
    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement("canvas").getContext("webgl2");
        if (!probe) return true;
        const ext = probe.getExtension("WEBGL_debug_renderer_info");
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param) || "");
        probe.getExtension("WEBGL_lose_context")?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: "high-performance",
        alpha: false,
      });
    } catch {
      setWebglError(true);
      return;
    }

    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(container.clientHeight, 360);

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.setAttribute(
      "aria-label",
      uiLangRef.current === "ar"
        ? "مشهد ثلاثي الأبعاد تفاعلي لصف تعليمي ذكي مستقبلي"
        : "Interactive 3D futuristic smart classroom scene"
    );

    container.appendChild(renderer.domElement);

    // 2. Scene, Soft Gradient Atmosphere & Studio Environment
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xedf4ee);
    scene.fog = new THREE.FogExp2(0xedf4ee, 0.032);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    pmremGenerator.dispose();

    // 3. Camera & Constrained OrbitControls
    const camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 60);
    camera.position.set(...CAMERA_PRESETS.overview.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(...CAMERA_PRESETS.overview.target);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 2.4;
    controls.maxDistance = 8.4;
    controls.minPolarAngle = Math.PI * 0.2;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minAzimuthAngle = -Math.PI * 0.36;
    controls.maxAzimuthAngle = Math.PI * 0.36;
    controls.enablePan = false;
    controls.update();

    const onControlsStart = () => {
      cameraTransitionRef.current.active = false;
    };
    controls.addEventListener("start", onControlsStart);

    // 4. Three-Point Daylight Classroom Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xdff2eb, 0xeae0cf, 0.92);
    hemiLight.position.set(0, 8, 0);
    scene.add(hemiLight);

    // Warm natural sunlight coming through the left-side architectural windows
    const sunKeyLight = new THREE.DirectionalLight(0xfff5e4, 1.55);
    sunKeyLight.position.set(-7.5, 6.2, 1.4);
    sunKeyLight.target.position.set(0.2, 0.8, -1.4);
    sunKeyLight.castShadow = !isSoftwareGl;
    sunKeyLight.shadow.mapSize.width = 1024;
    sunKeyLight.shadow.mapSize.height = 1024;
    sunKeyLight.shadow.camera.near = 1;
    sunKeyLight.shadow.camera.far = 22;
    sunKeyLight.shadow.camera.left = -6.5;
    sunKeyLight.shadow.camera.right = 6.5;
    sunKeyLight.shadow.camera.top = 6.5;
    sunKeyLight.shadow.camera.bottom = -6.5;
    sunKeyLight.shadow.bias = -0.0005;
    sunKeyLight.shadow.normalBias = 0.02;
    scene.add(sunKeyLight);
    scene.add(sunKeyLight.target);

    // Soft mint/cream rim & front fill
    const fillLight = new THREE.DirectionalLight(0xe2f5ee, 0.58);
    fillLight.position.set(5.2, 4.2, 4.8);
    scene.add(fillLight);

    // Subtle smart board ambient glow
    const boardGlowLight = new THREE.PointLight(0xa4cbbf, 0.75, 7, 1.8);
    boardGlowLight.position.set(0.85, 2.35, -3.2);
    scene.add(boardGlowLight);

    // 5. Procedural Textures, PBR Materials & Multi-Part Classroom Models
    const maxAnisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    const smartBoardCanvas = createSmartBoardCanvas(maxAnisotropy);
    const materials = createClassroomMaterials(isSoftwareGl, maxAnisotropy, smartBoardCanvas.texture);
    const classroomRig = buildSmartClassroomScene(materials);
    scene.add(classroomRig.classroomGroup);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // 6. Raycaster on Layer 1 for Interactive Robot, Smart Board & Floating Science Objects
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    const interactiveTargets: THREE.Object3D[] = [
      classroomRig.robot.hitbox,
      classroomRig.smartBoardHitbox,
      ...classroomRig.floatingScience.map((item) => item.hitbox),
    ];

    let lastHoverCheck = 0;
    let pointerDownPos = { x: 0, y: 0 };

    const updateNdc = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      _pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    };

    const handlePointerMove = (ev: PointerEvent) => {
      updateNdc(ev.clientX, ev.clientY);
      pointerWorldAimRef.current = { x: _pointerNdc.x, y: _pointerNdc.y };

      const now = performance.now();
      if (now - lastHoverCheck < 55) return;
      lastHoverCheck = now;

      raycaster.setFromCamera(_pointerNdc, camera);
      const hits = raycaster.intersectObjects(interactiveTargets, false);
      if (hits.length > 0) {
        renderer.domElement.style.cursor = "pointer";
        const kind = hits[0].object.userData.interactiveKind;
        const ar = uiLangRef.current === "ar";
        if (kind === "robot") {
          setHoverHint(ar ? "انقر للتحدث والترحيب مع الروبوت" : "Click to greet & talk with the Educator Robot");
        } else if (kind === "board") {
          setHoverHint(ar ? "انقر لتبديل المحتوى العلمي على السبورة الذكية" : "Click to switch Smart Board scientific display");
        } else {
          setHoverHint(ar ? "عنصر علمي ثلاثي الأبعاد · انقر للتفاعل" : "3D Science Model · Click to interact");
        }
      } else {
        renderer.domElement.style.cursor = "grab";
        setHoverHint(null);
      }
    };

    const handlePointerDown = (ev: PointerEvent) => {
      pointerDownPos = { x: ev.clientX, y: ev.clientY };
    };

    const handlePointerUp = (ev: PointerEvent) => {
      const dist = Math.hypot(ev.clientX - pointerDownPos.x, ev.clientY - pointerDownPos.y);
      if (dist > 8) return; // Ignore orbit drags

      updateNdc(ev.clientX, ev.clientY);
      raycaster.setFromCamera(_pointerNdc, camera);
      const hits = raycaster.intersectObjects(interactiveTargets, false);
      if (hits.length === 0) return;

      const hitData = hits[0].object.userData;
      if (hitData.interactiveKind === "robot") {
        onGestureChangeRef.current("wave");
        onRobotClickedRef.current();
      } else if (hitData.interactiveKind === "board") {
        const order: SmartBoardMode[] = ["atom", "molecules", "solar", "waves"];
        const nextIdx = (order.indexOf(boardModeRef.current) + 1) % order.length;
        setBoardMode(order[nextIdx]);
        onGestureChangeRef.current("point_board");
      } else if (hitData.interactiveKind === "science") {
        const stype = String(hitData.scienceType || "atom");
        scienceBoostRef.current[stype] = 1.8;
        if (stype === "atom") setBoardMode("atom");
        else if (stype === "molecule") setBoardMode("molecules");
        else if (stype === "planet") setBoardMode("solar");
        else setBoardMode("waves");
        onGestureChangeRef.current("point_board");
      }
    };

    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);

    // 7. WebGL Context Loss Safety
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglError(true);
    };
    const handleContextRestored = () => {
      setWebglError(false);
    };
    renderer.domElement.addEventListener("webglcontextlost", handleContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", handleContextRestored);

    // 8. Responsive ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 10 || rect.height < 10) return;
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height);
    });
    resizeObserver.observe(container);

    // 9. Paced Animation Loop (Software-WebGL fenceSync vs GPU requestAnimationFrame)
    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;
    let lastBoardDraw = -1;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== "function") {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function updateScene(delta: number, elapsed: number) {
      // Smooth damped camera preset transitions
      if (cameraTransitionRef.current.active) {
        _camGoalPos.set(...cameraTransitionRef.current.pos);
        _camGoalTarget.set(...cameraTransitionRef.current.target);
        camera.position.x = THREE.MathUtils.damp(camera.position.x, _camGoalPos.x, 5.2, delta);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _camGoalPos.y, 5.2, delta);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _camGoalPos.z, 5.2, delta);

        controls.target.x = THREE.MathUtils.damp(controls.target.x, _camGoalTarget.x, 5.2, delta);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, _camGoalTarget.y, 5.2, delta);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, _camGoalTarget.z, 5.2, delta);

        if (
          camera.position.distanceToSquared(_camGoalPos) < 0.001 &&
          controls.target.distanceToSquared(_camGoalTarget) < 0.001
        ) {
          cameraTransitionRef.current.active = false;
        }
      }

      controls.update();

      const { robot, floatingScience, sunDustPoints } = classroomRig;
      const motionMul = reducedMotionRef.current ? 0 : 1;

      // Gesture timeout back to natural idle
      if (gestureRef.current !== "idle" && gestureTimerRef.current > 0) {
        gestureTimerRef.current -= delta;
        if (gestureTimerRef.current <= 0) {
          gestureRef.current = "idle";
          onGestureChangeRef.current("idle");
        }
      }

      // Hero Robot Kinematics (Hover float + breathing + natural wave / point_board / speaking mouth bars)
      const hoverOffset = motionMul * Math.sin(elapsed * 2.1) * 0.045;
      robot.bodyGroup.position.y = 0.22 + hoverOffset;
      robot.hoverRing.scale.setScalar(1 + motionMul * Math.sin(elapsed * 2.1) * 0.04);
      robot.shadowBlob.scale.setScalar(1 - hoverOffset * 0.8);

      // Subtle head tracking toward pointer + gentle speaking cadence
      const aimX = THREE.MathUtils.clamp(pointerWorldAimRef.current.x * 0.28, -0.32, 0.32);
      const aimY = THREE.MathUtils.clamp(pointerWorldAimRef.current.y * 0.16, -0.18, 0.18);
      const speakNod = isSpeakingRef.current && motionMul ? Math.sin(elapsed * 7.2) * 0.045 : 0;

      const targetHeadRotY =
        gestureRef.current === "point_board" ? 0.42 : aimX;
      const targetHeadRotX = -aimY * 0.7 + speakNod;
      robot.headGroup.rotation.y = THREE.MathUtils.damp(
        robot.headGroup.rotation.y,
        targetHeadRotY,
        6,
        delta
      );
      robot.headGroup.rotation.x = THREE.MathUtils.damp(
        robot.headGroup.rotation.x,
        targetHeadRotX,
        7,
        delta
      );

      // Eye blink occasionally
      const blinkWave = Math.sin(elapsed * 0.85);
      const eyeScaleY = blinkWave > 0.985 && motionMul ? 0.15 : 1;
      robot.leftEye.scale.y = THREE.MathUtils.damp(robot.leftEye.scale.y, eyeScaleY, 18, delta);
      robot.rightEye.scale.y = THREE.MathUtils.damp(robot.rightEye.scale.y, eyeScaleY, 18, delta);

      // Mouth bars animate vibrantly when speaking
      robot.mouthBars.forEach((bar, idx) => {
        const targetScaleY =
          isSpeakingRef.current && motionMul
            ? 0.8 + Math.abs(Math.sin(elapsed * 14 + idx * 1.1)) * 2.4
            : 0.65 + motionMul * Math.sin(elapsed * 2 + idx) * 0.12;
        bar.scale.y = THREE.MathUtils.damp(bar.scale.y, targetScaleY, 16, delta);
      });

      // Arm gestures: Wave, Point to Smart Board, or Natural Welcome Idle
      let targetRArmZ = -0.14;
      let targetRArmX = isSpeakingRef.current ? -0.18 + Math.sin(elapsed * 4.5) * 0.1 : -0.08;
      let targetRForearmZ = 0.05;
      let targetRForearmX = -0.25;

      let targetLArmZ = 0.14;
      let targetLArmX = isSpeakingRef.current ? -0.2 + Math.cos(elapsed * 4) * 0.08 : -0.06;
      let targetLForearmZ = -0.05;
      let targetLForearmX = -0.22;

      if (gestureRef.current === "wave") {
        // Right arm raised welcoming wave
        targetRArmZ = 2.35;
        targetRArmX = -0.28;
        targetRForearmZ = Math.sin(elapsed * 7.5) * 0.38;
        targetRForearmX = -0.35;
      } else if (gestureRef.current === "point_board") {
        // Right arm gracefully gesturing toward the Smart Board (+X, -Z)
        targetRArmZ = 1.05;
        targetRArmX = -0.58;
        targetRForearmZ = 0.12;
        targetRForearmX = -0.15;
      }

      robot.rightArmPivot.rotation.z = THREE.MathUtils.damp(robot.rightArmPivot.rotation.z, targetRArmZ, 6.5, delta);
      robot.rightArmPivot.rotation.x = THREE.MathUtils.damp(robot.rightArmPivot.rotation.x, targetRArmX, 6.5, delta);
      robot.rightForearmPivot.rotation.z = THREE.MathUtils.damp(robot.rightForearmPivot.rotation.z, targetRForearmZ, 9, delta);
      robot.rightForearmPivot.rotation.x = THREE.MathUtils.damp(robot.rightForearmPivot.rotation.x, targetRForearmX, 6.5, delta);

      robot.leftArmPivot.rotation.z = THREE.MathUtils.damp(robot.leftArmPivot.rotation.z, targetLArmZ, 6.5, delta);
      robot.leftArmPivot.rotation.x = THREE.MathUtils.damp(robot.leftArmPivot.rotation.x, targetLArmX, 6.5, delta);
      robot.leftForearmPivot.rotation.z = THREE.MathUtils.damp(robot.leftForearmPivot.rotation.z, targetLForearmZ, 6.5, delta);
      robot.leftForearmPivot.rotation.x = THREE.MathUtils.damp(robot.leftForearmPivot.rotation.x, targetLForearmX, 6.5, delta);

      // Floating 3D Science Elements (Atom, Molecule, Planet, Geometry)
      floatingScience.forEach((item) => {
        const boost = scienceBoostRef.current[item.kind] || 0;
        if (boost > 0) {
          scienceBoostRef.current[item.kind] = Math.max(0, boost - delta * 1.4);
        }
        const speedMul = 1 + boost * 2.2;
        item.group.position.y =
          item.basePos.y + motionMul * Math.sin(elapsed * 1.35 + item.phase) * 0.14;
        item.group.rotation.y += delta * 0.35 * speedMul * motionMul;

        if (item.orbitElements) {
          item.orbitElements.forEach((el, idx) => {
            el.rotation.z += delta * (0.7 + idx * 0.25) * speedMul * motionMul;
            el.rotation.y += delta * 0.45 * speedMul * motionMul;
          });
        }
      });

      // Soft sunlit dust drift
      if (motionMul > 0) {
        sunDustPoints.rotation.y = Math.sin(elapsed * 0.12) * 0.08;
      }

      // Throttle animated Smart Board Canvas redraw to ~16fps for super light CPU overhead
      if (elapsed - lastBoardDraw > 0.06 || lastBoardDraw < 0) {
        lastBoardDraw = elapsed;
        smartBoardCanvas.draw(
          motionMul ? elapsed : 0,
          boardModeRef.current,
          uiLangRef.current,
          isSpeakingRef.current
        );
      }
    }

    function tick() {
      if (disposed) return;
      const delta = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.getElapsedTime();
      updateScene(delta, elapsed);
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      controls.removeEventListener("start", onControlsStart);
      controls.dispose();
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("webglcontextlost", handleContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", handleContextRestored);

      classroomRig.dispose();
      materials.dispose();
      smartBoardCanvas.dispose();
      envTarget.dispose();
      renderer.dispose();

      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  if (webglError) {
    return (
      <div
        className="relative w-full h-full min-h-[460px] rounded-3xl border p-8 flex flex-col items-center justify-center text-center gap-4"
        style={{
          background: "linear-gradient(135deg, #f3eadc 0%, #dfeee7 100%)",
          borderColor: "var(--border-hairline)",
        }}
      >
        <img
          src="/assets/aistudio/image_cbd252d9.png"
          alt="Smart Science AI Logo"
          referrerPolicy="no-referrer"
          className="w-20 h-20 rounded-full object-cover shadow-md"
        />
        <Bot className="w-12 h-12" style={{ color: "var(--accent-primary)" }} />
        <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
          smart science ai
        </p>
        <p className="text-xs max-w-md" style={{ color: "var(--text-secondary)" }}>
          {isAr
            ? "تعذر تهيئة العرض الثلاثي الأبعاد في هذا المتصفح، ويمكنك التفاعل مع الروبوت الصوتي وجميع أدوات المنصة بشكل طبيعي."
            : "3D WebGL viewport unavailable in this browser; voice assistant and all platform tools remain active."}
        </p>
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-full min-h-[480px] lg:min-h-[580px] rounded-3xl border overflow-hidden select-none"
      style={{
        background: "linear-gradient(135deg, #f3eadc 0%, #e4f0e9 100%)",
        borderColor: "var(--border-hairline)",
        boxShadow: "0 20px 48px -18px rgba(45, 75, 65, 0.22)",
      }}
    >
      {/* Isolated WebGL Canvas Container (no backdrop-filter over canvas) */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

      {/* Minimal Top Brand Badge & Interactive Hover Cue */}
      <div className="relative z-10 pointer-events-none p-4 flex flex-wrap items-start justify-between gap-3">
        <div
          className="pointer-events-auto flex items-center gap-2.5 px-3.5 py-2 rounded-2xl border shadow-sm"
          style={{
            backgroundColor: "rgba(250, 246, 238, 0.94)",
            borderColor: "rgba(47, 107, 91, 0.32)",
          }}
        >
          <img
            src="/assets/aistudio/image_cbd252d9.png"
            alt={isAr ? "شعار Smart Science AI" : "Smart Science AI Emblem"}
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-full object-cover border shrink-0"
            style={{ borderColor: "rgba(47, 107, 91, 0.38)" }}
          />
          <div className="leading-tight space-y-0.5">
            <div className="text-xs font-bold" style={{ color: "#1d332d" }}>
              smart science ai
            </div>
            <div className="text-[11px] font-bold" style={{ color: "#2f6b5b" }}>
              {isAr ? "إعداد المعلمة أمجاد المري" : "Prepared by Teacher Amjad Al-Marri"}
            </div>
            <div className="text-[10px]" style={{ color: "#4e6961" }}>
              {isAr
                ? "اسحب للتدوير · انقر على الروبوت أو السبورة"
                : "Drag to orbit · Click Robot or Smart Board"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          {hoverHint && (
            <div
              className="px-3 py-1.5 rounded-xl border text-[11px] font-semibold shadow-sm"
              style={{
                backgroundColor: "rgba(24, 42, 38, 0.9)",
                borderColor: "rgba(164, 203, 191, 0.45)",
                color: "#f5ece0",
              }}
            >
              {hoverHint}
            </div>
          )}

          {onBoardOpenStudio && (
            <button
              type="button"
              onClick={onBoardOpenStudio}
              className="min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0"
              style={{
                backgroundColor: "#2f6b5b",
                color: "#ffffff",
              }}
            >
              <MonitorPlay className="w-3.5 h-3.5" />
              <span>{isAr ? "فتح استوديو السبورة" : "Open Content Studio"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Collapsible Bottom Control Dock (Zero Viewport Center Occlusion) */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 w-[min(920px,95%)] flex flex-col items-center pointer-events-none">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="pointer-events-auto mb-1.5 px-3 py-1 rounded-t-xl border text-[11px] font-semibold flex items-center gap-1 shadow-sm whitespace-nowrap"
          style={{
            backgroundColor: "rgba(250, 246, 238, 0.94)",
            borderColor: "rgba(137, 161, 133, 0.45)",
            color: "#1d332d",
          }}
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              <span>{isAr ? "إظهار أدوات الصف ثلاثي الأبعاد" : "Show 3D Classroom Controls"}</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              <span>{isAr ? "إخفاء الأدوات" : "Hide Controls"}</span>
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div
            className="pointer-events-auto w-full rounded-2xl border px-3.5 py-2.5 shadow-lg flex flex-wrap items-center justify-between gap-2.5"
            style={{
              backgroundColor: "rgba(250, 246, 238, 0.94)",
              borderColor: "rgba(137, 161, 133, 0.45)",
            }}
          >
            {/* Camera View Presets */}
            <div className="flex items-center gap-1 flex-wrap">
              <span
                className="text-[11px] font-bold flex items-center gap-1 me-1"
                style={{ color: "#4e6961" }}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>{isAr ? "الكاميرا:" : "View:"}</span>
              </span>
              {(Object.keys(CAMERA_PRESETS) as ClassroomCameraView[]).map((key) => {
                const active = cameraView === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => selectCameraPreset(key)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0 transition-colors"
                    style={{
                      backgroundColor: active ? "#2f6b5b" : "rgba(137, 161, 133, 0.16)",
                      color: active ? "#ffffff" : "#1d332d",
                    }}
                  >
                    {isAr ? CAMERA_PRESETS[key].labelAr : CAMERA_PRESETS[key].labelEn}
                  </button>
                );
              })}
            </div>

            {/* Robot Interactive Gestures */}
            <div className="flex items-center gap-1 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  onGestureChange("wave");
                  onRobotClicked();
                }}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0"
                style={{
                  backgroundColor:
                    activeGesture === "wave" ? "#5c775c" : "rgba(164, 203, 191, 0.28)",
                  color: activeGesture === "wave" ? "#ffffff" : "#1d332d",
                }}
              >
                <Hand className="w-3.5 h-3.5" />
                <span>{isAr ? "تلويح وترحيب" : "Wave"}</span>
              </button>

              <button
                type="button"
                onClick={() => onGestureChange("point_board")}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0"
                style={{
                  backgroundColor:
                    activeGesture === "point_board" ? "#5c775c" : "rgba(164, 203, 191, 0.28)",
                  color: activeGesture === "point_board" ? "#ffffff" : "#1d332d",
                }}
              >
                <Pointer className="w-3.5 h-3.5" />
                <span>{isAr ? "إشارة للسبورة" : "Point Board"}</span>
              </button>

              <button
                type="button"
                onClick={onRobotClicked}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0"
                style={{
                  backgroundColor: isSpeaking ? "#0f766e" : "rgba(164, 203, 191, 0.28)",
                  color: isSpeaking ? "#ffffff" : "#1d332d",
                }}
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>{isAr ? "تحدث" : "Speak"}</span>
              </button>
            </div>

            {/* Smart Screen Animated Science Mode */}
            <div className="flex items-center gap-1 flex-wrap">
              <span
                className="text-[11px] font-bold flex items-center gap-1 me-1"
                style={{ color: "#4e6961" }}
              >
                <Atom className="w-3.5 h-3.5" />
                <span>{isAr ? "الشاشة:" : "Screen:"}</span>
              </span>
              {BOARD_MODES.map((m) => {
                const active = boardMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setBoardMode(m.id);
                      onGestureChange("point_board");
                    }}
                    className="px-2 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0"
                    style={{
                      backgroundColor: active ? "#89a185" : "rgba(137, 161, 133, 0.14)",
                      color: active ? "#ffffff" : "#1d332d",
                    }}
                  >
                    {isAr ? m.labelAr : m.labelEn}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
