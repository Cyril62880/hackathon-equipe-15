// Création automatique d'une branche + Pull Request de remédiation sur GitHub.
//
// L'IA ne merge JAMAIS : elle ouvre une PR qu'un humain relit et merge,
// conformément au brief.

import { Octokit } from '@octokit/rest';

function splitRepo(fullName) {
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) {
    throw new Error(`repo attendu au format "owner/repo", reçu: ${fullName}`);
  }
  return { owner, repo };
}

function client(token) {
  token = token || process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN manquant pour l\'accès GitHub.');
  return new Octokit({ auth: token });
}

// Récupère le contenu d'un fichier du repo (pour l'exécution en cluster).
export async function fetchFile(repoFullName, filePath, ref = 'main', token) {
  const octokit = client(token);
  const { owner, repo } = splitRepo(repoFullName);
  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: filePath,
    ref,
  });
  return Buffer.from(data.content, 'base64').toString('utf-8');
}

// Ouvre une PR corrigeant `filePath`. Retourne l'URL de la PR.
// Lève une erreur "NO_CHANGE" si le correctif est identique à l'existant.
export async function openRemediationPr({
  repoFullName,
  filePath,
  newContent,
  baseBranch = 'main',
  token,
  title,
  body,
}) {
  const octokit = client(token);
  const { owner, repo } = splitRepo(repoFullName);

  const base = await octokit.rest.repos.getBranch({ owner, repo, branch: baseBranch });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 15); // YYYYMMDDHHMMSS
  const branch = `ai-remediation/${stamp}`;

  // Récupère le blob existant (SHA nécessaire pour un update).
  let currentSha;
  let currentContent;
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: baseBranch,
    });
    currentSha = data.sha;
    currentContent = Buffer.from(data.content, 'base64').toString('utf-8');
  } catch {
    currentSha = undefined;
  }

  if (currentContent && currentContent.trim() === newContent.trim()) {
    const err = new Error('Le correctif proposé est identique au manifeste actuel.');
    err.code = 'NO_CHANGE';
    throw err;
  }

  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: base.data.commit.sha,
  });

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    message: `fix(security): remédiation IA de ${filePath}`,
    content: Buffer.from(newContent, 'utf-8').toString('base64'),
    branch,
    sha: currentSha,
  });

  const pr = await octokit.rest.pulls.create({
    owner,
    repo,
    title: title || `[IA] Remédiation sécurité — ${filePath}`,
    body: body || defaultBody(filePath),
    head: branch,
    base: baseBranch,
  });
  return pr.data.html_url;
}

function defaultBody(filePath) {
  return (
    '## Remédiation proposée automatiquement par la couche IA\n\n' +
    `Ce correctif a été généré par l'analyse IA (OVH AI Endpoints) des rapports ` +
    `Trivy et Kyverno, et applique les bonnes pratiques de sécurité sur ` +
    `\`${filePath}\`.\n\n` +
    "⚠️ **L'IA ne merge pas.** Un humain doit relire et valider cette PR. " +
    'Après merge, Argo CD resynchronise automatiquement le cluster.\n\n' +
    '### Points à vérifier\n' +
    '- Image épinglée et non vulnérable\n' +
    '- Suppression des privilèges / capabilities dangereuses\n' +
    '- securityContext restrictif + resources limits\n' +
    '- Plus de secret en clair ni de hostPath dangereux\n'
  );
}
