import * as THREE from 'three';
import { createStaircase, createMarker } from '../geometry.js';
import { solveConnectorPosition } from '../align.js';

// Builds a chain of N staircases (N-1 connections) that all rotate
// together as one rigid level: the first sits at the chain's own local
// origin; each later one is placed (translation only — never rotated
// relative to the chain, which is what keeps a connecting edge's full
// width matching on screen, not just its center point) so its entrance
// point lines up on screen with the previous stair's exit point at that
// connection's own solved angle, while sitting `connectionDepths[i]`
// further from the camera in true 3D space.
//
// Every point/edge this returns is already expressed in the chain
// group's own local space, so callers (the level runtime) never need
// to know which stairs have a placement offset and which don't.
export function buildStairChain({ camera, stairSpecs, connectionAngles, connectionDepths, center = false }) {
  const group = new THREE.Group();
  const stairs = []; // { pathLocal, entryEdge, exitEdge, entryLocal, exitLocal, height }

  const transformPoint = (p, m) => (m ? p.clone().applyMatrix4(m) : p.clone());
  const transformEdge = (e, m) => ({ a: transformPoint(e.a, m), b: transformPoint(e.b, m) });

  for (let i = 0; i < stairSpecs.length; i++) {
    const raw = createStaircase(stairSpecs[i]);
    let placementMatrix = null;

    if (i === 0) {
      group.add(raw.group);
    } else {
      const prevExitWorldLocal = stairs[i - 1].exitLocal;
      const connector = solveConnectorPosition(prevExitWorldLocal, camera, connectionAngles[i - 1], connectionDepths[i - 1]);

      const placement = new THREE.Group();
      placement.position.set(connector.x, connector.y - raw.height, connector.z);
      placement.add(raw.group);
      group.add(placement);

      placementMatrix = new THREE.Matrix4().makeRotationY(placement.rotation.y).setPosition(placement.position);
    }

    stairs.push({
      pathLocal: raw.pathLocal.map((p) => transformPoint(p, placementMatrix)),
      entryEdge: transformEdge(raw.entryEdge, placementMatrix),
      exitEdge: transformEdge(raw.exitEdge, placementMatrix),
      entryLocal: transformPoint(raw.entryLocal, placementMatrix),
      exitLocal: transformPoint(raw.exitLocal, placementMatrix),
      height: raw.height,
    });
  }

  if (center) {
    // Move geometry AND walking/connection coordinates together. Rotating
    // about the puzzle's middle preserves the solved edge alignment.
    const midpoint = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
    const offset = new THREE.Vector3(0, 2, 0).sub(midpoint);
    for (const child of group.children) child.position.add(offset);
    for (const stair of stairs) {
      for (const point of [...stair.pathLocal, stair.entryLocal, stair.exitLocal,
        stair.entryEdge.a, stair.entryEdge.b, stair.exitEdge.a, stair.exitEdge.b]) {
        point.add(offset);
      }
    }
  }

  // One connection per adjacent pair, each with its own solved target
  // angle and a highlight bar that only ever needs to sit at the
  // *previous* stair's exit edge (which coincides with the next stair's
  // entrance edge on screen only at that connection's own angle).
  const connections = [];
  for (let i = 0; i < stairs.length - 1; i++) {
    const highlight = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, stairSpecs[i].width * 0.92),
      new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.85 })
    );
    highlight.position.copy(stairs[i].exitLocal);
    highlight.visible = false;
    group.add(highlight);

    connections.push({
      targetAngle: connectionAngles[i],
      fromExitEdge: stairs[i].exitEdge,
      toEntryEdge: stairs[i + 1].entryEdge,
      highlight,
    });
  }

  const startMarker = createMarker(0x6bd08a);
  startMarker.position.copy(stairs[0].entryLocal).add(new THREE.Vector3(0, 0.4, 0));
  group.add(startMarker);

  const lastStair = stairs[stairs.length - 1];
  const goalMarker = createMarker(0xf2c14e);
  goalMarker.position.copy(lastStair.exitLocal).add(new THREE.Vector3(0, 0.4, 0));
  group.add(goalMarker);

  // The chain only ever rotates about Y through its own local origin,
  // so the farthest any of its points get from that origin is a
  // rotation-invariant bound on how much of it the camera needs to see.
  const allPoints = stairs.flatMap((s) => s.pathLocal);
  const levelRadius = Math.max(...allPoints.map((p) => p.length())) + 1.2;

  return {
    group,
    stairs,
    connections,
    startLocal: stairs[0].entryLocal.clone(),
    goalLocal: lastStair.exitLocal.clone(),
    levelRadius,
  };
}
