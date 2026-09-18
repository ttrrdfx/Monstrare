# AI-Ready 任務卡

## Metadata

- 任務：完成升級 E2E、文件與發布驗證
- 上層規格：`ai/artifacts/Monstrare 版本升級機制/feature-spec.md`
- 上層 Epic：Monstrare 版本升級機制
- 上層 User Story：US-5 驗證升級，並覆蓋 US-1 至 US-4 整體驗收
- 分軌：不適用
- 前置任務（dependsOn）：TASK-009、TASK-010、TASK-011、TASK-012
- 狀態：實作與自動驗證完成，等待人工驗收
- 風險等級：中
- Agent owner：Codex
- 人工核准者：使用者（2026-09-15，核准架構與任務卡；實作另開新 session）

## 目標

用可重現 fixture 證明新安裝、legacy 探測、dry-run、衝突保護、升級、回復與 migration 契約，並完成雙語操作與發布文件。

## 情境包（Context Pack）

- 相關檔案：本 Epic 全部實作與規格、`README.md`、`README en_us.md`、`package.json`、`scripts/check-governance.sh`。
- 既有模式：`npm test`、`npm run check`、Node `node:test`、臨時 `KANBAN_ROOT`／動態 port。
- 假設：驗證不修改真實下游專案或作用中看板資料。
- 未知事項：實際專案試跑由人工在架構核准後選擇；自動驗證不依賴它。
- 允許變更的檔案：`test/monstrare/**`、`package.json` 測試入口、治理檢查、雙語 README、本 Epic verification 報告、範圍內 defect 檔。
- 不得觸碰：真實 cards/epics、無關產品檔、既有客製內容。

## 需求

- 建立 pre-upgrader stock fixture、客製衝突 fixture、project-data fixture 與 migration fixture。
- 建立 feature-spec 驗收標準到測試／人工證據的矩陣。
- `verify <project>` 執行適用的 governance、看板測試與語法檢查，或清楚回報缺少的專案腳本。
- 更新中英文文件：取得新版 source、status、dry-run、upgrade、verify、衝突、備份與回復。
- 記錄 source release checklist：更新版本、baseline、測試、文件與 tag，不自動發布。

## 驗收標準

- feature spec 每項驗收條件都有通過證據或明確失敗紀錄。
- `npm test`、`npm run check` 涵蓋既有 17 項看板測試與全部升級器測試。
- stock legacy fixture 可升級且保留 cards/epics/context/artifacts checksum。
- 客製 fixture 在 dry-run 與 apply 都不覆寫衝突檔。
- fault injection 證明失敗回復與 manifest-last 契約。
- 雙語文件的指令可複製執行，本機連結存在。

## 實作備註

若驗證發現範圍內 defect，可修正其擁有卡片的檔案；不得藉此擴張成遠端下載、批次派送或自動 merge。

## 驗證契約

- 單元測試：執行全部 manifest、plan、transaction、migration tests。
- 整合測試：新安裝、legacy、衝突、no-op、升級、回復與 verify 命令。
- E2E 測試：升級保有資料的 fixture，啟動新版 server，GET cards/epics 並執行 API smoke test。
- 型別檢查：不適用。
- Lint：不適用。
- Build：`node --check` 全部 CLI/server modules、`bash -n` scripts。
- 螢幕截圖：升級器本身不適用；若看板 runtime 未改，不重做 UI 截圖。
- 安全性檢查：執行惡意路徑、symlink、manifest、lock、TOCTOU 與輸出隱私測試。

## 完成證據

- 變更的檔案：`scripts/lib/verify.mjs`、`scripts/monstrare.mjs`、`scripts/check-syntax.sh`、`scripts/check-governance.sh`、`monstrare-package.json`、`package.json`、`test/monstrare/fixtures*`、`test/monstrare/verify.test.mjs`、`test/monstrare/e2e.test.mjs`、`test/monstrare/documentation.test.mjs`、範圍內既有測試、雙語 README、搜尋指南與本卡驗證報告。
- 執行過的指令：針對性 `node --test`、`npm run check`、`git diff --check`。
- 測試輸出：完整回歸 78/78、Node/shell syntax、governance kit check 全部通過；legacy 升級後 CLI verify 與 GET/POST/DELETE API smoke 通過。
- 螢幕截圖：不適用。
- 已知限制：`verify` 執行信任 checkout 內的程式碼而非 sandbox；legacy fixture 需 Git object `7749c12`；斷電／`SIGKILL` 與極小同使用者 TOCTOU 視窗需依 backup/journal 人工處理；未對外部真實下游專案試跑。
- 後續任務：人工驗收實際下游 dry-run，核對 release diff 後再由維護者建立 tag；不自動發布。
