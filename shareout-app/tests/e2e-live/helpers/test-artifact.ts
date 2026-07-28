import { ShareOutClient } from './client';
import { uniqueSlug } from './env';
import { minimalArtifactHtml } from './fixtures';

export interface TestArtifact {
  client: ShareOutClient;
  artifactId: string;
  slug: string;
  marker: string;
  name: string;
}

export async function publishTestArtifact(
  client: ShareOutClient,
  prefix = 'e2e'
): Promise<TestArtifact> {
  const slug = uniqueSlug(prefix);
  const marker = `marker-${Date.now()}`;
  const name = `E2E ${slug}`;

  const { response, body } = await client.publish({
    name,
    slug,
    visibility: 'public',
    files: [{
      path: 'index.html',
      content: minimalArtifactHtml(name, marker),
      mime: 'text/html',
    }],
  });

  if (!response.ok || !body?.artifact?.id) {
    throw new Error(`Failed to publish test artifact: ${response.status} ${JSON.stringify(body)}`);
  }

  return {
    client,
    artifactId: body.artifact.id,
    slug,
    marker,
    name,
  };
}

export async function cleanupTestArtifact(client: ShareOutClient, artifactId: string): Promise<void> {
  if (artifactId) {
    await client.deleteArtifact(artifactId);
  }
}
