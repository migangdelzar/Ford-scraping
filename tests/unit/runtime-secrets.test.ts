import {describe, expect, it, vi} from 'vitest';
import {
  loadRuntimeEnvironment,
  resolveRuntimeEnvironment,
} from '../../src/secrets/runtime-secrets.js';

const databaseSecret = 'ocid1.vaultsecret.oc1..database';
const bearerSecret = 'ocid1.vaultsecret.oc1..bearer';

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
      FORD_VAULT_SECRET_OCID_MCP_HTTP_BEARER_TOKEN: bearerSecret,
      DATABASE_HOST: 'postgres',
      DATABASE_PORT: '5432',
      DATABASE_USER: 'ford',
      DATABASE_NAME: 'ford_service',
    };
    const reader = fakeSecretReader({
      [databaseSecret]: 'db-password',
      [bearerSecret]: 'mcp-token',
    });

    const resolved = await resolveRuntimeEnvironment(source, reader, {
      command: 'mcp-http',
    });

    expect(resolved.DATABASE_URL).toBe(
      'postgres://ford:db-password@postgres:5432/ford_service',
    );
    expect(resolved.MCP_HTTP_BEARER_TOKEN).toBe('mcp-token');
    expect(reader.requests).toEqual([databaseSecret, bearerSecret]);
  });

  it('fails closed when a required Vault mapping is missing', async () => {
    const reader = fakeSecretReader({});

    await expect(
      resolveRuntimeEnvironment({FORD_SECRETS_PROVIDER: 'oci-vault'}, reader, {
        command: 'mcp-http',
      }),
    ).rejects.toThrow(
      'Required OCI Vault mapping is missing: POSTGRES_PASSWORD',
    );

    expect(reader.requests).toEqual([]);
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

  it('does not fetch the MCP bearer token for the scheduler process', async () => {
    const source = {
      FORD_SECRETS_PROVIDER: 'oci-vault',
      FORD_VAULT_SECRET_OCID_POSTGRES_PASSWORD: databaseSecret,
      FORD_VAULT_SECRET_OCID_MCP_HTTP_BEARER_TOKEN: bearerSecret,
      DATABASE_HOST: 'postgres',
      DATABASE_USER: 'ford',
      DATABASE_NAME: 'ford_service',
    };
    const reader = fakeSecretReader({[databaseSecret]: 'db-password'});

    const resolved = await resolveRuntimeEnvironment(source, reader, {
      command: 'scheduler',
    });

    expect(resolved.MCP_HTTP_BEARER_TOKEN).toBeUndefined();
    expect(reader.requests).toEqual([databaseSecret]);
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
    const reader = fakeSecretReader({
      [databaseSecret]: 'db-password',
      [bearerSecret]: 'mcp-token',
    });
    const close = vi.fn();
    const createReader = vi.fn(async () => ({...reader, close}));

    const result = await loadRuntimeEnvironment(
      {
        FORD_SECRETS_PROVIDER: 'oci-vault',
        FORD_VAULT_SECRET_OCID_POSTGRES_PASSWORD: databaseSecret,
        FORD_VAULT_SECRET_OCID_MCP_HTTP_BEARER_TOKEN: bearerSecret,
        DATABASE_HOST: 'postgres',
        DATABASE_USER: 'ford',
        DATABASE_NAME: 'ford_service',
      },
      {command: 'mcp-http', createReader},
    );

    expect(result.MCP_HTTP_BEARER_TOKEN).toBe('mcp-token');
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
