# =============================================================================
#  Image de la couche IA de remédiation — DURCIE (à l'inverse du workload cible).
#  Build multi-stage, utilisateur non-root, dépendances de production seulement.
# =============================================================================

FROM node:20-slim AS build
WORKDIR /app
COPY package.json ./
# Pas de lockfile committé : npm install en prod-only.
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-slim AS runtime

# Utilisateur non-privilégié dédié.
RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --home /home/app --create-home app

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/

ENV NODE_ENV=production

USER 10001:10001

ENTRYPOINT ["node", "src/remediate.js"]
