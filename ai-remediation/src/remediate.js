
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';

import * as reportParser from './reportParser.js';

function parseArgs(argv) {
  const program = new Command();
  program
    .requiredOption('--target <path...>', 'Manifeste(s) à corriger (relatifs à la racine du repo)')
    .option('--reports-dir <dir>', 'Dossier des rapports JSON exportés')
    .option('--from-cluster', "Lire les rapports Trivy/Kyverno via l'API Kubernetes")
    .option('--repo <owner/repo>', 'Dépôt GitHub (obligatoire hors --dry-run)')
    .option('--base-branch <branch>', 'Branche de base', 'main')
    .option(
      '--focus <substr>',
      'Filtrer globalement les findings (tous les fichiers) sur ce sous-chaîne',
    )
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

async function loadTarget(filePath, opts) {
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }
  if (!opts.repo) {
    throw new Error(`${filePath} introuvable localement et --repo non fourni.`);
  }
  const { fetchFile } = await import('./githubPr.js');
  return fetchFile(opts.repo, filePath, opts.baseBranch);
}

async function collectFindings(opts) {
  if (opts.fromCluster) return reportParser.fromCluster();
  return reportParser.fromFiles(opts.reportsDir);
}

// Dérive un filtre de namespace depuis le chemin du manifeste.
// Ex: "manifest/vulnerable-app/base/deployment.yaml" → "vulnerable"
//     "manifest/alnoria/base/api.yaml"               → "alnoria"
//     "manifest/ai-remediation/rbac.yaml"            → "ai-remediation"
function namespaceHintFromPath(filePath) {
  const parts = filePath.split(path.sep).join('/').split('/');
  // prend le segment après "manifest/"
  const idx = parts.indexOf('manifest');
  if (idx >= 0 && parts[idx + 1]) {
    const app = parts[idx + 1]; // "vulnerable-app" | "alnoria" | "ai-remediation"
    if (app === 'vulnerable-app') return 'vulnerable';
    if (app === 'alnoria') return 'alnoria';
    if (app === 'ai-remediation') return 'ai-remediation';
  }
  return null;
}

function filterFindings(findings, hint, globalFocus) {
  let result = findings;

  // Filtre global (--focus) si présent
  if (globalFocus) {
    const needle = globalFocus.toLowerCase();
    result = result.filter(
      (f) =>
        f.namespace.toLowerCase().includes(needle) ||
        f.resource.toLowerCase().includes(needle),
    );
  }

  // Filtre par app si on a un hint (et qu'on n'a pas déjà filtré globalement)
  if (hint && !globalFocus) {
    const relevant = result.filter(
      (f) =>
        f.namespace.toLowerCase().includes(hint) ||
        f.resource.toLowerCase().includes(hint),
    );
    // Si des findings correspondent à cette app, on les utilise; sinon, on garde tout
    // pour que l'IA applique quand même les bonnes pratiques générales.
    if (relevant.length > 0) return relevant;
  }

  return result;
}

async function main(argv) {
  const opts = parseArgs(argv);
  const targets = Array.isArray(opts.target) ? opts.target : [opts.target];

  console.log(`→ Collecte des findings (${opts.fromCluster ? 'cluster' : opts.reportsDir})…`);
  const allFindings = await collectFindings(opts);
  console.log(`→ ${allFindings.length} findings bruts collectés (tous namespaces).`);

  const { OvhAiClient } = await import('./ovhAi.js');
  const client = new OvhAiClient();

  const fixedFiles = [];

  for (const target of targets) {
    const hint = namespaceHintFromPath(target);
    const findings = filterFindings(allFindings, hint, opts.focus);

    if (findings.length === 0) {
      console.log(`→ [${target}] Aucun finding pertinent, ignoré.`);
      continue;
    }

    const summary = reportParser.summarize(findings, 30);
    console.log(`\n→ [${target}] ${findings.length} findings (${hint ?? 'global'}) — appel OVH AI…`);

    let manifestYaml;
    try {
      manifestYaml = await loadTarget(target, opts);
    } catch (err) {
      console.error(`  ⚠ Impossible de charger ${target}: ${err.message}`);
      continue;
    }

    let fixed;
    try {
      fixed = await client.proposeFix(manifestYaml, summary);
    } catch (aiErr) {
      console.error(`  ✗ OVH AI error (${target}): ${aiErr.message}`);
      console.error(`    code=${aiErr.code} status=${aiErr.status} cause=${aiErr.cause?.message ?? aiErr.cause}`);
      continue;
    }

    if (opts.dryRun) {
      console.log(`\n===== MANIFESTE CORRIGÉ : ${target} =====\n`);
      console.log(fixed);
    } else {
      fixedFiles.push({ filePath: target, newContent: fixed });
    }
  }

  if (opts.dryRun) return 0;

  if (fixedFiles.length === 0) {
    console.error('Aucun fichier corrigé à commiter.');
    return 1;
  }

  if (!opts.repo) {
    console.error('--repo est requis hors --dry-run.');
    return 2;
  }

  const { openRemediationPr } = await import('./githubPr.js');
  console.log(
    `\n→ Ouverture de la Pull Request de remédiation (${fixedFiles.length} fichier(s))…`,
  );
  try {
    const url = await openRemediationPr({
      repoFullName: opts.repo,
      files: fixedFiles,
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
