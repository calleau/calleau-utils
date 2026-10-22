# calleau's utils

Boîte à outils de calculateurs pour les paris sportifs (TRJ, couverture, freebets, bonus de bienvenue…).

Publié sur GitHub Pages : https://calleau.github.io/calleau-utils/

## Lancer en local

Depuis la racine du dépôt :

```
python -m http.server 8080
```

Puis ouvrir http://localhost:8080

Le Magotculteur est en TypeScript (Vite) et se lance à part :

```
cd utilitaires/magotculteur
npm install
npm run dev
```

## Structure

- `index.html` : page d'accueil (menu des outils)
- `theme.css`, `theme-toggle.js`, `versions-widget.js` : ressources partagées
- `assets/` : données JSON partagées (sites, règles de couverture, exemples) et icônes
- `utilitaires/<outil>/` : un dossier par outil, avec ses versions archivées dans `vX.Y.Z/`

Au déploiement, `.github/workflows/deploy.yml` builde le Magotculteur et remonte `utilitaires/*` à la racine du site.
