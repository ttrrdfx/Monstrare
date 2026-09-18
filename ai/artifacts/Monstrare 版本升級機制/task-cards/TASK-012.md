# AI-Ready 任務卡

## Metadata

- 任務：建立受限的跨版本 migration 框架
- 上層規格：`ai/artifacts/Monstrare 版本升級機制/feature-spec.md`
- 上層 Epic：Monstrare 版本升級機制
- 上層 User Story：US-3 安全升級、US-4 保護客製內容
- 分軌：不適用
- 前置任務（dependsOn）：TASK-011
- 狀態：完成
- 風險等級：中
- Agent owner：Codex
- 人工核准者：使用者（2026-09-15，核准架構與任務卡；實作另開新 session）

## 目標

建立可排序、可檢查、限制檔案範圍且納入同一備份／回復交易的 migration registry，不新增沒有實際需求的資料 migration。

## 情境包（Context Pack）

- 相關檔案：TASK-008 SemVer API、TASK-011 transaction/journal、Card/Epic schema 文件。
- 既有模式：cards/epics 是 git tracked 單一事實來源，server 邊界驗證格式。
- 假設：第一版可能沒有實際 migration，但升級器需能明確拒絕缺少 migration 的不相容版本。
- 未知事項：第一個需要資料 migration 的版本差異尚未出現。
- 允許變更的檔案：`scripts/migrations/*.mjs`、migration runner、registry tests 與專用 fixtures。
- 不得觸碰：實際 production cards/epics、未宣告 migration 範圍、一般 managed 檔案分類邏輯。

## 需求

- migration 宣告 id、from/to、允許路徑與 check/apply 契約。
- runner 依版本連續排序，不允許缺口、重複 id、循環或跨越未知版本。
- check 回傳 needed/already-applied/incompatible，apply 必須可重跑或對已完成狀態 no-op。
- migration 寫入必須使用 TASK-011 transaction、backup 與 journal。
- 涉及 cards/epics 時先備份完整受影響資料並通過新版 schema 驗證。

## 驗收標準

- 空 registry 對無 schema 差異升級為 no-op。
- 缺少必要 migration 的版本鏈在寫入前失敗。
- 測試 migration 可成功執行、再次執行 no-op，失敗時完整回復。
- migration 嘗試寫入允許範圍外路徑時被拒絕。
- cards/epics migration fixture 在成功後可由新版 server 讀取，原始資料可從備份復原。

## 實作備註

測試用 migration 不配送成有效 production migration；registry 可用 dependency injection 載入 fixture。

## 驗證契約

- 單元測試：版本鏈排序、缺口、重複、check 狀態、允許路徑。
- 整合測試：idempotent migration、失敗 rollback、資料備份、schema 驗證。
- E2E 測試：測試 migration 後啟動新版 server 讀取 fixture。
- 型別檢查：不適用。
- Lint：不適用。
- Build：migration 與 runner `.mjs` 語法檢查。
- 螢幕截圖：不適用。
- 安全性檢查：migration scope escape、symlink、惡意 id/version 與未備份資料寫入。

## 完成證據

- 變更的檔案：`scripts/lib/migrations.mjs`、`scripts/migrations/index.mjs`、`scripts/lib/transaction.mjs`、`monstrare-package.json`、`scripts/check-governance.sh`、`test/monstrare/migrations.test.mjs`、`ai/context/code-search-guide.md`、TASK-012 任務與驗證證據。
- 執行過的指令：`node --test test/monstrare/migrations.test.mjs test/monstrare/transaction.test.mjs`、`npm run check`、相關 `.mjs` 的 `node --check`、`git diff --check`。
- 測試輸出：針對性測試 23/23、完整回歸 71/71 通過；governance kit check passed。
- 螢幕截圖：不適用。
- 已知限制：production migration 是受信任 source code；context 可限制及追蹤宣告 scope，但 Node.js 無法沙箱惡意 module 對 scope 外直接呼叫 `fs`。空 registry 代表無 schema 差異，未來 schema 變更必須由 release author 登錄完整鏈。程序遭 `SIGKILL` 或斷電時仍需用保留的 backup／journal 人工復原。
- 後續任務：TASK-013。
