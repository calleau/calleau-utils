const fmt = (n) => Number.isFinite(n) ? n.toFixed(3) : '—';

function layToBack(lay) {
	if (!Number.isFinite(lay) || lay <= 1) return NaN;
	return lay / (lay - 1);
}

function render() {
	const back = parseFloat(document.getElementById('pbl-back').value);
	const lay = parseFloat(document.getElementById('pbl-lay').value);
	const com = parseFloat(document.getElementById('pbl-com').value);
	const c = Number.isFinite(com) ? com / 100 : 0;

	const result = document.getElementById('pbl-result');
	if (!Number.isFinite(back) || !Number.isFinite(lay) || back <= 1 || lay <= 1) {
		result.hidden = true;
		return;
	}
	result.hidden = false;

	const backNet = 1 + (back - 1) * (1 - c);
	const layNet = 1 + (lay - 1) * (1 - c);

	const layBrutEq = layToBack(lay);
	const layNetEq = layToBack(layNet);

	document.getElementById('pbl-back-brut').textContent = fmt(back);
	document.getElementById('pbl-back-net').textContent = fmt(backNet);
	document.getElementById('pbl-lay-net').textContent = fmt(layNet);
	document.getElementById('pbl-lay-net-eq').textContent = '≡ back ' + fmt(layNetEq);
	document.getElementById('pbl-lay-brut').textContent = fmt(lay);
	document.getElementById('pbl-lay-brut-eq').textContent = '≡ back ' + fmt(layBrutEq);

	const cells = {
		'pbl-c-bk-brut': back,
		'pbl-c-bk-net': backNet,
		'pbl-c-ly-net': layNetEq,
		'pbl-c-ly-brut': layBrutEq,
	};
	document.querySelectorAll('.pbl-c').forEach(td => td.classList.remove('pbl-best'));

	let bestKey = null;
	let bestVal = -Infinity;
	for (const [k, v] of Object.entries(cells)) {
		if (Number.isFinite(v) && v > bestVal) {
			bestVal = v;
			bestKey = k;
		}
	}
	if (bestKey) {
		const el = document.querySelector('.' + bestKey);
		if (el) el.classList.add('pbl-best');
	}

	const labels = {
		'pbl-c-bk-brut': 'Back brut',
		'pbl-c-bk-net': 'Back net',
		'pbl-c-ly-net': 'Lay net',
		'pbl-c-ly-brut': 'Lay brut',
	};
	const verdict = document.getElementById('pbl-verdict');
	verdict.innerHTML = `Cote équivalente la plus intéressante : <strong>${labels[bestKey]} (${fmt(bestVal)})</strong>`;
}

document.addEventListener('DOMContentLoaded', render);
