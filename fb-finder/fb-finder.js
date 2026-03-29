'use strict';

// ===== STATE =====
let _data = null;
let _results = [];
let _allResults = {};   // cache: key = `${method}_${nLegs}` → results array
let _method = 1;   // 1 | 2 | 3
let _betType = 'fb'; // 'fb' | 'cash'
let _nLegs = 1;
let _amount = 10;
let _fbSite = '';
let _visibleCount = 20;

// Coverage rules — loaded from coverage-rules.json, embedded here as default fallback
let _coverageRules = [
	{ "issues": 2,
		"A": [
			{ "market": "Résultats", "issue": "1", "betType": "Back" },
			{ "market": "Double Chance", "issue": "X2", "betType": "Lay" },
			{ "market": "Asian Handicap", "issue": "1 (-0,5)", "betType": "Back" },
			{ "market": "Asian Handicap", "issue": "2 (+0,5)", "betType": "Lay" }
		],
		"B": [
			{ "market": "Résultats", "issue": "1", "betType": "Lay" },
			{ "market": "Double Chance", "issue": "X2", "betType": "Back" },
			{ "market": "Asian Handicap", "issue": "1 (-0,5)", "betType": "Lay" },
			{ "market": "Asian Handicap", "issue": "2 (+0,5)", "betType": "Back" }
		]
	},
	{ "issues": 2,
		"A": [
			{ "market": "Résultats", "issue": "X", "betType": "Back" },
			{ "market": "Double Chance", "issue": "12", "betType": "Lay" }
		],
		"B": [
			{ "market": "Résultats", "issue": "X", "betType": "Lay" },
			{ "market": "Double Chance", "issue": "12", "betType": "Back" }
		]
	},
	{ "issues": 2,
		"A": [
			{ "market": "Résultats", "issue": "2", "betType": "Back" },
			{ "market": "Double Chance", "issue": "1X", "betType": "Lay" },
			{ "market": "Asian Handicap", "issue": "2 (-0,5)", "betType": "Back" },
			{ "market": "Asian Handicap", "issue": "1 (+0,5)", "betType": "Lay" }
		],
		"B": [
			{ "market": "Résultats", "issue": "2", "betType": "Lay" },
			{ "market": "Double Chance", "issue": "1X", "betType": "Back" },
			{ "market": "Asian Handicap", "issue": "2 (-0,5)", "betType": "Lay" },
			{ "market": "Asian Handicap", "issue": "1 (+0,5)", "betType": "Back" }
		]
	},
	{ "issues": 2,
		"A": [
			{ "market": "Vainqueur", "issue": "1", "betType": "Back" },
			{ "market": "Vainqueur", "issue": "2", "betType": "Lay" }
		],
		"B": [
			{ "market": "Vainqueur", "issue": "2", "betType": "Back" },
			{ "market": "Vainqueur", "issue": "1", "betType": "Lay" }
		]
	},
	{ "issues": 2,
		"A": [
			{ "market": "BTTS", "issue": "Oui", "betType": "Back" },
			{ "market": "BTTS", "issue": "Non", "betType": "Lay" }
		],
		"B": [
			{ "market": "BTTS", "issue": "Oui", "betType": "Lay" },
			{ "market": "BTTS", "issue": "Non", "betType": "Back" }
		]
	},
	{ "issues": 2,
		"A": [
			{ "market": "/^Total \\w+$/", "issue": "/^(\\d+,\\d+)([+-])$/", "betType": "Back" },
			{ "market": "$market", "issue": "$1$2~+-", "betType": "Lay" }
		],
		"B": [
			{ "market": "$market", "issue": "$1$2", "betType": "Lay" },
			{ "market": "$market", "issue": "$1$2~+-", "betType": "Back" }
		]
	},
	{ "issues": 2,
		"A": [
			{ "market": "Asian Handicap", "issue": "/^(1|2) \\(\\+(\\d+,\\d+)\\)$/", "betType": "Back" },
			{ "market": "Asian Handicap", "issue": "$1~12 (-$2)", "betType": "Lay" }
		],
		"B": [
			{ "market": "Asian Handicap", "issue": "$1 (+$2)", "betType": "Lay" },
			{ "market": "Asian Handicap", "issue": "$1~12 (-$2)", "betType": "Back" }
		]
	}
];

const MIN_GAP_MS = 90 * 60 * 1000;

// ===== HELPERS =====

function isExchange(val) {
	return val !== null && typeof val === 'object' && !Array.isArray(val) && ('Back' in val || 'Lay' in val);
}

function getBackOdds(val) {
	if (typeof val === 'number') return val;
	if (isExchange(val)) return val.Back?.odds_net ?? val.Back?.odds ?? null;
	if (val && typeof val === 'object' && typeof val.odds === 'number') return val.odds;
	return null;
}

function getLayInfo(val) {
	if (!isExchange(val) || !val.Lay) return null;
	const lGross = val.Lay.odds ?? null;
	const lNet = val.Lay.odds_net ?? null;
	if (!lNet || lNet <= 1) return null;
	const c = (lGross && lGross > 1) ? 1 - (lNet - 1) / (lGross - 1) : 0;
	const k = (lGross && lGross > 1) ? (lGross - c) / (1 - c) : lNet;
	return { lGross: lGross ?? lNet, lNet, c, k };
}

function kFromLay(lGross, c) { return (lGross - c) / (1 - c); }
function kFromBk(odds) { return odds / (odds - 1); }

function norm(s) { return s.toLowerCase().trim().replace(/[:.;,!?]+$/, ''); }

function collectSites(data) {
	const sites = new Set();
	for (const event of Object.values(data)) {
		for (const market of Object.values(event.markets || {})) {
			for (const oddsMap of Object.values(market)) {
				if (oddsMap && typeof oddsMap === 'object' && !Array.isArray(oddsMap)) {
					for (const [site, val] of Object.entries(oddsMap))
						if (val && typeof val === 'object') sites.add(site);
				}
			}
		}
	}
	return [...sites].sort();
}

function findDcMarket(markets) {
	for (const [name, market] of Object.entries(markets))
		if (/double.?chance|chance\s+double/i.test(name)) return [name, market];
	return null;
}

function findRes12Market(markets) {
	// Prioritise "Résultats" / "Result" style markets (3 outcomes, no DC keyword)
	for (const [name, market] of Object.entries(markets)) {
		if (/double.?chance|chance\s+double/i.test(name)) continue;
		const keys = Object.keys(market);
		if (keys.length === 3) return [name, market];
	}
	return null;
}

function eventDisplayName(eventKey, event) {
	if (Array.isArray(event.opponents) && event.opponents.length >= 2)
		return event.opponents.join(' vs ');
	if (event.opponents && typeof event.opponents === 'object') {
		const vals = Object.values(event.opponents);
		if (vals.length >= 2) return vals.join(' vs ');
	}
	const m = eventKey.match(/^[^_]+_(.+?)_\d{4}-\d{2}-\d{2}/);
	return m ? m[1] : eventKey;
}

function formatDate(dt) {
	if (!dt) return '';
	try {
		const d = new Date(dt);
		return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
			+ ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	} catch { return ''; }
}

function esc(s) {
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(n, d = 2) { return Number(n).toFixed(d).replace('.', ','); }

function rateClass(rate) {
	if (rate >= 0.75) return 'ff-rate-good';
	if (rate >= 0.55) return 'ff-rate-ok';
	return 'ff-rate-bad';
}

function rateClassCash(rate) {
	if (rate >= 0.97) return 'ff-rate-good';
	if (rate >= 0.93) return 'ff-rate-ok';
	return 'ff-rate-bad';
}

// ===== COVERAGE RULES ENGINE =====

function isRegexStr(s) { return typeof s === 'string' && s.startsWith('/'); }

function parseRegexStr(s) {
	const m = s.match(/^\/(.*)\/([gimsuy]*)$/);
	return m ? new RegExp(m[1], m[2] || 'i') : null;
}

// Resolve a template: substitutes $market, $1, $2 etc., with optional ~12 or ~+- transforms.
function resolveTemplate(template, bindings) {
	return template.replace(/\$(\w+)(~[^\s$]+)?/g, (_, ref, transform) => {
		let val = ref === 'market' ? (bindings.$market || '') : (bindings[`$${ref}`] ?? '');
		if (transform === '~12')
			val = val.replace(/1/g, '\x00').replace(/2/g, '1').replace(/\x00/g, '2');
		else if (transform === '~+-')
			val = val.replace(/\+/g, '\x00').replace(/-/g, '+').replace(/\x00/g, '-');
		return val;
	});
}

// Match a rule bet-spec against (marketName, outcomeName).
// Returns bindings {$market, $1, ...} or null if no match.
function matchBetSpec(spec, marketName, outcomeName) {
	let bindings = {};
	if (isRegexStr(spec.market)) {
		const re = parseRegexStr(spec.market);
		const m = re && marketName.match(re);
		if (!m) return null;
		bindings.$market = marketName;
		for (let i = 1; i < m.length; i++) bindings[`$m${i}`] = m[i];
	} else if (spec.market.includes('$')) {
		return null; // template market — not usable as a primary match spec
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

// Resolve a cover spec using bindings. Returns {market, issue, betType} or null.
function resolveCoverSpec(spec, bindings) {
	if (isRegexStr(spec.market)) return null;
	const market = resolveTemplate(spec.market, bindings);
	const issue  = resolveTemplate(spec.issue,  bindings);
	return (market && issue) ? { market, issue, betType: spec.betType } : null;
}

// Find a market in event.markets by normalised name. Returns [name, market] or null.
function findMarketEntry(markets, marketName) {
	const n = norm(marketName);
	for (const [name, market] of Object.entries(markets))
		if (norm(name) === n) return [name, market];
	return null;
}

// Find an outcome in a market by normalised name. Returns [name, oddsMap] or null.
function findOutcomeEntry(market, outcomeName) {
	const n = norm(outcomeName);
	for (const [name, oddsMap] of Object.entries(market))
		if (norm(name) === n) return [name, oddsMap];
	return null;
}

// ===== COVER SEARCH (Method 1) =====

// For a given main bet outcome, find all covers based on coverage rules.
// Returns array of cover objects: { type, site, marketName, outcomeName, odds, lGross, c, k }
function findCoversForOutcome(event, mainMarketName, mainOutcomeName, _mainOddsMap, fbSite) {
	const covers = [];
	const seen = new Set();

	for (const rule of _coverageRules) {
		if (rule.issues !== 2) continue;
		const sideKeys = ['A', 'B'].filter(k => rule[k]);
		for (const sideAKey of sideKeys) {
			const sideBKey = sideKeys.find(k => k !== sideAKey);
			for (const opt of rule[sideAKey]) {
				if (opt.betType !== 'Back') continue;
				const bindings = matchBetSpec(opt, mainMarketName, mainOutcomeName);
				if (!bindings) continue;
				// Main bet matched sideA — all sideB options are valid covers
				for (const coverOpt of rule[sideBKey]) {
					const resolved = resolveCoverSpec(coverOpt, bindings);
					if (!resolved) continue;
					const mEntry = findMarketEntry(event.markets || {}, resolved.market);
					if (!mEntry) continue;
					const [mName, mData] = mEntry;
					const oEntry = findOutcomeEntry(mData, resolved.issue);
					if (!oEntry) continue;
					const [oName, oddsMap] = oEntry;
					for (const [site, val] of Object.entries(oddsMap)) {
						if (site === fbSite) continue;
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
				break; // First matching Back option per side is enough
			}
		}
	}
	return covers;
}

// Collect all single-leg options: {eventKey, evName, ..., b, covers, bestCover, bestK}
function collectLegs(data, fbSite) {
	const legs = [];
	for (const [eventKey, event] of Object.entries(data)) {
		const evName = eventDisplayName(eventKey, event);
		const evDate = formatDate(event.dateTime);
		const evComp = event.competition || event.tournoi || '';
		const dateTime = event.dateTime ? new Date(event.dateTime).getTime() : null;

		for (const [marketName, market] of Object.entries(event.markets || {})) {
			for (const [outcomeName, oddsMap] of Object.entries(market)) {
				if (!oddsMap || typeof oddsMap !== 'object' || Array.isArray(oddsMap)) continue;
				const fbVal = oddsMap[fbSite];
				if (fbVal == null) continue;
				const b = getBackOdds(fbVal);
				if (!b || b <= 1) continue;

				const covers = findCoversForOutcome(event, marketName, outcomeName, oddsMap, fbSite);
				if (!covers.length) continue;

				const bestCover = covers.reduce((best, cov) => cov.k < best.k ? cov : best);
				legs.push({ eventKey, evName, evDate, evComp, dateTime, marketName, outcomeName, b, covers, bestCover, bestK: bestCover.k });
			}
		}
	}
	return legs;
}

// ===== METHOD 1: SEQUENTIAL DUTCHING =====

const TOP_MULTI_M1 = 50; // legs conservés pour les boucles multileg

function stakeAndLiability(profit, kPrev, cover) {
	const gain = cover.type === 'lay' ? (1 - cover.c) : (cover.odds - 1);
	const stake = profit * kPrev / gain;
	const liability = cover.type === 'lay' ? stake * (cover.lGross - 1) : null;
	return { stake, liability };
}

// Cash cover: stake = T / gain, where T is the target total return.
function stakeAndLiabilityCash(T, cover) {
	const gain = cover.type === 'lay' ? (1 - cover.c) : (cover.odds - 1);
	const stake = T / gain;
	const liability = cover.type === 'lay' ? stake * (cover.lGross - 1) : null;
	return { stake, liability };
}

function computeM1(data, fbSite, amount, nLegs, betType = 'fb') {
	const legs = collectLegs(data, fbSite);
	const results = [];

	if (betType === 'cash') {
		const legsForMulti = nLegs > 1
			? [...legs].sort((a, b) => b.b / b.bestK - a.b / a.bestK).slice(0, TOP_MULTI_M1)
			: legs;

		if (nLegs === 1) {
			for (const leg of legs) {
				for (const cover of leg.covers) {
					const rate = leg.b / cover.k;
					const T = amount * rate;
					const { stake, liability } = stakeAndLiabilityCash(T, cover);
					results.push({
						method: 1, nLegs: 1, betType: 'cash',
						B: leg.b, rate, loss: amount * (1 - rate),
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

	// Pour multileg : garder seulement les meilleurs legs individuels
	// (le taux multi-leg ≈ produit des taux individuels → top legs → top combos)
	const legsForMulti = nLegs > 1
		? [...legs].sort((a, b) => (b.b - 1) / b.bestK - (a.b - 1) / a.bestK).slice(0, TOP_MULTI_M1)
		: legs;

	if (nLegs === 1) {
		for (const leg of legs) {
			for (const cover of leg.covers) {
				const profit = amount * (leg.b - 1) / cover.k;
				const rate = profit / amount;
				const { stake, liability } = stakeAndLiability(profit, 1, cover);
				results.push({
					method: 1, nLegs: 1,
					B: leg.b, profit, rate,
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

				const B = l1.b * l2.b;
				const K = l1.bestK * l2.bestK;
				const profit = amount * (B - 1) / K;
				const rate = profit / amount;
				const s1 = stakeAndLiability(profit, 1, l1.bestCover);
				const s2 = stakeAndLiability(profit, l1.bestK, l2.bestCover);
				results.push({
					method: 1, nLegs: 2,
					B, profit, rate,
					gaps: [l2.dateTime - l1.dateTime],
					legs: [
						{ ...l1, cover: l1.bestCover, ...s1 },
						{ ...l2, cover: l2.bestCover, ...s2 },
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
					results.push({
						method: 1, nLegs: 3,
						B, profit, rate,
						gaps: [l2.dateTime - l1.dateTime, l3.dateTime - l2.dateTime],
						legs: [
							{ ...l1, cover: l1.bestCover, ...s1 },
							{ ...l2, cover: l2.bestCover, ...s2 },
							{ ...l3, cover: l3.bestCover, ...s3 },
						],
					});
				}
			}
		}
	}

	return results.sort((a, b) => b.rate - a.rate);
}

// ===== METHOD 2: ALL-FREEBET COVERING SETS =====

// Profit égal sur toutes les issues : stake_i = P/(o_i-1), total = ∑stake_i = amount
// → P = amount / ∑(1/(o_i-1))  ;  rate = P/amount = 1/∑(1/(o_i-1))
function finalizeM2Bets(rawBets, totalAmount) {
	const sumInv = rawBets.reduce((s, b) => s + 1 / (b.odds - 1), 0);
	if (!isFinite(sumInv) || sumInv <= 0) return null;
	const rate = 1 / sumInv;
	const profit = totalAmount * rate;
	const bets = rawBets.map(b => ({ ...b, stake: profit / (b.odds - 1) }));
	return { rate, profit, bets };
}

// Cash: retour égal sur toutes les issues : stake_i = T/o_i, total = ∑stake_i = amount
// → T = amount / ∑(1/o_i)  ;  rate = T/amount = 1/∑(1/o_i)
function finalizeM2CashBets(rawBets, totalAmount) {
	const sumInv = rawBets.reduce((s, b) => s + 1 / b.odds, 0);
	if (!isFinite(sumInv) || sumInv <= 0) return null;
	const rate = 1 / sumInv;
	const totalReturn = totalAmount * rate;
	const bets = rawBets.map(b => ({ ...b, stake: totalReturn / b.odds }));
	return { rate, loss: totalAmount * (1 - rate), bets };
}

function finalizeBets(rawBets, amount, betType) {
	return betType === 'cash' ? finalizeM2CashBets(rawBets, amount) : finalizeM2Bets(rawBets, amount);
}

const TOP_EVENTS_M2 = 30; // matchs conservés pour les boucles multi-match M2

// Score d'un match pour M2 : meilleur taux single-match sur ses partitions DC
// Fallback sur 1X2 si aucun marché DC disponible.
function scoreEventM2(data, eventKey) {
	let best = 0;
	for (const p of dcPartitions(data, eventKey)) {
		const oDC   = bestCombinedOdds(data, [{ eventKey, marketName: p.dcMarket,   outcomeName: p.dcOutcome   }]);
		const oComp = bestCombinedOdds(data, [{ eventKey, marketName: p.compMarket, outcomeName: p.compOutcome }]);
		if (!oDC || !oComp) continue;
		const r = 1 / (1 / (oDC.odds - 1) + 1 / (oComp.odds - 1));
		if (r > best) best = r;
	}
	// Fallback : score depuis le marché 1X2 direct
	if (best === 0) {
		const res12 = findRes12Market(data[eventKey]?.markets || {});
		if (res12) {
			const [mkt, map] = res12;
			const outs = Object.keys(map);
			if (outs.length === 3) {
				const arr = outs.map(o => bestCombinedOdds(data, [{ eventKey, marketName: mkt, outcomeName: o }]));
				if (arr.every(Boolean)) best = 1 / arr.reduce((s, b) => s + 1 / (b.odds - 1), 0);
			}
		}
	}
	return best;
}

function topEventsForM2(data) {
	return Object.keys(data)
		.map(ek => ({ ek, score: scoreEventM2(data, ek) }))
		.filter(x => x.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, TOP_EVENTS_M2)
		.map(x => x.ek);
}

// Best combined odds for a list of legs [{eventKey, marketName, outcomeName}]
// Each site must offer ALL legs. Returns {site, odds} or null.
function bestCombinedOdds(data, betLegs) {
	const siteOddsPerLeg = betLegs.map(({ eventKey, marketName, outcomeName }) => {
		const market = data[eventKey]?.markets?.[marketName];
		const oddsMap = market?.[outcomeName];
		if (!oddsMap) return {};
		const map = {};
		for (const [site, val] of Object.entries(oddsMap)) {
			if (isExchange(val)) continue;
			const o = typeof val === 'number' ? val : (val?.odds ?? null);
			if (o && o > 1) map[site] = o;
		}
		return map;
	});

	// Sites that appear in all legs
	const sites = Object.keys(siteOddsPerLeg[0] || {}).filter(s => siteOddsPerLeg.every(m => s in m));
	if (!sites.length) return null;

	let best = null;
	for (const site of sites) {
		const odds = betLegs.reduce((prod, _, i) => prod * siteOddsPerLeg[i][site], 1);
		if (!best || odds > best.odds) best = { site, odds };
	}
	return best;
}

// Generate all 2^n bets for a covering set defined by partitions
// partitions[i] = {dcMarket, dcOutcome, compMarket, compOutcome, eventKey}
// mask bit i = 0 → use dc, bit i = 1 → use comp
function generateCoveringBets(eventKeys, partitions) {
	const n = partitions.length;
	const bets = [];
	for (let mask = 0; mask < (1 << n); mask++) {
		const bet = partitions.map((p, i) => ({
			eventKey: eventKeys[i],
			marketName: (mask >> i) & 1 ? p.compMarket : p.dcMarket,
			outcomeName: (mask >> i) & 1 ? p.compOutcome : p.dcOutcome,
		}));
		bets.push(bet);
	}
	return bets;
}

// 2-way covering partitions for a single match, based on coverage rules.
// Returns [{dcMarket, dcOutcome, compMarket, compOutcome}] (same interface as before).
function dcPartitions(data, eventKey) {
	const event = data[eventKey];
	if (!event) return [];
	const partitions = [];
	const seen = new Set();

	for (const rule of _coverageRules) {
		if (rule.issues !== 2) continue;
		const sideKeys = ['A', 'B'].filter(k => rule[k]);
		if (sideKeys.length !== 2) continue;

		for (let ai = 0; ai < 2; ai++) {
			const sideAKey = sideKeys[ai];
			const sideBKey = sideKeys[1 - ai];
			for (const [marketName, market] of Object.entries(event.markets || {})) {
				for (const [outcomeName] of Object.entries(market)) {
					// Find first Back option in sideA that matches this (market, outcome)
					let bindings = null;
					for (const opt of rule[sideAKey]) {
						if (opt.betType !== 'Back') continue;
						bindings = matchBetSpec(opt, marketName, outcomeName);
						if (bindings) break;
					}
					if (!bindings) continue;
					// Find best available Back option from sideB
					let bestB = null;
					for (const coverOpt of rule[sideBKey]) {
						if (coverOpt.betType !== 'Back') continue;
						const resolved = resolveCoverSpec(coverOpt, bindings);
						if (!resolved) continue;
						const mEntry = findMarketEntry(event.markets, resolved.market);
						if (!mEntry) continue;
						const [bMkt, bMktData] = mEntry;
						const oEntry = findOutcomeEntry(bMktData, resolved.issue);
						if (!oEntry) continue;
						const [bOut] = oEntry;
						const best = bestCombinedOdds(data, [{ eventKey, marketName: bMkt, outcomeName: bOut }]);
						if (!best) continue;
						if (!bestB || best.odds > bestB.odds)
							bestB = { marketName: bMkt, outcomeName: bOut };
					}
					if (!bestB) continue;
					const key = [marketName + ':' + outcomeName, bestB.marketName + ':' + bestB.outcomeName].sort().join('|');
					if (seen.has(key)) continue; seen.add(key);
					partitions.push({ dcMarket: marketName, dcOutcome: outcomeName,
						compMarket: bestB.marketName, compOutcome: bestB.outcomeName });
				}
			}
		}
	}
	return partitions;
}

function computeM2(data, amount, nMatches, betType = 'fb') {
	const allEventKeys = Object.keys(data);
	// Pour nMatches=1 on utilise tous les matchs ; pour multi on filtre top-N
	const eventKeys = nMatches === 1 ? allEventKeys : topEventsForM2(data);
	const results = [];
	// Déduplication : garder seulement le meilleur taux par combinaison de matchs
	const bestPerCombo = new Map();

	if (nMatches === 1) {
		for (const eventKey of eventKeys) {
			const event = data[eventKey];

			const partitions = dcPartitions(data, eventKey);
			// Pattern A: DC + single (2 freebets) — one per partition
			for (const p of partitions) {
				const oDC = bestCombinedOdds(data, [{ eventKey, marketName: p.dcMarket, outcomeName: p.dcOutcome }]);
				const oSingle = bestCombinedOdds(data, [{ eventKey, marketName: p.compMarket, outcomeName: p.compOutcome }]);
				if (!oDC || !oSingle) continue;
				const raw = [
					{ legs: [{ eventKey, marketName: p.dcMarket, outcomeName: p.dcOutcome }], site: oDC.site, odds: oDC.odds },
					{ legs: [{ eventKey, marketName: p.compMarket, outcomeName: p.compOutcome }], site: oSingle.site, odds: oSingle.odds },
				];
				const fin = finalizeBets(raw, amount, betType);
				if (!fin) continue;
				results.push({ method: 2, nMatches: 1, nBets: 2, ...fin, totalAmount: amount, eventKeys: [eventKey], betType });
			}

			// Pattern B: 1 + X + 2 (3 freebets)
			const res12Entry = findRes12Market(event.markets || {});
			if (res12Entry) {
				const [res12Market, res12Map] = res12Entry;
				const raw = [];
				let valid = true;
				for (const o of Object.keys(res12Map)) {
					const best = bestCombinedOdds(data, [{ eventKey, marketName: res12Market, outcomeName: o }]);
					if (!best) { valid = false; break; }
					raw.push({ legs: [{ eventKey, marketName: res12Market, outcomeName: o }], site: best.site, odds: best.odds });
				}
				if (valid && raw.length === 3) {
					const fin = finalizeBets(raw, amount, betType);
					if (fin) results.push({ method: 2, nMatches: 1, nBets: 3, ...fin, totalAmount: amount, eventKeys: [eventKey], betType });
				}
			}
		}
	} else if (nMatches === 2) {
		for (let i = 0; i < eventKeys.length; i++) {
			const ek1 = eventKeys[i];
			const ev1 = data[ek1];
			for (let j = i + 1; j < eventKeys.length; j++) {
				const ek2 = eventKeys[j];
				const ev2 = data[ek2];
				const comboKey = [ek1, ek2].sort().join('|');

				const parts1 = dcPartitions(data, ek1);
				const parts2 = dcPartitions(data, ek2);

				// DC × DC (4 bets)
				for (const p1 of parts1) {
					for (const p2 of parts2) {
						const betsSpec = generateCoveringBets([ek1, ek2], [p1, p2]);
						const raw = [];
						let valid = true;
						for (const betLegs of betsSpec) {
							const best = bestCombinedOdds(data, betLegs);
							if (!best) { valid = false; break; }
							raw.push({ legs: betLegs, site: best.site, odds: best.odds });
						}
						if (!valid) continue;
						const fin = finalizeBets(raw, amount, betType);
						if (!fin) continue;
						const entry = { method: 2, nMatches: 2, nBets: 4, ...fin, totalAmount: amount, eventKeys: [ek1, ek2], betType };
						const prev = bestPerCombo.get(comboKey);
						if (!prev || fin.rate > prev.rate) bestPerCombo.set(comboKey, entry);
					}
				}

				// 1X2 × 1X2 (9 bets)
				const res1 = findRes12Market(ev1.markets || {});
				const res2 = findRes12Market(ev2.markets || {});
				if (res1 && res2) {
					const [r1name, r1map] = res1;
					const [r2name, r2map] = res2;
					const raw = [];
					let valid = true;
					for (const o1 of Object.keys(r1map)) {
						for (const o2 of Object.keys(r2map)) {
							const betLegs = [
								{ eventKey: ek1, marketName: r1name, outcomeName: o1 },
								{ eventKey: ek2, marketName: r2name, outcomeName: o2 },
							];
							const best = bestCombinedOdds(data, betLegs);
							if (!best) { valid = false; break; }
							raw.push({ legs: betLegs, site: best.site, odds: best.odds });
						}
						if (!valid) break;
					}
					if (valid && raw.length === 9) {
						const fin = finalizeBets(raw, amount, betType);
						if (fin) {
							const entry = { method: 2, nMatches: 2, nBets: 9, ...fin, totalAmount: amount, eventKeys: [ek1, ek2], betType };
							const prev = bestPerCombo.get(comboKey);
							if (!prev || fin.rate > prev.rate) bestPerCombo.set(comboKey, entry);
						}
					}
				}
			}
		}
	} else if (nMatches === 3) {
		for (let i = 0; i < eventKeys.length; i++) {
			const ek1 = eventKeys[i];
			for (let j = i + 1; j < eventKeys.length; j++) {
				const ek2 = eventKeys[j];
				for (let m = j + 1; m < eventKeys.length; m++) {
					const ek3 = eventKeys[m];
					const comboKey = [ek1, ek2, ek3].sort().join('|');

					// DC × DC × DC (8 bets)
					const parts1 = dcPartitions(data, ek1);
					const parts2 = dcPartitions(data, ek2);
					const parts3 = dcPartitions(data, ek3);

					for (const p1 of parts1) {
						for (const p2 of parts2) {
							for (const p3 of parts3) {
								const betsSpec = generateCoveringBets([ek1, ek2, ek3], [p1, p2, p3]);
								const raw = [];
								let valid = true;
								for (const betLegs of betsSpec) {
									const best = bestCombinedOdds(data, betLegs);
									if (!best) { valid = false; break; }
									raw.push({ legs: betLegs, site: best.site, odds: best.odds });
								}
								if (!valid) continue;
								const fin = finalizeBets(raw, amount, betType);
								if (!fin) continue;
								const entry = { method: 2, nMatches: 3, nBets: 8, ...fin, totalAmount: amount, eventKeys: [ek1, ek2, ek3], betType };
								const prev = bestPerCombo.get(comboKey);
								if (!prev || fin.rate > prev.rate) bestPerCombo.set(comboKey, entry);
							}
						}
					}

					// 1X2 × 1X2 × 1X2 (27 bets)
					const res1 = findRes12Market(data[ek1]?.markets || {});
					const res2 = findRes12Market(data[ek2]?.markets || {});
					const res3 = findRes12Market(data[ek3]?.markets || {});
					if (res1 && res2 && res3) {
						const [r1n, r1m] = res1;
						const [r2n, r2m] = res2;
						const [r3n, r3m] = res3;
						const raw = [];
						let valid = true;
						for (const o1 of Object.keys(r1m)) {
							for (const o2 of Object.keys(r2m)) {
								for (const o3 of Object.keys(r3m)) {
									const betLegs = [
										{ eventKey: ek1, marketName: r1n, outcomeName: o1 },
										{ eventKey: ek2, marketName: r2n, outcomeName: o2 },
										{ eventKey: ek3, marketName: r3n, outcomeName: o3 },
									];
									const best = bestCombinedOdds(data, betLegs);
									if (!best) { valid = false; break; }
									raw.push({ legs: betLegs, site: best.site, odds: best.odds });
								}
								if (!valid) break;
							}
							if (!valid) break;
						}
						if (valid && raw.length === 27) {
							const fin = finalizeBets(raw, amount, betType);
							if (fin) {
								const entry = { method: 2, nMatches: 3, nBets: 27, ...fin, totalAmount: amount, eventKeys: [ek1, ek2, ek3], betType };
								const prev = bestPerCombo.get(comboKey);
								if (!prev || fin.rate > prev.rate) bestPerCombo.set(comboKey, entry);
							}
						}
					}
				}
			}
		}
	}

	return [...results, ...bestPerCombo.values()].sort((a, b) => b.rate - a.rate);
}

// ===== METHOD 3: MIXED (1 cash cover + FB covering set) =====
//
// 1 match couvert en cash (facteur k), les N-1 autres en FB simultanés.
// Les paris FB contiennent tous la bonne issue DC du match couvert en cash.
// rate_M3 = rate_M2(2^(N-1) paris FB) / k_cash
//
function computeM3(data, amount, nMatches, betType = 'fb') {
	if (nMatches < 2) return [];

	const eventKeys = topEventsForM2(data);
	const bestPerCombo = new Map();

	function saveIfBetter(comboKey, entry) {
		const prev = bestPerCombo.get(comboKey);
		if (!prev || entry.rate > prev.rate) bestPerCombo.set(comboKey, entry);
	}

	function buildM3Entry(cashEk, fbEks, cashPartition, cashCover, fin) {
		const k = cashCover.k;
		const rate = fin.rate / k;
		if (rate <= 0) return null;
		const gain = cashCover.type === 'lay' ? (1 - cashCover.c) : (cashCover.odds - 1);
		let cashStake, cashLiability;
		if (betType === 'cash') {
			// For cash: cover must pay total return T = amount × fin.rate
			const T = amount * fin.rate;
			cashStake = T / gain;
		} else {
			// For freebet: cover must pay profit = amount × rate
			cashStake = (amount * rate) / gain;
		}
		cashLiability = cashCover.type === 'lay' ? cashStake * (cashCover.lGross - 1) : null;
		const profit = amount * rate;
		return { method: 3, nMatches, betType, rate, profit,
			loss: betType === 'cash' ? amount * (1 - rate) : undefined,
			totalAmount: amount,
			cashEk, cashPartition, cashCover, cashStake, cashLiability,
			fbBets: fin.bets, eventKeys: [cashEk, ...fbEks] };
	}

	function tryCashFb(cashEk, fbEks) {
		const cashEvent = data[cashEk];
		const comboKey = [...fbEks, cashEk].sort().join('|') + '|c=' + cashEk;

		// --- Chemin DC (partitions double chance) ---
		const cashParts = dcPartitions(data, cashEk);
		const fbPartsList = fbEks.map(ek => dcPartitions(data, ek));
		if (cashParts.length > 0 && !fbPartsList.some(ps => !ps.length)) {
			for (const p_cash of cashParts) {
				const oddsMap = cashEvent?.markets?.[p_cash.dcMarket]?.[p_cash.dcOutcome];
				if (!oddsMap) continue;
				const covers = findCoversForOutcome(cashEvent, p_cash.dcMarket, p_cash.dcOutcome, oddsMap, '');
				if (!covers.length) continue;
				const bestCover = covers.reduce((best, c) => c.k < best.k ? c : best);

				function iterParts(idx, chosen) {
					if (idx === fbEks.length) {
						const raw = [];
						let valid = true;
						for (let mask = 0; mask < (1 << fbEks.length); mask++) {
							const betLegs = [
								{ eventKey: cashEk, marketName: p_cash.dcMarket, outcomeName: p_cash.dcOutcome },
								...chosen.map((p, i) => ({
									eventKey: fbEks[i],
									marketName: (mask >> i) & 1 ? p.compMarket : p.dcMarket,
									outcomeName: (mask >> i) & 1 ? p.compOutcome : p.dcOutcome,
								})),
							];
							const best = bestCombinedOdds(data, betLegs);
							if (!best) { valid = false; break; }
							raw.push({ legs: betLegs, site: best.site, odds: best.odds });
						}
						if (!valid) return;
						const fin = finalizeBets(raw, amount, betType);
						if (!fin) return;
						const entry = buildM3Entry(cashEk, fbEks, p_cash, bestCover, fin);
						if (entry) saveIfBetter(comboKey, entry);
						return;
					}
					for (const p of fbPartsList[idx]) iterParts(idx + 1, [...chosen, p]);
				}
				iterParts(0, []);
			}
		}

		// --- Chemin 1X2 (fallback sans marché DC) ---
		const res12Cash = findRes12Market(cashEvent?.markets || {});
		const fbRes12List = fbEks.map(ek => findRes12Market(data[ek]?.markets || {}));
		if (res12Cash && !fbRes12List.some(r => !r)) {
			const [r12mkt, r12map] = res12Cash;
			const allCashOuts = Object.keys(r12map);
			if (allCashOuts.length === 3) {
				for (const compOutcome of allCashOuts) {
					const nonComp = allCashOuts.filter(o => o !== compOutcome);
					const oddsMapComp = r12map[compOutcome];
					if (!oddsMapComp) continue;
					let bestCashCover = null;
					for (const [site, val] of Object.entries(oddsMapComp)) {
						let o = typeof val === 'number' ? val
							: (isExchange(val) ? (val.Back?.odds_net ?? val.Back?.odds) : (val?.odds ?? null));
						if (!o || o <= 1) continue;
						const k = kFromBk(o);
						if (!bestCashCover || k < bestCashCover.k)
							bestCashCover = { type: 'bk', site, marketName: r12mkt, outcomeName: compOutcome, odds: o, lGross: null, c: null, k };
					}
					if (!bestCashCover) continue;

					// FB bets : chaque non-comp de A × toutes issues des matchs FB
					function iterFb(fbIdx, tail) {
						if (fbIdx === fbEks.length)
							return nonComp.map(nc => [{ eventKey: cashEk, marketName: r12mkt, outcomeName: nc }, ...tail]);
						const [fm, fmap] = fbRes12List[fbIdx];
						return Object.keys(fmap).flatMap(fo =>
							iterFb(fbIdx + 1, [...tail, { eventKey: fbEks[fbIdx], marketName: fm, outcomeName: fo }])
						);
					}
					const allBetLegs = iterFb(0, []);
					const raw = [];
					let valid = true;
					for (const betLegs of allBetLegs) {
						const best = bestCombinedOdds(data, betLegs);
						if (!best) { valid = false; break; }
						raw.push({ legs: betLegs, site: best.site, odds: best.odds });
					}
					if (!valid) continue;
					const fin = finalizeBets(raw, amount, betType);
					if (!fin) continue;
					const syntheticPartition = { dcMarket: r12mkt, dcOutcome: nonComp.join('/'), compMarket: r12mkt, compOutcome };
					const entry = buildM3Entry(cashEk, fbEks, syntheticPartition, bestCashCover, fin);
					if (entry) saveIfBetter(comboKey, entry);
				}
			}
		}
	}

	if (nMatches === 2) {
		for (let i = 0; i < eventKeys.length; i++) {
			for (let j = i + 1; j < eventKeys.length; j++) {
				tryCashFb(eventKeys[i], [eventKeys[j]]);
				tryCashFb(eventKeys[j], [eventKeys[i]]);
			}
		}
	} else if (nMatches === 3) {
		for (let i = 0; i < eventKeys.length; i++) {
			for (let j = i + 1; j < eventKeys.length; j++) {
				for (let m = j + 1; m < eventKeys.length; m++) {
					const [e1, e2, e3] = [eventKeys[i], eventKeys[j], eventKeys[m]];
					tryCashFb(e1, [e2, e3]);
					tryCashFb(e2, [e1, e3]);
					tryCashFb(e3, [e1, e2]);
				}
			}
		}
	}

	return [...bestPerCombo.values()].sort((a, b) => b.rate - a.rate);
}

// ===== RENDERING =====

function formatGap(ms) {
	const totalMin = Math.round(ms / 60000);
	if (totalMin < 60) return `${totalMin}\u00a0min`;
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function evInfo(leg) {
	return `<span class="ff-ev-name">${esc(leg.evName)}</span>
		<span class="ff-ev-meta">${esc([leg.evComp, leg.evDate].filter(Boolean).join(' · '))}</span>`;
}

function coverBadge(cover) {
	if (cover.type === 'lay') return `<span class="ff-badge ff-badge-lay">Lay</span>`;
	if (cover.type === 'dc')  return `<span class="ff-badge ff-badge-dc">DC</span>`;
	return `<span class="ff-badge ff-badge-bk">Back</span>`;
}

function buildM1LegRow(leg, idx, gap) {
	const gapHtml = gap ? `<span class="ff-gap">+${formatGap(gap)}</span>` : '';
	const stakeDetail = leg.liability != null
		? `${fmt(leg.stake)}\u00a0€ <span class="ff-sub">(liab.\u00a0${fmt(leg.liability)}\u00a0€)</span>`
		: `${fmt(leg.stake)}\u00a0€`;
	const coverOddsDetail = leg.cover.lGross != null
		? `${fmt(leg.cover.odds)} <span class="ff-sub">brut\u00a0${fmt(leg.cover.lGross)}</span>`
		: `${fmt(leg.cover.odds)}`;
	return `
	<div class="ff-leg">
		<div class="ff-leg-left">
			<span class="ff-leg-num">L${idx + 1}</span>
			${gapHtml}
			<div class="ff-ev-wrap">${evInfo(leg)}</div>
		</div>
		<div class="ff-leg-right">
			<span class="ff-leg-market">${esc(leg.marketName)} · <strong>${esc(leg.outcomeName)}</strong></span>
			<span class="ff-leg-back">Back\u00a0: <strong>${fmt(leg.b)}</strong> sur ${esc(leg.cover.type !== 'lay' ? _fbSite : _fbSite)}</span>
			<span class="ff-leg-cover">${esc(leg.cover.site)} ${coverBadge(leg.cover)} ${esc(leg.cover.outcomeName)} · ${coverOddsDetail}</span>
			<span class="ff-leg-stake">Mise couv.\u00a0: <strong>${stakeDetail}</strong></span>
		</div>
	</div>`;
}

function buildM1Card(result) {
	const legRows = result.legs.map((leg, i) =>
		buildM1LegRow(leg, i, i > 0 ? result.gaps[i - 1] : null)
	).join('');
	const totalLiab = result.legs.reduce((s, l) => s + (l.liability ?? 0), 0);
	const liabHtml = totalLiab > 0
		? `<span class="ff-card-liab">Liab. totale <strong>${fmt(totalLiab)}\u00a0€</strong></span>` : '';
	const coverLabel = result.nLegs === 1
		? result.legs[0].cover.type === 'lay' ? 'Lay EX' : (result.legs[0].cover.type === 'dc' ? 'DC BK' : 'Back BK')
		: `${result.nLegs} legs séq.`;
	const isCash = result.betType === 'cash';
	const valueHtml = isCash
		? `<span class="ff-card-profit neg"><strong>−${fmt(result.loss)}\u00a0€</strong></span>`
		: `<span class="ff-card-profit pos"><strong>${fmt(result.profit)}\u00a0€</strong></span>`;
	const rateHtml = `<span class="${isCash ? rateClassCash(result.rate) : rateClass(result.rate)} ff-card-rate">${fmt(result.rate * 100, 1)}\u00a0%</span>`;

	return `
	<div class="ff-card ff-card-m1">
		<div class="ff-card-header">
			<span class="ff-card-type">M1 · ${esc(coverLabel)}</span>
			<span class="ff-card-b">Cote\u00a0: <strong>${fmt(result.B)}</strong></span>
			${liabHtml}
			${valueHtml}
			${rateHtml}
		</div>
		<div class="ff-legs">${legRows}</div>
	</div>`;
}

function buildM2BetRow(bet, idx, betType = 'fb') {
	const legLabels = bet.legs.map(l => {
		const ev = _data?.[l.eventKey];
		const evName = ev ? eventDisplayName(l.eventKey, ev) : l.eventKey;
		return `${esc(evName)}\u00a0<strong>${esc(l.outcomeName)}</strong>`;
	}).join(' + ');
	const returnDetail = betType === 'cash'
		? `${fmt(bet.stake)}\u00a0€ \u00d7 ${fmt(bet.odds)} = <strong>${fmt(bet.stake * bet.odds)}\u00a0€</strong>`
		: `${fmt(bet.stake)}\u00a0€ \u00d7 (${fmt(bet.odds)}\u2212\u20611) = <strong>${fmt(bet.stake * (bet.odds - 1))}\u00a0€</strong>`;
	return `
	<div class="ff-bet">
		<span class="ff-bet-num">FB${idx + 1}</span>
		<div class="ff-bet-desc">
			<span class="ff-bet-legs">${legLabels}</span>
			<span class="ff-bet-site">${esc(bet.site)} · cote <strong>${fmt(bet.odds)}</strong> · mise <strong>${fmt(bet.stake)}\u00a0€</strong></span>
		</div>
		<span class="ff-bet-profit">${returnDetail}</span>
	</div>`;
}

function buildM2Card(result) {
	const isCash = result.betType === 'cash';
	const betRows = result.bets.map((b, i) => buildM2BetRow(b, i, result.betType)).join('');
	const minOdds = Math.min(...result.bets.map(b => b.odds));
	const maxOdds = Math.max(...result.bets.map(b => b.odds));
	const valueHtml = isCash
		? `<span class="ff-card-profit neg"><strong>−${fmt(result.loss)}\u00a0€</strong> perte</span>`
		: `<span class="ff-card-profit pos"><strong>${fmt(result.profit)}\u00a0€</strong> garanti</span>`;
	const rateHtml = `<span class="${isCash ? rateClassCash(result.rate) : rateClass(result.rate)} ff-card-rate">${fmt(result.rate * 100, 1)}\u00a0%</span>`;
	return `
	<div class="ff-card ff-card-m2">
		<div class="ff-card-header">
			<span class="ff-card-type">M2 · ${result.nBets}\u00a0Paris · ${result.nMatches}\u00a0match${result.nMatches > 1 ? 's' : ''}</span>
			<span class="ff-card-b">Cotes\u00a0: ${fmt(minOdds)}\u2013${fmt(maxOdds)}</span>
			<span class="ff-card-totalfb">Total\u00a0: <strong>${fmt(result.totalAmount)}\u00a0€</strong></span>
			${valueHtml}
			${rateHtml}
		</div>
		<div class="ff-bets">${betRows}</div>
	</div>`;
}

function buildM3CashRow(result) {
	const ev = _data?.[result.cashEk];
	const evName = ev ? eventDisplayName(result.cashEk, ev) : result.cashEk;
	const p = result.cashPartition;
	const cover = result.cashCover;
	const stakeDetail = result.cashLiability != null
		? `${fmt(result.cashStake)}\u00a0€ <span class="ff-sub">(liab.\u00a0${fmt(result.cashLiability)}\u00a0€)</span>`
		: `${fmt(result.cashStake)}\u00a0€`;
	const oddsDetail = cover.lGross != null
		? `${fmt(cover.odds)} <span class="ff-sub">brut\u00a0${fmt(cover.lGross)}</span>`
		: `${fmt(cover.odds)}`;
	return `
	<div class="ff-leg ff-leg-cash">
		<div class="ff-leg-left">
			<span class="ff-leg-num ff-leg-num-cash">CASH</span>
			<div class="ff-ev-wrap"><span class="ff-ev-name">${esc(evName)}</span></div>
		</div>
		<div class="ff-leg-right">
			<span class="ff-leg-market">${esc(p.dcMarket)} · <strong>${esc(p.dcOutcome)}</strong> <span class="ff-sub">(en FB)</span></span>
			<span class="ff-leg-cover">${esc(cover.site)} ${coverBadge(cover)} ${esc(cover.outcomeName)} · ${oddsDetail}</span>
			<span class="ff-leg-stake">Mise couv.\u00a0: <strong>${stakeDetail}</strong></span>
		</div>
	</div>`;
}

function buildM3Card(result) {
	const isCash = result.betType === 'cash';
	const cashRow = buildM3CashRow(result);
	const betRows = result.fbBets.map((b, i) => buildM2BetRow(b, i, result.betType)).join('');
	const nFb = result.fbBets.length;
	const valueHtml = isCash
		? `<span class="ff-card-profit neg"><strong>−${fmt(result.loss)}\u00a0€</strong> perte</span>`
		: `<span class="ff-card-profit pos"><strong>${fmt(result.profit)}\u00a0€</strong> garanti</span>`;
	const rateHtml = `<span class="${isCash ? rateClassCash(result.rate) : rateClass(result.rate)} ff-card-rate">${fmt(result.rate * 100, 1)}\u00a0%</span>`;
	return `
	<div class="ff-card ff-card-m3">
		<div class="ff-card-header">
			<span class="ff-card-type">M3 · ${nFb}\u00a0Paris + cash</span>
			<span class="ff-card-b">${result.nMatches}\u00a0match${result.nMatches > 1 ? 's' : ''}</span>
			<span class="ff-card-totalfb">Total\u00a0: <strong>${fmt(result.totalAmount)}\u00a0€</strong></span>
			${valueHtml}
			${rateHtml}
		</div>
		<div class="ff-legs">${cashRow}</div>
		<div class="ff-m3-divider"></div>
		<div class="ff-bets">${betRows}</div>
	</div>`;
}

function renderResults(results) {
	_results = results;
	_visibleCount = 20;
	const el = document.getElementById('ff-results');
	el.hidden = false;

	if (!results.length) {
		el.innerHTML = `<p class="ff-empty">Aucune opportunité trouvée.</p>`;
		return;
	}

	const best = results[0].rate;
	const isCash = _betType === 'cash';
	const label = _method === 1
		? `${results.length} opportunité${results.length > 1 ? 's' : ''}`
		: `${results.length} ensemble${results.length > 1 ? 's' : ''} couvrants`;
	const metricLabel = isCash ? 'meilleur retour' : 'meilleur taux';

	el.innerHTML = `
		<p class="ff-summary">${label} — ${metricLabel}\u00a0: <strong>${fmt(best * 100, 1)}\u00a0%</strong></p>
		<div class="ff-search-row">
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
			<input id="ff-search" class="ff-search-input" placeholder="Rechercher un match…" oninput="renderPage()" />
		</div>
		<div id="ff-cards"></div>
		<div id="ff-more"></div>`;
	renderPage();
}

function renderPage() {
	const cards = document.getElementById('ff-cards');
	const more = document.getElementById('ff-more');
	if (!cards) return;
	const q = (document.getElementById('ff-search')?.value ?? '').trim().toLowerCase();

	const filtered = _results.filter(r => {
		if (!q) return true;
		if (r.method === 1) return r.legs.some(l => l.evName.toLowerCase().includes(q) || l.evComp.toLowerCase().includes(q));
		return r.eventKeys.some(ek => {
			const ev = _data?.[ek];
			if (!ev) return false;
			return eventDisplayName(ek, ev).toLowerCase().includes(q);
		});
	});

	const visible = filtered.slice(0, q ? filtered.length : _visibleCount);
	cards.innerHTML = visible.map(r =>
		r.method === 1 ? buildM1Card(r) : r.method === 3 ? buildM3Card(r) : buildM2Card(r)
	).join('');

	if (more) {
		const remaining = filtered.length - _visibleCount;
		more.innerHTML = !q && remaining > 0
			? `<button class="ff-more-btn" onclick="showMore()">Voir plus (${Math.min(remaining, 20)} sur ${remaining} restants)</button>`
			: '';
	}
}

function showMore() { _visibleCount += 20; renderPage(); }

// ===== UI =====

function setMethod(m) {
	_method = m;
	document.querySelectorAll('.ff-method-btn').forEach(b =>
		b.classList.toggle('ff-btn--active', +b.dataset.method === m)
	);
	const legsLabel = document.getElementById('ff-legs-label');
	if (legsLabel) legsLabel.textContent = m === 1 ? 'Sélections' : 'Matchs à couvrir';
	if (Object.keys(_allResults).length) showCurrentResults();
}

function setLegs(n) {
	_nLegs = n;
	document.querySelectorAll('.ff-legs-btn').forEach(b =>
		b.classList.toggle('ff-btn--active', +b.dataset.legs === n)
	);
	if (Object.keys(_allResults).length) showCurrentResults();
}

function setBetType(t) {
	_betType = t;
	document.querySelectorAll('.ff-bettype-btn').forEach(b =>
		b.classList.toggle('ff-btn--active', b.dataset.bettype === t)
	);
	_allResults = {};
	document.getElementById('ff-results').hidden = true;
}

function showCurrentResults() {
	const key = `${_method}_${_nLegs}`;
	const results = _allResults[key];
	if (results === undefined) {
		const el = document.getElementById('ff-results');
		el.hidden = false;
		el.innerHTML = '<p class="ff-empty">Sélectionnez un site freebet pour calculer M1.</p>';
		return;
	}
	renderResults(results);
}

function tryRender() {
	if (!_data) return;
	_amount = parseFloat(document.getElementById('ff-amount')?.value) || 10;
	_fbSite = document.getElementById('ff-site-select')?.value ?? '';
	_allResults = {};

	// M2 et M3 ne nécessitent pas de site
	for (const n of [1, 2, 3])
		_allResults[`2_${n}`] = computeM2(_data, _amount, n, _betType);
	_allResults[`3_1`] = [];
	for (const n of [2, 3])
		_allResults[`3_${n}`] = computeM3(_data, _amount, n, _betType);

	// M1 seulement si un site est sélectionné
	if (_fbSite) {
		for (const n of [1, 2, 3])
			_allResults[`1_${n}`] = computeM1(_data, _fbSite, _amount, n, _betType);
	}

	showCurrentResults();
}

function onJsonChange() {
	const raw = document.getElementById('ff-json')?.value.trim();
	const errEl = document.getElementById('ff-json-error');
	_allResults = {};
	document.getElementById('ff-results').hidden = true;
	if (!raw) {
		_data = null;
		errEl.hidden = true;
		updateSiteSelect([]);
	} else {
		try {
			_data = JSON.parse(raw);
			errEl.hidden = true;
			updateSiteSelect(collectSites(_data));
		} catch (e) {
			_data = null;
			errEl.textContent = 'JSON invalide : ' + e.message;
			errEl.hidden = false;
			updateSiteSelect([]);
		}
	}
	document.getElementById('ff-calc-btn').disabled = !_data;
}

function updateSiteSelect(sites) {
	const sel = document.getElementById('ff-site-select');
	const field = document.getElementById('ff-site-field');
	if (!sel || !field) return;
	if (!sites.length) {
		field.hidden = true;
		sel.innerHTML = '<option value="">— Sélectionner un site —</option>';
		return;
	}
	sel.innerHTML = '<option value="">— Sélectionner un site —</option>'
		+ sites.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
	field.hidden = false;
}

function stepAmount(delta) {
	const input = document.getElementById('ff-amount');
	input.value = Math.max(1, (parseFloat(input.value) || 0) + delta);
}

async function pasteFromClipboard() {
	const el = document.getElementById('ff-json');
	el.focus();
	el.select();
	// execCommand('paste') est silencieux (pas de dialog) mais déprécié
	if (document.execCommand('paste')) {
		onJsonChange();
		return;
	}
	// Fallback : API clipboard moderne (peut demander une permission la 1ère fois)
	try {
		const text = await navigator.clipboard.readText();
		el.value = text;
		onJsonChange();
	} catch {}
}

document.addEventListener('DOMContentLoaded', async () => {
	// Load coverage rules from external JSON (overrides embedded defaults if successful)
	try {
		const r = await fetch('../assets/coverage-rules.json');
		if (r.ok) _coverageRules = await r.json();
	} catch {}

	if (new URLSearchParams(location.search).get('autopaste') === '1') {
		try {
			const text = await navigator.clipboard.readText();
			if (text) { JSON.parse(text); document.getElementById('ff-json').value = text; onJsonChange(); }
		} catch {}
	}

	const param = new URLSearchParams(location.search).get('data');
	if (param) {
		try {
			const bytes = Uint8Array.from(atob(param), c => c.charCodeAt(0));
			document.getElementById('ff-json').value = new TextDecoder().decode(bytes);
			onJsonChange();
		} catch {}
	}
});
