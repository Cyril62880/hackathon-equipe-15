
import fs from 'node:fs';
import { Command } from 'commander';

import * as reportParser from './reportParser.js';

function parseArgs(argv) {
  const program = new Command();
  program
    .requiredOption('--target <path>', 'Manifeste à corriger (relatif à la racine du repo)')
    .option('--reports-dir <dir>', 'Dossier des rapports JSON exportés')
    .option('--from-cluster', 'Lire les rapports Trivy/Kyverno via l\'API Kubernetes')
    .option('--repo <owner/repo>', 'Dépôt GitHub (obligatoire hors --dry-run)')
    .option('--base-branch <branch>', 'Branche de base', 'main')
    .option('--focus <substr>', 'Ne garder que les findings dont le namespace/resource contient cette sous-chaîne')
    .option('--dry-run', "N'ouvre pas de PR : affiche le correctif proposé")
    .allowExcessArguments(false);
  program.parse(argv);
  const opts = program.opts();

  if (!opts.reportsDir && !opts.fromCluster) {
    program.error('Choisir une source : --reports-dir <dir> OU --from-cluster.');
  }
  if (opts.reportsDir && opts.fromCluster) {
    program.error('--reports-dir et --from-cluster sont mutuellement exclusifs.');
  }
  return opts;
}

async function loadTarget(opts) {
  if (fs.existsSync(opts.target)) {
    return fs.readFileSync(opts.target, 'utf-8');
  }
  if (!opts.repo) {
    throw new Error(`${opts.target} introuvable localement et --repo non fourni.`);
  }
  const { fetchFile } = await import('./githubPr.js');
  return fetchFile(opts.repo, opts.target, opts.baseBranch);
}

async function collectFindings(opts) {
  if (opts.fromCluster) return reportParser.fromCluster();
  return reportParser.fromFiles(opts.reportsDir);
}

async function main(argv) {
  const opts = parseArgs(argv);

  const manifestYaml = await loadTarget(opts);

  console.log(
    `→ Collecte des findings (${opts.fromCluster ? 'cluster' : opts.reportsDir})…`,
  );
  let findings = await collectFindings(opts);

  if (opts.focus) {
    const needle = opts.focus.toLowerCase();
    findings = findings.filter(
      (f) =>
        f.namespace.toLowerCase().includes(needle) ||
        f.resource.toLowerCase().includes(needle),
    );
  }

  if (findings.length === 0) {
    console.error('Aucun finding exploitable. Rien à corriger.');
    return 0;
  }

  const summary = reportParser.summarize(findings);
  console.log(`→ ${findings.length} findings collectés.\n${summary}\n`);

  console.log('→ Appel OVH AI Endpoints pour proposer un correctif…');
  const { OvhAiClient } = await import('./ovhAi.js');
  const client = new OvhAiClient();
  let fixed;
  try {
    fixed = await client.proposeFix(manifestYaml, summary);
  } catch (aiErr) {
    console.error(`OVH AI error: ${aiErr.message}`);
    console.error(`code=${aiErr.code} status=${aiErr.status} cause=${aiErr.cause?.message ?? aiErr.cause}`);
    throw aiErr;
  }

  if (opts.dryRun) {
    console.log('\n===== MANIFESTE CORRIGÉ (dry-run, aucune PR ouverte) =====\n');
    console.log(fixed);
    return 0;
  }

  if (!opts.repo) {
    console.error('--repo est requis hors --dry-run.');
    return 2;
  }

  const { openRemediationPr } = await import('./githubPr.js');
  console.log('→ Ouverture de la Pull Request de remédiation…');
  try {
    const url = await openRemediationPr({
      repoFullName: opts.repo,
      filePath: opts.target,
      newContent: fixed,
      baseBranch: opts.baseBranch,
    });
    console.log(`✅ Pull Request ouverte : ${url}`);
  } catch (err) {
    if (err.code === 'NO_CHANGE') {
      console.error(`Pas de PR : ${err.message}`);
      return 0;
    }
    throw err;
  }
  return 0;
}

main(process.argv)
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err.stack || String(err));
    process.exit(1);
  });
