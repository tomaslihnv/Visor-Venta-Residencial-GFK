// Consultas Recurrentes (Multifamily) — ver shared/recurringQueries.js para
// la implementación real (Firestore, compartida entre usuarios). Este
// archivo solo fija el 'market' de este visor.
import { initRecurringQueries } from '../../shared/recurringQueries.js';

export const { getQueries, getQuery, addQuery, updateQuery, deleteQuery, isOwner, onChange } =
  initRecurringQueries('multifamily');
