# Architecture — Le Magotculteur

## Table des matières

1. [Stack technique](#1-stack-technique)
2. [Structure des fichiers](#2-structure-des-fichiers)
3. [Architecture des modules](#3-architecture-des-modules)
4. [Fonctionnement du calculateur](#4-fonctionnement-du-calculateur)
5. [Flux de données complet](#5-flux-de-données-complet)
6. [Lancer en local](#6-lancer-en-local)

---

## 1. Stack technique

| Outil | Rôle |
|---|---|
| **Vite 6** | Bundler / serveur de développement. Gère le TypeScript, les imports ES, et le bundle Web Worker automatiquement via le suffixe `?worker`. |
| **TypeScript 5** | Typage statique. `strict: false` pour une migration pragmatique. |
| **Web Worker** | Déplace tous les calculs dans un thread séparé afin de ne jamais bloquer l'interface pendant une computation longue. |
| **Vanilla JS/DOM** | Pas de framework UI — rendu HTML par template strings, handlers `onclick` attachés via `window.*`. |

Tout le traitement se fait **côté client** : aucune donnée n'est envoyée à un serveur.

---

## 2. Structure des fichiers

```
magotculteur/
├── index.html              # Point d'entrée HTML, handlers onclick en inline
├── magotculteur.css        # Styles de l'application
├── magotculteur.js         # ⚠ Ancien fichier JS (conservé, non utilisé en dev/build)
│
├── src/                    # Sources TypeScript
│   ├── types.ts            # Interfaces partagées entre engine, worker et app
│   ├── engine.ts           # Fonctions de calcul pures (pas de DOM)
│   ├── worker.ts           # Web Worker : orchestre les étapes de calcul
│   └── app.ts              # État, rendu, gestion du Worker, exposition window.*
│
├── vite.config.ts          # Config Vite (root, outDir, worker format ES)
├── tsconfig.json           # Config TypeScript
├── package.json            # Dépendances et scripts npm
│
└── dist/                   # Build de production (généré par `npm run build`)
    ├── index.html
    └── assets/
        ├── index-*.js      # Bundle principal (app + engine)
        ├── worker-*.js     # Bundle du Web Worker (séparé)
        └── index-*.css
```

Le fichier `../assets/coverage-rules.json` (à la racine du dépôt) est chargé au démarrage via `fetch`. Il n'est pas bundlé.

---

## 3. Architecture des modules

```
┌─────────────────────────────────────────────────────┐
│                    index.html                        │
│  onclick="tryRender()" → window.tryRender            │
└────────────────────┬────────────────────────────────┘
                     │ importe
                     ▼
┌─────────────────────────────────────────────────────┐
│                    src/app.ts                        │
│  • État global (_data, _method, _betType, …)         │
│  • Fonctions UI (setBetType, setLegs, …)             │
│  • Rendu HTML (buildTableRow, renderPage, …)         │
│  • Expose window.* pour les handlers HTML            │
│  • Gère le cycle de vie du Worker                    │
└──────────┬──────────────────────────────────────────┘
           │ new EngineWorker() via import ?worker
           │ postMessage / onmessage
           ▼
┌─────────────────────────────────────────────────────┐
│                   src/worker.ts                      │
│  (thread séparé)                                     │
│  • Reçoit { type:'compute', payload }                │
│  • Poste { type:'progress', label, pct }             │
│  • Poste { type:'result', allResults }               │
│  • Poste { type:'cancelled' }                        │
└──────────┬──────────────────────────────────────────┘
           │ importe
           ▼
┌─────────────────────────────────────────────────────┐
│                   src/engine.ts                      │
│  Fonctions pures — aucune dépendance DOM             │
│  • computeSeq(data, fbSite, amount, nLegs, betType,  │
│               opts)                                  │
│  • computeToutFB(data, amount, nMatches, betType,    │
│                  opts)                               │
│  • computeMultiSite(data, amount, nMatches, betType, │
│                     opts)                            │
│  Toutes reçoivent opts: EngineOpts (= les globales   │
│  déplacées hors du moteur)                           │
└─────────────────────────────────────────────────────┘
           │ importe
           ▼
┌─────────────────────────────────────────────────────┐
│                   src/types.ts                       │
│  Interfaces partagées :                              │
│  CoverageRule, EngineOpts, Cover, Leg, SeqResult,    │
│  ToutFBResult, WorkerInMessage, WorkerOutMessage, …  │
└─────────────────────────────────────────────────────┘
```

### EngineOpts — remplacement des globales du moteur

Toutes les variables qui influencent le calcul sont regroupées dans un objet `EngineOpts` passé en paramètre aux fonctions du moteur. Cela les rend pures et testables indépendamment.

```typescript
interface EngineOpts {
  coverageRules: CoverageRule[];   // règles de couverture chargées depuis JSON
  filterMinOdds: number;           // cote minimale globale
  minOddsPerSelection: number;     // cote minimale par sélection (combinés)
  asymCov: boolean;                // activer les couvertures asymétriques
  freebetBySite: Record<string, number>; // montants freebets par site
  cashObjective: 'miser' | 'gagner' | 'perdre';
}
```

### Protocole Worker

```
app.ts  ──► { type: 'compute', payload: WorkerComputePayload }  ──► worker.ts
app.ts  ◄── { type: 'progress', label: string, pct: number }   ◄── worker.ts
app.ts  ◄── { type: 'result',   allResults: AllResults }        ◄── worker.ts
app.ts  ──► { type: 'cancel' }  (+ worker.terminate())          ──► worker.ts
app.ts  ◄── { type: 'cancelled' }                               ◄── worker.ts
```

---

## 4. Fonctionnement du calculateur

### 4.1 Données d'entrée

L'utilisateur colle un JSON représentant les cotes disponibles. Structure attendue :

```json
{
  "<eventKey>": {
    "dateTime": "2025-06-14T15:00:00Z",
    "opponents": { "1": "PSG", "2": "OM" },
    "competition": "Ligue 1",
    "markets": {
      "1X2": {
        "1": { "betclic": 2.10, "winamax": 2.05 },
        "X": { "betclic": 3.40 },
        "2": { "betclic": 3.20 }
      },
      "Double Chance": {
        "1X": { "betclic": 1.30 },
        "X2": { "betclic": 1.45 },
        "12": { "betclic": 1.25 }
      }
    }
  }
}
```

Pour les exchanges (Betfair/Smarkets), les cotes peuvent être des objets `{ Back: { odds, odds_net }, Lay: { odds, odds_net } }`.

### 4.2 Règles de couverture (`coverage-rules.json`)

Le fichier `assets/coverage-rules.json` définit quels paris se couvrent mutuellement. Chaque règle liste des **groupes** (A, B, C) représentant des issues mutuellement exclusives et exhaustives.

```json
{
  "issues": 2,
  "A": [
    { "market": "1X2",    "issue": "1",  "betType": "Back" },
    { "market": "DC",     "issue": "X2", "betType": "Lay" }
  ],
  "B": [
    { "market": "1X2",    "issue": "1",  "betType": "Lay" },
    { "market": "DC",     "issue": "X2", "betType": "Back" }
  ]
}
```

Les marchés et issues supportent les **regex** (`"/^Total \\w+$/"`) et les **templates** (`"$1$2~+-"`) pour des règles génériques (Over/Under, Asian Handicap, etc.).

### 4.3 Les trois méthodes de calcul

#### Méthode 1 — Séquentiel (`computeSeq`)

Le freebet est joué sur un combiné de N sélections Back (même site). Chaque sélection est couverte individuellement par un Lay ou un Back adverse sur un autre site, **dans l'ordre** des matchs.

- **1 sélection** : 1 Back + 1 couverture.
- **2 ou 3 sélections** : le Back est un combiné ; chaque couverture intervient au moment de son match.

**Formule freebet (profit égal sur chaque issue) :**
```
profit = amount × (B - 1) / K
où B = cote combinée Back, K = ∏ k_i, k_i = facteur de couverture du leg i
```

Pour un Lay : `k = (lGross - c) / (1 - c)` (avec `c` = commission de l'exchange)  
Pour un Back adverse : `k = odds / (odds - 1)`

**Mode Cash :** variantes `miser` (retour égal), `gagner` (couvrir la perte), `perdre` (couvrir le gain).

#### Méthode 2 — Couverture complète (`computeToutFB`)

Tous les paris sont placés sur le **même bookmaker**, un par issue. Le profit est identique quelle que soit l'issue.

**Formule :**
```
rate = 1 / Σ(1 / (odds_i - 1))   (freebet — profit égal)
rate = 1 / Σ(1 / odds_i)          (cash — retour égal)
```

**Covering sets** : les issues possibles sont déduites des règles de couverture.  
- `getCoverSets` — issues d'une seule règle (ex : 1X2 → 1/X/2).
- `getCoverSetsExtended` — ajoute les **produits croisés** de règles indépendantes (ex : DC × BTTS → 4 issues combinées), permettant des paris multi-sélections sur le même match.

**Multi-matchs** : pour N matchs, le calcul parcourt toutes les combinaisons de N événements (top-30 par score), puis le produit cartésien des covering sets de chaque match.

**Couvertures asymétriques** (option activable) : une issue du covering set est jouée en simple, les autres sont combinées avec les issues des autres matchs. Permet des configurations où les issues n'ont pas toutes le même nombre de sélections.

#### Méthode 4 — Couverture multi-sites (`computeMultiSite`)

Identique à la méthode 2 en structure, mais chaque pari peut être placé sur un **site différent** (la meilleure cote disponible tous sites confondus). Nécessite au minimum 2 sites différents sur l'ensemble des paris.

Si des montants freebets par site sont renseignés, seuls les sites avec un freebet actif (`> 0`) sont considérés pour la sélection des cotes.

### 4.4 Déduplication multi-matchs

Pour les calculs multi-matchs (méthodes 2 et 4), un seul résultat est conservé par combinaison de matchs (`bestPerCombo`) : celui avec le meilleur taux. Cela évite que deux covering sets différents sur les mêmes matchs occupent deux lignes distinctes dans les résultats.

### 4.5 Cache des résultats

Les résultats sont mis en cache dans `_allResults` (clé `"<method>_<nLegs>"`) pour éviter de recalculer lors d'un simple changement d'onglet. Le cache est invalidé dès qu'un paramètre de calcul change (type de mise, cote min, asymCov, etc.).

### 4.6 Affichage et filtres

Les résultats sont affichés dans un tableau virtuel paginé (50 par 50). Chaque colonne dispose d'un filtre inline (numérique ou par ensemble de valeurs). Un mode "Tout" agrège tous les résultats de toutes les méthodes et permet une recherche textuelle par nom de match.

---

## 5. Flux de données complet

```
Utilisateur colle JSON
        │
        ▼
   onJsonChange()
   → parse JSON → _data
   → collectSites() → populate <select>
        │
        ▼
   Utilisateur clique "Calculer"
        │
        ▼
   tryRender() [app.ts]
   → lit les paramètres UI
   → construit EngineOpts
   → crée un nouveau Worker
   → postMessage({ type:'compute', payload })
        │
        │   (thread Worker séparé)
        ▼
   worker.ts reçoit 'compute'
   → boucle sur les étapes de calcul
   → pour chaque étape : postMessage('progress')
   → computeSeq / computeToutFB / computeMultiSite
   → postMessage({ type:'result', allResults })
        │
        │   (retour thread principal)
        ▼
   app.ts reçoit 'result'
   → _allResults = allResults
   → showCurrentResults()
   → renderResults() → renderPage()
   → buildTableRow() × N → innerHTML
        │
        ▼
   Utilisateur clique sur une ligne
   → toggleDetail() → buildDetailContent()
```

---

## 6. Lancer en local

### Prérequis

- **Node.js** ≥ 18  
- **npm** ≥ 9

### Installation (une seule fois)

```bash
cd magotculteur/
npm install
```

### Serveur de développement

```bash
cd magotculteur/
npm run dev
```
http://localhost:5173

Vite démarre sur **http://localhost:5173** par défaut. Le hot-reload est actif : toute modification d'un fichier `src/*.ts` est reflétée immédiatement sans rechargement complet de la page.

> **Important** : il faut impérativement passer par le serveur Vite (ou tout autre serveur HTTP local). Ouvrir `index.html` directement depuis le système de fichiers (`file://`) empêche le `fetch('../assets/coverage-rules.json')` de fonctionner, ce qui bloque le démarrage de l'application.

### Build de production

```bash
cd magotculteur/
npm run build
```

Les fichiers sont générés dans `dist/`. Pour les tester :

```bash
npm run preview
# → http://localhost:4173
```

### Autres commandes utiles

| Commande | Description |
|---|---|
| `npm run dev` | Serveur de développement avec HMR |
| `npm run build` | Build de production dans `dist/` |
| `npm run preview` | Serveur statique sur le dossier `dist/` |

### Tester depuis la racine du dépôt

Si vous préférez servir l'ensemble du dépôt (pour accéder à `../theme.css`, `../theme-toggle.js`, etc.) :

```bash
# Depuis la racine calleau-utils/
npx serve .
# → http://localhost:3000/magotculteur/
```

Ou avec Python :

```bash
# Depuis la racine calleau-utils/
python -m http.server 8080
# → http://localhost:8080/magotculteur/
```

> Dans ce cas, les imports TypeScript ne sont pas compilés — utiliser `npm run build` d'abord pour obtenir le `dist/`, puis servir depuis `magotculteur/dist/`.
