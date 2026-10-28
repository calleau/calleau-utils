// API du Magotculteur : même moteur que l'interface (src/engine.ts), servi en HTTP.
// Service interne (réseau Docker), sans état. Construit par api/build.mjs en un seul
// fichier, qui sert aussi de script aux workers de calcul.
//
//   GET  /health   → { ok, version, coverageRules }
//   POST /compute  → { version, durationMs, workers, total, results: [...résultat, links] }
//
// Cf. api/README.md pour le format.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { compute } from '../src/engine';
import { resultLinks } from '../src/links';

/* global __MAGOTCULTEUR_VERSION__ */
const VERSION = typeof __MAGOTCULTEUR_VERSION__ !== 'undefined' ? __MAGOTCULTEUR_VERSION__ : 'dev';

if (!isMainThread) {
  // Worker : calcule une part (shard) des combinaisons.
  const { data, opts, shard } = workerData;
  parentPort.postMessage(compute(data, opts, undefined, shard));
} else {
  startServer();
}

function startServer() {
  const PORT = Number(process.env.PORT || 8080);
  // Par défaut : assets/ du dépôt, vu depuis le bundle (utilitaires/magotculteur/api/dist/).
  const ASSETS_DIR = process.env.ASSETS_DIR || resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../assets');
  const LINKS_BASE_URL = process.env.LINKS_BASE_URL || 'https://utils.calleau.org/';
  // Au-delà de 8, chaque worker refait les calculs préparatoires pour un gain négligeable.
  const WORKERS = Math.max(1, Number(process.env.WORKERS) || Math.min(availableParallelism(), containerCpuLimit(), 8));
  const MAX_BODY_BYTES = (Number(process.env.MAX_BODY_MB) || 50) * 1024 * 1024;
  const API_TOKEN = process.env.API_TOKEN || '';

  const readJson = name => JSON.parse(readFileSync(resolve(ASSETS_DIR, name), 'utf8'));
  const repoRules = readJson('coverage-rules.json');
  const sitesInfo = readJson('sites-informations.json');

  // Un calcul à la fois : chacun occupe déjà tous les cœurs.
  let queue = Promise.resolve();
  const enqueue = job => { const run = queue.then(job, job); queue = run.catch(() => {}); return run; };

  const runShards = (data, opts) => Promise.all(Array.from({ length: WORKERS }, (_, index) =>
    new Promise((ok, ko) => {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { data, opts, shard: { index, count: WORKERS } } });
      w.once('message', ok);
      w.once('error', ko);
      w.once('exit', code => { if (code !== 0) ko(new Error(`worker arrêté (code ${code})`)); });
    })));

  async function handleCompute(body) {
    const { engineOpts, data } = body;
    if (!engineOpts || typeof engineOpts !== 'object') throw httpError(400, '"engineOpts" manquant');
    if (!data || typeof data !== 'object') throw httpError(400, '"data" manquant (cotes au format Betxtractor)');
    if (!engineOpts.sites || !Array.isArray(engineOpts.allowedNLegs) || !engineOpts.betType)
      throw httpError(400, '"engineOpts" incomplet : "sites", "allowedNLegs" et "betType" sont requis');

    // Règles : celles de la requête, sinon celles d'engineOpts (fichier de debug rejoué),
    // sinon celles du dépôt.
    const coverageRules = body.coverageRules ?? engineOpts.coverageRules ?? repoRules;
    const opts = { ...engineOpts, coverageRules };

    const t0 = Date.now();
    const results = (await enqueue(() => runShards(data, opts))).flat().sort((a, b) => b.profit - a.profit);
    const durationMs = Date.now() - t0;

    const minProfit = body.minProfit ?? null;
    const limit = Math.max(0, Number(body.limit ?? 50));
    const kept = results.filter(r => minProfit === null || r.profit >= minProfit).slice(0, limit);
    const ctx = { data, sitesInfo, amountMode: opts.amountMode, baseUrl: body.linksBaseUrl || LINKS_BASE_URL };
    return {
      version: VERSION,
      durationMs,
      workers: WORKERS,
      total: results.length,
      results: kept.map(r => ({ ...r, links: resultLinks(r, ctx) })),
    };
  }

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        return send(res, 200, { ok: true, version: VERSION, coverageRules: repoRules.length });
      }
      if (API_TOKEN && req.headers.authorization !== `Bearer ${API_TOKEN}`) throw httpError(401, 'jeton invalide');
      if (req.method === 'POST' && req.url === '/compute') {
        return send(res, 200, await handleCompute(await readBody(req, MAX_BODY_BYTES)));
      }
      throw httpError(404, 'route inconnue (GET /health, POST /compute)');
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      send(res, status, { error: err.message || String(err) });
    }
  });
  server.requestTimeout = 0; // un calcul peut durer plusieurs minutes
  server.listen(PORT, () =>
    console.log(`magotculteur-api ${VERSION} sur :${PORT} (${WORKERS} workers, ${repoRules.length} règles, liens → ${LINKS_BASE_URL})`));
}

// Limite CPU du conteneur (cgroup v2 puis v1). availableParallelism() renvoie les cœurs
// de la machine hôte : avec --cpus=2 sur 16 cœurs, 16 workers rendaient le calcul ×5 plus lent.
function containerCpuLimit() {
  const read = p => { try { return readFileSync(p, 'utf8').trim(); } catch { return null; } };
  const v2 = read('/sys/fs/cgroup/cpu.max')?.split(/\s+/);
  if (v2 && v2[0] !== 'max') return Math.max(1, Math.ceil(Number(v2[0]) / Number(v2[1])));
  const quota = Number(read('/sys/fs/cgroup/cpu/cpu.cfs_quota_us')), period = Number(read('/sys/fs/cgroup/cpu/cpu.cfs_period_us'));
  if (quota > 0 && period > 0) return Math.max(1, Math.ceil(quota / period));
  return Infinity;
}

function httpError(status, message) { return Object.assign(new Error(message), { status }); }

function send(res, status, obj) {
  const json = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function readBody(req, maxBytes) {
  return new Promise((ok, ko) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > maxBytes) { ko(httpError(413, `corps trop volumineux (> ${maxBytes / 1048576} Mo)`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { ko(httpError(400, 'JSON invalide')); }
    });
    req.on('error', ko);
  });
}
