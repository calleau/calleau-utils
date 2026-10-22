# calleau's utils

Boîte à outils de calculateurs pour les paris sportifs (TRJ, couverture, freebets, bonus de bienvenue…).

En ligne sur https://utils.calleau.org (et sur GitHub Pages : https://calleau.github.io/calleau-utils/)

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

## Déploiement

`scripts/build-site.sh` construit le site publiable : il builde le Magotculteur, remonte `utilitaires/*` à la racine et corrige les chemins relatifs.

- **utils.calleau.org** : Coolify construit le `Dockerfile` (script ci-dessus + Nginx) à chaque push sur `main`.
- **GitHub Pages** : `.github/workflows/deploy.yml` utilise le même script.
