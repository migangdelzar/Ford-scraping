import {InstancePrincipalsAuthenticationDetailsProviderBuilder} from 'oci-common';
import {SecretsClient} from 'oci-secrets';
import type {RuntimeSecretReader} from './runtime-secrets.js';

interface SecretBundleClient {
  getSecretBundle(request: {secretId: string}): Promise<{
    secretBundle?: {
      secretBundleContent?: {contentType?: string; content?: string};
    };
  }>;
  close(): void;
}

export class OciVaultSecretReader implements RuntimeSecretReader {
  constructor(private readonly client: SecretBundleClient) {}

  async getSecretValue(secretId: string): Promise<string> {
    const response = await this.client.getSecretBundle({secretId});
    const content = response.secretBundle?.secretBundleContent;
    if (content?.contentType !== 'BASE64' || !content.content) {
      throw new Error(
        'OCI Vault returned an unsupported or empty secret bundle',
      );
    }

    const decoded = Buffer.from(content.content, 'base64');
    const canonical = decoded.toString('base64').replace(/=+$/, '');
    if (
      decoded.length === 0 ||
      canonical !== content.content.replace(/=+$/, '')
    ) {
      throw new Error(
        'OCI Vault returned an unsupported or empty secret bundle',
      );
    }
    return decoded.toString('utf8');
  }

  close(): void {
    this.client.close();
  }
}

export async function createOciVaultSecretReader(): Promise<OciVaultSecretReader> {
  const authenticationDetailsProvider =
    await new InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
  const client = new SecretsClient({authenticationDetailsProvider});
  return new OciVaultSecretReader(client);
}
