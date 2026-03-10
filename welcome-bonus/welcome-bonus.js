const ACCENT_COLORS = ['#5C899D', '#C07850', '#7BA18A', '#9B7EC4', '#C4A255'];

const SITE_LIST = [
	'Betclic', 'Betsson', 'bwin', 'Daznbet', 'Feelingbet',
	'Olybet', 'Parions Sports', 'PMU', 'Pokerstars',
	'Unibet', 'VBET', 'Winamax',
];

const SITE_PRESETS = {
	'Betclic':        { bonus: 'freebet_lose',   min: 100, maxBonus: 100, convRate: 85 },
	'Betsson':        { bonus: 'freebet_lose',   min: 100, maxBonus: 100, convRate: 70 },
	'bwin':           { bonus: 'freebet_lose',   min: 100, maxBonus: 100, convRate: 70 },
	'Daznbet':        { bonus: 'freebet_lose',   min: 100, maxBonus: 100, convRate: 70 },
	'Feelingbet':     { bonus: 'freebet_lose',   min: 50,  maxBonus: 50,  convRate: 70 },
	'Olybet':         { bonus: 'freebet_lose',   min: 100, maxBonus: 100, convRate: 70 },
	'Parions Sports': { bonus: 'freebet_always', min: 100, maxBonus: 100, convRate: 85 },
	'PMU':            { bonus: 'cash_lose',      min: 100, maxBonus: 100, convRate: 70 },
	'Pokerstars':     { bonus: 'freebet_lose',   min: 100, maxBonus: 100, convRate: 70 },
	'Unibet':         { bonus: 'freebet_lose',   min: 100, maxBonus: 100, convRate: 85 },
	'VBET':           { bonus: 'freebet_lose',   min: 100, maxBonus: 100, convRate: 70 },
	'Winamax':        { bonus: 'cash_lose',      min: 100, maxBonus: 100, convRate: 80 },
};

const OUTCOMES = ['1', 'N', '2'];

const SLOTS_P2 = [];
for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) SLOTS_P2.push([i, j]);

// ---- État global ----
let bookies  = [];           // { site, name, bonus, min, maxBonus }
let matches  = [{ name: 'Match 1' }, { name: 'Match 2' }];
let parlaySize = 1;
let oddsGrid = [];           // oddsGrid[siteIdx][matchIdx][outcomeIdx] = float | null
let _comboResults     = null; // { results }
let _selectedComboIdx = 0;
let _currentShowCount = 20;
let _nameRefreshTimer = null;

// ---- Initialisation ----

function makeBookie(i) {
	const defaults = [
		{ site: 'Betclic', name: 'Betclic', bonus: 'freebet_lose',   min: 100, maxBonus: 100, convRate: 85 },
		{ site: 'Winamax', name: 'Winamax', bonus: 'freebet_always', min: 100, maxBonus: 100, convRate: 80 },
		{ site: 'Unibet',  name: 'Unibet',  bonus: 'freebet_lose',   min: 100, maxBonus: 100, convRate: 85 },
	];
	return defaults[i] || { site: '-Autre-', name: `Site ${i + 1}`, bonus: 'freebet_lose', min: 100, maxBonus: 100, convRate: 80 };
}

function makeOddsForSite() {
	return matches.map(() => new Array(3).fill(null));
}

function init() {
	for (let i = 0; i < 3; i++) {
		bookies.push(makeBookie(i));
		oddsGrid.push(makeOddsForSite());
	}
	// Cotes d'exemple — match 0
	oddsGrid[0][0] = [2.10, 3.20, 3.50];
	oddsGrid[1][0] = [2.05, 3.40, 3.30];
	oddsGrid[2][0] = [2.15, 3.10, 3.60];
	// Cotes d'exemple — match 1
	oddsGrid[0][1] = [1.90, 3.50, 4.00];
	oddsGrid[1][1] = [1.95, 3.30, 3.80];
	oddsGrid[2][1] = [1.85, 3.60, 4.10];
	renderAll();
}

// ---- Gestion des sites ----

function addBookie() {
	if (bookies.length >= 15) return;
	bookies.push(makeBookie(bookies.length));
	oddsGrid.push(makeOddsForSite());
	renderAll();
}

function removeBookie() {
	if (bookies.length <= 2) return;
	bookies.pop();
	oddsGrid.pop();
	renderAll();
}

// ---- Gestion des matchs ----

function addMatch() {
	if (matches.length >= 5) return;
	matches.push({ name: `Match ${matches.length + 1}` });
	for (let i = 0; i < oddsGrid.length; i++) {
		oddsGrid[i].push(new Array(3).fill(null));
	}
	renderAll();
}

function removeMatch(idx) {
	matches.splice(idx, 1);
	for (let i = 0; i < oddsGrid.length; i++) {
		oddsGrid[i].splice(idx, 1);
	}
	if (parlaySize === 2 && matches.length < 2) parlaySize = 1;
	renderAll();
}

function setParlaySize(size) {
	if (size === 2 && matches.length < 2) return;
	parlaySize = size;
	renderMatchesAndOdds();
}

// ---- Mise à jour du nom d'un bookmaker ----

function updateBookieName(i, val) {
	bookies[i].name = val;
	document.querySelectorAll('[data-odds-name="' + i + '"]').forEach(el => el.textContent = val);
	scheduleNameRefresh();
}

// ---- Rendu ----

function renderAll() {
	renderBookies();
	renderMatchesAndOdds();
}

function renderBookies() {
	const container = document.getElementById('bookies-container');
	container.innerHTML = `
        <div class="bookies-table-container">
          <table class="bookies-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Site</th>
                <th>Nom affiché</th>
                <th>Type de bonus</th>
                <th>Mise min</th>
                <th>Bonus max</th>
                <th>Taux FB</th>
              </tr>
            </thead>
            <tbody>
              ${bookies.map((b, i) => `
                <tr>
                  <td>
                    <div class="bookie-num-badge">
                      <div style="width:8px;height:8px;border-radius:50%;background:${ACCENT_COLORS[i % ACCENT_COLORS.length]}"></div>
                      ${i + 1}
                    </div>
                  </td>
                  <td>
                    <select id="site-${i}" class="site-select" onchange="selectSite(${i}, this.value)">
                      <option value="-Autre-" ${b.site === '-Autre-' ? 'selected' : ''}>— Autre —</option>
                      ${SITE_LIST.map(s => `<option value="${s}" ${b.site === s ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                  </td>
                  <td><input type="text" id="name-${i}" value="${b.name}" oninput="updateBookieName(${i}, this.value)" onclick="this.select()" placeholder="Ex: Betclic" /></td>
                  <td>
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
                  </td>
                  <td>
                    <div class="numinput">
                      <input type="number" id="min-${i}" value="${b.min}" step="1" min="0" oninput="bookies[${i}].min=parseFloat(this.value)||0" onclick="this.select()" />
                      <span class="unit">€</span>
                      <div class="nbtn-wrap">
                        <button class="nbtn" onclick="incrementMin(${i})" type="button">▲</button>
                        <button class="nbtn" onclick="decrementMin(${i})" type="button">▼</button>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div class="numinput">
                      <input type="number" id="max-${i}" value="${b.maxBonus}" step="1" min="0" oninput="bookies[${i}].maxBonus=parseFloat(this.value)||0" onclick="this.select()" />
                      <span class="unit">€</span>
                      <div class="nbtn-wrap">
                        <button class="nbtn" onclick="incrementMax(${i})" type="button">▲</button>
                        <button class="nbtn" onclick="decrementMax(${i})" type="button">▼</button>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div id="conv-cell-${i}" class="numinput" ${['cash_lose','cash_always','no_bonus'].includes(b.bonus) ? 'hidden' : ''}>
                      <input type="number" id="conv-${i}" value="${b.convRate}" min="1" max="100" step="1"
                        oninput="bookies[${i}].convRate=Math.min(100,Math.max(1,parseFloat(this.value)||80))"
                        onclick="this.select()" />
                      <span class="unit">%</span>
                      <div class="nbtn-wrap">
                        <button class="nbtn" onclick="incrementConv(${i})" type="button">▲</button>
                        <button class="nbtn" onclick="decrementConv(${i})" type="button">▼</button>
                      </div>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
}

function renderMatchesAndOdds() {
	const container = document.getElementById('odds-container');
	const parlayBtn1Class = 'parlay-btn' + (parlaySize === 1 ? ' parlay-btn--active' : '');
	const parlayBtn2Class = 'parlay-btn' + (parlaySize === 2 ? ' parlay-btn--active' : '');
	const parlayBtn2Disabled = matches.length < 2 ? 'disabled' : '';

	let html = `
        <div class="parlay-selector">
          <span class="parlay-label">Nombre de matchs en combiné :</span>
          <div class="parlay-toggle">
            <button class="${parlayBtn1Class}" onclick="setParlaySize(1)">1 match — 3 issues</button>
            <button class="${parlayBtn2Class}" onclick="setParlaySize(2)" ${parlayBtn2Disabled}>2 matchs — 9 issues</button>
          </div>
        </div>
      `;

	matches.forEach((m, mIdx) => {
		html += `
        <div class="match-section">
          <div class="match-header">
            <input type="text" class="match-name-input" value="${m.name}" oninput="matches[${mIdx}].name = this.value" onclick="this.select()" placeholder="Nom du match" />
            ${matches.length > 1 ? `<button class="btn-remove-match" onclick="removeMatch(${mIdx})" title="Supprimer ce match">✕</button>` : ''}
          </div>
          <div class="bookies-table-container">
            <table class="odds-table">
              <thead>
                <tr>
                  <th class="odds-site-th">Site</th>
                  ${OUTCOMES.map(o => `<th><div class="outcome-th"><span class="outcome-label">${o}</span></div></th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${bookies.map((b, i) => `
                  <tr>
                    <td class="odds-site-cell">
                      <div class="bookie-color-dot" style="background:${ACCENT_COLORS[i % ACCENT_COLORS.length]}"></div>
                      <span data-odds-name="${i}">${b.name}</span>
                    </td>
                    ${OUTCOMES.map((_, j) => `
                      <td class="odds-cell">
                        <input type="number"
                          class="odds-input"
                          value="${oddsGrid[i] && oddsGrid[i][mIdx] && oddsGrid[i][mIdx][j] != null ? oddsGrid[i][mIdx][j] : ''}"
                          step="0.01" min="1.01"
                          placeholder="—"
                          oninput="oddsGrid[${i}][${mIdx}][${j}] = parseFloat(this.value) || null"
                          onclick="this.select()" />
                      </td>
                    `).join('')}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
	});

	html += `
        <div class="match-controls">
          <button class="btn btn-ghost" onclick="addMatch()" ${matches.length >= 5 ? 'disabled' : ''}>+ Ajouter un match</button>
          ${matches.length > 1 ? `<button class="btn btn-ghost" onclick="removeMatch(matches.length - 1)">− Retirer le dernier</button>` : ''}
        </div>
      `;

	container.innerHTML = html;
}

// ---- Contrôles numériques ----

function incrementMin(i) {
	const input = document.getElementById(`min-${i}`);
	const newVal = (parseFloat(input.value) || 0) + 10;
	input.value = newVal; bookies[i].min = newVal;
}
function decrementMin(i) {
	const input = document.getElementById(`min-${i}`);
	const newVal = Math.max(0, (parseFloat(input.value) || 0) - 10);
	input.value = newVal; bookies[i].min = newVal;
}
function incrementMax(i) {
	const input = document.getElementById(`max-${i}`);
	const newVal = (parseFloat(input.value) || 0) + 10;
	input.value = newVal; bookies[i].maxBonus = newVal;
}
function decrementMax(i) {
	const input = document.getElementById(`max-${i}`);
	const newVal = Math.max(0, (parseFloat(input.value) || 0) - 10);
	input.value = newVal; bookies[i].maxBonus = newVal;
}
function incrementConv(i) {
	const input = document.getElementById(`conv-${i}`);
	const newVal = Math.min(100, (parseFloat(input.value) || 80) + 5);
	input.value = newVal; bookies[i].convRate = newVal;
}
function decrementConv(i) {
	const input = document.getElementById(`conv-${i}`);
	const newVal = Math.max(1, (parseFloat(input.value) || 80) - 5);
	input.value = newVal; bookies[i].convRate = newVal;
}
function updateConvRateVisibility(i, bonusType) {
	const cell = document.getElementById(`conv-cell-${i}`);
	if (cell) cell.hidden = ['cash_lose', 'cash_always', 'no_bonus'].includes(bonusType);
}

function selectSite(i, siteKey) {
	bookies[i].site = siteKey;
	if (siteKey === '-Autre-') return;
	const preset = SITE_PRESETS[siteKey];
	if (!preset) return;
	bookies[i].name = siteKey;
	bookies[i].bonus = preset.bonus;
	bookies[i].min = preset.min;
	bookies[i].maxBonus = preset.maxBonus;
	bookies[i].convRate = preset.convRate;
	document.getElementById(`name-${i}`).value = siteKey;
	document.getElementById(`bonus-${i}`).value = preset.bonus;
	updateBonusDot(i, preset.bonus);
	updateConvRateVisibility(i, preset.bonus);
	document.getElementById(`min-${i}`).value = preset.min;
	document.getElementById(`max-${i}`).value = preset.maxBonus;
	document.getElementById(`conv-${i}`).value = preset.convRate;
}

function updateBonusDot(index, bonusType) {
	const dot = document.querySelector(`.bonus-dot-${index}`);
	if (dot) dot.setAttribute('data-bonus', bonusType);
}

function fmt(v, decimals = 2) {
	return v.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ---- Calcul ----

// Nombre de combinaisons à stocker et présenter (20 affichées + 100 via bouton)
const MAX_STORED = 120;

// Score rapide d'un slot : 1 / (cote - taux_conv_effectif)
// Somme sur tous les slots = indicateur d'arbitrage (plus bas = plus rentable)
// Monotone croissant pendant le backtracking → permet l'élagage branch-and-bound
function slotScore(siteIdx, odds) {
	const b = bookies[siteIdx];
	let r;
	if (b.bonus === 'no_bonus') r = 0;
	else if (b.bonus === 'cash_lose' || b.bonus === 'cash_always') r = 1;
	else r = b.convRate / 100;
	return 1 / Math.max(odds - r, 0.001);
}

// Insère dans un tableau trié par score croissant, plafond MAX_STORED
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
		// Élagage : ps est un minorant du score final (tous les termes sont ≥ 0)
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
	const rawCombos = parlaySize === 1 ? generateCombinationsP1() : generateCombinationsP2();
	if (rawCombos.length === 0) {
		showError(parlaySize === 1
			? 'Aucune combinaison valide. Assurez-vous que chaque issue a au moins une cote renseignée sur un site différent.'
			: 'Aucune combinaison valide. Pour un combiné 2 matchs, il faut au moins 9 sites avec des cotes renseignées sur les deux matchs.'
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
		showError("Impossible d'équilibrer les mises pour ces paramètres. Vérifiez les cotes et les bonus.");
		return;
	}
	results.sort((a, b) => b.avgGain - a.avgGain);
	_comboResults = { results };
	_selectedComboIdx = 0;
	renderCombinationsList(20);
	document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- Affichage des combinaisons ----

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
				`<span class="combo-site" style="color:${ACCENT_COLORS[siteIdx % ACCENT_COLORS.length]}">${bookies[siteIdx].name}</span><span class="combo-outcome-tag">${OUTCOMES[outcomeIdx]}</span>`
			).join('<span class="combo-sep">·</span>');
		} else {
			assignment = r.combo.slice(0, 3).map((siteIdx, k) => {
				const [i, j] = SLOTS_P2[k];
				return `<span class="combo-site" style="color:${ACCENT_COLORS[siteIdx % ACCENT_COLORS.length]}">${bookies[siteIdx].name}</span><span class="combo-outcome-tag">${OUTCOMES[i]}×${OUTCOMES[j]}</span>`;
			}).join('<span class="combo-sep">·</span>') + '<span class="combo-sep">…</span>';
		}
		return `
              <div class="combo-row" onclick="selectCombo(${idx})">
                <span class="combo-rank">#${idx + 1}</span>
                <span class="combo-match-label">${matchLabel}</span>
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

function scheduleNameRefresh() {
	clearTimeout(_nameRefreshTimer);
	_nameRefreshTimer = setTimeout(() => {
		if (!_comboResults) return;
		const { results } = _comboResults;
		// Mettre à jour les noms dans les snapshots active[]
		results.forEach(r => r.active.forEach(a => { a.name = bookies[a.siteIdx].name; }));
		// Ré-afficher la liste sans changer d'onglet
		document.getElementById('combos-container').innerHTML = buildCombosHTML(results, _currentShowCount);
		document.querySelectorAll('.combo-row').forEach((el, i) => {
			el.classList.toggle('combo-row--active', i === _selectedComboIdx);
		});
		// Ré-afficher le détail si l'onglet résultat est ouvert
		if (!document.getElementById('tab-result').hidden) {
			showResults({ active: results[_selectedComboIdx].active, ...results[_selectedComboIdx] });
		}
	}, 500);
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

// ---- Erreur ----

function showError(msg) {
	document.getElementById('results').style.display = 'flex';
	document.getElementById('results-tabs-wrapper').hidden = true;
	document.getElementById('error-container').innerHTML = `<div class="error-box">⚠ ${msg}</div>`;
}

// ---- Détail d'une combinaison ----

function showResults({ active, stakes, avgGain, totalStaked, roi, capped, bonusAmount }) {
	const matchLabel = active[0]?.matchLabel || '';
	document.getElementById('gain-banner').innerHTML = `
        ${matchLabel ? '<div class="result-match-label">' + matchLabel + '</div>' : ''}
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
            <div class="stake-bookie" style="color:${color}">${b.name}</div>
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
                    <div class="th-outcome-sub">${b.name} gagne @ ${fmt(b.odds)}</div>
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
                      <div class="site-name">${site.name}</div>
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

              <!-- Ligne totaux -->
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

// ---- Cotes aléatoires ----

function randomizeOdds() {
	const hasOdds = oddsGrid.some(row => row.some(m => m.some(v => v != null)));
	if (hasOdds) {
		const confirmed = confirm('Les cotes actuelles seront toutes remplacées. Continuer ?');
		if (!confirmed) return;
	}
	oddsGrid = bookies.map(() =>
		matches.map(() => OUTCOMES.map(() => Math.round((Math.random() + 2) * 100) / 100))
	);
	renderMatchesAndOdds();
}

// ---- Démarrage ----

init();

document.getElementById('footer-version').textContent =
	'Bonus de bienvenue — ' + (window.CURRENT_VERSION || 'version actuelle');

/* ---- Widget versions précédentes ---- */
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
		versionsDropdown.innerHTML =
			'<p class="versions-header">Versions précédentes</p>' +
			versions.map(v =>
				`<a href="${v}/index.html" class="version-link">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              ${v}
            </a>`
			).join('');
	}
});

document.addEventListener('click', (e) => {
	if (!versionsWidget.contains(e.target)) versionsDropdown.hidden = true;
});
