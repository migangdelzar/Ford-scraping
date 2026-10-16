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
  assert.doesNotMatch(
    workflow.split('name: Publish versioned MCP image')[0],
    /docker\/login-action/,
  );
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

test('version-tagged CI publishes only after tests and container smoke pass, then verifies tag provenance', async () => {
  const workflow = await read('.github/workflows/ci.yml');
  const publishIndex = workflow.indexOf('name: Publish versioned MCP image');
  const scanIndex = workflow.indexOf('name: Scan versioned image');
  const loginIndex = workflow.indexOf(
    'name: Log in to GHCR after the image passes its scan',
  );
  const pushIndex = workflow.indexOf('name: Publish scanned versioned image');
  const attestIndex = workflow.indexOf(
    'name: Attest versioned image provenance',
  );
  const verifyIndex = workflow.indexOf(
    'name: Verify versioned image provenance',
  );

  assert.ok(publishIndex >= 0, 'tagged CI must publish the MCP image');
  assert.match(workflow, /needs: \[test, container\]/);
  assert.match(
    workflow,
    /github\.event_name == 'push'[\s\S]*?github\.ref_type == 'tag'[\s\S]*?refs\/tags\/v/,
  );
  assert.ok(
    scanIndex > publishIndex &&
      loginIndex > scanIndex &&
      pushIndex > loginIndex,
  );
  assert.ok(attestIndex > pushIndex && verifyIndex > attestIndex);
  assert.match(workflow, /exit-code: '1'/);
  assert.match(workflow, /--bundle-from-oci/);
  assert.match(workflow, /--source-ref "refs\/tags\/\$\{VERSION\}"/);
  assert.match(workflow, /--source-digest "\$\{SOURCE_SHA\}"/);
  assert.match(
    workflow,
    /--signer-workflow "\$\{GITHUB_REPOSITORY\}\/\.github\/workflows\/ci\.yml"/,
  );
});

test('manual MCP release resolves only the immutable image published by tagged CI', async () => {
  const workflow = await read('.github/workflows/release.yml');

  assert.match(workflow, /version:/);
  assert.match(workflow, /INPUT_VERSION/);
  assert.match(workflow, /refs\/tags\/\$\{version\}/);
  assert.match(workflow, /git cat-file -t/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.match(workflow, /\.head_branch == \$version/);
  assert.match(workflow, /REQUESTED_SHA: \$\{\{ inputs\.source_sha \}\}/);
  assert.match(
    workflow,
    /actions\/runs\/\$\{coordinator_run_id\}\/attempts\/\$\{coordinator_attempt\}\/jobs/,
  );
  assert.match(workflow, /Approve and deploy selected releases in order/);
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.match(
    workflow,
    /name: Resolve immutable MCP image published by tagged CI/,
  );
  assert.match(workflow, /docker pull "\$\{tagged_image\}"/);
  assert.match(workflow, /docker image inspect/);
  assert.match(workflow, /--bundle-from-oci/);
  assert.match(workflow, /--source-ref "refs\/tags\/\$\{VERSION\}"/);
  assert.match(workflow, /--source-digest "\$\{SOURCE_SHA\}"/);
  assert.match(
    workflow,
    /--signer-workflow "\$\{GITHUB_REPOSITORY\}\/\.github\/workflows\/ci\.yml"/,
  );
  assert.doesNotMatch(workflow, /docker\/build-push-action/);
  assert.doesNotMatch(workflow, /aquasecurity\/trivy-action/);
  assert.doesNotMatch(workflow, /docker push/);
  assert.match(
    workflow,
    /Ford-oci-deployment-action.*@a9045317cbe5b29fac5c0483c8aa192d696532e9/,
  );
  assert.match(workflow, /target: ford-mcp/);
});

test('manual MCP release accepts only tagged-CI provenance for its source and image', async () => {
  const workflow = await read('.github/workflows/release.yml');
  const ci = await read('.github/workflows/ci.yml');

  assert.match(ci, /gh attestation verify "oci:\/\/\$\{IMAGE\}"/);
  assert.match(ci, /--bundle-from-oci/);
  assert.match(ci, /--repo "\$\{GITHUB_REPOSITORY\}"/);
  assert.match(ci, /--source-ref "refs\/tags\/\$\{VERSION\}"/);
  assert.match(ci, /--source-digest "\$\{SOURCE_SHA\}"/);
  assert.match(
    ci,
    /--signer-workflow "\$\{GITHUB_REPOSITORY\}\/\.github\/workflows\/ci\.yml"/,
  );
  assert.match(workflow, /needs\.image\.outputs\.image/);
  assert.match(ci, /GH_TOKEN: \$\{\{ github\.token \}\}/);
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
  assert.match(workflow, /remote-root: \/opt\/ford-uruapan/);
});

test('requested MCP releases fail instead of producing a skipped deployment artifact', async () => {
  const workflow = await read('.github/workflows/release.yml');

  assert.match(workflow, /Run Ford MCP releases from main/);
  assert.ok(workflow.includes('  production-readiness:'));
  assert.match(
    workflow,
    /PRODUCTION_DEPLOY_ENABLED: \$\{\{ vars\.PRODUCTION_DEPLOY_ENABLED \}\}/,
  );
  assert.match(
    workflow,
    /RUNTIME_VAULT_READY: \$\{\{ vars\.RUNTIME_VAULT_READY \}\}/,
  );
  assert.match(workflow, /needs\.production-readiness\.result == 'success'/);
  assert.match(
    workflow,
    /approval:[\s\S]*?environment: manual-release-approval/,
  );
  assert.match(
    workflow,
    /registry-username: \$\{\{ github\.repository_owner \}\}/,
  );
  assert.doesNotMatch(workflow, /needs\.deploy\.result == 'skipped'/);
});

test('manual deploy and rollback dispatches satisfy the release contract dependency', async () => {
  const workflow = await read('.github/workflows/release.yml');

  assert.match(
    workflow,
    /contract:[\s\S]*?if: github\.event_name == 'workflow_dispatch'/,
  );
  assert.match(workflow, /needs\.contract\.result == 'success'/);
});
