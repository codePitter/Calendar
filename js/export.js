/**
 * export.js — Exportar e importar datos del calendario.
 * Agrega opciones al menú de usuario existente.
 * Namespace global: window.CalApp.Export
 */
window.CalApp = window.CalApp || {};

window.CalApp.Export = (function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════
     EXPORTAR
  ══════════════════════════════════════════════════════════ */

  function exportData() {
    const { State } = window.CalApp;

    const payload = {
      version:   2,
      exportedAt: new Date().toISOString(),
      events:    State.events          || {},
      recurring: State.recurringEvents || [],
      settings:  { endHour: State.endHour },
    };

    const json     = JSON.stringify(payload, null, 2);
    const blob     = new Blob([json], { type: 'application/json' });
    const url      = URL.createObjectURL(blob);
    const dateStr  = new Date().toISOString().slice(0, 10);
    const filename = `agenda2026-backup-${dateStr}.json`;

    const a   = document.createElement('a');
    a.href    = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    _toast(`✅ Exportado: ${filename}`);
  }

  /* ══════════════════════════════════════════════════════════
     IMPORTAR
  ══════════════════════════════════════════════════════════ */

  function importData() {
    const input    = document.createElement('input');
    input.type     = 'file';
    input.accept   = '.json';

    input.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text    = await file.text();
        const payload = JSON.parse(text);

        // Validación básica
        if (!payload.recurring && !payload.events) {
          _toast('❌ Archivo inválido', true);
          return;
        }

        const confirmed = confirm(
          `¿Importar datos de ${file.name}?\n\n` +
          `• ${(payload.recurring || []).length} eventos recurrentes\n` +
          `• ${Object.values(payload.events || {}).flat().length} eventos regulares\n\n` +
          `Esto reemplazará los datos actuales.`
        );
        if (!confirmed) return;

        const { State, Storage } = window.CalApp;

        // Normalizar formato antiguo (array plano sin version)
        let recurring = payload.recurring || [];
        let events    = payload.events    || {};

        // Si es un array plano del backup antiguo
        if (Array.isArray(payload) && payload[0]?.recurrence) {
          recurring = payload;
          events    = {};
        }

        // Guardar localmente
        localStorage.setItem(window.CalApp.CONFIG.STORAGE_KEY_RECURRING, JSON.stringify(recurring));
        localStorage.setItem(window.CalApp.CONFIG.STORAGE_KEY_EVENTS,    JSON.stringify(events));
        if (payload.settings?.endHour) {
          localStorage.setItem(window.CalApp.CONFIG.STORAGE_KEY_SETTINGS,
            JSON.stringify({ endHour: payload.settings.endHour }));
        }

        // Actualizar state y renderizar
        State.events          = events;
        State.recurringEvents = recurring;
        if (payload.settings?.endHour) State.endHour = payload.settings.endHour;
        window.CalApp.renderAndBind?.();

        // Sincronizar con Supabase en background
        try {
          await Promise.all([
            Storage.syncNow.events(events),
            Storage.syncNow.recurring(recurring),
          ]);
        } catch (syncErr) {
          console.warn('[Export] Sync parcial:', syncErr);
        }

        _toast(`✅ Importados ${recurring.length} eventos recurrentes`);

      } catch (err) {
        console.error('[Export] Error importando:', err);
        _toast('❌ Error al leer el archivo', true);
      }
    });

    input.click();
  }

  /* ══════════════════════════════════════════════════════════
     TOAST
  ══════════════════════════════════════════════════════════ */

  function _toast(msg, isError = false) {
    let t = document.getElementById('export-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'export-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className   = 'export-toast' + (isError ? ' export-toast-err' : '');
    t.classList.add('export-toast-show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('export-toast-show'), 3000);
  }

  /* ══════════════════════════════════════════════════════════
     INYECTAR EN EL MENÚ DE USUARIO
  ══════════════════════════════════════════════════════════ */

  function _injectMenuItems() {
    // Esperar a que el menú de usuario exista (lo crea auth.js)
    const tryInject = () => {
      const menu = document.querySelector('.user-menu');
      if (!menu) { setTimeout(tryInject, 300); return; }
      if (menu.querySelector('.export-menu-item')) return; // ya inyectado

      const sep = document.createElement('hr');
      sep.className = 'user-menu-sep';

      const btnExport = document.createElement('button');
      btnExport.className = 'user-menu-item export-menu-item';
      btnExport.innerHTML = '📥 Exportar datos';
      btnExport.addEventListener('click', () => { exportData(); _closeMenu(); });

      const btnImport = document.createElement('button');
      btnImport.className = 'user-menu-item export-menu-item';
      btnImport.innerHTML = '📤 Importar datos';
      btnImport.addEventListener('click', () => { importData(); _closeMenu(); });

      // Insertar antes del separador de "Cerrar sesión"
      const lastSep = [...menu.querySelectorAll('.user-menu-sep')].pop();
      if (lastSep) {
        menu.insertBefore(btnImport, lastSep);
        menu.insertBefore(btnExport, btnImport);
        menu.insertBefore(sep, btnExport);
      } else {
        menu.appendChild(sep);
        menu.appendChild(btnExport);
        menu.appendChild(btnImport);
      }
    };

    // Re-inyectar cada vez que el menú se abre (se recrea dinámicamente)
    document.addEventListener('click', e => {
      if (e.target.closest('.user-badge-btn')) {
        setTimeout(tryInject, 50);
      }
    });

    tryInject();
  }

  function _closeMenu() {
    document.querySelector('.user-menu')?.remove();
    document.querySelector('.user-badge-btn')?.setAttribute('aria-expanded', 'false');
  }

  /* ══════════════════════════════════════════════════════════
     ESTILOS
  ══════════════════════════════════════════════════════════ */

  function _injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      .export-toast {
        position: fixed; bottom: 24px; left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: #1e293b; color: #f8fafc;
        padding: .65rem 1.2rem; border-radius: 10px;
        font-size: .84rem; font-weight: 500;
        box-shadow: 0 6px 24px rgba(0,0,0,.22);
        opacity: 0; transition: opacity .25s, transform .25s;
        pointer-events: none; white-space: nowrap; z-index: 99999;
      }
      .export-toast.export-toast-err { background: #dc2626; }
      .export-toast.export-toast-show {
        opacity: 1; transform: translateX(-50%) translateY(0);
      }
    `;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════ */

  function init() {
    _injectStyles();
    _injectMenuItems();
  }

  return { init, exportData, importData };
})();