// Appliqué immédiatement pour éviter le flash de thème au chargement
(function () {
	const saved = localStorage.getItem('theme');
	const preferred = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
	document.documentElement.setAttribute('data-theme', preferred);
})();

// Icônes SVG
const ICON_SUN = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="4"/>
  <line x1="12" y1="2" x2="12" y2="5"/>
  <line x1="12" y1="19" x2="12" y2="22"/>
  <line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/>
  <line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/>
  <line x1="2" y1="12" x2="5" y2="12"/>
  <line x1="19" y1="12" x2="22" y2="12"/>
  <line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/>
  <line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/>
</svg>`;

const ICON_MOON = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
</svg>`;

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
		localStorage.setItem('theme', next);
		syncIcon();
	});

	syncIcon();
	document.body.appendChild(btn);
});
