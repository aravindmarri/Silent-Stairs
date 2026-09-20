import * as THREE from 'three';
import { createStaircase, createMarker } from '../geometry.js';
import { stairDimensions } from './stairDimensions.js';

// A fixed tower (base + core) carries a rotating collar assembly on top
// — the collar, the central landing (B), a staircase arm, and a visible
// handle all rotate together in 90° steps. Two islands sit at fixed
// compass points around the tower: A to the west, C to the north. The
// arm's far end traces a circle at the same radius as both islands, so
// rotating it in quarter turns cycles its resting point through
// west/north/east/south — only two of which (west, north) actually
// dock with anything; the other two are the "empty" directions.
//
// Every point this returns lives in the returned `group`'s own local
// space (added to `world` by main.js, with `world.rotation.y` staying
// at 0 for this level — this mechanic doesn't use the camera-illusion
// world-rotation at all, only the collar's own local rotation).
export function buildTowerLevel() {
  const group = new THREE.Group();

  // ---------- tunable proportions ----------
  const LANDING_SURFACE_HEIGHT = 3.4; // where the ghost stands on B, and the arm's top (entry)
  const LANDING_THICKNESS = 0.3;
  const COLLAR_HEIGHT = 0.4;
  const CORE_TOP = LANDING_SURFACE_HEIGHT - LANDING_THICKNESS - COLLAR_HEIGHT;
  const BASE_HEIGHT = 0.9;
  const BASE_RADIUS = 1.6;
  const CORE_RADIUS = 1.0;
  const COLLAR_RADIUS = 1.15;
  const LANDING_RADIUS = 1.3;

  const STONE_COLOR = 0xc9c2b4;
  const COLLAR_COLOR = 0x9aa3ad;
  const STAIR_COLOR = 0xe4dccb;
  const ISLAND_SIZE = 2.6;
  const ISLAND_THICKNESS = 0.6;
  const ISLAND_FOOT_WIDTH = 2.6;

  // ---------- fixed tower: base + core (never rotates) ----------
  const stoneMat = new THREE.MeshStandardMaterial({ color: STONE_COLOR, roughness: 0.9, metalness: 0.04 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(BASE_RADIUS, BASE_RADIUS * 1.15, BASE_HEIGHT, 24), stoneMat);
  base.position.y = BASE_HEIGHT / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const core = new THREE.Mesh(new THREE.CylinderGeometry(CORE_RADIUS, CORE_RADIUS * 1.08, CORE_TOP - BASE_HEIGHT, 20), stoneMat);
  core.position.y = (BASE_HEIGHT + CORE_TOP) / 2;
  core.castShadow = true;
  core.receiveShadow = true;
  group.add(core);

  // ---------- rotating assembly: collar + landing (B) + arm + handle ----------
  const collarGroup = new THREE.Group();
  collarGroup.position.y = CORE_TOP;
  group.add(collarGroup);

  const collarMat = new THREE.MeshStandardMaterial({ color: COLLAR_COLOR, roughness: 0.45, metalness: 0.45 });
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(COLLAR_RADIUS, COLLAR_RADIUS, COLLAR_HEIGHT, 24), collarMat);
  collar.position.y = COLLAR_HEIGHT / 2;
  collar.castShadow = true;
  collarGroup.add(collar);

  const landingMat = new THREE.MeshStandardMaterial({ color: STAIR_COLOR, roughness: 0.85, metalness: 0.05 });
  const landing = new THREE.Mesh(new THREE.CylinderGeometry(LANDING_RADIUS, LANDING_RADIUS, LANDING_THICKNESS, 24), landingMat);
  landing.position.y = COLLAR_HEIGHT + LANDING_THICKNESS / 2;
  landing.castShadow = true;
  landing.receiveShadow = true;
  collarGroup.add(landing);

  // The handle: a visible lever on the collar's rim, purely to read as
  // "this is the control for the rotating part" — it turns with the
  // assembly, so its own position always shows the current orientation.
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.35, metalness: 0.6 });
  const handleArm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.7), handleMat);
  handleArm.position.set(0, COLLAR_HEIGHT / 2, COLLAR_RADIUS + 0.25);
  handleArm.castShadow = true;
  collarGroup.add(handleArm);
  const handleGrip = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 14), handleMat);
  handleGrip.position.set(0, COLLAR_HEIGHT / 2, COLLAR_RADIUS + 0.62);
  handleGrip.castShadow = true;
  collarGroup.add(handleGrip);

  // The arm: built with geometry.js's usual staircase. Its entry
  // (top, back of the first tread) sits exactly at its own local
  // y=steps*rise; its exit (bottom) is the *nosing* of the last tread —
  // one rise above the object's own y=0 — not the floor itself (see
  // geometry.js: the walking path never steps down past that nosing
  // onto an implied floor beyond it). Shifting the whole arm down by
  // CORE_TOP puts the entry exactly at world y=LANDING_SURFACE_HEIGHT
  // (on B); the exit then naturally lands at world y=ARM_RISE, which is
  // therefore the height islands' platforms and connector points need
  // to sit at — not y=0 — for the two to actually meet.
  const ARM_STEPS = 5;
  const ARM_RISE = LANDING_SURFACE_HEIGHT / ARM_STEPS;
  const arm = createStaircase({
    ...stairDimensions,
    steps: ARM_STEPS,
    rise: ARM_RISE,
    color: STAIR_COLOR,
    enlargeFirst: false,
    enlargeLast: true,
  });
  const armOffset = new THREE.Vector3(0, -CORE_TOP, 0);
  arm.group.position.copy(armOffset);
  collarGroup.add(arm.group);

  // Everything the runtime needs about the arm, in collarGroup-local space.
  const armPathInCollar = arm.pathLocal.map((p) => p.clone().add(armOffset));
  const armEntryInCollar = arm.entryLocal.clone().add(armOffset); // = B's standing point (on the rotation axis)
  const armExitInCollar = arm.exitLocal.clone().add(armOffset);
  const armLength = arm.length;
  const ISLAND_SURFACE_Y = ARM_RISE;

  // ---------- islands ----------
  // West = -X, North = -Z. The arm points local +X at rotationStep 0;
  // rotating the collar by 90° steps cycles its far end through
  // east(0) -> north(1) -> west(2) -> south(3) -> east(0)... so island
  // connector points are placed exactly on that same circle, at the
  // arm's actual exit height (ISLAND_SURFACE_Y), not y=0.
  function buildIsland(outward) {
    const islandGroup = new THREE.Group();
    islandGroup.position.copy(outward.clone().multiplyScalar(armLength));
    islandGroup.position.y = ISLAND_SURFACE_Y;

    const alongX = Math.abs(outward.x) > 0.5;
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(alongX ? ISLAND_SIZE : ISLAND_FOOT_WIDTH, ISLAND_THICKNESS, alongX ? ISLAND_FOOT_WIDTH : ISLAND_SIZE),
      new THREE.MeshStandardMaterial({ color: STAIR_COLOR, roughness: 0.85, metalness: 0.05 })
    );
    platform.position.copy(outward.clone().multiplyScalar(ISLAND_SIZE / 2));
    platform.position.y = -ISLAND_THICKNESS / 2;
    platform.castShadow = true;
    platform.receiveShadow = true;
    islandGroup.add(platform);

    return {
      group: islandGroup,
      connectorLocal: new THREE.Vector3(0, 0, 0),
      connectorWorld: islandGroup.position.clone(),
      farLocal: outward.clone().multiplyScalar(ISLAND_SIZE * 0.65),
      approachDir: outward.clone(),
    };
  }

  const islandA = buildIsland(new THREE.Vector3(-1, 0, 0));
  const islandC = buildIsland(new THREE.Vector3(0, 0, -1));
  group.add(islandA.group, islandC.group);

  islandA.startLocal = islandA.farLocal.clone();
  const startMarker = createMarker(0x6bd08a);
  startMarker.position.copy(islandA.startLocal).add(new THREE.Vector3(0, 0.4, 0));
  islandA.group.add(startMarker);

  islandC.goalLocal = islandC.farLocal.clone();
  const goalMarker = createMarker(0xf2c14e);
  goalMarker.position.copy(islandC.goalLocal).add(new THREE.Vector3(0, 0.4, 0));
  islandC.group.add(goalMarker);

  // A softly glowing exit marker on C: an emissive ring flush with the
  // platform plus a small point light, so the destination reads clearly
  // even before the ghost arrives.
  const glowRing = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.5, 32),
    new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  );
  glowRing.rotation.x = -Math.PI / 2;
  glowRing.position.copy(islandC.goalLocal).add(new THREE.Vector3(0, 0.02, 0));
  islandC.group.add(glowRing);
  const glowLight = new THREE.PointLight(0xffe9a8, 1.1, 4, 2);
  glowLight.position.copy(islandC.goalLocal).add(new THREE.Vector3(0, 0.6, 0));
  islandC.group.add(glowLight);

  // ---------- level radius (rotation-invariant: everything here only
  // ever rotates about the tower's own vertical axis through the origin) ----------
  const farPoints = [
    islandA.group.position.clone().add(new THREE.Vector3(-ISLAND_SIZE, 0, 0)),
    islandC.group.position.clone().add(new THREE.Vector3(0, 0, -ISLAND_SIZE)),
    new THREE.Vector3(0, LANDING_SURFACE_HEIGHT, 0),
  ];
  const levelRadius = Math.max(...farPoints.map((p) => p.length())) + 1.0;

  return {
    group,
    collarGroup,
    arm: { pathLocal: armPathInCollar, entryLocal: armEntryInCollar, exitLocal: armExitInCollar },
    islands: { A: islandA, C: islandC },
    levelRadius,
  };
}
