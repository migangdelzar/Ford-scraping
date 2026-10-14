export interface RuntimeSecretReader {
  getSecretValue(secretId: string): Promise<string>;
  close?(): void;
}

export interface ResolveRuntimeEnvironmentOptions {
  command?: string;
}

export interface LoadRuntimeEnvironmentOptions extends ResolveRuntimeEnvironmentOptions {
  createReader?: () => Promise<RuntimeSecretReader>;
}

const secretMappings = [
  {
    target: 'POSTGRES_PASSWORD',
    reference: 'FORD_VAULT_SECRET_OCID_POSTGRES_PASSWORD',
  },
  {
    target: 'MCP_HTTP_BEARER_TOKEN',
    reference: 'FORD_VAULT_SECRET_OCID_MCP_HTTP_BEARER_TOKEN',
  },
  {
    target: 'LANGFUSE_SECRET_KEY',
    reference: 'FORD_VAULT_SECRET_OCID_LANGFUSE_SECRET_KEY',
  },
  {
    target: 'EMBEDDING_API_KEY',
    reference: 'FORD_VAULT_SECRET_OCID_EMBEDDING_API_KEY',
  },
] as const;

export async function resolveRuntimeEnvironment(
  environment: NodeJS.ProcessEnv,
  reader: RuntimeSecretReader,
  options: ResolveRuntimeEnvironmentOptions = {},
): Promise<NodeJS.ProcessEnv> {
  const provider = environment.FORD_SECRETS_PROVIDER ?? 'environment';
  if (provider === 'environment') return {...environment};
  if (provider !== 'oci-vault') {
    reader.close?.();
    throw new Error(`Unsupported runtime secrets provider: ${provider}`);
  }

  const resolved = {...environment};
  try {
    for (const mapping of secretMappings) {
      const required = isRequired(mapping.target, environment, options.command);
      if (!required) continue;

      const secretId = environment[mapping.reference]?.trim();
      if (!secretId) {
        throw new Error(
          `Required OCI Vault mapping is missing: ${mapping.target}`,
        );
      }

      try {
        resolved[mapping.target] = await reader.getSecretValue(secretId);
      } catch {
        throw new Error(
          `OCI Vault secret retrieval failed for ${mapping.target}`,
        );
      }
    }

    resolved.DATABASE_URL = buildDatabaseUrl(resolved);
    return resolved;
  } finally {
    reader.close?.();
  }
}

export async function loadRuntimeEnvironment(
  environment: NodeJS.ProcessEnv,
  options: LoadRuntimeEnvironmentOptions = {},
): Promise<NodeJS.ProcessEnv> {
  if ((environment.FORD_SECRETS_PROVIDER ?? 'environment') === 'environment') {
    return {...environment};
  }
  if (environment.FORD_SECRETS_PROVIDER !== 'oci-vault') {
    throw new Error(
      `Unsupported runtime secrets provider: ${environment.FORD_SECRETS_PROVIDER}`,
    );
  }

  const createReader =
    options.createReader ??
    (async () => {
      const {createOciVaultSecretReader} =
        await import('./oci-vault-secret-reader.js');
      return createOciVaultSecretReader();
    });
  const reader = await createReader();
  return resolveRuntimeEnvironment(environment, reader, options);
}

function isRequired(
  target: (typeof secretMappings)[number]['target'],
  environment: NodeJS.ProcessEnv,
  command?: string,
): boolean {
  if (target === 'POSTGRES_PASSWORD') return true;
  if (target === 'MCP_HTTP_BEARER_TOKEN') return command === 'mcp-http';
  if (target === 'LANGFUSE_SECRET_KEY') {
    return Boolean(environment.LANGFUSE_PUBLIC_KEY);
  }
  return environment.EMBEDDING_PROVIDER === 'openai';
}

function buildDatabaseUrl(environment: NodeJS.ProcessEnv): string {
  const host = environment.DATABASE_HOST?.trim();
  const user = environment.DATABASE_USER?.trim();
  const database = environment.DATABASE_NAME?.trim();
  const password = environment.POSTGRES_PASSWORD;
  const port = environment.DATABASE_PORT?.trim() || '5432';
  if (!host || !user || !database || !password) {
    throw new Error(
      'OCI Vault mode requires database host, user, name, and password configuration',
    );
  }

  const url = new URL('postgres://localhost');
  url.hostname = host;
  url.port = port;
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  if (environment.DATABASE_APPLICATION_NAME) {
    url.searchParams.set(
      'application_name',
      environment.DATABASE_APPLICATION_NAME,
    );
  }
  return url.toString();
}
