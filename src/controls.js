// Drag-to-rotate: horizontal pointer movement spins `target.rotation.y`.
// The camera never moves — the world is a turntable. Built entirely on
// Pointer Events (unified mouse/touch/pen), with pointer capture so the
// drag keeps tracking even if the pointer leaves the canvas, and
// `pointercancel` handled the same as a release so a cancelled gesture
// (e.g. the browser taking over for a system gesture) can't leave
// `dragging` stuck true.
export function attachDragRotate(domElement, target, { sensitivity = 0.008, onChange, onRelease } = {}) {
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
    target.rotation.y += dx * sensitivity;
    onChange?.(target.rotation.y);
  };

  const end = (e) => {
    if (e.pointerId !== activePointerId) return;
    const wasDragging = dragging;
    dragging = false;
    activePointerId = null;
    if (wasDragging && !locked) onRelease?.(target.rotation.y);
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
