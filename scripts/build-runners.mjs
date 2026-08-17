#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runnersDir = path.resolve(here, '../runners');

const IMAGES = [
  { tag: 'oj-runner-python:latest', context: path.join(runnersDir, 'python') },
  { tag: 'oj-runner-cpp:latest', context: path.join(runnersDir, 'cpp') },
  { tag: 'oj-runner-node:latest', context: path.join(runnersDir, 'node') },
];

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))
    );
  });
}

for (const { tag, context } of IMAGES) {
  console.log(`\n=== building ${tag} ===`);
  await run('docker', ['build', '-t', tag, context]);
}

console.log('\nAll runner images built.');
