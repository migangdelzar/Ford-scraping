import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(path, 'utf8');

test('scraper image defaults to the monthly scheduler command', async () => {
  const dockerfile = await read('Dockerfile');

  assert.match(
    dockerfile,
    /^CMD \["node", "dist\/src\/cli\.js", "scheduler"\]$/m,
  );
});

test('runtime image contains only production dependencies on the supported Debian release', async () => {
  const dockerfile = await read('Dockerfile');

  assert.match(dockerfile, /^FROM node:22-trixie-slim AS production-deps$/m);
  assert.match(dockerfile, /^RUN npm ci --omit=dev$/m);
  assert.match(
    dockerfile,
    /^COPY --from=production-deps \/app\/node_modules \.\/node_modules$/m,
  );
  assert.match(dockerfile, /^RUN rm -rf \/usr\/local\/lib\/node_modules\/npm/m);
  assert.doesNotMatch(
    dockerfile,
    /^COPY --from=build \/app\/node_modules \.\/node_modules$/m,
  );
});

test('CI builds the app image and starts both production commands', async () => {
  const workflow = await read('.github/workflows/ci.yml');

  assert.match(workflow, /docker build --pull --tag ford-scraping:ci/);
  assert.match(workflow, /ford-scraping:ci/);
  assert.match(workflow, /Scheduler active:/);
  assert.match(workflow, /MCP_HTTP_BEARER_TOKEN/);
  assert.match(workflow, /http_code="\$\(curl/);
  assert.match(workflow, /\/mcp/);
  assert.doesNotMatch(workflow, /docker\/login-action/);
});

test('manual release publishes and scans the verified source image by digest', async () => {
  const workflow = await read('.github/workflows/release.yml');

  assert.match(workflow, /REQUESTED_SHA: \$\{\{ inputs\.source_sha \}\}/);
  assert.match(workflow, /\.head_branch == "main"/);
  assert.match(workflow, /platforms: linux\/arm64/);
  assert.match(workflow, /sha-\$\{\{ needs\.verify\.outputs\.source_sha \}\}/);
  assert.match(workflow, /aquasecurity\/trivy-action/);
  assert.match(workflow, /input: \/tmp\/ford-scraping\.tar/);
  assert.match(workflow, /outputs: type=docker,dest=\/tmp\/ford-scraping\.tar/);
  assert.ok(
    workflow.indexOf('name: Scan image') <
      workflow.indexOf('name: Log in to GHCR'),
    'the image must pass its scan before registry login and publication',
  );
  assert.match(workflow, /docker push "\$\{IMAGE_TAG\}"/);
  assert.doesNotMatch(workflow, /push: true/);
  assert.match(workflow, /anchore\/sbom-action/);
  assert.match(workflow, /actions\/attest-build-provenance/);
  assert.match(workflow, /cache-to: type=local/);
  assert.match(
    workflow,
    /Ford-oci-deployment-action.*@f8112024deea512ffebe8a7b49df531a29dad027/,
  );
  assert.match(workflow, /exit-code: '1'/);
  assert.match(workflow, /target: ford-mcp/);
});

test('manual release verifies the published image provenance from the release workflow', async () => {
  const workflow = await read('.github/workflows/release.yml');

  const attestIndex = workflow.indexOf('name: Attest image provenance');
  const verifyIndex = workflow.indexOf(
    'name: Verify published image provenance',
  );
  const summaryIndex = workflow.indexOf(
    'name: Summarize immutable scraper release',
  );

  assert.ok(attestIndex >= 0, 'the image must be attested');
  assert.ok(
    verifyIndex > attestIndex,
    'verify only after the registry attestation exists',
  );
  assert.ok(
    summaryIndex > verifyIndex,
    'release cannot pass before provenance verification',
  );
  assert.match(workflow, /gh attestation verify "oci:\/\/\$\{IMAGE\}"/);
  assert.match(workflow, /--repo "\$\{GITHUB_REPOSITORY\}"/);
  assert.match(
    workflow,
    /--signer-workflow "\$\{GITHUB_REPOSITORY\}\/\.github\/workflows\/release\.yml"/,
  );
  assert.match(workflow, /IMAGE: \$\{\{ steps\.image\.outputs\.image \}\}/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
});

test('successful main CI automatically publishes that exact MCP and scheduler source', async () => {
  const workflow = await read('.github/workflows/release.yml');

  assert.match(
    workflow,
    /workflow_run:[\s\S]*?workflows: \[CI\][\s\S]*?branches: \[main\]/,
  );
  assert.match(
    workflow,
    /WORKFLOW_RUN_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/,
  );
  assert.match(
    workflow,
    /WORKFLOW_RUN_CONCLUSION: \$\{\{ github\.event\.workflow_run\.conclusion \}\}/,
  );
  assert.match(
    workflow,
    /WORKFLOW_RUN_EVENT: \$\{\{ github\.event\.workflow_run\.event \}\}/,
  );
  assert.match(workflow, /WORKFLOW_RUN_EVENT\}" == "push"/);
  assert.match(workflow, /needs\.verify\.outputs\.operation == 'deploy'/);
  assert.match(workflow, /needs\.verify\.result == 'success'/);
  assert.match(workflow, /vars\.PRODUCTION_DEPLOY_ENABLED == 'true'/);
});

test('manual deploy and rollback dispatches satisfy the release contract dependency', async () => {
  const workflow = await read('.github/workflows/release.yml');

  assert.match(
    workflow,
    /contract:[\s\S]*?if: github\.event_name == 'workflow_run' \|\| github\.event_name == 'workflow_dispatch'/,
  );
  assert.match(workflow, /needs\.contract\.result == 'success'/);
});
