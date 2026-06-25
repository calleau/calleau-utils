# Architecture — Calculatrice couverture

Calculateur de couverture (surebet) supportant Back/Lay, commissions, gain fixe, multi-détails par issue et plusieurs calculateurs simultanés sur la même page.

## Stack

- HTML + CSS + jQuery 3.7 (pas de bundler, pas de build).
- Lucide pour quelques icônes (rendues via `lucide.createIcons()` après chaque insertion DOM).
- `localStorage` pour la persistance des paramètres globaux.
- Versioning maison via [`versions.js`](versions.js) + `../../versions-widget.js`.

## Fichiers

| Fichier | Rôle |
|---|---|
| [index.html](index.html) | Squelette : toolbar, conteneur `#calculators-container`, paramètres globaux, footer debug. |
| [calc-couverture.css](calc-couverture.css) | Grille CSS (`.sb-grid`), thèmes Back/Lay, overlay de hover, transitions. |
| [calc-couverture.js](calc-couverture.js) | Toute la logique : DOM building, math, persistance, debug. |
| [versions.js](versions.js) | Métadonnées de version consommées par le widget global. |

## Modèle DOM

Tout est une **grille CSS unique par calculateur** (`.sb-grid`). Pas de `<table>`, pas de `<tr>` — chaque cellule est un `<div class="cell">` placé directement dans la grille via l'auto-flow, avec des sélecteurs `data-*` pour la traversée.

### Ordre des colonnes

```
N° / Total │ Type │ Cote A..N │ Cote totale │ Mises │ Profit │ Suppr détail │ Fixe détail │ Fixe │ Distribution │ Profit total │ Actions
```

Le nombre de colonnes de cotes est dynamique via `--nb-cotes` (custom property posée sur `.sb-grid`) :

```css
grid-template-columns: min-content auto repeat(var(--nb-cotes), fit-content(180px)) auto auto auto auto auto auto auto auto;
```

### Hiérarchie logique

- **Calculateur** : `.calc-card[data-calc-id]` — instance encapsulée. Plusieurs calculateurs coexistent dans `#calculators-container`.
- **Issue** : ligne logique du tableau (`data-issuelabel`). Au moins 2 par calculateur.
- **Détail** : sous-ligne au sein d'une issue (`data-detailid`). Peut être Back, Lay ou Gain fixe. Auto-flow place les cellules d'un détail à la suite ; les cellules "issue-level" (Fixe, Distribution, Profit total, Actions) utilisent `grid-row: span K` quand l'issue a K détails.

### Compteurs d'IDs

`issueCounter`, `colCounter`, `detailCounter` sont **globaux** (module-level). Cela garantit l'unicité des IDs même lors de la duplication de calculateurs, où un clone DOM rapatrie les IDs existants.

### Conventions `data-*`

| Attribut | Sens |
|---|---|
| `data-issueid="I0X"` | Marque toute cellule appartenant à une issue. |
| `data-detailid="D0X"` | Marque toute cellule d'un détail spécifique. |
| `data-colid="C0X"` | Identifie la colonne de cote (stable, ne suit pas l'index visuel). |
| `data-type` / `data-odds` / `data-stake` / `data-odds-total` / `data-profit` / `data-fixedetail` / `data-issuefixe` / `data-issuedist` / `data-profit-total` / `data-actions` | Rôle de la cellule (un attribut par type). |
| `data-fixed-gain-input` | Marqueur spécifique au détail "Gain fixe" (utilisé en plus de `data-profit`). |
| `data-add-detail` / `data-issue-sum-profit` / `data-issue-avg-cote` | Cellules de la ligne "+ Détail" sous chaque issue. |

Les sélecteurs jQuery composent ces attributs avec les IDs : par ex.
`[data-stake][data-issueid="I02"][data-detailid="D04"]`.

## Architecture JS

[calc-couverture.js](calc-couverture.js) est un seul module non-module, organisé en quatre couches :

### 1. Helpers (top-level, sans état)

`toFixed2`, `normalize`, `letterFor`, `pad2`, `nextIssueId`, `getDefaultCommission`, `getLossDistribution`, etc.

### 2. Builders de cellules (top-level)

Une fonction `build<X>Cell(issueId, detailId, ...)` par type de cellule. Toutes retournent un `$('<div class="cell" ...>')`. Cette uniformité permet à `addDetail` / `addIssue` / `addOddsColumn` de composer les cellules sans connaître leur contenu.

Cas particulier : `buildFixedGainDetailCells` produit la liste complète des cellules d'un détail "Gain fixe" (placeholders vides pour Type/cotes/Cote totale/Mise, puis Profit avec input, puis Fixe détail coché+disabled). Le marqueur `data-fixed-gain-input` distingue ces détails dans `countDetails` et dans la collecte de `recomputeAll`.

### 3. `initCalculator($card, opts)` — closure par calculateur

C'est le cœur. Encapsule par calculateur :
- l'état (`colIds`, `nb_odds`, `nb_issues`, `recomputing`)
- les opérations DOM (`addOddsColumn`, `addIssue`, `addDetail`, `addFixedGainDetail`, `removeDetail`, `deleteIssue`, `removeOddsColumnAt`, …)
- le moteur de calcul (`recomputeAll`)
- les bindings d'événements jQuery delegated sur `$grid`
- un objet API `{ calcId, $card, $grid, recomputeAll }` exposé via `$card.data("calc")`

**Pourquoi closure et pas classe ?** Les paramètres globaux (`#commission-enabled`, `#loss-dist-enabled`, …) doivent invalider tous les calculateurs ; on itère `calcRegistry` et on appelle `api.recomputeAll(true)` sur chaque. Une closure suffit ; pas besoin de `this`.

**Mode `skipBootstrap`** : utilisé par `duplicateCalc`. Le DOM est déjà cloné depuis le calculateur source — on saute la création des deux issues par défaut, on reconstruit `colIds` depuis les headers existants, et on **rebind tous les `.num`** (les handlers jQuery ne survivent pas au `clone()`/`outerHTML`) via `rebindClonedNumberFields`.

### 4. Flow global

`addNewCalc` / `duplicateCalc` / `deleteCalc` / `initGlobalSettings` / `toggleDebug` / `collectDebugState`.
Un seul `$(function() { … })` à la fin lance l'init des settings globaux, crée le premier calculateur, et branche les boutons de l'en-tête.

### `recomputeAll(redistribute=true)` — pipeline

Le calcul est monolithique, en passes successives sur le même tableau `issues` en mémoire :

1. **Collecte** : parcourt le DOM, construit `issues[].details[]` avec, pour chaque détail :
   - `oddsTotal` (produit des cotes brutes), `oddsTotalNet` (avec commissions), `layNetWinFactor = Π(1-c)`, `layReturnFactor = layNetWinFactor + (oddsTotal − 1)`
   - `stake`, `engagement`, `isLay`, `isFixedGain`, `isFixedDetail`
2. **Affichage Cote totale** : grille Brut/Net × Back/Lay selon présence de commissions et type.
3. **Bootstrap mise par défaut** : si la fixed issue n'a qu'un détail valide sans mise, on injecte 10€.
4. **Calcul `issue.effectiveOddsNet`** : cote nette équivalente pour l'issue (gère Lay via `layReturnFactor / (oddsTotal − 1)`, multi-détails via `returnIfWin / sumInvested`).
5. **Calcul `effectiveOddsNetForTRJ`** : variante qui **ignore les Gain fixe** (pas de cote propre).
6. **TRJ** = `1 / Σ(1/effectiveOdds)` sur les issues valides.
7. **Résolution K et S** :
   - `K` = retour brut cible quand une issue gagne
   - `S` = total investi
   - σ_D / σ_N = somme de `1/effectiveOddsNet` pour les issues distribuées / non.
   - Si une issue est fixée et distribuée : `K = sumInvested × effOdds`, `S = K·σ_D / (1 − σ_N)`.
   - Si fixée et non-distribuée : `S = sumInvested × effOdds`, `K = S·(1 − σ_N) / σ_D`.
   - Sinon, fallback sur la mise du Total si la ligne Total est en mode fixe.
8. **Redistribution** (si `redistribute === true`) : pour chaque issue éligible non-fixée, on calcule `targetReturn = (1−p)·K + p·S` (où `p` = paramètre global "Répartition de la perte") et on ajuste les mises :
   - Détail unique : `stake = targetReturn / denom` (denom = `layReturnFactor` ou `oddsTotalNet`).
   - Multi-détails : on soustrait la contribution des détails fixés (`isFixedDetail`) — Gain fixe = sa valeur littérale, Back fixe = `stake·oddsNet`, Lay fixe = `stake·layReturnFactor` — puis on partage le `remaining` à parts égales entre les détails non-fixes (Gain fixe exclu).
9. **Engagement Lay** : `engagement = stake × (oddsTotal − 1)` sur tous les détails Lay.
10. **Affichage** : Profit par détail, Σ issue, Cote moyenne issue, Profit total par issue (formule : `Σ returns − sumInvestedAll`), Profit total global (`K − sumInvestedAll`).
11. **Coloration TRJ** : classes `trj-tier-{red,dark-orange,light-orange,green}` selon seuils 90/95/100 %.

Garde-fou `recomputing` : booléen qui empêche les ré-entrées causées par les `setStake`/`setLiability` (qui modifient des inputs et déclencheraient à nouveau les listeners). Les modifs d'inputs synchronisées **ne mettent pas à jour les inputs actuellement focalisés** (`if ($input[0] === document.activeElement) return;`) — sinon le curseur saute et la saisie devient impossible.

## CSS — points clés

- `.sb-grid > *` a `position: relative; z-index: 1`. L'overlay de hover (`.row-highlight-overlay`) est positionné en absolute sous les cellules pour colorier les gaps de la grille (les cellules restent au-dessus, contenu visible).
- Le bounding box de l'overlay est calculé en JS (`showHighlight($cells)`) à partir des `getBoundingClientRect()` des cellules concernées, étendu de ~4-8px pour englober les gaps.
- Classes globales sur `.sb-grid` :
  - `with-commission` — montre les inputs Com. dans les cellules de cote.
  - `with-details` — montre les colonnes Cote totale détaillée + Profit par détail.
  - `with-fixed-gain` — montre le bouton "+ Gain fixe".
  - `has-multi-details` — calculé en JS (`refreshMultiDetailsClass`), insère la colonne "Fixe détail" entre "Suppr détail" et "Fixe".
- `.issue-avg-cote { grid-column: calc(3 + var(--nb-cotes)) / span 1 }` et `.issue-sum-profit { grid-column: calc(5 + var(--nb-cotes)) / span 1 }` — placement explicite pour la ligne "+ Détail" car l'auto-flow ne suffit pas (cellules issue-level adjacentes).

## Paramètres globaux

Quatre toggles dans la section `.global-settings`, tous persistés en `localStorage` sous `calcCouv.<key>` :

| Clé | Effet |
|---|---|
| `commissionEnabled` / `commissionDefault` | Active les inputs Com. ; valeur par défaut pour les Lay (Back reste à 0). |
| `lossDistEnabled` / `lossDistDefault` | Active l'interpolation `target = (1−p)·K + p·S` (p ∈ [0,1]). |
| `detailsEnabled` | Affiche/masque la décomposition Cote totale + Profit par détail. |
| `fixedGainEnabled` | Affiche le bouton "+ Gain fixe" dans `addDetailCell`. |

Chaque toggle déclenche `recomputeAll(true)` sur tous les calculateurs du registry.

## Duplication / suppression de calculateur

- **Duplication** (`duplicateCalc`) : sérialise les inputs (radios/checkboxes : `.attr('checked')` ; texte : `.attr('value')`) **avant** `outerHTML`, sinon les valeurs live ne survivent pas. Le nouveau calculateur passe par `initCalculator(..., { skipBootstrap: true })` qui reconstruit l'état (`colIds`, `nb_odds`, `nb_issues`) depuis le DOM cloné et rebind les inputs.
- **Suppression** (`deleteCalc`) : retire l'entry de `calcRegistry`, puis `.remove()`. Minimum 1 calculateur (le bouton ne fait rien sinon).

## Math — récap des formules clés

- **Lay net win factor** : `layNetWinFactor = Π(1 − c_i)` — fraction du stake gagnée si le Lay gagne.
- **Lay return factor** : `layReturnFactor = layNetWinFactor + (oddsTotal − 1)` — retour total (stake gagné + engagement récupéré) par unité de stake quand le Lay gagne.
- **Back-équivalent NET d'un Lay** : `(O − c) / (O − 1) = layReturnFactor / (oddsTotal − 1)` — cote nette à comparer aux Back.
- **Engagement Lay** : `stake × (oddsBrut − 1)`.
- **TRJ** : `1 / Σ(1 / effectiveOddsNet_i)` sur les issues qui *parient* (Gain fixe exclu).
- **Cote moyenne issue (multi-détails)** : `Σ profit_i (hors FG) / Σ stake_i (hors FG)`.
- **Profit total issue** : `Σ retours_i (quand cette issue gagne) − Σ investis_toutes_issues`.
- **Profit total global** : `K − Σ investis_toutes_issues`.

## Debug

Bouton `bug` en footer → toggle `_debugMode`. En mode debug, le bouton "Télécharger état actuel (debug)" devient visible et exporte un JSON via `downloadDebugStateJson` → `collectDebugState` → `collectCalcState` par card.

**Limite connue** : `collectCalcState` itère uniquement les détails `[data-type]` (Back/Lay). Les détails Gain fixe (`[data-fixed-gain-input]`) **ne sont pas exportés** — c'est piégeux pour le debug car un Gain fixe invisible dans le JSON peut expliquer un écart de calcul.

## Points de vigilance pour les évolutions

- **Ajouter une colonne** ne se limite pas à `addOddsColumn` : il faut aussi insérer une cellule placeholder dans **chaque ligne Gain fixe** (`.fg-cote`) pour préserver l'alignement de l'auto-flow.
- **Ajouter un type de cellule par détail** : penser à `countDetails`, `updateIssueSpans` (compte aussi les Gain fixe via `[data-fixed-gain-input]`), `refreshMultiDetailsClass`, `buildFixedGainDetailCells` (placeholder), et `removeDetail`.
- **Ajouter une formule** : passer dans `recomputeAll` quelque part entre la collecte et l'affichage. Toujours filtrer `d.isFixedGain` quand la formule concerne des cotes/mises.
- **`autoSetFixeDetailsOnAdd`** est appelé sur `addDetail` (2 détails Back/Lay) mais **pas** sur `addFixedGainDetail` (le Gain fixe est son propre point d'ancrage ; le détail existant doit rester libre pour s'équilibrer contre lui).
- **Tout `setStake`/`setLiability`** doit respecter `if ($input[0] === document.activeElement) return;` — sinon la saisie utilisateur devient impossible.
