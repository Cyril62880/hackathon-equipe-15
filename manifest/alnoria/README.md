# Alnoria GitOps

Cette application est declaree dans Argo CD par `apps/alnoria.yaml`.

## Images Docker Hub

- `kasperski777/alnoria-api:latest`
- `kasperski777/alnoria-web:latest`
- `kasperski777/alnoria-db:latest`

## Applications Argo CD creees

- `alnoria-dev` vers le namespace `dev-alnoria`
- `alnoria-acc` vers le namespace `acc-alnoria`
- `alnoria-prod` vers le namespace `prod-alnoria`

## Services Kubernetes

- `alnoria-web:80` vers le conteneur web en `3000`
- `alnoria-api:8080`
- `alnoria-db:5432`

## Test local

Apres synchronisation Argo CD :

```bash
kubectl port-forward -n dev-alnoria svc/alnoria-web 8081:80
```

Puis ouvrir :

```text
http://localhost:8081
```

Pour tester l'API directement :

```bash
kubectl port-forward -n dev-alnoria svc/alnoria-api 8080:8080
```

Puis ouvrir :

```text
http://localhost:8080
```

## Secrets

Les Secrets actuels contiennent des valeurs de demonstration pour que l'application puisse demarrer via Argo CD.
Pour un environnement durable, remplace `secret.yaml` par External Secrets ou par un Secret cree hors Git.
