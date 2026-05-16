1. ../goose2 的主要变动

  总量：73 files changed, 2391 insertions(+), 2311 deletions(-)。

  核心变动按主题看：

  - Agents CRUD / sources 迁移
      - 新增 builtin-sources/agents/{ralph,scout,solo}.md
      - 删除大量 Tauri personas 逻辑：src-tauri/src/services/personas.rs、src-tauri/src/types/agents.rs 等
      - src/shared/api/agents.ts 从 Tauri invoke("list_personas") 改为 ACP GooseSources*
      - Avatar 从 url | local 简化为只存 URL/data/file URL
      - Persona 新增 writable
      - UI 根据 writable === false 限制编辑、删除、分组展示
  - 设置页从 Modal 移入 App Shell
      - 删除 SettingsModal.tsx、AboutSettings.tsx、AppearanceSettings.tsx、CompactionSettings.tsx
      - 新增 SettingsView.tsx、settingsSections.ts
      - AppShell 新增 settings view，并支持 /settings?section=...
      - Sidebar 新增设置二级导航和返回主导航
      - GeneralSettings.tsx 合并了原来的 appearance、general、compaction、about 等内容
  - Sidebar / Context Panel 打磨
      - Sidebar 默认宽度从 240 调整到 300，最小宽度到 220
      - 新增 src/shared/constants/panels.ts
      - Context panel widgets 变成可折叠 section，并持久化展开状态
      - Widget.tsx 视觉结构从 card 改成 section header
      - WorkspaceWidget、ChangesWidget、ArtifactsWidget 字号、间距、分隔线调整
  - Onboarding 修复
      - Provider catalog 异步加载后会重新计算 onboarding readiness
      - 修复 provider setup rows 在 catalog 后加载时不更新的问题
      - 更新相关测试
  - MCP App 修复
      - McpAppView.tsx 新增 hostCapabilities 推导，避免 host capabilities 广告不准确
  - Provider settings i18n
      - ModelProviderPanels.tsx、ModelProviderRow.tsx 去掉硬编码英文
      - common.json / settings.json 增加 add/connect/saving/saved 和 provider error 文案
  - 样式
      - globals.css 新增 streamdown inline code 样式
  - 开发工具 / Tauri
      - justfile 和 scripts/start-dev-vite.sh 处理 Vite 端口冲突复用
      - Tauri 依赖 bump、src-tauri 清理和配置调整

  2. 建议同步到 goose2web 的内容

  优先同步：

  - MCP App 修复
      - src/features/chat/ui/McpAppView.tsx
      - 这是纯前端修复，基本可以直接同步。
  - Onboarding 修复
      - src/features/onboarding/hooks/useOnboardingGate.ts
      - src/features/onboarding/hooks/useOnboardingProviderStep.ts
      - 对应测试和 onboarding.json 文案
      - 这是实际 bugfix，且不依赖 Tauri。
  - Provider settings i18n
      - ModelProviderPanels.tsx
      - ModelProviderRow.tsx
      - shared/i18n/locales/{en,es}/common.json
      - shared/i18n/locales/{en,es}/settings.json
      - 纯前端改进，值得同步。
  - inline code 样式
      - src/shared/styles/globals.css
      - 小改动，低风险。

  建议选择性同步：

  - Agents CRUD 相关 UI 语义
      - writable 字段、只读判断、Persona 分组、Picker/Mention 图标逻辑值得同步。
      - 但不要整文件覆盖 src/shared/api/agents.ts：上游现在走 ACP sources，而当前 goose2web 走 gooseServeHttp /
        personas。应按当前 web 后端 API 适配。
      - AvatarDropZone 上游改为 data URL/file URL，不再调用 avatar 保存接口；当前项目还有 /personas/avatar/save-
        bytes。如果 web 后端不想保存头像文件，可以同步；如果后端仍负责头像存储，就不要直接套。
  - Context Panel / Widget UI polish
      - 可折叠 section、布局和样式值得同步。
      - 风险中等，因为会影响多个 chat widget 和测试，但不依赖 Tauri。
  - Sidebar polish
      - SidebarProjectsSection、SidebarRecentsSection、部分 Sidebar 样式和 section visibility 可以同步。
      - 但当前 goose2web 的 Sidebar 已加入 backend server UI，这是本项目特有逻辑，不能整文件覆盖。

  谨慎同步 / 取决于产品目标：

  - 设置页移入 App Shell
      - 如果你希望 goose2web 跟最新 goose2 UI 完全一致，应同步这一整组：AppShell.tsx、AppShellContent.tsx、
        Sidebar.tsx、SettingsView.tsx、settingsSections.ts、GeneralSettings.tsx、SettingsPage.tsx、page-
        shell.tsx、相关 i18n。
      - 如果当前 web 版继续用 settings modal，这组不是必须，而且改动面大。

  不建议同步：

  - src-tauri/**
  - src-tauri/Cargo.*
  - src-tauri/tauri.conf.json
  - Tauri personas 删除/清理
  - tests/e2e/fixtures/tauri-mock.ts
  - scripts/start-dev-vite.sh 和上游 justfile 的 Tauri dev 逻辑，除非你也遇到相同 Vite 端口冲突问题
  - builtin-sources/agents/*.md，除非当前 web 项目也负责打包内置 agents

  结论：最值得先同步的是 MCP App 修复、Onboarding 修复、provider settings i18n、inline code 样式。Agents 和
  Sidebar/Context Panel 可以做“人工增量移植”。设置页 App Shell 化是大 UX 改造，建议单独作为一项迁移处理。