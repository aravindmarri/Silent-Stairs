import * as THREE from 'three';

// A person under a draped bedsheet: a small head-bump up top (where the
// sheet is pulled taut), flaring out into a much wider hem below (where
// the fabric hangs loose). Every vertex gets a static per-angle "fold"
// so the sheet reads as creased cloth rather than a smooth balloon, and
// the whole surface sways continuously — strongest at the loose hem,
// almost still up near the head — like air is moving through it. The
// hem's bottom ring is additionally scalloped into soft points, the
// classic sheet-ghost silhouette.
export function createGhost({ color = 0xf6f7fb, radius = 0.42, height = 1.5 } = {}) {
  const group = new THREE.Group();
  // Visuals live on an inner group so the idle float/bob (below) can
  // offset this without fighting whatever animates `group.position`
  // (e.g. walkPath moving the ghost along the level's waypoints).
  const visual = new THREE.Group();
  group.add(visual);

  const sheetMat = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity: 0.88,
    roughness: 0.55,
    metalness: 0,
    emissive: new THREE.Color(color).multiplyScalar(0.1),
    side: THREE.DoubleSide,
  });

  // Everything is placed with the hem's bottom rim resting at local
  // y=0, so the group's own origin is the ghost's "ground contact"
  // point — the same convention the staircase waypoints use.
  const bodyHeight = height * 0.9;
  const headRadius = radius * 0.72;
  const domeCenterY = bodyHeight;

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(headRadius, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    sheetMat
  );
  head.position.y = domeCenterY;
  head.castShadow = true;
  visual.add(head);

  const radialSegments = 26;
  const heightSegments = 3;
  const topRadius = headRadius;
  const bottomRadius = radius * 1.55;
  const sheetGeo = new THREE.CylinderGeometry(topRadius, bottomRadius, bodyHeight, radialSegments, heightSegments, true);
  sheetGeo.translate(0, domeCenterY - bodyHeight / 2, 0);

  const posAttr = sheetGeo.attributes.position;
  const topY = domeCenterY;
  const bottomY = domeCenterY - bodyHeight;
  const base = [];
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i);
    const heightFrac = THREE.MathUtils.clamp((topY - y) / bodyHeight, 0, 1);
    base.push({
      x: posAttr.getX(i),
      z: posAttr.getZ(i),
      y,
      heightFrac,
      isHem: Math.abs(y - bottomY) < 0.001,
    });
  }

  const sheet = new THREE.Mesh(sheetGeo, sheetMat);
  sheet.castShadow = true;
  visual.add(sheet);

  const sunglasses = createSunglasses();
  sunglasses.position.set(0, domeCenterY + headRadius * 0.08, headRadius * 0.92);
  visual.add(sunglasses);

  const sparkles = createSparkles();
  group.add(sparkles.group);

  const FOLD_COUNT = 6;
  const FOLD_AMP = 0.06;
  const HEM_JAG_COUNT = 5;
  const HEM_JAG_AMP = 0.13;
  const FLUTTER_AMP = 0.05;
  const FLUTTER_SPEED = 2.2;
  // While moving, the sheet billows harder — like it's catching air —
  // rather than just holding its idle sway.
  const MOVING_FLUTTER_BOOST = 2.4;
  const MOVING_SPEED_BOOST = 1.6;
  // The whole ghost group is rotated (elsewhere) to face its direction
  // of travel, so in this local frame "backward" is always -Z — no
  // travel direction needs to be passed in here.
  const WIND_AMP = 0.24;
  // Applied to every vertex regardless of side, so the front of the
  // sheet also gets swept backward (hugging in) while moving, not just
  // the back streaming out — the whole sheet leans back into the wind.
  const WIND_BASE = 0.1;

  function update(time, moving = false) {
    const flutterAmp = FLUTTER_AMP * (moving ? MOVING_FLUTTER_BOOST : 1);
    const flutterSpeed = FLUTTER_SPEED * (moving ? MOVING_SPEED_BOOST : 1);

    for (let i = 0; i < base.length; i++) {
      const p = base[i];
      const angle = Math.atan2(p.z, p.x);
      // 1 at the back of the sheet (-Z), 0 at the front, smoothly in
      // between at the sides — trailing cloth streams from the back,
      // the front stays close to the body.
      const backwardness = Math.max(0, -Math.sin(angle));

      const fold = FOLD_AMP * p.heightFrac * Math.sin(angle * FOLD_COUNT);
      const flutterBoost = 1 + backwardness * 1.5;
      const flutter = flutterAmp * flutterBoost * p.heightFrac * Math.sin(time * flutterSpeed + angle * 3 + p.heightFrac * 2);
      const wind = moving ? (WIND_BASE + WIND_AMP * backwardness) * p.heightFrac : 0;
      const radialScale = 1 + (fold + flutter) / radius;

      let y = p.y;
      if (p.isHem) {
        y += -Math.abs(HEM_JAG_AMP * Math.sin(angle * HEM_JAG_COUNT)) + flutter * 0.6;
      }

      posAttr.setX(i, p.x * radialScale);
      posAttr.setZ(i, p.z * radialScale - wind * 0.6);
      posAttr.setY(i, y);
    }
    posAttr.needsUpdate = true;
    sheetGeo.computeVertexNormals();

    // Hover stays well above ground contact (never dips below the
    // standing surface it was placed on) — only the amount of lift varies.
    visual.position.y = 0.2 + Math.sin(time * 1.8) * 0.05;

    sparkles.update(time, moving);
  }

  return { group, update };
}

// A small ring of glowing motes that rise and fade beneath the ghost,
// only while it's moving — a light magical trail rather than a
// constant effect.
function createSparkles(count = 16) {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.045, 8, 8);
  const items = [];

  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xeaf6ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    items.push({
      mesh,
      angle: Math.random() * Math.PI * 2,
      radius: 0.15 + Math.random() * 0.3,
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 0.5,
    });
    group.add(mesh);
  }

  function update(time, active) {
    for (const s of items) {
      const cycle = ((time * s.speed + s.phase) / (Math.PI * 2)) % 1;
      const rise = cycle * 0.7;
      const inwardPull = 1 - cycle * 0.5;
      s.mesh.position.set(
        Math.cos(s.angle) * s.radius * inwardPull,
        rise,
        Math.sin(s.angle) * s.radius * inwardPull
      );
      const scale = 0.5 + Math.sin(cycle * Math.PI) * 0.5;
      s.mesh.scale.setScalar(scale);
      const fade = Math.sin(cycle * Math.PI);
      s.mesh.material.opacity = active ? fade : 0;
    }
  }

  return { group, update };
}

function createSunglasses() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.15, metalness: 0.5 });

  const lensGeo = new THREE.SphereGeometry(0.09, 14, 10);
  const lensL = new THREE.Mesh(lensGeo, mat);
  lensL.scale.set(1, 0.7, 0.35);
  lensL.position.set(0.12, 0, 0);
  const lensR = lensL.clone();
  lensR.position.set(-0.12, 0, 0);
  group.add(lensL, lensR);

  const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 6), mat);
  bridge.rotation.z = Math.PI / 2;
  group.add(bridge);

  // Temples: lie flat and run backward from the outer lens edge (toward
  // the ears), like real glasses — not standing upright off the lens.
  const armGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.22, 6);
  const armL = new THREE.Mesh(armGeo, mat);
  armL.rotation.x = Math.PI / 2;
  armL.rotation.z = 0.14;
  armL.position.set(0.185, -0.005, -0.11);
  const armR = armL.clone();
  armR.position.x = -0.185;
  armR.rotation.z = -0.14;
  group.add(armL, armR);

  return group;
}
