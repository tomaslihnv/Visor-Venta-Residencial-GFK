// Instancia única de Firebase App — auth.js y recurringQueries.js importan
// de acá en vez de llamar initializeApp() cada uno por su cuenta (Firebase
// tira error si initializeApp() se llama dos veces con la misma config).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { FIREBASE_CONFIG } from '../js/config.js';

export const app = initializeApp(FIREBASE_CONFIG);
