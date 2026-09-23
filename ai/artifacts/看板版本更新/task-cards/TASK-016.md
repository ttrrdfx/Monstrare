# AI-Ready 任務卡

## Metadata

- 任務：建立看板版本更新 API 與寫入防護
- 上層規格：`ai/artifacts/看板版本更新/feature-spec.md`
- 上層 Epic：看板版本更新
- 上層 User Story：US-2 預覽變更、US-3 阻擋不安全更新、US-4 確認並更新、US-5 了解結果
- 分軌：後端
- 前置任務（dependsOn）：TASK-015
- 狀態：完成（2026-09-21）
- 風險等級：高
- Agent owner：Codex
- 人工核准者：使用者（2026-09-21，核准架構、安全與測試契約；TASK-015 已完成）

## 目標

在本機看板 server 提供穩定、可測、fail-closed 的 status/check/apply API，只在同來源二次確認、計畫未過期且重新驗證一致時呼叫既有 transaction。

## 情境包（Context Pack）

- 相關檔案：`tools/kanban/server.mjs`、TASK-015 provider/session、`scripts/lib/plan.mjs`、`scripts/lib/transaction.mjs`、`scripts/lib/verify.mjs`、`tools/kanban/server-*.test.mjs`。
- 既有模式：`sendJson`、route dispatcher、`readBody`、`KANBAN_ROOT` 測試隔離、`.monstrare/upgrade.lock`、Node child-process server fixtures。
- 假設：`KANBAN_ROOT` 繼續只代表 `tools/kanban` 資料根；target project root 使用新的 `KANBAN_PROJECT_ROOT` 測試覆寫。
- 未知事項：無；verify 失敗後「已套用、不自動 rollback」已由架構筆記決定。
- 允許變更的檔案：`tools/kanban/upgrade-api.mjs`、`tools/kanban/server.mjs`、`tools/kanban/upgrade-api.test.mjs`、必要的 server test helper、`monstrare-package.json`。
- 不得觸碰：`tools/kanban/index.html`、真實 cards/epics、provider 核心契約、plan/transaction/verify 的已有對外語意。
- 驗證指令：`node --test tools/kanban/upgrade-api.test.mjs test/monstrare/transaction.test.mjs`、`node --check tools/kanban/server.mjs tools/kanban/upgrade-api.mjs`、`npm run check`。

## 需求

- 實作架構筆記的 `GET /api/upgrade/status`、`POST /api/upgrade/check`、`POST /api/upgrade/apply` DTO 與穩定 error envelope。
- 將 project root 與 kanban data root 分開：production 從 module root 向上推導，測試才可用 `KANBAN_PROJECT_ROOT` 明確覆寫。
- `status` 不發網路請求；`check` 不寫 target；`apply` 前重驗 asset/bundle、重新 plan 並比對 token/version/digest。
- Upgrade POST 驗證 Host、Origin、Sec-Fetch-Site、JSON content type、body size、精確 schema 與 `confirm: true`，不開 CORS。
- 加上 process-local apply mutex，並保留 transaction lock；重複請求回穩定 conflict code。
- 只回傳版本、計數、相對路徑、理由、project-relative backup path 與受限 verification summary。
- Apply 成功後呼叫 `verifyProject`；將 transaction failure/rollback failure/verify failure 映射為不同 code 與 HTTP status，不含 stack/home path。
- Server shutdown 釋放 active session temp root；新功能不影響現有 SSE/watchers 清理。

## 非目標

- 不做 UI、不發布 release、不支援遠端/LAN server。
- 不接受 client 指定 repository、tag、asset URL、sourceRoot 或 targetRoot。
- 不自動 restart server，不在 verify 失敗後自動 rollback 已 commit 交易。

## 驗收標準

- `status` 在離線狀態可回傳本機版本與 provider 資訊，測試證明沒有網路呼叫。
- `check` 對臨時 target 的內容、mtime 與 `.monstrare/` 零變更，並回傳與 planner 一致的計數/路徑。
- 非 JSON、錯誤 Host/Origin、cross-site fetch、多餘字段、缺 `confirm`、無效/過期 token 全部在 transaction 前被拒絕。
- Check 後 target/source/plan 任一變動會回 `UPGRADE_PLAN_STALE` 且零寫入。
- 並行 apply 只有一個可進入 transaction，另一個回可理解的 busy/locked error。
- Transaction success + verify success、transaction rollback、rollback failure、transaction success + verify failure 四種語意可被測試區分。
- 成功回應固定 `restartRequired: true`，不自動關閉/restart process。

## 實作備註

- 路由僅負責 HTTP 邊界；orchestration/error mapping 放 `upgrade-api.mjs`，避免繼續擴大 `server.mjs`。
- 將 request validation 寫成可獨立測試的純函式，並在任何網路/檔案動作前執行。
- 對外 message 可顯示，code 穩定；原始 error/stack 只留受限 server log，且要 redact 本機路徑。

## 驗證契約

- 單元測試：DTO/schema、plan digest/token、error/status mapping、Origin/Host/Sec-Fetch-Site/content type/body limit、mutex。
- 整合測試：子 process server + fake provider + temp project，覆蓋 status/check/apply、stale/concurrent/rollback/verify failure 與 cleanup。
- E2E 測試：不含瀏覽器，TASK-020 覆蓋。
- 型別檢查：不適用。
- Lint：不適用。
- Build：`node --check tools/kanban/server.mjs tools/kanban/upgrade-api.mjs`。
- 螢幕截圖：不適用。
- 安全性檢查：CSRF/CORS、任意來源/目標輸入、路徑洩漏、TOCTOU、並行更新、rollback 語意。

## 完成證據

- 變更的檔案：`tools/kanban/upgrade-api.mjs`、`tools/kanban/upgrade-api.test.mjs`、
  `tools/kanban/server.mjs`、`monstrare-package.json`、本任務卡、
  `ai/artifacts/看板版本更新/verification/TASK-016.md` 與
  `tools/kanban/cards/TASK-016.json`。
- 行為變更：新增離線 status、唯讀 check 與二次確認 apply API；upgrade POST
  會先驗證本機 Host/Origin、cross-site、JSON content type、8 KiB body limit 與精確
  schema；check/apply 使用單一 process mutex，apply 會重新計畫並比對 release metadata、
  plan entries、來源 inventory hash、目標 snapshot 與 install manifest hash，成功後執行
  `verifyProject` 並只回傳受限摘要。
- 執行過的指令：
  - `node --test tools/kanban/upgrade-api.test.mjs test/monstrare/transaction.test.mjs`
  - `node --check tools/kanban/server.mjs tools/kanban/upgrade-api.mjs`
  - `npm run check`
  - `git diff --check`
- 測試輸出：針對性測試 29/29 通過；完整 `npm run check` 118/118 tests 通過，
  syntax check 與 governance kit check 通過；diff whitespace check 通過。
- 螢幕截圖：不適用。
- 安全性審查：CSRF/同源、body/schema、來源與目標路徑、TOCTOU、session lifecycle、
  process/cross-process lock、rollback/verify failure 與路徑洩漏皆有契約測試；審查中發現並
  修復「內容改變但 action 不變時 digest 未變」及「check 可能替換 apply session」兩項競態。
- 已知限制：真實 GitHub release/digest/redirect staging 仍由 TASK-019／020 驗證；
  verify 失敗依核准契約不自動 rollback 已 commit 交易；browser UI 串接由 TASK-018 負責。
- 後續任務：TASK-018。
- 驗證報告：`ai/artifacts/看板版本更新/verification/TASK-016.md`。
