# AI-Ready 任務卡

## Metadata

- 任務：實作交易式升級、備份與失敗回復
- 上層規格：`ai/artifacts/Monstrare 版本升級機制/feature-spec.md`
- 上層 Epic：Monstrare 版本升級機制
- 上層 User Story：US-3 安全升級、US-4 保護客製內容
- 分軌：不適用
- 前置任務（dependsOn）：TASK-009、TASK-010
- 狀態：已完成
- 風險等級：中
- Agent owner：Codex
- 人工核准者：使用者（2026-09-15，核准架構與任務卡；實作另開新 session）

## 目標

安全套用無衝突的 add/update/remove 計畫，在失敗時回復已碰觸檔案，並只於成功後更新安裝 manifest。

## 情境包（Context Pack）

- 相關檔案：TASK-009 install primitive、TASK-010 upgrade plan、architecture-plan 的寫入／備份契約。
- 既有模式：使用者最終以 git review/commit；工具不得執行破壞性 git 指令。
- 假設：備份與 staging 位於同一 target filesystem，可使用 rename 做逐檔原子替換。
- 未知事項：不同檔案系統的權限保留差異，以 Node 支援平台的整合測試與明確殘留風險處理。
- 允許變更的檔案：upgrade apply／transaction／backup helper、CLI upgrade 路徑、相關整合測試。
- 不得觸碰：migration 邏輯、無關檔案、未列於 plan 的 target 路徑、git index/history。

## 需求

- 有 conflict 或有效 lock 時，在任何 target 寫入前停止。
- 建立範圍限定的 lock、backup、staging 與交易 journal。
- 依 plan 套用 add/update/remove；remove 也必須先備份。
- 寫入前後驗證來源與 target hash，避免 plan 產生後被競態修改。
- 任一步驟失敗時回復本次已碰觸檔案；新 manifest 最後原子寫入。
- 不自動刪除備份、不執行 git reset/clean/commit。

## 驗收標準

- 無衝突 fixture 升級後 managed 檔案與來源一致，project-data checksum 不變。
- 衝突 fixture 零寫入、無半成品 manifest。
- 模擬每個寫入階段失敗後，原檔案與舊 manifest 均可回復。
- 上游刪除的未修改 managed 檔案會移除且可由備份找回。
- plan 後被外部修改的檔案觸發競態錯誤，不覆寫新內容。
- 成功與失敗均正確處理 lock，失敗證據與備份位置清楚。

## 實作備註

多檔案無全域原子性；以 journal、逐檔 temp+rename、manifest-last 與自動 failure rollback 達成可驗證的一致性。

## 驗證契約

- 單元測試：journal state、lock、backup mapping、apply ordering、rollback ordering。
- 整合測試：add/update/remove、conflict、stale plan、各階段 fault injection、重複升級 no-op。
- E2E 測試：從舊版 fixture 升級後讀取既有 cards/epics 並啟動看板。
- 型別檢查：不適用。
- Lint：不適用。
- Build：所有 `.mjs` 語法檢查。
- 螢幕截圖：不適用。
- 安全性檢查：lock 路徑、備份逃逸、symlink swap、TOCTOU 與未授權 remove 測試。

## 完成證據

- 變更的檔案：`scripts/lib/transaction.mjs`、`scripts/lib/plan.mjs`、`scripts/monstrare.mjs`、`test/monstrare/transaction.test.mjs`、`test/monstrare/cli.test.mjs`、`ai/context/code-search-guide.md`。
- 執行過的指令：`node --test test/monstrare/transaction.test.mjs test/monstrare/cli.test.mjs`、`npm run check`、以 shell loop 對所有相關 `.mjs` 執行 `node --check`、`git diff --check`。
- 測試輸出：Task 11 針對性測試 18/18 通過；完整檢查 61/61 通過，governance kit check passed。
- 螢幕截圖：不適用。
- 已知限制：Node.js 沒有 `openat` 型別 API，`lstat` 與 `rename` 間仍有同一使用者主動置換路徑的極小 TOCTOU 視窗；突發斷電或 `SIGKILL` 需依保留的 journal／backup 人工復原，既有 lock 採保守策略不自動移除。
- 後續任務：TASK-012、TASK-013。
