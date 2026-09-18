# 驗證報告

## 摘要

- 任務：TASK-012 建立受限的跨版本 migration 框架
- 結果：通過
- 驗證者：Codex（2026-09-18）

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `node --test test/monstrare/migrations.test.mjs test/monstrare/transaction.test.mjs` | 通過 | 23/23；涵蓋 registry、鏈式執行、scope、備份、rollback、managed 保護與看板 E2E。 |
| `npm run check` | 通過 | 71/71；完整 Monstrare 與既有看板回歸測試、server syntax、governance check 全部通過。 |
| `node --check`（migration runner、registry、transaction 與 migration tests） | 通過 | 本次相關 ES modules 語法有效。 |
| `git diff --check` | 通過 | 無 whitespace error。 |

## UI 證據

| Viewport | 螢幕截圖 | 備註 |
|---|---|---|
| 不適用 | 不適用 | 本任務只變更 CLI migration／檔案交易流程；以 migration 後啟動真實看板並讀取 cards API 的 E2E 取代視覺驗證。 |

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| registry 嚴格驗證 id、SemVer、重複 transition、分支、缺口、循環與跨越未知版本；不完整鏈在 lock 或 backup 前停止。 | 無 | 通過 |
| `check` context 唯讀；`apply` 只能透過宣告 scope 的原子寫入 API，路徑 traversal、`.monstrare`、symlink 與 scope escape 均 fail closed。 | 無 | 通過 |
| 每個 needed migration 在寫入前完整備份宣告 scope，進度納入同一 journal；apply、驗證或後續交易失敗時會逆序回復 migration、managed 檔案與舊 manifest。 | 無 | 通過 |
| migration 繞過 context 修改宣告 scope、或讓 managed 檔偏離來源 inventory 時會被偵測、拒絕並回復。 | 無 | 通過 |
| cards／epics scope 強制宣告 schema validator；fixture 成功 migration 後可由新版看板 server 讀取，備份保留原始資料。 | 無 | 通過 |
| 安全性與可維護性審查未發現阻擋問題。 | 無 | 核准 |

## 涵蓋範圍

- 空 registry 無 schema 差異 no-op，以及 1→2→3 連續鏈依前一步輸出執行。
- 缺口、重複 id／transition、循環、惡意 id/version、無效 check 狀態與 incompatible 資料。
- needed／already-applied、重跑 no-op、apply 失敗與 bypass transaction 寫入。
- exact／tree scope、scope escape、symlink、完整 scope backup 與新增檔 rollback。
- managed inventory 不變量、manifest-last、journal migration 狀態與既有 transaction 回歸。
- cards／epics validator 與啟動真實看板讀取 migrated fixture 的 E2E。

## 殘留風險

- migration registry 是隨 Monstrare source 配送的受信任程式碼，不會從 target manifest 動態載入。框架可拒絕 context scope escape，並偵測宣告 scope 內繞過 context 的寫入；但 Node.js 無法沙箱一個惡意 migration module 對宣告 scope 外直接使用 `fs`，因此新增 production migration 仍須 code review。
- Node.js 沒有 descriptor-relative `openat` API；雖然每次讀寫均重做 `lstat`、root 與 checksum 驗證，路徑檢查到 rename 間仍存在同一使用者刻意競態置換的極小 TOCTOU 視窗。
- 空 registry 依驗收標準代表版本間沒有資料 schema 差異；未來一旦引入 schema 差異，release author 必須同時登錄完整 migration 鏈。部分鏈會 fail closed，但框架無法從一般檔案差異自動推斷「遺漏了整條 migration」。
- `SIGKILL`、斷電或檔案系統故障仍需依保留的 backup／journal 人工復原；自動復原只涵蓋能進入 JavaScript error handling 的失敗。

## 完成定義

- 實作、針對性測試、完整回歸、安全審查、schema/E2E 與可重跑證據均已存在；TASK-012 符合完成定義。
