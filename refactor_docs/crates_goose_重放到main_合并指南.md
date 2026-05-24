## 目标
- 方向：从 `main` 新分支，按提交顺序重放 `goose2web` 的后端改动。
- 范围：仅 `crates/goose`。
- 基线：`main..goose2web`。
- 约束：本文不讨论 `crates/goose-server`，所有决策仅基于 `crates/goose`。

## 合并主旨
1. `main` 是基座，`goose2web` 改动以“能力迁移”方式叠加。
2. 保留 `goose2web` 的核心架构：runtime 与 WS 解耦、session event bus、streamable HTTP backend。
3. 冲突不机械选 `ours/theirs`，按能力落点重放。

## 已确认的架构决策（锁定）
1. `serve` 与 ACP 共用同一 secret/middleware 语义
- 维持 `acp/transport/mod.rs` 的统一鉴权入口，不拆分 `serve` 的鉴权路径。

2. 共享 agent + runtime/WS 解耦全覆盖
- 保持 `AcpServer` 共享 agent（`OnceCell`）模式。
- 保持 runtime 与 WS 传输层解耦，不回退到耦合实现。

3. event-bus 作为唯一分发主线
- 会话消息/工具更新统一经 `SessionEventBus` 分发与重放。
- 不引入并行的“直推通知主路径”，避免双轨语义漂移。

4. extension 会话状态采用运行态语义，并保留 main 增量功能
- `on_get_session_extensions` 采用 goose2web 的运行态返回（`Starting/Failed/Stopped/Running`）。
- 同时保留 main 在同文件中的隐藏扩展过滤能力（`on_get_extensions` 过滤 `is_hidden_extension`）。

## 提交清单（按时间）
1. `f476ecb0` 前端提取且密钥可用版
2. `d5c209fa` merge（可跳过）
3. `9cfc2961` 修复中文输入容易误发消息，以及goose2改动同步
4. `9e09121d` merge settingpage and add prompt edit on setting
5. `62013e54` add bashprehook modify
6. `fc335573` add recepe and extension detail
7. `6e35584f` http stream配置新增启动共享http后端能力，前端聊天窗口显示当前支持的extension
8. `b09d4046` decouple session runtime from ws and add runtime event bus

## 分组合并建议

### B1 Serve/API 基础能力（中）
- commits：`f476ecb0`、`9cfc2961`、`9e09121d`
- 主要文件：`serve/*`、`acp/transport/mod.rs`
- 理由：HTTP 接口层与少量同步修复，先作为底座。

### B2 Hook 与 Sources 增量（小-中）
- commits：`62013e54`、`fc335573`
- 主要文件：`hooks/mod.rs`、`agents/agent.rs`、`sources.rs`
- 理由：能力点独立，便于早期验证。

### B3 Streamable HTTP + Extension 联动（中-大）
- commits：`6e35584f`
- 主要文件：`acp/server.rs`、`acp/server/extensions.rs`、`agents/extension_manager.rs`、`agents/streamable_http_backend.rs`
- 理由：前后端联动主链路之一。

### B4 Runtime/WS 解耦与 Event Bus（大，高风险）
- commits：`b09d4046`
- 主要文件：`acp/session_events.rs`、`acp/server*.rs`、`acp/transport/*`、`session_manager.rs`
- 理由：架构级改动，冲突概率最高，必须最后单独处理。

## 建议顺序
1. B1
2. B2
3. B3
4. B4

## 与前端衔接说明
- 本文是单分支集成流程的第一阶段（后端先行）。
- 在同一分支完成 B1-B4 后，由你手动推进前端文档 `ui_goose2web_重放到main_合并指南.md`。
- 不并行推进前后端，避免接口契约在两个方向同时漂移。

## REST 接口取舍策略（已确认）
- 以下接口能力使用 goose2web 版本（均在 `crates/goose/src/serve/*`）：
  - `/config/prompts*`：`crates/goose/src/serve/prompts.rs`
  - `/fs/*`：`crates/goose/src/serve/filesystem.rs`
  - `/git/*`：`crates/goose/src/serve/git.rs`
  - `/doctor/*`：`crates/goose/src/serve/doctor.rs`
  - `/providers/setup/agent/*`、`/providers/setup/model/authenticate`：`crates/goose/src/serve/provider_setup.rs`

## 执行模板（仅后端路径）

### 0) 准备分支
```bash
source ./bin/activate-hermit
git checkout main
git pull --ff-only
git checkout -b replay/goose2web-onto-main
```

### 1) 重放单个提交（仅 `crates/goose`）
```bash
git show --binary <sha> -- crates/goose | git apply -3 --index
git commit -s -m "chore(replay-goose): port <sha> crates/goose from goose2web"
```

### 2) 冲突处理
```bash
git status
# 手动解决冲突后
git add <resolved-files>
git commit -s -m "chore(replay-goose): port <sha> crates/goose from goose2web"
```

### 3) 跳过 merge 提交
- `d5c209fa` 是 merge 提交，路径过滤重放时通常不需要处理。

## 冲突决策矩阵（核心）
- `acp/session_events.rs`：若 main 无同名能力，优先引入 goose2web 版本。
- `acp/server.rs`：以 goose2web 的 runtime/event-bus 分发语义为主，main 改动做兼容吸收。
- `acp/server/extensions.rs`：
  - `on_get_session_extensions` 保留 goose2web 运行态语义（`Starting/Failed/Stopped/Running`）。
  - `on_get_extensions` 同时保留 main 的 `is_hidden_extension` 过滤能力。
- `acp/transport/{connection,http,websocket}.rs`：保持 runtime 与 ws 解耦，且维持 `serve` 与 ACP 共用同一 secret/middleware 语义。
- `agents/extension_manager.rs` / `streamable_http_backend.rs`：保持 streamable HTTP 能力完整，必要时适配 main 当前 trait/类型。
- `hooks/mod.rs` / `agents/agent.rs`：保留 prehook 行为语义，同时兼容 main 新 hook 事件定义。
- `serve/{prompts,filesystem,git,doctor,provider_setup}.rs`：按 goose2web 版本重放，保持前端依赖能力不丢失。

## 每组最小验证

### B1 后
```bash
source ./bin/activate-hermit
cargo fmt
cargo build -p goose
```

### B2 后
```bash
source ./bin/activate-hermit
cargo test -p goose --test acp_server_test
```

### B3/B4 后
```bash
source ./bin/activate-hermit
cargo test -p goose --test acp_server_test
cargo test -p goose --test mcp_integration_test
```

## 阶段完成判定（进入前端前）
- B1-B4 已全部完成并提交。
- 后端最小验证全部通过（见上方验证命令）。
- 已产出“接口变更摘要”，供前端阶段对照。

## 接口变更摘要模板（给前端对照）
- ACP/HTTP 接口新增或变更：
- session/runtime 事件类型或字段变化：
- tool call/status 相关字段变化：
- extension/recipe 相关返回结构变化：
- 兼容性说明（是否保留旧字段）：

## 禁止项
- 不新开第二个长期分支。
- 未完成 B4 不开始 U1。
- 前端阶段发现后端问题，回到本阶段补独立提交，不在前端阶段混改后端。

## 失败与回滚策略
- 当前提交失败：`git reset --hard HEAD`
- 若冲突复杂且方向不清：先 `git reset --hard HEAD`，记录冲突点，切换到下一小组后再回补。

## 进度与阻塞记录
- 阶段：
- 提交组：
- 关键冲突文件：
- 接口影响：
- 验证结果：
- 阻塞项/处理结论：