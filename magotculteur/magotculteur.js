'use strict';

// ===== STATE =====
let _data = null;
let _results = [];
let _allResults = {};   // cache: key = `${method}_${nLegs}` → results array
let _method = 1;   // 1 | 2 | 4
let _betType = 'fb'; // 'fb' | 'cash'
let _nLegs = 1;
let _amount = 10;      // compute amount, toujours = _amountTotal
let _amountTotal = 10;
let _amountMin = 2;
let _amountMode = 'total'; // 'total' | 'min'
let _cashObjective = 'miser'; // 'miser' | 'gagner' | 'perdre'
let _asymCov = false;         // couvertures asymétriques (single + combinés)
let _filterMinOdds = 0;
let _calcCancelled = false;
let _allowedNLegs = new Set([1, 2, 3]);
let _minOddsPerSelection = 0;
let _fbSite = '';
let _visibleCount = 50;

// ===== PREFS (localStorage) =====
const _PREFS_KEY = 'ff_prefs';

function savePrefs() {
	try {
		localStorage.setItem(_PREFS_KEY, JSON.stringify({
			betType: _betType,
			cashObjective: _cashObjective,
			amountTotal: parseFloat(document.getElementById('ff-amount-total')?.value) || _amountTotal,
			amountMin: parseFloat(document.getElementById('ff-amount-min')?.value) || _amountMin,
			amountMode: _amountMode,
			method: _method,
			nLegs: _nLegs,
			asymCov: _asymCov,
			filterMinOdds: _filterMinOdds,
			allowedNLegs: [..._allowedNLegs],
			minOddsPerSelection: _minOddsPerSelection,
			site: document.getElementById('ff-site-select')?.value ?? '',
		}));
	} catch {}
}

function loadPrefs() {
	try { return JSON.parse(localStorage.getItem(_PREFS_KEY) || '{}'); } catch { return {}; }
}

// Coverage rules — chargées depuis coverage-rules.json au démarrage (requis)
let _coverageRules = [];

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
						// Pour un Lay, on ne peut pas couvrir sur le même site que le back
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
				if (_filterMinOdds > 0 && b < _filterMinOdds) continue;

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

const TOP_MULTI_SEQ = 50; // legs conservés pour les boucles multileg

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

// Best odds on fbSite for a cover outcome (Back covers only — freebets are back bets).
// Returns the cover object augmented with the fbSite odds, or null if unavailable.
function bestFbCoverOdds(leg, data, fbSite) {
	let best = null;
	for (const cover of leg.covers) {
		if (cover.type !== 'bk') continue;
		const val = data[leg.eventKey]?.markets?.[cover.marketName]?.[cover.outcomeName]?.[fbSite];
		const o = getBackOdds(val);
		if (!o || o <= 1) continue;
		if (_filterMinOdds > 0 && o < _filterMinOdds) continue;
		if (!best || o > best.odds) best = { ...cover, odds: o };
	}
	return best;
}

function computeSeq(data, fbSite, amount, nLegs, betType = 'fb') {
	const legs = collectLegs(data, fbSite);
	const results = [];

	if (betType === 'cash') {
		const legsForMulti = nLegs > 1
			? [...legs].sort((a, b) => b.b / b.bestK - a.b / a.bestK).slice(0, TOP_MULTI_SEQ)
			: legs;

		if (nLegs === 1) {
			for (const leg of legs) {
				for (const cover of leg.covers) {
					const gain = cover.type === 'lay' ? (1 - cover.c) : (cover.odds - 1);
					let stake, liability, rate, loss, netIfWins, netIfLoses;

					if (_cashObjective === 'gagner') {
						// Cover rembourse amount si back perd
						stake = amount / gain;
						liability = cover.type === 'lay' ? stake * (cover.lGross - 1) : null;
						netIfLoses = 0;
						// Si back gagne : lay perd sa liability (pas juste le stake)
						const coverCostGagner = cover.type === 'lay' ? liability : stake;
						netIfWins = amount * (leg.b - 1) - coverCostGagner;
						rate = netIfWins / amount;
						loss = -Math.min(netIfWins, 0);
					} else if (_cashObjective === 'perdre') {
						// Cover neutralise le gain si back gagne
						// Pour un lay : la liability doit absorber le gain → stake = amount*(b-1)/(lGross-1)
						const gainForStake = cover.type === 'lay' ? (cover.lGross - 1) : (cover.odds - 1);
						stake = amount * (leg.b - 1) / gainForStake;
						liability = cover.type === 'lay' ? stake * (cover.lGross - 1) : null;
						// netIfWins = amount*(b-1) - liability = 0 par construction
						netIfWins = 0;
						// Si back perd : cover gagne (lay gagne stake*gain, back cover gagne stake*(odds-1))
						netIfLoses = cover.type === 'lay' ? (stake * gain - amount) : (stake * (cover.odds - 1) - amount);
						rate = 1 + netIfLoses / amount;    // fraction de amount récupérée si back perd
						loss = -netIfLoses;
					} else {
						// miser : équilibré
						rate = leg.b / cover.k;
						const T = amount * rate;
						({ stake, liability } = stakeAndLiabilityCash(T, cover));
						netIfWins = netIfLoses = -amount * (1 - rate);
						loss = amount * (1 - rate);
					}

					results.push({
						method: 1, nLegs: 1, betType: 'cash', _cashObjective,
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

	// Pour multileg : garder seulement les meilleurs legs individuels
	// (le taux multi-leg ≈ produit des taux individuels → top legs → top combos)
	const legsForMulti = nLegs > 1
		? [...legs].sort((a, b) => (b.b - 1) / b.bestK - (a.b - 1) / a.bestK).slice(0, TOP_MULTI_SEQ)
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
				// Variante Fb : couvertures aussi en freebet sur fbSite
				const fb1 = bestFbCoverOdds(l1, data, fbSite);
				const fb2 = bestFbCoverOdds(l2, data, fbSite);
				const profitFb = (fb1 && fb2)
					? amount * Math.min(B - 1, fb1.odds - 1, fb2.odds - 1)
					: null;
				results.push({
					method: 1, nLegs: 2,
					B, profit, rate,
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
					// Variante Fb
					const fb1 = bestFbCoverOdds(l1, data, fbSite);
					const fb2 = bestFbCoverOdds(l2, data, fbSite);
					const fb3 = bestFbCoverOdds(l3, data, fbSite);
					const profitFb = (fb1 && fb2 && fb3)
						? amount * Math.min(B - 1, fb1.odds - 1, fb2.odds - 1, fb3.odds - 1)
						: null;
					results.push({
						method: 1, nLegs: 3,
						B, profit, rate,
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

// ===== METHOD 2: ALL-FREEBET COVERING SETS =====

// Profit égal sur toutes les issues : stake_i = P/(o_i-1), total = ∑stake_i = amount
// → P = amount / ∑(1/(o_i-1))  ;  rate = P/amount = 1/∑(1/(o_i-1))
function finalizeToutFBBets(rawBets, totalAmount) {
	const sumInv = rawBets.reduce((s, b) => s + 1 / (b.odds - 1), 0);
	if (!isFinite(sumInv) || sumInv <= 0) return null;
	const rate = 1 / sumInv;
	const profit = totalAmount * rate;
	const bets = rawBets.map(b => ({ ...b, stake: profit / (b.odds - 1) }));
	return { rate, profit, bets };
}

// Cash: retour égal sur toutes les issues : stake_i = T/o_i, total = ∑stake_i = amount
// → T = amount / ∑(1/o_i)  ;  rate = T/amount = 1/∑(1/o_i)
function finalizeToutFBCashBets(rawBets, totalAmount) {
	const sumInv = rawBets.reduce((s, b) => s + 1 / b.odds, 0);
	if (!isFinite(sumInv) || sumInv <= 0) return null;
	const rate = 1 / sumInv;
	const totalReturn = totalAmount * rate;
	const bets = rawBets.map(b => ({ ...b, stake: totalReturn / b.odds }));
	return { rate, loss: totalAmount * (1 - rate), bets };
}

function finalizeBets(rawBets, amount, betType) {
	return betType === 'cash' ? finalizeToutFBCashBets(rawBets, amount) : finalizeToutFBBets(rawBets, amount);
}

// ===== COVERING SET HELPERS (used by Couverture complète) =====

// First Back leg for a rule side in an event's markets. Returns null if not found.
function ruleSideBackLeg(rule, sideKey, event, eventKey) {
	for (const opt of (rule[sideKey] || [])) {
		if (opt.betType !== 'Back') continue;
		for (const [marketName, market] of Object.entries(event.markets || {})) {
			for (const [outcomeName] of Object.entries(market)) {
				if (matchBetSpec(opt, marketName, outcomeName))
					return { eventKey, marketName, outcomeName };
			}
		}
	}
	return null;
}

// All complete covering sets for an event from ALL rules (issues:2 → 2 legs, issues:3 → 3 legs, …).
// Returns [[{eventKey, marketName, outcomeName}, ...], ...]
function getCoverSets(data, eventKey) {
	const event = data[eventKey];
	if (!event) return [];
	const sets = [];
	const seen = new Set();
	for (const rule of _coverageRules) {
		const sideKeys = ['A', 'B', 'C'].filter(k => rule[k]);
		if (sideKeys.length < 2) continue;
		const legs = sideKeys.map(k => ruleSideBackLeg(rule, k, event, eventKey));
		if (legs.some(l => !l)) continue;
		const key = legs.map(l => l.marketName + ':' + l.outcomeName).sort().join('|');
		if (seen.has(key)) continue;
		seen.add(key);
		sets.push(legs);
	}
	return sets;
}

// Asymmetric splits: for each rule where all sides match, each side can be the "single",
// the remaining sides become the "combined" M1 legs.
// Returns [{singleLeg, combinedLegs[]}, ...]
function getAsymSplits(data, eventKey) {
	const event = data[eventKey];
	if (!event) return [];
	const splits = [];
	const seen = new Set();
	for (const rule of _coverageRules) {
		const sideKeys = ['A', 'B', 'C'].filter(k => rule[k]);
		if (sideKeys.length < 2) continue;
		const legs = sideKeys.map(k => ruleSideBackLeg(rule, k, event, eventKey));
		if (legs.some(l => !l)) continue;
		for (let si = 0; si < legs.length; si++) {
			const singleLeg = legs[si];
			const combinedLegs = legs.filter((_, i) => i !== si);
			const key = singleLeg.marketName + ':' + singleLeg.outcomeName + '|' +
				combinedLegs.map(l => l.marketName + ':' + l.outcomeName).join('|');
			if (seen.has(key)) continue;
			seen.add(key);
			splits.push({ singleLeg, combinedLegs });
		}
	}
	return splits;
}

const TOP_EVENTS_TOUTFB = 30; // matchs conservés pour les boucles multi-match Couverture complète

// Score d'un match pour Couverture classique : meilleur taux single-match sur ses partitions DC
// Fallback sur 1X2 si aucun marché DC disponible.
function scoreEventToutFB(data, eventKey) {
	let best = 0;
	for (const coverSet of getCoverSets(data, eventKey)) {
		const odds = coverSet.map(leg => bestCombinedOdds(data, [leg])?.odds ?? 0);
		if (odds.some(o => o <= 1)) continue;
		const r = 1 / odds.reduce((s, o) => s + 1 / (o - 1), 0);
		if (r > best) best = r;
	}
	return best;
}

function topEventsForToutFB(data) {
	return Object.keys(data)
		.map(ek => ({ ek, score: scoreEventToutFB(data, ek) }))
		.filter(x => x.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, TOP_EVENTS_TOUTFB)
		.map(x => x.ek);
}

// Best combined odds for a list of legs [{eventKey, marketName, outcomeName}]
// Each site must offer ALL legs. Returns {site, odds} or null.
// Used internally for scoring/partition selection — NOT for final covering sets.
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
		const legOdds = betLegs.map((_, i) => siteOddsPerLeg[i][site]);
		if (_minOddsPerSelection > 0 && legOdds.some(o => o < _minOddsPerSelection)) continue;
		const odds = legOdds.reduce((p, o) => p * o, 1);
		if (!best || odds > best.odds) best = { site, odds };
	}
	return best;
}

// "Couverture complète" : find all bookmaker sites offering back odds for every leg
// used across ALL bets in the covering set. Returns [{site, rawBets}] (one per valid site)
// or null if any required leg is absent from data.
// betsLegsArray: [ [{eventKey, marketName, outcomeName}, ...], ... ]
function bestSingleSiteCovering(data, betsLegsArray) {
	const legOddsCache = new Map();
	for (const betLegs of betsLegsArray) {
		for (const { eventKey, marketName, outcomeName } of betLegs) {
			const key = `${eventKey}|${marketName}|${outcomeName}`;
			if (legOddsCache.has(key)) continue;
			const oddsMap = data[eventKey]?.markets?.[marketName]?.[outcomeName];
			if (!oddsMap) return null;
			const siteOdds = {};
			for (const [site, val] of Object.entries(oddsMap)) {
				if (isExchange(val)) continue;
				const o = typeof val === 'number' ? val : (val?.odds ?? null);
				if (o && o > 1 && (_filterMinOdds <= 0 || o >= _filterMinOdds)) siteOdds[site] = o;
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
				prod * legOddsCache.get(`${eventKey}|${marketName}|${outcomeName}`)[site], 1),
		})),
	}));
}

// "Couverture multi-sites" : pour chaque pari du covering set, trouve la meilleure cote
// disponible sur N'IMPORTE quel site bookmaker (pas échange). Rejette si tous les paris
// se retrouvent sur le même site (→ déjà couvert par Couverture complète).
// Retourne [{legs, site, odds}, ...] ou null si une cote est manquante.
function bestMultiSiteCovering(data, betsLegsArray) {
	const isCombined = betsLegsArray.some(betLegs => betLegs.length > 1);
	const rawBets = betsLegsArray.map(betLegs => {
		let best = null;
		for (const { eventKey, marketName, outcomeName } of betLegs) {
			const oddsMap = data[eventKey]?.markets?.[marketName]?.[outcomeName];
			if (!oddsMap) return null;
			for (const [site, val] of Object.entries(oddsMap)) {
				// Les exchanges ne proposent pas de combinés
				if (isCombined && isExchange(val)) continue;
				const o = getBackOdds(val);
				if (!o || o <= 1) continue;
				if (_filterMinOdds > 0 && o < _filterMinOdds) continue;
				if (!best || o > best.odds) best = { site, odds: o };
			}
		}
		return best ? { legs: betLegs, site: best.site, odds: best.odds } : null;
	});
	if (rawBets.some(b => !b)) return null;
	// Filtre : au moins 2 sites différents requis
	const sites = new Set(rawBets.map(b => b.site));
	if (sites.size < 2) return null;
	return rawBets;
}

function computeMultiSite(data, amount, nMatches, betType = 'fb') {
	const allEventKeys = Object.keys(data);
	const eventKeys = nMatches === 1 ? allEventKeys : topEventsForToutFB(data);
	const results = [];
	const bestPerCombo = new Map();

	function tryMultiSite(betsSpec, comboKey, meta) {
		const rawBets = bestMultiSiteCovering(data, betsSpec);
		if (!rawBets) return;
		const fin = finalizeBets(rawBets, amount, betType);
		if (!fin) return;
		const entry = { method: 4, nMatches, nBets: betsSpec.length, ...fin,
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
			for (const coverSet of getCoverSets(data, eventKey)) {
				tryMultiSite(coverSet.map(l => [l]), eventKey, { eventKeys: [eventKey] });
			}
		}
	} else if (nMatches === 2) {
		for (let i = 0; i < eventKeys.length; i++) {
			const ek1 = eventKeys[i];
			for (let j = i + 1; j < eventKeys.length; j++) {
				const ek2 = eventKeys[j];
				const comboKey = [ek1, ek2].sort().join('|');
				for (const p1 of dcPartitions(data, ek1)) {
					for (const p2 of dcPartitions(data, ek2)) {
						tryMultiSite(
							generateCoveringBets([ek1, ek2], [p1, p2]),
							comboKey, { eventKeys: [ek1, ek2] }
						);
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
					for (const p1 of dcPartitions(data, ek1)) {
						for (const p2 of dcPartitions(data, ek2)) {
							for (const p3 of dcPartitions(data, ek3)) {
								tryMultiSite(
									generateCoveringBets([ek1, ek2, ek3], [p1, p2, p3]),
									comboKey, { eventKeys: [ek1, ek2, ek3] }
								);
							}
						}
					}
				}
			}
		}
	} else if (nMatches === 4) {
		for (let i = 0; i < eventKeys.length; i++) {
			const ek1 = eventKeys[i];
			for (let j = i + 1; j < eventKeys.length; j++) {
				const ek2 = eventKeys[j];
				for (let m = j + 1; m < eventKeys.length; m++) {
					const ek3 = eventKeys[m];
					for (let p = m + 1; p < eventKeys.length; p++) {
						const ek4 = eventKeys[p];
						const comboKey = [ek1, ek2, ek3, ek4].sort().join('|');
						for (const p1 of dcPartitions(data, ek1)) {
							for (const p2 of dcPartitions(data, ek2)) {
								for (const p3 of dcPartitions(data, ek3)) {
									for (const p4 of dcPartitions(data, ek4)) {
										tryMultiSite(
											generateCoveringBets([ek1, ek2, ek3, ek4], [p1, p2, p3, p4]),
											comboKey, { eventKeys: [ek1, ek2, ek3, ek4] }
										);
									}
								}
							}
						}
					}
				}
			}
		}
	}

	return [...results, ...bestPerCombo.values()].sort((a, b) => b.rate - a.rate);
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

function computeToutFB(data, amount, nMatches, betType = 'fb') {
	const allEventKeys = Object.keys(data);
	// Pour nMatches=1 on utilise tous les matchs ; pour multi on filtre top-N
	const eventKeys = nMatches === 1 ? allEventKeys : topEventsForToutFB(data);
	const results = [];
	// Déduplication : garder seulement le meilleur taux par combinaison de matchs
	const bestPerCombo = new Map();

	// Essaie toutes les options de site pour un set et garde le meilleur taux.
	function bestFinFromSiteOpts(siteOpts) {
		let best = null;
		for (const { rawBets } of siteOpts) {
			const fin = finalizeBets(rawBets, amount, betType);
			if (fin && (!best || fin.rate > best.rate)) best = fin;
		}
		return best;
	}

	if (nMatches === 1) {
		for (const eventKey of eventKeys) {
			for (const coverSet of getCoverSets(data, eventKey)) {
				const betsSpec = coverSet.map(leg => [leg]);
				const siteOpts = bestSingleSiteCovering(data, betsSpec);
				if (!siteOpts) continue;
				const fin = bestFinFromSiteOpts(siteOpts);
				if (fin) results.push({ method: 2, nMatches: 1, nBets: coverSet.length, ...fin, totalAmount: amount, eventKeys: [eventKey], betType });
			}
		}
	} else if (nMatches === 2) {
		for (let i = 0; i < eventKeys.length; i++) {
			const ek1 = eventKeys[i];
			for (let j = i + 1; j < eventKeys.length; j++) {
				const ek2 = eventKeys[j];
				const comboKey = [ek1, ek2].sort().join('|');
				const parts1 = dcPartitions(data, ek1);
				const parts2 = dcPartitions(data, ek2);
				for (const p1 of parts1) {
					for (const p2 of parts2) {
						const siteOpts = bestSingleSiteCovering(data, generateCoveringBets([ek1, ek2], [p1, p2]));
						if (!siteOpts) continue;
						for (const { rawBets } of siteOpts) {
							const fin = finalizeBets(rawBets, amount, betType);
							if (!fin) continue;
							const entry = { method: 2, nMatches: 2, nBets: 4, ...fin, totalAmount: amount, eventKeys: [ek1, ek2], betType };
							const prev = bestPerCombo.get(comboKey);
							if (!prev || fin.rate > prev.rate) bestPerCombo.set(comboKey, entry);
						}
					}
				}
				// Asymétrique : 1 single + combinés (si option activée)
				if (_asymCov) {
					for (const [ekS, ekC] of [[ek1, ek2], [ek2, ek1]]) {
						const asymKey = ekS + '→' + ekC;
						const splits = getAsymSplits(data, ekS);
						const coverSets = getCoverSets(data, ekC);
						if (!splits.length || !coverSets.length) continue;
						for (const { singleLeg, combinedLegs } of splits) {
							for (const cs of coverSets) {
								const betsSpec = [
									[singleLeg],
									...combinedLegs.flatMap(cl => cs.map(m2l => [cl, m2l])),
								];
								const siteOpts = bestSingleSiteCovering(data, betsSpec);
								if (!siteOpts) continue;
								for (const { rawBets } of siteOpts) {
									const fin = finalizeBets(rawBets, amount, betType);
									if (!fin) continue;
									const entry = { method: 2, nMatches: 2, nBets: betsSpec.length, ...fin,
										totalAmount: amount, eventKeys: [ekS, ekC], betType };
									const prev = bestPerCombo.get(asymKey);
									if (!prev || fin.rate > prev.rate) bestPerCombo.set(asymKey, entry);
								}
							}
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
					const parts1 = dcPartitions(data, ek1);
					const parts2 = dcPartitions(data, ek2);
					const parts3 = dcPartitions(data, ek3);
					for (const p1 of parts1) {
						for (const p2 of parts2) {
							for (const p3 of parts3) {
								const siteOpts = bestSingleSiteCovering(data, generateCoveringBets([ek1, ek2, ek3], [p1, p2, p3]));
								if (!siteOpts) continue;
								for (const { rawBets } of siteOpts) {
									const fin = finalizeBets(rawBets, amount, betType);
									if (!fin) continue;
									const entry = { method: 2, nMatches: 3, nBets: 8, ...fin, totalAmount: amount, eventKeys: [ek1, ek2, ek3], betType };
									const prev = bestPerCombo.get(comboKey);
									if (!prev || fin.rate > prev.rate) bestPerCombo.set(comboKey, entry);
								}
							}
						}
					}
					// Asymétrique 3 matchs (si option activée)
					if (_asymCov) {
						const es = [ek1, ek2, ek3];
						for (let si = 0; si < 3; si++) {
							const ekS = es[si];
							const ekCs = es.filter((_, k) => k !== si);
							const asymKey = ekS + '→' + ekCs.join('|');
							const splits = getAsymSplits(data, ekS);
							const coverSets1 = getCoverSets(data, ekCs[0]);
							const coverSets2 = getCoverSets(data, ekCs[1]);
							if (!splits.length || !coverSets1.length || !coverSets2.length) continue;
							for (const { singleLeg, combinedLegs } of splits) {
								for (const cs1 of coverSets1) {
									for (const cs2 of coverSets2) {
										const betsSpec = [
											[singleLeg],
											...combinedLegs.flatMap(cl =>
												cs1.flatMap(m2l => cs2.map(m3l => [cl, m2l, m3l]))
											),
										];
										const siteOpts = bestSingleSiteCovering(data, betsSpec);
										if (!siteOpts) continue;
										for (const { rawBets } of siteOpts) {
											const fin = finalizeBets(rawBets, amount, betType);
											if (!fin) continue;
											const entry = { method: 2, nMatches: 3, nBets: betsSpec.length, ...fin,
												totalAmount: amount, eventKeys: [ekS, ...ekCs], betType };
											const prev = bestPerCombo.get(asymKey);
											if (!prev || fin.rate > prev.rate) bestPerCombo.set(asymKey, entry);
										}
									}
								}
							}
						}
					}
				}
			}
		}
	} else if (nMatches === 4) {
		for (let i = 0; i < eventKeys.length; i++) {
			const ek1 = eventKeys[i];
			for (let j = i + 1; j < eventKeys.length; j++) {
				const ek2 = eventKeys[j];
				for (let m = j + 1; m < eventKeys.length; m++) {
					const ek3 = eventKeys[m];
					for (let p = m + 1; p < eventKeys.length; p++) {
						const ek4 = eventKeys[p];
						const comboKey = [ek1, ek2, ek3, ek4].sort().join('|');
						const parts1 = dcPartitions(data, ek1);
						const parts2 = dcPartitions(data, ek2);
						const parts3 = dcPartitions(data, ek3);
						const parts4 = dcPartitions(data, ek4);
						for (const p1 of parts1) {
							for (const p2 of parts2) {
								for (const p3 of parts3) {
									for (const p4 of parts4) {
										const siteOpts = bestSingleSiteCovering(data, generateCoveringBets([ek1, ek2, ek3, ek4], [p1, p2, p3, p4]));
										if (!siteOpts) continue;
										for (const { rawBets } of siteOpts) {
											const fin = finalizeBets(rawBets, amount, betType);
											if (!fin) continue;
											const entry = { method: 2, nMatches: 4, nBets: 16, ...fin, totalAmount: amount, eventKeys: [ek1, ek2, ek3, ek4], betType };
											const prev = bestPerCombo.get(comboKey);
											if (!prev || fin.rate > prev.rate) bestPerCombo.set(comboKey, entry);
										}
									}
								}
							}
						}
					}
				}
			}
		}
	}

	return [...results, ...bestPerCombo.values()].sort((a, b) => b.rate - a.rate);
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
	if (isExchangeSite(cover?.site)) return `<span class="ff-badge ff-badge-bk">Back</span>`;
	return '';
}

const _SITE_KEYS = ['piwi', 'olybet', 'betclic', 'winamax', 'bwin', 'unibet', 'feelingbet', 'pokerstars'];
const _EXCHANGE_SITE_KEYS = ['piwi'];

function isExchangeSite(name) {
	if (!name) return false;
	const low = name.toLowerCase();
	return _EXCHANGE_SITE_KEYS.some(k => low.includes(k));
}

function sitePill(name, isLay = false) {
	const key = _SITE_KEYS.find(k => name.toLowerCase().includes(k));
	const dataSite = key ? ` data-site="${key}"` : '';
	const isExch = _EXCHANGE_SITE_KEYS.includes(key);
	const layClass = isLay && isExch ? ' ff-site-pill--lay' : '';
	const label = isExch ? `${esc(name)} ${isLay ? 'Lay' : 'Back'}` : esc(name);
	return `<span class="ff-site-pill${layClass}"${dataSite}>${label}</span>`;
}

function miseTag(type) {
	return type === 'fb'
		? `<span class="ff-mise-tag ff-mise-tag--fb">Freebet</span>`
		: `<span class="ff-mise-tag ff-mise-tag--cash">Cash</span>`;
}

function resolveOutcome(outcomeName, eventKey, marketName) {
	const ev = _data?.[eventKey];
	const opp = ev?.opponents;
	if (!opp) return `${esc(marketName)} · ${esc(outcomeName)}`;
	let label;
	const k = outcomeName.trim();
	if (k === '1') label = esc(opp['1'] ?? outcomeName);
	else if (k === '2') label = esc(opp['2'] ?? outcomeName);
	else if (k === 'X') label = 'Nul';
	else label = esc(outcomeName);
	return `${esc(marketName)} · ${label}`;
}

function buildSeqLegRow(leg, idx, gap, scale = 1) {
	const gapHtml = gap ? `<span class="ff-gap">+${formatGap(gap)}</span>` : '';
	const stakeDetail = leg.liability != null
		? `${fmt(leg.stake * scale)}\u00a0€ <span class="ff-sub">(liab.\u00a0${fmt(leg.liability * scale)}\u00a0€)</span>`
		: `${fmt(leg.stake * scale)}\u00a0€`;
	const coverOddsDetail = leg.cover.lGross != null
		? `${fmt(leg.cover.lGross)}`
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
			<span class="ff-leg-back">Back\u00a0: <strong>${fmt(_amount * scale)}\u00a0€</strong> \u00d7 cote <strong>${fmt(leg.b)}</strong> sur ${esc(_fbSite)}</span>
			<span class="ff-leg-cover">${esc(leg.cover.site)} ${coverBadge(leg.cover)} ${esc(leg.cover.outcomeName)} · ${coverOddsDetail}</span>
			<span class="ff-leg-stake">Mise couv.\u00a0: <strong>${stakeDetail}</strong></span>
		</div>
	</div>`;
}

function buildSeqCard(result) {
	const legRows = result.legs.map((leg, i) =>
		buildSeqLegRow(leg, i, i > 0 ? result.gaps[i - 1] : null)
	).join('');
	const totalLiab = result.legs.reduce((s, l) => s + (l.liability ?? 0), 0);
	const liabHtml = totalLiab > 0
		? `<span class="ff-card-liab">Liab. totale <strong>${fmt(totalLiab)}\u00a0€</strong></span>` : '';
	const coverLabel = result.nLegs === 1
		? result.legs[0].cover.type === 'lay' ? 'Lay EX' : (result.legs[0].cover.type === 'dc' ? 'DC BK' : (isExchangeSite(result.legs[0].cover.site) ? 'Back EX' : 'BK'))
		: `${result.nLegs} legs séq.`;
	const isCash = result.betType === 'cash';
	const valueHtml = isCash
		? `<span class="ff-card-profit neg"><strong>−${fmt(result.loss)}\u00a0€</strong></span>`
		: `<span class="ff-card-profit pos"><strong>${fmt(result.profit)}\u00a0€</strong></span>`;
	const rateHtml = `<span class="${isCash ? rateClassCash(result.rate) : rateClass(result.rate)} ff-card-rate">${fmt(result.rate * 100, 1)}\u00a0%</span>`;

	return `
	<div class="ff-card ff-card-m1">
		<div class="ff-card-header">
			<span class="ff-card-type">Séquentiel · ${esc(coverLabel)}</span>
			<span class="ff-card-b">Cote\u00a0: <strong>${fmt(result.B)}</strong></span>
			${liabHtml}
			${valueHtml}
			${rateHtml}
		</div>
		<div class="ff-legs">${legRows}</div>
	</div>`;
}

function buildToutFBBetRow(bet, idx, betType = 'fb', scale = 1) {
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

function buildToutFBCard(result) {
	const isCash = result.betType === 'cash';
	const betRows = result.bets.map((b, i) => buildToutFBBetRow(b, i, result.betType)).join('');
	const minOdds = Math.min(...result.bets.map(b => b.odds));
	const maxOdds = Math.max(...result.bets.map(b => b.odds));
	const valueHtml = isCash
		? `<span class="ff-card-profit neg"><strong>−${fmt(result.loss)}\u00a0€</strong> perte</span>`
		: `<span class="ff-card-profit pos"><strong>${fmt(result.profit)}\u00a0€</strong> garanti</span>`;
	const rateHtml = `<span class="${isCash ? rateClassCash(result.rate) : rateClass(result.rate)} ff-card-rate">${fmt(result.rate * 100, 1)}\u00a0%</span>`;
	return `
	<div class="ff-card ff-card-m2">
		<div class="ff-card-header">
			<span class="ff-card-type">${result.method === 4 ? 'Couverture multi-sites' : 'Couverture complète'} · ${result.nBets}\u00a0Paris · ${result.nMatches}\u00a0match${result.nMatches > 1 ? 's' : ''}</span>
			<span class="ff-card-b">Cotes\u00a0: ${fmt(minOdds)}\u2013${fmt(maxOdds)}</span>
			<span class="ff-card-totalfb">Total\u00a0: <strong>${fmt(result.totalAmount)}\u00a0€</strong></span>
			${valueHtml}
			${rateHtml}
		</div>
		<div class="ff-bets">${betRows}</div>
	</div>`;
}

// ===== TABLE RENDERING =====

function rowMethod(result) {
	if (result.method === 1) return 'Séq.';
	if (result.method === 2) return 'Couv. complète';
	if (result.method === 4) return 'Multi-sites';
	return '';
}

function rowMatches(result) {
	if (result.method === 1) return new Set(result.legs.map(l => l.eventKey)).size;
	return result.nMatches ?? '-';
}

function rowFirstDate(result) {
	if (result.method === 1) {
		const first = result.legs.reduce((min, l) => (l.dateTime && (!min || l.dateTime < min)) ? l.dateTime : min, null);
		return first ? formatDate(first) : '—';
	}
	const keys = result.eventKeys || [];
	let first = null;
	for (const ek of keys) {
		const dt = _data?.[ek]?.dateTime;
		if (dt && (!first || dt < first)) first = dt;
	}
	return first ? formatDate(first) : '—';
}

function resultEventKeys(result) {
	if (result.method === 1) return [...new Set(result.legs.map(l => l.eventKey))];
	return result.eventKeys || [];
}

function rowMarketsHtml(result) {
	if (result.method === 1) {
		return resultEventKeys(result).map(ek => {
			const mkts = [...new Set(result.legs.filter(l => l.eventKey === ek).map(l => l.marketName))];
			return `<span>${esc(mkts.join(', '))}</span>`;
		}).join('');
	}
	if (result.method === 2 || result.method === 4) {
		return resultEventKeys(result).map(ek => {
			const mkts = [...new Set(result.bets.flatMap(b => b.legs.filter(l => l.eventKey === ek).map(l => l.marketName)))];
			return `<span>${esc(mkts.join(', '))}</span>`;
		}).join('');
	}
	return '';
}

function coverTypeLabel(cover) {
	if (!cover) return '';
	const exch = isExchangeSite(cover.site);
	const suffix = cover.type === 'lay' ? ' Lay' : cover.type === 'dc' ? '' : (exch ? ' Back' : '');
	return (cover.site || '') + suffix;
}

function outcomesPerEvent(bets, ek) {
	return new Set(bets.flatMap(b => b.legs.filter(l => l.eventKey === ek).map(l => l.outcomeName))).size;
}

function rowTypeHtml(result) {
	if (result.method === 1) {
		return resultEventKeys(result).map(ek => {
			const leg = result.legs.find(l => l.eventKey === ek);
			return `<span>${esc(leg ? coverTypeLabel(leg.cover) : '')}</span>`;
		}).join('');
	}
	if (result.method === 2 || result.method === 4) {
		return resultEventKeys(result).map(ek => {
			const n = outcomesPerEvent(result.bets, ek);
			return `<span>${n}\u00a0issues</span>`;
		}).join('');
	}
	return '';
}

function eventsLines(result) {
	const keys = result.method === 1
		? [...new Set(result.legs.map(l => l.eventKey))]
		: (result.eventKeys || []);
	return keys.map(ek => {
		const ev = _data?.[ek];
		return `<span>${esc(ev ? eventDisplayName(ek, ev) : ek)}</span>`;
	}).join('');
}

function eventsLabel(result) {
	const keys = result.method === 1
		? [...new Set(result.legs.map(l => l.eventKey))]
		: (result.eventKeys || []);
	return keys.map(ek => {
		const ev = _data?.[ek];
		return ev ? eventDisplayName(ek, ev) : ek;
	}).join(' + ');
}


function rowParis(result) {
	if (result.method === 1) {
		const count = result.legs.length * 2;
		if (result.profitFb != null && result.nLegs > 1) {
			const scale = getDisplayScale(result);
			return `${count}<br><span class="ff-paris-sub">+${fmt(result.profitFb * scale)}\u00a0\u20ac Fb</span><br><span class="ff-paris-sub">+${fmt(result.profit * scale)}\u00a0\u20ac Cash</span>`;
		}
		return count;
	}
	if (result.method === 2 || result.method === 4) return result.nBets;
	return '-';
}

function rowCashEngaged(result) {
	if (result.method === 1) return result.legs.reduce((s, l) => s + (l.liability ?? l.stake), 0);
	return null;
}

function rowCote(result) {
	if (result.method === 1) return fmt(result.B);
	if (result.method === 2 || result.method === 4) {
		const odds = result.bets.map(b => b.odds);
		const min = Math.min(...odds), max = Math.max(...odds);
		return Math.abs(max - min) < 0.01 ? fmt(min) : `${fmt(min)}\u2013${fmt(max)}`;
	}
	return '\u2013';
}

function buildSeqDetailFlat(result, scale = 1) {
	const amount = _amount * scale;
	// Combined back row
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

	// One cover row per leg
	const coverRows = result.legs.map((leg, i) => {
		const cover = leg.cover;
		const badgeClass = cover.type === 'lay' ? 'lay' : 'back';
		const oddsStr = cover.lGross != null
			? `<strong>${fmt(cover.lGross)}</strong>`
			: `<strong>${fmt(cover.odds)}</strong>`;
		const liabilityStr = leg.liability != null
			? ` · Liability <strong>${fmt(leg.liability * scale)}\u00a0€</strong>`
			: '';
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

function buildDetailContent(result, scale = 1) {
	if (result.method === 1) {
		return buildSeqDetailFlat(result, scale);
	}
	if (result.method === 2 || result.method === 4) {
		const rows = result.bets.map((b, i) => buildToutFBBetRow(b, i, result.betType, scale)).join('');
		return `<div class="ff-detail-bets">${rows}</div>`;
	}
	return '';
}

function buildTableRow(result, idx) {
	const isCash = result.betType === 'cash';
	const scale = getDisplayScale(result);
	const liab = rowCashEngaged(result);
	const obj = result._cashObjective;
	let profitClass, valueStr;
	if (obj === 'gagner') {
		const n = (result.netIfWins ?? 0) * scale;
		profitClass = n >= 0 ? 'pos' : 'neg';
		valueStr = `${n >= 0 ? '+' : '\u2212'}${fmt(Math.abs(n))}\u00a0\u20ac`;
	} else if (obj === 'perdre') {
		const n = (result.netIfLoses ?? 0) * scale;
		profitClass = 'neg';
		valueStr = `si\u00a0perdu\u00a0: \u2212${fmt(Math.abs(n))}\u00a0\u20ac`;
	} else {
		profitClass = isCash ? 'neg' : 'pos';
		valueStr = isCash
			? `\u2212${fmt(result.loss * scale)}\u00a0\u20ac`
			: `+${fmt(result.profit * scale)}\u00a0\u20ac`;
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

function toggleDetail(idx) {
	const detail = document.getElementById(`ff-detail-${idx}`);
	const btn = document.getElementById(`ff-expand-${idx}`);
	if (!detail) return;
	detail.hidden = !detail.hidden;
	btn.classList.toggle('ff-expand-open', !detail.hidden);
}

function renderResults(results) {
	_results = results;
	_visibleCount = 50;
	const el = document.getElementById('ff-results');
	el.hidden = false;

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
	const q = (document.getElementById('ff-search')?.value ?? '').trim().toLowerCase();

	const filtered = _results.filter(r => {
		if (_filterMinOdds > 0 && resultMinOdds(r) < _filterMinOdds) return false;
		if (!q) return true;
		if (r.method === 1) return r.legs.some(l => l.evName.toLowerCase().includes(q) || l.evComp.toLowerCase().includes(q));
		return r.eventKeys.some(ek => {
			const ev = _data?.[ek];
			if (!ev) return false;
			return eventDisplayName(ek, ev).toLowerCase().includes(q);
		});
	});

	filtered.sort((a, b) => resultSortKey(b) - resultSortKey(a));
	const visible = filtered.slice(0, _visibleCount);

	// Compteur — seulement hors onglet Tout
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

	if (!visible.length) {
		cards.innerHTML = `<p class="ff-empty">Aucun match correspondant.</p>`;
		if (more) more.innerHTML = '';
		return;
	}

	const headers = `
		<div class="ff-th"></div>
		<div class="ff-th">Méthode</div>
		<div class="ff-th ff-th-center">Matchs</div>
		<div class="ff-th">Date event</div>
		<div class="ff-th">Événement(s)</div>
		<div class="ff-th">Marchés</div>
		<div class="ff-th">Type</div>
		<div class="ff-th ff-th-center">Paris</div>
		<div class="ff-th">Cash engagé</div>
		<div class="ff-th">Cote</div>
		<div class="ff-th">Résultat</div>
		<div class="ff-th">Taux</div>`;

	cards.innerHTML = `<div class="ff-table-wrap"><div class="ff-table">${headers}${visible.map((r, i) => buildTableRow(r, i)).join('')}</div></div>`;

	if (more) {
		const remaining = filtered.length - _visibleCount;
		more.innerHTML = remaining > 0
			? `<button class="ff-more-btn" onclick="showMore()">Voir ${Math.min(remaining, 50)} de plus (${remaining} restant${remaining > 1 ? 's' : ''})</button>`
			: '';
	}
}

function showMore() { _visibleCount += 50; renderPage(); }

// ===== UI =====

function updateTabSummaries() {
	const applyFilter = arr => _filterMinOdds > 0 ? arr.filter(r => resultMinOdds(r) >= _filterMinOdds) : arr;

	document.querySelectorAll('.ff-count-btn[data-method][data-legs]').forEach(btn => {
		const m = +btn.dataset.method;
		const n = +btn.dataset.legs;
		const res = applyFilter(_allResults[`${m}_${n}`] ?? []);
		const num = btn.dataset.legs;
		if (!res.length) { btn.innerHTML = esc(num); return; }
		const best = res[0];
		const scale = getDisplayScale(best);
		const isCash = best.betType === 'cash';
		const valueStr = isCash ? `\u2212${fmt(best.loss * scale, 2)}\u00a0\u20ac` : `+${fmt(best.profit * scale, 2)}\u00a0\u20ac`;
		btn.innerHTML = `${esc(num)}<span class="ff-count-summary">${fmt(best.rate * 100, 1)}\u00a0%<br>${valueStr}</span>`;
	});

	// Résumé global pour l'onglet "Tout"
	const toutLabel = document.querySelector('.ff-method-label[data-name="Tout"]');
	if (toutLabel) {
		const all = applyFilter(Object.values(_allResults).flat());
		if (all.length) {
			const best = all.reduce((b, r) => r.rate > b.rate ? r : b);
			const scale = getDisplayScale(best);
			const isCash = best.betType === 'cash';
			const valueStr = isCash ? `\u2212${fmt(best.loss * scale, 2)}\u00a0\u20ac` : `+${fmt(best.profit * scale, 2)}\u00a0\u20ac`;
			toutLabel.innerHTML = `Tout<span class="ff-count-summary">${fmt(best.rate * 100, 1)}\u00a0%<br>${valueStr}</span>`;
		} else {
			toutLabel.innerHTML = 'Tout';
		}
	}
}

function clearTabSummaries() {
	document.querySelectorAll('.ff-count-btn[data-legs]').forEach(btn => {
		btn.innerHTML = esc(btn.dataset.legs);
	});
	document.querySelectorAll('.ff-method-label[data-name]').forEach(label => {
		label.innerHTML = esc(label.dataset.name);
	});
}

function resultMinOdds(result) {
	if (result.method === 1) return result.B;
	if (result.method === 2 || result.method === 4) return Math.min(...result.bets.map(b => b.odds));
	return 0;
}

function resultMinStake(result) {
	if (result.method === 1) return _amount;
	if (result.method === 2 || result.method === 4) return Math.min(...result.bets.map(b => b.stake));
	return _amount;
}

function resultSortKey(result) {
	const scale = getDisplayScale(result);
	if (result.betType !== 'cash') return (result.profit ?? 0) * scale;
	const obj = result._cashObjective;
	if (obj === 'gagner') return (result.netIfWins ?? 0) * scale;
	if (obj === 'perdre') return (result.netIfLoses ?? 0) * scale;
	return -(result.loss * scale); // miser : moins de perte = mieux
}

function getDisplayScale(result) {
	if (_amountMode !== 'min') return 1;
	const ms = resultMinStake(result);
	return ms > 0 ? _amountMin / ms : 1;
}

function setMinOddsFilter(val) {
	_filterMinOdds = parseFloat(val) || 0;
	// Le filtre affecte le calcul → invalider les résultats mis en cache
	_allResults = {};
	clearTabSummaries();
	document.getElementById('ff-results').hidden = true;
	savePrefs();
}

function setMethodLegs(m, n) {
	_method = m;
	_nLegs = n;
	document.querySelectorAll('.ff-method-group').forEach(g =>
		g.classList.toggle('ff-method-group--active', +g.dataset.method === m)
	);
	document.querySelectorAll('.ff-count-btn').forEach(b =>
		b.classList.toggle('ff-count-btn--active', +b.dataset.method === m && +b.dataset.legs === n)
	);
	if (Object.keys(_allResults).length) showCurrentResults();
	savePrefs();
}

function setMethod(m) { setMethodLegs(m, _nLegs); }
function setLegs(n) { setMethodLegs(_method, n); }

function setBetType(t) {
	_betType = t;
	document.querySelectorAll('.ff-bettype-btn').forEach(b =>
		b.classList.toggle('ff-btn--active', b.dataset.bettype === t)
	);
	const objField = document.getElementById('ff-objective-field');
	if (objField) objField.hidden = t !== 'cash';
	_allResults = {};
	clearTabSummaries();
	document.getElementById('ff-results').hidden = true;
	savePrefs();
}

function setAsymCov(val) {
	_asymCov = val;
	const cb = document.getElementById('ff-asymcov-cb');
	if (cb) cb.checked = val;
	_allResults = {};
	clearTabSummaries();
	document.getElementById('ff-results').hidden = true;
	savePrefs();
}

function updateTabCounts() {
	document.querySelectorAll('.ff-count-btn[data-legs]').forEach(btn => {
		const method = +btn.dataset.method;
		const n = +btn.dataset.legs;
		const visible = _allowedNLegs.has(n);
		btn.hidden = !visible;
		// Si le legs actif est masqué, basculer vers le premier visible
		if (!visible && btn.classList.contains('ff-count-btn--active')) {
			const first = document.querySelector(`.ff-count-btn[data-method="${method}"]:not([hidden])`);
			if (first) setMethodLegs(method, +first.dataset.legs);
		}
	});
}

function toggleNLegs(n) {
	if (_allowedNLegs.has(n)) _allowedNLegs.delete(n);
	else _allowedNLegs.add(n);
	document.querySelectorAll('.ff-nlegs-btn').forEach(b =>
		b.classList.toggle('ff-btn--active', _allowedNLegs.has(+b.dataset.n))
	);
	// Effacer l'erreur si au moins un est sélectionné
	if (_allowedNLegs.size > 0)
		document.getElementById('ff-nlegs-field')?.classList.remove('ff-field--error');
	updateTabCounts();
	_allResults = {};
	clearTabSummaries();
	document.getElementById('ff-results').hidden = true;
	savePrefs();
}

function setMinOddsPerSelection(val) {
	_minOddsPerSelection = parseFloat(val) || 0;
	_allResults = {};
	clearTabSummaries();
	document.getElementById('ff-results').hidden = true;
	savePrefs();
}

function setObjective(obj) {
	_cashObjective = obj;
	document.querySelectorAll('.ff-objective-btn').forEach(b =>
		b.classList.toggle('ff-btn--active', b.dataset.objective === obj)
	);
	_allResults = {};
	clearTabSummaries();
	document.getElementById('ff-results').hidden = true;
	savePrefs();
}

function showCurrentResults() {
	updateTabSummaries();
	const el = document.getElementById('ff-results');
	if (_method === 0) {
		const all = Object.values(_allResults).flat();
		if (!all.length) {
			el.hidden = false;
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
		el.hidden = false;
		el.innerHTML = '<p class="ff-empty">Sélectionnez un site freebet pour calculer le Séquentiel.</p>';
		return;
	}
	renderResults(results);
}

function yieldToUI() { return new Promise(r => setTimeout(r, 0)); }

function cancelCalc() {
	_calcCancelled = true;
}

async function tryRender() {
	if (!_data) return;
	if (_allowedNLegs.size === 0) {
		document.getElementById('ff-nlegs-field')?.classList.add('ff-field--error');
		return;
	}
	document.getElementById('ff-nlegs-field')?.classList.remove('ff-field--error');
	_amountTotal = parseFloat(document.getElementById('ff-amount-total')?.value) || 10;
	_amountMin = parseFloat(document.getElementById('ff-amount-min')?.value) || 2;
	_amount = _amountTotal;
	_fbSite = document.getElementById('ff-site-select')?.value ?? '';
	_allResults = {};

	// Construction de la liste des étapes
	const hasSeq = !!_fbSite;
	const steps = [];

	if (hasSeq) {
		for (const n of [1, 2, 3].filter(n => _allowedNLegs.has(n)))
			steps.push({ label: `Séquentiel · ${n} sélection${n > 1 ? 's' : ''}`, fn: () => { _allResults[`1_${n}`] = computeSeq(_data, _fbSite, _amount, n, _betType); } });
	}

	for (const n of [1, 2, 3, 4].filter(n => _allowedNLegs.has(n))) {
		if (_asymCov && n > 1 && n < 4) {
			steps.push({
				label: `Couverture complète · ${n} matchs`,
				fn: () => {
					_asymCov = false;
					_allResults[`2_${n}`] = computeToutFB(_data, _amount, n, _betType);
					_asymCov = true;
				},
			});
			steps.push({
				label: `Couverture complète asymétrique · ${n} matchs`,
				fn: () => { _allResults[`2_${n}`] = computeToutFB(_data, _amount, n, _betType); },
			});
		} else {
			steps.push({
				label: `Couverture complète · ${n} match${n > 1 ? 's' : ''}`,
				fn: () => { _allResults[`2_${n}`] = computeToutFB(_data, _amount, n, _betType); },
			});
		}
	}

	for (const n of [1, 2, 3, 4].filter(n => _allowedNLegs.has(n)))
		steps.push({ label: `Couverture multi-sites · ${n} match${n > 1 ? 's' : ''}`, fn: () => { _allResults[`4_${n}`] = computeMultiSite(_data, _amount, n, _betType); } });

	const btn = document.getElementById('ff-calc-btn');
	const overlay = document.getElementById('ff-calc-overlay');
	const overlayLabel = document.getElementById('ff-calc-overlay-label');
	const overlayBar = document.getElementById('ff-calc-overlay-bar');

	_calcCancelled = false;
	btn.disabled = true;
	overlay.hidden = false;
	overlayBar.style.width = '0%';
	overlayLabel.textContent = 'Démarrage…';
	await yieldToUI();

	for (let i = 0; i < steps.length; i++) {
		if (_calcCancelled) break;
		overlayLabel.textContent = steps[i].label;
		overlayBar.style.width = `${Math.round(i / steps.length * 100)}%`;
		await yieldToUI();
		steps[i].fn();
	}

	overlayBar.style.width = _calcCancelled ? '0%' : '100%';
	overlayLabel.textContent = _calcCancelled ? 'Annulé' : 'Terminé';
	await yieldToUI();
	overlay.hidden = true;
	btn.disabled = false;

	if (!_calcCancelled) showCurrentResults();
}

function onJsonChange() {
	const raw = document.getElementById('ff-json')?.value.trim();
	const errEl = document.getElementById('ff-json-error');
	_allResults = {};
	clearTabSummaries();
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
	const savedSite = loadPrefs().site;
	if (savedSite && sites.includes(savedSite)) sel.value = savedSite;
	field.hidden = false;
}

function stepAmountTotal(delta) {
	const input = document.getElementById('ff-amount-total');
	input.value = Math.max(1, (parseFloat(input.value) || 0) + delta);
	savePrefs();
}

function stepAmountMin(delta) {
	const input = document.getElementById('ff-amount-min');
	input.value = Math.max(0.5, (parseFloat(input.value) || 0) + delta);
	savePrefs();
}

function setAmountMode(mode) {
	_amountMode = mode;
	document.querySelectorAll('.ff-amountmode-btn').forEach(b =>
		b.classList.toggle('ff-btn--active', b.dataset.mode === mode)
	);
	document.getElementById('ff-amount-total-wrap').hidden = mode !== 'total';
	document.getElementById('ff-amount-min-wrap').hidden = mode !== 'min';
	savePrefs();
	if (Object.keys(_allResults).length) showCurrentResults();
}

async function pasteFromClipboard() {
	try {
		const text = await navigator.clipboard.readText();
		const el = document.getElementById('ff-json');
		el.value = text;
		onJsonChange();
	} catch {}
}

document.addEventListener('DOMContentLoaded', async () => {
	// Restore saved preferences
	const prefs = loadPrefs();
	if (prefs.betType) setBetType(prefs.betType);
	if (prefs.cashObjective) setObjective(prefs.cashObjective);
	if (prefs.amountMode) setAmountMode(prefs.amountMode);
	const savedTotal = prefs.amountTotal ?? prefs.amount; // compat ancienne clé
	if (savedTotal) { const i = document.getElementById('ff-amount-total'); if (i) i.value = savedTotal; }
	if (prefs.amountMin) { const i = document.getElementById('ff-amount-min'); if (i) i.value = prefs.amountMin; }
	if (prefs.method && prefs.nLegs) setMethodLegs(prefs.method, prefs.nLegs);
	if (prefs.asymCov) setAsymCov(true);
	if (prefs.filterMinOdds > 0) {
		_filterMinOdds = prefs.filterMinOdds;
		const i = document.getElementById('ff-filter-odds');
		if (i) i.value = prefs.filterMinOdds;
	}
	if (Array.isArray(prefs.allowedNLegs) && prefs.allowedNLegs.length > 0) {
		_allowedNLegs = new Set(prefs.allowedNLegs);
		document.querySelectorAll('.ff-nlegs-btn').forEach(b =>
			b.classList.toggle('ff-btn--active', _allowedNLegs.has(+b.dataset.n))
		);
		updateTabCounts();
	}
	if (prefs.minOddsPerSelection > 0) {
		_minOddsPerSelection = prefs.minOddsPerSelection;
		const i = document.getElementById('ff-min-odds-sel');
		if (i) i.value = prefs.minOddsPerSelection;
	}
	document.getElementById('ff-amount-total')?.addEventListener('change', savePrefs);
	document.getElementById('ff-amount-min')?.addEventListener('change', savePrefs);
	document.getElementById('ff-site-select')?.addEventListener('change', savePrefs);

	// Chargement obligatoire des règles de couverture
	try {
		const r = await fetch('../assets/coverage-rules.json');
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		_coverageRules = await r.json();
	} catch (e) {
		document.getElementById('ff-json-error').textContent =
			`Erreur : impossible de charger coverage-rules.json (${e.message}). Ouvrez la page via un serveur local.`;
		document.getElementById('ff-json-error').hidden = false;
		return;
	}

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

	// Le browser peut restaurer le textarea après DOMContentLoaded
	setTimeout(() => {
		if (document.getElementById('ff-json').value.trim()) onJsonChange();
	}, 100);
});
