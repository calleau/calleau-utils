import EngineWorker from './worker.ts?worker';
import { collectSites, eventDisplayName, formatDate, getBackOdds } from './engine';
import bugOffUrl from '../../assets/icons/bug-off.svg?url';
import bugUrl from '../../assets/icons/bug.svg?url';
import type { AllResults, CoveringSetResult, BetDetail, LegRef, WorkerOutMessage, EngineOpts, CoverageRule, SiteConfig, Mission } from './types';

// ===== STATE =====
let _data: any = null;
let _results: AllResults = [];
let _filteredResults: AllResults = [];
let _coverageRules: CoverageRule[] = [];
let _sitesInfo: any = null;
let _workers: Worker[] = [];
let _visibleCount = 50;
let _colFilters: Record<string, any> = {};
let _cfpOpenCol: string | null = null;

// Config state
let _betType: 'fb' | 'cash' = 'fb';
let _advancedMode = false;

// Simple mode
let _simpleSite = '';
let _simpleAmountMode: 'mise_totale' | 'mise_min_par_pari' | 'profit_net_min' | 'profit_brut' = 'mise_totale';
let _simpleAmount = 10;
let _simpleCashObjective: 'gagner' | 'miser' | 'perdre' = 'miser';
let _simpleCoteMin = 0;
let _simpleCoteMinSel = 0;

// Advanced mode — per site
let _advSites: Record<string, {
  freebetAmount: number;
  freebetPriority: 1 | 2 | 3;
  missions: Mission[];
}> = {};

// General params
let _allowedNLegs = new Set([1, 2, 3]);
let _allowSeq = true;
let _allowSimult = true;
let _allowUni = true;
let _allowMulti = true;
let _allowSym = true;
let _allowAsymLight = false;
let _allowAsym = false;
let _savedMethods: { seq: boolean; simult: boolean; sym: boolean; asymLight: boolean; asym: boolean } | null = null;

// ===== PREFS =====
const PREFS_KEY = 'ff_prefs_v2';

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      betType: _betType,
      advancedMode: _advancedMode,
      simpleSite: _simpleSite,
      simpleAmountMode: _simpleAmountMode,
      simpleAmount: _simpleAmount,
      simpleCashObjective: _simpleCashObjective,
      simpleCoteMin: _simpleCoteMin,
      simpleCoteMinSel: _simpleCoteMinSel,
      allowedNLegs: [..._allowedNLegs],
      allowSeq: _savedMethods ? _savedMethods.seq : _allowSeq,
      allowSimult: _savedMethods ? _savedMethods.simult : _allowSimult,
      allowUni: _allowUni, allowMulti: _allowMulti,
      allowSym: _savedMethods ? _savedMethods.sym : _allowSym,
      allowAsymLight: _savedMethods ? _savedMethods.asymLight : _allowAsymLight,
      allowAsym: _savedMethods ? _savedMethods.asym : _allowAsym,
    }));
  } catch {}
}

function loadPrefs(): Record<string, any> {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; }
}

// ===== HELPERS =====

function siteHasFb(name: string): boolean {
  const entry = _sitesInfo?.[name];
  if (entry && 'has_fb' in entry) return entry.has_fb;
  return _sitesInfo?.default?.has_fb ?? true;
}

function esc(s: any): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(n: number, d = 2): string { return Number(n).toFixed(d).replace('.', ','); }

function rateClass(rate: number, isCash: boolean): string {
  if (isCash) {
    if (rate >= -0.03) return 'ff-rate-good';
    if (rate >= -0.07) return 'ff-rate-ok';
    return 'ff-rate-bad';
  }
  if (rate >= 0.75) return 'ff-rate-good';
  if (rate >= 0.55) return 'ff-rate-ok';
  return 'ff-rate-bad';
}

function isExchangeSite(name: string): boolean {
  if (!_sitesInfo) return false;
  for (const [key, val] of Object.entries(_sitesInfo) as [string, any][]) {
    if (key === 'default') continue;
    if ((val as any).type === 'Exchange' && name.toLowerCase().includes(key.toLowerCase())) return true;
  }
  return false;
}

function sitePill(name: string, isLay = false): string {
  const isExch = isExchangeSite(name);
  const layClass = isLay && isExch ? ' ff-site-pill--lay' : '';
  const label = isExch ? `${esc(name)} ${isLay ? 'Lay' : 'Back'}` : esc(name);
  return `<span class="ff-site-pill${layClass}" data-site="${esc(name.toLowerCase())}">${label}</span>`;
}

function miseTag(type: 'fb' | 'cash'): string {
  return type === 'fb'
    ? `<span class="ff-mise-tag ff-mise-tag--fb">Freebet</span>`
    : `<span class="ff-mise-tag ff-mise-tag--cash">Cash</span>`;
}

function resolveIssueLabel(outcomeName: string, eventKey: string): string {
  const ev = _data?.[eventKey];
  const opp = ev?.opponents;
  if (!opp) return esc(outcomeName);
  const k = outcomeName.trim();
  if (k === '1') return esc(String(opp['1'] ?? outcomeName));
  if (k === '2') return esc(String(opp['2'] ?? outcomeName));
  if (k === 'X') return 'Nul';
  return esc(outcomeName);
}

function getLegIndivOdds(leg: LegRef, site: string): number | null {
  const oddsMap = _data?.[leg.eventKey]?.markets?.[leg.marketName]?.[leg.outcomeName];
  if (!oddsMap) return null;
  return getBackOdds(oddsMap[site]);
}

function formatGap(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}\u00a0min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

// ===== BUILD ENGINE OPTS =====

function buildEngineOpts(): EngineOpts {
  const sites: Record<string, SiteConfig> = {};

  if (_advancedMode) {
    for (const [site, cfg] of Object.entries(_advSites)) {
      sites[site] = {
        freebetAmount: cfg.freebetAmount,
        freebetPriority: cfg.freebetPriority,
        missions: cfg.missions,
      };
    }
  } else {
    // Simple mode: build a single-site config from simple mode settings
    if (_data) {
      const allSites = collectSites(_data);
      for (const s of allSites) {
        if (s === _simpleSite && _betType === 'fb' && siteHasFb(s)) {
          sites[s] = { freebetAmount: _simpleAmount, freebetPriority: 1, missions: [] };
        } else if (s === _simpleSite && _betType === 'cash') {
          // Obligatory cash site: add a default mission
          sites[s] = {
            freebetAmount: 0, freebetPriority: 3,
            missions: [{
              id: 'simple_main',
              importance: 'obligatoire',
              montantMode: (_simpleAmountMode === 'mise_totale' || _simpleAmountMode === 'mise_min_par_pari') ? 'mise_min' : _simpleAmountMode,
              // Pour mise_totale : montant=0 car l'amount est déjà appliqué
              // dans makeSimultResult via opts.amount. La mission sert uniquement
              // à marquer le site comme obligatoire.
              montant: _simpleAmountMode === 'mise_totale' ? 0 : _simpleAmount,
              objectif: _simpleCashObjective,
              coteMin: _simpleCoteMin,
              coteMinParSelection: _simpleCoteMinSel,
              nbCombinesMin: 1,
            }],
          };
        } else {
          sites[s] = { freebetAmount: 0, freebetPriority: 3, missions: [] };
        }
      }
    }
  }

  return {
    coverageRules: _coverageRules,
    betType: _betType,
    sites,
    allowedNLegs: [..._allowedNLegs],
    amountMode: _simpleAmountMode,
    amount: _simpleAmount,
    cashObjective: _simpleCashObjective,
    coteMin: _simpleCoteMin,
    coteMinParSelection: _simpleCoteMinSel,
    allowSeq: _allowSeq,
    allowSimult: _allowSimult,
    allowUni: _allowUni,
    allowMulti: _allowMulti,
    allowSym: _allowSym,
    allowAsymLight: _allowAsymLight,
    allowAsym: _allowAsym,
  };
}

// ===== RESULT TABLE HELPERS =====

function resultMethodLabel(r: CoveringSetResult): string {
  const timing = r.timing === 'seq' ? 'Séq.' : 'Simult.';
  const placement = r.placement === 'uni' ? 'Uni' : 'Multi';
  const sym = r.symmetry === 'sym' ? 'Sym.' : r.symmetry === 'asym-light' ? 'Asym. lég.' : 'Asym.';
  return `${timing} · ${placement} · ${sym}`;
}

function resultFirstDate(r: CoveringSetResult): string {
  let first: number | null = null;
  for (const ek of r.eventKeys) {
    const dt = _data?.[ek]?.dateTime;
    if (dt) {
      const t = new Date(dt).getTime();
      if (!first || t < first) first = t;
    }
  }
  return first ? formatDate(new Date(first).toISOString()) : '—';
}

function resultEventsHtml(r: CoveringSetResult): string {
  return r.eventKeys.map(ek => {
    const ev = _data?.[ek];
    return `<span>${esc(ev ? eventDisplayName(ek, ev) : ek)}</span>`;
  }).join('');
}

function resultMarketsHtml(r: CoveringSetResult): string {
  return r.eventKeys.map(ek => {
    const mkts = [...new Set(r.bets.flatMap(b => b.legs.filter(l => l.eventKey === ek).map(l => l.marketName)))];
    return `<span>${esc(mkts.join(', ') || '—')}</span>`;
  }).join('');
}

function resultAllOdds(r: CoveringSetResult): number[] {
  return r.bets.map(b => b.odds);
}

function resultOddsRange(r: CoveringSetResult): string {
  const odds = resultAllOdds(r);
  if (!odds.length) return '—';
  const mn = Math.min(...odds), mx = Math.max(...odds);
  return Math.abs(mx - mn) < 0.01 ? fmt(mn) : `${fmt(mn)}\u2013${fmt(mx)}`;
}

function resultProfitDisplay(r: CoveringSetResult): { cls: string; text: string } {
  const p = r.profit;
  if (_betType === 'cash') {
    return { cls: p >= 0 ? 'pos' : 'neg', text: `${p >= 0 ? '+' : '\u2212'}${fmt(Math.abs(p))}\u00a0\u20ac` };
  }
  return { cls: 'pos', text: `+${fmt(p)}\u00a0\u20ac` };
}

// ===== DETAIL RENDERING =====

function buildBetDetailRow(bet: BetDetail, idx: number): string {
  const isLay = bet.liability != null;
  const stepLabel = bet.seqStep != null ? `Seq.\u00a0${bet.seqStep + 1}` : `Pari\u00a0${idx + 1}`;
  const roleClass = bet.role === 'principal' ? 'ff-betrow-badge--back' : 'ff-betrow-badge--cover';
  const roleLabel = bet.role === 'principal' ? stepLabel : `Couv.\u00a0${idx + 1}`;

  const legLines = bet.legs.map(l => {
    const evName = _data?.[l.eventKey] ? eventDisplayName(l.eventKey, _data[l.eventKey]) : l.eventKey;
    const issueLabel = resolveIssueLabel(l.outcomeName, l.eventKey);
    const indivOdds = bet.legs.length === 1 ? bet.odds : (getLegIndivOdds(l, bet.site) ?? bet.odds);
    const marketIssue = isLay
      ? `<strong>Lay ${esc(l.marketName)} ${issueLabel}</strong>`
      : `<strong>${esc(l.marketName)} ${issueLabel}</strong>`;
    return `<span class="ff-betrow-legline">${esc(evName)} \u2022 ${marketIssue} \u2022 ${fmt(indivOdds)}</span>`;
  }).join('');

  const liabilityStr = isLay
    ? ` \u2022 <strong>Liability\u00a0${fmt(bet.liability!)}\u00a0\u20ac</strong>`
    : '';
  const summaryLine = `${sitePill(bet.site, isLay)} \u2022 ${fmt(bet.odds)} \u2022 ${miseTag(bet.betType)} Mise <strong>${fmt(bet.stake)}\u00a0\u20ac</strong>${liabilityStr}`;
  const grossGain = fmt(bet.stake * bet.odds);

  return `
  <div class="ff-betrow">
    <span class="ff-betrow-badge ${roleClass}">${esc(roleLabel)}</span>
    <div class="ff-betrow-body">
      ${legLines}
      <div class="ff-betrow-summary-row">
        <span class="ff-betrow-summary">${summaryLine}</span>
        <span class="ff-betrow-gain">${grossGain}\u00a0\u20ac</span>
      </div>
    </div>
  </div>`;
}

function buildDetailContent(r: CoveringSetResult): string {
  const rows = r.bets.map((b, i) => buildBetDetailRow(b, i)).join('');
  return `<div class="ff-betlist">${rows}</div>`;
}

// ===== COLUMN FILTERS =====

const COL_FILTER_DEFS: Record<string, any> = {
  method: {
    type: 'set',
    label: 'Méthode',
    options: [
      { value: 'seq_uni_sym', label: 'Séq. · Uni · Sym.' },
      { value: 'seq_multi_sym', label: 'Séq. · Multi · Sym.' },
      { value: 'simult_uni_sym', label: 'Simult. · Uni · Sym.' },
      { value: 'simult_multi_sym', label: 'Simult. · Multi · Sym.' },
      { value: 'simult_uni_asym-light', label: 'Simult. · Uni · Asym. lég.' },
      { value: 'simult_multi_asym-light', label: 'Simult. · Multi · Asym. lég.' },
      { value: 'simult_uni_asym', label: 'Simult. · Uni · Asym.' },
      { value: 'simult_multi_asym', label: 'Simult. · Multi · Asym.' },
    ],
    getValue: (r: CoveringSetResult) => `${r.timing}_${r.placement}_${r.symmetry}`,
  },
  matches: {
    type: 'num',
    label: 'Matchs',
    getValue: (r: CoveringSetResult) => r.nMatches,
  },
  paris: {
    type: 'num',
    label: 'Paris',
    getValue: (r: CoveringSetResult) => r.bets.length,
  },
  cash: {
    type: 'num',
    label: 'Cash engagé',
    getValue: (r: CoveringSetResult) => r.totalCash,
  },
  cote: {
    type: 'num',
    label: 'Cote min',
    getValue: (r: CoveringSetResult) => Math.min(...r.bets.map(b => b.odds)),
  },
  result: {
    type: 'num',
    label: 'Résultat',
    getValue: (r: CoveringSetResult) => r.profit,
  },
  taux: {
    type: 'num',
    label: 'Taux (%)',
    getValue: (r: CoveringSetResult) => r.rate * 100,
  },
};

function isColFilterActive(col: string): boolean {
  const f = _colFilters[col];
  if (!f) return false;
  if (f.type === 'num') return f.min !== null || f.max !== null || f.exact !== null;
  if (f.type === 'set') return f.values.size > 0 && f.values.size < COL_FILTER_DEFS[col]?.options?.length;
  return false;
}

function passesColFilters(r: CoveringSetResult): boolean {
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

function clearColFilter(col: string) { delete _colFilters[col]; closeColFilterPopover(); renderPage(); }
function clearAllColFilters() { _colFilters = {}; closeColFilterPopover(); renderPage(); }

function applyColFilterFromPopover(col: string) {
  const def = COL_FILTER_DEFS[col];
  if (def.type === 'num') {
    const parse = (id: string) => { const v = (document.getElementById(id) as HTMLInputElement)?.value.trim(); return v === '' || v == null ? null : parseFloat(v); };
    const min = parse('ff-cfp-min'), max = parse('ff-cfp-max'), exact = parse('ff-cfp-exact');
    if (min === null && max === null && exact === null) delete _colFilters[col];
    else _colFilters[col] = { type: 'num', min, max, exact };
  } else if (def.type === 'set') {
    const checked = new Set([...document.querySelectorAll('#ff-cfp-body input[type=checkbox]:checked')].map(cb => (cb as HTMLInputElement).value));
    if (checked.size === 0 || checked.size === def.options.length) delete _colFilters[col];
    else _colFilters[col] = { type: 'set', values: checked };
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

// ===== TABLE ROW =====

function buildTableRow(r: CoveringSetResult, idx: number): string {
  const { cls: profitCls, text: profitText } = resultProfitDisplay(r);
  const isCash = _betType === 'cash';
  const rc = rateClass(r.rate, isCash);
  const cashStr = r.totalCash > 0 ? `${fmt(r.totalCash)}\u00a0\u20ac` : '\u2013';
  return `
    <button class="ff-row-expand" id="ff-expand-${idx}" onclick="toggleDetail(${idx})" aria-label="Détails"><span class="ff-expand-icon">&#9654;</span></button>
    <div class="ff-td ff-td-muted ff-method-cell">${esc(resultMethodLabel(r))}</div>
    <div class="ff-td ff-td-center">${r.nMatches}</div>
    <div class="ff-td ff-td-mono ff-td-date">${esc(resultFirstDate(r))}</div>
    <div class="ff-td ff-td-events">${resultEventsHtml(r)}</div>
    <div class="ff-td ff-td-muted ff-td-events">${resultMarketsHtml(r)}</div>
    <div class="ff-td ff-td-center">${r.bets.length}</div>
    <div class="ff-td ff-td-mono">${esc(cashStr)}</div>
    <div class="ff-td ff-td-mono">${esc(resultOddsRange(r))}</div>
    <div class="ff-td ff-td-mono ${profitCls}">${profitText}</div>
    <div class="ff-td ${rc} ff-td-bold">${fmt(r.rate * 100, 1)}\u00a0%</div>
    <div class="ff-tr-detail" id="ff-detail-${idx}" hidden>${buildDetailContent(r)}</div>`;
}

function toggleDetail(idx: number) {
  const detail = document.getElementById(`ff-detail-${idx}`);
  const btn = document.getElementById(`ff-expand-${idx}`);
  if (!detail) return;
  (detail as any).hidden = !(detail as any).hidden;
  btn?.classList.toggle('ff-expand-open', !(detail as any).hidden);
}

// ===== RESULTS RENDERING =====

function renderResults(results: AllResults) {
  _results = results;
  _visibleCount = 50;
  const el = document.getElementById('ff-results')!;
  (el as any).hidden = false;

  if (!results.length) {
    el.innerHTML = `<p class="ff-empty">Aucune opportunité trouvée.</p>`;
    return;
  }

  el.innerHTML = `
    <div class="ff-search-row">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      <input id="ff-search" class="ff-search-input" placeholder="Rechercher un match…" oninput="onSearchInput()" />
    </div>
    <p id="ff-summary" class="ff-summary"></p>
    <div id="ff-cards"></div>
    <div id="ff-more"></div>`;
  renderPage();
}

function renderPage() {
  const cards = document.getElementById('ff-cards');
  const more = document.getElementById('ff-more');
  if (!cards) return;
  const q = ((document.getElementById('ff-search') as HTMLInputElement)?.value ?? '').trim().toLowerCase();

  const filtered = _results.filter(r => {
    if (!passesColFilters(r)) return false;
    if (!q) return true;
    return r.eventKeys.some(ek => {
      const ev = _data?.[ek];
      return ev && eventDisplayName(ek, ev).toLowerCase().includes(q);
    });
  });
  _filteredResults = filtered;

  filtered.sort((a, b) => b.profit - a.profit);
  const visible = filtered.slice(0, _visibleCount);

  const summaryEl = document.getElementById('ff-summary');
  if (summaryEl) {
    summaryEl.textContent = q
      ? `${filtered.length} résultat${filtered.length > 1 ? 's' : ''} — ${Math.min(_visibleCount, filtered.length)} affiché${filtered.length > 1 ? 's' : ''}`
      : `${_results.length} combinaison${_results.length > 1 ? 's' : ''} — ${Math.min(_visibleCount, filtered.length)} affichée${_results.length > 1 ? 's' : ''}`;
  }

  const headers = `
    <div class="ff-th"></div>
    ${thFilter('method', 'Méthode')}
    ${thFilter('matches', 'Matchs', 'ff-th-center')}
    <div class="ff-th">Date</div>
    <div class="ff-th">Événement(s)</div>
    <div class="ff-th">Marchés</div>
    ${thFilter('paris', 'Paris', 'ff-th-center')}
    ${thFilter('cash', 'Cash engagé')}
    ${thFilter('cote', 'Cotes')}
    ${thFilter('result', 'Résultat')}
    ${thFilter('taux', 'Taux')}`;

  if (!visible.length) {
    const hasFilters = Object.keys(_colFilters).length > 0;
    const msg = hasFilters
      ? `<p class="ff-empty">Aucun résultat. <button class="ff-link-btn" onclick="clearAllColFilters()">Effacer les filtres</button></p>`
      : `<p class="ff-empty">Aucun match correspondant.</p>`;
    cards.innerHTML = `<div class="ff-table-wrap"><div class="ff-table">${headers}</div></div>${msg}`;
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

// ===== UI STATE =====

function setBetType(t: 'fb' | 'cash') {
  _betType = t;
  document.querySelectorAll('.ff-bettype-btn').forEach(b =>
    b.classList.toggle('ff-btn--active', (b as HTMLElement).dataset.bettype === t)
  );
  const objField = document.getElementById('ff-objective-field');
  if (objField) (objField as any).hidden = t !== 'cash';
  updateAmountLabel();
  if (_data) updateSiteSelect(collectSites(_data));
  resetResults();
  savePrefs();
}

function setObjective(obj: 'gagner' | 'miser' | 'perdre') {
  _simpleCashObjective = obj;
  document.querySelectorAll('.ff-objective-btn').forEach(b =>
    b.classList.toggle('ff-btn--active', (b as HTMLElement).dataset.objective === obj)
  );
  resetResults();
  savePrefs();
}

function updateAmountLabel() {
  const lbl = document.getElementById('ff-amount-label');
  if (!lbl) return;
  const labels: Record<string, Record<string, string>> = {
    fb: {
      mise_totale: 'Montant Freebet',
      mise_min_par_pari: 'Mise min. / pari FB',
      profit_net_min: 'Profit net min.',
      profit_brut: 'Profit brut min.',
    },
    cash: {
      mise_totale: 'Mise totale',
      mise_min_par_pari: 'Mise min. par pari',
      profit_net_min: 'Profit net min.',
      profit_brut: 'Profit brut min.',
    },
  };
  lbl.textContent = labels[_betType]?.[_simpleAmountMode] ?? 'Montant';
}

function setAmountMode(mode: 'mise_totale' | 'mise_min_par_pari' | 'profit_net_min' | 'profit_brut') {
  _simpleAmountMode = mode;
  document.querySelectorAll('.ff-amountmode-btn').forEach(b =>
    b.classList.toggle('ff-btn--active', (b as HTMLElement).dataset.mode === mode)
  );
  updateAmountLabel();
  resetResults();
  savePrefs();
}

function onAmountInput(val: string) {
  _simpleAmount = parseFloat(val) || 10;
  resetResults();
  savePrefs();
}

function stepAmount(delta: number) {
  const input = document.getElementById('ff-amount-input') as HTMLInputElement;
  if (!input) return;
  const min = parseFloat(input.min) || 0.5;
  input.value = String(Math.max(min, (parseFloat(input.value) || 0) + delta));
  _simpleAmount = parseFloat(input.value);
  resetResults();
  savePrefs();
}

function setMinOddsFilter(val: string) {
  _simpleCoteMin = parseFloat(val) || 0;
  resetResults();
  savePrefs();
}

function setMinOddsPerSelection(val: string) {
  _simpleCoteMinSel = parseFloat(val) || 0;
  resetResults();
  savePrefs();
}

function toggleNLegs(n: number) {
  if (_allowedNLegs.has(n)) _allowedNLegs.delete(n);
  else _allowedNLegs.add(n);
  document.querySelectorAll('.ff-nlegs-btn').forEach(b =>
    b.classList.toggle('ff-btn--active', _allowedNLegs.has(+(b as HTMLElement).dataset.n!))
  );
  if (_allowedNLegs.size > 0)
    document.getElementById('ff-nlegs-field')?.classList.remove('ff-field--error');
  updateMethodAvailability();
  resetResults();
  savePrefs();
}

function updateMethodAvailability() {
  const onlyOne = _allowedNLegs.size === 1 && _allowedNLegs.has(1);
  if (onlyOne && !_savedMethods) {
    _savedMethods = { seq: _allowSeq, simult: _allowSimult, sym: _allowSym, asymLight: _allowAsymLight, asym: _allowAsym };
    _allowSeq = false;
    _allowSimult = true;
    _allowSym = true;
    _allowAsymLight = false;
    _allowAsym = false;
  } else if (!onlyOne && _savedMethods) {
    _allowSeq = _savedMethods.seq;
    _allowSimult = _savedMethods.simult;
    _allowSym = _savedMethods.sym;
    _allowAsymLight = _savedMethods.asymLight;
    _allowAsym = _savedMethods.asym;
    _savedMethods = null;
  }
  const mapping: Array<[string, boolean]> = [
    ['ff-cb-seq', _allowSeq],
    ['ff-cb-simult', _allowSimult],
    ['ff-cb-sym', _allowSym],
    ['ff-cb-asym-light', _allowAsymLight],
    ['ff-cb-asym', _allowAsym],
  ];
  for (const [id, checked] of mapping) {
    const cb = document.getElementById(id) as HTMLInputElement | null;
    if (!cb) continue;
    cb.disabled = onlyOne;
    cb.checked = checked;
    const label = cb.closest('.ff-toggle-label') as HTMLElement | null;
    if (label) label.classList.toggle('ff-toggle-label--disabled', onlyOne);
  }
}

function setMethodToggle(method: string, val: boolean) {
  switch (method) {
    case 'seq': _allowSeq = val; break;
    case 'simult': _allowSimult = val; break;
    case 'uni': _allowUni = val; break;
    case 'multi': _allowMulti = val; break;
    case 'sym': _allowSym = val; break;
    case 'asym-light': _allowAsymLight = val; break;
    case 'asym': _allowAsym = val; break;
  }
  resetResults();
  savePrefs();
}

function setAdvancedMode(val: boolean) {
  _advancedMode = val;
  const simple = document.getElementById('ff-simple-mode');
  const advanced = document.getElementById('ff-advanced-mode');
  if (simple) (simple as any).hidden = val;
  if (advanced) (advanced as any).hidden = !val;
  if (val && _data) renderAdvancedSites(collectSites(_data));
  resetResults();
  savePrefs();
}

// ===== ADVANCED MODE UI =====

function ensureAdvSite(site: string) {
  if (!_advSites[site]) {
    _advSites[site] = { freebetAmount: 0, freebetPriority: 3, missions: [] };
  }
}

function setAdvFbAmount(site: string, val: string) {
  ensureAdvSite(site);
  _advSites[site].freebetAmount = parseFloat(val) || 0;
  resetResults(); savePrefs();
}

function setAdvFbPriority(site: string, prio: 1 | 2 | 3) {
  ensureAdvSite(site);
  _advSites[site].freebetPriority = prio;
  const wrap = document.getElementById(`ff-adv-prio-${site}`);
  wrap?.querySelectorAll('.ff-adv-prio-btn').forEach(b =>
    b.classList.toggle('ff-btn--active', +(b as HTMLElement).dataset.prio! === prio)
  );
  resetResults(); savePrefs();
}

function addAdvMission(site: string) {
  ensureAdvSite(site);
  const id = `m_${site}_${Date.now()}`;
  const mission: Mission = {
    id,
    importance: 'obligatoire',
    montantMode: 'mise_min',
    montant: 10,
    objectif: 'miser',
    coteMin: 0,
    coteMinParSelection: 0,
    nbCombinesMin: 1,
  };
  _advSites[site].missions.push(mission);
  renderAdvancedSites(Object.keys(_advSites));
  resetResults(); savePrefs();
}

function removeAdvMission(site: string, missionId: string) {
  ensureAdvSite(site);
  _advSites[site].missions = _advSites[site].missions.filter(m => m.id !== missionId);
  renderAdvancedSites(Object.keys(_advSites));
  resetResults(); savePrefs();
}

function setAdvMissionField(site: string, missionId: string, field: string, val: any) {
  ensureAdvSite(site);
  const m = _advSites[site].missions.find(m => m.id === missionId);
  if (!m) return;
  (m as any)[field] = val;
  resetResults(); savePrefs();
}

function renderAdvancedSites(sites: string[]) {
  const wrap = document.getElementById('ff-advanced-sites-wrap');
  if (!wrap) return;

  // Ensure all sites have a default config
  for (const s of sites) ensureAdvSite(s);

  const isFb = _betType === 'fb';

  wrap.innerHTML = sites.map(site => {
    const cfg = _advSites[site];
    const prioHtml = isFb && siteHasFb(site) ? `
      <div class="ff-adv-row">
        <span class="ff-sublabel">Priorité freebets</span>
        <div class="ff-legs-toggle ff-legs-toggle--sm" id="ff-adv-prio-${esc(site)}">
          ${[1, 2, 3].map(p => `
            <button class="ff-adv-prio-btn ff-btn ff-btn--sm${cfg.freebetPriority === p ? ' ff-btn--active' : ''}"
              data-prio="${p}"
              onclick="setAdvFbPriority('${esc(site)}', ${p})">${p === 1 ? '1 – Tout' : p === 2 ? '2 – Compl.' : '3 – Non'}</button>
          `).join('')}
        </div>
      </div>
      <div class="ff-adv-row">
        <label class="ff-sublabel" for="ff-adv-fb-${esc(site)}">Freebet disponible</label>
        <div class="numinput numinput--sm">
          <input type="number" id="ff-adv-fb-${esc(site)}" value="${cfg.freebetAmount}" min="0" step="5"
            onclick="this.select()"
            oninput="setAdvFbAmount('${esc(site)}', this.value)" />
          <span class="unit">€</span>
        </div>
      </div>` : '';

    const missionsHtml = cfg.missions.map(m => `
      <div class="ff-adv-mission" id="ff-adv-mission-${m.id}">
        <div class="ff-adv-mission-header">
          <span class="ff-sublabel">Mission</span>
          <button class="ff-adv-mission-del" onclick="removeAdvMission('${esc(site)}', '${m.id}')" title="Supprimer">✕</button>
        </div>
        <div class="ff-adv-mission-fields">
          <div class="ff-adv-row">
            <span class="ff-sublabel">Importance</span>
            <div class="ff-legs-toggle ff-legs-toggle--sm">
              <button class="ff-btn ff-btn--sm${m.importance === 'obligatoire' ? ' ff-btn--active' : ''}"
                onclick="setAdvMissionField('${esc(site)}','${m.id}','importance','obligatoire'); renderAdvancedSites(Object.keys(window._advSites))">Obligatoire</button>
              <button class="ff-btn ff-btn--sm${m.importance === 'optionnelle' ? ' ff-btn--active' : ''}"
                onclick="setAdvMissionField('${esc(site)}','${m.id}','importance','optionnelle'); renderAdvancedSites(Object.keys(window._advSites))">Optionnelle</button>
            </div>
          </div>
          <div class="ff-adv-row">
            <span class="ff-sublabel">Mode montant</span>
            <div class="ff-legs-toggle ff-legs-toggle--sm">
              ${(['mise_min', 'profit_net_min', 'profit_brut'] as const).map(mode => `
                <button class="ff-btn ff-btn--sm${m.montantMode === mode ? ' ff-btn--active' : ''}"
                  onclick="setAdvMissionField('${esc(site)}','${m.id}','montantMode','${mode}'); renderAdvancedSites(Object.keys(window._advSites))">
                  ${mode === 'mise_min' ? 'Mise min.' : mode === 'profit_net_min' ? 'Profit net' : 'Profit brut'}
                </button>`).join('')}
            </div>
          </div>
          <div class="ff-adv-row">
            <span class="ff-sublabel">Objectif</span>
            <div class="ff-legs-toggle ff-legs-toggle--sm">
              ${(['gagner', 'miser', 'perdre'] as const).map(obj => `
                <button class="ff-btn ff-btn--sm${m.objectif === obj ? ' ff-btn--active' : ''}"
                  onclick="setAdvMissionField('${esc(site)}','${m.id}','objectif','${obj}'); renderAdvancedSites(Object.keys(window._advSites))">
                  ${obj.charAt(0).toUpperCase() + obj.slice(1)}
                </button>`).join('')}
            </div>
          </div>
          <div class="ff-adv-row">
            <label class="ff-sublabel">Montant</label>
            <div class="numinput numinput--sm">
              <input type="number" value="${m.montant}" min="0" step="1" onclick="this.select()"
                oninput="setAdvMissionField('${esc(site)}','${m.id}','montant',parseFloat(this.value)||0)" />
              <span class="unit">€</span>
            </div>
          </div>
          <div class="ff-adv-row">
            <label class="ff-sublabel">Cote min.</label>
            <div class="numinput numinput--sm">
              <input type="number" value="${m.coteMin || ''}" min="1" step="0.05" placeholder="—" onclick="this.select()"
                oninput="setAdvMissionField('${esc(site)}','${m.id}','coteMin',parseFloat(this.value)||0)" />
            </div>
          </div>
          <div class="ff-adv-row">
            <label class="ff-sublabel">Cote min. / sél.</label>
            <div class="numinput numinput--sm">
              <input type="number" value="${m.coteMinParSelection || ''}" min="1" step="0.05" placeholder="—" onclick="this.select()"
                oninput="setAdvMissionField('${esc(site)}','${m.id}','coteMinParSelection',parseFloat(this.value)||0)" />
            </div>
          </div>
          <div class="ff-adv-row">
            <label class="ff-sublabel">Combinés min.</label>
            <div class="ff-legs-toggle ff-legs-toggle--sm">
              ${[1,2,3,4,5].map(nb => `
                <button class="ff-btn ff-btn--sm${m.nbCombinesMin === nb ? ' ff-btn--active' : ''}"
                  onclick="setAdvMissionField('${esc(site)}','${m.id}','nbCombinesMin',${nb}); renderAdvancedSites(Object.keys(window._advSites))">${nb}</button>
              `).join('')}
            </div>
          </div>
        </div>
      </div>`).join('');

    return `
      <div class="ff-adv-site card">
        <div class="ff-adv-site-header">
          <span class="ff-label">${esc(site)}</span>
        </div>
        ${prioHtml}
        ${missionsHtml}
        <button class="ff-adv-add-mission" onclick="addAdvMission('${esc(site)}')">+ Mission</button>
      </div>`;
  }).join('');
}

// Expose _advSites for inline onclick references
(window as any)._advSites = _advSites;

function setSite(site: string) {
  _simpleSite = site;
  document.querySelectorAll('.ff-site-btn').forEach(b =>
    b.classList.toggle('ff-btn--active', (b as HTMLElement).dataset.site === site)
  );
  resetResults();
  savePrefs();
}


function resetResults() {
  _results = [];
  (document.getElementById('ff-results') as any).hidden = true;
}

// ===== WORKER =====

function cancelCalc() {
  for (const w of _workers) {
    try { w.postMessage({ type: 'cancel' }); } catch {}
    w.terminate();
  }
  _workers = [];
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

  // Read current amount
  const amountInput = parseFloat((document.getElementById('ff-amount-input') as HTMLInputElement)?.value);
  if (!isNaN(amountInput) && amountInput > 0) _simpleAmount = amountInput;

  _results = [];
  _colFilters = {};

  const btn = document.getElementById('ff-calc-btn') as HTMLButtonElement;
  const overlay = document.getElementById('ff-calc-overlay')!;
  const overlayLabel = document.getElementById('ff-calc-overlay-label')!;
  const overlayDetail = document.getElementById('ff-calc-overlay-detail')!;
  const overlayCount = document.getElementById('ff-calc-overlay-count')!;
  const overlayBar = document.getElementById('ff-calc-overlay-bar')!;

  btn.disabled = true;
  (overlay as any).hidden = false;
  (overlayBar as HTMLElement).style.width = '0%';
  overlayLabel.textContent = 'Démarrage…';
  overlayDetail.textContent = '';
  overlayCount.textContent = '';

  for (const w of _workers) w.terminate();
  _workers = [];

  const opts = buildEngineOpts();

  const hw = (navigator as any).hardwareConcurrency || 4;
  const poolSize = Math.max(1, Math.min(hw, 8));

  const progressPerWorker: Array<{ done: number; total: number; detail: string }> =
    Array.from({ length: poolSize }, () => ({ done: 0, total: 0, detail: '' }));
  const aggregatedResults: any[][] = Array.from({ length: poolSize }, () => []);
  let finished = 0;
  let anyCancelled = false;

  for (let i = 0; i < poolSize; i++) {
    const w = new EngineWorker();
    _workers.push(w);

    w.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        progressPerWorker[i] = { done: msg.done ?? 0, total: msg.total ?? 0, detail: msg.detail ?? '' };
        const totalDone = progressPerWorker.reduce((s, p) => s + p.done, 0);
        const totalAll = progressPerWorker.reduce((s, p) => s + p.total, 0);
        overlayLabel.textContent = msg.label;
        overlayDetail.textContent = msg.detail ?? '';
        overlayCount.textContent = totalAll > 0
          ? `${totalDone.toLocaleString('fr-FR')} / ${totalAll.toLocaleString('fr-FR')} combinaisons`
          : '';
        const pct = totalAll > 0 ? Math.round(5 + (totalDone / totalAll) * 88) : 5;
        (overlayBar as HTMLElement).style.width = `${pct}%`;
      } else if (msg.type === 'result') {
        aggregatedResults[i] = msg.results;
        finished++;
        if (finished === poolSize) {
          if (anyCancelled) return;
          _results = aggregatedResults.flat().sort((a, b) => b.profit - a.profit);
          (overlayBar as HTMLElement).style.width = '100%';
          overlayLabel.textContent = 'Terminé';
          setTimeout(() => {
            (overlay as any).hidden = true;
            btn.disabled = false;
            for (const ww of _workers) ww.terminate();
            _workers = [];
            renderResults(_results);
          }, 150);
        }
      } else if (msg.type === 'cancelled') {
        anyCancelled = true;
        finished++;
        if (finished === poolSize) {
          (overlayBar as HTMLElement).style.width = '0%';
          overlayLabel.textContent = 'Annulé';
          setTimeout(() => {
            (overlay as any).hidden = true;
            btn.disabled = false;
            for (const ww of _workers) ww.terminate();
            _workers = [];
          }, 150);
        }
      }
    };

    w.onerror = () => {
      (overlay as any).hidden = true;
      btn.disabled = false;
      for (const ww of _workers) ww.terminate();
      _workers = [];
    };

    w.postMessage({ type: 'compute', payload: { data: _data, opts, shard: { index: i, count: poolSize } } });
  }
}

// ===== JSON / DATA =====

function onJsonChange() {
  const raw = (document.getElementById('ff-json') as HTMLTextAreaElement)?.value.trim();
  const errEl = document.getElementById('ff-json-error')!;
  resetResults();
  if (!raw) {
    _data = null;
    (errEl as any).hidden = true;
    updateSiteSelect([]);
  } else {
    try {
      _data = JSON.parse(raw);
      (errEl as any).hidden = true;
      const sites = collectSites(_data);
      updateSiteSelect(sites);
    } catch (e: any) {
      _data = null;
      errEl.textContent = 'JSON invalide : ' + e.message;
      (errEl as any).hidden = false;
      updateSiteSelect([]);
    }
  }
  (document.getElementById('ff-calc-btn') as HTMLButtonElement).disabled = !_data;
}

function updateSiteSelect(sites: string[]) {
  const wrap = document.getElementById('ff-site-select-wrap')!;
  if (!wrap) return;
  if (!sites.length) {
    wrap.innerHTML = '<p class="ff-no-sites">Chargez un JSON pour voir les sites.</p>';
    _simpleSite = '';
    return;
  }
  // In freebet mode, only show sites that support freebets as principal site
  const visibleSites = _betType === 'fb' ? sites.filter(s => siteHasFb(s)) : sites;
  const pool = visibleSites.length > 0 ? visibleSites : sites;
  if (!pool.includes(_simpleSite)) _simpleSite = pool[0] ?? '';
  wrap.innerHTML = pool.map(s => `
    <button class="ff-site-btn ff-btn${s === _simpleSite ? ' ff-btn--active' : ''}"
      data-site="${esc(s)}" onclick="setSite('${esc(s)}')">${esc(s)}</button>`).join('');

  // Refresh advanced mode panel if active
  if (_advancedMode) renderAdvancedSites(sites);
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

// ===== WINDOW EXPORTS =====

declare global { interface Window { [key: string]: any; } }

window.tryRender = tryRender;
window.cancelCalc = cancelCalc;
window.onJsonChange = onJsonChange;
window.onSearchInput = onSearchInput;
window.pasteFromClipboard = pasteFromClipboard;
window.setBetType = setBetType;
window.setObjective = setObjective;
window.setAmountMode = setAmountMode;
window.setMinOddsFilter = setMinOddsFilter;
window.setMinOddsPerSelection = setMinOddsPerSelection;
window.toggleNLegs = toggleNLegs;
window.setMethodToggle = setMethodToggle;
window.setAdvancedMode = setAdvancedMode;
window.setSite = setSite;
window.stepAmount = stepAmount;
window.onAmountInput = onAmountInput;
window.renderAdvancedSites = renderAdvancedSites;
window.setAdvFbAmount = setAdvFbAmount;
window.setAdvFbPriority = setAdvFbPriority;
window.addAdvMission = addAdvMission;
window.removeAdvMission = removeAdvMission;
window.setAdvMissionField = setAdvMissionField;
window.toggleDetail = toggleDetail;
window.showMore = showMore;
window.openColFilterPopover = openColFilterPopover;
window.closeColFilterPopover = closeColFilterPopover;
window.clearColFilter = clearColFilter;
window.clearAllColFilters = clearAllColFilters;
window.applyColFilterFromPopover = applyColFilterFromPopover;

// ===== DEBUG =====

let _debugMode = false;

function toggleDebug() {
  _debugMode = !_debugMode;
  const btn = document.getElementById('ff-debug-btn')!;
  const iconOff = document.getElementById('ff-debug-icon-off')!;
  const iconOn = document.getElementById('ff-debug-icon-on')!;
  const dlBtn = document.getElementById('ff-debug-dl-btn')!;
  const stateBtn = document.getElementById('ff-debug-state-btn')!;
  btn.classList.toggle('ff-debug-btn--active', _debugMode);
  (iconOff as any).hidden = _debugMode;
  (iconOn as any).hidden = !_debugMode;
  (dlBtn as any).hidden = !_debugMode;
  (stateBtn as any).hidden = !_debugMode;
}

function downloadDebugJson() {
  const opts = buildEngineOpts();
  const payload = {
    _meta: {
      timestamp: new Date().toISOString(),
      version: '6.0.0',
    },
    ui: {
      betType: _betType,
      advancedMode: _advancedMode,
      simpleSite: _simpleSite,
      simpleAmountMode: _simpleAmountMode,
      simpleAmount: _simpleAmount,
      simpleCashObjective: _simpleCashObjective,
      simpleCoteMin: _simpleCoteMin,
      simpleCoteMinSel: _simpleCoteMinSel,
      allowedNLegs: [..._allowedNLegs],
      allowSeq: _allowSeq,
      allowSimult: _allowSimult,
      allowUni: _allowUni,
      allowMulti: _allowMulti,
      allowSym: _allowSym,
      allowAsymLight: _allowAsymLight,
      allowAsym: _allowAsym,
      advSites: _advSites,
    },
    engineOpts: opts,
    data: _data,
    coverageRules: _coverageRules,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `magotculteur-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadDebugStateJson() {
  const opts = buildEngineOpts();
  const payload = {
    _meta: {
      timestamp: new Date().toISOString(),
      version: '6.0.0',
    },
    ui: {
      betType: _betType,
      advancedMode: _advancedMode,
      simpleSite: _simpleSite,
      simpleAmountMode: _simpleAmountMode,
      simpleAmount: _simpleAmount,
      simpleCashObjective: _simpleCashObjective,
      simpleCoteMin: _simpleCoteMin,
      simpleCoteMinSel: _simpleCoteMinSel,
      allowedNLegs: [..._allowedNLegs],
      allowSeq: _allowSeq,
      allowSimult: _allowSimult,
      allowUni: _allowUni,
      allowMulti: _allowMulti,
      allowSym: _allowSym,
      allowAsymLight: _allowAsymLight,
      allowAsym: _allowAsym,
      advSites: _advSites,
    },
    engineOpts: opts,
    data: _data,
    coverageRules: _coverageRules,
    results: _filteredResults.slice(0, 10),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `magotculteur-state-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

window.toggleDebug = toggleDebug;
window.downloadDebugJson = downloadDebugJson;
window.downloadDebugStateJson = downloadDebugStateJson;

// ===== INIT =====

document.addEventListener('DOMContentLoaded', async () => {
  (document.getElementById('ff-debug-icon-off') as HTMLImageElement).src = bugOffUrl;
  (document.getElementById('ff-debug-icon-on') as HTMLImageElement).src = bugUrl;
  (document.getElementById('ff-debug-state-icon') as HTMLImageElement).src = bugUrl;

  const prefs = loadPrefs();
  if (prefs.betType) setBetType(prefs.betType);
  if (prefs.simpleCashObjective) setObjective(prefs.simpleCashObjective);

  setAmountMode((prefs.simpleAmountMode as any) || 'mise_totale');

  if (prefs.simpleAmount) {
    _simpleAmount = prefs.simpleAmount;
    const i = document.getElementById('ff-amount-input') as HTMLInputElement;
    if (i) i.value = String(prefs.simpleAmount);
  }

  if (prefs.advancedMode != null) {
    const cb = document.getElementById('ff-advanced-cb') as HTMLInputElement;
    if (cb) cb.checked = prefs.advancedMode;
    setAdvancedMode(prefs.advancedMode);
  }
  if (Array.isArray(prefs.allowedNLegs) && prefs.allowedNLegs.length > 0) {
    _allowedNLegs = new Set(prefs.allowedNLegs);
    document.querySelectorAll('.ff-nlegs-btn').forEach(b =>
      b.classList.toggle('ff-btn--active', _allowedNLegs.has(+(b as HTMLElement).dataset.n!))
    );
  }
  if (prefs.simpleCoteMin > 0) {
    _simpleCoteMin = prefs.simpleCoteMin;
    const i = document.getElementById('ff-filter-odds') as HTMLInputElement;
    if (i) i.value = String(prefs.simpleCoteMin);
  }
  if (prefs.simpleCoteMinSel > 0) {
    _simpleCoteMinSel = prefs.simpleCoteMinSel;
    const i = document.getElementById('ff-min-odds-sel') as HTMLInputElement;
    if (i) i.value = String(prefs.simpleCoteMinSel);
  }
  // Method toggles from prefs
  if (prefs.allowSeq != null) {
    _allowSeq = prefs.allowSeq;
    const cb = document.getElementById('ff-cb-seq') as HTMLInputElement;
    if (cb) cb.checked = _allowSeq;
  }
  if (prefs.allowSimult != null) {
    _allowSimult = prefs.allowSimult;
    const cb = document.getElementById('ff-cb-simult') as HTMLInputElement;
    if (cb) cb.checked = _allowSimult;
  }
  if (prefs.allowUni != null) {
    _allowUni = prefs.allowUni;
    const cb = document.getElementById('ff-cb-uni') as HTMLInputElement;
    if (cb) cb.checked = _allowUni;
  }
  if (prefs.allowMulti != null) {
    _allowMulti = prefs.allowMulti;
    const cb = document.getElementById('ff-cb-multi') as HTMLInputElement;
    if (cb) cb.checked = _allowMulti;
  }
  if (prefs.allowSym != null) {
    _allowSym = prefs.allowSym;
    const cb = document.getElementById('ff-cb-sym') as HTMLInputElement;
    if (cb) cb.checked = _allowSym;
  }
  if (prefs.allowAsymLight != null) {
    _allowAsymLight = prefs.allowAsymLight;
    const cb = document.getElementById('ff-cb-asym-light') as HTMLInputElement;
    if (cb) cb.checked = _allowAsymLight;
  }
  if (prefs.allowAsym != null) {
    _allowAsym = prefs.allowAsym;
    const cb = document.getElementById('ff-cb-asym') as HTMLInputElement;
    if (cb) cb.checked = _allowAsym;
  }
  updateMethodAvailability();

  document.getElementById('ff-amount-input')?.addEventListener('change', () => {
    _simpleAmount = parseFloat((document.getElementById('ff-amount-input') as HTMLInputElement).value) || 10;
    savePrefs();
  });

  // Load coverage rules and sites info in parallel
  try {
    const [rulesRes, sitesRes] = await Promise.all([
      fetch('../assets/coverage-rules.json'),
      fetch('../assets/sites-informations.json'),
    ]);
    if (!rulesRes.ok) throw new Error(`coverage-rules.json HTTP ${rulesRes.status}`);
    _coverageRules = await rulesRes.json();
    if (sitesRes.ok) _sitesInfo = await sitesRes.json();
  } catch (e: any) {
    const errEl = document.getElementById('ff-json-error')!;
    errEl.textContent = `Erreur : impossible de charger les fichiers de config (${e.message}). Ouvrez la page via un serveur local.`;
    (errEl as any).hidden = false;
    return;
  }

  // Auto-paste
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
