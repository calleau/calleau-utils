import { compute } from './engine';
import type { WorkerInMessage, WorkerOutMessage } from './types';

// Pas d'annulation par message : le calcul est synchrone, l'interface arrête le worker
// (terminate) pour annuler.

function post(msg: WorkerOutMessage) { self.postMessage(msg); }

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;
  if (msg.type !== 'compute') return;

  const { data, opts, shard } = msg.payload;

  post({ type: 'progress', label: 'Analyse des données…', detail: '', pct: 5 });

  const results = compute(data, opts, (detail, done, total) => {
    const pct = total > 0 ? Math.round(5 + (done / total) * 88) : 50;
    post({ type: 'progress', label: 'Calcul en cours…', detail, pct, done, total });
  }, shard);

  post({ type: 'result', results });
};
