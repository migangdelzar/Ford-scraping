import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const workflowPath = resolve(process.cwd(), '.github/workflows/ci.yml');
const releaseWorkflowPath = resolve(
  process.cwd(),
  '.github/workflows/release.yml',
);
const dockerfilePath = resolve(process.cwd(), 'Dockerfile');
const composePath = resolve(process.cwd(), 'docker-compose.yml');
const configPath = resolve(process.cwd(), 'src/config.ts');
const vaultPreflightPath = resolve(
  process.cwd(),
  '.github/workflows/vault-runtime-preflight.yml',
);

describe('CI workflow contract', () => {
  it('runs quality gates on every branch push, pull request, and manual dispatch', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toMatch(/on:\s*[\s\S]*pull_request:/);
    expect(workflow).toMatch(/on:\s*[\s\S]*push:\s*\n/);
    expect(workflow).toMatch(/on:\s*[\s\S]*workflow_dispatch:/);
    expect(workflow).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(workflow).toMatch(/concurrency:/);
    expect(workflow).toMatch(/node-version:\s*['"]?22['"]?/);
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('npm run lint');
    expect(workflow).not.toContain('continue-on-error: true');
    expect(workflow).toContain('npm run build');
    expect(workflow).toContain('npm run test:unit');
    expect(workflow).toContain('npm run test:integration');
  });

  it('runs the MCP container as the unprivileged Node user', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf8');

    expect(dockerfile).toMatch(/^USER node$/m);
  });

  it('provides an isolated PostgreSQL test database', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toMatch(
      /postgres:\s*\n[\s\S]*image:\s*pgvector\/pgvector:pg16/,
    );
    expect(workflow).toContain('POSTGRES_DB: ford_test');
    expect(workflow).toContain('POSTGRES_USER: postgres');
    expect(workflow).toContain('POSTGRES_PASSWORD: postgres');
    expect(workflow).toContain(
      'FORD_TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5432/ford_test',
    );
    expect(workflow).toMatch(/Run database migrations[\s\S]*npm run migrate/);
    expect(workflow).toMatch(
      /name: Run database migrations[\s\S]*FORD_BASE_URL: https:\/\/www\.ford\.mx\//,
    );
    expect(workflow).toMatch(
      /name: Run integration tests[\s\S]*npm run test:integration/,
    );
  });

  it('blocks CI on lint and executable quality gates', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toMatch(/name: Lint[\s\S]*npm run lint/);
    expect(workflow).not.toContain('continue-on-error: true');
    expect(workflow).toMatch(/name: Build[\s\S]*npm run build/);
    expect(workflow).toMatch(/name: Unit tests[\s\S]*npm run test:unit/);
    expect(workflow).toMatch(
      /name: Run integration tests[\s\S]*npm run test:integration/,
    );
  });

  it('does not publish or deploy', () => {
    const workflow = readFileSync(workflowPath, 'utf8').split('  publish:')[0];

    expect(workflow).not.toMatch(/docker\s+push|npm\s+publish/i);
    expect(workflow).not.toMatch(/uses:\s+[^\n]*(?:release|deploy)/i);
  });
});

describe('scheduler release contract', () => {
  it('runs monthly at noon Mexico City time and never migrates on container startup', () => {
    const compose = readFileSync(composePath, 'utf8');
    const config = readFileSync(configPath, 'utf8');
    const scheduler =
      compose.match(/ {2}scheduler:[\s\S]*?(?=\nvolumes:)/)?.[0] ?? '';

    expect(scheduler).toContain('SYNC_SCHEDULE: "0 12 1 * *"');
    expect(scheduler).toContain('SYNC_TIMEZONE: America/Mexico_City');
    expect(scheduler).not.toContain('migrate');
    expect(config).toContain("SYNC_SCHEDULE: z.string().default('0 12 1 * *')");
  });
});

describe('MCP release workflow contract', () => {
  it('accepts only an explicit operation and full source SHA', () => {
    const workflow = readFileSync(releaseWorkflowPath, 'utf8');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain(
      'publication and deployment remain separately gated.',
    );
    expect(workflow).toContain('options: [validate, deploy, rollback]');
    expect(workflow).toContain('source_sha:');
    expect(workflow).toContain('^[0-9a-f]{40}$');
  });

  it('publishes and attests an ARM64 image from the exact CI-verified tag', () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    const releaseWorkflow = readFileSync(releaseWorkflowPath, 'utf8');
    const publishWorkflow = workflow.slice(workflow.indexOf('  publish:'));

    expect(workflow).toContain('name: Publish versioned MCP image');
    expect(workflow).toContain('needs: [test, container]');
    expect(workflow).toContain("github.event_name == 'push'");
    expect(workflow).toContain("github.ref_type == 'tag'");
    expect(workflow).toContain('git cat-file -t');
    expect(workflow).toContain('git merge-base --is-ancestor');
    expect(publishWorkflow).toContain('platforms: linux/arm64');
    expect(publishWorkflow).toContain('input: /tmp/ford-scraping.tar');
    expect(publishWorkflow).toContain(
      'outputs: type=docker,dest=/tmp/ford-scraping.tar',
    );
    expect(publishWorkflow).toContain(
      'digest: ${{ steps.publish.outputs.digest }}',
    );
    expect(publishWorkflow.indexOf('name: Scan versioned image')).toBeLessThan(
      publishWorkflow.indexOf(
        'name: Log in to GHCR after the image passes its scan',
      ),
    );
    expect(publishWorkflow).toContain(
      'image=${IMAGE_REPOSITORY}@${IMAGE_DIGEST}',
    );
    expect(publishWorkflow).toContain('limit-severities-for-sarif: true');
    expect(publishWorkflow).toContain('anchore/sbom-action@v0.20.0');
    expect(publishWorkflow).toContain('actions/attest-build-provenance@v2');
    expect(publishWorkflow).toContain('--source-ref "refs/tags/${VERSION}"');
    expect(publishWorkflow).toContain('--source-digest "${SOURCE_SHA}"');
    expect(publishWorkflow).toContain('--bundle-from-oci');
    expect(publishWorkflow).toContain(
      'name: ford-scraping-sbom-${{ github.sha }}.cdx.json',
    );

    expect(releaseWorkflow).toContain(
      'name: Resolve immutable MCP image published by tagged CI',
    );
    expect(releaseWorkflow).toContain('docker pull "${tagged_image}"');
    expect(releaseWorkflow).toContain(
      'digest: ${{ steps.image.outputs.digest }}',
    );
    expect(releaseWorkflow).toContain('name: ford-release-result');
    expect(releaseWorkflow).not.toContain('docker/build-push-action');
    expect(releaseWorkflow).not.toContain('docker push');
  });

  it('pins the public OCI action and keeps production behind both readiness gates', () => {
    const workflow = readFileSync(releaseWorkflowPath, 'utf8');

    expect(workflow).toMatch(
      /uses: migangdelzar\/Ford-oci-deployment-action\/\.github\/actions\/oci-blue-green@cd920eb42c341a0ecc8583ea00a878f6a89bcc72/,
    );
    expect(workflow).toContain("vars.PRODUCTION_DEPLOY_ENABLED == 'true'");
    expect(workflow).toContain("vars.RUNTIME_VAULT_READY == 'true'");
    expect(workflow).toContain('environment: production');
    expect(workflow).not.toContain('continue-on-error: true');
    expect(workflow).toContain(
      'migangdelzar/Ford-oci-deployment-action/.github/actions/oci-blue-green@cd920eb42c341a0ecc8583ea00a878f6a89bcc72',
    );
  });

  it('passes runtime Vault configuration to the deployment action', () => {
    const workflow = readFileSync(releaseWorkflowPath, 'utf8');

    expect(workflow).toContain(
      'FORD_SECRETS_PROVIDER: ${{ vars.FORD_SECRETS_PROVIDER }}',
    );
    expect(workflow).toContain(
      'FORD_VAULT_SECRET_OCID_POSTGRES_PASSWORD: ${{ vars.FORD_VAULT_SECRET_OCID_POSTGRES_PASSWORD }}',
    );
    expect(workflow).toContain(
      'FORD_VAULT_SECRET_OCID_MCP_HTTP_BEARER_TOKEN: ${{ vars.FORD_VAULT_SECRET_OCID_MCP_HTTP_BEARER_TOKEN }}',
    );
    expect(workflow).toContain(
      'secrets-provider: ${{ vars.FORD_SECRETS_PROVIDER }}',
    );
    expect(workflow).toContain(
      'postgres-password-secret-ocid: ${{ vars.FORD_VAULT_SECRET_OCID_POSTGRES_PASSWORD }}',
    );
    expect(workflow).toContain(
      'mcp-http-bearer-token-secret-ocid: ${{ vars.FORD_VAULT_SECRET_OCID_MCP_HTTP_BEARER_TOKEN }}',
    );
    expect(workflow).toContain(
      'mcp-public-smoke-access-client-id: ${{ vars.FORD_MCP_ACCESS_CLIENT_ID }}',
    );
    expect(workflow).toContain(
      'mcp-public-smoke-access-client-secret-secret-ocid: ${{ vars.FORD_VAULT_SECRET_OCID_FORD_MCP_ACCESS_CLIENT_SECRET }}',
    );
    expect(workflow).toContain(
      'FORD_VAULT_SECRET_OCID_FORD_MCP_ACCESS_CLIENT_SECRET: ${{ vars.FORD_VAULT_SECRET_OCID_FORD_MCP_ACCESS_CLIENT_SECRET }}',
    );
  });
});

describe('production Vault readiness preflight', () => {
  it('read-only verifies all runtime and public smoke secret reads on emme-2', () => {
    const workflow = readFileSync(vaultPreflightPath, 'utf8');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('GITHUB_REF}');
    expect(workflow).toContain("'refs/heads/main'");
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain(
      'FORD_SECRETS_PROVIDER: ${{ vars.FORD_SECRETS_PROVIDER }}',
    );
    expect(workflow).toContain('FORD_VAULT_SECRET_OCID_POSTGRES_PASSWORD:');
    expect(workflow).toContain('FORD_VAULT_SECRET_OCID_MCP_HTTP_BEARER_TOKEN:');
    expect(workflow).toContain('FORD_MCP_ACCESS_CLIENT_ID:');
    expect(workflow).toContain(
      'FORD_VAULT_SECRET_OCID_FORD_MCP_ACCESS_CLIENT_SECRET:',
    );
    expect(workflow).toContain('FORD_MCP_ACCESS_CLIENT_ID');
    expect(workflow).toContain('CLOUDFLARE_ACCESS_CLIENT_SECRET_B64');
    expect(workflow).toContain('OCI_MCP_SSH_PRIVATE_KEY');
    expect(workflow).toContain('OCI_SSH_KNOWN_HOSTS');
    expect(workflow).toContain('--auth instance_principal');
    expect(workflow).toContain('secret-bundle get');
    expect(workflow).toContain('Vault access passed');
    expect(workflow).not.toMatch(/echo\s+.*(?:secret|token|password).*\$\{/i);
    expect(workflow).not.toContain('docker compose');
    expect(workflow).toContain(
      'migration, container startup, and route switch: not run',
    );
    expect(workflow).not.toMatch(
      /\b(?:docker|npm)\s+(?:compose|run\s+migrate)/i,
    );
  });
});
