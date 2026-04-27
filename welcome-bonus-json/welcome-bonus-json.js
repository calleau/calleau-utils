const ACCENT_COLORS = ['#5C899D', '#C07850', '#7BA18A', '#9B7EC4', '#C4A255'];
const OUTCOMES = ['1', 'N', '2'];
const MAX_MATCHES = 5;
const MAX_BOOKIES = 15;

const SLOTS_P2 = [];
for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) SLOTS_P2.push([i, j]);

// ---- État ----
let _data = null;                // JSON brut
let _sitesInfo = null;           // assets/sites-informations.json
let _parsedEvents = [];          // [{ eventKey, displayName, dateLabel, marketName, outcomeNames:[i1,iX,i2], oddsBySite:{site:[o1,oX,o2]} }]
let _selectedEventKeys = [];     // ordre de sélection

let bookies = [];                // [{ site, name, bonus, min, maxBonus, convRate }]
let matches = [];                // [{ name, eventKey }]
let parlaySize = 1;
let oddsGrid = [];               // oddsGrid[siteIdx][matchIdx][outcomeIdx] = float | null

let _comboResults = null;
let _selectedComboIdx = 0;
let _currentShowCount = 20;

// ---- Helpers JSON ----

function norm(s) {
	return String(s).toLowerCase().trim().replace(/[\s:.;,!?]+$/, '');
}

function getOddsValue(val) {
	if (val == null) return null;
	if (typeof val === 'number') return val;
	if (typeof val !== 'object') return null;
	if (val.Back && typeof val.Back === 'object') {
		return val.Back.odds_net ?? val.Back.odds ?? null;
	}
	if (typeof val.odds === 'number') return val.odds;
	return null;
}

function findOneXTwoMarket(event) {
	if (!event || !event.markets) return null;
	for (const [marketName, market] of Object.entries(event.markets)) {
		if (!market || typeof market !== 'object') continue;
		const found = { '1': null, 'X': null, '2': null };
		for (const issueName of Object.keys(market)) {
			const n = norm(issueName);
			if (n === '1' && !found['1']) found['1'] = issueName;
			else if ((n === 'x' || n === 'n') && !found['X']) found['X'] = issueName;
			else if (n === '2' && !found['2']) found['2'] = issueName;
		}
		if (found['1'] && found['X'] && found['2']) {
			return { marketName, outcomeNames: [found['1'], found['X'], found['2']] };
		}
	}
	return null;
}

function eventDisplayName(eventKey, event) {
	if (event && typeof event.nom_event === 'string') return event.nom_event;
	if (Array.isArray(event?.opponents) && event.opponents.length >= 2) return event.opponents.join(' vs ');
	if (event?.opponents && typeof event.opponents === 'object') {
		const vals = Object.values(event.opponents);
		if (vals.length >= 2) return vals.join(' vs ');
	}
	const m = String(eventKey).match(/^([^_]+)_/);
	return m ? m[1] : String(eventKey);
}

function eventDateLabel(event) {
	if (!event?.dateTime) return '';
	try {
		const d = new Date(event.dateTime);
		if (isNaN(d)) return '';
		return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
	} catch { return ''; }
}

function parseEvents(data) {
	const out = [];
	for (const [eventKey, event] of Object.entries(data || {})) {
		if (!event || typeof event !== 'object') continue;
		const m = findOneXTwoMarket(event);
		if (!m) continue;
		const oddsBySite = {};
		const [i1, iX, i2] = m.outcomeNames;
		for (const issueName of m.outcomeNames) {
			const issueOdds = event.markets[m.marketName][issueName];
			if (!issueOdds || typeof issueOdds !== 'object') continue;
			for (const [siteName, val] of Object.entries(issueOdds)) {
				if (siteName === 'timeex') continue;
				const o = getOddsValue(val);
				if (!o || o < 1.01) continue;
				if (!oddsBySite[siteName]) oddsBySite[siteName] = [null, null, null];
				const idx = issueName === i1 ? 0 : issueName === iX ? 1 : 2;
				oddsBySite[siteName][idx] = o;
			}
		}
		// Garder seulement les sites ayant les 3 cotes
		for (const site of Object.keys(oddsBySite)) {
			const arr = oddsBySite[site];
			if (arr.some(v => v == null)) delete oddsBySite[site];
		}
		out.push({
			eventKey,
			displayName: eventDisplayName(eventKey, event),
			dateLabel: eventDateLabel(event),
			marketName: m.marketName,
			outcomeNames: m.outcomeNames,
			oddsBySite,
		});
	}
	return out;
}

// ---- sites-informations ----

async function loadSitesInfo() {
	if (_sitesInfo) return _sitesInfo;
	try {
		const res = await fetch('../assets/sites-informations.json');
		if (!res.ok) throw new Error('HTTP ' + res.status);
		_sitesInfo = await res.json();
	} catch (e) {
		console.warn('Impossible de charger sites-informations.json :', e);
		_sitesInfo = { default: {} };
	}
	return _sitesInfo;
}

function siteWelcomeBonusConfig(siteName) {
	const def = (_sitesInfo && _sitesInfo.default) || {};
	const specific = (_sitesInfo && _sitesInfo[siteName]) || {};
	const merged = { ...def, ...specific };
	// Merge profond pour default_welcomebonus (sauf si explicitement null côté site)
	let wb;
	if (Object.prototype.hasOwnProperty.call(specific, 'default_welcomebonus') && specific.default_welcomebonus === null) {
		wb = null;
	} else {
		wb = { ...(def.default_welcomebonus || {}), ...(specific.default_welcomebonus || {}) };
		if (Object.keys(wb).length === 0) wb = null;
	}
	const tauxFb = typeof merged.taux_fb === 'number' ? merged.taux_fb : 0.8;
	const convRate = Math.round(tauxFb * 100);
	if (!wb) {
		return { bonus: 'no_bonus', min: 100, maxBonus: 100, convRate };
	}
	let bonus;
	if (wb.type === 'cash') {
		bonus = wb.mission === 'mise' ? 'cash_always' : 'cash_lose';
	} else {
		bonus = wb.mission === 'mise' ? 'freebet_always' : 'freebet_lose';
	}
	const max = typeof wb.max_bonus === 'number' ? wb.max_bonus : 100;
	return { bonus, min: max, maxBonus: max, convRate };
}

// ---- JSON input ----

async function onJsonChange() {
	await loadSitesInfo();
	const raw = document.getElementById('wbj-json').value.trim();
	const errEl = document.getElementById('wbj-json-error');
	resetResults();
	if (!raw) {
		_data = null; _parsedEvents = []; _selectedEventKeys = [];
		errEl.hidden = true;
		renderEvents();
		rebuildFromSelection();
		return;
	}
	try {
		_data = JSON.parse(raw);
		errEl.hidden = true;
	} catch (e) {
		_data = null; _parsedEvents = []; _selectedEventKeys = [];
		errEl.textContent = 'JSON invalide : ' + e.message;
		errEl.hidden = false;
		renderEvents();
		rebuildFromSelection();
		return;
	}
	_parsedEvents = parseEvents(_data);
	if (_parsedEvents.length === 0) {
		errEl.textContent = 'Aucun événement avec un marché 1X2 (issues 1, X, 2) trouvé.';
		errEl.hidden = false;
	}
	// Pré-sélectionner les 2 premiers
	_selectedEventKeys = _parsedEvents.slice(0, 2).map(e => e.eventKey);
	renderEvents();
	rebuildFromSelection();
}

async function pasteFromClipboard() {
	try {
		const text = await navigator.clipboard.readText();
		document.getElementById('wbj-json').value = text;
		onJsonChange();
	} catch {}
}

function toggleEventByIdx(parsedIdx) {
	const ev = _parsedEvents[parsedIdx];
	if (!ev) return;
	const idx = _selectedEventKeys.indexOf(ev.eventKey);
	if (idx >= 0) {
		_selectedEventKeys.splice(idx, 1);
	} else {
		if (_selectedEventKeys.length >= MAX_MATCHES) return;
		_selectedEventKeys.push(ev.eventKey);
	}
	renderEvents();
	rebuildFromSelection();
}

// ---- Reconstruction depuis la sélection ----

function rebuildFromSelection() {
	const selectedEvents = _selectedEventKeys
		.map(k => _parsedEvents.find(e => e.eventKey === k))
		.filter(Boolean);

	matches = selectedEvents.map(e => ({ name: e.displayName, eventKey: e.eventKey }));

	if (parlaySize === 2 && matches.length < 2) parlaySize = 1;

	// Union des sites présents dans au moins un match sélectionné
	const sitesSet = new Set();
	selectedEvents.forEach(e => Object.keys(e.oddsBySite).forEach(s => sitesSet.add(s)));
	const sites = [...sitesSet].sort();

	// Préserver les overrides utilisateur sur les sites déjà présents
	const prevBySite = new Map(bookies.map(b => [b.site, b]));
	bookies = sites.slice(0, MAX_BOOKIES).map(site => {
		const prev = prevBySite.get(site);
		if (prev) return prev;
		const cfg = siteWelcomeBonusConfig(site);
		return { site, name: site, bonus: cfg.bonus, min: cfg.min, maxBonus: cfg.maxBonus, convRate: cfg.convRate };
	});

	// Reconstruire oddsGrid
	oddsGrid = bookies.map(b =>
		selectedEvents.map(e => {
			const arr = e.oddsBySite[b.site];
			return arr ? [...arr] : [null, null, null];
		})
	);

	renderBookies();
	renderMatchesAndOdds();
	updateCalcBtn();
}

function deleteBookie(i) {
	bookies.splice(i, 1);
	oddsGrid.splice(i, 1);
	renderBookies();
	renderMatchesAndOdds();
	updateCalcBtn();
}

function setParlaySize(size) {
	if (size === 2 && matches.length < 2) return;
	parlaySize = size;
	renderMatchesAndOdds();
}

function updateBookieName(i, val) {
	bookies[i].name = val;
	document.querySelectorAll('[data-odds-name="' + i + '"]').forEach(el => el.textContent = val);
}

function updateCalcBtn() {
	const btn = document.getElementById('btn-calc');
	btn.disabled = bookies.length < 3 || matches.length === 0;
}

// ---- Rendu : événements ----

function renderEvents() {
	const container = document.getElementById('events-container');
	if (_parsedEvents.length === 0) {
		container.hidden = true;
		container.innerHTML = '';
		return;
	}
	container.hidden = false;
	const limitReached = _selectedEventKeys.length >= MAX_MATCHES;
	container.innerHTML = `
		<div class="wbj-events-card">
			<div class="wbj-events-header">
				<span class="wbj-events-title">Événements détectés (1X2)</span>
				<span class="wbj-events-count">${_selectedEventKeys.length} / ${MAX_MATCHES} sélectionné${_selectedEventKeys.length > 1 ? 's' : ''}</span>
			</div>
			<div class="wbj-events-list">
				${_parsedEvents.map((e, idx) => {
					const checked = _selectedEventKeys.includes(e.eventKey);
					const disabled = !checked && limitReached;
					const nbSites = Object.keys(e.oddsBySite).length;
					return `
						<label class="wbj-event-row ${disabled ? 'disabled' : ''}">
							<input type="checkbox" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}
								onchange="toggleEventByIdx(${idx})" />
							<span class="wbj-event-name">${escHtml(e.displayName)}</span>
							<span class="wbj-event-meta">${escHtml(e.dateLabel)} · ${nbSites} site${nbSites > 1 ? 's' : ''}</span>
						</label>
					`;
				}).join('')}
			</div>
		</div>
	`;
}

function escHtml(s) {
	return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}
function escAttr(s) { return escHtml(s).replace(/`/g, '&#96;'); }

// ---- Rendu : bookmakers ----

function renderBookies() {
	const container = document.getElementById('bookies-container');
	if (bookies.length === 0) {
		container.hidden = true;
		container.innerHTML = '';
		return;
	}
	container.hidden = false;
	const TRASH = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
	container.innerHTML = `
		<div class="bookies-grid" style="grid-template-columns: 36px 1fr minmax(140px,1fr) 90px 90px 80px 36px">
			<div class="bg-th">#</div>
			<div class="bg-th">Site</div>
			<div class="bg-th">Type de bonus</div>
			<div class="bg-th">Mise min</div>
			<div class="bg-th">Bonus max</div>
			<div class="bg-th">Taux FB</div>
			<div class="bg-th"></div>

			${bookies.map((b, i) => `
				<div class="bg-row">
					<div class="bg-cell bg-cell-num">
						<div class="bookie-num-badge">
							<div style="width:8px;height:8px;border-radius:50%;background:${ACCENT_COLORS[i % ACCENT_COLORS.length]}"></div>
							${i + 1}
						</div>
					</div>
					<div class="bg-cell">
						<input type="text" id="name-${i}" value="${escAttr(b.name)}" oninput="updateBookieName(${i}, this.value)" onclick="this.select()" />
					</div>
					<div class="bg-cell">
						<div class="bonus-select-wrapper">
							<span class="bonus-dot bonus-dot-${i}" data-bonus="${b.bonus}"></span>
							<select id="bonus-${i}" onchange="bookies[${i}].bonus=this.value; updateBonusDot(${i}, this.value); updateConvRateVisibility(${i}, this.value)">
								<option value="freebet_lose"   ${b.bonus === 'freebet_lose' ? 'selected' : ''}>Freebet si perdant</option>
								<option value="freebet_always" ${b.bonus === 'freebet_always' ? 'selected' : ''}>Freebet toujours</option>
								<option value="cash_lose"      ${b.bonus === 'cash_lose' ? 'selected' : ''}>Cash si perdant</option>
								<option value="cash_always"    ${b.bonus === 'cash_always' ? 'selected' : ''}>Cash toujours</option>
								<option value="no_bonus"       ${b.bonus === 'no_bonus' ? 'selected' : ''}>Sans bonus</option>
							</select>
						</div>
					</div>
					<div class="bg-cell">
						<div class="numinput">
							<input type="number" id="min-${i}" value="${b.min}" step="1" min="0" oninput="bookies[${i}].min=parseFloat(this.value)||0" onclick="this.select()" />
							<span class="unit">€</span>
							<div class="nbtn-wrap">
								<button class="nbtn" onclick="stepNum('min',${i},10)" type="button">▲</button>
								<button class="nbtn" onclick="stepNum('min',${i},-10)" type="button">▼</button>
							</div>
						</div>
					</div>
					<div class="bg-cell">
						<div class="numinput">
							<input type="number" id="max-${i}" value="${b.maxBonus}" step="1" min="0" oninput="bookies[${i}].maxBonus=parseFloat(this.value)||0" onclick="this.select()" />
							<span class="unit">€</span>
							<div class="nbtn-wrap">
								<button class="nbtn" onclick="stepNum('max',${i},10)" type="button">▲</button>
								<button class="nbtn" onclick="stepNum('max',${i},-10)" type="button">▼</button>
							</div>
						</div>
					</div>
					<div class="bg-cell">
						<div id="conv-cell-${i}" class="numinput" ${['cash_lose','cash_always','no_bonus'].includes(b.bonus) ? 'hidden' : ''}>
							<input type="number" id="conv-${i}" value="${b.convRate}" min="1" max="100" step="1"
								oninput="bookies[${i}].convRate=Math.min(100,Math.max(1,parseFloat(this.value)||80))"
								onclick="this.select()" />
							<span class="unit">%</span>
							<div class="nbtn-wrap">
								<button class="nbtn" onclick="stepNum('conv',${i},5)" type="button">▲</button>
								<button class="nbtn" onclick="stepNum('conv',${i},-5)" type="button">▼</button>
							</div>
						</div>
					</div>
					<div class="bg-cell bg-cell-delete">
						<button class="btn-delete-bookie" onclick="deleteBookie(${i})" title="Retirer ce site">${TRASH}</button>
					</div>
				</div>
			`).join('')}
		</div>
	`;
}

function stepNum(kind, i, delta) {
	const input = document.getElementById(`${kind}-${i}`);
	if (!input) return;
	const cur = parseFloat(input.value) || 0;
	let next = cur + delta;
	if (kind === 'conv') next = Math.min(100, Math.max(1, next));
	else next = Math.max(0, next);
	input.value = next;
	if (kind === 'min') bookies[i].min = next;
	else if (kind === 'max') bookies[i].maxBonus = next;
	else if (kind === 'conv') bookies[i].convRate = next;
}

function updateBonusDot(index, bonusType) {
	const dot = document.querySelector(`.bonus-dot-${index}`);
	if (dot) dot.setAttribute('data-bonus', bonusType);
}

function updateConvRateVisibility(i, bonusType) {
	const cell = document.getElementById(`conv-cell-${i}`);
	if (cell) cell.hidden = ['cash_lose', 'cash_always', 'no_bonus'].includes(bonusType);
}

// ---- Rendu : matchs / cotes (lecture seule) ----

function renderMatchesAndOdds() {
	const container = document.getElementById('odds-container');
	if (matches.length === 0 || bookies.length === 0) {
		container.hidden = true;
		container.innerHTML = '';
		return;
	}
	container.hidden = false;
	const parlayBtn1Class = 'parlay-btn' + (parlaySize === 1 ? ' parlay-btn--active' : '');
	const parlayBtn2Class = 'parlay-btn' + (parlaySize === 2 ? ' parlay-btn--active' : '');
	const parlayBtn2Disabled = matches.length < 2 ? 'disabled' : '';
	const oddsCols = matches.length * 3;

	container.innerHTML = `
		<div class="parlay-selector">
			<span class="parlay-label">Nombre de matchs en combiné :</span>
			<div class="parlay-toggle">
				<button class="${parlayBtn1Class}" onclick="setParlaySize(1)">1 match — 3 issues</button>
				<button class="${parlayBtn2Class}" onclick="setParlaySize(2)" ${parlayBtn2Disabled}>2 matchs — 9 issues</button>
			</div>
		</div>
		<div class="odds-grid" style="--odds-cols:${oddsCols}">
			<div class="og-site-th">Site</div>
			${matches.map((m, mIdx) => `
				<div class="og-match-th${mIdx > 0 ? ' og-group-start' : ''}">
					<div class="match-header">
						<span class="match-name-input" style="display:inline-block;padding:0.25rem 0.4rem;font-weight:600">${escHtml(m.name)}</span>
					</div>
				</div>
			`).join('')}

			<div class="og-site-placeholder"></div>
			${matches.map((_, mIdx) => OUTCOMES.map((o, j) => `
				<div class="og-outcome-th${mIdx > 0 && j === 0 ? ' og-group-start' : ''}">${o}</div>
			`).join('')).join('')}

			${bookies.map((b, i) => `
				<div class="og-row">
					<div class="og-site-cell">
						<div class="bookie-color-dot" style="background:${ACCENT_COLORS[i % ACCENT_COLORS.length]}"></div>
						<span data-odds-name="${i}">${escHtml(b.name)}</span>
					</div>
					${matches.map((_, mIdx) => OUTCOMES.map((_, j) => {
						const v = oddsGrid[i] && oddsGrid[i][mIdx] && oddsGrid[i][mIdx][j];
						const cls = 'og-cell-readonly' + (v ? '' : ' empty');
						return `
							<div class="og-cell${mIdx > 0 && j === 0 ? ' og-group-start' : ''}">
								<div class="${cls}">${v ? fmt(v, 2) : '—'}</div>
							</div>
						`;
					}).join('')).join('')}
				</div>
			`).join('')}
		</div>
	`;
}

function fmt(v, decimals = 2) {
	return v.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ---- Calcul (logique identique à welcome-bonus) ----

const MAX_STORED = 120;

function slotScore(siteIdx, odds) {
	const b = bookies[siteIdx];
	let r;
	if (b.bonus === 'no_bonus') r = 0;
	else if (b.bonus === 'cash_lose' || b.bonus === 'cash_always') r = 1;
	else r = b.convRate / 100;
	return 1 / Math.max(odds - r, 0.001);
}

function insertTop(top, item) {
	if (top.length === MAX_STORED && item.score >= top[top.length - 1].score) return;
	let lo = 0, hi = top.length;
	while (lo < hi) { const mid = (lo + hi) >> 1; if (top[mid].score < item.score) lo = mid + 1; else hi = mid; }
	top.splice(lo, 0, item);
	if (top.length > MAX_STORED) top.pop();
}

function generateCombinationsP1() {
	const top = [];
	const N = bookies.length;
	function recurse(m, slotIdx, current, used, ps) {
		if (top.length === MAX_STORED && ps >= top[top.length - 1].score) return;
		if (slotIdx === 3) { insertTop(top, { matchIndices: [m], combo: [...current], score: ps }); return; }
		for (let s = 0; s < N; s++) {
			if (used[s]) continue;
			const odds = oddsGrid[s][m][slotIdx];
			if (!odds || odds < 1.01) continue;
			const ns = ps + slotScore(s, odds);
			if (top.length === MAX_STORED && ns >= top[top.length - 1].score) continue;
			used[s] = true; current.push(s);
			recurse(m, slotIdx + 1, current, used, ns);
			current.pop(); used[s] = false;
		}
	}
	for (let m = 0; m < matches.length; m++) recurse(m, 0, [], new Array(N).fill(false), 0);
	return top;
}

function generateCombinationsP2() {
	const top = [];
	const N = bookies.length;
	const M = matches.length;
	function recurse(m1, m2, slotIdx, current, used, ps) {
		if (top.length === MAX_STORED && ps >= top[top.length - 1].score) return;
		if (slotIdx === 9) { insertTop(top, { matchIndices: [m1, m2], combo: [...current], score: ps }); return; }
		const [i, j] = SLOTS_P2[slotIdx];
		for (let s = 0; s < N; s++) {
			if (used[s]) continue;
			const o1 = oddsGrid[s][m1][i], o2 = oddsGrid[s][m2][j];
			if (!o1 || o1 < 1.01 || !o2 || o2 < 1.01) continue;
			const ns = ps + slotScore(s, o1 * o2);
			if (top.length === MAX_STORED && ns >= top[top.length - 1].score) continue;
			used[s] = true; current.push(s);
			recurse(m1, m2, slotIdx + 1, current, used, ns);
			current.pop(); used[s] = false;
		}
	}
	for (let m1 = 0; m1 < M - 1; m1++)
		for (let m2 = m1 + 1; m2 < M; m2++)
			recurse(m1, m2, 0, [], new Array(N).fill(false), 0);
	return top;
}

function computeStakes(active) {
	const n = active.length;

	const effectiveConv = active.map(b => {
		if (b.bonus === 'no_bonus') return 0;
		if (b.bonus === 'cash_lose' || b.bonus === 'cash_always') return 1;
		return b.convRate / 100;
	});

	let capped = active.map(() => false);
	let stakes = null;

	for (let iter = 0; iter < 20; iter++) {
		const winCoef = active.map((b, j) => {
			if (b.bonus === 'no_bonus' || b.bonus === 'freebet_lose' || b.bonus === 'cash_lose') return b.odds - 1;
			return capped[j] ? (b.odds - 1) : (b.odds - 1 + effectiveConv[j]);
		});
		const winConst = active.map((b, j) => {
			if ((b.bonus === 'freebet_always' || b.bonus === 'cash_always') && capped[j]) return effectiveConv[j] * b.maxBonus;
			return 0;
		});
		const loseCoef = active.map((b, j) => {
			if (b.bonus === 'no_bonus') return -1;
			return capped[j] ? -1 : -(1 - effectiveConv[j]);
		});
		const loseConst = active.map((b, j) => {
			if (b.bonus === 'no_bonus') return 0;
			return capped[j] ? effectiveConv[j] * b.maxBonus : 0;
		});

		const eff = active.map((_, j) => winCoef[j] - loseCoef[j]);
		const C   = active.map((_, j) => winConst[j] - loseConst[j]);

		if (active.some((_, j) => Math.abs(eff[j]) < 1e-9)) return null;

		let s0 = active[0].min || 1;
		for (let k = 1; k < n; k++) {
			const needed = (eff[k] * (active[k].min || 0) - C[0] + C[k]) / eff[0];
			if (needed > s0) s0 = needed;
		}
		if (s0 < (active[0].min || 0)) s0 = active[0].min || 0;

		const candidate = active.map((_, j) => j === 0 ? s0 : (eff[0] * s0 + C[0] - C[j]) / eff[j]);

		if (candidate.some(s => s < -0.01)) return null;

		let changed = false;
		active.forEach((b, j) => {
			if (b.bonus === 'no_bonus' || b.maxBonus <= 0) return;
			const shouldCap = candidate[j] > b.maxBonus + 0.01;
			if (shouldCap !== capped[j]) { capped[j] = shouldCap; changed = true; }
		});

		stakes = candidate;
		if (!changed) break;
	}

	if (!stakes) return null;

	const bonusAmount = (b, s, bIdx) => {
		if (b.bonus === 'no_bonus') return 0;
		return effectiveConv[bIdx] * Math.min(s, b.maxBonus > 0 ? b.maxBonus : s);
	};

	const gains = active.map((_, outcomeIdx) => {
		let g = 0;
		active.forEach((bk, j) => {
			const s = stakes[j];
			if (j === outcomeIdx) {
				g += (bk.odds - 1) * s;
				if (bk.bonus === 'freebet_always' || bk.bonus === 'cash_always') g += bonusAmount(bk, s, j);
			} else {
				g += -s + bonusAmount(bk, s, j);
			}
		});
		return g;
	});

	const totalStaked = stakes.reduce((a, b) => a + b, 0);
	const avgGain     = gains.reduce((a, b) => a + b, 0) / gains.length;
	const roi         = totalStaked > 0 ? (avgGain / totalStaked) * 100 : 0;

	return { stakes, gains, avgGain, totalStaked, roi, effectiveConv, capped, bonusAmount };
}

function calculate() {
	if (bookies.length < 3 || matches.length === 0) return;
	const rawCombos = parlaySize === 1 ? generateCombinationsP1() : generateCombinationsP2();
	if (rawCombos.length === 0) {
		showError(parlaySize === 1
			? 'Aucune combinaison valide. Il faut au moins 3 sites avec des cotes 1/N/2 sur le même match.'
			: 'Aucune combinaison valide. Pour un combiné 2 matchs, il faut au moins 9 couples (site, match) couvrant les 9 issues.'
		);
		return;
	}
	const results = [];
	rawCombos.forEach(({ matchIndices, combo }) => {
		let active;
		if (parlaySize === 1) {
			const m = matchIndices[0];
			active = combo.map((siteIdx, outcomeIdx) => ({
				...bookies[siteIdx],
				odds: oddsGrid[siteIdx][m][outcomeIdx],
				outcome: OUTCOMES[outcomeIdx],
				matchLabel: matches[m].name,
				siteIdx,
			}));
		} else {
			const [m1, m2] = matchIndices;
			active = combo.map((siteIdx, slotIdx) => {
				const [i, j] = SLOTS_P2[slotIdx];
				return {
					...bookies[siteIdx],
					odds: oddsGrid[siteIdx][m1][i] * oddsGrid[siteIdx][m2][j],
					outcome: `${OUTCOMES[i]}×${OUTCOMES[j]}`,
					matchLabel: `${matches[m1].name} + ${matches[m2].name}`,
					siteIdx,
				};
			});
		}
		const result = computeStakes(active);
		if (result) results.push({ matchIndices, combo, active, ...result });
	});
	if (results.length === 0) {
		showError("Impossible d'équilibrer les mises pour ces paramètres. Vérifiez les bonus.");
		return;
	}
	results.sort((a, b) => b.avgGain - a.avgGain);
	_comboResults = { results };
	_selectedComboIdx = 0;
	renderCombinationsList(20);
	document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- Affichage des combinaisons (identique à welcome-bonus) ----

function buildCombosHTML(results, showCount) {
	const displayed = results.slice(0, showCount);
	const remaining = results.length - showCount;
	return `
		<div class="combos-list">
			<div class="combos-list-header">
				<span>${results.length} combinaison${results.length > 1 ? 's' : ''} trouvée${results.length > 1 ? 's' : ''}</span>
				<span class="combos-list-hint">Cliquer pour afficher le détail</span>
			</div>
			${displayed.map((r, idx) => {
				const matchLabel = r.matchIndices.map(mi => matches[mi].name).join(' + ');
				let assignment;
				if (parlaySize === 1) {
					assignment = r.combo.map((siteIdx, outcomeIdx) =>
						`<span class="combo-site" style="color:${ACCENT_COLORS[siteIdx % ACCENT_COLORS.length]}">${escHtml(bookies[siteIdx].name)}</span><span class="combo-outcome-tag">${OUTCOMES[outcomeIdx]}</span>`
					).join('<span class="combo-sep">·</span>');
				} else {
					assignment = r.combo.slice(0, 3).map((siteIdx, k) => {
						const [i, j] = SLOTS_P2[k];
						return `<span class="combo-site" style="color:${ACCENT_COLORS[siteIdx % ACCENT_COLORS.length]}">${escHtml(bookies[siteIdx].name)}</span><span class="combo-outcome-tag">${OUTCOMES[i]}×${OUTCOMES[j]}</span>`;
					}).join('<span class="combo-sep">·</span>') + '<span class="combo-sep">…</span>';
				}
				return `
					<div class="combo-row" onclick="selectCombo(${idx})">
						<span class="combo-rank">#${idx + 1}</span>
						<span class="combo-match-label">${escHtml(matchLabel)}</span>
						<span class="combo-assignment">${assignment}</span>
						<span class="combo-gain ${r.avgGain >= 0 ? 'pos' : 'neg'}">${fmt(r.avgGain)} €</span>
						<span class="combo-roi ${r.roi >= 0 ? 'pos' : 'neg'}">${fmt(r.roi, 1)} %</span>
					</div>
				`;
			}).join('')}
			${remaining > 0 ? `
				<div class="combos-more-row">
					<button class="btn btn-ghost combos-more-btn" onclick="renderCombinationsList(${results.length})">
						Voir les ${remaining} autre${remaining > 1 ? 's' : ''} combinaison${remaining > 1 ? 's' : ''}
					</button>
				</div>
			` : ''}
		</div>
	`;
}

function renderCombinationsList(showCount) {
	_currentShowCount = showCount;
	const { results } = _comboResults;

	document.getElementById('results').style.display = 'flex';
	document.getElementById('error-container').innerHTML = '';
	document.getElementById('results-tabs-wrapper').hidden = false;
	switchTab('combos');

	document.getElementById('combos-container').innerHTML = buildCombosHTML(results, showCount);
	document.getElementById('gain-banner').innerHTML = '';
	document.getElementById('stakes-grid').innerHTML = '';
	document.getElementById('breakdown-container').innerHTML = '';

	selectCombo(Math.min(_selectedComboIdx, results.slice(0, showCount).length - 1), false);
}

function selectCombo(idx, navigate = true) {
	_selectedComboIdx = idx;
	document.querySelectorAll('.combo-row').forEach((el, i) => {
		el.classList.toggle('combo-row--active', i === idx);
	});
	const { results } = _comboResults;
	showResults({ active: results[idx].active, ...results[idx] });
	if (navigate) switchTab('result');
}

function switchTab(name) {
	document.querySelectorAll('.results-tab').forEach(btn => {
		btn.classList.toggle('results-tab--active', btn.textContent.trim() === (name === 'combos' ? 'Combinaisons' : 'Résultat'));
	});
	document.getElementById('tab-combos').hidden = (name !== 'combos');
	document.getElementById('tab-result').hidden  = (name !== 'result');
}

function resetResults() {
	_comboResults = null;
	_selectedComboIdx = 0;
	document.getElementById('results').style.display = 'none';
	document.getElementById('error-container').innerHTML = '';
}

function showError(msg) {
	document.getElementById('results').style.display = 'flex';
	document.getElementById('results-tabs-wrapper').hidden = true;
	document.getElementById('error-container').innerHTML = `<div class="error-box">⚠ ${escHtml(msg)}</div>`;
}

function showResults({ active, stakes, avgGain, totalStaked, roi, capped, bonusAmount, matchIndices }) {
	const matchLabel = matchIndices ? matchIndices.map(mi => matches[mi].name).join(' + ') : (active[0]?.matchLabel || '');
	document.getElementById('gain-banner').innerHTML = `
		${matchLabel ? '<div class="result-match-label">' + escHtml(matchLabel) + '</div>' : ''}
		<div class="metrics-grid">
			<div class="metric-card">
				<div class="metric-label">Total misé</div>
				<div class="metric-value">${fmt(totalStaked)} €</div>
			</div>
			<div class="metric-card">
				<div class="metric-label">Gain net</div>
				<div class="metric-value ${avgGain >= 0 ? 'pos' : 'neg'}">${fmt(avgGain)} €</div>
			</div>
			<div class="metric-card">
				<div class="metric-label">Total garanti</div>
				<div class="metric-value pos">${fmt(totalStaked + avgGain)} €</div>
			</div>
			<div class="metric-card">
				<div class="metric-label">ROI</div>
				<div class="metric-value ${roi >= 0 ? 'pos' : 'neg'}">${fmt(roi, 1)} %</div>
			</div>
		</div>
	`;

	document.getElementById('stakes-grid').innerHTML = active.map((b, i) => {
		const color   = ACCENT_COLORS[b.siteIdx % ACCENT_COLORS.length];
		const capNote = capped[i] ? `<div class="stake-cap">⚠ Bonus plafonné à ${fmt(b.maxBonus)} €</div>` : '';
		return `
			<div class="stake-card" style="border-left-color:${color}">
				<div class="stake-bookie" style="color:${color}">${escHtml(b.name)}</div>
				<div class="stake-name">${b.outcome}</div>
				<div class="stake-amount">${fmt(stakes[i])} €</div>
				<div class="stake-outcome">@ cote ${fmt(b.odds, 2)}</div>
				${capNote}
			</div>
		`;
	}).join('');

	const isCashBonus = bonus => bonus === 'cash_lose' || bonus === 'cash_always';

	const tableHTML = `
		<div class="breakdown">
			<table class="breakdown-table">
				<thead>
					<tr>
						<th>Site / Bookmaker</th>
						${active.map(b => `
							<th>
								<div class="th-outcome-title">${b.outcome}</div>
								<div class="th-outcome-sub">${escHtml(b.name)} gagne @ ${fmt(b.odds)}</div>
							</th>
						`).join('')}
					</tr>
				</thead>
				<tbody>
					${active.map((site, siteIdx) => {
						const s        = stakes[siteIdx];
						const bonusRaw = site.bonus === 'no_bonus' ? 0 : Math.min(s, site.maxBonus > 0 ? site.maxBonus : s);
						const bonusCash = bonusAmount(site, s, siteIdx);
						const isCash   = isCashBonus(site.bonus);
						return `
							<tr>
								<td>
									<div class="site-name">${escHtml(site.name)}</div>
									<div class="site-meta">Mise : ${fmt(s)} €${capped[siteIdx] ? ' ⚠' : ''}</div>
								</td>
								${active.map((_, outcomeIdx) => {
									const wins = siteIdx === outcomeIdx;
									if (wins) {
										const cashProfit     = (site.odds - 1) * s;
										const hasAlwaysBonus = site.bonus === 'freebet_always' || site.bonus === 'cash_always';
										const bonusIfWin     = hasAlwaysBonus ? bonusCash : 0;
										const total          = cashProfit + bonusIfWin;
										if (isCash) return `
											<td class="td-outcome win">
												<div class="detail-line"><span class="detail-lbl">Cash</span><span class="detail-val pos">+${fmt(cashProfit)} €</span></div>
												<div class="detail-line"><span class="detail-lbl">Bonus cash</span><span class="detail-val ${bonusIfWin > 0 ? 'neut' : 'text-muted'}">+${fmt(bonusIfWin)} €</span></div>
												<div class="detail-line total-line"><span class="detail-lbl">Total</span><span class="detail-val pos strong">+${fmt(total)} €</span></div>
											</td>`;
										const fbRaw = hasAlwaysBonus ? bonusRaw : 0;
										return `
											<td class="td-outcome win">
												<div class="detail-line"><span class="detail-lbl">Cash</span><span class="detail-val pos">+${fmt(cashProfit)} €</span></div>
												<div class="detail-line"><span class="detail-lbl">Freebet brut</span><span class="detail-val ${fbRaw > 0 ? 'neut' : 'text-muted'}">+${fmt(fbRaw)} €</span></div>
												<div class="detail-line"><span class="detail-lbl">Freebet @${site.convRate}%</span><span class="detail-val ${bonusIfWin > 0 ? 'neut' : 'text-muted'}">+${fmt(bonusIfWin)} €</span></div>
												<div class="detail-line total-line"><span class="detail-lbl">Total</span><span class="detail-val pos strong">+${fmt(total)} €</span></div>
											</td>`;
									} else {
										const cashLoss = -s;
										const total    = cashLoss + bonusCash;
										if (isCash) return `
											<td class="td-outcome lose">
												<div class="detail-line"><span class="detail-lbl">Cash</span><span class="detail-val neg">${fmt(cashLoss)} €</span></div>
												<div class="detail-line"><span class="detail-lbl">Bonus cash</span><span class="detail-val ${bonusCash > 0 ? 'neut' : 'text-muted'}">+${fmt(bonusCash)} €</span></div>
												<div class="detail-line total-line"><span class="detail-lbl">Total</span><span class="detail-val ${total >= 0 ? 'neut' : 'neg'} strong">${fmt(total)} €</span></div>
											</td>`;
										return `
											<td class="td-outcome lose">
												<div class="detail-line"><span class="detail-lbl">Cash</span><span class="detail-val neg">${fmt(cashLoss)} €</span></div>
												<div class="detail-line"><span class="detail-lbl">Freebet brut</span><span class="detail-val ${bonusRaw > 0 ? 'neut' : 'text-muted'}">+${fmt(bonusRaw)} €</span></div>
												<div class="detail-line"><span class="detail-lbl">Freebet @${site.convRate}%</span><span class="detail-val ${bonusCash > 0 ? 'neut' : 'text-muted'}">+${fmt(bonusCash)} €</span></div>
												<div class="detail-line total-line"><span class="detail-lbl">Total</span><span class="detail-val ${total >= 0 ? 'neut' : 'neg'} strong">${fmt(total)} €</span></div>
											</td>`;
									}
								}).join('')}
							</tr>
						`;
					}).join('')}

					<tr class="total-row">
						<td><div class="total-label"><div class="site-name">Total</div></div></td>
						${active.map((_, outcomeIdx) => {
							let totalCash = 0, totalFbRaw = 0, totalFbConv = 0, totalCashBonus = 0;
							let hasCash = false, hasFb = false;
							active.forEach((site, siteIdx) => {
								const s        = stakes[siteIdx];
								const bonusRaw = site.bonus === 'no_bonus' ? 0 : Math.min(s, site.maxBonus > 0 ? site.maxBonus : s);
								const bCash    = bonusAmount(site, s, siteIdx);
								const wins     = siteIdx === outcomeIdx;
								const isCash   = isCashBonus(site.bonus);
								if (isCash && site.bonus !== 'no_bonus') hasCash = true;
								if (!isCash && site.bonus !== 'no_bonus') hasFb = true;
								if (wins) {
									totalCash += (site.odds - 1) * s;
									if (site.bonus === 'freebet_always' || site.bonus === 'cash_always') {
										if (isCash) totalCashBonus += bCash;
										else { totalFbRaw += bonusRaw; totalFbConv += bCash; }
									}
								} else {
									totalCash += -s;
									if (isCash) totalCashBonus += bCash;
									else { totalFbRaw += bonusRaw; totalFbConv += bCash; }
								}
							});
							const total = totalCash + totalFbConv + totalCashBonus;
							let lines = `<div class="detail-line"><span class="detail-lbl">Cash</span><span class="detail-val ${totalCash >= 0 ? 'pos' : 'neg'} strong">${fmt(totalCash)} €</span></div>`;
							if (hasFb) {
								lines += `<div class="detail-line"><span class="detail-lbl">Freebet brut</span><span class="detail-val ${totalFbRaw > 0 ? 'neut' : 'text-muted'} strong">+${fmt(totalFbRaw)} €</span></div>`;
								lines += `<div class="detail-line"><span class="detail-lbl">Freebet converti</span><span class="detail-val ${totalFbConv > 0 ? 'neut' : 'text-muted'} strong">+${fmt(totalFbConv)} €</span></div>`;
							}
							if (hasCash) {
								lines += `<div class="detail-line"><span class="detail-lbl">Cash bonus</span><span class="detail-val ${totalCashBonus > 0 ? 'neut' : 'text-muted'} strong">+${fmt(totalCashBonus)} €</span></div>`;
							}
							lines += `<div class="detail-line total-line"><span class="detail-lbl">Total</span><span class="detail-val ${total >= 0 ? 'pos' : 'neg'} strong">${fmt(total)} €</span></div>`;
							return `<td class="td-outcome">${lines}</td>`;
						}).join('')}
					</tr>
				</tbody>
			</table>
		</div>
		${capped.some(Boolean) ? `<p class="tip">⚠ = bonus plafonné au maximum du site</p>` : ''}
	`;

	document.getElementById('breakdown-container').innerHTML = tableHTML;
}

// ---- Démarrage ----

loadSitesInfo().then(() => {
	updateCalcBtn();
});
