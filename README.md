# Chaîne d'audit et de remédiation GitOps sécurisée — Équipe 15

> Hackathon **Lille Ynov Campus × OVHcloud**, 6 & 7 juillet 2026.
> Cluster Managed Kubernetes OVHcloud, tout piloté par Argo CD.

Le pari du sujet, c'était de faire de l'IA autre chose qu'un assistant à côté du
pipeline : la mettre **dedans**. Chez nous, quand un scanner trouve une faille,
c'est un modèle génératif OVH AI qui lit le rapport, réécrit le manifeste fautif
et ouvre une Pull Request. Un humain relit, merge, et Argo CD remet le cluster en
conformité. Personne ne `kubectl apply` à la main, et l'IA ne touche jamais
directement à la prod — elle propose, on décide.

Ce README est aussi notre **rapport d'architecture** : il explique ce qu'on a
construit, pourquoi, et où sont les limites qu'on assume.

---

## La boucle, en vrai

```text
  Trivy / Kyverno / Falco          couche IA (Node.js)          GitHub
  détectent une faille   ─────►    lit le rapport,      ─────►  Pull Request
  sur un workload                  réécrit le manifeste          automatique
                                                                     │
                                                                     ▼
   cluster corrigé   ◄─────  Argo CD resync  ◄─────  merge  ◄──  revue humaine
```

Le point important : **Git reste la seule source de vérité**. L'IA ne fait
qu'ajouter un commit candidat ; c'est le merge humain qui déclenche la
réconciliation Argo CD. Si on veut annuler une remédiation, on `git revert`, et
le cluster suit.

---

## Architecture

### Tout part d'un seul objet Argo CD

On a suivi le pattern **app-of-apps**. Une seule `Application` racine
([root.yaml](root.yaml)) pointe sur le dossier [apps/](apps/), et chaque fichier
là-dedans déclare une brique. Résultat : brancher Argo CD sur le dépôt une fois
suffit à faire apparaître tout le reste — les opérateurs de sécurité, l'observabilité,
les workloads de démo, la couche IA.

```text
                   root (Application Argo CD)
                            │  lit apps/*.yaml
   ┌──────────┬────────────┼────────────┬──────────────┬───────────────┐
   ▼          ▼            ▼            ▼              ▼               ▼
 trivy-    kyverno       falco      prometheus    external-      ai-remediation
 operator                                          secrets        (CronJob IA)
   │          │            │            │              │               │
   └──────────┴──── audit / policy / runtime / métriques ─────────────┘
                            appliqués sur ▼
             workloads volontairement vulnérables (DVWA + Alnoria)
                       en overlays  dev / acc / prod
```

### Trois angles de sécurité, pas un seul

Un scanner d'image seul aurait raté la moitié des problèmes, donc on a superposé
trois regards complémentaires :

- **Trivy Operator** scanne les images et les configurations dans le cluster, en
  continu, et publie ses résultats sous forme de CRD (`VulnerabilityReports`,
  `ConfigAuditReports`).
- **Kyverno** joue le rôle de garde-barrière *policy-as-code* : il refuse (ou
  signale) les configs interdites — conteneur privilégié, absence de limites,
  tag `latest`… La policy `disallow-privileged` est dans
  [kyverno/policy/](kyverno/policy/).
- **Falco** surveille le *runtime* : ce que Trivy et Kyverno ne peuvent pas voir
  à l'admission (un shell qui s'ouvre dans un pod, un accès suspect au
  filesystem hôte), Falco le détecte à l'exécution.

Les trois remontent dans **Prometheus**, et on a préparé des dashboards Grafana
dédiés (voir [monitoring/](monitoring/)) : CVE critiques, policies en échec,
événements Falco, drift Argo CD, tout au même endroit.

### Secrets : rien de sensible dans Git

La couche IA a besoin de deux secrets (token OVH AI, PAT GitHub). On les gère
avec **External Secrets Operator** : le secret source vit dans un namespace
verrouillé `eso-source`, hors du dépôt, et ESO le projette dans le namespace
`ai-remediation`. Rotation = on met à jour la source, ESO resynchronise. Détail
dans [manifest/ai-remediation/README.md](manifest/ai-remediation/README.md).

### Promotion entre environnements

Les workloads existent en trois overlays Kustomize (`dev` / `acc` / `prod`). Un
workflow GitHub Actions [promote.yml](.github/workflows/promote.yml) copie le tag
d'image validé d'un environnement vers le suivant et **ouvre une PR** — là encore,
pas de promotion automatique en prod sans relecture.

---

## Livrable 1 — Le dépôt géré par Argo CD

Chaque brique est une `Application` Argo CD synchronisée depuis ce dépôt :

| Application | Source | Rôle |
| --- | --- | --- |
| `trivy-operator` | Helm (aquasecurity) | Audit images & configs |
| `kyverno` | Helm (kyverno) | Policy-as-code à l'admission |
| `falco` | Helm (falcosecurity) | Détection runtime |
| `prometheus` | Helm (prometheus-community) | Métriques & alerting |
| `external-secrets` | Helm (external-secrets) | Injection des secrets hors Git |
| `monitoring-dashboards` | `monitoring/` (ce dépôt) | Dashboards Grafana + règles |
| `ai-remediation` | `manifest/ai-remediation/` | CronJob de la couche IA |
| `vulnerable-app-{dev,acc,prod}` | overlays Kustomize | Workload DVWA vulnérable |
| `alnoria-{dev,acc,prod}` | overlays Kustomize | Appli multi-tier web/api/db |

Structure du dépôt :

```text
.
├── root.yaml               # Application "app-of-apps" — point d'entrée Argo CD
├── apps/                   # une Application Argo CD par brique
├── manifest/
│   ├── vulnerable-app/     # DVWA : base + overlays dev/acc/prod
│   ├── alnoria/            # appli web/api/db : base + overlays
│   └── ai-remediation/     # namespace, RBAC, CronJob, NetworkPolicy, ESO
├── ai-remediation/         # code Node.js de la couche IA + Dockerfile durci
│   └── src/{reportParser,ovhAi,githubPr,remediate}.js
├── kyverno/policy/         # policies cluster
├── monitoring/             # dashboards Grafana + règles Prometheus
├── reports/                # exports d'audit horodatés (Trivy/Kyverno)
└── .github/workflows/      # ci · build-push · promote
```

---

## Livrable 2 — La couche d'enrichissement IA

C'est le cœur du projet, en Node.js, dans [ai-remediation/](ai-remediation/).
Quatre modules, un par étape :

| Module | Ce qu'il fait |
| --- | --- |
| [reportParser.js](ai-remediation/src/reportParser.js) | Lit et normalise les findings Trivy + Kyverno, depuis des fichiers JSON **ou** en direct via l'API Kubernetes (`--from-cluster`) |
| [ovhAi.js](ai-remediation/src/ovhAi.js) | Client **OVH AI Endpoints** (API compatible OpenAI, modèle `gpt-oss-120b`). Le prompt système en fait un ingénieur sécu qui rend un manifeste corrigé, rien d'autre |
| [githubPr.js](ai-remediation/src/githubPr.js) | Crée une branche et ouvre la Pull Request via l'API GitHub. **Ne merge jamais.** |
| [remediate.js](ai-remediation/src/remediate.js) | L'orchestrateur / CLI qui enchaîne le tout |

Deux choix qu'on tient à expliquer en soutenance :

1. **`temperature: 0.1`** — on veut un correctif reproductible, pas de la
   créativité. Le prompt impose une sortie *YAML strict*, sans markdown ni
   commentaire, et on nettoie quand même la réponse (`stripCodeFence`) par
   sécurité.
2. **Un mode `--dry-run`** qui affiche le manifeste corrigé sans ouvrir de PR.
   C'est ce qu'on montre en live : on voit l'IA raisonner sur le vrai rapport,
   sans polluer le dépôt.

```bash
# Démo locale, sans rien pousser
cd ai-remediation && npm install
export OVH_AI_ENDPOINTS_ACCESS_TOKEN="$(cat ../ai-endpoints-key.txt)"

node src/remediate.js \
  --reports-dir ../reports/2026-07-06_15-13-10 \
  --target ../manifest/vulnerable-app/base/deployment.yaml \
  --focus demo-vulnerable \
  --dry-run
```

En cluster, c'est le même code packagé dans une image **durcie** (Node 20,
utilisateur non-root UID 10001, rootfs en lecture seule, aucune capability) et
lancé en `CronJob` horaire — l'exact opposé du workload qu'il corrige.

---

## Livrable 3 — Démonstration de bout en bout

### Les cobayes

On a déployé **DVWA** (`vulnerables/web-dvwa:latest`) en cumulant volontairement
les mauvaises pratiques, pour que chaque outil ait quelque chose à trouver
([manifest/vulnerable-app/base/deployment.yaml](manifest/vulnerable-app/base/deployment.yaml)) :

- image en `latest`, tirée à chaque démarrage ;
- conteneur **privilégié**, en **root**, avec `NET_ADMIN` + `SYS_ADMIN` ;
- `hostPath: /` monté dans le pod (accès à tout le nœud) ;
- des clés AWS et un mot de passe MySQL **en clair** dans les variables d'env ;
- une kubeconfig « fuitée » montée en secret.

À côté, **Alnoria** (web / api / db) sert d'appli « réaliste » multi-tier pour
montrer que la chaîne marche aussi sur autre chose qu'un cas d'école.

### Le scénario qu'on déroule

1. Argo CD affiche le workload vulnérable synchronisé (tout est vert… sauf la sécu).
2. Trivy et Kyverno remontent leurs findings ; Grafana montre les CVE et les
   policies en échec.
3. On lance la couche IA sur le rapport (`--dry-run`) : elle propose un manifeste
   corrigé — non-root, `drop ALL`, limites CPU/mémoire, plus de `hostPath`, plus
   de secrets en clair.
4. Sans `--dry-run`, elle ouvre la **Pull Request** sur GitHub.
5. On relit, on merge.
6. Argo CD **resynchronise** ; le pod redéployé ne déclenche plus les mêmes
   alertes.

C'est la boucle complète : détection → IA → PR → revue → merge → resync.

---

## Livrable 4 — Statut CNCF des composants

Contrainte du sujet : toute la chaîne repose sur des projets hébergés par la CNCF
(hors la couche IA, qui est le service OVHcloud imposé).

| Composant | Rôle | Statut CNCF |
| --- | --- | --- |
| **Argo CD** | GitOps — synchronisation Git → cluster | Graduated |
| **Trivy** (Operator) | Audit sécurité images & configs | Outil au choix du brief (open-source Aqua) — l'alternative CNCF est Kubescape, Sandbox |
| **Falco** | Détection de menaces runtime | Graduated |
| **Kyverno** | Policy-as-code — contrôle des configs | Graduated |
| **Prometheus** | Observabilité & métriques | Graduated |
| **External Secrets Operator** | Gestion des secrets hors Git | Sandbox |
| **OVH AI Endpoints** | Couche d'IA générative | — (service OVHcloud) |

On a écarté Vault (hors périmètre CNCF) au profit d'ESO, comme le suggérait le
brief.

---

## Ce qui tourne vraiment vs. ce qu'on simule

Autant être honnêtes pour le Q/A :

- La boucle IA → PR → merge → Argo CD est **fonctionnelle** de bout en bout.
- En démo live, on privilégie le `--dry-run` (montrer le raisonnement de l'IA)
  puis une vraie PR ; le `CronJob` horaire, lui, tourne en tâche de fond.
- Les `secret.yaml` d'Alnoria contiennent des valeurs de **démo** pour que
  l'appli démarre via Argo CD ; en durable on passerait tout par ESO.
- Le placeholder de registry dans le CronJob doit être remplacé par un registry
  réel (Managed Private Registry OVHcloud ou GHCR) avant un run en cluster.

---

## Accès

**Cluster** — un bundle kubeconfig est fourni pour l'équipe :

```bash
export KUBECONFIG=./kubeconfig-equipe-15.yml
kubectl get nodes
```

**OVH AI Endpoints** — le token est dans `ai-endpoints-key.txt` (local, jamais commité) :

```bash
export OVH_AI_ENDPOINTS_ACCESS_TOKEN="$(cat ai-endpoints-key.txt)"
```

**Grafana** :

```bash
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80
# http://localhost:3000  (admin / hackathon)
```

---

## Sécurité — nos règles

- `kubeconfig-equipe-15.yml` et `ai-endpoints-key.txt` restent **locaux**
  (voir [.gitignore](.gitignore)). Aucun secret réel dans Git.
- Les secrets de la couche IA passent par **External Secrets Operator**.
- **Toujours** une validation humaine avant qu'une remédiation IA n'atteigne le
  cluster — c'est le principe non négociable du projet.

---

## À retenir pour la soutenance

- L'IA est un **maillon actif** de la chaîne de sécu, pas un chatbot à côté :
  elle détecte (via les rapports), analyse et corrige.
- Elle **propose**, l'humain **dispose** : la PR est le point de contrôle.
- **Git = source de vérité**, Argo CD = réconciliateur. Rollback = `git revert`.
- Défense en profondeur : audit statique (Trivy), admission (Kyverno), runtime
  (Falco), le tout observé dans Prometheus/Grafana.
- On a joué la **cohérence de l'architecture** plutôt que la profondeur d'une
  seule brique — ce que le brief valorise explicitement.
