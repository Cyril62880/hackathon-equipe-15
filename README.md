# Hackathon OVH x Ynov - GitOps Security Remediation

Projet equipe 15 pour le hackathon Lille Ynov Campus x OVHcloud des 6 et 7 juillet 2026.

## Objectif

Concevoir une chaine d'audit et de remediation GitOps securisee sur un cluster Managed Kubernetes OVHcloud.

La solution doit detecter des vulnerabilites ou mauvaises configurations, les analyser avec une couche d'IA generative, proposer un correctif sous forme de Pull Request, puis laisser Argo CD appliquer automatiquement la correction apres validation humaine.

## Boucle cible

```text
Detection d'une faille
        |
        v
Analyse et correctif propose par l'IA
        |
        v
Pull Request automatique sur le depot Git
        |
        v
Revue humaine et merge
        |
        v
Resynchronisation Argo CD
        |
        v
Cluster corrige
```

## Architecture prevue

```text
                    +----------------------+
                    | Depot Git GitOps     |
                    | manifests + policies |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    | Argo CD              |
                    | Sync Git -> Cluster  |
                    +----------+-----------+
                               |
                               v
+----------------+   +----------------------+   +----------------+
| Kyverno        |   | Workloads Kubernetes |   | Falco          |
| Policy-as-code |   | vulnerables/corriges |   | Runtime alert  |
+----------------+   +----------------------+   +----------------+
          |                     |                      |
          +----------+----------+----------+-----------+
                     |
                     v
              +-------------+
              | Trivy ou    |
              | Kubescape   |
              +------+------+
                     |
                     v
              +-------------+
              | Couche IA   |
              | OVH AI      |
              +------+------+
                     |
                     v
              +-------------+
              | PR correctif|
              +-------------+
```

## Stack technique

| Composant | Role | Statut |
| --- | --- | --- |
| Argo CD | GitOps, synchronisation Git vers cluster | CNCF Graduated |
| Trivy Operator ou Kubescape | Audit securite et detection de vulnerabilites | CNCF |
| Falco | Detection de menaces runtime | CNCF Graduated |
| Kyverno | Policy-as-code et controle des configurations | CNCF Graduated |
| Prometheus | Observabilite et metriques | CNCF Graduated |
| OVH AI Endpoints | Analyse IA et proposition de correctifs | OVHcloud |

Briques optionnelles :

- Istio : service mesh.
- External Secrets Operator : gestion des secrets.

## Roadmap

### 1. Initialisation GitOps

- Creer la structure du depot.
- Ajouter les manifests Kubernetes de base.
- Installer ou connecter Argo CD.
- Declarer l'application Argo CD qui synchronise le cluster depuis Git.

### 2. Workload vulnerable de demonstration

- Deployer une application volontairement vulnerable.
- Ajouter des mauvaises pratiques detectables :
  - image non epinglee ;
  - container lance en root ;
  - absence de limites CPU/memoire ;
  - privileges ou capabilities dangereuses ;
  - image contenant des CVE connues.

### 3. Audit securite

- Installer Trivy Operator ou Kubescape.
- Recuperer les rapports de vulnerabilites.
- Normaliser les resultats pour la couche IA.

### 4. Policies Kubernetes

- Installer Kyverno.
- Ajouter des policies simples et demonstrables :
  - interdiction des containers privilegies ;
  - obligation de definir des resources limits ;
  - interdiction de l'image tag `latest` ;
  - obligation de definir un `securityContext`.

### 5. Detection runtime

- Installer Falco.
- Declencher une alerte runtime simple.
- Montrer que la detection complete l'audit statique.

### 6. Couche IA

- Lire les rapports d'audit.
- Envoyer un resume a OVH AI Endpoints.
- Demander une proposition de correction en YAML ou patch Git.
- Generer automatiquement une branche et une Pull Request.

### 7. Remediation GitOps

- Faire relire la Pull Request par un humain.
- Merger la correction.
- Laisser Argo CD resynchroniser le cluster.
- Verifier que le workload corrige ne declenche plus la meme alerte.

### 8. Observabilite

- Installer Prometheus.
- Exposer ou consulter quelques metriques utiles :
  - nombre de vulnerabilites detectees ;
  - nombre de policies en erreur ;
  - etat de synchronisation Argo CD ;
  - evenements de detection runtime.

## Structure recommandee du depot

```text
.
├── apps/
│   └── vulnerable-app/
│       ├── deployment.yaml
│       └── service.yaml
├── argocd/
│   └── application.yaml
├── security/
│   ├── kyverno/
│   ├── trivy/
│   └── falco/
├── ai-remediation/
│   ├── src/
│   ├── requirements.txt
│   └── README.md
├── observability/
│   └── prometheus/
└── docs/
    └── architecture.md
```

## Acces au cluster

Le bundle fourni contient une kubeconfig pour l'equipe.

```bash
export KUBECONFIG=/chemin/vers/kubeconfig-equipe-3.yaml
kubectl get nodes
```

Ne jamais commiter la kubeconfig ni les tokens dans le depot Git.

## Acces OVH AI Endpoints

Le token AI Endpoints est fourni dans `ai-endpoints-key.txt`.

```bash
export OVH_AI_ENDPOINTS_ACCESS_TOKEN="$(cat ai-endpoints-key.txt)"
```

Ce fichier contient un secret partage par l'equipe. Il doit rester local et ne doit pas etre pousse sur Git.

## Demo attendue

Scenario de demonstration conseille :

1. Montrer le workload vulnerable synchronise par Argo CD.
2. Montrer la detection par Trivy/Kubescape et Kyverno.
3. Lancer la couche IA sur le rapport de vulnerabilites.
4. Montrer la Pull Request generee automatiquement.
5. Merger la Pull Request apres revue humaine.
6. Montrer Argo CD qui resynchronise le cluster.
7. Verifier que le workload corrige est deploye.

## Livrables

- Depot Git complet gere par Argo CD.
- Code de la couche d'enrichissement et remediation IA.
- Demonstration live de bout en bout.
- Rapport d'architecture de 1 a 2 pages.
- Tableau recapitulatif du statut CNCF des composants utilises.

## Points cles pour la soutenance

- L'IA ne merge pas directement en production : elle propose un correctif, un humain valide.
- Git reste la source de verite.
- Argo CD assure la reconciliation entre Git et le cluster.
- Les outils de securite couvrent plusieurs angles :
  - audit d'image et de configuration ;
  - policies Kubernetes ;
  - detection runtime ;
  - observabilite.
- La coherence de l'architecture est prioritaire sur la profondeur technique de chaque brique.

## Securite

- Ne pas commiter `kubeconfig-equipe-3.yaml`.
- Ne pas commiter `ai-endpoints-key.txt`.
- Utiliser des secrets Kubernetes ou External Secrets Operator si une integration durable est necessaire.
- Garder une validation humaine avant tout merge de remediation.
