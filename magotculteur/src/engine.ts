import type {
  BetSpec, CoverageRule, EngineOpts, Cover, Leg, LegRef, LayInfo,
  BetDetail, CoveringSetResult, AllResults, BetType, SiteConfig
} from './types';

export const MIN_GAP_MS = 90 * 60 * 1000;
const TOP_EVENTS = 30;
const TOP_SEQ = 50;

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

function resolveCoverSpec(spec: BetSpec, bindings: Record<string, string>): { market: string; issue: string; betType: string } | null {
  if (isRegexStr(spec.market)) return null;
  const market = resolveTemplate(spec.market, bindings);
  const issue = resolveTemplate(spec.issue, bindings);
  return (market && issue) ? { market, issue, betType: spec.betType } : null;
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

function findCoversForOutcome(event: any, mainMarketName: string, mainOutcomeName: string, site: string, opts: EngineOpts): Cover[] {
  const covers: Cover[] = [];
  const seen = new Set<string>();
  for (const rule of opts.coverageRules) {
    if (rule.issues !== 2) continue;
    const sideKeys = (['A', 'B'] as const).filter(k => rule[k]);
    for (const sideAKey of sideKeys) {
      const sideBKey = sideKeys.find(k => k !== sideAKey)!;
      for (const opt of rule[sideAKey]!) {
        if (opt.betType !== 'Back') continue;
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
            if (resolved.betType === 'Lay') {
              const lay = getLayInfo(val);
              if (!lay) continue;
              const key = `L:${mName}:${oName}:${s}`;
              if (seen.has(key)) continue; seen.add(key);
              covers.push({ type: 'lay', site: s, marketName: mName, outcomeName: oName,
                odds: lay.lNet, lGross: lay.lGross, c: lay.c, k: lay.k });
            } else {
              const o = getBackOdds(val);
              if (!o || o <= 1) continue;
              const key = `B:${mName}:${oName}:${s}`;
              if (seen.has(key)) continue; seen.add(key);
              covers.push({ type: 'bk', site: s, marketName: mName, outcomeName: oName,
                odds: o, lGross: null, c: null, k: kFromBk(o) });
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
        const b = getBackOdds(fbVal);
        if (!b || b <= 1) continue;
        if (opts.coteMin > 0 && b < opts.coteMin) continue;
        const covers = findCoversForOutcome(event, marketName, outcomeName, site, opts);
        if (!covers.length) continue;
        const bestCover = covers.reduce((best, cov) => cov.k < best.k ? cov : best);
        legs.push({ eventKey, evName, evDate, evComp, dateTime, marketName, outcomeName, b, covers, bestCover, bestK: bestCover.k });
      }
    }
  }
  return legs;
}

// ===== COVER SET GENERATORS =====

function ruleSideBackLeg(rule: CoverageRule, sideKey: 'A' | 'B' | 'C', event: any, eventKey: string): LegRef | null {
  for (const opt of (rule[sideKey] || [])) {
    if (opt.betType !== 'Back') continue;
    for (const [marketName, market] of Object.entries(event.markets || {}) as [string, any][]) {
      for (const [outcomeName] of Object.entries(market)) {
        if (matchBetSpec(opt, marketName, outcomeName))
          return { eventKey, marketName, outcomeName };
      }
    }
  }
  return null;
}

function getCoverSets(data: any, eventKey: string, opts: EngineOpts): LegRef[][][] {
  const event = data[eventKey];
  if (!event) return [];
  const sets: LegRef[][][] = [];
  const seen = new Set<string>();
  for (const rule of opts.coverageRules) {
    const sideKeys = (['A', 'B', 'C'] as const).filter(k => rule[k]);
    if (sideKeys.length < 2) continue;
    const legs = sideKeys.map(k => ruleSideBackLeg(rule, k, event, eventKey));
    if (legs.some(l => !l)) continue;
    const key = (legs as LegRef[]).map(l => l.marketName + ':' + l.outcomeName).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    sets.push((legs as LegRef[]).map(l => [l]));
  }
  return sets;
}

function getAsymSplits(data: any, eventKey: string, opts: EngineOpts) {
  const splits: Array<{ singleGroup: LegRef[]; combinedGroups: LegRef[][] }> = [];
  const seen = new Set<string>();
  // Use simple cover sets (no cross-products) to keep asymmetric computation tractable
  for (const coverSet of getCoverSets(data, eventKey, opts)) {
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

function getFreebetEligibleSites(opts: EngineOpts): string[] {
  return Object.entries(opts.sites)
    .filter(([, cfg]) => cfg.freebetPriority <= 2 && cfg.freebetAmount > 0)
    .map(([s]) => s);
}

// Combined back odds for a group of legs on one site; null if unavailable/filtered
function legGroupOdds(data: any, legRefs: LegRef[], site: string, coteMinPerSel: number): number | null {
  let combined = 1;
  for (const { eventKey, marketName, outcomeName } of legRefs) {
    const oddsMap = data[eventKey]?.markets?.[marketName]?.[outcomeName];
    if (!oddsMap) return null;
    const val = oddsMap[site];
    if (val == null) return null;
    // Skip exchange objects for combined bets
    if (legRefs.length > 1 && isExchange(val)) return null;
    const o = getBackOdds(val);
    if (!o || o <= 1) return null;
    if (coteMinPerSel > 0 && o < coteMinPerSel) return null;
    combined *= o;
  }
  return combined;
}

// ===== MISSION CHECKING =====

function checkAllMissions(bets: BetDetail[], opts: EngineOpts): { satisfiedMissions: string[]; obligatoryOk: boolean } {
  const satisfiedMissions: string[] = [];
  let obligatoryOk = true;

  for (const [site, cfg] of Object.entries(opts.sites)) {
    const siteBets = bets.filter(b => b.site === site);

    for (const mission of cfg.missions) {
      const minLegs = mission.nbCombinesMin || 1;
      const qualBets = siteBets.filter(b => b.legs.length >= minLegs);
      let ok = false;
      for (const bet of qualBets) {
        if (mission.coteMin > 0 && bet.odds < mission.coteMin) continue;
        let meetsAmount = false;
        if (mission.montantMode === 'mise_min') {
          meetsAmount = bet.stake >= mission.montant;
        } else if (mission.montantMode === 'profit_net_min') {
          meetsAmount = bet.stake * (bet.odds - 1) >= mission.montant;
        } else if (mission.montantMode === 'profit_brut') {
          meetsAmount = bet.stake * bet.odds >= mission.montant;
        }
        if (meetsAmount) { ok = true; break; }
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
  symmetry: 'sym' | 'asym',
  sitePerGroup: string[],
  opts: EngineOpts
): CoveringSetResult | null {
  const n = betsLegsArray.length;
  const oddsPerGroup: number[] = [];

  for (let i = 0; i < n; i++) {
    const o = legGroupOdds(data, betsLegsArray[i], sitePerGroup[i], opts.coteMinParSelection);
    if (!o) return null;
    oddsPerGroup.push(o);
  }

  // Apply coteMin to obligatory sites' bets
  const obligSites = new Set(getObligatorySites(opts));
  for (let i = 0; i < n; i++) {
    if (opts.coteMin > 0) {
      const isOblig = obligSites.size === 0 || obligSites.has(sitePerGroup[i]);
      if (isOblig && oddsPerGroup[i] < opts.coteMin) return null;
    }
  }

  let profit: number, rate: number, totalCash: number;
  const bets: BetDetail[] = [];

  if (opts.betType === 'fb') {
    const sumInv = oddsPerGroup.reduce((s, o) => s + 1 / (o - 1), 0);
    if (!isFinite(sumInv) || sumInv <= 0) return null;
    rate = 1 / sumInv;

    // Determine total freebet amount from P1 sites
    const p1Sites = [...obligSites];
    let totalFB = p1Sites.reduce((s, site) => s + (opts.sites[site]?.freebetAmount ?? 0), 0);
    if (totalFB <= 0) totalFB = opts.amount;

    // Scale for amountMode
    if (opts.amountMode === 'mise_min_par_pari') {
      // stake_i = profit/(o_i-1) >= opts.amount → profit >= opts.amount*(o_i-1) → totalFB >= opts.amount*max(o_i-1)/rate
      const needed = opts.amount * Math.max(...oddsPerGroup.map(o => o - 1)) / rate;
      if (needed > totalFB) totalFB = needed;
    } else if (opts.amountMode === 'profit_net_min') {
      // profit = totalFB * rate >= opts.amount
      if (totalFB * rate < opts.amount) totalFB = opts.amount / rate;
    } else if (opts.amountMode === 'profit_brut') {
      // gain_i = odds_i * stake_i = profit * odds_i/(odds_i-1); min gain = profit * min(o/(o-1)) >= opts.amount
      // min(o/(o-1)) achieved at max odds: 1 + 1/(maxOdds-1)
      const maxOdds = Math.max(...oddsPerGroup);
      const minGainFactor = maxOdds / (maxOdds - 1);
      const needed = opts.amount / (rate * minGainFactor);
      if (needed > totalFB) totalFB = needed;
    }

    profit = totalFB * rate;

    for (let i = 0; i < n; i++) {
      const stake = profit / (oddsPerGroup[i] - 1);
      bets.push({
        legs: betsLegsArray[i],
        site: sitePerGroup[i],
        odds: oddsPerGroup[i],
        stake,
        betType: 'fb',
        role: 'principal',
      });
    }
    totalCash = 0;
  } else {
    // Cash mode
    const sumInv = oddsPerGroup.reduce((s, o) => s + 1 / o, 0);
    if (!isFinite(sumInv) || sumInv <= 0) return null;
    rate = 1 / sumInv; // return rate

    let totalStake = opts.amount;
    // Scale for amountMode
    if (opts.amountMode === 'mise_min_par_pari') {
      // stake_i = totalReturn / o_i >= opts.amount → totalReturn >= opts.amount*max(o_i) → totalStake >= opts.amount*max(o_i)/rate
      const needed = opts.amount * Math.max(...oddsPerGroup) / rate;
      if (needed > totalStake) totalStake = needed;
    } else if (opts.amountMode === 'profit_net_min') {
      // Guaranteed net outcome = totalStake*(rate-1). For covering (rate<1), this is a loss.
      // User enters acceptable loss as positive: loss = opts.amount → totalStake*(1-rate) = opts.amount → totalStake = opts.amount/(1-rate)
      if (rate < 1) {
        totalStake = opts.amount / (1 - rate);
      } else {
        // rate >= 1: must guarantee profit >= opts.amount
        if (totalStake * (rate - 1) < opts.amount) totalStake = opts.amount / (rate - 1);
      }
    } else if (opts.amountMode === 'profit_brut') {
      // Gross return per outcome = totalReturn = totalStake*rate >= opts.amount
      const needed = opts.amount / rate;
      if (needed > totalStake) totalStake = needed;
    }

    // Classify each group as principal (obligatory site) or cover
    const isObligGroup = betsLegsArray.map((_, i) => obligSites.size === 0 || obligSites.has(sitePerGroup[i]));
    const principalIdxs = betsLegsArray.map((_, i) => i).filter(i => isObligGroup[i]);
    const coverIdxs = betsLegsArray.map((_, i) => i).filter(i => !isObligGroup[i]);

    // Build stakes according to objective
    const obj = opts.cashObjective;
    let stakes: number[];

    if (obj === 'miser' || principalIdxs.length === 0 || coverIdxs.length === 0) {
      // Standard Dutch: equal profit across all outcomes
      const totalReturn = totalStake * rate;
      stakes = oddsPerGroup.map(o => totalReturn / o);
      profit = totalReturn - totalStake;
      totalCash = totalStake;
    } else if (obj === 'gagner') {
      // Cover bets must individually break even (gain = stake per cover)
      // stake_cover_i × odds_i = stake_cover_i → only possible if odds_i = 1 (impossible)
      // Correct spec: covers return the total invested amount → stake_cover_i × odds_i = totalStake
      // → stake_cover_i = totalStake / odds_cover_i
      // Principal site receives remaining return: totalReturn - sum(stake_cover)
      // Actually: set cover stakes so their winnings cover the whole stake:
      // For each cover i: stake_i = totalStake / odds_i (so gain = totalStake)
      // Then principal stake = totalStake - sum(cover_stakes)
      // And principal gain = odds_p × stake_p (must equal totalStake too)
      const coverOddsSum = coverIdxs.reduce((s, i) => s + 1 / oddsPerGroup[i], 0);
      const principalOddsInv = principalIdxs.reduce((s, i) => s + 1 / oddsPerGroup[i], 0);
      // All outcomes return totalStake (break even on covers, covers pay for principal loss)
      // For cover wins: stake_cover × odds_cover = totalStake → stake_cover = totalStake / odds_cover
      // For principal wins: stake_principal × odds_principal = totalStake → stake_principal = totalStake / odds_principal
      // totalStake = sum(stakes) must hold → sum(1/o_i) × totalStake = totalStake → only if sum = 1
      // Instead: set totalReturn = totalStake so all breakeven; scale principal so loss is only there
      // Practical: cover stakes → stake_i = amount/odds_i (so win = amount on cover outcomes)
      // principal stake = amount - sum(cover_stakes)
      const coverStakes = coverIdxs.map(i => opts.amount / oddsPerGroup[i]);
      const coverStakeTotal = coverStakes.reduce((s, v) => s + v, 0);
      const principalStakeTotal = opts.amount - coverStakeTotal;
      if (principalStakeTotal <= 0) return null; // covers cost more than amount
      // Distribute principal stake proportionally among principal groups
      const principalOddsInvSum = principalIdxs.reduce((s, i) => s + 1 / oddsPerGroup[i], 0);
      stakes = betsLegsArray.map((_, idx) => {
        const ci = coverIdxs.indexOf(idx);
        if (ci >= 0) return coverStakes[ci];
        const pi = principalIdxs.indexOf(idx);
        // Give each principal stake so gains = opts.amount (break even on principal outcomes too if possible)
        return opts.amount / oddsPerGroup[idx];
      });
      // Recompute totalStake
      totalStake = stakes.reduce((s, v) => s + v, 0);
      profit = opts.amount - totalStake; // on any outcome, gain = opts.amount; profit = gain - totalStake
      totalCash = totalStake;
    } else {
      // perdre: principal bets must individually return the total invested
      // → stake_principal_i = totalStake / odds_i  (so gain = totalStake on principal wins)
      // → cover stakes bear the loss
      // Similarly to 'gagner' but flipped
      const principalStakes = principalIdxs.map(i => opts.amount / oddsPerGroup[i]);
      const principalStakeTotal = principalStakes.reduce((s, v) => s + v, 0);
      const coverStakeTotal = opts.amount - principalStakeTotal;
      if (coverStakeTotal <= 0) return null;
      stakes = betsLegsArray.map((_, idx) => {
        const pi = principalIdxs.indexOf(idx);
        if (pi >= 0) return principalStakes[pi];
        return opts.amount / oddsPerGroup[idx]; // covers also break even
      });
      totalStake = stakes.reduce((s, v) => s + v, 0);
      profit = opts.amount - totalStake;
      totalCash = totalStake;
    }

    for (let i = 0; i < n; i++) {
      bets.push({
        legs: betsLegsArray[i],
        site: sitePerGroup[i],
        odds: oddsPerGroup[i],
        stake: stakes[i],
        betType: 'cash',
        role: isObligGroup[i] ? 'principal' : 'cover',
      });
    }
  }

  const { satisfiedMissions, obligatoryOk } = checkAllMissions(bets, opts);
  if (!obligatoryOk) return null;

  const uniqueSites = new Set(sitePerGroup);
  const placement: 'uni' | 'multi' = uniqueSites.size === 1 ? 'uni' : 'multi';

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
  };
}

// Try all site assignments for a covering set
function trySimult(
  data: any,
  betsLegsArray: LegRef[][],
  eventKeys: string[],
  symmetry: 'sym' | 'asym',
  opts: EngineOpts
): CoveringSetResult[] {
  const results: CoveringSetResult[] = [];
  const obligSites = getObligatorySites(opts);
  const fbSites = getFreebetEligibleSites(opts);
  const allSites = Object.keys(opts.sites);

  // Helper: get best odds for a leg group from a list of sites
  function bestSiteForGroup(legRefs: LegRef[], sites: string[]): { site: string; odds: number } | null {
    let best: { site: string; odds: number } | null = null;
    for (const site of sites) {
      const o = legGroupOdds(data, legRefs, site, opts.coteMinParSelection);
      if (!o) continue;
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

    for (const site of uniSites) {
      const sitePerGroup = betsLegsArray.map(() => site);
      const r = makeSimultResult(data, betsLegsArray, eventKeys, symmetry, sitePerGroup, opts);
      if (r) results.push(r);
    }
  }

  // --- MULTI-SITE ---
  if (opts.allowMulti) {
    // Each bet group goes to its best site
    const sitesToUse = opts.betType === 'fb'
      ? (fbSites.length > 0 ? fbSites : allSites)
      : allSites;

    const sitePerGroup: string[] = [];
    let valid = true;
    for (const legRefs of betsLegsArray) {
      const best = bestSiteForGroup(legRefs, sitesToUse);
      if (!best) { valid = false; break; }
      sitePerGroup.push(best.site);
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
          const r = makeSimultResult(data, betsLegsArray, eventKeys, symmetry, sitePerGroup, opts);
          if (r) results.push(r);
        }
      }
    }

    // If there are obligatory sites not in the best assignment, try forcing them in
    if (obligSites.length >= 1) {
      for (const obligSite of obligSites) {
        // Find which group is best for this obligatory site and try assigning it there
        let bestGroupIdx = -1, bestOdds = 0;
        for (let i = 0; i < betsLegsArray.length; i++) {
          const o = legGroupOdds(data, betsLegsArray[i], obligSite, opts.coteMinParSelection);
          if (o && o > bestOdds) { bestOdds = o; bestGroupIdx = i; }
        }
        if (bestGroupIdx < 0) continue;

        const forcedSitePerGroup = betsLegsArray.map((legRefs, i) => {
          if (i === bestGroupIdx) return obligSite;
          // Best from remaining sites
          const remaining = sitesToUse.filter(s => s !== obligSite);
          const best = bestSiteForGroup(legRefs, remaining.length > 0 ? remaining : sitesToUse);
          return best?.site ?? obligSite;
        });

        const uniqueForced = new Set(forcedSitePerGroup);
        if (uniqueForced.size >= 2) {
          const r = makeSimultResult(data, betsLegsArray, eventKeys, symmetry, forcedSitePerGroup, opts);
          if (r) {
            const key = r.bets.map(b => b.site + ':' + b.legs.map(l => l.outcomeName).join('+')).join('|');
            if (!results.some(existing => {
              const ek = existing.bets.map(b => b.site + ':' + b.legs.map(l => l.outcomeName).join('+')).join('|');
              return ek === key;
            })) results.push(r);
          }
        }
      }
    }
  }

  return results;
}

// ===== SIMULT MAIN LOOP =====

function computeSimult(data: any, opts: EngineOpts, onProgress?: (detail: string, done: number, total: number) => void): CoveringSetResult[] {
  const topEvents = getTopEvents(data, opts);
  const allEventKeys = Object.keys(data);

  // Pre-compute total event combos for accurate progress tracking
  let totalCombos = 0;
  for (const n of opts.allowedNLegs) {
    totalCombos += C(n === 1 ? allEventKeys.length : topEvents.length, n);
  }
  let doneCombos = 0;

  const results: CoveringSetResult[] = [];
  const bestPerCombo = new Map<string, CoveringSetResult>();
  let lastProgressReport = 0;

  for (const n of opts.allowedNLegs) {
    const nStr = n === 1 ? '1 combiné' : `${n} combinés`;
    const hasSym = opts.allowSym;
    const hasAsym = opts.allowAsym && n > 1;
    const symSuffix = (hasSym && !hasAsym) ? ' • Symétrique' : (!hasSym && hasAsym) ? ' • Asymétrique' : '';
    const detail = `${nStr} • Simultané${symSuffix}`;

    const eventPool = n === 1 ? allEventKeys : topEvents;

    forEachCombo(eventPool, n, combo => {
      doneCombos++;
      const now = Date.now();
      if (now - lastProgressReport >= 50) {
        lastProgressReport = now;
        onProgress?.(detail, doneCombos, totalCombos);
      }
      const comboKey = combo.slice().sort().join('|');
      const coverSetsPerEvent = combo.map(ek => getCoverSets(data, ek, opts));
      if (coverSetsPerEvent.some(s => !s.length)) return;

      forEachCoverSetCombo(coverSetsPerEvent, chosen => {
        const betsLegsArray = generateCoveringBets(chosen);

        // Key identifying the covering set structure (markets + outcomes), indépendamment du site
        const coverKey = betsLegsArray
          .map(group => group.map(l => l.marketName + ':' + l.outcomeName).sort().join('+'))
          .sort().join('||');

        // Symmetric
        if (opts.allowSym) {
          const symResults = trySimult(data, betsLegsArray, combo, 'sym', opts);
          for (const r of symResults) {
            const key = comboKey + '|' + coverKey + '|sym|' + r.placement;
            const prev = bestPerCombo.get(key);
            if (!prev || r.rate > prev.rate) bestPerCombo.set(key, r);
          }
        }

        // Asymmetric (only for multi-match)
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
              const css = getCoverSets(data, ek, opts);
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
                const asymResults = trySimult(data, asymLegsArray, [ekS, ...ekCs], 'asym', opts);
                for (const r of asymResults) {
                  const key = comboKey + '|asym|' + si + '|' + asymCoverKey + '|' + r.placement;
                  const prev = bestPerCombo.get(key);
                  if (!prev || r.rate > prev.rate) bestPerCombo.set(key, r);
                }
              });
            }
          }
        }
      });
    });
  }

  return [...results, ...bestPerCombo.values()];
}

// ===== SEQUENTIAL COMPUTATION =====

function computeSeq(data: any, opts: EngineOpts, onProgress?: (detail: string, done: number, total: number) => void): CoveringSetResult[] {
  const obligSites = getObligatorySites(opts);
  const sitesToUse = obligSites.length > 0 ? obligSites
    : opts.betType === 'fb' ? getFreebetEligibleSites(opts)
    : Object.keys(opts.sites);

  if (!sitesToUse.length) return [];

  // Cache legs per site to avoid recomputing for each n
  const legsPerSite = new Map<string, Leg[]>();
  for (const site of sitesToUse) {
    legsPerSite.set(site, collectLegsForSite(data, site, opts));
  }

  const results: CoveringSetResult[] = [];

  for (const n of opts.allowedNLegs.filter(x => x >= 2 && x <= 3)) {
    const nStr = n === 1 ? '1 combiné' : `${n} combinés`;
    onProgress?.(`${nStr} • Séquentiel`, 0, 0);

    for (const site of sitesToUse) {
      const legs = legsPerSite.get(site)!;

      if (n === 1) {
        if (!opts.allowSym) continue; // single-event sequential is always symmetric
        for (const leg of legs) {
          for (const cover of leg.covers) {
            if (opts.betType === 'fb') {
              const profit = opts.amount * (leg.b - 1) / cover.k;
              const rate = profit / opts.amount;
              const stake = profit / (cover.type === 'lay' ? (1 - cover.c!) : (cover.odds - 1));
              const liability = cover.type === 'lay' ? stake * (cover.lGross! - 1) : null;

              const bets: BetDetail[] = [
                { legs: [{ eventKey: leg.eventKey, marketName: leg.marketName, outcomeName: leg.outcomeName }], site, odds: leg.b, stake: opts.amount, betType: 'fb', role: 'principal', seqStep: 0 },
                { legs: [{ eventKey: leg.eventKey, marketName: cover.marketName, outcomeName: cover.outcomeName }], site: cover.site, odds: cover.odds, stake, betType: 'cash', role: 'cover', seqStep: 0, ...(liability != null ? { liability } : {}) },
              ];

              const { satisfiedMissions, obligatoryOk } = checkAllMissions(bets, opts);
              if (!obligatoryOk) continue;
              results.push({
                timing: 'seq', placement: cover.site === site ? 'uni' : 'multi', symmetry: 'sym',
                bets, eventKeys: [leg.eventKey], nMatches: 1,
                profit, rate, totalCash: liability != null ? liability : stake, satisfiedMissions,
              });
            } else {
              // Cash
              const rate = leg.b / cover.k;
              const T = opts.amount * rate;
              const gain = cover.type === 'lay' ? (1 - cover.c!) : (cover.odds - 1);
              const stake = T / gain;
              const liability = cover.type === 'lay' ? stake * (cover.lGross! - 1) : null;
              const profit = T - opts.amount;

              const bets: BetDetail[] = [
                { legs: [{ eventKey: leg.eventKey, marketName: leg.marketName, outcomeName: leg.outcomeName }], site, odds: leg.b, stake: opts.amount, betType: 'cash', role: 'principal', seqStep: 0 },
                { legs: [{ eventKey: leg.eventKey, marketName: cover.marketName, outcomeName: cover.outcomeName }], site: cover.site, odds: cover.odds, stake, betType: 'cash', role: 'cover', seqStep: 0, ...(liability != null ? { liability } : {}) },
              ];

              const { satisfiedMissions, obligatoryOk } = checkAllMissions(bets, opts);
              if (!obligatoryOk) continue;
              results.push({
                timing: 'seq', placement: cover.site === site ? 'uni' : 'multi', symmetry: 'sym',
                bets, eventKeys: [leg.eventKey], nMatches: 1,
                profit, rate, totalCash: (liability ?? 0) + opts.amount, satisfiedMissions,
              });
            }
          }
        }
      } else {
        // n = 2 or 3: multi-leg sequential
        const pool = [...legs]
          .filter(l => l.dateTime !== null)
          .sort((a, b) => (opts.betType === 'fb'
            ? (b.b - 1) / b.bestK - (a.b - 1) / a.bestK
            : b.b / b.bestK - a.b / a.bestK
          ))
          .slice(0, TOP_SEQ);

        const trySeqCombo = (legList: Leg[]) => {
          // Classify symmetry: sym if all principal legs use the same market type, asym otherwise
          const marketTypes = new Set(legList.map(l => norm(l.marketName)));
          const symmetry: 'sym' | 'asym' = marketTypes.size === 1 ? 'sym' : 'asym';
          if (symmetry === 'sym' && !opts.allowSym) return;
          if (symmetry === 'asym' && !opts.allowAsym) return;

          const B = legList.reduce((p, l) => p * l.b, 1);
          const K = legList.reduce((p, l) => p * l.bestK, 1);

          if (opts.betType === 'fb') {
            const profit = opts.amount * (B - 1) / K;
            const rate = profit / opts.amount;
            let kPrev = 1;
            const bets: BetDetail[] = [
              {
                legs: legList.map(l => ({ eventKey: l.eventKey, marketName: l.marketName, outcomeName: l.outcomeName })),
                site, odds: B, stake: opts.amount, betType: 'fb', role: 'principal', seqStep: 0,
              },
            ];
            for (let i = 0; i < legList.length; i++) {
              const leg = legList[i];
              const cover = leg.bestCover;
              const gain = cover.type === 'lay' ? (1 - cover.c!) : (cover.odds - 1);
              const stake = profit * kPrev / gain;
              const liability = cover.type === 'lay' ? stake * (cover.lGross! - 1) : undefined;
              bets.push({
                legs: [{ eventKey: leg.eventKey, marketName: cover.marketName, outcomeName: cover.outcomeName }],
                site: cover.site, odds: cover.odds, stake, betType: 'cash', role: 'cover', seqStep: i + 1,
                ...(liability != null ? { liability } : {}),
              });
              kPrev *= leg.bestK;
            }

            const { satisfiedMissions, obligatoryOk } = checkAllMissions(bets, opts);
            if (!obligatoryOk) return;
            const uniqueSites = new Set(bets.map(b => b.site));
            results.push({
              timing: 'seq', placement: uniqueSites.size === 1 ? 'uni' : 'multi', symmetry,
              bets, eventKeys: [...new Set(legList.map(l => l.eventKey))], nMatches: legList.length,
              profit, rate, totalCash: bets.filter(b => b.betType === 'cash').reduce((s, b) => s + (b.liability ?? b.stake), 0),
              satisfiedMissions,
            });
          } else {
            const rate = B / K;
            const T = opts.amount * rate;
            const bets: BetDetail[] = [
              {
                legs: legList.map(l => ({ eventKey: l.eventKey, marketName: l.marketName, outcomeName: l.outcomeName })),
                site, odds: B, stake: opts.amount, betType: 'cash', role: 'principal', seqStep: 0,
              },
            ];
            for (let i = 0; i < legList.length; i++) {
              const leg = legList[i];
              const cover = leg.bestCover;
              const gain = cover.type === 'lay' ? (1 - cover.c!) : (cover.odds - 1);
              const stake = T / gain;
              const liability = cover.type === 'lay' ? stake * (cover.lGross! - 1) : undefined;
              bets.push({
                legs: [{ eventKey: leg.eventKey, marketName: cover.marketName, outcomeName: cover.outcomeName }],
                site: cover.site, odds: cover.odds, stake, betType: 'cash', role: 'cover', seqStep: i + 1,
                ...(liability != null ? { liability } : {}),
              });
            }

            const { satisfiedMissions, obligatoryOk } = checkAllMissions(bets, opts);
            if (!obligatoryOk) return;
            const uniqueSites = new Set(bets.map(b => b.site));
            results.push({
              timing: 'seq', placement: uniqueSites.size === 1 ? 'uni' : 'multi', symmetry,
              bets, eventKeys: [...new Set(legList.map(l => l.eventKey))], nMatches: legList.length,
              profit: T - opts.amount, rate, totalCash: opts.amount + bets.filter(b => b.betType === 'cash').reduce((s, b) => s + (b.liability ?? b.stake), 0),
              satisfiedMissions,
            });
          }
        };

        if (n === 2) {
          for (let i = 0; i < pool.length; i++) {
            const l1 = pool[i];
            for (let j = 0; j < pool.length; j++) {
              if (i === j || pool[j].eventKey === l1.eventKey) continue;
              const l2 = pool[j];
              if (!l2.dateTime || !l1.dateTime || l2.dateTime <= l1.dateTime) continue;
              if (l2.dateTime - l1.dateTime < MIN_GAP_MS) continue;
              trySeqCombo([l1, l2]);
            }
          }
        } else if (n === 3) {
          for (let i = 0; i < pool.length; i++) {
            const l1 = pool[i];
            for (let j = 0; j < pool.length; j++) {
              if (i === j || pool[j].eventKey === l1.eventKey) continue;
              const l2 = pool[j];
              if (!l2.dateTime || !l1.dateTime || l2.dateTime <= l1.dateTime) continue;
              if (l2.dateTime - l1.dateTime < MIN_GAP_MS) continue;
              for (let m = 0; m < pool.length; m++) {
                if (m === i || m === j || pool[m].eventKey === l1.eventKey || pool[m].eventKey === l2.eventKey) continue;
                const l3 = pool[m];
                if (!l3.dateTime || l3.dateTime <= l2.dateTime) continue;
                if (l3.dateTime - l2.dateTime < MIN_GAP_MS) continue;
                trySeqCombo([l1, l2, l3]);
              }
            }
          }
        }
      }
    }
  }

  return results;
}

// ===== MAIN EXPORT =====

export function compute(data: any, opts: EngineOpts, onProgress?: (detail: string, done: number, total: number) => void): AllResults {
  const results: CoveringSetResult[] = [];

  if (opts.allowSimult) {
    results.push(...computeSimult(data, opts, onProgress));
  }
  if (opts.allowSeq) {
    results.push(...computeSeq(data, opts, onProgress));
  }

  return results.sort((a, b) => b.profit - a.profit);
}
