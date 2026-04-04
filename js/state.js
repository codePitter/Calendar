/**
 * state.js — Estado centralizado de la aplicación.
 * Namespace global: window.CalApp.State
 */
window.CalApp = window.CalApp || {};

window.CalApp.State = (function () {
  const { CONFIG, Storage } = window.CalApp;

  /* ── Utilidades privadas ──────────────────────────────── */

  function getMondayOf(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const dow = d.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + diff);
    return d;
  }

  function toDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Parsea un string "YYYY-MM-DD" como fecha LOCAL (no UTC).
   */
  function parseDateKey(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  /**
   * Expande eventos recurrentes para un rango de fechas
   */
  function expandRecurringEventsForRange(startDate, endDate, recurringEvents) {
    const expanded = [];
    const start = new Date(startDate);
    const end   = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    for (const event of recurringEvents) {
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
              currentDate = new Date(end.getTime() + 1);
          }
        }
      }
    }

    return expanded;
  }

  /* ── Carga de datos ────────────────────────────────────── */
  const savedSettings = Storage.loadSettings();

  /* ── Estado público ───────────────────────────────────── */
  const state = {
    weekStart: getMondayOf(new Date()),
    endHour: savedSettings.endHour || CONFIG.DEFAULT_END_HOUR,
    events: Storage.loadEvents(),
    recurringEvents: Storage.loadRecurringEvents(),
    markedDays: Storage.loadMarkedDays(),

    /* ── Navegación ─────────────────────────────────────── */
    nextWeek() {
      const d = new Date(this.weekStart);
      d.setDate(d.getDate() + 7);
      this.weekStart = d;
    },

    prevWeek() {
      const d = new Date(this.weekStart);
      d.setDate(d.getDate() - 7);
      this.weekStart = d;
    },

    goToToday() {
      this.weekStart = getMondayOf(new Date());
    },

    /* ── Horas visibles ─────────────────────────────────── */
    addHours(n) {
      this.endHour = Math.min(this.endHour + n, CONFIG.MAX_END_HOUR);
      Storage.saveSettings({ endHour: this.endHour });
    },

    removeHours(n) {
      this.endHour = Math.max(this.endHour - n, CONFIG.START_HOUR + 1);
      Storage.saveSettings({ endHour: this.endHour });
    },

    /* ── Días de la semana ──────────────────────────────── */
    getWeekDays() {
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(this.weekStart);
        d.setDate(d.getDate() + i);
        return d;
      });
    },

    dateKey: toDateKey,

    /* ── Días marcados (feriados, importantes) ──────────── */
    setDayMark(dateKey, { color, label }) {
      this.markedDays[dateKey] = { color, label: label || '' };
      Storage.saveMarkedDays(this.markedDays);
    },

    removeDayMark(dateKey) {
      delete this.markedDays[dateKey];
      Storage.saveMarkedDays(this.markedDays);
    },

    /**
     * Devuelve los eventos del día (incluyendo recurrentes expandidos)
     */
    getEventsForDay(date) {
      const dateKey = toDateKey(date);
      const regularEvents = this.events[dateKey] || [];

      const weekDays  = this.getWeekDays();
      const weekStart = weekDays[0];
      const weekEnd   = weekDays[6];

      const expandedRecurring = expandRecurringEventsForRange(weekStart, weekEnd, this.recurringEvents);
      const dayRecurring = expandedRecurring.filter(ev => ev.dateKey === dateKey);

      const allEvents = [...regularEvents, ...dayRecurring];
      return allEvents.sort((a, b) => a.startTime.localeCompare(b.startTime));
    },

    /* ── CRUD de eventos ────────────────────────────────── */
    addEvent(event) {
      if (event.recurrence && event.recurrence !== CONFIG.RECURRENCE_TYPES.NONE) {
        const recurringEvent = {
          id:            event.id,
          title:         event.title,
          startTime:     event.startTime,
          endTime:       event.endTime,
          desc:          event.desc,
          color:         event.color,
          important:     event.important  || false,  // ← FIX: guardar flag
          imageUrl:      event.imageUrl   || null,   // ← FIX: guardar imagen
          recurrence:    event.recurrence,
          originalDate:  event.dateKey,
          endRecurrence: event.endRecurrence || null,
        };
        this.recurringEvents.push(recurringEvent);
        Storage.saveRecurringEvents(this.recurringEvents);
      } else {
        const key = event.dateKey;
        if (!this.events[key]) this.events[key] = [];
        this.events[key].push(event);
        Storage.saveEvents(this.events);
      }
    },

    updateEvent(event) {
      const recurringIndex = this.recurringEvents.findIndex(e => e.id === event.id);

      if (recurringIndex !== -1) {
        this.recurringEvents[recurringIndex] = {
          ...this.recurringEvents[recurringIndex],
          title:         event.title,
          startTime:     event.startTime,
          endTime:       event.endTime,
          desc:          event.desc,
          color:         event.color,
          important:     event.important  || false,  // ← FIX
          imageUrl:      event.imageUrl   || null,   // ← FIX
          recurrence:    event.recurrence,
          endRecurrence: event.endRecurrence || null,
        };
        Storage.saveRecurringEvents(this.recurringEvents);
      } else {
        const key = event.dateKey;
        if (this.events[key]) {
          const idx = this.events[key].findIndex(e => e.id === event.id);
          if (idx !== -1) {
            this.events[key][idx] = event;
            Storage.saveEvents(this.events);
          }
        }
      }
    },

    deleteEvent(dateKey, eventId) {
      const recurringIndex = this.recurringEvents.findIndex(e => e.id === eventId);

      if (recurringIndex !== -1) {
        this.recurringEvents.splice(recurringIndex, 1);
        Storage.saveRecurringEvents(this.recurringEvents);
      } else {
        if (this.events[dateKey]) {
          this.events[dateKey] = this.events[dateKey].filter(e => e.id !== eventId);
          if (this.events[dateKey].length === 0) delete this.events[dateKey];
          Storage.saveEvents(this.events);
        }
      }
    },
  };

  return state;
})();