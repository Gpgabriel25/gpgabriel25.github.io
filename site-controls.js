/* site-controls.js — dark mode + effects toggles
 * Injects pill buttons into the page footer.
 * Persists preferences to localStorage.
 * Anti-FOUC: also handled by the inline <head> snippet on each page.
 */
(() => {
  /* === Apply saved preferences immediately (belt-and-suspenders) === */
  try {
    const t = localStorage.getItem('theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
    const savedEffects = localStorage.getItem('effects');
    if (savedEffects === 'off') {
      document.documentElement.classList.add('effects-off');
    } else if (!savedEffects && window.matchMedia &&
               window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Auto-disable animations for OS-level reduced-motion preference
      // (does not write to localStorage, so OS setting stays in control)
      document.documentElement.classList.add('effects-off');
    }
  } catch (_) {}

  /* === Build + inject controls into footer === */
  function inject() {
    const footer = document.querySelector('footer');
    if (!footer) return;

    const wrap = document.createElement('div');
    wrap.className = 'site-controls';

    const themeBtn   = makeBtn('theme-toggle',   'Toggle colour mode');
    const effectsBtn = makeBtn('effects-toggle', 'Toggle background animation');
    wrap.appendChild(themeBtn);
    wrap.appendChild(effectsBtn);
    footer.appendChild(wrap);

    /* Render initial state */
    const isDark     = document.documentElement.getAttribute('data-theme') === 'dark';
    const effectsOff = document.documentElement.classList.contains('effects-off');
    paintTheme(themeBtn, isDark);
    paintEffects(effectsBtn, effectsOff);

    /* Theme toggle */
    themeBtn.addEventListener('click', () => {
      const goDark = document.documentElement.getAttribute('data-theme') !== 'dark';
      document.documentElement.setAttribute('data-theme', goDark ? 'dark' : 'light');
      try { localStorage.setItem('theme', goDark ? 'dark' : 'light'); } catch (_) {}
      paintTheme(themeBtn, goDark);
    });

    /* Effects toggle */
    effectsBtn.addEventListener('click', () => {
      const turnOff = !document.documentElement.classList.contains('effects-off');
      document.documentElement.classList.toggle('effects-off', turnOff);
      try { localStorage.setItem('effects', turnOff ? 'off' : 'on'); } catch (_) {}
      paintEffects(effectsBtn, turnOff);
    });
  }

  function makeBtn(id, label) {
    const btn = document.createElement('button');
    btn.className = 'site-toggle';
    btn.id = id;
    btn.setAttribute('aria-label', label);
    return btn;
  }

  /* Icon + label helpers */
  function paintTheme(btn, isDark) {
    /* ◑ = half-black circle (suggests duality / switching) */
    btn.innerHTML = isDark
      ? '<span class="toggle-icon" aria-hidden="true">\u25d1</span>\u202fLight'
      : '<span class="toggle-icon" aria-hidden="true">\u25d1</span>\u202fDark';
  }

  function paintEffects(btn, isOff) {
    /* ◉ = fisheye (on) · ○ = open circle (off) */
    btn.innerHTML = isOff
      ? '<span class="toggle-icon" aria-hidden="true">\u25cb</span>\u202fEffects off'
      : '<span class="toggle-icon" aria-hidden="true">\u25c9</span>\u202fEffects on';
  }

  /* Defer until DOM is ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
