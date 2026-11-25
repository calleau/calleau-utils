// =========================================================
// Pari garanti — optimisation d'une mission bet365 « Pari garanti »
// (pari personnalisé remboursé en freebet s'il est perdu), couvert en Lay
// sur les marchés combinés de PIWIx. Voir ARCHITECTURE.md.
// =========================================================

const STORAGE_KEY = 'pari-garanti:v1';

const state = {
	events: [],        // [{ key, name, opp1, opp2, date, groups: [{ title, rows: [...] }] }]
	odds: {},          // clé de ligne → cote bet365 saisie (texte)
	mode: 'balanced',  // 'balanced' | 'allin'
	bestLay: false,    // calculer avec la meilleure proposition en Lay (cote juste sous le Lay)
	json: '',
};

// ── Utilitaires ─────────────────────────────────────────

const $ = id => document.getElementById(id);
const fold = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
	.normalize('NFD').replace(/[̀-ͯ]/g, '');
const num = v => {
	const n = parseFloat(String(v ?? '').replace(',', '.').replace(/\s/g, ''));
	return Number.isFinite(n) ? n : null;
};
const round2 = x => Math.round(x * 100) / 100;
const fmtNum = (x, d = 2) => x.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtEur = x => fmtNum(x) + ' €';
const fmtSigned = x => (x > 0.004 ? '+' : x < -0.004 ? '−' : '') + fmtNum(Math.abs(x)) + ' €';
const signClass = x => (x > 0.004 ? 'pos' : x < -0.004 ? 'neg' : 'neut');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── Lecture des marchés combinés ────────────────────────
// Même règles que mappings/combo-normalizer.js de l'extension Betxtractor :
// noms canoniques ("1X2 & BTTS", issue "1 & Oui") ou bruts PIWIx
// ("Match Odds and Both teams to Score", issue "Paris St-G/Yes").

const BTTS = 'btts';
const TOTAL = 'total';

function comboMarketOf(name) {
	const n = fold(name);
	if (/^(1x2 & btts|match odds and both teams to score)$/.test(n)) return BTTS;
	if (/^(1x2 & total buts|match odds and over\/under \d+(?:[.,]\d+)? goals)$/.test(n)) return TOTAL;
	return null;
}

function splitEventName(name) {
	const m = String(name || '').match(/^(.+?)\s+(?:v|vs\.?|-)\s+(.+)$/i);
	return m ? [m[1].trim(), m[2].trim()] : null;
}

function resultOf(label, opp1, opp2) {
	const p = fold(label);
	if (/^(x|n|nul|match nul|draw|the draw)$/.test(p)) return 'X';
	if (p === '1' || p === '2') return p;
	const o1 = fold(opp1), o2 = fold(opp2);
	if (o1 && p === o1) return '1';
	if (o2 && p === o2) return '2';
	const in1 = o1 && (o1.includes(p) || p.includes(o1));
	const in2 = o2 && (o2.includes(p) || p.includes(o2));
	if (in1 && !in2) return '1';
	if (in2 && !in1) return '2';
	return null;
}

function secondOf(label, market) {
	const p = fold(label).replace(',', '.');
	if (market === BTTS) {
		if (/^(yes|oui)$/.test(p)) return 'Oui';
		if (/^(no|non)$/.test(p)) return 'Non';
		return null;
	}
	const m = p.match(/^(over|under|plus de|moins de|\+|-) ?(\d+(?:\.\d+)?)(?: goals?| buts?)?$/);
	if (!m) return null;
	return (/^(over|plus de|\+)$/.test(m[1]) ? '+' : '-') + Number(m[2]);
}

function comboIssue(label, market, opp1, opp2) {
	const text = String(label || '').replace(/\s+/g, ' ').trim();
	for (const sep of ['/', ' & ']) {
		const i = text.lastIndexOf(sep);
		if (i <= 0) continue;
		const result = resultOf(text.slice(0, i), opp1, opp2);
		const second = secondOf(text.slice(i + sep.length), market);
		if (result && second) return { result, second };
	}
	return null;
}

/** Cotes Lay (et Back) d'une issue au format Betxtractor : PIWIx en priorité, sinon le 1er site avec un Lay. */
function layOf(sites) {
	if (!sites || typeof sites !== 'object') return null;
	const pick = s => (s && s.Lay && num(s.Lay.odds) > 1
		? { odds: num(s.Lay.odds), amount: num(s.Lay.amount), back: num(s.Back?.odds) }
		: null);
	return pick(sites.PIWIx) || Object.values(sites).map(pick).find(Boolean) || null;
}

// ── Meilleure proposition en Lay ────────────────────────
// Barème des cotes de l'exchange (Betfair) : pas de cotation par tranche.
function tickBelow(odds) {
	// Pas de la tranche juste en dessous de `odds` (10 → 9,80 : pas de la tranche 6–10)
	const v = odds - 1e-9;
	if (v < 2) return 0.01;
	if (v < 3) return 0.02;
	if (v < 4) return 0.05;
	if (v < 6) return 0.1;
	if (v < 10) return 0.2;
	if (v < 20) return 0.5;
	if (v < 30) return 1;
	if (v < 50) return 2;
	if (v < 100) return 5;
	return 10;
}

/**
 * Cote Lay à proposer : la cote juste en dessous du Lay actuel, sauf si elle atteint
 * le Back (Back et Lay consécutifs : 1,20 / 1,21 ou 9,6 / 9,8) → Lay actuel.
 * Ex. Back 1,20 / Lay 1,25 → 1,24 ; Back 9 / Lay 9,8 → 9,6.
 */
function proposedLay(back, lay) {
	const below = round2(lay - tickBelow(lay));
	if (below <= 1) return lay;
	if (back != null && below <= back + 1e-9) return lay;
	return below;
}

/** Texte JSON → liste d'événements { name, opp1, opp2, date, items: [{ result, second, lay, amount }] }. */
function parseInput(text) {
	const data = JSON.parse(text);
	const raw = [];

	const rawEvents = data?.extraction?.events || (Array.isArray(data?.events) ? data.events : null);
	if (rawEvents) {
		// Extraction brute (Betxtractor-3000, extension avant mise en forme)
		for (const ev of rawEvents) {
			const name = ev.event?.fullName || [ev.event?.opponent1, ev.event?.opponent2].filter(Boolean).join(' vs ');
			const odds = (ev.odds || []).map(o => ({
				market: o.market, issue: o.betType,
				lay: num(o.lay?.value), amount: num(o.lay?.amount), back: num(o.back?.value),
			}));
			raw.push({ name, opp1: ev.event?.opponent1, opp2: ev.event?.opponent2, date: ev.metadata?.datetime, odds });
		}
	} else if (data && typeof data === 'object') {
		// Export du tableau de bord : { "<match>_<date>": { nom_event, opponents, markets } }
		for (const ev of Object.values(data)) {
			if (!ev || typeof ev !== 'object' || !ev.markets) continue;
			const odds = [];
			for (const [market, issues] of Object.entries(ev.markets)) {
				for (const [issue, sites] of Object.entries(issues || {})) {
					const l = layOf(sites);
					odds.push({ market, issue, lay: l?.odds ?? null, amount: l?.amount ?? null, back: l?.back ?? null });
				}
			}
			raw.push({ name: ev.nom_event, opp1: ev.opponents?.['1'], opp2: ev.opponents?.['2'], date: ev.dateTime, odds });
		}
	}

	const events = [];
	for (const ev of raw) {
		let { opp1, opp2 } = ev;
		if (!opp1 || !opp2) {
			const split = splitEventName(ev.name);
			if (split) [opp1, opp2] = split;
		}
		const seen = new Set();
		const items = [];
		for (const o of ev.odds) {
			const market = comboMarketOf(o.market);
			if (!market || !(o.lay > 1)) continue;
			const c = comboIssue(o.issue, market, opp1, opp2);
			if (!c) continue;
			const id = `${c.result} & ${c.second}`;
			if (seen.has(id)) continue;
			seen.add(id);
			items.push({ ...c, lay: o.lay, amount: o.amount, back: o.back > 1 ? o.back : null });
		}
		if (items.length) events.push({ name: ev.name || `${opp1} vs ${opp2}`, opp1, opp2, date: ev.date, items });
	}
	return events;
}

/** Regroupe les issues d'un match : BTTS, puis chaque ligne de buts ; 1 / X / 2, Oui / plus avant Non / moins. */
function buildGroups(ev) {
	const groups = new Map();
	const RES = ['1', 'X', '2'];
	for (const it of ev.items) {
		const isBtts = it.second === 'Oui' || it.second === 'Non';
		const line = isBtts ? 0 : Math.abs(Number(it.second));
		const gk = isBtts ? 'btts' : `t${line}`;
		if (!groups.has(gk)) groups.set(gk, { line, title: isBtts ? 'Résultat & les 2 équipes marquent' : `Résultat & plus / moins de ${fmtNum(line, 1)} buts`, rows: [] });
		const rank = RES.indexOf(it.result) * 2 + (it.second === 'Oui' || it.second.startsWith('+') ? 0 : 1);
		groups.get(gk).rows.push({ ...it, rank, key: `${ev.name}|${it.result} & ${it.second}`, label: comboLabel(ev, it) });
	}
	return [...groups.values()]
		.sort((a, b) => a.line - b.line)
		.map(g => ({ ...g, rows: g.rows.sort((a, b) => a.rank - b.rank) }));
}

function comboLabel(ev, it) {
	const res = it.result === '1' ? ev.opp1 || 'Équipe 1' : it.result === '2' ? ev.opp2 || 'Équipe 2' : 'Nul';
	let second;
	if (it.second === 'Oui') second = 'les 2 marquent';
	else if (it.second === 'Non') second = 'les 2 ne marquent pas';
	else second = `${it.second.startsWith('+') ? 'plus' : 'moins'} de ${fmtNum(Math.abs(Number(it.second)), 1)} buts`;
	return { res, second };
}

// ── Calcul ──────────────────────────────────────────────
// S mise bet365 (cash), B cote bet365, L cote Lay, c commission, F freebet, r valeur du FB.
// Lay de m : bet365 gagne → S(B−1) − m(L−1) ; bet365 perd → −S + m(1−c), plus le freebet.

function params() {
	return {
		S: num($('pg-stake').value) ?? 0,
		F: num($('pg-fb').value) ?? 0,
		r: (num($('pg-conv').value) ?? 0) / 100,
		c: (num($('pg-com').value) ?? 0) / 100,
		minOdds: num($('pg-min').value) ?? 1,
	};
}

function compute(p, B, L, mode = state.mode) {
	const { S, F, r, c } = p;
	const exact = mode === 'balanced'
		? (S * B - r * F) / (L - c)   // même résultat dans les deux cas (FB compté à r·F)
		: S * (B - 1) / (L - 1);       // 0 si bet365 gagne
	const m = Math.max(0, round2(exact));
	const win = S * (B - 1) - m * (L - 1);
	const loseCash = -S + m * (1 - c);
	const loseValue = loseCash + r * F;
	const score = mode === 'balanced' ? Math.min(win, loseValue) : loseCash;
	return { m, liability: m * (L - 1), win, loseCash, loseValue, score };
}

// Scénarios comparés : mode (Équilibré / Tout ou rien) × Lay (actuel / meilleure proposition)
const SCENARIOS = [
	{ key: 'balanced|cur', mode: 'balanced', prop: false },
	{ key: 'balanced|prop', mode: 'balanced', prop: true },
	{ key: 'allin|cur', mode: 'allin', prop: false },
	{ key: 'allin|prop', mode: 'allin', prop: true },
];
const scenarioKey = (mode, prop) => `${mode}|${prop ? 'prop' : 'cur'}`;
const MODE_LABEL = { balanced: 'Équilibré', allin: 'Tout ou rien' };

/** Cote bet365 à partir de laquelle une issue atteint le résultat `target` (null si inatteignable). */
function oddsFor(p, L, target) {
	const { S, F, r, c } = p;
	if (!(S > 0) || !(L > 1)) return null;
	const B = state.mode === 'balanced'
		? (target + S - r * F * (L - 1) / (L - c)) * (L - c) / (S * (1 - c))
		: 1 + (target + S) * (L - 1) / (S * (1 - c));
	return Number.isFinite(B) ? Math.max(B, p.minOdds, 1.01) : null;
}

// ── Lien vers calc-couverture ───────────────────────────
// Deux calculateurs (cf. calc-couverture/URL_STATE.md) : issue 1 = Back bet365 (mise fixe),
// issue 2 = Lay PIWIx + gain fixe du freebet.
//   - Équilibré    : deux issues distribuées, freebet compté r·F → même profit partout.
//   - Tout ou rien : issue 1 non distribuée (0 € si bet365 gagne), freebet à sa valeur
//                    nominale F (profit de l'issue 2 = perte en cash + freebet).

function calcCouvUrl(ev, row, p, L = row.L) {
	const proposed = L !== row.lay;
	if (typeof LZString === 'undefined') return null;
	const fr = (x, d = 2) => x.toFixed(d).replace('.', ',');
	const combo = `${row.label.res} & ${row.label.second}`;
	const match = ev.opp1 && ev.opp2 ? `${ev.opp1} – ${ev.opp2}` : ev.name;
	const calc = mode => {
		const allin = mode === 'allin';
		const tag = allin ? 'Tout ou rien' : 'Équilibré';
		const fbText = allin
			? `freebet ${fmtNum(p.F, 0)} € (valeur nominale)`
			: `freebet ${fmtNum(p.F, 0)} € compté ${fmtNum(p.r * 100, 0)} %`;
		return {
			i: [
				{
					l: `${tag} · bet365 gagne · ${combo} (${match})`,
					f: 1,
					...(allin ? { d: 0 } : {}),
					dt: [{ w: 'bet365', o: [fr(row.B)], s: fr(p.S) }],
				},
				{
					l: `${tag} · bet365 perd · Lay PIWIx + ${fbText}`,
					dt: [
						{ t: 'l', w: proposed ? 'PIWIx (proposé)' : 'PIWIx', o: [fr(L)], m: [fr(p.c * 100)] },
						{ t: 'f', w: 'bet365', v: fr(allin ? p.F : p.r * p.F) },
					],
				},
			],
		};
	};
	const state = { v: 1, g: { cm: 1, fg: 1, il: 1, ds: 1 }, c: [calc('balanced'), calc('allin')] };
	return '../calc-couverture/index.html?s=' + LZString.compressToEncodedURIComponent(JSON.stringify(state));
}

function calcCouvLink(ev, row, p, cls = 'pg-cc-link', L = row.L) {
	const url = calcCouvUrl(ev, row, p, L);
	return url
		? `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener" title="Ouvrir dans calc-couverture (Équilibré + Tout ou rien)">calc-couv ↗</a>`
		: '';
}

// ── Rendu ───────────────────────────────────────────────

function renderEvents() {
	const root = $('pg-events');
	if (!state.events.length) { root.innerHTML = ''; return; }
	root.innerHTML = state.events.map((ev, ei) => {
		const date = ev.date ? new Date(ev.date) : null;
		const when = date && !isNaN(date) ? date.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
		return `
		<section class="card pg-event">
			<header class="pg-event-head">
				<h2 class="pg-event-title">${esc(ev.opp1 && ev.opp2 ? `${ev.opp1} – ${ev.opp2}` : ev.name)}</h2>
				<span class="pg-event-date">${esc(when)}</span>
			</header>
			<div class="pg-table-wrap">
			<table class="pg-table">
				<thead><tr>
					<th class="pg-th-combo">Combinaison</th>
					<th class="pg-th-lay">Lay PIWIx</th>
					<th class="pg-th-365">Cote bet365</th>
					<th>Cote à viser</th>
					<th>Mise Lay</th>
					<th>Si bet365 gagne</th>
					<th>Si bet365 perd</th>
					<th>Résultat</th>
				</tr></thead>
				${ev.groups.map(g => `
				<tbody>
					<tr class="pg-group"><th colspan="8">${esc(g.title)}</th></tr>
					${g.rows.map((row, ri) => `
					<tr class="pg-row" data-key="${esc(row.key)}">
						<td class="pg-combo"><span class="pg-combo-res">${esc(row.label.res)}</span><span class="pg-combo-sec">${esc(row.label.second)}</span></td>
						<td class="pg-lay" data-cell="lay"></td>
						<td class="pg-365"><div class="numinput pg-odds-input"><input type="text" inputmode="decimal" placeholder="—"
							data-key="${esc(row.key)}" id="pg-in-${ei}-${esc(g.line)}-${ri}" value="${esc(state.odds[row.key] || '')}" /></div></td>
						<td class="pg-target" data-cell="target"></td>
						<td class="pg-num" data-cell="stake"></td>
						<td class="pg-num" data-cell="win"></td>
						<td class="pg-num" data-cell="lose"></td>
						<td class="pg-num pg-score" data-cell="score"></td>
					</tr>`).join('')}
				</tbody>`).join('')}
			</table>
			</div>
		</section>`;
	}).join('');
}

function allRows() {
	return state.events.flatMap(ev => ev.groups.flatMap(g => g.rows.map(row => ({ ev, row }))));
}

function update() {
	const p = params();
	const rows = allRows();

	// Lignes renseignées et éligibles, classées
	const filled = [];
	for (const { ev, row } of rows) {
		const B = num(state.odds[row.key]);
		row.B = B;
		row.res = null;
		// Cote Lay retenue : Lay actuel, ou meilleure proposition (option)
		row.Lprop = proposedLay(row.back, row.lay);
		row.L = state.bestLay ? row.Lprop : row.lay;
		row.proposed = row.L !== row.lay;
		row.status = B == null ? 'empty' : B < p.minOdds ? 'low' : B <= 1 ? 'invalid' : 'ok';
		if (row.status === 'ok') {
			// Tous les scénarios (mode × Lay), pour la comparaison
			row.scen = {};
			for (const s of SCENARIOS) row.scen[s.key] = compute(p, B, s.prop ? row.Lprop : row.lay, s.mode);
			row.res = row.scen[scenarioKey(state.mode, state.bestLay)];
			filled.push({ ev, row });
		}
	}
	filled.sort((a, b) => b.row.res.score - a.row.res.score);
	filled.forEach((f, i) => { f.row.rank = i + 1; });
	const best = filled[0] || null;
	// Cote à viser : battre la meilleure ligne ; à défaut, équilibre à 0 € (mode équilibré)
	const target = best ? best.row.res.score : state.mode === 'balanced' ? 0 : null;

	const trByKey = new Map([...document.querySelectorAll('tr.pg-row')].map(tr => [tr.dataset.key, tr]));
	for (const { ev, row } of rows) {
		const tr = trByKey.get(row.key);
		if (!tr) continue;
		const cell = name => tr.querySelector(`[data-cell="${name}"]`);
		tr.classList.toggle('is-best', !!best && best.row === row);
		tr.classList.toggle('is-low', row.status === 'low');

		const backTxt = row.back != null ? ` · back ${fmtNum(row.back)}` : '';
		cell('lay').innerHTML = row.proposed
			? `<span class="pg-lay-odds" title="Ordre Lay à proposer : non apparié tant qu'un parieur ne le prend pas">${fmtNum(row.L)}</span>`
				+ `<span class="pg-sub pg-proposed">proposé</span><span class="pg-sub">lay ${fmtNum(row.lay)}${backTxt}</span>`
			: `<span class="pg-lay-odds">${fmtNum(row.lay)}</span>`
				+ (row.amount != null ? `<span class="pg-sub">dispo ${fmtNum(row.amount, 0)} €</span>` : '')
				+ (state.bestLay ? `<span class="pg-sub" title="Back et Lay consécutifs : pas de meilleure proposition">consécutifs${backTxt}</span>` : '');

		const isBest = best && best.row === row;
		const t = target == null || isBest ? null : oddsFor(p, row.L, target);
		cell('target').innerHTML = t == null ? '' : `<span class="pg-target-val" title="${best ? 'Cote bet365 à atteindre pour égaler la meilleure option' : 'Cote bet365 pour un résultat à 0 €'}">≥ ${fmtNum(Math.ceil(t * 100) / 100)}</span>`;

		if (row.status === 'low') {
			cell('stake').innerHTML = '';
			cell('win').innerHTML = '';
			cell('lose').innerHTML = '';
			cell('score').innerHTML = `<span class="pg-warn">cote &lt; ${fmtNum(p.minOdds)}</span>`;
			continue;
		}
		if (!row.res) {
			for (const n of ['stake', 'win', 'lose', 'score']) cell(n).innerHTML = '';
			continue;
		}
		const r = row.res;
		// Disponible : n'a de sens que pour le Lay actuel (une proposition attend une contrepartie)
		const short = !row.proposed && row.amount != null && r.m > row.amount;
		cell('stake').innerHTML = `<span class="pg-main">${fmtEur(r.m)}</span><span class="pg-sub">resp. ${fmtEur(r.liability)}</span>`
			+ (short ? `<span class="pg-warn" title="Le Lay disponible sur PIWIx est inférieur à la mise">dispo ${fmtNum(row.amount, 0)} €</span>` : '');
		cell('win').innerHTML = `<span class="pg-main ${signClass(r.win)}">${fmtSigned(r.win)}</span>`;
		cell('lose').innerHTML = `<span class="pg-main ${signClass(r.loseCash)}">${fmtSigned(r.loseCash)}</span><span class="pg-sub">+ ${fmtNum(p.F, 0)} € FB</span>`;
		// Option active et cote proposée différente : rappel du résultat avec le Lay actuel
		const cur = row.proposed ? row.scen[scenarioKey(state.mode, false)] : null;
		cell('score').innerHTML = `<span class="pg-main ${signClass(r.score)}">${fmtSigned(r.score)}</span>`
			+ (cur ? `<span class="pg-sub" title="Même issue avec le Lay actuel (${fmtNum(row.lay)})">lay actuel ${fmtSigned(cur.score)}</span>` : '')
			+ `<span class="pg-rank">#${row.rank}</span>${calcCouvLink(ev, row, p)}`;
	}

	renderBest(p, filled);
	save();
}

function renderBest(p, filled) {
	const box = $('pg-best');
	if (!filled.length) { box.hidden = true; box.innerHTML = ''; return; }
	box.hidden = false;
	const { ev, row } = filled[0];
	const r = row.res;
	const scoreLabel = state.mode === 'balanced' ? 'Gain garanti (FB à ' + fmtNum(p.r * 100, 0) + ' %)' : 'Cash si bet365 perd';
	box.innerHTML = `
		<div class="card pg-best-card">
			<div class="pg-best-head">
				<span class="pg-label">Meilleure option</span>
				<span class="pg-best-match">${esc(ev.opp1 && ev.opp2 ? `${ev.opp1} – ${ev.opp2}` : ev.name)}</span>
				${calcCouvLink(ev, row, p, 'btn btn-secondary pg-cc-btn')}
			</div>
			<p class="pg-best-combo">${esc(row.label.res)} <span class="pg-amp">&amp;</span> ${esc(row.label.second)}</p>
			<div class="metrics-grid">
				<div class="metric-card">
					<div class="metric-label">bet365 (pari personnalisé)</div>
					<div class="metric-value">${fmtEur(p.S)}</div>
					<div class="tip">à la cote ${fmtNum(row.B)}</div>
				</div>
				<div class="metric-card">
					<div class="metric-label">Lay PIWIx</div>
					<div class="metric-value">${fmtEur(r.m)}</div>
					<div class="tip">à ${fmtNum(row.L)}${row.proposed ? ` (proposé, lay actuel ${fmtNum(row.lay)})` : ''} — responsabilité ${fmtEur(r.liability)}</div>
				</div>
				<div class="metric-card">
					<div class="metric-label">Si bet365 gagne</div>
					<div class="metric-value ${signClass(r.win)}">${fmtSigned(r.win)}</div>
				</div>
				<div class="metric-card">
					<div class="metric-label">Si bet365 perd</div>
					<div class="metric-value ${signClass(r.loseCash)}">${fmtSigned(r.loseCash)}</div>
					<div class="tip">+ ${fmtNum(p.F, 0)} € de freebet (≈ ${fmtEur(r.loseValue)} au total)</div>
				</div>
				<div class="metric-card">
					<div class="metric-label">${esc(scoreLabel)}</div>
					<div class="metric-value ${signClass(r.score)}">${fmtSigned(r.score)}</div>
				</div>
			</div>
			${filled.length > 1 ? `
			<ol class="pg-podium" start="2">
				${filled.slice(1, 5).map(({ ev: e, row: x }) => `
				<li><span>${esc(x.label.res)} &amp; ${esc(x.label.second)}</span>
					${state.events.length > 1 ? `<span class="tip">${esc(e.opp1 && e.opp2 ? `${e.opp1} – ${e.opp2}` : e.name)}</span>` : ''}
					<span class="tip">@ ${fmtNum(x.B)} / Lay ${fmtNum(x.L)}${x.proposed ? ' (proposé)' : ''}</span>
					<span class="pg-main ${signClass(x.res.score)}">${fmtSigned(x.res.score)}</span>
					${calcCouvLink(e, x, p)}</li>`).join('')}
			</ol>` : ''}
			${renderComparison(p, filled)}
		</div>`;
}

function renderComparison(p, filled) {
	const scens = SCENARIOS.filter(s => state.bestLay || !s.prop);
	const bestOf = key => filled.reduce((b, f) => (!b || f.row.scen[key].score > b.row.scen[key].score ? f : b), null);
	const bests = Object.fromEntries(scens.map(s => [s.key, bestOf(s.key)]));
	const name = f => `${f.row.label.res} & ${f.row.label.second}`
		+ (state.events.length > 1 ? ` (${f.ev.opp1 && f.ev.opp2 ? `${f.ev.opp1} – ${f.ev.opp2}` : f.ev.name})` : '');
	const scoreTxt = (mode, res) => (mode === 'balanced' ? 'gain garanti ' : 'cash si bet365 perd ') + fmtSigned(res.score);
	const currentKey = scenarioKey(state.mode, state.bestLay);

	const rows = scens.map(s => {
		const f = bests[s.key];
		const res = f.row.scen[s.key];
		const L = s.prop ? f.row.Lprop : f.row.lay;
		const isProp = L !== f.row.lay;
		return `
			<tr class="${s.key === currentKey ? 'is-current' : ''}">
				<td class="pg-cmp-scen">${MODE_LABEL[s.mode]}${state.bestLay ? `<span class="pg-sub">${s.prop ? 'Lay proposé' : 'Lay actuel'}</span>` : ''}</td>
				<td class="pg-cmp-opt">${esc(name(f))}<span class="pg-sub">bet365 ${fmtNum(f.row.B)} · Lay ${fmtNum(L)}${isProp ? ' (proposé)' : s.prop ? ' (consécutifs)' : ''}</span></td>
				<td class="pg-num"><span class="pg-main">${fmtEur(res.m)}</span><span class="pg-sub">resp. ${fmtEur(res.liability)}</span></td>
				<td class="pg-num"><span class="pg-main ${signClass(res.win)}">${fmtSigned(res.win)}</span></td>
				<td class="pg-num"><span class="pg-main ${signClass(res.loseCash)}">${fmtSigned(res.loseCash)}</span><span class="pg-sub">+ ${fmtNum(p.F, 0)} € FB</span></td>
				<td class="pg-num"><span class="pg-main ${signClass(res.score)}">${fmtSigned(res.score)}</span></td>
				<td>${calcCouvLink(f.ev, f.row, p, 'pg-cc-link', L)}</td>
			</tr>`;
	}).join('');

	// Constats : même meilleure option ou non, avec les résultats des deux scénarios
	const notes = [];
	const compare = (ka, kb, labelA, labelB, ctx) => {
		const a = bests[ka], b = bests[kb];
		const ra = a.row.scen[ka], rb = b.row.scen[kb];
		const modeA = ka.split('|')[0], modeB = kb.split('|')[0];
		notes.push(a.row === b.row
			? `<li><strong>Même meilleure option</strong> ${ctx} : ${esc(name(a))} — ${labelA} : ${scoreTxt(modeA, ra)} ; ${labelB} : ${scoreTxt(modeB, rb)}.</li>`
			: `<li><strong>Meilleure option différente</strong> ${ctx} — ${labelA} : ${esc(name(a))} (${scoreTxt(modeA, ra)}) ; ${labelB} : ${esc(name(b))} (${scoreTxt(modeB, rb)}).</li>`);
	};
	if (state.bestLay) {
		compare('balanced|cur', 'balanced|prop', 'Lay actuel', 'Lay proposé', 'avec ou sans proposition en Lay, en Équilibré');
		compare('allin|cur', 'allin|prop', 'Lay actuel', 'Lay proposé', 'avec ou sans proposition en Lay, en Tout ou rien');
	}
	const lay = state.bestLay ? 'prop' : 'cur';
	compare(`balanced|${lay}`, `allin|${lay}`, 'Équilibré', 'Tout ou rien',
		`en Équilibré et en Tout ou rien${state.bestLay ? ' (Lay proposé)' : ''}`);

	return `
		<div class="pg-compare">
			<span class="pg-label">Comparaison des scénarios</span>
			<ul class="pg-cmp-notes">${notes.join('')}</ul>
			<div class="pg-table-wrap">
			<table class="pg-table pg-cmp-table">
				<thead><tr>
					<th class="pg-th-combo">Scénario</th>
					<th class="pg-th-combo">Meilleure option</th>
					<th>Mise Lay</th>
					<th>Si bet365 gagne</th>
					<th>Si bet365 perd</th>
					<th>Résultat</th>
					<th></th>
				</tr></thead>
				<tbody>${rows}</tbody>
			</table>
			</div>
			<p class="tip">Résultat : gain garanti en Équilibré (freebet compté ${fmtNum(p.r * 100, 0)} %), cash si bet365 perd en Tout ou rien (+ freebet entier). Ligne surlignée : réglages actuels.</p>
		</div>`;
}

function renderModeTip() {
	document.querySelectorAll('.pg-seg-btn').forEach(b => {
		const on = b.dataset.mode === state.mode;
		b.classList.toggle('is-active', on);
		b.setAttribute('aria-checked', on ? 'true' : 'false');
	});
	$('pg-mode-tip').textContent = state.mode === 'balanced'
		? 'Équilibré : le Lay est calculé pour gagner la même chose dans les deux cas, le freebet étant compté à sa valeur en cash. Classement : gain garanti.'
		: 'Tout ou rien : le Lay rembourse exactement la mise si le pari bet365 gagne (0 €). Si bet365 perd, on encaisse le Lay (perte en cash) et on reçoit le freebet entier. Classement : plus petite perte en cash.';
}

// ── Chargement / sauvegarde ─────────────────────────────

function load(text, { silent = false } = {}) {
	const err = $('pg-error');
	err.hidden = true;
	if (!text.trim()) { state.events = []; renderEvents(); update(); return; }
	let events;
	try {
		events = parseInput(text);
	} catch (e) {
		if (!silent) { err.textContent = 'JSON invalide : ' + e.message; err.hidden = false; }
		return;
	}
	if (!events.length) {
		err.textContent = 'Aucun marché combiné trouvé. Il faut les marchés PIWIx « Match Odds and Both teams to Score » et « Match Odds and Over/Under 2.5 / 3.5 Goals » (ou « 1X2 & BTTS » / « 1X2 & Total buts »).';
		err.hidden = false;
	}
	state.json = text;
	state.events = events.map(ev => ({ ...ev, groups: buildGroups(ev) }));
	renderEvents();
	update();
}

const PARAM_IDS = ['pg-stake', 'pg-fb', 'pg-conv', 'pg-com', 'pg-min'];

function save() {
	try {
		const values = Object.fromEntries(PARAM_IDS.map(id => [id, $(id).value]));
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ json: state.json, odds: state.odds, mode: state.mode, bestLay: state.bestLay, values }));
	} catch { /* stockage indisponible : rien à faire */ }
}

function restore() {
	try {
		const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
		if (!saved) return;
		for (const [id, v] of Object.entries(saved.values || {})) if ($(id) && v != null) $(id).value = v;
		if (saved.mode === 'allin' || saved.mode === 'balanced') state.mode = saved.mode;
		state.bestLay = saved.bestLay === true;
		state.odds = saved.odds || {};
		state.json = saved.json || '';
		$('pg-json').value = state.json;
	} catch { /* données illisibles : on repart de zéro */ }
}

// ── Événements ──────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
	restore();
	renderModeTip();
	load(state.json, { silent: true });

	PARAM_IDS.forEach(id => {
		$(id).addEventListener('input', update);
		$(id).addEventListener('focus', e => e.target.select());
	});
	document.querySelectorAll('.pg-seg-btn').forEach(b => b.addEventListener('click', () => {
		state.mode = b.dataset.mode;
		renderModeTip();
		update();
	}));
	$('pg-bestlay').checked = state.bestLay;
	$('pg-bestlay').addEventListener('change', e => {
		state.bestLay = e.target.checked;
		update();
	});

	$('pg-load').addEventListener('click', () => load($('pg-json').value));
	$('pg-json').addEventListener('paste', () => setTimeout(() => load($('pg-json').value), 0));
	$('pg-clear-odds').addEventListener('click', () => {
		state.odds = {};
		document.querySelectorAll('.pg-odds-input input').forEach(i => { i.value = ''; });
		update();
	});
	$('pg-reset').addEventListener('click', () => {
		state.odds = {};
		$('pg-json').value = '';
		state.json = '';
		load('');
	});

	$('pg-events').addEventListener('input', e => {
		const key = e.target.dataset?.key;
		if (!key) return;
		state.odds[key] = e.target.value;
		update();
	});
	$('pg-events').addEventListener('focusin', e => { if (e.target.matches('input')) e.target.select(); });
	// Entrée / flèches : passer à la cote bet365 suivante / précédente
	$('pg-events').addEventListener('keydown', e => {
		if (!e.target.matches('.pg-odds-input input')) return;
		if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
		const inputs = [...document.querySelectorAll('.pg-odds-input input')];
		const i = inputs.indexOf(e.target) + (e.key === 'ArrowUp' ? -1 : 1);
		if (inputs[i]) { e.preventDefault(); inputs[i].focus(); }
	});
});
