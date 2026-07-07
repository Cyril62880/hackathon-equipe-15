# Grafana supervision

Ce dossier est synchronise par l'application Argo CD `monitoring-dashboards`.

## Dashboards fournis

- `Kubernetes KPI Supervision` : etat des pods, redemarrages, CPU, memoire et targets Prometheus.
- `Security & GitOps Supervision` : KPI Trivy, Kyverno, Falco, Argo CD et vulnerable app.

## Acces local

```bash
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80
```

Puis ouvrir :

```text
http://localhost:3000
```

Identifiants par defaut :

```text
user: admin
password: hackathon
```

Les dashboards sont provisionnes automatiquement par les ConfigMaps portant le label `grafana_dashboard: "1"`.
