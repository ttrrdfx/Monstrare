# 架構地圖

狀態：已更新（2026-09-07）。

## 系統總覽

Monstrare 由「repository 內的治理文件」與「選用的本機看板」組成。
Agent 從 `AGENTS.md`／`CLAUDE.md` 進入共用流程與 skills；產出寫入
`ai/artifacts/`。看板 server 讀寫 JSON 檔，瀏覽器使用 HTTP JSON API 操作資料，
並透過 SSE 接收 invalidation 後重新讀取最新狀態。git 是跨機器持久化與同步層。

```text
Agent entrypoints → ai/process + ai/skills → ai/artifacts
                                           ↓
Browser UI ⇄ JSON API ⇄ cards/*.json + epics.json ⇄ git
     ↑            └── fs.watch → SSE change ───────┘
     └────────────────重新 GET 最新資料─────────────
```

## 邊界

| 邊界 | 負責人 | 輸入 | 輸出 | 風險 |
|---|---|---|---|---|
| Agent 治理 | repository | 使用者需求、context | 規格、task、驗證 | 規則過重或情境過時 |
| Browser UI | `index.html` | cards、epics、SSE event | 操作與 HTTP request | dirty modal、回應競態 |
| Local server | `server.mjs` | HTTP、檔案事件 | JSON、SSE、檔案寫入 | 路徑驗證、watcher 清理 |
| Data files | 專案 git | 完整 card / Epic JSON | 單一事實來源 | git merge 衝突 |
| Installer | `scripts/install-into-project.sh` | 來源套件、目標路徑 | 安裝後的治理層 | 不可覆寫專案擁有資料 |

## 應遵循的模式

- 保持零 production dependency，優先使用 Node.js 內建模組。
- JSON 檔是單一事實來源；SSE 只傳 invalidation，client 透過 GET 重取資料。
- 所有 card id、stage、risk、dependsOn 在 server 邊界驗證。
- 動態 HTML 文字必須通過 `escapeHtml`。
- UI 狀態以純函式處理，測試直接驗證資料轉換與 viewport 計算。
- context 與 artifacts 是專案擁有資料，安裝器不可覆寫。

## 應避免的模式

- 不把 SSE 當作跨網路協同服務或在事件 payload 傳完整卡片。
- 不新增資料庫、帳號或 production dependency 來處理本機工具需求。
- 不繞過 server 驗證直接由瀏覽器寫檔。
- 不在 modal dirty 時用外部更新重建表單。
- 不把已完成 artifacts 當成作用中的看板資料。
