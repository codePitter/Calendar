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
      '.day-weather-icon, [class*="weather-icon"] {',
      '  display:inline-block; cursor:pointer;',
      '  transition: transform .18s cubic-bezier(.34,1.56,.64,1), filter .18s ease;',
      '  transform-origin:center center; will-change:transform;',
      '  position:relative; z-index:2;',
      '}',
      '.day-weather-icon:hover, [class*="weather-icon"]:hover,',
      '.day-weather:hover .day-weather-icon {',
      '  transform:scale(1.4); filter:drop-shadow(0 2px 5px rgba(0,0,0,.3)); z-index:20;',
      '}',
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

  function _makeRainParticles(W, H, heavy) {
    var n = heavy ? 38 : 16;
    var result = [];
    for (var i = 0; i < n; i++) {
      result.push({
        x: Math.random() * W, y: Math.random() * H,
        len: heavy ? 10 + Math.random() * 8 : 6 + Math.random() * 6,
        wx:  heavy ? -2.5 : -1.5,
        vy:  heavy ? 6 + Math.random() * 5 : 3.5 + Math.random() * 3,
        vx:  heavy ? -1.2 : -.7,
        w:   heavy ? 1.3 : .9,
        r: 140, g: 185, b: 255,
        a: .22 + Math.random() * .28,
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
    var particles = type === 'snow' ? _makeSnowParticles(W, H) : _makeRainParticles(W, H, heavy);
    _canvasEntries.add({ canvas: canvas, ctx: ctx, particles: particles, type: type });
    _startRaf();
  }

  function _cssFx(layer, cat) {
    if (cat === 'sunny') {
      layer.innerHTML = '<div class="wfx-sun-glow"></div><div class="wfx-sun-rays"></div>';
    } else if (cat === 'partly-cloudy') {
      layer.innerHTML = [
        '<div class="wfx-sky-base" style="--sba:rgba(170,205,255,.15);--sbb:rgba(130,175,230,.07)"></div>',
        '<div class="wfx-cloud" style="--cw:52px;--ch:20px;--ct:18%;--cl:8%;--cd:11s;--co:.13;--cdl:0s"></div>',
        '<div class="wfx-cloud" style="--cw:36px;--ch:14px;--ct:60%;--cl:52%;--cd:15s;--co:.09;--cdl:-5s"></div>',
      ].join('');
    } else if (cat === 'overcast') {
      layer.innerHTML = [
        '<div class="wfx-sky-base" style="--sba:rgba(120,135,155,.20);--sbb:rgba(90,105,120,.12)"></div>',
        '<div class="wfx-cloud" style="--cw:68px;--ch:24px;--ct:8%;--cl:0%;--cd:17s;--co:.17;--cdl:0s"></div>',
        '<div class="wfx-cloud" style="--cw:48px;--ch:18px;--ct:42%;--cl:35%;--cd:13s;--co:.13;--cdl:-5s"></div>',
        '<div class="wfx-cloud" style="--cw:38px;--ch:15px;--ct:68%;--cl:65%;--cd:19s;--co:.11;--cdl:-9s"></div>',
      ].join('');
    } else if (cat === 'fog') {
      layer.innerHTML = [
        '<div class="wfx-fog" style="--ft:18%;--fo:.28;--fd:7s;--fdl:0s"></div>',
        '<div class="wfx-fog" style="--ft:48%;--fo:.20;--fd:9s;--fdl:-3s"></div>',
        '<div class="wfx-fog" style="--ft:74%;--fo:.16;--fd:12s;--fdl:-7s"></div>',
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
      /* Header position so overlay anchors correctly */
      .cal-day-header { position: relative !important; }

      /* All header children float above the overlay */
      .cal-day-header > *:not(.wfx-layer) { position: relative; z-index: 1; }

      /* Overlay: clip-path self-clips without touching parent overflow,
         so the emoji scale animation still escapes normally */
      .wfx-layer {
        position: absolute; inset: 0;
        pointer-events: none; z-index: 0;
        clip-path: inset(0);
        border-radius: inherit;
      }

      /* ── Sunny ── */
      .wfx-sun-glow {
        position: absolute; inset: 0;
        background: radial-gradient(ellipse at 72% 18%,
          rgba(255,215,60,.34) 0%, rgba(255,180,0,.10) 45%, transparent 68%);
        animation: wfx-sun-pulse 4s ease-in-out infinite;
      }
      .wfx-sun-rays {
        position: absolute; width: 58px; height: 58px;
        top: -20px; right: -10px; opacity: .20;
        animation: wfx-spin 28s linear infinite;
        background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cg fill='%23FFD700'%3E%3Cellipse cx='50' cy='7' rx='4' ry='13'/%3E%3Cellipse cx='50' cy='93' rx='4' ry='13'/%3E%3Cellipse cx='7' cy='50' rx='13' ry='4'/%3E%3Cellipse cx='93' cy='50' rx='13' ry='4'/%3E%3Cellipse cx='22' cy='22' rx='4' ry='13' transform='rotate(45 22 22)'/%3E%3Cellipse cx='78' cy='22' rx='4' ry='13' transform='rotate(-45 78 22)'/%3E%3Cellipse cx='22' cy='78' rx='4' ry='13' transform='rotate(-45 22 78)'/%3E%3Cellipse cx='78' cy='78' rx='4' ry='13' transform='rotate(45 78 78)'/%3E%3C/g%3E%3C/svg%3E") center/contain no-repeat;
      }
      @keyframes wfx-sun-pulse { 0%,100% { opacity:1; } 50% { opacity:.6; } }
      @keyframes wfx-spin { to { transform: rotate(360deg); } }

      /* ── Sky base ── */
      .wfx-sky-base {
        position: absolute; inset: 0;
        background: linear-gradient(180deg, var(--sba) 0%, var(--sbb) 100%);
      }

      /* ── Clouds ── */
      .wfx-cloud {
        position: absolute;
        width: var(--cw,50px); height: var(--ch,20px);
        top: var(--ct,20%);    left: var(--cl,10%);
        opacity: var(--co,.12);
        animation: wfx-cloud-drift var(--cd,12s) ease-in-out infinite;
        animation-delay: var(--cdl,0s);
        background: radial-gradient(ellipse at 50% 65%,
          rgba(255,255,255,.92) 0%, rgba(210,222,235,.55) 60%, transparent 100%);
        border-radius: 50%;
        filter: blur(4px);
      }
      @keyframes wfx-cloud-drift {
        0%,100% { transform: translateX(0); }
        50%      { transform: translateX(10px); }
      }

      /* ── Fog ── */
      .wfx-fog {
        position: absolute;
        top: var(--ft,30%); left: -12%; right: -12%;
        height: 14px;
        background: rgba(200,215,228,.88);
        filter: blur(7px);
        opacity: var(--fo,.3);
        animation: wfx-fog-drift var(--fd,8s) ease-in-out infinite;
        animation-delay: var(--fdl,0s);
      }
      @keyframes wfx-fog-drift {
        0%,100% { transform: translateX(0%); }
        50%      { transform: translateX(9%); }
      }

      /* ── Sky tints for precipitation ── */
      .wfx-sky-rain::before, .wfx-sky-storm::before, .wfx-sky-snow::before {
        content: ''; position: absolute; inset: 0;
      }
      .wfx-sky-rain::before  { background: linear-gradient(180deg,rgba(55,80,115,.18) 0%,rgba(40,60,95,.10) 100%); }
      .wfx-sky-storm::before { background: linear-gradient(180deg,rgba(25,30,52,.30) 0%,rgba(18,22,44,.18) 100%); }
      .wfx-sky-snow::before  { background: linear-gradient(180deg,rgba(200,215,238,.18) 0%,rgba(185,205,228,.10) 100%); }

      /* ── Lightning flash ── */
      .wfx-lightning {
        position: absolute; inset: 0;
        background: rgba(175,200,255,.58);
        opacity: 0;
        animation: wfx-flash 3.8s ease-in-out infinite;
        animation-delay: var(--wfx-ld, 0s);
      }
      @keyframes wfx-flash {
        0%,80%,100% { opacity: 0; }
        81%  { opacity: .78; }
        82%  { opacity: 0;   }
        83%  { opacity: .45; }
        84%  { opacity: 0;   }
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

  function _observeCalendar() {
    var calHeader = document.getElementById('calendar-header');
    if (!calHeader) return;
    new MutationObserver(function() {
      clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(_applyHeaderEffects, 300);
    }).observe(calHeader, { childList: true });
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
    _observeCalendar();
  }

  return { init: init, open: openModal, close: closeModal };
})();