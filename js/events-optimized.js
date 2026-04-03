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

  const RECENT_IMG_KEY  = 'agenda2026_recent_images';
  const RECENT_IMG_MAX  = 8;

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
      _selectedColor = dot.dataset.color;
      setActiveDot(_selectedColor); // sincroniza ambas paletas
    });
  }

  function setActiveDot(color) {
    // Paleta del tab Color
    if ($palette) {
      $palette.querySelectorAll('.color-dot').forEach(d => {
        d.classList.toggle('active', d.dataset.color === color);
      });
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
      <div class="img-search-row">
        <input type="text" id="img-search-input"
               placeholder="Buscar en web: montañas, ciudad, flores…"
               autocomplete="off">
        <button type="button" class="img-search-btn" id="img-search-btn">🔍</button>
      </div>
      <div class="img-category-pills" id="img-category-pills">
        ${IMG_CATEGORIES.map(c =>
          `<button type="button" class="img-pill" data-q="${c.q}">${c.label}</button>`
        ).join('')}
      </div>
      <div class="img-grid-wrap">
        <div class="img-grid" id="img-grid">
          <div class="img-hint">✨ Elige una categoría o escribe tu búsqueda</div>
        </div>
      </div>
      <div class="img-frame-row" id="img-frame-row">
        <span class="img-frame-label">Marco</span>
        <div class="img-frame-palette" id="img-frame-palette" role="group" aria-label="Color de marco">
          ${frameDotsHTML}
        </div>
      </div>
      <div class="img-selected-bar" id="img-selected-bar" style="display:none">
        <span>🖼️ Imagen seleccionada como fondo</span>
        <button type="button" class="img-clear-btn" id="img-clear-btn">✕ Quitar</button>
      </div>
    `;

    // Frame color palette listener — sincroniza con _selectedColor
    container.querySelector('#img-frame-palette').addEventListener('click', e => {
      const dot = e.target.closest('.color-dot');
      if (!dot) return;
      _selectedColor = dot.dataset.color;
      setActiveDot(_selectedColor); // sincroniza ambas paletas
    });

    // Renderizar imágenes locales de img/
    renderLocalImages(container);

    // Botón "Elegir carpeta" (File System Access API + fallback)
    container.querySelector('#img-pick-folder-btn').addEventListener('click', pickLocalFolder);

    // Fallback webkitdirectory (navegadores sin File System Access API)
    container.querySelector('#img-folder-input').addEventListener('change', _handleFolderInputChange);

    // File input — subir imagen suelta del equipo
    container.querySelector('#img-file-input').addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (!file || !file.type.startsWith('image/')) return;

      const reader = new FileReader();
      reader.onload = ev => {
        const dataUrl = ev.target.result;
        selectUploadedImageByDataUrl(dataUrl, file.name);
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });

    // Mostrar recientes al abrir
    renderRecentImages();

    // Category pills
    container.querySelectorAll('.img-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        container.querySelectorAll('.img-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        _currentQuery = pill.dataset.q;
        _imgSeed = Date.now();
        loadImages(_currentQuery);
      });
    });

    // Search
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

    // Clear button
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

    addToRecentImages(urlLocal, urlLocal);  // Ambos parámetros son la URL
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

    _imgConvertPromise = (async () => {
      try {
        const compressed  = await compressImage(dataUrl);
        _selectedImageUrl = compressed;
        if (barSpan) barSpan.textContent = '🖼️ Imagen seleccionada como fondo';

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

        // Comprimir antes de guardar (evita QuotaExceededError)
        const compressed  = await compressImage(rawDataUrl);
        _selectedImageUrl = compressed;
        if (barSpan) barSpan.textContent = '🖼️ Imagen seleccionada como fondo';

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

  /* ── Clear selected image ───────────────────────────────── */

  function clearImage() {
    _selectedImageUrl = null;
    _selectedThumbUrl = null;
    _isLocalImage     = false;
    _imgConvertPromise = null;

    document.querySelectorAll('.img-thumb').forEach(t => t.classList.remove('selected'));

    const bar = document.getElementById('img-selected-bar');
    if (bar) bar.style.display = 'none';
  }

  /* ── Switch tab (Color / Imagen) ───────────────────────── */

  function switchBgTab(tab) {
    const colorPanel = document.getElementById('bg-panel-color');
    const imgPanel   = document.getElementById('bg-panel-imagen');
    const tabs       = document.querySelectorAll('.bg-tab');

    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));

    if (tab === 'color') {
      colorPanel.classList.remove('hidden');
      imgPanel.classList.add('hidden');
    } else {
      colorPanel.classList.add('hidden');
      imgPanel.classList.remove('hidden');
    }
  }

  /* ── Modal: open/close ──────────────────────────────────– */

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

    renderLocalImages();  // Refresh grid
    renderRecentImages();  // Refresh recientes

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
    const event = {
      id:        _currentEvent ? _currentEvent.id : generateId(),
      dateKey:   _currentEvent ? _currentEvent.dateKey : _pendingDate,
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
      event.originalDate = _currentEvent
        ? (_currentEvent.originalDate || _currentEvent.dateKey)
        : _pendingDate;
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

  /* ── Delete ─────────────────────────────────────────────── */

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

    document.addEventListener('click', hideContextMenu);
  }

  function showContextMenu(event, x, y) {
    if (!$ctxMenu) return;

    const deleteBtn = `<button class="ctx-item ctx-delete" id="ctx-delete-btn">🗑️ Eliminar</button>`;
    const editBtn   = `<button class="ctx-item ctx-edit" id="ctx-edit-btn">✏️ Editar</button>`;

    $ctxMenu.innerHTML = `${editBtn}${deleteBtn}`;
    $ctxMenu.style.left = `${x}px`;
    $ctxMenu.style.top  = `${y}px`;
    $ctxMenu.hidden     = false;
    _ctxEvent           = event;

    document.getElementById('ctx-edit-btn').addEventListener('click', () => {
      openModal(_ctxEvent.dateKey, null, _ctxEvent);
      hideContextMenu();
    });

    document.getElementById('ctx-delete-btn').addEventListener('click', () => {
      if (confirm(`¿Eliminar "${_ctxEvent.title}"?`)) {
        State.deleteEvent(_ctxEvent.dateKey, _ctxEvent.id);
        window.CalApp.renderAndBind();
      }
      hideContextMenu();
    });
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

    const dateKey = evtEl.dataset.dateKey;
    const eventId = evtEl.dataset.eventId;

    let found = (State.events[dateKey] || []).find(ev => ev.id === eventId);

    if (!found) {
      const weekDays = State.getWeekDays();
      const expanded = expandRecurringEventsForRange(weekDays[0], weekDays[6], State.recurringEvents);
      const expFound = expanded.find(ev => ev.id === eventId && ev.dateKey === dateKey);
      if (expFound && expFound.originalEventId) {
        const orig = State.recurringEvents.find(ev => ev.id === expFound.originalEventId);
        if (orig) found = { ...orig, dateKey };
      }
    }

    if (found) showContextMenu(found, e.clientX, e.clientY);
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

    // Crear dropdown y anclarlo al wrapper del input título
    const titleGroup = $inputTitle.closest('.field-group');
    titleGroup.style.position = 'relative';

    $presetDropdown = document.createElement('div');
    $presetDropdown.id        = 'preset-dropdown';
    $presetDropdown.className = 'preset-dropdown';
    $presetDropdown.hidden    = true;
    titleGroup.appendChild($presetDropdown);

    // Mostrar al hacer focus en el título
    $inputTitle.addEventListener('focus', () => showPresetDropdown(''));

    // Filtrar mientras se escribe, y auto-aplicar si hay match exacto
    $inputTitle.addEventListener('input', () => {
      const q = $inputTitle.value;
      showPresetDropdown(q);
      // Auto-aplicar si el título coincide exactamente con una plantilla
      const match = loadPresets().find(
        p => p.label.toLowerCase() === q.toLowerCase()
      );
      if (match) applyPreset(match, /* fillTitle */ false);
    });

    // Ocultar al perder foco (delay para permitir click en ítem)
    $inputTitle.addEventListener('blur', () =>
      setTimeout(() => { if ($presetDropdown) $presetDropdown.hidden = true; }, 160)
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

    // Seleccionar plantilla
    $presetDropdown.querySelectorAll('.preset-dd-item').forEach(item => {
      item.addEventListener('mousedown', e => {
        e.preventDefault(); // evitar que blur cierre el dropdown antes del click
        const preset = presets.find(p => p.id === item.dataset.id);
        if (!preset) return;
        applyPreset(preset, /* fillTitle */ true);
        $presetDropdown.hidden = true;
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

    /* ── Transformar el grupo de color en: tabs + color panel + imagen panel ── */
    const originalColorGroup = document.getElementById('color-palette').closest('.field-group');
    const bgGroup = document.createElement('div');
    bgGroup.className = 'field-group';
    bgGroup.id = 'bg-group';
    bgGroup.innerHTML = `
      <div class="bg-field-header">
        <label>Fondo</label>
        <div class="bg-tabs" id="bg-tabs">
          <button type="button" class="bg-tab active" data-tab="color">🎨 Color</button>
          <button type="button" class="bg-tab"        data-tab="imagen">🖼️ Imagen</button>
        </div>
      </div>
      <div id="bg-panel-color" class="bg-panel">
        <div class="color-palette" id="color-palette"
             role="group" aria-label="Seleccionar color"></div>
      </div>
      <div id="bg-panel-imagen" class="bg-panel hidden"></div>
    `;

    originalColorGroup.replaceWith(bgGroup);

    // Re-set palette reference (DOM was replaced)
    $palette       = document.getElementById('color-palette');
    $bgPanelColor  = document.getElementById('bg-panel-color');
    $bgPanelImagen = document.getElementById('bg-panel-imagen');

    buildColorPalette();
    buildImagePicker($bgPanelImagen);

    // Tab switcher
    document.getElementById('bg-tabs').addEventListener('click', e => {
      const tab = e.target.closest('.bg-tab');
      if (!tab) return;
      switchBgTab(tab.dataset.tab);
    });

    /* ── Toggle de importancia ── */
    if (!document.getElementById('important-group')) {
      const colorBgGroup   = document.getElementById('bg-group');
      const importantGroup = document.createElement('div');
      importantGroup.id        = 'important-group';
      importantGroup.className = 'field-group';
      importantGroup.innerHTML = `
        <label>Prioridad</label>
        <button type="button" id="btn-important-toggle"
                class="btn-important-toggle" aria-pressed="false">
          <span class="toggle-star">☆</span>
          <span class="toggle-label">Marcar como importante</span>
        </button>
      `;
      colorBgGroup.insertAdjacentElement('afterend', importantGroup);
    }
    $btnImportant = document.getElementById('btn-important-toggle');
    $btnImportant.addEventListener('click', () => setImportant(!_isImportant));

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