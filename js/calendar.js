/**
 * calendar.js — Lógica de renderizado del calendario.
 * Namespace global: window.CalApp.Calendar
 */
window.CalApp = window.CalApp || {};

window.CalApp.Calendar = (function () {
  const { CONFIG, State } = window.CalApp;

  /* ── Estado interno del módulo ────────────────────────────── */

  let _referenceSlotMap = [];

  /* ── Clima (Open-Meteo — sin API key) ────────────────────── */
  const WEATHER_LAT  = -32.9468; // Rosario, Argentina
  const WEATHER_LON  = -60.6393;
  let   _weatherCache = {};      // dateKey → { emoji, maxTemp }
  let   _weatherState = 'idle';  // 'idle' | 'loading' | 'done' | 'error'

  const WMO_EMOJI = [
    [0,  0,  '☀️'],
    [1,  2,  '⛅'],
    [3,  3,  '☁️'],
    [45, 48, '🌫️'],
    [51, 67, '🌧️'],
    [71, 77, '❄️'],
    [80, 82, '🌦️'],
    [85, 86, '❄️'],
    [95, 99, '⛈️'],
  ];

  function _wmoEmoji(code) {
    for (const [lo, hi, icon] of WMO_EMOJI) {
      if (code >= lo && code <= hi) return icon;
    }
    return '🌡️';
  }

  async function _fetchWeather() {
    if (_weatherState === 'loading' || _weatherState === 'done') return;
    _weatherState = 'loading';
    try {
      const url = `https://api.open-meteo.com/v1/forecast`
        + `?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}`
        + `&daily=weathercode,temperature_2m_max,temperature_2m_min`
        + `&timezone=America%2FArgentina%2FBuenos_Aires`
        + `&forecast_days=16`;
      const res  = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const { time, weathercode, temperature_2m_max } = data.daily;
      for (let i = 0; i < time.length; i++) {
        _weatherCache[time[i]] = {
          emoji:   _wmoEmoji(weathercode[i]),
          maxTemp: Math.round(temperature_2m_max[i]),
        };
      }
      _weatherState = 'done';
      renderHeader(); // actualizar encabezados con datos de clima
    } catch (err) {
      console.warn('[Calendar] Clima no disponible:', err.message);
      _weatherState = 'error';
    }
  }

  /* ── SlotMap ──────────────────────────────────────────────── */

  function buildSlotMap() {
    const { START_HOUR, SLOT_HEIGHT } = CONFIG;
    const endHour  = State.endHour;
    const slots    = [];
    let   currentTop = 0;

    for (let h = START_HOUR; h < endHour; h++) {
      slots.push({ hour: h, height: SLOT_HEIGHT, top: currentTop });
      currentTop += SLOT_HEIGHT;
    }

    return slots;
  }

  function timeToY(h, m, slotMap) {
    if (!slotMap.length) return 0;

    const last = slotMap[slotMap.length - 1];

    if (h > last.hour) return last.top + last.height;

    const slot = slotMap.find(s => s.hour === h);
    if (!slot) return 0;

    return slot.top + (m / 60) * slot.height;
  }

  /* ── API pública: yToHour ─────────────────────────────────── */

  function yToHour(y) {
    const slotMap = _referenceSlotMap;
    if (!slotMap.length) return CONFIG.START_HOUR;

    for (const slot of slotMap) {
      if (y >= slot.top && y < slot.top + slot.height) return slot.hour;
    }

    return slotMap[slotMap.length - 1].hour;
  }

  /* ── Utilidades privadas ──────────────────────────────────── */

  function getISOWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  function padTime(h, m = 0) {
    const hh = h % 24;
    return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function isToday(date) {
    const now = new Date();
    return (
      date.getDate()     === now.getDate()  &&
      date.getMonth()    === now.getMonth() &&
      date.getFullYear() === now.getFullYear()
    );
  }

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;');
  }

  /* ── Renderizado del encabezado ───────────────────────────── */

  function renderHeader() {
    const days      = State.getWeekDays();
    const weekNum   = getISOWeekNumber(days[0]);
    const startDay  = days[0];
    const endDay    = days[6];

    const sameMonth = startDay.getMonth() === endDay.getMonth();
    const startStr  = sameMonth
      ? `${startDay.getDate()}`
      : `${startDay.getDate()} ${CONFIG.MONTH_NAMES[startDay.getMonth()]}`;
    const endStr    = `${endDay.getDate()} ${CONFIG.MONTH_NAMES[endDay.getMonth()]}`;

    document.getElementById('week-range').textContent = `${startStr} – ${endStr}`;
    document.getElementById('week-num').textContent   = `Semana ${weekNum}`;

    const corner     = `<div class="cal-corner"></div>`;
    const dayHeaders = days.map((d, i) => {
      const dateKey = State.dateKey(d);
      const mark    = State.markedDays?.[dateKey];

      const classes = [
        'cal-day-header',
        isToday(d) ? 'is-today' : '',
        i === 5    ? 'is-sat'   : '',
        i === 6    ? 'is-sun'   : '',
        mark       ? 'is-marked' : '',
      ].filter(Boolean).join(' ');

      const markStyle = mark
        ? `style="background:${mark.color};"`
        : '';

      const markLabel = mark?.label
        ? `<span class="day-mark-label">${escapeHTML(mark.label)}</span>`
        : `<span class="day-mark-label day-mark-ph" aria-hidden="true">&nbsp;</span>`;

      const showMonth  = (i === 0) || (d.getDate() === 1);
      const monthLabel = showMonth
        ? `<span class="day-month-label">${CONFIG.MONTH_NAMES[d.getMonth()]}</span>`
        : '';

      const w = _weatherCache[dateKey];
      const weatherHTML = w
        ? `<div class="day-weather">
             <span class="day-weather-icon">${w.emoji}</span>
             <span class="day-weather-temp">${w.maxTemp}°</span>
           </div>`
        : `<div class="day-weather day-weather-ph" aria-hidden="true">
             <span class="day-weather-icon">☀️</span>
             <span class="day-weather-temp">--°</span>
           </div>`;

      return `
        <div class="${classes}" data-date-key="${dateKey}" ${markStyle}>
          <div class="day-header-main">
            <div class="day-left">
              <span class="day-name">${CONFIG.DAY_NAMES_SHORT[i]}</span>
              <span class="day-number">${d.getDate()}</span>
              ${monthLabel}
            </div>
            ${weatherHTML}
          </div>
          ${markLabel}
        </div>`;
    }).join('');

    document.getElementById('calendar-header').innerHTML =
      `${corner}<div class="cal-days-header">${dayHeaders}</div>`;
  }

  /* ── Renderizado del cuerpo ───────────────────────────────── */

  function renderBody() {
    const days = State.getWeekDays();

    _referenceSlotMap = buildSlotMap();

    /* Columna de horas */
    const timeColHTML = _referenceSlotMap.map(({ hour, height }) => {
      return `<div class="cal-time-label" style="height:${height}px">${padTime(hour)}</div>`;
    }).join('');

    /* Columnas de días */
    const dayCols = days.map((day, i) => {
      const dateKey = State.dateKey(day);
      const totalH  = _referenceSlotMap.reduce((sum, s) => sum + s.height, 0);

      const colClass = [
        'cal-day-col',
        isToday(day) ? 'is-today' : '',
        i === 5      ? 'is-sat'   : '',
        i === 6      ? 'is-sun'   : '',
      ].filter(Boolean).join(' ');

      const lines = _referenceSlotMap.map(({ height, top }) => {
        const topHalf = top + height / 2;
        return `<div class="cal-hour-line" style="top:${top}px"></div>
                <div class="cal-half-line" style="top:${topHalf}px"></div>`;
      }).join('');

      const dayEvents  = State.getEventsForDay(day);
      const eventsHTML = dayEvents.map(evt => renderEvent(evt, _referenceSlotMap)).join('');

      const timeLine = isToday(day)
        ? `<div class="current-time-line" id="current-time-line"></div>`
        : '';

      return `
        <div class="${colClass}"
             data-date="${dateKey}"
             data-day-idx="${i}"
             style="height:${totalH}px">
          ${lines}
          ${eventsHTML}
          ${timeLine}
        </div>`;
    }).join('');

    document.getElementById('calendar-body').innerHTML = `
      <div class="cal-time-col">${timeColHTML}</div>
      <div class="cal-days-area">${dayCols}</div>
    `;

    updateCurrentTimeLine();
    scrollToWorkingHours();
  }

  /* ── Renderizado de un evento ─────────────────────────────── */

  function renderEvent(evt, slotMap) {
    const [sh, sm] = evt.startTime.split(':').map(Number);
    const [eh, em] = evt.endTime.split(':').map(Number);

    const top    = timeToY(sh, sm, slotMap);
    const bottom = timeToY(eh, em, slotMap);
    const height = Math.max(bottom - top, 20);
    const color  = evt.color || CONFIG.COLORS[0];
    const isTransparent = color === 'transparent';

    const showTime    = height > 38;
    const isRecurring = evt.recurrence && evt.recurrence !== 'none';
    const isImportant = !!evt.important;
    const hasImage    = !!evt.imageUrl;

    const recurrenceIcon = isRecurring ? ' 🔄' : '';

    // Clases del evento
    const classes = [
      'cal-event',
      isImportant    ? 'is-important'   : '',
      hasImage       ? 'has-image'      : '',
      isTransparent  ? 'is-transparent' : '',
    ].filter(Boolean).join(' ');

    const zIndex = isImportant ? 50 : 5;

    // Estilo principal
    let styleStr;
    if (hasImage) {
      styleStr = [
        `top:${top}px`,
        `height:${height}px`,
        `background-image:url('${evt.imageUrl}')`,
        `background-size:cover`,
        `background-position:center`,
        `z-index:${zIndex}`,
        `border:3px solid ${color === 'transparent' ? '#94a3b8' : color}`,
        `border-radius:var(--radius-event)`,
      ].join(';');
    } else if (isTransparent) {
      styleStr = [
        `top:${top}px`,
        `height:${height}px`,
        `background:transparent`,
        `z-index:${zIndex}`,
      ].join(';');
    } else {
      styleStr = [
        `top:${top}px`,
        `height:${height}px`,
        `background:${color}`,
        `z-index:${zIndex}`,
      ].join(';');
    }

    // Sin overlay: la imagen se ve limpia, el color se expresa en el borde
    const overlayHTML = '';

    const titleAttr = escapeAttr(evt.title)
      + (evt.desc  ? ' — ' + escapeAttr(evt.desc) : '')
      + (isRecurring ? ' (Evento recurrente)' : '')
      + (isImportant ? ' ⭐ Importante' : '');

    return `
      <div class="${classes}"
           data-event-id="${escapeAttr(evt.id)}"
           data-date-key="${escapeAttr(evt.dateKey)}"
           style="${styleStr}"
           title="${titleAttr}">
        ${overlayHTML}
        <div class="cal-event-title">${escapeHTML(evt.title)}${recurrenceIcon}</div>
        ${showTime ? `<div class="cal-event-time">${evt.startTime}–${evt.endTime}</div>` : ''}
      </div>`;
  }

  /* ── Línea de hora actual ─────────────────────────────────── */

  function updateCurrentTimeLine() {
    const line = document.getElementById('current-time-line');
    if (!line) return;

    const now     = new Date();
    const slotMap = _referenceSlotMap;
    const totalH  = slotMap.reduce((sum, s) => sum + s.height, 0);

    const top = timeToY(now.getHours(), now.getMinutes(), slotMap);

    if (!slotMap.length || top < 0 || top > totalH) {
      line.style.display = 'none';
    } else {
      line.style.display = 'block';
      line.style.top     = `${top}px`;
    }
  }

  function scrollToWorkingHours() {
    const body = document.getElementById('calendar-body');
    if (!body || body.dataset.scrolled) return;
    body.dataset.scrolled = '1';
    body.scrollTop = 0;
  }

  /* ── Sincronizar header con scrollbar del body ────────────── */

  /**
   * Cuando aparece la barra de desplazamiento vertical en .calendar-body,
   * le resta ~15px al área de contenido. Aquí medimos ese ancho exacto y
   * ajustamos el padding-right del header para que los 7 días queden
   * perfectamente alineados con sus columnas, sin importar el SO o navegador.
   */
  function _syncHeaderScrollbar() {
    const body   = document.getElementById('calendar-body');
    const header = document.getElementById('calendar-header');
    if (!body || !header) return;
    // offsetWidth incluye el scrollbar; clientWidth es solo el contenido.
    const sbW = body.offsetWidth - body.clientWidth;
    header.style.paddingRight = `calc(0.75rem + ${sbW}px)`;
  }

  window.addEventListener('resize', _syncHeaderScrollbar);

  function render() {
    renderHeader();
    renderBody();
    _fetchWeather();
    // Sincronizar en el mismo tick y luego otra vez tras el primer paint
    // (el scrollbar puede aparecer después de que el DOM se pinte).
    _syncHeaderScrollbar();
    requestAnimationFrame(_syncHeaderScrollbar);
    
    // Aplicar efectos del cielo a la columna del día actual
    requestAnimationFrame(() => {
      _applyTodayColumnEffect();
      _observeCalendar();
    });
  }

  setInterval(updateCurrentTimeLine, 30_000);

  /* ── Day Marker Popover ───────────────────────────────────── */

  let _dmPopover        = null;
  let _dmCurrentDateKey = null;
  let _dmSelectedColor  = CONFIG.COLORS[0];
  let _dmInited         = false;

  const DM_PRESETS = [
    { color: '#ef4444', emoji: '🔴', label: 'Feriado'     },
    { color: '#f97316', emoji: '🟠', label: 'Importante'  },
    { color: '#f59e0b', emoji: '🟡', label: 'Libre'       },
    { color: '#10b981', emoji: '🟢', label: 'Especial'    },
    { color: '#3b82f6', emoji: '🔵', label: 'Recordatorio'},
    { color: '#8b5cf6', emoji: '🟣', label: 'Evento'      },
  ];

  function _buildDMPopover() {
    if (_dmPopover) return;

    const swatchesHTML = [
      ...DM_PRESETS.map(p =>
        `<button type="button" class="dmp-swatch" data-color="${p.color}"
                 style="background:${p.color}" title="${p.label}"></button>`
      ),
      ...CONFIG.COLORS.filter(c => !DM_PRESETS.find(p => p.color === c)).map(c =>
        `<button type="button" class="dmp-swatch" data-color="${c}"
                 style="background:${c}" title="${c}"></button>`
      ),
    ].join('');

    _dmPopover = document.createElement('div');
    _dmPopover.id        = 'day-marker-popover';
    _dmPopover.className = 'day-marker-popover';
    _dmPopover.hidden    = true;
    _dmPopover.innerHTML = `
      <div class="dmp-header">
        <span class="dmp-title">Marcar día</span>
        <button type="button" class="dmp-close" id="dmp-close">×</button>
      </div>
      <div class="dmp-presets" id="dmp-presets">
        ${DM_PRESETS.map(p =>
          `<button type="button" class="dmp-preset-btn" data-color="${p.color}" data-label="${p.label}">
            ${p.emoji} ${p.label}
          </button>`
        ).join('')}
      </div>
      <div class="dmp-divider"></div>
      <div class="dmp-swatches" id="dmp-swatches">${swatchesHTML}</div>
      <div class="dmp-label-row">
        <input type="text" id="dmp-label" class="dmp-label-input"
               placeholder="Etiqueta personalizada…" maxlength="28" autocomplete="off">
      </div>
      <div class="dmp-actions">
        <button type="button" class="dmp-btn dmp-btn-remove" id="dmp-remove">Quitar</button>
        <button type="button" class="dmp-btn dmp-btn-save"   id="dmp-save">Guardar</button>
      </div>
    `;
    document.body.appendChild(_dmPopover);

    // Swatch click
    _dmPopover.querySelector('#dmp-swatches').addEventListener('click', e => {
      const sw = e.target.closest('.dmp-swatch');
      if (!sw) return;
      _dmSelectedColor = sw.dataset.color;
      _dmSyncSwatches();
    });

    // Preset buttons — fill color + label
    _dmPopover.querySelector('#dmp-presets').addEventListener('click', e => {
      const btn = e.target.closest('.dmp-preset-btn');
      if (!btn) return;
      _dmSelectedColor = btn.dataset.color;
      const labelInput = document.getElementById('dmp-label');
      if (labelInput && !labelInput.value.trim()) {
        labelInput.value = btn.dataset.label;
      }
      _dmSyncSwatches();
    });

    document.getElementById('dmp-close').addEventListener('click', _closeDM);
    document.getElementById('dmp-save').addEventListener('click', _saveDM);
    document.getElementById('dmp-remove').addEventListener('click', _removeDM);

    // Cerrar al click fuera
    document.addEventListener('click', e => {
      if (!_dmPopover.hidden &&
          !_dmPopover.contains(e.target) &&
          !e.target.closest('.cal-day-header[data-date-key]')) {
        _closeDM();
      }
    }, true);
  }

  function _dmSyncSwatches() {
    if (!_dmPopover) return;
    _dmPopover.querySelectorAll('.dmp-swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.color === _dmSelectedColor);
    });
  }

  function _openDM(dateKey, headerEl) {
    _buildDMPopover();
    _dmCurrentDateKey = dateKey;

    const mark = State.markedDays?.[dateKey];
    _dmSelectedColor = mark?.color || DM_PRESETS[0].color;

    _dmSyncSwatches();
    document.getElementById('dmp-label').value = mark?.label || '';
    document.getElementById('dmp-remove').style.display = mark ? 'inline-flex' : 'none';

    _dmPopover.hidden = false;

    // Posicionar debajo del encabezado
    const rect = headerEl.getBoundingClientRect();
    const pw   = _dmPopover.offsetWidth  || 240;
    const ph   = _dmPopover.offsetHeight || 220;
    let left   = rect.left;
    let top    = rect.bottom + 6;

    if (left + pw > window.innerWidth  - 8) left = window.innerWidth  - pw - 8;
    if (top  + ph > window.innerHeight - 8) top  = rect.top - ph - 6;
    left = Math.max(8, left);

    _dmPopover.style.left = `${left}px`;
    _dmPopover.style.top  = `${top}px`;

    setTimeout(() => document.getElementById('dmp-label')?.focus(), 50);
  }

  function _closeDM() {
    if (_dmPopover) _dmPopover.hidden = true;
    _dmCurrentDateKey = null;
  }

  function _saveDM() {
    if (!_dmCurrentDateKey) return;
    const label = document.getElementById('dmp-label')?.value.trim() || '';
    State.setDayMark(_dmCurrentDateKey, { color: _dmSelectedColor, label });
    render();
    _closeDM();
  }

  function _removeDM() {
    if (!_dmCurrentDateKey) return;
    State.removeDayMark(_dmCurrentDateKey);
    render();
    _closeDM();
  }

  /* ── Sistema de efectos del cielo para columna del día actual ──── */

  /**
   * Retorna un gradiente base según la hora del día (calibrado para Argentina en abril).
   */
  function _baseSky(hour) {
    // Noche profunda
    if (hour >= 0  && hour < 5)  return 'linear-gradient(180deg, #0a0e27 0%, #1a1f3a 100%)';
    // Pre-amanecer (morado oscuro)
    if (hour >= 5  && hour < 6)  return 'linear-gradient(180deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)';
    // Aurora (naranja-púrpura)
    if (hour >= 6  && hour < 7)  return 'linear-gradient(180deg, #7c2d12 0%, #be123c 30%, #c026d3 70%, #4338ca 100%)';
    // Amanecer (dorado-celeste)
    if (hour >= 7  && hour < 8)  return 'linear-gradient(180deg, #fbbf24 0%, #fb923c 30%, #f472b6 60%, #60a5fa 100%)';
    // Mañana (celeste brillante)
    if (hour >= 8  && hour < 13) return 'linear-gradient(180deg, #38bdf8 0%, #60a5fa 50%, #93c5fd 100%)';
    // Tarde (azul profundo)
    if (hour >= 13 && hour < 18) return 'linear-gradient(180deg, #3b82f6 0%, #60a5fa 60%, #93c5fd 100%)';
    // Hora dorada (naranja cálido)
    if (hour >= 18 && hour < 19) return 'linear-gradient(180deg, #f59e0b 0%, #fb923c 40%, #f472b6 80%, #818cf8 100%)';
    // Atardecer (rojo-púrpura)
    if (hour >= 19 && hour < 20) return 'linear-gradient(180deg, #dc2626 0%, #be123c 30%, #a21caf 60%, #6366f1 100%)';
    // Dusk / noche temprana
    if (hour >= 20 && hour < 22) return 'linear-gradient(180deg, #312e81 0%, #1e1b4b 50%, #0f172a 100%)';
    // Noche
    return 'linear-gradient(180deg, #0a0e27 0%, #1a1f3a 100%)';
  }

  /**
   * Combina la categoría horaria con el clima actual para retornar el gradiente final.
   */
  function _skyForHourCat(hourCat, weatherEmoji) {
    const isNight     = (hourCat === 'night' || hourCat === 'dusk');
    const isDawn      = (hourCat === 'dawn' || hourCat === 'sunrise');
    const isDay       = (hourCat === 'morning' || hourCat === 'afternoon');
    const isGolden    = (hourCat === 'golden' || hourCat === 'sunset');

    // Tormenta → cielo casi negro verdoso
    if (weatherEmoji === '⛈️') {
      return 'linear-gradient(180deg, #0f172a 0%, #1e293b 30%, #334155 60%, #1c2e1f 100%)';
    }

    // Lluvia fuerte
    if (weatherEmoji === '🌧️') {
      if (isNight) return 'linear-gradient(180deg, #1e293b 0%, #334155 100%)';
      if (isDay)   return 'linear-gradient(180deg, #475569 0%, #64748b 50%, #94a3b8 100%)';
      // Dawn/golden con lluvia → gris azulado
      return 'linear-gradient(180deg, #475569 0%, #64748b 100%)';
    }

    // Nieve
    if (weatherEmoji === '❄️') {
      if (isNight) return 'linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #334155 100%)';
      // Día con nieve → cielo gris claro
      return 'linear-gradient(180deg, #cbd5e1 0%, #e2e8f0 50%, #f1f5f9 100%)';
    }

    // Niebla
    if (weatherEmoji === '🌫️') {
      if (isNight) return 'linear-gradient(180deg, #1e293b 0%, #334155 100%)';
      return 'linear-gradient(180deg, #94a3b8 0%, #cbd5e1 50%, #e2e8f0 100%)';
    }

    // Parcialmente nublado → matizar el cielo base con un tinte grisáceo
    if (weatherEmoji === '⛅' || weatherEmoji === '🌦️') {
      const base = _baseSky(new Date().getHours());
      // Overlay semi-transparente gris sobre el gradiente base
      return `${base}, rgba(148,163,184,0.2)`;
    }

    // Nublado → gris más pronunciado
    if (weatherEmoji === '☁️') {
      if (isNight) return 'linear-gradient(180deg, #334155 0%, #475569 100%)';
      if (isDawn || isGolden) return 'linear-gradient(180deg, #64748b 0%, #94a3b8 100%)';
      return 'linear-gradient(180deg, #94a3b8 0%, #cbd5e1 50%, #e2e8f0 100%)';
    }

    // Despejado → usar el cielo base natural
    return _baseSky(new Date().getHours());
  }

  /**
   * Aplica el fondo dinámico (hora + clima) a la columna del día actual,
   * junto con estrellas, luna, sol, lluvia, nieve, niebla, nubes según corresponda.
   */
  function _applyTodayColumnEffect() {
    const todayCol = document.querySelector('.cal-day-col.is-today');
    if (!todayCol) return;

    const now  = new Date();
    const hour = now.getHours();

    // Obtener clima del día actual
    const todayKey = State.dateKey(now);
    const weather  = _weatherCache[todayKey];
    const weatherEmoji = weather?.emoji || '☀️';

    // Categoría horaria (para lógica de clima)
    let hourCat;
    if      (hour >= 0  && hour < 5)  hourCat = 'night';
    else if (hour >= 5  && hour < 7)  hourCat = 'dawn';
    else if (hour >= 7  && hour < 8)  hourCat = 'sunrise';
    else if (hour >= 8  && hour < 13) hourCat = 'morning';
    else if (hour >= 13 && hour < 18) hourCat = 'afternoon';
    else if (hour >= 18 && hour < 19) hourCat = 'golden';
    else if (hour >= 19 && hour < 20) hourCat = 'sunset';
    else if (hour >= 20 && hour < 22) hourCat = 'dusk';
    else                              hourCat = 'night';

    const skyGradient = _skyForHourCat(hourCat, weatherEmoji);

    // Aplicar gradiente de fondo
    todayCol.style.background = skyGradient;

    // Limpiar efectos previos
    todayCol.querySelectorAll('.sky-effect').forEach(el => el.remove());

    // ── Estrellas (noche / dusk) ────────────────────────────────────
    if (hourCat === 'night' || hourCat === 'dusk') {
      for (let i = 0; i < 30; i++) {
        const star = document.createElement('div');
        star.className = 'sky-effect sky-star';
        star.style.cssText = `
          position: absolute;
          width: 2px;
          height: 2px;
          background: white;
          border-radius: 50%;
          box-shadow: 0 0 4px rgba(255,255,255,0.8);
          top: ${Math.random() * 100}%;
          left: ${Math.random() * 100}%;
          opacity: ${0.3 + Math.random() * 0.7};
          animation: twinkle ${2 + Math.random() * 3}s infinite ease-in-out;
          pointer-events: none;
        `;
        todayCol.appendChild(star);
      }

      // Luna 3D con glow
      const moon = document.createElement('div');
      moon.className = 'sky-effect sky-moon';
      moon.style.cssText = `
        position: absolute;
        top: 8%;
        right: 12%;
        width: 50px;
        height: 50px;
        background: radial-gradient(circle at 35% 35%, #fff9e6, #e0ddd5);
        border-radius: 50%;
        box-shadow:
          0 0 20px rgba(255,255,255,0.5),
          inset -8px -8px 12px rgba(0,0,0,0.15);
        animation: moonGlow 4s infinite ease-in-out;
        pointer-events: none;
        z-index: 2;
      `;
      todayCol.appendChild(moon);
    }

    // ── Glow de horizonte (dawn, sunrise, golden, sunset, dusk) ─────
    if (['dawn','sunrise','golden','sunset','dusk'].includes(hourCat)) {
      const glow = document.createElement('div');
      glow.className = 'sky-effect sky-glow';
      let glowColor;
      if (hourCat === 'dawn')    glowColor = 'rgba(123,44,191,0.3)'; // Morado
      if (hourCat === 'sunrise') glowColor = 'rgba(251,191,36,0.4)'; // Dorado
      if (hourCat === 'golden')  glowColor = 'rgba(245,158,11,0.4)'; // Naranja
      if (hourCat === 'sunset')  glowColor = 'rgba(220,38,38,0.4)';  // Rojo
      if (hourCat === 'dusk')    glowColor = 'rgba(99,102,241,0.3)'; // Índigo

      glow.style.cssText = `
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 35%;
        background: radial-gradient(ellipse at bottom, ${glowColor}, transparent 70%);
        pointer-events: none;
        z-index: 1;
      `;
      todayCol.appendChild(glow);
    }

    // ── Sol (días despejados o parcialmente nublados) ──────────────
    if ((weatherEmoji === '☀️' || weatherEmoji === '⛅' || weatherEmoji === '🌦️') &&
        (hourCat === 'morning' || hourCat === 'afternoon' || hourCat === 'sunrise' || hourCat === 'golden')) {
      const sun = document.createElement('div');
      sun.className = 'sky-effect sky-sun';
      
      let sunTop, sunRight;
      if (hourCat === 'sunrise') { sunTop = '65%'; sunRight = '75%'; }
      else if (hourCat === 'morning')   { sunTop = '15%'; sunRight = '15%'; }
      else if (hourCat === 'afternoon') { sunTop = '20%'; sunRight = '25%'; }
      else /* golden */                 { sunTop = '60%'; sunRight = '70%'; }

      sun.style.cssText = `
        position: absolute;
        top: ${sunTop};
        right: ${sunRight};
        width: 60px;
        height: 60px;
        background: radial-gradient(circle, #fef9c3 0%, #fde047 40%, #facc15 100%);
        border-radius: 50%;
        box-shadow:
          0 0 30px rgba(254,243,199,0.8),
          0 0 60px rgba(253,224,71,0.5);
        pointer-events: none;
        z-index: 2;
      `;
      todayCol.appendChild(sun);
    }

    // ── Lluvia (CSS rain) ───────────────────────────────────────────
    if (weatherEmoji === '🌧️' || weatherEmoji === '🌦️' || weatherEmoji === '⛈️') {
      const isHeavy = (weatherEmoji === '⛈️' || weatherEmoji === '🌧️');
      const rainCount = isHeavy ? 60 : 30;

      for (let i = 0; i < rainCount; i++) {
        const drop = document.createElement('div');
        drop.className = 'sky-effect sky-rain';
        drop.style.cssText = `
          position: absolute;
          width: 1px;
          height: ${isHeavy ? '20px' : '12px'};
          background: linear-gradient(to bottom, transparent, rgba(174,203,250,0.7));
          top: -30px;
          left: ${Math.random() * 100}%;
          animation: rainFall ${0.5 + Math.random() * 0.8}s linear infinite;
          animation-delay: ${Math.random() * 2}s;
          pointer-events: none;
          z-index: 10;
        `;
        todayCol.appendChild(drop);
      }
    }

    // ── Tormenta eléctrica (flash de relámpago) ─────────────────────
    if (weatherEmoji === '⛈️') {
      const flash = document.createElement('div');
      flash.className = 'sky-effect sky-lightning';
      flash.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(255,255,255,0);
        animation: lightningFlash 8s infinite;
        pointer-events: none;
        z-index: 15;
      `;
      todayCol.appendChild(flash);
    }

    // ── Nieve (CSS snow) ────────────────────────────────────────────
    if (weatherEmoji === '❄️') {
      for (let i = 0; i < 40; i++) {
        const flake = document.createElement('div');
        flake.className = 'sky-effect sky-snow';
        flake.style.cssText = `
          position: absolute;
          width: ${3 + Math.random() * 4}px;
          height: ${3 + Math.random() * 4}px;
          background: white;
          border-radius: 50%;
          top: -20px;
          left: ${Math.random() * 100}%;
          opacity: ${0.6 + Math.random() * 0.4};
          animation: snowFall ${4 + Math.random() * 6}s linear infinite;
          animation-delay: ${Math.random() * 3}s;
          pointer-events: none;
          z-index: 10;
        `;
        todayCol.appendChild(flake);
      }
    }

    // ── Niebla (bandas horizontales con drift) ──────────────────────
    if (weatherEmoji === '🌫️') {
      for (let i = 0; i < 5; i++) {
        const fog = document.createElement('div');
        fog.className = 'sky-effect sky-fog';
        fog.style.cssText = `
          position: absolute;
          top: ${i * 20}%;
          left: -10%;
          width: 120%;
          height: 15%;
          background: linear-gradient(90deg,
            transparent 0%,
            rgba(203,213,225,0.5) 25%,
            rgba(203,213,225,0.7) 50%,
            rgba(203,213,225,0.5) 75%,
            transparent 100%
          );
          animation: fogDrift ${10 + i * 2}s linear infinite;
          animation-delay: ${i * -2}s;
          pointer-events: none;
          z-index: 5;
        `;
        todayCol.appendChild(fog);
      }
    }

    // ── Nubes 3D (si está nublado o parcialmente nublado) ──────────
    if (weatherEmoji === '☁️' || weatherEmoji === '⛅' || weatherEmoji === '🌦️') {
      const cloudCount = (weatherEmoji === '☁️') ? 7 : 4;
      const cloudPositions = [8, 20, 35, 50, 62, 75, 88]; // % verticales

      for (let i = 0; i < cloudCount; i++) {
        const cloud = document.createElement('div');
        cloud.className = 'sky-effect sky-cloud';
        const size = 60 + Math.random() * 40;
        const top  = cloudPositions[i] || (Math.random() * 80);

        cloud.style.cssText = `
          position: absolute;
          top: ${top}%;
          left: ${Math.random() * 70}%;
          width: ${size}px;
          height: ${size * 0.6}px;
          background: radial-gradient(ellipse, rgba(255,255,255,0.9), rgba(255,255,255,0.6));
          border-radius: 50%;
          box-shadow:
            ${size * 0.3}px ${size * 0.2}px ${size * 0.4}px rgba(255,255,255,0.7) inset,
            -${size * 0.2}px -${size * 0.1}px ${size * 0.3}px rgba(0,0,0,0.1) inset;
          animation: cloudDrift ${20 + Math.random() * 15}s linear infinite;
          animation-delay: ${Math.random() * -10}s;
          pointer-events: none;
          z-index: 3;
        `;
        todayCol.appendChild(cloud);
      }
    }
  }

  /**
   * Observa cambios en #calendar-body para volver a aplicar efectos
   * cuando el DOM se regenera (ej. al cambiar de semana).
   */
  function _observeCalendar() {
    const calBody = document.getElementById('calendar-body');
    if (!calBody) return;

    const observer = new MutationObserver(() => {
      _applyTodayColumnEffect();
    });

    observer.observe(calBody, { childList: true, subtree: true });
  }

  /* ── Fin del sistema de efectos del cielo ──── */

  function initDayMarkerListener() {
    if (_dmInited) return;
    _dmInited = true;
    document.getElementById('calendar-header').addEventListener('click', e => {
      const hdr = e.target.closest('.cal-day-header[data-date-key]');
      if (!hdr) return;
      // Si el popover ya está abierto para este día, cerrarlo
      if (!_dmPopover?.hidden && _dmCurrentDateKey === hdr.dataset.dateKey) {
        _closeDM(); return;
      }
      _openDM(hdr.dataset.dateKey, hdr);
    });
  }

  return { render, updateCurrentTimeLine, yToHour, initDayMarkerListener };
})();