# Stage 0 Toolchain Fix

## Summary

Stage 0 的 ESLint 与 Vitest 失败不是依赖版本互相冲突，而是命令实际运行在错误的 Node runtime 上。

- 失败现象 1：`npm run lint` 报 `structuredClone is not defined`
- 失败现象 2：`npm test` 报 `crypto.getRandomValues is not a function`
- 现场证据：默认 shell 的 `node` / `npm` 实际来自 `~/.nvm/versions/node/v16.17.0/bin`
- 对照证据：同一套 lockfile 在 `Node v22.22.0` 下直接执行 `npm run lint` 与 `npm test` 均可通过

## Root Cause

### What actually happened

项目脚本之前直接写成：

```json
{
  "lint": "eslint .",
  "test": "vitest run"
}
```

这会让 `npm run lint` / `npm test` 使用当前 shell 解析到的 `node`。本机虽然安装了 `Node v20.20.2` 与 `v22.22.0`，但默认 PATH 里排在前面的仍是 `v16.17.0`：

```bash
command -v node
# /Users/zhangzhengtian02/.nvm/versions/node/v16.17.0/bin/node
```

因此：

- ESLint 9 实际跑在 Node 16 上，访问 `structuredClone` 时失败
- Vitest 3.2 / Vite 7 实际跑在 Node 16 上，访问 `crypto.getRandomValues` 时失败

### Why this is not a dependency-compatibility bug

复核 lockfile 与安装结果后，当前实际解析到的是：

- `eslint@9.39.4`
- `@eslint/js@9.39.4`
- `@typescript-eslint/eslint-plugin@8.59.0`
- `@typescript-eslint/parser@8.59.0`
- `vitest@3.2.4`
- `vite@7.3.2`
- `@eslint/config-array@0.21.2`

在 `Node v22.22.0` 下，这一组版本可正常通过 `lint`、`test`、`test:coverage` 和 `build`。因此这里不存在“升级/降级某个包才能跑”的证据，真实问题是 runtime 误选。

## Official Compatibility References

- ESLint v9 migration guide: ESLint v9 不支持 Node `<18.18.0` 和 Node 19
  Source: [eslint.org/docs/latest/use/migrate-to-9.0.0](https://eslint.org/docs/latest/use/migrate-to-9.0.0)
- typescript-eslint dependency versions: 当前支持的 ESLint 范围是 `^8.57.0 || ^9.0.0 || ^10.0.0`，Node 范围是 `^18.18.0 || ^20.9.0 || >=21.1.0`
  Source: [typescript-eslint.io/users/dependency-versions](https://typescript-eslint.io/users/dependency-versions)
- typescript-eslint v8 announcement: v8 明确支持 ESLint v9
  Source: [typescript-eslint.io/blog/announcing-typescript-eslint-v8](https://typescript-eslint.io/blog/announcing-typescript-eslint-v8/)
- Vite 7 announcement: Vite 7 需要 Node `20.19+` 或 `22.12+`
  Source: [vite.dev/blog/announcing-vite7](https://vite.dev/blog/announcing-vite7)
- Node.js docs: `structuredClone` 是 Node 全局；`crypto.getRandomValues()` 在较新的 Node 中可用
  Sources: [nodejs.org/docs/latest/api/globals.html](https://nodejs.org/docs/latest/api/globals.html), [nodejs.org/download/release/v20.15.1/docs/api/crypto.html](https://nodejs.org/download/release/v20.15.1/docs/api/crypto.html)

这些官方资料与本地复现相互印证：问题在于脚本被 Node 16 执行，而不是当前 ESLint / Vitest 版本组合本身不兼容。

## Chosen Fix

### 1. Make npm scripts select a supported Node runtime

新增 `scripts/run-node-tool.sh`：

- 复用 `scripts/lib/runtime.sh`
- 自动探测已安装的 Node 20+ / 22+
- 将所选 runtime 的 `bin` 目录前置到 PATH
- 再执行 `eslint` / `vitest` / `tsc` / `prettier`
- 若机器上根本没有可用 Node 20+，会直接给出明确错误提示，而不是静默退出

这样即使 `npm` 本身是从旧版 Node 启动，真正执行的工具进程仍会落到受支持的 Node runtime 上。

### 2. Keep dependency set unchanged

没有对 ESLint / Vitest / Vite 做“猜测式升级或降级”，因为本地证据已经证明：

- 同一个 `package-lock.json`
- 同一份 `node_modules`
- 仅切换到 Node 22

即可让所有失败消失。

### 3. Make CI and pre-commit output explicit step status

`scripts/ci.sh` 与 `scripts/pre-commit.sh` 原本已经有 `set -euo pipefail`，所以“严格模式缺失”不是实际根因。

本次额外补了 `scripts/lib/steps.sh`，把每个步骤包装成：

- `[STEP] <name>`
- `[PASS] <name>`
- `[FAIL] <name> (exit <code>)`

这样失败时会立即退出，并明确告诉调用者到底卡在哪一步。

## Rejected Options

### Rejected: upgrade/downgrade ESLint, Vitest, or Vite first

理由：

- 在 Node 22 下现有版本已能稳定通过
- 没有官方资料表明当前版本组合与 Node 22 不兼容
- 盲目换版本只会扩大 scope，并引入新的未知变更

### Rejected: add polyfills or shims

理由：

- `structuredClone` / `crypto.getRandomValues` 本来就是目标 runtime 应具备的能力
- 加 polyfill 只会掩盖脚本跑在错误 Node 上的事实
- 这类“绕过”与 Stage 0 自举的可验证性目标相违背

### Rejected: downgrade project Node target

理由：

- `.nvmrc` 已声明 Node 22
- Vite 7 官方本身要求 `20.19+` / `22.12+`
- 降级 Node 既不能解释当前症状，也与项目技术约束冲突

## Validation

修复后，在默认 shell 仍解析到 `node v16.17.0` 的前提下，以下命令都应可执行通过：

```bash
bash scripts/env-check.sh
npm run typecheck
npm run lint
bash scripts/lint-arch.sh
npm test
npm run test:coverage
npm run build
bash scripts/ci.sh
```

关键点在于：项目级 npm 脚本会自行切到可用的 Node runtime，而不再依赖调用者手工先执行 `nvm use 22`。
