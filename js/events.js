/**
 * events.js — Modal de eventos y operaciones CRUD.
 * Incluye buscador de imágenes estilo Giphy (vía Unsplash, sin API key).
 */
window.CalApp = window.CalApp || {};

window.CalApp.Events = (function () {
  const { CONFIG, State } = window.CalApp;

  let _currentEvent  = null;
  let _pendingDate   = null;
  let _pendingHour   = null;
  let _selectedColor = CONFIG.COLORS[0];
  let _isImportant   = false;
  let _selectedImageUrl  = null;   // data URL final
  let _selectedThumbUrl  = null;   // URL del thumb (para resaltar en grid)
  let _imgConvertPromise = null;   // Promise pendiente de conversión

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
      console.warn('[RECENTS] Error guardando recientes:', e);
    }
  }

  function addToRecentImages(thumbUrl, dataUrl) {
    const recents = loadRecentImages().filter(r => r.thumbUrl !== thumbUrl);
    recents.unshift({ thumbUrl, dataUrl });
    if (recents.length > RECENT_IMG_MAX) recents.length = RECENT_IMG_MAX;
    saveRecentImages(recents);
    renderRecentImages();  // actualizar UI inmediatamente
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
      $palette.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      _selectedColor = dot.dataset.color;
    });
  }

  function setActiveDot(color) {
    if (!$palette) return;
    $palette.querySelectorAll('.color-dot').forEach(d => {
      d.classList.toggle('active', d.dataset.color === color);
    });
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
        selectLocalImageByUrl(dataUrl, file.name, dataUrl);
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
          selectLocalImageByUrl(thumb.dataset.url, thumb.title, thumb.dataset.url));
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
    // Método moderno: File System Access API
    if ('showDirectoryPicker' in window) {
      try {
        _folderHandle = await window.showDirectoryPicker({ mode: 'read' });
        _folderName   = _folderHandle.name;
        await _loadHandleImages(_folderHandle);
      } catch (err) {
        if (err.name !== 'AbortError') console.error('[Folder]', err);
      }
    } else {
      // Fallback: input webkitdirectory
      document.getElementById('img-folder-input').click();
    }
  }

  async function _loadHandleImages(handle) {
    const grid = document.getElementById('img-local-grid');
    if (grid) grid.innerHTML = `
      <div class="img-loading" style="grid-column:1/-1">
        <div class="img-spinner"></div><span>Leyendo carpeta…</span>
      </div>`;

    // Liberar object URLs previos
    _folderImages.forEach(f => URL.revokeObjectURL(f.objectUrl));
    _folderImages = [];

    for await (const [name, entry] of handle.entries()) {
      if (entry.kind === 'file' && IMG_EXTENSIONS.test(name)) {
        const file      = await entry.getFile();
        const objectUrl = URL.createObjectURL(file);
        _folderImages.push({ name, objectUrl, file });
      }
    }

    _folderImages.sort((a, b) => a.name.localeCompare(b.name));
    _updateFolderLabel();
    if (grid) _renderFolderGrid(grid);
  }

  function _handleFolderInputChange(e) {
    const files = Array.from(e.target.files || []).filter(f => IMG_EXTENSIONS.test(f.name));
    if (!files.length) return;

    // Liberar URLs previas
    _folderImages.forEach(f => URL.revokeObjectURL(f.objectUrl));
    _folderImages = [];

    _folderName = files[0].webkitRelativePath.split('/')[0] || 'Carpeta local';
    files.sort((a, b) => a.name.localeCompare(b.name));

    _folderImages = files.map(file => ({
      name: file.name, objectUrl: URL.createObjectURL(file), file
    }));

    _updateFolderLabel();
    const grid = document.getElementById('img-local-grid');
    if (grid) _renderFolderGrid(grid);
    e.target.value = '';
  }

  function _updateFolderLabel() {
    const label = document.getElementById('img-folder-name');
    if (!label) return;
    label.textContent = _folderName
      ? `📂 ${_folderName} (${_folderImages.length} imágenes)`
      : '';
  }

  /* ── Select image from folder (async → data URL) ────────── */

  async function selectFolderImage(img) {
    _selectedThumbUrl  = img.objectUrl;
    _selectedImageUrl  = null;
    _imgConvertPromise = null;

    // Feedback inmediato
    document.querySelectorAll('.img-thumb').forEach(t =>
      t.classList.toggle('selected', t.dataset.url === img.objectUrl));

    const bar     = document.getElementById('img-selected-bar');
    const barSpan = bar?.querySelector('span');
    if (bar) bar.style.display = 'flex';
    if (barSpan) barSpan.textContent = `⏳ Preparando ${img.name}…`;

    _imgConvertPromise = (async () => {
      try {
        const dataUrl = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onloadend = () => res(reader.result);
          reader.onerror   = rej;
          reader.readAsDataURL(img.file);
        });
        _selectedImageUrl = dataUrl;
        if (barSpan) barSpan.textContent = `🖼️ ${img.name}`;
        addToRecentImages(img.objectUrl, dataUrl);
      } catch (err) {
        console.error('[Folder img]', err);
        _selectedImageUrl = img.objectUrl; // fallback: usar objectUrl (funciona en sesión)
        if (barSpan) barSpan.textContent = `🖼️ ${img.name} (sesión)`;
      }
    })();

    await _imgConvertPromise;
  }

  /* ── Select a local/uploaded image (synchronous) ────────── */

  function selectLocalImageByUrl(thumbUrl, label, imageUrl) {
    _selectedThumbUrl  = thumbUrl;
    _selectedImageUrl  = imageUrl;
    _imgConvertPromise = null;

    document.querySelectorAll('.img-thumb').forEach(t =>
      t.classList.toggle('selected', t.dataset.url === thumbUrl));

    const bar     = document.getElementById('img-selected-bar');
    const barSpan = bar?.querySelector('span');
    if (bar) bar.style.display = 'flex';
    if (barSpan) barSpan.textContent = `🖼️ ${label || 'Imagen local seleccionada'}`;

    addToRecentImages(thumbUrl, imageUrl);
  }

  /* ── Render recent images ───────────────────────────────── */

  function renderRecentImages() {
    const section = document.getElementById('img-recents-section');
    const grid    = document.getElementById('img-recents-grid');
    if (!section || !grid) return;

    const recents = loadRecentImages();
    if (!recents.length) { section.style.display = 'none'; return; }

    section.style.display = 'block';
    grid.innerHTML = recents.map(({ thumbUrl, dataUrl }) => `
      <button type="button"
              class="img-thumb${_selectedThumbUrl === thumbUrl ? ' selected' : ''}"
              data-url="${thumbUrl}"
              data-dataurl-cached="1"
              title="Imagen reciente">
        <img src="${thumbUrl}" alt="Reciente" loading="lazy" crossorigin="anonymous"
             onerror="this.closest('.img-thumb').style.display='none'">
        <div class="img-thumb-check">✓</div>
      </button>
    `).join('');

    // Click en reciente: usar data URL ya guardado (sin re-fetch)
    grid.querySelectorAll('.img-thumb').forEach(thumb => {
      thumb.addEventListener('click', () => {
        const recent = recents.find(r => r.thumbUrl === thumb.dataset.url);
        if (!recent) return;
        // Aplicar directamente sin fetch
        _selectedThumbUrl  = recent.thumbUrl;
        _selectedImageUrl  = recent.dataUrl;
        _imgConvertPromise = null;

        // Actualizar selección visual en TODOS los grids
        document.querySelectorAll('.img-thumb').forEach(t =>
          t.classList.toggle('selected', t.dataset.url === recent.thumbUrl));

        const bar     = document.getElementById('img-selected-bar');
        const barSpan = bar ? bar.querySelector('span') : null;
        if (bar) bar.style.display = 'flex';
        if (barSpan) barSpan.textContent = '🖼️ Imagen reciente seleccionada';
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
      const url  = `https://picsum.photos/seed/${seed}/280/180`;
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
      thumb.addEventListener('click', () => selectImage(thumb.dataset.url));
    });
  }

  /* ── selectImage: async + data URL + guarda en recientes ── */

  async function selectImage(url) {
    _selectedThumbUrl  = url;
    _selectedImageUrl  = null;
    _imgConvertPromise = null;

    // UI inmediata: marcar seleccionado + spinner en barra
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
        const dataUrl  = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror   = reject;
          reader.readAsDataURL(blob);
        });

        _selectedImageUrl = dataUrl;
        if (barSpan) barSpan.textContent = '🖼️ Imagen seleccionada como fondo';

        // Guardar en recientes
        addToRecentImages(url, dataUrl);

      } catch (err) {
        console.error('[IMG] Error convirtiendo imagen:', err);
        _selectedImageUrl = url;
        if (barSpan) barSpan.textContent = '⚠️ Imagen (modo directo)';
      }
    })();

    await _imgConvertPromise;
  }

  function clearImage() {
    _selectedImageUrl  = null;
    _selectedThumbUrl  = null;
    _imgConvertPromise = null;

    document.querySelectorAll('.img-thumb').forEach(t => t.classList.remove('selected'));

    const bar = document.getElementById('img-selected-bar');
    if (bar) bar.style.display = 'none';
  }

  /* ── Switcher de tabs Fondo ─────────────────────────────── */

  function switchBgTab(tabName) {
    const tabs = document.querySelectorAll('.bg-tab');
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    if ($bgPanelColor)  $bgPanelColor.classList.toggle('hidden', tabName !== 'color');
    if ($bgPanelImagen) $bgPanelImagen.classList.toggle('hidden', tabName !== 'imagen');
  }

  /* ── Modal open/close ───────────────────────────────────── */

  function openModal(dateStr, hour, event = null) {
    _currentEvent  = event;
    _pendingDate   = dateStr;
    _pendingHour   = hour;

    if (event) {
      $title.textContent = event.recurrence && event.recurrence !== 'none'
        ? 'Editar Evento Recurrente'
        : 'Editar Evento';
      $inputTitle.value     = event.title || '';
      $inputStart.value     = event.startTime || padTime(hour ?? CONFIG.START_HOUR);
      $inputEnd.value       = event.endTime   || padTime((hour ?? CONFIG.START_HOUR) + 1);
      $inputDesc.value      = event.desc || '';
      _selectedColor        = event.color || CONFIG.COLORS[0];
      _selectedImageUrl     = event.imageUrl || null;
      $recurrence.value     = event.recurrence || 'none';
      if ($endRecurrence) $endRecurrence.value = event.endRecurrence || '';
      $btnDelete.hidden = false;
      setImportant(event.important);
    } else {
      $title.textContent = 'Nuevo Evento';
      const safeHour = Math.min(hour ?? CONFIG.START_HOUR, State.endHour - 1);
      $inputTitle.value     = '';
      $inputStart.value     = padTime(safeHour);
      $inputEnd.value       = padTime(Math.min(safeHour + 1, State.endHour));
      $inputDesc.value      = '';
      _selectedColor        = CONFIG.COLORS[0];
      _selectedImageUrl     = null;
      $recurrence.value     = 'none';
      if ($endRecurrence) $endRecurrence.value = '';
      $btnDelete.hidden = true;
      setImportant(false);
    }

    setActiveDot(_selectedColor);
    toggleEndRecurrenceField();

    // Resetear imagen picker
    clearImage();
    const imgGrid = document.getElementById('img-grid');
    if (imgGrid) {
      imgGrid.innerHTML = `<div class="img-hint">✨ Elige una categoría o escribe tu búsqueda</div>`;
    }
    document.querySelectorAll('.img-pill').forEach(p => p.classList.remove('active'));
    const searchInput = document.getElementById('img-search-input');
    if (searchInput) searchInput.value = '';

    // Actualizar sección de recientes
    renderRecentImages();

    // Si el evento ya tenía imagen, restaurar thumb URL y mostrar barra
    if (_selectedImageUrl) {
      _selectedThumbUrl = null; // no conocemos el thumb URL original en edición
      const bar = document.getElementById('img-selected-bar');
      if (bar) { bar.style.display = 'flex'; bar.querySelector('span').textContent = '🖼️ Imagen guardada en el evento'; }
      switchBgTab('imagen');
    } else {
      switchBgTab('color');
    }

    $backdrop.hidden = false;
    $backdrop.removeAttribute('aria-hidden');
    $inputTitle.focus();
    $inputTitle.classList.remove('error');

    // Si el título ya coincide con una plantilla, aplicarla sin sobrescribir
    const titleVal = $inputTitle.value.trim();
    if (titleVal) {
      const match = loadPresets().find(p => p.label.toLowerCase() === titleVal.toLowerCase());
      if (match) applyPreset(match, false);
    }
  }

  function closeModal() {
    $backdrop.hidden = true;
    $backdrop.setAttribute('aria-hidden', 'true');
    _currentEvent = null;
  }

  /* ── Save ───────────────────────────────────────────────── */

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
    if (!col) return;

    const dateKey = col.dataset.date;
    const rect    = col.getBoundingClientRect();
    const relY    = e.clientY - rect.top;
    const hour    = window.CalApp.Calendar.yToHour(relY, dateKey);

    openModal(dateKey, hour);
  }

  /* ── HTML helpers ───────────────────────────────────────── */

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function parseLinksInText(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.split(urlRegex).map(part => {
      if (/^https?:\/\//.test(part)) {
        return `<a href="#" class="ctx-link" data-href="${escapeAttr(part)}">${escapeHTML(part)}</a>`;
      }
      return escapeHTML(part).replace(/\n/g, '<br>');
    }).join('');
  }

  /* ── Presets ─────────────────────────────────────────────── */

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

  /* ── Context menu ────────────────────────────────────────── */

  function createContextMenu() {
    $ctxMenu = document.createElement('div');
    $ctxMenu.id        = 'event-ctx-menu';
    $ctxMenu.className = 'event-ctx-menu';
    $ctxMenu.hidden    = true;
    document.body.appendChild($ctxMenu);

    // Cerrar con click fuera o Escape
    document.addEventListener('click', e => {
      if ($ctxMenu && !$ctxMenu.contains(e.target)) hideContextMenu();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') hideContextMenu();
    });
  }

  function showContextMenu(evt, x, y) {
    _ctxEvent = evt;

    const hasDesc   = !!(evt.desc && evt.desc.trim());
    const descHTML  = hasDesc ? parseLinksInText(evt.desc) : '';
    const dotColor  = evt.color || CONFIG.COLORS[0];
    const isRecurring = evt.recurrence && evt.recurrence !== 'none';

    $ctxMenu.innerHTML = `
      <div class="ctx-head">
        <span class="ctx-color-dot" style="background:${dotColor}"></span>
        <div class="ctx-head-text">
          <div class="ctx-title">${escapeHTML(evt.title)}${isRecurring ? ' <span class="ctx-recur">🔄</span>' : ''}</div>
          <div class="ctx-time">${evt.startTime} – ${evt.endTime}</div>
        </div>
      </div>
      ${hasDesc ? `<div class="ctx-desc">${descHTML}</div>` : '<div class="ctx-no-desc">Sin descripción</div>'}
      <div class="ctx-actions">
        <button class="ctx-btn" id="ctx-edit">✏️ Editar</button>
        <button class="ctx-btn ctx-btn-danger" id="ctx-del">🗑️ Eliminar</button>
      </div>
    `;

    $ctxMenu.hidden = false;

    // Posicionar sin salirse de la pantalla
    const W = $ctxMenu.offsetWidth  || 280;
    const H = $ctxMenu.offsetHeight || 200;
    let left = x + 4, top = y + 4;
    if (left + W > window.innerWidth  - 8) left = x - W - 4;
    if (top  + H > window.innerHeight - 8) top  = y - H - 4;
    $ctxMenu.style.left = `${Math.max(4, left)}px`;
    $ctxMenu.style.top  = `${Math.max(4, top)}px`;

    // Editar
    document.getElementById('ctx-edit').addEventListener('click', e => {
      e.stopPropagation();
      hideContextMenu();
      openModal(evt.dateKey, null, evt);
    });

    // Eliminar
    document.getElementById('ctx-del').addEventListener('click', e => {
      e.stopPropagation();
      const msg = isRecurring
        ? `¿Eliminar el evento recurrente "${evt.title}" y todas sus ocurrencias?`
        : `¿Eliminar "${evt.title}"?`;
      if (confirm(msg)) {
        hideContextMenu();
        State.deleteEvent(evt.dateKey, evt.id);
        window.CalApp.renderAndBind();
      }
    });

    // Links en descripción
    $ctxMenu.querySelectorAll('.ctx-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const href = link.dataset.href;
        if (confirm(`¿Abrir este enlace en una nueva pestaña?\n\n${href}`)) {
          window.open(href, '_blank', 'noopener,noreferrer');
        }
      });
    });
  }

  function hideContextMenu() {
    if ($ctxMenu) $ctxMenu.hidden = true;
    _ctxEvent = null;
  }

  /* ── Context menu click on event ─────────────────────────── */

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

  /* ── Init ───────────────────────────────────────────────── */

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