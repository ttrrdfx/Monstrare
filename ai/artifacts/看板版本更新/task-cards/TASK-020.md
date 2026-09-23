# AI-Ready 任務卡

## Metadata

- 任務：完成版本更新端對端、安全與視覺驗證
- 上層規格：`ai/artifacts/看板版本更新/feature-spec.md`
- 上層 Epic：看板版本更新
- 上層 User Story：US-1 至 US-5
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-018、TASK-019
- 狀態：完成（2026-09-23）
- 風險等級：高
- Agent owner：Codex
- 人工核准者：使用者（2026-09-21，核准架構、安全與測試契約；最終驗收待 TASK-018、TASK-019 完成）

## 目標

以可重跑的證據矩陣證明從 release bundle 到 Variant A 使用者旅程的完整行為、安全邊界、專案資料保留、失敗回復與視覺/無障礙規格均符合已核准規格。

## 情境包（Context Pack）

- 相關檔案：TASK-014–019 產物、`test/monstrare/e2e.test.mjs`、`test/monstrare/transaction.test.mjs`、`tools/kanban/*.test.mjs`、本 Epic feature/screen/mockup/architecture 文件。
- 既有模式：`node:test`、臨時 target、child-process server、snapshot/checksum、browser screenshot、verification report template。
- 假設：所有前置卡已通過各自驗證契約，本卡不補新功能。
- 未知事項：真實 GitHub Release 驗收若未獲得外部發布授權，以「未執行的手動 gate」記錄，不伪造證據。
- 允許變更的檔案：`test/monstrare/update-e2e.test.mjs`、`tools/kanban/upgrade-e2e.test.mjs`、測試 fixtures/helpers、`ai/artifacts/看板版本更新/verification/TASK-020.md`、純測試所需的小修正。
- 不得觸碰：真實 cards/epics/context/artifacts 內容、Git history、未授權的 GitHub tag/release、不相關 runtime。
- 驗證指令：針對性 E2E/security tests、`npm test`、`npm run check`、`git diff --check`、desktop/mobile screenshot 與鍵盤驗證。

## 需求

- 建立 fake GitHub release service/transport fixture，可決定 metadata、redirect、digest、streaming、timeout 與惡意 bundle 輸入。
- 建立可辨識舊版的臨時下游 project fixture，包含 cards/epics/context/artifacts 哨兵內容、可選的 managed conflict 與 fault injection。
- 證明 check 完全唯讀，apply 只改預期 managed 檔案，project-data checksum/mtime 保持且 backup journal 完整。
- 覆蓋 latest、available、conflict、network/rate-limit、bad redirect、digest mismatch、malicious bundle、stale plan、concurrent apply、transaction rollback/rollback failure、verify failure 與 restart-required。
- 驗證來自非同來源、非 JSON、任意 URL/path、過大 body、過期 token 的請求全部零寫入。
- 驗證 card editing、SSE sync、看板/藍圖 tabs 與現有 install/upgrade CLI 不回歸。
- 取得 1440×900 與 390×844 的 loading/available/conflict/success 核心截圖，審查無溢出、不只靠色彩與 44px 觸控目標。
- 以鍵盤驗證 focus order/trap/return、Escape/applying 行為、`aria-live`、reduced motion，並記錄瀏覽器 console 錯誤/警告。
- 產出 verification report，逐條對照 feature spec 驗收標準與 review gates，不能只寫「測試通過」。

## 非目標

- 不實作新 runtime 功能、不改變 API/bundle/UI 契約。
- 不在真實工作目錄套用更新；所有寫入測試只對明確臨時目錄。
- 沒有另行授權時，不建立或修改真實 GitHub Release。

## 驗收標準

- Feature spec 每一條驗收標準在 verification report 都有可重跑指令、結果或明確的人工 gate。
- 正常 E2E 從檢查、預覽、確認、套用、verify 到重啟後版本狀態為最新，並保留專案資料。
- 所有惡意來源、CSRF、stale/concurrent/fault injection 測試在預期邊界失敗，沒有混合版本或越界檔案。
- `npm test`、`npm run check`、所有新 `.mjs` syntax check 與 `git diff --check` 通過。
- Desktop/mobile 截圖已人工審查，而且 browser console 無本功能新增 error/warning。
- 安全性審查沒有未解決的高/中嚴重度問題；殘留風險、回復流程與未執行的真實 release gate 已記錄。

## 實作備註

- 測試必須對臨時根目錄做明確 `realpath`/哨兵驗證，不使用未解析的 `$HOME`、`~` 或 workspace root 當刪除目標。
- 跨層測試只補驗收缺口；若發現功能問題，回到擁有該核心的前置卡修正，不在本卡複製邏輯。
- 截圖與 report 不得包含本機絕對密密路徑、token 或檔案內容。

## 驗證契約

- 單元測試：重跑 TASK-014–018 全部新增單元測試，驗證無 skip/only。
- 整合測試：fake GitHub + temp downstream + 真實 server、各種惡意/故障路徑與專案資料 snapshot。
- E2E 測試：真實瀏覽器完整成功旅程、conflict、verify failure，重啟 server 後重取 status。
- 型別檢查：不適用。
- Lint：不適用；workflow 執行 static validation。
- Build：`npm run check` 與全部新 `.mjs` 的 `node --check`。
- 螢幕截圖：desktop/mobile 的 loading、available、conflict、success，加上二次確認。
- 安全性檢查：OWASP 相關邊界（CSRF、SSRF、XSS、path traversal、software/data integrity、logging）、workflow supply chain、rollback/backup。

## 完成證據

- 變更的檔案：`test/monstrare/update-e2e.test.mjs`、本卡、看板本卡與
  `ai/artifacts/看板版本更新/verification/TASK-020.md`。
- 執行過的指令：針對性跨層 E2E、`npm run check`、`git diff --check`、本機 Browser QA。
- 測試輸出：跨層 E2E 1/1、完整 137/137、syntax 與 governance 通過。
- 螢幕截圖：沿用同版 TASK-017/018 desktop/mobile loading、available、conflict、
  confirm、applying、success、verification-failed 證據；本次另實際確認真實 server 的 loading/error。
- 已知限制：本次瀏覽器控制介面未提供 console log 讀取；官方 actions Node 20 runtime
  已由 runner 強制切至 Node 24，且 ubuntu-latest 將遷移 Ubuntu 26，後續需更新 pin。
- 後續任務：無；完成後進入最終人工驗收與 merge gate。
