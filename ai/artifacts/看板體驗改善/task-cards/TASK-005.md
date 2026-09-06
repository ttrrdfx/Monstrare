# AI-Ready 任務卡

## Metadata
- 任務：串接前端自動同步與編輯保護
- 上層規格：`feature-spec.md`
- 上層 Epic：看板體驗改善
- 上層 User Story：任務卡即時同步
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-004
- 狀態：待驗證／審查
- 風險等級：中
- Agent owner：Codex
- 人工核准者：使用者（2026-09-07 指示開始 TASK-005）

## 目標
串接 EventSource，讓看板、藍圖、WIP 與 modal 在外部變更後安全更新，並保護未儲存輸入。

## 情境包（Context Pack）
- 相關檔案：`tools/kanban/index.html`、TASK-004 SSE 契約。
- 既有模式：`loadAll()`、`renderAll()`、blur 即時儲存、toast。
- 假設：EventSource 由瀏覽器自動重連。
- 未知事項：無。
- 允許變更的檔案：`tools/kanban/index.html`、`tools/kanban/README.md`、前端測試檔。
- 不得觸碰：Card 儲存契約與 dependsOn 防呆。

## 需求
- 連線 `/api/events`，顯示 connecting/live/reconnecting/error。
- change 事件後 debounce 重取相關資源，並以 request sequence 防止亂序。
- modal dirty 時不重繪輸入；儲存或關閉後套用最新資料。

## 驗收標準
- 外部完成卡片後 3 秒內，多頁籤的欄位、WIP、藍圖進度均更新。
- server 中斷後顯示警示，重啟後自動恢復與完整同步。
- 標題/內容輸入在 blur 前不被外部事件覆寫；寫入失敗時回復 server 狀態。

## 實作備註
更新通知不等於資料 payload；重取 GET 維持 server 單一事實來源。

## 驗證契約
- 單元測試：dirty 判定、request sequence、event coalescing。
- 整合測試：EventSource 狀態、loadAll/renderAll 串接。
- E2E 測試：兩頁籤、server restart、dirty modal。
- 型別檢查：不適用。
- Lint：不適用。
- Build：啟動本機 server。
- 螢幕截圖：live/reconnecting/error。
- 安全性檢查：event data 必須 JSON parse 失敗安全；不將 payload 當 HTML。

## 完成證據
- 變更的檔案：`tools/kanban/index.html`、`tools/kanban/realtime-sync.test.mjs`、`tools/kanban/README.md`
- 執行過的指令：同步、SSE 與藍圖測試、module script / server 語法檢查、`git diff --check`
- 測試輸出：15/15 通過；瀏覽器 dirty modal 與 server restart 驗證通過
- 螢幕截圖：完整桌面／行動矩陣由 TASK-006 產出；本卡以瀏覽器即時檢視驗證 live/reconnecting 與恢復流程
- 已知限制：不做字段級協同編輯
- 後續任務：TASK-006
