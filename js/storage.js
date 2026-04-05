/**
 * storage.js — localStorage + sincronización con Supabase.
 *
 * ✨ FIX v2: Estrategia de MERGE al cargar desde Supabase.
 *   • Antes: Supabase SIEMPRE pisaba localStorage → se perdían cambios no sincronizados.
 *   • Ahora: se combinan local + nube (local gana en conflictos por ser más reciente).
 *     Si local tenía datos que no estaban en la nube, se re-sincronizan automáticamente.
 *
 * ESTRATEGIA:
 *   • Lecturas: siempre desde localStorage (síncronas, instantáneas).
 *   • Escrituras: localStorage primero + Supabase en paralelo (no bloquea la UI).
 *   • Al login: MERGE de Supabase + local → guarda merged → re-sube si había diferencias.
 *
 * Namespace global: window.CalApp.Storage
 */
window.CalApp = window.CalApp || {};

window.CalApp.Storage = (function () {
  const { STORAGE_KEY_EVENTS, STORAGE_KEY_SETTINGS, STORAGE_KEY_RECURRING } =
    window.CalApp.CONFIG;

  const STORAGE_KEY_MARKED_DAYS  = 'agenda2026_marked_days';
  const STORAGE_KEY_LAST_MODIFIED = 'agenda2026_last_modified'; // ✨ nuevo

  /* ══════════════════════════════════════════════════════════
     LOCAL STORAGE  (API sincrónica)
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
    _touchModified();        // ✨ marcar timestamp de modificación local
    _sync.events(events);    // fire-and-forget a Supabase
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
    _touchModified();          // ✨ marcar timestamp
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

  /** ✨ Guarda el timestamp de la última modificación local */
  function _touchModified() {
    try { localStorage.setItem(STORAGE_KEY_LAST_MODIFIED, Date.now().toString()); }
    catch (_) {}
  }

  /** ✨ Devuelve el timestamp de la última modificación local (ms), o 0 */
  function getLastModified() {
    const raw = localStorage.getItem(STORAGE_KEY_LAST_MODIFIED);
    return raw ? parseInt(raw, 10) : 0;
  }

  /* ══════════════════════════════════════════════════════════
     ✨ MERGE HELPERS
  ══════════════════════════════════════════════════════════ */

  /**
   * Combina dos mapas de eventos { dateKey: [evt, ...] }.
   * Local gana en conflictos de ID (es más reciente).
   * Retorna { merged, hadLocalOnly } donde hadLocalOnly = true si local
   * tenía eventos que la nube no tenía (datos no sincronizados).
   */
  function _mergeEvents(cloudMap, localMap) {
    // Construir índice de IDs en la nube
    const cloudIds = new Set();
    for (const evts of Object.values(cloudMap)) {
      for (const e of evts) cloudIds.add(e.id);
    }

    // Empezar con todos los eventos de la nube
    const merged = {};
    for (const [dk, evts] of Object.entries(cloudMap)) {
      merged[dk] = evts.map(e => ({ ...e }));
    }

    let hadLocalOnly = false;

    // Agregar/sobreescribir con los eventos locales
    for (const [dk, evts] of Object.entries(localMap)) {
      for (const localEvt of evts) {
        if (!cloudIds.has(localEvt.id)) {
          // Evento local que no estaba en la nube → lo agregamos
          hadLocalOnly = true;
          if (!merged[dk]) merged[dk] = [];
          merged[dk].push({ ...localEvt });
        } else {
          // El evento existe en ambos → local gana (reemplazar)
          if (!merged[dk]) merged[dk] = [];
          const idx = merged[dk].findIndex(e => e.id === localEvt.id);
          if (idx !== -1) merged[dk][idx] = { ...localEvt };
          else merged[dk].push({ ...localEvt });
        }
      }
    }

    // Limpiar entradas vacías
    for (const dk of Object.keys(merged)) {
      if (!merged[dk] || merged[dk].length === 0) delete merged[dk];
    }

    return { merged, hadLocalOnly };
  }

  /**
   * Combina dos arrays de eventos recurrentes.
   * Local gana en conflictos de ID.
   */
  function _mergeRecurring(cloudArr, localArr) {
    const byId = {};
    // Nube primero
    for (const e of cloudArr) byId[e.id] = { ...e };

    let hadLocalOnly = false;
    // Local sobreescribe (más reciente)
    for (const e of localArr) {
      if (!byId[e.id]) hadLocalOnly = true;
      byId[e.id] = { ...e };
    }

    return { merged: Object.values(byId), hadLocalOnly };
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
        const rows = [];
        for (const [dateKey, evts] of Object.entries(eventsMap)) {
          for (const evt of evts) {
            if (evt.recurrence && evt.recurrence !== 'none') {
              console.warn(`[Sync] ⚠️ Evento ${evt.id} tiene recurrencia en events regulares — omitido.`);
              continue;
            }
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
     DÍAS MARCADOS
  ══════════════════════════════════════════════════════════ */

  function loadMarkedDays() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_MARKED_DAYS);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.warn('[Storage] Error cargando días marcados:', err);
      return {};
    }
  }

  function saveMarkedDays(data) {
    try { localStorage.setItem(STORAGE_KEY_MARKED_DAYS, JSON.stringify(data)); }
    catch (err) { console.error('[Storage] Error guardando días marcados:', err); }
  }

  /* ══════════════════════════════════════════════════════════
     VALIDACIÓN / MIGRACIÓN (igual que antes)
  ══════════════════════════════════════════════════════════ */

  function _validateAndMigrateEvents(eventsMap, recurringArray) {
    const cleanedEvents = {};
    const migratedToRecurring = [];
    const existingRecurringIds = new Set(recurringArray.map(e => e.id));

    for (const [dateKey, dateEvents] of Object.entries(eventsMap)) {
      cleanedEvents[dateKey] = [];
      for (const evt of dateEvents) {
        if (evt.recurrence && evt.recurrence !== 'none' && !existingRecurringIds.has(evt.id)) {
          console.warn(`[Storage] ⚠️ Evento "${evt.title}" migrado automáticamente a recurringEvents.`);
          migratedToRecurring.push({
            id:            evt.id,
            title:         evt.title,
            startTime:     evt.startTime,
            endTime:       evt.endTime,
            desc:          evt.desc         || '',
            color:         evt.color        || '#4f46e5',
            imageUrl:      evt.imageUrl     || null,
            important:     evt.important    || false,
            recurrence:    evt.recurrence,
            originalDate:  evt.originalDate || dateKey,
            endRecurrence: evt.endRecurrence || null,
          });
          existingRecurringIds.add(evt.id);
        } else if (evt.recurrence === 'none' || !evt.recurrence) {
          cleanedEvents[dateKey].push(evt);
        }
      }
      if (cleanedEvents[dateKey].length === 0) delete cleanedEvents[dateKey];
    }

    return { cleanedEvents, migratedToRecurring, totalMigrated: migratedToRecurring.length };
  }

  /* ══════════════════════════════════════════════════════════
     ✨ CARGA DESDE SUPABASE — con MERGE (no sobreescribe)
  ══════════════════════════════════════════════════════════ */

  async function loadFromSupabase(userId) {
    const db = window.CalApp._supabase;
    if (!db || !userId) return;

    try {
      // ── 1. Guardar snapshot local ANTES de traer la nube ──────────────
      const localEvents    = loadEvents();
      const localRecurring = loadRecurringEvents();

      // ── 2. Traer datos de la nube ──────────────────────────────────────
      const { data: evData, error: evErr } = await db
        .from('events').select('*').eq('user_id', userId);
      if (evErr) throw evErr;

      const cloudEventsMap = {};
      for (const row of evData || []) {
        if (!cloudEventsMap[row.date_key]) cloudEventsMap[row.date_key] = [];
        cloudEventsMap[row.date_key].push({
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

      const { data: recData, error: recErr } = await db
        .from('recurring_events').select('*').eq('user_id', userId);
      if (recErr) throw recErr;

      const cloudRecurring = (recData || []).map(row => ({
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

      // ── 3. Validar/migrar eventos mal guardados ────────────────────────
      const { cleanedEvents: cleanedCloud, migratedToRecurring, totalMigrated } =
        _validateAndMigrateEvents(cloudEventsMap, cloudRecurring);

      let finalCloudRecurring = totalMigrated > 0
        ? [...cloudRecurring, ...migratedToRecurring]
        : cloudRecurring;

      // ── 4. ✨ MERGE: nube + local (local gana en conflictos) ───────────
      const { merged: mergedEvents, hadLocalOnly: evLocalOnly } =
        _mergeEvents(cleanedCloud, localEvents);

      const { merged: mergedRecurring, hadLocalOnly: recLocalOnly } =
        _mergeRecurring(finalCloudRecurring, localRecurring);

      const hadUnsyncedLocal = evLocalOnly || recLocalOnly || totalMigrated > 0;

      if (hadUnsyncedLocal) {
        console.log(
          `[Storage] 🔀 Merge: local tenía datos no sincronizados. ` +
          `${totalMigrated} migrados. Re-subiendo a Supabase…`
        );
      }

      // ── 5. Guardar resultado merged en localStorage ───────────────────
      try {
        localStorage.setItem(STORAGE_KEY_EVENTS,    JSON.stringify(mergedEvents));
        localStorage.setItem(STORAGE_KEY_RECURRING, JSON.stringify(mergedRecurring));
      } catch {}

      // ── 6. Si local tenía datos extra, re-sincronizar con la nube ─────
      if (hadUnsyncedLocal) {
        try {
          await _sync.events(mergedEvents);
          await _sync.recurring(mergedRecurring);
          console.log('[Storage] ✅ Re-sincronización exitosa tras merge.');
        } catch (syncErr) {
          console.error('[Storage] Error re-sincronizando:', syncErr);
        }
      }

      // ── 7. Settings ────────────────────────────────────────────────────
      const { data: settData } = await db
        .from('user_settings').select('*').eq('user_id', userId).maybeSingle();
      if (settData) {
        try {
          localStorage.setItem(STORAGE_KEY_SETTINGS,
            JSON.stringify({ endHour: settData.end_hour }));
        } catch {}
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
    loadMarkedDays,
    saveMarkedDays,
    getLastModified,   // ✨ nuevo
    // Cloud
    loadFromSupabase,
    // Expuesto para migración en auth.js / export.js
    syncNow: {
      events:    data => _sync.events(data),
      recurring: data => _sync.recurring(data),
      settings:  data => _sync.settings(data),
    },
  };
})();