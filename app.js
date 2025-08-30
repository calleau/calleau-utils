const LS_KEY = 'freebets-step1-v1';

/*** Data model ***/
let state = {
	outcomeLabels: ["Domicile", "N", "Extérieur"],
	matches: [
		mkMatch('Suède', 'Angleterre'),
		mkMatch('France', 'Allemagne'),
		mkMatch('Norvège', 'Italie'),
	]
};

function mkMatch(teamA = 'Équipe A', teamB = 'Équipe B') {
	return {
		name: teamA + ' vs ' + teamB,
		outcomes: [teamA, 'N', teamB],
		books: [
			mkBook('Betclic'),
			mkBook('Winamax'),
			mkBook('Unibet'),
			mkBook('PSEL')
		]
	}
}
function mkBook(name = 'Book') {
	return { name, odds: [2.00, 3.00, 2.00] }
}

/*** Helpers ***/
function fmtPct(x) {
	if (!isFinite(x)) return '—';
	return (x * 100).toFixed(2).replace('.', ',') + '%';
}
function computeTRJ(odds) {
	const v = odds.map(Number);
	if (v.some(o => !o || o <= 1)) return NaN; // invalid odds
	const sum = v.reduce((a, o) => a + 1 / o, 0);
	return 1 / sum; // as ratio (0..1)
}
function bestIndexes(books) {
	const cols = [0, 1, 2];
	return cols.map(ci => {
		let best = -Infinity, idx = -1;
		books.forEach((b, i) => {
			const val = Number(b.odds[ci]);
			if (val > best) { best = val; idx = i }
		});
		return idx;
	});
}
function escapeHtml(s) {
	return String(s).replace(/[&<>\"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[m]));
}

/*** Rendering ***/
const matchesEl = document.getElementById('matches');
function render() {
	matchesEl.innerHTML = '';
	state.matches.forEach((m, mi) => {
		const block = document.createElement('article');
		block.className = 'match';
		block.innerHTML = `
      <header>
        <div class="match-title">
          <input type="text" value="${escapeHtml(m.name)}" data-mi="${mi}" data-k="name" />
          <span class="hint">(${escapeHtml(m.outcomes[0])} / ${escapeHtml(m.outcomes[1])} / ${escapeHtml(m.outcomes[2])})</span>
          <span class="pill" role="button" data-mi="${mi}" data-action="renameOutcomes" title="Renommer les colonnes du match">Renommer colonnes</span>
          <span class="pill" role="button" data-mi="${mi}" data-action="removeMatch" title="Supprimer ce match">Supprimer</span>
        </div>
      </header>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="label">Bookmaker</th>
              <th>${escapeHtml(m.outcomes[0])}</th>
              <th>${escapeHtml(m.outcomes[1])}</th>
              <th>${escapeHtml(m.outcomes[2])}</th>
              <th>TRJ</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
        <div class="row-actions">
          <button class="ghost" data-mi="${mi}" data-action="addBook">+ Ajouter un bookmaker</button>
        </div>
      </div>`;

		const tbody = block.querySelector('tbody');
		const bestIdx = bestIndexes(m.books);

		m.books.forEach((b, bi) => {
			const trj = computeTRJ(b.odds);
			const tr = document.createElement('tr');
			tr.innerHTML = `
        <td class="label">
          <input type="text" value="${escapeHtml(b.name)}" data-mi="${mi}" data-bi="${bi}" data-k="bookName" />
        </td>
        ${[0, 1, 2].map(ci => {
				const best = bestIdx[ci] === bi ? ' best' : '';
				return `<td class="${best}"><input class="odds" type="number" inputmode="decimal" min="1.01" step="0.01" value="${Number(b.odds[ci]).toFixed(2)}" data-mi="${mi}" data-bi="${bi}" data-ci="${ci}" /></td>`;
			}).join('')}
        <td class="trj ${isFinite(trj) ? (trj >= 0.97 ? 'good' : 'bad') : ''}">${isFinite(trj) ? fmtPct(trj) : '—'}</td>`;
			tbody.appendChild(tr);
		});

		matchesEl.appendChild(block);
	});

	attachEvents();
	persist();
}

function attachEvents() {
	// select-all on focus
	document.querySelectorAll('input').forEach(inp => {
		inp.onfocus = e => e.target.select();
	});

	// change handlers
	matchesEl.querySelectorAll('input[type="number"]').forEach(inp => {
		inp.addEventListener('input', e => {
			const mi = +e.target.dataset.mi, bi = +e.target.dataset.bi, ci = +e.target.dataset.ci;
			let v = parseFloat(e.target.value.replace(',', '.'));
			if (!isFinite(v)) v = '';
			state.matches[mi].books[bi].odds[ci] = v;
			render();
		})
	});
	matchesEl.querySelectorAll('input[type="text"]').forEach(inp => {
		inp.addEventListener('input', e => {
			const { mi, k, bi } = e.target.dataset;
			if (k === 'name') { state.matches[+mi].name = e.target.value; }
			if (k === 'bookName') { state.matches[+mi].books[+bi].name = e.target.value; }
			persist();
		})
	});

	// row/block actions
	matchesEl.querySelectorAll('[data-action]').forEach(el => {
		el.addEventListener('click', e => {
			const act = e.currentTarget.dataset.action;
			const mi = +e.currentTarget.dataset.mi;
			if (act === 'addBook') {
				state.matches[mi].books.push(mkBook('Book'));
				render();
			}
			if (act === 'removeMatch') {
				if (confirm('Supprimer ce match ?')) { state.matches.splice(mi, 1); render(); }
			}
			if (act === 'renameOutcomes') {
				const m = state.matches[mi];
				const a = prompt('Libellé colonne 1 (équipe A / domicile) :', m.outcomes[0]);
				if (a === null) return;
				const n = prompt('Libellé colonne 2 (match nul N) :', m.outcomes[1]);
				if (n === null) return;
				const b = prompt('Libellé colonne 3 (équipe B / extérieur) :', m.outcomes[2]);
				if (b === null) return;
				m.outcomes = [a, n, b];
				render();
			}
		})
	});
}

/*** Top bar actions ***/
const addMatchBtn = document.getElementById('addMatchBtn');
const addBookBtn = document.getElementById('addBookBtn');
const saveBtn = document.getElementById('saveBtn');
const loadBtn = document.getElementById('loadBtn');
const resetBtn = document.getElementById('resetBtn');
const exportBtn = document.getElementById('exportBtn');
const importFile = document.getElementById('importFile');

addMatchBtn.onclick = () => { state.matches.push(mkMatch()); render(); };
addBookBtn.onclick = () => { state.matches.forEach(m => m.books.push(mkBook('Book'))); render(); };
saveBtn.onclick = () => { persist(true); alert('Données sauvegardées dans le navigateur.'); };
loadBtn.onclick = () => { const ok = load(); if (!ok) alert('Aucune sauvegarde trouvée.'); else render(); };
resetBtn.onclick = () => { if (confirm('Tout réinitialiser ?')) { localStorage.removeItem(LS_KEY); state = { outcomeLabels: ["Domicile", "N", "Extérieur"], matches: [mkMatch(), mkMatch(), mkMatch()] }; render(); } };
exportBtn.onclick = () => {
	const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = 'freebets-step1.json';
	a.click();
};

// Import JSON via file picker with right-click (ou modifier si tu préfères un bouton dédié)
loadBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); importFile.click(); });
importFile.onchange = async (e) => {
	const file = e.target.files[0]; if (!file) return;
	const txt = await file.text();
	try {
		const data = JSON.parse(txt);
		if (validate(data)) { state = data; render(); } else { alert('Fichier invalide.'); }
	} catch (err) { alert('JSON invalide.'); }
};

/*** Persistence ***/
function persist() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
function load() {
	const raw = localStorage.getItem(LS_KEY);
	if (!raw) return false;
	try {
		const data = JSON.parse(raw);
		if (validate(data)) { state = data; return true; }
	} catch { }
	return false;
}
function validate(d) { return d && Array.isArray(d.matches); }

/*** Init ***/
load();
render();
