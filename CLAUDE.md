# harness-studio

Claude Code 的可视化编排平台。读写 `~/.claude/` 目录，提供 Agent/Workflow/Skill/Rule/MCP 的可视化管理和工作流 DAG 编排。

## 核心定位

- **不替代 CC 运行时**，只生产 CC 能理解的文件
- `.claude/` 目录是唯一数据源，GUI 和 CC 共享
- 目标用户：Claude Code 用户（开发者）

## 技术栈

- **前端**：React + React Flow v12（DAG 编辑）+ Monaco Editor（MD/YAML 编辑）
- **后端**：Next.js API Routes，纯文件系统操作，无数据库
- **语言**：TypeScript 全栈
- **运行方式**：`npx harness-studio` 启动本地服务，浏览器访问

## 架构

```
┌─────────────────────────────────┐
│  GUI (React + React Flow v12)   │  ← 拖拽编排、资源管理
├─────────────────────────────────┤
│  Next.js API Routes             │  ← 读写 ~/.claude/ 文件 + fs.watch
├─────────────────────────────────┤
│  ~/.claude/                     │  ← 真实数据源（单一事实来源）
├─────────────────────────────────┤
│  Claude Code (运行时)            │  ← 读取文件执行，平台不介入
└─────────────────────────────────┘
```

## 资源模型

| 资源 | 路径 | 格式 | GUI 操作 |
|------|------|------|---------|
| Agent | `agents/*.md` | MD + YAML frontmatter | 编辑角色定义、工具权限 |
| Workflow | `workflows/*.yaml` | YAML（新增） | 拖拽编排 DAG |
| Skill | `skills/<name>/SKILL.md` | MD + YAML frontmatter | 编辑触发词、引用文档 |
| Rule | `rules/**/*.md` | 纯 MD | 分类管理、编辑 |
| MCP | `settings.json` → mcpServers | JSON | 连接管理 |
| Hook | `settings.json` → hooks | JSON | 事件绑定 |

## 工作流描述格式

新增 `.claude/workflows/*.yaml`，CC 可直接读取理解：

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
    task: AI热点调研
    depends_on: [login-check]
    # 与 comment-patrol 同级依赖 = 并行

  - id: content-draft
    agent: xhs-ops-operator
    task: 写草稿+生成配图
    depends_on: [comment-patrol, ai-trends]

  - id: image-review
    agent: commander
    task: 审核配图质量
    depends_on: [content-draft]
    checkpoint: true  # 人工确权节点

  - id: publish
    agent: xhs-ops-operator
    task: 发布到小红书
    depends_on: [image-review]
```

## 单页面布局

一个页面包含所有功能，布局参考：

```
┌──────────────────────────────────────────────┐
│  harness-studio                          [设置]    │
├────────┬─────────────────────┬───────────────┤
│        │                     │               │
│ 资源   │   Workflow DAG      │   属性面板     │
│ 面板   │   (React Flow)      │   (编辑器)     │
│        │                     │               │
│ Agents │   [拖拽节点编排]     │  选中节点的    │
│ Skills │                     │  详细配置      │
│ Rules  │                     │  MD/YAML编辑   │
│ MCPs   │                     │               │
│ Hooks  │                     │               │
│        │                     │               │
├────────┴─────────────────────┴───────────────┤
│  状态栏：.claude/ 路径 | 文件变更监听状态      │
└──────────────────────────────────────────────┘
```

- **左侧资源面板**：树形浏览 .claude/ 下所有资源，可拖入画布
- **中间画布**：React Flow DAG 编辑区，展示工作流节点和依赖关系
- **右侧属性面板**：选中节点后显示详细配置，支持 MD/YAML 编辑

## API Routes

```
GET    /api/resources            # 列出所有资源
GET    /api/resources/:type      # 按类型列出（agents/skills/rules/workflows）
GET    /api/resources/:type/:id  # 读取单个资源
PUT    /api/resources/:type/:id  # 更新资源
POST   /api/resources/:type      # 创建资源
DELETE /api/resources/:type/:id  # 删除资源
GET    /api/watch                # SSE 文件变更推送
GET    /api/settings             # 读取 settings.json
PUT    /api/settings             # 更新 settings.json
```

## 开发规范

- 不可变数据模式：所有状态更新返回新对象
- 文件操作必须做好错误处理（文件不存在、权限不足、格式解析失败）
- 前端组件 < 200 行，超过就拆分
- API Routes 只做文件 I/O，不含业务逻辑
- 所有文件写入前先读取验证，避免覆盖 CC 正在写入的内容
