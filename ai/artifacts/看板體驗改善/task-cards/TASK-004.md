# AI-Ready 任務卡

## Metadata
- 任務：建立 server 即時變更事件流
- 上層規格：`feature-spec.md`
- 上層 Epic：看板體驗改善
- 上層 User Story：任務卡即時同步
- 分軌：後端
- 前置任務（dependsOn）：TASK-001
- 狀態：完成
- 風險等級：中
- Agent owner：Codex
- 人工核准者：使用者（2026-09-06 指示開始 TASK-004）

## 目標
新增可通知 cards/epics 變更的 SSE 事件流，包含直接檔案修改、合併通知與斷線清理。

## 情境包（Context Pack）
- 相關檔案：`tools/kanban/server.mjs`、`tools/kanban/README.md`、`architecture-plan.md`。
- 既有模式：Node 內建 `http`/`fs`，只 bind `127.0.0.1`，零套件。
- 假設：檔案事件只作 invalidation，不依賴單一平台的 event shape。
- 未知事項：無。
- 允許變更的檔案：`tools/kanban/server.mjs`、`tools/kanban/README.md`、server 測試檔。
- 不得觸碰：現有 API 輸入輸出、Card schema、bind host。

## 需求
- 新增 `GET /api/events`，送 `ready`、`change`、heartbeat comment。
- 偵測 `cards/` 與 `epics.json`，debounce 後合併 `resources`。
- request close 時移除 client；server close/error 時清理 watcher、timer 與 response。

## 驗收標準
- POST/PUT/bulk/DELETE、直接修檔與 git 替換檔案都會觸發通知。
- 連續檔案事件被合併，但 cards 與 epics 資源類型不遺失。
- 斷線 client 不再接收寫入，server 可平順關閉。

## 實作備註
SSE 不傳完整 card，client 以 GET 重取；避免 watcher 路徑來自請求輸入。

## 驗證契約
- 單元測試：debounce/resources 合併。
- 整合測試：SSE 格式、六種變更路徑、client cleanup。
- E2E 測試：後續 TASK-005/006。
- 型別檢查：不適用。
- Lint：不適用。
- Build：`node --check tools/kanban/server.mjs`。
- 螢幕截圖：不適用。
- 安全性檢查：仍只 bind localhost；無動態路徑讀取；限制 event payload。

## 完成證據
- 變更的檔案：`tools/kanban/server.mjs`、`tools/kanban/server-events.test.mjs`、`tools/kanban/README.md`
- 執行過的指令：`node --test tools/kanban/server-events.test.mjs tools/kanban/roadmap-data.test.mjs`、`node --check tools/kanban/server.mjs`、`git diff --check`
- 測試輸出：12/12 測試通過，語法與 whitespace 檢查通過
- 螢幕截圖：不適用
- 已知限制：只通知同一本機 server 的 client
- 後續任務：TASK-005
