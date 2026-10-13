import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const workflowPath = resolve(process.cwd(), '.github/workflows/ci.yml');
const dockerfilePath = resolve(process.cwd(), 'Dockerfile');
const composePath = resolve(process.cwd(), 'docker-compose.yml');
const configPath = resolve(process.cwd(), 'src/config.ts');

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
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).not.toMatch(
      /\b(publish|deploy|docker push|npm publish)\b/i,
    );
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
