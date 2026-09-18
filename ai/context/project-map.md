# 專案地圖

狀態：已更新（2026-09-15）。

## 產品

- 名稱：Monstrare
- 使用者：使用 Claude Code、Codex 或其他 coding agent 的開發者與團隊。
- 核心工作流程：需求收件 → 情境探索 → 規格／UI 選型 → 架構與任務卡 →
  實作 → 驗證／審查 → 人工驗收；小型明確工作依 `AGENTS.md` 可走精簡流程。

## 技術棧

- 前端：單檔 HTML/CSS/JavaScript（ES module），無框架。
- 後端：Node.js 內建 `http`、`fs`、`path`、`child_process` 模組。
- 資料庫：無；看板以 `tools/kanban/cards/*.json` 與 `epics.json` 為資料源。
- 身分驗證：無；server 僅 bind `127.0.0.1`，預設作者取自 `git config user.name`。
- 測試：Node.js `node:test`、shell 治理檔案自我檢查、瀏覽器視覺驗證。
- 部署：不提供 production deployment；可複製／安裝到其他 git 專案。

## 重要目錄

| 路徑 | 用途 | 備註 |
|---|---|---|
| `AGENTS.md` / `CLAUDE.md` | Agent 入口與工作規則 | 目前要求優先 |
| `ai/process/` | 共用流程、DoR/DoD 與 review gates | 套件擁有 |
| `ai/skills/` | Claude/Codex skill 的共用正本 | stub 會指向這裡 |
| `ai/context/` | 專案、架構、設計系統與搜尋知識 | 專案擁有 |
| `ai/artifacts/` | 已完成規格、task、mockup 與驗證證據 | 不屬於作用中 backlog |
| `tools/kanban/` | 本機治理看板、JSON API 與 SSE | 零 production dependency |
| `scripts/` | 安裝器與治理自我檢查 | Bash |

## 常用指令

| 指令 | 用途 | 備註 |
|---|---|---|
| `npm run kanban` | 從 `127.0.0.1:4420` 啟動看板 | port 被占用時依序遞增；可用 `KANBAN_PORT` 覆寫起始 port |
| `npm test` | 執行全部看板測試 | 使用 `node:test` |
| `npm run check` | 測試、server 語法與治理檔案檢查 | 交付前執行 |
| `scripts/install-into-project.sh <path>` | 安裝 Monstrare 到既有專案 | 不覆寫專案擁有的 context/artifacts |
