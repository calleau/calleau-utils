#!/usr/bin/env bash
# Construit le site statique déployable dans un dossier de sortie.
# Utilisé par la GitHub Action (GitHub Pages) et par le Dockerfile (utils.calleau.org).
#
#   bash scripts/build-site.sh [dossier_sortie]   (défaut : _site)
set -euo pipefail

cd "$(dirname "$0")/.."
OUT="${1:-_site}"

# Build du Magotculteur (Vite)
(cd utilitaires/magotculteur && npm ci && npm run build)

rm -rf "$OUT"
mkdir -p "$OUT"

# Copie tout le repo sauf les dossiers inutiles en prod
# utilitaires/magotculteur est exclu : il sera remplacé par le build Vite
tar -cf - \
	--exclude='./.git*' \
	--exclude='./.claude' \
	--exclude='./scripts' \
	--exclude='./debug' \
	--exclude='./Dockerfile' \
	--exclude='./.dockerignore' \
	--exclude='node_modules' \
	--exclude='./utilitaires/magotculteur' \
	--exclude="./$OUT" \
	. | tar -xf - -C "$OUT"

# Remplace utilitaires/magotculteur/ par le résultat du build Vite
cp -r utilitaires/magotculteur/dist "$OUT/utilitaires/magotculteur"

# Aplatit utilitaires/* à la racine du site
# (les URLs publiques restent /fb-conv/, /calc-couverture/, etc.)
shopt -s dotglob
mv "$OUT"/utilitaires/* "$OUT"/
rmdir "$OUT/utilitaires"

# Compense le décalage d'un niveau pour les seules ressources racine.
# Les fichiers déplacés contiennent ../../foo (depuis utilitaires/x/) ;
# après aplatissement ils sont à $OUT/x/, donc ../foo suffit.
# On utilise une whitelist pour éviter de toucher les références
# entre calculateurs frères (ex: ../welcome-bonus/welcome-bonus.css).
ROOT_RES='(theme\.css|theme-toggle\.js|homepage\.css|index\.html|versions-widget\.js|assets/)'
find "$OUT" -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' -o -name '*.mjs' \) \
	-not -path "$OUT/assets/*" \
	-print0 | \
	xargs -0 sed -i -E "s#([\"'(=])\.\./((\.\./)*${ROOT_RES})#\1\2#g"

# Retire le préfixe utilitaires/ des liens du menu de la page d'accueil
sed -i 's#href="utilitaires/#href="#g' "$OUT/index.html"

echo "Site construit dans $OUT/"
