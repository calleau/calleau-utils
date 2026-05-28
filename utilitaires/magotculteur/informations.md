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
    - Séléction : Un leg qui fait parti d'un combiné.
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
- Perte : {Mise totale du covering set} - {Gain}
- Gain : Correspond pour un pari à {Cote} * {Mise}. Aussi appelé profit brut.
- Profit brut : Correspond au Gain.
- Profit net : Correspond pour un pari à {Gain} - {Mise}.

### Type de paris
Dans un covering set il peut y avoir deux types de paris, les paris principaux et les paris de couvertures.
Un pari principal est un pari qui remplis le but principal recherché (placer un pari en freebets ou remplir une mission)
Un pari de couverture est un pari qui permet d'équilibrer les pertes mais qui ne remplissent pas directement le but principal. Par ex :
- Dans un pari pour convertir des freebets sans missions, c'est un pari en Cash, puisqu'il ne place pas directement des freebets, mais couvre les issues
- Dans un pari pour réaliser une mission, c'est un pari qui ne réalisera pas direcement la mission
    - Pour une mission de mise, un pari hors du site en question
    - Pour une mission de gagner, un pari qui est sur un autre site simplement pour couvrir les issues et qui remboursera la mise initiale si elle ne se réalise pas.

## Paramètres
Les paramètres sont visiuellement divisés en trois parties distincts.
1. Données JSON
2. Type de mise
3. Sites
4. Calculateur

### Données JSON
Permet d'insérer les données JSON.
Contient un grand text area qui contient le JSON et un bouton "Coller" qui colle automatiquement le contenu de notre presse-papié dans le texte area.

### Type de mise
Selecteur (radio-group boutons)
"Freebet" ou "Cash"
Chaque bouton doit être de sa couleur.

### Sites
Les paramètres de sites ont deux modes. Un mode simple et un mode avancé.
Par défaut on se trouve dans le mode simple et une checkbox permet de cocher ou non le mode avancé.
Si l'on séléctionne le mode avancé, les paramètres du mode simple ne sont plus visibles, mais les valeurs séléctionnées doivent toujours être stockées pour pouvoir les réafficher si la mode avancé est décoché.

#### Mode simple
Dans le mode simple il n'y a que les paramètres suivants. Ces paramètres n'apparaissent que dans le mode simple et sont remplacés si le mode avancé est activé.
- "Site principal"
- "Montant misé"
- "Objectif"
- "Cote minimum"
- "Cote minimum par séléction"

##### Site principal
Selecteur (radio-group boutons)
Contient tous les sites présents dans le JSON.

##### Montant misé
Selecteur (radio-group boutons)
Quatres options "Mise totale", "Mise minimale par pari", "Profit net minimum" ou "Profit brut"

###### Mise totale
Si le type de mise est Freebet, l'option s'appelle alors "Mise fb totale" et corresponds au montant totale de tout les paris en Freebet qui doivent être placé, cela ne doit pas prendre en compte les mises en Cash.
Si le type de mise est Cash, l'option s'appelle alors "Mise totale" et corresponds au montant totale de toutes les mises (liability inclus) qui doivent être placé.

###### Mise minimale par pari
Si le type de mise est Freebet, l'option s'appelle alors "Mise fb minimale par pari" et corresponds au montant minimum de la mise de chaque pari en freebet d'un covering set placé sur le site principal séléctionné, les paris en Cash n'ont pas besoin de respecter ce critère.
Si le type de mise est Cash, l'option s'appelle alors "Mise minimale par pari" et corresponds au montant minimum de la mise de chaque pari d'un covering set placé sur le site principal séléctionné.

###### Profit net minimum
Le profit net (gain - mise) minimum de tous les paris d'un covering set placé sur le site principal doit alors être du montant indiqué.

###### Profit brut
Le profit brut (gain d'un pari) de tous les paris d'un covering set placé sur le site principal doit alors être du montant indiqué.

##### Objectif
Si type de mise est Cash, sinon si c'est Freebet le paramètre n'est pas disponible.
Selecteur (radio-group boutons)
Trois options "Gagner", "Miser" ou "Perdre"
Corresponds à l'objectif principal du covering set.

###### Gagner
Indique que dans un covering set, tous les paris qui sont placés hors du site principal doivent rembourser la mise totale placée. La perte doit seulement être sur les paris du site principal.

###### Miser
Indique que la perte doit être équilibrée entre tous les paris placés, qu'ils soient sur le site principal ou non.

###### Perde
Indique que dans un covering set, tous les paris qui sont placés sur le site principal doivent rembourser la mise totale placée. La perte doit seulement être sur les paris placés hors du site principal.

##### Cote minimum
Corresponds à la côte minimum des paris qui sont placé sur le site principal.

##### Cote minimum par séléction
Corresponds à la côte minimum par séléction des paris qui sont placé sur le site principal.


#### Mode avancé
Dans le mode avancé, les paramètres sont liés spécifiquement aux différents sites qui sont présents dans le JSON.
Pour chaque site les paramètres suivants sont disponibles.
En mode Freebet les paramètres suivants sont accessibles : 
- Freebet disponible
- Priorité d'utilisation des freebets
- Ajouter une mission

En mode Cash les paramètres suivants sont accessibles : 
- Ajouter une mission

##### Freebet disponible
Si type de mise est Freebet, sinon si c'est Cash le paramètre n'est pas disponible.
Corresponds au montant des freebets disponible par l'utilisateur sur le site en question.

##### Priorité d'utilisation des freebets
Si type de mise est Freebet, sinon si c'est Cash le paramètre n'est pas disponible.
Trois valeurs peuvent être séléctionnées ici
"1-Tout utiliser", indique que le montant de la cagnotte doit être totatelement utilisé (à 2% près du maximum) dans tous les covering sets proposés.
"2-Pour compléter", indique que le montant de cette cagnotte peut-etre utilisé si besoin pour compléter les covering sets proposés.
"3-Ne pas utiliser", indique qu'aucun pari en freebet ne doit être proposé pour ce site. Fait fonctionnelement la même chose que d'avoir le montant de "Freebet disponible" du site à 0.

Ainsi si plusieurs sites sont en priorité 1, il faut proposer des covering set qui utilise l'entiereté de la cagnotte des deux sites.
Par exemple pour 
Site A : 10€ freebet · priorité 1
Site B : 15€ freebet · priorité 1
Site C : 25€ freebet · priorité 2
Il faudra ne proposer que : 
- un (ou plusieurs) paris freebet sur A totalisant au minimum 9,8€ et s'approchant au maximum de 10€
- un (ou plusieurs) paris freebet sur B totalisant au minimum 14,7€ et s'approchant au maximum de 15€
- pour couvir le reste des paris cash de nimporte quel site OU des paris freebet du site C

##### Ajouter une mission
Pour chaque site, il est possible d'ajouter une (ou plusieurs) missions qui doivent être réalisées sur ce site.
Une mission ne peut toujours être fait que en Cash, mais une mission peut quand même être ajoutée sur une conversion de freebet pour essayer d'être réalisée en même temps que la conversion.
Quand on ajoute une mission pour un site les paramètres suivants sont remplissables : 
- Montant misé
- Objectif
- Cote minimum
- Cote minimum par séléction
- Nb de combinés minimum

##### Importance
Selecteur (radio-group boutons)
Chaque mission peut avoir deux niveaux d'importance :
"Obligatoire" et "Optionnelle"

###### Obligatoire
Indique que la mission doit forcément être prise en compte dans les calculs.
Si la mission n'est pas faisable dans le covering set alors il ne sera pas proposé

###### Optionnelle
Indique que qu'un covering set peut tout de même être proposé, même si il ne remplis pas la condition de la mission.

##### Montant misé
Selecteur (radio-group boutons)
Trois options "Mise minimale par pari", "Profit net minimum" ou "Profit brut"

###### Mise minimale par pari
Corresponds au montant minimum de la mise de chaque pari d'un covering set placé sur le site en question.
Si la mise n'est pas indiqué pour un site 

###### Profit net minimum
Le profit net (gain - mise) minimum de tous les paris d'un covering set placé sur le site en question doit alors être du montant indiqué.

###### Profit brut
Le profit brut (gain d'un pari) de tous les paris d'un covering set placé sur le site en question doit alors être du montant indiqué.

##### Objectif
Si type de mise est Cash, sinon si c'est Freebet le paramètre n'est pas disponible.
Selecteur (radio-group boutons)
Trois options "Gagner", "Miser" ou "Perdre"
Corresponds à l'objectif principal du covering set.

###### Gagner
Indique que dans un covering set, tous les paris qui sont placés hors du site en question doivent rembourser la mise totale placée (à moins d'être lié à une autre mission). La perte doit seulement être sur les paris du site principal.

###### Miser
Indique que la perte doit être équilibrée entre tous les paris placés, qu'ils soient sur le site principal ou non.

###### Perde
Indique que dans un covering set, tous les paris qui sont placés sur le site principal doivent rembourser la mise totale placée. La perte doit seulement être sur les paris placés hors du site principal.

##### Cote minimum
Corresponds à la côte minimum des paris qui sont placé sur le site principal.

##### Cote minimum par séléction
Corresponds à la côte minimum par séléction des paris qui sont placé sur le site principal.

##### Nb de combinés minimum
Selecteur (radio-group boutons)
Options 1, 2, 3, + (appuyer sur plus affiche 3 chiffres de plus (4, 5, 6, +) et un autre plus). Une seule séléction possible.
Pour séléctionner le nombre de combinés minimum qui doivent être réalisés dans le cadre de cette mission.
Si la mission est obligatoire, tous les covering set proposés doivent avoir au moins un des paris qui respecte ce nombre.

### Paramètres généraux
#### Nombre de combinés à calculer
Selecteur (radio-group boutons)
Options 1, 2, 3, 4, 5.
On peut séléctionner chaque nombre individuellement (donc faire des combinaison tels que 1 et 5 ou 2,3,4)
Warning sur le 4 et 5 qui indiquent que si il y a une grosse d'events et de sites inclus dans la données, ça peut prendre énormement de temps à calculer.

#### Méthodes de placement
Des checkboxes indépendantes qui permettent d'activer/désactiver le calcul de certaines méthodes de placement.
- "Séquentiel" "Simultané"
- "Uni-site" "Multi-sites"
- "Symétrique" "Asym. léger" "Asymétrique"

Quand "Nb combinés à calculer" ne contient que la valeur 1, les méthodes "Séquentiel/Simultané" et "Symétrique/Asym. léger/Asymétrique" sont automatiquement désactivées (grisées) et forcées à "Simult. + Sym." uniquement, les valeurs précédemment cochées sont restaurées dès qu'une autre valeur est ajoutée dans "Nb combinés à calculer".

## Méthode de placement
### Timing
#### Séquentiel
Possible seulement si le covering set contient au moins un combiné sur au moins deux events. Les couvertures du combiné sont alors placées séparément, dans l'ordre chronologique. Ces couvertures peuvent être un simple pari opposé comme un autre combiné ou un plusieurs paris. La principal différence avec le simultané est que les paris de couverture suivant ne sont placés que si la permiere couverture est perdante et que donc une partie du combiné est gagnant.
Cette méthode est le plus souvent utile pour placer des couvertures sur des sites ne permettant pas de placer des combinés (site d'exchanges par exemple). Mais elle doit tout de même être proposée pour des sites classiques.
Le calculateur permet alors de calculer à l'avance toutes les paris et leurs mises qui seront à placer. Le profit de tous les paris doit être égal (à moins d'indication contraire dans les missions).

#### Simultané
Tous les paris du covering set sont placés au même moment.

### Sites
Lors du placement des paris les sites peuvent avoir deux niveaux d'importance :
Obligatoire et Secondaire.

##### Obligatoire
Les sites Obligatoire sont les sites qui répondent aux critères suivants, tous les autres sont alors considérés comme secondaires.
- Mode simple
    - Si un site principal est séléctionné, il est considéré comme Obligatoire.
- Mode avancé
    - Freebet
        - Si un ou plusieurs sites on une priorité freebet de 1, ce sont les Obligatoires
        - Tous les sites ayant une mission Obligatoire sont également considérés comme Obligatoires
    - Cash
        - Tous les sites ayant une mission Obligatoire sont considérés comme Obligatoires

#### Placement par site
##### Uni-site
Tous les paris du covering set sont placés sur le même site.
Pour calculer ce type de placement il faut suivre les règles suivantes : 
- 0 site obligatoire --> calculer pour tous les sites secondaires
- 1 site obligatoire --> calculer pour le site obligatoire
- 2 sites obligatoires --> ne pas calculer

#### Multi-sites
Les paris du covering set sont placés sur au moins deux sites différents. Il doit toujours y avoir au moins un pari sur chaque site considérés comme obligatoires.

### Symetrie
La symétrie d'un convering set n'est prise en compte seulement s'il contient au moins un combiné sur au moins deux events. La symetrie va correspondre au fait d'avoir ou non les paris du deuxieme event, de la même façon pour chaque séléction du premier event

#### Covering set symetrique
Exemple de covering symétrique pour deux matchs en 1X2
M1 1 M2 1
M1 1 M2 X
M1 1 M2 2
M1 X M2 1
M1 X M2 X
M1 X M2 2
M1 2 M2 1
M1 2 M2 X
M1 2 M2 2

#### Covering set asymétrique
Si une couverture asymétrique ne remplis pas les conditions pour une mission (ex 3 combinés sur chaque paris), elle ne doit simplement pas être calculées.
Exemple de covering asymétrique pour deux matchs en 1X2
M1 1 M2 1
M1 1 M2 X
M1 1 M2 2
M1 X M2 1X
M1 X M2 2
M1 2

#### Covering set asymétrique léger
Un cas intermédiaire entre symétrique et asymétrique. Pour chaque combiné, un event est considéré comme "ancre" (MF) : un sous-ensemble de ses issues est placé côté combiné (en produit cartésien symétrique avec les autres events), les issues restantes de l'ancre sont couvertes en simples. Le calculateur itère sur chaque event possible comme ancre, chaque market de l'ancre et chaque sous-ensemble K ∈ [1, k-1] de ses issues.

Exemple (3 events, M1 2 issues, M2 3 issues, M3 2 issues, ancre = M1, K=1) :
M1 1 • M2 1 • M3 1X
M1 1 • M2 1 • M3 2
M1 1 • M2 X • M3 1X
M1 1 • M2 X • M3 2
M1 1 • M2 2 • M3 1X
M1 1 • M2 2 • M3 2
M1 X2

Exemple (3 events, M1 3 issues, M2 2 issues, M3 2 issues, ancre = M1, K=1) :
M1 1 • M2 BTTS Oui • M3 1X
M1 1 • M2 BTTS Oui • M3 2
M1 1 • M2 BTTS Non • M3 1X
M1 1 • M2 BTTS Non • M3 2
M1 X
M1 2

Seule la méthode Simultané produit des résultats asymétriques légers (incompatible avec le paradigme séquentiel qui repose sur un unique pari principal). Pour contenir la combinatoire, le calculateur ne retient que les top 20 variantes les plus prometteuses par combinaison d'events, classées par un score rapide basé sur les meilleures cotes disponibles par site.

### Exemples
Pour les multi-sites les sites de chaque pari est précisé via les indications :
- SP (Site principal)
- S1 (Site optionnel 1)
- S2 (Site optionnel 2)

#### Séquentiel • Uni • Sym
##### 1 event
Séquentiel impossible pour 1 seul event

##### 2 events combinés
Exemple 1 - 2 events (M1 3 issues; M2 3 issues)
M1 A • M2 A
M1 B
M1 C
Seq 1 - M2 B
Seq 1 - M2 C

Exemple 2 - 2 events (M1 3 issues; M2 3 issues)
M1 A • M2 A
M1 A • M2 B
M1 B
M1 C
Seq 1 - M2 C

Exemple 3 - 2 events (M1 3 issues; M2 3 issues)
M1 A • M2 A
M1 B • M2 A
M1 C
Seq 1 - M2 B
Seq 1 - M2 C

Exemple 4 - 2 events (M1 2 issues; M2 3 issues)
M1 A • M2 A
M1 A • M2 B
M1 B
Seq 1 - M2 C

Exemple 5 - 2 events (M1 2 issues; M2 3 issues)
M1 A • M2 A
M1 B
Seq 1 - M2 B
Seq 1 - M2 C

Exemple 6 - 2 events (M1 2 issues; M2 2 issues)
M1 A • M2 A
M1 B
Seq 1 - M2 B

##### 3 events combinés
Exemple 1 - 2 events (M1 3 issues; M2 3 issues; M3 3 issues)
M1 A • M2 A • M3 A
M1 B
M1 C
Seq 1 - M2 B
Seq 1 - M2 C

Exemple 2 - 2 events (M1 3 issues; M2 3 issues)
M1 A • M2 A
M1 A • M2 B
M1 B
M1 C
Seq 1 - M2 C

Exemple 3 - 2 events (M1 3 issues; M2 3 issues)
M1 A • M2 A
M1 B • M2 A
M1 C
Seq 1 - M2 B
Seq 1 - M2 C

Exemple 4 - 2 events (M1 2 issues; M2 3 issues)
M1 A • M2 A
M1 A • M2 B
M1 B
Seq 1 - M2 C

Exemple 5 - 2 events (M1 2 issues; M2 3 issues)
M1 A • M2 A
M1 B
Seq 1 - M2 B
Seq 1 - M2 C

Exemple 6 - 2 events (M1 2 issues; M2 2 issues)
M1 A • M2 A
M1 B
Seq 1 - M2 B

#### Séquentiel • Uni • Asym. léger
##### 1 event
Séquentiel impossible pour 1 seul event

##### 2 events combinés
##### 3 events combinés

#### Séquentiel • Uni • Asym
##### 1 event
Séquentiel impossible pour 1 seul event

##### 2 events combinés
##### 3 events combinés

#### Séquentiel • Multi • Sym
##### 1 event
Séquentiel impossible pour 1 seul event

##### 2 events combinés
##### 3 events combinés

#### Séquentiel • Multi • Asym. léger
##### 1 event
Séquentiel impossible pour 1 seul event

##### 2 events combinés
##### 3 events combinés

#### Séquentiel • Multi • Asym
##### 1 event
Séquentiel impossible pour 1 seul event

##### 2 events combinés
##### 3 events combinés

#### Simultané • Uni • Sym
##### 1 event
##### 2 events combinés
##### 3 events combinés

#### Simultané • Uni • Asym. léger
##### 1 event
##### 2 events combinés
##### 3 events combinés

#### Simultané • Uni • Asym
##### 1 event
##### 2 events combinés
##### 3 events combinés

#### Simultané • Multi • Sym
##### 1 event
##### 2 events combinés
##### 3 events combinés

#### Simultané • Multi • Asym. léger
##### 1 event
##### 2 events combinés
##### 3 events combinés

#### Simultané • Multi • Asym
##### 1 event
##### 2 events combinés
##### 3 events combinés


## Résultats
L'affichage des résultats doit se faire dans un tableau dont chaque ligne contient un covering set. Il est possible d'ouvrir le détail d'une ligne pour voir les différents paris qui sont placés pour ce covering set.

Pour chaque ligne il faut afficher les informations suivantes : 
- Méthodes
- Nb event(s)
- Date event(s)
- Event(s)
- Marché(s)
- Nb paris
- Cash engagé
- Cotes
- Résultat
- Taux

### Méthodes
Contient les différentes méthodes utilisées pour ce covering set.

### Nb event(s)
Contient le nb d'events distincts qui sont utilisés dans ce covering set

### Date event(s)
Pour chaque ligne d'events, affiche la date de l'event en question

### Event(s)
Pour chaque event dans le covering set affiche une ligne avec le nom de l'event

### Marché(s)
Pour chaque ligne d'events, affiche les marchés qui sont utilisés

### Nb paris
Affiche le nombre de paris au total utilisés pour ce covering set

### Cash engagé
Affiche le total de cash engagé (liability comprise) pour ce covering set

### Cotes
Affiche la plus petite et la plus grande cote des paris utilisés dans ce covering set

### Résultat
Affiche en € la perte totale du covering set

### Taux
Affiche le TRJ du covering set

### Filtres par colonne
Chaque colonne du tableau de résultats propose un filtre. Le filtre "Méthode" propose notamment les combinaisons :
- Séq. · Uni · Sym.
- Séq. · Multi · Sym.
- Simult. · Uni · Sym.
- Simult. · Multi · Sym.
- Simult. · Uni · Asym. lég.
- Simult. · Multi · Asym. lég.
- Simult. · Uni · Asym.
- Simult. · Multi · Asym.

## Architecture technique
### Moteur de calcul
Le moteur est exécuté dans un pool de Web Workers (un par cœur CPU, jusqu'à 8) pour paralléliser les calculs. Chaque worker reçoit un shard `{ index, count }` et ne traite que les combinaisons d'events où `counter % count === index`. Les résultats de chaque worker sont agrégés et triés par profit sur le thread principal.

### Missions et filtres
- Le filtre global "Cote min. par sélection" ne s'applique qu'aux combinés (≥ 2 legs), pas aux paris simples.
- Chaque mission peut définir ses propres `coteMin` et `coteMinParSelection` ; `coteMinParSelection` est vérifiée sur chaque leg individuel des paris combinés côté site de la mission.