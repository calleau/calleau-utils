# Architecture — Pari garanti

Outil pour la mission bet365 **« Pari garanti »** : bet365 rend un freebet (5 ou 10 €) si un pari est perdu. Ce pari doit être un **pari personnalisé** (combiné d'au moins 2 sélections) d'une cote d'au moins 2. La meilleure option est presque toujours **résultat du match (1X2) + BTTS ou plus/moins de 2,5 / 3,5 buts**, couvert par un **Lay** du marché combiné équivalent sur PIWIx.

Version actuelle : voir [`versions.js`](versions.js) (`CURRENT_VERSION`).

## Utilisation

1. Sur PIWIx, extraire avec Betxtractor les marchés « Match Odds and Both teams to Score », « Match Odds and Over/Under 2.5 Goals » et « … 3.5 Goals » du match (pages de détail), puis exporter le JSON.
2. Coller le JSON : un tableau par match, 6 issues par marché (1 / X / 2 × Oui / Non ou plus / moins).
3. Recopier, une par une, les cotes bet365 du pari personnalisé correspondant (pas d'API côté bet365). Entrée ou ↓ passe à la ligne suivante.
4. La meilleure option est mise en avant (carte verte + ligne surlignée), les suivantes sont classées (#2, #3…).

Les paramètres, le JSON et les cotes saisies sont gardés dans le navigateur (`localStorage`, clé `pari-garanti:v1`). Les cotes sont rangées par match et par issue : recoller un nouvel export du même match conserve les cotes bet365 déjà saisies.

## Formats lus

| Format | Repère | Cote Lay |
|---|---|---|
| Export du tableau de bord Betxtractor (`{ "<match>_<date>": { nom_event, opponents, markets } }`) | `markets[marché][issue][site]` | `PIWIx.Lay.odds` (sinon le 1er site avec un Lay), disponible `Lay.amount`, Back `Back.odds` (meilleure proposition en Lay) |
| Extraction brute (`{ extraction: { events } }` de Betxtractor-3000, ou `{ site, events }` de l'extension) | `events[].odds[]` | `lay.value`, disponible `lay.amount`, Back `back.value` |

Marchés reconnus (même règles que `mappings/combo-normalizer.js` de l'extension) :

| Marché | Noms acceptés | Issues |
|---|---|---|
| Résultat & BTTS | `1X2 & BTTS`, `Match Odds and Both teams to Score` | `1 & Oui`, ou `Paris St-G/Yes`, `Draw/No`… |
| Résultat & total de buts | `1X2 & Total buts`, `Match Odds and Over/Under 2.5 Goals` (toute ligne) | `X & -2.5`, ou `Roma/Under 2.5 Goals`… |

Les équipes viennent de `opponents` ; à défaut (anciens exports PIWIx, opposants vides), du nom du match découpé sur ` v ` / ` vs ` / ` - `. Les autres marchés sont ignorés.

## Le calcul

Notations : `S` mise bet365 (cash), `B` cote bet365, `L` cote Lay PIWIx, `c` commission PIWIx (3 %), `F` freebet, `r` valeur d'un euro de freebet en cash (80 %), `m` mise Lay.

Le Lay porte sur exactement la même issue que le pari bet365 : il n'y a que deux cas.

| Cas | Résultat |
|---|---|
| bet365 gagne (le Lay perd) | `S·(B−1) − m·(L−1)` |
| bet365 perd (le Lay gagne) | `−S + m·(1−c)` en cash, **plus le freebet `F`** |

### Mode équilibré

Même résultat dans les deux cas, le freebet étant compté `r·F` :

- `m = (S·B − r·F) / (L − c)`
- résultat garanti `P = S·(B−1) − m·(L−1)` = `−S + m·(1−c) + r·F`
- classement : `P` décroissant.

### Mode tout ou rien

Le Lay rembourse exactement la mise si bet365 gagne (0 €) ; si bet365 perd, la perte en cash est compensée par le freebet entier :

- `m = S·(B−1) / (L−1)`
- résultat : `0` si bet365 gagne, `−S + m·(1−c)` en cash + `F` en freebet sinon
- classement : perte en cash (cas « bet365 perd ») la plus petite.

Les deux modes ne classent pas forcément les issues dans le même ordre.

La mise Lay est arrondie au centime et les résultats affichés sont calculés avec cette mise arrondie (ce qui explique un écart d'un centime entre les deux cas en mode équilibré).

### Cote à viser

Pour chaque autre issue, la colonne « Cote à viser » donne la cote bet365 à partir de laquelle elle égalerait la meilleure option actuelle : elle sert à savoir quelles combinaisons valent la peine d'être vérifiées sur bet365. Sans aucune cote saisie, elle donne la cote d'équilibre (résultat 0 €) en mode équilibré, et rien en mode tout ou rien. Toujours au moins la cote minimale.

- équilibré : `P(B) = B·S·(1−c)/(L−c) − S + r·F·(L−1)/(L−c)` → `B = (P* + S − r·F·(L−1)/(L−c)) · (L−c) / (S·(1−c))`
- tout ou rien : `B = 1 + (P* + S)·(L−1) / (S·(1−c))`

### Lien vers calc-couverture

Chaque ligne calculée (colonne Résultat), la carte « Meilleure option » et le classement ont un lien **calc-couv ↗**. Il ouvre la [calculatrice couverture](../calc-couverture/index.html) avec **deux calculateurs** (format `?s=…`, voir [URL_STATE.md](../calc-couverture/URL_STATE.md)), options Commissions, Gain fixe, Intitulés et Site activées :

| Calculateur | Issue 1 « bet365 gagne » | Issue 2 « bet365 perd » |
|---|---|---|
| **Équilibré** | Back bet365 à `B`, mise `S`, **Fixe**, distribuée | Lay PIWIx à `L` (commission `c`) + gain fixe `r·F` (freebet à sa valeur), distribuée |
| **Tout ou rien** | idem, **non distribuée** (vise 0 €) | Lay PIWIx + gain fixe `F` (valeur nominale du freebet), distribuée |

calc-couverture retrouve les mises Lay de l'outil (à l'arrondi près : il ne les arrondit pas au centime). En tout ou rien, le profit de l'issue 2 inclut le freebet entier : perte en cash + `F`. Le lien est construit par `calcCouvUrl()` avec `lz-string` 1.5.0 (CDN jsDelivr, comme les autres outils).

### Meilleure proposition en Lay (option)

Case « Meilleure proposition en Lay » : au lieu de prendre le Lay affiché (apparié tout de suite), on calcule avec la meilleure cote qu'on peut **proposer** sur PIWIx, c'est-à-dire la cote juste en dessous du Lay actuel (`proposedLay()`) :

- Back et Lay **consécutifs** sur le barème (1,20 / 1,21 ; 9,6 / 9,8) : pas de place entre les deux → Lay actuel ;
- sinon : la cote précédant le Lay sur le barème (Back 1,20 / Lay 1,25 → 1,24 ; Back 9 / Lay 9,8 → 9,6). Sans Back affiché, idem.

Barème des cotes de l'exchange (pas par tranche) : 0,01 jusqu'à 2 ; 0,02 jusqu'à 3 ; 0,05 jusqu'à 4 ; 0,1 jusqu'à 6 ; 0,2 jusqu'à 10 ; 0,5 jusqu'à 20 ; 1 jusqu'à 30 ; 2 jusqu'à 50 ; 5 jusqu'à 100 ; 10 au-delà. La cote précédente utilise le pas de la tranche **inférieure** (`tickBelow()`) : Lay 10 → 9,8, Lay 2,02 → 2,00, Lay 3,10 → 3,05.

Avec l'option, la colonne Lay affiche la cote proposée (« proposé », avec le Lay et le Back actuels en dessous) ou « consécutifs » ; mises, résultats, cote à viser, carte de la meilleure option et liens calc-couverture utilisent la cote proposée. Une proposition n'est appariée que si un parieur la prend : l'avertissement de disponible ne s'applique qu'au Lay actuel.

### Comparaison des scénarios

Chaque ligne renseignée est calculée dans les 4 scénarios `SCENARIOS` : mode (Équilibré / Tout ou rien) × Lay (actuel / proposé, cote `Lprop = proposedLay(back, lay)`). Le tableau principal et la carte « Meilleure option » suivent les réglages choisis ; sous la carte, `renderComparison()` affiche :

- un tableau avec la **meilleure option de chaque scénario** : Équilibré et Tout ou rien avec le Lay actuel, plus les deux scénarios « Lay proposé » quand l'option est cochée. Pour chacun : combinaison, cotes, mise Lay, résultat si bet365 gagne / perd, résultat de classement, lien calc-couverture avec la cote Lay du scénario. La ligne des réglages actuels est surlignée ;
- des **constats** : même meilleure option ou option différente, avec les résultats des deux scénarios dans tous les cas :
  - Lay actuel / Lay proposé, en Équilibré puis en Tout ou rien (option cochée) ;
  - Équilibré / Tout ou rien (avec le Lay retenu).

Option cochée, la colonne Résultat d'une ligne dont la cote proposée diffère du Lay rappelle aussi le résultat avec le Lay actuel (« lay actuel … »).

### Contrôles

- Cote bet365 inférieure à la cote minimale (2 par défaut) : ligne grisée « cote < 2,00 », exclue du classement.
- Mise Lay supérieure au disponible PIWIx (`Lay.amount`) : avertissement « dispo N € » sous la mise (la ligne reste classée).

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Page : paramètres, import, meilleure option, tableaux |
| `pari-garanti.js` | Lecture des marchés, calcul, rendu, liens calc-couverture, sauvegarde locale |
| `pari-garanti.css` | Styles propres à l'outil (préfixe `pg-`) |
| `versions.js` | Nom et version pour `versions-widget.js` |

## Historique

- **v1.0.0** (2026-11-25) : première version.
- **v1.1.0** (2026-11-25) : liens vers calc-couverture (deux calculateurs : Équilibré et Tout ou rien) sur chaque option calculée.
- **v1.2.0** (2026-11-25) : option « Meilleure proposition en Lay » (cote juste sous le Lay actuel, sauf Back / Lay consécutifs).
- **v1.3.0** (2026-11-25) : comparaison des scénarios (Équilibré / Tout ou rien, Lay actuel / proposé) : meilleure option de chacun, même option ou non, résultats des deux.
