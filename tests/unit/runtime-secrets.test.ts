import {describe, expect, it, vi} from 'vitest';
import {
  loadRuntimeEnvironment,
  resolveRuntimeEnvironment,
} from '../../src/secrets/runtime-secrets.js';

const databaseSecret = 'ocid1.vaultsecret.oc1..database';

function fakeSecretReader(values: Record<string, string>) {
  const requests: string[] = [];
  return {
    requests,
    async getSecretValue(secretId: string) {
      requests.push(secretId);
      const value = values[secretId];
      if (!value) throw new Error('secret unavailable');
      return value;
    },
  };
}

describe('resolveRuntimeEnvironment', () => {
  it('keeps environment mode unchanged and does not contact OCI', async () => {
    const source = {
      FORD_SECRETS_PROVIDER: 'environment',
      DATABASE_URL: 'postgres://ford:local@localhost:5432/ford',
    };
    const reader = fakeSecretReader({});

    const resolved = await resolveRuntimeEnvironment(source, reader);

    expect(resolved).toEqual(source);
    expect(reader.requests).toEqual([]);
  });

  it('loads required OCI secrets and builds the database URL without logging values', async () => {
    const source = {
      FORD_SECRETS_PROVIDER: 'oci-vault',
      FORD_VAULT_SECRET_OCID_POSTGRES_PASSWORD: databaseSecret,
      DATABASE_HOST: 'postgres',
      DATABASE_PORT: '5432',
      DATABASE_USER: 'ford',
      DATABASE_NAME: 'ford_service',
    };
    const reader = fakeSecretReader({
      [databaseSecret]: 'db-password',
    });

    const resolved = await resolveRuntimeEnvironment(source, reader);

    expect(resolved.DATABASE_URL).toBe(
      'postgres://ford:db-password@postgres:5432/ford_service',
    );
    expect(reader.requests).toEqual([databaseSecret]);
  });

  it('fails closed when a required Vault mapping is missing', async () => {
    const reader = fakeSecretReader({});

    await expect(
      resolveRuntimeEnvironment({FORD_SECRETS_PROVIDER: 'oci-vault'}, reader),
    ).rejects.toThrow(
      'Required OCI Vault mapping is missing: POSTGRES_PASSWORD',
    );

    expect(reader.requests).toEqual([]);
  });

  it('reports a safe Vault transport error code without exposing the error message', async () => {
    const sensitiveMessage = 'transport details containing secret content';
    const transportError = Object.assign(new Error(sensitiveMessage), {
      code: 'ENETUNREACH',
    });
    const reader = {
      async getSecretValue() {
        throw new TypeError('fetch failed', {cause: transportError});
      },
    };
    const source = {
      FORD_SECRETS_PROVIDER: 'oci-vault',
      FORD_VAULT_SECRET_OCID_POSTGRES_PASSWORD: databaseSecret,
    };

    await expect(resolveRuntimeEnvironment(source, reader)).rejects.toThrow(
      'OCI Vault secret retrieval failed for POSTGRES_PASSWORD (ENETUNREACH)',
    );
    await expect(resolveRuntimeEnvironment(source, reader)).rejects.not.toThrow(
      sensitiveMessage,
    );
  });

  it('maps OCI federation fetch failures to a safe diagnostic code', async () => {
    const reader = {
      async getSecretValue() {
        throw {
          code: -1,
          message:
            'Failed to fetch the token from auth server. Failed with error: TypeError: fetch failed',
        };
      },
    };

    await expect(
      resolveRuntimeEnvironment(
        {
          FORD_SECRETS_PROVIDER: 'oci-vault',
          FORD_VAULT_SECRET_OCID_POSTGRES_PASSWORD: databaseSecret,
        },
        reader,
      ),
    ).rejects.toThrow(
      'OCI Vault secret retrieval failed for POSTGRES_PASSWORD (OCI_AUTH_FETCH_FAILED)',
    );
  });

  it('prefers a safe nested network code over the generic OCI federation error', async () => {
    const networkError = Object.assign(new Error('private network detail'), {
      code: 'ECONNRESET',
    });
    const fetchError = new TypeError('fetch failed', {cause: networkError});
    const reader = {
      async getSecretValue() {
        throw {
          code: -1,
          message:
            'Failed to fetch the token from auth server. Failed with error: TypeError: fetch failed',
          cause: fetchError,
        };
      },
    };

    await expect(
      resolveRuntimeEnvironment(
        {
          FORD_SECRETS_PROVIDER: 'oci-vault',
          FORD_VAULT_SECRET_OCID_POSTGRES_PASSWORD: databaseSecret,
        },
        reader,
      ),
    ).rejects.toThrow(
      'OCI Vault secret retrieval failed for POSTGRES_PASSWORD (ECONNRESET)',
    );
    await expect(
      resolveRuntimeEnvironment(
        {
          FORD_SECRETS_PROVIDER: 'oci-vault',
          FORD_VAULT_SECRET_OCID_POSTGRES_PASSWORD: databaseSecret,
        },
        reader,
      ),
    ).rejects.not.toThrow('private network detail');
  });

  it('encodes a Vault password before constructing the database URL', async () => {
    const source = {
      FORD_SECRETS_PROVIDER: 'oci-vault',
      FORD_VAULT_SECRET_OCID_POSTGRES_PASSWORD: databaseSecret,
      DATABASE_HOST: 'postgres',
      DATABASE_PORT: '5432',
      DATABASE_USER: 'ford',
      DATABASE_NAME: 'ford_service',
    };
    const reader = fakeSecretReader({[databaseSecret]: 'p@ss:word'});

    const resolved = await resolveRuntimeEnvironment(source, reader);

    expect(resolved.DATABASE_URL).toBe(
      'postgres://ford:p%40ss%3Aword@postgres:5432/ford_service',
    );
  });
});

describe('loadRuntimeEnvironment', () => {
  it('does not initialize an OCI client in environment mode', async () => {
    const createReader = vi.fn();

    await loadRuntimeEnvironment(
      {FORD_SECRETS_PROVIDER: 'environment'},
      {createReader},
    );

    expect(createReader).not.toHaveBeenCalled();
  });

  it('creates and closes the configured OCI reader for Vault mode', async () => {
    const reader = fakeSecretReader({[databaseSecret]: 'db-password'});
    const close = vi.fn();
    const createReader = vi.fn(async () => ({...reader, close}));

    const result = await loadRuntimeEnvironment(
      {
        FORD_SECRETS_PROVIDER: 'oci-vault',
        FORD_VAULT_SECRET_OCID_POSTGRES_PASSWORD: databaseSecret,
        DATABASE_HOST: 'postgres',
        DATABASE_USER: 'ford',
        DATABASE_NAME: 'ford_service',
      },
      {createReader},
    );

    expect(result.POSTGRES_PASSWORD).toBe('db-password');
    expect(createReader).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects unknown providers before creating an OCI reader', async () => {
    const createReader = vi.fn();

    await expect(
      loadRuntimeEnvironment(
        {FORD_SECRETS_PROVIDER: 'unknown'},
        {createReader},
      ),
    ).rejects.toThrow('Unsupported runtime secrets provider: unknown');

    expect(createReader).not.toHaveBeenCalled();
  });
});
