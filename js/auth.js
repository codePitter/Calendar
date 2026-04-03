/**
 * auth.js — Autenticación con Supabase.
 * Gestiona sesión, modal de login/registro y badge de usuario en el header.
 * Namespace global: window.CalApp.Auth
 */
window.CalApp = window.CalApp || {};

window.CalApp.Auth = (function () {
  'use strict';

  let _client = null;
  let _user   = null;
  let _mode   = 'login'; // 'login' | 'register'

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
        await _afterSignIn();
      } else if (event === 'SIGNED_OUT') {
        _user = null;
        _afterSignOut();
      }
    });

    // Verificar sesión existente al cargar
    const { data: { session } } = await _client.auth.getSession();
    if (session?.user) {
      _user = session.user;
      await _afterSignIn();
    } else {
      _showModal();
    }
  }

  /* ══════════════════════════════════════════════════════════
     POST SIGN-IN / SIGN-OUT
  ══════════════════════════════════════════════════════════ */

  async function _afterSignIn() {
    _setLoading(true);
    try {
      const Storage = window.CalApp.Storage;

      // ¿Hay datos en la nube para este usuario?
      const { count: evCount }  = await _client
        .from('events').select('*', { count: 'exact', head: true })
        .eq('user_id', _user.id);
      const { count: recCount } = await _client
        .from('recurring_events').select('*', { count: 'exact', head: true })
        .eq('user_id', _user.id);

      const hasCloudData = (evCount || 0) + (recCount || 0) > 0;

      if (hasCloudData) {
        // Cargar desde la nube (fuente de verdad)
        await Storage.loadFromSupabase(_user.id);
      } else {
        // Primera vez: migrar datos locales a la nube
        await _migrateLocalToCloud();
      }

      // Actualizar estado en memoria desde localStorage (ya actualizado arriba)
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
      _hideModal();
      _updateBadge(_user.email);
    }
  }

  function _afterSignOut() {
    const { CONFIG, State } = window.CalApp;

    // Limpiar datos locales
    if (CONFIG) {
      localStorage.removeItem(CONFIG.STORAGE_KEY_EVENTS);
      localStorage.removeItem(CONFIG.STORAGE_KEY_RECURRING);
      localStorage.removeItem(CONFIG.STORAGE_KEY_SETTINGS);
    }

    // Resetear estado
    if (State) {
      State.events          = {};
      State.recurringEvents = [];
    }

    window.CalApp.renderAndBind?.();
    _hideBadge();
    _mode = 'login';
    _clearError();
    _showModal();
  }

  /* ── Migración de datos locales a la nube ──────────────── */

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

  async function _submit() {
    const email    = document.getElementById('auth-email')?.value.trim();
    const password = document.getElementById('auth-password')?.value;

    if (!email || !password) {
      _showError('Por favor ingresá email y contraseña.');
      return;
    }
    if (password.length < 6) {
      _showError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    _setLoading(true);
    _clearError();

    let error;
    if (_mode === 'login') {
      ({ error } = await _client.auth.signInWithPassword({ email, password }));
    } else {
      const { error: signUpError } = await _client.auth.signUp({ email, password });
      error = signUpError;
      if (!error) {
        _showError('✅ ¡Cuenta creada! Revisá tu email para confirmar y luego iniciá sesión.', 'success');
        _setLoading(false);
        return;
      }
    }

    _setLoading(false);
    if (error) _showError(_friendlyError(error.message));
  }

  async function signOut() {
    await _client?.auth.signOut();
  }

  function _friendlyError(msg) {
    if (!msg) return 'Error desconocido.';
    if (msg.includes('Invalid login credentials')) return 'Email o contraseña incorrectos.';
    if (msg.includes('already registered'))        return 'Este email ya está registrado.';
    if (msg.includes('Password should'))           return 'La contraseña debe tener al menos 6 caracteres.';
    if (msg.includes('Unable to validate'))        return 'Email con formato inválido.';
    if (msg.includes('Email not confirmed'))       return 'Confirmá tu email antes de iniciar sesión.';
    return 'Error de conexión. Intentá nuevamente.';
  }

  /* ══════════════════════════════════════════════════════════
     MODAL UI
  ══════════════════════════════════════════════════════════ */

  function _buildModal() {
    const div = document.createElement('div');
    div.id        = 'auth-modal-backdrop';
    div.className = 'auth-backdrop';
    div.hidden    = true;
    div.innerHTML = `
      <div class="auth-card" role="dialog" aria-modal="true" aria-label="Iniciar sesión">

        <div class="auth-brand-row">
          <span class="auth-logo">📅</span>
          <div>
            <div class="auth-brand-name">Agenda <span class="auth-brand-yr">2026</span></div>
            <div class="auth-brand-sub">Tu calendario siempre sincronizado</div>
          </div>
        </div>

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

      </div>`;

    document.body.appendChild(div);

    // Tabs login / registro
    div.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        _mode = tab.dataset.tab;
        div.querySelectorAll('.auth-tab').forEach(t =>
          t.classList.toggle('active', t === tab));
        const lbl = _mode === 'login' ? 'Entrar' : 'Crear cuenta';
        document.querySelector('.auth-submit-lbl').textContent = lbl;
        document.getElementById('auth-password').autocomplete =
          _mode === 'login' ? 'current-password' : 'new-password';
        _clearError();
      });
    });

    // Botón enviar
    document.getElementById('auth-submit').addEventListener('click', _submit);

    // Enter en los inputs
    div.querySelectorAll('input').forEach(inp =>
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') _submit(); }));
  }

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

  function _setLoading(on) {
    const btn    = document.getElementById('auth-submit');
    const lbl    = btn?.querySelector('.auth-submit-lbl');
    const spin   = btn?.querySelector('.auth-submit-spin');
    if (!btn) return;
    btn.disabled   = on;
    if (lbl)  lbl.hidden  = on;
    if (spin) spin.hidden = !on;
  }

  function _showError(msg, type = 'error') {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.textContent   = msg;
    el.style.display = 'block';
    el.className     = `auth-err-box ${type === 'success' ? 'auth-err-ok' : 'auth-err-err'}`;
  }

  function _clearError() {
    const el = document.getElementById('auth-error');
    if (el) { el.textContent = ''; el.style.display = 'none'; }
  }

  /* ══════════════════════════════════════════════════════════
     BADGE DE USUARIO EN EL HEADER
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
      <span class="user-avatar" id="user-avatar"></span>
      <span class="user-email-lbl" id="user-email-lbl"></span>
      <button class="btn-logout" id="btn-logout" title="Cerrar sesión">Salir</button>`;

    actions.appendChild(badge);
    document.getElementById('btn-logout')?.addEventListener('click', signOut);
  }

  function _updateBadge(email) {
    const badge   = document.getElementById('user-badge');
    const emailEl = document.getElementById('user-email-lbl');
    const avatarEl= document.getElementById('user-avatar');
    if (badge)    badge.hidden = false;
    if (emailEl)  emailEl.textContent  = email.split('@')[0];
    if (avatarEl) avatarEl.textContent = email[0].toUpperCase();
  }

  function _hideBadge() {
    const badge = document.getElementById('user-badge');
    if (badge) badge.hidden = true;
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
        font-family: inherit;
      }
      .auth-submit:hover:not(:disabled)  { background: #4338ca; }
      .auth-submit:active:not(:disabled) { transform: scale(.98); }
      .auth-submit:disabled { opacity: .65; cursor: not-allowed; }

      /* ── User badge en el header ───────────────────────── */
      .user-badge {
        display: flex; align-items: center; gap: .5rem;
        padding-left: .75rem;
        border-left: 1px solid rgba(255,255,255,.12);
      }
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
      .btn-logout {
        padding: .25rem .6rem; border-radius: 6px; border: none;
        background: rgba(255,255,255,.08); color: rgba(255,255,255,.65);
        font-size: .68rem; font-weight: 500; cursor: pointer;
        transition: all .18s; font-family: inherit;
      }
      .btn-logout:hover { background: rgba(255,255,255,.18); color:#fff; }

      /* Indicador de sincronización */
      .sync-dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: transparent; transition: background .4s;
        flex-shrink: 0;
      }
      .sync-dot.sync-ok  { background: #34d399; box-shadow: 0 0 5px #34d39988; }
      .sync-dot.sync-err { background: #f87171; box-shadow: 0 0 5px #f8717188; }

      @media (max-width: 700px) {
        .user-email-lbl { display: none; }
      }
    `;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════
     API PÚBLICA
  ══════════════════════════════════════════════════════════ */

  function getUser()         { return _user; }
  function getClient()       { return _client; }

  return { init, signOut, getUser, getClient, updateSyncStatus };
})();
