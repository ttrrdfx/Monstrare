# 驗證報告

## 摘要

- 任務：TASK-010 實作 status、dry-run 與 legacy 版本探測
- 結果：通過
- 驗證者：Codex（2026-09-15）

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `node --test test/monstrare/plan.test.mjs test/monstrare/cli.test.mjs` | 通過 | 11/11；涵蓋分類 truth table、remove、legacy、未知 legacy、唯讀快照及文字／JSON 契約。 |
| `npm run check` | 通過 | 47/47；完整 Monstrare 與既有看板回歸測試、server syntax、governance check 全部通過。 |
| `node --check scripts/lib/plan.mjs`、`node --check scripts/monstrare.mjs` | 通過 | 升級計畫 helper 與 CLI 語法有效。 |
| `git diff --check` | 通過 | 無 whitespace error。 |

## UI 證據

| Viewport | 螢幕截圖 | 備註 |
|---|---|---|
| 不適用 | 不適用 | 本任務只新增 CLI 與純資料計畫，沒有 UI 變更。 |

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| legacy baseline 與來源 manifest 均做 schema、SemVer、路徑及 checksum 驗證；未知或無法唯一辨識的版本 fail closed。 | 無 | 通過 |
| status／dry-run 不建立 lock、manifest、backup 或 temp file；兩次執行前後的 target 內容及 mtime 快照一致。 | 無 | 通過 |
| 人類與 JSON 輸出由同一 plan object 產生，僅列路徑、分類與原因，不包含 target 檔案內容或 hash。 | 無 | 通過 |
| 修正來源 manifest 漏列的 `tools/kanban/docs/**`，避免 stock legacy 文件被錯誤分類為 remove。 | 低 | 已修正 |

## 涵蓋範圍

- `add/update/remove/preserve/conflict` truth table、固定排序、原因與摘要。
- manifest 安裝、stock `7749c12` legacy、單一 managed 客製、未知 legacy、上游移除與 seed/project-data 保留。
- 連續兩次唯讀規劃的 byte checksum 與 mtime 一致性。
- CLI `status` 與 `upgrade --dry-run` 的 human/JSON 輸出及衝突 exit code 契約。
- 外逃 symlink 與不安全 target 沿用 TASK-008 路徑邊界；沒有新增 dependency 或網路行為。

## 殘留風險

- 目前只內建 `7749c12` baseline；未納入 `a187710`，因本次沒有足夠證據證明它代表不同且可可靠辨識的已配送版本。
- legacy 辨識要求至少 80% 路徑存在且至少 80% checksum 完全相符；客製程度更高的安裝會保守拒絕，需人工辨識。
- 計畫建立後到 TASK-011 實際套用前仍存在本機同使用者 TOCTOU；寫入階段必須重新 hash 並驗證 plan。

## 完成定義

- 實作、針對性測試、完整回歸、語法檢查、安全審查與可重跑證據均已存在；TASK-010 符合完成定義。
