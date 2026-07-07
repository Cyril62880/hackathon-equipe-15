# Couche IA de remédiation (Node.js)

Cœur de la chaîne : **rapports de sécurité → analyse IA → Pull Request**.

```text
Trivy + Kyverno (rapports)
        │
        ▼
reportParser.js   ← normalise les findings (fichiers JSON ou API K8s)
        │
        ▼
ovhAi.js          ← OVH AI Endpoints propose un manifeste corrigé
        │
        ▼
githubPr.js       ← ouvre une PR (l'IA ne merge JAMAIS)
        │
        ▼
Revue humaine → merge → Argo CD resync → cluster corrigé
```

## Structure

| Fichier | Rôle |
| --- | --- |
| `src/reportParser.js` | Lecture/normalisation Trivy + Kyverno (fichiers ou cluster) |
| `src/ovhAi.js` | Client OVH AI Endpoints (API compatible OpenAI, SDK `openai`) |
| `src/githubPr.js` | Création branche + Pull Request via l'API GitHub (`@octokit/rest`) |
| `src/remediate.js` | Orchestrateur / CLI (`commander`) |

## Configuration (variables d'environnement)

| Variable | Rôle |
| --- | --- |
| `OVH_AI_ENDPOINTS_ACCESS_TOKEN` | Token OVH AI Endpoints |
| `OVH_AI_ENDPOINT_URL` | (option) base URL compatible OpenAI |
| `OVH_AI_MODEL` | (option) modèle, défaut `Meta-Llama-3_1-70B-Instruct` |
| `GITHUB_TOKEN` | PAT GitHub (scope `repo`) pour ouvrir la PR |

Ces secrets ne sont **jamais** en clair : ils sont injectés via External Secrets
Operator (voir `../manifest/ai-remediation/`).

## Utilisation locale (démo, sans rien pousser)

```bash
npm install
export OVH_AI_ENDPOINTS_ACCESS_TOKEN="$(cat ../ai-endpoints-key.txt)"

node src/remediate.js \
  --reports-dir ../reports/2026-07-06_15-13-10 \
  --target ../manifest/vulnerable-app/deployment.yaml \
  --focus demo-vulnerable \
  --dry-run
```

`--dry-run` affiche le manifeste corrigé proposé sans ouvrir de PR — idéal pour
la démonstration live. `--focus` recentre l'analyse sur un workload.

## Utilisation en cluster

Déployée en `CronJob` par Argo CD (voir `../manifest/ai-remediation/cronjob.yaml`),
elle lit les CRD Trivy/Kyverno en direct et ouvre la PR :

```bash
node src/remediate.js \
  --from-cluster \
  --target manifest/vulnerable-app/deployment.yaml \
  --repo Cyril62880/hackathon-equipe-15
```

## Build de l'image (durcie)

```bash
docker build -t <registry>/ai-remediation:latest .
docker push <registry>/ai-remediation:latest
```

L'image tourne en Node 20, utilisateur non-root (UID 10001), sans capabilities,
filesystem root en lecture seule — à l'opposé du workload cible volontairement
vulnérable.
