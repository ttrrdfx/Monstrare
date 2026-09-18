# 驗證報告

## 摘要

- 任務：TASK-011 實作交易式升級、備份與失敗回復
- 結果：通過
- 驗證者：Codex（2026-09-17）

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `node --test test/monstrare/transaction.test.mjs test/monstrare/cli.test.mjs` | 通過 | 18/18；交易狀態、成功套用、conflict、lock、stale plan、故障回復、symlink 與真實看板 E2E。 |
| `npm run check` | 通過 | 61/61；完整 Monstrare 與既有看板回歸測試、server syntax、governance check 全部通過。 |
| `node --check`（CLI、`scripts/lib/*.mjs`、交易測試） | 通過 | 所有本次相關 ES modules 語法有效。 |
| `git diff --check` | 通過 | 無 whitespace error。 |

## UI 證據

| Viewport | 螢幕截圖 | 備註 |
|---|---|---|
| 不適用 | 不適用 | 本任務只變更 CLI 與檔案交易流程；以升級後啟動真實看板並讀取 cards／epics 的 E2E 取代視覺驗證。 |

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| conflict 在 lock、backup 與 managed 寫入前停止；錯誤只列路徑，不輸出檔案內容。 | 無 | 通過 |
| source、target 與 manifest 在套用前重驗 checksum；每個 managed 寫入前再次檢查 target 狀態。 | 無 | 通過 |
| backup／staging 目錄使用 `0700`，路徑穿越、外逃與 managed 父目錄 symlink 會 fail closed。 | 無 | 通過 |
| add／update／remove 依固定順序套用；manifest 最後寫入，五個故障階段均能逆序回復並留下 `rolled-back` journal。 | 無 | 通過 |
| project-data 與既有 seed-only 保持不變；上游 remove 檔案可從保留的 backup 找回。 | 無 | 通過 |
| 安全性與可維護性審查未發現阻擋問題。 | 無 | 核准 |

## 涵蓋範圍

- journal state 與非法轉移、穩定 apply ordering。
- add／update／remove、metadata-only／重複升級 no-op、manifest-last。
- conflict 零寫入、有效 lock、target/source stale plan。
- backup、staging、逐檔套用前後與 manifest 後的故障注入及 rollback。
- 備份路徑 symlink escape、managed parent symlink、lock ownership 與備份權限。
- 真實看板升級後啟動，既有 cards／epics 可由 API 原樣讀取。

## 殘留風險

- Node.js 沒有 `openat` 類型的 descriptor-relative API；雖然每階段均重做 `lstat`、root 與 checksum 驗證，`lstat` 到 `rename` 間仍存在同一使用者刻意競態置換路徑的極小視窗。本 CLI 不以不可信任的共同 OS 使用者為威脅模型。
- `SIGKILL`、主機斷電或檔案系統故障無法進入 JavaScript catch 自動 rollback；backup 與 journal 會保留供人工復原，既有 lock 不會被自動判定過期或刪除。
- migration 編排刻意留待 TASK-012；發布文件與跨版本整體驗證留待 TASK-013。

## 完成定義

- 實作、針對性測試、完整回歸、安全審查、E2E 與可重跑證據均已存在；TASK-011 符合完成定義。
