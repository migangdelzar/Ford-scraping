import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const workflowPath = resolve(process.cwd(), '.github/workflows/ci.yml');
const dockerfilePath = resolve(process.cwd(), 'Dockerfile');
const composePath = resolve(process.cwd(), 'docker-compose.yml');
const configPath = resolve(process.cwd(), 'src/config.ts');
const releaseWorkflowPath = resolve(
  process.cwd(),
  '.github/workflows/release.yml',
);

describe('scraper runtime contract', () => {
  it('runs the scheduler as an unprivileged user in its production image', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf8');

    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(
      /^CMD \["node", "dist\/src\/cli\.js", "scheduler"\]$/m,
    );
  });

  it('runs monthly at noon Mexico City time and does not migrate on startup', () => {
    const compose = readFileSync(composePath, 'utf8');
    const config = readFileSync(configPath, 'utf8');
    const scheduler =
      compose.match(/ {2}scheduler:[\s\S]*?(?=\nvolumes:)/)?.[0] ?? '';

    expect(scheduler).toContain('SYNC_SCHEDULE: "0 12 1 * *"');
    expect(scheduler).toContain('SYNC_TIMEZONE: America/Mexico_City');
    expect(scheduler).not.toContain('migrate');
    expect(config).toContain("SYNC_SCHEDULE: z.string().default('0 12 1 * *')");
  });

  it('keeps migration and integration checks in CI without an MCP runtime smoke', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('npm run migrate');
    expect(workflow).toContain('npm run test:integration');
    expect(workflow).toContain('Scheduler active:');
    expect(workflow).not.toMatch(/MCP_HTTP|mcp-http|ford-mcp/i);
  });

  it('supports an approved scheduler disable operation without resolving a new image', () => {
    const release = readFileSync(releaseWorkflowPath, 'utf8');

    expect(release).toContain('options: [deploy, rollback, disable]');
    expect(release).toContain('operation=disable');
    expect(release).toContain('source_sha=recorded-disable');
    expect(release).toContain(
      "needs.verify.outputs.operation != 'deploy' || needs.image.result == 'success'",
    );
  });

  it('passes the existing PostgreSQL Vault secret reference to the scheduler action', () => {
    const release = readFileSync(releaseWorkflowPath, 'utf8');

    expect(release).toContain(
      'oci-blue-green@60e44cc9a508f7a8300656ff8149e32c0d540b18',
    );
    expect(release).toContain(
      'scheduler-postgres-password-secret-ocid: ${{ vars.FORD_VAULT_SECRET_OCID_POSTGRES_PASSWORD }}',
    );
    expect(release).not.toContain('FORD_CATALOG_PASSWORD');
  });
});
