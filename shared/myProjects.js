// ── Mi Proyecto — capa de persistencia compartida (Firestore) ──────────────
// Mismo patrón que shared/recurringQueries.js: colección única en Firestore,
// cualquier usuario logueado puede VER todos los proyectos, pero solo puede
// EDITAR/BORRAR el suyo (ownerUid) o uno donde el dueño le haya dado permiso
// explícito (editorEmails) — ver firestore.rules para el enforcement real,
// esto de acá es solo la UX.
//
// A diferencia de recurringQueries, NO se filtra por 'market': un mismo
// proyecto es transversal a todos los visores (se puede comparar en Venta,
// Renta, Multifamily, etc. al mismo tiempo). El campo 'tipo' es solo una
// etiqueta informativa, no restringe dónde se puede usar.
//
// Uso (una sola instancia compartida entre todos los visores):
//   import { initMyProjects } from '../shared/myProjects.js';
//   export const MyProjects = initMyProjects();

import {
  getFirestore, collection, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import { app } from './firebase.js';
import { authReady, getUser } from './auth.js';
import { initSavedFilters } from './savedFilters.js';

const db = getFirestore(app);
const COLLECTION = 'myProjects';

let _instance = null;

export function initMyProjects() {
  if (_instance) return _instance; // singleton — un solo listener para todo el sitio

  const SavedFilters = initSavedFilters();
  let _projects = [];
  const _listeners = new Set();

  const _notify = () => _listeners.forEach(cb => { try { cb(_projects); } catch {} });

  authReady().then(() => {
    if (!getUser()) return; // sin sesión: no hay para qué escuchar la colección
    onSnapshot(collection(db, COLLECTION), snap => {
      _projects = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es'));
      _notify();
    }, err => {
      console.error('[myProjects] onSnapshot error:', err);
    });
  });

  function getProjects() { return _projects; }
  function getProject(id) { return _projects.find(p => p.id === id) ?? null; }

  function isOwner(p) {
    const user = getUser();
    return !!user && !!p && p.ownerUid === user.uid;
  }

  function canEdit(p) {
    if (isOwner(p)) return true;
    const user = getUser();
    return !!user && !!p && (p.editorEmails ?? []).includes(user.email);
  }

  /** Se llama cuando la lista cambia (carga inicial, alta, edición, borrado —
   *  propia o de otro usuario, gracias a onSnapshot en tiempo real). */
  function onChange(cb) {
    _listeners.add(cb);
    if (_projects.length) cb(_projects);
    return () => _listeners.delete(cb);
  }

  async function addProject({ nombre, direccion = '', tipo = '', tipologias = [], editorEmails = [] }) {
    const user = getUser();
    if (!user) throw new Error('No hay sesión activa.');
    const ref = await addDoc(collection(db, COLLECTION), {
      nombre, direccion, tipo, tipologias,
      ownerUid:   user.uid,
      ownerEmail: user.email,
      ownerName:  user.displayName ?? user.email,
      editorEmails,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    // onSnapshot actualiza _projects async — devolvemos un objeto ya usable
    // de inmediato para que el caller no tenga que esperar el round-trip.
    return {
      id: ref.id, nombre, direccion, tipo, tipologias,
      ownerUid: user.uid, ownerEmail: user.email, ownerName: user.displayName ?? user.email,
      editorEmails,
    };
  }

  async function updateProject(id, patch) {
    const p = getProject(id);
    if (!p) throw new Error('Proyecto no encontrado.');
    if (!canEdit(p)) throw new Error('No tienes permiso para editar este proyecto.');
    await updateDoc(doc(db, COLLECTION, id), { ...patch, updatedAt: serverTimestamp() });
    return { ...p, ...patch };
  }

  async function deleteProject(id) {
    const p = getProject(id);
    if (!p) return;
    // El borrado se restringe al dueño (no a cualquier editor) — un editor
    // con permiso para modificar tipologías no debería poder eliminar el
    // proyecto completo de otra persona.
    if (!isOwner(p)) throw new Error('Solo el dueño del proyecto puede eliminarlo.');
    // Cascade delete: los filtros guardados no tienen sentido sin su
    // proyecto (relación 1:N). Se borran los hijos ANTES que el padre —
    // si esto falla a mitad de camino, el proyecto sigue existiendo y los
    // filtros huérfanos remanentes quedan visibles/corregibles, en vez de
    // quedar apuntando a un projectId que ya no existe.
    await SavedFilters.deleteAllForProject(id);
    await deleteDoc(doc(db, COLLECTION, id));
  }

  _instance = { getProjects, getProject, addProject, updateProject, deleteProject, isOwner, canEdit, onChange };
  return _instance;
}
