// Runs before styles load: only the non-sensitive appearance preference persists.
(() => {
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const allowed = new Set(['system', 'light', 'dark']);
  let preference = 'system';
  try {
    const saved = document.cookie.split('; ').find(item => item.startsWith('memory_panel_theme='))?.split('=')[1];
    if (allowed.has(saved)) preference = saved;
  } catch { /* Appearance remains usable when browser storage is unavailable. */ }
  function apply(value, persist = false) {
    if (!allowed.has(value)) return;
    preference = value;
    root.dataset.theme = value === 'system' ? (system.matches ? 'dark' : 'light') : value;
    root.dataset.themePreference = value;
    if (persist) try {
      // Host-scoped so a new loopback port does not reset the selected theme.
      document.cookie = `memory_panel_theme=${value}; Path=/; Max-Age=31536000; SameSite=Strict`;
    } catch { /* No persistence is required for switching the current page. */ }
  }
  apply(preference);
  document.addEventListener('DOMContentLoaded', () => {
    const control = document.getElementById('theme');
    if (!control) return;
    control.value = preference;
    control.addEventListener('change', () => apply(control.value, true));
  });
  system.addEventListener('change', () => { if (preference === 'system') apply('system'); });
})();
