# Déploiement de la couche IA + gestion des secrets (ESO)

Ressources synchronisées par Argo CD (`apps/ai-remediation.yaml`) :

| Fichier | Rôle |
| --- | --- |
| `namespace.yaml` | Namespace `ai-remediation` en Pod Security `restricted` |
| `rbac.yaml` | ServiceAccount + ClusterRole **lecture seule** des rapports |
| `cronjob.yaml` | CronJob horaire durci (non-root, RO rootfs, drop ALL) |
| `networkpolicy.yaml` | deny-all + egress restreint (DNS / 443 / API K8s) |
| `secretstore.yaml` | ESO : namespace source + RBAC + `ClusterSecretStore` |
| `externalsecret.yaml` | Projection du secret vers `ai-remediation-secrets` |

## Gestion des secrets — External Secrets Operator

Chaîne : **secret source (hors Git) → ESO → Secret Kubernetes → CronJob**.

OVHcloud n'ayant pas de secrets-manager natif supporté par ESO, on utilise le
**provider Kubernetes** d'ESO. Le secret source vit dans le namespace verrouillé
`eso-source` et n'est **jamais commité**.

### Bootstrap (une seule fois, hors Git)

```bash
export KUBECONFIG=./kubeconfig-equipe-15.yml

kubectl create namespace eso-source --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic ai-remediation-source \
  --namespace eso-source \
  --from-literal=OVH_AI_ENDPOINTS_ACCESS_TOKEN="$(cat ai-endpoints-key.txt)" \
  --from-literal=GITHUB_TOKEN="<PAT_GitHub_scope_repo>"
```

ESO lit ensuite ce secret et crée automatiquement `ai-remediation-secrets` dans
le namespace `ai-remediation`. Rotation : il suffit de mettre à jour le secret
source, ESO resynchronise sous `refreshInterval`.

> Le token OVH AI (`ai-endpoints-key.txt`) et la kubeconfig restent **locaux** —
> voir le `.gitignore` à la racine.

## Image de la couche IA

Le `cronjob.yaml` référence `REGISTRY_PLACEHOLDER/ai-remediation:latest`.
Builder et pousser l'image (voir `../../ai-remediation/Dockerfile`), puis
remplacer le placeholder par le registry réel (Managed Private Registry OVHcloud,
GHCR, …).
