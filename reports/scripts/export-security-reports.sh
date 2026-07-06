#!/bin/bash

set -e

# Se placer automatiquement à la racine du repo Git
REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

DATE=$(date +"%Y-%m-%d_%H-%M-%S")
REPORT_DIR="reports/$DATE"

mkdir -p "$REPORT_DIR"

echo "Export des rapports de sécurité : $DATE"
echo "Dossier : $REPORT_DIR"

echo "Export Trivy VulnerabilityReports..."
kubectl get vulnerabilityreports -A -o json > "$REPORT_DIR/trivy-vulnerabilityreports-$DATE.json"
kubectl get vulnerabilityreports -A -o yaml > "$REPORT_DIR/trivy-vulnerabilityreports-$DATE.yaml"

echo "Export Trivy ConfigAuditReports..."
kubectl get configauditreports -A -o json > "$REPORT_DIR/trivy-configauditreports-$DATE.json"
kubectl get configauditreports -A -o yaml > "$REPORT_DIR/trivy-configauditreports-$DATE.yaml"

echo "Export résumé Trivy..."
kubectl get vulnerabilityreports -A \
  -o custom-columns="NAMESPACE:.metadata.namespace,NAME:.metadata.name,CRITICAL:.report.summary.criticalCount,HIGH:.report.summary.highCount,MEDIUM:.report.summary.mediumCount,LOW:.report.summary.lowCount" \
  > "$REPORT_DIR/trivy-summary-$DATE.txt"

echo "Export Kyverno PolicyReports..."
kubectl get policyreports -A -o json > "$REPORT_DIR/kyverno-policyreports-$DATE.json"
kubectl get policyreports -A -o yaml > "$REPORT_DIR/kyverno-policyreports-$DATE.yaml"

echo "Export Kyverno ClusterPolicyReports si disponibles..."
if kubectl get clusterpolicyreports >/dev/null 2>&1; then
  kubectl get clusterpolicyreports -o json > "$REPORT_DIR/kyverno-clusterpolicyreports-$DATE.json"
  kubectl get clusterpolicyreports -o yaml > "$REPORT_DIR/kyverno-clusterpolicyreports-$DATE.yaml"
else
  echo "Aucun ClusterPolicyReport disponible." > "$REPORT_DIR/kyverno-clusterpolicyreports-$DATE.txt"
fi

echo "Création d'un résumé global..."
cat > "$REPORT_DIR/README-$DATE.md" <<EOF
# Rapport sécurité Kubernetes - $DATE

## Exports générés

- Trivy VulnerabilityReports
- Trivy ConfigAuditReports
- Kyverno PolicyReports
- Kyverno ClusterPolicyReports si disponibles
- Résumé Trivy texte

## Commandes sources

\`\`\`bash
kubectl get vulnerabilityreports -A
kubectl get configauditreports -A
kubectl get policyreports -A
kubectl get clusterpolicyreports
\`\`\`
EOF

echo "Ajout Git..."
git add "$REPORT_DIR"

if git diff --cached --quiet; then
  echo "Aucun nouveau rapport à commit."
else
  git commit -m "chore: export security reports $DATE"
  git push
  echo "Rapports exportés et poussés sur GitHub."
fi