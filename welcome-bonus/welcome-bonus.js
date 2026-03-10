const ACCENT_COLORS = ['#5C899D', '#C07850', '#7BA18A', '#9B7EC4', '#C4A255'];

const SITE_LIST = [
	'Betclic', 'Betsson', 'bwin', 'Daznbet', 'Feelingbet',
	'Olybet', 'Parions Sports', 'PMU', 'Pokerstars',
	'Unibet', 'VBET', 'Winamax',
];

const SITE_PRESETS = {
	'Betclic':        { bonus: 'freebet_lose',   min: 100, maxBonus: 100 },
	'Betsson':        { bonus: 'freebet_lose',   min: 100, maxBonus: 100 },
	'bwin':           { bonus: 'freebet_lose',   min: 100, maxBonus: 100 },
	'Daznbet':        { bonus: 'freebet_lose',   min: 100, maxBonus: 100 },
	'Feelingbet':     { bonus: 'freebet_lose',   min: 50, maxBonus: 50 },
	'Olybet':         { bonus: 'freebet_lose',   min: 100, maxBonus: 100 },
	'Parions Sports': { bonus: 'freebet_always',   min: 100, maxBonus: 100 },
	'PMU':            { bonus: 'cash_lose',   min: 100, maxBonus: 100 },
	'Pokerstars':     { bonus: 'freebet_lose',   min: 100,  maxBonus: 100  },
	'Unibet':         { bonus: 'freebet_lose',   min: 100, maxBonus: 100 },
	'VBET':           { bonus: 'freebet_lose',   min: 100, maxBonus: 100 },
	'Winamax':        { bonus: 'cash_lose', min: 100, maxBonus: 100 },
};

// ---- État global ----
let bookies  = [];           // { site, name, bonus, min, maxBonus }
let outcomes = ['1', 'N', '2'];
let oddsGrid = [];           // oddsGrid[siteIdx][outcomeIdx] = float | null
let _comboResults    = null; // { results, convRate }
let _selectedComboIdx = 0;

// ---- Initialisation ----

function makeBookie(i) {
	const defaults = [
		{ site: 'Betclic', name: 'Betclic', bonus: 'freebet_lose',   min: 100, maxBonus: 100 },
		{ site: 'Winamax', name: 'Winamax', bonus: 'freebet_always', min: 100, maxBonus: 100 },
		{ site: 'Unibet',  name: 'Unibet',  bonus: 'freebet_lose',   min: 100, maxBonus: 100 },
	];
	return defaults[i] || { site: '-Autre-', name: `Site ${i + 1}`, bonus: 'freebet_lose', min: 100, maxBonus: 100 };
}

function init() {
	for (let i = 0; i < 3; i++) {
		bookies.push(makeBookie(i));
		oddsGrid.push(new Array(outcomes.length).fill(null));
	}
	// Cotes d'exemple
	oddsGrid[0] = [2.10, 3.20, 3.50];
	oddsGrid[1] = [2.05, 3.40, 3.30];
	oddsGrid[2] = [2.15, 3.10, 3.60];
	renderAll();
}

// ---- Gestion des sites ----

function addBookie() {
	if (bookies.length >= 8) return;
	bookies.push(makeBookie(bookies.length));
	oddsGrid.push(new Array(outcomes.length).fill(null));
	renderAll();
}

function removeBookie() {
	if (bookies.length <= 2) return;
	bookies.pop();
	oddsGrid.pop();
	renderAll();
}

// ---- Gestion des issues ----

function addOutcome() {
	outcomes.push(`Issue ${outcomes.length + 1}`);
	oddsGrid.forEach(row => row.push(null));
	renderAll();
}

function removeOutcome(j) {
	if (outcomes.length <= 2) return;
	outcomes.splice(j, 1);
	oddsGrid.forEach(row => row.splice(j, 1));
	renderAll();
}

// ---- Rendu ----

function renderAll() {
	renderBookies();
	renderOddsTable();
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
                  <td><input type="text" id="name-${i}" value="${b.name}" oninput="bookies[${i}].name=this.value" onclick="this.select()" placeholder="Ex: Betclic" /></td>
                  <td>
                    <div class="bonus-select-wrapper">
                      <span class="bonus-dot bonus-dot-${i}" data-bonus="${b.bonus}"></span>
                      <select id="bonus-${i}" onchange="bookies[${i}].bonus=this.value; updateBonusDot(${i}, this.value)">
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
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
}

function renderOddsTable() {
	const container = document.getElementById('odds-container');
	container.innerHTML = `
        <div class="bookies-table-container">
          <table class="odds-table">
            <thead>
              <tr>
                <th class="odds-site-th">Site</th>
                ${outcomes.map((o, j) => `
                  <th>
                    <div class="outcome-th">
                      <input type="text" class="outcome-name-input" value="${o}"
                        oninput="outcomes[${j}] = this.value"
                        placeholder="Issue" />
                      ${outcomes.length > 2 ? `<button class="btn-remove-outcome" onclick="removeOutcome(${j})" title="Supprimer cette issue">✕</button>` : ''}
                    </div>
                  </th>
                `).join('')}
                <th class="th-add-outcome">
                  <button class="btn btn-ghost btn-sm" onclick="addOutcome()">+ Issue</button>
                </th>
              </tr>
            </thead>
            <tbody>
              ${bookies.map((b, i) => `
                <tr>
                  <td class="odds-site-cell">
                    <div class="bookie-color-dot" style="background:${ACCENT_COLORS[i % ACCENT_COLORS.length]}"></div>
                    <span>${b.name}</span>
                  </td>
                  ${outcomes.map((_, j) => `
                    <td class="odds-cell">
                      <input type="number"
                        class="odds-input"
                        value="${oddsGrid[i] && oddsGrid[i][j] != null ? oddsGrid[i][j] : ''}"
                        step="0.01" min="1.01"
                        placeholder="—"
                        oninput="oddsGrid[${i}][${j}] = parseFloat(this.value) || null"
                        onclick="this.select()" />
                    </td>
                  `).join('')}
                  <td></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
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
function incrementConvRate() {
	const input = document.getElementById('convRate');
	input.value = Math.min(100, (parseFloat(input.value) || 80) + 1);
}
function decrementConvRate() {
	const input = document.getElementById('convRate');
	input.value = Math.max(1, (parseFloat(input.value) || 80) - 1);
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
	document.getElementById(`name-${i}`).value = siteKey;
	document.getElementById(`bonus-${i}`).value = preset.bonus;
	updateBonusDot(i, preset.bonus);
	document.getElementById(`min-${i}`).value = preset.min;
	document.getElementById(`max-${i}`).value = preset.maxBonus;
}

function updateBonusDot(index, bonusType) {
	const dot = document.querySelector(`.bonus-dot-${index}`);
	if (dot) dot.setAttribute('data-bonus', bonusType);
}

function fmt(v, decimals = 2) {
	return v.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ---- Calcul ----

function generateCombinations() {
	const M = outcomes.length;
	const N = bookies.length;
	const combos = [];
	const used = new Array(N).fill(false);

	function recurse(outcomeIdx, current) {
		if (outcomeIdx === M) {
			combos.push([...current]);
			return;
		}
		for (let s = 0; s < N; s++) {
			if (used[s]) continue;
			const odds = oddsGrid[s] && oddsGrid[s][outcomeIdx];
			if (!odds || odds < 1.01) continue;
			used[s] = true;
			current.push(s);
			recurse(outcomeIdx + 1, current);
			current.pop();
			used[s] = false;
		}
	}

	recurse(0, []);
	return combos;
}

function computeStakes(active, convRate) {
	const n = active.length;

	const effectiveConv = active.map(b => {
		if (b.bonus === 'no_bonus') return 0;
		if (b.bonus === 'cash_lose' || b.bonus === 'cash_always') return 1;
		return convRate;
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
	const convRate = (parseFloat(document.getElementById('convRate').value) || 80) / 100;

	const combos = generateCombinations();
	if (combos.length === 0) {
		showError('Aucune combinaison valide. Assurez-vous que chaque issue a au moins une cote renseignée sur un site différent.');
		return;
	}

	const results = [];
	combos.forEach(combo => {
		const active = combo.map((siteIdx, outcomeIdx) => ({
			...bookies[siteIdx],
			odds: oddsGrid[siteIdx][outcomeIdx],
			outcome: outcomes[outcomeIdx],
			siteIdx,
		}));
		const result = computeStakes(active, convRate);
		if (result) results.push({ combo, active, ...result });
	});

	if (results.length === 0) {
		showError("Impossible d'équilibrer les mises pour ces paramètres. Vérifiez les cotes et les bonus.");
		return;
	}

	results.sort((a, b) => b.avgGain - a.avgGain);
	_comboResults     = { results, convRate };
	_selectedComboIdx = 0;
	renderCombinationsList(20);
	document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- Affichage des combinaisons ----

function renderCombinationsList(showCount) {
	const { results } = _comboResults;
	const displayed   = results.slice(0, showCount);
	const remaining   = results.length - showCount;

	document.getElementById('results').style.display = 'flex';
	document.getElementById('error-container').innerHTML = '';

	document.getElementById('combos-container').innerHTML = `
        <div class="combos-list">
          <div class="combos-list-header">
            <span>${results.length} combinaison${results.length > 1 ? 's' : ''} trouvée${results.length > 1 ? 's' : ''}</span>
            <span class="combos-list-hint">Cliquer pour afficher le détail</span>
          </div>
          ${displayed.map((r, idx) => {
		const assignment = r.combo.map((siteIdx, outcomeIdx) =>
			`<span class="combo-site" style="color:${ACCENT_COLORS[siteIdx % ACCENT_COLORS.length]}">${bookies[siteIdx].name}</span><span class="combo-outcome-tag">${outcomes[outcomeIdx]}</span>`
		).join('<span class="combo-sep">·</span>');
		return `
              <div class="combo-row" onclick="selectCombo(${idx})">
                <span class="combo-rank">#${idx + 1}</span>
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

	document.getElementById('gain-banner').innerHTML = '';
	document.getElementById('stakes-grid').innerHTML = '';
	document.getElementById('breakdown-container').innerHTML = '';

	selectCombo(Math.min(_selectedComboIdx, displayed.length - 1));
}

function selectCombo(idx) {
	_selectedComboIdx = idx;
	document.querySelectorAll('.combo-row').forEach((el, i) => {
		el.classList.toggle('combo-row--active', i === idx);
	});
	const { results, convRate } = _comboResults;
	showResults({ active: results[idx].active, ...results[idx], convRate });
}

// ---- Erreur ----

function showError(msg) {
	document.getElementById('results').style.display = 'flex';
	document.getElementById('error-container').innerHTML = `<div class="error-box">⚠ ${msg}</div>`;
	document.getElementById('combos-container').innerHTML = '';
	document.getElementById('gain-banner').innerHTML = '';
	document.getElementById('stakes-grid').innerHTML = '';
	document.getElementById('breakdown-container').innerHTML = '';
}

// ---- Détail d'une combinaison ----

function showResults({ active, stakes, avgGain, totalStaked, roi, convRate, capped, bonusAmount }) {
	document.getElementById('gain-banner').innerHTML = `
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
                            <div class="detail-line"><span class="detail-lbl">Freebet @${Math.round(convRate * 100)}%</span><span class="detail-val ${bonusIfWin > 0 ? 'neut' : 'text-muted'}">+${fmt(bonusIfWin)} €</span></div>
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
                            <div class="detail-line"><span class="detail-lbl">Freebet @${Math.round(convRate * 100)}%</span><span class="detail-val ${bonusCash > 0 ? 'neut' : 'text-muted'}">+${fmt(bonusCash)} €</span></div>
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
			lines += `<div class="detail-line"><span class="detail-lbl">Freebet @${Math.round(convRate * 100)}%</span><span class="detail-val ${totalFbConv > 0 ? 'neut' : 'text-muted'} strong">+${fmt(totalFbConv)} €</span></div>`;
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
