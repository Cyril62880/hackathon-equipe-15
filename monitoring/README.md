# Grafana supervision

Ce dossier est synchronise par l'application Argo CD `monitoring-dashboards`.

## Dashboards fournis

- `Kubernetes KPI Supervision` : etat des pods, redemarrages, CPU, memoire et targets Prometheus.
- `Security & GitOps Supervision` : KPI Trivy, Kyverno, Falco, Argo CD et vulnerable app.
- `Cluster - Etat global` : vision cluster complet, nodes, pods, CPU, memoire, PV et targets.
- `Disponibilite - Workloads` : replicas indisponibles, restarts, pods en attente et terminaisons anormales.
- `Cybersecurite - Posture concrete` : CVE Trivy, resultats Kyverno, evenements Falco, drift Argo CD et alertes.

## Alertes Prometheus

Le fichier `prometheus-rules.yaml` ajoute des alertes pour les nodes non ready, pods non sains, deployments indisponibles, redemarrages eleves, CVE critical, policies Kyverno en echec, evenements Falco et applications Argo CD out-of-sync.

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
