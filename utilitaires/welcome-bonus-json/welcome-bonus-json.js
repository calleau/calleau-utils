/* ===========================================================================
   Welcome Bonus (JSON) — v2.0.0
   Multi-comptes, multi-règles (coverage-rules.json), Back + Lay,
   recherche de partitions optimales avec sites bonus + sites de couverture.
   =========================================================================== */

const ACCENT_COLORS    = ['#5C899D', '#C07850', '#7BA18A', '#9B7EC4', '#C4A255', '#D17A8C', '#6B9AC4', '#A89060'];
const MAX_PARTITIONS   = 20;
const MAX_CAND_PER_BASE = 12;   // top-K candidats par setBase et par signature de bonus
const MAX_SETBASES_PER_EVENT = 24;
const MAX_PARTITION_SETS = 6;   // garde-fou
const SCORE_EPS = 0.01;

/* ── État global ─────────────────────────────────────────────────────────── */
let _data           = null;   // JSON brut
let _sitesInfo      = null;   // assets/sites-informations.json
let _coverageRules  = null;   // assets/coverage-rules.json
let _parsedEvents   = [];     // [{ eventKey, displayName, dateLabel, markets:{ market:{ issue:{ site:{back,lay} } } } }]
let _setBases       = [];     // setBases dérivés (eventKey × rule expanded)
let _allSites       = [];     // sites détectés dans le JSON (triés)

let _bonusSites     = [];     // [{ site, accounts, bonus, min, maxBonus, convRate }]
let _allowCombine   = false;  // active la génération de setBases combinés 2-events

let _partitions     = null;   // résultats de la recherche
let _selectedPartIdx = 0;

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function norm(s) { return String(s ?? '').toLowerCase().trim().replace(/[\s:.;,!?]+$/, ''); }
function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]); }
function escAttr(s) { return escHtml(s).replace(/`/g, '&#96;'); }
function fmt(v, d = 2) {
	if (v == null || !isFinite(v)) return '—';
	return v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function getBack(val) {
	if (val == null) return null;
	if (typeof val === 'number') return val >= 1.01 ? val : null;
	if (typeof val !== 'object') return null;
	if (val.Back && typeof val.Back === 'object') {
		const o = val.Back.odds_net ?? val.Back.odds;
		return (o != null && o >= 1.01) ? o : null;
	}
	if (typeof val.odds === 'number') return val.odds >= 1.01 ? val.odds : null;
	return null;
}
function getBackBrut(val) {
	if (val == null) return null;
	if (typeof val === 'number') return val >= 1.01 ? val : null;
	if (typeof val !== 'object') return null;
	if (val.Back && typeof val.Back === 'object') {
		const o = val.Back.odds ?? val.Back.odds_net;
		return (o != null && o >= 1.01) ? o : null;
	}
	if (typeof val.odds === 'number') return val.odds >= 1.01 ? val.odds : null;
	return null;
}
function getLay(val) {
	if (val == null || typeof val !== 'object') return null;
	if (val.Lay && typeof val.Lay === 'object') {
		const o = val.Lay.odds_net ?? val.Lay.odds;
		return (o != null && o >= 1.01) ? o : null;
	}
	return null;
}
function getLayBrut(val) {
	if (val == null || typeof val !== 'object') return null;
	if (val.Lay && typeof val.Lay === 'object') {
		const o = val.Lay.odds ?? val.Lay.odds_net;
		return (o != null && o >= 1.01) ? o : null;
	}
	return null;
}

/* ── Chargement assets ───────────────────────────────────────────────────── */
async function loadSitesInfo() {
	if (_sitesInfo) return _sitesInfo;
	try {
		const res = await fetch('../../assets/sites-informations.json');
		_sitesInfo = res.ok ? await res.json() : { default: {} };
	} catch { _sitesInfo = { default: {} }; }
	return _sitesInfo;
}
async function loadCoverageRules() {
	if (_coverageRules) return _coverageRules;
	try {
		const res = await fetch('../../assets/coverage-rules.json');
		_coverageRules = res.ok ? await res.json() : [];
	} catch { _coverageRules = []; }
	return _coverageRules;
}
function siteCommission(site) {
	const def = (_sitesInfo && _sitesInfo.default) || {};
	const sp  = (_sitesInfo && _sitesInfo[site])    || {};
	const v = sp.commission_winning ?? def.commission_winning ?? 0;
	return typeof v === 'number' ? v : 0;
}
function siteWelcomeBonusConfig(siteName) {
	const def = (_sitesInfo && _sitesInfo.default) || {};
	const specific = (_sitesInfo && _sitesInfo[siteName]) || {};
	const merged = { ...def, ...specific };
	let wb;
	if (Object.prototype.hasOwnProperty.call(specific, 'default_welcomebonus') && specific.default_welcomebonus === null) wb = null;
	else { wb = { ...(def.default_welcomebonus || {}), ...(specific.default_welcomebonus || {}) }; if (Object.keys(wb).length === 0) wb = null; }
	const tauxFb = typeof merged.taux_fb === 'number' ? merged.taux_fb : 0.8;
	const convRate = Math.round(tauxFb * 100);
	if (!wb) return { bonus: 'no_bonus', min: 100, maxBonus: 100, convRate };
	let bonus;
	if (wb.type === 'cash') bonus = wb.mission === 'mise' ? 'cash_always' : 'cash_lose';
	else bonus = wb.mission === 'mise' ? 'freebet_always' : 'freebet_lose';
	const max = typeof wb.max_bonus === 'number' ? wb.max_bonus : 100;
	return { bonus, min: max, maxBonus: max, convRate };
}

/* ── Expander de règles coverage-rules.json ──────────────────────────────── *
   Une règle peut contenir des patterns regex (`/^…$/`) côté market ou issue,
   et des templates (`$market`, `$1`, `$1~+-`, …) côté alternatives non-anchor.
   ─────────────────────────────────────────────────────────────────────────── */
function isRegexPattern(s) {
	return typeof s === 'string' && s.length >= 2 && s.startsWith('/') && s.endsWith('/');
}
function compileRegex(s) {
	try { return new RegExp(s.slice(1, -1)); } catch { return null; }
}
function swapChars(str, a, b) {
	let out = '';
	for (const c of str) out += c === a ? b : (c === b ? a : c);
	return out;
}
function tokenizeTemplate(template) {
	const tokens = [];
	let i = 0;
	while (i < template.length) {
		if (template[i] === '$') {
			let key = null, consumed = 0;
			if (template.startsWith('$market', i)) { key = 'market'; consumed = 7; }
			else {
				const m = template.slice(i).match(/^\$(\d+)/);
				if (m) { key = m[1]; consumed = m[0].length; }
			}
			if (key === null) { tokens.push({ literal: '$' }); i++; continue; }
			i += consumed;
			let swap = null;
			if (template[i] === '~' && template[i+1] && template[i+2]) {
				swap = { a: template[i+1], b: template[i+2] };
				i += 3;
			}
			tokens.push({ key, swap });
		} else {
			let j = template.indexOf('$', i);
			if (j === -1) j = template.length;
			tokens.push({ literal: template.slice(i, j) });
			i = j;
		}
	}
	return tokens;
}
function resolveTemplate(template, captures, marketName) {
	if (!template) return '';
	// si le template ne contient ni $ ni regex, c'est une chaîne littérale
	if (!template.includes('$')) return template;
	const tokens = tokenizeTemplate(template);
	return tokens.map(t => {
		if (t.literal !== undefined) return t.literal;
		let val = t.key === 'market' ? marketName : (captures[parseInt(t.key)] ?? '');
		if (t.swap) val = swapChars(String(val), t.swap.a, t.swap.b);
		return val;
	}).join('');
}

/* Renvoie un tableau de "concretRule" applicables à event.
   Chaque concretRule = { groups: [ [{market,issue,betType}, …], … ] } */
function expandRule(rule, event) {
	const groupKeys = Object.keys(rule).filter(k => k !== 'issues');
	if (groupKeys.length === 0) return [];

	// Trouver l'anchor : première alternative avec ≥ 1 pattern regex
	let anchor = null, anchorGroupKey = null;
	for (const gk of groupKeys) {
		const list = rule[gk] || [];
		for (const alt of list) {
			if (isRegexPattern(alt.market) || isRegexPattern(alt.issue)) {
				anchor = alt; anchorGroupKey = gk; break;
			}
		}
		if (anchor) break;
	}

	// Cas 1 : aucune regex → règle déjà concrète, un seul instance
	if (!anchor) {
		const groups = groupKeys.map(gk => rule[gk].map(a => ({ market: a.market, issue: a.issue, betType: a.betType })));
		return [{ groups, anchorGroupKey: groupKeys[0] }];
	}

	// Cas 2 : anchor regex → énumérer toutes les correspondances (market, issue) dans l'event
	const marketRe = isRegexPattern(anchor.market) ? compileRegex(anchor.market) : null;
	const issueRe  = isRegexPattern(anchor.issue)  ? compileRegex(anchor.issue)  : null;
	const concretes = [];
	const seen = new Set();

	for (const marketName of Object.keys(event.markets)) {
		if (marketRe) { if (!marketRe.test(marketName)) continue; }
		else if (anchor.market !== marketName) continue;

		const issues = event.markets[marketName];
		for (const issueName of Object.keys(issues)) {
			let captures;
			if (issueRe) {
				const m = issueName.match(issueRe);
				if (!m) continue;
				captures = m; // captures[0] = match complet, captures[1..] = groupes
			} else {
				if (anchor.issue !== issueName) continue;
				captures = [issueName];
			}

			// Résoudre tous les groupes avec ce captures
			const groups = groupKeys.map(gk =>
				rule[gk].map(a => ({
					market:  resolveTemplate(a.market, captures, marketName),
					issue:   resolveTemplate(a.issue,  captures, marketName),
					betType: a.betType,
				}))
			);
			const sig = JSON.stringify(groups);
			if (seen.has(sig)) continue;
			seen.add(sig);
			concretes.push({ groups, anchorGroupKey });
		}
	}
	return concretes;
}

/* ── Parsing des événements ──────────────────────────────────────────────── */
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
		if (!event || typeof event !== 'object' || !event.markets) continue;
		const markets = {};
		for (const [marketName, market] of Object.entries(event.markets)) {
			if (!market || typeof market !== 'object') continue;
			const issues = {};
			for (const [issueName, issueOdds] of Object.entries(market)) {
				if (!issueOdds || typeof issueOdds !== 'object') continue;
				const sites = {};
				for (const [siteName, val] of Object.entries(issueOdds)) {
					if (siteName === 'timeex') continue;
					const back = getBack(val);
					const lay  = getLay(val);
					if (back == null && lay == null) continue;
					sites[siteName] = {
						back, lay,
						backBrut: getBackBrut(val),
						layBrut: getLayBrut(val),
					};
				}
				if (Object.keys(sites).length > 0) issues[issueName] = sites;
			}
			if (Object.keys(issues).length > 0) markets[marketName] = issues;
		}
		if (Object.keys(markets).length > 0) {
			out.push({
				eventKey,
				displayName: eventDisplayName(eventKey, event),
				dateLabel: eventDateLabel(event),
				markets,
			});
		}
	}
	return out;
}

/* ── Construction des setBases ──────────────────────────────────────────── */
/* setBase = {
     id, eventKey, displayName, dateLabel, ruleIdx, ruleLabel,
     numIssues, groups: [
       [{ market, issue, betType, sitesOdds: { site: odds } }, …],  // groupe 0
       …
     ]
   } */
function tryBuildSetBase(event, ruleIdx, concrete, ruleLabel) {
	const groupSlots = [];
	for (const altList of concrete.groups) {
		const slot = [];
		for (const alt of altList) {
			const issues = event.markets[alt.market];
			if (!issues) continue;
			const issueOdds = issues[alt.issue];
			if (!issueOdds) continue;
			const sitesOdds = {};
			for (const [site, vals] of Object.entries(issueOdds)) {
				const o = alt.betType === 'Lay' ? vals.lay : vals.back;
				const oBrut = alt.betType === 'Lay' ? vals.layBrut : vals.backBrut;
				if (o != null && o >= 1.01) sitesOdds[site] = { net: o, brut: oBrut ?? o };
			}
			if (Object.keys(sitesOdds).length === 0) continue;
			slot.push({ market: alt.market, issue: alt.issue, betType: alt.betType, sitesOdds });
		}
		if (slot.length === 0) return null;
		groupSlots.push(slot);
	}
	const id = `${event.eventKey}::r${ruleIdx}::${groupSlots.map(g => g.map(a => a.market + '/' + a.issue + '/' + a.betType).join('|')).join('»')}`;
	return {
		id, eventKey: event.eventKey, displayName: event.displayName, dateLabel: event.dateLabel,
		ruleIdx, ruleLabel, numIssues: groupSlots.length, groups: groupSlots,
	};
}
function ruleLabelOf(rule, concrete) {
	// Étiquette lisible : "1X2 ↔ DC (3)" ou "Total Buts 2,5+/-"
	const mains = concrete.groups.map(g => g[0] ? `${g[0].market}:${g[0].issue}` : '?').join(' / ');
	return `${mains} [${rule.issues} issues]`;
}
function buildSetBases(parsedEvents, rules) {
	const setBases = [];
	const idsSeen = new Set();
	for (const ev of parsedEvents) {
		const perEvent = [];
		for (let ruleIdx = 0; ruleIdx < rules.length; ruleIdx++) {
			const rule = rules[ruleIdx];
			const concretes = expandRule(rule, ev);
			for (const c of concretes) {
				const sb = tryBuildSetBase(ev, ruleIdx, c, ruleLabelOf(rule, c));
				if (!sb || idsSeen.has(sb.id)) continue;
				idsSeen.add(sb.id);
				perEvent.push(sb);
				if (perEvent.length >= MAX_SETBASES_PER_EVENT) break;
			}
			if (perEvent.length >= MAX_SETBASES_PER_EVENT) break;
		}
		setBases.push(...perEvent);
	}
	return setBases;
}

/* ── computeStakes généralisé (Back + Lay) ───────────────────────────────── *
   Entrée : slots = [{ site, betType, odds, bonus, min, maxBonus, convRate, commission }]
   Hypothèse : un slot par issue. Slot j "couvre" l'issue j (Back ou Lay équivalent).
   Pour le solveur, on adopte la convention :
     • Si issue j se produit : slot j "gagne", autres slots "perdent" (selon Back/Lay)
   Le bonus ne s'applique qu'aux slots Back (sinon convertit à 0).
   ─────────────────────────────────────────────────────────────────────────── */
function computeStakes(slots) {
	const n = slots.length;
	if (n < 2) return null;

	const isBack = slots.map(s => s.betType !== 'Lay');
	const odds   = slots.map(s => s.odds);
	const comm   = slots.map(s => s.commission || 0);

	const bonus = slots.map(s => isBack[s] ? s : null);
	// effectiveConv : taux de conversion freebet (0..1). Cash = 1. no_bonus / Lay = 0.
	const effConv = slots.map((s, j) => {
		if (!isBack[j]) return 0;
		if (s.bonus === 'no_bonus' || !s.bonus) return 0;
		if (s.bonus === 'cash_lose' || s.bonus === 'cash_always') return 1;
		return (s.convRate || 80) / 100;
	});

	// coefficients :
	//   win_j  = mise s_j × winCoef_j + winConst_j  (gain quand issue j se réalise)
	//   lose_j = mise s_j × loseCoef_j + loseConst_j (gain quand une AUTRE issue se réalise)
	// Back : win = (odds-1)*s ; lose = -s
	// Lay  : win = s*(1-c)   ; lose = -(odds-1)*s
	// Bonus (Back only) :
	//   freebet_lose / cash_lose : ajoute convRate * min(s, max) en cas de perte
	//   freebet_always / cash_always : ajoute convRate * min(s, max) toujours
	//   plafond : si s > max → bonus capé à effConv * max + bonus capé constant

	let capped = slots.map(() => false);
	let stakes = null;

	for (let it = 0; it < 30; it++) {
		const winCoef  = new Array(n), winConst = new Array(n);
		const loseCoef = new Array(n), loseConst = new Array(n);

		for (let j = 0; j < n; j++) {
			const s = slots[j];
			if (isBack[j]) {
				const bonusType = s.bonus || 'no_bonus';
				const alwaysBonus = bonusType === 'freebet_always' || bonusType === 'cash_always';
				const loseBonus   = bonusType === 'freebet_lose'   || bonusType === 'cash_lose';
				if (capped[j]) {
					winCoef[j]  = odds[j] - 1;
					winConst[j] = alwaysBonus ? effConv[j] * (s.maxBonus || 0) : 0;
					loseCoef[j] = -1;
					loseConst[j] = (alwaysBonus || loseBonus) ? effConv[j] * (s.maxBonus || 0) : 0;
				} else {
					winCoef[j]  = (odds[j] - 1) + (alwaysBonus ? effConv[j] : 0);
					winConst[j] = 0;
					loseCoef[j] = -1 + ((alwaysBonus || loseBonus) ? effConv[j] : 0);
					loseConst[j] = 0;
				}
			} else {
				// Lay
				winCoef[j]  = 1 - comm[j];
				winConst[j] = 0;
				loseCoef[j] = -(odds[j] - 1);
				loseConst[j] = 0;
			}
		}

		// Équilibrage : tous les gains nets par issue identiques.
		// gain[k] = winCoef[k]*s[k] + winConst[k]  +  sum_{j≠k} (loseCoef[j]*s[j] + loseConst[j])
		// On définit eff[j] = winCoef[j] - loseCoef[j], C[j] = winConst[j] - loseConst[j].
		// gain[k] - gain[0] = (eff[k]*s[k] + C[k]) - (eff[0]*s[0] + C[0]) → on impose = 0
		// → s[k] = (eff[0]*s[0] + C[0] - C[k]) / eff[k]
		const eff = winCoef.map((wc, j) => wc - loseCoef[j]);
		const C   = winConst.map((wc, j) => wc - loseConst[j]);

		if (eff.some(e => Math.abs(e) < 1e-9)) return null;

		// Trouver s[0] minimum tel que toutes les mises ≥ min de chaque slot.
		let s0 = Math.max(slots[0].min || 1, 1);
		for (let k = 1; k < n; k++) {
			const needed = (eff[k] * (slots[k].min || 1) - C[0] + C[k]) / eff[0];
			if (needed > s0) s0 = needed;
		}

		const candidate = new Array(n);
		candidate[0] = s0;
		for (let k = 1; k < n; k++) candidate[k] = (eff[0] * s0 + C[0] - C[k]) / eff[k];

		if (candidate.some(s => !isFinite(s) || s < -0.01)) return null;

		// Vérifier les caps de bonus
		let changed = false;
		for (let j = 0; j < n; j++) {
			if (!isBack[j]) continue;
			const s = slots[j];
			if (s.bonus === 'no_bonus' || !s.bonus || !(s.maxBonus > 0)) continue;
			const shouldCap = candidate[j] > s.maxBonus + 0.01;
			if (shouldCap !== capped[j]) { capped[j] = shouldCap; changed = true; }
		}
		stakes = candidate;
		if (!changed) break;
	}
	if (!stakes) return null;

	// Calcul effectif des gains par issue
	const bonusAmount = (j, s) => {
		const slot = slots[j];
		if (!isBack[j] || !slot.bonus || slot.bonus === 'no_bonus') return 0;
		const cap = slot.maxBonus > 0 ? slot.maxBonus : s;
		return effConv[j] * Math.min(s, cap);
	};
	const gains = stakes.map((_, k) => {
		let g = 0;
		for (let j = 0; j < n; j++) {
			const s = stakes[j];
			if (j === k) {
				if (isBack[j]) {
					g += (odds[j] - 1) * s;
					const bt = slots[j].bonus;
					if (bt === 'freebet_always' || bt === 'cash_always') g += bonusAmount(j, s);
				} else {
					g += s * (1 - comm[j]);
				}
			} else {
				if (isBack[j]) {
					g += -s;
					const bt = slots[j].bonus;
					if (bt === 'freebet_lose' || bt === 'cash_lose' || bt === 'freebet_always' || bt === 'cash_always') g += bonusAmount(j, s);
				} else {
					g += -(odds[j] - 1) * s;
				}
			}
		}
		return g;
	});
	const totalStaked = stakes.reduce((a, b) => a + b, 0);
	const avgGain = gains.reduce((a, b) => a + b, 0) / gains.length;
	const minGain = Math.min(...gains);
	const roi = totalStaked > 0 ? (avgGain / totalStaked) * 100 : 0;
	return { stakes, gains, avgGain, minGain, totalStaked, roi, capped };
}

/* ── Génération de candidats par setBase ─────────────────────────────────── *
   Pour un setBase à G groupes, on doit choisir, par groupe :
     • une alternative (market+issue+betType)
     • un site qui propose la cote correspondante
   Contraintes :
     • Sites bonus : un site bonus n'apparaît que sur des slots Back, et chaque
       apparition consomme 1 compte du site.
     • Au sein d'un set, un site donné apparaît au plus une fois (bonus ou non).
   ─────────────────────────────────────────────────────────────────────────── */
function genCandidatesForBase(setBase) {
	const G = setBase.numIssues;
	const groups = setBase.groups;
	const bonusSiteNames = new Set(_bonusSites.map(b => b.site));
	const bonusBySite = new Map(_bonusSites.map(b => [b.site, b]));

	// Pour chaque slot, lister les options possibles (alt, site, betType, odds, isBonus)
	const slotOptions = groups.map(altList => {
		const opts = [];
		for (let altIdx = 0; altIdx < altList.length; altIdx++) {
			const alt = altList[altIdx];
			for (const [site, oddsObj] of Object.entries(alt.sitesOdds)) {
				const isBonus = bonusSiteNames.has(site);
				if (isBonus && alt.betType !== 'Back') continue; // bonus = Back uniquement
				opts.push({
					altIdx, site, betType: alt.betType,
					odds: oddsObj.net, oddsBrut: oddsObj.brut,
					isBonus, market: alt.market, issue: alt.issue,
				});
			}
		}
		return opts;
	});

	if (slotOptions.some(o => o.length === 0)) return [];

	const candidates = []; // [{ slots:[{site,...}], signature:{site:n}, computed:{...} }]
	const seen = new Set();

	function backtrack(slotIdx, chosen, usedSitesInSet, signature) {
		if (slotIdx === G) {
			// Évaluer le candidat
			const slotSpecs = chosen.map((c, j) => {
				const cfg = c.isBonus ? bonusBySite.get(c.site) : null;
				return {
					site: c.site, betType: c.betType, odds: c.odds, oddsBrut: c.oddsBrut ?? c.odds,
					bonus: cfg ? cfg.bonus : 'no_bonus',
					min: cfg ? cfg.min : 1,
					maxBonus: cfg ? cfg.maxBonus : 0,
					convRate: cfg ? cfg.convRate : 0,
					commission: siteCommission(c.site),
					isBonus: c.isBonus,
					altIdx: c.altIdx,
					market: c.market, issue: c.issue,
				};
			});
			const computed = computeStakes(slotSpecs);
			if (!computed) return;
			if (computed.avgGain < -0.5) return; // élague les très mauvais

			// Clé d'unicité (sites par groupe + alternative)
			const key = chosen.map(c => c.site + ':' + c.altIdx + ':' + c.betType).join('|');
			if (seen.has(key)) return;
			seen.add(key);

			candidates.push({
				baseId: setBase.id,
				slots: slotSpecs,
				signature: { ...signature },
				avgGain: computed.avgGain,
				minGain: computed.minGain,
				totalStaked: computed.totalStaked,
				roi: computed.roi,
				stakes: computed.stakes,
				gains: computed.gains,
				capped: computed.capped,
			});
			return;
		}
		// Brancher sur chaque option de ce slot
		for (const opt of slotOptions[slotIdx]) {
			const prevCount = usedSitesInSet.get(opt.site) || 0;
			if (opt.isBonus) {
				const cfg = bonusBySite.get(opt.site);
				// un site bonus peut occuper plusieurs slots, capé par le nb de comptes
				if (prevCount >= cfg.accounts) continue;
				signature[opt.site] = (signature[opt.site] || 0) + 1;
			} else {
				// site de couverture = 1 compte unique → 1 slot max par setBase
				if (prevCount > 0) continue;
			}
			usedSitesInSet.set(opt.site, prevCount + 1);
			chosen.push(opt);
			backtrack(slotIdx + 1, chosen, usedSitesInSet, signature);
			chosen.pop();
			if (prevCount === 0) usedSitesInSet.delete(opt.site);
			else usedSitesInSet.set(opt.site, prevCount);
			if (opt.isBonus) {
				signature[opt.site]--;
				if (signature[opt.site] === 0) delete signature[opt.site];
			}
		}
	}

	backtrack(0, [], new Map(), {});

	// Tri + top-K par signature de bonus
	candidates.sort((a, b) => b.avgGain - a.avgGain);
	const perSig = new Map();
	const kept = [];
	for (const c of candidates) {
		const sigKey = JSON.stringify(c.signature);
		const n = perSig.get(sigKey) || 0;
		if (n >= MAX_CAND_PER_BASE) continue;
		perSig.set(sigKey, n + 1);
		kept.push(c);
	}
	return kept;
}

/* ── Recherche de partitions ─────────────────────────────────────────────── *
   On reçoit la liste des candidats (regroupés par setBase).
   Une partition = liste de candidats dont la somme des signatures = totalAccounts.
   Optim : on ordonne les setBases par "meilleur avgGain disponible" décroissant,
   on backtrack avec borne sup.
   ─────────────────────────────────────────────────────────────────────────── */
function searchPartitions(allCandidates, totalAccounts) {
	// Grouper par setBase
	const byBase = new Map();
	for (const c of allCandidates) {
		if (!byBase.has(c.baseId)) byBase.set(c.baseId, []);
		byBase.get(c.baseId).push(c);
	}
	// Pour chaque base, déjà triée par avgGain desc
	const totalBudget = Object.values(totalAccounts).reduce((a, b) => a + b, 0);

	// Best upper bound per base : max avgGain disponible
	const bestPerBase = new Map();
	for (const id of byBase.keys()) bestPerBase.set(id, byBase.get(id)[0]?.avgGain ?? 0);

	// Ordonner les bases par meilleur avgGain décroissant : trouve vite les bonnes partitions
	// et permet à l'élagage par borne supérieure de couper agressivement.
	const baseIds = [...byBase.keys()].sort((a, b) => (bestPerBase.get(b) ?? 0) - (bestPerBase.get(a) ?? 0));

	// suffixMax[i] = max bestPerBase parmi baseIds[i..]
	const suffixMax = new Array(baseIds.length + 1).fill(0);
	for (let i = baseIds.length - 1; i >= 0; i--) {
		suffixMax[i] = Math.max(suffixMax[i + 1], bestPerBase.get(baseIds[i]) ?? 0);
	}

	const partitions = [];
	let worstTopGain = -Infinity;

	function pushPartition(parts, totalGain) {
		if (partitions.length < MAX_PARTITIONS) {
			partitions.push({ sets: [...parts], totalGain });
			partitions.sort((a, b) => b.totalGain - a.totalGain);
			worstTopGain = partitions.length === MAX_PARTITIONS ? partitions[partitions.length - 1].totalGain : -Infinity;
		} else if (totalGain > worstTopGain + SCORE_EPS) {
			partitions[partitions.length - 1] = { sets: [...parts], totalGain };
			partitions.sort((a, b) => b.totalGain - a.totalGain);
			worstTopGain = partitions[partitions.length - 1].totalGain;
		}
	}

	function remaining(remainingAccounts) {
		let s = 0;
		for (const k of Object.keys(remainingAccounts)) s += remainingAccounts[k];
		return s;
	}

	function canAccommodate(candidate, remainingAccounts) {
		for (const k of Object.keys(candidate.signature)) {
			if ((remainingAccounts[k] || 0) < candidate.signature[k]) return false;
		}
		return true;
	}

	function applySig(remainingAccounts, sig, sign) {
		for (const k of Object.keys(sig)) {
			remainingAccounts[k] = (remainingAccounts[k] || 0) + sign * sig[k];
			if (remainingAccounts[k] === 0) delete remainingAccounts[k];
		}
	}

	function backtrack(baseStartIdx, candStartIdx, remainingAccounts, parts, gainSoFar) {
		const remain = remaining(remainingAccounts);
		if (remain === 0) { pushPartition(parts, gainSoFar); return; }
		if (parts.length >= MAX_PARTITION_SETS) return;
		if (baseStartIdx >= baseIds.length) return;

		// Borne sup : il reste au plus min(remain, MAX_PARTITION_SETS - parts.length)
		// candidats à placer, chacun contribuant au plus suffixMax[baseStartIdx].
		const slotsLeft = Math.min(remain, MAX_PARTITION_SETS - parts.length);
		const upperBound = gainSoFar + slotsLeft * suffixMax[baseStartIdx];
		if (partitions.length >= MAX_PARTITIONS && upperBound <= worstTopGain + SCORE_EPS) return;

		// Un setBase peut être ré-utilisé plusieurs fois dans une partition (= placer
		// le même set de paris sur plusieurs comptes du même site). On enforce un ordre
		// lexicographique (baseIdx, candIdx) non-décroissant pour éviter de compter
		// plusieurs fois la même partition dans des ordres différents.
		for (let bi = baseStartIdx; bi < baseIds.length; bi++) {
			const cands = byBase.get(baseIds[bi]);
			const startC = (bi === baseStartIdx) ? candStartIdx : 0;
			for (let ci = startC; ci < cands.length; ci++) {
				const cand = cands[ci];
				const sigSize = Object.values(cand.signature).reduce((a, b) => a + b, 0);
				if (sigSize === 0) continue; // un set sans aucun bonus n'avance pas
				if (!canAccommodate(cand, remainingAccounts)) continue;
				applySig(remainingAccounts, cand.signature, -1);
				parts.push(cand);
				backtrack(bi, ci, remainingAccounts, parts, gainSoFar + cand.avgGain);
				parts.pop();
				applySig(remainingAccounts, cand.signature, +1);
			}
		}
	}

	const initRemaining = { ...totalAccounts };
	backtrack(0, 0, initRemaining, [], 0);
	return partitions;
}

/* ── Pipeline calcul ─────────────────────────────────────────────────────── */
function calculate() {
	const err = document.getElementById('error-container');
	err.innerHTML = '';
	const totalAccounts = {};
	for (const b of _bonusSites) {
		if (b.accounts > 0) totalAccounts[b.site] = b.accounts;
	}
	const totalBudget = Object.values(totalAccounts).reduce((a, b) => a + b, 0);
	if (totalBudget === 0) { showError('Indique au moins 1 site bonus avec ≥ 1 compte.'); return; }
	if (_setBases.length === 0) { showError('Aucun setBase utilisable depuis le JSON.'); return; }

	const t0 = performance.now();
	const allCandidates = [];
	for (const sb of _setBases) {
		const cands = genCandidatesForBase(sb);
		allCandidates.push(...cands);
	}
	if (allCandidates.length === 0) { showError('Aucun candidat valide produit. Vérifie les cotes / les sites bonus.'); return; }

	const partitions = searchPartitions(allCandidates, totalAccounts);
	const ms = performance.now() - t0;

	if (partitions.length === 0) { showError('Impossible de placer tous les comptes bonus avec les setBases disponibles.'); return; }

	_partitions = partitions;
	_selectedPartIdx = 0;
	renderPartitions(ms);
	document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function showError(msg) {
	document.getElementById('results').style.display = 'flex';
	document.getElementById('error-container').innerHTML = `<div class="error-box">⚠ ${escHtml(msg)}</div>`;
	document.getElementById('results-tabs-wrapper').hidden = true;
}

/* ── Rendu : partitions + détail ─────────────────────────────────────────── */
function renderPartitions(elapsedMs) {
	document.getElementById('results').style.display = 'flex';
	document.getElementById('error-container').innerHTML = '';
	document.getElementById('results-tabs-wrapper').hidden = false;

	const list = document.getElementById('combos-container');
	list.innerHTML = `
		<div class="combos-list-header">
			<span>${_partitions.length} partition${_partitions.length > 1 ? 's' : ''} (top ${MAX_PARTITIONS})</span>
			<span class="combos-list-hint">${elapsedMs ? fmt(elapsedMs, 0) + ' ms' : ''}</span>
		</div>
		<div class="combos-list">
		${_partitions.map((p, i) => `
			<div class="combo-row ${i === _selectedPartIdx ? 'combo-row--active' : ''}" onclick="selectPartition(${i})">
				<span class="combo-rank">#${i + 1}</span>
				<span class="combo-match-label">${p.sets.length} set${p.sets.length > 1 ? 's' : ''}</span>
				<span class="combo-assignment">${p.sets.map(s => escHtml(setShortLabel(s))).join(' · ')}</span>
				<span class="combo-gain ${p.totalGain >= 0 ? 'pos' : 'neg'}">${fmt(p.totalGain)} €</span>
			</div>
		`).join('')}
		</div>`;
	switchTab('combos');
	selectPartition(0, false);
}
function setShortLabel(set) {
	const sb = _setBases.find(b => b.id === set.baseId);
	return sb ? `${sb.displayName}` : '?';
}
function selectPartition(idx, navigate = true) {
	_selectedPartIdx = idx;
	document.querySelectorAll('.combo-row').forEach((el, i) => el.classList.toggle('combo-row--active', i === idx));
	const p = _partitions[idx];
	if (!p) return;
	renderPartitionDetail(p);
	if (navigate) switchTab('result');
}
function switchTab(name) {
	document.querySelectorAll('.results-tab').forEach(btn => {
		btn.classList.toggle('results-tab--active', btn.dataset.tab === name);
	});
	document.getElementById('tab-combos').hidden = (name !== 'combos');
	document.getElementById('tab-result').hidden  = (name !== 'result');
}
function renderPartitionDetail(p) {
	const totalStaked = p.sets.reduce((a, s) => a + s.totalStaked, 0);
	const totalGain   = p.totalGain;
	const roi = totalStaked > 0 ? (totalGain / totalStaked) * 100 : 0;
	document.getElementById('gain-banner').innerHTML = `
		<div class="metrics-grid">
			<div class="metric-card"><div class="metric-label">Total misé</div><div class="metric-value">${fmt(totalStaked)} €</div></div>
			<div class="metric-card"><div class="metric-label">Gain moyen</div><div class="metric-value ${totalGain >= 0 ? 'pos' : 'neg'}">${fmt(totalGain)} €</div></div>
			<div class="metric-card"><div class="metric-label">ROI</div><div class="metric-value ${roi >= 0 ? 'pos' : 'neg'}">${fmt(roi, 1)} %</div></div>
			<div class="metric-card"><div class="metric-label">Sets</div><div class="metric-value">${p.sets.length}</div></div>
		</div>`;
	document.getElementById('stakes-grid').innerHTML = '';
	document.getElementById('breakdown-container').innerHTML = p.sets.map((s, si) => renderSetCard(s, si)).join('');
}
function renderSetCard(set, idx) {
	const sb = _setBases.find(b => b.id === set.baseId);
	const slotsHTML = set.slots.map((sl, j) => {
		const stake = set.stakes[j];
		const tag = sl.isBonus ? '<span class="tag tag-bonus">BONUS</span>' : (sl.betType === 'Lay' ? '<span class="tag tag-lay">LAY</span>' : '<span class="tag tag-back">BACK</span>');
		const cap = set.capped && set.capped[j] ? ' ⚠' : '';
		const hasComm = sl.oddsBrut != null && Math.abs(sl.oddsBrut - sl.odds) > 0.001;
		const oddsLine = hasComm
			? `@ cote brut ${fmt(sl.oddsBrut)} <span class="stake-odds-net">(net ${fmt(sl.odds)})</span>`
			: `@ cote ${fmt(sl.odds)}`;
		const liabLine = sl.betType === 'Lay'
			? `<div class="stake-liab">Liability : ${fmt(stake * ((sl.oddsBrut ?? sl.odds) - 1))} €</div>`
			: '';
		return `
			<div class="stake-card" style="border-left-color:${ACCENT_COLORS[j % ACCENT_COLORS.length]}">
				<div class="stake-bookie">${escHtml(sl.site)} ${tag}</div>
				<div class="stake-name">${escHtml(sl.market)} — ${escHtml(sl.issue)}</div>
				<div class="stake-amount">${fmt(stake)} €${cap}</div>
				<div class="stake-outcome">${oddsLine}</div>
				${liabLine}
			</div>`;
	}).join('');
	return `
		<div class="set-card">
			<div class="set-card-head">
				<div>
					<div class="set-card-title">Set #${idx + 1} · ${escHtml(sb?.displayName || '?')}</div>
					<div class="set-card-meta">${escHtml(sb?.dateLabel || '')} · ${escHtml(sb?.ruleLabel || '')}</div>
				</div>
				<div class="set-card-gain ${set.avgGain >= 0 ? 'pos' : 'neg'}">${fmt(set.avgGain)} €</div>
			</div>
			<div class="stakes-grid">${slotsHTML}</div>
			${renderSetBreakdown(set)}
		</div>`;
}

/* ── Breakdown détaillé d'un set (cash / bonus par issue × par slot) ─────── */
function renderSetBreakdown(set) {
	const slots = set.slots;
	const stakes = set.stakes;
	const n = slots.length;
	if (!n || !stakes) return '';

	const isCashBonus = b => b === 'cash_lose' || b === 'cash_always';
	const isAlwaysBonus = b => b === 'freebet_always' || b === 'cash_always';
	const isLoseBonus = b => b === 'freebet_lose' || b === 'cash_lose';

	// Détail (cash, fbRaw, fbConv, cashBonus) pour slot j quand l'issue k se produit.
	function cellDetail(j, k) {
		const sl = slots[j];
		const s = stakes[j];
		const isBack = sl.betType !== 'Lay';
		const comm = sl.commission || 0;
		const effConv = !isBack ? 0 : (sl.bonus === 'no_bonus' || !sl.bonus ? 0 : (isCashBonus(sl.bonus) ? 1 : (sl.convRate || 80) / 100));
		const cap = sl.maxBonus > 0 ? sl.maxBonus : s;
		const bonusBase = Math.min(s, cap); // freebet brut applicable
		const wins = (j === k);
		let cash = 0, fbRaw = 0, fbConv = 0, cashBonus = 0;
		if (isBack) {
			if (wins) {
				cash = (sl.odds - 1) * s;
				if (isAlwaysBonus(sl.bonus)) {
					if (isCashBonus(sl.bonus)) cashBonus = bonusBase;
					else { fbRaw = bonusBase; fbConv = effConv * bonusBase; }
				}
			} else {
				cash = -s;
				if (isAlwaysBonus(sl.bonus) || isLoseBonus(sl.bonus)) {
					if (isCashBonus(sl.bonus)) cashBonus = bonusBase;
					else { fbRaw = bonusBase; fbConv = effConv * bonusBase; }
				}
			}
		} else {
			// Lay : convention du solveur — wins quand j === k
			if (wins) cash = s * (1 - comm);
			else cash = -(sl.odds - 1) * s;
		}
		return { cash, fbRaw, fbConv, cashBonus, isCash: isCashBonus(sl.bonus), hasBonus: sl.bonus && sl.bonus !== 'no_bonus' && isBack, convRate: sl.convRate || 0 };
	}

	const headRow = slots.map((sl, k) => `
		<th>
			<div class="th-outcome-title">${escHtml(sl.issue)}</div>
			<div class="th-outcome-sub">${escHtml(sl.market)}</div>
		</th>`).join('');

	const bodyRows = slots.map((sl, j) => {
		const s = stakes[j];
		const cap = set.capped && set.capped[j] ? ' ⚠' : '';
		const cells = slots.map((_, k) => {
			const d = cellDetail(j, k);
			const wins = (j === k);
			const total = d.cash + d.fbConv + d.cashBonus;
			let lines = `<div class="detail-line"><span class="detail-lbl">Cash</span><span class="detail-val ${d.cash >= 0 ? 'pos' : 'neg'}">${fmt(d.cash)} €</span></div>`;
			if (d.hasBonus && d.isCash) {
				lines += `<div class="detail-line"><span class="detail-lbl">Bonus cash</span><span class="detail-val ${d.cashBonus > 0 ? 'neut' : 'text-muted'}">+${fmt(d.cashBonus)} €</span></div>`;
			} else if (d.hasBonus) {
				lines += `<div class="detail-line"><span class="detail-lbl">Freebet brut</span><span class="detail-val ${d.fbRaw > 0 ? 'neut' : 'text-muted'}">+${fmt(d.fbRaw)} €</span></div>`;
				lines += `<div class="detail-line"><span class="detail-lbl">Freebet @${d.convRate}%</span><span class="detail-val ${d.fbConv > 0 ? 'neut' : 'text-muted'}">+${fmt(d.fbConv)} €</span></div>`;
			}
			lines += `<div class="detail-line total-line"><span class="detail-lbl">Total</span><span class="detail-val ${total >= 0 ? 'pos' : 'neg'} strong">${fmt(total)} €</span></div>`;
			return `<td class="td-outcome ${wins ? 'win' : 'lose'}">${lines}</td>`;
		}).join('');
		const tag = sl.isBonus ? ' <span class="tag tag-bonus">BONUS</span>' : '';
		const hasComm = sl.oddsBrut != null && Math.abs(sl.oddsBrut - sl.odds) > 0.001;
		const oddsTxt = hasComm
			? `@ ${fmt(sl.oddsBrut)} <span class="text-muted">(net ${fmt(sl.odds)})</span>`
			: `@ ${fmt(sl.odds)}`;
		const liabTxt = sl.betType === 'Lay'
			? `<div class="site-meta">Liability : ${fmt(s * ((sl.oddsBrut ?? sl.odds) - 1))} €</div>`
			: '';
		return `
			<tr>
				<td>
					<div class="site-name">${escHtml(sl.site)}${tag}</div>
					<div class="site-meta">${escHtml(sl.issue)} (${escHtml(sl.betType)}) ${oddsTxt}</div>
					<div class="site-meta">Mise : ${fmt(s)} €${cap}</div>
					${liabTxt}
				</td>
				${cells}
			</tr>`;
	}).join('');

	const totalRow = (() => {
		const cells = slots.map((_, k) => {
			let totalCash = 0, totalFbRaw = 0, totalFbConv = 0, totalCashBonus = 0;
			let hasFb = false, hasCash = false;
			for (let j = 0; j < n; j++) {
				const d = cellDetail(j, k);
				totalCash += d.cash; totalFbRaw += d.fbRaw; totalFbConv += d.fbConv; totalCashBonus += d.cashBonus;
				if (d.hasBonus && d.isCash) hasCash = true;
				else if (d.hasBonus) hasFb = true;
			}
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
		}).join('');
		return `<tr class="total-row"><td><div class="total-label"><div class="site-name">Total</div></div></td>${cells}</tr>`;
	})();

	return `
		<div class="breakdown">
			<table class="breakdown-table">
				<thead><tr><th>Site / Pari</th>${headRow}</tr></thead>
				<tbody>${bodyRows}${totalRow}</tbody>
			</table>
		</div>`;
}

/* ── UI : sites bonus ─────────────────────────────────────────────────────── */
function renderBonusSites() {
	const container = document.getElementById('bonus-sites-container');
	const suggestions = _allSites.filter(s => !_bonusSites.find(b => b.site === s));
	container.innerHTML = `
		<div class="card">
			<div class="card-label">Sites bonus (un compte = un slot bonus à placer)</div>
			<div class="bonus-sites-list">
				${_bonusSites.length === 0 ? '<p class="placed-bets-empty">Aucun site bonus. Choisis un site ci-dessous.</p>' : ''}
				${_bonusSites.map((b, i) => `
					<div class="bonus-site-row">
						<div class="bs-name" style="border-left:4px solid ${ACCENT_COLORS[i % ACCENT_COLORS.length]}">${escHtml(b.site)}</div>
						<div class="bs-field"><label>Comptes</label>
							<input type="number" min="1" max="9" value="${b.accounts}" oninput="updateBonusAccounts(${i}, this.value)" onclick="this.select()" />
						</div>
						<div class="bs-field"><label>Bonus</label>
							<select onchange="_bonusSites[${i}].bonus = this.value">
								<option value="freebet_lose"   ${b.bonus==='freebet_lose'?'selected':''}>Freebet si perdant</option>
								<option value="freebet_always" ${b.bonus==='freebet_always'?'selected':''}>Freebet toujours</option>
								<option value="cash_lose"      ${b.bonus==='cash_lose'?'selected':''}>Cash si perdant</option>
								<option value="cash_always"    ${b.bonus==='cash_always'?'selected':''}>Cash toujours</option>
								<option value="no_bonus"       ${b.bonus==='no_bonus'?'selected':''}>Sans bonus</option>
							</select>
						</div>
						<div class="bs-field"><label>Bonus max €</label>
							<input type="number" min="0" value="${b.maxBonus}" oninput="_bonusSites[${i}].maxBonus = parseFloat(this.value)||0" />
						</div>
						<div class="bs-field"><label>Min mise €</label>
							<input type="number" min="0" value="${b.min}" oninput="_bonusSites[${i}].min = parseFloat(this.value)||0" />
						</div>
						<div class="bs-field"><label>Taux FB %</label>
							<input type="number" min="1" max="100" value="${b.convRate}" oninput="_bonusSites[${i}].convRate = Math.min(100,Math.max(1,parseFloat(this.value)||80))" />
						</div>
						<button class="btn-delete-bookie" onclick="removeBonusSite(${i})" title="Retirer">✕</button>
					</div>`).join('')}
			</div>
			<div class="bonus-site-add">
				<select id="bs-add-select"><option value="">+ Ajouter un site bonus…</option>${suggestions.map(s => `<option value="${escAttr(s)}">${escHtml(s)}</option>`).join('')}</select>
				<button class="btn btn-ghost" onclick="addBonusSiteFromSelect()">Ajouter</button>
			</div>
		</div>`;
	updateCalcBtn();
}
function addBonusSiteFromSelect() {
	const sel = document.getElementById('bs-add-select');
	const site = sel.value;
	if (!site) return;
	addBonusSite(site);
	sel.value = '';
}
function addBonusSite(site) {
	if (_bonusSites.find(b => b.site === site)) return;
	const cfg = siteWelcomeBonusConfig(site);
	_bonusSites.push({ site, accounts: 1, bonus: cfg.bonus, min: cfg.min, maxBonus: cfg.maxBonus, convRate: cfg.convRate });
	renderBonusSites();
}
function removeBonusSite(i) { _bonusSites.splice(i, 1); renderBonusSites(); }
function updateBonusAccounts(i, val) {
	const n = Math.min(9, Math.max(1, parseInt(val) || 1));
	_bonusSites[i].accounts = n;
	updateCalcBtn();
}
function updateCalcBtn() {
	const btn = document.getElementById('btn-calc');
	const totalAcc = _bonusSites.reduce((a, b) => a + b.accounts, 0);
	btn.disabled = !(_setBases.length > 0 && totalAcc > 0);
	const info = document.getElementById('setbases-info');
	if (info) info.textContent = `${_setBases.length} setBases · ${_allSites.length} sites · ${totalAcc} comptes bonus`;
}

/* ── UI : panneau JSON ───────────────────────────────────────────────────── */
async function onJsonChange() {
	await Promise.all([loadSitesInfo(), loadCoverageRules()]);
	const raw = document.getElementById('wbj-json').value.trim();
	const errEl = document.getElementById('wbj-json-error');
	resetResults();
	if (!raw) { _data = null; _parsedEvents = []; _setBases = []; _allSites = []; errEl.hidden = true; renderBonusSites(); return; }
	try { _data = JSON.parse(raw); errEl.hidden = true; }
	catch (e) { _data = null; _parsedEvents = []; _setBases = []; _allSites = []; errEl.textContent = 'JSON invalide : ' + e.message; errEl.hidden = false; renderBonusSites(); return; }
	_parsedEvents = parseEvents(_data);
	_setBases = buildSetBases(_parsedEvents, _coverageRules);
	const allSitesSet = new Set();
	for (const ev of _parsedEvents) {
		for (const market of Object.values(ev.markets)) {
			for (const issue of Object.values(market)) {
				for (const site of Object.keys(issue)) allSitesSet.add(site);
			}
		}
	}
	_allSites = [...allSitesSet].sort();
	if (_setBases.length === 0) { errEl.textContent = 'Aucun setBase compatible. Vérifie le contenu JSON.'; errEl.hidden = false; }
	renderBonusSites();
}
async function pasteFromClipboard() {
	try {
		const text = await navigator.clipboard.readText();
		document.getElementById('wbj-json').value = text;
		await onJsonChange();
	} catch {}
}
function resetResults() {
	_partitions = null;
	document.getElementById('results').style.display = 'none';
	document.getElementById('error-container').innerHTML = '';
}

/* ── Démarrage ───────────────────────────────────────────────────────────── */
Promise.all([loadSitesInfo(), loadCoverageRules()]).then(() => {
	renderBonusSites();
	updateCalcBtn();
});

/* ── VERSIONS ────────────────────────────────────────────────────────────── */
document.getElementById('footer-version').textContent =
	'Bonus de bienvenue (JSON) — ' + (window.CURRENT_VERSION || 'version actuelle');

const versionsWidget   = document.getElementById('versions-widget');
const versionsBtn      = document.getElementById('versions-btn');
const versionsDropdown = document.getElementById('versions-dropdown');
let versionsLoaded = false;

versionsBtn.addEventListener('click', () => {
	const isOpen = !versionsDropdown.hidden;
	versionsDropdown.hidden = isOpen;
	if (isOpen || versionsLoaded) return;
	versionsLoaded = true;
	const versions = window.AVAILABLE_VERSIONS || [];
	if (versions.length === 0) {
		versionsDropdown.innerHTML = '<p class="versions-msg">Aucune version disponible</p>';
	} else {
		versionsDropdown.innerHTML = '<p class="versions-header">Versions précédentes</p>' +
			versions.map(v => `<a href="${v}/index.html" class="version-link">
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
					<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
				</svg>${v}</a>`).join('');
	}
});
document.addEventListener('click', (e) => {
	if (!versionsWidget.contains(e.target)) versionsDropdown.hidden = true;
});
