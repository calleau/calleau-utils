import EngineWorker from './worker.ts?worker';
import { collectSites, eventDisplayName, formatDate, isExchange, getBackOdds } from './engine';
import type { AllResults, AnyResult, SeqResult, ToutFBResult, HybridFBResult, LegWithCover, FinalizedBet, WorkerOutMessage, EngineOpts, CoverageRule } from './types';

// ===== STATE =====
let _data: any = null;
let _results: AnyResult[] = [];
let _allResults: AllResults = {};
let _method = 1;
let _betType = 'fb';
let _nLegs = 1;
let _amount = 10;
let _amountTotal = 10;
let _amountMin = 2;
let _amountMode = 'total';
let _cashObjective: 'miser' | 'gagner' | 'perdre' = 'miser';
let _asymCov = false;
let _filterMinOdds = 0;
let _allowedNLegs = new Set([1, 2, 3]);
let _minOddsPerSelection = 0;
let _fbSite = '';
let _visibleCount = 50;
let _colFilters: Record<string, any> = {};
let _cfpOpenCol: string | null = null;
let _freebetBySite: Record<string, number> = {};
let _coverageRules: CoverageRule[] = [];

// Worker state
let _worker: Worker | null = null;

// ===== PREFS =====
const _PREFS_KEY = 'ff_prefs';

function savePrefs() {
  try {
    localStorage.setItem(_PREFS_KEY, JSON.stringify({
      betType: _betType,
      cashObjective: _cashObjective,
      amountTotal: parseFloat((document.getElementById('ff-amount-total') as HTMLInputElement)?.value) || _amountTotal,
      amountMin: parseFloat((document.getElementById('ff-amount-min') as HTMLInputElement)?.value) || _amountMin,
      amountMode: _amountMode,
      method: _method,
      nLegs: _nLegs,
      asymCov: _asymCov,
      filterMinOdds: _filterMinOdds,
      allowedNLegs: [..._allowedNLegs],
      minOddsPerSelection: _minOddsPerSelection,
      site: (document.getElementById('ff-site-select') as HTMLSelectElement)?.value ?? '',
    }));
  } catch {}
}

function loadPrefs(): Record<string, any> {
  try { return JSON.parse(localStorage.getItem(_PREFS_KEY) || '{}'); } catch { return {}; }
}

// ===== HELPERS =====

function esc(s: any): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(n: number, d = 2): string { return Number(n).toFixed(d).replace('.', ','); }

function rateClass(rate: number): string {
  if (rate >= 0.75) return 'ff-rate-good';
  if (rate >= 0.55) return 'ff-rate-ok';
  return 'ff-rate-bad';
}

function rateClassCash(rate: number): string {
  if (rate >= 0.97) return 'ff-rate-good';
  if (rate >= 0.93) return 'ff-rate-ok';
  return 'ff-rate-bad';
}

const _SITE_KEYS = ['piwi', 'olybet', 'betclic', 'winamax', 'bwin', 'unibet', 'feelingbet', 'pokerstars'];
const _EXCHANGE_SITE_KEYS = ['piwi'];

function isExchangeSite(name: string): boolean {
  if (!name) return false;
  const low = name.toLowerCase();
  return _EXCHANGE_SITE_KEYS.some(k => low.includes(k));
}

function sitePill(name: string, isLay = false): string {
  const key = _SITE_KEYS.find(k => name.toLowerCase().includes(k));
  const dataSite = key ? ` data-site="${key}"` : '';
  const isExch = _EXCHANGE_SITE_KEYS.includes(key!);
  const layClass = isLay && isExch ? ' ff-site-pill--lay' : '';
  const label = isExch ? `${esc(name)} ${isLay ? 'Lay' : 'Back'}` : esc(name);
  return `<span class="ff-site-pill${layClass}"${dataSite}>${label}</span>`;
}

function miseTag(type: string): string {
  return type === 'fb'
    ? `<span class="ff-mise-tag ff-mise-tag--fb">Freebet</span>`
    : `<span class="ff-mise-tag ff-mise-tag--cash">Cash</span>`;
}

function coverBadge(cover: any): string {
  if (cover.type === 'lay') return `<span class="ff-badge ff-badge-lay">Lay</span>`;
  if (cover.type === 'dc') return `<span class="ff-badge ff-badge-dc">DC</span>`;
  if (isExchangeSite(cover?.site)) return `<span class="ff-badge ff-badge-bk">Back</span>`;
  return '';
}

function resolveOutcome(outcomeName: string, eventKey: string, marketName: string): string {
  const ev = _data?.[eventKey];
  const opp = ev?.opponents;
  if (!opp) return `${esc(marketName)} · ${esc(outcomeName)}`;
  let label: string;
  const k = outcomeName.trim();
  if (k === '1') label = esc(opp['1'] ?? outcomeName);
  else if (k === '2') label = esc(opp['2'] ?? outcomeName);
  else if (k === 'X') label = 'Nul';
  else label = esc(outcomeName);
  return `${esc(marketName)} · ${label}`;
}

function formatGap(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}\u00a0min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function evInfo(leg: LegWithCover): string {
  return `<span class="ff-ev-name">${esc(leg.evName)}</span>
    <span class="ff-ev-meta">${esc([leg.evComp, leg.evDate].filter(Boolean).join(' · '))}</span>`;
}

// ===== RENDERING =====

function buildSeqLegRow(leg: LegWithCover, idx: number, gap: number | null, scale = 1): string {
  const gapHtml = gap ? `<span class="ff-gap">+${formatGap(gap)}</span>` : '';
  const stakeDetail = leg.liability != null
    ? `${fmt(leg.stake * scale)}\u00a0€ <span class="ff-sub">(liab.\u00a0${fmt(leg.liability * scale)}\u00a0€)</span>`
    : `${fmt(leg.stake * scale)}\u00a0€`;
  const coverOddsDetail = leg.cover.lGross != null ? `${fmt(leg.cover.lGross)}` : `${fmt(leg.cover.odds)}`;
  return `
  <div class="ff-leg">
    <div class="ff-leg-left">
      <span class="ff-leg-num">L${idx + 1}</span>
      ${gapHtml}
      <div class="ff-ev-wrap">${evInfo(leg)}</div>
    </div>
    <div class="ff-leg-right">
      <span class="ff-leg-market">${esc(leg.marketName)} · <strong>${esc(leg.outcomeName)}</strong></span>
      <span class="ff-leg-back">Back\u00a0: <strong>${fmt(_amount * scale)}\u00a0€</strong> \u00d7 cote <strong>${fmt(leg.b)}</strong> sur ${esc(_fbSite)}</span>
      <span class="ff-leg-cover">${esc(leg.cover.site)} ${coverBadge(leg.cover)} ${esc(leg.cover.outcomeName)} · ${coverOddsDetail}</span>
      <span class="ff-leg-stake">Mise couv.\u00a0: <strong>${stakeDetail}</strong></span>
    </div>
  </div>`;
}

function buildSeqDetailFlat(result: SeqResult, scale = 1): string {
  const amount = _amount * scale;
  const backTitles = result.legs.map(leg => esc(leg.evName)).join(' + ');
  const backOutcomes = result.legs.map(leg => resolveOutcome(leg.outcomeName, leg.eventKey, leg.marketName)).join(' + ');
  const backRow = `
  <div class="ff-betrow">
    <span class="ff-betrow-badge ff-betrow-badge--back">Seq.\u00a01</span>
    <div class="ff-betrow-body">
      <span class="ff-betrow-title">${backTitles}</span>
      <span class="ff-betrow-detail">${sitePill(_fbSite)} · ${backOutcomes} · Mise <strong>${fmt(amount)}\u00a0€</strong> ${miseTag('fb')} · Cote <strong>${fmt(result.B)}</strong></span>
    </div>
  </div>`;
  const coverRows = result.legs.map((leg, i) => {
    const cover = leg.cover;
    const badgeClass = cover.type === 'lay' ? 'lay' : 'back';
    const oddsStr = cover.lGross != null ? `<strong>${fmt(cover.lGross)}</strong>` : `<strong>${fmt(cover.odds)}</strong>`;
    const liabilityStr = leg.liability != null ? ` · Liability <strong>${fmt(leg.liability * scale)}\u00a0€</strong>` : '';
    const coverOutcome = resolveOutcome(cover.outcomeName, leg.eventKey, leg.marketName);
    return `
  <div class="ff-betrow">
    <span class="ff-betrow-badge ff-betrow-badge--${badgeClass}">Seq.\u00a0${i + 2}</span>
    <div class="ff-betrow-body">
      <span class="ff-betrow-title">${esc(leg.evName)}</span>
      <span class="ff-betrow-detail">${sitePill(cover.site, cover.type === 'lay')} · ${coverOutcome} · Mise <strong>${fmt(leg.stake * scale)}\u00a0€</strong> ${miseTag('cash')} · Cote ${oddsStr}${liabilityStr}</span>
    </div>
  </div>`;
  }).join('');
  return `<div class="ff-betlist">${backRow}${coverRows}</div>`;
}

function buildToutFBBetRow(bet: FinalizedBet, idx: number, betType: string, scale = 1): string {
  const titleParts = bet.legs.map(l => {
    const ev = _data?.[l.eventKey];
    return esc(ev ? eventDisplayName(l.eventKey, ev) : l.eventKey);
  }).join(' + ');
  const outcomeParts = bet.legs.map(l => resolveOutcome(l.outcomeName, l.eventKey, l.marketName)).join(' + ');
  const s = bet.stake * scale;
  const detail = `${sitePill(bet.site)} · ${outcomeParts} · Mise <strong>${fmt(s)}\u00a0€</strong> ${miseTag(betType)} · Cote <strong>${fmt(bet.odds)}</strong>`;
  return `
  <div class="ff-bet">
    <span class="ff-bet-num">Pari\u00a0${idx + 1}</span>
    <div class="ff-bet-desc">
      <span class="ff-bet-legs">${titleParts}</span>
      <span class="ff-bet-site">${detail}</span>
    </div>
  </div>`;
}

function buildHybridDetailContent(result: HybridFBResult, scale = 1): string {
  const fbTitleParts = result.fbBet.legs.map(l => {
    const ev = _data?.[l.eventKey];
    return esc(ev ? eventDisplayName(l.eventKey, ev) : l.eventKey);
  }).join(' + ');
  const fbOutcomeParts = result.fbBet.legs.map(l => resolveOutcome(l.outcomeName, l.eventKey, l.marketName)).join(' + ');
  const fbRow = `
  <div class="ff-bet">
    <span class="ff-bet-num">Freebet</span>
    <div class="ff-bet-desc">
      <span class="ff-bet-legs">${fbTitleParts}</span>
      <span class="ff-bet-site">${sitePill(result.fbBet.site)} · ${fbOutcomeParts} · Mise <strong>${fmt(result.fbBet.stake * scale)}\u00a0€</strong> ${miseTag('fb')} · Cote <strong>${fmt(result.fbBet.odds)}</strong></span>
    </div>
  </div>`;
  const cashRows = result.cashBets.map((b, i) => {
    const titleParts = b.legs.map(l => {
      const ev = _data?.[l.eventKey];
      return esc(ev ? eventDisplayName(l.eventKey, ev) : l.eventKey);
    }).join(' + ');
    const outcomeParts = b.legs.map(l => resolveOutcome(l.outcomeName, l.eventKey, l.marketName)).join(' + ');
    return `
  <div class="ff-bet">
    <span class="ff-bet-num">Cash\u00a0${i + 1}</span>
    <div class="ff-bet-desc">
      <span class="ff-bet-legs">${titleParts}</span>
      <span class="ff-bet-site">${sitePill(b.site)} · ${outcomeParts} · Mise <strong>${fmt(b.stake * scale)}\u00a0€</strong> ${miseTag('cash')} · Cote <strong>${fmt(b.odds)}</strong></span>
    </div>
  </div>`;
  }).join('');
  return `<div class="ff-detail-bets">${fbRow}${cashRows}</div>`;
}

function buildDetailContent(result: AnyResult, scale = 1): string {
  if (result.method === 1) return buildSeqDetailFlat(result as SeqResult, scale);
  if (result.method === 3) return buildHybridDetailContent(result as HybridFBResult, scale);
  if (result.method === 2 || result.method === 4) {
    const r = result as ToutFBResult;
    const rows = r.bets.map((b, i) => buildToutFBBetRow(b, i, r.betType, scale)).join('');
    return `<div class="ff-detail-bets">${rows}</div>`;
  }
  return '';
}

// ===== COLUMN FILTERS =====

const COL_FILTER_DEFS: Record<string, any> = {
  method: {
    type: 'set',
    label: 'Méthode',
    options: [
      { value: '1', label: 'Séq.' },
      { value: '2', label: 'Couv. complète' },
      { value: '3', label: 'Hybride FB' },
      { value: '4', label: 'Multi-sites' },
    ],
    getValue: (r: AnyResult) => String(r.method),
  },
  matches: {
    type: 'num',
    label: 'Matchs',
    getValue: (r: AnyResult) => r.method === 1
      ? new Set((r as SeqResult).legs.map(l => l.eventKey)).size
      : ((r as ToutFBResult | HybridFBResult).nMatches ?? 0),
  },
  paris: {
    type: 'num',
    label: 'Paris',
    getValue: (r: AnyResult) => r.method === 1
      ? (r as SeqResult).legs.length * 2
      : ((r as ToutFBResult | HybridFBResult).nBets ?? 0),
  },
  liab: {
    type: 'num',
    label: 'Cash engagé',
    getValue: (r: AnyResult) => {
      const v = rowCashEngaged(r);
      return v === null ? null : v * getDisplayScale(r);
    },
  },
  cote: {
    type: 'num',
    label: 'Cote',
    getValue: (r: AnyResult) => {
      if (r.method === 1) return (r as SeqResult).B;
      if (r.method === 3) { const hr = r as HybridFBResult; return Math.min(hr.fbBet.odds, ...hr.cashBets.map(b => b.odds)); }
      if (r.method === 2 || r.method === 4) return Math.min(...(r as ToutFBResult).bets.map(b => b.odds));
      return null;
    },
  },
  result: {
    type: 'num',
    label: 'Résultat',
    getValue: (r: AnyResult) => {
      const scale = getDisplayScale(r);
      const obj = (r as SeqResult)._cashObjective;
      if (obj === 'gagner') return ((r as SeqResult).netIfWins ?? 0) * scale;
      if (obj === 'perdre') return ((r as SeqResult).netIfLoses ?? 0) * scale;
      return r.betType === 'cash' ? -((r as any).loss * scale) : ((r as any).profit * scale);
    },
  },
  taux: {
    type: 'num',
    label: 'Taux (%)',
    getValue: (r: AnyResult) => r.rate * 100,
  },
};

function isColFilterActive(col: string): boolean {
  const f = _colFilters[col];
  if (!f) return false;
  if (f.type === 'num') return f.min !== null || f.max !== null || f.exact !== null;
  if (f.type === 'set') {
    const def = COL_FILTER_DEFS[col];
    return def && f.values.size > 0 && f.values.size < def.options.length;
  }
  return false;
}

function passesColFilters(r: AnyResult): boolean {
  for (const [col, f] of Object.entries(_colFilters)) {
    const def = COL_FILTER_DEFS[col];
    if (!def) continue;
    const val = def.getValue(r);
    if (val === null || val === undefined) continue;
    if (f.type === 'num') {
      if (f.exact !== null && Math.abs(val - f.exact) > 0.005) return false;
      if (f.exact === null && f.min !== null && val < f.min) return false;
      if (f.exact === null && f.max !== null && val > f.max) return false;
    } else if (f.type === 'set') {
      if (!f.values.has(String(val))) return false;
    }
  }
  return true;
}

function clearColFilter(col: string) {
  delete _colFilters[col];
  closeColFilterPopover();
  renderPage();
}

function clearAllColFilters() {
  _colFilters = {};
  closeColFilterPopover();
  renderPage();
}

function applyColFilterFromPopover(col: string) {
  const def = COL_FILTER_DEFS[col];
  if (def.type === 'num') {
    const parse = (id: string) => { const v = (document.getElementById(id) as HTMLInputElement)?.value.trim(); return v === '' || v == null ? null : parseFloat(v); };
    const min = parse('ff-cfp-min'), max = parse('ff-cfp-max'), exact = parse('ff-cfp-exact');
    if (min === null && max === null && exact === null) {
      delete _colFilters[col];
    } else {
      _colFilters[col] = { type: 'num', min, max, exact };
    }
  } else if (def.type === 'set') {
    const checked = new Set([...document.querySelectorAll('#ff-cfp-body input[type=checkbox]:checked')].map(cb => (cb as HTMLInputElement).value));
    if (checked.size === 0 || checked.size === def.options.length) {
      delete _colFilters[col];
    } else {
      _colFilters[col] = { type: 'set', values: checked };
    }
  }
  closeColFilterPopover();
  renderPage();
}

function openColFilterPopover(col: string, anchorEl: HTMLElement) {
  if (_cfpOpenCol === col) { closeColFilterPopover(); return; }
  _cfpOpenCol = col;
  const def = COL_FILTER_DEFS[col];
  const f = _colFilters[col];
  let inner = '';
  if (def.type === 'num') {
    const v = (n: any) => (n !== null && n !== undefined) ? n : '';
    inner = `
      <div class="ff-cfp-row"><label class="ff-cfp-lbl">Min</label><input id="ff-cfp-min" class="ff-cfp-input" type="number" step="any" value="${v(f?.min)}" placeholder="—"/></div>
      <div class="ff-cfp-row"><label class="ff-cfp-lbl">Max</label><input id="ff-cfp-max" class="ff-cfp-input" type="number" step="any" value="${v(f?.max)}" placeholder="—"/></div>
      <div class="ff-cfp-row"><label class="ff-cfp-lbl">Exact</label><input id="ff-cfp-exact" class="ff-cfp-input" type="number" step="any" value="${v(f?.exact)}" placeholder="—"/></div>`;
  } else if (def.type === 'set') {
    const active = f?.values ?? new Set(def.options.map((o: any) => o.value));
    inner = def.options.map((o: any) => `
      <label class="ff-cfp-check-lbl">
        <input type="checkbox" value="${esc(o.value)}" ${active.has(o.value) ? 'checked' : ''}/>
        ${esc(o.label)}
      </label>`).join('');
  }
  const popover = document.getElementById('ff-col-filter-popover')!;
  popover.innerHTML = `
    <div class="ff-cfp-title">${esc(def.label)}</div>
    <div id="ff-cfp-body">${inner}</div>
    <div class="ff-cfp-actions">
      ${isColFilterActive(col) ? `<button class="ff-cfp-clear" onclick="clearColFilter('${col}')">Effacer</button>` : ''}
      <button class="ff-cfp-apply" onclick="applyColFilterFromPopover('${col}')">Appliquer</button>
    </div>`;
  const rect = anchorEl.getBoundingClientRect();
  popover.style.top = (rect.bottom + 4) + 'px';
  popover.style.left = rect.left + 'px';
  (popover as any).hidden = false;
  setTimeout(() => {
    const first = popover.querySelector('input') as HTMLInputElement;
    first?.focus();
    if (first?.type === 'number') first.select?.();
    popover.querySelectorAll('.ff-cfp-input').forEach(inp => {
      inp.addEventListener('keydown', (e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Enter') applyColFilterFromPopover(col);
        if (ke.key === 'Escape') closeColFilterPopover();
      });
    });
  }, 0);
}

function closeColFilterPopover() {
  _cfpOpenCol = null;
  const p = document.getElementById('ff-col-filter-popover');
  if (p) (p as any).hidden = true;
}

function thFilter(col: string, label: string, extraClass = ''): string {
  const active = isColFilterActive(col);
  return `<div class="ff-th${extraClass ? ' ' + extraClass : ''}">
    <span>${esc(label)}</span>
    <button class="ff-th-filter-btn${active ? ' ff-th-filter-btn--active' : ''}" onclick="event.stopPropagation(); openColFilterPopover('${col}', this)" title="Filtrer">&#9663;</button>
  </div>`;
}

// ===== TABLE ROW HELPERS =====

function rowMethod(result: AnyResult): string {
  if (result.method === 1) return 'Séq.';
  if (result.method === 2) return 'Couv. complète';
  if (result.method === 3) return 'Hybride FB';
  if (result.method === 4) return 'Multi-sites';
  return '';
}

function rowMatches(result: AnyResult): number | string {
  if (result.method === 1) return new Set((result as SeqResult).legs.map(l => l.eventKey)).size;
  return (result as ToutFBResult | HybridFBResult).nMatches ?? '-';
}

function rowFirstDate(result: AnyResult): string {
  if (result.method === 1) {
    const first = (result as SeqResult).legs.reduce((min: number | null, l) =>
      (l.dateTime && (!min || l.dateTime < min)) ? l.dateTime : min, null);
    return first ? formatDate(new Date(first).toISOString()) : '—';
  }
  const keys = (result as ToutFBResult | HybridFBResult).eventKeys || [];
  let first: string | null = null;
  for (const ek of keys) {
    const dt = _data?.[ek]?.dateTime;
    if (dt && (!first || dt < first)) first = dt;
  }
  return first ? formatDate(first) : '—';
}

function resultEventKeys(result: AnyResult): string[] {
  if (result.method === 1) return [...new Set((result as SeqResult).legs.map(l => l.eventKey))];
  return (result as ToutFBResult | HybridFBResult).eventKeys || [];
}

function rowMarketsHtml(result: AnyResult): string {
  if (result.method === 1) {
    return resultEventKeys(result).map(ek => {
      const mkts = [...new Set((result as SeqResult).legs.filter(l => l.eventKey === ek).map(l => l.marketName))];
      return `<span>${esc(mkts.join(', '))}</span>`;
    }).join('');
  }
  if (result.method === 3) {
    const r = result as HybridFBResult;
    const allBets = [r.fbBet, ...r.cashBets];
    return resultEventKeys(result).map(ek => {
      const mkts = [...new Set(allBets.flatMap(b => b.legs.filter(l => l.eventKey === ek).map(l => l.marketName)))];
      return `<span>${esc(mkts.join(', '))}</span>`;
    }).join('');
  }
  if (result.method === 2 || result.method === 4) {
    return resultEventKeys(result).map(ek => {
      const mkts = [...new Set((result as ToutFBResult).bets.flatMap(b => b.legs.filter(l => l.eventKey === ek).map(l => l.marketName)))];
      return `<span>${esc(mkts.join(', '))}</span>`;
    }).join('');
  }
  return '';
}

function coverTypeLabel(cover: any): string {
  if (!cover) return '';
  const exch = isExchangeSite(cover.site);
  const suffix = cover.type === 'lay' ? ' Lay' : cover.type === 'dc' ? '' : (exch ? ' Back' : '');
  return (cover.site || '') + suffix;
}

function outcomesPerEvent(bets: FinalizedBet[], ek: string): number {
  return new Set(bets.flatMap(b => b.legs.filter(l => l.eventKey === ek).map(l => l.outcomeName))).size;
}

function rowTypeHtml(result: AnyResult): string {
  if (result.method === 1) {
    return resultEventKeys(result).map(ek => {
      const leg = (result as SeqResult).legs.find(l => l.eventKey === ek);
      return `<span>${esc(leg ? coverTypeLabel(leg.cover) : '')}</span>`;
    }).join('');
  }
  if (result.method === 3) {
    const r = result as HybridFBResult;
    const allBets = [r.fbBet, ...r.cashBets];
    return resultEventKeys(result).map(ek => {
      const n = new Set(allBets.flatMap(b => b.legs.filter(l => l.eventKey === ek).map(l => l.outcomeName))).size;
      return `<span>${n}\u00a0issues</span>`;
    }).join('');
  }
  if (result.method === 2 || result.method === 4) {
    return resultEventKeys(result).map(ek => {
      const n = outcomesPerEvent((result as ToutFBResult).bets, ek);
      return `<span>${n}\u00a0issues</span>`;
    }).join('');
  }
  return '';
}

function eventsLines(result: AnyResult): string {
  return resultEventKeys(result).map(ek => {
    const ev = _data?.[ek];
    return `<span>${esc(ev ? eventDisplayName(ek, ev) : ek)}</span>`;
  }).join('');
}

function rowParis(result: AnyResult): string | number {
  if (result.method === 1) {
    const r = result as SeqResult;
    const count = r.legs.length * 2;
    if (r.profitFb != null && r.nLegs > 1) {
      const scale = getDisplayScale(r);
      return `${count}<br><span class="ff-paris-sub">+${fmt(r.profitFb * scale)}\u00a0\u20ac Fb</span><br><span class="ff-paris-sub">+${fmt((r.profit ?? 0) * scale)}\u00a0\u20ac Cash</span>`;
    }
    return count;
  }
  if (result.method === 3) return (result as HybridFBResult).nBets;
  if (result.method === 2 || result.method === 4) return (result as ToutFBResult).nBets;
  return '-';
}

function rowCashEngaged(result: AnyResult): number | null {
  if (result.method === 1) return (result as SeqResult).legs.reduce((s, l) => s + (l.liability ?? l.stake), 0);
  if (result.method === 3) return (result as HybridFBResult).totalCashAmount;
  return null;
}

function rowCote(result: AnyResult): string {
  if (result.method === 1) return fmt((result as SeqResult).B);
  if (result.method === 3) {
    const r = result as HybridFBResult;
    const odds = [r.fbBet, ...r.cashBets].map(b => b.odds);
    const min = Math.min(...odds), max = Math.max(...odds);
    return Math.abs(max - min) < 0.01 ? fmt(min) : `${fmt(min)}\u2013${fmt(max)}`;
  }
  if (result.method === 2 || result.method === 4) {
    const odds = (result as ToutFBResult).bets.map(b => b.odds);
    const min = Math.min(...odds), max = Math.max(...odds);
    return Math.abs(max - min) < 0.01 ? fmt(min) : `${fmt(min)}\u2013${fmt(max)}`;
  }
  return '\u2013';
}

function resultMinOdds(result: AnyResult): number {
  if (result.method === 1) return (result as SeqResult).B;
  if (result.method === 3) { const r = result as HybridFBResult; return Math.min(r.fbBet.odds, ...r.cashBets.map(b => b.odds)); }
  if (result.method === 2 || result.method === 4) return Math.min(...(result as ToutFBResult).bets.map(b => b.odds));
  return 0;
}

function resultMinStake(result: AnyResult): number {
  if (result.method === 1) return _amount;
  if (result.method === 3) { const r = result as HybridFBResult; return Math.min(r.fbBet.stake, ...r.cashBets.map(b => b.stake)); }
  if (result.method === 2 || result.method === 4) return Math.min(...(result as ToutFBResult).bets.map(b => b.stake));
  return _amount;
}

function resultSortKey(result: AnyResult): number {
  const scale = getDisplayScale(result);
  if (result.betType !== 'cash') return ((result as any).profit ?? 0) * scale;
  const obj = (result as SeqResult)._cashObjective;
  if (obj === 'gagner') return ((result as SeqResult).netIfWins ?? 0) * scale;
  if (obj === 'perdre') return ((result as SeqResult).netIfLoses ?? 0) * scale;
  return -((result as any).loss * scale);
}

function getDisplayScale(result: AnyResult): number {
  if (_amountMode !== 'min') return 1;
  const ms = resultMinStake(result);
  return ms > 0 ? _amountMin / ms : 1;
}

function buildTableRow(result: AnyResult, idx: number): string {
  const isCash = result.betType === 'cash';
  const scale = getDisplayScale(result);
  const liab = rowCashEngaged(result);
  const obj = (result as SeqResult)._cashObjective;
  let profitClass: string, valueStr: string;
  if (obj === 'gagner') {
    const n = ((result as SeqResult).netIfWins ?? 0) * scale;
    profitClass = n >= 0 ? 'pos' : 'neg';
    valueStr = `${n >= 0 ? '+' : '\u2212'}${fmt(Math.abs(n))}\u00a0\u20ac`;
  } else if (obj === 'perdre') {
    const n = ((result as SeqResult).netIfLoses ?? 0) * scale;
    profitClass = 'neg';
    valueStr = `si\u00a0perdu\u00a0: \u2212${fmt(Math.abs(n))}\u00a0\u20ac`;
  } else {
    profitClass = isCash ? 'neg' : 'pos';
    valueStr = isCash
      ? `\u2212${fmt((result as any).loss * scale)}\u00a0\u20ac`
      : `+${fmt((result as any).profit * scale)}\u00a0\u20ac`;
  }
  const liabStr = liab !== null ? `${fmt(liab * scale)}\u00a0\u20ac` : '\u2013';
  const rClass = isCash ? rateClassCash(result.rate) : rateClass(result.rate);
  return `
    <button class="ff-row-expand" id="ff-expand-${idx}" onclick="toggleDetail(${idx})" aria-label="Détails"><span class="ff-expand-icon">&#9654;</span></button>
    <div class="ff-td ff-td-muted">${esc(rowMethod(result))}</div>
    <div class="ff-td ff-td-center">${rowMatches(result)}</div>
    <div class="ff-td ff-td-mono ff-td-date">${esc(rowFirstDate(result))}</div>
    <div class="ff-td ff-td-events">${eventsLines(result)}</div>
    <div class="ff-td ff-td-muted ff-td-events">${rowMarketsHtml(result)}</div>
    <div class="ff-td ff-td-muted ff-td-events">${rowTypeHtml(result)}</div>
    <div class="ff-td ff-td-center">${rowParis(result)}</div>
    <div class="ff-td ff-td-mono">${esc(liabStr)}</div>
    <div class="ff-td ff-td-mono">${esc(rowCote(result))}</div>
    <div class="ff-td ff-td-mono ${profitClass}">${esc(valueStr)}</div>
    <div class="ff-td ${rClass} ff-td-bold">${fmt(result.rate * 100, 1)}\u00a0%</div>
    <div class="ff-tr-detail" id="ff-detail-${idx}" hidden>${buildDetailContent(result, scale)}</div>`;
}

function toggleDetail(idx: number) {
  const detail = document.getElementById(`ff-detail-${idx}`);
  const btn = document.getElementById(`ff-expand-${idx}`);
  if (!detail) return;
  (detail as any).hidden = !(detail as any).hidden;
  btn?.classList.toggle('ff-expand-open', !(detail as any).hidden);
}

// ===== RESULTS RENDERING =====

function renderResults(results: AnyResult[]) {
  _results = results;
  _visibleCount = 50;
  const el = document.getElementById('ff-results')!;
  (el as any).hidden = false;

  if (!results.length) {
    el.innerHTML = `<p class="ff-empty">Aucune opportunité trouvée.</p>`;
    return;
  }

  const isTout = _method === 0;
  const topHtml = isTout
    ? `<div class="ff-search-row">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input id="ff-search" class="ff-search-input" placeholder="Rechercher un match…" oninput="onSearchInput()" />
      </div>
      <p id="ff-summary" class="ff-summary"></p>`
    : `<p id="ff-count" class="ff-summary"></p>`;

  el.innerHTML = `${topHtml}<div id="ff-cards"></div><div id="ff-more"></div>`;
  renderPage();
}

function renderPage() {
  const cards = document.getElementById('ff-cards');
  const more = document.getElementById('ff-more');
  if (!cards) return;
  const q = ((document.getElementById('ff-search') as HTMLInputElement)?.value ?? '').trim().toLowerCase();

  const filtered = _results.filter(r => {
    if (_filterMinOdds > 0 && resultMinOdds(r) < _filterMinOdds) return false;
    if (!passesColFilters(r)) return false;
    if (!q) return true;
    if (r.method === 1) return (r as SeqResult).legs.some(l => l.evName.toLowerCase().includes(q) || l.evComp.toLowerCase().includes(q));
    return (r as ToutFBResult).eventKeys.some(ek => {
      const ev = _data?.[ek];
      if (!ev) return false;
      return eventDisplayName(ek, ev).toLowerCase().includes(q);
    });
  });

  filtered.sort((a, b) => resultSortKey(b) - resultSortKey(a));
  const visible = filtered.slice(0, _visibleCount);

  const summaryEl = document.getElementById('ff-summary');
  if (summaryEl) {
    if (q) {
      summaryEl.textContent = `${filtered.length} combinaison${filtered.length > 1 ? 's' : ''} trouvée${filtered.length > 1 ? 's' : ''} — affichage des ${Math.min(_visibleCount, filtered.length)} meilleures`;
    } else {
      summaryEl.textContent = `${_results.length} combinaison${_results.length > 1 ? 's' : ''} — ${Math.min(_visibleCount, filtered.length)} affichées`;
    }
  } else {
    const countEl = document.getElementById('ff-count');
    if (countEl) countEl.textContent = `${_results.length} combinaison${_results.length > 1 ? 's' : ''}`;
  }

  const headers = `
    <div class="ff-th"></div>
    ${thFilter('method', 'Méthode')}
    ${thFilter('matches', 'Matchs', 'ff-th-center')}
    <div class="ff-th">Date event</div>
    <div class="ff-th">Événement(s)</div>
    <div class="ff-th">Marchés</div>
    <div class="ff-th">Type</div>
    ${thFilter('paris', 'Paris', 'ff-th-center')}
    ${thFilter('liab', 'Cash engagé')}
    ${thFilter('cote', 'Cote')}
    ${thFilter('result', 'Résultat')}
    ${thFilter('taux', 'Taux')}`;

  if (!visible.length) {
    const hasColFilters = Object.keys(_colFilters).length > 0;
    const emptyMsg = hasColFilters
      ? `<p class="ff-empty">Aucun résultat pour ces filtres. <button class="ff-link-btn" onclick="clearAllColFilters()">Effacer tous les filtres</button></p>`
      : `<p class="ff-empty">Aucun match correspondant.</p>`;
    cards.innerHTML = `<div class="ff-table-wrap"><div class="ff-table">${headers}</div></div>${emptyMsg}`;
    if (more) more.innerHTML = '';
    return;
  }

  cards.innerHTML = `<div class="ff-table-wrap"><div class="ff-table">${headers}${visible.map((r, i) => buildTableRow(r, i)).join('')}</div></div>`;

  if (more) {
    const remaining = filtered.length - _visibleCount;
    more.innerHTML = remaining > 0
      ? `<button class="ff-more-btn" onclick="showMore()">Voir ${Math.min(remaining, 50)} de plus (${remaining} restant${remaining > 1 ? 's' : ''})</button>`
      : '';
  }
}

function showMore() { _visibleCount += 50; renderPage(); }

// ===== UI STATE FUNCTIONS =====

function updateTabSummaries() {
  const applyFilter = (arr: AnyResult[]) => _filterMinOdds > 0 ? arr.filter(r => resultMinOdds(r) >= _filterMinOdds) : arr;
  document.querySelectorAll('.ff-count-btn[data-method][data-legs]').forEach(btn => {
    const el = btn as HTMLElement;
    const m = +el.dataset.method!;
    const n = +el.dataset.legs!;
    const res = applyFilter(_allResults[`${m}_${n}`] ?? []);
    const num = el.dataset.legs!;
    if (!res.length) { el.innerHTML = esc(num); return; }
    const best = res[0];
    const scale = getDisplayScale(best);
    const isCash = best.betType === 'cash';
    const valueStr = isCash ? `\u2212${fmt((best as any).loss * scale, 2)}\u00a0\u20ac` : `+${fmt((best as any).profit * scale, 2)}\u00a0\u20ac`;
    el.innerHTML = `${esc(num)}<span class="ff-count-summary">${fmt(best.rate * 100, 1)}\u00a0%<br>${valueStr}</span>`;
  });
  const toutLabel = document.querySelector('.ff-method-label[data-name="Tout"]');
  if (toutLabel) {
    const all = applyFilter(Object.values(_allResults).flat());
    if (all.length) {
      const best = all.reduce((b, r) => r.rate > b.rate ? r : b);
      const scale = getDisplayScale(best);
      const isCash = best.betType === 'cash';
      const valueStr = isCash ? `\u2212${fmt((best as any).loss * scale, 2)}\u00a0\u20ac` : `+${fmt((best as any).profit * scale, 2)}\u00a0\u20ac`;
      toutLabel.innerHTML = `Tout<span class="ff-count-summary">${fmt(best.rate * 100, 1)}\u00a0%<br>${valueStr}</span>`;
    } else {
      toutLabel.innerHTML = 'Tout';
    }
  }
}

function clearTabSummaries() {
  document.querySelectorAll('.ff-count-btn[data-legs]').forEach(btn => {
    const el = btn as HTMLElement;
    el.innerHTML = esc(el.dataset.legs!);
  });
  document.querySelectorAll('.ff-method-label[data-name]').forEach(label => {
    const el = label as HTMLElement;
    el.innerHTML = esc(el.dataset.name!);
  });
}

function setMinOddsFilter(val: string) {
  _filterMinOdds = parseFloat(val) || 0;
  _allResults = {};
  clearTabSummaries();
  (document.getElementById('ff-results') as any).hidden = true;
  savePrefs();
}

function setMethodLegs(m: number, n: number) {
  _method = m;
  _nLegs = n;
  document.querySelectorAll('.ff-method-group').forEach(g =>
    g.classList.toggle('ff-method-group--active', +(g as HTMLElement).dataset.method! === m)
  );
  document.querySelectorAll('.ff-count-btn').forEach(b => {
    const el = b as HTMLElement;
    el.classList.toggle('ff-count-btn--active', +el.dataset.method! === m && +el.dataset.legs! === n);
  });
  if (Object.keys(_allResults).length) showCurrentResults();
  savePrefs();
}

function setMethod(m: number) { setMethodLegs(m, _nLegs); }
function setLegs(n: number) { setMethodLegs(_method, n); }

function setBetType(t: string) {
  _betType = t;
  document.querySelectorAll('.ff-bettype-btn').forEach(b =>
    b.classList.toggle('ff-btn--active', (b as HTMLElement).dataset.bettype === t)
  );
  const objField = document.getElementById('ff-objective-field');
  if (objField) (objField as any).hidden = t !== 'cash';
  const fbField = document.getElementById('ff-freebet-sites-field');
  if (fbField && Object.keys(_freebetBySite).length) (fbField as any).hidden = t !== 'fb';
  _allResults = {};
  clearTabSummaries();
  (document.getElementById('ff-results') as any).hidden = true;
  savePrefs();
}

function setAsymCov(val: boolean) {
  _asymCov = val;
  const cb = document.getElementById('ff-asymcov-cb') as HTMLInputElement;
  if (cb) cb.checked = val;
  _allResults = {};
  clearTabSummaries();
  (document.getElementById('ff-results') as any).hidden = true;
  savePrefs();
}

function updateTabCounts() {
  document.querySelectorAll('.ff-count-btn[data-legs]').forEach(btn => {
    const el = btn as HTMLElement;
    const method = +el.dataset.method!;
    const n = +el.dataset.legs!;
    const visible = _allowedNLegs.has(n);
    (el as any).hidden = !visible;
    if (!visible && el.classList.contains('ff-count-btn--active')) {
      const first = document.querySelector(`.ff-count-btn[data-method="${method}"]:not([hidden])`) as HTMLElement;
      if (first) setMethodLegs(method, +first.dataset.legs!);
    }
  });
}

function toggleNLegs(n: number) {
  if (_allowedNLegs.has(n)) _allowedNLegs.delete(n);
  else _allowedNLegs.add(n);
  document.querySelectorAll('.ff-nlegs-btn').forEach(b =>
    b.classList.toggle('ff-btn--active', _allowedNLegs.has(+(b as HTMLElement).dataset.n!))
  );
  if (_allowedNLegs.size > 0)
    document.getElementById('ff-nlegs-field')?.classList.remove('ff-field--error');
  updateTabCounts();
  _allResults = {};
  clearTabSummaries();
  (document.getElementById('ff-results') as any).hidden = true;
  savePrefs();
}

function setMinOddsPerSelection(val: string) {
  _minOddsPerSelection = parseFloat(val) || 0;
  _allResults = {};
  clearTabSummaries();
  (document.getElementById('ff-results') as any).hidden = true;
  savePrefs();
}

function setObjective(obj: 'miser' | 'gagner' | 'perdre') {
  _cashObjective = obj;
  document.querySelectorAll('.ff-objective-btn').forEach(b =>
    b.classList.toggle('ff-btn--active', (b as HTMLElement).dataset.objective === obj)
  );
  _allResults = {};
  clearTabSummaries();
  (document.getElementById('ff-results') as any).hidden = true;
  savePrefs();
}

function showCurrentResults() {
  updateTabSummaries();
  const el = document.getElementById('ff-results')!;
  if (_method === 0) {
    const all = Object.values(_allResults).flat();
    if (!all.length) {
      (el as any).hidden = false;
      el.innerHTML = '<p class="ff-empty">Cliquez sur Calculer pour voir toutes les combinaisons.</p>';
      return;
    }
    all.sort((a, b) => b.rate - a.rate);
    renderResults(all);
    return;
  }
  const key = `${_method}_${_nLegs}`;
  const results = _allResults[key];
  if (results === undefined) {
    (el as any).hidden = false;
    el.innerHTML = (_method === 1 || _method === 3)
      ? '<p class="ff-empty">Sélectionnez un site freebet pour calculer cette méthode.</p>'
      : '<p class="ff-empty">Cliquez sur Calculer.</p>';
    return;
  }
  renderResults(results);
}

// ===== WORKER LIFECYCLE =====

function cancelCalc() {
  if (_worker) {
    _worker.postMessage({ type: 'cancel' });
    _worker.terminate();
    _worker = null;
  }
  const btn = document.getElementById('ff-calc-btn') as HTMLButtonElement;
  const overlay = document.getElementById('ff-calc-overlay')!;
  if (btn) btn.disabled = false;
  (overlay as any).hidden = true;
}

async function tryRender() {
  if (!_data) return;
  if (_allowedNLegs.size === 0) {
    document.getElementById('ff-nlegs-field')?.classList.add('ff-field--error');
    return;
  }
  document.getElementById('ff-nlegs-field')?.classList.remove('ff-field--error');
  _amountTotal = parseFloat((document.getElementById('ff-amount-total') as HTMLInputElement)?.value) || 10;
  _amountMin = parseFloat((document.getElementById('ff-amount-min') as HTMLInputElement)?.value) || 2;
  _amount = _amountTotal;
  _fbSite = (document.getElementById('ff-site-select') as HTMLSelectElement)?.value ?? '';
  _allResults = {};
  _colFilters = {};

  const btn = document.getElementById('ff-calc-btn') as HTMLButtonElement;
  const overlay = document.getElementById('ff-calc-overlay')!;
  const overlayLabel = document.getElementById('ff-calc-overlay-label')!;
  const overlayBar = document.getElementById('ff-calc-overlay-bar')!;

  btn.disabled = true;
  (overlay as any).hidden = false;
  (overlayBar as HTMLElement).style.width = '0%';
  overlayLabel.textContent = 'Démarrage…';

  // Terminate any previous worker
  if (_worker) { _worker.terminate(); _worker = null; }
  _worker = new EngineWorker();

  const opts: EngineOpts = {
    coverageRules: _coverageRules,
    filterMinOdds: _filterMinOdds,
    minOddsPerSelection: _minOddsPerSelection,
    asymCov: _asymCov,
    freebetBySite: { ..._freebetBySite },
    cashObjective: _cashObjective,
  };

  _worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      overlayLabel.textContent = msg.label;
      (overlayBar as HTMLElement).style.width = `${msg.pct}%`;
    } else if (msg.type === 'result') {
      _allResults = msg.allResults;
      (overlayBar as HTMLElement).style.width = '100%';
      overlayLabel.textContent = 'Terminé';
      setTimeout(() => {
        (overlay as any).hidden = true;
        btn.disabled = false;
        _worker = null;
        showCurrentResults();
      }, 150);
    } else if (msg.type === 'cancelled') {
      (overlayBar as HTMLElement).style.width = '0%';
      overlayLabel.textContent = 'Annulé';
      setTimeout(() => {
        (overlay as any).hidden = true;
        btn.disabled = false;
        _worker = null;
      }, 150);
    }
  };

  _worker.onerror = () => {
    (overlay as any).hidden = true;
    btn.disabled = false;
    _worker = null;
  };

  _worker.postMessage({
    type: 'compute',
    payload: {
      data: _data,
      opts,
      fbSite: _fbSite,
      amount: _amount,
      allowedNLegs: [..._allowedNLegs],
      betType: _betType,
      hasSeq: !!_fbSite,
    },
  });
}

// ===== JSON / DATA =====

function onJsonChange() {
  const raw = (document.getElementById('ff-json') as HTMLTextAreaElement)?.value.trim();
  const errEl = document.getElementById('ff-json-error')!;
  _allResults = {};
  clearTabSummaries();
  (document.getElementById('ff-results') as any).hidden = true;
  if (!raw) {
    _data = null;
    (errEl as any).hidden = true;
    updateSiteSelect([]);
    updateFreebetSites([]);
  } else {
    try {
      _data = JSON.parse(raw);
      (errEl as any).hidden = true;
      const sites = collectSites(_data);
      updateSiteSelect(sites);
      updateFreebetSites(sites);
    } catch (e: any) {
      _data = null;
      errEl.textContent = 'JSON invalide : ' + e.message;
      (errEl as any).hidden = false;
      updateSiteSelect([]);
      updateFreebetSites([]);
    }
  }
  (document.getElementById('ff-calc-btn') as HTMLButtonElement).disabled = !_data;
}

function updateFreebetSites(sites: string[]) {
  const wrap = document.getElementById('ff-freebet-sites-wrap')!;
  const field = document.getElementById('ff-freebet-sites-field')!;
  if (!wrap || !field) return;
  if (!sites.length) {
    (field as any).hidden = true;
    _freebetBySite = {};
    return;
  }
  const prev = { ..._freebetBySite };
  _freebetBySite = {};
  for (const s of sites) _freebetBySite[s] = prev[s] ?? 0;
  wrap.innerHTML = sites.map(s => `
    <div class="ff-fb-site-row">
      <span class="ff-fb-site-name">${esc(s)}</span>
      <div class="numinput numinput--sm">
        <input type="number" class="ff-fb-amount-input" data-site="${esc(s)}"
          value="${_freebetBySite[s] || ''}"
          min="0" step="5" placeholder="0"
          oninput="setFreebetAmount('${esc(s)}', this.value)"
          onclick="this.select()" />
        <span class="unit">€</span>
      </div>
    </div>`).join('');
  (field as any).hidden = _betType !== 'fb';
}

function setFreebetAmount(site: string, value: string) {
  _freebetBySite[site] = parseFloat(value) || 0;
}

function updateSiteSelect(sites: string[]) {
  const sel = document.getElementById('ff-site-select') as HTMLSelectElement;
  const field = document.getElementById('ff-site-field')!;
  if (!sel || !field) return;
  if (!sites.length) {
    (field as any).hidden = true;
    sel.innerHTML = '<option value="">— Sélectionner un site —</option>';
    return;
  }
  sel.innerHTML = '<option value="">— Sélectionner un site —</option>'
    + sites.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  const savedSite = loadPrefs().site;
  if (savedSite && sites.includes(savedSite)) sel.value = savedSite;
  (field as any).hidden = false;
}

function stepAmountTotal(delta: number) {
  const input = document.getElementById('ff-amount-total') as HTMLInputElement;
  input.value = String(Math.max(1, (parseFloat(input.value) || 0) + delta));
  savePrefs();
}

function stepAmountMin(delta: number) {
  const input = document.getElementById('ff-amount-min') as HTMLInputElement;
  input.value = String(Math.max(0.5, (parseFloat(input.value) || 0) + delta));
  savePrefs();
}

function setAmountMode(mode: string) {
  _amountMode = mode;
  document.querySelectorAll('.ff-amountmode-btn').forEach(b =>
    b.classList.toggle('ff-btn--active', (b as HTMLElement).dataset.mode === mode)
  );
  (document.getElementById('ff-amount-total-wrap') as any).hidden = mode !== 'total';
  (document.getElementById('ff-amount-min-wrap') as any).hidden = mode !== 'min';
  savePrefs();
  if (Object.keys(_allResults).length) showCurrentResults();
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    const el = document.getElementById('ff-json') as HTMLTextAreaElement;
    el.value = text;
    onJsonChange();
  } catch {}
}

function onSearchInput() { renderPage(); }

// ===== EXPOSE TO WINDOW (for HTML onclick handlers) =====

declare global { interface Window { [key: string]: any; } }

window.tryRender = tryRender;
window.cancelCalc = cancelCalc;
window.onJsonChange = onJsonChange;
window.onSearchInput = onSearchInput;
window.pasteFromClipboard = pasteFromClipboard;
window.setBetType = setBetType;
window.setMethod = setMethod;
window.setLegs = setLegs;
window.setMethodLegs = setMethodLegs;
window.setAsymCov = setAsymCov;
window.setObjective = setObjective;
window.setMinOddsFilter = setMinOddsFilter;
window.setMinOddsPerSelection = setMinOddsPerSelection;
window.toggleNLegs = toggleNLegs;
window.setAmountMode = setAmountMode;
window.stepAmountTotal = stepAmountTotal;
window.stepAmountMin = stepAmountMin;
window.setFreebetAmount = setFreebetAmount;
window.toggleDetail = toggleDetail;
window.showMore = showMore;
window.openColFilterPopover = openColFilterPopover;
window.closeColFilterPopover = closeColFilterPopover;
window.clearColFilter = clearColFilter;
window.clearAllColFilters = clearAllColFilters;
window.applyColFilterFromPopover = applyColFilterFromPopover;

// ===== INIT =====

document.addEventListener('DOMContentLoaded', async () => {
  const prefs = loadPrefs();
  if (prefs.betType) setBetType(prefs.betType);
  if (prefs.cashObjective) setObjective(prefs.cashObjective);
  if (prefs.amountMode) setAmountMode(prefs.amountMode);
  const savedTotal = prefs.amountTotal ?? prefs.amount;
  if (savedTotal) { const i = document.getElementById('ff-amount-total') as HTMLInputElement; if (i) i.value = savedTotal; }
  if (prefs.amountMin) { const i = document.getElementById('ff-amount-min') as HTMLInputElement; if (i) i.value = prefs.amountMin; }
  if (prefs.method && prefs.nLegs) setMethodLegs(prefs.method, prefs.nLegs);
  if (prefs.asymCov) setAsymCov(true);
  if (prefs.filterMinOdds > 0) {
    _filterMinOdds = prefs.filterMinOdds;
    const i = document.getElementById('ff-filter-odds') as HTMLInputElement;
    if (i) i.value = prefs.filterMinOdds;
  }
  if (Array.isArray(prefs.allowedNLegs) && prefs.allowedNLegs.length > 0) {
    _allowedNLegs = new Set(prefs.allowedNLegs);
    document.querySelectorAll('.ff-nlegs-btn').forEach(b =>
      b.classList.toggle('ff-btn--active', _allowedNLegs.has(+(b as HTMLElement).dataset.n!))
    );
    updateTabCounts();
  }
  if (prefs.minOddsPerSelection > 0) {
    _minOddsPerSelection = prefs.minOddsPerSelection;
    const i = document.getElementById('ff-min-odds-sel') as HTMLInputElement;
    if (i) i.value = prefs.minOddsPerSelection;
  }
  document.getElementById('ff-amount-total')?.addEventListener('change', savePrefs);
  document.getElementById('ff-amount-min')?.addEventListener('change', savePrefs);
  document.getElementById('ff-site-select')?.addEventListener('change', savePrefs);

  // Load coverage rules
  try {
    const r = await fetch('../assets/coverage-rules.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _coverageRules = await r.json();
  } catch (e: any) {
    const errEl = document.getElementById('ff-json-error')!;
    errEl.textContent = `Erreur : impossible de charger coverage-rules.json (${e.message}). Ouvrez la page via un serveur local.`;
    (errEl as any).hidden = false;
    return;
  }

  if (new URLSearchParams(location.search).get('autopaste') === '1') {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { JSON.parse(text); (document.getElementById('ff-json') as HTMLTextAreaElement).value = text; onJsonChange(); }
    } catch {}
  }

  const param = new URLSearchParams(location.search).get('data');
  if (param) {
    try {
      const bytes = Uint8Array.from(atob(param), c => c.charCodeAt(0));
      (document.getElementById('ff-json') as HTMLTextAreaElement).value = new TextDecoder().decode(bytes);
      onJsonChange();
    } catch {}
  }

  setTimeout(() => {
    if ((document.getElementById('ff-json') as HTMLTextAreaElement).value.trim()) onJsonChange();
  }, 100);

  document.addEventListener('click', e => {
    const p = document.getElementById('ff-col-filter-popover');
    if (!p || (p as any).hidden) return;
    if (!p.contains(e.target as Node) && !(e.target as Element).closest('.ff-th-filter-btn')) closeColFilterPopover();
  });
  document.addEventListener('keydown', e => {
    if ((e as KeyboardEvent).key === 'Escape') closeColFilterPopover();
  });
});
