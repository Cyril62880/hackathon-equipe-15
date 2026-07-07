
import OpenAI from 'openai';

const DEFAULT_BASE_URL =
  process.env.OVH_AI_ENDPOINT_URL ||
  'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1';
const DEFAULT_MODEL = process.env.OVH_AI_MODEL || 'Meta-Llama-3_3-70B-Instruct';

export const SYSTEM_PROMPT = `Tu es un ingénieur sécurité Kubernetes. On te fournit un manifeste Kubernetes
et la liste des vulnérabilités / mauvaises configurations détectées par Trivy
et Kyverno sur ce workload.

Ta mission : produire une version CORRIGÉE du manifeste qui applique les bonnes
pratiques de sécurité :
- épingler l'image sur un tag/digest récent et non vulnérable (jamais \`latest\`) ;
- supprimer privileged, allowPrivilegeEscalation, les capabilities dangereuses ;
- exécuter en utilisateur non-root (runAsNonRoot, runAsUser >= 1000) ;
- ajouter un securityContext restrictif (readOnlyRootFilesystem, drop ALL) ;
- définir des resources requests/limits CPU et mémoire ;
- supprimer les montages hostPath dangereux et les secrets en clair ;
- désactiver l'automount du token de ServiceAccount si inutile.

CONTRAINTES DE SORTIE STRICTES :
- Réponds UNIQUEMENT avec le manifeste YAML corrigé, valide et complet.
- Conserve le kind, le nom, le namespace et le rôle fonctionnel du workload.
- N'ajoute aucune explication, aucun commentaire hors YAML, aucun bloc markdown.`;

export class OvhAiClient {
  constructor({ apiKey, baseURL = DEFAULT_BASE_URL, model = DEFAULT_MODEL } = {}) {
    apiKey = apiKey || process.env.OVH_AI_ENDPOINTS_ACCESS_TOKEN;
    if (!apiKey) {
      throw new Error(
        'Token OVH AI manquant : définir OVH_AI_ENDPOINTS_ACCESS_TOKEN.',
      );
    }
    this.model = model;
    this.client = new OpenAI({ apiKey, baseURL });
  }

  async proposeFix(manifestYaml, findingsSummary) {
    const userPrompt =
      '### Manifeste actuel\n```yaml\n' +
      `${manifestYaml}\n` +
      '```\n\n### Findings de sécurité\n' +
      `${findingsSummary}\n\n` +
      'Renvoie le manifeste corrigé.';

    const resp = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    });
    return stripCodeFence(resp.choices[0]?.message?.content || '');
  }
}

export function stripCodeFence(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*)\n```$/);
  return match ? match[1].trim() : trimmed;
}
