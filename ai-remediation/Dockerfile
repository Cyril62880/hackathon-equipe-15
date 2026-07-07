
FROM node:20-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-slim AS runtime

RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --home /home/app --create-home app

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/

ENV NODE_ENV=production

USER 10001:10001

ENTRYPOINT ["node", "src/remediate.js"]
