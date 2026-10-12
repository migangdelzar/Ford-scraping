#!/usr/bin/env node
/* global console, process */
import 'dotenv/config';
import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, rename, rm, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const backupDir = path.join(projectRoot, 'backups');
const container =
  process.env.FORD_POSTGRES_CONTAINER ?? 'ford-scraping-postgres-1';
const database = process.env.FORD_DATABASE_NAME ?? 'ford';
const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('-', '');
const output = path.join(backupDir, `${database}-${stamp}.dump`);
const partial = `${output}.partial`;

if (database !== 'ford') {
  throw new Error(`Refusing to back up unexpected database name: ${database}`);
}

await mkdir(backupDir, {recursive: true});
const child = spawn(
  'docker',
  [
    'exec',
    container,
    'pg_dump',
    '-U',
    'postgres',
    '--format=custom',
    '--no-owner',
    '--no-acl',
    database,
  ],
  {stdio: ['ignore', 'pipe', 'inherit']},
);
const file = createWriteStream(partial, {flags: 'wx'});
child.stdout.pipe(file);
const [exitCode] = await once(child, 'close');
if (exitCode !== 0) {
  file.destroy();
  await rm(partial, {force: true});
  throw new Error(`pg_dump failed with exit code ${exitCode}`);
}
await once(file, 'close');
await rename(partial, output);

const hash = createHash('sha256');
for await (const chunk of createReadStream(output)) hash.update(chunk);
const checksumPath = `${output}.sha256`;
await writeFile(
  checksumPath,
  `${hash.digest('hex')}  ${path.basename(output)}\n`,
  {flag: 'wx'},
);
console.log(`Backup created: ${path.relative(projectRoot, output)}`);
console.log(`Checksum created: ${path.relative(projectRoot, checksumPath)}`);
