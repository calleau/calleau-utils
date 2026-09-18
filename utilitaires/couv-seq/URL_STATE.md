# URL state — Couverture séquentielle

Format documentaire du paramètre `?s=…` que l'utilitaire écrit dans l'URL. Cette page permet à d'autres utilitaires de **produire** un lien qui pré-remplit l'app, ou de **lire** l'état d'un lien pour l'importer.

Le format suit exactement les mêmes conventions que celui de [`calc-couverture/URL_STATE.md`](../calc-couverture/URL_STATE.md) : query param, `lz-string`, omission agressive des valeurs par défaut, version bumpable.

## Format en 30 secondes

```
https://…/couv-seq/?s=<encoded>
```

`<encoded>` = `LZString.compressToEncodedURIComponent(JSON.stringify(state))`.

- **Compression** : [`lz-string`](https://github.com/pieroxy/lz-string) v1.5, méthode `compressToEncodedURIComponent`.
- **Sérialisation** : `JSON.stringify` du payload décrit ci-dessous, avec **omission agressive de toutes les valeurs par défaut**.

Décodage / encodage minimal (JavaScript) :

```js
// Décodage
const params = new URLSearchParams(window.location.search);
const s = params.get('s');
const state = JSON.parse(LZString.decompressFromEncodedURIComponent(s));

// Encodage
const encoded = LZString.compressToEncodedURIComponent(JSON.stringify(state));
const url = new URL(window.location);
url.searchParams.set('s', encoded);
```

## Schéma

### Racine

| Clé | Type | Défaut | Description |
|-----|------|--------|-------------|
| `v` | number | — (obligatoire) | Version du format. Actuellement `1`. Un décodeur doit rejeter tout autre valeur. |
| `n` | number | `2` | Nombre de couvertures séquentielles (entier 2–8). Omis si `2`. |
| `b` | array<Bet> | `[]` | Paris placés. Omis si aucun. |
| `c` | array<Cover> | `[]` | Couvertures. Trailing empty covers (`{}`) sont rognés — la longueur reconstruite = `n`. Omis si tous à défaut. |

### `b[k]` — un pari placé

| Clé | Type | Défaut | Description |
|-----|------|--------|-------------|
| `t` | `"cash"` | `"freebet"` | Type de mise. Omis pour freebet. |
| `a` | number | `50` | Montant du pari (€). Omis si `50`. |
| `m` | `"total"` | `"individual"` | Mode d'entrée des cotes : cote combinée totale vs cotes individuelles. Omis pour individual. |
| `to` | number | `null` | Cote totale (utilisée uniquement quand `m:"total"`). Omis si `null`. |
| `o` | array<number\|null> | `[null, null]` | Cotes individuelles par match/leg. Longueur libre (1+). Omis si exactement `[null, null]`. |

Le champ `id` (utilisé côté DOM pour identifier une carte) n'est **pas** sérialisé — il est régénéré à chaque décodage.

### `c[i]` — une couverture

| Clé | Type | Défaut | Description |
|-----|------|--------|-------------|
| `s` | `"realized"` | `"pending"` | Statut de la couverture. Contrainte : dès qu'un `pending` apparaît, tous les suivants doivent l'être aussi (verrou séquentiel appliqué au load par `ensureCoversLength`). |
| `b` | number | `null` | Cote Back placée. Omis si null. |
| `l` | number | `null` | Cote Lay placée. Omis si null. |
| `m` | number | `3` | Commission Lay en % (défaut Piwi Exchange 3%). Omis si `3`. |
| `x` | number | `null` | Perte enregistrée sur cette couverture (mode "réalisé"). Omis si null. |

## Règles de sérialisation

1. **Omission des défauts** : ne jamais écrire un champ à sa valeur par défaut. Un objet Bet ou Cover qui serait vide après omission → sérialiser en `{}`.
2. **Trimming des covers** : les covers par défaut consécutifs en fin de `c` sont rognés. À la reconstruction, `ensureCoversLength()` re-pad avec des covers par défaut pour atteindre `n`.
3. **Trimming des bets** : contrairement aux covers, les bets **ne peuvent pas être vides** — un bet vide est un vrai bet dont tous les champs sont à défaut. Il reste en `{}` dans le tableau `b`.
4. **Nombres** : natifs (`2.5`, pas `"2,5"`). Différence avec calc-couverture qui utilise des strings formatées en français.

## Exemples

Chaque exemple inclut le JSON, sa taille brute vs compressée, et une URL directement testable.

### 1. State vide (par défaut)

Aucun pari, 2 couvertures vides — la calc à son état de démarrage. La sérialisation ne produit que la version, tout le reste est à défaut :

```json
{ "v": 1 }
```

JSON 7 chars → encodé 13 chars.

<https://calleau.github.io/calleau-utils/couv-seq/?s=N4IgbiBcCMC+Q>

### 2. Un freebet 100€ sur deux cotes individuelles

Un freebet simple, cotes 3,10 et 2,15 sur deux matchs :

```json
{
  "v": 1,
  "b": [
    { "a": 100, "o": [3.10, 2.15] }
  ]
}
```

JSON 38 chars → encodé 48 chars.

<https://calleau.github.io/calleau-utils/couv-seq/?s=N4IgbiBcCMA0ICMoG1QEMrQAxfgexQGYA6OAJlIFYBdAXzqA>

### 3. Bonus cash au lieu de freebet

Pari cash 30€ (type "cash" au lieu de "freebet") :

```json
{
  "v": 1,
  "b": [
    { "t": "cash", "a": 30, "o": [2.50, null] }
  ]
}
```

JSON 48 chars → encodé 68 chars.

<https://calleau.github.io/calleau-utils/couv-seq/?s=N4IgbiBcCMA0ICMoG1QBcogMYEMDOAFiPDlAMwAM8A9igEwB0ArLAHYCuANpwLoC+-IA>

### 4. Cote totale directe

Au lieu de saisir chaque cote individuelle, on donne directement la cote combinée (`m:"total"`, `to:5.5`) :

```json
{
  "v": 1,
  "b": [
    { "a": 100, "m": "total", "to": 5.5 }
  ]
}
```

JSON 44 chars → encodé 56 chars.

<https://calleau.github.io/calleau-utils/couv-seq/?s=N4IgbiBcCMA0ICMoG1QEMrQAxfgWyhABcB7ItAGxHlKgFYA6OgXwF1mg>

### 5. 4 couvertures séquentielles, deux réalisées

Nombre de couvertures poussé à 4. Les deux premières sont réalisées avec pertes enregistrées, les deux dernières restent en attente :

```json
{
  "v": 1,
  "n": 4,
  "c": [
    { "s": "realized", "b": 2.50, "l": 2.55, "x": 3.20 },
    { "s": "realized", "b": 2.10, "l": 2.15, "x": 2.50 }
  ]
}
```

Les 2 covers trailing vides (à défaut) sont omis ; `ensureCoversLength` les recrée au load pour atteindre `n:4`.

JSON 103 chars → encodé 107 chars.

<https://calleau.github.io/calleau-utils/couv-seq/?s=N4IgbiBcCMA0IDsoBZ4GMoG1QGcogCcBTAQwBsBLALyIBMR4AjKAJgDoBWeM1zrkAB5QAzGxYBfWLnzFy1OgxDNI7OCB4q20fkM0dxAXXFA>

### 6. Combiné 2 matchs avec plusieurs paris placés

Deux freebets sur des matchs différents : le premier avec cotes individuelles, le second avec cote totale directe.

```json
{
  "v": 1,
  "n": 3,
  "b": [
    { "a": 50,  "o": [2.10, 3.20] },
    { "a": 100, "m": "total", "to": 6.50 }
  ]
}
```

JSON 73 chars → encodé 83 chars.

<https://calleau.github.io/calleau-utils/couv-seq/?s=N4IgbiBcCMA0IDsoGZ4CMoG1QEMoFYAGeAeywCYA6OZS8gXQF9ZcppDiQBbKEAFxJ8cAGxDwBUAGyV8jJkA>

### 7. Un placed bet vide + toutes couvertures pending

Utile comme scaffold à pré-remplir par l'utilisateur :

```json
{
  "v": 1,
  "n": 5,
  "b": [{}]
}
```

`b:[{}]` = 1 bet à toutes valeurs par défaut. `n:5` = 5 couvertures pending vides (reconstituées par `ensureCoversLength`).

JSON 22 chars → encodé 32 chars.

<https://calleau.github.io/calleau-utils/couv-seq/?s=N4IgbiBcCMA0IDsoFZ4CMoG1gF8C6OQA>

### 8. Kitchen sink — tous les cas exercés

3 paris placés (freebet + cash + freebet-total), 6 couvertures dont 3 réalisées avec pertes et commissions non-standards :

```json
{
  "v": 1,
  "n": 6,
  "b": [
    { "a": 100, "o": [3.10, 2.15] },
    { "t": "cash", "a": 25, "o": [1.85, 1.95, 2.10] },
    { "a": 200, "m": "total", "to": 8.75 }
  ],
  "c": [
    { "s": "realized", "b": 3.05, "l": 3.10, "m": 2.5, "x": 4.50 },
    { "s": "realized", "b": 2.10, "l": 2.15, "x": 5.20 },
    { "s": "realized", "b": 1.85, "l": 1.90, "m": 4,   "x": 2.10 },
    { "b": 2.50, "l": 2.55 },
    { "b": 3.00 },
    {}
  ]
}
```

Le dernier cover `{}` est omis à la sérialisation (trailing empty). `ensureCoversLength` restaure la longueur `n:6` au load.

JSON 289 chars → encodé 242 chars.

<https://calleau.github.io/calleau-utils/couv-seq/?s=N4IgbiBcCMA0IDsoDZ4CMoG1QEMrQAYD4B7LAZgDo4AmagVgF0BfWUAFyhAGMcBnABYh4eSDXqks0SgA4J0gJwS60FmxCiaReAFsu7EuxwAbYSANQZlAOz1mjeNyyg+XAE4BTEwEsAXh4ATMwxIKgIJEFNQ6l0oOgiADygAFko7dVdIEE8ffyD0OJjIwuhEqHpKGlYXdy9jP0Dg-FkIqMVYyGT4JLFqapAQ+Pgo+PTQEPJ7ZiA>

## Snippet — produire une URL depuis un autre utilitaire

```html
<script src="https://cdn.jsdelivr.net/npm/lz-string@1.5.0/libs/lz-string.min.js"></script>
<script>
function couvSeqUrl(state) {
  const payload = { v: 1, ...state };
  const encoded = LZString.compressToEncodedURIComponent(JSON.stringify(payload));
  return `../couv-seq/index.html?s=${encoded}`;
}

// Exemple : envoyer un scaffold avec un freebet 50€
const url = couvSeqUrl({
  n: 3,
  b: [{ o: [2.5, 3.0] }]
});
window.open(url, '_blank');
</script>
```

## Snippet — lire un état depuis un autre utilitaire

```js
function readCouvSeqState(url) {
  const u = new URL(url);
  const s = u.searchParams.get('s');
  if (!s) return null;
  try {
    const json = LZString.decompressFromEncodedURIComponent(s);
    const state = JSON.parse(json);
    if (state.v !== 1) return null;
    return state;
  } catch (_) {
    return null;
  }
}
```

## Compatibilité

- **Versionnage** : `v` est **obligatoire**. Un décodeur qui ne connaît pas la version doit refuser (retourner `null` / fallback silencieux).
- **Ancien format hash `#s=`** : les URLs qui utilisaient l'ancien encodage (`#s=<JSON URL-encodé>`, sans compression) ne sont plus lues par la version actuelle. Elles retomberont sur l'état localStorage / défaut.
- **Séquence des covers** : la contrainte « dès qu'un cover est `pending`, tous les suivants doivent l'être » est appliquée par `ensureCoversLength()` au chargement. Un état URL qui violerait cette contrainte sera silencieusement corrigé (les covers après le premier pending seront forcés à pending).

## Références

- Code de référence : [`couv-seq.js`](couv-seq.js), section « URL state sync » en tête de fichier.
- Format sœur : [`../calc-couverture/URL_STATE.md`](../calc-couverture/URL_STATE.md) — mêmes conventions générales (versionnage, omission des défauts, compression, sync auto).
- Librairie de compression : https://github.com/pieroxy/lz-string
