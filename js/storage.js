/**
 * storage.js — Abstracción sobre localStorage.
 * Namespace global: window.CalApp.Storage
 */
window.CalApp = window.CalApp || {};

window.CalApp.Storage = (function () {
  const { STORAGE_KEY_EVENTS, STORAGE_KEY_SETTINGS, STORAGE_KEY_RECURRING } = window.CalApp.CONFIG;

  /**
   * Carga el mapa de eventos desde localStorage.
   * @returns {Object} Mapa { dateKey: Event[] }
   */
  function loadEvents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_EVENTS);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.warn('[Storage] Error cargando eventos:', err);
      return {};
    }
  }

  /**
   * Persiste el mapa de eventos completo en localStorage.
   * @param {Object} events - Mapa { dateKey: Event[] }
   */
  function saveEvents(events) {
    try {
      localStorage.setItem(STORAGE_KEY_EVENTS, JSON.stringify(events));
    } catch (err) {
      console.error('[Storage] Error guardando eventos:', err);
    }
  }

  /**
   * Carga los eventos recurrentes.
   * @returns {Array} Lista de eventos recurrentes
   */
  function loadRecurringEvents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_RECURRING);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.warn('[Storage] Error cargando eventos recurrentes:', err);
      return [];
    }
  }

  /**
   * Persiste los eventos recurrentes.
   * @param {Array} recurring - Lista de eventos recurrentes
   */
  function saveRecurringEvents(recurring) {
    try {
      localStorage.setItem(STORAGE_KEY_RECURRING, JSON.stringify(recurring));
    } catch (err) {
      console.error('[Storage] Error guardando eventos recurrentes:', err);
    }
  }

  /**
   * Carga las preferencias del usuario.
   * @returns {Object} Objeto de configuración guardada
   */
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.warn('[Storage] Error cargando settings:', err);
      return {};
    }
  }

  /**
   * Persiste las preferencias del usuario.
   * @param {Object} settings
   */
  function saveSettings(settings) {
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
    } catch (err) {
      console.error('[Storage] Error guardando settings:', err);
    }
  }

  return { 
    loadEvents, 
    saveEvents, 
    loadSettings, 
    saveSettings,
    loadRecurringEvents,
    saveRecurringEvents
  };
})();