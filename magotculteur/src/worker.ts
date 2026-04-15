import { computeSeq, computeToutFB, computeMultiSite } from './engine';
import type { WorkerInMessage, WorkerOutMessage, AllResults } from './types';

let cancelled = false;

function post(msg: WorkerOutMessage) { self.postMessage(msg); }

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;
  if (msg.type === 'cancel') { cancelled = true; return; }
  if (msg.type !== 'compute') return;

  cancelled = false;
  const { data, opts, fbSite, amount, allowedNLegs, betType, hasSeq } = msg.payload;
  const allResults: AllResults = {};

  // Build computation steps
  const steps: Array<{ label: string; fn: () => void }> = [];

  if (hasSeq) {
    for (const n of [1, 2, 3].filter(n => allowedNLegs.includes(n))) {
      steps.push({
        label: `Séquentiel · ${n} sélection${n > 1 ? 's' : ''}`,
        fn: () => { allResults[`1_${n}`] = computeSeq(data, fbSite, amount, n, betType, opts); },
      });
    }
  }

  for (const n of [1, 2, 3, 4].filter(n => allowedNLegs.includes(n))) {
    if (opts.asymCov && n > 1 && n < 4) {
      // First pass: symmetric only
      steps.push({
        label: `Couverture complète · ${n} matchs`,
        fn: () => {
          allResults[`2_${n}`] = computeToutFB(data, amount, n, betType, { ...opts, asymCov: false });
        },
      });
      // Second pass: symmetric + asymmetric (overwrites with superset)
      steps.push({
        label: `Couverture complète asymétrique · ${n} matchs`,
        fn: () => { allResults[`2_${n}`] = computeToutFB(data, amount, n, betType, opts); },
      });
    } else {
      steps.push({
        label: `Couverture complète · ${n} match${n > 1 ? 's' : ''}`,
        fn: () => { allResults[`2_${n}`] = computeToutFB(data, amount, n, betType, opts); },
      });
    }
  }

  for (const n of [1, 2, 3, 4].filter(n => allowedNLegs.includes(n))) {
    steps.push({
      label: `Couverture multi-sites · ${n} match${n > 1 ? 's' : ''}`,
      fn: () => { allResults[`4_${n}`] = computeMultiSite(data, amount, n, betType, opts); },
    });
  }

  for (let i = 0; i < steps.length; i++) {
    if (cancelled) {
      post({ type: 'cancelled' });
      return;
    }
    post({ type: 'progress', label: steps[i].label, pct: Math.round(i / steps.length * 100) });
    steps[i].fn();
  }

  post({ type: 'result', allResults });
};
