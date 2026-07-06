# Image vulnérable custom (option « build ta propre image »)

Deux façons d'alimenter la chaîne d'audit :

## Option A — image publique (par défaut, zéro build)

Le déploiement (`../deployment.yaml`) utilise déjà **`vulnerables/web-dvwa:latest`** :
application délibérément vulnérable, autonome (Apache + PHP + MySQL embarqués),
base ancienne → rapport Trivy très riche, secrets, et tag `latest` qui déclenche
la policy Kyverno `disallow-latest`. Rien à builder.

## Option B — image custom (ce Dockerfile)

Plus de contrôle sur la surface d'analyse (CVE OS + libs Node + secrets baked-in).

```bash
# 1. Build
docker build -t <registry>/vulnerable-demo-app:latest manifest/vulnerable-app/build

# 2. Push vers un registry accessible par le cluster
#    (Managed Private Registry OVHcloud, GHCR, Docker Hub, ...)
docker push <registry>/vulnerable-demo-app:latest

# 3. Remplacer l'image dans ../deployment.yaml
#    image: <registry>/vulnerable-demo-app:latest
```

Le trivy-operator scanne automatiquement le nouveau workload dès qu'Argo CD
l'a synchronisé.
