# Harness Studio VS Code Extension (MVP)

This extension adds two commands:

- `Harness Studio: Start Server`
- `Harness Studio: Open`
- `Harness Studio: Show Logs`
- `Harness Studio: Open DAG For Current Workflow`

`webview` is now the default mode. It loads the full Harness Studio app from packaged local assets inside VS Code and routes `/api/*` requests directly to the extension host, so no local Next.js server is required.

The local `webview` bridge handles:

- app -> extension host (`postMessage`)
- in-process file/resource/settings/project APIs
- in-process execution and watch streams
- optional Claude CLI generation (`/api/generate`)

`openMode=nativePreview` opens a no-iframe preview panel that supports:

- resource summary + filterable resource list (`/api/resources`)
- click-to-load resource details (`/api/resources/:type/:id`)
- create/delete resources in panel (`POST/DELETE /api/resources/*`)
- inline resource edit/save (`PUT /api/resources/:type/:id`, keeps frontmatter)
- global settings view/edit (`/api/settings`)
- project open/create + project resource CRUD via in-process bridge routes
- execution APIs (`/api/execute/*`) including SSE stream bridge

## Settings

- `harnessStudio.serverUrl` (default: `http://127.0.0.1:3100`)
- `harnessStudio.autoStart` (default: `true`)
- `harnessStudio.openMode` (default: `webview`) values: `webview`, `nativePreview`, `simpleBrowser`, `external`
- `harnessStudio.startCommand` (default: `npx harness-studio --port {port}`)
- `harnessStudio.startupTimeoutMs` (default: `45000`)

`startCommand` placeholders:

- `{port}` from `serverUrl`
- `{url}` full server URL

Only `simpleBrowser` and `external` require the configured server URL to be reachable. `webview` and `nativePreview` run without starting a local server.

## Local Development

From the repository root:

```bash
npm install
npm --prefix extensions/vscode install
npm run vscode:build
```

Then open `extensions/vscode` in VS Code and press `F5`.

For iterative development from the repo root:

```bash
npm run vscode:watch
```
