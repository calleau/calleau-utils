# URL state — Calculatrice couverture

Format documentaire du paramètre `?s=…` que la calculatrice écrit dans l'URL. Cette page permet à d'autres utilitaires de **produire** un lien qui pré-remplit un calculateur, ou de **lire** l'état d'un lien pour l'importer.

## Format en 30 secondes

```
https://…/calc-couverture/?s=<encoded>
```

`<encoded>` = `LZString.compressToEncodedURIComponent(JSON.stringify(state))`.

- **Compression** : [`lz-string`](https://github.com/pieroxy/lz-string) v1.5, méthode `compressToEncodedURIComponent` (safe URL, pas de `%` supplémentaire à échapper).
- **Sérialisation** : `JSON.stringify` du payload décrit ci-dessous, avec **omission agressive de toutes les valeurs par défaut**.

Décodage :

```js
const params = new URLSearchParams(window.location.search);
const s = params.get('s');
const json = LZString.decompressFromEncodedURIComponent(s);
const state = JSON.parse(json);
```

Encodage :

```js
const encoded = LZString.compressToEncodedURIComponent(JSON.stringify(state));
const url = new URL(window.location);
url.searchParams.set('s', encoded);
```

## Schéma

### Racine

| Clé | Type | Défaut | Description |
|-----|------|--------|-------------|
| `v` | number | — (obligatoire) | Version du format. Actuellement `1`. Un décodeur doit rejeter tout autre valeur. |
| `g` | object | `{}` | Paramètres globaux. Omis entièrement si tous les paramètres sont à leur défaut. |
| `c` | array<Calc> | `[]` | Liste des calculateurs. Ordre = ordre d'affichage. Omis si aucun. |

### `g` — paramètres globaux

Tous les champs sont **optionnels**. La présence d'une clé signifie « non-défaut ». L'absence signifie « défaut ».

| Clé | Type | Défaut | Signification |
|-----|------|--------|---------------|
| `cm` | `1` | `0` | Commissions activées |
| `cv` | string | `"3,00"` | Valeur par défaut de commission Lay (utilisée à la création de cellules Lay). Format français (virgule). |
| `b` | `1` | `0` | Boost activé |
| `d` | `1` | `0` | Détails issues activés (affichage colonne Cote totale détaillée + profit par détail) |
| `fg` | `1` | `0` | Bouton « + Gain fixe » visible |
| `il` | `1` | `0` | Ligne d'intitulé au-dessus des issues activée |
| `ds` | `1` | `0` | Colonne « Site » par détail activée |
| `ld` | `1` | `0` | Répartition de la perte activée |
| `lv` | string | `"50"` | Coefficient de répartition en % (0-100). Format français. |

### `c[i]` — un calculateur

| Clé | Type | Défaut | Description |
|-----|------|--------|-------------|
| `n` | number | `1` | Nombre de colonnes de cotes |
| `t` | object (`Total`) | `{}` | État de la ligne Total (voir ci-dessous). Omis si tous les champs à défaut. |
| `i` | array<Issue> | `[]` | Liste des issues. Minimum implicite = 2 à la reconstruction. |

### `t` — ligne Total

| Clé | Type | Défaut | Description |
|-----|------|--------|-------------|
| `s` | string | `""` | Valeur de la mise Total. Format français (`"10,00"`). |
| `f` | `1` | `0` | Radio « Fixe » du Total cochée |
| `d` | `0` | `1` | Distribution du Total. **Défaut inversé** : on écrit `d:0` uniquement si décochée. |

### `i[k]` — une issue

| Clé | Type | Défaut | Description |
|-----|------|--------|-------------|
| `l` | string | `""` | Intitulé libre (contenteditable au-dessus de l'issue). Tronqué à 200 chars à la sérialisation. |
| `f` | `1` | `0` | Radio « Fixe » cochée sur cette issue. Au plus **une** `i[k].f=1` par calc (exclusivité radio-group). |
| `d` | `0` | `1` | Distribution cochée. **Défaut inversé** : on écrit `d:0` uniquement si décochée. |
| `dt` | array<Detail> | `[]` | Liste des détails de l'issue. Ordre = ordre DOM. |

### `dt[j]` — un détail

Trois types, discriminés par `t` :

#### Type `"b"` (Back — défaut) ou `"l"` (Lay)

| Clé | Type | Défaut | Description |
|-----|------|--------|-------------|
| `t` | `"l"` | `"b"` | Type. Omis pour Back. |
| `w` | string | `""` | Site (contenteditable). Tronqué à 200 chars. La détection de pill se fait automatiquement côté calc (substring insensible à la casse contre `KNOWN_SITES`). |
| `o` | array<string> | tous `""` | Cotes brutes par colonne (format français `"2,80"`). Longueur = `c.n`. Omis si toutes vides. |
| `m` | array<string> | tous `""` | Commissions en % par colonne. Longueur = `c.n`. Omis si toutes vides. |
| `b` | array<string> | tous `""` | Boosts en % par colonne. Longueur = `c.n`. Omis si toutes vides. |
| `s` | string | `""` | Mise (Back stake). Format français. L'engagement Lay est **dérivé** de la mise + cote — ne pas stocker. |
| `x` | `1` | `0` | Fixe-détail coché. **Omis** quand l'issue est fixée (`i[k].f=1`) car auto-dérivé. |

#### Type `"f"` (Gain fixe)

| Clé | Type | Défaut | Description |
|-----|------|--------|-------------|
| `t` | `"f"` | — (obligatoire) | Discriminant. |
| `w` | string | `""` | Site (même règle que Back/Lay). |
| `v` | string | `""` | Valeur du gain (peut être négative : `"-2,00"`). Format français. |

**Contrainte de modèle** : chaque issue doit avoir au moins un détail Back ou Lay. Un détail FG est toujours additionnel.

## Règles de sérialisation

1. **Omission des défauts** : ne jamais écrire un champ à sa valeur par défaut. Cela s'applique récursivement : un objet dont tous les champs seraient omis doit lui-même être omis.
2. **Format des nombres** : chaînes de caractères, virgule comme séparateur décimal (`"2,80"`, pas `"2.80"`). Deux décimales par convention pour les mises/cotes.
3. **Textes libres** : trimmés et tronqués à 200 chars.
4. **Arrays de cotes/commissions/boosts** : longueur = `c.n`. Si tous les éléments sont `""`, omettre l'array entier. Sinon garder tous les éléments (même vides) pour préserver l'alignement colonne.

## Exemples

Chaque exemple inclut le JSON, sa taille brute vs compressée, et une URL directement testable pointant vers l'app en prod (`https://calleau.github.io/calleau-utils/calc-couverture/index.html`).

### 1. Scaffold vide

Un calc totalement vide (aucune valeur saisie, 2 issues obligatoires) :

```json
{ "v": 1, "c": [{ "i": [{ "f": 1 }, {}] }] }
```

- Issue 1 marquée fixe (contrainte : une seule fixe par calc, on met la 1re par défaut).
- Aucun détail dans `dt` → le décodeur applique le défaut (1 détail Back vide).
- Total row vide → `t` entièrement omis.

JSON 32 chars → encodé 37 chars.

<https://calleau.github.io/calleau-utils/calc-couverture/index.html?s=N4IgbiBcCMA0IGMoG1QEsWgGZWgX1mDwF0S8g>

### 2. Calc par défaut fraîchement bootstrappé

Ce que la calc écrit toute seule au premier chargement (2 issues, cotes 2,00 pré-remplies, mise 5,00 sur issue 1) :

```json
{
  "v": 1,
  "c": [
    {
      "t": { "s": "5,00" },
      "i": [
        { "f": 1, "dt": [{ "o": ["2,00"], "s": "5,00" }] },
        { "dt": [{ "o": ["2,00"] }] }
      ]
    }
  ]
}
```

JSON 103 chars → encodé 89 chars.

<https://calleau.github.io/calleau-utils/calc-couverture/index.html?s=N4IgbiBcCMA0IGMoG1QBcqgM5RAVlgAZCQBfeASxVADMo4QATDSVEAexRACYiSBdeDkj4+ZfuVDNqHLr2IgJS0hKA>

### 3. Surebet Back/Lay simple

Deux issues, cote 2,10 Back (Unibet) contre cote 2,10 Lay (Piwix) avec 3% de commission. Toutes distribuées, issue 1 fixée :

```json
{
  "v": 1,
  "g": { "cm": 1, "ds": 1 },
  "c": [
    {
      "t": { "s": "10,00" },
      "i": [
        {
          "f": 1,
          "dt": [{ "w": "unibet", "o": ["2,10"], "s": "5,00" }]
        },
        {
          "dt": [{ "t": "l", "w": "piwix", "o": ["2,10"], "m": ["3,00"], "s": "4,90" }]
        }
      ]
    }
  ]
}
```

JSON 181 chars → encodé 170 chars.

<https://calleau.github.io/calleau-utils/calc-couverture/index.html?s=N4IgbiBcCMA0IHMqgMYFspxAEwM6YF94UoBtUAF2RH0hGgAZYGGQiQBLM0AM03mxVI5EAHcoIAK4A7DgCMAplXgB7MiABMsRiAC68WiACszVgV1FQg7iCEgANiHji6ABw6iOADycg1wzW1WfRAMAIBmUz0DCQAWWABOMwsUgiA>

### 4. Trois issues (1N2) sans commission

Un match nul possible, trois cotes de bookmakers différents. Aucune commission (toggle off), toutes distribuées :

```json
{
  "v": 1,
  "g": { "ds": 1 },
  "c": [
    {
      "t": { "s": "30,00" },
      "i": [
        { "l": "1 (domicile)", "f": 1, "dt": [{ "w": "betclic", "o": ["3,10"], "s": "10,00" }] },
        { "l": "N (nul)",              "dt": [{ "w": "winamax", "o": ["3,40"] }] },
        { "l": "2 (extérieur)",        "dt": [{ "w": "unibet",  "o": ["2,25"] }] }
      ]
    }
  ]
}
```

JSON 236 chars → encodé 228 chars.

<https://calleau.github.io/calleau-utils/calc-couverture/index.html?s=N4IgbiBcCMA0IHMqgCZTiFBndBfeAxlANqgAuyIOkIAzAAyz30j4gCWJoAZuvChUikQAdyggArgDt2AIwCmFeAHsSIAExMWAXXjUQ0Rs1axQYmgrIEANuyIq1m+gFYQuquOdbW2-KkHCgiDWIPDmIAAO7CLsAB6hIKpCGrCGbvAAtmq03r55uL5AA>

### 5. Combiné (parlay) — plusieurs colonnes de cotes

Un pari combiné à 3 sélections. `n:3` déclare 3 colonnes de cotes, chaque détail liste ses cotes par colonne :

```json
{
  "v": 1,
  "c": [
    {
      "n": 3,
      "t": { "s": "10,00" },
      "i": [
        { "f": 1, "dt": [{ "o": ["2,10", "1,80", "1,50"], "s": "10,00" }] },
        { "dt": [{ "t": "l", "o": ["2,10", "1,80", "1,50"], "m": ["3,00", "3,00", "3,00"] }] }
      ]
    }
  ]
}
```

Cote totale combinée : `2,10 × 1,80 × 1,50 = 5,67`.

JSON 174 chars → encodé 139 chars.

<https://calleau.github.io/calleau-utils/calc-couverture/index.html?s=N4IgbiBcCMA0IGMoG1QDsoGZ4BcqgGcoRoAGWU0kAX3gEsVQAzKOEAEz0lRAHsUQAJlhkQ8OAA4q42AFYqAXXhFIJcpRoLaoToxBcQAGzF8Bw0TKkm48kEpABbAdg3wX0kO7vUtv6kA>

### 6. Gain fixe positif — bonus fidélité

Une issue Back avec un bonus fidélité de 5€ garanti si l'issue passe. La couverture doit tenir compte du bonus :

```json
{
  "v": 1,
  "g": { "fg": 1 },
  "c": [
    {
      "t": { "s": "12,00" },
      "i": [
        {
          "f": 1,
          "dt": [
            { "o": ["2,00"], "s": "6,00" },
            { "t": "f", "v": "5,00" }
          ]
        },
        { "dt": [{ "t": "l", "o": ["2,20"], "m": ["3,00"] }] }
      ]
    }
  ]
}
```

JSON 159 chars → encodé 131 chars.

<https://calleau.github.io/calleau-utils/calc-couverture/index.html?s=N4IgbiBcCMA0IHMqgGZJgX3gYygbVABdkQBnKEaAJlgAZaQsQBLfVKOEAE2MgJAD2+EDXogAuvHKQQANjoMsRCihDwIMgKwLG4pd179eIADZrBwmlQaSQAW2EBmHXtcY9QA>

### 7. Gain fixe négatif — pénalité freebet

Certains bookmakers imposent une pénalité si l'issue ne passe pas ; on la modélise comme un FG négatif attaché à l'issue Lay (non-distribuée pour que son profit vise 0) :

```json
{
  "v": 1,
  "g": { "cm": 1, "fg": 1 },
  "c": [
    {
      "t": { "s": "20,88" },
      "i": [
        { "f": 1, "dt": [{ "o": ["2,80"], "s": "5,00" }] },
        {
          "d": 0,
          "dt": [
            { "t": "l", "o": ["3,20"], "m": ["3,00"], "s": "7,22" },
            { "t": "f", "v": "-2,00" }
          ]
        }
      ]
    }
  ]
}
```

JSON 184 chars → encodé 159 chars.

<https://calleau.github.io/calleau-utils/calc-couverture/index.html?s=N4IgbiBcCMA0IHMqgMYFspxAMyTAvvClANqgAuyIAzlCAEwAMsAHCyISAJamjabwAJpUhkQAe1INWjEAF14tSCACssRrPxzCoQVGYhhvECJAAbEPEmiQAZlhN58DDfsanNOgHYH9DrAo6fngIZQBaenVNbRj8IA>

### 8. Boost bookmaker

Cote 1,50 Back avec un boost bookmaker de 20% (cote nette effective = 1 + 0,50 × 1,20 = 1,60), couverte en Lay :

```json
{
  "v": 1,
  "g": { "b": 1, "cm": 1 },
  "c": [
    {
      "i": [
        {
          "f": 1,
          "dt": [{ "o": ["1,50"], "b": ["20"], "s": "10,00" }]
        },
        {
          "dt": [{ "t": "l", "o": ["1,60"], "m": ["3,00"] }]
        }
      ]
    }
  ]
}
```

JSON 138 chars → encodé 122 chars.

<https://calleau.github.io/calleau-utils/calc-couverture/index.html?s=N4IgbiBcCMA0IHMqgEZTiAxgW3QX3kygG1QBLE0AM3XgBMAXSkAexJDgFYAGEAXXhpIxEACZeAkAGcoHbrG688fAqEbMmkEABsQ8NsI6wAbBPi5DAZgUTldlUA>

### 9. Multi-détails par issue (deux bookmakers sur la même issue)

Pour spread the risk : deux Back sur des bookmakers différents pour la même issue. Le premier détail est verrouillé (`x:1`), le second flotte pour équilibrer :

```json
{
  "v": 1,
  "g": { "d": 1, "ds": 1 },
  "c": [
    {
      "t": { "s": "30,00" },
      "i": [
        {
          "f": 1,
          "dt": [
            { "w": "unibet",  "o": ["2,00"], "s": "10,00", "x": 1 },
            { "w": "betclic", "o": ["2,05"], "s": "5,00" }
          ]
        },
        { "dt": [{ "t": "l", "w": "piwix", "o": ["2,10"], "m": ["3,00"] }] }
      ]
    }
  ]
}
```

Note : `x:1` sur le premier détail est **explicite** parce que l'issue est fixée (`f:1`) — mais dans ce cas `x` est redondant (auto-dérivé) et **doit être omis** par le producteur. Le décodeur l'ignorerait aussi mais autant produire du JSON propre.

JSON 210 chars → encodé 185 chars.

<https://calleau.github.io/calleau-utils/calc-couverture/index.html?s=N4IgbiBcCMA0IHMqgCZTiFBndBfeAxlANqgAuyIOkIAzAAyz30j4gCWJoAZuvChUikQAdyggArgDt2AIwCmFeAHsSIAExMWAXXjUQ0Rs1axQYmgrIEANuyIq1m+gFYQuquOdbW2-KkHCgiDWIPDmIAAO7CLsAB6hIKpCGrCGbvAAtmq03r55uL5AA>

### 10. Répartition de la perte (loss distribution)

Interpolation entre concentration du profit (K) et équilibrage des profits totaux (S). `ld:1` active, `lv:"30"` = 30% :

```json
{
  "v": 1,
  "g": { "cm": 1, "ld": 1, "lv": "30" },
  "c": [
    {
      "i": [
        { "f": 1, "dt": [{ "o": ["2,00"], "s": "10,00" }] },
        { "dt": [{ "t": "l", "o": ["2,05"], "m": ["3,00"] }] }
      ]
    }
  ]
}
```

JSON 138 chars → encodé 121 chars.

<https://calleau.github.io/calleau-utils/calc-couverture/index.html?s=N4IgbiBcCMA0IHMqgMYFspxAGwCafmwkhAGYAGEAX3hSgG1QBLB0AMwJFwBdWQB7BiABMscpQC68AM5QQ0cmMpUJNUDz68S2EPEGR6IsQFYQUkBgNklZlXdVA>

### 11. Total fixé — partir d'une bankroll cible

Au lieu de fixer une mise sur une issue, on fixe le total investi. `t.f:1` marque le radio du Total, aucune issue n'a `f:1` :

```json
{
  "v": 1,
  "c": [
    {
      "t": { "s": "50,00", "f": 1 },
      "i": [
        { "dt": [{ "o": ["2,10"] }] },
        { "dt": [{ "o": ["2,10"] }] }
      ]
    }
  ]
}
```

JSON 93 chars → encodé 85 chars.

<https://calleau.github.io/calleau-utils/calc-couverture/index.html?s=N4IgbiBcCMA0IGMoG1QBcqgM5RAVgAZYCCR4AzKaAX3gEsVQATDSVEAexRACZZpSAXWrDYzVuy5te-ISPnCgA>

### 12. Issue non-distribuée

L'issue non-distribuée ne participe pas au partage du profit — elle sert juste à couvrir la mise. Utile pour une jambe qui ne doit "que" break-even :

```json
{
  "v": 1,
  "c": [
    {
      "i": [
        { "f": 1, "dt": [{ "o": ["3,00"], "s": "10,00" }] },
        { "d": 0, "dt": [{ "t": "l", "o": ["3,00"] }] }
      ]
    }
  ]
}
```

JSON 101 chars → encodé 91 chars.

<https://calleau.github.io/calleau-utils/calc-couverture/index.html?s=N4IgbiBcCMA0IGMoG1QEsWgGZTiAJgC6YgD2KIAzLAAw0gC68AzlCNDbfQL4Peyh8UTgWKRUIMSAA2IeOXFUujXqr5A>

### 13. Intitulés d'issue (screenshot / partage)

Toggle `il:1` active la ligne d'intitulé au-dessus de chaque issue. Utile pour annoter un screenshot :

```json
{
  "v": 1,
  "g": { "il": 1, "ds": 1 },
  "c": [
    {
      "i": [
        {
          "l": "PSG victoire (bonus 100% first bet)",
          "f": 1,
          "dt": [{ "w": "betclic", "o": ["1,85"], "s": "20,00" }]
        },
        {
          "l": "Couverture Lay Piwix",
          "dt": [{ "t": "l", "w": "piwix", "o": ["1,90"], "m": ["3,00"] }]
        }
      ]
    }
  ]
}
```

JSON 223 chars → encodé 239 chars.

<https://calleau.github.io/calleau-utils/calc-couverture/index.html?s=N4IgbiBcCMA0IHMqgJYBspxAEwM6YF94BjKAbVXNA0hAAUBlAcQAIwViAXAexQCcApiwAUAI24A7AK64W0AAzyApCwBm-XJxaiBnAJQh4qzPGycqIAO5QQOzsTQdDIbuRBwAHAFYQAXXj4tABM8rCKIAS+RNQ2AMLcUmACfJxSgiwAMgCGAJ4sdCiWKAAezmYW5rQY8Na0AA6FJc6ukGTusACc8n7wALZuAMxh3VGjkQRAA>

### 14. Plusieurs calcs sur la même page

Le format supporte nativement N calcs. Chaque `c[i]` est indépendant :

```json
{
  "v": 1,
  "c": [
    {
      "i": [
        { "f": 1, "dt": [{ "o": ["2,00"], "s": "5,00" }] },
        { "dt": [{ "t": "l", "o": ["2,00"], "m": ["3,00"] }] }
      ]
    },
    {
      "i": [
        { "f": 1, "dt": [{ "o": ["1,50"], "s": "10,00" }] },
        { "dt": [{ "t": "l", "o": ["1,55"], "m": ["3,00"] }] }
      ]
    },
    {
      "n": 2,
      "i": [
        { "f": 1, "dt": [{ "o": ["1,80", "2,10"], "s": "3,00" }] },
        { "dt": [{ "t": "l", "o": ["1,90", "2,15"], "m": ["3,00", "3,00"] }] }
      ]
    }
  ]
}
```

JSON 323 chars → encodé 215 chars.

<https://calleau.github.io/calleau-utils/calc-couverture/index.html?s=N4IgbiBcCMA0IGMoG1QEsWgGZTiAJgC6YgD2KIATLAAw0gC68AzlCAKy30C+D3soIiWKQQAGxDxykZFS6N4AWwoBmeXw390JHDHhCZoabLjt6TEK1HQa83loIjUIEeMlkKp9gpDKZINTpGez4BEAA7KGoQDEMQXTwDZ2MQOAAOenhqGx8rALtQwSdQVwkpT1gATky5aG8LP1lAmubgzT4gA>

### 15. Cas complet — tous les toggles actifs, multi-détails, FG, boost, sites, intitulés

Le "kitchen sink" pour valider un décodeur :

```json
{
  "v": 1,
  "g": {
    "cm": 1, "cv": "4,50",
    "b": 1,
    "d": 1,
    "fg": 1,
    "il": 1,
    "ds": 1,
    "ld": 1, "lv": "25"
  },
  "c": [
    {
      "n": 2,
      "t": { "s": "45,50" },
      "i": [
        {
          "l": "PSG − Marseille (combiné 2 matchs)",
          "f": 1,
          "dt": [
            { "w": "betclic", "o": ["1,85", "2,10"], "b": ["10", ""], "s": "20,00" },
            { "t": "f", "v": "3,00" }
          ]
        },
        {
          "l": "Couverture Lay",
          "d": 0,
          "dt": [
            { "t": "l", "w": "piwix", "o": ["1,95", "2,15"], "m": ["3,00", "3,00"], "s": "9,20" },
            { "t": "f", "w": "piwix", "v": "-1,50" }
          ]
        },
        {
          "l": "3e option (couverture partielle)",
          "dt": [
            { "w": "unibet",  "o": ["4,50", ""], "s": "2,50", "x": 1 },
            { "w": "winamax", "o": ["4,80", ""] }
          ]
        }
      ]
    }
  ]
}
```

Points d'attention :
- `cv:"4,50"` : override de la commission par défaut Lay (défaut = `"3,00"`).
- Cote absente sur la colonne B pour la 3e issue → `o:["4,50", ""]`. Le calcul ignore les cotes vides ; on garde l'entrée `""` pour préserver l'index colonne.
- `x:1` sur le premier détail de la 3e issue → le premier bookmaker est verrouillé, le second flotte.
- FG positif sur issue 1 (bonus) + FG négatif sur issue 2 (pénalité freebet) : les deux se combinent dans le calcul de couverture.

JSON 530 chars → encodé 462 chars.

<https://calleau.github.io/calleau-utils/calc-couverture/index.html?s=N4IgbiBcCMA0IHMqgMYFspxCikQBZYBWABhHgCNN4ATakAMyRngEsAbemgZ3vbpYh2uEACYiIAL7wUUANqgAdlFHwALshC88+IsTLSQreaE54ACgGUA4gAJASES2AsgEMATtwCmHdp9sAKFAB7NApWRQBL21FbNBc1FAALbgBKckYuDUgFEAB3KBAKTwT2Vll4IPkQOAAOCXhVaDIAXUoqpvSQVq0C0RJYEgNYUCyM+BEAZgGDZulTAoBhIIBXME83NWW3PwAZFwBPdIF+kBosnNHOeHy8AAdWXNYAD3TK7OrYAE56sVhoCW6GHeU0G6RBLXg2hAn1gfSkwxAowY6RuIHujxe4wKAFo4KQpLMEWYQBM-EFbmpWEFFAFgqt1pttrZbu5KZ52L40rRzqBUctFKwihoKlVCPj4F1Ib19OkXjA5nkCo9FC44piQG85ARYDUyBLZgbJLMgA>

## Snippet — produire une URL depuis un autre utilitaire

```html
<script src="https://cdn.jsdelivr.net/npm/lz-string@1.5.0/libs/lz-string.min.js"></script>
<script>
function calcCouvUrl(state) {
  const payload = { v: 1, ...state };
  const encoded = LZString.compressToEncodedURIComponent(JSON.stringify(payload));
  return `../calc-couverture/index.html?s=${encoded}`;
}

// Exemple : envoyer un pari Back/Lay pré-configuré
const url = calcCouvUrl({
  c: [{
    i: [
      { f: 1, dt: [{ o: ['2,80'], s: '5,00' }] },
      { dt: [{ t: 'l', o: ['3,20'], m: ['3,00'] }] }
    ]
  }]
});
window.open(url, '_blank');
</script>
```

## Snippet — lire un état depuis un autre utilitaire

```js
function readCalcCouvState(url) {
  const u = new URL(url);
  const s = u.searchParams.get('s');
  if (!s) return null;
  try {
    const json = LZString.decompressFromEncodedURIComponent(s);
    const state = JSON.parse(json);
    if (state.v !== 1) return null; // version inconnue
    return state;
  } catch (_) {
    return null;
  }
}
```

## Compatibilité

- **Versionnage** : `v` est **obligatoire**. Un décodeur qui ne connaît pas la version doit refuser (retourner `null` / fallback). Les futures évolutions de format bumperont `v`.
- **Champs inconnus** : le décodeur de référence (`applyStateFromUrl` dans [calc-couverture.js](calc-couverture.js)) ignore les clés qu'il ne connaît pas. Un producteur peut donc ajouter des champs sans casser les anciens lecteurs, mais ces champs seront perdus au prochain re-write.
- **Défauts inversés** (`d` = distribution) : attention à la logique — l'absence de la clé signifie `true`. Un producteur qui met `d:1` explicitement écrit du bruit qui sera dé-omis à la re-sérialisation.

## Sécurité

- Les textes libres (`l`, `w`) sont écrits via `.text()` (jQuery) côté calc-couverture, donc non-interprétés comme HTML. Aucun risque XSS à priori.
- La longueur max d'une URL varie selon les navigateurs (~2000 chars en pratique conservative, jusqu'à 32k en Chrome). L'omission des défauts + lz-string donne ~100-300 chars pour un usage typique, ~1000 chars pour un cas lourd (5+ calcs).

## Références

- Code de référence : [`calc-couverture.js`](calc-couverture.js) sections `serializeStateForUrl` et `applyStateFromUrl`.
- Architecture générale : [`ARCHITECTURE.md`](ARCHITECTURE.md).
- Librairie de compression : https://github.com/pieroxy/lz-string
