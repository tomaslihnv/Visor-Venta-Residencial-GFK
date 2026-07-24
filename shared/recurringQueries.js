// ── Consultas Recurrentes — capa de persistencia compartida (Firestore) ────
// Reemplaza el localStorage por proyecto (que era por navegador, no
// compartido) por una única colección 'recurringQueries' en Firestore:
// cualquier usuario logueado puede VER las consultas de todos, pero solo
// puede EDITAR/BORRAR las suyas (ownerUid). La colección guarda todos los
// visores juntos, filtrando por el campo 'market' — ver firestore.rules
// para la aplicación real de estos permisos (esto de acá es solo la UX;
// el enforcement real vive en las reglas, igual que con el Worker de Inciti).
//
// Uso por visor (ver js/oficinas/recurringQueries.js como ejemplo):
//   import { initRecurringQueries } from '../../shared/recurringQueries.js';
//   export const { getQueries, getQuery, addQuery, updateQuery, deleteQuery,
//                  isOwner, onChange } = initRecurringQueries('oficinas');

import {
  getFirestore, collection, query, where, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import { app } from './firebase.js';
import { authReady, getUser } from './auth.js';

const db = getFirestore(app);
const COLLECTION = 'recurringQueries';

export function initRecurringQueries(market) {
  let _queries = [];
  const _listeners = new Set();

  const _notify = () => _listeners.forEach(cb => { try { cb(_queries); } catch {} });

  authReady().then(() => {
    if (!getUser()) return; // sin sesión: no hay para qué escuchar la colección
    const q = query(collection(db, COLLECTION), where('market', '==', market));
    onSnapshot(q, snap => {
      _queries = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '', 'es'));
      _notify();
    }, err => {
      console.error('[recurringQueries] onSnapshot error:', err);
    });
  });

  function getQueries() { return _queries; }
  function getQuery(id) { return _queries.find(q => q.id === id) ?? null; }

  function isOwner(q) {
    const user = getUser();
    return !!user && !!q && q.ownerUid === user.uid;
  }

  /** Se llama cuando la lista cambia (carga inicial, alta, edición, borrado —
   *  propia o de otro usuario, gracias a onSnapshot en tiempo real). */
  function onChange(cb) {
    _listeners.add(cb);
    if (_queries.length) cb(_queries);
    return () => _listeners.delete(cb);
  }

  async function addQuery({ label, type, comuna = null, polygon = null }) {
    const user = getUser();
    if (!user) throw new Error('No hay sesión activa.');
    const ref = await addDoc(collection(db, COLLECTION), {
      market, label, type, comuna, polygon,
      rememberedSelection: null,
      lastRunAt: null,
      ownerUid:   user.uid,
      ownerEmail: user.email,
      ownerName:  user.displayName ?? user.email,
      createdAt:  serverTimestamp(),
    });
    // onSnapshot actualiza _queries async — devolvemos un objeto ya usable
    // de inmediato para que el caller (ej. "dibujar y correr al toque") no
    // tenga que esperar el round-trip del listener.
    return {
      id: ref.id, market, label, type, comuna, polygon,
      rememberedSelection: null, lastRunAt: null,
      ownerUid: user.uid, ownerEmail: user.email, ownerName: user.displayName ?? user.email,
    };
  }

  async function updateQuery(id, patch) {
    const q = getQuery(id);
    if (!q) throw new Error('Consulta no encontrada.');
    if (!isOwner(q)) throw new Error('Solo el dueño de la consulta puede editarla.');
    await updateDoc(doc(db, COLLECTION, id), patch);
    return { ...q, ...patch };
  }

  async function deleteQuery(id) {
    const q = getQuery(id);
    if (!q) return;
    if (!isOwner(q)) throw new Error('Solo el dueño de la consulta puede eliminarla.');
    await deleteDoc(doc(db, COLLECTION, id));
  }

  return { getQueries, getQuery, addQuery, updateQuery, deleteQuery, isOwner, onChange };
}
