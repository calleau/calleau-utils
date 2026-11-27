# URL state — Freebets combinés couverts

Format du paramètre `?s=…` que l'utilitaire écrit dans l'URL. Le même JSON (non compressé) est gardé dans le navigateur (`localStorage`, clé `fbconv_state`). Mêmes conventions que [`couv-seq`](../couv-seq/URL_STATE.md) et [`calc-couverture`](../calc-couverture/URL_STATE.md) : query param, `lz-string`, clés courtes, omission des valeurs par défaut, version obligatoire.

## Format en 30 secondes

```
https://…/fb-conv/?s=<encoded>
```

`<encoded>` = `LZString.compressToEncodedURIComponent(JSON.stringify(state))` ([`lz-string`](https://github.com/pieroxy/lz-string) v1.5).

- **Écriture** : automatique, ~400 ms après la dernière modification (`history.replaceState`, pas d'entrée dans l'historique).
- **Lecture au chargement** : l'URL, sinon `localStorage`, sinon les valeurs par défaut. Un paramètre illisible ou d'une autre version est ignoré.
- **Nombres** : natifs (`2.75`), pas de chaînes formatées.

## Schéma

### Racine

| Clé | Type | Défaut | Description |
|-----|------|--------|-------------|
| `v` | number | — (obligatoire) | Version du format. Actuellement `1`. Toute autre valeur est rejetée. |
| `n` | number | `3` | Matchs configurés (entier 2–7). |
| `k` | number | `3` | Matchs en combiné (entier 2–5, ramené à `n` au besoin). |
| `ft` | `1` | absent | Type de freebet « mise incluse » (absent = « profit seul »). |
| `g` | `1` | absent | Garanties activées. |
| `sm` | `1` | absent | Mode « Freebets réels » (absent = « Mise standard »). |
| `ss` | number | `100` | Montant de la mise standard (€). |
| `mx` | number | absent | Plafond max en mode « Freebets réels » (€). Absent = illimité. |
| `mn` | array<string> | — | Noms des matchs, par index. `""` = nom par défaut (`Match i`). Noms vides finaux rognés, tronqués à 100 caractères. |
| `t` | `"ranking"` \| `"all"` | `"plan"` | Onglet ouvert. |
| `b` | array<Site> | 5 sites par défaut | Sites **dans l'ordre de priorité**. Omis si ordre par défaut et aucun site renseigné. |
| `r` | Calc | absent | Dernier calcul. Absent = « Calculer » jamais lancé. |

### `b[i]` — un site

| Clé | Type | Défaut | Description |
|-----|------|--------|-------------|
| `i` | number | — (obligatoire) | Identifiant : `1` PMU, `2` Betclic, `3` Unibet, `4` Winamax, `5` PSEL. Inconnu ou en double → ignoré ; un site absent est ajouté en fin de liste. |
| `a` | number | absent | Freebet disponible (€). |
| `x` | `1` | absent | Site exclu. |
| `o` | array<[n1, nN, n2] \| null> | absent | Cotes 1 / N / 2 par match. `null` = match vide, valeur `null` = cote vide. Matchs vides finaux rognés. |
| `go` | array<[g1, g2] \| null> | absent | Cotes garanties 1G / 2G par match, mêmes règles. |

### `r` — dernier calcul

| Clé | Type | Défaut | Description |
|-----|------|--------|-------------|
| `s` | array<number> | absent | Sélection retenue en mode standard (indices de matchs, croissants, longueur `k`). |
| `gs` | array<number> | absent | Sélection retenue avec garanties. |
| `dm` | `1` | absent | Plan affiché : avec garanties (absent = standard). |
| `p` | array<[idx, mise, paiement, cote]> | absent | Paris marqués « Placé » : index de la combinaison dans le plan affiché, mise (€), paiement par € misé, cote. Arrondis à 4 décimales. |
| `in` | object | absent | Entrées au moment du calcul, **seulement si elles diffèrent des entrées affichées** (cotes modifiées sans recalculer). `{ n, k, ft?, b: [Site sans `a`] }`. |

Le plan n'est pas stocké : il est recalculé au chargement à partir de `r.in` (ou des entrées affichées si `r.in` est absent), en imposant les sélections `s` / `gs`. Le résultat est le même que lors du calcul, y compris après « Recalculer les mises restantes » (sélection conservée).

## Exemples

### État vide

```json
{ "v": 1 }
```

### 2 matchs sur 2, cotes Betclic et Winamax, 50 € de mise standard

```json
{
  "v": 1, "n": 2, "k": 2, "ss": 50,
  "mn": ["PSG-OM", "Lyon-Nice"],
  "b": [
    { "i": 1 },
    { "i": 2, "o": [[2.1, 3.4, 3.6], [1.9, 3.5, 4.2]] },
    { "i": 3 },
    { "i": 4, "o": [[2.05, 3.5, 3.7], [1.95, 3.4, 4.1]] },
    { "i": 5, "x": 1 }
  ]
}
```

## Snippet — produire un lien depuis un autre utilitaire

```html
<script src="https://cdn.jsdelivr.net/npm/lz-string@1.5.0/libs/lz-string.min.js"></script>
<script>
function fbConvUrl(state) {
  const encoded = LZString.compressToEncodedURIComponent(JSON.stringify({ v: 1, ...state }));
  return `../fb-conv/index.html?s=${encoded}`;
}
</script>
```

## Références

- Code : [`fb-conv.js`](fb-conv.js), section « Sauvegarde de l'état » (`encodeState`, `decodeState`, `plansFromCalc`).
