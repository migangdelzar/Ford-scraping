import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(path, 'utf8');

test('scraper image defaults to the monthly scheduler command', async () => {
  const dockerfile = await read('Dockerfile');

  assert.match(
    dockerfile,
    /^CMD \["node", "dist\/src\/cli\.js", "scheduler"\]$/m,
  );
  assert.match(dockerfile, /^USER node$/m);
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

test('CI validates API, database migrations, integration tests, and scheduler container', async () => {
  const workflow = await read('.github/workflows/ci.yml');

  assert.match(workflow, /npm test -- --run tests\/api/);
  assert.match(workflow, /npm run migrate/);
  assert.match(workflow, /npm run test:integration/);
  assert.match(workflow, /Scheduler active:/);
  assert.doesNotMatch(workflow, /MCP_HTTP|mcp-http|ford-mcp/i);
  assert.doesNotMatch(
    workflow.split('name: Publish versioned scraper image')[0],
    /docker\/login-action/,
  );
});

test('version-tagged CI publishes the verified scraper image and attests its digest', async () => {
  const workflow = await read('.github/workflows/ci.yml');
  const publishIndex = workflow.indexOf(
    'name: Publish versioned scraper image',
  );
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

  assert.ok(publishIndex >= 0, 'tagged CI must publish the scraper image');
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

test('Node has no MCP server/client and its release workflow only deploys the scraper scheduler', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const cli = await read('src/cli.ts');
  const compose = await read('docker-compose.yml');
  const ci = await read('.github/workflows/ci.yml');
  const release = await read('.github/workflows/release.yml');
  const readme = await read('README.md');

  assert.equal(existsSync('src/mcp'), false);
  assert.equal(
    existsSync('.github/workflows/vault-runtime-preflight.yml'),
    false,
  );
  assert.equal(
    packageJson.dependencies['@modelcontextprotocol/node'],
    undefined,
  );
  assert.equal(
    packageJson.dependencies['@modelcontextprotocol/server'],
    undefined,
  );
  assert.doesNotMatch(JSON.stringify(packageJson.scripts), /mcp/i);
  assert.doesNotMatch(cli, /mcp-http|serveMcpStdio|mcpServices/i);
  assert.doesNotMatch(compose, /ford-mcp|MCP_HTTP/i);
  assert.doesNotMatch(ci, /MCP_HTTP|mcp-http|ford-mcp|MCP image/i);
  assert.match(release, /target: ford-scraper-scheduler/);
  assert.match(
    release,
    /oci-blue-green@a878ad1ba1dd4a25ef814ea4b69ac817ae32165a/,
  );
  assert.match(release, /secrets-provider: oci-vault/);
  assert.doesNotMatch(release, /target: ford-mcp|mcp-private-ip|mcp-http/i);
  assert.match(release, /PRODUCTION_DEPLOY_ENABLED/);
  assert.match(release, /RUNTIME_VAULT_READY/);
  assert.match(release, /attestation verify/);
  assert.match(release, /environment: manual-release-approval/);
  assert.match(release, /release_request_id/);
  assert.match(release, /run-name:.*Release Ford scraper scheduler/);
  assert.doesNotMatch(readme, /npm run dev -- mcp|MCP server exposes/i);
});

test('legacy MCP retirement is protected and preserves scraper dependencies', async () => {
  const workflowPath = '.github/workflows/retire-legacy-mcp.yml';
  const scriptPath = 'scripts/retire-legacy-mcp.sh';
  assert.equal(
    existsSync(workflowPath),
    true,
    'protected retirement workflow must exist',
  );
  assert.equal(
    existsSync(scriptPath),
    true,
    'target-scoped retirement script must exist',
  );
  const workflow = await read(workflowPath);
  const script = await read(scriptPath);

  assert.match(workflow, /workflow_dispatch/);
  assert.doesNotMatch(workflow, /^ {2}push:/m);
  assert.match(workflow, /RETIRE_FORD_MCP/);
  assert.match(workflow, /environment: manual-release-approval/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /vars\.OCI_MCP_HOST/);
  assert.match(workflow, /secrets\.OCI_MCP_SSH_PRIVATE_KEY/);
  assert.match(workflow, /PRODUCTION_DEPLOY_ENABLED/);
  assert.match(workflow, /RUNTIME_VAULT_READY/);
  assert.match(workflow, /retire-legacy-mcp\.sh/);

  const targetMatch = script.match(/RETIRE_SERVICES=\(([^)]*)\)/);
  assert.ok(
    targetMatch,
    'retirement must use an explicit Compose service allowlist',
  );
  assert.deepEqual(targetMatch[1].trim().split(/\s+/), [
    'mcp-blue',
    'mcp-green',
    'mcp',
    'mcp-proxy',
  ]);
  assert.doesNotMatch(targetMatch[1], /scheduler|ollama|cloudflared/);
  assert.match(script, /ford-scraping-scheduler/);
  assert.match(script, /"\$service" == scheduler/);
  assert.match(script, /"\$service" == ollama/);
  assert.match(script, /ford-mcp_ollama-data/);
  assert.match(script, /pg_isready/);
  assert.match(
    script,
    /for\s+target_service\s+in\s+"\$\{RETIRE_SERVICES\[@\]\}"/,
  );
  assert.match(
    script,
    /docker\s+stop\s+--time\s+30\s+"\$\{target_ids\[\$index\]\}"/,
  );
  assert.match(script, /docker rm "\$\{target_ids\[\$index\]\}"/);
  assert.match(script, /original_scheduler_id/);
  assert.match(script, /original_ollama_id/);
  assert.match(script, /for port in 3001 3101 3102/);
  assert.match(script, /verify_mcp_listeners_closed/);
  assert.match(script, /Cloudflared, MCP environment\/config files.*preserved/);
  assert.doesNotMatch(script, /docker\s+compose\s+.*down|docker\s+volume\s+rm/);
  assert.doesNotMatch(script, /\.Config\.Env|printenv/);
});
