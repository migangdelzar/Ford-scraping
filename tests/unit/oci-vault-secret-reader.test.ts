import {describe, expect, it, vi} from 'vitest';
import {OciVaultSecretReader} from '../../src/secrets/oci-vault-secret-reader.js';

describe('OciVaultSecretReader', () => {
  it('decodes the current base64 secret bundle content', async () => {
    const client = {
      getSecretBundle: vi.fn().mockResolvedValue({
        secretBundle: {
          secretBundleContent: {
            contentType: 'BASE64',
            content: Buffer.from('secret-value').toString('base64'),
          },
        },
      }),
      close: vi.fn(),
    };
    const reader = new OciVaultSecretReader(client);

    await expect(reader.getSecretValue('secret-ocid')).resolves.toBe(
      'secret-value',
    );
    expect(client.getSecretBundle).toHaveBeenCalledWith({
      secretId: 'secret-ocid',
    });
  });

  it('rejects missing or unsupported secret content without including secret data', async () => {
    const client = {
      getSecretBundle: vi.fn().mockResolvedValue({
        secretBundle: {secretBundleContent: {contentType: 'RAW', content: 'x'}},
      }),
      close: vi.fn(),
    };
    const reader = new OciVaultSecretReader(client);

    await expect(reader.getSecretValue('secret-ocid')).rejects.toThrow(
      'OCI Vault returned an unsupported or empty secret bundle',
    );
  });

  it('closes the OCI secrets client when finished', () => {
    const client = {
      getSecretBundle: vi.fn(),
      close: vi.fn(),
    };
    const reader = new OciVaultSecretReader(client);

    reader.close();

    expect(client.close).toHaveBeenCalledOnce();
  });
});
