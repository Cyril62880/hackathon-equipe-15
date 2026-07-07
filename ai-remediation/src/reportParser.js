
import fs from 'node:fs';
import path from 'node:path';


const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 };

export function severityRank(sev) {
  return SEVERITY_ORDER[(sev || 'UNKNOWN').toUpperCase()] ?? 4;
}

function resourceName(meta) {
  const labels = meta.labels || {};
  return labels['trivy-operator.resource.name'] || meta.name || 'unknown';
}

function parseVulnerabilityReport(item) {
  const meta = item.metadata || {};
  const report = item.report || {};
  const resource = resourceName(meta);
  const ns = meta.namespace || 'unknown';
  return (report.vulnerabilities || []).map((v) => ({
    source: 'trivy-vuln',
    namespace: ns,
    resource,
    identifier: v.vulnerabilityID || '?',
    severity: v.severity || 'UNKNOWN',
    title: v.title || v.resource || '',
    fix: v.fixedVersion || '',
    extra: { pkg: v.resource, installed: v.installedVersion },
  }));
}

function parseConfigAuditReport(item) {
  const meta = item.metadata || {};
  const report = item.report || {};
  const resource = resourceName(meta);
  const ns = meta.namespace || 'unknown';
  return (report.checks || [])
    .filter((c) => c.success !== true)
    .map((c) => ({
      source: 'trivy-config',
      namespace: ns,
      resource,
      identifier: c.checkID || '?',
      severity: c.severity || 'UNKNOWN',
      title: c.title || '',
      fix: c.remediation || '',
      extra: { messages: c.messages || [] },
    }));
}

function parsePolicyReport(item) {
  const meta = item.metadata || {};
  const ns = meta.namespace || 'cluster';
  return (item.results || [])
    .filter((r) => ['fail', 'error', 'warn'].includes(r.result))
    .map((r) => {
      const subj = (r.resources && r.resources[0]) || {};
      return {
        source: 'kyverno',
        namespace: ns,
        resource: subj.name || 'unknown',
        identifier: r.policy || '?',
        severity: (r.severity || 'MEDIUM').toUpperCase(),
        title: r.message || '',
        fix: '',
        extra: { rule: r.rule, result: r.result },
      };
    });
}

function dispatch(kind, item) {
  const k = (kind || '').toLowerCase();
  if (k.includes('vulnerabilityreport')) return parseVulnerabilityReport(item);
  if (k.includes('configauditreport')) return parseConfigAuditReport(item);
  if (k.includes('policyreport')) return parsePolicyReport(item);
  return [];
}

export function fromFiles(reportsDir) {
  const findings = [];
  const files = fs
    .readdirSync(reportsDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(reportsDir, file), 'utf-8'));
    const items = data.items || [data];
    for (const item of items) {
      findings.push(...dispatch(item.kind || file, item));
    }
  }
  return findings;
}

export function latestReportsDir(root) {
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  if (dirs.length === 0) throw new Error(`Aucun dossier de rapport dans ${root}`);
  return path.join(root, dirs[dirs.length - 1]);
}

export async function fromCluster() {
  const k8s = await import('@kubernetes/client-node'); 
  const kc = new k8s.KubeConfig();
  try {
    kc.loadFromCluster();
  } catch {
    kc.loadFromDefault();
  }
  const api = kc.makeApiClient(k8s.CustomObjectsApi);

  const crds = [
    ['aquasecurity.github.io', 'v1alpha1', 'vulnerabilityreports'],
    ['aquasecurity.github.io', 'v1alpha1', 'configauditreports'],
    ['wgpolicyk8s.io', 'v1alpha2', 'policyreports'],
    ['wgpolicyk8s.io', 'v1alpha2', 'clusterpolicyreports'],
  ];

  const findings = [];
  for (const [group, version, plural] of crds) {
    try {
      const resp = await api.listClusterCustomObject({ group, version, plural });
      const body = resp?.body ?? resp; 
      for (const item of body.items || []) {
        findings.push(...dispatch(plural, item));
      }
    } catch {
      // CRD peut être absente selon l'installation — on ignore.
    }
  }

  // Alertes runtime Falco via Falcosidekick (Kubernetes Events dans le namespace falco).
  try {
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);
    const evResp = await coreApi.listNamespacedEvent({ namespace: 'falco' });
    const evBody = evResp?.body ?? evResp;
    for (const ev of (evBody.items || [])) {
      if (ev.source?.component !== 'falcosidekick') continue;
      findings.push({
        source: 'falco',
        namespace: ev.involvedObject?.namespace || 'falco',
        resource: ev.involvedObject?.name || 'unknown',
        identifier: ev.reason || 'falco-alert',
        severity: ev.type === 'Warning' ? 'HIGH' : 'LOW',
        title: ev.message || '',
        fix: '',
        extra: { count: ev.count, firstTime: ev.firstTimestamp },
      });
    }
  } catch {
    // Falcosidekick non disponible — on ignore.
  }

  return findings;
}

export function summarize(findings, top = 25) {
  const ranked = [...findings].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity),
  );

  const counts = {};
  for (const f of findings) {
    const s = f.severity.toUpperCase();
    counts[s] = (counts[s] || 0) + 1;
  }

  const lines = ['## Résumé des sévérités'];
  for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']) {
    if (counts[sev]) lines.push(`- ${sev}: ${counts[sev]}`);
  }

  lines.push('\n## Findings les plus critiques');
  for (const f of ranked.slice(0, top)) {
    const fix = f.fix ? ` | correctif: ${f.fix}` : '';
    lines.push(
      `- [${f.severity}][${f.source}] ${f.namespace}/${f.resource} ` +
        `— ${f.identifier}: ${f.title}${fix}`,
    );
  }
  return lines.join('\n');
}
