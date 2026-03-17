'use strict';

let _data = null;
let _opps = [];
let _legs = 1;
let _rateCache = null;
let _mode = 'freebet'; // 'freebet' | 'cash'

// ---- Helpers ----

function isExchange(val) {
	return val !== null && typeof val === 'object' && !Array.isArray(val) && ('Back' in val || 'Lay' in val);
}

function getBackOdds(val) {
	if (typeof val === 'number') return val;
	if (isExchange(val)) return val.Back?.odds_net ?? val.Back?.odds ?? null;
	return null;
}

function getLayOddsNet(val) {
	if (!isExchange(val)) return null;
	return val.Lay?.odds_net ?? null;
}

function collectSites(data) {
	const sites = new Set();
	for (const event of Object.values(data)) {
		for (const market of Object.values(event.markets || {})) {
			for (const oddsMap of Object.values(market)) {
				if (oddsMap && typeof oddsMap === 'object' && !Array.isArray(oddsMap)) {
					for (const site of Object.keys(oddsMap)) sites.add(site);
				}
			}
		}
	}
	return [...sites].sort();
}

function findDcMarket(markets) {
	for (const [name, market] of Object.entries(markets)) {
		if (/double.?chance|chance\s+double/i.test(name)) return [name, market];
	}
	return null;
}

function norm(s) {
	return s.toLowerCase().trim().replace(/[:.;,!?]+$/, '');
}

function findCoveringDcOutcome(dcMarket, backedOutcome) {
	const backed = norm(backedOutcome);
	for (const outcomeName of Object.keys(dcMarket)) {
		const parts = outcomeName.toLowerCase().split(/\s+ou\s+|\s*\/\s*/).map(norm);
		const containsBacked = parts.some(p => p === backed || p.includes(backed) || backed.includes(p));
		if (!containsBacked) return outcomeName;
	}
	return null;
}

function eventDisplayName(eventKey, event) {
	if (event.opponents?.length >= 2) return event.opponents.join(' vs ');
	const m = eventKey.match(/^[^_]+_(.+?)_\d{4}-\d{2}-\d{2}/);
	if (m) return m[1];
	return eventKey;
}

function formatDate(dt) {
	if (!dt) return '';
	try {
		const d = new Date(dt);
		return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
			+ ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	} catch { return ''; }
}

// ---- Calcul des opportunités ----

function computeOpportunities(data, freebetSite, amount) {
	const results = [];
	const isFb = _mode === 'freebet';

	for (const [eventKey, event] of Object.entries(data)) {
		const evName = eventDisplayName(eventKey, event);
		const evDate = formatDate(event.dateTime);
		const evComp = event.competition || event.tournoi || '';
		const dcEntry = findDcMarket(event.markets || {});

		for (const [marketName, market] of Object.entries(event.markets || {})) {
			for (const [outcomeName, oddsMap] of Object.entries(market)) {
				if (!oddsMap || typeof oddsMap !== 'object' || Array.isArray(oddsMap)) continue;

				const fbVal = oddsMap[freebetSite];
				if (fbVal == null) continue;

				const b = getBackOdds(fbVal);
				if (!b || b <= 1) continue;

				// — Couverture Lay (exchange) —
				for (const [site, val] of Object.entries(oddsMap)) {
					if (site === freebetSite) continue;
					const lNet = getLayOddsNet(val);
					if (!lNet || lNet <= 1) continue;
					const lGross = val.Lay?.odds ?? null;
					const c = (lGross != null && lGross > 1) ? 1 - (lNet - 1) / (lGross - 1) : 0;
					const denom = lGross != null ? lGross - c : lNet;
					let stake, profit;
					if (isFb) {
						stake = amount * (b - 1) / denom;
						profit = stake * (1 - c);
					} else {
						// Cash : L = S*b/(lGross-c), résultat = L*(1-c) - S
						stake = amount * b / denom;
						profit = stake * (1 - c) - amount;
					}
					const liability = lGross != null ? stake * (lGross - 1) : null;
					const rate = profit / amount;
					results.push({ evName, evDate, evComp, marketName, outcomeName, b, coverSite: site, coverType: 'lay', coverOdds: lNet, lGross, liability, coverOutcome: outcomeName, stake, profit, rate });
				}

				// — Couverture Double Chance (bookmakers classiques) —
				if (dcEntry) {
					const [, dcMarket] = dcEntry;
					const dcOutcomeName = findCoveringDcOutcome(dcMarket, outcomeName);
					if (dcOutcomeName) {
						const dcOddsMap = dcMarket[dcOutcomeName];
						if (dcOddsMap && typeof dcOddsMap === 'object') {
							for (const [site, val] of Object.entries(dcOddsMap)) {
								if (site === freebetSite) continue;
								if (isExchange(val)) continue;
								if (typeof val !== 'number' || val <= 1) continue;
								let stake, profit;
								if (isFb) {
									stake = amount * (b - 1) / val;
									profit = stake * (val - 1);
								} else {
									// Cash : L = S*b/dc, résultat = L*(dc-1) - S
									stake = amount * b / val;
									profit = stake * (val - 1) - amount;
								}
								const rate = profit / amount;
								results.push({ evName, evDate, evComp, marketName, outcomeName, b, coverSite: site, coverType: 'dc', coverOdds: val, lGross: null, liability: null, coverOutcome: dcOutcomeName, stake, profit, rate });
							}
						}
					}
				}
			}
		}
	}

	return results.sort((a, b) => b.rate - a.rate);
}

// ---- Rendu ----

function rateClass(rate) {
	if (_mode === 'cash') {
		if (rate >= -0.02) return 'fc-rate-good';
		if (rate >= -0.05) return 'fc-rate-ok';
		return 'fc-rate-bad';
	}
	if (rate >= 0.75) return 'fc-rate-good';
	if (rate >= 0.60) return 'fc-rate-ok';
	return 'fc-rate-bad';
}

function fmt(n, d = 2) {
	return n.toFixed(d).replace('.', ',');
}

function esc(s) {
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildRow(op) {
	const coverOddsCell = op.coverType === 'lay' && op.lGross != null
		? `<span class="fc-cell-main">${fmt(op.coverOdds)}</span><span class="fc-cell-sub">brut : ${fmt(op.lGross)}</span>`
		: `<span class="fc-cell-main">${fmt(op.coverOdds)}</span>`;

	const stakeCell = op.coverType === 'lay' && op.liability != null
		? `<span class="fc-cell-main">${fmt(op.stake)} €</span><span class="fc-cell-sub">liab. : ${fmt(op.liability)} €</span>`
		: `<span class="fc-cell-main">${fmt(op.stake)} €</span>`;

	const profitClass = op.profit >= 0 ? 'pos' : 'neg';

	return `
		<div class="fc-row">
			<div class="fc-cell">
				<div class="fc-event-wrap">
					<span class="fc-event-name">${esc(op.evName)}</span>
					<span class="fc-event-meta">${esc([op.evComp, op.evDate].filter(Boolean).join(' · '))}</span>
				</div>
			</div>
			<div class="fc-cell fc-cell-muted">${esc(op.marketName)}</div>
			<div class="fc-cell fc-cell-strong">${esc(op.outcomeName)}</div>
			<div class="fc-cell fc-cell-mono">${fmt(op.b)}</div>
			<div class="fc-cell">
				<div class="fc-cover-wrap">
					<div class="fc-cover-top">
						<span class="fc-cover-site">${esc(op.coverSite)}</span>
						<span class="fc-badge fc-badge-${op.coverType}">${op.coverType === 'lay' ? 'Lay' : 'DC'}</span>
					</div>
					${op.coverType === 'dc' ? `<span class="fc-cover-outcome">${esc(op.coverOutcome)}</span>` : ''}
				</div>
			</div>
			<div class="fc-cell fc-cell-mono fc-cell-stack">${coverOddsCell}</div>
			<div class="fc-cell fc-cell-mono fc-cell-stack">${stakeCell}</div>
			<div class="fc-cell fc-cell-mono fc-cell-profit ${profitClass}">${fmt(op.profit)} €</div>
			<div class="fc-cell ${rateClass(op.rate)}">${fmt(op.rate * 100, 1)} %</div>
		</div>
	`;
}

function renderTable(query) {
	const grid = document.getElementById('fc-grid');
	if (!grid) return;

	const q = query.trim().toLowerCase();
	const filtered = q
		? _opps.filter(op => op.evName.toLowerCase().includes(q) || op.evComp.toLowerCase().includes(q))
		: _opps.slice(0, 10);

	const resultHeader = _mode === 'cash' ? 'Résultat' : 'Profit';

	if (!filtered.length) {
		grid.innerHTML = `
			<div class="fc-results-grid">
				<div class="fc-th">Événement</div>
				<div class="fc-th">Marché</div>
				<div class="fc-th">Issue</div>
				<div class="fc-th">Cote back</div>
				<div class="fc-th">Couverture</div>
				<div class="fc-th">Cote couv.</div>
				<div class="fc-th">Mise couv.</div>
				<div class="fc-th">${resultHeader}</div>
				<div class="fc-th">Taux</div>
			</div>
			<p class="fc-empty text-muted">Aucun match correspondant.</p>
		`;
		return;
	}

	const label = q
		? `${filtered.length} résultat${filtered.length > 1 ? 's' : ''}`
		: `Top 10 sur ${_opps.length} couverture${_opps.length > 1 ? 's' : ''}`;

	grid.innerHTML = `
		<p class="fc-grid-label">${label}</p>
		<div class="fc-results-grid">
			<div class="fc-th">Événement</div>
			<div class="fc-th">Marché</div>
			<div class="fc-th">Issue</div>
			<div class="fc-th">Cote back</div>
			<div class="fc-th">Couverture</div>
			<div class="fc-th">Cote couv.</div>
			<div class="fc-th">Mise couv.</div>
			<div class="fc-th">${resultHeader}</div>
			<div class="fc-th">Taux</div>
			${filtered.map(buildRow).join('')}
		</div>
	`;
}

function onSearch() {
	const q = document.getElementById('fc-search')?.value ?? '';
	if (_legs === 1) renderTable(q);
	else renderCombinedTable(q);
}

function renderResults(opps) {
	_opps = opps;
	const el = document.getElementById('fc-results');
	el.hidden = false;

	if (!opps.length) {
		el.innerHTML = `<p class="fc-empty text-muted">Aucune couverture trouvée pour ce site.</p>`;
		return;
	}

	const bestRate = opps[0].rate;
	const summaryLabel = _mode === 'cash'
		? `${opps.length} couverture${opps.length > 1 ? 's' : ''} — meilleur taux de perte\u00a0: <strong>${fmt(bestRate * 100, 1)}\u00a0%</strong>`
		: `${opps.length} opportunité${opps.length > 1 ? 's' : ''} — meilleur taux\u00a0: <strong>${fmt(bestRate * 100, 1)}\u00a0%</strong>`;

	el.innerHTML = `
		<p class="fc-summary">${summaryLabel}</p>
		<div id="fc-grid"></div>
		<div class="fc-search-row">
			<svg class="fc-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
			<input type="text" id="fc-search" class="fc-search-input" placeholder="Rechercher un match…" oninput="onSearch()" />
		</div>
	`;
	renderTable('');
}

// ---- Gestionnaires d'événements ----

function setMode(mode) {
	_mode = mode;
	_rateCache = null;
	document.querySelectorAll('.fc-mode-btn').forEach(btn => {
		btn.classList.toggle('fc-legs-btn--active', btn.dataset.mode === mode);
	});
	const label = document.getElementById('fc-amount-label');
	if (label) label.textContent = mode === 'freebet' ? 'Montant freebet' : 'Mise cash';
	if (mode === 'cash') {
		_legs = 1;
		const legsRow = document.getElementById('fc-legs-row');
		if (legsRow) legsRow.hidden = true;
	}
	tryRender();
}

function onJsonChange() {
	const raw = document.getElementById('fc-json').value.trim();
	const errEl = document.getElementById('fc-json-error');
	document.getElementById('fc-results').hidden = true;
	const legsRow = document.getElementById('fc-legs-row');
	if (legsRow) legsRow.hidden = true;
	_rateCache = null;

	if (!raw) {
		_data = null;
		errEl.hidden = true;
		updateSiteSelect([]);
		return;
	}

	try {
		_data = JSON.parse(raw);
		errEl.hidden = true;
		updateSiteSelect(collectSites(_data));
		tryRender();
	} catch (e) {
		_data = null;
		errEl.textContent = 'JSON invalide : ' + e.message;
		errEl.hidden = false;
		updateSiteSelect([]);
	}
}

function updateSiteSelect(sites) {
	const field = document.getElementById('fc-site-field');
	const sel = document.getElementById('fc-site-select');
	if (!sites.length) {
		field.hidden = true;
		sel.innerHTML = '<option value="">— Sélectionner un site —</option>';
		return;
	}
	sel.innerHTML = '<option value="">— Sélectionner un site —</option>'
		+ sites.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
	field.hidden = false;
}

function setLegs(n) {
	_legs = n;
	tryRender();
}

function updateLegsButtons(data, site, amount) {
	const legsRow = document.getElementById('fc-legs-row');
	if (_mode === 'cash') {
		if (legsRow) legsRow.hidden = true;
		return;
	}
	if (legsRow) legsRow.hidden = false;

	if (!_rateCache || _rateCache.data !== data || _rateCache.site !== site || _rateCache.amount !== amount) {
		_rateCache = {
			data, site, amount,
			rates: [1, 2, 3].map(n => {
				const opps = n === 1
					? computeOpportunities(data, site, amount)
					: computeCombinedOpportunities(data, site, amount, n);
				return opps.length ? opps[0].rate : null;
			}),
		};
	}

	const labels = ['1', '2 comb.', '3 comb.'];
	document.querySelectorAll('.fc-legs-btn:not(.fc-mode-btn)').forEach((btn, i) => {
		const rate = _rateCache.rates[i];
		const rateHtml = rate != null
			? `<span class="fc-btn-rate">${fmt(rate * 100, 1)} %</span>`
			: '';
		btn.innerHTML = `<span>${labels[i]}</span>${rateHtml}`;
		btn.classList.toggle('fc-legs-btn--active', i + 1 === _legs);
	});
}

function tryRender() {
	if (!_data) return;
	const site = document.getElementById('fc-site-select').value;
	if (!site) return;
	const amount = parseFloat(document.getElementById('fc-amount').value) || 10;
	updateLegsButtons(_data, site, amount);
	if (_mode === 'cash' || _legs === 1) {
		renderResults(computeOpportunities(_data, site, amount));
	} else {
		renderCombinedResults(computeCombinedOpportunities(_data, site, amount, _legs));
	}
}

async function pasteFromClipboard() {
	try {
		const text = await navigator.clipboard.readText();
		document.getElementById('fc-json').value = text;
		onJsonChange();
	} catch {
		document.getElementById('fc-json').focus();
	}
}

function stepAmount(delta) {
	const input = document.getElementById('fc-amount');
	const val = Math.max(1, (parseFloat(input.value) || 0) + delta);
	input.value = val;
	tryRender();
}

document.addEventListener('DOMContentLoaded', () => {
	document.getElementById('fc-site-select').addEventListener('change', tryRender);

	const param = new URLSearchParams(location.search).get('data');
	if (param) {
		try {
			const json = decodeURIComponent(atob(param));
			document.getElementById('fc-json').value = json;
			onJsonChange();
		} catch {
			// param malformé, on ignore
		}
	}
});

// ---- Combinés (freebet uniquement) ----

const MIN_GAP_MS = 90 * 60 * 1000;

function collectLaySingles(data, freebetSite) {
	const singles = [];
	for (const [eventKey, event] of Object.entries(data)) {
		const evName = eventDisplayName(eventKey, event);
		const evDate = formatDate(event.dateTime);
		const evComp = event.competition || event.tournoi || '';
		const dateTime = event.dateTime ? new Date(event.dateTime).getTime() : null;

		for (const [marketName, market] of Object.entries(event.markets || {})) {
			for (const [outcomeName, oddsMap] of Object.entries(market)) {
				if (!oddsMap || typeof oddsMap !== 'object' || Array.isArray(oddsMap)) continue;

				const fbVal = oddsMap[freebetSite];
				if (fbVal == null) continue;
				const b = getBackOdds(fbVal);
				if (!b || b <= 1) continue;

				for (const [site, val] of Object.entries(oddsMap)) {
					if (site === freebetSite) continue;
					const lNet = getLayOddsNet(val);
					if (!lNet || lNet <= 1) continue;
					const lGross = val.Lay?.odds ?? null;
					const c = (lGross != null && lGross > 1) ? 1 - (lNet - 1) / (lGross - 1) : 0;
					const k = (lGross != null && lGross > 1) ? (lGross - c) / (1 - c) : lNet;
					singles.push({ eventKey, evName, evDate, evComp, dateTime, marketName, outcomeName, b, coverSite: site, lNet, lGross, c, k });
				}
			}
		}
	}
	return singles;
}

function computeCombinedOpportunities(data, freebetSite, amount, nLegs) {
	const singles = collectLaySingles(data, freebetSite);
	const results = [];

	if (nLegs === 2) {
		for (let i = 0; i < singles.length; i++) {
			const s1 = singles[i];
			if (s1.dateTime == null) continue;
			for (let j = 0; j < singles.length; j++) {
				if (i === j) continue;
				const s2 = singles[j];
				if (s2.eventKey === s1.eventKey) continue;
				if (s2.dateTime == null || s2.dateTime <= s1.dateTime) continue;
				if (s2.dateTime - s1.dateTime < MIN_GAP_MS) continue;

				const B = s1.b * s2.b;
				const profit = amount * (B - 1) / (s1.k * s2.k);
				const rate = profit / amount;
				const L1 = profit / (1 - s1.c);
				const L2 = profit * s1.k / (1 - s2.c);

				results.push({
					B, profit, rate,
					gaps: [s2.dateTime - s1.dateTime],
					legs: [
						{ ...s1, stake: L1, liability: L1 * ((s1.lGross ?? s1.lNet) - 1) },
						{ ...s2, b: null, stake: L2, liability: L2 * ((s2.lGross ?? s2.lNet) - 1) },
					],
				});
			}
		}
	} else if (nLegs === 3) {
		for (let i = 0; i < singles.length; i++) {
			const s1 = singles[i];
			if (s1.dateTime == null) continue;
			for (let j = 0; j < singles.length; j++) {
				if (i === j) continue;
				const s2 = singles[j];
				if (s2.eventKey === s1.eventKey) continue;
				if (s2.dateTime == null || s2.dateTime <= s1.dateTime) continue;
				if (s2.dateTime - s1.dateTime < MIN_GAP_MS) continue;
				for (let m = 0; m < singles.length; m++) {
					if (m === i || m === j) continue;
					const s3 = singles[m];
					if (s3.eventKey === s1.eventKey || s3.eventKey === s2.eventKey) continue;
					if (s3.dateTime == null || s3.dateTime <= s2.dateTime) continue;
					if (s3.dateTime - s2.dateTime < MIN_GAP_MS) continue;

					const B = s1.b * s2.b * s3.b;
					const profit = amount * (B - 1) / (s1.k * s2.k * s3.k);
					const rate = profit / amount;
					const L1 = profit / (1 - s1.c);
					const L2 = profit * s1.k / (1 - s2.c);
					const L3 = profit * s1.k * s2.k / (1 - s3.c);

					results.push({
						B, profit, rate,
						gaps: [s2.dateTime - s1.dateTime, s3.dateTime - s2.dateTime],
						legs: [
							{ ...s1, stake: L1, liability: L1 * ((s1.lGross ?? s1.lNet) - 1) },
							{ ...s2, b: null, stake: L2, liability: L2 * ((s2.lGross ?? s2.lNet) - 1) },
							{ ...s3, b: null, stake: L3, liability: L3 * ((s3.lGross ?? s3.lNet) - 1) },
						],
					});
				}
			}
		}
	}

	return results.sort((a, b) => b.rate - a.rate);
}

function formatGap(ms) {
	const totalMin = Math.round(ms / 60000);
	if (totalMin < 60) return `${totalMin}\u00a0min`;
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function buildComboCard(combo) {
	const legRows = combo.legs.map((leg, idx) => {
		const gapHtml = idx > 0
			? `<span class="fc-combo-gap">+${formatGap(combo.gaps[idx - 1])}</span>`
			: '';
		return `
		<div class="fc-combo-leg">
			<div class="fc-combo-leg-left">
				<span class="fc-combo-leg-num">L${idx + 1}</span>
				${gapHtml}
				<div class="fc-event-wrap">
					<span class="fc-event-name">${esc(leg.evName)}</span>
					<span class="fc-event-meta">${esc([leg.evComp, leg.evDate].filter(Boolean).join(' \u00b7 '))}</span>
				</div>
			</div>
			<div class="fc-combo-leg-right">
				<span class="fc-combo-market">${esc(leg.marketName)} &middot; <strong>${esc(leg.outcomeName)}</strong></span>
				${leg.b != null ? `<span class="fc-combo-back">Back\u00a0: <strong>${fmt(leg.b)}</strong></span>` : ''}
				<span class="fc-combo-cover">${esc(leg.coverSite)}<span class="fc-cell-sub"> net\u00a0${fmt(leg.lNet)}${leg.lGross != null ? ` (brut\u00a0${fmt(leg.lGross)})` : ''}</span></span>
				<span class="fc-combo-stake">Mise\u00a0: <strong>${fmt(leg.stake)}\u00a0\u20ac</strong> &middot; liab.\u00a0${fmt(leg.liability)}\u00a0\u20ac</span>
			</div>
		</div>`;
	}).join('');

	return `
	<div class="fc-combo-card">
		<div class="fc-combo-header">
			<span class="fc-combo-b">Cot. combinée <strong>${fmt(combo.B)}</strong></span>
			<span class="fc-combo-profit pos"><strong>${fmt(combo.profit)}\u00a0\u20ac</strong></span>
			<span class="${rateClass(combo.rate)} fc-combo-rate">${fmt(combo.rate * 100, 1)}\u00a0%</span>
		</div>
		<div class="fc-combo-legs">${legRows}</div>
	</div>`;
}

function renderCombinedTable(query) {
	const grid = document.getElementById('fc-grid');
	if (!grid) return;

	const q = query.trim().toLowerCase();
	const filtered = q
		? _opps.filter(combo => combo.legs.some(l => l.evName.toLowerCase().includes(q) || l.evComp.toLowerCase().includes(q)))
		: _opps.slice(0, 10);

	if (!filtered.length) {
		grid.innerHTML = `<p class="fc-empty text-muted">Aucune combinaison correspondante.</p>`;
		return;
	}

	const label = q
		? `${filtered.length} r\u00e9sultat${filtered.length > 1 ? 's' : ''}`
		: `Top 10 sur ${_opps.length} combinaison${_opps.length > 1 ? 's' : ''}`;

	grid.innerHTML = `<p class="fc-grid-label">${label}</p>${filtered.map(buildComboCard).join('')}`;
}

function renderCombinedResults(opps) {
	_opps = opps;
	const el = document.getElementById('fc-results');
	el.hidden = false;

	if (!opps.length) {
		el.innerHTML = `<p class="fc-empty text-muted">Aucune opportunit\u00e9 combin\u00e9e trouv\u00e9e pour ce site.</p>`;
		return;
	}

	const bestRate = opps[0].rate;
	el.innerHTML = `
		<p class="fc-summary">${opps.length} combinaison${opps.length > 1 ? 's' : ''} \u2014 meilleur taux\u00a0: <strong>${fmt(bestRate * 100, 1)}\u00a0%</strong></p>
		<div id="fc-grid"></div>
		<div class="fc-search-row">
			<svg class="fc-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
			<input type="text" id="fc-search" class="fc-search-input" placeholder="Rechercher un match\u2026" oninput="onSearch()" />
		</div>`;
	renderCombinedTable('');
}
