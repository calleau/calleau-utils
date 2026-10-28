# API du Magotculteur (service interne, cf. api/README.md).
# Contexte de build : racine du dépôt calleau-utils.
#   docker build -f utilitaires/magotculteur/api/Dockerfile -t magotculteur-api .

FROM node:20-slim AS build
WORKDIR /src
COPY utilitaires/magotculteur/package.json utilitaires/magotculteur/package-lock.json utilitaires/magotculteur/
RUN cd utilitaires/magotculteur && npm ci --no-audit --no-fund
COPY scripts/build-coverage-rules.mjs scripts/
COPY assets/coverage-rules-src assets/coverage-rules-src
COPY assets/sites-informations.json assets/
COPY utilitaires/magotculteur utilitaires/magotculteur
RUN node scripts/build-coverage-rules.mjs \
	&& cd utilitaires/magotculteur && npm run build:api

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 ASSETS_DIR=/app/assets
COPY --from=build /src/utilitaires/magotculteur/api/dist/server.mjs ./server.mjs
COPY --from=build /src/assets/coverage-rules.json /src/assets/sites-informations.json ./assets/
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
	CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.mjs"]
