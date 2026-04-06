/**
 * weather-modal.js — v3
 * 1. Modal de clima horario al hacer clic en el emoji del día
 * 2. Efectos visuales animados en los encabezados de cada columna:
 *    ☀️ sol, ⛅ parcialmente nublado, ☁️ nublado, 🌫️ niebla,
 *    🌧️ lluvia leve / intensa, ❄️ nieve, ⛈️ tormenta con rayos
 */
window.CalApp = window.CalApp || {};

window.CalApp.WeatherModal = (function () {

  /* ══════════════════════════════════════════════
     WMO CODES
     ══════════════════════════════════════════════ */
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

  /* ══════════════════════════════════════════════
     GEOLOCATION
     ══════════════════════════════════════════════ */
  let _coordsCache = null;

  function getCoords() {
    if (_coordsCache) return Promise.resolve(_coordsCache);
    return new Promise(resolve => {
      if (!navigator.geolocation) {
        resolve({ latitude: -32.9468, longitude: -60.6393 });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => {
          _coordsCache = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          resolve(_coordsCache);
        },
        () => resolve({ latitude: -32.9468, longitude: -60.6393 })
      );
    });
  }

  /* ══════════════════════════════════════════════
     FETCH
     ══════════════════════════════════════════════ */
  async function fetchHourly(dateStr) {
    const coords = await getCoords();
    const url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude='  + coords.latitude
      + '&longitude=' + coords.longitude
      + '&hourly=temperature_2m,precipitation_probability,relativehumidity_2m,weathercode'
      + '&timezone=auto'
      + '&start_date=' + dateStr + '&end_date=' + dateStr;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Open-Meteo error ' + res.status);
    return res.json();
  }

  async function fetchDailyCodes(startDate, endDate) {
    const coords = await getCoords();
    const url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude='  + coords.latitude
      + '&longitude=' + coords.longitude
      + '&daily=weathercode'
      + '&timezone=auto'
      + '&start_date=' + startDate + '&end_date=' + endDate;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Open-Meteo daily error ' + res.status);
    const data = await res.json();
    const map = {};
    data.daily.time.forEach(function(d, i) { map[d] = data.daily.weathercode[i]; });
    return map;
  }

  /* ══════════════════════════════════════════════
     MODAL DOM
     ══════════════════════════════════════════════ */
  let $backdrop = null;

  function ensureModal() {
    if (document.getElementById('wm-backdrop')) return;

    const style = document.createElement('style');
    style.textContent = [
      '.day-weather { cursor:pointer; overflow:visible !important; }',
      '#wm-backdrop {',
      '  position:fixed; inset:0; z-index:9000;',
      '  background:rgba(0,0,0,.45);',
      '  display:flex; align-items:center; justify-content:center; padding:1rem;',
      '}',
      '#wm-backdrop[hidden] { display:none; }',
      '#wm-modal {',
      '  background:var(--clr-surface,#fff); color:var(--clr-text,#1a1a2e);',
      '  border-radius:var(--radius-lg,16px); box-shadow:0 24px 60px rgba(0,0,0,.35);',
      '  width:min(480px,100%); max-height:82vh;',
      '  display:flex; flex-direction:column; overflow:hidden;',
      '  font-family:var(--font-body,"DM Sans",sans-serif);',
      '}',
      '#wm-header {',
      '  display:flex; align-items:center; justify-content:space-between;',
      '  padding:1rem 1.25rem .75rem;',
      '  border-bottom:1px solid var(--clr-border,#e5e7eb); flex-shrink:0;',
      '}',
      '#wm-title  { font-size:1rem; font-weight:600; margin:0; line-height:1.3; }',
      '#wm-subtitle { font-size:.75rem; opacity:.6; margin:0; }',
      '#wm-close {',
      '  background:none; border:none; cursor:pointer; font-size:1.25rem; line-height:1;',
      '  color:var(--clr-text,#1a1a2e); padding:.25rem .4rem; border-radius:6px;',
      '  transition:background .15s;',
      '}',
      '#wm-close:hover { background:var(--clr-bg,#f3f4f6); }',
      '#wm-body { overflow-y:auto; flex:1; padding:.5rem .75rem .75rem; }',
      '.wm-loading { text-align:center; padding:2.5rem 1rem; opacity:.55; font-size:.9rem; }',
      '.wm-error   { text-align:center; padding:2rem 1rem; color:#ef4444; font-size:.85rem; }',
      '.wm-row {',
      '  display:grid; grid-template-columns:3rem 2rem 1fr 1fr 1fr;',
      '  align-items:center; gap:.25rem .5rem; padding:.45rem .5rem;',
      '  border-radius:8px; font-size:.82rem; transition:background .12s;',
      '}',
      '.wm-row:hover { background:var(--clr-bg,#f9fafb); }',
      '.wm-row + .wm-row { border-top:1px solid var(--clr-border,#e5e7eb); }',
      '.wm-hour { font-weight:600; font-size:.8rem; color:var(--clr-accent,#4f46e5); white-space:nowrap; }',
      '.wm-emoji { font-size:1.2rem; text-align:center; }',
      '.wm-label { font-size:.75rem; opacity:.7; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
      '.wm-stat  { text-align:center; display:flex; flex-direction:column; align-items:center; gap:1px; }',
      '.wm-stat-val { font-weight:600; font-size:.85rem; }',
      '.wm-stat-key { font-size:.65rem; opacity:.5; text-transform:uppercase; letter-spacing:.03em; }',
      '.wm-col-heads {',
      '  display:grid; grid-template-columns:3rem 2rem 1fr 1fr 1fr;',
      '  gap:.25rem .5rem; padding:.3rem .5rem .2rem;',
      '  font-size:.65rem; text-transform:uppercase; letter-spacing:.05em;',
      '  opacity:.45; font-weight:600;',
      '  border-bottom:1px solid var(--clr-border,#e5e7eb); margin-bottom:.15rem;',
      '}',
    ].join('\n');
    document.head.appendChild(style);

    const backdrop = document.createElement('div');
    backdrop.id = 'wm-backdrop';
    backdrop.hidden = true;
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.innerHTML = [
      '<div id="wm-modal" role="dialog" aria-modal="true" aria-labelledby="wm-title">',
      '  <div id="wm-header">',
      '    <div><p id="wm-title">Clima del día</p><p id="wm-subtitle"></p></div>',
      '    <button id="wm-close" aria-label="Cerrar">\u00d7</button>',
      '  </div>',
      '  <div id="wm-body"><div class="wm-loading">Cargando clima\u2026</div></div>',
      '</div>',
    ].join('');
    document.body.appendChild(backdrop);
    $backdrop = backdrop;

    backdrop.addEventListener('click', function(e) { if (e.target === backdrop) closeModal(); });
    document.getElementById('wm-close').addEventListener('click', closeModal);
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && !$backdrop.hidden) closeModal(); });
  }

  function closeModal() {
    if ($backdrop) { $backdrop.hidden = true; $backdrop.setAttribute('aria-hidden', 'true'); }
  }

  function renderRows(data) {
    var h = data.hourly;
    var html = '<div class="wm-col-heads">'
      + '<span>Hora</span><span></span><span>Estado</span>'
      + '<span style="text-align:center">Temp</span>'
      + '<span style="text-align:center">Lluvia / Hum.</span>'
      + '</div>';
    h.time.forEach(function(t, i) {
      var hour   = t.slice(11, 16);
      var info   = wmoInfo(h.weathercode[i]);
      var precip = h.precipitation_probability[i] != null ? h.precipitation_probability[i] + '%' : '—';
      var hum    = h.relativehumidity_2m[i]        != null ? h.relativehumidity_2m[i] + '%'        : '—';
      var temp   = h.temperature_2m[i]             != null ? Math.round(h.temperature_2m[i]) + '°'  : '—';
      var color  = h.temperature_2m[i] > 30 ? '#ef4444'
                 : h.temperature_2m[i] > 22 ? '#f97316'
                 : h.temperature_2m[i] > 15 ? '#10b981'
                 : '#3b82f6';
      html += '<div class="wm-row">'
        + '<span class="wm-hour">' + hour + '</span>'
        + '<span class="wm-emoji" title="' + info.label + '">' + info.emoji + '</span>'
        + '<span class="wm-label" title="' + info.label + '">' + info.label + '</span>'
        + '<div class="wm-stat"><span class="wm-stat-val" style="color:' + color + '">' + temp + '</span>'
        + '<span class="wm-stat-key">Temp</span></div>'
        + '<div class="wm-stat"><span class="wm-stat-val">\uD83C\uDF27 ' + precip + ' \u00b7 \uD83D\uDCA7' + hum + '</span>'
        + '<span class="wm-stat-key">Precip \u00b7 Hum.</span></div>'
        + '</div>';
    });
    return html;
  }

  async function openModal(dateStr, label) {
    ensureModal();
    $backdrop.hidden = false;
    $backdrop.setAttribute('aria-hidden', 'false');
    document.getElementById('wm-title').textContent    = 'Clima — ' + label;
    document.getElementById('wm-subtitle').textContent = 'Actualizado con Open-Meteo';
    document.getElementById('wm-body').innerHTML       = '<div class="wm-loading">⏳ Cargando datos horarios…</div>';
    try {
      var data = await fetchHourly(dateStr);
      document.getElementById('wm-body').innerHTML = renderRows(data);
    } catch (err) {
      console.error('[WeatherModal]', err);
      document.getElementById('wm-body').innerHTML =
        '<div class="wm-error">No se pudo cargar el clima.<br><small>' + err.message + '</small></div>';
    }
  }

  /* ══════════════════════════════════════════════
     WEATHER EFFECTS ON DAY HEADERS
     ══════════════════════════════════════════════ */

  function effectCategory(code) {
    if (code <= 1)                                                          return 'sunny';
    if (code === 2)                                                         return 'partly-cloudy';
    if (code === 3)                                                         return 'overcast';
    if (code === 45 || code === 48)                                         return 'fog';
    if (code >= 95)                                                         return 'storm';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86)          return 'snow';
    if (code >= 63 || code === 55 || code === 81 || code === 82)           return 'rain-heavy';
    if (code >= 51)                                                         return 'rain-light';
    return 'overcast';
  }

  /* ── Shared canvas particle loop ── */
  var _canvasEntries = new Set();
  var _rafId         = null;

  function _startRaf() {
    if (!_rafId) _rafId = requestAnimationFrame(_tick);
  }

  function _tick() {
    var stale = [];
    _canvasEntries.forEach(function(entry) {
      if (!document.body.contains(entry.canvas)) { stale.push(entry); return; }
      _drawFrame(entry);
    });
    stale.forEach(function(e) { _canvasEntries.delete(e); });
    _rafId = _canvasEntries.size > 0 ? requestAnimationFrame(_tick) : null;
  }

  function _drawFrame(entry) {
    var canvas    = entry.canvas;
    var ctx       = entry.ctx;
    var particles = entry.particles;
    var type      = entry.type;
    var W = canvas.clientWidth  || canvas.width;
    var H = canvas.clientHeight || canvas.height;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    ctx.clearRect(0, 0, W, H);

    particles.forEach(function(p) {
      if (type === 'rain' || type === 'storm') {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.wx, p.y + p.len);
        ctx.strokeStyle = 'rgba(' + p.r + ',' + p.g + ',' + p.b + ',' + p.a + ')';
        ctx.lineWidth   = p.w;
        ctx.stroke();
        p.y += p.vy; p.x += p.vx;
        if (p.y > H + p.len) { p.y = -p.len - Math.random() * H * .4; p.x = Math.random() * (W + 20) - 10; }
        if (p.x < -20) p.x = W + 10;
        if (p.x > W + 20) p.x = -10;
      } else if (type === 'snow') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(220,235,255,' + p.a + ')';
        ctx.fill();
        p.y     += p.vy;
        p.x     += Math.sin(p.phase) * .35;
        p.phase += p.phaseSpeed;
        if (p.y > H + p.r) { p.y = -p.r; p.x = Math.random() * W; }
      }
    });
  }

  function _makeRainParticles(W, H, heavy, night) {
    var n = heavy ? 55 : 28;
    var result = [];
    for (var i = 0; i < n; i++) {
      /* Night rain: longer streaks, higher opacity (more visible on dark bg) */
      var baseLen  = heavy ? 16 + Math.random() * 14 : 10 + Math.random() * 10;
      var baseA    = night
        ? (heavy ? .45 + Math.random() * .35 : .32 + Math.random() * .28)
        : (heavy ? .28 + Math.random() * .24 : .18 + Math.random() * .20);
      result.push({
        x: Math.random() * W, y: Math.random() * H,
        len: baseLen,
        wx:  heavy ? -3.5 : -2.0,          /* endpoint x-offset (angle) */
        vy:  heavy ? 4 + Math.random() * 3.5 : 2.5 + Math.random() * 2,   /* slower → longer visible streaks */
        vx:  heavy ? -1.6 : -0.9,
        w:   heavy ? 1.5 : 1.0,
        r: night ? 170 : 140,
        g: night ? 210 : 185,
        b: 255,
        a: baseA,
      });
    }
    return result;
  }

  function _makeSnowParticles(W, H) {
    var result = [];
    for (var i = 0; i < 24; i++) {
      result.push({
        x: Math.random() * W, y: Math.random() * H,
        r: 1.5 + Math.random() * 2,
        vy: .5 + Math.random() * 1,
        a:  .4 + Math.random() * .45,
        phase:      Math.random() * Math.PI * 2,
        phaseSpeed: .018 + Math.random() * .018,
      });
    }
    return result;
  }

  function _attachCanvas(layer, type, heavy) {
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    layer.appendChild(canvas);
    canvas.width  = layer.offsetWidth  || 120;
    canvas.height = layer.offsetHeight || 60;
    var ctx       = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var night = !!(layer.dataset && layer.dataset.night === '1');
    var particles = type === 'snow' ? _makeSnowParticles(W, H) : _makeRainParticles(W, H, heavy, night);
    _canvasEntries.add({ canvas: canvas, ctx: ctx, particles: particles, type: type });
    _startRaf();
  }

  /* ── Helper: build one 3D cloud group HTML ── */
  function _cloudGroupHTML(ct, cl, scale, dur, delay, grey) {
    var g = grey ? 1 : 0;
    return '<div class="wfx-cg' + (g ? ' wfx-cg-grey' : '') + '" style="'
      + '--ct:' + ct + ';--cl:' + cl + ';--cs:' + scale + ';'
      + '--cd:' + dur + ';--cdl:' + delay + '">'
      + '<div class="wfx-p wfx-pb"></div>'
      + '<div class="wfx-p wfx-pl"></div>'
      + '<div class="wfx-p wfx-pt"></div>'
      + '<div class="wfx-p wfx-pr"></div>'
      + '</div>';
  }

  function _cssFx(layer, cat) {
    if (cat === 'sunny') {
      layer.innerHTML = [
        '<div class="wfx-sunny-tint"></div>',
        '<div class="wfx-sun-spikes"></div>',
        '<div class="wfx-sun-ring"></div>',
        '<div class="wfx-sun-disc"></div>',
      ].join('');

    } else if (cat === 'partly-cloudy') {
      layer.innerHTML = [
        '<div class="wfx-sky-base" style="--sba:rgba(160,205,255,.28);--sbb:rgba(120,178,235,.12)"></div>',
        /* small sun peeking behind clouds */
        '<div class="wfx-sun-spikes wfx-sun-small"></div>',
        '<div class="wfx-sun-ring wfx-sun-small"></div>',
        '<div class="wfx-sun-disc wfx-sun-small"></div>',
        /* 3D clouds */
        _cloudGroupHTML('8%',  '4%',  1.0, '15s', '0s',   false),
        _cloudGroupHTML('50%', '42%', 0.72,'20s', '-7s',  false),
        _cloudGroupHTML('72%', '18%', 0.55,'25s', '-13s', false),
      ].join('');

    } else if (cat === 'overcast') {
      layer.innerHTML = [
        '<div class="wfx-sky-base" style="--sba:rgba(80,95,115,.42);--sbb:rgba(58,70,88,.26)"></div>',
        _cloudGroupHTML('2%',  '-5%', 1.35,'18s', '0s',   true),
        _cloudGroupHTML('35%', '28%', 1.10,'22s', '-6s',  true),
        _cloudGroupHTML('58%', '55%', 0.90,'28s', '-12s', true),
        _cloudGroupHTML('75%', '10%', 0.75,'20s', '-16s', true),
      ].join('');

    } else if (cat === 'fog') {
      layer.innerHTML = [
        '<div class="wfx-fog-base"></div>',
        '<div class="wfx-fog" style="--ft:10%;--fo:.60;--fd:7s;--fdl:0s"></div>',
        '<div class="wfx-fog" style="--ft:32%;--fo:.52;--fd:9s;--fdl:-2.5s"></div>',
        '<div class="wfx-fog" style="--ft:55%;--fo:.44;--fd:12s;--fdl:-5s"></div>',
        '<div class="wfx-fog" style="--ft:76%;--fo:.38;--fd:15s;--fdl:-8s"></div>',
      ].join('');
    }
  }

  function _buildOverlay(cat, headerEl) {
    headerEl.querySelectorAll('.wfx-layer').forEach(function(el) { el.remove(); });
    var layer = document.createElement('div');
    layer.className = 'wfx-layer wfx-' + cat;
    headerEl.insertBefore(layer, headerEl.firstChild);

    if (cat === 'rain-light') {
      _attachCanvas(layer, 'rain', false);
    } else if (cat === 'rain-heavy') {
      layer.classList.add('wfx-sky-rain');
      _attachCanvas(layer, 'rain', true);
    } else if (cat === 'storm') {
      layer.classList.add('wfx-sky-storm');
      _attachCanvas(layer, 'storm', true);
      var flash = document.createElement('div');
      flash.className = 'wfx-lightning';
      flash.style.setProperty('--wfx-ld', (Math.random() * 3).toFixed(1) + 's');
      layer.appendChild(flash);
    } else if (cat === 'snow') {
      layer.classList.add('wfx-sky-snow');
      _attachCanvas(layer, 'snow', false);
    } else {
      _cssFx(layer, cat);
    }
  }

  function _injectEffectStyles() {
    if (document.getElementById('wfx-styles')) return;
    var s = document.createElement('style');
    s.id = 'wfx-styles';
    s.textContent = `
      /* ── Base ── */
      .cal-day-header { position: relative !important; overflow: hidden; }
      .cal-day-header > *:not(.wfx-layer) { position: relative; z-index: 1; }
      .wfx-layer {
        position: absolute; inset: 0;
        pointer-events: none; z-index: 0;
        border-radius: inherit; overflow: hidden;
      }

      /* ══════════════════════════════════════════════
         ☀️  SUN — visible disc + ring + spikes
         ══════════════════════════════════════════════ */
      .wfx-sun-disc {
        position: absolute;
        width: 30px; height: 30px;
        top: 9px; right: 14px;
        border-radius: 50%;
        background: radial-gradient(circle at 35% 32%,
          #fffbcc 0%, #ffe033 38%, #ff9c00 80%, #e07000 100%);
        box-shadow:
          inset -3px -3px 7px rgba(180,80,0,.40),
          inset 2px  2px 5px rgba(255,255,210,.85),
          0 0 0 2.5px rgba(255,200,0,.80),
          0 0 0 5px   rgba(255,180,0,.30),
          0 0 20px 6px rgba(255,200,0,.55),
          0 0 42px 12px rgba(255,150,0,.25);
        animation: wfx-sun-pulse 4s ease-in-out infinite;
        z-index: 2;
      }
      .wfx-sun-ring {
        position: absolute;
        width: 46px; height: 46px;
        top: 1px; right: 6px;
        border-radius: 50%;
        border: 2px solid rgba(255,220,0,.55);
        box-shadow:
          0 0 8px  3px rgba(255,200,0,.45),
          inset 0 0 8px 3px rgba(255,200,0,.20);
        animation: wfx-ring-pulse 4s ease-in-out infinite;
        z-index: 1;
      }
      .wfx-sun-spikes {
        position: absolute;
        width: 64px; height: 64px;
        top: -8px; right: -2px;
        animation: wfx-spin 20s linear infinite;
        background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cg fill='%23FFD000' opacity='.75'%3E%3Cpolygon points='50,2 53,22 47,22'/%3E%3Cpolygon points='50,98 53,78 47,78'/%3E%3Cpolygon points='2,50 22,53 22,47'/%3E%3Cpolygon points='98,50 78,53 78,47'/%3E%3Cpolygon points='15,15 30,28 24,34'/%3E%3Cpolygon points='85,15 72,28 76,34'/%3E%3Cpolygon points='15,85 30,72 24,66'/%3E%3Cpolygon points='85,85 70,72 76,66'/%3E%3C/g%3E%3C/svg%3E") center/contain no-repeat;
        z-index: 0;
        filter: drop-shadow(0 0 4px rgba(255,200,0,.60));
      }
      /* Smaller sun for partly-cloudy (partially hidden behind clouds) */
      .wfx-sun-small.wfx-sun-disc  { width:22px; height:22px; top:11px; right:16px; opacity:.85; }
      .wfx-sun-small.wfx-sun-ring  { width:34px; height:34px; top: 5px; right:10px; opacity:.75; }
      .wfx-sun-small.wfx-sun-spikes{ width:48px; height:48px; top:-4px; right: 2px; opacity:.70; }

      .wfx-sunny-tint {
        position: absolute; inset: 0;
        background: linear-gradient(135deg,
          rgba(255,230,60,.20) 0%,
          rgba(255,190,0,.09) 55%,
          transparent 100%);
        animation: wfx-sunny-tint-pulse 5s ease-in-out infinite;
      }
      .wfx-sky-base {
        position: absolute; inset: 0;
        background: linear-gradient(180deg, var(--sba) 0%, var(--sbb) 100%);
      }

      @keyframes wfx-sun-pulse {
        0%,100% { transform: scale(1);    box-shadow: inset -3px -3px 7px rgba(180,80,0,.40), inset 2px 2px 5px rgba(255,255,210,.85), 0 0 0 2.5px rgba(255,200,0,.80), 0 0 0 5px rgba(255,180,0,.30), 0 0 20px 6px rgba(255,200,0,.55), 0 0 42px 12px rgba(255,150,0,.25); }
        50%      { transform: scale(1.06); box-shadow: inset -3px -3px 7px rgba(180,80,0,.40), inset 2px 2px 5px rgba(255,255,210,.85), 0 0 0 2.5px rgba(255,200,0,.90), 0 0 0 7px rgba(255,180,0,.22), 0 0 28px 9px rgba(255,200,0,.65), 0 0 55px 16px rgba(255,150,0,.30); }
      }
      @keyframes wfx-ring-pulse {
        0%,100% { transform: scale(1);    opacity: 1;   }
        50%      { transform: scale(1.10); opacity: .70; }
      }
      @keyframes wfx-sunny-tint-pulse {
        0%,100% { opacity: 1;   }
        50%      { opacity: .60; }
      }
      @keyframes wfx-spin { to { transform: rotate(360deg); } }

      /* ══════════════════════════════════════════════
         ☁️  3D CLOUD GROUPS
         Each .wfx-cg contains 4 puffs (.wfx-p) that
         overlap to form a fluffy volumetric cloud.
         ══════════════════════════════════════════════ */
      .wfx-cg {
        position: absolute;
        top:  var(--ct, 10%);
        left: var(--cl, 5%);
        transform: scale(var(--cs, 1));
        transform-origin: left top;
        animation: wfx-cloud-drift var(--cd, 16s) ease-in-out infinite;
        animation-delay: var(--cdl, 0s);
      }
      @keyframes wfx-cloud-drift {
        0%,100% { transform: scale(var(--cs,1)) translateX(0px); }
        50%      { transform: scale(var(--cs,1)) translateX(12px); }
      }

      /* Individual puff — white 3D sphere */
      .wfx-p {
        position: absolute;
        border-radius: 50%;
        background: radial-gradient(circle at 38% 32%,
          #ffffff 0%, #eef4ff 42%, #cddcf0 78%, #b8cce4 100%);
        box-shadow:
          inset -4px -5px 10px rgba(120,160,210,.50),
          inset  3px  3px  7px rgba(255,255,255,.92),
          0 2px 8px  rgba(80,120,180,.30),
          0 0 0 1px  rgba(180,205,235,.70);
      }
      /* Grey variant for overcast */
      .wfx-cg-grey .wfx-p {
        background: radial-gradient(circle at 38% 32%,
          #e8edf5 0%, #cdd5e2 42%, #aab4c8 78%, #8f9db5 100%);
        box-shadow:
          inset -4px -5px 10px rgba(60,75,105,.45),
          inset  3px  3px  7px rgba(240,242,248,.80),
          0 2px 8px  rgba(40,55,90,.25),
          0 0 0 1px  rgba(130,148,180,.65);
      }

      /* Puff positions — base body */
      .wfx-pb { width:52px; height:36px; top:14px; left:10px; border-radius:40%; }
      /* Left puff */
      .wfx-pl { width:30px; height:30px; top:18px; left:6px;  }
      /* Top-center puff (tallest) */
      .wfx-pt { width:36px; height:36px; top:4px;  left:24px; }
      /* Right puff */
      .wfx-pr { width:28px; height:28px; top:16px; left:46px; }

      /* ══════════════════════════════════════════════
         🌫️  FOG
         ══════════════════════════════════════════════ */
      .wfx-fog-base {
        position: absolute; inset: 0;
        background: rgba(190,208,228,.15);
      }
      .wfx-fog {
        position: absolute;
        top: var(--ft, 30%); left: -15%; right: -15%;
        height: 20px;
        background: linear-gradient(90deg,
          transparent 0%,
          rgba(200,218,238,.95) 18%,
          rgba(215,228,245,.98) 50%,
          rgba(200,218,238,.95) 82%,
          transparent 100%);
        border-top:    1px solid rgba(230,240,252,.60);
        border-bottom: 1px solid rgba(175,195,220,.40);
        filter: blur(5px);
        opacity: var(--fo, .48);
        animation: wfx-fog-drift var(--fd, 9s) ease-in-out infinite;
        animation-delay: var(--fdl, 0s);
      }
      @keyframes wfx-fog-drift {
        0%,100% { transform: translateX(0%);  }
        50%      { transform: translateX(10%); }
      }

      /* ══════════════════════════════════════════════
         🌧️ / ⛈️ / ❄️  precipitation sky tints
         ══════════════════════════════════════════════ */
      .wfx-sky-rain::before, .wfx-sky-storm::before, .wfx-sky-snow::before {
        content: ''; position: absolute; inset: 0;
      }
      .wfx-sky-rain::before  { background: linear-gradient(180deg,rgba(50,75,115,.24) 0%,rgba(38,58,92,.15) 100%); }
      .wfx-sky-storm::before { background: linear-gradient(180deg,rgba(20,26,52,.38) 0%,rgba(14,18,42,.24) 100%); }
      .wfx-sky-snow::before  { background: linear-gradient(180deg,rgba(200,215,238,.22) 0%,rgba(185,205,228,.12) 100%); }

      /* ══════════════════════════════════════════════
         ⚡  LIGHTNING
         ══════════════════════════════════════════════ */
      .wfx-lightning {
        position: absolute; inset: 0;
        background: rgba(175,200,255,.62);
        opacity: 0;
        animation: wfx-flash 3.8s ease-in-out infinite;
        animation-delay: var(--wfx-ld, 0s);
      }
      @keyframes wfx-flash {
        0%,80%,100% { opacity: 0;   }
        81%          { opacity: .82; }
        82%          { opacity: 0;   }
        83%          { opacity: .50; }
        84%          { opacity: 0;   }
      }

      /* ── Emoji hover ── */
      .day-weather { cursor:pointer; overflow:visible !important; }
      .day-weather-icon, [class*="weather-icon"] {
        display:inline-block; cursor:pointer;
        transition: transform .18s cubic-bezier(.34,1.56,.64,1), filter .18s ease;
        transform-origin:center; will-change:transform; position:relative; z-index:2;
      }
      .day-weather-icon:hover, [class*="weather-icon"]:hover,
      .day-weather:hover .day-weather-icon {
        transform:scale(1.4); filter:drop-shadow(0 2px 5px rgba(0,0,0,.3)); z-index:20;
      }
    `;
    document.head.appendChild(s);
  }

  /* ── Fetch daily codes and apply effects ── */
  var _debounceTimer = null;

  async function _applyHeaderEffects() {
    _injectEffectStyles();
    var calHeader = document.getElementById('calendar-header');
    if (!calHeader) return;

    var cols = Array.from(calHeader.querySelectorAll('[data-date-key], [data-date]'));
    if (!cols.length) return;

    var datesSet = {};
    cols.forEach(function(c) {
      var d = c.dataset.dateKey || c.dataset.date;
      if (d) datesSet[d] = true;
    });
    var dates = Object.keys(datesSet).sort();
    if (!dates.length) return;

    var codemap;
    try {
      codemap = await fetchDailyCodes(dates[0], dates[dates.length - 1]);
    } catch (e) {
      console.warn('[WeatherEffects] forecast fetch failed:', e.message);
      return;
    }

    cols.forEach(function(col) {
      var dateStr = col.dataset.dateKey || col.dataset.date;
      if (!dateStr || codemap[dateStr] == null) return;
      _buildOverlay(effectCategory(codemap[dateStr]), col);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     TODAY COLUMN — Sky atmosphere (hour × weather)
     ══════════════════════════════════════════════════════════════ */

  function _todayStr() {
    var d = new Date();
    return d.getFullYear() + '-'
      + String(d.getMonth() + 1).padStart(2, '0') + '-'
      + String(d.getDate()).padStart(2, '0');
  }

  /* Sky gradient per hour for Argentina April (sunrise ~7h, sunset ~19h) */
  function _baseSky(h) {
    if (h <  5) return { t:'#03030e', b:'#07071a', stars:true,  phase:'night'   };
    if (h <  6) return { t:'#0c0720', b:'#1a0c38', stars:true,  phase:'predawn' };
    if (h <  7) return { t:'#220d52', b:'#c04420', stars:false, phase:'dawn'    };
    if (h <  8) return { t:'#e06018', b:'#ffb840', stars:false, phase:'sunrise' };
    if (h <  9) return { t:'#42a0d8', b:'#b8deff', stars:false, phase:'morning' };
    if (h < 13) return { t:'#2882c8', b:'#78c2f8', stars:false, phase:'day'     };
    if (h < 16) return { t:'#3488c0', b:'#88c8f0', stars:false, phase:'day'     };
    if (h < 18) return { t:'#4090b8', b:'#a0c8e0', stars:false, phase:'afternoon'};
    if (h < 19) return { t:'#d86020', b:'#ffa840', stars:false, phase:'golden'  };
    if (h < 20) return { t:'#a82c18', b:'#5a1845', stars:false, phase:'sunset'  };
    if (h < 21) return { t:'#180a38', b:'#241248', stars:true,  phase:'dusk'    };
    return             { t:'#03030e', b:'#07071a', stars:true,  phase:'night'   };
  }

  /* Combined sky + weather → { grad, stars, phase, overlay } */
  function _skyForHourCat(h, cat) {
    var sky = _baseSky(h);
    var night = sky.stars;

    if (cat === 'storm') {
      return { grad:'linear-gradient(180deg,#050c08 0%,#0c160e 60%,#101408 100%)',
               stars:false, phase:'storm', overlay:'storm' };
    }
    if (cat === 'rain-heavy') {
      return { grad: night
        ? 'linear-gradient(180deg,#07091a 0%,#0e1228 100%)'
        : 'linear-gradient(180deg,#2e4458 0%,#3e5868 100%)',
               stars:false, phase:sky.phase, overlay:'rain-heavy' };
    }
    if (cat === 'rain-light') {
      return { grad: night
        ? 'linear-gradient(180deg,#0a0c20 0%,#121828 100%)'
        : 'linear-gradient(180deg,#486078 0%,#607888 100%)',
               stars:false, phase:sky.phase, overlay:'rain-light' };
    }
    if (cat === 'overcast') {
      return { grad: night
        ? 'linear-gradient(180deg,#111420 0%,#181c28 100%)'
        : 'linear-gradient(180deg,#5c6878 0%,#788494 100%)',
               stars:false, phase:sky.phase, overlay:'overcast' };
    }
    if (cat === 'snow') {
      return { grad: night
        ? 'linear-gradient(180deg,#131828 0%,#1c2238 100%)'
        : 'linear-gradient(180deg,#849ab0 0%,#a8bece 100%)',
               stars:false, phase:sky.phase, overlay:'snow' };
    }
    if (cat === 'fog') {
      return { grad:'linear-gradient(180deg,#8898a8 0%,#aab8c4 100%)',
               stars:false, phase:sky.phase, overlay:'fog' };
    }
    /* partly-cloudy / sunny / clear */
    return { grad:'linear-gradient(180deg,' + sky.t + ' 0%,' + sky.b + ' 100%)',
             stars:sky.stars, phase:sky.phase, overlay:cat };
  }

  function _injectColStyles() {
    if (document.getElementById('wfx-col-styles')) return;
    var s = document.createElement('style');
    s.id = 'wfx-col-styles';
    s.textContent = `
      /* Column wrap */
      .wfx-col-wrap { position: relative !important; overflow: hidden; }
      /* Suppress ::before solid fill so wfx-day-bg sky shows through */
      .wfx-col-wrap::before { background: transparent !important; border-color: transparent !important; }

      /* Sky background */
      .wfx-day-bg {
        position: absolute; inset: 0; z-index: 1;
        pointer-events: none; overflow: hidden;
        transition: background 3s ease;
      }

      /* ── Stars ── */
      .wfx-star {
        position: absolute; border-radius: 50%; background: #fff;
        animation: wfxs-twinkle var(--wst,3s) ease-in-out infinite;
        animation-delay: var(--wsd,0s);
        opacity: var(--wso,.7);
      }
      @keyframes wfxs-twinkle {
        0%,100% { opacity: var(--wso,.7); transform:scale(1);   }
        50%      { opacity: .15;           transform:scale(.55); }
      }

      /* ── Moon ── */
      .wfx-moon {
        position: absolute; top: 14px; right: 22px;
        width: 22px; height: 22px; border-radius: 50%;
        background: radial-gradient(circle at 36% 33%,#fffce0 0%,#f2e080 55%,#d4b848 100%);
        box-shadow:
          inset -3px -2px 6px rgba(130,100,0,.40),
          inset  2px  2px 4px rgba(255,255,220,.85),
          0 0 0 1.5px rgba(240,220,70,.55),
          0 0 14px 4px rgba(220,195,50,.38);
        animation: wfxs-moon 7s ease-in-out infinite;
      }
      @keyframes wfxs-moon {
        0%,100% { box-shadow: inset -3px -2px 6px rgba(130,100,0,.40), inset 2px 2px 4px rgba(255,255,220,.85), 0 0 0 1.5px rgba(240,220,70,.55), 0 0 14px 4px rgba(220,195,50,.38); }
        50%      { box-shadow: inset -3px -2px 6px rgba(130,100,0,.40), inset 2px 2px 4px rgba(255,255,220,.85), 0 0 0 1.5px rgba(240,220,70,.75), 0 0 26px 8px rgba(220,195,50,.55); }
      }

      /* ── Horizon (dawn / dusk / sunset) ── */
      .wfx-horizon {
        position: absolute; bottom: 0; left: 0; right: 0; height: 30%;
        pointer-events: none;
      }

      /* ── CSS Rain (light) ── */
      .wfx-day-rain {
        position: absolute; inset: 0; pointer-events: none;
        background-image: repeating-linear-gradient(
          170deg,
          transparent 0px 3px,
          rgba(160,200,255,.22) 3px 4px,
          transparent 4px 20px
        );
        background-size: 18px 55px;
        animation: wfxs-rain .38s linear infinite;
      }
      @keyframes wfxs-rain { to { background-position: -5px 55px; } }

      /* ── CSS Rain (heavy) ── */
      .wfx-day-rain-hv {
        position: absolute; inset: 0; pointer-events: none;
        background-image:
          repeating-linear-gradient(168deg,transparent 0px 2px,rgba(140,185,255,.32) 2px 3.5px,transparent 3.5px 12px),
          repeating-linear-gradient(172deg,transparent 0px 3px,rgba(160,200,255,.18) 3px 4.5px,transparent 4.5px 18px);
        background-size: 13px 38px, 22px 55px;
        animation: wfxs-rain-hv .22s linear infinite;
      }
      @keyframes wfxs-rain-hv { to { background-position: -4px 38px, -7px 55px; } }

      /* ── CSS Snow ── */
      .wfx-day-snow {
        position: absolute; inset: 0; pointer-events: none;
        background-image:
          radial-gradient(circle, rgba(255,255,255,.70) 1.5px, transparent 1.5px),
          radial-gradient(circle, rgba(255,255,255,.45) 1px,   transparent 1px);
        background-size: 24px 24px, 18px 18px;
        background-position: 0 0, 9px 9px;
        animation: wfxs-snow 5s linear infinite;
      }
      @keyframes wfxs-snow { to { background-position: 6px 24px, 15px 33px; } }

      /* ── Lightning (re-use existing .wfx-lightning keyframes) ── */
      .wfx-day-lightning {
        position: absolute; inset: 0; pointer-events: none;
        background: rgba(175,200,255,.58); opacity: 0;
        animation: wfx-flash 3.8s ease-in-out infinite;
        animation-delay: var(--wfx-ld,0s);
      }

      /* ── CSS fog bands in column ── */
      .wfx-day-fog-band {
        position: absolute; left: -12%; right: -12%; height: 22px;
        top: var(--ft,30%);
        background: linear-gradient(90deg,transparent 0%,rgba(200,218,238,.88) 20%,rgba(215,228,245,.92) 50%,rgba(200,218,238,.88) 80%,transparent 100%);
        filter: blur(6px); opacity: var(--fo,.48);
        animation: wfx-fog-drift var(--fd,9s) ease-in-out infinite;
        animation-delay: var(--fdl,0s);
      }

      /* ── Small sun / sun-peek for daytime in column ── */
      .wfx-day-sun {
        position: absolute; top: 16px; right: 20px; z-index: 1;
      }
      .wfx-day-sun .wfx-sun-disc  { position:relative; top:0; right:0; width:24px; height:24px; }
      .wfx-day-sun .wfx-sun-ring  { position:relative; top:-30px; right:-11px; width:36px; height:36px; }
      .wfx-day-sun .wfx-sun-spikes{ position:relative; top:-86px; right:-2px;  width:58px; height:58px; }

      /* ── Overcast sky overlay ── */
      .wfx-day-overcast-tint {
        position: absolute; inset: 0; pointer-events: none;
        background: rgba(60,70,85,.22);
      }

      /* ── Column cloud groups (smaller, spread vertically) ── */
      .wfx-col-clouds {
        position: absolute; inset: 0; overflow: hidden; pointer-events: none;
      }
    `;
    document.head.appendChild(s);
  }

  function _addStars(container, n) {
    for (var i = 0; i < n; i++) {
      var el = document.createElement('div');
      var sz = .7 + Math.random() * 1.6;
      el.className = 'wfx-star';
      el.style.cssText = 'width:' + sz + 'px;height:' + sz + 'px;'
        + 'top:'  + (Math.random() * 82) + '%;'
        + 'left:' + (Math.random() * 88) + '%;'
        + '--wso:' + (.35 + Math.random() * .6) + ';'
        + '--wst:' + (2 + Math.random() * 4).toFixed(1) + 's;'
        + '--wsd:' + (-Math.random() * 5).toFixed(1) + 's;';
      container.appendChild(el);
    }
  }

  function _colCloudHTML(top, left, scale, dur, delay, grey) {
    return '<div class="wfx-cg' + (grey ? ' wfx-cg-grey' : '') + '" style="'
      + '--ct:' + top  + ';--cl:' + left + ';--cs:' + scale + ';'
      + '--cd:'  + dur + ';--cdl:' + delay + '">'
      + '<div class="wfx-p wfx-pb"></div>'
      + '<div class="wfx-p wfx-pl"></div>'
      + '<div class="wfx-p wfx-pt"></div>'
      + '<div class="wfx-p wfx-pr"></div>'
      + '</div>';
  }

  async function _applyTodayColumnEffect() {
    _injectColStyles();

    var today   = _todayStr();
    var hour    = new Date().getHours();
    var calBody = document.getElementById('calendar-body');
    if (!calBody) return;

    /* Find today's column — try common data-attribute patterns */
    var col = calBody.querySelector(
      '[data-date="' + today + '"], [data-date-key="' + today + '"]'
    );
    if (!col) return;

    /* Clear previous effect */
    var prev = col.querySelector('.wfx-day-bg');
    if (prev) prev.remove();
    col.classList.add('wfx-col-wrap');

    /* Fetch current hour weathercode */
    var code = 0;
    try {
      var hData = await fetchHourly(today);
      var idx = hData.hourly.time.findIndex(function(t) {
        return parseInt(t.slice(11, 13), 10) === hour;
      });
      if (idx >= 0 && hData.hourly.weathercode[idx] != null) {
        code = hData.hourly.weathercode[idx];
      }
    } catch (err) {
      console.warn('[WeatherCol]', err);
    }

    var cat = effectCategory(code);
    var sky = _skyForHourCat(hour, cat);

    /* ── Background div ── */
    var bg = document.createElement('div');
    bg.className = 'wfx-day-bg';
    bg.style.background = sky.grad;

    /* Aplicar border-radius explícito — "inherit" falla porque el radio está en ::before */
    var colStyle = window.getComputedStyle(col);
    var br = colStyle.borderRadius;
    if (!br || br === '0px') {
      var refHeader = document.querySelector('[data-date="' + today + '"].cal-day-header, .cal-day-header[data-date="' + today + '"]');
      if (refHeader) br = window.getComputedStyle(refHeader).borderRadius;
    }
    if (br && br !== '0px') bg.style.borderRadius = br;
    if (sky.stars) bg.dataset.night = '1';   /* flag for canvas rain opacity */
    col.insertBefore(bg, col.firstChild);

    /* ── Stars + Moon (night / dusk) ── */
    if (sky.stars) {
      _addStars(bg, 30);
      if (cat !== 'storm' && cat !== 'rain-heavy' && cat !== 'rain-light') {
        var moon = document.createElement('div');
        moon.className = 'wfx-moon';
        bg.appendChild(moon);
      }
    }

    /* ── Horizon glow (dawn, sunrise, golden hour, sunset, dusk) ── */
    var p = sky.phase;
    if (p === 'dawn' || p === 'sunrise' || p === 'golden' || p === 'sunset' || p === 'dusk') {
      var hz = document.createElement('div');
      hz.className = 'wfx-horizon';
      var warm = p === 'dawn' || p === 'sunrise' || p === 'golden';
      hz.style.background = warm
        ? 'linear-gradient(0deg,rgba(255,130,25,.55) 0%,rgba(255,90,15,.22) 45%,transparent 100%)'
        : 'linear-gradient(0deg,rgba(200,45,15,.58) 0%,rgba(140,30,55,.28) 48%,transparent 100%)';
      bg.appendChild(hz);
    }

    /* ── Daytime sun disc (sunny / partly-cloudy) ── */
    if (!sky.stars && (cat === 'sunny' || cat === 'partly-cloudy') && p !== 'sunset' && p !== 'golden') {
      var sunWrap = document.createElement('div');
      sunWrap.className = 'wfx-day-sun';
      sunWrap.innerHTML = [
        '<div class="wfx-sun-spikes"></div>',
        '<div class="wfx-sun-ring"></div>',
        '<div class="wfx-sun-disc"></div>',
      ].join('');
      bg.appendChild(sunWrap);
    }

    /* ── Weather overlays ── */
    var ov = sky.overlay;

    if (ov === 'rain-light') {
      /* Use canvas particles — CSS gradient tiles look like TV static */
      _attachCanvas(bg, 'rain', false);
    }
    if (ov === 'rain-heavy') {
      _attachCanvas(bg, 'rain', true);
    }
    if (ov === 'storm') {
      _attachCanvas(bg, 'storm', true);
      var fl = document.createElement('div');
      fl.className = 'wfx-day-lightning';
      fl.style.setProperty('--wfx-ld', (Math.random() * 2).toFixed(1) + 's');
      bg.appendChild(fl);
    }
    if (ov === 'snow') {
      var sn = document.createElement('div'); sn.className = 'wfx-day-snow'; bg.appendChild(sn);
    }
    if (ov === 'fog') {
      ['10%','30%','52%','72%','90%'].forEach(function(ft, i) {
        var fb = document.createElement('div'); fb.className = 'wfx-day-fog-band';
        fb.style.cssText = '--ft:' + ft + ';--fo:' + (.55 - i*.06) + ';--fd:' + (6+i*2) + 's;--fdl:-' + (i*1.8) + 's;';
        bg.appendChild(fb);
      });
    }
    if (ov === 'overcast') {
      var ot = document.createElement('div'); ot.className = 'wfx-day-overcast-tint'; bg.appendChild(ot);
    }

    /* ── 3D cloud groups in column ── */
    if (ov === 'partly-cloudy' || ov === 'overcast') {
      var cc = document.createElement('div'); cc.className = 'wfx-col-clouds'; bg.appendChild(cc);
      var grey = ov === 'overcast';
      /* Spread clouds vertically across the full column */
      cc.innerHTML = [
        _colCloudHTML('2%',  '5%',  1.15, '18s', '0s',    grey),
        _colCloudHTML('14%', '48%', 0.85, '22s', '-6s',   grey),
        _colCloudHTML('26%', '15%', 0.70, '26s', '-12s',  grey),
        _colCloudHTML('40%', '55%', 0.95, '20s', '-4s',   grey),
        _colCloudHTML('54%', '8%',  0.80, '24s', '-9s',   grey),
        _colCloudHTML('66%', '42%', 0.65, '28s', '-15s',  grey),
        _colCloudHTML('78%', '22%', 0.90, '19s', '-7s',   grey),
      ].join('');
    }
  }

  function _observeCalendar() {
    var calHeader = document.getElementById('calendar-header');
    var calBody   = document.getElementById('calendar-body');

    var onHeaderChange = function() {
      clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(function() {
        _applyHeaderEffects();
        _applyTodayColumnEffect();
      }, 300);
    };

    if (calHeader) new MutationObserver(onHeaderChange).observe(calHeader, { childList: true });
    if (calBody)   new MutationObserver(onHeaderChange).observe(calBody,   { childList: true });
  }

  /* ══════════════════════════════════════════════
     INIT
     ══════════════════════════════════════════════ */
  function init() {
    var calHeader = document.getElementById('calendar-header');
    if (!calHeader) return;

    /* Open modal on weather emoji click */
    calHeader.addEventListener('click', function(e) {
      var weatherEl = e.target.closest(
        '.day-weather, .day-weather-icon, [class*="weather-icon"], [class*="weather-badge"], .day-temp'
      );
      if (!weatherEl) return;
      var col     = weatherEl.closest('[data-date], [data-date-key]');
      var dateStr = col && (col.dataset.date || col.dataset.dateKey);
      if (!dateStr) return;
      e.stopPropagation();
      e.preventDefault();
      var parts = dateStr.split('-').map(Number);
      var label = new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long'
      });
      openModal(dateStr, label.charAt(0).toUpperCase() + label.slice(1));
    }, true);

    /* Apply weather effects to headers, then watch for week changes */
    _applyHeaderEffects();
    _applyTodayColumnEffect();
    _observeCalendar();
  }

  return { init: init, open: openModal, close: closeModal };
})();