import type { BetSpec, CoverageRule, EngineOpts, Cover, Leg, LegWithCover, LegRef, RawBet, FinalizedBet, LayInfo, SeqResult, ToutFBResult } from './types';

export const MIN_GAP_MS = 90 * 60 * 1000;
const TOP_MULTI_SEQ = 50;
export const TOP_EVENTS_TOUTFB = 30;

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
            if (val && typeof val === 'object') sites.add(site);
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

// ===== COVER SEARCH (Method 1) =====

function findCoversForOutcome(event: any, mainMarketName: string, mainOutcomeName: string, fbSite: string, opts: EngineOpts): Cover[] {
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
          for (const [site, val] of Object.entries(oddsMap as any)) {
            if (resolved.betType === 'Lay' && site === fbSite) continue;
            if (resolved.betType === 'Lay') {
              const lay = getLayInfo(val);
              if (!lay) continue;
              const key = `L:${mName}:${oName}:${site}`;
              if (seen.has(key)) continue; seen.add(key);
              covers.push({ type: 'lay', site, marketName: mName, outcomeName: oName,
                odds: lay.lNet, lGross: lay.lGross, c: lay.c, k: lay.k });
            } else {
              const o = getBackOdds(val);
              if (!o || o <= 1) continue;
              const key = `B:${mName}:${oName}:${site}`;
              if (seen.has(key)) continue; seen.add(key);
              covers.push({ type: 'bk', site, marketName: mName, outcomeName: oName,
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

function collectLegs(data: any, fbSite: string, opts: EngineOpts): Leg[] {
  const legs: Leg[] = [];
  for (const [eventKey, event] of Object.entries(data) as [string, any][]) {
    const evName = eventDisplayName(eventKey, event);
    const evDate = formatDate(event.dateTime);
    const evComp = event.competition || event.tournoi || '';
    const dateTime = event.dateTime ? new Date(event.dateTime).getTime() : null;
    for (const [marketName, market] of Object.entries(event.markets || {}) as [string, any][]) {
      for (const [outcomeName, oddsMap] of Object.entries(market) as [string, any][]) {
        if (!oddsMap || typeof oddsMap !== 'object' || Array.isArray(oddsMap)) continue;
        const fbVal = oddsMap[fbSite];
        if (fbVal == null) continue;
        const b = getBackOdds(fbVal);
        if (!b || b <= 1) continue;
        if (opts.filterMinOdds > 0 && b < opts.filterMinOdds) continue;
        const covers = findCoversForOutcome(event, marketName, outcomeName, fbSite, opts);
        if (!covers.length) continue;
        const bestCover = covers.reduce((best, cov) => cov.k < best.k ? cov : best);
        legs.push({ eventKey, evName, evDate, evComp, dateTime, marketName, outcomeName, b, covers, bestCover, bestK: bestCover.k });
      }
    }
  }
  return legs;
}

// ===== METHOD 1: SEQUENTIAL DUTCHING =====

function stakeAndLiability(profit: number, kPrev: number, cover: Cover): { stake: number; liability: number | null } {
  const gain = cover.type === 'lay' ? (1 - cover.c!) : (cover.odds - 1);
  const stake = profit * kPrev / gain;
  const liability = cover.type === 'lay' ? stake * (cover.lGross! - 1) : null;
  return { stake, liability };
}

function stakeAndLiabilityCash(T: number, cover: Cover): { stake: number; liability: number | null } {
  const gain = cover.type === 'lay' ? (1 - cover.c!) : (cover.odds - 1);
  const stake = T / gain;
  const liability = cover.type === 'lay' ? stake * (cover.lGross! - 1) : null;
  return { stake, liability };
}

function bestFbCoverOdds(leg: Leg, data: any, fbSite: string, opts: EngineOpts): (Cover & { odds: number }) | null {
  let best: (Cover & { odds: number }) | null = null;
  for (const cover of leg.covers) {
    if (cover.type !== 'bk') continue;
    const val = data[leg.eventKey]?.markets?.[cover.marketName]?.[cover.outcomeName]?.[fbSite];
    const o = getBackOdds(val);
    if (!o || o <= 1) continue;
    if (opts.filterMinOdds > 0 && o < opts.filterMinOdds) continue;
    if (!best || o > best.odds) best = { ...cover, odds: o };
  }
  return best;
}

export function computeSeq(data: any, fbSite: string, amount: number, nLegs: number, betType: string, opts: EngineOpts): SeqResult[] {
  const legs = collectLegs(data, fbSite, opts);
  const results: SeqResult[] = [];

  if (betType === 'cash') {
    const legsForMulti = nLegs > 1
      ? [...legs].sort((a, b) => b.b / b.bestK - a.b / a.bestK).slice(0, TOP_MULTI_SEQ)
      : legs;

    if (nLegs === 1) {
      for (const leg of legs) {
        for (const cover of leg.covers) {
          const gain = cover.type === 'lay' ? (1 - cover.c!) : (cover.odds - 1);
          let stake: number, liability: number | null, rate: number, loss: number, netIfWins: number, netIfLoses: number;
          if (opts.cashObjective === 'gagner') {
            stake = amount / gain;
            liability = cover.type === 'lay' ? stake * (cover.lGross! - 1) : null;
            netIfLoses = 0;
            const coverCostGagner = cover.type === 'lay' ? liability! : stake;
            netIfWins = amount * (leg.b - 1) - coverCostGagner;
            rate = netIfWins / amount;
            loss = -Math.min(netIfWins, 0);
          } else if (opts.cashObjective === 'perdre') {
            const gainForStake = cover.type === 'lay' ? (cover.lGross! - 1) : (cover.odds - 1);
            stake = amount * (leg.b - 1) / gainForStake;
            liability = cover.type === 'lay' ? stake * (cover.lGross! - 1) : null;
            netIfWins = 0;
            netIfLoses = cover.type === 'lay' ? (stake * gain - amount) : (stake * (cover.odds - 1) - amount);
            rate = 1 + netIfLoses / amount;
            loss = -netIfLoses;
          } else {
            rate = leg.b / cover.k;
            const T = amount * rate;
            ({ stake, liability } = stakeAndLiabilityCash(T, cover));
            netIfWins = netIfLoses = -amount * (1 - rate);
            loss = amount * (1 - rate);
          }
          results.push({
            method: 1, nLegs: 1, betType: 'cash', _cashObjective: opts.cashObjective,
            B: leg.b, rate, loss,
            netIfWins, netIfLoses,
            legs: [{ ...leg, cover, stake, liability }],
          });
        }
      }
    } else if (nLegs === 2) {
      for (let i = 0; i < legsForMulti.length; i++) {
        const l1 = legsForMulti[i];
        if (!l1.dateTime) continue;
        for (let j = 0; j < legsForMulti.length; j++) {
          if (i === j) continue;
          const l2 = legsForMulti[j];
          if (l2.eventKey === l1.eventKey) continue;
          if (!l2.dateTime || l2.dateTime <= l1.dateTime) continue;
          if (l2.dateTime - l1.dateTime < MIN_GAP_MS) continue;
          const B = l1.b * l2.b, K = l1.bestK * l2.bestK;
          const rate = B / K;
          const T = amount * rate;
          results.push({
            method: 1, nLegs: 2, betType: 'cash',
            B, rate, loss: amount * (1 - rate),
            gaps: [l2.dateTime - l1.dateTime],
            legs: [
              { ...l1, cover: l1.bestCover, ...stakeAndLiabilityCash(T, l1.bestCover) },
              { ...l2, cover: l2.bestCover, ...stakeAndLiabilityCash(T, l2.bestCover) },
            ],
          });
        }
      }
    } else if (nLegs === 3) {
      for (let i = 0; i < legsForMulti.length; i++) {
        const l1 = legsForMulti[i];
        if (!l1.dateTime) continue;
        for (let j = 0; j < legsForMulti.length; j++) {
          if (i === j) continue;
          const l2 = legsForMulti[j];
          if (l2.eventKey === l1.eventKey) continue;
          if (!l2.dateTime || l2.dateTime <= l1.dateTime) continue;
          if (l2.dateTime - l1.dateTime < MIN_GAP_MS) continue;
          for (let m = 0; m < legsForMulti.length; m++) {
            if (m === i || m === j) continue;
            const l3 = legsForMulti[m];
            if (l3.eventKey === l1.eventKey || l3.eventKey === l2.eventKey) continue;
            if (!l3.dateTime || l3.dateTime <= l2.dateTime) continue;
            if (l3.dateTime - l2.dateTime < MIN_GAP_MS) continue;
            const B = l1.b * l2.b * l3.b, K = l1.bestK * l2.bestK * l3.bestK;
            const rate = B / K;
            const T = amount * rate;
            results.push({
              method: 1, nLegs: 3, betType: 'cash',
              B, rate, loss: amount * (1 - rate),
              gaps: [l2.dateTime - l1.dateTime, l3.dateTime - l2.dateTime],
              legs: [
                { ...l1, cover: l1.bestCover, ...stakeAndLiabilityCash(T, l1.bestCover) },
                { ...l2, cover: l2.bestCover, ...stakeAndLiabilityCash(T, l2.bestCover) },
                { ...l3, cover: l3.bestCover, ...stakeAndLiabilityCash(T, l3.bestCover) },
              ],
            });
          }
        }
      }
    }
    return results.sort((a, b) => b.rate - a.rate);
  }

  const legsForMulti = nLegs > 1
    ? [...legs].sort((a, b) => (b.b - 1) / b.bestK - (a.b - 1) / a.bestK).slice(0, TOP_MULTI_SEQ)
    : legs;

  if (nLegs === 1) {
    for (const leg of legs) {
      for (const cover of leg.covers) {
        const profit = amount * (leg.b - 1) / cover.k;
        const rate = profit / amount;
        const { stake, liability } = stakeAndLiability(profit, 1, cover);
        results.push({ method: 1, nLegs: 1, B: leg.b, profit, rate, betType,
          legs: [{ ...leg, cover, stake, liability }] });
      }
    }
  } else if (nLegs === 2) {
    for (let i = 0; i < legsForMulti.length; i++) {
      const l1 = legsForMulti[i];
      if (!l1.dateTime) continue;
      for (let j = 0; j < legsForMulti.length; j++) {
        if (i === j) continue;
        const l2 = legsForMulti[j];
        if (l2.eventKey === l1.eventKey) continue;
        if (!l2.dateTime || l2.dateTime <= l1.dateTime) continue;
        if (l2.dateTime - l1.dateTime < MIN_GAP_MS) continue;
        const B = l1.b * l2.b;
        const K = l1.bestK * l2.bestK;
        const profit = amount * (B - 1) / K;
        const rate = profit / amount;
        const s1 = stakeAndLiability(profit, 1, l1.bestCover);
        const s2 = stakeAndLiability(profit, l1.bestK, l2.bestCover);
        const fb1 = bestFbCoverOdds(l1, data, fbSite, opts);
        const fb2 = bestFbCoverOdds(l2, data, fbSite, opts);
        const profitFb = (fb1 && fb2) ? amount * Math.min(B - 1, fb1.odds - 1, fb2.odds - 1) : null;
        results.push({
          method: 1, nLegs: 2, B, profit, rate, betType,
          profitFb, rateFb: profitFb != null ? profitFb / amount : null,
          gaps: [l2.dateTime - l1.dateTime],
          legs: [
            { ...l1, cover: l1.bestCover, ...s1, fbCover: fb1 },
            { ...l2, cover: l2.bestCover, ...s2, fbCover: fb2 },
          ],
        });
      }
    }
  } else if (nLegs === 3) {
    for (let i = 0; i < legsForMulti.length; i++) {
      const l1 = legsForMulti[i];
      if (!l1.dateTime) continue;
      for (let j = 0; j < legsForMulti.length; j++) {
        if (i === j) continue;
        const l2 = legsForMulti[j];
        if (l2.eventKey === l1.eventKey) continue;
        if (!l2.dateTime || l2.dateTime <= l1.dateTime) continue;
        if (l2.dateTime - l1.dateTime < MIN_GAP_MS) continue;
        for (let m = 0; m < legsForMulti.length; m++) {
          if (m === i || m === j) continue;
          const l3 = legsForMulti[m];
          if (l3.eventKey === l1.eventKey || l3.eventKey === l2.eventKey) continue;
          if (!l3.dateTime || l3.dateTime <= l2.dateTime) continue;
          if (l3.dateTime - l2.dateTime < MIN_GAP_MS) continue;
          const B = l1.b * l2.b * l3.b;
          const K = l1.bestK * l2.bestK * l3.bestK;
          const profit = amount * (B - 1) / K;
          const rate = profit / amount;
          const s1 = stakeAndLiability(profit, 1, l1.bestCover);
          const s2 = stakeAndLiability(profit, l1.bestK, l2.bestCover);
          const s3 = stakeAndLiability(profit, l1.bestK * l2.bestK, l3.bestCover);
          const fb1 = bestFbCoverOdds(l1, data, fbSite, opts);
          const fb2 = bestFbCoverOdds(l2, data, fbSite, opts);
          const fb3 = bestFbCoverOdds(l3, data, fbSite, opts);
          const profitFb = (fb1 && fb2 && fb3)
            ? amount * Math.min(B - 1, fb1.odds - 1, fb2.odds - 1, fb3.odds - 1) : null;
          results.push({
            method: 1, nLegs: 3, B, profit, rate, betType,
            profitFb, rateFb: profitFb != null ? profitFb / amount : null,
            gaps: [l2.dateTime - l1.dateTime, l3.dateTime - l2.dateTime],
            legs: [
              { ...l1, cover: l1.bestCover, ...s1, fbCover: fb1 },
              { ...l2, cover: l2.bestCover, ...s2, fbCover: fb2 },
              { ...l3, cover: l3.bestCover, ...s3, fbCover: fb3 },
            ],
          });
        }
      }
    }
  }
  return results.sort((a, b) => b.rate - a.rate);
}

// ===== METHOD 2 & 4: COVERING SETS =====

function finalizeToutFBBets(rawBets: RawBet[], totalAmount: number): { rate: number; profit: number; bets: FinalizedBet[] } | null {
  const sumInv = rawBets.reduce((s, b) => s + 1 / (b.odds - 1), 0);
  if (!isFinite(sumInv) || sumInv <= 0) return null;
  const rate = 1 / sumInv;
  const profit = totalAmount * rate;
  const bets = rawBets.map(b => ({ ...b, stake: profit / (b.odds - 1) }));
  return { rate, profit, bets };
}

function finalizeToutFBCashBets(rawBets: RawBet[], totalAmount: number): { rate: number; loss: number; bets: FinalizedBet[] } | null {
  const sumInv = rawBets.reduce((s, b) => s + 1 / b.odds, 0);
  if (!isFinite(sumInv) || sumInv <= 0) return null;
  const rate = 1 / sumInv;
  const totalReturn = totalAmount * rate;
  const bets = rawBets.map(b => ({ ...b, stake: totalReturn / b.odds }));
  return { rate, loss: totalAmount * (1 - rate), bets };
}

function finalizeBets(rawBets: RawBet[], amount: number, betType: string) {
  return betType === 'cash' ? finalizeToutFBCashBets(rawBets, amount) : finalizeToutFBBets(rawBets, amount);
}

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

function getCoverSetsExtended(data: any, eventKey: string, opts: EngineOpts): LegRef[][][] {
  const singleRuleSets = getCoverSets(data, eventKey, opts);
  const result = [...singleRuleSets];
  const crossSeen = new Set<string>();
  for (let i = 0; i < singleRuleSets.length; i++) {
    for (let j = i + 1; j < singleRuleSets.length; j++) {
      const crossSet = singleRuleSets[i].flatMap(g1 => singleRuleSets[j].map(g2 => [...g1, ...g2]));
      const crossKey = crossSet.map(g => g.map(l => l.marketName + ':' + l.outcomeName).sort().join('+')).sort().join('|');
      if (crossSeen.has(crossKey)) continue;
      crossSeen.add(crossKey);
      result.push(crossSet);
    }
  }
  return result;
}

function getAsymSplits(data: any, eventKey: string, opts: EngineOpts) {
  const splits: Array<{ singleGroup: LegRef[]; combinedGroups: LegRef[][] }> = [];
  const seen = new Set<string>();
  for (const coverSet of getCoverSetsExtended(data, eventKey, opts)) {
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

function scoreEventToutFB(data: any, eventKey: string, opts: EngineOpts): number {
  let best = 0;
  for (const coverSet of getCoverSets(data, eventKey, opts)) {
    const odds = coverSet.map(legGroup => bestCombinedOdds(data, legGroup, opts)?.odds ?? 0);
    if (odds.some(o => o <= 1)) continue;
    const r = 1 / odds.reduce((s, o) => s + 1 / (o - 1), 0);
    if (r > best) best = r;
  }
  return best;
}

function topEventsForToutFB(data: any, opts: EngineOpts): string[] {
  return Object.keys(data)
    .map(ek => ({ ek, score: scoreEventToutFB(data, ek, opts) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_EVENTS_TOUTFB)
    .map(x => x.ek);
}

function bestCombinedOdds(data: any, betLegs: LegRef[], opts: EngineOpts): { site: string; odds: number } | null {
  const siteOddsPerLeg = betLegs.map(({ eventKey, marketName, outcomeName }) => {
    const market = data[eventKey]?.markets?.[marketName];
    const oddsMap = market?.[outcomeName];
    if (!oddsMap) return {};
    const map: Record<string, number> = {};
    for (const [site, val] of Object.entries(oddsMap) as [string, any][]) {
      if (isExchange(val)) continue;
      const o = typeof val === 'number' ? val : (val?.odds ?? null);
      if (o && o > 1) map[site] = o;
    }
    return map;
  });
  const sites = Object.keys(siteOddsPerLeg[0] || {}).filter(s => siteOddsPerLeg.every(m => s in m));
  if (!sites.length) return null;
  let best: { site: string; odds: number } | null = null;
  for (const site of sites) {
    const legOdds = betLegs.map((_, i) => siteOddsPerLeg[i][site]);
    if (opts.minOddsPerSelection > 0 && legOdds.some(o => o < opts.minOddsPerSelection)) continue;
    const odds = legOdds.reduce((p, o) => p * o, 1);
    if (!best || odds > best.odds) best = { site, odds };
  }
  return best;
}

function bestSingleSiteCovering(data: any, betsLegsArray: LegRef[][], opts: EngineOpts) {
  const legOddsCache = new Map<string, Record<string, number>>();
  for (const betLegs of betsLegsArray) {
    for (const { eventKey, marketName, outcomeName } of betLegs) {
      const key = `${eventKey}|${marketName}|${outcomeName}`;
      if (legOddsCache.has(key)) continue;
      const oddsMap = data[eventKey]?.markets?.[marketName]?.[outcomeName];
      if (!oddsMap) return null;
      const siteOdds: Record<string, number> = {};
      for (const [site, val] of Object.entries(oddsMap) as [string, any][]) {
        if (isExchange(val)) continue;
        const o = typeof val === 'number' ? val : (val?.odds ?? null);
        if (o && o > 1 && (opts.filterMinOdds <= 0 || o >= opts.filterMinOdds)) siteOdds[site] = o;
      }
      legOddsCache.set(key, siteOdds);
    }
  }
  const allMaps = [...legOddsCache.values()];
  if (!allMaps.length) return null;
  const sites = Object.keys(allMaps[0]).filter(s => allMaps.every(m => s in m));
  if (!sites.length) return null;
  return sites.map(site => ({
    site,
    rawBets: betsLegsArray.map(betLegs => ({
      legs: betLegs, site,
      odds: betLegs.reduce((prod, { eventKey, marketName, outcomeName }) =>
        prod * legOddsCache.get(`${eventKey}|${marketName}|${outcomeName}`)![site], 1),
    })) as RawBet[],
  }));
}

function bestMultiSiteCovering(data: any, betsLegsArray: LegRef[][], betType: string, opts: EngineOpts): RawBet[] | null {
  const isCombined = betsLegsArray.some(betLegs => betLegs.length > 1);
  const fbActiveSites = betType === 'fb'
    ? Object.entries(opts.freebetBySite).filter(([, v]) => v > 0).map(([k]) => k)
    : null;
  const useFbFilter = fbActiveSites && fbActiveSites.length > 0;
  const rawBets = betsLegsArray.map(betLegs => {
    let siteOddsMap: Record<string, number> | null = null;
    for (const { eventKey, marketName, outcomeName } of betLegs) {
      const oddsMap = data[eventKey]?.markets?.[marketName]?.[outcomeName];
      if (!oddsMap) return null;
      const legSiteOdds: Record<string, number> = {};
      for (const [site, val] of Object.entries(oddsMap) as [string, any][]) {
        if (isCombined && isExchange(val)) continue;
        if (useFbFilter && !fbActiveSites!.includes(site)) continue;
        const o = getBackOdds(val);
        if (!o || o <= 1) continue;
        if (opts.filterMinOdds > 0 && o < opts.filterMinOdds) continue;
        legSiteOdds[site] = o;
      }
      if (siteOddsMap === null) {
        siteOddsMap = { ...legSiteOdds };
      } else {
        for (const site of Object.keys(siteOddsMap)) {
          if (site in legSiteOdds) siteOddsMap[site] *= legSiteOdds[site];
          else delete siteOddsMap[site];
        }
      }
    }
    if (!siteOddsMap || !Object.keys(siteOddsMap).length) return null;
    let best: { site: string; odds: number } | null = null;
    for (const [site, odds] of Object.entries(siteOddsMap)) {
      if (!best || odds > best.odds) best = { site, odds };
    }
    return best ? { legs: betLegs, site: best.site, odds: best.odds } : null;
  });
  if (rawBets.some(b => !b)) return null;
  const sites = new Set((rawBets as RawBet[]).map(b => b.site));
  if (sites.size < 2) return null;
  return rawBets as RawBet[];
}

function generateCoveringBetsMulti(coveringSets: LegRef[][][]): LegRef[][] {
  let result: LegRef[][] = [[]];
  for (const groups of coveringSets) {
    result = result.flatMap(prev => groups.map(legGroup => [...prev, ...legGroup]));
  }
  return result;
}

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

export function computeToutFB(data: any, amount: number, nMatches: number, betType: string, opts: EngineOpts): ToutFBResult[] {
  const allEventKeys = Object.keys(data);
  const eventKeys = nMatches === 1 ? allEventKeys : topEventsForToutFB(data, opts);
  const results: ToutFBResult[] = [];
  const bestPerCombo = new Map<string, ToutFBResult>();

  function bestFinFromSiteOpts(siteOpts: Array<{ rawBets: RawBet[] }>) {
    let best: ReturnType<typeof finalizeBets> = null;
    for (const { rawBets } of siteOpts) {
      const fin = finalizeBets(rawBets, amount, betType);
      if (fin && (!best || fin.rate > best.rate)) best = fin;
    }
    return best;
  }

  if (nMatches === 1) {
    for (const eventKey of eventKeys) {
      for (const coverSet of getCoverSetsExtended(data, eventKey, opts)) {
        const siteOpts = bestSingleSiteCovering(data, coverSet, opts);
        if (!siteOpts) continue;
        const fin = bestFinFromSiteOpts(siteOpts);
        if (fin) results.push({ method: 2, nMatches: 1, nBets: coverSet.length, ...fin, totalAmount: amount, eventKeys: [eventKey], betType });
      }
    }
  } else {
    forEachCombo(eventKeys, nMatches, combo => {
      const comboKey = combo.slice().sort().join('|');
      const coverSetsPerEvent = combo.map(ek => getCoverSetsExtended(data, ek, opts));
      if (coverSetsPerEvent.some(s => !s.length)) return;

      forEachCoverSetCombo(coverSetsPerEvent, chosen => {
        const betsSpec = generateCoveringBetsMulti(chosen);
        const siteOpts = bestSingleSiteCovering(data, betsSpec, opts);
        if (!siteOpts) return;
        for (const { rawBets } of siteOpts) {
          const fin = finalizeBets(rawBets, amount, betType);
          if (!fin) continue;
          const entry: ToutFBResult = { method: 2, nMatches, nBets: betsSpec.length, ...fin, totalAmount: amount, eventKeys: combo, betType };
          const prev = bestPerCombo.get(comboKey);
          if (!prev || fin.rate > prev.rate) bestPerCombo.set(comboKey, entry);
        }
      });

      if (opts.asymCov) {
        for (let si = 0; si < combo.length; si++) {
          const ekS = combo[si];
          const ekCs = combo.filter((_, k) => k !== si);
          const asymKey = ekS + '→' + ekCs.join('|');
          const splits = getAsymSplits(data, ekS, opts);
          const coverSetsCs = ekCs.map(ek => getCoverSetsExtended(data, ek, opts));
          if (!splits.length || coverSetsCs.some(s => !s.length)) continue;
          for (const { singleGroup, combinedGroups } of splits) {
            forEachCoverSetCombo(coverSetsCs, chosenCs => {
              const betsSpec = [
                singleGroup,
                ...combinedGroups.flatMap(cg =>
                  generateCoveringBetsMulti(chosenCs).map(comboLegs => [...cg, ...comboLegs])
                ),
              ];
              const siteOpts = bestSingleSiteCovering(data, betsSpec, opts);
              if (!siteOpts) return;
              for (const { rawBets } of siteOpts) {
                const fin = finalizeBets(rawBets, amount, betType);
                if (!fin) continue;
                const entry: ToutFBResult = { method: 2, nMatches, nBets: betsSpec.length, ...fin,
                  totalAmount: amount, eventKeys: [ekS, ...ekCs], betType };
                const prev = bestPerCombo.get(asymKey);
                if (!prev || fin.rate > prev.rate) bestPerCombo.set(asymKey, entry);
              }
            });
          }
        }
      }
    });
  }

  return [...results, ...bestPerCombo.values()].sort((a, b) => b.rate - a.rate);
}

export function computeMultiSite(data: any, amount: number, nMatches: number, betType: string, opts: EngineOpts): ToutFBResult[] {
  const allEventKeys = Object.keys(data);
  const eventKeys = nMatches === 1 ? allEventKeys : topEventsForToutFB(data, opts);
  const results: ToutFBResult[] = [];
  const bestPerCombo = new Map<string, ToutFBResult>();

  function tryMultiSite(betsSpec: LegRef[][], comboKey: string, meta: { eventKeys: string[] }) {
    const rawBets = bestMultiSiteCovering(data, betsSpec, betType, opts);
    if (!rawBets) return;
    const fin = finalizeBets(rawBets, amount, betType);
    if (!fin) return;
    const entry: ToutFBResult = { method: 4, nMatches, nBets: betsSpec.length, ...fin,
      totalAmount: amount, betType, ...meta };
    if (nMatches === 1) {
      results.push(entry);
    } else {
      const prev = bestPerCombo.get(comboKey);
      if (!prev || fin.rate > prev.rate) bestPerCombo.set(comboKey, entry);
    }
  }

  if (nMatches === 1) {
    for (const eventKey of eventKeys) {
      for (const coverSet of getCoverSetsExtended(data, eventKey, opts)) {
        tryMultiSite(coverSet, eventKey, { eventKeys: [eventKey] });
      }
    }
  } else {
    forEachCombo(eventKeys, nMatches, combo => {
      const comboKey = combo.slice().sort().join('|');
      const coverSetsPerEvent = combo.map(ek => getCoverSetsExtended(data, ek, opts));
      if (coverSetsPerEvent.some(s => !s.length)) return;
      forEachCoverSetCombo(coverSetsPerEvent, chosen => {
        tryMultiSite(generateCoveringBetsMulti(chosen), comboKey, { eventKeys: combo });
      });
    });
  }

  return [...results, ...bestPerCombo.values()].sort((a, b) => b.rate - a.rate);
}
