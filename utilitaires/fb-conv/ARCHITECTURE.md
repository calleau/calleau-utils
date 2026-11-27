# Architecture — Freebets combinés couverts

Convertit des freebets répartis sur plusieurs sites en cash garanti, en couvrant **toutes les issues** de combinés 1N2 : pour `k` matchs en combiné, les `3^k` combinaisons sont jouées, chacune sur le site qui offre la meilleure cote.

Version actuelle : voir [`versions.js`](versions.js) (`CURRENT_VERSION`).

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page (en-tête, `#root`, pied de page) et chargement des scripts |
| `fb-conv.js` | Calcul + composant React (`FreebetOptimizer`) en JSX, chargé en `<script type="text/babel" src>` et compilé dans le navigateur par Babel standalone (CDN). Babel le récupère en HTTP : ouvrir la page depuis un serveur, pas en `file://` |
| `fb-conv.css` | Styles propres à l'outil, construits sur les variables de `../../theme.css` (clair / sombre) |
| `versions.js` | Métadonnées lues par `../../versions-widget.js` |
| `URL_STATE.md` | Format de l'état sauvegardé dans le lien (`?s=`) et dans le navigateur |
| `v1.0.0/` | Ancienne version (thème sombre autonome, sans `theme.css`) |

## Sites

- Par défaut : PMU, Betclic, Unibet, Winamax, PSEL (`DEFAULT_SITES`, ids 1 à 5).
- Modifiables dans la carte « Freebets disponibles par site » :
  - **Ajouter** : un site du catalogue (`SITE_CATALOG`, les 14 sites qui ont des couleurs dans `theme.css`), ou « Autre » avec un nom libre, sans couleur de marque.
  - **Retirer** : bouton × sur la carte, avec confirmation si le site a des cotes ou un montant.
  - Les ids ne sont jamais réutilisés (`nextBookmakerId`), pour qu'un nouveau site ne récupère pas les mises d'un site retiré encore présent dans le dernier calcul.
- **Cotes déjà garanties** (`preGuaranteed`, visible quand les garanties sont activées) : le site paie déjà en avance. Sa ligne 1G / 2G est masquée et ses cotes normales servent telles quelles dans le plan avec garanties. Coché par défaut pour Winamax (avant la v2.2.0, c'était codé en dur sur Winamax).
- Couleurs : le champ `site` est la clé des couleurs de `theme.css` (`--site-<site>-bg/-text`, `.ff-site-pill[data-site]`) ; `fb-conv.css` en tire `--bk-accent` (bandeaux, bordures), ajusté en thème sombre.

## Le calcul

- Une **sélection** = `k` matchs parmi les `n` configurés. Pour chaque sélection, chaque combinaison prend la meilleure cote parmi les sites actifs (égalité : ordre de priorité des sites).
- Paiement d'une combinaison : `cote − 1` (freebet « profit seul ») ou `cote` (« mise incluse »).
- Taux de conversion : `1 / Σ(1 / paiement_c)` ; mise de chaque combinaison : `(total × taux) / paiement_c`. La sélection au meilleur taux est retenue.
- **Garanties** (option) : cotes 1G / 2G utilisées à la place de 1 / 2 quand elles sont renseignées (paiement anticipé si une équipe mène de 2 buts). Le plan avec garanties est calculé à part et proposé s'il est meilleur ; la colonne « Jackpot » montre le gain cumulé si le paiement anticipé est suivi d'un autre résultat final.
- Le plan est figé au clic sur « Calculer ». Les paris marqués « Placé » gardent leur mise ; les autres sont recalculés sur le gain moyen des paris placés.

## Sauvegarde

Tout l'état est sauvegardé ~400 ms après chaque modification, dans le lien (`?s=…`, compressé par lz-string) et dans le navigateur (`localStorage`, clé `fbconv_state`). Au chargement, on lit le lien, sinon le navigateur, sinon les valeurs par défaut. Le dernier calcul est rebâti à l'identique (sélection retenue par mode, paris placés, cotes du moment du calcul si elles ont changé depuis). « Tout effacer » vide la sauvegarde et recharge la page. Détail du format : [URL_STATE.md](URL_STATE.md).

## Historique

- **v2.2.0** (2026-11-27) : sites modifiables (ajout depuis un catalogue de 14 sites ou nom libre, retrait), option « Cotes déjà garanties » par site (remplace la règle codée en dur pour Winamax). Les liens sauvegardés en v2.1.0 restent lisibles.
- **v2.1.0** (2026-11-27) : sauvegarde de l'état dans le lien et dans le navigateur (plus rien n'est perdu à la fermeture, lien partageable) ; bouton « Tout effacer ».
- **v2.0.1** (2026-11-27) : JavaScript sorti de `index.html` dans `fb-conv.js`. Aucun changement visible.
- **v2.0.0** (2026-11-27) : passage au thème global (`theme.css`, mode clair / sombre, bouton de thème, widget des versions, pied de page), styles sortis dans `fb-conv.css`, noms de sites en pastilles aux couleurs des sites. Calcul inchangé.
- **v1.0.0** : version d'origine, thème sombre autonome.
