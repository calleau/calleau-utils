'use strict';

// ===== STATE =====
let _data = null;
let _results = [];
let _method = 1;   // 1 | 2
let _nLegs = 1;
let _amount = 10;
let _fbSite = '';
let _visibleCount = 20;

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

// ===== COVER SEARCH (Method 1) =====

// For a given main bet outcome in a given market, find all possible covers.
// Returns array of cover objects: { type, site, marketName, outcomeName, odds, lGross, c, k }
function findCoversForOutcome(event, mainMarketName, mainOutcomeName, mainOddsMap, fbSite) {
	const covers = [];

	// 1) Exchange Lay on the same market/outcome (lay the same thing the FB backs)
	for (const [site, val] of Object.entries(mainOddsMap)) {
		if (site === fbSite) continue;
		const lay = getLayInfo(val);
		if (!lay) continue;
		covers.push({
			type: 'lay',
			site,
			marketName: mainMarketName,
			outcomeName: mainOutcomeName,
			odds: lay.lNet,
			lGross: lay.lGross,
			c: lay.c,
			k: lay.k,
		});
	}

	// 2) Bookmaker cover on the complementary DC outcome
	const dcEntry = findDcMarket(event.markets || {});
	if (dcEntry) {
		const [dcMarketName, dcMarket] = dcEntry;
		// Find the DC outcome that does NOT contain the backed outcome
		const backedNorm = norm(mainOutcomeName);
		for (const [dcOutcome, dcOddsMap] of Object.entries(dcMarket)) {
			const parts = dcOutcome.toLowerCase().split(/\s+ou\s+|\s*\/\s*/).map(norm);
			const containsBacked = parts.some(p => p === backedNorm || p.includes(backedNorm) || backedNorm.includes(p));
			if (containsBacked) continue; // skip DC outcomes that include the backed outcome
			// This DC outcome is complementary
			if (!dcOddsMap || typeof dcOddsMap !== 'object') continue;
			for (const [site, val] of Object.entries(dcOddsMap)) {
				if (site === fbSite) continue;
				if (isExchange(val)) {
					// Exchange lay of the DC (equivalent to backing complement)
					const lay = getLayInfo(val);
					if (!lay) continue;
					covers.push({
						type: 'lay',
						site,
						marketName: dcMarketName,
						outcomeName: dcOutcome,
						odds: lay.lNet,
						lGross: lay.lGross,
						c: lay.c,
						k: lay.k,
					});
				} else {
					const c = typeof val === 'number' ? val : (val?.odds ?? null);
					if (!c || c <= 1) continue;
					covers.push({
						type: 'dc',
						site,
						marketName: dcMarketName,
						outcomeName: dcOutcome,
						odds: c,
						lGross: null,
						c: null,
						k: kFromBk(c),
					});
				}
			}
		}
	}

	// 3) If main bet is on a DC outcome: bookmaker back on the single complement
	if (/double.?chance|chance\s+double/i.test(mainMarketName)) {
		const res12Entry = findRes12Market(event.markets || {});
		if (res12Entry) {
			const [res12Name, res12Market] = res12Entry;
			// Find the 1X2 outcome not covered by this DC
			const dcParts = mainOutcomeName.toLowerCase().split(/\s+ou\s+|\s*\/\s*/).map(norm);
			for (const [singleOutcome, singleOddsMap] of Object.entries(res12Market)) {
				const sn = norm(singleOutcome);
				const covered = dcParts.some(p => p === sn || p.includes(sn) || sn.includes(p));
				if (covered) continue;
				// singleOutcome is the complement
				if (!singleOddsMap || typeof singleOddsMap !== 'object') continue;
				for (const [site, val] of Object.entries(singleOddsMap)) {
					if (site === fbSite) continue;
					if (isExchange(val)) {
						// Back on exchange is valid too
						const b = getBackOdds(val);
						if (!b || b <= 1) continue;
						covers.push({
							type: 'bk',
							site,
							marketName: res12Name,
							outcomeName: singleOutcome,
							odds: b,
							lGross: null,
							c: null,
							k: kFromBk(b),
						});
					} else {
						const c = typeof val === 'number' ? val : (val?.odds ?? null);
						if (!c || c <= 1) continue;
						covers.push({
							type: 'bk',
							site,
							marketName: res12Name,
							outcomeName: singleOutcome,
							odds: c,
							lGross: null,
							c: null,
							k: kFromBk(c),
						});
					}
				}
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

function stakeAndLiability(profit, kPrev, cover) {
	const gain = cover.type === 'lay' ? (1 - cover.c) : (cover.odds - 1);
	const stake = profit * kPrev / gain;
	const liability = cover.type === 'lay' ? stake * (cover.lGross - 1) : null;
	return { stake, liability };
}

function computeM1(data, fbSite, amount, nLegs) {
	const legs = collectLegs(data, fbSite);
	const results = [];

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
		for (let i = 0; i < legs.length; i++) {
			const l1 = legs[i];
			if (!l1.dateTime) continue;
			for (let j = 0; j < legs.length; j++) {
				if (i === j) continue;
				const l2 = legs[j];
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
		for (let i = 0; i < legs.length; i++) {
			const l1 = legs[i];
			if (!l1.dateTime) continue;
			for (let j = 0; j < legs.length; j++) {
				if (i === j) continue;
				const l2 = legs[j];
				if (l2.eventKey === l1.eventKey) continue;
				if (!l2.dateTime || l2.dateTime <= l1.dateTime) continue;
				if (l2.dateTime - l1.dateTime < MIN_GAP_MS) continue;
				for (let m = 0; m < legs.length; m++) {
					if (m === i || m === j) continue;
					const l3 = legs[m];
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

// DC partition options for a single match
function dcPartitions(data, eventKey) {
	const event = data[eventKey];
	if (!event) return [];
	const dcEntry = findDcMarket(event.markets || {});
	const res12Entry = findRes12Market(event.markets || {});
	if (!dcEntry || !res12Entry) return [];
	const [dcMarket, dcMap] = dcEntry;
	const [res12Market, res12Map] = res12Entry;
	const partitions = [];

	for (const dcOutcome of Object.keys(dcMap)) {
		const dcParts = dcOutcome.toLowerCase().split(/\s+ou\s+|\s*\/\s*/).map(norm);
		for (const singleOutcome of Object.keys(res12Map)) {
			const sn = norm(singleOutcome);
			const covered = dcParts.some(p => p === sn || p.includes(sn) || sn.includes(p));
			if (covered) continue;
			partitions.push({
				dcMarket, dcOutcome,
				compMarket: res12Market, compOutcome: singleOutcome,
			});
		}
	}
	return partitions; // should be 3 (one per DC outcome)
}

function computeM2(data, amount, nMatches) {
	const eventKeys = Object.keys(data);
	const results = [];

	if (nMatches === 1) {
		for (const eventKey of eventKeys) {
			const event = data[eventKey];
			const evName = eventDisplayName(eventKey, event);
			const evDate = formatDate(event.dateTime);
			const evComp = event.competition || event.tournoi || '';

			const partitions = dcPartitions(data, eventKey);
			// Pattern A: DC + single (2 freebets) — one per partition
			for (const p of partitions) {
				const betDC = [{ eventKey, marketName: p.dcMarket, outcomeName: p.dcOutcome }];
				const betSingle = [{ eventKey, marketName: p.compMarket, outcomeName: p.compOutcome }];
				const oDC = bestCombinedOdds(data, betDC);
				const oSingle = bestCombinedOdds(data, betSingle);
				if (!oDC || !oSingle) continue;

				const bets = [
					{ legs: betDC, site: oDC.site, odds: oDC.odds, amount },
					{ legs: betSingle, site: oSingle.site, odds: oSingle.odds, amount },
				];
				const minPayout = Math.min(...bets.map(b => b.odds - 1));
				const rate = minPayout / bets.length;
				results.push({ method: 2, nMatches: 1, nBets: 2, rate, minPayout, amount, bets, eventKeys: [eventKey] });
			}

			// Pattern B: 1 + X + 2 (3 freebets)
			const res12Entry = findRes12Market(event.markets || {});
			if (res12Entry) {
				const [res12Market, res12Map] = res12Entry;
				const betsList = Object.keys(res12Map).map(o => [{ eventKey, marketName: res12Market, outcomeName: o }]);
				const oddsArr = betsList.map(b => bestCombinedOdds(data, b));
				if (oddsArr.every(o => o !== null)) {
					const bets = betsList.map((b, i) => ({ legs: b, site: oddsArr[i].site, odds: oddsArr[i].odds, amount }));
					const minPayout = Math.min(...bets.map(b => b.odds - 1));
					const rate = minPayout / bets.length;
					results.push({ method: 2, nMatches: 1, nBets: 3, rate, minPayout, amount, bets, eventKeys: [eventKey] });
				}
			}
		}
	} else if (nMatches === 2) {
		for (let i = 0; i < eventKeys.length; i++) {
			const ek1 = eventKeys[i];
			const ev1 = data[ek1];
			const dt1 = ev1.dateTime ? new Date(ev1.dateTime).getTime() : null;
			for (let j = 0; j < eventKeys.length; j++) {
				if (i === j) continue;
				const ek2 = eventKeys[j];
				const ev2 = data[ek2];
				const dt2 = ev2.dateTime ? new Date(ev2.dateTime).getTime() : null;
				// No time gap required for method 2 (all bets placed simultaneously)

				const parts1 = dcPartitions(data, ek1);
				const parts2 = dcPartitions(data, ek2);

				// DC × DC (4 bets)
				for (const p1 of parts1) {
					for (const p2 of parts2) {
						const betsSpec = generateCoveringBets([ek1, ek2], [p1, p2]);
						const bets = [];
						let valid = true;
						for (const betLegs of betsSpec) {
							const best = bestCombinedOdds(data, betLegs);
							if (!best) { valid = false; break; }
							bets.push({ legs: betLegs, site: best.site, odds: best.odds, amount });
						}
						if (!valid) continue;
						const minPayout = Math.min(...bets.map(b => b.odds - 1));
						const rate = minPayout / bets.length;
						results.push({ method: 2, nMatches: 2, nBets: 4, rate, minPayout, amount, bets, eventKeys: [ek1, ek2] });
					}
				}

				// 1X2 × 1X2 (9 bets) — only add if we have both res12 markets
				const res1 = findRes12Market(ev1.markets || {});
				const res2 = findRes12Market(ev2.markets || {});
				if (res1 && res2) {
					const [r1name, r1map] = res1;
					const [r2name, r2map] = res2;
					const bets = [];
					let valid = true;
					for (const o1 of Object.keys(r1map)) {
						for (const o2 of Object.keys(r2map)) {
							const betLegs = [
								{ eventKey: ek1, marketName: r1name, outcomeName: o1 },
								{ eventKey: ek2, marketName: r2name, outcomeName: o2 },
							];
							const best = bestCombinedOdds(data, betLegs);
							if (!best) { valid = false; break; }
							bets.push({ legs: betLegs, site: best.site, odds: best.odds, amount });
						}
						if (!valid) break;
					}
					if (valid && bets.length === 9) {
						const minPayout = Math.min(...bets.map(b => b.odds - 1));
						const rate = minPayout / bets.length;
						results.push({ method: 2, nMatches: 2, nBets: 9, rate, minPayout, amount, bets, eventKeys: [ek1, ek2] });
					}
				}
			}
		}
	} else if (nMatches === 3) {
		for (let i = 0; i < eventKeys.length; i++) {
			const ek1 = eventKeys[i];
			for (let j = 0; j < eventKeys.length; j++) {
				if (j === i) continue;
				const ek2 = eventKeys[j];
				for (let m = 0; m < eventKeys.length; m++) {
					if (m === i || m === j) continue;
					const ek3 = eventKeys[m];

					// DC × DC × DC (8 bets)
					const parts1 = dcPartitions(data, ek1);
					const parts2 = dcPartitions(data, ek2);
					const parts3 = dcPartitions(data, ek3);

					for (const p1 of parts1) {
						for (const p2 of parts2) {
							for (const p3 of parts3) {
								const betsSpec = generateCoveringBets([ek1, ek2, ek3], [p1, p2, p3]);
								const bets = [];
								let valid = true;
								for (const betLegs of betsSpec) {
									const best = bestCombinedOdds(data, betLegs);
									if (!best) { valid = false; break; }
									bets.push({ legs: betLegs, site: best.site, odds: best.odds, amount });
								}
								if (!valid) continue;
								const minPayout = Math.min(...bets.map(b => b.odds - 1));
								const rate = minPayout / bets.length;
								results.push({ method: 2, nMatches: 3, nBets: 8, rate, minPayout, amount, bets, eventKeys: [ek1, ek2, ek3] });
							}
						}
					}
				}
			}
		}
	}

	return results.sort((a, b) => b.rate - a.rate);
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

	return `
	<div class="ff-card ff-card-m1">
		<div class="ff-card-header">
			<span class="ff-card-type">M1 · ${esc(coverLabel)}</span>
			<span class="ff-card-b">Cote\u00a0: <strong>${fmt(result.B)}</strong></span>
			${liabHtml}
			<span class="ff-card-profit pos"><strong>${fmt(result.profit)}\u00a0€</strong></span>
			<span class="${rateClass(result.rate)} ff-card-rate">${fmt(result.rate * 100, 1)}\u00a0%</span>
		</div>
		<div class="ff-legs">${legRows}</div>
	</div>`;
}

function buildM2BetRow(bet, idx) {
	const legLabels = bet.legs.map(l => {
		const ev = _data?.[l.eventKey];
		const evName = ev ? eventDisplayName(l.eventKey, ev) : l.eventKey;
		return `${esc(evName)}\u00a0<strong>${esc(l.outcomeName)}</strong>`;
	}).join(' + ');
	return `
	<div class="ff-bet">
		<span class="ff-bet-num">FB${idx + 1}</span>
		<div class="ff-bet-desc">
			<span class="ff-bet-legs">${legLabels}</span>
			<span class="ff-bet-site">${esc(bet.site)} · cote <strong>${fmt(bet.odds)}</strong> · mise <strong>${fmt(bet.amount)}\u00a0€</strong></span>
		</div>
		<span class="ff-bet-profit">${fmt(bet.odds - 1, 2)} \u00d7 ${fmt(bet.amount)}\u00a0€ = <strong>${fmt((bet.odds - 1) * bet.amount)}\u00a0€</strong></span>
	</div>`;
}

function buildM2Card(result) {
	const betRows = result.bets.map((b, i) => buildM2BetRow(b, i)).join('');
	const totalFb = result.nBets * result.amount;
	const guaranteedProfit = result.minPayout * result.amount;
	const minOdds = Math.min(...result.bets.map(b => b.odds));
	const maxOdds = Math.max(...result.bets.map(b => b.odds));
	return `
	<div class="ff-card ff-card-m2">
		<div class="ff-card-header">
			<span class="ff-card-type">M2 · ${result.nBets}\u00a0FB · ${result.nMatches}\u00a0match${result.nMatches > 1 ? 's' : ''}</span>
			<span class="ff-card-b">Cotes\u00a0: ${fmt(minOdds)}\u2013${fmt(maxOdds)}</span>
			<span class="ff-card-totalfb">Total FB\u00a0: <strong>${fmt(totalFb)}\u00a0€</strong></span>
			<span class="ff-card-profit pos"><strong>${fmt(guaranteedProfit)}\u00a0€</strong> garanti</span>
			<span class="${rateClass(result.rate)} ff-card-rate">${fmt(result.rate * 100, 1)}\u00a0%</span>
		</div>
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
	const label = _method === 1
		? `${results.length} opportunité${results.length > 1 ? 's' : ''}`
		: `${results.length} ensemble${results.length > 1 ? 's' : ''} couvrants`;

	el.innerHTML = `
		<p class="ff-summary">${label} — meilleur taux\u00a0: <strong>${fmt(best * 100, 1)}\u00a0%</strong></p>
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
		if (r.method === 2) return r.eventKeys.some(ek => {
			const ev = _data?.[ek];
			if (!ev) return false;
			const evName = eventDisplayName(ek, ev).toLowerCase();
			return evName.includes(q);
		});
		return true;
	});

	const visible = filtered.slice(0, q ? filtered.length : _visibleCount);
	cards.innerHTML = visible.map(r => r.method === 1 ? buildM1Card(r) : buildM2Card(r)).join('');

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
	// For method 2, nLegs means nMatches
	const legsLabel = document.getElementById('ff-legs-label');
	if (legsLabel) legsLabel.textContent = m === 2 ? 'Matchs à couvrir' : 'Sélections';
	const siteRow = document.getElementById('ff-site-row');
	if (siteRow) siteRow.hidden = m === 2;
	tryRender();
}

function setLegs(n) {
	_nLegs = n;
	document.querySelectorAll('.ff-legs-btn').forEach(b =>
		b.classList.toggle('ff-btn--active', +b.dataset.legs === n)
	);
	tryRender();
}

function tryRender() {
	if (!_data) return;
	_amount = parseFloat(document.getElementById('ff-amount')?.value) || 10;
	if (_method === 1) {
		_fbSite = document.getElementById('ff-site-select')?.value ?? '';
		if (!_fbSite) return;
		renderResults(computeM1(_data, _fbSite, _amount, _nLegs));
	} else {
		renderResults(computeM2(_data, _amount, _nLegs));
	}
}

function onJsonChange() {
	const raw = document.getElementById('ff-json')?.value.trim();
	const errEl = document.getElementById('ff-json-error');
	document.getElementById('ff-results').hidden = true;
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
	tryRender();
}

async function pasteFromClipboard() {
	try {
		const text = await navigator.clipboard.readText();
		document.getElementById('ff-json').value = text;
		onJsonChange();
	} catch {
		document.getElementById('ff-json').focus();
	}
}

document.addEventListener('DOMContentLoaded', async () => {
	document.getElementById('ff-site-select')?.addEventListener('change', tryRender);

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
