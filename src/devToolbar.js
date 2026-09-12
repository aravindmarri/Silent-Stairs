// A compact panel for jumping directly to any registered level during
// development, without having to solve your way there. Shown only in
// the Vite dev server or when the URL carries `?dev=1`.
export function createDevToolbar({ container, levels, currentLevelId, onLoad, onRestart }) {
  const el = document.createElement('div');
  el.id = 'devToolbar';
  el.innerHTML = `
    <select id="devLevelSelect" aria-label="Level"></select>
    <button id="devLoadBtn" type="button">Load level</button>
    <button id="devRestartBtn" type="button">Restart level</button>
  `;
  container.appendChild(el);

  const select = el.querySelector('#devLevelSelect');
  for (const level of levels) {
    const option = document.createElement('option');
    option.value = String(level.id);
    option.textContent = `${level.id}. ${level.name}`;
    select.appendChild(option);
  }
  select.value = String(currentLevelId);

  el.querySelector('#devLoadBtn').addEventListener('click', () => {
    onLoad(parseInt(select.value, 10));
  });
  el.querySelector('#devRestartBtn').addEventListener('click', onRestart);

  return {
    setCurrentLevel(id) {
      select.value = String(id);
    },
  };
}
