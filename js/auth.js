/**
 * auth.js — Autenticación con Supabase. v2
 * Novedades: reset de contraseña · menú de cuenta · eliminar cuenta
 * Namespace global: window.CalApp.Auth
 */
window.CalApp = window.CalApp || {};

window.CalApp.Auth = (function () {
  'use strict';

  let _client = null;
  let _user   = null;
  let _mode   = 'login'; // 'login' | 'register' | 'forgot' | 'update-password'

  /* ══════════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════ */

  async function init() {
    const cfg = window.CalApp.SUPABASE_CONFIG || {};

    if (!cfg.url || cfg.url === 'YOUR_SUPABASE_URL') {
      _showConfigError();
      return;
    }

    _injectStyles();
    _buildModal();
    _buildUserBadge();

    _client = window.supabase.createClient(cfg.url, cfg.anonKey);
    window.CalApp._supabase = _client;

    // Escuchar cambios de sesión
    _client.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        _user = session.user;
        // No re-ejecutar afterSignIn si estamos en flujo de actualizar contraseña
        if (_mode !== 'update-password') await _afterSignIn();

      } else if (event === 'SIGNED_OUT') {
        _user = null;
        _afterSignOut();

      } else if (event === 'TOKEN_REFRESHED' && !session) {
        // Token de refresco inválido — limpiar y volver al login
        console.warn('[Auth] Token refresh fallido, cerrando sesión');
        await _client.auth.signOut();

      } else if (event === 'PASSWORD_RECOVERY') {
        // Usuario llegó desde el email de reset → mostrar formulario de nueva contraseña
        _user = session?.user || null;
        _mode = 'update-password';
        _showModal();
        _switchView('update-password');
      }
    });

    // Verificar sesión existente al cargar
    const { data: { session }, error: sessionError } = await _client.auth.getSession();

    // Token de refresco inválido o vencido → limpiar localStorage y mostrar login
    if (sessionError) {
      console.warn('[Auth] Sesión inválida, limpiando token:', sessionError.message);
      await _client.auth.signOut();
      _showModal();
      return;
    }

    if (session?.user) {
      _user = session.user;
      // Si hay hash de recovery en la URL, el evento PASSWORD_RECOVERY ya dispara solo
      if (!window.location.hash.includes('type=recovery')) {
        await _afterSignIn();
      }
    } else {
      _showModal();
    }
  }

  /* ══════════════════════════════════════════════════════════
     POST SIGN-IN / SIGN-OUT
  ══════════════════════════════════════════════════════════ */

  let _afterSignInRunning = false;

  async function _afterSignIn() {
    // Guard: evitar doble ejecución (onAuthStateChange + getSession pueden disparar juntos)
    if (_afterSignInRunning) return;
    _afterSignInRunning = true;

    // Cerrar el modal inmediatamente — el usuario ya está autenticado
    _hideModal();
    _updateBadge(_user.email);

    _setLoading(true);
    try {
      const Storage = window.CalApp.Storage;

      const { count: evCount }  = await _client
        .from('events').select('*', { count: 'exact', head: true })
        .eq('user_id', _user.id);
      const { count: recCount } = await _client
        .from('recurring_events').select('*', { count: 'exact', head: true })
        .eq('user_id', _user.id);

      const hasCloudData = (evCount || 0) + (recCount || 0) > 0;

      if (hasCloudData) {
        await Storage.loadFromSupabase(_user.id);
      } else {
        await _migrateLocalToCloud();
      }

      const { State } = window.CalApp;
      if (State) {
        State.events          = Storage.loadEvents();
        State.recurringEvents = Storage.loadRecurringEvents();
        const s = Storage.loadSettings();
        if (s.endHour) State.endHour = s.endHour;
      }

      window.CalApp.renderAndBind?.();

    } catch (err) {
      console.error('[Auth] afterSignIn error:', err);
    } finally {
      _setLoading(false);
      _afterSignInRunning = false;
    }
  }

  function _afterSignOut() {
    const { CONFIG, State } = window.CalApp;

    if (CONFIG) {
      localStorage.removeItem(CONFIG.STORAGE_KEY_EVENTS);
      localStorage.removeItem(CONFIG.STORAGE_KEY_RECURRING);
      localStorage.removeItem(CONFIG.STORAGE_KEY_SETTINGS);
    }

    if (State) {
      State.events          = {};
      State.recurringEvents = [];
    }

    window.CalApp.renderAndBind?.();
    _hideBadge();
    _mode = 'login';
    _clearAllErrors();
    _showModal();
    _switchView('login');
  }

  async function _migrateLocalToCloud() {
    const S = window.CalApp.Storage;
    await Promise.all([
      S.syncNow.events(S.loadEvents()),
      S.syncNow.recurring(S.loadRecurringEvents()),
      S.syncNow.settings(S.loadSettings()),
    ]);
  }

  /* ══════════════════════════════════════════════════════════
     ACCIONES DE AUTH
  ══════════════════════════════════════════════════════════ */

  /* ── Login / Registro ───────────────────────────────────── */

  async function _submit() {
    const email    = document.getElementById('auth-email')?.value.trim();
    const password = document.getElementById('auth-password')?.value;

    if (!email || !password) {
      _showError('Por favor ingresá email y contraseña.', 'error', 'auth-error');
      return;
    }
    if (password.length < 6) {
      _showError('La contraseña debe tener al menos 6 caracteres.', 'error', 'auth-error');
      return;
    }

    _setLoading(true);
    _clearAllErrors();

    try {
      let error;

      if (_mode === 'login') {
        ({ error } = await _client.auth.signInWithPassword({ email, password }));
      } else {
        const { error: signUpError } = await _client.auth.signUp({ email, password });
        error = signUpError;
        if (!error) {
          _showError('✅ ¡Cuenta creada! Revisá tu email para confirmar y luego iniciá sesión.', 'success', 'auth-error');
          return;
        }
      }

      if (error) _showError(_friendlyError(error.message), 'error', 'auth-error');
    } catch (err) {
      console.error('[Auth] submit error:', err);
      _showError('Error de conexión. Intentá nuevamente.', 'error', 'auth-error');
    } finally {
      _setLoading(false);
    }
  }

  /* ── Recuperar contraseña (solicitud) ───────────────────── */

  async function _requestReset() {
    const email = document.getElementById('auth-reset-email')?.value.trim();

    if (!email) {
      _showError('Ingresá tu dirección de email.', 'error', 'auth-reset-error');
      return;
    }

    _setLoading(true);
    _clearAllErrors();

    const redirectTo = window.location.origin + window.location.pathname;

    try {
      const { error } = await _client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        _showError(_friendlyError(error.message), 'error', 'auth-reset-error');
      } else {
        _showError(
          '✅ ¡Listo! Si ese email está registrado, recibirás las instrucciones en breve.',
          'success',
          'auth-reset-error'
        );
      }
    } catch (err) {
      console.error('[Auth] requestReset error:', err);
      _showError('Error de conexión. Intentá nuevamente.', 'error', 'auth-reset-error');
    } finally {
      _setLoading(false);
    }
  }

  /* ── Actualizar contraseña (tras clic en email) ─────────── */

  async function _updatePassword() {
    const p1 = document.getElementById('auth-new-pass')?.value;
    const p2 = document.getElementById('auth-new-pass2')?.value;

    if (!p1 || p1.length < 6) {
      _showError('La contraseña debe tener al menos 6 caracteres.', 'error', 'auth-update-error');
      return;
    }
    if (p1 !== p2) {
      _showError('Las contraseñas no coinciden.', 'error', 'auth-update-error');
      return;
    }

    _setLoading(true);
    _clearAllErrors();

    _setLoading(true);
    _clearAllErrors();

    try {
      const { error } = await _client.auth.updateUser({ password: p1 });
      if (error) {
        _showError(_friendlyError(error.message), 'error', 'auth-update-error');
      } else {
        _showError('✅ ¡Contraseña actualizada! Iniciando sesión…', 'success', 'auth-update-error');
        _mode = 'login';
        setTimeout(async () => {
          if (_user) await _afterSignIn();
        }, 1800);
      }
    } catch (err) {
      console.error('[Auth] updatePassword error:', err);
      _showError('Error de conexión. Intentá nuevamente.', 'error', 'auth-update-error');
    } finally {
      _setLoading(false);
    }
  }

  /* ── Cambiar contraseña (desde el badge, usuario logueado) ─ */

  async function _sendChangePasswordEmail() {
    _closeMenu();
    if (!_user?.email) return;

    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await _client.auth.resetPasswordForEmail(_user.email, { redirectTo });

    if (error) {
      alert('Error al enviar el email: ' + error.message);
    } else {
      // Toast minimalista
      _showToast('✅ Te enviamos un email para cambiar tu contraseña');
    }
  }

  /* ── Eliminar cuenta ────────────────────────────────────── */

  async function _deleteAccount() {
    _closeMenu();

    const confirmed = window.confirm(
      '⚠️ ¿Eliminar tu cuenta permanentemente?\n\n' +
      'Se borrarán todos tus eventos y datos. Esta acción no se puede deshacer.'
    );
    if (!confirmed) return;

    const reconfirmed = window.confirm(
      '❗ Última confirmación.\n\n¿Estás seguro de que querés eliminar tu cuenta?'
    );
    if (!reconfirmed) return;

    try {
      // Requiere que hayas ejecutado schema-addons.sql en Supabase
      const { error } = await _client.rpc('delete_user');
      if (error) throw error;
      await _client.auth.signOut();
    } catch (err) {
      console.error('[Auth] deleteAccount:', err);
      alert(
        'Error al eliminar la cuenta.\n\n' +
        'Asegurate de haber ejecutado schema-addons.sql en el SQL Editor de Supabase.\n\n' +
        'Detalle: ' + (err.message || err)
      );
    }
  }

  /* ── Cerrar sesión ──────────────────────────────────────── */

  async function signOut() {
    await _client?.auth.signOut();
  }

  /* ── Mensajes de error amigables ────────────────────────── */

  function _friendlyError(msg) {
    if (!msg) return 'Error desconocido.';
    if (msg.includes('Invalid login credentials')) return 'Email o contraseña incorrectos.';
    if (msg.includes('already registered'))        return 'Este email ya está registrado.';
    if (msg.includes('Password should'))           return 'La contraseña debe tener al menos 6 caracteres.';
    if (msg.includes('Unable to validate'))        return 'Email con formato inválido.';
    if (msg.includes('Email not confirmed'))       return 'Confirmá tu email antes de iniciar sesión.';
    if (msg.includes('User not found'))            return 'No encontramos una cuenta con ese email.';
    return 'Error de conexión. Intentá nuevamente.';
  }

  /* ══════════════════════════════════════════════════════════
     MODAL UI — CONSTRUCCIÓN
  ══════════════════════════════════════════════════════════ */

  function _buildModal() {
    const div = document.createElement('div');
    div.id        = 'auth-modal-backdrop';
    div.className = 'auth-backdrop';
    div.hidden    = true;
    div.innerHTML = `
      <div class="auth-card" role="dialog" aria-modal="true" aria-label="Acceso a la cuenta">

        <!-- Brand -->
        <div class="auth-brand-row">
          <span class="auth-logo">📅</span>
          <div>
            <div class="auth-brand-name">Agenda <span class="auth-brand-yr">2026</span></div>
            <div class="auth-brand-sub">Tu calendario siempre sincronizado</div>
          </div>
        </div>

        <!-- ── Vista principal: login / registro ── -->
        <div id="auth-view-main">
          <div class="auth-tabs" role="tablist">
            <button class="auth-tab active" data-tab="login"    role="tab">Entrar</button>
            <button class="auth-tab"        data-tab="register" role="tab">Crear cuenta</button>
          </div>

          <div class="auth-err-box" id="auth-error" style="display:none"></div>

          <div class="auth-fields">
            <div class="auth-field">
              <label for="auth-email">Email</label>
              <input type="email" id="auth-email" placeholder="tu@email.com"
                     autocomplete="email" spellcheck="false">
            </div>
            <div class="auth-field">
              <label for="auth-password">Contraseña</label>
              <input type="password" id="auth-password" placeholder="••••••••"
                     autocomplete="current-password" minlength="6">
            </div>
          </div>

          <button class="auth-submit" id="auth-submit">
            <span class="auth-submit-lbl">Entrar</span>
            <span class="auth-submit-spin" hidden>Cargando…</span>
          </button>

          <div class="auth-extra-links">
            <button class="auth-link" id="auth-forgot-link">¿Olvidaste tu contraseña?</button>
          </div>
        </div>

        <!-- ── Vista: recuperar contraseña ── -->
        <div id="auth-view-forgot" style="display:none">
          <h3 class="auth-view-title">Recuperar contraseña</h3>
          <p class="auth-view-desc">
            Ingresá tu email y te enviamos un enlace para crear una contraseña nueva.
          </p>

          <div class="auth-err-box" id="auth-reset-error" style="display:none"></div>

          <div class="auth-fields">
            <div class="auth-field">
              <label for="auth-reset-email">Email</label>
              <input type="email" id="auth-reset-email" placeholder="tu@email.com"
                     autocomplete="email" spellcheck="false">
            </div>
          </div>

          <button class="auth-submit" id="auth-reset-submit">
            <span class="auth-submit-lbl">Enviar instrucciones</span>
            <span class="auth-submit-spin" hidden>Cargando…</span>
          </button>

          <div class="auth-extra-links">
            <button class="auth-link" id="auth-back-link">← Volver al inicio de sesión</button>
          </div>
        </div>

        <!-- ── Vista: nueva contraseña (tras reset email) ── -->
        <div id="auth-view-update-pass" style="display:none">
          <h3 class="auth-view-title">🔑 Nueva contraseña</h3>
          <p class="auth-view-desc">
            Elegí una contraseña segura. Debe tener al menos 6 caracteres.
          </p>

          <div class="auth-err-box" id="auth-update-error" style="display:none"></div>

          <div class="auth-fields">
            <div class="auth-field">
              <label for="auth-new-pass">Contraseña nueva</label>
              <input type="password" id="auth-new-pass" placeholder="Mínimo 6 caracteres"
                     minlength="6" autocomplete="new-password">
            </div>
            <div class="auth-field">
              <label for="auth-new-pass2">Confirmá la contraseña</label>
              <input type="password" id="auth-new-pass2" placeholder="Repetí la contraseña"
                     minlength="6" autocomplete="new-password">
            </div>
          </div>

          <button class="auth-submit" id="auth-update-submit">
            <span class="auth-submit-lbl">Actualizar contraseña</span>
            <span class="auth-submit-spin" hidden>Cargando…</span>
          </button>
        </div>

      </div>`;

    document.body.appendChild(div);

    /* ── Tabs ── */
    div.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        _mode = tab.dataset.tab;
        div.querySelectorAll('.auth-tab').forEach(t =>
          t.classList.toggle('active', t === tab));
        document.querySelector('#auth-view-main .auth-submit-lbl').textContent =
          _mode === 'login' ? 'Entrar' : 'Crear cuenta';
        document.getElementById('auth-password').autocomplete =
          _mode === 'login' ? 'current-password' : 'new-password';
        _clearAllErrors();
      });
    });

    /* ── Formulario principal ── */
    document.getElementById('auth-submit').addEventListener('click', _submit);
    div.querySelectorAll('#auth-view-main input').forEach(inp =>
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') _submit(); }));

    /* ── Link "¿Olvidaste tu contraseña?" ── */
    document.getElementById('auth-forgot-link').addEventListener('click', () => {
      // Pre-llenar email si ya estaba escrito
      const existing = document.getElementById('auth-email')?.value;
      if (existing) document.getElementById('auth-reset-email').value = existing;
      _switchView('forgot');
    });

    /* ── Formulario de recuperación ── */
    document.getElementById('auth-reset-submit').addEventListener('click', _requestReset);
    document.getElementById('auth-reset-email').addEventListener('keydown', e => {
      if (e.key === 'Enter') _requestReset();
    });

    /* ── Botón "Volver" ── */
    document.getElementById('auth-back-link').addEventListener('click', () => {
      _switchView('login');
      _clearAllErrors();
    });

    /* ── Formulario de nueva contraseña ── */
    document.getElementById('auth-update-submit').addEventListener('click', _updatePassword);
    div.querySelectorAll('#auth-view-update-pass input').forEach(inp =>
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') _updatePassword(); }));
  }

  /* ── Cambiar entre vistas del modal ─────────────────────── */

  function _switchView(view) {
    const views = {
      'auth-view-main':        ['login', 'register'],
      'auth-view-forgot':      ['forgot'],
      'auth-view-update-pass': ['update-password'],
    };

    for (const [id, modes] of Object.entries(views)) {
      const el = document.getElementById(id);
      if (el) el.style.display = modes.includes(view) ? '' : 'none';
    }

    _clearAllErrors();

    // Focus automático en el primer input visible
    setTimeout(() => {
      const firstInput = document.querySelector(
        '#auth-view-main input:not([hidden]), ' +
        '#auth-view-forgot input:not([hidden]), ' +
        '#auth-view-update-pass input:not([hidden])'
      );
      const visibleInput = [...document.querySelectorAll('input')].find(
        el => el.closest('[style*="display: none"]') === null &&
              el.closest('[style*="display:none"]') === null
      );
      (firstInput || visibleInput)?.focus();
    }, 60);
  }

  /* ── Show / Hide modal ──────────────────────────────────── */

  function _showModal() {
    const el = document.getElementById('auth-modal-backdrop');
    if (el) {
      el.hidden = false;
      setTimeout(() => document.getElementById('auth-email')?.focus(), 80);
    }
  }

  function _hideModal() {
    const el = document.getElementById('auth-modal-backdrop');
    if (el) el.hidden = true;
  }

  /* ── Loading state ───────────────────────────────────────── */

  function _setLoading(on) {
    ['auth-submit', 'auth-reset-submit', 'auth-update-submit'].forEach(id => {
      const btn  = document.getElementById(id);
      if (!btn) return;
      const lbl  = btn.querySelector('.auth-submit-lbl');
      const spin = btn.querySelector('.auth-submit-spin');
      btn.disabled  = on;
      if (lbl)  lbl.hidden  = on;
      if (spin) spin.hidden = !on;
    });
  }

  /* ── Error messages ─────────────────────────────────────── */

  function _showError(msg, type = 'error', boxId = 'auth-error') {
    const el = document.getElementById(boxId);
    if (!el) return;
    el.textContent   = msg;
    el.style.display = 'block';
    el.className     = `auth-err-box ${type === 'success' ? 'auth-err-ok' : 'auth-err-err'}`;
  }

  function _clearAllErrors() {
    ['auth-error', 'auth-reset-error', 'auth-update-error'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = ''; el.style.display = 'none'; }
    });
  }

  /* ══════════════════════════════════════════════════════════
     BADGE DE USUARIO + MENÚ DE CUENTA
  ══════════════════════════════════════════════════════════ */

  function _buildUserBadge() {
    const actions = document.querySelector('.header-actions');
    if (!actions) return;

    const badge = document.createElement('div');
    badge.id        = 'user-badge';
    badge.className = 'user-badge';
    badge.hidden    = true;
    badge.innerHTML = `
      <span class="sync-dot" id="sync-dot" title="Estado de sincronización"></span>

      <button class="user-badge-btn" id="user-badge-btn"
              aria-haspopup="true" aria-expanded="false" title="Menú de cuenta">
        <span class="user-avatar" id="user-avatar"></span>
        <span class="user-email-lbl" id="user-email-lbl"></span>
        <span class="badge-chevron" aria-hidden="true">▾</span>
      </button>

      <div class="user-menu" id="user-menu" hidden role="menu">
        <div class="user-menu-email" id="user-menu-email"></div>
        <hr class="user-menu-sep">
        <button class="user-menu-item" id="btn-change-pass" role="menuitem">
          🔑 Cambiar contraseña
        </button>
        <button class="user-menu-item user-menu-danger" id="btn-delete-account" role="menuitem">
          🗑️ Eliminar mi cuenta
        </button>
        <hr class="user-menu-sep">
        <button class="user-menu-item" id="btn-logout" role="menuitem">
          ↩️ Cerrar sesión
        </button>
      </div>`;

    actions.appendChild(badge);

    /* ── Toggle menú ── */
    document.getElementById('user-badge-btn').addEventListener('click', e => {
      e.stopPropagation();
      const menu    = document.getElementById('user-menu');
      const btn     = document.getElementById('user-badge-btn');
      const opening = menu.hidden;
      menu.hidden   = !opening;
      btn.setAttribute('aria-expanded', String(opening));
    });

    /* ── Cerrar menú al hacer clic fuera ── */
    document.addEventListener('click', () => {
      const menu = document.getElementById('user-menu');
      if (menu && !menu.hidden) {
        menu.hidden = true;
        document.getElementById('user-badge-btn')?.setAttribute('aria-expanded', 'false');
      }
    });

    /* ── Cerrar menú con Escape ── */
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') _closeMenu();
    });

    /* ── Acciones del menú ── */
    document.getElementById('btn-logout').addEventListener('click', signOut);
    document.getElementById('btn-change-pass').addEventListener('click', _sendChangePasswordEmail);
    document.getElementById('btn-delete-account').addEventListener('click', _deleteAccount);
  }

  function _closeMenu() {
    const menu = document.getElementById('user-menu');
    const btn  = document.getElementById('user-badge-btn');
    if (menu) menu.hidden = true;
    if (btn)  btn.setAttribute('aria-expanded', 'false');
  }

  function _updateBadge(email) {
    const badge       = document.getElementById('user-badge');
    const emailEl     = document.getElementById('user-email-lbl');
    const avatarEl    = document.getElementById('user-avatar');
    const menuEmailEl = document.getElementById('user-menu-email');

    if (badge)       badge.hidden        = false;
    if (emailEl)     emailEl.textContent = email.split('@')[0];
    if (avatarEl)    avatarEl.textContent= email[0].toUpperCase();
    if (menuEmailEl) menuEmailEl.textContent = email;
  }

  function _hideBadge() {
    const badge = document.getElementById('user-badge');
    if (badge) badge.hidden = true;
  }

  /* ── Toast minimalista ─────────────────────────────────── */

  function _showToast(msg, duration = 3500) {
    let toast = document.getElementById('auth-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id        = 'auth-toast';
      toast.className = 'auth-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('auth-toast-show');
    setTimeout(() => toast.classList.remove('auth-toast-show'), duration);
  }

  /* ── Indicador de sincronización ──────────────────────── */

  let _syncTimer = null;

  function updateSyncStatus(ok) {
    const dot = document.getElementById('sync-dot');
    if (!dot) return;
    clearTimeout(_syncTimer);
    dot.className = ok ? 'sync-dot sync-ok' : 'sync-dot sync-err';
    dot.title     = ok ? 'Sincronizado ☁' : 'Error al sincronizar ⚠';
    if (ok) {
      _syncTimer = setTimeout(() => { dot.className = 'sync-dot'; }, 4000);
    }
  }

  /* ══════════════════════════════════════════════════════════
     ERROR DE CONFIGURACIÓN
  ══════════════════════════════════════════════════════════ */

  function _showConfigError() {
    document.body.innerHTML = `
      <div style="position:fixed;inset:0;background:#0f172a;display:flex;
                  align-items:center;justify-content:center;font-family:system-ui;
                  color:#f8fafc;text-align:center;padding:2rem">
        <div>
          <div style="font-size:3rem;margin-bottom:1.25rem">⚙️</div>
          <h2 style="font-size:1.4rem;margin-bottom:.6rem">Configuración pendiente</h2>
          <p style="color:#94a3b8;max-width:460px;line-height:1.7;font-size:.95rem">
            Abrí <code style="background:#1e293b;padding:2px 8px;border-radius:5px;
            color:#a5b4fc">js/supabase-config.js</code> y reemplazá
            <code style="background:#1e293b;padding:2px 8px;border-radius:5px;color:#a5b4fc">
            YOUR_SUPABASE_URL</code> y
            <code style="background:#1e293b;padding:2px 8px;border-radius:5px;color:#a5b4fc">
            YOUR_SUPABASE_ANON_KEY</code> con las credenciales de tu proyecto en
            <a href="https://supabase.com" target="_blank"
               style="color:#818cf8;text-decoration:underline">supabase.com</a>.
          </p>
          <p style="color:#64748b;font-size:.8rem;margin-top:1.5rem">
            Settings → API → Project URL & anon public key
          </p>
        </div>
      </div>`;
  }

  /* ══════════════════════════════════════════════════════════
     ESTILOS (inyectados dinámicamente)
  ══════════════════════════════════════════════════════════ */

  function _injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      /* ── Auth backdrop ─────────────────────────────────── */
      .auth-backdrop {
        position: fixed; inset: 0; z-index: 9000;
        background: rgba(15,23,42,.88);
        backdrop-filter: blur(7px);
        -webkit-backdrop-filter: blur(7px);
        display: flex; align-items: center; justify-content: center;
        padding: 1rem;
      }
      .auth-card {
        background: #fff; border-radius: 18px; padding: 2rem;
        width: 100%; max-width: 390px;
        box-shadow: 0 32px 80px rgba(0,0,0,.4);
        animation: auth-pop .22s cubic-bezier(.34,1.56,.64,1);
      }
      @keyframes auth-pop {
        from { opacity:0; transform:scale(.93) translateY(10px); }
        to   { opacity:1; transform:scale(1)   translateY(0); }
      }

      /* Brand */
      .auth-brand-row {
        display: flex; align-items: center; gap: .85rem; margin-bottom: 1.6rem;
      }
      .auth-logo { font-size: 2.2rem; }
      .auth-brand-name {
        font-size: 1.15rem; font-weight: 700; color: #0f172a; letter-spacing: -.02em;
      }
      .auth-brand-yr { font-weight: 400; color: #94a3b8; font-size: .78rem; }
      .auth-brand-sub { font-size: .75rem; color: #94a3b8; margin-top: 3px; }

      /* Tabs */
      .auth-tabs {
        display: flex; gap: .3rem; background: #f1f5f9;
        border-radius: 11px; padding: .28rem; margin-bottom: 1.25rem;
      }
      .auth-tab {
        flex: 1; padding: .42rem .75rem; border-radius: 9px; border: none;
        font-size: .83rem; font-weight: 500; color: #64748b; background: transparent;
        cursor: pointer; transition: all .15s; font-family: inherit;
      }
      .auth-tab.active {
        background: #fff; color: #0f172a;
        box-shadow: 0 1px 5px rgba(0,0,0,.12);
      }

      /* View titles */
      .auth-view-title {
        font-size: 1.05rem; font-weight: 700; color: #0f172a;
        letter-spacing: -.02em; margin-bottom: .4rem;
      }
      .auth-view-desc {
        font-size: .8rem; color: #64748b; line-height: 1.55;
        margin-bottom: 1.1rem;
      }

      /* Error / success box */
      .auth-err-box {
        padding: .6rem .9rem; border-radius: 9px;
        font-size: .8rem; font-weight: 500; margin-bottom: .9rem; line-height: 1.5;
      }
      .auth-err-err { background:#fef2f2; color:#dc2626; border:1px solid #fecaca; }
      .auth-err-ok  { background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0; }

      /* Fields */
      .auth-fields { display:flex; flex-direction:column; gap:.75rem; margin-bottom:1.1rem; }
      .auth-field  { display:flex; flex-direction:column; gap:.35rem; }
      .auth-field label { font-size:.78rem; font-weight:600; color:#374151; }
      .auth-field input {
        padding: .58rem .8rem; border: 1.5px solid #e2e8f0; border-radius: 9px;
        font-size: .9rem; color: #0f172a; background: #f8fafc; width: 100%;
        outline: none; transition: border-color .15s, box-shadow .15s;
        font-family: inherit;
      }
      .auth-field input:focus {
        border-color: #4f46e5; background: #fff;
        box-shadow: 0 0 0 3px rgba(79,70,229,.15);
      }

      /* Submit button */
      .auth-submit {
        width: 100%; padding: .68rem; border-radius: 11px; border: none;
        background: #4f46e5; color: #fff; font-size: .9rem; font-weight: 600;
        cursor: pointer; transition: background .2s, transform .1s;
        display: flex; align-items: center; justify-content: center; gap: .5rem;
        font-family: inherit; margin-bottom: .6rem;
      }
      .auth-submit:hover:not(:disabled)  { background: #4338ca; }
      .auth-submit:active:not(:disabled) { transform: scale(.98); }
      .auth-submit:disabled { opacity: .65; cursor: not-allowed; }

      /* Extra links (forgot password, back, etc.) */
      .auth-extra-links { text-align: center; margin-top: .3rem; }
      .auth-link {
        background: none; border: none; padding: .3rem .5rem;
        font-size: .78rem; color: #6366f1; cursor: pointer; font-family: inherit;
        text-decoration: underline; text-underline-offset: 2px; opacity: .85;
        transition: opacity .15s;
      }
      .auth-link:hover { opacity: 1; }

      /* ── User badge en el header ───────────────────────── */
      .user-badge {
        position: relative;
        display: flex; align-items: center; gap: .5rem;
        padding-left: .75rem;
        border-left: 1px solid rgba(255,255,255,.12);
      }

      /* Badge button (toggle del menú) */
      .user-badge-btn {
        display: flex; align-items: center; gap: .4rem;
        background: none; border: none; cursor: pointer;
        padding: .25rem .35rem; border-radius: 8px;
        transition: background .15s;
      }
      .user-badge-btn:hover { background: rgba(255,255,255,.1); }

      .user-avatar {
        width: 26px; height: 26px; border-radius: 50%;
        background: linear-gradient(135deg,#6366f1,#8b5cf6);
        color: #fff; font-size: .72rem; font-weight: 700;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; user-select: none;
      }
      .user-email-lbl {
        font-size: .72rem; color: rgba(255,255,255,.7);
        max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .badge-chevron {
        font-size: .65rem; color: rgba(255,255,255,.45);
        transition: transform .15s;
      }
      [aria-expanded="true"] .badge-chevron { transform: rotate(180deg); }

      /* Dropdown menú */
      .user-menu {
        position: absolute; top: calc(100% + 10px); right: 0;
        background: #fff; border-radius: 13px; min-width: 210px;
        box-shadow: 0 8px 30px rgba(0,0,0,.18), 0 2px 6px rgba(0,0,0,.08);
        border: 1px solid rgba(0,0,0,.06);
        z-index: 9999;
        animation: menu-pop .16s cubic-bezier(.34,1.56,.64,1);
        overflow: hidden;
      }
      @keyframes menu-pop {
        from { opacity:0; transform: scale(.95) translateY(-6px); }
        to   { opacity:1; transform: scale(1)   translateY(0); }
      }

      .user-menu-email {
        padding: .75rem 1rem .6rem;
        font-size: .75rem; color: #64748b; font-weight: 500;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }

      .user-menu-sep {
        border: none; border-top: 1px solid #f1f5f9; margin: .2rem 0;
      }

      .user-menu-item {
        display: block; width: 100%;
        padding: .6rem 1rem; border: none; background: none;
        text-align: left; font-size: .83rem; color: #374151; font-weight: 500;
        cursor: pointer; font-family: inherit; transition: background .12s;
      }
      .user-menu-item:hover { background: #f8fafc; }
      .user-menu-danger { color: #dc2626; }
      .user-menu-danger:hover { background: #fef2f2; }

      /* Indicador de sincronización */
      .sync-dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: transparent; transition: background .4s;
        flex-shrink: 0;
      }
      .sync-dot.sync-ok  { background: #34d399; box-shadow: 0 0 5px #34d39988; }
      .sync-dot.sync-err { background: #f87171; box-shadow: 0 0 5px #f8717188; }

      /* ── Toast ─────────────────────────────────────────── */
      .auth-toast {
        position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(20px);
        background: #1e293b; color: #f8fafc;
        padding: .65rem 1.2rem; border-radius: 10px; font-size: .84rem; font-weight: 500;
        box-shadow: 0 6px 24px rgba(0,0,0,.22);
        opacity: 0; transition: opacity .25s, transform .25s;
        pointer-events: none; white-space: nowrap; z-index: 99999;
      }
      .auth-toast.auth-toast-show {
        opacity: 1; transform: translateX(-50%) translateY(0);
      }

      /* ── Responsive ────────────────────────────────────── */
      @media (max-width: 700px) {
        .user-email-lbl { display: none; }
        .user-menu { right: -8px; }
      }
    `;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════
     API PÚBLICA
  ══════════════════════════════════════════════════════════ */

  function getUser()   { return _user; }
  function getClient() { return _client; }

  return { init, signOut, getUser, getClient, updateSyncStatus };
})();