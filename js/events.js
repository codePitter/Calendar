/**
 * events.js — Modal de eventos y operaciones CRUD.
 * Incluye buscador de imágenes estilo Giphy (vía Unsplash, sin API key).
 */
window.CalApp = window.CalApp || {};

window.CalApp.Events = (function () {
  const { CONFIG, State } = window.CalApp;

  let _currentEvent  = null;
  let _pendingDate   = null;
  let _pendingHour   = null;
  let _selectedColor = CONFIG.COLORS[0];
  let _isImportant   = false;
  let _selectedImageUrl = null;     // ← imagen seleccionada

  let $backdrop, $title, $inputTitle, $inputStart, $inputEnd,
      $inputDesc, $palette, $btnDelete, $btnSave, $recurrence,
      $endRecurrence, $btnImportant;

  // Referencia a los paneles de fondo
  let $bgPanelColor, $bgPanelImagen;

  function padTime(h, m = 0) {
    const hh = h % 24;
    return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function generateId() {
    return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /* ── Color palette ──────────────────────────────────────── */

  function buildColorPalette() {
    $palette.innerHTML = CONFIG.COLORS.map((c, i) =>
      `<button type="button"
               class="color-dot${i === 0 ? ' active' : ''}"
               data-color="${c}"
               style="background:${c}"
               aria-label="Color ${i + 1}"></button>`
    ).join('');

    $palette.addEventListener('click', e => {
      const dot = e.target.closest('.color-dot');
      if (!dot) return;
      $palette.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      _selectedColor = dot.dataset.color;
    });
  }

  function setActiveDot(color) {
    if (!$palette) return;
    $palette.querySelectorAll('.color-dot').forEach(d => {
      d.classList.toggle('active', d.dataset.color === color);
    });
  }

  /* ── Toggle importante ──────────────────────────────────── */

  function setImportant(value) {
    _isImportant = !!value;
    if (!$btnImportant) return;
    const star  = $btnImportant.querySelector('.toggle-star');
    const label = $btnImportant.querySelector('.toggle-label');
    if (_isImportant) {
      $btnImportant.classList.add('is-active');
      if (star)  star.textContent  = '★';
      if (label) label.textContent = 'Importante';
    } else {
      $btnImportant.classList.remove('is-active');
      if (star)  star.textContent  = '☆';
      if (label) label.textContent = 'Marcar como importante';
    }
    $btnImportant.setAttribute('aria-pressed', String(_isImportant));
  }

  /* ── Recurrencia ────────────────────────────────────────── */

  function toggleEndRecurrenceField() {
    const recurrenceValue = $recurrence.value;
    const $endRecurrenceGroup = document.getElementById('end-recurrence-group');
    if ($endRecurrenceGroup) {
      $endRecurrenceGroup.style.display = recurrenceValue !== 'none' ? 'flex' : 'none';
    }
  }

  /* ── Image picker ───────────────────────────────────────── */

  const IMG_CATEGORIES = [
    { label: '🌿 Naturaleza', q: 'nature,green' },
    { label: '🏙️ Ciudad',     q: 'city,urban' },
    { label: '🌌 Espacio',    q: 'space,galaxy' },
    { label: '🌊 Océano',     q: 'ocean,sea' },
    { label: '⛰️ Montañas',  q: 'mountains,landscape' },
    { label: '🎨 Arte',       q: 'abstract,art' },
    { label: '🌸 Flores',     q: 'flowers,bloom' },
    { label: '✨ Mínimal',    q: 'minimal,texture' },
  ];

  let _currentQuery = '';
  let _imgSeed      = Date.now();

  function buildImagePicker(container) {
    container.innerHTML = `
      <div class="img-search-row">
        <input type="text" id="img-search-input"
               placeholder="Buscar: montañas, ciudad, flores…"
               autocomplete="off">
        <button type="button" class="img-search-btn" id="img-search-btn">🔍</button>
      </div>
      <div class="img-category-pills" id="img-category-pills">
        ${IMG_CATEGORIES.map(c =>
          `<button type="button" class="img-pill" data-q="${c.q}">${c.label}</button>`
        ).join('')}
      </div>
      <div class="img-grid-wrap">
        <div class="img-grid" id="img-grid">
          <div class="img-hint">✨ Elige una categoría o escribe tu búsqueda</div>
        </div>
      </div>
      <div class="img-selected-bar" id="img-selected-bar" style="display:none">
        <span>🖼️ Imagen seleccionada como fondo</span>
        <button type="button" class="img-clear-btn" id="img-clear-btn">✕ Quitar</button>
      </div>
    `;

    // Category pills
    container.querySelectorAll('.img-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        container.querySelectorAll('.img-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        _currentQuery = pill.dataset.q;
        _imgSeed = Date.now();
        loadImages(_currentQuery);
      });
    });

    // Search
    const searchInput = document.getElementById('img-search-input');
    const searchBtn   = document.getElementById('img-search-btn');

    function doSearch() {
      const q = searchInput.value.trim();
      if (!q) return;
      _currentQuery = q;
      _imgSeed = Date.now();
      container.querySelectorAll('.img-pill').forEach(p => p.classList.remove('active'));
      loadImages(q);
    }

    searchBtn.addEventListener('click', doSearch);
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
    });

    // Clear button
    document.getElementById('img-clear-btn').addEventListener('click', clearImage);
  }

  function loadImages(query) {
    const grid = document.getElementById('img-grid');
    if (!grid) return;

    grid.innerHTML = `
      <div class="img-loading">
        <div class="img-spinner"></div>
        <span>Buscando imágenes…</span>
      </div>`;

    // Generamos 8 URLs únicas usando loremflickr (soporte de keywords, gratuito)
    const thumbs = Array.from({ length: 8 }, (_, i) => {
      const sig = _imgSeed + i;
      const safeQuery = query.trim().replace(/\s+/g, ',');
      const url = `https://loremflickr.com/280/180/${safeQuery}?lock=${sig}`;
      return { url, sig };
    });

    grid.innerHTML = thumbs.map(({ url, sig }) => `
      <button type="button"
              class="img-thumb${_selectedImageUrl === url ? ' selected' : ''}"
              data-url="${url}"
              title="Seleccionar imagen">
        <img src="${url}"
             alt="Imagen"
             loading="lazy"
             onerror="this.closest('.img-thumb').style.display='none'">
        <div class="img-thumb-check">✓</div>
      </button>
    `).join('');

    grid.querySelectorAll('.img-thumb').forEach(thumb => {
      thumb.addEventListener('click', () => selectImage(thumb.dataset.url));
    });
  }

  function selectImage(url) {
    _selectedImageUrl = url;

    // Actualizar UI de thumbnails
    const grid = document.getElementById('img-grid');
    if (grid) {
      grid.querySelectorAll('.img-thumb').forEach(t =>
        t.classList.toggle('selected', t.dataset.url === url)
      );
    }

    // Mostrar barra de "imagen seleccionada"
    const bar = document.getElementById('img-selected-bar');
    if (bar) bar.style.display = 'flex';
  }

  function clearImage() {
    _selectedImageUrl = null;

    const grid = document.getElementById('img-grid');
    if (grid) grid.querySelectorAll('.img-thumb').forEach(t => t.classList.remove('selected'));

    const bar = document.getElementById('img-selected-bar');
    if (bar) bar.style.display = 'none';
  }

  /* ── Switcher de tabs Fondo ─────────────────────────────── */

  function switchBgTab(tabName) {
    const tabs = document.querySelectorAll('.bg-tab');
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    if ($bgPanelColor)  $bgPanelColor.classList.toggle('hidden', tabName !== 'color');
    if ($bgPanelImagen) $bgPanelImagen.classList.toggle('hidden', tabName !== 'imagen');
  }

  /* ── Modal open/close ───────────────────────────────────── */

  function openModal(dateStr, hour, event = null) {
    _currentEvent  = event;
    _pendingDate   = dateStr;
    _pendingHour   = hour;

    if (event) {
      $title.textContent = event.recurrence && event.recurrence !== 'none'
        ? 'Editar Evento Recurrente'
        : 'Editar Evento';
      $inputTitle.value     = event.title || '';
      $inputStart.value     = event.startTime || padTime(hour ?? CONFIG.START_HOUR);
      $inputEnd.value       = event.endTime   || padTime((hour ?? CONFIG.START_HOUR) + 1);
      $inputDesc.value      = event.desc || '';
      _selectedColor        = event.color || CONFIG.COLORS[0];
      _selectedImageUrl     = event.imageUrl || null;
      $recurrence.value     = event.recurrence || 'none';
      if ($endRecurrence) $endRecurrence.value = event.endRecurrence || '';
      $btnDelete.hidden = false;
      setImportant(event.important);
    } else {
      $title.textContent = 'Nuevo Evento';
      const safeHour = Math.min(hour ?? CONFIG.START_HOUR, State.endHour - 1);
      $inputTitle.value     = '';
      $inputStart.value     = padTime(safeHour);
      $inputEnd.value       = padTime(Math.min(safeHour + 1, State.endHour));
      $inputDesc.value      = '';
      _selectedColor        = CONFIG.COLORS[0];
      _selectedImageUrl     = null;
      $recurrence.value     = 'none';
      if ($endRecurrence) $endRecurrence.value = '';
      $btnDelete.hidden = true;
      setImportant(false);
    }

    setActiveDot(_selectedColor);
    toggleEndRecurrenceField();

    // Resetear imagen picker
    clearImage();
    const imgGrid = document.getElementById('img-grid');
    if (imgGrid) {
      imgGrid.innerHTML = `<div class="img-hint">✨ Elige una categoría o escribe tu búsqueda</div>`;
    }
    document.querySelectorAll('.img-pill').forEach(p => p.classList.remove('active'));
    const searchInput = document.getElementById('img-search-input');
    if (searchInput) searchInput.value = '';

    // Si el evento ya tenía imagen, mostrar barra + cambiar a tab imagen
    if (_selectedImageUrl) {
      const bar = document.getElementById('img-selected-bar');
      if (bar) bar.style.display = 'flex';
      switchBgTab('imagen');
    } else {
      switchBgTab('color');
    }

    $backdrop.hidden = false;
    $backdrop.removeAttribute('aria-hidden');
    $inputTitle.focus();
    $inputTitle.classList.remove('error');
  }

  function closeModal() {
    $backdrop.hidden = true;
    $backdrop.setAttribute('aria-hidden', 'true');
    _currentEvent = null;
  }

  /* ── Save ───────────────────────────────────────────────── */

  function saveEvent() {
    const title = $inputTitle.value.trim();
    if (!title) {
      $inputTitle.classList.add('error');
      $inputTitle.focus();
      $inputTitle.addEventListener('input', () => $inputTitle.classList.remove('error'), { once: true });
      return;
    }

    const recurrence = $recurrence.value;
    const event = {
      id:        _currentEvent ? _currentEvent.id : generateId(),
      dateKey:   _currentEvent ? _currentEvent.dateKey : _pendingDate,
      title,
      startTime: $inputStart.value,
      endTime:   $inputEnd.value,
      desc:      $inputDesc.value.trim(),
      color:     _selectedColor,
      important: _isImportant,
      imageUrl:  _selectedImageUrl || null,
    };

    if (recurrence !== 'none') {
      event.recurrence   = recurrence;
      event.originalDate = _currentEvent
        ? (_currentEvent.originalDate || _currentEvent.dateKey)
        : _pendingDate;
      if ($endRecurrence && $endRecurrence.value) {
        event.endRecurrence = $endRecurrence.value;
      }
    }

    if (_currentEvent) {
      State.updateEvent(event);
    } else {
      State.addEvent(event);
    }

    closeModal();
    window.CalApp.renderAndBind();
  }

  /* ── Delete ─────────────────────────────────────────────── */

  function deleteEvent() {
    if (!_currentEvent) return;
    const confirmMsg = _currentEvent.recurrence && _currentEvent.recurrence !== 'none'
      ? `¿Eliminar el evento recurrente "${_currentEvent.title}" y todas sus ocurrencias?`
      : `¿Eliminar el evento "${_currentEvent.title}"?`;

    if (!confirm(confirmMsg)) return;
    State.deleteEvent(_currentEvent.dateKey, _currentEvent.id);
    closeModal();
    window.CalApp.renderAndBind();
  }

  /* ── Click en calendario ────────────────────────────────── */

  function handleBodyClick(e) {
    const evtEl = e.target.closest('.cal-event');
    if (evtEl) {
      const dateKey = evtEl.dataset.dateKey;
      const eventId = evtEl.dataset.eventId;

      let found = (State.events[dateKey] || []).find(ev => ev.id === eventId);

      if (!found) {
        const weekDays  = State.getWeekDays();
        const weekStart = weekDays[0];
        const weekEnd   = weekDays[6];
        const expanded  = expandRecurringEventsForRange(weekStart, weekEnd, State.recurringEvents);
        found = expanded.find(ev => ev.id === eventId && ev.dateKey === dateKey);
        if (found && found.originalEventId) {
          found = State.recurringEvents.find(ev => ev.id === found.originalEventId);
        }
      }

      if (found) openModal(dateKey, null, found);
      return;
    }

    const col = e.target.closest('.cal-day-col');
    if (!col) return;

    const dateKey = col.dataset.date;
    const rect    = col.getBoundingClientRect();
    const relY    = e.clientY - rect.top;
    const hour    = window.CalApp.Calendar.yToHour(relY, dateKey);

    openModal(dateKey, hour);
  }

  /* ── Init ───────────────────────────────────────────────── */

  function init() {
    $backdrop   = document.getElementById('modal-backdrop');
    $title      = document.getElementById('modal-heading');
    $inputTitle = document.getElementById('evt-title');
    $inputStart = document.getElementById('evt-start');
    $inputEnd   = document.getElementById('evt-end');
    $inputDesc  = document.getElementById('evt-desc');
    $btnDelete  = document.getElementById('btn-delete');
    $btnSave    = document.getElementById('btn-save');
    $recurrence = document.getElementById('evt-recurrence');

    /* ── Campo "Hasta" de recurrencia ── */
    if (!document.getElementById('end-recurrence-group')) {
      const recurrenceGroup    = $recurrence.closest('.field-group');
      const endRecurrenceGroup = document.createElement('div');
      endRecurrenceGroup.id        = 'end-recurrence-group';
      endRecurrenceGroup.className = 'field-group';
      endRecurrenceGroup.style.display = 'none';
      endRecurrenceGroup.innerHTML = `
        <label for="evt-end-recurrence">Hasta (opcional)</label>
        <input type="date" id="evt-end-recurrence">
      `;
      recurrenceGroup.insertAdjacentElement('afterend', endRecurrenceGroup);
    }
    $endRecurrence = document.getElementById('evt-end-recurrence');

    /* ── Transformar el grupo de color en: tabs + color panel + imagen panel ── */
    const originalColorGroup = document.getElementById('color-palette').closest('.field-group');
    const bgGroup = document.createElement('div');
    bgGroup.className = 'field-group';
    bgGroup.id = 'bg-group';
    bgGroup.innerHTML = `
      <div class="bg-field-header">
        <label>Fondo</label>
        <div class="bg-tabs" id="bg-tabs">
          <button type="button" class="bg-tab active" data-tab="color">🎨 Color</button>
          <button type="button" class="bg-tab"        data-tab="imagen">🖼️ Imagen</button>
        </div>
      </div>
      <div id="bg-panel-color" class="bg-panel">
        <div class="color-palette" id="color-palette"
             role="group" aria-label="Seleccionar color"></div>
      </div>
      <div id="bg-panel-imagen" class="bg-panel hidden"></div>
    `;

    originalColorGroup.replaceWith(bgGroup);

    // Re-set palette reference (DOM was replaced)
    $palette       = document.getElementById('color-palette');
    $bgPanelColor  = document.getElementById('bg-panel-color');
    $bgPanelImagen = document.getElementById('bg-panel-imagen');

    buildColorPalette();
    buildImagePicker($bgPanelImagen);

    // Tab switcher
    document.getElementById('bg-tabs').addEventListener('click', e => {
      const tab = e.target.closest('.bg-tab');
      if (!tab) return;
      switchBgTab(tab.dataset.tab);
    });

    /* ── Toggle de importancia ── */
    if (!document.getElementById('important-group')) {
      const colorBgGroup   = document.getElementById('bg-group');
      const importantGroup = document.createElement('div');
      importantGroup.id        = 'important-group';
      importantGroup.className = 'field-group';
      importantGroup.innerHTML = `
        <label>Prioridad</label>
        <button type="button" id="btn-important-toggle"
                class="btn-important-toggle" aria-pressed="false">
          <span class="toggle-star">☆</span>
          <span class="toggle-label">Marcar como importante</span>
        </button>
      `;
      colorBgGroup.insertAdjacentElement('afterend', importantGroup);
    }
    $btnImportant = document.getElementById('btn-important-toggle');
    $btnImportant.addEventListener('click', () => setImportant(!_isImportant));

    /* ── Listeners generales ── */
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('btn-cancel').addEventListener('click', closeModal);
    $btnSave.addEventListener('click', saveEvent);
    $btnDelete.addEventListener('click', deleteEvent);

    if ($recurrence) {
      $recurrence.addEventListener('change', toggleEndRecurrenceField);
    }

    $backdrop.addEventListener('click', e => {
      if (e.target === $backdrop) closeModal();
    });

    document.addEventListener('keydown', e => {
      if (!$backdrop.hidden) {
        if (e.key === 'Escape') closeModal();
        if (e.key === 'Enter' && e.ctrlKey) saveEvent();
      }
    });

    document.getElementById('calendar-body').addEventListener('click', handleBodyClick);
  }

  /* ── Helper: parsear date string como hora local ─────────── */

  function parseDateKey(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  /* ── Helper: expandir recurrentes ───────────────────────── */

  function expandRecurringEventsForRange(startDate, endDate, recurringEvents) {
    const { CONFIG } = window.CalApp;
    const expanded = [];
    const start = new Date(startDate);
    const end   = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    function toDateKey(date) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    for (const event of recurringEvents) {
      let currentDate     = parseDateKey(event.originalDate);
      const endRecurrence = event.endRecurrence ? parseDateKey(event.endRecurrence) : null;

      if (event.recurrence === CONFIG.RECURRENCE_TYPES.YEARLY) {
        let year         = start.getFullYear();
        const eventMonth = currentDate.getMonth();
        const eventDay   = currentDate.getDate();

        while (year <= end.getFullYear()) {
          const occurrenceDate = new Date(year, eventMonth, eventDay);
          if (occurrenceDate >= start && occurrenceDate <= end) {
            if (!endRecurrence || occurrenceDate <= endRecurrence) {
              expanded.push({ ...event, dateKey: toDateKey(occurrenceDate), originalEventId: event.id });
            }
          }
          year++;
        }
      } else {
        while (currentDate <= end) {
          if (currentDate >= start) {
            if (!endRecurrence || currentDate <= endRecurrence) {
              expanded.push({ ...event, dateKey: toDateKey(currentDate), originalEventId: event.id });
            }
          }
          switch (event.recurrence) {
            case CONFIG.RECURRENCE_TYPES.DAILY:
              currentDate.setDate(currentDate.getDate() + 1); break;
            case CONFIG.RECURRENCE_TYPES.WEEKLY:
              currentDate.setDate(currentDate.getDate() + 7); break;
            case CONFIG.RECURRENCE_TYPES.MONTHLY:
              currentDate.setMonth(currentDate.getMonth() + 1); break;
            default:
              currentDate = new Date(end.getTime() + 1);
          }
        }
      }
    }

    return expanded;
  }

  return { init, openModal, closeModal };
})();