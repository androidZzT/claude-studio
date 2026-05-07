#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// Parse port from args
const args = process.argv.slice(2);
let port = 3100;
const portIdx = args.indexOf('--port') !== -1 ? args.indexOf('--port') : args.indexOf('-p');
if (portIdx !== -1 && args[portIdx + 1]) {
  port = parseInt(args[portIdx + 1], 10);
}

console.log(`\n  ◆ harness-studio\n  Starting on http://localhost:${port}\n`);

// Install deps if needed
if (!existsSync(resolve(projectRoot, 'node_modules'))) {
  console.log('  Installing dependencies...');
  execSync('npm install --production', { cwd: projectRoot, stdio: 'inherit' });
}

// Build if needed
if (!existsSync(resolve(projectRoot, '.next'))) {
  console.log('  Building...');
  execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });
}

// Start
const child = spawn('npx', ['next', 'start', '-p', String(port)], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env },
});

child.on('exit', (code) => process.exit(code ?? 0));

// Handle signals
process.on('SIGINT', () => { child.kill('SIGINT'); });
process.on('SIGTERM', () => { child.kill('SIGTERM'); });
