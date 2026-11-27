import type {
  BetSpec, CoverageRule, EngineOpts, Cover, Leg, LegRef, LayInfo,
  BetDetail, CoveringSetResult, AllResults, BetType, SiteConfig, AmountConstraint, SeqTiming
} from './types';

export const MIN_GAP_MS = 90 * 60 * 1000;
const TOP_EVENTS = 30;
const TOP_SEQ = 50;
// Tolérance (€) des contrôles de montant des missions : une mise calée exactement sur
// le montant peut retomber juste en dessous par arrondi flottant (10 → 9,999999999999998).
const AMOUNT_EPS = 1e-6;

// Cote affichée au-dessus de la cote max (EngineOpts.coteMax), si elle est renseignée.
function aboveCoteMax(odds: number, opts: EngineOpts): boolean {
  return (opts.coteMax ?? 0) > 0 && odds > opts.coteMax!;
}

// Contraintes de montant Cash (cf. EngineOpts.amountConstraints).
function amountConstraints(opts: EngineOpts): AmountConstraint[] {
  const list = (opts.amountConstraints ?? []).filter(c => c.amount > 0);
  return list.length ? list : [{ mode: opts.amountMode, amount: opts.amount }];
}

function C(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let r = 1;
  for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
  return Math.round(r);
}

// ===== HELPERS =====

export function isExchange(val: any): boolean {
  return val !== null && typeof val === 'object' && !Array.isArray(val) && ('Back' in val || 'Lay' in val);
}

export function getBackOdds(val: any): number | null {
  if (typeof val === 'number') return val;
  if (isExchange(val)) return val.Back?.odds_net ?? val.Back?.odds ?? null;
  if (val && typeof val === 'object' && typeof val.odds === 'number') return val.odds;
  return null;
}

// Gross back odds (pre-commission). For non-exchange sites this is the same as
// getBackOdds; for exchange sites we return the listed `odds` (not odds_net).
// Used for *display* — math always uses the net via getBackOdds.
export function getBackOddsGross(val: any): number | null {
  if (typeof val === 'number') return val;
  if (isExchange(val)) return val.Back?.odds ?? val.Back?.odds_net ?? null;
  if (val && typeof val === 'object' && typeof val.odds === 'number') return val.odds;
  return null;
}

export function getLayInfo(val: any): LayInfo | null {
  if (!isExchange(val) || !val.Lay) return null;
  const lGross = val.Lay.odds ?? null;
  const lNet = val.Lay.odds_net ?? null;
  if (!lNet || lNet <= 1) return null;
  const c = (lGross && lGross > 1) ? 1 - (lNet - 1) / (lGross - 1) : 0;
  const k = (lGross && lGross > 1) ? (lGross - c) / (1 - c) : lNet;
  return { lGross: lGross ?? lNet, lNet, c, k };
}

function kFromBk(odds: number) { return odds / (odds - 1); }

// Bookmakers arrondissent la cote finale d'un combiné à 2 décimales avant
// d'appliquer les gains. Le moteur fait pareil pour que les calculs (rate,
// stakes, profits) reflètent le vrai retour reçu par l'utilisateur.
function roundCombo(x: number): number { return Math.round(x * 100) / 100; }

export function norm(s: string) { return s.toLowerCase().trim().replace(/[:.;,!?]+$/, ''); }

export function collectSites(data: any): string[] {
  const sites = new Set<string>();
  for (const event of Object.values(data) as any[]) {
    for (const market of Object.values(event.markets || {}) as any[]) {
      for (const oddsMap of Object.values(market) as any[]) {
        if (oddsMap && typeof oddsMap === 'object' && !Array.isArray(oddsMap)) {
          for (const [site, val] of Object.entries(oddsMap))
            if (val != null && (typeof val === 'number' || typeof val === 'object')) sites.add(site);
        }
      }
    }
  }
  return [...sites].sort();
}

export function eventDisplayName(eventKey: string, event: any): string {
  if (Array.isArray(event.opponents) && event.opponents.length >= 2)
    return event.opponents.join(' vs ');
  if (event.opponents && typeof event.opponents === 'object') {
    const vals = Object.values(event.opponents) as string[];
    if (vals.length >= 2) return vals.join(' vs ');
  }
  const m = eventKey.match(/^[^_]+_(.+?)_\d{4}-\d{2}-\d{2}/);
  return m ? m[1] : eventKey;
}

export function formatDate(dt: string | null | undefined): string {
  if (!dt) return '';
  try {
    const d = new Date(dt);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
      + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

// ===== COVERAGE RULES ENGINE =====

function isRegexStr(s: string): boolean { return typeof s === 'string' && s.startsWith('/'); }

function parseRegexStr(s: string): RegExp | null {
  const m = s.match(/^\/(.*)\/([gimsuy]*)$/);
  return m ? new RegExp(m[1], m[2] || 'i') : null;
}

function resolveTemplate(template: string, bindings: Record<string, string>): string {
  return template.replace(/\$(\w+)(~[^\s$]+)?/g, (_, ref, transform) => {
    let val = ref === 'market' ? (bindings.$market || '') : (bindings[`$${ref}`] ?? '');
    if (transform === '~12')
      val = val.replace(/1/g, '\x00').replace(/2/g, '1').replace(/\x00/g, '2');
    else if (transform === '~+-')
      val = val.replace(/\+/g, '\x00').replace(/-/g, '+').replace(/\x00/g, '-');
    return val;
  });
}

function matchBetSpec(spec: BetSpec, marketName: string, outcomeName: string): Record<string, string> | null {
  let bindings: Record<string, string> = {};
  if (isRegexStr(spec.market)) {
    const re = parseRegexStr(spec.market);
    const m = re && marketName.match(re);
    if (!m) return null;
    bindings.$market = marketName;
    for (let i = 1; i < m.length; i++) bindings[`$m${i}`] = m[i];
  } else if (spec.market.includes('$')) {
    return null;
  } else {
    if (norm(spec.market) !== norm(marketName)) return null;
    bindings.$market = marketName;
  }
  if (isRegexStr(spec.issue)) {
    const re = parseRegexStr(spec.issue);
    const m = re && outcomeName.match(re);
    if (!m) return null;
    for (let i = 1; i < m.length; i++) bindings[`$${i}`] = m[i];
  } else if (spec.issue.includes('$')) {
    if (norm(resolveTemplate(spec.issue, bindings)) !== norm(outcomeName)) return null;
  } else {
    if (norm(spec.issue) !== norm(outcomeName)) return null;
  }
  return bindings;
}

function resolveCoverSpec(spec: BetSpec, bindings: Record<string, string>): { market: string; issue: string; betType: 'Back' | 'Lay' } | null {
  if (isRegexStr(spec.market) || isRegexStr(spec.issue)) return null;
  const market = resolveTemplate(spec.market, bindings);
  const issue = resolveTemplate(spec.issue, bindings);
  return (market && issue) ? { market, issue, betType: spec.betType } : null;
}

function hasPrice(oddsMap: any, betType: 'Back' | 'Lay'): boolean {
  for (const val of Object.values(oddsMap || {})) {
    if (betType === 'Back') {
      const o = getBackOdds(val);
      if (o && o > 1) return true;
    } else {
      if (getLayInfo(val)) return true;
    }
  }
  return false;
}

function findMarketEntry(markets: any, marketName: string): [string, any] | null {
  const n = norm(marketName);
  for (const [name, market] of Object.entries(markets))
    if (norm(name) === n) return [name, market];
  return null;
}

function findOutcomeEntry(market: any, outcomeName: string): [string, any] | null {
  const n = norm(outcomeName);
  for (const [name, oddsMap] of Object.entries(market))
    if (norm(name) === n) return [name, oddsMap];
  return null;
}

// ===== COVER SEARCH (for sequential method) =====

function findCoversForOutcome(event: any, mainMarketName: string, mainOutcomeName: string, mainBetType: 'Back' | 'Lay', site: string, opts: EngineOpts): Cover[] {
  const covers: Cover[] = [];
  const seen = new Set<string>();
  for (const rule of opts.coverageRules) {
    if (rule.issues !== 2) continue;
    const sideKeys = (['A', 'B'] as const).filter(k => rule[k]);
    for (const sideAKey of sideKeys) {
      const sideBKey = sideKeys.find(k => k !== sideAKey)!;
      for (const opt of rule[sideAKey]!) {
        if (opt.betType !== mainBetType) continue;
        const bindings = matchBetSpec(opt, mainMarketName, mainOutcomeName);
        if (!bindings) continue;
        for (const coverOpt of rule[sideBKey]!) {
          const resolved = resolveCoverSpec(coverOpt, bindings);
          if (!resolved) continue;
          const mEntry = findMarketEntry(event.markets || {}, resolved.market);
          if (!mEntry) continue;
          const [mName, mData] = mEntry;
          const oEntry = findOutcomeEntry(mData, resolved.issue);
          if (!oEntry) continue;
          const [oName, oddsMap] = oEntry;
          for (const [s, val] of Object.entries(oddsMap as any)) {
            if (resolved.betType === 'Lay' && s === site) continue;
            // Uni-site / Multi-sites (séquentiel) : la couverture est sur le site du
            // principal (uni) ou sur un autre (multi). Filtrer ici plutôt que les
            // résultats, sinon bestCover peut tomber sur une méthode décochée.
            if (s === site ? !opts.allowUni : !opts.allowMulti) continue;
            if (resolved.betType === 'Lay') {
              const lay = getLayInfo(val);
              if (!lay) continue;
              const key = `L:${mName}:${oName}:${s}`;
              if (seen.has(key)) continue; seen.add(key);
              covers.push({ type: 'lay', site: s, marketName: mName, outcomeName: oName,
                odds: lay.lNet, oddsGross: lay.lGross, lGross: lay.lGross, c: lay.c, k: lay.k });
            } else {
              const o = getBackOdds(val);
              if (!o || o <= 1) continue;
              const oGross = getBackOddsGross(val) ?? o;
              // Cotes min. et max. : comme en simultané, aussi pour une couverture sur le site
              // du principal (tous les paris du site principal).
              if (s === site && opts.coteMin > 0 && oGross < opts.coteMin) continue;
              if (s === site && aboveCoteMax(oGross, opts)) continue;
              const key = `B:${mName}:${oName}:${s}`;
              if (seen.has(key)) continue; seen.add(key);
              covers.push({ type: 'bk', site: s, marketName: mName, outcomeName: oName,
                odds: o, oddsGross: oGross, lGross: null, c: null, k: kFromBk(o) });
            }
          }
        }
        break;
      }
    }
  }
  return covers;
}

function collectLegsForSite(data: any, site: string, opts: EngineOpts): Leg[] {
  const legs: Leg[] = [];
  for (const [eventKey, event] of Object.entries(data) as [string, any][]) {
    const evName = eventDisplayName(eventKey, event);
    const evDate = formatDate(event.dateTime);
    const evComp = event.competition || event.tournoi || '';
    const dateTime = event.dateTime ? new Date(event.dateTime).getTime() : null;
    for (const [marketName, market] of Object.entries(event.markets || {}) as [string, any][]) {
      for (const [outcomeName, oddsMap] of Object.entries(market) as [string, any][]) {
        if (!oddsMap || typeof oddsMap !== 'object' || Array.isArray(oddsMap)) continue;
        const fbVal = oddsMap[site];
        if (fbVal == null) continue;

        // Back principal candidate
        const b = getBackOdds(fbVal);
        const bGross = getBackOddsGross(fbVal) ?? b;
        // Pas de filtre coteMin par sélection : en séquentiel, la cote min. porte sur la cote
        // du combiné (trySeqCombo), comme en simultané.
        if (b && b > 1 && bGross) {
          const covers = findCoversForOutcome(event, marketName, outcomeName, 'Back', site, opts);
          if (covers.length) {
            const bestCover = covers.reduce((best, cov) => cov.k < best.k ? cov : best);
            legs.push({ eventKey, evName, evDate, evComp, dateTime, marketName, outcomeName, betType: 'Back', b, bGross, layInfo: null, covers, bestCover, bestK: bestCover.k });
          }
        }

        // Pas de principal Lay : un combiné ne peut pas être Lay (le séquentiel ne fait que des combinés).
      }
    }
  }
  return legs;
}

// ===== COVER SET GENERATORS =====

// The alternatives of a rule side are equivalent ways to bet the same outcome. Drop
// those beaten everywhere: another alternative of the same bet type is priced on each
// of their sites at odds at least as high. Lossless (same site, odds ≥, so coteMin and
// missions pass too) and keeps the cartesian product of sides small — e.g. 9-sided
// HT/FT with two equivalent markets on one bookmaker would otherwise yield 2^9 sets.
function pruneDominatedAlts(event: any, alts: LegRef[]): LegRef[] {
  if (alts.length < 2) return alts;
  const prices = alts.map(l => {
    const m = new Map<string, number>();
    for (const [site, val] of Object.entries(event.markets?.[l.marketName]?.[l.outcomeName] || {})) {
      let o: number | null;
      if (l.betType === 'Lay') {
        const lay = getLayInfo(val);
        o = lay && lay.lGross > 1 ? (lay.lGross - lay.c) / (lay.lGross - 1) : null;
      } else o = getBackOdds(val);
      if (o && o > 1) m.set(site, o);
    }
    return m;
  });
  const dominates = (j: number, i: number) => alts[j].betType === alts[i].betType
    && [...prices[i]].every(([site, o]) => (prices[j].get(site) ?? 0) >= o);
  // Equal everywhere (mutual dominance): keep the first one.
  return alts.filter((_, i) => !alts.some((_, j) => j !== i && dominates(j, i) && !(dominates(i, j) && i < j)));
}

// Build covering sets for an event, supporting both literal rules (rule#1..#5)
// and template/regex rules (rule#6..#7, wildcard). Strategy: try each side as
// "anchor". An anchor opt with a directly-matchable spec is matched against
// every market/outcome of the event, producing bindings. All sides then
// resolve their alternatives (literal-or-template, via resolveCoverSpec) from
// those bindings, including the anchor side itself (the anchor leg is added
// directly). Cartesian product gives the covering sets; sorted (betType,market,
// outcome) keys dedupe across anchors.
function getCoverSets(data: any, eventKey: string, opts: EngineOpts): LegRef[][][] {
  const event = data[eventKey];
  if (!event) return [];
  const sets: LegRef[][][] = [];
  const seen = new Set<string>();

  for (const rule of opts.coverageRules) {
    const sideKeys = (['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const).filter(k => rule[k]);
    if (sideKeys.length < 2) continue;

    for (const anchorKey of sideKeys) {
      for (const anchorOpt of rule[anchorKey]!) {
        // The anchor opt must be directly matchable (not template-only).
        // matchBetSpec returns null for opts with $-templates that aren't regex.
        for (const [marketName, market] of Object.entries(event.markets || {}) as [string, any][]) {
          for (const [outcomeName, oddsMap] of Object.entries(market) as [string, any][]) {
            if (!oddsMap || typeof oddsMap !== 'object' || Array.isArray(oddsMap)) continue;
            const bindings = matchBetSpec(anchorOpt, marketName, outcomeName);
            if (!bindings) continue;
            if (!hasPrice(oddsMap, anchorOpt.betType)) continue;

            // Build per-side alternatives using these bindings.
            const sideAlts: LegRef[][] = [];
            let valid = true;
            for (const sk of sideKeys) {
              const alts: LegRef[] = [];
              const seenLeg = new Set<string>();
              const pushLeg = (mName: string, oName: string, betType: 'Back' | 'Lay') => {
                const key = `${betType}:${mName}:${oName}`;
                if (seenLeg.has(key)) return;
                seenLeg.add(key);
                alts.push({ eventKey, marketName: mName, outcomeName: oName, betType });
              };
              for (const opt of rule[sk]!) {
                if (sk === anchorKey && opt === anchorOpt) {
                  pushLeg(marketName, outcomeName, opt.betType);
                  continue;
                }
                const resolved = resolveCoverSpec(opt, bindings);
                if (!resolved) continue;
                const mEntry = findMarketEntry(event.markets || {}, resolved.market);
                if (!mEntry) continue;
                const oEntry = findOutcomeEntry(mEntry[1], resolved.issue);
                if (!oEntry) continue;
                if (!hasPrice(oEntry[1], resolved.betType)) continue;
                pushLeg(mEntry[0], oEntry[0], resolved.betType);
              }
              if (!alts.length) { valid = false; break; }
              sideAlts.push(pruneDominatedAlts(event, alts));
            }
            if (!valid) continue;

            // Cartesian product over per-side alternatives
            let combos: LegRef[][] = [[]];
            for (const alts of sideAlts) {
              const next: LegRef[][] = [];
              for (const prev of combos)
                for (const leg of alts) next.push([...prev, leg]);
              combos = next;
            }
            for (const legs of combos) {
              const key = legs.map(l => `${l.betType}:${l.marketName}:${l.outcomeName}`).sort().join('|');
              if (seen.has(key)) continue;
              seen.add(key);
              sets.push(legs.map(l => [l]));
            }
          }
        }
      }
    }
  }
  return sets;
}

// For asym-light: one "anchor" event has its cover sides split into K combined sides
// (cross-producted with full sym covers of other events) + (total-K) single sides.
export interface AsymLightSplit {
  anchorIdx: number;
  comboSides: LegRef[][];
  singleSides: LegRef[][];
  otherCoverSets: LegRef[][][]; // aligned with eventKeys excluding anchorIdx
}

// Cover sets with many sides (e.g. 9-sided HT/FT) are only used for single-match covers:
// combined with another match they give 10+ bets with long-shot odds, and asym-light
// would enumerate 2^k splits per set.
const MAX_SIDES_IN_COMBO = 4;

function getComboCoverSets(data: any, eventKey: string, opts: EngineOpts): LegRef[][][] {
  return getCoverSets(data, eventKey, opts).filter(cs => cs.length <= MAX_SIDES_IN_COMBO);
}

function getAsymLightSplits(data: any, eventKeys: string[], opts: EngineOpts): AsymLightSplit[] {
  const out: AsymLightSplit[] = [];
  const csPerEvent = eventKeys.map(ek => getComboCoverSets(data, ek, opts));
  if (csPerEvent.some(s => !s.length)) return out;

  for (let anchorIdx = 0; anchorIdx < eventKeys.length; anchorIdx++) {
    const anchorCoverSets = csPerEvent[anchorIdx];
    const otherCoverSetLists = eventKeys.map((_, i) => csPerEvent[i]).filter((_, i) => i !== anchorIdx);
    for (const anchorCs of anchorCoverSets) {
      const k = anchorCs.length;
      if (k < 2) continue;
      const sideIdxs = anchorCs.map((_, i) => i);
      for (let K = 1; K <= k - 1; K++) {
        forEachCombo(sideIdxs, K, (subset) => {
          const subsetSet = new Set(subset);
          const comboSides = subset.map(i => anchorCs[i]);
          const singleSides = anchorCs.filter((_, i) => !subsetSet.has(i));
          forEachCoverSetCombo(otherCoverSetLists, (otherCs) => {
            out.push({ anchorIdx, comboSides, singleSides, otherCoverSets: otherCs });
          });
        });
      }
    }
  }
  return out;
}

// Build the legs array (first singles, then combined groups) from an asym-light split
function buildAsymLightLegs(split: AsymLightSplit): LegRef[][] {
  const { comboSides, singleSides, otherCoverSets } = split;
  const otherCrossed = generateCoveringBets(otherCoverSets); // list of leg groups (one leg per other event)
  const combinedGroups: LegRef[][] = [];
  for (const anchorSide of comboSides) {
    for (const otherLegs of otherCrossed) {
      combinedGroups.push([...anchorSide, ...otherLegs]);
    }
  }
  return [...singleSides, ...combinedGroups];
}

// Cheap best-odds score for a legs array (uni-site approximation, dutching équilibré).
// Higher = better; null = split unusable. In cash the score estimates profit/amount for
// the active amountMode, so the pre-selection ranks splits like the final profit sort:
// with mise_min_par_pari a lower rate can still lose less when odds are more balanced.
function scoreLegsArray(data: any, legsArray: LegRef[][], opts: EngineOpts): number | null {
  const sites = Object.keys(opts.sites).length > 0 ? Object.keys(opts.sites) : collectSites(data);
  if (!sites.length) return null;
  const obligSet = new Set(getObligatorySites(opts));
  let invSum = 0;
  let maxO = 0;
  let minO = Infinity;
  for (const legs of legsArray) {
    let bestO = 0;
    let bestOblig = 0;
    let hasNonOblig = false;
    for (const s of sites) {
      const o = legGroupOdds(data, legs, s, opts.coteMinParSelection);
      if (!o) continue;
      if (o > bestO) bestO = o;
      if (obligSet.has(s)) {
        if (o > bestOblig) bestOblig = o;
      } else {
        hasNonOblig = true;
      }
    }
    if (bestO <= 1) return null;
    // Mirror makeSimultResult's coteMin check: it rejects groups placed on an obligatory
    // site whose displayOdds < coteMin. If no obligatory site meets coteMin AND no
    // non-obligatory site offers this group as a cover fallback, the split has no valid
    // placement — drop it so it doesn't waste MAX_ASYMLIGHT slots on unusable candidates.
    if (opts.coteMin > 0 && obligSet.size > 0 && bestOblig < opts.coteMin && !hasNonOblig) return null;
    if (opts.coteMin > 0 && obligSet.size === 0 && bestO < opts.coteMin) return null;
    invSum += opts.betType === 'fb' ? 1 / (bestO - 1) : 1 / bestO;
    if (bestO > maxO) maxO = bestO;
    if (bestO < minO) minO = bestO;
  }
  if (invSum <= 0) return null;
  const rate = 1 / invSum;
  if (opts.betType === 'fb') return rate;
  // Cash, stakes_i = rate/o_i par unité de mise totale → profit/amount selon amountMode.
  if (opts.amountMode === 'mise_min_par_pari') return (rate - 1) * maxO / rate;
  if (opts.amountMode === 'profit_brut') return (rate - 1) / rate;
  // profit_net_min : gain net de chaque pari rate × (o − 1) / o, le plus petit (cote la plus basse) fixe l'échelle.
  if (opts.amountMode === 'profit_net_min') return (rate - 1) * minO / (rate * (minO - 1));
  return rate - 1; // mise_totale
}

function getAsymSplits(data: any, eventKey: string, opts: EngineOpts) {
  const splits: Array<{ singleGroup: LegRef[]; combinedGroups: LegRef[][] }> = [];
  const seen = new Set<string>();
  // Use simple cover sets (no cross-products) to keep asymmetric computation tractable
  for (const coverSet of getComboCoverSets(data, eventKey, opts)) {
    for (let si = 0; si < coverSet.length; si++) {
      const singleGroup = coverSet[si];
      const combinedGroups = coverSet.filter((_, i) => i !== si);
      const key = singleGroup.map(l => l.marketName + ':' + l.outcomeName).sort().join('+') + '→' +
        combinedGroups.map(g => g.map(l => l.marketName + ':' + l.outcomeName).sort().join('+')).sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      splits.push({ singleGroup, combinedGroups });
    }
  }
  return splits;
}

// ===== UTILITY COMBINATORICS =====

function forEachCombo<T>(arr: T[], k: number, fn: (combo: T[]) => void) {
  function rec(start: number, combo: T[]) {
    if (combo.length === k) { fn(combo.slice()); return; }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      rec(i + 1, combo);
      combo.pop();
    }
  }
  rec(0, []);
}

// Nombre d'éléments traités par un shard parmi `total` numérotés 0..total-1
// (counter % count === index).
function shardShare(total: number, shard?: ComputeShard): number {
  if (!shard) return total;
  return total > shard.index ? Math.ceil((total - shard.index) / shard.count) : 0;
}

// Progression d'un calcul (simultané puis séquentiel) sur un seul total, connu d'avance,
// limité à la part du shard : l'interface additionne les workers.
interface Progress { step(detail: string): void; flush(): void }

function makeProgress(total: number, onProgress?: (detail: string, done: number, total: number) => void): Progress {
  let done = 0, last = 0, lastDetail = '';
  return {
    step(detail) {
      done++;
      lastDetail = detail;
      const now = Date.now();
      if (now - last >= 50) { last = now; onProgress?.(detail, done, total); }
    },
    // Dernier point, sinon le compteur s'arrête sur l'avant-dernier envoi (< 50 ms).
    flush() { onProgress?.(lastDetail, done, total); },
  };
}

function forEachCoverSetCombo(coverSetsPerEvent: LegRef[][][][], fn: (chosen: LegRef[][][]) => void) {
  function rec(idx: number, chosen: LegRef[][][]) {
    if (idx === coverSetsPerEvent.length) { fn(chosen); return; }
    for (const s of coverSetsPerEvent[idx]) rec(idx + 1, [...chosen, s]);
  }
  rec(0, []);
}

function generateCoveringBets(coveringSets: LegRef[][][]): LegRef[][] {
  let result: LegRef[][] = [[]];
  for (const groups of coveringSets) {
    result = result.flatMap(prev => groups.map(legGroup => [...prev, ...legGroup]));
  }
  return result;
}

// ===== NEW SITE HELPERS =====

function getObligatorySites(opts: EngineOpts): string[] {
  if (opts.betType === 'fb') {
    return Object.entries(opts.sites)
      .filter(([, cfg]) => cfg.freebetPriority === 1 && cfg.freebetAmount > 0)
      .map(([s]) => s);
  }
  return Object.entries(opts.sites)
    .filter(([, cfg]) => cfg.missions.some(m => m.importance === 'obligatoire'))
    .map(([s]) => s);
}

// Sites obligatoires au sens de la spécification : en plus des précédents (Freebet : sites en
// priorité 1), les sites ayant une mission obligatoire. Ils doivent tous recevoir au moins un
// pari ; en Freebet, un site à mission sans priorité 1 y reçoit un pari cash.
function getRequiredSites(opts: EngineOpts): string[] {
  const sites = new Set(getObligatorySites(opts));
  for (const [s, cfg] of Object.entries(opts.sites))
    if (cfg.missions.some(m => m.importance === 'obligatoire')) sites.add(s);
  return [...sites];
}

function getFreebetEligibleSites(opts: EngineOpts): string[] {
  return Object.entries(opts.sites)
    .filter(([, cfg]) => cfg.freebetPriority <= 2 && cfg.freebetAmount > 0)
    .map(([s]) => s);
}

// Combined back odds for a group of legs on one site; null if unavailable/filtered
function legGroupOdds(data: any, legRefs: LegRef[], site: string, coteMinPerSel: number): number | null {
  const info = legGroupInfo(data, legRefs, site, coteMinPerSel);
  return info ? info.effOdds : null;
}

// Rich info for a leg group on a site:
//  - Back combo (1+ legs, all Back): effOdds = combined back odds, displayOdds = same.
//  - Lay single (1 leg, Lay): effOdds = (lGross-c)/(lGross-1), displayOdds = lNet, layInfo set.
//  - Mixed Back/Lay or multi-leg containing a Lay: invalid (returns null).
export interface LegGroupInfo {
  effOdds: number;          // for dutching math: cashCommitted/T = 1/effOdds, payoutOnWin = T
  displayOdds: number;      // Back: combined odds; Lay: lNet
  isLay: boolean;
  layInfo: LayInfo | null;
}

function legGroupInfo(data: any, legRefs: LegRef[], site: string, coteMinPerSel: number): LegGroupInfo | null {
  const layCount = legRefs.filter(l => l.betType === 'Lay').length;
  if (layCount > 0 && legRefs.length > 1) return null; // no combined Lay, no mixed Back+Lay
  if (layCount === 1) {
    const { eventKey, marketName, outcomeName } = legRefs[0];
    const val = data[eventKey]?.markets?.[marketName]?.[outcomeName]?.[site];
    if (val == null) return null;
    const lay = getLayInfo(val);
    if (!lay) return null;
    const denom = lay.lGross - 1;
    if (denom <= 0) return null;
    const effOdds = (lay.lGross - lay.c) / denom;
    if (!isFinite(effOdds) || effOdds <= 1) return null;
    return { effOdds, displayOdds: lay.lGross, isLay: true, layInfo: lay };
  }
  // All-Back combo. effOdds (math) = product of net; displayOdds = product of gross.
  // Note: coteMinPerSel filtering is NOT applied here — the caller (makeSimultResult)
  // applies it only to principal-site groups, since covers on other sites should not
  // be filtered by the principal-site coteMinParSelection.
  let combined = 1;
  let combinedGross = 1;
  for (const { eventKey, marketName, outcomeName } of legRefs) {
    const oddsMap = data[eventKey]?.markets?.[marketName]?.[outcomeName];
    if (!oddsMap) return null;
    const val = oddsMap[site];
    if (val == null) return null;
    if (legRefs.length > 1 && isExchange(val)) return null;
    const o = getBackOdds(val);
    if (!o || o <= 1) return null;
    const oGross = getBackOddsGross(val) ?? o;
    combined *= o;
    combinedGross *= oGross;
  }
  if (legRefs.length > 1) {
    combined = roundCombo(combined);
    combinedGross = roundCombo(combinedGross);
  }
  // Silence unused-param warnings for callers that still pass coteMinPerSel.
  void coteMinPerSel;
  return { effOdds: combined, displayOdds: combinedGross, isLay: false, layInfo: null };
}

// For Lay groups, the per-group "stake" computed above represents the cash committed
// (liability). Convert to the displayed exchange-style amounts: bet.stake = lay stake
// (backer's amount on the exchange), bet.liability = cash committed.
function patchLayBets(bets: BetDetail[], groupInfos: LegGroupInfo[]): void {
  for (let i = 0; i < bets.length; i++) {
    const info = groupInfos[i];
    if (!info.isLay || !info.layInfo) continue;
    const liability = bets[i].stake;
    const denom = info.layInfo.lGross - 1;
    if (denom <= 0) continue;
    const layStake = liability / denom;
    bets[i] = {
      ...bets[i],
      stake: layStake,
      liability,
      betType: 'cash',
      odds: info.layInfo.lGross,
    };
  }
}

// ===== MISSION CHECKING =====

function checkAllMissions(data: any, bets: BetDetail[], opts: EngineOpts): { satisfiedMissions: string[]; obligatoryOk: boolean } {
  const satisfiedMissions: string[] = [];
  let obligatoryOk = true;

  for (const [site, cfg] of Object.entries(opts.sites)) {
    // Une mission se fait toujours en cash (spécification) : les paris freebet ne comptent pas.
    const siteBets = bets.filter(b => b.site === site && b.betType !== 'fb');

    for (const mission of cfg.missions) {
      const minLegs = mission.nbCombinesMin || 1;
      const qualBets = siteBets.filter(b => b.legs.length >= minLegs);
      let ok = false;
      for (const bet of qualBets) {
        if (mission.coteMin > 0 && bet.odds < mission.coteMin) continue;
        if (mission.coteMinParSelection > 0 && bet.legs.length > 1) {
          let legOk = true;
          for (const lg of bet.legs) {
            const val = data[lg.eventKey]?.markets?.[lg.marketName]?.[lg.outcomeName]?.[bet.site];
            const o = getBackOdds(val);
            if (!o || o < mission.coteMinParSelection) { legOk = false; break; }
          }
          if (!legOk) continue;
        }
        let meetsAmount = false;
        const minAmount = mission.montant - AMOUNT_EPS;
        if (mission.montantMode === 'mise_min') {
          meetsAmount = bet.stake >= minAmount;
        } else if (mission.montantMode === 'profit_net_min') {
          meetsAmount = bet.stake * (bet.odds - 1) >= minAmount;
        } else if (mission.montantMode === 'profit_brut') {
          meetsAmount = bet.stake * bet.odds >= minAmount;
        }
        if (meetsAmount) {
          ok = true;
          (bet.satisfiedMissions ||= []).push(mission.id);
        }
      }
      if (ok) {
        satisfiedMissions.push(mission.id);
      } else if (mission.importance === 'obligatoire') {
        obligatoryOk = false;
      }
    }
  }

  // For freebet mode: check P1 sites have enough freebet stake used
  if (opts.betType === 'fb') {
    for (const [site, cfg] of Object.entries(opts.sites)) {
      if (cfg.freebetPriority !== 1 || cfg.freebetAmount <= 0) continue;
      const fbStake = bets
        .filter(b => b.site === site && b.betType === 'fb')
        .reduce((s, b) => s + b.stake, 0);
      if (fbStake < cfg.freebetAmount * 0.98) {
        obligatoryOk = false;
      }
    }
  }

  return { satisfiedMissions, obligatoryOk };
}

// ===== EVENT SCORING / SELECTION =====

function scoreEventForSite(data: any, eventKey: string, site: string, opts: EngineOpts): number {
  let best = 0;
  for (const coverSet of getCoverSets(data, eventKey, opts)) {
    const odds = coverSet.map(lg => legGroupOdds(data, lg, site, opts.coteMinParSelection) ?? 0);
    if (odds.some(o => o <= 1)) continue;
    const r = opts.betType === 'fb'
      ? 1 / odds.reduce((s, o) => s + 1 / (o - 1), 0)
      : 1 / odds.reduce((s, o) => s + 1 / o, 0);
    if (r > best) best = r;
  }
  return best;
}

function getTopEvents(data: any, opts: EngineOpts): string[] {
  const obligSites = getObligatorySites(opts);
  const allSites = Object.keys(opts.sites);
  const sitesToScore = obligSites.length > 0 ? obligSites : (allSites.length > 0 ? allSites : collectSites(data));
  return Object.keys(data)
    .map(ek => ({ ek, score: Math.max(...sitesToScore.map(s => scoreEventForSite(data, ek, s, opts))) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_EVENTS)
    .map(x => x.ek);
}

// ===== SIMULT COMPUTATION =====

// Build a CoveringSetResult for a simultaneous covering set with explicit site per group
function makeSimultResult(
  data: any,
  betsLegsArray: LegRef[][],
  eventKeys: string[],
  symmetry: 'sym' | 'asym' | 'asym-light',
  sitePerGroup: string[],
  opts: EngineOpts,
  boostedIdx: number | null = null,
  // Freebet : pari d'un site en priorité 1 joué en cash (mission de ce site, cf. fin de fonction)
  forcedCashIdx: number | null = null,
): CoveringSetResult | null {
  const n = betsLegsArray.length;
  const sitePerGroupIn = sitePerGroup;
  const groupInfos: LegGroupInfo[] = [];
  const oddsPerGroup: number[] = []; // effective odds (for dutching math, boostée si applicable)
  const oddsPerGroupBase: number[] = []; // effective odds non boostées (pour calcul rateNoBoost)
  const displayOddsBase: number[] = []; // display odds non boostées
  const boostFactor = boostedIdx != null && opts.boostPct ? 1 + opts.boostPct / 100 : 1;

  for (let i = 0; i < n; i++) {
    const info = legGroupInfo(data, betsLegsArray[i], sitePerGroup[i], opts.coteMinParSelection);
    if (!info) return null;
    groupInfos.push(info);
    oddsPerGroupBase.push(info.effOdds);
    displayOddsBase.push(info.displayOdds);
    if (i === boostedIdx) {
      // Boost sur gain net : o' = 1 + (o - 1) * (1 + boostPct/100)
      const effBoosted = 1 + (info.effOdds - 1) * boostFactor;
      oddsPerGroup.push(effBoosted);
    } else {
      oddsPerGroup.push(info.effOdds);
    }
  }

  // Boost uniquement valide sur un pari placé sur le site de boost (= site principal).
  if (boostedIdx != null) {
    if (!opts.boostSite || sitePerGroup[boostedIdx] !== opts.boostSite) return null;
    // Pas de boost sur un Lay (non pertinent pour l'offre de boost cote).
    if (groupInfos[boostedIdx].isLay) return null;
  }

  // Apply coteMin / coteMax to obligatory sites' bets
  const obligSites = new Set(getObligatorySites(opts));
  for (let i = 0; i < n; i++) {
    const isOblig = obligSites.size === 0 || obligSites.has(sitePerGroup[i]);
    if (!isOblig) continue;
    // Compare against displayOdds (the user-visible odds). For Lay this is lNet.
    if (opts.coteMin > 0 && groupInfos[i].displayOdds < opts.coteMin) return null;
    if (aboveCoteMax(groupInfos[i].displayOdds, opts)) return null;
  }

  // Lay groups cannot be on freebet (P1) sites — fb on exchange Lay is nonsense.
  for (let i = 0; i < n; i++) {
    if (groupInfos[i].isLay && obligSites.has(sitePerGroup[i]) && opts.betType === 'fb') return null;
  }

  let profit: number, rate: number, totalCash: number;
  const bets: BetDetail[] = [];

  if (opts.betType === 'fb') {
    // A bet is "freebet" if placed on an obligatory (P1) site, otherwise it's a cash cover.
    // Mixed dutch formula: α = Σ(1/o) for cash bets, β = Σ(1/(o-1)) for fb bets
    // T = FB_total / β → fb stake_i = T/(o_i-1), cash stake_i = T/o_i
    // profit = T*(1-α) - 0 = FB_total*(1-α)/β  (all pocket costs are cash stakes only)
    const isFbBet = oddsPerGroup.map((_, i) => i !== forcedCashIdx && !groupInfos[i].isLay && (obligSites.size === 0 || obligSites.has(sitePerGroup[i])));

    // coteMinParSelection : comme en Cash pour les paris principaux, chaque sélection
    // d'un combiné freebet doit atteindre le minimum (les couvertures cash sont libres).
    if (opts.coteMinParSelection > 0) {
      for (let i = 0; i < n; i++) {
        if (!isFbBet[i] || betsLegsArray[i].length <= 1) continue;
        for (const lr of betsLegsArray[i]) {
          const val = data[lr.eventKey]?.markets?.[lr.marketName]?.[lr.outcomeName]?.[sitePerGroup[i]];
          const o = getBackOdds(val);
          if (!o || o < opts.coteMinParSelection) return null;
        }
      }
    }
    let alpha = oddsPerGroup.reduce((s, o, i) => isFbBet[i] ? s : s + 1 / o, 0);
    const beta  = oddsPerGroup.reduce((s, o, i) => isFbBet[i] ? s + 1 / (o - 1) : s, 0);
    if (!isFinite(beta) || beta <= 0) return null;
    rate = (1 - alpha) / beta;
    if (!isFinite(rate) || rate <= 0) return null;

    const p1Sites = [...obligSites];
    let totalFB = p1Sites.reduce((s, site) => s + (opts.sites[site]?.freebetAmount ?? 0), 0);
    if (totalFB <= 0) totalFB = opts.amount;

    // Scale for amountMode
    if (opts.amountMode === 'mise_min_par_pari') {
      const fbOdds = oddsPerGroup.filter((_, i) => isFbBet[i]);
      if (fbOdds.length) {
        const needed = opts.amount * Math.max(...fbOdds.map(o => o - 1)) * beta;
        if (needed > totalFB) totalFB = needed;
      }
    } else if (opts.amountMode === 'profit_net_min') {
      // Gain net d'un freebet gagnant = mise × (cote − 1) = T, le même pour tous.
      if (totalFB / beta < opts.amount) totalFB = opts.amount * beta;
    } else if (opts.amountMode === 'profit_brut') {
      // min gross return = T (cash bets return exactly T if they win)
      const T0 = totalFB / beta;
      if (T0 < opts.amount) totalFB = opts.amount * beta;
    }

    const T = totalFB / beta;

    // Priorité 2 (« Pour compléter ») : une couverture peut passer en freebet sur un site en
    // priorité 2 (mise T/(o2−1), plus de cash). But : le meilleur taux de conversion global,
    // profit / (freebets priorité 1 + freebets priorité 2 utilisés). T reste fixé par la
    // priorité 1. Une couverture passe en freebet si son taux marginal (o2−1)/o_cash dépasse
    // le taux courant : essais du meilleur au moins bon, freebet de chaque site plafonné.
    const fb2 = new Array<boolean>(n).fill(false);
    let beta2 = 0;
    if (obligSites.size > 0 && opts.allowMulti) {
      const p2Sites = Object.entries(opts.sites)
        .filter(([s, c]) => c.freebetPriority === 2 && c.freebetAmount > 0 && !obligSites.has(s))
        .map(([s]) => s);
      const candidates: { i: number; site: string; info: LegGroupInfo; ratio: number }[] = [];
      if (p2Sites.length) for (let i = 0; i < n; i++) {
        if (isFbBet[i] || betsLegsArray[i].some(l => l.betType === 'Lay')) continue;
        let best: { site: string; info: LegGroupInfo } | null = null;
        for (const s of p2Sites) {
          const info = legGroupInfo(data, betsLegsArray[i], s, opts.coteMinParSelection);
          if (!info || info.isLay || info.effOdds <= 1) continue;
          if (!best || info.effOdds > best.info.effOdds) best = { site: s, info };
        }
        if (best) candidates.push({ i, ...best, ratio: (best.info.effOdds - 1) / oddsPerGroup[i] });
      }
      candidates.sort((a, b) => b.ratio - a.ratio);
      const used: Record<string, number> = {};
      for (const c of candidates) {
        const cost = 1 / (c.info.effOdds - 1);
        const a2 = alpha - 1 / oddsPerGroup[c.i];
        if ((1 - a2) / (beta + beta2 + cost) <= (1 - alpha) / (beta + beta2)) break;
        const fbUsed = (used[c.site] ?? 0) + T * cost;
        if (fbUsed > opts.sites[c.site].freebetAmount * (1 + 1e-9)) continue; // plafond du site
        used[c.site] = fbUsed;
        fb2[c.i] = true;
        alpha = a2;
        beta2 += cost;
        sitePerGroup = sitePerGroup.slice();
        sitePerGroup[c.i] = c.site;
        groupInfos[c.i] = c.info;
        oddsPerGroup[c.i] = c.info.effOdds;
      }
    }

    profit = T * (1 - alpha);
    rate = profit / (T * (beta + beta2)); // = (1 − α) / β sans priorité 2

    for (let i = 0; i < n; i++) {
      const isFb = isFbBet[i] || fb2[i];
      const stake = isFb ? T / (oddsPerGroup[i] - 1) : T / oddsPerGroup[i];
      bets.push({
        legs: betsLegsArray[i],
        site: sitePerGroup[i],
        odds: groupInfos[i].displayOdds,
        stake,
        betType: isFb ? 'fb' : 'cash',
        role: isFbBet[i] || i === forcedCashIdx ? 'principal' : 'cover',
      });
    }
    patchLayBets(bets, groupInfos);
    totalCash = bets.reduce((s, b) => s + (b.betType === 'cash' ? (b.liability ?? b.stake) : 0), 0);
  } else {
    // Cash mode
    const sumInv = oddsPerGroup.reduce((s, o) => s + 1 / o, 0);
    if (!isFinite(sumInv) || sumInv <= 0) return null;
    rate = 1 / sumInv; // return rate

    // Classify each group as principal (satisfait au moins une mission obligatoire
    // du site sur ses critères indépendants de la mise — nbCombinesMin, coteMin,
    // coteMinParSelection) ou cover (sinon). On ne se contente plus du site
    // obligatoire : un pari sur le site oblig. qui ne remplit pas les critères de
    // la mission doit être traité comme cover pour rembourser totalStake en cas de
    // victoire (objectif gagner) ou pour absorber la perte (objectif perdre).
    const groupSatisfiesOblig = (i: number): boolean => {
      const site = sitePerGroup[i];
      const cfg = opts.sites[site];
      if (!cfg) return false;
      const legCount = betsLegsArray[i].length;
      const dispOdds = groupInfos[i].displayOdds;
      for (const m of cfg.missions) {
        if (m.importance !== 'obligatoire') continue;
        if ((m.nbCombinesMin || 1) > legCount) continue;
        if (m.coteMin > 0 && dispOdds < m.coteMin) continue;
        if (m.coteMinParSelection > 0 && legCount > 1) {
          let ok = true;
          for (const lg of betsLegsArray[i]) {
            const val = data[lg.eventKey]?.markets?.[lg.marketName]?.[lg.outcomeName]?.[site];
            const o = getBackOdds(val);
            if (!o || o < m.coteMinParSelection) { ok = false; break; }
          }
          if (!ok) continue;
        }
        return true;
      }
      return false;
    };
    const isObligGroup = betsLegsArray.map((_, i) =>
      obligSites.size === 0 ? true : (obligSites.has(sitePerGroup[i]) && groupSatisfiesOblig(i))
    );
    const principalIdxs = betsLegsArray.map((_, i) => i).filter(i => isObligGroup[i]);
    const coverIdxs = betsLegsArray.map((_, i) => i).filter(i => !isObligGroup[i]);

    // coteMinParSelection applies only to principal-site multi-leg groups.
    // (Covers on other sites are unconstrained.) For Lay groups it's irrelevant
    // since Lay groups are single-leg.
    if (opts.coteMinParSelection > 0) {
      for (const i of principalIdxs) {
        const legRefs = betsLegsArray[i];
        if (legRefs.length <= 1 || groupInfos[i].isLay) continue;
        for (const lr of legRefs) {
          const val = data[lr.eventKey]?.markets?.[lr.marketName]?.[lr.outcomeName]?.[sitePerGroup[i]];
          const o = getBackOdds(val);
          if (!o || o < opts.coteMinParSelection) return null;
        }
      }
    }

    const obj = opts.cashObjective;
    // Asymmetric gagner / perdre in simult:
    //   - 'gagner': covers are "fixed" (stake = T/o so cover-win gross return = T,
    //     net = 0 break-even). Principal stakes are dutched to fill remaining budget.
    //     → loss on principal-win (= T × (dutchK − 1), negative for covering sets).
    //   - 'perdre': principals are "fixed" (principal-win gross return = T, net = 0).
    //     Covers are dutched. → loss on cover-win.
    //   - 'miser' (or uni-side: only principal OR only cover): standard Dutch on all
    //     groups, profit invariant across outcomes.
    let fixedIdxs: number[] | null = null;
    let dutchIdxs: number[] = [];
    if (principalIdxs.length > 0 && coverIdxs.length > 0 && (obj === 'perdre' || obj === 'gagner')) {
      fixedIdxs = obj === 'perdre' ? principalIdxs : coverIdxs;
      dutchIdxs = obj === 'perdre' ? coverIdxs : principalIdxs;
    }

    // Per-unit stakes (with totalStake = 1).
    let baseStakes: number[];
    let dutchK: number; // gain per unit totalStake when a dutched group wins
    if (fixedIdxs === null) {
      baseStakes = oddsPerGroup.map(o => rate / o);
      dutchK = rate;
    } else {
      const sumFixedInv = fixedIdxs.reduce((s, i) => s + 1 / oddsPerGroup[i], 0);
      if (sumFixedInv >= 1) return null; // covers (or principals) saturate the budget
      const sumDutchInv = dutchIdxs.reduce((s, i) => s + 1 / oddsPerGroup[i], 0);
      if (sumDutchInv <= 0) return null;
      const rateDutch = 1 / sumDutchInv;
      const dutchFraction = 1 - sumFixedInv;
      dutchK = dutchFraction * rateDutch;
      baseStakes = oddsPerGroup.map((o, i) => fixedIdxs!.includes(i) ? 1 / o : dutchK / o);
    }

    // amountMode applied only to principal-site bets.
    const principalOrAll = principalIdxs.length > 0 ? principalIdxs : oddsPerGroup.map((_, i) => i);
    // Échelle exigée par une contrainte ; null = impossible. Une contrainte limitée à un
    // site ne porte que sur ses paris principaux (ignorée s'il n'y en a aucun).
    const scaleFor = (c: AmountConstraint): number | null | 'skip' => {
      const constraintIdxs = c.site ? principalOrAll.filter(i => sitePerGroup[i] === c.site) : principalOrAll;
      if (!constraintIdxs.length) return 'skip';
      const constraintBase = constraintIdxs.map(i => baseStakes[i]);
      if (c.mode === 'mise_totale') {
        const sumP = constraintBase.reduce((s, v) => s + v, 0);
        return sumP > 0 ? c.amount / sumP : null;
      }
      if (c.mode === 'mise_min_par_pari') {
        // En mode boost + mise_min_par_pari : la mise de référence est celle du pari boosté
        // (le user veut "au moins opts.amount sur le pari boosté", les autres peuvent varier).
        const anchor = (boostedIdx != null) ? baseStakes[boostedIdx] : Math.min(...constraintBase);
        return isFinite(anchor) && anchor > 0 ? c.amount / anchor : null;
      }
      if (c.mode === 'profit_brut') {
        // Gross gain quand le groupe "dutch" (= principal pour gagner, cover pour perdre,
        // tous pour miser) gagne, par unité totalStake.
        let factor: number;
        if (fixedIdxs === null) factor = rate;
        else if (obj === 'perdre') factor = 1;
        else factor = dutchK;
        return factor > 0 ? c.amount / factor : null;
      }
      // profit_net_min (spécification) : le gain net de chaque pari concerné quand il gagne,
      // mise × (cote − 1) (Lay : engagement × (cote effective − 1)), atteint le montant ;
      // le plus petit fixe l'échelle.
      const minNet = Math.min(...constraintIdxs.map(i => baseStakes[i] * (oddsPerGroup[i] - 1)));
      return minNet > 0 ? c.amount / minNet : null;
    };
    // Toutes les contraintes doivent être tenues : la plus exigeante fixe l'échelle.
    let scale = 0;
    for (const c of amountConstraints(opts)) {
      const sc = scaleFor(c);
      if (sc === 'skip') continue;
      if (sc === null || !isFinite(sc) || sc <= 0) return null;
      scale = Math.max(scale, sc);
    }
    if (!isFinite(scale) || scale <= 0) return null;

    const stakes = baseStakes.map(s => s * scale);
    profit = (dutchK - 1) * scale; // loss sur l'outcome où un groupe dutched gagne
    totalCash = stakes.reduce((s, v) => s + v, 0);

    for (let i = 0; i < n; i++) {
      const dispBase = groupInfos[i].displayOdds;
      const isBoosted = i === boostedIdx;
      const dispOdds = isBoosted ? 1 + (dispBase - 1) * boostFactor : dispBase;
      bets.push({
        legs: betsLegsArray[i],
        site: sitePerGroup[i],
        odds: dispOdds,
        stake: stakes[i],
        betType: 'cash',
        role: isObligGroup[i] ? 'principal' : 'cover',
        ...(isBoosted ? { boosted: true, oddsBase: dispBase } : {}),
      });
    }
    patchLayBets(bets, groupInfos);
    totalCash = bets.reduce((s, b) => s + (b.liability ?? b.stake), 0);
  }

  const { satisfiedMissions, obligatoryOk } = checkAllMissions(data, bets, opts);
  if (!obligatoryOk) {
    // Freebet, mission obligatoire non remplie sur un site en priorité 1 : ses paris y sont
    // tous en freebet, qui ne compte pas pour une mission. Variantes avec un de ces paris joué
    // en cash ; la meilleure (taux de conversion) qui remplit les missions.
    if (opts.betType !== 'fb' || forcedCashIdx !== null || boostedIdx !== null) return null;
    const missing = (s: string) => (opts.sites[s]?.missions ?? []).some(m => m.importance === 'obligatoire' && !satisfiedMissions.includes(m.id));
    let best: CoveringSetResult | null = null;
    for (let i = 0; i < n; i++) {
      const s = sitePerGroupIn[i];
      if (!obligSites.has(s) || !missing(s)) continue;
      const r = makeSimultResult(data, betsLegsArray, eventKeys, symmetry, sitePerGroupIn, opts, null, i);
      if (r && (!best || r.rate > best.rate)) best = r;
    }
    return best;
  }

  const uniqueSites = new Set(sitePerGroup);
  const placement: 'uni' | 'multi' = uniqueSites.size === 1 ? 'uni' : 'multi';

  // Comparatif "sans boost" : rejoue le même cover set sans boost pour avoir profit/rate
  // de référence. Mêmes paramètres (sites, amount, mode) sauf boostedIdx=null.
  let profitNoBoost: number | undefined;
  let rateNoBoost: number | undefined;
  if (boostedIdx != null) {
    const ref = makeSimultResult(data, betsLegsArray, eventKeys, symmetry, sitePerGroup, opts, null);
    if (ref) { profitNoBoost = ref.profit; rateNoBoost = ref.rate; }
  }

  return {
    timing: 'simult',
    placement,
    symmetry,
    bets,
    eventKeys,
    nMatches: eventKeys.length,
    profit,
    rate,
    totalCash,
    satisfiedMissions,
    ...(profitNoBoost !== undefined ? { profitNoBoost, rateNoBoost } : {}),
  };
}

// ===== PLUSIEURS SITES EN PRIORITÉ 1 (Freebet) =====

// Programme linéaire : maximiser c·x avec x ≥ 0 et, pour chaque ligne, coef·x ≤ rhs
// (ou = rhs si eq), rhs ≥ 0. Simplexe en deux phases, règle de Bland (pas de cyclage).
// Petits problèmes seulement (quelques dizaines de variables). null = impossible.
interface LPRow { coef: number[]; rhs: number; eq: boolean }

function solveLP(c: number[], rows: LPRow[]): number[] | null {
  const EPS = 1e-9;
  const nVar = c.length, m = rows.length;
  const nSlack = rows.filter(r => !r.eq).length;
  const nArt = m - nSlack;
  const nCol = nVar + nSlack + nArt; // + colonne RHS
  const T: number[][] = [];
  const basis: number[] = [];
  let si = nVar, ai = nVar + nSlack;
  for (const r of rows) {
    const row = new Array(nCol + 1).fill(0);
    for (let j = 0; j < nVar; j++) row[j] = r.coef[j] ?? 0;
    row[nCol] = r.rhs;
    if (r.eq) { row[ai] = 1; basis.push(ai++); } else { row[si] = 1; basis.push(si++); }
    T.push(row);
  }
  const isArt = (j: number) => j >= nVar + nSlack;

  const pivot = (pr: number, pc: number) => {
    const p = T[pr][pc];
    for (let j = 0; j <= nCol; j++) T[pr][j] /= p;
    for (let i = 0; i < m; i++) {
      if (i === pr) continue;
      const f = T[i][pc];
      if (Math.abs(f) < 1e-15) continue;
      for (let j = 0; j <= nCol; j++) T[i][j] -= f * T[pr][j];
    }
    basis[pr] = pc;
  };

  const run = (cost: number[], allowed: (j: number) => boolean): boolean => {
    for (let iter = 0; iter < 1000; iter++) {
      let enter = -1;
      for (let j = 0; j < nCol; j++) {
        if (!allowed(j) || basis.includes(j)) continue;
        let rc = cost[j];
        for (let i = 0; i < m; i++) rc -= cost[basis[i]] * T[i][j];
        if (rc > EPS) { enter = j; break; }
      }
      if (enter < 0) return true;
      let leave = -1, best = Infinity;
      for (let i = 0; i < m; i++) {
        if (T[i][enter] <= EPS) continue;
        const ratio = T[i][nCol] / T[i][enter];
        if (ratio < best - EPS || (Math.abs(ratio - best) <= EPS && basis[i] < basis[leave])) { best = ratio; leave = i; }
      }
      if (leave < 0) return false; // non borné
      pivot(leave, enter);
    }
    return false;
  };

  // Phase 1 : annuler les variables artificielles.
  if (nArt > 0) {
    const cost1 = Array.from({ length: nCol }, (_, j) => isArt(j) ? -1 : 0);
    if (!run(cost1, () => true)) return null;
    for (let i = 0; i < m; i++) if (isArt(basis[i]) && T[i][nCol] > 1e-7) return null; // impossible
    // Artificielles restées dans la base à 0 : les sortir si possible.
    for (let i = 0; i < m; i++) {
      if (!isArt(basis[i])) continue;
      const j = Array.from({ length: nVar + nSlack }, (_, k) => k).find(k => Math.abs(T[i][k]) > EPS && !basis.includes(k));
      if (j !== undefined) pivot(i, j);
    }
  }
  // Phase 2.
  const cost2 = Array.from({ length: nCol }, (_, j) => j < nVar ? c[j] : 0);
  if (!run(cost2, j => !isArt(j))) return null;
  const x = new Array(nVar).fill(0);
  for (let i = 0; i < m; i++) if (basis[i] < nVar) x[basis[i]] = T[i][nCol];
  return x;
}

// Freebet avec plusieurs sites en priorité 1 : chaque freebet joué en entier (spécification :
// A 10 €, B 15 € → paris freebet totalisant 10 € sur A et 15 € sur B). Une issue peut être
// jouée en freebet sur un ou plusieurs de ces sites, et complétée en cash sur un autre site
// (meilleure cote) ; toutes les issues rapportent T.
// Programme linéaire, en « retour » P[k][s] = mise freebet × (cote − 1) :
//   maximiser profit = T − Σ_k cash_k,  cash_k = (T − Σ_s P[k][s]) / cote cash_k
//   avec Σ_s P[k][s] ≤ T (= T sans cote cash), Σ_k P[k][s] / (cote[k][s] − 1) = freebet de s.
function makeMultiP1Result(
  data: any,
  betsLegsArray: LegRef[][],
  eventKeys: string[],
  symmetry: 'sym' | 'asym' | 'asym-light',
  opts: EngineOpts,
  p1Sites: string[],
): CoveringSetResult | null {
  const n = betsLegsArray.length;
  const p1 = new Set(p1Sites);
  const cashSites = Object.keys(opts.sites).filter(s => !p1.has(s));

  // Options de chaque issue : freebet sur les sites en priorité 1, meilleure cote cash ailleurs.
  const fbOpts: { site: string; info: LegGroupInfo; v: number }[][] = [];
  const cashOpt: ({ site: string; info: LegGroupInfo } | null)[] = [];
  for (let k = 0; k < n; k++) {
    const legs = betsLegsArray[k];
    const fo: { site: string; info: LegGroupInfo; v: number }[] = [];
    if (!legs.some(l => l.betType === 'Lay')) for (const s of p1Sites) {
      const info = legGroupInfo(data, legs, s, opts.coteMinParSelection);
      if (!info || info.isLay || info.effOdds <= 1) continue;
      if (opts.coteMin > 0 && info.displayOdds < opts.coteMin) continue;
      if (aboveCoteMax(info.displayOdds, opts)) continue;
      if (opts.coteMinParSelection > 0 && legs.length > 1 && legs.some(lr => {
        const o = getBackOdds(data[lr.eventKey]?.markets?.[lr.marketName]?.[lr.outcomeName]?.[s]);
        return !o || o < opts.coteMinParSelection;
      })) continue;
      fo.push({ site: s, info, v: -1 });
    }
    let best: { site: string; info: LegGroupInfo } | null = null;
    for (const s of cashSites) {
      const info = legGroupInfo(data, legs, s, opts.coteMinParSelection);
      if (info && info.effOdds > 1 && (!best || info.effOdds > best.info.effOdds)) best = { site: s, info };
    }
    if (!fo.length && !best) return null;
    fbOpts.push(fo);
    cashOpt.push(best);
  }

  // Variables : P[k][s] (une par option freebet), puis T.
  let nv = 0;
  for (const fo of fbOpts) for (const o of fo) o.v = nv++;
  const iT = nv++;
  const c = new Array(nv).fill(0);
  c[iT] = 1;
  const rows: LPRow[] = [];
  for (let k = 0; k < n; k++) {
    const coef = new Array(nv).fill(0);
    for (const o of fbOpts[k]) coef[o.v] = 1;
    coef[iT] = -1;
    const cash = cashOpt[k];
    if (cash) {
      const w = 1 / cash.info.effOdds;
      c[iT] -= w;
      for (const o of fbOpts[k]) c[o.v] += w;
    }
    rows.push({ coef, rhs: 0, eq: !cash });
  }
  let tCap = 0;
  for (const s of p1Sites) {
    const amount = opts.sites[s].freebetAmount;
    const coef = new Array(nv).fill(0);
    let maxGain = 0;
    for (const fo of fbOpts) for (const o of fo) if (o.site === s) {
      coef[o.v] = 1 / (o.info.effOdds - 1);
      maxGain = Math.max(maxGain, o.info.effOdds - 1);
    }
    if (maxGain <= 0) return null; // ce site ne peut rien jouer dans cet ensemble de couverture
    rows.push({ coef, rhs: amount, eq: true });
    tCap += amount * maxGain;
  }
  // Borne de T (sinon non borné si les cotes cash forment un arbitrage).
  const capRow = new Array(nv).fill(0);
  capRow[iT] = 1;
  rows.push({ coef: capRow, rhs: tCap, eq: false });

  const x = solveLP(c, rows);
  if (!x) return null;
  const T = x[iT];
  if (!(T > 1e-9)) return null;

  const bets: BetDetail[] = [];
  const infos: LegGroupInfo[] = [];
  let cashTotal = 0;
  for (let k = 0; k < n; k++) {
    let paid = 0;
    for (const o of fbOpts[k]) {
      const p = x[o.v];
      if (p <= 1e-9) continue;
      paid += p;
      bets.push({ legs: betsLegsArray[k], site: o.site, odds: o.info.displayOdds, stake: p / (o.info.effOdds - 1), betType: 'fb', role: 'principal' });
      infos.push(o.info);
    }
    const rest = T - paid;
    const cash = cashOpt[k];
    if (rest > 1e-9 * Math.max(1, T)) {
      if (!cash) return null;
      const stake = rest / cash.info.effOdds;
      cashTotal += stake;
      bets.push({ legs: betsLegsArray[k], site: cash.site, odds: cash.info.displayOdds, stake, betType: 'cash', role: 'cover' });
      infos.push(cash.info);
    }
  }
  patchLayBets(bets, infos);

  const { satisfiedMissions, obligatoryOk } = checkAllMissions(data, bets, opts);
  if (!obligatoryOk) return null;
  const profit = T - cashTotal;
  const fbTotal = p1Sites.reduce((s, site) => s + opts.sites[site].freebetAmount, 0);
  return {
    timing: 'simult',
    placement: new Set(bets.map(b => b.site)).size === 1 ? 'uni' : 'multi',
    symmetry,
    bets,
    eventKeys,
    nMatches: eventKeys.length,
    profit,
    rate: profit / fbTotal,
    totalCash: bets.reduce((s, b) => s + (b.betType === 'cash' ? (b.liability ?? b.stake) : 0), 0),
    satisfiedMissions,
  };
}

// Try all site assignments for a covering set
function trySimult(
  data: any,
  betsLegsArray: LegRef[][],
  eventKeys: string[],
  symmetry: 'sym' | 'asym' | 'asym-light',
  opts: EngineOpts,
  boostedIdx: number | null = null
): CoveringSetResult[] {
  const results: CoveringSetResult[] = [];
  const obligSites = getObligatorySites(opts);
  const fbSites = getFreebetEligibleSites(opts);
  const allSites = Object.keys(opts.sites);
  // Freebet : sites à mission obligatoire sans priorité 1 (vide en Cash).
  const extraRequired = getRequiredSites(opts).filter(s => !obligSites.includes(s));

  // Place au moins un pari sur chaque site de extraRequired : la couverture (pari hors des
  // sites requis) qui y perd le moins de cote y est déplacée. null = impossible.
  const withRequired = (assign: string[]): string[] | null => {
    let a = assign;
    for (const rs of extraRequired) {
      if (a.includes(rs)) continue;
      let bestG = -1, bestRatio = 0;
      for (let g = 0; g < a.length; g++) {
        if (obligSites.includes(a[g]) || extraRequired.includes(a[g])) continue;
        const o = legGroupOdds(data, betsLegsArray[g], rs, opts.coteMinParSelection);
        const cur = legGroupOdds(data, betsLegsArray[g], a[g], opts.coteMinParSelection);
        if (!o || !cur) continue;
        if (o / cur > bestRatio) { bestRatio = o / cur; bestG = g; }
      }
      if (bestG < 0) return null;
      a = a.slice();
      a[bestG] = rs;
    }
    return a;
  };

  // Freebet, plusieurs sites en priorité 1 : un seul calcul (programme linéaire) par ensemble
  // de couverture, qui choisit lui-même les sites ; forcément multi-sites.
  if (opts.betType === 'fb' && obligSites.length >= 2) {
    if (!opts.allowMulti) return results;
    const r = makeMultiP1Result(data, betsLegsArray, eventKeys, symmetry, opts, obligSites);
    return r ? [r] : results;
  }

  // Helper: get best odds for a leg group from a list of sites
  function bestSiteForGroup(legRefs: LegRef[], sites: string[]): { site: string; odds: number } | null {
    let best: { site: string; odds: number } | null = null;
    for (const site of sites) {
      const o = legGroupOdds(data, legRefs, site, opts.coteMinParSelection);
      if (!o) continue;
      // Cote max : un site obligatoire trop coté laisse ce pari à un autre site (couverture)
      // au lieu de faire rejeter la combinaison.
      if ((opts.coteMax ?? 0) > 0 && (obligSites.length === 0 || obligSites.includes(site))) {
        const info = legGroupInfo(data, legRefs, site, opts.coteMinParSelection);
        if (!info || aboveCoteMax(info.displayOdds, opts)) continue;
      }
      if (!best || o > best.odds) best = { site, odds: o };
    }
    return best;
  }

  // --- UNI-SITE ---
  if (opts.allowUni) {
    // Determine which sites to try for uni
    let uniSites: string[];
    if (opts.betType === 'fb') {
      if (obligSites.length === 1) {
        uniSites = obligSites; // only the P1 site
      } else if (obligSites.length === 0) {
        uniSites = fbSites.length > 0 ? fbSites : allSites;
      } else {
        uniSites = []; // 2+ P1 sites: can't do uni
      }
    } else {
      uniSites = obligSites.length === 1 ? obligSites
        : obligSites.length === 0 ? allSites
        : []; // 2+ obligatory cash sites: can't do uni (would miss one)
    }
    // Sites requis en plus (mission obligatoire en Freebet) : uni-site seulement sur le site
    // requis lui-même, et rien s'il y en a deux ou plus (spécification).
    if (extraRequired.length) {
      const required = [...obligSites, ...extraRequired];
      uniSites = uniSites.filter(s => required.every(r => r === s));
    }

    for (const site of uniSites) {
      const sitePerGroup = betsLegsArray.map(() => site);
      const r = makeSimultResult(data, betsLegsArray, eventKeys, symmetry, sitePerGroup, opts, boostedIdx);
      if (r) results.push(r);
    }
  }

  // --- MULTI-SITE ---
  if (opts.allowMulti) {
    // Use all sites: freebet cover bets can be placed as cash on any site (e.g. exchange).
    // The obligatory-site check below ensures P1 freebet sites are included.
    const sitesToUse = allSites;

    let sitePerGroup: string[] = [];
    let valid = true;
    for (const legRefs of betsLegsArray) {
      const best = bestSiteForGroup(legRefs, sitesToUse);
      if (!best) { valid = false; break; }
      sitePerGroup.push(best.site);
    }
    if (valid) {
      const a = withRequired(sitePerGroup);
      if (a) sitePerGroup = a; else valid = false;
    }

    if (valid) {
      const uniqueSites = new Set(sitePerGroup);
      // Must be truly multi-site
      if (uniqueSites.size >= 2) {
        // For obligatory sites: ensure each obligatory site has at least one bet
        let obligOk = true;
        for (const os of obligSites) {
          if (!sitePerGroup.includes(os)) { obligOk = false; break; }
        }
        if (obligOk) {
          const r = makeSimultResult(data, betsLegsArray, eventKeys, symmetry, sitePerGroup, opts, boostedIdx);
          if (r) results.push(r);
        }
      }
    }

    // Exhaustive 2^n multi-site assignments: try all combinations of (obligatory/non-obligatory)
    // per group, generating e.g. [B,B,P], [B,P,B], [P,B,B] in addition to [B,P,P].
    // Guards: skip if no non-oblig site can bet any group (e.g. exchange can't do multi-leg
    // combined bets), and cap n≤8 to avoid 2^n explosion on large multi-event covers.
    if (obligSites.length >= 1) {
      const n = betsLegsArray.length;
      const nonObligSites = allSites.filter(s => !obligSites.includes(s));
      const obligChoice: (string | null)[] = betsLegsArray.map(legRefs =>
        bestSiteForGroup(legRefs, obligSites)?.site ?? null
      );
      const nonObligChoice: (string | null)[] = betsLegsArray.map(legRefs =>
        bestSiteForGroup(legRefs, nonObligSites.length > 0 ? nonObligSites : allSites)?.site ?? null
      );

      if (n <= 8 && nonObligChoice.some(c => c !== null)) {
        for (let mask = 1; mask < (1 << n); mask++) {
          const assignment: string[] = [];
          let valid = true;
          for (let i = 0; i < n; i++) {
            const choice = ((mask >> i) & 1) ? obligChoice[i] : nonObligChoice[i];
            if (!choice) { valid = false; break; }
            assignment.push(choice);
          }
          if (!valid) continue;
          if (new Set(assignment).size < 2) continue;
          if (obligSites.some(os => !assignment.includes(os))) continue;
          const withReq = withRequired(assignment);
          if (!withReq) continue;
          const r = makeSimultResult(data, betsLegsArray, eventKeys, symmetry, withReq, opts, boostedIdx);
          if (r) results.push(r);
        }
      }
    }
  }

  return results;
}

// Call trySimult once (no boost) OR, if boost active, iterate boost candidates
// (eligible groups = ceux qui peuvent être placés sur boostSite). Quand boostPct > 0
// on ne retourne QUE des résultats boostés (variantes sans boost ignorées).
function trySimultWithBoost(
  data: any,
  betsLegsArray: LegRef[][],
  eventKeys: string[],
  symmetry: 'sym' | 'asym' | 'asym-light',
  opts: EngineOpts
): CoveringSetResult[] {
  const boostActive = (opts.boostPct ?? 0) > 0 && !!opts.boostSite;
  if (!boostActive) return trySimult(data, betsLegsArray, eventKeys, symmetry, opts, null);

  const results: CoveringSetResult[] = [];
  for (let i = 0; i < betsLegsArray.length; i++) {
    // Groupe éligible : au moins une cote dispo sur boostSite (sinon makeSimultResult rejette).
    if (legGroupOdds(data, betsLegsArray[i], opts.boostSite!, opts.coteMinParSelection) == null) continue;
    results.push(...trySimult(data, betsLegsArray, eventKeys, symmetry, opts, i));
  }
  return results;
}

// ===== SIMULT MAIN LOOP =====

// Combinaisons de matchs parcourues par computeSimult (tous shards confondus).
function countSimultCombos(data: any, opts: EngineOpts, topEvents: string[]): number {
  const nEvents = Object.keys(data).length;
  return opts.allowedNLegs.reduce((s, n) => s + C(n === 1 ? nEvents : topEvents.length, n), 0);
}

function computeSimult(data: any, opts: EngineOpts, topEvents: string[], progress: Progress, shard?: ComputeShard): CoveringSetResult[] {
  const allEventKeys = Object.keys(data);

  const results: CoveringSetResult[] = [];
  const bestPerCombo = new Map<string, CoveringSetResult>();
  let globalCounter = 0;

  for (const n of opts.allowedNLegs) {
    const nStr = n === 1 ? 'Simples' : `Combinés de ${n}`;
    const hasSym = opts.allowSym;
    const hasAsym = opts.allowAsym && n > 1;
    const symSuffix = (hasSym && !hasAsym) ? ' • Symétrique' : (!hasSym && hasAsym) ? ' • Asymétrique' : '';
    const detail = `${nStr} • Simultané${symSuffix}`;

    const eventPool = n === 1 ? allEventKeys : topEvents;

    forEachCombo(eventPool, n, combo => {
      const myIdx = globalCounter++;
      if (shard && myIdx % shard.count !== shard.index) return;
      progress.step(detail);
      const comboKey = combo.slice().sort().join('|');
      const coverSetsPerEvent = combo.map(ek => n === 1 ? getCoverSets(data, ek, opts) : getComboCoverSets(data, ek, opts));
      if (coverSetsPerEvent.some(s => !s.length)) return;

      forEachCoverSetCombo(coverSetsPerEvent, chosen => {
        const betsLegsArray = generateCoveringBets(chosen);

        // Key identifying the covering set structure (markets + outcomes), indépendamment du site
        const coverKey = betsLegsArray
          .map(group => group.map(l => l.marketName + ':' + l.outcomeName).sort().join('+'))
          .sort().join('||');

        // Symmetric
        if (opts.allowSym) {
          const symResults = trySimultWithBoost(data, betsLegsArray, combo, 'sym', opts);
          for (const r of symResults) {
            const sitesKey = r.bets.map(b => b.site).join('+');
            const key = comboKey + '|' + coverKey + '|sym|' + r.placement + '|' + sitesKey;
            const prev = bestPerCombo.get(key);
            if (!prev || r.profit > prev.profit) bestPerCombo.set(key, r);
          }
        }
      });

      // Asymmetric (only for multi-match). Independent of the sym cover-set combo above:
      // it enumerates its own splits, so it runs once per event combo.
      if (opts.allowAsym && n > 1) {
        for (let si = 0; si < combo.length; si++) {
          const ekS = combo[si];
          const ekCs = combo.filter((_, k) => k !== si);
          const allSplits = getAsymSplits(data, ekS, opts);
          // For n≥3: restrict to 2-sided splits to avoid generating impractically
          // large asymLegsArrays (3-sided splits × 3-sided remaining events → up to 19 bets).
          const splits = n >= 3
            ? allSplits.filter(({ combinedGroups }) => combinedGroups.length <= 1)
            : allSplits;
          // For n≥3: also restrict remaining events' cover sets to 2-sided only.
          const coverSetsCs = ekCs.map(ek => {
            const css = getComboCoverSets(data, ek, opts);
            return n >= 3 ? css.filter(cs => cs.length === 2) : css;
          });
          if (!splits.length || coverSetsCs.some(s => !s.length)) continue;

          for (const { singleGroup, combinedGroups } of splits) {
            forEachCoverSetCombo(coverSetsCs, chosenCs => {
              const csLegs = generateCoveringBets(chosenCs);
              const asymLegsArray = [
                singleGroup,
                ...combinedGroups.map(cg => csLegs.map(cl => [...cg, ...cl])).flat(),
              ];
              const asymCoverKey = asymLegsArray
                .map(group => group.map(l => l.marketName + ':' + l.outcomeName).sort().join('+'))
                .sort().join('||');
              const asymResults = trySimultWithBoost(data, asymLegsArray, [ekS, ...ekCs], 'asym', opts);
              for (const r of asymResults) {
                const sitesKey = r.bets.map(b => b.site).join('+');
                const key = comboKey + '|asym|' + si + '|' + asymCoverKey + '|' + r.placement + '|' + sitesKey;
                const prev = bestPerCombo.get(key);
                if (!prev || r.profit > prev.profit) bestPerCombo.set(key, r);
              }
            });
          }
        }
      }

      // Asym-light (only for multi-match): enumerate splits, score cheaply, keep top-M
      if (opts.allowAsymLight && n > 1) {
        const MAX_ASYMLIGHT = 20;
        const allSplits = getAsymLightSplits(data, combo, opts);
        const scored: Array<{ s: AsymLightSplit; legs: LegRef[][]; score: number }> = [];
        for (const s of allSplits) {
          const legs = buildAsymLightLegs(s);
          const score = scoreLegsArray(data, legs, opts);
          if (score !== null) scored.push({ s, legs, score });
        }
        scored.sort((a, b) => b.score - a.score);
        for (const { s, legs } of scored.slice(0, MAX_ASYMLIGHT)) {
          const anchorKey = combo[s.anchorIdx];
          const orderedKeys = [anchorKey, ...combo.filter((_, i) => i !== s.anchorIdx)];
          const alCoverKey = legs
            .map(group => group.map(l => l.marketName + ':' + l.outcomeName).sort().join('+'))
            .sort().join('||');
          const alResults = trySimultWithBoost(data, legs, orderedKeys, 'asym-light', opts);
          for (const r of alResults) {
            const sitesKey = r.bets.map(b => b.site).join('+');
            const key = comboKey + '|asym-light|' + s.anchorIdx + '|' + alCoverKey + '|' + r.placement + '|' + sitesKey;
            const prev = bestPerCombo.get(key);
            if (!prev || r.profit > prev.profit) bestPerCombo.set(key, r);
          }
        }
      }
    });
  }

  return [...results, ...bestPerCombo.values()];
}

// ===== SEQUENTIAL COMPUTATION =====

// ===== SÉQUENTIEL : SÉLECTIONS =====

// Marché dont le résultat tombe à la mi-temps (1re mi-temps) : « 1X2 MT1 »…
const FIRST_HALF_MARKET = /\bMT1\b|\b1(?:re|ère|er)?\s*mi-?temps\b|\bfirst half\b|\b1st half\b/i;

const normSport = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Délai (ms) entre le coup d'envoi d'un match et le moment où le match suivant d'un combiné
// séquentiel peut commencer : résultat des marchés joués (durée du sport, 1re mi-temps si tous
// sont des marchés de 1re mi-temps) + marge. Sans seqTiming : MIN_GAP_MS.
function seqResultDelayMs(timing: SeqTiming | undefined, sport: string | undefined, marketNames: string[]): number {
  if (!timing) return MIN_GAP_MS;
  const key = normSport(sport ?? '');
  const d = (key && timing.sports.find(s => normSport(s.name) === key || s.aliases.some(a => normSport(a) === key))) || timing.default;
  const half = marketNames.length > 0 && marketNames.every(m => FIRST_HALF_MARKET.test(m));
  const minutes = (half && d.half != null ? d.half : d.full) + (timing.marginMinutes || 0);
  return minutes * 60 * 1000;
}

// Issue couverte d'une sélection séquentielle, sur son meilleur site.
interface SeqCoverSide {
  legRef: LegRef;          // betType Back ou Lay
  site: string;
  e: number;               // cote effective (retour / engagement) : Back cote nette ; Lay (lGross − c) / (lGross − 1)
  oddsGross: number;       // cote affichée (Lay : lGross)
  lGross: number | null;   // Lay
}

// Sélection d'un combiné séquentiel : une ou deux issues jouées (dans le combiné, sur le site du
// combiné) et les autres issues de la règle couvertes à part, chacune sur son meilleur site.
//  - deux issues jouées : plusieurs combinés, qui rapportent tous la même chose (spécification,
//    exemples 2 à 4 : M1 A • M2 A et M1 A • M2 B) ;
//  - plusieurs issues couvertes : couverture répartie (exemples 1 et 5 : M1 B et M1 C).
// Les issues jouées valent une cote équivalente b = 1 / Σ 1/b_p, les issues couvertes une cote
// effective équivalente E = 1 / Σ 1/e : les formules d'une sélection simple s'appliquent.
interface SeqLeg {
  eventKey: string;
  dateTime: number | null;
  principal: { marketName: string; outcomeName: string; b: number; bGross: number }[];
  b: number;
  cover: SeqCoverSide[];
  E: number;
  bestK: number;           // E / (E − 1) : coût de la couverture
  resultAfterMs: number;   // délai avant le match suivant (cf. seqResultDelayMs)
}

// Au plus 2 issues jouées par sélection (au-delà, trop de combinés).
const MAX_SEQ_PRINCIPAL_ISSUES = 2;

// Sélection à une issue jouée et une issue couverte (règles à 2 issues, findCoversForOutcome).
function seqLegFromLeg(l: Leg, data: any, opts: EngineOpts): SeqLeg {
  const c = l.bestCover;
  const lay = c.type === 'lay';
  const e = lay ? (c.lGross! - c.c!) / (c.lGross! - 1) : c.odds;
  return {
    eventKey: l.eventKey,
    dateTime: l.dateTime,
    principal: [{ marketName: l.marketName, outcomeName: l.outcomeName, b: l.b, bGross: l.bGross }],
    b: l.b,
    cover: [{
      legRef: { eventKey: l.eventKey, marketName: c.marketName, outcomeName: c.outcomeName, betType: lay ? 'Lay' : 'Back' },
      site: c.site, e, oddsGross: c.oddsGross, lGross: lay ? c.lGross : null,
    }],
    E: e,
    bestK: c.k,
    resultAfterMs: seqResultDelayMs(opts.seqTiming, data[l.eventKey]?.sport, [l.marketName]),
  };
}

// Sélections tirées des règles à 3 issues ou plus (ensembles de couverture d'un match) : chaque
// partage des issues entre jouées (1 ou 2, Back cotées sur le site du combiné) et couvertes.
function multiIssueSeqLegs(data: any, eventKey: string, sets: LegRef[][][], site: string, opts: EngineOpts): SeqLeg[] {
  const event = data[eventKey];
  const dateTime = event?.dateTime ? new Date(event.dateTime).getTime() : null;
  const priced = (lr: LegRef, s: string) => event?.markets?.[lr.marketName]?.[lr.outcomeName]?.[s];
  const sites = Object.keys(opts.sites);

  // Meilleur site pour couvrir une issue (mêmes règles que findCoversForOutcome : Uni-site /
  // Multi-sites, pas de Lay sur le site du combiné, cotes min. / max. sur ce site).
  const coverSide = (lr: LegRef): SeqCoverSide | null => {
    let best: SeqCoverSide | null = null;
    for (const s of sites) {
      if (s === site ? !opts.allowUni : !opts.allowMulti) continue;
      const v = priced(lr, s);
      if (v == null) continue;
      let side: SeqCoverSide;
      if (lr.betType === 'Lay') {
        if (s === site) continue;
        const lay = getLayInfo(v);
        if (!lay || lay.lGross <= 1) continue;
        const e = (lay.lGross - lay.c) / (lay.lGross - 1);
        if (!(e > 1)) continue;
        side = { legRef: lr, site: s, e, oddsGross: lay.lGross, lGross: lay.lGross };
      } else {
        const o = getBackOdds(v);
        if (!o || o <= 1) continue;
        const og = getBackOddsGross(v) ?? o;
        if (s === site && ((opts.coteMin > 0 && og < opts.coteMin) || aboveCoteMax(og, opts))) continue;
        side = { legRef: lr, site: s, e: o, oddsGross: og, lGross: null };
      }
      if (!best || side.e > best.e) best = side;
    }
    return best;
  };

  const out: SeqLeg[] = [];
  for (const set of sets) {
    const sides = set.map(g => g[0]);
    const m = sides.length;
    if (m < 3) continue;
    const covers = new Map<number, SeqCoverSide | null>();
    const cov = (j: number) => {
      if (!covers.has(j)) covers.set(j, coverSide(sides[j]));
      return covers.get(j)!;
    };
    for (let mask = 1; mask < (1 << m) - 1; mask++) {
      const pIdx = sides.map((_, j) => j).filter(j => (mask >> j) & 1);
      if (pIdx.length > MAX_SEQ_PRINCIPAL_ISSUES) continue;
      const principal: SeqLeg['principal'] = [];
      for (const j of pIdx) {
        const lr = sides[j];
        if (lr.betType !== 'Back') break;
        const v = priced(lr, site);
        const b = getBackOdds(v);
        if (!b || b <= 1) break;
        principal.push({ marketName: lr.marketName, outcomeName: lr.outcomeName, b, bGross: getBackOddsGross(v) ?? b });
      }
      if (principal.length !== pIdx.length) continue;
      const cover: SeqCoverSide[] = [];
      for (let j = 0; j < m; j++) {
        if ((mask >> j) & 1) continue;
        const c = cov(j);
        if (!c) break;
        cover.push(c);
      }
      if (cover.length !== m - pIdx.length) continue;
      const invE = cover.reduce((s, c) => s + 1 / c.e, 0);
      if (!(invE < 1)) continue; // couverture plus chère que ce qu'elle rapporte
      // Issues jouées à cote équivalente ≤ 1 (ex. « 1 ou 2 » à 1,3 et 4) : rien à gagner, et des
      // couvertures négatives en « Perdre ».
      const b = 1 / principal.reduce((s, p) => s + 1 / p.b, 0);
      if (!(b > 1)) continue;
      const E = 1 / invE;
      out.push({
        eventKey, dateTime, principal, b, cover, E, bestK: E / (E - 1),
        resultAfterMs: seqResultDelayMs(opts.seqTiming, event?.sport, principal.map(p => p.marketName)),
      });
    }
  }
  return out;
}

// Sélections séquentielles d'un site : pour chaque ensemble d'issues jouées, la couverture la
// moins chère (règle à 2 issues ou couverture répartie).
function collectSeqLegs(data: any, site: string, opts: EngineOpts, multiSets: Map<string, LegRef[][][]>): SeqLeg[] {
  const best = new Map<string, SeqLeg>();
  const add = (l: SeqLeg) => {
    const k = l.eventKey + '|' + l.principal.map(p => `${p.marketName}#${p.outcomeName}`).sort().join('+');
    const cur = best.get(k);
    if (!cur || l.bestK < cur.bestK) best.set(k, l);
  };
  for (const l of collectLegsForSite(data, site, opts)) add(seqLegFromLeg(l, data, opts));
  for (const [ek, sets] of multiSets) for (const l of multiIssueSeqLegs(data, ek, sets, site, opts)) add(l);
  return [...best.values()];
}

// Pari d'un résultat séquentiel ramené à une unité de mise totale des combinés (Cash) : sert aux
// contraintes de montant.
interface SeqUnit { site: string; principal: boolean; stake: number; committed: number; net: number; gross: number }

// Séquentiel Cash : mise totale des combinés exigée par les contraintes de montant (toutes tenues,
// la plus exigeante l'emporte). Une contrainte porte sur les paris du site du combiné (combinés et
// couvertures sur ce site), ou sur les couvertures d'un autre site si elle est limitée à ce site.
// NaN = impossible.
function seqUnitsScale(units: SeqUnit[], site: string, opts: EngineOpts): number {
  let S = 0;
  for (const c of amountConstraints(opts)) {
    const onPrincipalSite = !c.site || c.site === site;
    const us = units.filter(u => onPrincipalSite ? (u.principal || u.site === site) : (!u.principal && u.site === c.site));
    if (!us.length) continue;
    let sp: number;
    switch (c.mode) {
      case 'mise_totale':       sp = c.amount / us.reduce((s, u) => s + u.committed, 0); break;
      case 'mise_min_par_pari': sp = c.amount / Math.min(...us.map(u => u.stake)); break;
      // Site du combiné : retour brut des combinés. Autre site : au moins une de ses
      // couvertures doit atteindre le montant (comme le contrôle de la mission).
      case 'profit_brut':       sp = c.amount / Math.max(...(onPrincipalSite ? us.filter(u => u.principal) : us).map(u => u.gross)); break;
      case 'profit_net_min': {
        // Gain net de chaque pari concerné quand il gagne.
        const minNet = Math.min(...us.map(u => u.net));
        sp = minNet > 1e-9 ? c.amount / minNet : NaN;
        break;
      }
      default: sp = c.amount;
    }
    if (!isFinite(sp) || sp <= 0) return NaN;
    S = Math.max(S, sp);
  }
  return S > 0 ? S : NaN;
}

// Sélections candidates aux combinés séquentiels d'un site (les TOP_SEQ meilleures).
function seqPool(legs: SeqLeg[], opts: EngineOpts): SeqLeg[] {
  return legs
    .filter(l => l.dateTime !== null)
    // Filter coteMinParSelection BEFORE slicing to TOP_SEQ. Otherwise the top-50
    // is ranked by b/bestK (coverage efficiency), which often favors moderate-odds
    // legs over high-odds ones — leaving few or no combos where all legs satisfy
    // the per-selection minimum.
    .filter(l => opts.coteMinParSelection <= 0 || l.principal.every(p => p.b >= opts.coteMinParSelection))
    // Cote max : une issue au-dessus donnerait un combiné au-dessus (cotes > 1).
    .filter(l => !l.principal.some(p => aboveCoteMax(p.bGross, opts)))
    .sort((a, b) => (opts.betType === 'fb'
      ? (b.b - 1) / b.bestK - (a.b - 1) / a.bestK
      : b.b / b.bestK - a.b / a.bestK
    ))
    .slice(0, TOP_SEQ);
}

// Combinés séquentiels de n sélections : matchs distincts, chacun commençant une fois le résultat
// du précédent connu (resultAfterMs après son coup d'envoi). Même ordre de parcours que les
// anciennes boucles i/j/m.
function forEachSeqChain<T extends { dateTime: number | null; eventKey: string; resultAfterMs: number }>(pool: T[], n: number, fn: (legs: T[]) => void) {
  const chain: T[] = [];
  const rec = () => {
    if (chain.length === n) { fn(chain.slice()); return; }
    const prev = chain[chain.length - 1];
    for (const l of pool) {
      if (prev) {
        if (!l.dateTime || !prev.dateTime || l.dateTime <= prev.dateTime) continue;
        if (l.dateTime - prev.dateTime < prev.resultAfterMs) continue;
        if (chain.some(c => c === l || c.eventKey === l.eventKey)) continue;
      }
      chain.push(l); rec(); chain.pop();
    }
  };
  rec();
}

interface SeqPrep {
  sitesToUse: string[];
  nList: number[];
  poolPerSite: Map<string, SeqLeg[]>;
  total: number; // combinés parcourus, tous shards confondus
}

function prepareSeq(data: any, opts: EngineOpts): SeqPrep | null {
  const obligSites = getObligatorySites(opts);
  const sitesToUse = obligSites.length > 0 ? obligSites
    : opts.betType === 'fb' ? getFreebetEligibleSites(opts)
    : Object.keys(opts.sites);

  if (!sitesToUse.length || (!opts.allowUni && !opts.allowMulti)) return null;

  // Ensembles de couverture à 3 issues ou plus de chaque match daté (couvertures réparties,
  // plusieurs issues jouées) : calculés une fois pour tous les sites.
  const multiSets = new Map<string, LegRef[][][]>();
  for (const [ek, ev] of Object.entries(data) as [string, any][]) {
    if (!ev?.dateTime) continue;
    const sets = getCoverSets(data, ek, opts).filter(s => s.length >= 3);
    if (sets.length) multiSets.set(ek, sets);
  }

  const poolPerSite = new Map<string, SeqLeg[]>();
  for (const site of sitesToUse) poolPerSite.set(site, seqPool(collectSeqLegs(data, site, opts, multiSets), opts));

  // Combinés de 2 à 5 sélections (un simple n'a rien de séquentiel : simultané).
  const nList = opts.allowedNLegs.filter(x => x >= 2 && x <= 5);
  let total = 0;
  for (const n of nList)
    for (const site of sitesToUse) forEachSeqChain(poolPerSite.get(site)!, n, () => { total++; });
  return { sitesToUse, nList, poolPerSite, total };
}

function computeSeq(data: any, opts: EngineOpts, prep: SeqPrep, progress: Progress, shard?: ComputeShard): CoveringSetResult[] {
  const { sitesToUse, poolPerSite } = prep;

  const results: CoveringSetResult[] = [];
  let seqCounter = 0;

  for (const n of prep.nList) {
    const detail = `Combinés de ${n} • Séquentiel`;

    for (const site of sitesToUse) {
      // Freebet : la mise des combinés est le freebet disponible du site (en mode simple,
      // c'est le montant saisi). opts.amount ne sert que de secours.
      const fbStake = (opts.sites[site]?.freebetAmount ?? 0) > 0 ? opts.sites[site].freebetAmount : opts.amount;
      const pool = poolPerSite.get(site)!;

      const trySeqCombo = (legList: SeqLeg[]) => {
        if (opts.coteMinParSelection > 0 && legList.some(l => l.principal.some(p => p.b < opts.coteMinParSelection))) return;
        // Pas de matrice d'issues croisées en séquentiel (cf. doc « Symétrie ») : toujours 'sym'.
        // Le flag allowAsym ne s'applique qu'au simultané.
        const symmetry: 'sym' = 'sym';
        if (!opts.allowSym) return;

        // Combinés joués : une issue jouée par sélection (plusieurs combinés si une sélection en a
        // plusieurs). Cotes arrondies à 2 décimales (convention bookmaker : la cote du ticket).
        let sideCombos: SeqLeg['principal'][] = [[]];
        for (const leg of legList) sideCombos = sideCombos.flatMap(c => leg.principal.map(p => [...c, p]));
        const combos = sideCombos.map(ps => ({
          legs: ps.map((p, i) => ({ eventKey: legList[i].eventKey, marketName: p.marketName, outcomeName: p.outcomeName, betType: 'Back' as const })),
          B: roundCombo(ps.reduce((x, p) => x * p.b, 1)),
          BGross: roundCombo(ps.reduce((x, p) => x * p.bGross, 1)),
        }));
        // Cotes min. et max. sur la cote de chaque combiné (cote affichée), comme en simultané.
        for (const c of combos) {
          if (opts.coteMin > 0 && c.BGross < opts.coteMin) return;
          if (aboveCoteMax(c.BGross, opts)) return;
        }
        const K = legList.reduce((p, l) => p * l.bestK, 1);
        // Cote nette équivalente des combinés (un seul : sa cote) : ils rapportent tous S × B.
        const invB = combos.reduce((s, c) => s + 1 / c.B, 0);
        const B = 1 / invB;

        // Paris de couverture de la sélection i pour un engagement total `committed`, réparti
        // entre ses issues pour qu'elles rapportent toutes committed × E.
        const coverBets = (i: number, committed: number): BetDetail[] => {
          const leg = legList[i];
          return leg.cover.map(cs => {
            const part = committed * leg.E / cs.e;
            const lay = cs.legRef.betType === 'Lay';
            return {
              legs: [cs.legRef], site: cs.site, odds: cs.oddsGross,
              stake: lay ? part / (cs.lGross! - 1) : part,
              betType: 'cash' as const, role: 'cover' as const, seqStep: i + 1,
              ...(lay ? { liability: part } : {}),
            };
          });
        };
        const pushResult = (bets: BetDetail[], profit: number, rate: number, totalCash: number,
          noBoost?: { profitNoBoost: number; rateNoBoost: number }) => {
          if (bets.some(b => !(b.stake > 0))) return; // mise nulle ou négative : pas de résultat
          const { satisfiedMissions, obligatoryOk } = checkAllMissions(data, bets, opts);
          if (!obligatoryOk) return;
          const uniqueSites = new Set(bets.map(b => b.site));
          results.push({
            timing: 'seq', placement: uniqueSites.size === 1 ? 'uni' : 'multi', symmetry,
            bets, eventKeys: [...new Set(legList.map(l => l.eventKey))], nMatches: legList.length,
            profit, rate, totalCash, satisfiedMissions,
            ...(noBoost ?? {}),
          });
        };

        if (opts.betType === 'fb') {
          // Combinés en freebet : chacun rapporte X = mise × (cote − 1) s'il gagne. X vient du
          // freebet du site, relevé si le mode de montant l'exige (comme en simultané) : mise
          // min. = montant ; profit net / brut : X au moins égal au montant.
          const invFb = combos.reduce((s, c) => s + 1 / (c.B - 1), 0);
          let X = fbStake / invFb;
          if (opts.amountMode === 'mise_min_par_pari') X = Math.max(X, opts.amount * Math.max(...combos.map(c => c.B - 1)));
          else if (opts.amountMode === 'profit_net_min' || opts.amountMode === 'profit_brut') X = Math.max(X, opts.amount);
          if (!isFinite(X) || X <= 0) return;
          const S = X * invFb;
          const profit = X / K;
          const bets: BetDetail[] = combos.map(c => ({
            legs: c.legs, site, odds: c.BGross, stake: X / (c.B - 1), betType: 'fb' as const, role: 'principal' as const, seqStep: 0,
          }));
          let kPrev = 1;
          for (let i = 0; i < legList.length; i++) {
            bets.push(...coverBets(i, profit * kPrev / (legList[i].E - 1)));
            kPrev *= legList[i].bestK;
          }
          pushResult(bets, profit, profit / S, bets.filter(b => b.betType === 'cash').reduce((s, b) => s + (b.liability ?? b.stake), 0));
          return;
        }

        // Boost (Cash) : comme en simultané, seulement des résultats boostés, avec UNE issue boostée
        // sur le site du boost : ici le combiné, s'il est seul et placé sur ce site. Cote boostée
        // 1 + (B − 1) × (1 + boost %) ; couvertures dimensionnées sur cette cote.
        const boostActive = (opts.boostPct ?? 0) > 0 && !!opts.boostSite;
        if (boostActive && (site !== opts.boostSite || combos.length > 1)) return;

        // Cash, par unité de mise totale S des combinés :
        //  - 'miser' : couvertures composées par leg.bestK, profit égal partout (T = S × B / K) ;
        //  - 'gagner' : une couverture gagnante rembourse ce qui est en jeu (résultat nul), la perte
        //    est sur les combinés gagnants ;
        //  - 'perdre' : les combinés gagnants remboursent tout, la perte est sur une couverture gagnante.
        // f : facteur de boost (1 = sans boost).
        const cashResult = (f: number) => {
          const boost = (o: number) => f === 1 ? o : 1 + (o - 1) * f;
          const cB = combos.map(c => boost(c.B));                  // cotes nettes (boostée si f > 1)
          const cBGross = combos.map(c => boost(c.BGross));
          const invBf = cB.reduce((x, b) => x + 1 / b, 0);
          const Bf = 1 / invBf;
          const rate = Bf / K;
          const obj = opts.cashObjective;
          // Engagement de la couverture i (mise Back, engagement Lay), par unité de S. Gagner /
          // perdre composent les cotes des sélections : la dernière prend la cote qui ramène le
          // produit à celle des combinés, Π b = Bf (cote arrondie du ticket, boost compris).
          const coverUnit: number[] = [];
          let kPrev1 = 1;
          legList.forEach((leg, i) => {
            const b = i === legList.length - 1 && obj !== 'miser' ? Bf / kPrev1 : leg.b;
            if (obj === 'miser') { coverUnit.push(rate * kPrev1 / (leg.E - 1)); kPrev1 *= leg.bestK; }
            else if (obj === 'gagner') { coverUnit.push(kPrev1 / (leg.E - 1)); kPrev1 *= b; }
            else { coverUnit.push(kPrev1 * (b - 1)); kPrev1 *= b; }
          });
          const comboUnit = cB.map(b => (1 / b) / invBf);
          const units: SeqUnit[] = [
            ...combos.map((_, ci) => ({
              site, principal: true, stake: comboUnit[ci], committed: comboUnit[ci],
              net: comboUnit[ci] * (cB[ci] - 1), gross: comboUnit[ci] * cB[ci],
            })),
            ...legList.flatMap((leg, i) => leg.cover.map(cs => {
              const part = coverUnit[i] * leg.E / cs.e;
              const stake = cs.legRef.betType === 'Lay' ? part / (cs.lGross! - 1) : part;
              return { site: cs.site, principal: false, stake, committed: part, net: part * (cs.e - 1), gross: stake * cs.oddsGross };
            })),
          ];
          const S = seqUnitsScale(units, site, opts);
          if (!isFinite(S) || S <= 0) return null;

          const bets: BetDetail[] = combos.map((c, ci) => ({
            legs: c.legs, site, odds: cBGross[ci], stake: comboUnit[ci] * S, betType: 'cash' as const, role: 'principal' as const, seqStep: 0,
            ...(f > 1 ? { boosted: true, oddsBase: c.BGross } : {}),
          }));
          const coverCommitted: number[] = [];
          for (let i = 0; i < legList.length; i++) {
            coverCommitted.push(coverUnit[i] * S);
            bets.push(...coverBets(i, coverUnit[i] * S));
          }
          const coversTotal = coverCommitted.reduce((x, c) => x + c, 0);
          let profit: number;
          if (obj === 'miser') profit = S * rate - S;
          else if (obj === 'gagner') profit = S * (Bf - 1) - coversTotal; // perte si les combinés gagnent
          else {
            // Pire cas d'une couverture gagnante (tout placé d'avance) : son gain net moins les
            // combinés et les autres couvertures perdus.
            let worst = Infinity;
            for (let i = 0; i < legList.length; i++) {
              const net = coverCommitted[i] * (legList[i].E - 1) - S - (coversTotal - coverCommitted[i]);
              if (net < worst) worst = net;
            }
            profit = isFinite(worst) ? worst : 0;
          }
          return { bets, profit, rate, totalCash: S + coversTotal };
        };

        const main = cashResult(boostActive ? 1 + opts.boostPct! / 100 : 1);
        if (!main) return;
        // Boost : profit et taux du même résultat sans boost, pour comparer (comme en simultané).
        const ref = boostActive ? cashResult(1) : null;
        pushResult(main.bets, main.profit, main.rate, main.totalCash,
          ref ? { profitNoBoost: ref.profit, rateNoBoost: ref.rate } : undefined);
      };

      forEachSeqChain(pool, n, legList => {
        const idx = seqCounter++;
        if (shard && idx % shard.count !== shard.index) return;
        progress.step(detail);
        trySeqCombo(legList);
      });
    }
  }

  return results;
}

// ===== MAIN EXPORT =====

export interface ComputeShard { index: number; count: number }

export function compute(
  data: any,
  opts: EngineOpts,
  onProgress?: (detail: string, done: number, total: number) => void,
  shard?: ComputeShard,
): AllResults {
  const results: CoveringSetResult[] = [];

  // Totaux connus d'avance : une seule barre de progression (simultané puis séquentiel).
  const topEvents = opts.allowSimult ? getTopEvents(data, opts) : [];
  const seqPrep = opts.allowSeq ? prepareSeq(data, opts) : null;
  const total = shardShare(opts.allowSimult ? countSimultCombos(data, opts, topEvents) : 0, shard)
    + shardShare(seqPrep?.total ?? 0, shard);
  const progress = makeProgress(total, onProgress);

  // Pas de push(...liste) : au-delà d'environ 100 000 résultats, l'étalement dépasse la pile.
  const simult = opts.allowSimult ? computeSimult(data, opts, topEvents, progress, shard) : [];
  const seq = seqPrep ? computeSeq(data, opts, seqPrep, progress, shard) : [];
  progress.flush();

  return results.concat(simult, seq).sort((a, b) => b.profit - a.profit);
}
