// Drag-to-rotate: horizontal pointer movement spins `target.rotation.y`.
// The camera never moves — the world is a turntable. Built entirely on
// Pointer Events (unified mouse/touch/pen), with pointer capture so the
// drag keeps tracking even if the pointer leaves the canvas, and
// `pointercancel` handled the same as a release so a cancelled gesture
// (e.g. the browser taking over for a system gesture) can't leave
// `dragging` stuck true.
//
// `targetOrGetter` may be a fixed Object3D, or a function returning the
// current one — the latter lets a single set of listeners (and a single
// lock/unlock state) survive across level loads, since the "world"
// group being rotated is a different object per level.
export function attachDragRotate(domElement, targetOrGetter, { sensitivity = 0.008, onChange, onRelease } = {}) {
  const getTarget = typeof targetOrGetter === 'function' ? targetOrGetter : () => targetOrGetter;

  let dragging = false;
  let locked = false;
  let lastX = 0;
  let activePointerId = null;

  const down = (e) => {
    if (locked) return;
    dragging = true;
    lastX = e.clientX;
    activePointerId = e.pointerId;
    domElement.setPointerCapture?.(e.pointerId);
  };

  const move = (e) => {
    if (locked || !dragging || e.pointerId !== activePointerId) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    const target = getTarget();
    target.rotation.y += dx * sensitivity;
    onChange?.(target.rotation.y);
  };

  const end = (e) => {
    if (e.pointerId !== activePointerId) return;
    const wasDragging = dragging;
    dragging = false;
    activePointerId = null;
    if (wasDragging && !locked) onRelease?.(getTarget().rotation.y);
  };

  domElement.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);

  return {
    lock() {
      locked = true;
      dragging = false;
      activePointerId = null;
    },
    unlock() {
      locked = false;
    },
    isLocked() {
      return locked;
    },
  };
}
