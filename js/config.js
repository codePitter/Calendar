/**
 * config.js — Constantes y configuración de la aplicación.
 * Namespace global: window.CalApp.CONFIG
 */
window.CalApp = window.CalApp || {};

window.CalApp.CONFIG = Object.freeze({
  /** Hora de inicio del calendario */
  START_HOUR: 7,

  /** Hora de fin por defecto (exclusiva: hasta las 23:00) */
  DEFAULT_END_HOUR: 23,

  /** Altura en px de cada franja horaria de 1 hora — debe coincidir con --slot-h en CSS */
  SLOT_HEIGHT: 30,

  /** Máximo de horas que se pueden mostrar (hasta las 06:00 del día siguiente) */
  MAX_END_HOUR: 30,

  /** Incremento al presionar "+ Horas" o "- Horas" */
  HOURS_INCREMENT: 1,

  /** Tipos de recurrencia */
  RECURRENCE_TYPES: {
    NONE: 'none',
    DAILY: 'daily',
    WEEKLY: 'weekly',
    MONTHLY: 'monthly',
    YEARLY: 'yearly'
  },

  /** Textos para los tipos de recurrencia */
  RECURRENCE_LABELS: {
    none: 'No repetir',
    daily: 'Diario',
    weekly: 'Semanal',
    monthly: 'Mensual',
    yearly: 'Anual'
  },

  /** Nombres de los días (Lunes = índice 0) */
  DAY_NAMES:       ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
  DAY_NAMES_SHORT: ['Lun',   'Mar',    'Mié',        'Jue',    'Vie',     'Sáb',    'Dom'],

  /** Nombres de los meses */
  MONTH_NAMES: [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ],

  /** Paleta de colores disponibles para eventos */
  COLORS: [
    '#4f46e5', // Indigo
    '#f59e0b', // Amber
    '#10b981', // Emerald
    '#ef4444', // Red
    '#8b5cf6', // Violet
    '#ec4899', // Pink
    '#06b6d4', // Cyan
    '#f97316', // Orange
  ],

  /** Claves de localStorage */
  STORAGE_KEY_EVENTS:   'agenda2026_events',
  STORAGE_KEY_SETTINGS: 'agenda2026_settings',
  STORAGE_KEY_RECURRING: 'agenda2026_recurring',
});