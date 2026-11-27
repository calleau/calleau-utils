# Architecture — Freebets combinés couverts

Convertit des freebets répartis sur plusieurs sites en cash garanti, en couvrant **toutes les issues** de combinés 1N2 : pour `k` matchs en combiné, les `3^k` combinaisons sont jouées, chacune sur le site qui offre la meilleure cote.

Version actuelle : voir [`versions.js`](versions.js) (`CURRENT_VERSION`).

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Page + composant React (`FreebetOptimizer`), JSX compilé dans le navigateur par Babel standalone (CDN) |
| `fb-conv.css` | Styles propres à l'outil, construits sur les variables de `../../theme.css` (clair / sombre) |
| `versions.js` | Métadonnées lues par `../../versions-widget.js` |
| `v1.0.0/` | Ancienne version (thème sombre autonome, sans `theme.css`) |

Bookmakers : PMU, Betclic, Unibet, Winamax, PSEL (`BOOKMAKER_DEFS`). Le champ `site` est la clé des couleurs de `theme.css` (`--site-<site>-bg/-text`, `.ff-site-pill[data-site]`) ; `fb-conv.css` en tire `--bk-accent` (bandeaux, bordures), ajusté en thème sombre.

## Le calcul

- Une **sélection** = `k` matchs parmi les `n` configurés. Pour chaque sélection, chaque combinaison prend la meilleure cote parmi les sites actifs (égalité : ordre de priorité des sites).
- Paiement d'une combinaison : `cote − 1` (freebet « profit seul ») ou `cote` (« mise incluse »).
- Taux de conversion : `1 / Σ(1 / paiement_c)` ; mise de chaque combinaison : `(total × taux) / paiement_c`. La sélection au meilleur taux est retenue.
- **Garanties** (option) : cotes 1G / 2G utilisées à la place de 1 / 2 quand elles sont renseignées (paiement anticipé si une équipe mène de 2 buts). Le plan avec garanties est calculé à part et proposé s'il est meilleur ; la colonne « Jackpot » montre le gain cumulé si le paiement anticipé est suivi d'un autre résultat final.
- Le plan est figé au clic sur « Calculer ». Les paris marqués « Placé » gardent leur mise ; les autres sont recalculés sur le gain moyen des paris placés.

## Historique

- **v2.0.0** (2026-11-27) : passage au thème global (`theme.css`, mode clair / sombre, bouton de thème, widget des versions, pied de page), styles sortis dans `fb-conv.css`, noms de sites en pastilles aux couleurs des sites. Calcul inchangé.
- **v1.0.0** : version d'origine, thème sombre autonome.
