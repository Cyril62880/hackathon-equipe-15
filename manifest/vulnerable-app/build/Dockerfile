FROM node:10-stretch

LABEL org.opencontainers.image.title="vulnerable-demo-app" \
      org.opencontainers.image.description="Deliberately vulnerable app for GitOps security demo"


USER root
WORKDIR /app


RUN apt-get update && apt-get install -y --no-install-recommends \
      curl=7.52.* \
      openssl \
      git \
      netcat-traditional \
    && rm -rf /var/lib/apt/lists/*


RUN npm install --no-audit --no-fund \
      lodash@4.17.4 \
      express@4.16.0 \
      minimist@1.2.0 \
      jsonwebtoken@8.0.0 \
      axios@0.18.0


ENV AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE \
    AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY \
    DB_PASSWORD=SuperSecret123!

RUN printf 'github_pat_11ABCDEFG0000000000000_fakeTokenForDemoOnly\n' > /app/.env \
    && chmod 777 /app/.env


RUN printf '%s\n' \
  "const express = require('express');" \
  "const app = express();" \
  "app.get('/', (_, res) => res.send('vulnerable demo app'));" \
  "app.listen(80, () => console.log('listening on 80'));" \
  > /app/server.js

EXPOSE 80

CMD ["node", "/app/server.js"]
