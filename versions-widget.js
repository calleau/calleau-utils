// Widget de versioning partagé.
// Chaque utilitaire doit charger AVANT ce script un fichier `versions.js` local exposant :
//   window.UTILITY_NAME      — libellé affiché dans le footer
//   window.CURRENT_VERSION   — version courante (ex. "v1.0.0")
//   window.AVAILABLE_VERSIONS — tableau des sous-dossiers de versions précédentes (ex. ["v1.0.0"])
//
// Le script auto-injecte le bouton flottant + dropdown dans #floating-actions
// et remplit l'élément #footer-version s'il est présent.

document.addEventListener('DOMContentLoaded', function () {
	const name = window.UTILITY_NAME || 'Utilitaire';
	const current = window.CURRENT_VERSION || 'version actuelle';
	const versions = window.AVAILABLE_VERSIONS || [];

	const footerSpan = document.getElementById('footer-version');
	if (footerSpan) footerSpan.textContent = name + ' — ' + current;

	let container = document.getElementById('floating-actions');
	if (!container) {
		container = document.createElement('div');
		container.id = 'floating-actions';
		document.body.appendChild(container);
	}

	const widget = document.createElement('div');
	widget.id = 'versions-widget';
	widget.innerHTML = `
		<button id="versions-btn" class="btn-versions-toggle" aria-label="Versions précédentes" title="Versions précédentes">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>
			</svg>
		</button>
		<div id="versions-dropdown" class="versions-dropdown" hidden>
			<p class="versions-msg">Chargement…</p>
		</div>
	`;
	container.appendChild(widget);

	const btn = widget.querySelector('#versions-btn');
	const dropdown = widget.querySelector('#versions-dropdown');
	let loaded = false;

	btn.addEventListener('click', () => {
		const isOpen = !dropdown.hidden;
		dropdown.hidden = isOpen;
		if (isOpen || loaded) return;
		loaded = true;
		if (versions.length === 0) {
			dropdown.innerHTML = '<p class="versions-msg">Aucune version disponible</p>';
		} else {
			dropdown.innerHTML = '<p class="versions-header">Versions précédentes</p>' +
				versions.map(v => `<a href="${v}/index.html" class="version-link">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
						<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
					</svg>${v}</a>`).join('');
		}
	});

	document.addEventListener('click', (e) => {
		if (!widget.contains(e.target)) dropdown.hidden = true;
	});
});
