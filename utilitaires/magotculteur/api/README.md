# API du Magotculteur

Le moteur de l'interface (`src/engine.ts`) servi en HTTP, pour des appels automatiques (Cotorico). Même code que l'interface : un push sur `calleau-utils` met à jour les deux.

- **Service interne** : pas de domaine public. On l'appelle par le réseau Docker `coolify`.
- **Sans état** : chaque appel reçoit les cotes et les réglages, et renvoie les résultats.
- **Version** : celle de l'interface (`public/versions.js`), renvoyée par chaque réponse.

## Appels

### `GET /health`

```json
{ "ok": true, "version": "v6.7.0", "coverageRules": 27 }
```

### `POST /compute`

Corps JSON. **Un fichier de debug de l'interface (bouton « bug ») peut être envoyé tel quel** et redonne les résultats de l'interface.

| Champ | Requis | Description |
|---|---|---|
| `engineOpts` | oui | Réglages du moteur, comme dans un fichier de debug : `sites` (missions, freebets), `betType`, `allowedNLegs`, `amountMode`, `amount`, méthodes… Facultatif en Cash : `amountConstraints` (`[{ mode, amount, site? }]`), plusieurs contraintes de montant toutes respectées, la plus exigeante fixe les mises (mode avancé de l'interface) ; absent, `amountMode` / `amount` s'appliquent. Facultatif : `seqTiming`, durées des matchs pour le séquentiel (format de `assets/sport-durations.json`) ; absent, celles du dépôt. `coteMin` / `coteMax` : cotes minimale et maximale des paris placés sur le site principal (site du freebet en priorité 1 ou de la mission obligatoire ; cote combinée pour un combiné ; couvertures libres ; en simultané comme en séquentiel), absente ou `0` = pas de limite (`coteMax` est facultative). |
| `data` | oui | Cotes au format Betxtractor (export de l'extension collé dans l'interface). |
| `coverageRules` | non | Règles de couverture. Voir l'ordre ci-dessous. |
| `limit` | non | Nombre de résultats renvoyés, les meilleurs d'abord. Défaut : `50`. |
| `minProfit` | non | Ne renvoie que les résultats dont le profit (€, négatif = perte) est au moins égal. |
| `linksBaseUrl` | non | Racine des utilitaires pour les liens. Défaut : variable `LINKS_BASE_URL`. |

**Règles de couverture utilisées**, dans cet ordre : `coverageRules` de la requête, sinon `engineOpts.coverageRules`, sinon le `coverage-rules.json` du dépôt. Pour profiter automatiquement des règles à jour, **ne pas envoyer de règles** (et retirer `engineOpts.coverageRules` si les réglages viennent d'un fichier de debug).

Réponse :

```json
{
  "version": "v6.7.0",
  "durationMs": 812,
  "workers": 4,
  "total": 1258,
  "results": [
    {
      "timing": "simult", "placement": "uni", "symmetry": "asym-light",
      "eventKeys": ["…"], "nMatches": 2, "profit": -2.1, "rate": 0.9012, "totalCash": 21.25,
      "bets": [{ "legs": [...], "site": "Betclic", "odds": 3.53, "stake": 5.42, "betType": "cash", "role": "principal" }],
      "links": {
        "calcCouverture": "https://utils.calleau.org/calc-couverture/index.html?s=…",
        "couvSeq": "https://utils.calleau.org/couv-seq/index.html?s=…"
      }
    }
  ]
}
```

- Freebet avec plusieurs sites en priorité 1 (`freebetPriority: 1`) : chaque freebet est joué en entier, quel que soit `amountMode` ; une issue peut avoir plusieurs paris (freebet sur plusieurs de ces sites, complément en cash).
- `amountMode: "profit_net_min"` : le gain net (mise × (cote − 1)) de chaque pari du site principal atteint `amount`, le plus petit fixe les mises (depuis v7.7.0 ; avant, perte totale égale au montant en cash).
- `rate` : en freebet, taux de conversion = `profit` / freebets utilisés (priorité 1, et priorité 2 si des couvertures passent en freebet sur un site en priorité 2).
- `total` : nombre de résultats trouvés, avant `minProfit` et `limit`.
- `links.calcCouverture` : une colonne de cotes par match, chaque sélection dans la colonne de son match. Pour un freebet ou un pari boosté combiné sur plusieurs matchs, une dernière colonne « Freebet : mise non rendue » / « Boost +X % sur le combiné » porte, sur sa seule ligne, le coefficient qui ramène le produit des colonnes à la cote à utiliser (cote − 1 pour un freebet, cote boostée).
- `links.couvSeq` : seulement pour les couvertures séquentielles multi-matchs (comme dans l'interface).

Erreurs : `{ "error": "…" }` avec le code 400 (requête invalide), 401 (jeton), 404, 413 (corps trop gros) ou 500.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `8080` | Port d'écoute. |
| `WORKERS` | CPU disponibles (limite du conteneur comprise), 8 max | Nombre de threads de calcul. |
| `API_TOKEN` | vide | Si défini, `/compute` exige `Authorization: Bearer <jeton>`. `/health` reste libre. |
| `LINKS_BASE_URL` | `https://utils.calleau.org/` | Racine des utilitaires dans les liens. |
| `MAX_BODY_MB` | `50` | Taille maximale du corps. |
| `ASSETS_DIR` | `assets/` du dépôt (`/app/assets` dans l'image) | `coverage-rules.json`, `sites-informations.json` et `sport-durations.json`. |

Un seul calcul à la fois : les appels suivants attendent leur tour (chaque calcul occupe déjà tous les workers).

## Durée de calcul

Mesurée sur 94 matchs (Betclic, réglages du debug du 17/09), 4 workers :

| Combinés | Durée | Résultats |
|---|---|---|
| 1 à 2 matchs | ~1-2 s | 2 585 |
| 1 à 3 matchs, toutes méthodes | ~45 s | 176 408 |
| 1 à 3 matchs, sans « Asymétrique » | ~21 s | 148 633 |

Les combinés à 3 matchs font l'essentiel du temps, sans améliorer le meilleur résultat sur ces données. Seuls les 30 meilleurs matchs entrent dans les combinés.

## En local

```bash
cd utilitaires/magotculteur
npm run build:api
npm run start:api
curl -s localhost:8080/health
curl -s -X POST --data-binary @../../debug/<fichier de debug>.json localhost:8080/compute
```

Image Docker (depuis la racine du dépôt) :

```bash
cd calleau-utils
docker build -f utilitaires/magotculteur/api/Dockerfile -t magotculteur-api .
docker run --rm -p 8080:8080 magotculteur-api
```

## Déploiement Coolify

Nouvelle application, dans le même projet que `utils.calleau.org`, environnement **production** :

1. **+ Add Resource → Application**, même source GitHub que le site, dépôt `calleau-utils`, branche `main`.
2. **Build Pack** : `Dockerfile`. **Base Directory** : `/`. **Dockerfile Location** : `/utilitaires/magotculteur/api/Dockerfile`.
3. **Name** : `magotculteur-api`. **Ports Exposes** : `8080`.
4. **Domains : vide.** Supprimer le domaine généré automatiquement s'il y en a un : l'API ne doit pas être joignable depuis Internet.
5. **Watch Paths** (pour ne redéployer que si le moteur ou les règles changent) :
   ```
   utilitaires/magotculteur/src/**
   utilitaires/magotculteur/api/**
   utilitaires/magotculteur/package*.json
   utilitaires/magotculteur/public/versions.js
   assets/coverage-rules-src/**
   assets/sites-informations.json
   assets/sport-durations.json
   scripts/build-coverage-rules.mjs
   ```
6. Variables : aucune obligatoire. `API_TOKEN` en défense supplémentaire (à donner aussi à Cotorico).
7. **Deploy.** Logs attendus : `magotculteur-api v6.7.0 sur :8080 (N workers, 27 règles, liens → https://utils.calleau.org/)`.

Vérification sur le VPS :

```bash
ssh calleau
docker ps --format '{{.Names}}  {{.Status}}' | grep -i <uuid de l'app>
```
Attendu : une ligne `<uuid>-…  Up … (healthy)`.

```bash
docker inspect -f '{{json .NetworkSettings.Networks.coolify.Aliases}}' <nom du conteneur>
```
Attendu : une liste de noms. L'un d'eux (souvent l'uuid de l'app) est l'adresse stable à donner à Cotorico, `http://<alias>:8080`, car le nom du conteneur change à chaque déploiement.

```bash
docker exec <conteneur Cotorico> node -e "fetch('http://<alias>:8080/health').then(r => r.text()).then(console.log)"
```
Attendu : `{"ok":true,"version":"v6.7.0","coverageRules":27}`.
