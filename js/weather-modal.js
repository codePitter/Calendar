/**
 * weather-modal.js
 * Al hacer clic en el emoji del clima de una fecha, muestra un modal
 * con el detalle horario: emoji, precipitación, temperatura °C, humedad.
 * Usa Open-Meteo (gratuito, sin API key).
 */
window.CalApp = window.CalApp || {};

window.CalApp.WeatherModal = (function () {

  /* ── WMO weather code → { emoji, label } ─────────────────── */
  const WMO = {
    0:  { emoji: '☀️',  label: 'Despejado' },
    1:  { emoji: '🌤️', label: 'Mayormente despejado' },
    2:  { emoji: '⛅',  label: 'Parcialmente nublado' },
    3:  { emoji: '☁️',  label: 'Nublado' },
    45: { emoji: '🌫️', label: 'Niebla' },
    48: { emoji: '🌫️', label: 'Niebla con escarcha' },
    51: { emoji: '🌦️', label: 'Llovizna leve' },
    53: { emoji: '🌦️', label: 'Llovizna moderada' },
    55: { emoji: '🌧️', label: 'Llovizna densa' },
    61: { emoji: '🌧️', label: 'Lluvia leve' },
    63: { emoji: '🌧️', label: 'Lluvia moderada' },
    65: { emoji: '🌧️', label: 'Lluvia intensa' },
    71: { emoji: '🌨️', label: 'Nieve leve' },
    73: { emoji: '🌨️', label: 'Nieve moderada' },
    75: { emoji: '❄️',  label: 'Nieve intensa' },
    77: { emoji: '🌨️', label: 'Granizo' },
    80: { emoji: '🌦️', label: 'Chaparrón leve' },
    81: { emoji: '🌧️', label: 'Chaparrón moderado' },
    82: { emoji: '⛈️',  label: 'Chaparrón violento' },
    85: { emoji: '🌨️', label: 'Nevadas leves' },
    86: { emoji: '❄️',  label: 'Nevadas intensas' },
    95: { emoji: '⛈️',  label: 'Tormenta eléctrica' },
    96: { emoji: '⛈️',  label: 'Tormenta con granizo' },
    99: { emoji: '⛈️',  label: 'Tormenta fuerte con granizo' },
  };

  function wmoInfo(code) {
    return WMO[code] || WMO[Math.floor(code / 10) * 10] || { emoji: '🌡️', label: `Código ${code}` };
  }

  /* ── Geolocation (con caché de sesión) ───────────────────── */
  let _coordsCache = null;

  function getCoords() {
    if (_coordsCache) return Promise.resolve(_coordsCache);
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        // Fallback: Buenos Aires / Rosario area
        resolve({ latitude: -32.9468, longitude: -60.6393 });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => {
          _coordsCache = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          resolve(_coordsCache);
        },
        () => resolve({ latitude: -32.9468, longitude: -60.6393 }) // fallback silencioso
      );
    });
  }

  /* ── Fetch Open-Meteo ────────────────────────────────────── */
  async function fetchHourly(dateStr) {
    const coords = await getCoords();
    const url = `https://api.open-meteo.com/v1/forecast`
      + `?latitude=${coords.latitude}&longitude=${coords.longitude}`
      + `&hourly=temperature_2m,precipitation_probability,relativehumidity_2m,weathercode`
      + `&timezone=auto`
      + `&start_date=${dateStr}&end_date=${dateStr}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo error ${res.status}`);
    return res.json();
  }

  /* ── Modal DOM ───────────────────────────────────────────── */
  let $backdrop = null;

  function ensureModal() {
    if (document.getElementById('wm-backdrop')) return;

    // Inyectar estilos
    const style = document.createElement('style');
    style.textContent = `
      #wm-backdrop {
        position: fixed; inset: 0; z-index: 9000;
        background: rgba(0,0,0,.45);
        display: flex; align-items: center; justify-content: center;
        padding: 1rem;
      }
      #wm-backdrop[hidden] { display: none; }

      #wm-modal {
        background: var(--clr-surface, #fff);
        color: var(--clr-text, #1a1a2e);
        border-radius: var(--radius-lg, 16px);
        box-shadow: 0 24px 60px rgba(0,0,0,.35);
        width: min(480px, 100%);
        max-height: 82vh;
        display: flex; flex-direction: column;
        overflow: hidden;
        font-family: var(--font-body, 'DM Sans', sans-serif);
      }

      #wm-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 1rem 1.25rem .75rem;
        border-bottom: 1px solid var(--clr-border, #e5e7eb);
        flex-shrink: 0;
      }
      #wm-title {
        font-size: 1rem; font-weight: 600;
        margin: 0; line-height: 1.3;
      }
      #wm-subtitle {
        font-size: .75rem; opacity: .6; margin: 0;
      }
      #wm-close {
        background: none; border: none; cursor: pointer;
        font-size: 1.25rem; line-height: 1;
        color: var(--clr-text, #1a1a2e);
        padding: .25rem .4rem; border-radius: 6px;
        transition: background .15s;
      }
      #wm-close:hover { background: var(--clr-bg, #f3f4f6); }

      #wm-body {
        overflow-y: auto; flex: 1;
        padding: .5rem .75rem .75rem;
      }

      .wm-loading {
        text-align: center; padding: 2.5rem 1rem;
        opacity: .55; font-size: .9rem;
      }

      .wm-error {
        text-align: center; padding: 2rem 1rem;
        color: #ef4444; font-size: .85rem;
      }

      .wm-row {
        display: grid;
        grid-template-columns: 3rem 2rem 1fr 1fr 1fr;
        align-items: center;
        gap: .25rem .5rem;
        padding: .45rem .5rem;
        border-radius: 8px;
        font-size: .82rem;
        transition: background .12s;
      }
      .wm-row:hover { background: var(--clr-bg, #f9fafb); }
      .wm-row + .wm-row { border-top: 1px solid var(--clr-border, #e5e7eb); }

      .wm-hour {
        font-weight: 600; font-size: .8rem;
        color: var(--clr-accent, #4f46e5);
        white-space: nowrap;
      }
      .wm-emoji { font-size: 1.2rem; text-align: center; }
      .wm-label {
        font-size: .75rem; opacity: .7;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .wm-stat {
        text-align: center;
        display: flex; flex-direction: column; align-items: center; gap: 1px;
      }
      .wm-stat-val { font-weight: 600; font-size: .85rem; }
      .wm-stat-key { font-size: .65rem; opacity: .5; text-transform: uppercase; letter-spacing: .03em; }

      .wm-col-heads {
        display: grid;
        grid-template-columns: 3rem 2rem 1fr 1fr 1fr;
        gap: .25rem .5rem;
        padding: .3rem .5rem .2rem;
        font-size: .65rem; text-transform: uppercase;
        letter-spacing: .05em; opacity: .45; font-weight: 600;
        border-bottom: 1px solid var(--clr-border, #e5e7eb);
        margin-bottom: .15rem;
      }
    `;
    document.head.appendChild(style);

    // Backdrop + modal
    const backdrop = document.createElement('div');
    backdrop.id = 'wm-backdrop';
    backdrop.hidden = true;
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.innerHTML = `
      <div id="wm-modal" role="dialog" aria-modal="true" aria-labelledby="wm-title">
        <div id="wm-header">
          <div>
            <p id="wm-title">Clima del día</p>
            <p id="wm-subtitle"></p>
          </div>
          <button id="wm-close" aria-label="Cerrar">×</button>
        </div>
        <div id="wm-body">
          <div class="wm-loading">Cargando clima…</div>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    $backdrop = backdrop;

    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
    document.getElementById('wm-close').addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$backdrop.hidden) close(); });
  }

  function close() {
    if ($backdrop) { $backdrop.hidden = true; $backdrop.setAttribute('aria-hidden', 'true'); }
  }

  /* ── Render hourly rows ──────────────────────────────────── */
  function renderRows(data) {
    const h   = data.hourly;
    const times = h.time;              // ["2026-04-06T00:00", ...]
    const temp  = h.temperature_2m;
    const precip = h.precipitation_probability;
    const hum   = h.relativehumidity_2m;
    const codes = h.weathercode;

    let html = `<div class="wm-col-heads">
      <span>Hora</span><span></span><span>Estado</span>
      <span style="text-align:center">Temp</span>
      <span style="text-align:center">Lluvia / Hum.</span>
    </div>`;

    times.forEach((t, i) => {
      const hour = t.slice(11, 16);   // "HH:MM"
      const info = wmoInfo(codes[i]);
      const precipitation = precip[i] != null ? `${precip[i]}%` : '—';
      const humidity = hum[i] != null ? `${hum[i]}%` : '—';
      const temperature = temp[i] != null ? `${Math.round(temp[i])}°` : '—';

      // Colorear según temperatura
      const hotness = temp[i] > 30 ? '#ef4444' : temp[i] > 22 ? '#f97316' : temp[i] > 15 ? '#10b981' : '#3b82f6';

      html += `
        <div class="wm-row">
          <span class="wm-hour">${hour}</span>
          <span class="wm-emoji" title="${info.label}">${info.emoji}</span>
          <span class="wm-label" title="${info.label}">${info.label}</span>
          <div class="wm-stat">
            <span class="wm-stat-val" style="color:${hotness}">${temperature}</span>
            <span class="wm-stat-key">Temp</span>
          </div>
          <div class="wm-stat">
            <span class="wm-stat-val">
              🌧 ${precipitation} · 💧${humidity}
            </span>
            <span class="wm-stat-key">Precip · Hum.</span>
          </div>
        </div>`;
    });

    return html;
  }

  /* ── Open modal for a given date ─────────────────────────── */
  async function open(dateStr, label) {
    ensureModal();
    $backdrop.hidden = false;
    $backdrop.setAttribute('aria-hidden', 'false');

    document.getElementById('wm-title').textContent = `Clima — ${label}`;
    document.getElementById('wm-subtitle').textContent = 'Actualizado con Open-Meteo';
    document.getElementById('wm-body').innerHTML = `<div class="wm-loading">⏳ Cargando datos horarios…</div>`;

    try {
      const data = await fetchHourly(dateStr);
      document.getElementById('wm-body').innerHTML = renderRows(data);
    } catch (err) {
      console.error('[WeatherModal]', err);
      document.getElementById('wm-body').innerHTML =
        `<div class="wm-error">No se pudo cargar el clima.<br><small>${err.message}</small></div>`;
    }
  }

  /* ── Attach click listeners via delegation ───────────────── */
  function init() {
    // Escuchar clics en el header del calendario.
    // Los emojis de clima tienen clase .day-weather o similar,
    // y su columna padre (.day-col) tiene data-date="YYYY-MM-DD".
    // Usamos un selector amplio para capturar distintas implementaciones.
    document.getElementById('calendar-header').addEventListener('click', e => {
      const weatherEl = e.target.closest('[class*="weather"], .day-weather-badge, .weather-icon, .day-temp');
      if (!weatherEl) return;

      // Buscar la fecha en el atributo data-date del col padre o del propio elemento
      const col = weatherEl.closest('[data-date]');
      const dateStr = col?.dataset?.date || weatherEl.dataset?.date;
      if (!dateStr) return;

      e.stopPropagation();

      // Construir etiqueta legible: "Lunes 6 de Abril"
      const [y, m, d] = dateStr.split('-').map(Number);
      const fecha = new Date(y, m - 1, d);
      const label = fecha.toLocaleDateString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long'
      });

      open(dateStr, label.charAt(0).toUpperCase() + label.slice(1));
    });
  }

  return { init, open, close };
})();
