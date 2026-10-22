# Image de production pour utils.calleau.org (déployée par Coolify).
# 1. Node construit le site statique, 2. Nginx le sert sur le port 80.

FROM node:20-slim AS build
WORKDIR /src
COPY . .
RUN bash scripts/build-site.sh /site

FROM nginx:1.27-alpine
COPY --from=build /site /usr/share/nginx/html
EXPOSE 80
