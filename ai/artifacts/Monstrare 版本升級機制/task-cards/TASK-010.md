# AI-Ready 任務卡

## Metadata

- 任務：實作 status、dry-run 與 legacy 版本探測
- 上層規格：`ai/artifacts/Monstrare 版本升級機制/feature-spec.md`
- 上層 Epic：Monstrare 版本升級機制
- 上層 User Story：US-1 查看安裝版本、US-2 預覽升級、US-4 保護客製內容
- 分軌：不適用
- 前置任務（dependsOn）：TASK-008
- 狀態：已完成
- 風險等級：中
- Agent owner：Codex
- 人工核准者：使用者（2026-09-15，核准架構與任務卡；實作另開新 session）

## 目標

在不修改 target 的前提下，產生可讀及機器可讀的版本狀態與升級計畫，並保守辨識沒有 manifest 的已知舊版安裝。

## 情境包（Context Pack）

- 相關檔案：TASK-008 manifest API、`scripts/install-into-project.sh` 的舊配送規則、git 基準 `7749c12` 與選定的 legacy baseline。
- 既有模式：所有安裝目標由使用者明確傳入；測試只用臨時目錄。
- 假設：未知舊版或客製檔案寧可衝突停止，不推測可覆寫。
- 未知事項：是否納入 `a187710` baseline 以實作時可取得且能建立可靠 fixture 為準。
- 允許變更的檔案：`scripts/monstrare.mjs`、升級 plan helper、`scripts/manifests/*.json`、對應測試 fixtures。
- 不得觸碰：target 任何檔案內容與時間戳、實際升級寫入、migration。

## 需求

- `status` 回報來源版本、安裝版本、manifest 狀態與本地修改摘要。
- `upgrade <project> --dry-run` 分類 `add/update/remove/preserve/conflict`。
- `--json` 輸出穩定 schema，與人類輸出使用同一 plan object。
- 缺少 manifest 時對 bundled legacy baseline 比對；完全可辨識才允許產生升級計畫。
- 衝突只報路徑、分類與原因，不輸出可能敏感的檔案內容。

## 驗收標準

- status 與 dry-run 前後，target 全目錄內容與修改時間一致。
- stock legacy fixture 可辨識來源版本並產生正確計畫。
- 修改一個 managed 檔案後只標記對應衝突，且升級計畫為不可套用。
- 上游已刪除但下游未修改的 managed 檔案分類為 remove；已修改者分類為 conflict。
- project-data 與既有 seed-only 永遠分類為 preserve。
- 人類與 JSON 輸出的數量及路徑集合一致。

## 實作備註

升級 plan 必須是純資料，不在分類過程呼叫寫入；後續 TASK-011 只消費這份契約。

## 驗證契約

- 單元測試：所有分類 truth table、排序、衝突原因、JSON schema。
- 整合測試：manifest 安裝、stock legacy、未知 legacy、客製 managed、removed upstream fixtures。
- E2E 測試：連續執行兩次 dry-run 並比較 target snapshot。
- 型別檢查：不適用。
- Lint：不適用。
- Build：`node --check scripts/monstrare.mjs` 與 plan modules。
- 螢幕截圖：不適用。
- 安全性檢查：輸出不得洩漏檔案內容；唯讀命令不得建立 lock、manifest 或 backup。

## 完成證據

- 變更的檔案：`scripts/lib/plan.mjs`、`scripts/manifests/legacy-7749c12.json`、`scripts/monstrare.mjs`、`monstrare-package.json`、`scripts/check-governance.sh`、`test/monstrare/plan.test.mjs`、`test/monstrare/cli.test.mjs`、`ai/context/code-search-guide.md`。
- 執行過的指令：`node --test test/monstrare/plan.test.mjs test/monstrare/cli.test.mjs`、`npm run check`、`node --check scripts/lib/plan.mjs`、`node --check scripts/monstrare.mjs`、`git diff --check`。
- 測試輸出：Task 10 針對性測試 11/11 通過；完整檢查 47/47 通過，governance kit check passed。
- 螢幕截圖：不適用。
- 已知限制：legacy 辨識目前只內建 `7749c12`，且要求至少 80% baseline 路徑存在並有至少 80% checksum 相符；其他版本 fail closed。讀取與後續 TASK-011 寫入之間仍需在套用前重新驗證，以處理 TOCTOU。
- 後續任務：TASK-011、TASK-013。
