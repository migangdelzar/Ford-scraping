import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const workflowPath = resolve(process.cwd(), '.github/workflows/ci.yml');

describe('CI workflow contract', () => {
  it('runs the quality gates on pull requests and pushes to main', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toMatch(/on:\s*[\s\S]*pull_request:/);
    expect(workflow).toMatch(
      /on:\s*[\s\S]*push:\s*[\s\S]*branches:\s*\n\s*- main/,
    );
    expect(workflow).toMatch(/node-version:\s*['"]?22['"]?/);
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('npm run lint');
    expect(workflow).toContain('npm run build');
    expect(workflow).toContain('npm run test:unit');
    expect(workflow).toContain('npm run test:integration');
  });

  it('provides an isolated PostgreSQL test database', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toMatch(/postgres:\s*\n[\s\S]*image:\s*postgres:16/);
    expect(workflow).toContain('POSTGRES_DB: ford_test');
    expect(workflow).toContain('POSTGRES_USER: postgres');
    expect(workflow).toContain('POSTGRES_PASSWORD: postgres');
    expect(workflow).toContain(
      'FORD_TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5432/ford_test',
    );
  });

  it('does not publish or deploy', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).not.toMatch(
      /\b(publish|deploy|docker push|npm publish)\b/i,
    );
  });
});
