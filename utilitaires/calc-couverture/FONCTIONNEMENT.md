# Fonctionnement — Calculatrice couverture

Guide d'utilisation et de compréhension de la calculatrice de couverture (version de référence : **v3.7.0**).

Ce document explique **ce que fait l'outil et comment il raisonne**. Pour l'implémentation (DOM, pipeline JS, CSS), voir [ARCHITECTURE.md](ARCHITECTURE.md). Pour le format des liens partageables `?s=…`, voir [URL_STATE.md](URL_STATE.md).

---

## 1. À quoi sert l'outil

La calculatrice répartit des mises entre plusieurs issues d'un même événement (Back chez un bookmaker, Lay sur un exchange, plusieurs bookmakers sur la même issue…) pour que **le résultat soit connu à l'avance, quelle que soit l'issue qui passe**.

On lui donne :
- les **cotes** de chaque issue (et éventuellement commissions, boosts, gains fixes) ;
- **un point d'ancrage** : la mise d'une issue, le total investi, ou un montant total sur des mises liées.

Elle calcule :
- les **mises** (et engagements Lay) à placer sur les autres issues ;
- le **profit** pour chaque issue qui passe ;
- le **TRJ** (taux de retour) de la combinaison.

Tout est recalculé en direct à chaque saisie.

---

## 2. Vocabulaire

| Terme | Sens dans l'outil |
|---|---|
| **Calculateur** | Un tableau de couverture complet. Plusieurs peuvent cohabiter sur la page. |
| **Issue** | Un résultat possible de l'événement (ex. « PSG gagne », « Nul »…). Une ligne numérotée 1, 2, 3… Minimum 2 par calculateur. |
| **Détail** | Un pari placé sur une issue. Une issue a au moins un détail ; elle peut en avoir plusieurs (ex. deux bookmakers sur la même issue). |
| **Colonne de cote** (A, B, C…) | Une sélection d'un pari combiné. Avec plusieurs colonnes, la cote totale d'un détail = produit des cotes. |
| **Back** | Pari classique « cette issue passe ». La mise est l'argent engagé. |
| **Lay** | Pari « contre » sur un exchange. La **Mise** est le gain potentiel (mise du parieur d'en face), l'**Engagement** est ce qu'on risque : `mise × (cote − 1)`. |
| **Commission** | Pourcentage prélevé sur les gains (typiquement exchange, 3 % par défaut). |
| **Boost** | Bonification bookmaker qui augmente le gain net d'un Back de x %. |
| **Gain fixe** | Montant fixe (positif ou négatif) encaissé si l'issue passe, sans mise ni cote (bonus, pénalité…). |
| **TRJ** | Taux de retour : part de l'argent investi qui revient en moyenne. 100 % = aucune perte. |

---

## 3. Lecture du tableau

```
N° │ Type │ Site │ Cote A..N │ Cote totale │ Mises │ Profit │ 🗑 │ Fixe détail │ Fixe │ Distribution │ Profit total │ 🗑
```

| Colonne | Contenu |
|---|---|
| **N°** | Numéro de l'issue. La dernière ligne, **Total**, résume le calculateur. |
| **Type** | Bouton bascule **+ Back** / **− Lay**. |
| **Site** | Nom du site (option « Site par détail »). Les sites connus (Betclic, Winamax, Unibet, Piwix, bet365…) prennent automatiquement leur couleur. |
| **Cote A, B…** | Cote brute du détail pour chaque sélection. Avec l'option « Intitulés », la lettre de l'en-tête devient un texte personnalisable. Sous la cote : champs **Com.** (si Commissions actives) et **Boost** (si Boost actif). |
| **Cote totale** | Produit des cotes. Avec commissions ou en Lay, affiche une mini-grille **Brut / Net** et l'équivalent Back d'un Lay. Sur la ligne Total : le **TRJ**. |
| **Mises** | Mise du détail ; pour un Lay, la mise **et** l'engagement. Sur la ligne Total : le total investi. |
| **Profit** | Par détail. Back : retour si l'issue passe (`mise × cote nette`, mise incluse). Lay : gain net encaissé (`mise × (1 − commission)`). |
| **Fixe détail** | N'apparaît que si une issue a plusieurs détails (voir §6). |
| **Fixe** | Bouton radio : **le point d'ancrage** du calcul (une seule ligne par calculateur). |
| **Distribution** | Case à cocher : l'issue participe au partage du profit (voir §5). |
| **Profit total** | Résultat net si **cette** issue passe : tout ce qui revient − tout ce qui a été investi sur toutes les issues. Sur la ligne Total : le profit garanti. |

Les cellules de profit et de TRJ sont colorées selon le TRJ :

| TRJ | Couleur |
|---|---|
| < 90 % | rouge |
| 90 – 95 % | orange foncé |
| 95 – 100 % | orange clair |
| ≥ 100 % | vert (surebet : profit garanti) |

---

## 4. Le point d'ancrage : « Fixe »

Toute couverture a besoin d'**une valeur connue** à partir de laquelle on déduit le reste. C'est le rôle du radio **Fixe**.

- **Fixe sur une issue** (cas courant) : on saisit la mise de cette issue (ex. 10 € sur le Back), les mises des autres issues sont calculées.
- **Fixe sur la ligne Total** : on saisit le **montant total à investir** (bankroll), l'outil répartit entre toutes les issues.
- **Lier issues** (option, voir §8) : remplace le Fixe quand elle est active.

Comportements utiles :
- Si l'issue fixe a une cote mais pas de mise, l'outil y met **10 €** par défaut.
- Si on supprime l'issue fixe, le Fixe **et sa mise** passent à l'issue suivante.
- Modifier à la main la mise d'une issue **non fixe** ne relance pas l'équilibrage : on voit simplement l'effet sur les profits. Re-modifier l'ancrage (ou une cote) ré-équilibre tout.
- Modifier l'**Engagement** d'un Lay recalcule sa mise (`mise = engagement / (cote − 1)`).

---

## 5. La distribution : où va le profit

### Issues distribuées (case cochée, défaut)

Toutes les issues distribuées sont équilibrées pour **rapporter le même montant** quand elles passent. Leur **Profit total** est donc identique : c'est le profit (ou la perte) garanti.

### Issues non distribuées (case décochée)

Une issue non distribuée est calculée pour simplement **rembourser le total investi** : si elle passe, on finit à 0 €. Tout le profit est reporté sur les issues distribuées.

Usage typique : on veut maximiser le gain sur une issue précise et accepter un résultat nul sur l'autre (« break-even »).

Il faut au moins une issue distribuée ; sinon le message « Aucune ligne en distribution » s'affiche.

> La case Distribution de la ligne **Total** coche/décoche toutes les issues d'un coup.

### Répartition de la perte (option)

Quand il y a des issues non distribuées, l'option **Répartition de la perte** (p, en %) fait un compromis entre les deux extrêmes :
- **p = 0 %** : comportement ci-dessus (profit concentré sur les issues distribuées, 0 € sur les autres) ;
- **p = 100 %** : les issues distribuées visent elles aussi le remboursement du total ;
- entre les deux : interpolation linéaire.

Sans issue non distribuée, l'option n'a aucun effet.

---

## 6. Plusieurs détails sur une même issue

Le bouton **+ Détail** sous une issue ajoute un pari supplémentaire sur cette issue (autre bookmaker, Back + Lay…). La colonne **Fixe détail** apparaît alors.

- Un détail **Fixe détail coché** garde sa mise telle quelle.
- Les détails **non cochés** se partagent à parts égales le retour restant pour atteindre l'objectif de l'issue.
- Quand on passe de 1 à 2 détails sur une issue non fixe, le détail existant est **coché automatiquement** (il devient la référence) et le nouveau s'ajuste.
- Sur l'**issue fixe**, tous les détails sont fixes d'office (cases cochées et grisées).

Sous l'issue, deux indicateurs apparaissent : **Moyenne** (cote moyenne réalisée sur les détails) et **Total** (somme des profits des détails).

---

## 7. Gain fixe

Activé par l'option **Gain fixe**, le bouton **+ Gain fixe** ajoute sur une issue un montant encaissé si elle passe, sans mise ni cote :
- **positif** : bonus garanti, remboursement promis… ;
- **négatif** : pénalité, perte annexe liée à cette issue.

Le gain fixe est toujours « fixe » : les autres détails de l'issue s'ajustent pour en tenir compte (une issue qui touche déjà 5 € de bonus a besoin de 5 € de retour en moins). Il n'entre **pas** dans le calcul du TRJ (il n'a pas de cote).

Une issue doit toujours garder au moins un détail Back ou Lay ; le gain fixe est un complément.

---

## 8. Options globales

En bas de page. Elles s'appliquent à **tous les calculateurs** et sont mémorisées dans le navigateur.

| Option | Effet |
|---|---|
| **Détails issues** | Affiche la décomposition Cote totale Brut/Net et le profit par détail. |
| **Gain fixe** | Affiche le bouton « + Gain fixe » sous chaque issue (§7). |
| **Intitulés** | Ajoute une ligne de texte libre au-dessus de chaque issue, et rend les en-têtes de colonnes de cote (A, B…) modifiables (ex. « PSG − OM », « Lens − Lille » pour un combiné). Un en-tête vidé reprend sa lettre. Pratique pour les captures d'écran. |
| **Site par détail** | Affiche la colonne Site, avec couleur automatique des sites connus. |
| **Lier issues** | Ajoute un bouton 🔗 sur chaque mise et un champ « Total des mises liées » sous le calculateur. Voir ci-dessous. |
| **Répartition de la perte** | Coefficient p en % (§5). |
| **Boost** | Affiche les champs Boost sous les cotes (§9). |
| **Commissions** | Affiche les champs Com. sous les cotes, avec une valeur par défaut pour les Lay (3 %). Les Back démarrent à 0. |

### Lier issues

Permet de fixer **la somme de plusieurs mises** plutôt qu'une mise unique. Exemple : « je veux miser 20 € au total entre mon Back Betclic et mon Back Winamax ».

1. Activer l'option, cliquer sur 🔗 sur les mises concernées.
2. Saisir le montant dans « Total des mises liées ».
3. L'outil cherche l'équilibrage dont la somme des mises liées (arrondies au centime) atteint **au moins** ce montant, au plus près.

Tant que le lien est actif (option cochée + montant > 0 + au moins une mise liée), il **remplace la ligne Fixe**, qui est ignorée. Le texte sous le champ indique le nombre de mises liées et leur total.

---

## 9. Comment sont prises en compte commissions, boosts et Lay

Pour chaque sélection de cote `o`, avec commission `c` et boost `b` (en fraction) :

- **Cote nette Back** : `1 + (o − 1) × (1 + b) × (1 − c)`. Le boost augmente le gain, la commission le réduit.
- **Lay** : si le Lay gagne, on encaisse `mise × (1 − c)` et on récupère son engagement `mise × (o − 1)`. Le boost ne s'applique pas aux Lay.
- **Équivalent Back d'un Lay** : `(o − c) / (o − 1)` — c'est la cote nette comparable à un Back, affichée dans « Cote totale ».
- **Combinés** : les cotes (brutes et nettes) des colonnes se multiplient.

---

## 10. Le calcul en résumé

1. Chaque issue reçoit une **cote effective** (cote nette, ou équivalent Back pour un Lay, ou moyenne pondérée en multi-détails).
2. **TRJ** = `1 / Σ (1 / cote effective)` sur les issues qui ont une cote.
3. À partir de l'ancrage, l'outil détermine deux quantités :
   - **K** : le retour visé quand une issue distribuée passe ;
   - **S** : le total investi (somme des mises Back + engagements Lay).
4. Chaque issue non fixe reçoit sa mise pour atteindre son objectif : **K** si distribuée, **S** si non distribuée (ou un mélange avec la répartition de la perte).
5. **Profit garanti** (ligne Total) = `K − S`.

### Exemple : Back / Lay à 2,10

Back 2,10 (issue 1, fixe, 10 €) contre Lay 2,10 avec 3 % de commission (issue 2), les deux distribuées.

| | Calcul | Résultat |
|---|---|---|
| Retour visé K | 10 × 2,10 | 21,00 € |
| Mise Lay | 21 / (0,97 + 1,10) | 10,14 € |
| Engagement Lay | 10,14 × 1,10 | 11,16 € |
| Total investi S | 10 + 11,16 | 21,16 € |
| Profit si issue 1 passe | +11,00 (Back) − 11,16 (engagement perdu) | −0,16 € |
| Profit si issue 2 passe | −10,00 (Back perdu) + 10,14 × 0,97 | −0,16 € |
| TRJ | 1 / (1/2,10 + 1,10/2,07) | ≈ 99,25 % |

Le résultat est le même quelle que soit l'issue : c'est la couverture.

---

## 11. Gestion des calculateurs

Sous chaque calculateur :
- **Colonne de côte** : ajoute une sélection (pari combiné). La corbeille de l'en-tête la supprime.
- **Issue** : ajoute une issue (corbeille en fin de ligne pour la supprimer ; minimum 2).
- **Dupliquer** : copie le calculateur avec toutes ses valeurs, juste en dessous.
- **Supprimer** : supprime le calculateur (minimum 1 sur la page).

Le bouton **Calculateur** sous la liste en ajoute un vierge.

Un calculateur neuf contient 1 colonne de cote, 2 issues à 2,00, l'issue 1 fixe avec 5 €.

Saisie des nombres : virgule ou point acceptés, arrondi à 2 décimales en quittant le champ ; les boutons **+ / −** font varier de 0,01.

---

## 12. Sauvegarde et partage

- **Lien partageable** : à chaque modification (après ~0,5 s), l'état complet de la page (tous les calculateurs + options) est encodé dans l'adresse (`?s=…`). Copier l'URL suffit pour **retrouver ou partager** exactement la même configuration. D'autres utilitaires peuvent générer ces liens (voir [URL_STATE.md](URL_STATE.md)).
- **Options globales** : mémorisées dans le navigateur (`localStorage`). Ouvrir un lien partagé applique ses options et les mémorise.
- Un lien corrompu est ignoré silencieusement : la page démarre avec un calculateur par défaut.

---

## 13. Messages d'erreur

| Message | Cause | Solution |
|---|---|---|
| Aucune ligne en distribution — cochez au moins une ligne. | Toutes les issues sont non distribuées. | Cocher Distribution sur au moins une issue. |
| Configuration impossible : trop de lignes non distribuées. | L'issue fixe est distribuée et les issues non distribuées pèsent à elles seules 100 % ou plus (somme des `1/cote` ≥ 1) : impossible de toutes les rembourser. | Distribuer davantage d'issues ou revoir les cotes. |
| Lier issues : les mises liées ne varient pas avec l'équilibrage (détails tous fixés ?). | Les mises liées sont toutes sur des détails fixes : elles ne peuvent pas bouger. | Lier au moins une mise non fixe. |
| Lier issues : montant impossible à atteindre avec ces cotes. | Le montant demandé donnerait un total investi négatif ou infini. | Changer le montant ou les mises liées. |

---

## 14. Divers

- **Versions précédentes** : bouton flottant d'historique (en bas de page) ; la version courante est affichée dans le pied de page.
- **Mode debug** : bouton « debug » du pied de page, puis « Télécharger état actuel (debug) » pour exporter l'état en JSON. Les détails Gain fixe ne sont pas inclus dans cet export.
