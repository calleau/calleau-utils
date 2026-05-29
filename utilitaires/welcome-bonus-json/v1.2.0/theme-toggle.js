// Lit le thème depuis localStorage ou le cookie (le cookie fonctionne entre sous-dossiers sur file://)
function _readTheme() {
	try { const v = localStorage.getItem('theme'); if (v) return v; } catch (_) {}
	const m = document.cookie.match(/(?:^|; )theme=([^;]+)/);
	return m ? m[1] : null;
}

// Sauvegarde dans les deux pour une compatibilité maximale
function _saveTheme(value) {
	try { localStorage.setItem('theme', value); } catch (_) {}
	document.cookie = 'theme=' + value + '; path=/; max-age=31536000; SameSite=Lax';
}

// Appliqué immédiatement pour éviter le flash de thème au chargement
(function () {
	const saved = _readTheme();
	const preferred = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
	document.documentElement.setAttribute('data-theme', preferred);
})();

// Icônes SVG
const ICON_SUN = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`;

const ICON_MOON = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>`;

document.addEventListener('DOMContentLoaded', function () {
	const btn = document.createElement('button');
	btn.id = 'theme-toggle';
	btn.className = 'btn-theme-toggle';

	function syncIcon() {
		const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
		btn.innerHTML = isDark ? ICON_SUN : ICON_MOON;
		btn.setAttribute('aria-label', isDark ? 'Passer en mode clair' : 'Passer en mode sombre');
		btn.title = isDark ? 'Mode clair' : 'Mode sombre';
	}

	btn.addEventListener('click', function () {
		const current = document.documentElement.getAttribute('data-theme');
		const next = current === 'dark' ? 'light' : 'dark';
		document.documentElement.setAttribute('data-theme', next);
		_saveTheme(next);
		syncIcon();
	});

	syncIcon();
	let container = document.getElementById('floating-actions');
	if (!container) {
		container = document.createElement('div');
		container.id = 'floating-actions';
		document.body.appendChild(container);
	}
	container.insertBefore(btn, container.firstChild);
});
