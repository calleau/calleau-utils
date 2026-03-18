'use strict';

let _data = null;
let _opps = [];
let _visibleCount = 20;
let _legs = 1;

// ---- Helpers ----

function isExchange(val) {
	return val !== null && typeof val === 'object' && !Array.isArray(val) && ('Back' in val || 'Lay' in val);
}

function getBackOdds(val) {
	if (typeof val === 'number') return val;
	if (isExchange(val)) return val.Back?.odds_net ?? val.Back?.odds ?? null;
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

function fmt(n, d = 2) {
	return n.toFixed(d).replace('.', ',');
}

function esc(s) {
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rateClass(rate) {
	if (rate >= 0) return 'pc-rate-good';
	if (rate >= -0.03) return 'pc-rate-ok';
	return 'pc-rate-bad';
}

// ---- Calcul ----

function computeOpportunities(data, amount) {
	const results = [];

	for (const [eventKey, event] of Object.entries(data)) {
		const evName = eventDisplayName(eventKey, event);
		const evDate = formatDate(event.dateTime);
		const evComp = event.competition || event.tournoi || '';

		for (const [marketName, market] of Object.entries(event.markets || {})) {
			const outcomeEntries = Object.entries(market);
			if (outcomeEntries.length < 2) continue;

			// Pour chaque issue, trouver la meilleure cote back disponible
			const legs = [];
			for (const [outcomeName, oddsMap] of outcomeEntries) {
				if (!oddsMap || typeof oddsMap !== 'object' || Array.isArray(oddsMap)) continue;
				let bestOdd = 0;
				let bestSite = '';
				for (const [site, val] of Object.entries(oddsMap)) {
					const odd = getBackOdds(val);
					if (odd && odd > bestOdd) { bestOdd = odd; bestSite = site; }
				}
				if (bestOdd > 1) legs.push({ outcomeName, odds: bestOdd, site: bestSite });
			}

			// Toutes les issues doivent avoir une cote
			if (legs.length < 2 || legs.length !== outcomeEntries.length) continue;

			// Trier par cote décroissante : on mise 'amount' sur la plus haute
			legs.sort((a, b) => b.odds - a.odds);
			const k = legs[0].odds * amount;
			legs.forEach((leg, i) => { leg.stake = i === 0 ? amount : k / leg.odds; });

			const totalStake = legs.reduce((sum, l) => sum + l.stake, 0);
			const profit = k - totalStake;
			const rate = profit / totalStake;

			results.push({ evName, evDate, evComp, marketName, legs, totalStake, profit, rate, k });
		}
	}

	return results.sort((a, b) => b.profit - a.profit);
}

// ---- Calcul combiné ----

function collectSingles(data) {
	const singles = [];
	for (const [eventKey, event] of Object.entries(data)) {
		const evName = eventDisplayName(eventKey, event);
		const evDate = formatDate(event.dateTime);
		const evComp = event.competition || event.tournoi || '';
		for (const [marketName, market] of Object.entries(event.markets || {})) {
			const outcomeEntries = Object.entries(market);
			if (outcomeEntries.length < 2) continue;
			const legs = [];
			for (const [outcomeName, oddsMap] of outcomeEntries) {
				if (!oddsMap || typeof oddsMap !== 'object' || Array.isArray(oddsMap)) continue;
				let bestOdd = 0, bestSite = '';
				for (const [site, val] of Object.entries(oddsMap)) {
					const odd = getBackOdds(val);
					if (odd && odd > bestOdd) { bestOdd = odd; bestSite = site; }
				}
				if (bestOdd > 1) legs.push({ outcomeName, odds: bestOdd, site: bestSite });
			}
			if (legs.length === outcomeEntries.length && legs.length >= 2)
				singles.push({ eventKey, evName, evDate, evComp, marketName, legs });
		}
	}
	return singles;
}

function computeCombinedOpportunities(data, amount) {
	const singles = collectSingles(data);
	const results = [];

	for (let i = 0; i < singles.length; i++) {
		const s1 = singles[i];
		for (let j = i + 1; j < singles.length; j++) {
			const s2 = singles[j];
			if (s1.eventKey === s2.eventKey) continue;
			if (s1.marketName !== s2.marketName) continue;

			// Générer toutes les combinaisons (N×M)
			const combos = [];
			for (const l1 of s1.legs) {
				for (const l2 of s2.legs) {
					combos.push({ outcome1: l1.outcomeName, odds1: l1.odds, site1: l1.site, outcome2: l2.outcomeName, odds2: l2.odds, site2: l2.site, odds: l1.odds * l2.odds });
				}
			}

			combos.sort((a, b) => b.odds - a.odds);
			const k = combos[0].odds * amount;
			combos.forEach((c, idx) => { c.stake = idx === 0 ? amount : k / c.odds; });

			const totalStake = combos.reduce((sum, c) => sum + c.stake, 0);
			const profit = k - totalStake;
			const rate = profit / totalStake;

			results.push({ s1, s2, combos, totalStake, profit, rate, k });
		}
	}

	return results.sort((a, b) => b.profit - a.profit);
}

// ---- Rendu ----

function buildCard(op) {
	const profitClass = op.profit >= 0 ? 'pos' : 'neg';

	const legsHtml = op.legs.map((leg, i) => `
		<div class="pc-leg-row${i === 0 ? ' pc-leg-main' : ''}">
			<span class="pc-leg-outcome">${esc(leg.outcomeName)}</span>
			<span class="pc-leg-site">${esc(leg.site)}</span>
			<span class="pc-leg-odds">${fmt(leg.odds)}</span>
			<span class="pc-leg-stake">${fmt(leg.stake)}\u00a0\u20ac</span>
		</div>`).join('');

	return `
	<div class="pc-card">
		<div class="pc-card-header">
			<div class="pc-event">
				<span class="pc-event-name">${esc(op.evName)}</span>
				<span class="pc-event-meta">${esc([op.evComp, op.evDate].filter(Boolean).join(' \u00b7 '))}</span>
			</div>
			<span class="pc-market">${esc(op.marketName)}</span>
			<div class="pc-card-stats">
				<span class="pc-stat-label">Total <strong>${fmt(op.totalStake)}\u00a0\u20ac</strong></span>
				<span class="pc-stat-label">Retour <strong>${fmt(op.k)}\u00a0\u20ac</strong></span>
				<span class="pc-profit ${profitClass}"><strong>${op.profit >= 0 ? '+' : ''}${fmt(op.profit)}\u00a0\u20ac</strong></span>
				<span class="${rateClass(op.rate)} pc-rate">${fmt(op.rate * 100, 1)}\u00a0%</span>
			</div>
		</div>
		<div class="pc-legs">
			<div class="pc-legs-header">
				<span>Issue</span><span>Site</span><span>Cote</span><span>Mise</span>
			</div>
			${legsHtml}
		</div>
	</div>`;
}

function buildComboCard(op) {
	const profitClass = op.profit >= 0 ? 'pos' : 'neg';
	const n1 = op.s1.evName.split(' vs ')[0] || 'M1';
	const n2 = op.s2.evName.split(' vs ')[0] || 'M2';

	const combosHtml = op.combos.map((c, i) => `
		<div class="pc-combo-row${i === 0 ? ' pc-leg-main' : ''}">
			<span class="pc-combo-o">${esc(c.outcome1)}</span>
			<span class="pc-combo-o">${esc(c.outcome2)}</span>
			<span class="pc-combo-odds">${fmt(c.odds1)}\u00a0\u00d7\u00a0${fmt(c.odds2)}\u00a0=\u00a0<strong>${fmt(c.odds)}</strong></span>
			<span class="pc-leg-stake">${fmt(c.stake)}\u00a0\u20ac</span>
		</div>`).join('');

	return `
	<div class="pc-card">
		<div class="pc-card-header">
			<div class="pc-event">
				<span class="pc-event-name">${esc(op.s1.evName)}</span>
				<span class="pc-event-name pc-event-name-x">\u00d7 ${esc(op.s2.evName)}</span>
				<span class="pc-event-meta">${esc(op.s1.marketName)}</span>
			</div>
			<div class="pc-card-stats">
				<span class="pc-stat-label">Total <strong>${fmt(op.totalStake)}\u00a0\u20ac</strong></span>
				<span class="pc-stat-label">Retour <strong>${fmt(op.k)}\u00a0\u20ac</strong></span>
				<span class="pc-profit ${profitClass}"><strong>${op.profit >= 0 ? '+' : ''}${fmt(op.profit)}\u00a0\u20ac</strong></span>
				<span class="${rateClass(op.rate)} pc-rate">${fmt(op.rate * 100, 1)}\u00a0%</span>
			</div>
		</div>
		<div class="pc-combo-grid">
			<div class="pc-legs-header">
				<span>${esc(n1)}</span><span>${esc(n2)}</span><span>Cote comb.</span><span>Mise</span>
			</div>
			${combosHtml}
		</div>
	</div>`;
}

function renderCombinedGrid(query) {
	const grid = document.getElementById('pc-grid');
	const moreBtn = document.getElementById('pc-more');
	if (!grid) return;

	const q = query.trim().toLowerCase();
	const allFiltered = q
		? _opps.filter(op => op.s1.evName.toLowerCase().includes(q) || op.s2.evName.toLowerCase().includes(q) || op.s1.evComp.toLowerCase().includes(q))
		: _opps;
	const visible = allFiltered.slice(0, q ? allFiltered.length : _visibleCount);

	if (!allFiltered.length) {
		grid.innerHTML = `<p class="pc-empty text-muted">Aucun résultat correspondant.</p>`;
		if (moreBtn) moreBtn.innerHTML = '';
		return;
	}

	const label = q
		? `${allFiltered.length} résultat${allFiltered.length > 1 ? 's' : ''}`
		: `${visible.length} sur ${_opps.length} paire${_opps.length > 1 ? 's' : ''}`;

	grid.innerHTML = `<p class="pc-grid-label">${label}</p>${visible.map(buildComboCard).join('')}`;

	if (moreBtn) {
		const remaining = _opps.length - _visibleCount;
		moreBtn.innerHTML = !q && remaining > 0
			? `<button class="pc-show-more-btn" onclick="showMore()">Voir plus (${Math.min(remaining, 20)} sur ${remaining} restants)</button>`
			: '';
	}
}

function renderCombinedResults(opps) {
	_opps = opps;
	const el = document.getElementById('pc-results');
	el.hidden = false;

	if (!opps.length) {
		el.innerHTML = `<p class="pc-empty text-muted">Aucune paire couvrable trouvée (même marché, événements différents).</p>`;
		return;
	}

	const bestProfit = opps[0].profit;
	const sign = bestProfit >= 0 ? '+' : '';
	_visibleCount = 20;
	el.innerHTML = `
		<p class="pc-summary">${opps.length} paire${opps.length > 1 ? 's' : ''} couvrable${opps.length > 1 ? 's' : ''} — plus petite perte\u00a0: <strong>${sign}${fmt(bestProfit)}\u00a0\u20ac</strong></p>
		<div id="pc-grid"></div>
		<div id="pc-more"></div>
		<div class="pc-search-row">
			<svg class="pc-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
			<input type="text" id="pc-search" class="pc-search-input" placeholder="Rechercher un match…" oninput="onSearch()" />
		</div>
	`;
	renderCombinedGrid('');
}

function renderGrid(query) {
	const grid = document.getElementById('pc-grid');
	const moreBtn = document.getElementById('pc-more');
	if (!grid) return;

	const q = query.trim().toLowerCase();
	const oddsMin = parseFloat(document.getElementById('pc-odds-min')?.value) || null;
	const oddsMax = parseFloat(document.getElementById('pc-odds-max')?.value) || null;

	const allFiltered = _opps.filter(op => {
		if (q && !op.evName.toLowerCase().includes(q) && !op.evComp.toLowerCase().includes(q)) return false;
		if (oddsMin != null && op.legs[0].odds < oddsMin) return false;
		if (oddsMax != null && op.legs[0].odds > oddsMax) return false;
		return true;
	});

	const visible = allFiltered.slice(0, q ? allFiltered.length : _visibleCount);

	if (!allFiltered.length) {
		grid.innerHTML = `<p class="pc-empty text-muted">Aucun résultat correspondant.</p>`;
		if (moreBtn) moreBtn.innerHTML = '';
		return;
	}

	const label = q
		? `${allFiltered.length} résultat${allFiltered.length > 1 ? 's' : ''}`
		: `${visible.length} sur ${_opps.length} marché${_opps.length > 1 ? 's' : ''}`;

	grid.innerHTML = `<p class="pc-grid-label">${label}</p>${visible.map(buildCard).join('')}`;

	if (moreBtn) {
		const remaining = _opps.length - _visibleCount;
		moreBtn.innerHTML = !q && remaining > 0
			? `<button class="pc-show-more-btn" onclick="showMore()">Voir plus (${Math.min(remaining, 20)} sur ${remaining} restants)</button>`
			: '';
	}
}

function renderResults(opps) {
	_opps = opps;
	const el = document.getElementById('pc-results');
	el.hidden = false;

	if (!opps.length) {
		el.innerHTML = `<p class="pc-empty text-muted">Aucun marché couvrable trouvé dans ce JSON.</p>`;
		return;
	}

	const bestProfit = opps[0].profit;
	const sign = bestProfit >= 0 ? '+' : '';
	_visibleCount = 20;
	el.innerHTML = `
		<p class="pc-summary">${opps.length} marché${opps.length > 1 ? 's' : ''} couvrable${opps.length > 1 ? 's' : ''} — plus petite perte\u00a0: <strong>${sign}${fmt(bestProfit)}\u00a0\u20ac</strong></p>
		<div id="pc-grid"></div>
		<div id="pc-more"></div>
		<div class="pc-search-row">
			<svg class="pc-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
			<input type="text" id="pc-search" class="pc-search-input" placeholder="Rechercher un match…" oninput="onSearch()" />
		</div>
	`;
	renderGrid('');
}

// ---- Gestionnaires ----

function onSearch() {
	const q = document.getElementById('pc-search')?.value ?? '';
	if (_legs === 1) renderGrid(q);
	else renderCombinedGrid(q);
}

function showMore() {
	_visibleCount += 20;
	onSearch();
}

function setLegs(n) {
	_legs = n;
	document.getElementById('pc-btn-1').classList.toggle('pc-legs-btn--active', n === 1);
	document.getElementById('pc-btn-2').classList.toggle('pc-legs-btn--active', n === 2);
	tryRender();
}

function onJsonChange() {
	const raw = document.getElementById('pc-json').value.trim();
	const errEl = document.getElementById('pc-json-error');
	document.getElementById('pc-results').hidden = true;
	const filterRow = document.getElementById('pc-filter-row');
	if (filterRow) filterRow.hidden = true;

	if (!raw) { _data = null; errEl.hidden = true; return; }

	try {
		_data = JSON.parse(raw);
		errEl.hidden = true;
		if (filterRow) filterRow.hidden = false;
		tryRender();
	} catch (e) {
		_data = null;
		errEl.textContent = 'JSON invalide : ' + e.message;
		errEl.hidden = false;
	}
}

function tryRender() {
	if (!_data) return;
	const amount = parseFloat(document.getElementById('pc-amount').value) || 5;
	if (_legs === 1) renderResults(computeOpportunities(_data, amount));
	else renderCombinedResults(computeCombinedOpportunities(_data, amount));
}

function stepAmount(delta) {
	const input = document.getElementById('pc-amount');
	const val = Math.max(1, (parseFloat(input.value) || 0) + delta);
	input.value = val;
	tryRender();
}

async function pasteFromClipboard() {
	try {
		const text = await navigator.clipboard.readText();
		document.getElementById('pc-json').value = text;
		onJsonChange();
	} catch {
		document.getElementById('pc-json').focus();
	}
}

document.addEventListener('DOMContentLoaded', () => {
	// Réception via postMessage (envoyé en boucle par l'extension)
	window.addEventListener('message', function handler(e) {
		if (e.data?.type === 'couverture_json') {
			window.removeEventListener('message', handler);
			e.source.postMessage({ type: 'couverture_received' }, '*');
			document.getElementById('pc-json').value = e.data.json;
			onJsonChange();
		}
	});

	// Fallback : window.name
	if (window.name) {
		try {
			document.getElementById('pc-json').value = window.name;
			window.name = '';
			onJsonChange();
		} catch {}
	}
});
