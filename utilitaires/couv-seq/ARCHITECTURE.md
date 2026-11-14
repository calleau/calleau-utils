# Architecture — Couverture séquentielle

Calculateur qui convertit un ou plusieurs paris placés chez un bookmaker (freebet ou cash, simple ou combiné) en profit garanti, en les couvrant **match par match** sur un exchange (Piwi par défaut) avec des Lay ou des Back opposés. Les mises de couverture sont calculées pour que le profit soit **identique quelle que soit l'issue**.

Version actuelle : voir [`versions.js`](versions.js) (`CURRENT_VERSION`).

## Principe

### La séquence

Un combiné de N matchs se couvre en N étapes. On ne place la couverture *k* que si toutes les précédentes ont été perdues (c'est-à-dire si la sélection du combiné est toujours vivante) :

```
            Couverture 1 (match 1)
            ├─ gagne  → combiné mort, on encaisse la couverture 1 ........ FIN (profit P)
            └─ perd   → perte enregistrée, on passe à la suivante
                 Couverture 2 (match 2)
                 ├─ gagne → combiné mort, on encaisse la couverture 2 ..... FIN (profit P)
                 └─ perd  → …
                      …
                      Couverture N perd → le combiné passe, on encaisse W  FIN (profit P)
```

Il y a donc **N + 1 issues possibles** (une par couverture gagnante, plus « le combiné passe »). L'outil choisit les mises de couverture pour que les N + 1 issues donnent le même profit `P`.

### Les deux types de couverture

Pour chaque couverture, on peut saisir une cote **Lay** et/ou une cote **Back opposé**, chacune avec sa propre commission (3 % par défaut, `0` pour un bookmaker classique). Par euro misé :

| Type | Gain si la couverture gagne (`gain`) | Perte si elle perd (`loss`) |
|---|---|---|
| Lay @ `l` | `1 − c` | `l − 1` (la liability) |
| Back opposé @ `b` | `(b − 1) × (1 − c)` | `1` |

Si les deux cotes sont renseignées, l'outil teste toutes les combinaisons Lay/Back sur l'ensemble des couvertures à venir (au plus 2⁸ = 256) et garde celle qui maximise `P`.

### Couvertures réalisées

Au fil des matchs, on bascule une couverture de **À venir** à **Réalisé** et on saisit la perte réellement subie. Cette perte (`L`, cumulée) est intégrée au calcul : les mises des couvertures restantes sont recalculées pour rééquilibrer le profit sur les issues encore possibles.

Verrou séquentiel : une couverture ne peut être marquée réalisée que si toutes les précédentes le sont. Repasser une couverture en « À venir » repasse toutes les suivantes en « À venir ».

Au passage en « Réalisé », si la perte est vide, elle est pré-remplie avec la perte attendue : pertes des mises validées + perte de la mise conseillée restante (`expectedCoverLoss`).

### Mises validées (placement partiel)

Pendant le placement, la cote peut bouger et seule une partie de la mise est validée. Sur la couverture en cours (la première non réalisée), le bouton **« + Mise validée »** enregistre ce qui a réellement été validé : type (Back opp. / Lay), cote, montant, commission. La nouvelle ligne est pré-remplie avec la mise conseillée du moment, il ne reste qu'à corriger le montant (et la cote si besoin).

On met ensuite les cotes Back/Lay de la carte à jour avec les cotes actuelles : la carte affiche le **complément à placer**, les couvertures suivantes et le profit sont rééquilibrés. On répète l'opération si les cotes bougent encore (une ligne par validation). Le complément peut être d'un autre type que les mises validées : l'optimisation Lay/Back porte uniquement sur le complément.

Si les mises validées couvrent déjà la couverture (complément négatif ou < 1 centime), la carte affiche « Rien à ajouter ». La mise est alors figée à 0 et l'issue « cette couverture gagne » rapporte plus que le profit garanti affiché, qui reste celui des autres issues.

Rappel affiché sous les mises : annuler la partie non validée de l'ordre avant de placer le complément, sinon elle risque d'être validée plus tard à l'ancienne cote.

## Le calcul

Implémenté dans `computeSequential()` et `evaluateCombination()` ([couv-seq.js](couv-seq.js), section « MOTEUR DE CALCUL »).

### Entrées agrégées

- `W` = Σ `mise × (cote totale − 1)` sur les paris placés valides — gain net si tous les paris passent. La cote totale est soit saisie directement, soit le produit des cotes individuelles (`computeTotalOdd`).
- `cashRisk` = Σ des mises des paris **cash** (perdues si le combiné ne passe pas ; un freebet, lui, ne coûte rien).
- `freebetTotal` = Σ des mises des paris **freebet** (sert au taux de conversion).
- `L` = Σ des pertes saisies sur les couvertures réalisées.

Un pari sans cote valide (> 1) ou sans montant est ignoré.

### Résolution

Pour les K couvertures à venir, avec `gᵢ` et `lᵢ` le gain et la perte unitaires de la couverture *i* :

```
Qₖ = Π_{i<k} (gᵢ + lᵢ)        (Q₁ = 1)
Rₖ = Π_{i≤k} gᵢ
M  = (W + cashRisk) / (1 + Σₖ Qₖ·lₖ / Rₖ)
Sₖ = M · Qₖ / Rₖ               ← mise de la couverture k
P  = M − L − cashRisk          ← profit garanti
```

D'où vient la formule : si la couverture *k* gagne, le profit vaut `Sₖ·gₖ − (pertes des couvertures précédentes) − L − cashRisk`. Imposer que ce profit soit le même pour chaque *k*, et égal au profit « combiné passe » (`W − L − Σ Sᵢ·lᵢ`), donne un système triangulaire dont la solution est ci-dessus. `M` est le montant net que doit rapporter chaque couverture gagnante, pertes antérieures déjà remboursées.

**Avec des mises validées**, chaque couverture *k* a une part fixe `Gₖ` (gain des mises validées si elle gagne) et `Lₖ` (leur perte si elle perd), calculée par `fillsFixedPart`. En notant `Tₖ = M + pertes cumulées avant k` :

```
couverture k gagne : Sₖ·gₖ + Gₖ = Tₖ        →  Sₖ = (Tₖ − Gₖ) / gₖ
couverture k perd  : Tₖ₊₁ = Tₖ + Sₖ·lₖ + Lₖ
combiné passe      : T_{K+1} = W + cashRisk
```

`Tₖ` est affine en `M` (`aₖ·M + bₖ`), donc on résout `M` directement. Sans mise validée, `bₖ = 0` et on retombe exactement sur la formule ci-dessus. Si une mise `Sₖ` ressort négative, elle est figée à 0, son équation « gagne » est retirée (`Tₖ₊₁ = Tₖ + Lₖ`), et on résout de nouveau (`evaluateCombination`).

Pour un Lay, la liability affichée est `Sₖ × (l − 1)`.

### Exemple chiffré

Freebet 100 € sur un combiné 3,10 × 2,15. Deux couvertures Lay à 3,20 puis 2,25, commission 3 %.

- `W = 100 × (6,665 − 1) = 566,50 €`
- Couverture 1 : `g = 0,97`, `l = 2,2` — Couverture 2 : `g = 0,97`, `l = 1,25`
- `M = 566,50 / 7,4794 = 75,74 €`

| Couverture | Mise | Liability |
|---|---|---|
| 1 — Lay @ 3,20 | 78,08 € | 171,78 € |
| 2 — Lay @ 2,25 | 255,18 € | 318,98 € |

Vérification des 3 issues : couverture 1 gagne → `78,08 × 0,97 = +75,74 €` ; couverture 2 gagne → `255,18 × 0,97 − 171,78 = +75,74 €` ; combiné passe → `566,50 − 171,78 − 318,98 = +75,74 €`. Conversion : 75,7 %.

### Résultats affichés

- **Sur chaque couverture à venir** : type retenu (Lay / Back opp.) et cote, mise à placer (« Complément à placer » s'il y a des mises validées), liability (ou « sans liability » pour un Back opposé).
- **Résumé global** (sous les couvertures) :
  - *Freebet placé* = `freebetTotal`
  - *Cash récupéré* = `P` ; si toutes les couvertures sont réalisées (le combiné est passé), `W − L − cashRisk`
  - *Conversion* = `P / freebetTotal` (« — » s'il n'y a que du cash)

Messages d'attente selon le statut renvoyé par `computeSequential()` :

| Statut | Signification |
|---|---|
| `no-bets` | Aucun pari placé valide. |
| `missing-odds` | Une couverture à venir n'a ni Lay ni Back opp. Le calcul s'arrête : elle affiche « Renseignez… », les suivantes « En attente de la couverture N ». |
| `no-pending` | Toutes les couvertures sont réalisées, donc toutes ont perdu et le combiné est passé. |
| `ok` | Calcul complet. |

## Interface

| Zone | Contenu |
|---|---|
| Colonne gauche (`.params-col`) | Nombre de couvertures (2 à 8), paris placés, bouton « Enregistrer la configuration », configurations enregistrées. |
| Colonne centrale (`.main-col`) | Une carte par couverture (`#covers-container`), puis le résumé (`#results-summary`). |

**Pari placé** : site, intitulé, type (Freebet / Cash, défaut freebet), mise (défaut 50 €), cotes en mode *Individuelles* (liste extensible, cote totale affichée en direct) ou *Cote totale*.

**Couverture** : site, intitulé, statut (À venir / Réalisé). En « À venir » : cote Back opposé + commission, cote Lay + commission, et sur la couverture en cours le bloc « Mises validées ». En « Réalisé » : perte subie (€).

**Site** : texte libre. Si le texte contient le nom d'un site connu (`KNOWN_SITES` : bet365, betclic, winamax, piwix…), l'input prend l'attribut `data-site-match` et se colore avec la couleur du bookmaker définie dans [`theme.css`](../../theme.css). Purement visuel.

## Fichiers

| Fichier | Rôle |
|---|---|
| [index.html](index.html) | Squelette : toolbar, deux colonnes, footer version, widget versions. Charge `lz-string` depuis jsDelivr. |
| [couv-seq.css](couv-seq.css) | Mise en page et styles propres à l'outil (le thème commun vient de `../../theme.css`). |
| [couv-seq.js](couv-seq.js) | Toute la logique : état, rendu, calcul, persistance, partage par URL. |
| [versions.js](versions.js) | `CURRENT_VERSION` (footer) et `AVAILABLE_VERSIONS` (archives). |
| [URL_STATE.md](URL_STATE.md) | Spécification du paramètre `?s=` pour produire ou lire un lien depuis un autre outil. |
| [v1.0.0/](v1.0.0/index.html) | Ancienne version archivée (calculateur simple / combiné 2 matchs / récupération), autonome. |

## Architecture JS

[couv-seq.js](couv-seq.js) est un script classique (pas de module, pas de build). Pas de framework : le HTML est généré par concaténation de chaînes et réinjecté via `innerHTML`, avec des handlers inline (`onclick="setCoverStatus(1,'realized')"`), donc toutes les fonctions appelées depuis le HTML sont globales.

### État

Trois variables globales, chacune miroir d'une clé `localStorage` :

| Variable | Clé `localStorage` | Forme |
|---|---|---|
| `placedBets` | `couvseq_bets` | `[{ id, type, amount, oddsMode, totalOdd, odds[], site, label }]` |
| `covers` | `couvseq_covers` | `[{ status, backOdd, layOdd, backComm, layComm, loss, site, label, fills:[{ mode, odd, comm, stake }] }]` |
| `nCovers` | `couvseq_ncovers` | entier 2–8 |

Plus `savedConfigs` (`couvseq_saves`) pour les configurations nommées, et `lastResult` (non persisté) : le dernier résultat du calcul, utilisé pour pré-remplir une mise validée ou la perte d'une couverture réalisée.

### Cycle de mise à jour

Chaque modification passe par le même circuit :

```
handler inline (onBetAmount, setCoverField, …)
  → mute placedBets / covers
  → savePlacedBets() / saveCovers()
       ├─ localStorage
       ├─ pushStateToURL()   (debounce 500 ms)
       └─ recompute()        → computeSequential() → updateCoverResultsDom() + updateGlobalSummary()
  → éventuellement renderPlacedBets() / renderCovers() si la structure change
```

Les saisies de texte et de nombres **ne re-rendent pas** la carte (seulement le calcul et les zones de résultat), pour ne pas faire perdre le focus. Seuls les changements de structure (ajout/suppression de pari ou de cote, changement de type, de mode, de statut, de nombre de couvertures) déclenchent un re-rendu complet.

`renderCovers()` appelle `ensureCoversLength()`, qui ajuste `covers` à `nCovers` (complète avec des couvertures par défaut ou tronque) et applique le verrou séquentiel.

### Ordre de démarrage

L'ordre dans le fichier compte :

1. `primeStorageFromURL()` — si l'URL contient `?s=`, le décode et **écrit** son contenu dans `localStorage` avant que les loaders ne s'exécutent.
2. `loadPlacedBets()` + `renderPlacedBets()`.
3. Lecture de `nCovers` + `renderNCovers()`.
4. `loadCovers()` + `renderCovers()` (premier calcul).
5. `loadSavedConfigs()` + `renderSavedConfigs()`.
6. `__urlSyncReady = true` puis `pushStateToURL()` : l'URL n'est mise à jour qu'à partir d'ici, pour ne pas l'écraser pendant le chargement.

### Partage par URL

L'état complet est encodé dans `?s=` (JSON compact à clés courtes, valeurs par défaut omises, compressé avec `lz-string`), réécrit via `history.replaceState` 500 ms après la dernière modification. Copier l'URL de la barre d'adresse suffit pour partager l'état. Format détaillé : [URL_STATE.md](URL_STATE.md).

Un paramètre illisible est retiré de l'URL sans message ; un `v` différent de `1` est ignoré.

### Configurations enregistrées

« Enregistrer la configuration » demande un nom (défaut : date + heure) et ajoute en tête de liste un snapshot `{ id, name, createdAt, state: { v, b, c, n } }`. Attention : malgré les mêmes noms de clés `b` / `c` / `n`, `state` contient les objets **complets** (format `localStorage`), pas le format compact de l'URL.

« Charger » remplace l'état courant (écritures directes dans `localStorage` puis re-rendu complet). Les configurations restent locales au navigateur.

### Migration

`migrateCover()` convertit l'ancien champ unique `commission` en `backComm` + `layComm` et ajoute `fills: []` s'il manque, au chargement depuis `localStorage` et depuis une configuration enregistrée. Côté URL, l'ancienne clé `m` sert de valeur de repli pour `mb` / `ml`.

## Points de vigilance pour les évolutions

- **Un lien sans `b` ou sans `c` ne réinitialise pas** : `primeStorageFromURL` n'écrit dans `localStorage` que les clés présentes dans l'URL. Ouvrir `?s=` encodant `{ "v": 1 }` laisse donc en place les paris et couvertures locaux du visiteur au lieu d'afficher un état vide.
- **Clé `fbcalc`** : n'est plus écrite par la version actuelle, mais reste utilisée par l'archive [v1.0.0](v1.0.0/index.html) (même origine). Ne pas la supprimer du `localStorage`.
- **Ajouter un champ à un pari ou une couverture** : le prévoir dans `createBet` / `defaultCover`, dans `serializeBetForUrl` / `expandBetFromUrl` (ou leurs équivalents cover), et dans [URL_STATE.md](URL_STATE.md). Ne jamais écrire sa valeur par défaut dans l'URL.
- **Champs numériques** : une cote ou une perte vidée devient `null` ; une commission vidée devient `0` (et non 3 %).
- **`escapeHtml`** est indispensable pour tout texte libre réinjecté dans le HTML (site, intitulé, nom de configuration).
- **Liste des sites connus** : `KNOWN_SITES` doit rester alignée avec les couleurs `--site-*` de `theme.css` et avec la liste de calc-couverture.
- **Versions** : à chaque évolution, incrémenter `CURRENT_VERSION` dans [versions.js](versions.js). Pour archiver une version, copier la page dans `vX.Y.Z/` et l'ajouter à `AVAILABLE_VERSIONS`.
