import * as THREE from "three";

export type SmartBoardMode = "atom" | "solar" | "waves" | "molecules";

export const CLASSROOM_PALETTE = {
  sageGreen: 0x89a185,
  sageDeep: 0x5c775c,
  mintGreen: 0xa4cbbf,
  mintBright: 0x6ec3ad,
  creamyBeige: 0xf3eadc,
  warmCream: 0xfaf5ec,
  porcelainWhite: 0xf8f9f7,
  champagneTrim: 0xd9cbb5,
  slateVisor: 0x162624,
  windowSkyTop: 0xdff2eb,
  windowSkyBottom: 0xf7efe3,
};

export interface ClassroomMaterials {
  robotWhite: THREE.MeshPhysicalMaterial;
  robotSage: THREE.MeshStandardMaterial;
  robotCream: THREE.MeshStandardMaterial;
  robotJoint: THREE.MeshStandardMaterial;
  robotVisor: THREE.MeshPhysicalMaterial;
  robotGlowMint: THREE.MeshStandardMaterial;
  floorMaterial: THREE.MeshStandardMaterial;
  rugMaterial: THREE.MeshStandardMaterial;
  wallCream: THREE.MeshStandardMaterial;
  wallSageTrim: THREE.MeshStandardMaterial;
  ceilingCream: THREE.MeshStandardMaterial;
  deskTopCream: THREE.MeshPhysicalMaterial;
  deskFrameSage: THREE.MeshStandardMaterial;
  deskHoloMint: THREE.MeshStandardMaterial;
  chairShellCream: THREE.MeshStandardMaterial;
  chairCushionSage: THREE.MeshStandardMaterial;
  boardFrameSage: THREE.MeshStandardMaterial;
  boardBezelCream: THREE.MeshStandardMaterial;
  boardScreen: THREE.MeshStandardMaterial;
  windowFrame: THREE.MeshStandardMaterial;
  windowGlass: THREE.MeshPhysicalMaterial;
  sunbeamMaterial: THREE.MeshBasicMaterial;
  atomCore: THREE.MeshStandardMaterial;
  atomRingMint: THREE.MeshStandardMaterial;
  atomElectron: THREE.MeshStandardMaterial;
  planetBody: THREE.MeshStandardMaterial;
  planetRing: THREE.MeshStandardMaterial;
  geoWire: THREE.MeshStandardMaterial;
  geoCore: THREE.MeshStandardMaterial;
  contactShadow: THREE.MeshBasicMaterial;
  dispose: () => void;
}

export interface SmartBoardCanvasHandle {
  texture: THREE.CanvasTexture;
  draw: (elapsed: number, mode: SmartBoardMode, lang: "ar" | "en", isSpeaking: boolean) => void;
  dispose: () => void;
}

function createFloorTileTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#F4ECE0";
  ctx.fillRect(0, 0, size, size);

  // Subtle marble/terrazzo warmth speckles
  for (let i = 0; i < 420; i++) {
    const x = (Math.sin(i * 19.37) * 0.5 + 0.5) * size;
    const y = (Math.cos(i * 41.13) * 0.5 + 0.5) * size;
    const r = 1 + (i % 3);
    ctx.fillStyle =
      i % 3 === 0
        ? "rgba(137, 161, 133, 0.10)"
        : i % 3 === 1
          ? "rgba(164, 203, 191, 0.12)"
          : "rgba(215, 201, 179, 0.16)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Architectural floor seams
  ctx.strokeStyle = "rgba(137, 161, 133, 0.22)";
  ctx.lineWidth = 2;
  const step = size / 2;
  for (let p = 0; p <= size; p += step) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(7, 7);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(44, 62, 54, 0.36)");
  grad.addColorStop(0.55, "rgba(44, 62, 54, 0.12)");
  grad.addColorStop(1, "rgba(44, 62, 54, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSmartBoardCanvas(maxAnisotropy: number): SmartBoardCanvasHandle {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;

  const draw = (
    elapsed: number,
    mode: SmartBoardMode,
    lang: "ar" | "en",
    isSpeaking: boolean
  ) => {
    // Deep sage-mint futuristic classroom display backdrop
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, "#122421");
    bgGrad.addColorStop(0.55, "#19312D");
    bgGrad.addColorStop(1, "#1D3832");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Subtle scientific grid
    ctx.strokeStyle = "rgba(164, 203, 191, 0.08)";
    ctx.lineWidth = 1;
    for (let x = 40; x < width; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 40; y < height; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Header bar
    ctx.fillStyle = "rgba(243, 234, 220, 0.09)";
    ctx.fillRect(28, 22, width - 56, 56);
    ctx.strokeStyle = "rgba(164, 203, 191, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(28, 22, width - 56, 56);

    // Brand emblem circle on board
    ctx.fillStyle = "#89A185";
    ctx.beginPath();
    ctx.arc(68, 50, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#F3EADC";
    ctx.beginPath();
    ctx.arc(68, 50, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#5C775C";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("AM", 68, 50);

    // Title
    ctx.fillStyle = "#F3EADC";
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "left";
    const titles: Record<SmartBoardMode, string> = {
      atom: lang === "ar" ? "smart science ai · التركيب الذري والمدارات" : "smart science ai · Atomic Structure & Orbitals",
      solar: lang === "ar" ? "smart science ai · المدارات الفلكية والكواكب" : "smart science ai · Planetary Orbits & Gravity",
      waves: lang === "ar" ? "smart science ai · الموجات التوافقية والطيف" : "smart science ai · Harmonic Waves & Optics",
      molecules: lang === "ar" ? "smart science ai · الروابط الجزيئية والهندسة" : "smart science ai · Molecular Bonds & Geometry",
    };
    ctx.fillText(titles[mode], 102, 50);

    // Teacher attribution on the Smart Board header
    ctx.save();
    if ("direction" in ctx) {
      ctx.direction = lang === "ar" ? "rtl" : "ltr";
    }
    ctx.fillStyle = "#A4CBBF";
    ctx.font = "bold 17px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(
      lang === "ar" ? "إعداد المعلمة أمجاد المري" : "Prepared by Teacher Amjad Al-Marri",
      width - 46,
      50
    );
    ctx.restore();

    // Mode graphic on left/center
    const cx = 310;
    const cy = 286;

    if (mode === "atom") {
      // Three rotating elliptical electron orbitals
      const angles = [0.25, 1.3, 2.35];
      angles.forEach((ang, idx) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang + elapsed * 0.25 * (idx % 2 === 0 ? 1 : -1));
        ctx.strokeStyle = idx === 1 ? "#F3EADC" : "#A4CBBF";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, 150, 56, 0, 0, Math.PI * 2);
        ctx.stroke();

        // Electron moving along orbit
        const eAngle = elapsed * (1.8 + idx * 0.45) + idx * 2.1;
        const ex = Math.cos(eAngle) * 150;
        const ey = Math.sin(eAngle) * 56;
        ctx.fillStyle = "#6EC3AD";
        ctx.beginPath();
        ctx.arc(ex, ey, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#FAF5EC";
        ctx.beginPath();
        ctx.arc(ex - 2, ey - 2, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // Nucleus
      const pulse = 1 + Math.sin(elapsed * 3) * 0.05;
      ctx.fillStyle = "#89A185";
      ctx.beginPath();
      ctx.arc(cx, cy, 28 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#F3EADC";
      ctx.beginPath();
      ctx.arc(cx - 8, cy - 6, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#A4CBBF";
      ctx.beginPath();
      ctx.arc(cx + 9, cy + 7, 10, 0, Math.PI * 2);
      ctx.fill();
    } else if (mode === "solar") {
      // Sun + 3 planetary rings + planets
      const sunGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, 40);
      sunGrad.addColorStop(0, "#FAF5EC");
      sunGrad.addColorStop(0.6, "#DFC89D");
      sunGrad.addColorStop(1, "rgba(217, 203, 181, 0)");
      ctx.fillStyle = sunGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, 40, 0, Math.PI * 2);
      ctx.fill();

      [72, 114, 158].forEach((r, idx) => {
        ctx.strokeStyle = "rgba(243, 234, 220, 0.28)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.56, -0.18, 0, Math.PI * 2);
        ctx.stroke();

        const ang = elapsed * (1.2 - idx * 0.25) + idx * 1.6;
        const px = cx + Math.cos(ang) * r * Math.cos(-0.18) - Math.sin(ang) * r * 0.56 * Math.sin(-0.18);
        const py = cy + Math.cos(ang) * r * Math.sin(-0.18) + Math.sin(ang) * r * 0.56 * Math.cos(-0.18);
        ctx.fillStyle = idx === 0 ? "#A4CBBF" : idx === 1 ? "#89A185" : "#F3EADC";
        ctx.beginPath();
        ctx.arc(px, py, 9 + idx * 2, 0, Math.PI * 2);
        ctx.fill();
      });
    } else if (mode === "waves") {
      // Dual sine waves
      for (let layer = 0; layer < 3; layer++) {
        ctx.strokeStyle =
          layer === 0 ? "#6EC3AD" : layer === 1 ? "#F3EADC" : "rgba(137, 161, 133, 0.85)";
        ctx.lineWidth = layer === 0 ? 3.5 : 2.2;
        ctx.beginPath();
        for (let x = 80; x <= 540; x += 6) {
          const norm = (x - 80) / 460;
          const y =
            cy +
            Math.sin(norm * Math.PI * (4 + layer) - elapsed * (2.6 + layer * 0.5)) *
              (58 - layer * 14) *
              Math.sin(norm * Math.PI);
          if (x === 80) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    } else {
      // Molecular hexagonal network
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 + elapsed * 0.35;
        pts.push([cx + Math.cos(a) * 105, cy + Math.sin(a) * 105]);
      }
      ctx.strokeStyle = "#A4CBBF";
      ctx.lineWidth = 4;
      ctx.beginPath();
      pts.forEach(([px, py], i) => {
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.stroke();

      pts.forEach(([px, py], i) => {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, py);
        ctx.strokeStyle = "rgba(243, 234, 220, 0.35)";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = i % 2 === 0 ? "#89A185" : "#F3EADC";
        ctx.beginPath();
        ctx.arc(px, py, 16, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = "#6EC3AD";
      ctx.beginPath();
      ctx.arc(cx, cy, 22, 0, Math.PI * 2);
      ctx.fill();
    }

    // Right information panel on the smart board
    const rx = 595;
    ctx.fillStyle = "rgba(243, 234, 220, 0.08)";
    ctx.fillRect(rx, 106, 388, 366);
    ctx.strokeStyle = "rgba(164, 203, 191, 0.3)";
    ctx.strokeRect(rx, 106, 388, 366);

    ctx.fillStyle = "#A4CBBF";
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(lang === "ar" ? "Interactive Science Hub" : "Interactive Science Hub", rx + 24, 144);

    ctx.fillStyle = "#F3EADC";
    ctx.font = "16px sans-serif";
    const lines = [
      "• Physics · Chemistry · Biology",
      "• Geology · Mathematics",
      "• AI Lesson Studio & PPTX",
      "• Inclusive Voice & Live Quiz",
    ];
    lines.forEach((line, i) => {
      ctx.fillText(line, rx + 24, 194 + i * 38);
    });

    // Live audio bars at bottom right when robot speaks or ambient pulse
    const bars = 14;
    for (let i = 0; i < bars; i++) {
      const wave = isSpeaking
        ? 14 + Math.abs(Math.sin(elapsed * 8 + i * 0.7)) * 44
        : 10 + Math.abs(Math.sin(elapsed * 2 + i * 0.5)) * 18;
      ctx.fillStyle = i % 2 === 0 ? "#6EC3AD" : "#F3EADC";
      ctx.fillRect(rx + 26 + i * 24, 442 - wave, 14, wave);
    }

    texture.needsUpdate = true;
  };

  draw(0, "atom", "ar", false);

  return {
    texture,
    draw,
    dispose: () => texture.dispose(),
  };
}

export function createClassroomMaterials(
  isSoftwareGl: boolean,
  maxAnisotropy: number,
  boardTexture: THREE.CanvasTexture
): ClassroomMaterials {
  const floorTex = createFloorTileTexture(maxAnisotropy);
  const shadowTex = createContactShadowTexture();

  const robotWhite = new THREE.MeshPhysicalMaterial({
    color: CLASSROOM_PALETTE.porcelainWhite,
    roughness: 0.24,
    metalness: 0.08,
    clearcoat: 0.65,
    clearcoatRoughness: 0.18,
  });

  const robotSage = new THREE.MeshStandardMaterial({
    color: CLASSROOM_PALETTE.sageGreen,
    roughness: 0.36,
    metalness: 0.22,
  });

  const robotCream = new THREE.MeshStandardMaterial({
    color: CLASSROOM_PALETTE.creamyBeige,
    roughness: 0.42,
    metalness: 0.08,
  });

  const robotJoint = new THREE.MeshStandardMaterial({
    color: 0x455953,
    roughness: 0.45,
    metalness: 0.62,
  });

  const robotVisor = new THREE.MeshPhysicalMaterial({
    color: CLASSROOM_PALETTE.slateVisor,
    roughness: 0.12,
    metalness: 0.18,
    clearcoat: 0.9,
    clearcoatRoughness: 0.08,
  });

  const robotGlowMint = new THREE.MeshStandardMaterial({
    color: CLASSROOM_PALETTE.mintBright,
    emissive: CLASSROOM_PALETTE.mintBright,
    emissiveIntensity: 1.35,
    roughness: 0.2,
    metalness: 0.1,
  });

  const floorMaterial = new THREE.MeshStandardMaterial({
    map: floorTex,
    roughness: 0.72,
    metalness: 0.04,
  });

  const rugMaterial = new THREE.MeshStandardMaterial({
    color: 0xdce8df,
    roughness: 0.92,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const wallCream = new THREE.MeshStandardMaterial({
    color: CLASSROOM_PALETTE.warmCream,
    roughness: 0.85,
    metalness: 0.02,
  });

  const wallSageTrim = new THREE.MeshStandardMaterial({
    color: CLASSROOM_PALETTE.sageGreen,
    roughness: 0.56,
    metalness: 0.08,
  });

  const ceilingCream = new THREE.MeshStandardMaterial({
    color: 0xf7f1e6,
    roughness: 0.9,
    metalness: 0.02,
  });

  const deskTopCream = new THREE.MeshPhysicalMaterial({
    color: CLASSROOM_PALETTE.creamyBeige,
    roughness: 0.35,
    metalness: 0.05,
    clearcoat: 0.35,
  });

  const deskFrameSage = new THREE.MeshStandardMaterial({
    color: CLASSROOM_PALETTE.sageDeep,
    roughness: 0.42,
    metalness: 0.35,
  });

  const deskHoloMint = new THREE.MeshStandardMaterial({
    color: CLASSROOM_PALETTE.mintGreen,
    emissive: CLASSROOM_PALETTE.mintBright,
    emissiveIntensity: 0.48,
    roughness: 0.25,
    metalness: 0.12,
  });

  const chairShellCream = new THREE.MeshStandardMaterial({
    color: CLASSROOM_PALETTE.warmCream,
    roughness: 0.48,
    metalness: 0.05,
  });

  const chairCushionSage = new THREE.MeshStandardMaterial({
    color: CLASSROOM_PALETTE.mintGreen,
    roughness: 0.75,
    metalness: 0.02,
  });

  const boardFrameSage = new THREE.MeshStandardMaterial({
    color: CLASSROOM_PALETTE.sageDeep,
    roughness: 0.38,
    metalness: 0.32,
  });

  const boardBezelCream = new THREE.MeshStandardMaterial({
    color: CLASSROOM_PALETTE.creamyBeige,
    roughness: 0.46,
    metalness: 0.1,
  });

  const boardScreen = new THREE.MeshStandardMaterial({
    map: boardTexture,
    emissiveMap: boardTexture,
    emissive: 0xffffff,
    emissiveIntensity: 0.68,
    roughness: 0.22,
    metalness: 0.08,
  });

  const windowFrame = new THREE.MeshStandardMaterial({
    color: CLASSROOM_PALETTE.champagneTrim,
    roughness: 0.45,
    metalness: 0.18,
  });

  const windowGlass = new THREE.MeshPhysicalMaterial({
    color: 0xe6f6f0,
    roughness: 0.1,
    metalness: 0.02,
    transmission: isSoftwareGl ? 0 : 0.72,
    transparent: true,
    opacity: isSoftwareGl ? 0.38 : 0.92,
    ior: 1.48,
    thickness: 0.15,
    depthWrite: false,
  });

  const sunbeamMaterial = new THREE.MeshBasicMaterial({
    color: 0xfbf4e4,
    transparent: true,
    opacity: 0.085,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });

  const atomCore = new THREE.MeshStandardMaterial({
    color: CLASSROOM_PALETTE.sageGreen,
    emissive: CLASSROOM_PALETTE.sageGreen,
    emissiveIntensity: 0.25,
    roughness: 0.32,
    metalness: 0.25,
  });

  const atomRingMint = new THREE.MeshStandardMaterial({
    color: CLASSROOM_PALETTE.mintBright,
    emissive: CLASSROOM_PALETTE.mintGreen,
    emissiveIntensity: 0.38,
    roughness: 0.25,
    metalness: 0.35,
  });

  const atomElectron = new THREE.MeshStandardMaterial({
    color: CLASSROOM_PALETTE.creamyBeige,
    emissive: CLASSROOM_PALETTE.warmCream,
    emissiveIntensity: 0.5,
    roughness: 0.2,
    metalness: 0.15,
  });

  const planetBody = new THREE.MeshStandardMaterial({
    color: CLASSROOM_PALETTE.mintGreen,
    roughness: 0.55,
    metalness: 0.12,
  });

  const planetRing = new THREE.MeshStandardMaterial({
    color: CLASSROOM_PALETTE.creamyBeige,
    roughness: 0.45,
    metalness: 0.15,
    transparent: true,
    opacity: 0.82,
    side: THREE.DoubleSide,
  });

  const geoWire = new THREE.MeshStandardMaterial({
    color: CLASSROOM_PALETTE.sageDeep,
    roughness: 0.35,
    metalness: 0.45,
    wireframe: true,
  });

  const geoCore = new THREE.MeshStandardMaterial({
    color: CLASSROOM_PALETTE.creamyBeige,
    roughness: 0.3,
    metalness: 0.2,
  });

  const contactShadow = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });

  const allMaterials: THREE.Material[] = [
    robotWhite,
    robotSage,
    robotCream,
    robotJoint,
    robotVisor,
    robotGlowMint,
    floorMaterial,
    rugMaterial,
    wallCream,
    wallSageTrim,
    ceilingCream,
    deskTopCream,
    deskFrameSage,
    deskHoloMint,
    chairShellCream,
    chairCushionSage,
    boardFrameSage,
    boardBezelCream,
    boardScreen,
    windowFrame,
    windowGlass,
    sunbeamMaterial,
    atomCore,
    atomRingMint,
    atomElectron,
    planetBody,
    planetRing,
    geoWire,
    geoCore,
    contactShadow,
  ];

  return {
    robotWhite,
    robotSage,
    robotCream,
    robotJoint,
    robotVisor,
    robotGlowMint,
    floorMaterial,
    rugMaterial,
    wallCream,
    wallSageTrim,
    ceilingCream,
    deskTopCream,
    deskFrameSage,
    deskHoloMint,
    chairShellCream,
    chairCushionSage,
    boardFrameSage,
    boardBezelCream,
    boardScreen,
    windowFrame,
    windowGlass,
    sunbeamMaterial,
    atomCore,
    atomRingMint,
    atomElectron,
    planetBody,
    planetRing,
    geoWire,
    geoCore,
    contactShadow,
    dispose: () => {
      floorTex.dispose();
      shadowTex.dispose();
      allMaterials.forEach((m) => m.dispose());
    },
  };
}
