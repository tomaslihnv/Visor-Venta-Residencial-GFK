// ── Login de herramienta (Firebase Auth) ────────────────────────────────────
// Un solo gate para TODOS los visores del sitio (Venta, Renta, Multifamily,
// Oficinas, Bodegas, Parques Industriales, Strip Centers, Suelos, Barrio) —
// todos comparten origen, así que Firebase Auth persiste la sesión entre
// ellos: iniciar sesión una vez en cualquier visor basta para el resto.
//
// Esta capa es SOLO la experiencia de usuario (ocultar la app hasta iniciar
// sesión). La seguridad real está en workers/inciti-proxy.js, que verifica
// el ID token en cada request — sin eso, cualquiera que llame al Worker
// directo (sin pasar por esta pantalla) seguiría consumiendo la cuota de
// Inciti igual.

import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { ALLOWED_EMAIL_DOMAIN } from '../js/config.js';
import { app } from './firebase.js';

const auth = getAuth(app);

let _currentUser = null;
let _overlay = null;

function _domainOk(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith('@' + ALLOWED_EMAIL_DOMAIN.toLowerCase());
}

function _injectStyles() {
  if (document.getElementById('authGateStyles')) return;
  const style = document.createElement('style');
  style.id = 'authGateStyles';
  style.textContent = `
    #authGateOverlay {
      position: fixed; inset: 0; z-index: 999999;
      background: #0f172a; color: #e2e8f0;
      display: flex; align-items: center; justify-content: center;
      font-family: system-ui, -apple-system, sans-serif;
    }
    #authGateCard {
      background: #1e293b; border-radius: 12px; padding: 40px;
      max-width: 380px; width: 90%; text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    }
    #authGateCard h1 { font-size: 18px; margin: 0 0 8px; color: #f1f5f9; }
    #authGateCard p  { font-size: 13px; color: #94a3b8; margin: 0 0 24px; line-height: 1.5; }
    #authGateBtn {
      display: inline-flex; align-items: center; gap: 10px;
      background: #fff; color: #1f2937; border: none; border-radius: 8px;
      padding: 11px 20px; font-size: 14px; font-weight: 600; cursor: pointer;
    }
    #authGateBtn:hover { background: #f1f5f9; }
    #authGateError { color: #f87171; font-size: 12px; margin-top: 16px; display: none; }
    #authGateSpinner {
      width: 28px; height: 28px; border: 3px solid #334155; border-top-color: #60a5fa;
      border-radius: 50%; animation: authGateSpin 0.8s linear infinite; margin: 0 auto;
    }
    @keyframes authGateSpin { to { transform: rotate(360deg); } }
    .auth-user-chip {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 12px; color: #64748b; margin-left: 8px;
    }
    .auth-user-chip button {
      background: none; border: none; color: #94a3b8; text-decoration: underline;
      cursor: pointer; font-size: 12px; padding: 0;
    }
  `;
  document.head.appendChild(style);
}

let _pendingError = null;

function _showOverlay(state) {
  _injectStyles();
  if (!_overlay) {
    _overlay = document.createElement('div');
    _overlay.id = 'authGateOverlay';
    document.documentElement.appendChild(_overlay);
  }
  if (state === 'loading') {
    _overlay.innerHTML = `<div id="authGateSpinner"></div>`;
  } else if (state === 'login') {
    _overlay.innerHTML = `
      <div id="authGateCard">
        <h1>Visor de Mercado Inmobiliario</h1>
        <p>Inicia sesión con tu cuenta ${esc(ALLOWED_EMAIL_DOMAIN)} para continuar.</p>
        <button id="authGateBtn">Iniciar sesión con Google</button>
        <div id="authGateError"></div>
      </div>`;
    document.getElementById('authGateBtn').addEventListener('click', _signIn);
    // onAuthStateChanged puede re-renderizar esta pantalla justo después de
    // que _signIn() puso un error (ej. dominio no permitido) — sin esto, el
    // mensaje quedaba pisado antes de que el usuario alcanzara a leerlo.
    if (_pendingError) { _showError(_pendingError); _pendingError = null; }
  }
}

function _hideOverlay() {
  _overlay?.remove();
  _overlay = null;
}

function _showError(msg) {
  // Se guarda SIEMPRE (no solo cuando no hay elemento visible): si justo
  // después de esto onAuthStateChanged reconstruye la tarjeta de login
  // (ej. porque se acaba de hacer signOut por dominio no permitido), ese
  // rebuild vuelve a aplicar este mensaje en vez de perderlo.
  _pendingError = msg;
  const el = document.getElementById('authGateError');
  if (el) { el.textContent = msg; el.style.display = ''; }
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function _signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: ALLOWED_EMAIL_DOMAIN });
  try {
    const result = await signInWithPopup(auth, provider);
    if (!_domainOk(result.user.email)) {
      _showError(`Solo cuentas @${ALLOWED_EMAIL_DOMAIN}. Sesión cerrada.`);
      await signOut(auth);
    }
  } catch (err) {
    if (err?.code !== 'auth/popup-closed-by-user') {
      _showError('No se pudo iniciar sesión: ' + (err?.message ?? err));
    }
  }
}

// Oculta la app inmediatamente (antes de saber si hay sesión) para que no
// haya un parpadeo mostrando datos antes del check de auth.
_showOverlay('loading');

let _resolveReady;
const _ready = new Promise(res => { _resolveReady = res; });

onAuthStateChanged(auth, user => {
  if (user && _domainOk(user.email)) {
    _currentUser = user;
    _hideOverlay();
    _paintUserChip(user);
  } else {
    if (user && !_domainOk(user.email)) signOut(auth);
    _currentUser = null;
    _showOverlay('login');
  }
  _resolveReady();
});

function _paintUserChip(user) {
  document.querySelectorAll('.topbar-actions, .header-actions').forEach(bar => {
    if (bar.querySelector('.auth-user-chip')) return;
    const chip = document.createElement('span');
    chip.className = 'auth-user-chip';
    chip.innerHTML = `${esc(user.email)} · <button type="button">Cerrar sesión</button>`;
    chip.querySelector('button').addEventListener('click', () => signOut(auth));
    bar.appendChild(chip);
  });
}

/** Resuelve cuando el estado de auth inicial ya se resolvió (con o sin sesión). */
export function authReady() { return _ready; }

/** Usuario actual (null si no hay sesión válida). */
export function getUser() { return _currentUser; }

/** Token fresco para mandar al Worker (Authorization: Bearer <token>). */
export async function getIdToken() {
  if (!_currentUser) throw new Error('No hay sesión activa.');
  return _currentUser.getIdToken();
}

export function signOutUser() { return signOut(auth); }
