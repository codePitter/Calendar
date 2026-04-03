/**
 * storage.js — localStorage + sincronización con Supabase.
 *
 * ESTRATEGIA:
 *   • Lecturas: siempre desde localStorage (síncronas, instantáneas).
 *   • Escrituras: localStorage primero + Supabase en paralelo (no bloquea la UI).
 *   • Al login: carga desde Supabase → sobreescribe localStorage → re-renderiza.
 *
 * Namespace global: window.CalApp.Storage
 */
window.CalApp = window.CalApp || {};

window.CalApp.Storage = (function () {
  const { STORAGE_KEY_EVENTS, STORAGE_KEY_SETTINGS, STORAGE_KEY_RECURRING } =
    window.CalApp.CONFIG;

  /* ══════════════════════════════════════════════════════════
     LOCAL STORAGE  (API sincrónica — sin cambios para el resto de la app)
  ══════════════════════════════════════════════════════════ */

  function loadEvents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_EVENTS);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.warn('[Storage] Error cargando eventos:', err);
      return {};
    }
  }

  function saveEvents(events) {
    try { localStorage.setItem(STORAGE_KEY_EVENTS, JSON.stringify(events)); }
    catch (err) { console.error('[Storage] Error guardando eventos:', err); }
    _sync.events(events); // fire-and-forget a Supabase
  }

  function loadRecurringEvents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_RECURRING);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.warn('[Storage] Error cargando recurrentes:', err);
      return [];
    }
  }

  function saveRecurringEvents(recurring) {
    try { localStorage.setItem(STORAGE_KEY_RECURRING, JSON.stringify(recurring)); }
    catch (err) { console.error('[Storage] Error guardando recurrentes:', err); }
    _sync.recurring(recurring);
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.warn('[Storage] Error cargando settings:', err);
      return {};
    }
  }

  function saveSettings(settings) {
    try { localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings)); }
    catch (err) { console.error('[Storage] Error guardando settings:', err); }
    _sync.settings(settings);
  }

  /* ══════════════════════════════════════════════════════════
     SUPABASE SYNC (async, no bloquea)
  ══════════════════════════════════════════════════════════ */

  const _sync = {
    _db()  { return window.CalApp._supabase; },
    _uid() { return window.CalApp.Auth?.getUser()?.id; },

    async events(eventsMap) {
      const db = this._db(), uid = this._uid();
      if (!db || !uid) return;
      try {
        // Aplanar { dateKey: [evt, …] } → filas de Supabase
        const rows = [];
        for (const [dateKey, evts] of Object.entries(eventsMap)) {
          for (const evt of evts) {
            rows.push({
              id:          evt.id,
              user_id:     uid,
              date_key:    dateKey,
              title:       evt.title,
              start_time:  evt.startTime,
              end_time:    evt.endTime,
              description: evt.desc     || '',
              color:       evt.color    || '#4f46e5',
              image_url:   evt.imageUrl || null,
              important:   !!evt.important,
            });
          }
        }
        // Reemplazar todos los eventos del usuario
        await db.from('events').delete().eq('user_id', uid);
        if (rows.length) await db.from('events').insert(rows);

        window.CalApp.Auth?.updateSyncStatus(true);
      } catch (err) {
        console.error('[Sync] events:', err);
        window.CalApp.Auth?.updateSyncStatus(false);
      }
    },

    async recurring(recurring) {
      const db = this._db(), uid = this._uid();
      if (!db || !uid) return;
      try {
        const rows = recurring.map(evt => ({
          id:             evt.id,
          user_id:        uid,
          title:          evt.title,
          start_time:     evt.startTime,
          end_time:       evt.endTime,
          description:    evt.desc          || '',
          color:          evt.color         || '#4f46e5',
          image_url:      evt.imageUrl      || null,
          important:      !!evt.important,
          recurrence:     evt.recurrence,
          original_date:  evt.originalDate,
          end_recurrence: evt.endRecurrence || null,
        }));
        await db.from('recurring_events').delete().eq('user_id', uid);
        if (rows.length) await db.from('recurring_events').insert(rows);

        window.CalApp.Auth?.updateSyncStatus(true);
      } catch (err) {
        console.error('[Sync] recurring:', err);
        window.CalApp.Auth?.updateSyncStatus(false);
      }
    },

    async settings(settings) {
      const db = this._db(), uid = this._uid();
      if (!db || !uid) return;
      try {
        await db.from('user_settings').upsert(
          { user_id: uid, end_hour: settings.endHour ?? 24, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
      } catch (err) {
        console.error('[Sync] settings:', err);
      }
    },
  };

  /* ══════════════════════════════════════════════════════════
     CARGA DESDE SUPABASE (llamado al hacer login)
  ══════════════════════════════════════════════════════════ */

  async function loadFromSupabase(userId) {
    const db = window.CalApp._supabase;
    if (!db || !userId) return;

    try {
      // Eventos regulares
      const { data: evData, error: evErr } = await db
        .from('events').select('*').eq('user_id', userId);
      if (evErr) throw evErr;

      const eventsMap = {};
      for (const row of evData || []) {
        if (!eventsMap[row.date_key]) eventsMap[row.date_key] = [];
        eventsMap[row.date_key].push({
          id:         row.id,
          title:      row.title,
          startTime:  row.start_time,
          endTime:    row.end_time,
          desc:       row.description,
          color:      row.color,
          imageUrl:   row.image_url,
          important:  row.important,
          recurrence: 'none',
          dateKey:    row.date_key,
        });
      }
      // Escribir en localStorage SIN disparar sync (ya venimos de la nube)
      try { localStorage.setItem(STORAGE_KEY_EVENTS, JSON.stringify(eventsMap)); } catch {}

      // Eventos recurrentes
      const { data: recData, error: recErr } = await db
        .from('recurring_events').select('*').eq('user_id', userId);
      if (recErr) throw recErr;

      const recurring = (recData || []).map(row => ({
        id:            row.id,
        title:         row.title,
        startTime:     row.start_time,
        endTime:       row.end_time,
        desc:          row.description,
        color:         row.color,
        imageUrl:      row.image_url,
        important:     row.important,
        recurrence:    row.recurrence,
        originalDate:  row.original_date,
        endRecurrence: row.end_recurrence,
      }));
      try { localStorage.setItem(STORAGE_KEY_RECURRING, JSON.stringify(recurring)); } catch {}

      // Preferencias
      const { data: settData } = await db
        .from('user_settings').select('*').eq('user_id', userId).maybeSingle();
      if (settData) {
        try { localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify({ endHour: settData.end_hour })); } catch {}
      }

    } catch (err) {
      console.error('[Storage] loadFromSupabase:', err);
    }
  }

  /* ══════════════════════════════════════════════════════════
     API PÚBLICA
  ══════════════════════════════════════════════════════════ */

  return {
    // Sync API (localStorage)
    loadEvents,
    saveEvents,
    loadSettings,
    saveSettings,
    loadRecurringEvents,
    saveRecurringEvents,
    // Cloud
    loadFromSupabase,
    // Expuesto para migración en auth.js
    syncNow: {
      events:   data => _sync.events(data),
      recurring: data => _sync.recurring(data),
      settings:  data => _sync.settings(data),
    },
  };
})();