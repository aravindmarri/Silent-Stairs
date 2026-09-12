// Drag-to-rotate: horizontal pointer movement spins `target.rotation.y`.
// The camera never moves — the world is a turntable.
export function attachDragRotate(domElement, target, { sensitivity = 0.008, onChange } = {}) {
  let dragging = false;
  let locked = false;
  let lastX = 0;

  const down = (x) => {
    if (locked) return;
    dragging = true;
    lastX = x;
  };
  const move = (x) => {
    if (locked || !dragging) return;
    const dx = x - lastX;
    lastX = x;
    target.rotation.y += dx * sensitivity;
    onChange?.(target.rotation.y);
  };
  const up = () => {
    dragging = false;
  };

  domElement.addEventListener('pointerdown', (e) => down(e.clientX));
  window.addEventListener('pointermove', (e) => move(e.clientX));
  window.addEventListener('pointerup', up);

  domElement.addEventListener(
    'touchstart',
    (e) => down(e.touches[0].clientX),
    { passive: true }
  );
  window.addEventListener(
    'touchmove',
    (e) => move(e.touches[0].clientX),
    { passive: true }
  );
  window.addEventListener('touchend', up);

  return {
    lock() {
      locked = true;
      dragging = false;
    },
    unlock() {
      locked = false;
    },
  };
}
