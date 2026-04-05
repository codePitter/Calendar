/**
 * storage.js — localStorage + sincronización con Supabase.
 *
 * ✨ FIX v3:
 *   1. MERGE al cargar desde Supabase (local gana en conflictos).
 *   2. Indicador visual de sync pendiente (dot amarillo pulsante).
 *   3. Advertencia beforeunload si hay cambios sin guardar en la nube.
 *
 * Namespace global: window.CalApp.Storage
 */
window.CalApp = window.CalApp || {};

window.CalApp.Storage = (function () {
  const { STORAGE_KEY_EVENTS, STORAGE_KEY_SETTINGS, STORAGE_KEY_RECURRING } =
    window.CalApp.CONFIG;

  const STORAGE_KEY_MARKED_DAYS   = 'agenda2026_marked_days';
  const STORAGE_KEY_LAST_MODIFIED = 'agenda2026_last_modified';

  /* ══════════════════════════════════════════════════════════
     ✨ PENDING SYNC TRACKING
  ══════════════════════════════════════════════════════════ */

  let _pendingSyncs = 0;

  function _syncStart() {
    _pendingSyncs++;
    _updateSyncDot('pending');
  }

  function _syncEnd(ok) {
    _pendingSyncs = Math.max(0, _pendingSyncs - 1);
    if (_pendingSyncs === 0) {
      _updateSyncDot(ok ? 'ok' : 'err');
    }
  }

  function _updateSyncDot(state) {
    if (state === 'ok' || state === 'err') {
      window.CalApp.Auth?.updateSyncStatus(state === 'ok');
    }
    const dot = document.querySelector('.sync-dot');
    if (!dot) return;
    dot.classList.remove('sync-ok', 'sync-err', 'sync-pending');
    if      (state === 'ok')      dot.classList.add('sync-ok');
    else if (state === 'err')     dot.classList.add('sync-err');
    else if (state === 'pending') dot.classList.add('sync-pending');
  }

  // Estilo para dot amarillo pulsante
  (function _injectPendingStyle() {
    if (document.getElementById('sync-pending-style')) return;
    const s = document.createElement('style');
    s.id = 'sync-pending-style';
    s.textContent = `
      .sync-dot.sync-pending {
        background: #fbbf24 !important;
        box-shadow: 0 0 5px #fbbf2488 !important;
        animation: sync-pulse 1s ease-in-out infinite;
      }
      @keyframes sync-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%       { opacity: .5; transform: scale(.8); }
      }
    `;
    document.head.appendChild(s);
  })();

  // Advertir si hay syncs pendientes al cerrar la pestaña
  window.addEventListener('beforeunload', e => {
    if (_pendingSyncs > 0) {
      e.preventDefault();
      e.returnValue = 'Hay cambios sincronizando con la nube. ¿Salir de todas formas?';
    }
  });

  /* ══════════════════════════════════════════════════════════
     LOCAL STORAGE
  ══════════════════════════════════════════════════════════ */

  function loadEvents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_EVENTS);
      return raw ? JSON.parse(raw) : {};
    } catch (err) { console.warn('[Storage] Error cargando eventos:', err); return {}; }
  }

  function saveEvents(events) {
    try { localStorage.setItem(STORAGE_KEY_EVENTS, JSON.stringify(events)); }
    catch (err) { console.error('[Storage] Error guardando eventos:', err); }
    _touchModified();
    _sync.events(events);
  }

  function loadRecurringEvents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_RECURRING);
      return raw ? JSON.parse(raw) : [];
    } catch (err) { console.warn('[Storage] Error cargando recurrentes:', err); return []; }
  }

  function saveRecurringEvents(recurring) {
    try { localStorage.setItem(STORAGE_KEY_RECURRING, JSON.stringify(recurring)); }
    catch (err) { console.error('[Storage] Error guardando recurrentes:', err); }
    _touchModified();
    _sync.recurring(recurring);
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
      return raw ? JSON.parse(raw) : {};
    } catch (err) { console.warn('[Storage] Error cargando settings:', err); return {}; }
  }

  function saveSettings(settings) {
    try { localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings)); }
    catch (err) { console.error('[Storage] Error guardando settings:', err); }
    _sync.settings(settings);
  }

  function _touchModified() {
    try { localStorage.setItem(STORAGE_KEY_LAST_MODIFIED, Date.now().toString()); } catch (_) {}
  }

  function getLastModified() {
    const raw = localStorage.getItem(STORAGE_KEY_LAST_MODIFIED);
    return raw ? parseInt(raw, 10) : 0;
  }

  /* ══════════════════════════════════════════════════════════
     ✨ MERGE HELPERS
  ══════════════════════════════════════════════════════════ */

  function _mergeEvents(cloudMap, localMap) {
    const cloudIds = new Set();
    for (const evts of Object.values(cloudMap)) {
      for (const e of evts) cloudIds.add(e.id);
    }

    const merged = {};
    for (const [dk, evts] of Object.entries(cloudMap)) {
      merged[dk] = evts.map(e => ({ ...e }));
    }

    let hadLocalOnly = false;
    for (const [dk, evts] of Object.entries(localMap)) {
      for (const localEvt of evts) {
        if (!cloudIds.has(localEvt.id)) {
          hadLocalOnly = true;
          if (!merged[dk]) merged[dk] = [];
          merged[dk].push({ ...localEvt });
        } else {
          if (!merged[dk]) merged[dk] = [];
          const idx = merged[dk].findIndex(e => e.id === localEvt.id);
          if (idx !== -1) merged[dk][idx] = { ...localEvt };
          else merged[dk].push({ ...localEvt });
        }
      }
    }

    for (const dk of Object.keys(merged)) {
      if (!merged[dk] || merged[dk].length === 0) delete merged[dk];
    }

    return { merged, hadLocalOnly };
  }

  function _mergeRecurring(cloudArr, localArr) {
    const byId = {};
    for (const e of cloudArr) byId[e.id] = { ...e };
    let hadLocalOnly = false;
    for (const e of localArr) {
      if (!byId[e.id]) hadLocalOnly = true;
      byId[e.id] = { ...e };
    }
    return { merged: Object.values(byId), hadLocalOnly };
  }

  /* ══════════════════════════════════════════════════════════
     SUPABASE SYNC — con tracking de pendientes
  ══════════════════════════════════════════════════════════ */

  const _sync = {
    _db()  { return window.CalApp._supabase; },
    _uid() { return window.CalApp.Auth?.getUser()?.id; },

    async events(eventsMap) {
      const db = this._db(), uid = this._uid();
      if (!db || !uid) return;
      _syncStart();
      try {
        const rows = [];
        for (const [dateKey, evts] of Object.entries(eventsMap)) {
          for (const evt of evts) {
            if (evt.recurrence && evt.recurrence !== 'none') {
              console.warn(`[Sync] ⚠️ Evento ${evt.id} tiene recurrencia — omitido de events.`);
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
        _syncEnd(true);
      } catch (err) {
        console.error('[Sync] events:', err);
        _syncEnd(false);
      }
    },

    async recurring(recurring) {
      const db = this._db(), uid = this._uid();
      if (!db || !uid) return;
      _syncStart();
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
        _syncEnd(true);
      } catch (err) {
        console.error('[Sync] recurring:', err);
        _syncEnd(false);
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
    } catch (err) { console.warn('[Storage] Error cargando días marcados:', err); return {}; }
  }

  function saveMarkedDays(data) {
    try { localStorage.setItem(STORAGE_KEY_MARKED_DAYS, JSON.stringify(data)); }
    catch (err) { console.error('[Storage] Error guardando días marcados:', err); }
  }

  /* ══════════════════════════════════════════════════════════
     VALIDACIÓN / MIGRACIÓN
  ══════════════════════════════════════════════════════════ */

  function _validateAndMigrateEvents(eventsMap, recurringArray) {
    const cleanedEvents = {};
    const migratedToRecurring = [];
    const existingRecurringIds = new Set(recurringArray.map(e => e.id));

    for (const [dateKey, dateEvents] of Object.entries(eventsMap)) {
      cleanedEvents[dateKey] = [];
      for (const evt of dateEvents) {
        if (evt.recurrence && evt.recurrence !== 'none' && !existingRecurringIds.has(evt.id)) {
          console.warn(`[Storage] ⚠️ "${evt.title}" migrado a recurringEvents.`);
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
     ✨ CARGA DESDE SUPABASE — con MERGE
  ══════════════════════════════════════════════════════════ */

  async function loadFromSupabase(userId) {
    const db = window.CalApp._supabase;
    if (!db || !userId) return;

    try {
      // 1. Snapshot local ANTES de traer la nube
      const localEvents    = loadEvents();
      const localRecurring = loadRecurringEvents();

      // 2. Eventos regulares de la nube
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

      // 3. Recurrentes de la nube
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

      // 4. Validar/migrar mal guardados
      const { cleanedEvents: cleanedCloud, migratedToRecurring, totalMigrated } =
        _validateAndMigrateEvents(cloudEventsMap, cloudRecurring);
      const finalCloudRecurring = totalMigrated > 0
        ? [...cloudRecurring, ...migratedToRecurring]
        : cloudRecurring;

      // 5. ✨ MERGE: nube + local (local gana)
      const { merged: mergedEvents,    hadLocalOnly: evLocalOnly  } =
        _mergeEvents(cleanedCloud, localEvents);
      const { merged: mergedRecurring, hadLocalOnly: recLocalOnly } =
        _mergeRecurring(finalCloudRecurring, localRecurring);

      const hadUnsyncedLocal = evLocalOnly || recLocalOnly || totalMigrated > 0;

      if (hadUnsyncedLocal) {
        const evM = Object.values(mergedEvents).flat().length;
        const reM = mergedRecurring.length;
        console.log(`[Storage] 🔀 Merge: local tenía datos no sincronizados → merged: ${evM} eventos, ${reM} recurrentes.`);
      }

      // 6. Guardar merged en localStorage
      try {
        localStorage.setItem(STORAGE_KEY_EVENTS,    JSON.stringify(mergedEvents));
        localStorage.setItem(STORAGE_KEY_RECURRING, JSON.stringify(mergedRecurring));
      } catch {}

      // 7. Re-sincronizar a la nube si local tenía datos extra
      if (hadUnsyncedLocal) {
        try {
          await _sync.events(mergedEvents);
          await _sync.recurring(mergedRecurring);
          console.log('[Storage] ✅ Re-sincronización exitosa tras merge.');
        } catch (syncErr) {
          console.error('[Storage] Error re-sincronizando:', syncErr);
        }
      }

      // 8. Settings
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
    loadEvents,
    saveEvents,
    loadSettings,
    saveSettings,
    loadRecurringEvents,
    saveRecurringEvents,
    loadMarkedDays,
    saveMarkedDays,
    getLastModified,
    loadFromSupabase,
    syncNow: {
      events:    data => _sync.events(data),
      recurring: data => _sync.recurring(data),
      settings:  data => _sync.settings(data),
    },
  };
})();