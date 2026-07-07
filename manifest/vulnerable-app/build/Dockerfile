# =============================================================================
#  Image volontairement vulnérable pour la chaîne d'audit / remédiation GitOps.
#
#  Objectif : maximiser la surface d'analyse pour Trivy (CVE OS + libs),
#  le secret-scanning, et l'audit de configuration.
#
#  /!\ NE JAMAIS UTILISER EN PRODUCTION - image délibérément non sécurisée.
# =============================================================================

# Base ANCIENNE et GROSSE (Debian stretch, EOL) -> des centaines de CVE OS.
FROM node:10-stretch

LABEL org.opencontainers.image.title="vulnerable-demo-app" \
      org.opencontainers.image.description="Deliberately vulnerable app for GitOps security demo"

# Mauvaise pratique : on reste root pour tout le build ET le runtime.
USER root
WORKDIR /app

# Paquets système anciens / vulnérables installés volontairement.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl=7.52.* \
      openssl \
      git \
      netcat-traditional \
    && rm -rf /var/lib/apt/lists/*

# Dépendances applicatives épinglées sur des versions connues vulnérables
# (Trivy remonte les CVE des libs Node).
RUN npm install --no-audit --no-fund \
      lodash@4.17.4 \
      express@4.16.0 \
      minimist@1.2.0 \
      jsonwebtoken@8.0.0 \
      axios@0.18.0

# Mauvaise pratique : secrets en clair dans l'image (secret-scanning Trivy).
ENV AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE \
    AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY \
    DB_PASSWORD=SuperSecret123!

RUN printf 'github_pat_11ABCDEFG0000000000000_fakeTokenForDemoOnly\n' > /app/.env \
    && chmod 777 /app/.env

# Application minimale exposant un endpoint (pour Falco / démo runtime).
RUN printf '%s\n' \
  "const express = require('express');" \
  "const app = express();" \
  "app.get('/', (_, res) => res.send('vulnerable demo app'));" \
  "app.listen(80, () => console.log('listening on 80'));" \
  > /app/server.js

EXPOSE 80

# Mauvaise pratique : process root, pas de HEALTHCHECK, pas d'utilisateur dédié.
CMD ["node", "/app/server.js"]
