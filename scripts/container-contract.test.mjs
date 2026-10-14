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

test('CI verifies authenticated MCP initialization and tool listing in the container', async () => {
  const workflow = await read('.github/workflows/ci.yml');

  assert.match(
    workflow,
    /docker exec -i ford-mcp-smoke node --input-type=module/,
  );
  assert.match(workflow, /method: 'initialize'/);
  assert.match(workflow, /method: 'notifications\/initialized'/);
  assert.match(workflow, /method: 'tools\/list'/);
  assert.match(workflow, /search_vehicles/);
});

test('versioned release publishes only an immutable SemVer tag after verifying tagged CI', async () => {
  const workflow = await read('.github/workflows/release.yml');

  assert.match(workflow, /version:/);
  assert.match(workflow, /INPUT_VERSION/);
  assert.match(workflow, /refs\/tags\/\$\{version\}/);
  assert.match(workflow, /git cat-file -t/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.match(workflow, /\.head_branch == \$version/);
  assert.match(workflow, /--source-ref "refs\/tags\/\$\{VERSION\}"/);
  assert.match(workflow, /--source-digest "\$\{SOURCE_SHA\}"/);
  assert.match(workflow, /REQUESTED_SHA: \$\{\{ inputs\.source_sha \}\}/);
  assert.doesNotMatch(workflow, /workflow_run:/);
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
  assert.match(workflow, /docker push "\$\{sha_tag\}"/);
  assert.match(workflow, /docker push "\$\{version_tag\}"/);
  assert.doesNotMatch(workflow, /push: true/);
  assert.match(workflow, /anchore\/sbom-action/);
  assert.match(workflow, /actions\/attest-build-provenance/);
  assert.match(workflow, /cache-to: type=local/);
  assert.match(
    workflow,
    /Ford-oci-deployment-action.*@8e32aec3eabf8207c47c7a601d8d32735f7c0b37/,
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

test('main CI does not publish or deploy automatically', async () => {
  const workflow = await read('.github/workflows/release.yml');

  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.match(workflow, /needs\.verify\.outputs\.operation == 'deploy'/);
  assert.match(workflow, /needs\.verify\.result == 'success'/);
  assert.match(workflow, /vars\.PRODUCTION_DEPLOY_ENABLED == 'true'/);
  assert.match(workflow, /vars\.RUNTIME_VAULT_READY == 'true'/);
  assert.match(workflow, /name: ford-release-result/);
  assert.match(workflow, /"imageDigest": os\.environ\["IMAGE_DIGEST"\]/);
  assert.match(workflow, /ford-mcp\.emme\.business\/mcp/);
  assert.match(workflow, /backup-host: \$\{\{ vars\.OCI_DATA_DEPLOY_HOST \}\}/);
  assert.match(workflow, /backup-user: \$\{\{ vars\.OCI_DATA_DEPLOY_USER \}\}/);
});

test('manual deploy and rollback dispatches satisfy the release contract dependency', async () => {
  const workflow = await read('.github/workflows/release.yml');

  assert.match(
    workflow,
    /contract:[\s\S]*?if: github\.event_name == 'workflow_dispatch'/,
  );
  assert.match(workflow, /needs\.contract\.result == 'success'/);
});
