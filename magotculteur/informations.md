# Informations du calculateur Magoculteur
Le but de ce calculateur est double :
Pouvoir permettre de convertir des Freebets et pouvoir effectuer des mises en cash pour remplir des missions sur certains bookmakers. 
Dans tous les cas le calculateur doit générer un liste de covering set en ayant calculé la perte sur la mise totale initiale.

Pour cela il faut pouvoir te baser sur les règles de coverage. Celle-ci sont listées dans coverage-rules.json et doivent être dynamiques si l'on update le fichier.
Chaque règle de coverage contient deux informations primordiales : 
1. Le nombre d'issues requises pour couvrir completement les paris
2. Les différentes issues qui forment une même couverture.

## Lexique
Voici le lexique à utiliser dans tout le calculateur : 
- Leg : Une séléction individuelle. Un event + une issue.
- Marché : Type de pari proposé sur un match. Ex : 1X2, Double Chance, BTTS, Asian Handicap, Total Buts.
- Issue : Résultat possible dans un marché. Ex : 1, X, 2, 1X, Oui, Non, Over 2,5.
- Pari : Un pari à une mise, une cote, et au moins un leg.
    - Simple : Un pari placé sur un seul leg.
    - Combiné : Un pari placé sur deux legs d'events différents.
    - Combo : Un pari placé sur deux legs du même event et d'issue différente.
- Event : Le plus souvent, un match qui affronte deux opposants, mais peut aussi se faire affronter plus que deux opposants dans le cas de courses ou de competitions.
- Competition : Un tournoi, une ligue, une coupe ou toute autre "competition" qui fait affronter des équipes sur plusieurs events.
- Freebet : Mise offerte par un bookmaker. La mise elle-même n'est pas rendue si le pari gagne seul le gain net est versé.
- Cash : Mise en argent réel. La mise est rendue en cas de gain
- Mise : Montant placé sur un pari.
- Back : Pari classique : on mise sur la réalisation d'une issue. Si elle arrive, on gagne mise × (cote - 1).
- Lay : Pari inverse sur une plateforme d'échange (Betfair, Smarkets…) : on joue contre une issue. On encaisse une prime si elle n'arrive pas, mais on paye la liability si elle arrive.
- Liability : Sur un Lay, somme bloquée en garantie = mise × (cote brute - 1). Perdue si l'issue arrive.
- Couverture : Pari adverse placé pour neutraliser une perte potentielle sur le Back principal.
- Covering set : Ensembles de paris placés sur les différentes issues, qui, ensemble, couvre toutes les possibilités d'un event.

## Méthode de couverture
### 
### Séquentiel
Pour un ou plusieurs combiné 