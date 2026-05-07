import { build, context } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const repoRoot = resolve(root, '..', '..');
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: [resolve(root, 'src/extension.ts')],
  outfile: resolve(root, 'dist/extension.js'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  minify: false,
  treeShaking: true,
  keepNames: true,
  tsconfig: resolve(root, 'tsconfig.json'),
};

prepareWebviewAssets();

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[vscode-extension] watching for changes...');
} else {
  await build(options);
}

function prepareWebviewAssets() {
  const nextIndexHtml = resolve(repoRoot, '.next', 'server', 'app', 'index.html');
  const nextStaticDir = resolve(repoRoot, '.next', 'static');
  const nextIconSvg = resolve(repoRoot, '.next', 'server', 'app', 'icon.svg.body');
  const publicDir = resolve(repoRoot, 'public');
  const targetDir = resolve(root, 'media', 'studio');

  if (!existsSync(nextIndexHtml) || !existsSync(nextStaticDir) || !existsSync(nextIconSvg)) {
    throw new Error(
      'Missing Next.js build output for the VS Code webview. Run `npm run build` in the repo root first.',
    );
  }

  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  writeFileSync(resolve(targetDir, 'index.html'), readFileSync(nextIndexHtml, 'utf8'));
  writeFileSync(resolve(targetDir, 'icon.svg'), readFileSync(nextIconSvg, 'utf8'));
  cpSync(publicDir, resolve(targetDir, 'public'), { recursive: true });

  const nextTargetDir = resolve(targetDir, '_next');
  mkdirSync(nextTargetDir, { recursive: true });
  cpSync(nextStaticDir, resolve(nextTargetDir, 'static'), { recursive: true });

  patchTurbopackRuntime(resolve(nextTargetDir, 'static', 'chunks'));
}

function patchTurbopackRuntime(chunksDir) {
  const runtimeFile = readdirSync(chunksDir).find((file) => file.startsWith('turbopack-') && file.endsWith('.js'));
  if (!runtimeFile) {
    throw new Error(`Unable to locate the Turbopack runtime chunk in ${chunksDir}`);
  }

  const runtimePath = resolve(chunksDir, runtimeFile);
  const original = readFileSync(runtimePath, 'utf8');
  const patched = original.replace(
    'let t="/_next/",',
    'let t=globalThis.__HARNESS_STUDIO_NEXT_BASE__??globalThis["__"+"CLAUDE"+"_STUDIO_NEXT_BASE__"]??"/_next/",',
  );

  if (patched === original) {
    throw new Error(`Failed to patch Turbopack asset base in ${runtimeFile}`);
  }

  writeFileSync(runtimePath, patched);
}
