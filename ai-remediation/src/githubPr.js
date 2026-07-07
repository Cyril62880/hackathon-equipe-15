
import { Octokit } from '@octokit/rest';

function splitRepo(fullName) {
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) {
    throw new Error(`repo attendu au format "owner/repo", reçu: ${fullName}`);
  }
  return { owner, repo };
}

function client(token) {
  token = (token || process.env.GITHUB_TOKEN || '').trim();
  if (!token) throw new Error('GITHUB_TOKEN manquant pour l\'accès GitHub.');
  return new Octokit({ auth: token });
}

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

// files: [{ filePath, newContent }]
export async function openRemediationPr({
  repoFullName,
  files,
  baseBranch = 'main',
  token,
  title,
  body,
  // legacy single-file compat
  filePath,
  newContent,
}) {
  // legacy single-file support
  if (filePath && newContent && !files) {
    files = [{ filePath, newContent }];
  }
  if (!files || files.length === 0) throw new Error('Aucun fichier à commiter.');

  const octokit = client(token);
  const { owner, repo } = splitRepo(repoFullName);

  const base = await octokit.rest.repos.getBranch({ owner, repo, branch: baseBranch });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  const branch = `ai-remediation/${stamp}`;

  // Fetch current sha + content for each file; skip unchanged ones
  const toCommit = [];
  for (const { filePath: fp, newContent: nc } of files) {
    let currentSha;
    let currentContent;
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: fp,
        ref: baseBranch,
      });
      currentSha = data.sha;
      currentContent = Buffer.from(data.content, 'base64').toString('utf-8');
    } catch {
      currentSha = undefined;
    }
    if (currentContent && currentContent.trim() === nc.trim()) {
      console.log(`  → Pas de changement pour ${fp}, ignoré.`);
      continue;
    }
    toCommit.push({ filePath: fp, newContent: nc, sha: currentSha });
  }

  if (toCommit.length === 0) {
    const err = new Error('Le correctif proposé est identique au manifeste actuel pour tous les fichiers.');
    err.code = 'NO_CHANGE';
    throw err;
  }

  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: base.data.commit.sha,
  });

  for (const { filePath: fp, newContent: nc, sha } of toCommit) {
    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: fp,
      message: `fix(security): remédiation IA de ${fp}`,
      content: Buffer.from(nc, 'utf-8').toString('base64'),
      branch,
      sha,
    });
    console.log(`  ✅ ${fp} commité sur ${branch}`);
  }

  const fileList = toCommit.map((f) => `\`${f.filePath}\``).join(', ');
  const pr = await octokit.rest.pulls.create({
    owner,
    repo,
    title: title || `[IA] Remédiation sécurité — ${toCommit.length} fichier(s)`,
    body: body || defaultBody(fileList),
    head: branch,
    base: baseBranch,
  });
  return pr.data.html_url;
}

function defaultBody(fileList) {
  return (
    '## Remédiation proposée automatiquement par la couche IA\n\n' +
    `Fichiers corrigés : ${fileList}\n\n` +
    `Ce correctif a été généré par l'analyse IA (OVH AI Endpoints) des rapports ` +
    `Trivy et Kyverno, et applique les bonnes pratiques de sécurité Kubernetes.\n\n` +
    "⚠️ **L'IA ne merge pas.** Un humain doit relire et valider cette PR. " +
    'Après merge, Argo CD resynchronise automatiquement le cluster.\n\n' +
    '### Points vérifiés\n' +
    '- Image épinglée sur un tag/digest non vulnérable (jamais `:latest`)\n' +
    '- Suppression des privilèges / capabilities dangereuses\n' +
    '- securityContext restrictif (readOnlyRootFilesystem, drop ALL, runAsNonRoot)\n' +
    '- Resources requests/limits CPU et mémoire\n' +
    '- Suppression des secrets en clair et des montages hostPath\n' +
    '- RBAC au principe du moindre privilège\n'
  );
}
