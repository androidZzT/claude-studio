# harness-studio

harness-studio 是 Claude Code 的可视化编排平台。它直接读写 `~/.claude/` 与项目内 `.claude/`，提供 Agent、Workflow、Skill、Rule、MCP、Hook 的可视化管理，以及工作流 DAG 编排能力。

## 核心定位

- **不替代 Claude Code 运行时**，只生产 Claude Code 能理解的文件
- `.claude/` 是唯一数据源，GUI 和 Claude Code 共享同一份配置
- 目标用户：Claude Code 用户与 Agent 工作流设计者

## 技术栈

- **前端**：React + React Flow v12 + Monaco Editor
- **Web 应用**：Next.js App Router + API Routes
- **共享核心**：`packages/studio-core`，封装文件读写、项目扫描、工作流解析、执行编排等逻辑
- **VS Code 插件**：`extensions/vscode`，提供本地打包 webview 与 extension host bridge
- **语言**：TypeScript

## 当前架构

### Web 版

```text
┌─────────────────────────────────┐
│  React UI + React Flow          │
├─────────────────────────────────┤
│  Next.js API Routes             │
├─────────────────────────────────┤
│  studio-core                    │
├─────────────────────────────────┤
│  ~/.claude/ + project/.claude/  │
├─────────────────────────────────┤
│  Claude Code runtime            │
└─────────────────────────────────┘
```

### VS Code 插件

```text
┌─────────────────────────────────┐
│  VS Code Webview UI             │
├─────────────────────────────────┤
│  Extension Host bridge          │
├─────────────────────────────────┤
│  studio-core                    │
├─────────────────────────────────┤
│  ~/.claude/ + project/.claude/  │
└─────────────────────────────────┘
```

- `webview` 模式默认不依赖外部本地服务
- extension host 负责 bridge API、文件访问、watch 与 execution stream
- 插件打包时会带上本地 webview 所需的静态资源

## 资源模型

| 资源 | 路径 | 格式 | GUI 操作 |
|------|------|------|---------|
| Agent | `.claude/agents/*.md` | MD + YAML frontmatter | 编辑角色定义、权限与提示词 |
| Workflow | `.claude/workflows/*.md` | Markdown 文件中保存 YAML 内容 | 拖拽编排 DAG |
| Skill | `.claude/skills/<name>/SKILL.md` | MD + YAML frontmatter | 编辑触发词与说明 |
| Rule | `.claude/rules/**/*.md` | 纯 MD | 分类管理与编辑 |
| MCP | `.claude/settings.json` → `mcpServers` | JSON | 连接管理 |
| Hook | `.claude/settings.json` → `hooks` | JSON | 事件绑定 |

## 工作流格式

工作流保存为 `.claude/workflows/*.md`，文件承载 Markdown，但核心结构是 Claude Code 可理解的 YAML 内容。

```yaml
name: 小红书日常运营
description: 每日自动化运营流程
version: 1

nodes:
  - id: login-check
    agent: xhs-ops-operator
    task: 检查登录态

  - id: comment-patrol
    agent: xhs-ops-operator
    task: 巡查评论并自主回复
    depends_on: [login-check]

  - id: ai-trends
    agent: xhs-ops-operator
    task: AI 热点调研
    depends_on: [login-check]

  - id: content-draft
    agent: xhs-ops-operator
    task: 写草稿并生成配图
    depends_on: [comment-patrol, ai-trends]

  - id: image-review
    agent: commander
    task: 审核配图质量
    depends_on: [content-draft]
    checkpoint: true

  - id: publish
    agent: xhs-ops-operator
    task: 发布到小红书
    depends_on: [image-review]
```

## UI 布局

```text
┌──────────────────────────────────────────────┐
│  harness-studio                        [设置] │
├────────┬─────────────────────┬───────────────┤
│        │                     │               │
│ 资源   │   Workflow DAG      │   属性面板     │
│ 面板   │   (React Flow)      │   (编辑器)     │
│        │                     │               │
│ Agents │   [拖拽节点编排]     │  节点 / 资源   │
│ Skills │                     │  详细配置      │
│ Rules  │                     │  MD / YAML 编辑│
│ MCPs   │                     │               │
│ Hooks  │                     │               │
│        │                     │               │
├────────┴─────────────────────┴───────────────┤
│ 状态栏：项目路径 | watch 状态 | 扩展桥接状态   │
└──────────────────────────────────────────────┘
```

## API 与职责边界

- `src/app/api/*`：Web 入口层，只负责 request/response 与错误映射
- `packages/studio-core/src/*`：共享业务逻辑与文件系统能力
- `extensions/vscode/src/extension.ts`：VS Code bridge、commands、webview 生命周期

常见 API：

```text
GET    /api/resources
GET    /api/resources/:type
GET    /api/resources/:type/:id
PUT    /api/resources/:type/:id
POST   /api/resources/:type
DELETE /api/resources/:type/:id

GET    /api/projects
POST   /api/projects/open
POST   /api/projects/create

GET    /api/settings
PUT    /api/settings

GET    /api/watch
POST   /api/execute
GET    /api/execute/:id
GET    /api/execute/:id/stream
POST   /api/execute/:id/checkpoint/:nodeId
POST   /api/execute/:id/cancel
```

## 开发命令

```bash
npm install
npm run dev
npm run build
npm run core:build
npm run vscode:build
npm run vscode:watch
```

## 开发规范

- 保持不可变数据更新模式
- 文件写入前先读取并校验，避免覆盖 Claude Code 正在使用或修改的内容
- 复杂文件操作优先沉入 `studio-core`
- Web 层和 VS Code 插件层尽量复用 `studio-core`，避免复制逻辑
- 前端组件过大时及时拆分，控制认知复杂度
- 对用户可见的工作流文件，以 Claude Code 实际可消费的格式为准
