export const INCITI_PROXY_URL = 'https://inciti-proxy.situanalisis.workers.dev';

// ── Login de herramienta (Firebase Auth) ────────────────────────────────────
// Gate a nivel de HERRAMIENTA (no por visor de mercado): un solo login sirve
// para todos los visores del sitio, porque todos comparten origen y Firebase
// Auth persiste la sesión en el navegador. La config de cliente de Firebase
// NO es secreta (a diferencia de INCITI_API_KEY) — la seguridad real la hace
// el Worker verificando el ID token, no el ocultamiento de esta config.
//
// Completar con los valores de Firebase Console → Configuración del proyecto
// → General → "Tus apps" → Config del SDK.
export const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyBPGtsizfWQ8cHpU2nS7Rg4XVSD8KGkzu0',
  authDomain:        'visor-estudio-mercado.firebaseapp.com',
  projectId:         'visor-estudio-mercado',
  storageBucket:     'visor-estudio-mercado.firebasestorage.app',
  messagingSenderId: '724974563156',
  appId:             '1:724974563156:web:264bc797d26afc766f62c1',
};

// Dominio de correo permitido para iniciar sesión (Google Workspace).
export const ALLOWED_EMAIL_DOMAIN = 'situ.cl';
