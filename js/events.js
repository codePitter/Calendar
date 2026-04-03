/**
 * events.js — Modal de eventos y operaciones CRUD.
 */
window.CalApp = window.CalApp || {};

window.CalApp.Events = (function () {
  const { CONFIG, State } = window.CalApp;

  let _currentEvent  = null;
  let _pendingDate   = null;
  let _pendingHour   = null;
  let _selectedColor = CONFIG.COLORS[0];

  let $backdrop, $title, $inputTitle, $inputStart, $inputEnd,
      $inputDesc, $palette, $btnDelete, $btnSave, $recurrence, $endRecurrence;

  function padTime(h, m = 0) {
    const hh = h % 24;
    return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function generateId() {
    return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

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
    $palette.querySelectorAll('.color-dot').forEach(d => {
      d.classList.toggle('active', d.dataset.color === color);
    });
  }

  function toggleEndRecurrenceField() {
    const recurrenceValue = $recurrence.value;
    const $endRecurrenceGroup = document.getElementById('end-recurrence-group');
    if ($endRecurrenceGroup) {
      $endRecurrenceGroup.style.display = recurrenceValue !== 'none' ? 'flex' : 'none';
    }
  }

  function openModal(dateStr, hour, event = null) {
    _currentEvent  = event;
    _pendingDate   = dateStr;
    _pendingHour   = hour;

    if (event) {
      $title.textContent = event.recurrence && event.recurrence !== 'none' ? 'Editar Evento Recurrente' : 'Editar Evento';
      $inputTitle.value = event.title || '';
      $inputStart.value = event.startTime || padTime(hour ?? CONFIG.START_HOUR);
      $inputEnd.value = event.endTime || padTime((hour ?? CONFIG.START_HOUR) + 1);
      $inputDesc.value = event.desc || '';
      _selectedColor = event.color || CONFIG.COLORS[0];
      $recurrence.value = event.recurrence || 'none';
      if ($endRecurrence) {
        $endRecurrence.value = event.endRecurrence || '';
      }
      $btnDelete.hidden = false;
    } else {
      $title.textContent = 'Nuevo Evento';
      const safeHour = Math.min(hour ?? CONFIG.START_HOUR, State.endHour - 1);
      $inputTitle.value = '';
      $inputStart.value = padTime(safeHour);
      $inputEnd.value = padTime(Math.min(safeHour + 1, State.endHour));
      $inputDesc.value = '';
      _selectedColor = CONFIG.COLORS[0];
      $recurrence.value = 'none';
      if ($endRecurrence) {
        $endRecurrence.value = '';
      }
      $btnDelete.hidden = true;
    }

    setActiveDot(_selectedColor);
    toggleEndRecurrenceField();
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
      id: _currentEvent ? _currentEvent.id : generateId(),
      dateKey: _currentEvent ? _currentEvent.dateKey : _pendingDate,
      title,
      startTime: $inputStart.value,
      endTime: $inputEnd.value,
      desc: $inputDesc.value.trim(),
      color: _selectedColor,
    };

    if (recurrence !== 'none') {
      event.recurrence = recurrence;
      event.originalDate = _currentEvent ? (_currentEvent.originalDate || _currentEvent.dateKey) : _pendingDate;
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
    const rect = col.getBoundingClientRect();
    const relY  = e.clientY - rect.top;
    const hour  = window.CalApp.Calendar.yToHour(relY, dateKey);

    openModal(dateKey, hour);
  }

  function init() {
    $backdrop   = document.getElementById('modal-backdrop');
    $title      = document.getElementById('modal-heading');
    $inputTitle = document.getElementById('evt-title');
    $inputStart = document.getElementById('evt-start');
    $inputEnd   = document.getElementById('evt-end');
    $inputDesc  = document.getElementById('evt-desc');
    $palette    = document.getElementById('color-palette');
    $btnDelete  = document.getElementById('btn-delete');
    $btnSave    = document.getElementById('btn-save');
    $recurrence = document.getElementById('evt-recurrence');

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

    buildColorPalette();

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

  // ✅ FIX: parsear strings "YYYY-MM-DD" como hora local, no UTC
  function parseDateKey(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  // Función auxiliar para expandir recurrentes (necesaria en handleBodyClick)
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
      // ✅ FIX: usar parseDateKey en lugar de new Date(string) para evitar UTC offset
      let currentDate = parseDateKey(event.originalDate);
      const endRecurrence = event.endRecurrence ? parseDateKey(event.endRecurrence) : null;

      if (event.recurrence === CONFIG.RECURRENCE_TYPES.YEARLY) {
        let year = start.getFullYear();
        const eventMonth = currentDate.getMonth();
        const eventDay   = currentDate.getDate();

        while (year <= end.getFullYear()) {
          const occurrenceDate = new Date(year, eventMonth, eventDay);
          if (occurrenceDate >= start && occurrenceDate <= end) {
            if (!endRecurrence || occurrenceDate <= endRecurrence) {
              expanded.push({
                ...event,
                dateKey: toDateKey(occurrenceDate),
                originalEventId: event.id
              });
            }
          }
          year++;
        }
      } else {
        while (currentDate <= end) {
          if (currentDate >= start) {
            if (!endRecurrence || currentDate <= endRecurrence) {
              expanded.push({
                ...event,
                dateKey: toDateKey(currentDate),
                originalEventId: event.id
              });
            }
          }

          switch (event.recurrence) {
            case CONFIG.RECURRENCE_TYPES.DAILY:
              currentDate.setDate(currentDate.getDate() + 1);
              break;
            case CONFIG.RECURRENCE_TYPES.WEEKLY:
              currentDate.setDate(currentDate.getDate() + 7);
              break;
            case CONFIG.RECURRENCE_TYPES.MONTHLY:
              currentDate.setMonth(currentDate.getMonth() + 1);
              break;
            default:
              currentDate = new Date(end.getTime() + 1); // salir del loop
          }
        }
      }
    }

    return expanded;
  }

  return { init, openModal, closeModal };
})();