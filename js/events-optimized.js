/**
 * events.js — OPTIMIZADO para usar SOLO URLs locales
 * 
 * CAMBIOS:
 * - Imágenes locales: Se guardan SOLO como URLs (no dataURLs)
 * - Imágenes web: Se guardan como dataURLs comprimidas (necesario)
 * - Imágenes subidas: Se guardan como dataURLs comprimidas (necesario)
 */
window.CalApp = window.CalApp || {};

window.CalApp.Events = (function () {
  const { CONFIG, State } = window.CalApp;

  let _currentEvent  = null;
  let _pendingDate   = null;
  let _pendingHour   = null;
  let _selectedColor = CONFIG.COLORS[0];
  let _isImportant   = false;
  let _selectedImageUrl  = null;   // URL final (local, web, o dataURL)
  let _selectedThumbUrl  = null;   // URL del thumb
  let _imgConvertPromise = null;   // Promise pendiente de conversión
  let _isLocalImage       = false; // ← NUEVO: Flag para saber si es imagen local

  const RECENT_IMG_KEY    = 'agenda2026_recent_images';
  const RECENT_IMG_MAX    = 8;
  const RECENT_COLORS_KEY = 'agenda2026_recent_colors';
  const RECENT_COLORS_MAX = 8;

  /* ── Presets ─────────────────────────────────────────────── */

  const PRESET_STORAGE_KEY = 'agenda2026_presets';

  const DEFAULT_PRESETS = [
    { id: 'trabajo',     label: 'Trabajo',      color: '#f97316', icon: '💼' },
    { id: 'universidad', label: 'Universidad',   color: '#4f46e5', icon: '🎓' },
    { id: 'personal',    label: 'Personal',      color: '#10b981', icon: '👤' },
    { id: 'salud',       label: 'Salud',         color: '#ef4444', icon: '❤️' },
    { id: 'social',      label: 'Social',        color: '#ec4899', icon: '🎉' },
    { id: 'descanso',    label: 'Descanso',      color: '#8b5cf6', icon: '😴' },
  ];

  /* ── Context menu state ───────────────────────────────────── */

  let $ctxMenu  = null;
  let _ctxEvent = null;

  /* ── Image compression ───────────────────────────────────── */

  /**
   * Comprime una dataUrl usando Canvas.
   * @param {string} dataUrl   - imagen origen
   * @param {number} maxW      - ancho máximo en px (default 480)
   * @param {number} maxH      - alto máximo en px (default 360)
   * @param {number} quality   - calidad JPEG 0-1 (default 0.72)
   * @returns {Promise<string>} dataUrl comprimida
   */
  function compressImage(dataUrl, maxW = 900, maxH = 900, quality = 0.88) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const scale  = Math.min(1, maxW / img.width, maxH / img.height);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(dataUrl); // fallback: devolver original
      img.src = dataUrl;
    });
  }

  /**
   * Versión muy pequeña para thumbnails de recientes (≤ 120×90, jpeg 0.5)
   */
  function compressThumb(dataUrl) {
    return compressImage(dataUrl, 120, 90, 0.5);
  }

  /* ── Recent images helpers ──────────────────────────────── */

  function loadRecentImages() {
    try {
      const raw = localStorage.getItem(RECENT_IMG_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  /* ── Recent colors helpers ──────────────────────────────── */

  function loadRecentColors() {
    try {
      const raw = localStorage.getItem(RECENT_COLORS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  function saveRecentColors(colors) {
    try { localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(colors)); }
    catch { /* ignorar */ }
  }

  function addToRecentColors(hex) {
    if (!hex || hex === 'transparent') return;
    const colors = loadRecentColors().filter(c => c !== hex);
    colors.unshift(hex);
    if (colors.length > RECENT_COLORS_MAX) colors.length = RECENT_COLORS_MAX;
    saveRecentColors(colors);
    renderRecentColors();
  }

  function saveRecentImages(recents) {
    try {
      localStorage.setItem(RECENT_IMG_KEY, JSON.stringify(recents));
    } catch (e) {
      // Si aun así hay quota, intentar con menos recientes
      try {
        const fewer = recents.slice(0, 3);
        localStorage.setItem(RECENT_IMG_KEY, JSON.stringify(fewer));
      } catch { /* ignorar */ }
    }
  }

  /**
   * OPTIMIZADO: Detecta si es URL local y NO la comprime
   * Solo comprime imágenes web o subidas (dataURLs)
   */
  async function addToRecentImages(thumbUrl, dataUrl) {
    // Si es URL local (no es dataURL y no es URL web), guardarla directo
    const isLocalUrl = !dataUrl.startsWith('data:') && 
                       !dataUrl.startsWith('http://') && 
                       !dataUrl.startsWith('https://') &&
                       !dataUrl.startsWith('blob:') &&
                       !dataUrl.startsWith('/');
    
    const compressedThumb = isLocalUrl
      ? thumbUrl  // Para imágenes locales: usar la URL como está
      : dataUrl.startsWith('data:')
        ? await compressThumb(dataUrl)  // Para dataURLs: comprimir
        : dataUrl;  // Para URLs web: guardar como está

    const recents = loadRecentImages().filter(r => r.thumbUrl !== thumbUrl);
    recents.unshift({ 
      thumbUrl, 
      dataUrl: compressedThumb,
      isLocal: isLocalUrl  // ← NUEVO: Marcar si es local
    });
    if (recents.length > RECENT_IMG_MAX) recents.length = RECENT_IMG_MAX;
    saveRecentImages(recents);
    renderRecentImages();
  }

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
    // ── Fila 1: colores predefinidos + transparente + picker ──
    const fixedDotsHTML = CONFIG.COLORS.map((c, i) =>
      `<button type="button"
               class="color-dot${i === 0 ? ' active' : ''}"
               data-color="${c}"
               style="background:${c}"
               aria-label="Color ${i + 1}"></button>`
    ).join('');

    $palette.innerHTML = `
      <div class="cp-row" id="cp-row-fixed">
        ${fixedDotsHTML}
        <button type="button" class="color-dot is-transparent" data-color="transparent"
                aria-label="Transparente" title="Sin fondo (transparente)"></button>
        <label class="color-dot is-picker" title="Elige un color personalizado" aria-label="Color personalizado">
          <input type="color" id="cp-custom-input" style="opacity:0;position:absolute;width:0;height:0">
          <span>+</span>
        </label>
      </div>
      <div class="cp-recents" id="cp-recents" style="display:none">
        <span class="cp-recents-label">Recientes</span>
        <div class="cp-recents-row" id="cp-recents-row"></div>
      </div>
      <div id="important-group" class="field-group cp-important-group">
        <label>Prioridad</label>
        <button type="button" id="btn-important-toggle"
                class="btn-important-toggle" aria-pressed="false">
          <span class="toggle-star">☆</span>
          <span class="toggle-label">Marcar como importante</span>
        </button>
      </div>
    `;

    $palette.addEventListener('click', e => {
      const dot = e.target.closest('.color-dot[data-color]');
      if (!dot) return;
      _selectedColor = dot.dataset.color;
      setActiveDot(_selectedColor);
    });

    // Color picker nativo
    const cpInput = document.getElementById('cp-custom-input');
    cpInput.addEventListener('input', e => {
      _selectedColor = e.target.value;
      setActiveDot(_selectedColor);
    });
    cpInput.addEventListener('change', e => {
      _selectedColor = e.target.value;
      setActiveDot(_selectedColor);
      addToRecentColors(_selectedColor);
    });

    renderRecentColors();
  }

  function renderRecentColors() {
    const section = document.getElementById('cp-recents');
    const row     = document.getElementById('cp-recents-row');
    if (!section || !row) return;
    const colors = loadRecentColors();
    if (!colors.length) { section.style.display = 'none'; return; }
    section.style.display = 'flex';
    row.innerHTML = colors.map(c =>
      `<button type="button" class="color-dot" data-color="${c}"
               style="background:${c}" aria-label="${c}" title="${c}"></button>`
    ).join('');
  }

  function setActiveDot(color) {
    // Paleta del tab Color — marcar el dot activo
    if ($palette) {
      $palette.querySelectorAll('.color-dot[data-color]').forEach(d => {
        d.classList.toggle('active', d.dataset.color === color);
      });
      // Si es un color custom (no está en ningún dot), actualizar el input
      const cpInput = document.getElementById('cp-custom-input');
      if (cpInput && color && color !== 'transparent' && !CONFIG.COLORS.includes(color)) {
        cpInput.value = color;
        // Resaltar el botón picker como activo
        const pickerDot = $palette.querySelector('.is-picker');
        if (pickerDot) pickerDot.classList.add('active');
      }
    }
    // Paleta del tab Imagen (marco) — sincronizar siempre
    const framePalette = document.getElementById('img-frame-palette');
    if (framePalette) {
      framePalette.querySelectorAll('.color-dot').forEach(d => {
        d.classList.toggle('active', d.dataset.color === color);
      });
    }
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
    const frameDotsHTML = CONFIG.COLORS.map((c, i) =>
      `<button type="button"
               class="color-dot frame-dot${i === 0 ? ' active' : ''}"
               data-color="${c}"
               style="background:${c}"
               aria-label="Marco ${i + 1}"></button>`
    ).join('');

    container.innerHTML = `
      <div class="img-picker-layout">

        <!-- ── Columna izquierda: controles ── -->
        <div class="img-picker-left">
          <div class="img-recents-section" id="img-recents-section" style="display:none">
            <div class="img-recents-label">🕐 Recientes</div>
            <div class="img-recents-grid" id="img-recents-grid"></div>
          </div>
          <div class="img-local-section" id="img-local-section">
            <div class="img-local-header">
              <span class="img-recents-label">📁 Locales</span>
              <div class="img-local-actions">
                <span class="img-folder-name" id="img-folder-name"></span>
                <button type="button" class="img-upload-label" id="img-pick-folder-btn">
                  📂 Elegir carpeta
                </button>
                <label class="img-upload-label" title="Subir imagen suelta">
                  📤 Subir
                  <input type="file" id="img-file-input" accept="image/*" style="display:none">
                </label>
                <input type="file" id="img-folder-input" webkitdirectory multiple
                       accept="image/*" style="display:none">
              </div>
            </div>
            <div class="img-local-grid" id="img-local-grid"></div>
          </div>

          <div class="img-selected-bar" id="img-selected-bar" style="display:none">
            <span>Imagen seleccionada</span>
            <button type="button" class="img-clear-btn" id="img-clear-btn">✕ Quitar</button>
          </div>

          <div class="img-search-row">
            <input type="text" id="img-search-input"
                   placeholder="Buscar: montañas, ciudad…"
                   autocomplete="off">
            <button type="button" class="img-search-btn" id="img-search-btn">🔍</button>
          </div>
          <div class="img-category-pills" id="img-category-pills">
            ${IMG_CATEGORIES.map(c =>
              `<button type="button" class="img-pill" data-q="${c.q}">${c.label}</button>`
            ).join('')}
          </div>
          <div class="img-frame-row" id="img-frame-row">
            <span class="img-frame-label">Marco</span>
            <div class="img-frame-palette" id="img-frame-palette" role="group" aria-label="Color de marco">
              ${frameDotsHTML}
            </div>
          </div>
        </div>

        <!-- ── Columna derecha: preview + grilla de imágenes ── -->
        <div class="img-picker-right">
          <div class="img-preview-panel" id="img-preview-panel">
            <div class="img-preview-empty" id="img-preview-empty">
              <span class="img-preview-icon">✨</span>
              <span>Elegí una categoría o buscá</span>
            </div>
            <img class="img-preview-img" id="img-preview-img" alt="Vista previa">
          </div>
          <div class="img-grid-wrap">
            <div class="img-grid" id="img-grid"></div>
          </div>
        </div>

      </div>
    `;

    // Frame color palette listener — sincroniza con _selectedColor
    container.querySelector('#img-frame-palette').addEventListener('click', e => {
      const dot = e.target.closest('.color-dot');
      if (!dot) return;
      _selectedColor = dot.dataset.color;
      setActiveDot(_selectedColor);
    });

    renderLocalImages(container);

    container.querySelector('#img-pick-folder-btn').addEventListener('click', pickLocalFolder);
    container.querySelector('#img-folder-input').addEventListener('change', _handleFolderInputChange);

    container.querySelector('#img-file-input').addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = ev => selectUploadedImageByDataUrl(ev.target.result, file.name);
      reader.readAsDataURL(file);
      e.target.value = '';
    });

    renderRecentImages();

    container.querySelectorAll('.img-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        container.querySelectorAll('.img-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        _currentQuery = pill.dataset.q;
        _imgSeed = Date.now();
        loadImages(_currentQuery);
      });
    });

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

    document.getElementById('img-clear-btn').addEventListener('click', clearImage);
  }

  /* ── Local folder state ─────────────────────────────────── */

  let _folderHandle = null;   // FileSystemDirectoryHandle (File System Access API)
  let _folderImages = [];     // [{ name, objectUrl, file }]
  let _folderName   = '';

  const IMG_EXTENSIONS = /\.(jpe?g|png|gif|webp|bmp|avif|svg)$/i;

  /* ── Render local images (img/ folder) ─────────────────── */

  function renderLocalImages(container) {
    const grid = container
      ? container.querySelector('#img-local-grid')
      : document.getElementById('img-local-grid');
    if (!grid) return;

    const presets = (CONFIG.LOCAL_IMAGES || []).map(entry =>
      typeof entry === 'string' ? { src: entry, label: entry.split('/').pop() } : entry
    );

    // Si hay imágenes de carpeta elegida, mostrarlas
    if (_folderImages.length) {
      _renderFolderGrid(grid);
      return;
    }

    // Si hay presets en config, mostrarlos
    if (presets.length) {
      grid.innerHTML = presets.map(({ src, label }) => `
        <button type="button"
                class="img-thumb${_selectedThumbUrl === src ? ' selected' : ''}"
                data-url="${src}" data-local="1" title="${label || src}">
          <img src="${src}" alt="${label || ''}" loading="lazy"
               onerror="this.closest('.img-thumb').style.display='none'">
          <div class="img-thumb-check">✓</div>
        </button>`).join('');

      grid.querySelectorAll('.img-thumb[data-local]').forEach(thumb => {
        thumb.addEventListener('click', () =>
          selectLocalImage(thumb.dataset.url, thumb.title));
      });
      return;
    }

    // Estado vacío
    grid.innerHTML = `<span class="img-local-empty">
      Elegí una carpeta con 📂 o agregá rutas en <code>CONFIG.LOCAL_IMAGES</code>.
    </span>`;
  }

  function _renderFolderGrid(grid) {
    if (!grid) return;
    grid.innerHTML = _folderImages.map(({ name, objectUrl }) => `
      <button type="button"
              class="img-thumb${_selectedThumbUrl === objectUrl ? ' selected' : ''}"
              data-url="${objectUrl}" data-folder="1" title="${name}">
        <img src="${objectUrl}" alt="${name}" loading="lazy">
        <div class="img-thumb-check">✓</div>
      </button>`).join('');

    grid.querySelectorAll('.img-thumb[data-folder]').forEach(thumb => {
      const img = _folderImages.find(f => f.objectUrl === thumb.dataset.url);
      if (!img) return;
      thumb.addEventListener('click', () => selectFolderImage(img));
    });
  }

  /* ── Pick folder via File System Access API ─────────────── */

  async function pickLocalFolder() {
    try {
      _folderHandle = await window.showDirectoryPicker?.();
      if (!_folderHandle) {
        document.getElementById('img-folder-input').click();
        return;
      }

      _folderImages = [];
      _folderName = _folderHandle.name;
      document.getElementById('img-folder-name').textContent = `📂 ${_folderName}`;

      for await (const [name, handle] of _folderHandle.entries()) {
        if (handle.kind === 'file' && IMG_EXTENSIONS.test(name)) {
          const file = await handle.getFile();
          const objectUrl = URL.createObjectURL(file);
          _folderImages.push({ name, objectUrl, file });
        }
      }

      renderLocalImages();
    } catch (err) {
      if (err.name !== 'NotAllowedError') console.error('[Folder]', err);
      document.getElementById('img-folder-input').click();
    }
  }

  function _handleFolderInputChange(e) {
    const files = e.target.files;
    if (!files?.length) return;

    _folderImages = [];
    _folderName = 'Imágenes';

    for (const file of files) {
      if (IMG_EXTENSIONS.test(file.name)) {
        const objectUrl = URL.createObjectURL(file);
        _folderImages.push({ name: file.name, objectUrl, file });
      }
    }

    document.getElementById('img-folder-name').textContent = `📂 ${_folderName}`;
    renderLocalImages();
    e.target.value = '';
  }

  /* ── Select folder image (con conversión a dataURL si es necesario) ── */

  async function selectFolderImage(img) {
    _selectedThumbUrl  = img.objectUrl;
    _selectedImageUrl  = null;
    _imgConvertPromise = null;
    _isLocalImage      = false;

    document.querySelectorAll('.img-thumb').forEach(t =>
      t.classList.toggle('selected', t.dataset.url === img.objectUrl));

    const bar     = document.getElementById('img-selected-bar');
    const barSpan = bar ? bar.querySelector('span') : null;
    if (bar) bar.style.display = 'flex';
    if (barSpan) barSpan.textContent = '⏳ Preparando imagen…';
    _updateImagePreview(img.objectUrl);

    _imgConvertPromise = (async () => {
      try {
        const blob = img.file || await (await fetch(img.objectUrl)).blob();
        const rawDataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror   = reject;
          reader.readAsDataURL(blob);
        });

        const compressed  = await compressImage(rawDataUrl);
        _selectedImageUrl = compressed;
        if (barSpan) barSpan.textContent = '🖼️ Imagen seleccionada como fondo';
        _updateImagePreview(compressed);

        await addToRecentImages(compressed, compressed);

      } catch (err) {
        console.error('[Folder img]', err);
        _selectedImageUrl = img.objectUrl;
        if (barSpan) barSpan.textContent = `🖼️ ${img.name} (sesión)`;
      }
    })();

    await _imgConvertPromise;
  }

  /* ── OPTIMIZADO: Select local image (URL directo, sin conversión) ── */

  function selectLocalImage(urlLocal, label) {
    _selectedThumbUrl  = urlLocal;
    _selectedImageUrl  = urlLocal;  // ← URL local directo, SIN conversión
    _imgConvertPromise = null;
    _isLocalImage      = true;      // ← Marcar como local

    document.querySelectorAll('.img-thumb').forEach(t =>
      t.classList.toggle('selected', t.dataset.url === urlLocal));

    const bar     = document.getElementById('img-selected-bar');
    const barSpan = bar ? bar.querySelector('span') : null;
    if (bar) bar.style.display = 'flex';
    if (barSpan) barSpan.textContent = `🖼️ ${label || 'Imagen local seleccionada'}`;
    _updateImagePreview(urlLocal);

    addToRecentImages(urlLocal, urlLocal);
  }

  /* ── OPTIMIZADO: Select uploaded image (dataURL) ── */

  async function selectUploadedImageByDataUrl(dataUrl, fileName) {
    _selectedThumbUrl  = dataUrl;
    _selectedImageUrl  = null;
    _imgConvertPromise = null;
    _isLocalImage      = false;

    document.querySelectorAll('.img-thumb').forEach(t =>
      t.classList.toggle('selected', t.dataset.url === dataUrl));

    const bar     = document.getElementById('img-selected-bar');
    const barSpan = bar ? bar.querySelector('span') : null;
    if (bar) bar.style.display = 'flex';
    if (barSpan) barSpan.textContent = '⏳ Preparando imagen…';
    _updateImagePreview(dataUrl);

    _imgConvertPromise = (async () => {
      try {
        const compressed  = await compressImage(dataUrl);
        _selectedImageUrl = compressed;
        if (barSpan) barSpan.textContent = '🖼️ Imagen seleccionada como fondo';
        _updateImagePreview(compressed);

        await addToRecentImages(dataUrl, compressed);

      } catch (err) {
        console.error('[IMG Upload]', err);
        _selectedImageUrl = dataUrl;
        if (barSpan) barSpan.textContent = '⚠️ Imagen (modo directo)';
      }
    })();

    await _imgConvertPromise;
  }

  /* ── Render recent images ───────────────────────────────── */

  function renderRecentImages() {
    const section = document.getElementById('img-recents-section');
    const grid    = document.getElementById('img-recents-grid');
    if (!section || !grid) return;

    const recents = loadRecentImages();
    if (!recents.length) { section.style.display = 'none'; return; }

    section.style.display = 'block';
    grid.innerHTML = recents.map(({ thumbUrl, dataUrl, isLocal }) => `
      <button type="button"
              class="img-thumb${_selectedThumbUrl === thumbUrl ? ' selected' : ''}"
              data-url="${thumbUrl}"
              data-is-local="${isLocal ? '1' : '0'}"
              title="Imagen reciente${isLocal ? ' (local)' : ''}">
        <img src="${thumbUrl}" alt="Reciente" loading="lazy" crossorigin="anonymous"
             onerror="this.closest('.img-thumb').style.display='none'">
        <div class="img-thumb-check">✓</div>
      </button>
    `).join('');

    // Click en reciente: usar directamente (no necesita procesamiento)
    grid.querySelectorAll('.img-thumb').forEach(thumb => {
      thumb.addEventListener('click', () => {
        const recent = recents.find(r => r.thumbUrl === thumb.dataset.url);
        if (!recent) return;
        
        const isLocal = recent.isLocal === true || 
                        (!recent.dataUrl.startsWith('data:') && 
                         !recent.dataUrl.startsWith('http'));
        
        // Aplicar directamente sin procesamiento
        _selectedThumbUrl  = recent.thumbUrl;
        _selectedImageUrl  = recent.dataUrl;  // Ya procesada (URL local o dataURL)
        _imgConvertPromise = null;
        _isLocalImage      = isLocal;

        // Actualizar selección visual
        document.querySelectorAll('.img-thumb').forEach(t =>
          t.classList.toggle('selected', t.dataset.url === recent.thumbUrl));

        const bar     = document.getElementById('img-selected-bar');
        const barSpan = bar ? bar.querySelector('span') : null;
        if (bar) bar.style.display = 'flex';
        if (barSpan) barSpan.textContent = `🖼️ Imagen ${isLocal ? 'local' : 'reciente'} seleccionada`;
        _updateImagePreview(recent.dataUrl);
      });
    });
  }

  function loadImages(query) {
    const grid = document.getElementById('img-grid');
    if (!grid) return;

    grid.innerHTML = `
      <div class="img-loading">
        <div class="img-spinner"></div>
        <span>Buscando imágenes…</span>
      </div>`;

    // picsum.photos: CORS abierto, sin redirect externo, sin API key
    const safeQuery = query.trim().replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const thumbs = Array.from({ length: 8 }, (_, i) => {
      const seed = `${safeQuery}-${i}-${_imgSeed % 9999}`;
      const url  = `https://picsum.photos/seed/${seed}/600/400`;
      return { url };
    });

    grid.innerHTML = thumbs.map(({ url }) => `
      <button type="button"
              class="img-thumb${_selectedThumbUrl === url ? ' selected' : ''}"
              data-url="${url}"
              title="Seleccionar imagen">
        <img src="${url}"
             alt="Imagen"
             loading="lazy"
             crossorigin="anonymous"
             onerror="this.closest('.img-thumb').style.display='none'">
        <div class="img-thumb-check">✓</div>
      </button>
    `).join('');

    grid.querySelectorAll('.img-thumb').forEach(thumb => {
      thumb.addEventListener('click', () => selectWebImage(thumb.dataset.url));
    });
  }

  /* ── selectWebImage: async + compressed data URL ── */

  async function selectWebImage(url) {
    _selectedThumbUrl  = url;
    _selectedImageUrl  = null;
    _imgConvertPromise = null;
    _isLocalImage      = false;

    document.querySelectorAll('.img-thumb').forEach(t =>
      t.classList.toggle('selected', t.dataset.url === url));

    const bar     = document.getElementById('img-selected-bar');
    const barSpan = bar ? bar.querySelector('span') : null;
    if (bar) bar.style.display = 'flex';
    if (barSpan) barSpan.textContent = '⏳ Preparando imagen…';
    _updateImagePreview(url);

    _imgConvertPromise = (async () => {
      try {
        const response = await fetch(url, { mode: 'cors' });
        const blob     = await response.blob();
        const rawDataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror   = reject;
          reader.readAsDataURL(blob);
        });

        const compressed  = await compressImage(rawDataUrl);
        _selectedImageUrl = compressed;
        if (barSpan) barSpan.textContent = '🖼️ Imagen seleccionada como fondo';
        _updateImagePreview(compressed);

        await addToRecentImages(url, compressed);

      } catch (err) {
        console.error('[IMG] Error convirtiendo imagen:', err);
        _selectedImageUrl = url;
        if (barSpan) barSpan.textContent = '⚠️ Imagen (modo directo)';
        await addToRecentImages(url, url);
      }
    })();

    await _imgConvertPromise;
  }

  /* ── Update image preview panel (right column) ──────────── */

  function _updateImagePreview(url) {
    const img   = document.getElementById('img-preview-img');
    const empty = document.getElementById('img-preview-empty');
    if (!img) return;
    if (url) {
      img.src = url;
      img.style.display = 'block';
      if (empty) empty.style.display = 'none';
    } else {
      img.src = '';
      img.style.display = 'none';
      if (empty) empty.style.display = 'flex';
    }
  }

  /* ── Clear selected image ───────────────────────────────── */

  function clearImage() {
    _selectedImageUrl = null;
    _selectedThumbUrl = null;
    _isLocalImage     = false;
    _imgConvertPromise = null;

    document.querySelectorAll('.img-thumb').forEach(t => t.classList.remove('selected'));

    const bar = document.getElementById('img-selected-bar');
    if (bar) bar.style.display = 'none';

    _updateImagePreview(null);
  }

  /* ── Switch modal tabs (Datos / Fondo) ─────────────────── */

  function switchModalTab(tab) {
    document.querySelectorAll('.modal-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.modal-tab-panel').forEach(p =>
      p.classList.toggle('hidden', p.id !== `modal-panel-${tab}`));
  }

  /* ── Switch tab (Color / Imagen) → delega en modal tabs ─── */

  function switchBgTab(tab) {
    // Color e Imagen son ahora tabs del modal principal
    switchModalTab(tab === 'color' ? 'color' : 'imagen');
  }

  /* ── Modal: open/close ──────────────────────────────────– */

  /**
   * Cambiar entre tabs del modal (Datos / Fondo)
   */
  function switchModalTab(tabName) {
    const tabs = document.querySelectorAll('.modal-tab');
    const panels = document.querySelectorAll('.modal-tab-panel');

    tabs.forEach(t => {
      const isActive = t.dataset.tab === tabName;
      t.classList.toggle('active', isActive);
    });

    panels.forEach(p => {
      const panelName = p.id.replace('modal-panel-', '');
      const isVisible = panelName === tabName;
      p.classList.toggle('hidden', !isVisible);
    });
  }

  function openModal(dateKey, hourStart, existingEvent = null) {
    _currentEvent = existingEvent || null;
    _pendingDate  = dateKey;
    _pendingHour  = hourStart;

    _selectedColor = existingEvent?.color || CONFIG.COLORS[0];
    _selectedImageUrl = existingEvent?.imageUrl || null;
    _selectedThumbUrl = existingEvent?.imageUrl || null;
    _isLocalImage = existingEvent?.imageUrl && 
                    !existingEvent.imageUrl.startsWith('data:') &&
                    !existingEvent.imageUrl.startsWith('http');
    _isImportant  = !!existingEvent?.important;
    _imgConvertPromise = null;

    setActiveDot(_selectedColor);
    setImportant(_isImportant);

    $title.textContent = existingEvent ? 'Editar Evento' : 'Nuevo Evento';
    $inputTitle.value  = existingEvent?.title || '';
    $inputStart.value  = existingEvent?.startTime || padTime(hourStart ?? 9);
    $inputEnd.value    = existingEvent?.endTime || padTime((hourStart ?? 9) + 1);
    $inputDesc.value   = existingEvent?.desc || '';

    const recurrence = existingEvent?.recurrence || 'none';
    $recurrence.value = recurrence;
    toggleEndRecurrenceField();

    if (existingEvent?.endRecurrence) {
      $endRecurrence.value = existingEvent.endRecurrence;
    } else {
      $endRecurrence.value = '';
    }

    $btnDelete.hidden = !existingEvent;

    // Resetear al tab Datos
    switchModalTab('datos');

    // Actualizar preview lateral de imagen
    _updateImagePreview(_selectedImageUrl);

    // Actualizar barra de imagen seleccionada
    const bar = document.getElementById('img-selected-bar');
    if (_selectedImageUrl) {
      if (bar) bar.style.display = 'flex';
      const barSpan = bar ? bar.querySelector('span') : null;
      if (barSpan) {
        barSpan.textContent = _isLocalImage
          ? `🖼️ Imagen local seleccionada`
          : `🖼️ Imagen seleccionada como fondo`;
      }
    } else {
      if (bar) bar.style.display = 'none';
    }

    renderLocalImages();
    renderRecentImages();

    $backdrop.hidden = false;
    $inputTitle.focus();
  }

  function closeModal() {
    $backdrop.hidden = true;
    _currentEvent = null;
    clearImage();
  }

  /* ── Save event ────────────────────────────────────────── */

  async function saveEvent() {
    const title = $inputTitle.value.trim();
    if (!title) {
      $inputTitle.classList.add('error');
      $inputTitle.focus();
      $inputTitle.addEventListener('input', () => $inputTitle.classList.remove('error'), { once: true });
      return;
    }

    // Esperar conversión si está en curso (race condition fix)
    if (_imgConvertPromise) {
      $btnSave.disabled    = true;
      $btnSave.textContent = 'Procesando…';
      try { await _imgConvertPromise; } catch (e) {}
      $btnSave.disabled    = false;
      $btnSave.textContent = 'Guardar';
    }

    const recurrence = $recurrence.value;

    // Los eventos recurrentes en State.recurringEvents no tienen propiedad dateKey.
    // Usamos _pendingDate (el dia desde el que se abrio el modal) como fallback.
    const resolvedDateKey = _currentEvent
      ? (_currentEvent.dateKey || _pendingDate)
      : _pendingDate;

    const event = {
      id:        _currentEvent ? _currentEvent.id : generateId(),
      dateKey:   resolvedDateKey,
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
      // originalDate: usar el campo del evento original si existe,
      // luego el dateKey resuelto (nunca undefined).
      event.originalDate = _currentEvent
        ? (_currentEvent.originalDate || resolvedDateKey)
        : _pendingDate;
      if ($endRecurrence && $endRecurrence.value) {
        event.endRecurrence = $endRecurrence.value;
      }
    }

    if (_currentEvent) {
      // Detectar si el evento original ERA recurrente
      const wasRecurring = State.recurringEvents.some(e => e.id === _currentEvent.id);

      if (wasRecurring && recurrence === 'none') {
        // El usuario quito la recurrencia: eliminar de recurringEvents
        // y guardar como evento regular en el dia que se estaba editando.
        State.deleteEvent(resolvedDateKey, _currentEvent.id);
        State.addEvent(event);
      } else {
        State.updateEvent(event);
      }
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
    State.deleteEvent(_currentEvent.dateKey || _pendingDate, _currentEvent.id);
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
    if (col) {
      const dateKey = col.dataset.date;
      const y = e.clientY - col.getBoundingClientRect().top + col.scrollTop;
      const hourStart = window.CalApp.Calendar.yToHour(y);
      openModal(dateKey, hourStart);
    }
  }

/* ── Context menu ───────────────────────────────────────– */

function createContextMenu() {
  if (document.getElementById('context-menu')) return;

  $ctxMenu = document.createElement('div');
  $ctxMenu.id = 'context-menu';
  $ctxMenu.className = 'context-menu';
  $ctxMenu.hidden = true;
  document.body.appendChild($ctxMenu);

  // Cerrar al hacer click fuera
  document.addEventListener('click', (e) => {
    if (!$ctxMenu.hidden && !$ctxMenu.contains(e.target)) {
      hideContextMenu();
    }
  });
  
  // Cerrar con tecla ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$ctxMenu.hidden) {
      hideContextMenu();
    }
  });
}

function showContextMenu(eventObj, x, y) {
  if (!$ctxMenu) return;

  // Guardar el evento para usarlo después
  _ctxEvent = eventObj;

  // Escapar HTML para seguridad
  const escapeHTML = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  // Procesar URLs en la descripción
  const formatDescription = (desc) => {
    if (!desc) return '';
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return escapeHTML(desc).replace(urlRegex, (url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="ctx-link" onclick="event.stopPropagation()">${escapeHTML(url)}</a>`;
    });
  };

  const title = escapeHTML(eventObj.title);
  const desc = eventObj.desc || '';
  const startTime = eventObj.startTime;
  const endTime = eventObj.endTime;
  const isRecurring = eventObj.recurrence && eventObj.recurrence !== 'none';
  const recurrenceText = isRecurring ? ` 🔄 ${window.CalApp.CONFIG.RECURRENCE_LABELS[eventObj.recurrence] || eventObj.recurrence}` : '';
  const importantStar = eventObj.important ? '⭐ ' : '';
  
  // Color del evento para el indicador
  const eventColor = eventObj.color || '#4f46e5';

  $ctxMenu.innerHTML = `
    <div class="ctx-header">
      <div class="ctx-head">
        <div class="ctx-color-dot" style="background: ${eventColor}"></div>
        <div class="ctx-info">
          <div class="ctx-title">${importantStar}${title}${recurrenceText}</div>
          <div class="ctx-time">${startTime} – ${endTime}</div>
        </div>
        <button class="ctx-close" id="ctx-close-btn" aria-label="Cerrar">×</button>
      </div>
    </div>
    ${desc ? `<div class="ctx-desc">${formatDescription(desc)}</div>` : '<div class="ctx-no-desc">Sin descripción</div>'}
    <div class="ctx-actions">
      <button class="ctx-btn ctx-edit" id="ctx-edit-btn">✏️ Editar</button>
      <button class="ctx-btn ctx-btn-danger ctx-delete" id="ctx-delete-btn">🗑️ Eliminar</button>
    </div>
  `;

  // Posicionar el menú
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  let left = x;
  let top = y;
  
  // Ajustar si se sale por la derecha
  if (left + 320 > viewportWidth) {
    left = viewportWidth - 320 - 10;
  }
  
  // Ajustar si se sale por la izquierda
  if (left < 10) {
    left = 10;
  }
  
  // Ajustar si se sale por abajo
  if (top + 280 > viewportHeight) {
    top = viewportHeight - 280 - 10;
  }
  
  // Ajustar si se sale por arriba
  if (top < 10) {
    top = 10;
  }
  
  $ctxMenu.style.left = `${left}px`;
  $ctxMenu.style.top = `${top}px`;
  $ctxMenu.hidden = false;

  // Event listeners
  const closeBtn = document.getElementById('ctx-close-btn');
  const editBtn = document.getElementById('ctx-edit-btn');
  const deleteBtn = document.getElementById('ctx-delete-btn');
  
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      hideContextMenu();
    };
  }
  
  if (editBtn) {
    editBtn.onclick = (e) => {
      e.stopPropagation();
      if (_ctxEvent) {
        openModal(_ctxEvent.dateKey, null, _ctxEvent);
      }
      hideContextMenu();
    };
  }
  
  if (deleteBtn) {
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      if (_ctxEvent && confirm(`¿Eliminar "${_ctxEvent.title}"?`)) {
        State.deleteEvent(_ctxEvent.dateKey, _ctxEvent.id);
        window.CalApp.renderAndBind();
      }
      hideContextMenu();
    };
  }
}

function hideContextMenu() {
  if ($ctxMenu) $ctxMenu.hidden = true;
  _ctxEvent = null;
}

/* ── Context menu click on event ─────────────────────────– */

function handleContextMenu(e) {
  const evtEl = e.target.closest('.cal-event');
  if (!evtEl) return;
  e.preventDefault();
  e.stopPropagation();

  const dateKey = evtEl.dataset.dateKey;
  const eventId = evtEl.dataset.eventId;

  let found = null;
  
  // Buscar en eventos regulares
  if (State.events[dateKey]) {
    found = State.events[dateKey].find(ev => ev.id === eventId);
  }
  
  // Buscar en eventos recurrentes
  if (!found && State.recurringEvents) {
    found = State.recurringEvents.find(ev => ev.id === eventId);
    if (found) {
      // Para eventos recurrentes, añadir la fecha actual
      found = { ...found, dateKey };
    }
  }
  
  // Buscar en eventos expandidos (recurrentes de la semana actual)
  if (!found) {
    const weekDays = State.getWeekDays();
    const expanded = expandRecurringEventsForRange(weekDays[0], weekDays[6], State.recurringEvents);
    const expFound = expanded.find(ev => ev.id === eventId && ev.dateKey === dateKey);
    if (expFound && expFound.originalEventId) {
      const orig = State.recurringEvents.find(ev => ev.id === expFound.originalEventId);
      if (orig) found = { ...orig, dateKey, id: eventId };
    }
  }

  if (found) {
    if (!$ctxMenu) createContextMenu();
    showContextMenu(found, e.clientX, e.clientY);
  }
}

  /* ── Presets: Plantillas de eventos ─────────────────────── */

  function loadPresets() {
    try {
      const raw = localStorage.getItem(PRESET_STORAGE_KEY);
      const custom = raw ? JSON.parse(raw) : [];
      return [...DEFAULT_PRESETS, ...custom];
    } catch { return [...DEFAULT_PRESETS]; }
  }

  function saveCustomPreset(preset) {
    try {
      const raw = localStorage.getItem(PRESET_STORAGE_KEY);
      const custom = raw ? JSON.parse(raw) : [];
      const idx = custom.findIndex(p => p.id === preset.id);
      if (idx !== -1) custom[idx] = preset; else custom.push(preset);
      localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(custom));
    } catch (e) { console.warn('[Presets] Error guardando:', e); }
  }

  function deleteCustomPreset(id) {
    try {
      const raw = localStorage.getItem(PRESET_STORAGE_KEY);
      const custom = raw ? JSON.parse(raw) : [];
      const filtered = custom.filter(p => p.id !== id);
      localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) { console.warn('[Presets] Error eliminando:', e); }
  }

  function refreshPresetsBar() { /* no-op: replaced by dropdown */ }

  /* ── Preset dropdown (anclado al input Título) ──────────── */

  let $presetDropdown = null;

  function buildPresetDropdown() {
    if (document.getElementById('preset-dropdown')) return;

    // Anchor dropdown to the title-wrapper (position:relative set in CSS)
    const titleWrapper = $inputTitle.closest('.title-wrapper') || $inputTitle.parentElement;

    $presetDropdown = document.createElement('div');
    $presetDropdown.id        = 'preset-dropdown';
    $presetDropdown.className = 'preset-dropdown';
    $presetDropdown.hidden    = true;
    titleWrapper.appendChild($presetDropdown);

    // Chevron toggles the dropdown
    const chevron = document.getElementById('preset-chevron');
    if (chevron) {
      chevron.addEventListener('click', e => {
        e.stopPropagation();
        if ($presetDropdown.hidden) {
          showPresetDropdown($inputTitle.value);
        } else {
          $presetDropdown.hidden = true;
          chevron.classList.remove('is-open');
        }
      });
    }

    // Filter while typing (only if dropdown already open)
    $inputTitle.addEventListener('input', () => {
      const q = $inputTitle.value;
      if (!$presetDropdown.hidden) showPresetDropdown(q);
      // Auto-aplicar si el título coincide exactamente con una plantilla
      const match = loadPresets().find(
        p => p.label.toLowerCase() === q.toLowerCase()
      );
      if (match) applyPreset(match, /* fillTitle */ false);
    });

    // Ocultar al perder foco (delay para permitir click en ítem)
    $inputTitle.addEventListener('blur', () =>
      setTimeout(() => {
        if ($presetDropdown) $presetDropdown.hidden = true;
        const ch = document.getElementById('preset-chevron');
        if (ch) ch.classList.remove('is-open');
      }, 160)
    );
  }

  function showPresetDropdown(query) {
    if (!$presetDropdown) return;
    const presets = loadPresets();
    const q       = query.trim().toLowerCase();

    const customIds = new Set(
      (() => { try { return JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || '[]').map(p => p.id); } catch { return []; } })()
    );

    const filtered = q
      ? presets.filter(p => p.label.toLowerCase().includes(q))
      : presets;

    if (!filtered.length && q) {
      $presetDropdown.hidden = true;
      const ch = document.getElementById('preset-chevron');
      if (ch) ch.classList.remove('is-open');
      return;
    }

    const activeColor = _selectedColor;

    $presetDropdown.innerHTML = `
      <div class="preset-dd-list">
        ${filtered.map(p => `
          <button type="button" class="preset-dd-item${p.color === activeColor ? ' is-active' : ''}" data-id="${p.id}">
            <span class="preset-dd-dot" style="background:${p.color}"></span>
            <span class="preset-dd-icon">${p.icon || '📌'}</span>
            <span class="preset-dd-name">${escapeHTML(p.label)}</span>
            ${customIds.has(p.id)
              ? `<span class="preset-dd-del" data-del-id="${p.id}" title="Eliminar plantilla">×</span>`
              : ''}
          </button>
        `).join('')}
      </div>
      <div class="preset-dd-footer">
        <button type="button" class="preset-dd-save" id="preset-dd-save-btn">＋ Guardar como plantilla</button>
      </div>
    `;

    $presetDropdown.hidden = false;
    const _ch = document.getElementById('preset-chevron');
    if (_ch) _ch.classList.add('is-open');

    // Seleccionar plantilla
    $presetDropdown.querySelectorAll('.preset-dd-item').forEach(item => {
      item.addEventListener('mousedown', e => {
        e.preventDefault(); // evitar que blur cierre el dropdown antes del click
        const preset = presets.find(p => p.id === item.dataset.id);
        if (!preset) return;
        applyPreset(preset, /* fillTitle */ true);
        $presetDropdown.hidden = true;
        const ch = document.getElementById('preset-chevron');
        if (ch) ch.classList.remove('is-open');
        $inputTitle.focus();
      });
    });

    // Eliminar plantilla custom
    $presetDropdown.querySelectorAll('.preset-dd-del').forEach(btn => {
      btn.addEventListener('mousedown', e => {
        e.stopPropagation();
        e.preventDefault();
        const id = btn.dataset.delId;
        const preset = presets.find(p => p.id === id);
        if (preset && confirm(`¿Eliminar la plantilla "${preset.label}"?`)) {
          deleteCustomPreset(id);
          showPresetDropdown($inputTitle.value);
        }
      });
    });

    // Guardar como plantilla
    const saveBtn = document.getElementById('preset-dd-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('mousedown', e => {
        e.preventDefault();
        const suggested = $inputTitle.value.trim() || 'Nueva plantilla';
        const label = prompt('Nombre de la nueva plantilla:', suggested);
        if (!label || !label.trim()) return;
        saveCustomPreset({
          id:       `custom_${Date.now()}`,
          label:    label.trim(),
          color:    _selectedColor,
          icon:     '📌',
          imageUrl: _selectedImageUrl || null,
          thumbUrl: _selectedThumbUrl || null,
        });
        $presetDropdown.hidden = true;
        const _chv = document.getElementById('preset-chevron');
        if (_chv) _chv.classList.remove('is-open');
      });
    }
  }

  function buildPresetsBar(container) {
    // No-op: presets now live as a dropdown on the title input
    container.remove();
  }

  function applyPreset(preset, fillTitle = true) {
    _selectedColor = preset.color;
    setActiveDot(_selectedColor);

    if (preset.imageUrl) {
      _selectedImageUrl = preset.imageUrl;
      _selectedThumbUrl = preset.thumbUrl || null;
      const bar = document.getElementById('img-selected-bar');
      if (bar) { bar.style.display = 'flex'; bar.querySelector('span').textContent = '🖼️ Imagen de plantilla'; }
      switchBgTab('imagen');
    }

    if (fillTitle && !$inputTitle.value.trim()) {
      $inputTitle.value = preset.label;
    }
  }

  /* ── Helper: escapeHTML ─────────────────────────────────── */

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ── Init ───────────────────────────────────────────────– */

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

    /* ── Color palette: usar el panel del modal directamente ── */
    $palette       = document.getElementById('color-palette');
    $bgPanelImagen = document.getElementById('modal-panel-imagen');

    buildColorPalette();
    buildImagePicker($bgPanelImagen);

    /* ── Toggle de importancia (ya está en el DOM via buildImagePicker) ── */
    $btnImportant = document.getElementById('btn-important-toggle');
    $btnImportant.addEventListener('click', () => setImportant(!_isImportant));

    /* ── Modal tabs ── */
    document.getElementById('modal-tabs').addEventListener('click', e => {
      const tab = e.target.closest('.modal-tab');
      if (!tab) return;
      switchModalTab(tab.dataset.tab);
    });

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
    document.getElementById('calendar-body').addEventListener('contextmenu', handleContextMenu);

    // Crear context menu flotante
    createContextMenu();

    // Construir dropdown de plantillas anclado al input de título
    buildPresetDropdown();
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