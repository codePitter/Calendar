/**
 * app.js — Entry point. Conecta todos los módulos e inicializa la app.
 * Namespace global: window.CalApp
 */
(function () {
  'use strict';

  const { Calendar, Events, State, CONFIG } = window.CalApp;

  /* ── Función central de renderizado ──────────────────── */

  /**
   * Renderiza el calendario y sincroniza la variable CSS --slot-h.
   * Expuesto globalmente para que events.js pueda llamarlo después de save/delete.
   */
  function renderAndBind() {
    // Sincronizar token CSS con el valor de configuración (por si cambia vía DevTools, etc.)
    document.documentElement.style.setProperty('--slot-h', CONFIG.SLOT_HEIGHT + 'px');
    Calendar.render();
  }

  // Exponer a window.CalApp para uso cross-módulo
  window.CalApp.renderAndBind = renderAndBind;

  /* ── Navegación de semanas ────────────────────────────── */

  document.getElementById('btn-prev').addEventListener('click', () => {
    State.prevWeek();
    renderAndBind();
  });

  document.getElementById('btn-next').addEventListener('click', () => {
    State.nextWeek();
    renderAndBind();
  });

  document.getElementById('btn-today').addEventListener('click', () => {
    State.goToToday();
    renderAndBind();
  });

  /* ── Agregar horas ────────────────────────────────────── */

  document.getElementById('btn-add-hours').addEventListener('click', () => {
    State.addHours(CONFIG.HOURS_INCREMENT);
    renderAndBind();

    // Feedback visual breve en el botón
    const btn = document.getElementById('btn-add-hours');
    btn.textContent = `+${CONFIG.HOURS_INCREMENT}h agregada${CONFIG.HOURS_INCREMENT !== 1 ? 's' : ''}`;
    setTimeout(() => { btn.textContent = '+ Hora'; }, 1800);
  });

  /* ── Quitar horas ────────────────────────────────────── */

  document.getElementById('btn-remove-hours').addEventListener('click', () => {
    State.removeHours(CONFIG.HOURS_INCREMENT);
    renderAndBind();

    // Feedback visual breve en el botón
    const btn = document.getElementById('btn-remove-hours');
    btn.textContent = `-${CONFIG.HOURS_INCREMENT}h quitada${CONFIG.HOURS_INCREMENT !== 1 ? 's' : ''}`;
    setTimeout(() => { btn.textContent = '- Hora'; }, 1800);
  });
  
  /* ── Atajos de teclado globales ───────────────────────── */

  document.addEventListener('keydown', e => {
    // No interferir si el modal está abierto o el foco está en un input
    const inInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if (inInput) return;

    if (e.key === 'ArrowLeft'  || e.key === 'p') { State.prevWeek();   renderAndBind(); }
    if (e.key === 'ArrowRight' || e.key === 'n') { State.nextWeek();   renderAndBind(); }
    if (e.key === 't' || e.key === 'T')           { State.goToToday(); renderAndBind(); }
  });

  /* ── Guardar manualmente ──────────────────────────────── */

  document.getElementById('btn-save-manual').addEventListener('click', () => {
    const { Storage, State } = window.CalApp;

    // Forzar persistencia de todo el estado actual
    Storage.saveEvents(State.events);
    Storage.saveRecurringEvents(State.recurringEvents);
    Storage.saveMarkedDays(State.markedDays);
    Storage.saveSettings({ endHour: State.endHour });

    // Feedback visual en el botón
    const btn = document.getElementById('btn-save-manual');
    const prev = btn.textContent;
    btn.textContent = '✓';
    btn.classList.add('btn-save-manual--ok');
    setTimeout(() => {
      btn.textContent = prev;
      btn.classList.remove('btn-save-manual--ok');
    }, 1800);
  });

  // 1. Render inicial del calendario
  renderAndBind();

  // 2. Inicializar módulo de eventos (modal + delegación de clics)
  Events.init();

  // 3. Listener para marcar días (feriados / importantes)
  Calendar.initDayMarkerListener();

  console.info(
    '%cAgenda 2026%c lista. Atajos: ←/→ semana · T = hoy',
    'color:#4a7c6f;font-weight:600;font-size:13px',
    'color:#7a8c82;font-size:12px'
  );
})();