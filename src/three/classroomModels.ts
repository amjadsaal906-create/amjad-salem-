import * as THREE from "three";
import type { ClassroomMaterials } from "./classroomMaterials.ts";

export interface EducatorRobotRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  headGroup: THREE.Group;
  leftEye: THREE.Mesh;
  rightEye: THREE.Mesh;
  mouthBars: THREE.Mesh[];
  leftArmPivot: THREE.Group;
  leftForearmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  rightForearmPivot: THREE.Group;
  hoverRing: THREE.Mesh;
  shadowBlob: THREE.Mesh;
  hitbox: THREE.Mesh;
}

export interface FloatingScienceItem {
  group: THREE.Group;
  kind: "atom" | "molecule" | "planet" | "geometry";
  basePos: THREE.Vector3;
  phase: number;
  orbitElements?: THREE.Object3D[];
  hitbox: THREE.Mesh;
}

export interface SmartClassroomRig {
  classroomGroup: THREE.Group;
  robot: EducatorRobotRig;
  smartBoardHitbox: THREE.Mesh;
  floatingScience: FloatingScienceItem[];
  sunDustPoints: THREE.Points;
  dispose: () => void;
}

function tagLayerRecursive(obj: THREE.Object3D, layer: number) {
  obj.layers.set(layer);
}

/**
 * Builds the 3D Hero Educator Robot (White ceramic body + Sage Green & Creamy Beige accents).
 * Pivoted cleanly at bottom-center (y = 0) with articulated head, torso, hover ring, and arms.
 */
export function createEducatorRobot(materials: ClassroomMaterials): EducatorRobotRig {
  const root = new THREE.Group();
  root.name = "EducatorRobot";

  const bodyGroup = new THREE.Group();
  bodyGroup.position.set(0, 0.22, 0);
  root.add(bodyGroup);

  // 1. Contact shadow at floor y = 0.016
  const shadowBlob = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.35), materials.contactShadow);
  shadowBlob.rotation.x = -Math.PI / 2;
  shadowBlob.position.y = 0.018;
  root.add(shadowBlob);

  // 2. Sculpted Hover Pedestal Base (Creamy beige base + glowing mint levitation ring)
  const lowerSkirt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.36, 0.22, 28),
    materials.robotCream
  );
  lowerSkirt.position.y = 0.18;
  lowerSkirt.castShadow = true;
  bodyGroup.add(lowerSkirt);

  const hoverRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.32, 0.028, 14, 36),
    materials.robotGlowMint
  );
  hoverRing.rotation.x = Math.PI / 2;
  hoverRing.position.y = 0.05;
  bodyGroup.add(hoverRing);

  // Waist joint
  const waist = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.22, 0.16, 24),
    materials.robotJoint
  );
  waist.position.y = 0.35;
  bodyGroup.add(waist);

  // 3. Primary Torso Silhouette (White rounded chassis + Sage Green shoulder yoke + Cream chest medallion)
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.28, 0.36, 12, 28),
    materials.robotWhite
  );
  torso.scale.set(1.06, 1, 0.86);
  torso.position.y = 0.72;
  torso.castShadow = true;
  torso.receiveShadow = true;
  bodyGroup.add(torso);

  const sageCollar = new THREE.Mesh(
    new THREE.TorusGeometry(0.24, 0.055, 16, 32),
    materials.robotSage
  );
  sageCollar.rotation.x = Math.PI / 2;
  sageCollar.position.set(0, 0.98, 0);
  sageCollar.castShadow = true;
  bodyGroup.add(sageCollar);

  // Chest badge (Cream ring + Mint core matching brand emblem)
  const chestRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.105, 0.022, 12, 28),
    materials.robotCream
  );
  chestRing.position.set(0, 0.76, 0.245);
  bodyGroup.add(chestRing);

  const chestCore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.075, 0.02, 24),
    materials.robotGlowMint
  );
  chestCore.rotation.x = Math.PI / 2;
  chestCore.position.set(0, 0.76, 0.24);
  bodyGroup.add(chestCore);

  // 4. Articulated Head with Visor, Glowing Mint Eyes, Talking Mouth Bars & Sage Ear Pods
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.24, 0.02);
  bodyGroup.add(headGroup);

  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 0.14, 20),
    materials.robotJoint
  );
  neck.position.y = -0.13;
  headGroup.add(neck);

  const headShell = new THREE.Mesh(
    new THREE.SphereGeometry(0.27, 28, 24),
    materials.robotWhite
  );
  headShell.scale.set(1.08, 0.94, 0.96);
  headShell.castShadow = true;
  headGroup.add(headShell);

  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.245, 24, 20, -Math.PI * 0.38, Math.PI * 0.76, Math.PI * 0.24, Math.PI * 0.52),
    materials.robotVisor
  );
  visor.rotation.y = Math.PI / 2;
  visor.position.set(0, 0.01, 0.045);
  headGroup.add(visor);

  // Expressive Eyes
  const eyeGeo = new THREE.CapsuleGeometry(0.024, 0.032, 6, 12);
  const leftEye = new THREE.Mesh(eyeGeo, materials.robotGlowMint);
  leftEye.position.set(-0.085, 0.035, 0.245);
  headGroup.add(leftEye);

  const rightEye = new THREE.Mesh(eyeGeo, materials.robotGlowMint);
  rightEye.position.set(0.085, 0.035, 0.245);
  headGroup.add(rightEye);

  // 5-segment animated talking mouth grille
  const mouthBars: THREE.Mesh[] = [];
  const mouthBarGeo = new THREE.BoxGeometry(0.016, 0.022, 0.012);
  for (let i = 0; i < 5; i++) {
    const bar = new THREE.Mesh(mouthBarGeo, materials.robotGlowMint);
    bar.position.set((i - 2) * 0.026, -0.055, 0.252);
    headGroup.add(bar);
    mouthBars.push(bar);
  }

  // Sage Green Ear Acoustic Pods + Cream Accent Rings + Mint Antenna
  [-1, 1].forEach((side) => {
    const ear = new THREE.Mesh(
      new THREE.CylinderGeometry(0.078, 0.078, 0.06, 20),
      materials.robotSage
    );
    ear.rotation.z = Math.PI / 2;
    ear.position.set(side * 0.285, 0.01, 0);
    ear.castShadow = true;
    headGroup.add(ear);

    const earTrim = new THREE.Mesh(
      new THREE.TorusGeometry(0.064, 0.012, 10, 20),
      materials.robotCream
    );
    earTrim.rotation.y = Math.PI / 2;
    earTrim.position.set(side * 0.312, 0.01, 0);
    headGroup.add(earTrim);
  });

  const antennaStem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.01, 0.014, 0.14, 12),
    materials.robotSage
  );
  antennaStem.position.set(0, 0.28, -0.02);
  headGroup.add(antennaStem);

  const antennaTip = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 14, 14),
    materials.robotGlowMint
  );
  antennaTip.position.set(0, 0.36, -0.02);
  headGroup.add(antennaTip);

  // 5. Left & Right Articulated Arms (Shoulder -> Upper Arm -> Elbow -> Forearm -> Sculpted Hand)
  const buildArm = (side: -1 | 1) => {
    const shoulderPivot = new THREE.Group();
    shoulderPivot.position.set(side * 0.34, 0.88, 0);
    bodyGroup.add(shoulderPivot);

    const shoulderPad = new THREE.Mesh(
      new THREE.SphereGeometry(0.088, 18, 18),
      materials.robotSage
    );
    shoulderPad.castShadow = true;
    shoulderPivot.add(shoulderPad);

    const upperArm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.056, 0.22, 8, 16),
      materials.robotWhite
    );
    upperArm.position.set(0, -0.15, 0);
    upperArm.castShadow = true;
    shoulderPivot.add(upperArm);

    const forearmPivot = new THREE.Group();
    forearmPivot.position.set(0, -0.29, 0);
    shoulderPivot.add(forearmPivot);

    const elbowJoint = new THREE.Mesh(
      new THREE.SphereGeometry(0.052, 14, 14),
      materials.robotJoint
    );
    forearmPivot.add(elbowJoint);

    const forearm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.052, 0.2, 8, 16),
      materials.robotCream
    );
    forearm.position.set(0, -0.14, 0);
    forearm.castShadow = true;
    forearmPivot.add(forearm);

    const hand = new THREE.Mesh(
      new THREE.SphereGeometry(0.062, 16, 14),
      materials.robotWhite
    );
    hand.scale.set(0.95, 1.15, 0.72);
    hand.position.set(0, -0.29, 0.02);
    forearmPivot.add(hand);

    return { shoulderPivot, forearmPivot };
  };

  const leftArm = buildArm(-1);
  const rightArm = buildArm(1);

  // Invisible interactive proxy hitbox on layer 1 for fast raycasting
  const hitbox = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 1.9, 0.75),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hitbox.position.set(0, 0.98, 0);
  hitbox.userData = { interactiveKind: "robot" };
  tagLayerRecursive(hitbox, 1);
  root.add(hitbox);

  return {
    root,
    bodyGroup,
    headGroup,
    leftEye,
    rightEye,
    mouthBars,
    leftArmPivot: leftArm.shoulderPivot,
    leftForearmPivot: leftArm.forearmPivot,
    rightArmPivot: rightArm.shoulderPivot,
    rightForearmPivot: rightArm.forearmPivot,
    hoverRing,
    shadowBlob,
    hitbox,
  };
}

/**
 * Builds a single futuristic student desk & chair assembly (multi-part composite Group, bottom-center pivoted at y=0).
 */
function createFuturisticDeskChair(materials: ClassroomMaterials): THREE.Group {
  const unit = new THREE.Group();

  // Desk tabletop (creamy beige rounded slab)
  const topShape = new THREE.Shape();
  const w = 0.62;
  const d = 0.4;
  const r = 0.07;
  topShape.moveTo(-w + r, -d);
  topShape.lineTo(w - r, -d);
  topShape.quadraticCurveTo(w, -d, w, -d + r);
  topShape.lineTo(w, d - r);
  topShape.quadraticCurveTo(w, d, w - r, d);
  topShape.lineTo(-w + r, d);
  topShape.quadraticCurveTo(-w, d, -w, d - r);
  topShape.lineTo(-w, -d + r);
  topShape.quadraticCurveTo(-w, -d, -w + r, -d);

  const tabletopGeo = new THREE.ExtrudeGeometry(topShape, {
    depth: 0.045,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 3,
  });
  tabletopGeo.rotateX(Math.PI / 2);

  const tabletop = new THREE.Mesh(tabletopGeo, materials.deskTopCream);
  tabletop.position.set(0, 0.74, 0);
  tabletop.castShadow = true;
  tabletop.receiveShadow = true;
  unit.add(tabletop);

  // Embedded glowing mint holo-tablet panel on tabletop
  const tablet = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.012, 0.26),
    materials.deskHoloMint
  );
  tablet.position.set(0, 0.752, -0.02);
  unit.add(tablet);

  // Sage cantilevered support legs + sleek floor runners
  [-0.46, 0.46].forEach((lx) => {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.032, 0.71, 14),
      materials.deskFrameSage
    );
    leg.position.set(lx, 0.36, -0.14);
    leg.rotation.x = 0.14;
    leg.castShadow = true;
    unit.add(leg);

    const foot = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.024, 0.44, 6, 12),
      materials.deskFrameSage
    );
    foot.rotation.x = Math.PI / 2;
    foot.position.set(lx, 0.025, 0);
    unit.add(foot);
  });

  // Futuristic Ergonomic Chair (positioned smoothly behind desk at +z)
  const chairZ = 0.56;
  const chairPedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.04, 0.42, 16),
    materials.deskFrameSage
  );
  chairPedestal.position.set(0, 0.22, chairZ);
  chairPedestal.castShadow = true;
  unit.add(chairPedestal);

  const chairBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.26, 0.04, 24),
    materials.deskFrameSage
  );
  chairBase.position.set(0, 0.02, chairZ);
  unit.add(chairBase);

  const seatShell = new THREE.Mesh(
    new THREE.BoxGeometry(0.48, 0.055, 0.44),
    materials.chairShellCream
  );
  seatShell.position.set(0, 0.44, chairZ);
  seatShell.castShadow = true;
  unit.add(seatShell);

  const cushion = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.035, 0.38),
    materials.chairCushionSage
  );
  cushion.position.set(0, 0.475, chairZ - 0.01);
  unit.add(cushion);

  const backrest = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.38, 0.05),
    materials.chairShellCream
  );
  backrest.position.set(0, 0.68, chairZ + 0.21);
  backrest.rotation.x = -0.12;
  backrest.castShadow = true;
  unit.add(backrest);

  return unit;
}

/**
 * Builds floating 3D scientific objects (Atom, Molecule, Ringed Planet, Geometric Polyhedron)
 */
function createFloatingScience(materials: ClassroomMaterials): FloatingScienceItem[] {
  const items: FloatingScienceItem[] = [];

  // 1. 3D Atom (upper front-right)
  const atomGroup = new THREE.Group();
  const atomPos = new THREE.Vector3(3.45, 3.05, -2.15);
  atomGroup.position.copy(atomPos);

  const nucleus = new THREE.Mesh(new THREE.SphereGeometry(0.18, 22, 20), materials.atomCore);
  atomGroup.add(nucleus);

  const atomOrbits: THREE.Object3D[] = [];
  const ringRotations = [
    [0.45, 0.2, 0],
    [-0.5, 0.65, 0.7],
    [0.85, -0.4, -0.5],
  ];
  ringRotations.forEach(([rx, ry, rz], idx) => {
    const orbitPivot = new THREE.Group();
    orbitPivot.rotation.set(rx, ry, rz);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.016, 12, 48), materials.atomRingMint);
    orbitPivot.add(ring);

    const electron = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 14), materials.atomElectron);
    electron.position.set(0.56, 0, 0);
    orbitPivot.add(electron);
    orbitPivot.userData.spinSpeed = 0.8 + idx * 0.35;

    atomGroup.add(orbitPivot);
    atomOrbits.push(orbitPivot);
  });

  const atomHitbox = new THREE.Mesh(
    new THREE.SphereGeometry(0.68, 12, 12),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  atomHitbox.userData = { interactiveKind: "science", scienceType: "atom" };
  tagLayerRecursive(atomHitbox, 1);
  atomGroup.add(atomHitbox);
  items.push({
    group: atomGroup,
    kind: "atom",
    basePos: atomPos.clone(),
    phase: 0.2,
    orbitElements: atomOrbits,
    hitbox: atomHitbox,
  });

  // 2. 3D Molecule Structure (upper left near windows)
  const molGroup = new THREE.Group();
  const molPos = new THREE.Vector3(-3.35, 3.15, -1.75);
  molGroup.position.copy(molPos);

  const centerAtom = new THREE.Mesh(new THREE.SphereGeometry(0.2, 22, 20), materials.robotSage);
  molGroup.add(centerAtom);

  const bondDirs = [
    new THREE.Vector3(0.48, 0.32, 0.15),
    new THREE.Vector3(-0.48, 0.32, -0.1),
    new THREE.Vector3(0.05, -0.45, 0.35),
  ];
  bondDirs.forEach((dir, idx) => {
    const endPos = dir.clone();
    const len = endPos.length();
    const bond = new THREE.Mesh(
      new THREE.CylinderGeometry(0.036, 0.036, len, 12),
      materials.robotCream
    );
    bond.position.copy(endPos.clone().multiplyScalar(0.5));
    bond.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), endPos.clone().normalize());
    molGroup.add(bond);

    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 18, 16),
      idx === 2 ? materials.atomRingMint : materials.atomElectron
    );
    orb.position.copy(endPos);
    molGroup.add(orb);
  });

  const molHitbox = new THREE.Mesh(
    new THREE.SphereGeometry(0.65, 12, 12),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  molHitbox.userData = { interactiveKind: "science", scienceType: "molecule" };
  tagLayerRecursive(molHitbox, 1);
  molGroup.add(molHitbox);
  items.push({
    group: molGroup,
    kind: "molecule",
    basePos: molPos.clone(),
    phase: 1.8,
    hitbox: molHitbox,
  });

  // 3. 3D Ringed Planet (mid-right ceiling gallery)
  const planetGroup = new THREE.Group();
  const planetPos = new THREE.Vector3(3.7, 2.95, 1.3);
  planetGroup.position.copy(planetPos);

  const planetSphere = new THREE.Mesh(new THREE.SphereGeometry(0.29, 26, 22), materials.planetBody);
  planetGroup.add(planetSphere);

  const ringMesh = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.64, 48), materials.planetRing);
  ringMesh.rotation.set(Math.PI * 0.36, 0.25, 0.15);
  planetGroup.add(ringMesh);

  const moonPivot = new THREE.Group();
  const moon = new THREE.Mesh(new THREE.SphereGeometry(0.065, 14, 14), materials.atomElectron);
  moon.position.set(0.75, 0.08, 0);
  moonPivot.add(moon);
  planetGroup.add(moonPivot);

  const planetHitbox = new THREE.Mesh(
    new THREE.SphereGeometry(0.72, 12, 12),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  planetHitbox.userData = { interactiveKind: "science", scienceType: "planet" };
  tagLayerRecursive(planetHitbox, 1);
  planetGroup.add(planetHitbox);
  items.push({
    group: planetGroup,
    kind: "planet",
    basePos: planetPos.clone(),
    phase: 3.1,
    orbitElements: [moonPivot],
    hitbox: planetHitbox,
  });

  // 4. 3D Geometric Polyhedron (upper left-mid)
  const geoGroup = new THREE.Group();
  const geoPos = new THREE.Vector3(-3.45, 2.85, 1.45);
  geoGroup.position.copy(geoPos);

  const outerCage = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), materials.geoWire);
  geoGroup.add(outerCage);

  const innerCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), materials.geoCore);
  geoGroup.add(innerCrystal);

  const geoHitbox = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 12, 12),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  geoHitbox.userData = { interactiveKind: "science", scienceType: "geometry" };
  tagLayerRecursive(geoHitbox, 1);
  geoGroup.add(geoHitbox);
  items.push({
    group: geoGroup,
    kind: "geometry",
    basePos: geoPos.clone(),
    phase: 4.5,
    orbitElements: [innerCrystal],
    hitbox: geoHitbox,
  });

  return items;
}

/**
 * Builds the complete 3D Futuristic Smart Classroom interior:
 * - Architectural walls, sage acoustic trims, creamy floor, stage rug
 * - Large Smart Board & animated science display in front
 * - Left-side tall daylight windows with soft volumetric sunlight shafts
 * - 4 ergonomic futuristic student desk/chair stations arranged in rows
 * - Hero White+Sage+Cream Educator Robot standing beside the smart board
 * - Floating 3D Atom, Molecule, Planet, Geometry elements + floating sunlit motes
 */
export function buildSmartClassroomScene(materials: ClassroomMaterials): SmartClassroomRig {
  const classroomGroup = new THREE.Group();
  const disposableGeometries: THREE.BufferGeometry[] = [];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposableGeometries.push(g);
    return g;
  };

  // Floor (16m x 14m)
  const floor = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(16, 14)), materials.floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  classroomGroup.add(floor);

  // Subtle mint/sage acoustic teaching stage rug at front (y = 0.015 so zero Z-fighting)
  const stageRug = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(3.4, 3.45, 0.024, 48)),
    materials.rugMaterial
  );
  stageRug.scale.set(1.35, 1, 0.62);
  stageRug.position.set(0, 0.014, -2.55);
  stageRug.receiveShadow = true;
  classroomGroup.add(stageRug);

  // Front Teaching Wall (z = -4.2) + Sage Architectural Pilasters
  const frontWall = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(13.2, 5.2, 0.2)),
    materials.wallCream
  );
  frontWall.position.set(0, 2.6, -4.3);
  frontWall.receiveShadow = true;
  classroomGroup.add(frontWall);

  // Decorative curved sage header fascia above smart board
  const topFascia = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(11.6, 0.24, 0.28)),
    materials.wallSageTrim
  );
  topFascia.position.set(0, 4.35, -4.15);
  classroomGroup.add(topFascia);

  // Right Acoustic Slatted Wall (x = +6.1)
  const rightWall = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.2, 5.2, 12.5)),
    materials.wallCream
  );
  rightWall.position.set(6.1, 2.6, 1.4);
  rightWall.receiveShadow = true;
  classroomGroup.add(rightWall);

  // Vertical Sage Acoustic Slats along Right Wall
  for (let i = 0; i < 6; i++) {
    const slat = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.08, 3.6, 0.28)),
      materials.wallSageTrim
    );
    slat.position.set(5.96, 2.2, -2.6 + i * 1.45);
    classroomGroup.add(slat);
  }

  // Left Window Wall (x = -5.6) with 3 Large Sunlight Windows
  const leftWallLower = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.24, 0.9, 12.5)),
    materials.wallCream
  );
  leftWallLower.position.set(-5.6, 0.45, 1.4);
  classroomGroup.add(leftWallLower);

  const leftWallUpper = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.24, 1.0, 12.5)),
    materials.wallCream
  );
  leftWallUpper.position.set(-5.6, 4.7, 1.4);
  classroomGroup.add(leftWallUpper);

  [-2.6, 0.4, 3.4].forEach((wz) => {
    // Window mullion pillar
    const pillar = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.28, 3.3, 0.48)),
      materials.wallCream
    );
    pillar.position.set(-5.6, 2.55, wz - 1.5);
    classroomGroup.add(pillar);

    // Window frame & glass pane
    const sill = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.36, 0.09, 2.52)),
      materials.windowFrame
    );
    sill.position.set(-5.56, 0.92, wz);
    classroomGroup.add(sill);

    const glassPane = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(2.48, 3.15)),
      materials.windowGlass
    );
    glassPane.rotation.y = Math.PI / 2;
    glassPane.position.set(-5.58, 2.52, wz);
    glassPane.renderOrder = 2;
    classroomGroup.add(glassPane);

    // Soft natural daylight shaft entering diagonally across the classroom
    const beam = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(2.3, 6.2)),
      materials.sunbeamMaterial
    );
    beam.position.set(-2.9, 2.05, wz);
    beam.rotation.y = Math.PI / 2;
    beam.rotation.x = -0.62;
    beam.renderOrder = 3;
    classroomGroup.add(beam);
  });

  // Ceiling Acoustic Beams
  [-2.5, -0.3, 1.9, 4.1].forEach((cz) => {
    const beam = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(11.6, 0.14, 0.36)),
      materials.ceilingCream
    );
    beam.position.set(0.2, 4.85, cz);
    classroomGroup.add(beam);
  });

  // Large Interactive Smart Board & Scientific Display at Front Center-Right
  const boardGroup = new THREE.Group();
  boardGroup.position.set(0.85, 2.25, -4.08);
  classroomGroup.add(boardGroup);

  const outerBezel = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(5.15, 2.65, 0.12)),
    materials.boardFrameSage
  );
  outerBezel.castShadow = true;
  boardGroup.add(outerBezel);

  const innerBezel = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(4.92, 2.44, 0.13)),
    materials.boardBezelCream
  );
  innerBezel.position.z = 0.015;
  boardGroup.add(innerBezel);

  const screenMesh = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(4.72, 2.26)),
    materials.boardScreen
  );
  screenMesh.position.z = 0.088;
  boardGroup.add(screenMesh);

  // Subtle mint LED bar beneath smart board
  const boardShelf = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(4.2, 0.06, 0.24)),
    materials.deskFrameSage
  );
  boardShelf.position.set(0, -1.36, 0.12);
  boardGroup.add(boardShelf);

  const smartBoardHitbox = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(4.9, 2.5, 0.3)),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  smartBoardHitbox.position.copy(boardGroup.position);
  smartBoardHitbox.userData = { interactiveKind: "board" };
  tagLayerRecursive(smartBoardHitbox, 1);
  classroomGroup.add(smartBoardHitbox);

  // Futuristic Student Desks & Chairs (2 balanced rows of 2)
  const deskPositions: Array<[number, number, number]> = [
    [-2.05, 0, 0.25],
    [1.85, 0, 0.25],
    [-2.15, 0, 2.35],
    [1.95, 0, 2.35],
  ];
  deskPositions.forEach(([dx, dy, dz]) => {
    const desk = createFuturisticDeskChair(materials);
    desk.position.set(dx, dy, dz);
    // Subtle natural angle slightly toward the smart board
    desk.rotation.y = dx < 0 ? 0.08 : -0.08;
    classroomGroup.add(desk);
  });

  // Hero 3D Educator Robot standing beside the Smart Board on the left-front stage
  const robot = createEducatorRobot(materials);
  robot.root.position.set(-2.35, 0, -2.55);
  robot.root.rotation.y = 0.26;
  classroomGroup.add(robot.root);

  // Floating 3D Scientific Elements around the classroom
  const floatingScience = createFloatingScience(materials);
  floatingScience.forEach((item) => classroomGroup.add(item.group));

  // Soft sunlit floating dust particles
  const particleCount = 64;
  const posArray = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    posArray[i * 3] = (Math.sin(i * 12.9898) * 0.5) * 9.5;
    posArray[i * 3 + 1] = 0.6 + ((Math.cos(i * 78.233) * 0.5 + 0.5) * 3.4);
    posArray[i * 3 + 2] = (Math.sin(i * 37.719) * 0.5) * 7.5;
  }
  const dustGeo = trackGeo(new THREE.BufferGeometry());
  dustGeo.setAttribute("position", new THREE.BufferAttribute(posArray, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0xf7efe3,
    size: 0.045,
    transparent: true,
    opacity: 0.55,
  });
  const sunDustPoints = new THREE.Points(dustGeo, dustMat);
  classroomGroup.add(sunDustPoints);

  return {
    classroomGroup,
    robot,
    smartBoardHitbox,
    floatingScience,
    sunDustPoints,
    dispose: () => {
      disposableGeometries.forEach((g) => g.dispose());
      dustMat.dispose();
      classroomGroup.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).geometry?.dispose();
        }
      });
    },
  };
}
