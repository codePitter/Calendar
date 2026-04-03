/**
 * calendar.js — Lógica de renderizado del calendario.
 * Namespace global: window.CalApp.Calendar
 */
window.CalApp = window.CalApp || {};

window.CalApp.Calendar = (function () {
  const { CONFIG, State } = window.CalApp;

  /* ── Estado interno del módulo ────────────────────────────── */

  let _referenceSlotMap = [];

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
      const classes = [
        'cal-day-header',
        isToday(d) ? 'is-today' : '',
        i === 5    ? 'is-sat'   : '',
        i === 6    ? 'is-sun'   : '',
      ].filter(Boolean).join(' ');

      const showMonth  = (i === 0) || (d.getDate() === 1);
      const monthLabel = showMonth
        ? `<span class="day-month-label">${CONFIG.MONTH_NAMES[d.getMonth()]}</span>`
        : '';

      return `
        <div class="${classes}">
          <span class="day-name">${CONFIG.DAY_NAMES_SHORT[i]}</span>
          <span class="day-number">${d.getDate()}</span>
          ${monthLabel}
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

    const showTime    = height > 38;
    const isRecurring = evt.recurrence && evt.recurrence !== 'none';
    const isImportant = !!evt.important;
    const hasImage    = !!evt.imageUrl;

    // ── DEBUG: log eventos con imagen ──
    if (hasImage) {
      const imgType = evt.imageUrl.startsWith('data:') ? 'data URL' : 'URL directa';
      console.log(`[RENDER] Evento "${evt.title}" tiene imagen:`
        + ` tipo=${imgType}, longitud=${evt.imageUrl.length}`
        + (imgType === 'data URL' ? `, prefijo=${evt.imageUrl.substring(0,40)}` : `, url=${evt.imageUrl.substring(0,60)}`));
    }

    const recurrenceIcon = isRecurring ? ' 🔄' : '';

    // Clases del evento
    const classes = [
      'cal-event',
      isImportant ? 'is-important' : '',
      hasImage    ? 'has-image'    : '',
    ].filter(Boolean).join(' ');

    const zIndex = isImportant ? 50 : 5;

    // Estilo principal
    let styleStr;
    if (hasImage) {
      styleStr = [
        `top:${top}px`,
        `height:${height}px`,
        `background-image:url("${escapeAttr(evt.imageUrl)}")`,
        `background-size:cover`,
        `background-position:center`,
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

    // Overlay de color cuando hay imagen (da legibilidad)
    const overlayHTML = hasImage
      ? `<div class="cal-event-img-overlay" style="background:${color}cc;"></div>`
      : '';

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

  /* ── API pública ──────────────────────────────────────────── */

  function render() {
    renderHeader();
    renderBody();
  }

  setInterval(updateCurrentTimeLine, 30_000);

  return { render, updateCurrentTimeLine, yToHour };
})();