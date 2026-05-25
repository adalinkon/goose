# goose2web Cleanup Plan

## Purpose

`ui/goose2web` is the browser-only frontend extracted from the Goose2 Tauri desktop app. Its runtime target is a normal web page that connects to a remote or locally hosted `goose serve` instance over ACP WebSocket.

This document records the intended Web boundary, desktop/Tauri remnants found during audit, and a safe cleanup sequence.

## Web Boundary

### Runtime Model

- The frontend is a thin browser client.
- Backend work flows through `goose serve`, primarily over ACP WebSocket via `@aaif/goose-sdk`.
- Browser-only state such as selected backend server, auth token, theme, density, and transient UI preferences may stay in `localStorage`.
- Data, filesystem access, sessions, providers, skills, projects, and other Goose domain operations should remain backend-owned.

### Supported Browser Capabilities

- Connect to user-configured `ws://` or `wss://` Goose ACP endpoints.
- Store multiple backend server profiles and auth tokens locally.
- Use browser file APIs for user-selected local files when the feature is explicitly local-browser scoped.
- Open external HTTP/HTTPS links with browser APIs.
- Download exported data through browser download APIs.
- Render remote Goose responses, tool calls, MCP app UI, sessions, projects, skills, providers, and settings.

### Unsupported Desktop Capabilities

The Web frontend must not assume it can:

- Spawn or manage a local `goose serve` process.
- Call Tauri `invoke()` commands.
- Use Tauri plugins for file dialogs, shell commands, opener APIs, window APIs, or asset URL conversion.
- Open a remote server path in the user's local file manager.
- Reveal files in Finder/Explorer/File Manager without an explicit browser/backend-supported feature.
- Access arbitrary local filesystem paths selected as strings.
- Depend on `src-tauri`, Tauri configuration, Rust build output, or desktop bundle settings.

## Current Findings

### Low-Risk Desktop Remnants

These items are not required for the browser target and can be cleaned first:

- `README.md` still describes Goose2 as a Tauri desktop app.
- `justfile` still contains `src-tauri`, `pnpm tauri`, local `GOOSE_BIN`, desktop bundle, and worktree icon logic.
- `vite.config.ts` still has `TAURI_DEV_HOST`, Tauri HMR, and `src-tauri` watch-ignore logic.
- `biome.json` still ignores Tauri-generated paths.
- `scripts/generate-dev-icon.swift` only supports Tauri worktree icons.
- `rust-toolchain.toml` is unnecessary for a browser-only package.
- `package.json` still has a `tauri` script.
- `@tauri-apps/cli` and `@tauri-apps/plugin-shell` are present but not referenced by source code.

### Runtime Tauri Dependencies

These are still used by production code and must be migrated before removal:

- `@tauri-apps/api`
  - Window show/min-size logic.
  - Webview zoom.
  - App info in About settings.
  - `convertFileSrc` for image/file previews.
  - Tauri drag/drop handling.
- `@tauri-apps/plugin-dialog`
  - Chat attachment file/folder selection.
  - Project working directory selection.
  - Custom project icon selection.
- `@tauri-apps/plugin-opener`
  - Opening external URLs.
  - Opening local paths.
  - Revealing files in file manager.

### Test Remnants

- `tests/e2e/fixtures/tauri-mock.ts` still mocks `window.__TAURI_INTERNALS__`, Tauri invoke commands, and ACP traffic together.
- Unit tests mock Tauri modules directly in several places.
- These mocks should be renamed or split after runtime migration so tests reflect the browser target.

## Capability Decisions

### Confirmed Decisions

- File selection uses browser `<input type="file">`.
- Directory and project working directory selection uses manual remote path entry.
- Web image attachment previews stay as `blob:` URLs for browser-selected files.
- Tauri asset URL conversion is removed.
- Tauri window, webview, app info, app zoom, and desktop titlebar behavior is removed.
- `data-tauri-drag-region` and macOS traffic-light padding such as `pl-20` are removed.
- E2E tests mock ACP/WebSocket traffic and browser APIs only.
- External URL opening uses `window.open(url, "_blank", "noopener,noreferrer")`.
- Path opening locates and opens the remote file in the chat page right sidebar.
- File-manager reveal actions are removed from the frontend.

### Keep

- ACP WebSocket connection flow and `@aaif/goose-sdk` usage.
- `src/shared/api/backendConfig.ts` server profile storage.
- `src/shared/api/backendConnection.ts` connection probing.
- `src/shared/api/gooseServeHttp.ts` and filesystem helper APIs when they call `goose serve` HTTP endpoints intentionally.
- Browser download flow for session export.
- Browser-native drag/drop for real `File` objects.
- Browser `localStorage` for Web-only preferences and backend server profiles.

### Delete

Delete only after confirming no source references remain:

- Tauri CLI/package scripts.
- `src-tauri`-specific `justfile` recipes.
- Tauri dev host/HMR config in Vite.
- Tauri generated-path ignores in Biome.
- Desktop icon generation script.
- Rust toolchain marker in the Web package.
- `@tauri-apps/cli`.
- `@tauri-apps/plugin-shell`.

### Migrate

#### URL Opening

Replace direct `openUrl()` imports with a small browser adapter:

- `openExternalUrl(url: string): Promise<void>`
- Allow only `http:` and `https:`.
- Use `window.open(url, "_blank", "noopener,noreferrer")`.
- Return a clear error if the browser blocks the popup.

#### Path Opening and Reveal

Replace direct `openPath()` imports with a chat remote-file action:

- Path opening should locate the remote file in the chat page right sidebar and open it there.
- The target path is a Goose server path, not a local browser path.
- The implementation should reuse or introduce chat/sidebar state rather than calling any desktop opener API.
- If the file is not available in the right sidebar/file tree, show a user-visible failure or fallback that makes the remote-path limitation clear.

Remove file-manager reveal behavior:

- Delete `revealItemInDir()` usage.
- Delete the `revealInFileManager()` wrapper.
- Remove corresponding frontend menu items/buttons from the UI.
- Remove related translations and tests once no UI references remain.

#### File Selection

Replace Tauri file dialogs with browser file inputs:

- Chat image/file uploads can use `<input type="file" multiple>`.
- Browser files should be converted to attachment payloads using `File`, `Blob`, `FileReader`, and object URLs.
- A browser `File` does not provide a stable absolute path; do not send fake local paths to the backend.
- The file picker migration should remove `@tauri-apps/plugin-dialog` from chat file attachment flows.

#### Directory and Remote Path Selection

Replace Tauri directory dialogs with manual remote path entry:

- Browser directory picking does not produce remote Goose server paths.
- Project working directories must be typed or pasted as remote Goose server paths.
- Folder attachment selection should not use browser directory picking as a substitute for remote server paths.
- If folder attachments remain available, they should accept explicit remote paths or use a future backend-backed remote path picker.

#### Image and File Preview

Remove `convertFileSrc` and Tauri asset URL assumptions:

- Local browser-selected images use `blob:` object URLs.
- Attachment image previews should remain `blob:` URLs for browser-selected files.
- Server-side images should be read through backend APIs and rendered as `data:` or HTTP URLs only when available.
- Raw remote filesystem paths should not be used directly as `<img src>`.

#### Window and App Shell

Remove desktop shell behavior:

- Drop `getCurrentWindow().show()`.
- Drop Tauri min-size resizing.
- Remove `data-tauri-drag-region`.
- Remove macOS traffic-light padding such as `pl-20`.
- Remove Tauri webview zoom behavior.
- Remove Tauri app/window/webview imports.
- About settings should not display Tauri version.
- About settings may show Web app/package info, backend info, or build metadata.

#### Drag and Drop

Keep browser drag/drop:

- Preserve standard `DataTransfer.files` handling.
- Remove Tauri webview drag/drop event handling.
- If remote path drag/drop is required later, design it as a backend/browser feature explicitly.

## Suggested Execution Plan

### Phase 1: Documentation and Low-Risk Cleanup

Scope:

- Update `README.md` for Web usage.
- Simplify `justfile` to browser-only recipes.
- Simplify `vite.config.ts`.
- Remove desktop-only script/config files.
- Remove unused Tauri CLI/shell dependencies.
- Keep runtime Tauri dependencies until production imports are gone.

Verification:

- `pnpm typecheck`
- `pnpm build`
- `pnpm check` if dependency setup is available.

### Phase 2: Browser Platform Adapters

Scope:

- Add a browser platform adapter for external URL actions.
- Replace direct `@tauri-apps/plugin-opener` production imports.
- Update tests to mock the adapter, not Tauri.
- Replace `openUrl()` usage with `window.open(url, "_blank", "noopener,noreferrer")`.
- Replace `openPath()` usage with a chat right-sidebar remote-file open action.
- Remove `revealItemInDir()` / `revealInFileManager()` usage and delete corresponding UI.

Verification:

- `pnpm typecheck`
- Focused tests for link safety, MCP app link opening, file context menus, message attachments, and remote-file opening in the chat right sidebar.

### Phase 3: Remove Desktop Window Logic

Scope:

- Remove Tauri window show/min-size logic.
- Remove Tauri webview zoom logic.
- Remove drag-region attributes and `pl-20` desktop traffic-light padding.
- Replace About settings Tauri fields and remove Tauri version.
- Remove `@tauri-apps/api/window`, `@tauri-apps/api/webviewWindow`, `@tauri-apps/api/webview`, and `@tauri-apps/api/app` production imports.

Verification:

- `pnpm typecheck`
- Visual smoke in browser at desktop and mobile widths.

### Phase 4: File and Directory Interaction Migration

Scope:

- Convert chat file selection to browser `<input type="file">`.
- Replace directory/folder selection with manual remote path entry.
- Replace project working directory dialog with manual remote path input.
- Replace custom project icon dialog with browser file upload or remote path input.
- Remove `convertFileSrc` usage.
- Keep attachment image previews as `blob:` URLs.
- Remove remaining `@tauri-apps/plugin-dialog` and `@tauri-apps/api/core` production imports.

Verification:

- Attachment unit/component tests.
- Project create/edit tests.
- Manual remote `goose serve` smoke for chat attachments and project working directories.

### Phase 5: Test and Dependency Cleanup

Scope:

- Rename or rewrite `tauri-mock.ts` as a browser ACP/WebSocket mock.
- The E2E fixture should mock only ACP/WebSocket traffic and browser APIs.
- The E2E fixture should not define `window.__TAURI_INTERNALS__` or mock Tauri invoke commands.
- Remove all remaining `window.__TAURI_INTERNALS__` production references.
- Remove remaining `@tauri-apps/*` dependencies.
- Re-run unused dependency scan and remove confirmed unused UI libraries in a separate small change.

Verification:

- `rg "tauri|@tauri|__TAURI_INTERNALS__|data-tauri|src-tauri|pnpm tauri|TAURI_DEV_HOST" . -g '!node_modules' -g '!dist'`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test`
- E2E smoke if the browser mock is maintained.

## Risks and Guardrails

- Do not remove runtime Tauri packages until all production imports are migrated.
- Do not replace remote server paths with local browser file paths; they are different machines in the remote-vibe-code model.
- Do not add frontend business logic that should belong to Goose core or ACP.
- Do not introduce new Tauri commands or desktop-only assumptions.
- Treat browser file uploads and remote filesystem paths as separate feature concepts.
- Keep each cleanup phase small enough to verify independently.

## Open Product Questions

- Should custom project icons be uploaded into project metadata as data URLs, stored by Goose, or referenced as server-side paths?
