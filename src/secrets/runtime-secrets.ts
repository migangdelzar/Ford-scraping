export interface RuntimeSecretReader {
  getSecretValue(secretId: string): Promise<string>;
  close?(): void;
}

export interface LoadRuntimeEnvironmentOptions {
  createReader?: () => Promise<RuntimeSecretReader>;
}

const secretMappings = [
  {
    target: 'POSTGRES_PASSWORD',
    reference: 'FORD_VAULT_SECRET_OCID_POSTGRES_PASSWORD',
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
      const required = isRequired(mapping.target, environment);
      if (!required) continue;

      const secretId = environment[mapping.reference]?.trim();
      if (!secretId) {
        throw new Error(
          `Required OCI Vault mapping is missing: ${mapping.target}`,
        );
      }

      try {
        resolved[mapping.target] = await reader.getSecretValue(secretId);
      } catch (error) {
        const code = safeErrorCode(error);
        const detail = code ? ` (${code})` : '';
        throw new Error(
          `OCI Vault secret retrieval failed for ${mapping.target}${detail}`,
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
  return resolveRuntimeEnvironment(environment, reader);
}

function isRequired(
  target: (typeof secretMappings)[number]['target'],
  environment: NodeJS.ProcessEnv,
): boolean {
  if (target === 'POSTGRES_PASSWORD') return true;
  if (target === 'LANGFUSE_SECRET_KEY') {
    return Boolean(environment.LANGFUSE_PUBLIC_KEY);
  }
  return environment.EMBEDDING_PROVIDER === 'openai';
}

function safeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  const candidate = error as {
    code?: unknown;
    cause?: unknown;
    message?: unknown;
  };
  if (
    typeof candidate.code === 'string' &&
    /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(candidate.code)
  ) {
    return candidate.code;
  }
  const causeCode =
    candidate.cause === undefined ? undefined : safeErrorCode(candidate.cause);
  if (causeCode) return causeCode;
  if (
    typeof candidate.message === 'string' &&
    candidate.message.includes(
      'Failed to fetch the token from auth server. Failed with error: TypeError: fetch failed',
    )
  ) {
    return 'OCI_AUTH_FETCH_FAILED';
  }
  if (typeof candidate.message === 'string') {
    const status = candidate.message.match(
      /Failed to fetch the token from auth server\. Response received but failed with status: ([0-9]{3})/,
    );
    if (status) return `OCI_AUTH_HTTP_${status[1]}`;
  }
  return undefined;
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
