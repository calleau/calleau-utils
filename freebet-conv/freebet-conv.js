'use strict';

let _data = null;
let _opps = [];

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

				// — Couverture Lay (sites exchange dans la même issue) —
				for (const [site, val] of Object.entries(oddsMap)) {
					if (site === freebetSite) continue;
					const lNet = getLayOddsNet(val);
					if (!lNet || lNet <= 1) continue;
					const lGross = val.Lay?.odds ?? null;
					// c = commission dérivée depuis lGross et odds_net : c = 1 − (odds_net−1)/(lGross−1)
					const c = (lGross != null && lGross > 1) ? 1 - (lNet - 1) / (lGross - 1) : 0;
					const denom = lGross != null ? lGross - c : lNet;
					const stake = amount * (b - 1) / denom;
					const profit = stake * (1 - c);
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
								const c = val;
								const stake = amount * (b - 1) / c;
								const profit = stake * (c - 1);
								const rate = (b - 1) * (c - 1) / c;
								results.push({ evName, evDate, evComp, marketName, outcomeName, b, coverSite: site, coverType: 'dc', coverOdds: c, lGross: null, liability: null, coverOutcome: dcOutcomeName, stake, profit, rate });
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
	// Cellule "Cote couv." : odds_net + cote brute pour Lay
	const coverOddsCell = op.coverType === 'lay' && op.lGross != null
		? `<span class="fc-cell-main">${fmt(op.coverOdds)}</span><span class="fc-cell-sub">brut : ${fmt(op.lGross)}</span>`
		: `<span class="fc-cell-main">${fmt(op.coverOdds)}</span>`;

	// Cellule "Mise" : stake + liability pour Lay
	const stakeCell = op.coverType === 'lay' && op.liability != null
		? `<span class="fc-cell-main">${fmt(op.stake)} €</span><span class="fc-cell-sub">liab. : ${fmt(op.liability)} €</span>`
		: `<span class="fc-cell-main">${fmt(op.stake)} €</span>`;

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
			<div class="fc-cell fc-cell-mono fc-cell-profit pos">${fmt(op.profit)} €</div>
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

	if (!filtered.length) {
		grid.innerHTML = `
			<div class="fc-results-grid">
				<div class="fc-th">Événement</div>
				<div class="fc-th">Marché</div>
				<div class="fc-th">Issue</div>
				<div class="fc-th">Cote back</div>
				<div class="fc-th">Couverture</div>
				<div class="fc-th">Cote couv.</div>
				<div class="fc-th">Mise</div>
				<div class="fc-th">Profit</div>
				<div class="fc-th">Taux</div>
			</div>
			<p class="fc-empty text-muted">Aucun match correspondant.</p>
		`;
		return;
	}

	const label = q
		? `${filtered.length} résultat${filtered.length > 1 ? 's' : ''}`
		: `Top 10 sur ${_opps.length} opportunité${_opps.length > 1 ? 's' : ''}`;

	grid.innerHTML = `
		<p class="fc-grid-label">${label}</p>
		<div class="fc-results-grid">
			<div class="fc-th">Événement</div>
			<div class="fc-th">Marché</div>
			<div class="fc-th">Issue</div>
			<div class="fc-th">Cote back</div>
			<div class="fc-th">Couverture</div>
			<div class="fc-th">Cote couv.</div>
			<div class="fc-th">Mise</div>
			<div class="fc-th">Profit</div>
			<div class="fc-th">Taux</div>
			${filtered.map(buildRow).join('')}
		</div>
	`;
}

function onSearch() {
	renderTable(document.getElementById('fc-search')?.value ?? '');
}

function renderResults(opps) {
	_opps = opps;
	const el = document.getElementById('fc-results');
	el.hidden = false;

	if (!opps.length) {
		el.innerHTML = `<p class="fc-empty text-muted">Aucune opportunité trouvée pour ce site.</p>`;
		return;
	}

	const bestRate = opps[0].rate;
	el.innerHTML = `
		<p class="fc-summary">${opps.length} opportunité${opps.length > 1 ? 's' : ''} — meilleur taux : <strong>${fmt(bestRate * 100, 1)} %</strong></p>
		<div id="fc-grid"></div>
		<div class="fc-search-row">
			<svg class="fc-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
			<input type="text" id="fc-search" class="fc-search-input" placeholder="Rechercher un match…" oninput="onSearch()" />
		</div>
	`;
	renderTable('');
}

// ---- Gestionnaires d'événements ----

function onJsonChange() {
	const raw = document.getElementById('fc-json').value.trim();
	const errEl = document.getElementById('fc-json-error');
	document.getElementById('fc-results').hidden = true;

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
	const sel = document.getElementById('fc-site-select');
	if (!sites.length) {
		sel.innerHTML = '<option value="">— Charger un JSON —</option>';
		sel.disabled = true;
		return;
	}
	sel.innerHTML = '<option value="">— Sélectionner un site —</option>'
		+ sites.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
	sel.disabled = false;
}

function tryRender() {
	if (!_data) return;
	const site = document.getElementById('fc-site-select').value;
	if (!site) return;
	const amount = parseFloat(document.getElementById('fc-amount').value) || 10;
	renderResults(computeOpportunities(_data, site, amount));
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
});
