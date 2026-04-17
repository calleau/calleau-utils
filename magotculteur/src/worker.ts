import { compute } from './engine';
import type { WorkerInMessage, WorkerOutMessage } from './types';

let cancelled = false;

function post(msg: WorkerOutMessage) { self.postMessage(msg); }

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;
  if (msg.type === 'cancel') { cancelled = true; return; }
  if (msg.type !== 'compute') return;

  cancelled = false;
  const { data, opts } = msg.payload;

  post({ type: 'progress', label: 'Analyse des données…', detail: '', pct: 5 });

  if (cancelled) { post({ type: 'cancelled' }); return; }

  const results = compute(data, opts, (detail, done, total) => {
    if (cancelled) return;
    const pct = total > 0 ? Math.round(5 + (done / total) * 88) : 50;
    post({ type: 'progress', label: 'Calcul en cours…', detail, pct, done, total });
  });

  if (cancelled) { post({ type: 'cancelled' }); return; }

  post({ type: 'result', results });
};
