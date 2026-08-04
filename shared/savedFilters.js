// ── Filtros guardados — capa de persistencia compartida (Firestore) ────────
// Mismo patrón que shared/myProjects.js: colección única, un solo listener
// para toda la app, filtrado client-side. Relación 1:N con myProjects
// (cada filtro guardado pertenece a exactamente un proyecto — projectId).
//
// El campo 'filters' es OPACO: se guarda y se lee exactamente como lo
// devuelve getFilterState() del visor correspondiente, sin inspeccionar su
// forma. La responsabilidad de tolerar categorías de filtro que ya no
// existen (o son nuevas) es de applyFilterState() en cada visor — ya es
// defensivo (ver js/filters.js), así que un preset viejo no rompe nada acá.
//
// Uso (una sola instancia compartida entre todos los visores):
//   import { initSavedFilters } from '../shared/savedFilters.js';
//   export const SavedFilters = initSavedFilters();

import {
  getFirestore, collection, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import { app } from './firebase.js';
import { authReady, getUser } from './auth.js';

const db = getFirestore(app);
const COLLECTION = 'savedFilters';

let _instance = null;

export function initSavedFilters() {
  if (_instance) return _instance; // singleton — un solo listener para todo el sitio

  let _filters = [];
  const _listeners = new Set();

  const _notify = () => _listeners.forEach(cb => { try { cb(_filters); } catch {} });

  authReady().then(() => {
    if (!getUser()) return;
    onSnapshot(collection(db, COLLECTION), snap => {
      _filters = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es'));
      _notify();
    }, err => {
      console.error('[savedFilters] onSnapshot error:', err);
    });
  });

  function getFiltersForProject(projectId, visorId) {
    return _filters.filter(f => f.projectId === projectId && f.visorId === visorId);
  }

  function isOwner(f) {
    const user = getUser();
    return !!user && !!f && f.ownerUid === user.uid;
  }

  function onChange(cb) {
    _listeners.add(cb);
    if (_filters.length) cb(_filters);
    return () => _listeners.delete(cb);
  }

  async function addFilter({ projectId, visorId, nombre, filters }) {
    const user = getUser();
    if (!user) throw new Error('No hay sesión activa.');

    // Nombre único por (proyecto, visor) — chequeo client-side, mismo nivel
    // de rigor que el resto de la app (sin transacción/ID determinístico).
    const normalizado = nombre.trim().toLowerCase();
    const existe = getFiltersForProject(projectId, visorId)
      .some(f => (f.nombre ?? '').trim().toLowerCase() === normalizado);
    if (existe) throw new Error(`Ya existe un filtro llamado "${nombre}" para este proyecto.`);

    const ref = await addDoc(collection(db, COLLECTION), {
      projectId, visorId, nombre: nombre.trim(), filters,
      ownerUid:   user.uid,
      ownerEmail: user.email,
      ownerName:  user.displayName ?? user.email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return {
      id: ref.id, projectId, visorId, nombre: nombre.trim(), filters,
      ownerUid: user.uid, ownerEmail: user.email, ownerName: user.displayName ?? user.email,
    };
  }

  async function updateFilter(id, { filters }) {
    const f = _filters.find(x => x.id === id);
    if (!f) throw new Error('Filtro no encontrado.');
    if (!isOwner(f)) throw new Error('Solo el dueño del filtro puede actualizarlo.');
    await updateDoc(doc(db, COLLECTION, id), { filters, updatedAt: serverTimestamp() });
    return { ...f, filters };
  }

  async function deleteFilter(id) {
    const f = _filters.find(x => x.id === id);
    if (!f) return;
    if (!isOwner(f)) throw new Error('Solo el dueño del filtro puede eliminarlo.');
    await deleteDoc(doc(db, COLLECTION, id));
  }

  // Cascade delete — llamado por shared/myProjects.js justo antes de borrar
  // el proyecto padre. No valida ownership por filtro individual: si el
  // caller ya pudo borrar el proyecto, puede limpiar sus hijos.
  async function deleteAllForProject(projectId) {
    const hijos = _filters.filter(f => f.projectId === projectId);
    await Promise.all(hijos.map(f => deleteDoc(doc(db, COLLECTION, f.id))));
  }

  _instance = { getFiltersForProject, addFilter, updateFilter, deleteFilter, deleteAllForProject, isOwner, onChange };
  return _instance;
}
