# État des lieux du Magotculteur — 26/11/2026

Analyse du code complet (v7.2.0) : `src/` (engine, app, links, worker, types), `index.html`, API. Le code est comparé à la spécification ([informations.md](informations.md)) et à [architecture.md](architecture.md).

## Sommaire

1. [Fonctionnement actuel](#1-fonctionnement-actuel)
2. [Bugs](#2-bugs)
3. [Fonctionnalités incomplètes ou peu logiques](#3-fonctionnalités-incomplètes-ou-peu-logiques)
4. [Calculs à valider](#4-calculs-à-valider)
5. [Dette technique et documentation](#5-dette-technique-et-documentation)
6. [Questions ouvertes](#6-questions-ouvertes)
7. [Ordre de correction proposé](#7-ordre-de-correction-proposé)

---

## 1. Fonctionnement actuel

- **Deux moteurs** :
  - **Simultané** (`computeSimult`) : symétrique, asymétrique et asymétrique léger ; uni-site et multi-sites.
  - **Séquentiel** (`computeSeq`) : un combiné principal de 2 ou 3 sélections, avec une seule couverture par sélection (celle dont la cote est la plus favorable).
- **Calcul parallèle** : jusqu'à 8 workers se partagent les combinaisons de matchs. Au-delà d'un match, seuls les 30 meilleurs matchs sont combinés.
- **Mode simple** : il est converti en configuration de sites.
  - Freebet : le site principal passe en priorité 1, avec le montant saisi comme freebet.
  - Cash : le site principal reçoit une mission obligatoire fictive (`simple_main`).
- **Mode avancé** : freebets et missions par site, mais une grande partie de la spécification n'est pas branchée (voir la partie 3).
- **Résultats** : triés par profit, avec un filtre par colonne et des liens vers calc-couverture et couv-seq.

---

## 2. Bugs

### Bugs majeurs

| # | Problème | Où | Effet |
|---|---|---|---|
| B1 | ✅ **Corrigé en v7.2.1** (tolérance `AMOUNT_EPS`). **Arrondi des nombres à virgule sur les montants de mission.** Le moteur cale une mise exactement sur le montant voulu, puis vérifie `mise >= montant`. Le résultat tombe parfois à 9,9999999 € pour 10 €. | [engine.ts:690](src/engine.ts#L690), [app.ts:181](src/app.ts#L181) | Environ **3 % des combinaisons valides sont écartées sans message** en Cash simple, avec « Mise min. par pari » ou « Profit brut » (mesuré sur 200 000 cas simulés). |
| B2 | ✅ **Corrigé en v7.2.2.** **« Cote min. par sélection » n'a aucun effet en Freebet simultané.** Le contrôle se trouve uniquement dans la partie Cash. | [engine.ts:902](src/engine.ts#L902) | Des combinés freebet sortent avec des sélections sous le minimum. |
| B3 | ✅ **Corrigé en v7.2.2.** **Le séquentiel ignore les cases Uni-site / Multi-sites.** | [engine.ts:1309](src/engine.ts#L1309) | Des résultats « Séq. · Multi » apparaissent même quand Multi-sites est décoché. |
| B4 | **Freebet séquentiel en mode avancé** : la mise freebet vient du montant du mode simple (caché), et non du freebet disponible du site. Le contrôle des 98 % compare ensuite cette mise au freebet disponible. | [engine.ts:1511](src/engine.ts#L1511), [engine.ts:716](src/engine.ts#L716) | Aucun résultat si le montant caché est plus petit que le freebet. Mise supérieure au freebet disponible s'il est plus grand. |
| B7 | **Configuration du mode avancé jamais sauvegardée** (`_advSites` absent des préférences). Le site principal est enregistré mais jamais relu. | [app.ts:54](src/app.ts#L54) | Freebets et missions sont perdus à chaque rechargement ou nouvel onglet. Le site principal repart sur le premier site par ordre alphabétique. |
| B8 | **Sites d'un ancien JSON conservés** : `_advSites` n'est jamais vidé. | [app.ts:910](src/app.ts#L910), [app.ts:159](src/app.ts#L159) | Une mission obligatoire restée sur un site absent du JSON bloque tous les résultats. |
| B10 | **Freebet en mode avancé sans site en priorité 1** : tous les paris sont traités comme des freebets, y compris sur des sites en priorité 3 ou sans freebet. Le montant total vient du mode simple caché. | [engine.ts:816](src/engine.ts#L816), [engine.ts:825](src/engine.ts#L825) | Les résultats supposent des freebets que l'utilisateur n'a pas. |
| B11 | **Aucun plafond sur la mise freebet.** Avec « Mise min. par pari » ou « Profit », le total freebet peut dépasser le freebet disponible. | [engine.ts:828-840](src/engine.ts#L828-L840) | Le calculateur propose plus de freebet que disponible. |

### Bugs d'affichage

| # | Problème | Où |
|---|---|---|
| B5 | **Barre de progression fausse.** Chaque worker annonce le total global au lieu de sa part. Avec 8 workers, la barre plafonne vers 16 %, le compteur affiche 8 fois trop de combinaisons, et la progression retombe à 0/0 en séquentiel. | [engine.ts:1182](src/engine.ts#L1182), [app.ts:1132](src/app.ts#L1132) |
| B6 | **Couleur du Taux toujours verte en Cash.** Le seuil attend un taux négatif (−3 %), alors que le taux affiché est un TRJ d'environ 95 %. | [app.ts:95](src/app.ts#L95) |
| B9 | **« Profit » faux pour un Lay** dans le détail : il affiche `mise × cote`. Ailleurs, ce « Profit » est en fait le retour brut. | [app.ts:327](src/app.ts#L327) |

### Bugs mineurs

- **Apostrophe non échappée** : `esc()` ne la traite pas, donc un nom de site contenant `'` casse les `onclick`.
- **Montant à 0 ou vide** : il est remplacé par 10 € sans prévenir.
- **Plantage d'un worker** : l'écran de calcul se ferme sans aucun message d'erreur.
- **Fichier de debug** : la version `6.0.0` y est écrite en dur.
- **Annulation dans le worker** : le drapeau `cancelled` ne sert jamais, car le worker est arrêté directement.

---

## 3. Fonctionnalités incomplètes ou peu logiques

### Mode avancé

- **Les réglages cachés du mode simple restent utilisés** : montant, mode de montant, objectif, cote min., cote min. par sélection et boost (dont le site reste le site principal du mode simple) ([app.ts:199-218](src/app.ts#L199-L218)).
- **Missions** :
  - l'**objectif** d'une mission n'est jamais lu par le moteur ;
  - le **montant** d'une mission ne fait que filtrer les résultats, il ne fixe pas les mises.
- **Priorité 2 (« Pour compléter »)** : inutilisée en simultané dès qu'un site est en priorité 1.
- **Plusieurs sites en priorité 1** : la répartition des freebets suit les cotes, sans viser le freebet de chaque site, puis chaque site doit atteindre 98 %. L'exemple de la spécification (A à 10 €, B à 15 €) ne donne presque jamais de résultat.
- **Mission obligatoire en Freebet** : elle ne rend pas le site obligatoire, contrairement à la spécification. Elle reste pourtant exigée, ce qui élimine des résultats sans explication.
- **Missions et freebets** : un pari freebet peut valider une mission, alors que la spécification dit qu'une mission se fait toujours en Cash.

### « Profit net min. »

Son sens change selon la méthode, et aucune version ne correspond à la spécification (« profit net minimum de chaque pari sur le site principal ») :

| Méthode | Comportement actuel |
|---|---|
| Cash simultané | Vise une **perte totale égale au montant** : 10 € donnent environ 200 € misés pour 10 € de perte. |
| Freebet | Profit total au moins égal au montant. |
| Séquentiel « Gagner » | Profit net du pari principal égal au montant. |

### Séquentiel

- **Mode de montant ignoré** en Freebet et en Cash « Miser » : la mise principale vaut toujours le montant saisi.
- **Cote min. appliquée à chaque sélection** et non à la cote combinée ([engine.ts:241](src/engine.ts#L241)), contrairement au simultané.
- **2 ou 3 sélections seulement** : 4 et 5 sont ignorées, et la branche « 1 sélection » ne s'exécute jamais.
- **Couvertures limitées aux règles à 2 issues** : les exemples 1 à 3 de la spécification ne sont pas gérés (M1 B et M1 C couverts séparément, couverture combinée).
- **Boost non géré** : quand un boost est actif, le séquentiel sort quand même des résultats non boostés.
- **Écart minimum de 90 min entre deux matchs, en dur** : pensé pour le foot. Les matchs sans date sont écartés sans message.

### Asymétrique et Asym. léger

- **Doublons** : l'asymétrique (une issue en simple, les autres en combiné) est un cas particulier de l'asym. léger. Sur les ensembles de couverture à 2 issues, les deux méthodes sont identiques. Les mêmes combinaisons sortent donc deux fois, sous deux étiquettes.
- **Le vrai asymétrique de la spécification n'est pas produit** : un ensemble de couverture différent pour le 2e match selon la branche du 1er. Le code réutilise le même ensemble pour toutes les branches.

### Dédoublonnage

- **Ce qu'annonce la documentation** : un résultat par combinaison de matchs.
- **Ce que fait le code** : un résultat par structure, méthode et site ([engine.ts:1227](src/engine.ts#L1227)).
- **Conséquence** : des volumes énormes, par exemple environ 176 000 résultats pour 94 matchs.

---

## 4. Calculs à valider

- **Séquentiel Cash « Gagner »** : le commentaire promet un résultat nul quand une couverture gagne. Ce n'est vrai que pour la 1re couverture ([engine.ts:1600](src/engine.ts#L1600)).
- **Séquentiel Cash « Perdre »** : le pire cas retire aussi les couvertures suivantes, qui ne sont pourtant jamais placées si une couverture précédente gagne ([engine.ts:1676](src/engine.ts#L1676)). La perte affichée est donc trop pessimiste.
- **Cote min. sur un Lay** : elle est comparée à la cote Lay brute. Le filtre a-t-il un sens pour un Lay ?
- **Bases de comparaison différentes** : la cote min. par sélection des missions utilise la cote nette, la cote min. utilise la cote brute.
- **Mission « Mise min. » sur un Lay** : la référence est la mise Lay, et non la liability.
- **Choix des 30 meilleurs matchs** : ils sont notés en uni-site sur les sites obligatoires seulement. Un match intéressant uniquement en multi-sites peut ne jamais être combiné.
- **Tri par profit absolu** : avec « Mise min. par pari », les petites mises remontent mécaniquement.
- **Fraîcheur des cotes** : le moteur n'écarte pas les matchs déjà commencés.

---

## 5. Dette technique et documentation

- **architecture.md est très en retard sur le moteur** : il cite `computeToutFB` / `computeMultiSite`, des « méthodes 1/2/4 », un seul worker, un cache `_allResults` et des `EngineOpts` qui n'existent plus.
- **informations.md** :
  - la plupart des sections d'exemples sont vides ;
  - la partie « 3 events » reprend les exemples à 2 matchs ;
  - les sections séquentiel Multi et Asym. sont vides.
- **Aucun test automatisé du moteur**, alors que l'API et les fichiers de debug fourniraient facilement des cas de non-régression.
- **Performance** : `getCoverSets` n'est jamais mis en cache et se recalcule des milliers de fois par match.
- **Code mort** : le tableau `results` de `computeSimult`, le paramètre `coteMinPerSel` de `legGroupInfo` et l'annulation dans le worker.

---

## 6. Questions ouvertes

1. **« Profit net min. »** : profit de chaque pari du site principal (spécification), ou perte totale cible (comportement actuel en Cash) ?
2. **Mode avancé** : le montant d'une mission doit-il fixer les mises ? Quel objectif et quelle cote min. appliquer quand plusieurs sites ont des missions ?
3. **Plusieurs sites en priorité 1** : faut-il répartir les freebets site par site, pour viser 98 à 100 % de chaque freebet ?
4. **Priorité 2** : comment la jouer quand un site est déjà en priorité 1 ? Faut-il plafonner chaque site à son freebet disponible ?
5. **Séquentiel** : veux-tu les couvertures sur marchés à 3 issues, les couvertures combinées et les combinés de 4 ou 5 sélections ?
6. **Séquentiel Gagner / Perdre** : le profit affiché doit-il supposer toutes les couvertures placées d'avance, ou suivre le déroulement réel ?
7. **Asymétrique / Asym. léger** : faut-il les fusionner, ou implémenter le vrai asymétrique de la spécification ?
8. **Dédoublonnage** : un seul résultat par combinaison de matchs, ou toutes les variantes ?
9. **Écart de 90 min entre deux matchs** : réglable, ou adapté au sport ?
10. **Missions en Freebet** : un pari freebet peut-il valider une mission ?

---

## 7. Ordre de correction proposé

1. **B7 et B8** : sauvegarder le mode avancé, relire le site principal et nettoyer les anciens sites.
2. ~~**B1** : comparer les montants avec une petite tolérance.~~ Fait en v7.2.1.
3. ~~**B2 et B3** : corrections simples, sans ambiguïté.~~ Fait en v7.2.2.
4. **B5, B6 et B9** : affichage.
5. **Mode avancé** (B4, B10, B11 et partie 3) : une fois les questions 1 à 4 tranchées.
