# 驗證報告

## 摘要

- 任務：TASK-013 完成升級 E2E、文件與發布驗證
- 結果：通過，等待人工驗收
- 驗證者：Codex（2026-09-18）

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `node --test test/monstrare/verify.test.mjs test/monstrare/e2e.test.mjs` | 通過 | 6/6；verify pass/fail/missing、固定命令、環境變數隔離、legacy E2E 與 conflict fixture。 |
| `node --test test/monstrare/documentation.test.mjs test/monstrare/verify.test.mjs test/monstrare/e2e.test.mjs` | 通過 | 7/7；中英文指令、備份與發布文件、本機連結及 E2E。 |
| `npm run check` | 通過 | 78/78；全部看板與升級器測試、Node/shell 語法及 governance kit check 通過。 |
| `git diff --check` | 通過 | 無 whitespace error。 |

## 驗收標準證據矩陣

| Feature spec 驗收標準 | 自動／人工證據 | 結果 |
|---|---|---|
| 全新安裝後存在有效 manifest，並能正確回報版本 | `install.test.mjs` 的新安裝 checksum／manifest 測試；`cli.test.mjs` 的 status/no-op 契約 | 通過 |
| legacy dry-run 完全不修改目標 | `plan.test.mjs` 的 tree/mtime snapshot；`e2e.test.mjs` 重複 dry-run 與 project-data snapshot | 通過 |
| 舊版看板檔案可升級到新版 | `fixtures.mjs` 由 bundled `7749c12` baseline 與 Git objects 重建 stock tree，再由 `e2e.test.mjs` 完整 apply | 通過 |
| cards、epics、context、artifacts 逐檔內容不變 | `fixtures/project-data/` 與 `snapshotFixtureData` 在升級前後逐檔比對 base64 bytes | 通過 |
| 修改過的 managed 檔列為衝突且保持原內容 | customized fixture 在 dry-run 列出唯一 conflict；apply 回傳 `UPGRADE_CONFLICT`，無 `.monstrare` 寫入 | 通過 |
| 中途失敗不留下半套版本且備份可用 | `transaction.test.mjs` 五階段 fault injection、lock/stale/symlink；`migrations.test.mjs` migration failure rollback 與 snapshot | 通過 |
| 升級後 self-check、看板測試與 server syntax 通過 | legacy E2E 直接執行 CLI `verify`；其後啟動升級後 server，GET cards/epics、POST/DELETE card | 通過 |
| 文件說明新安裝、升級、衝突與回滾 | 中英文 README 包含 install → status → dry-run → upgrade → verify、備份／legacy／migration 回復與 release checklist；文件測試檢查指令與連結 | 通過 |

## Fixture 與涵蓋範圍

- `fixtures.mjs`：依 baseline 精確重建 pre-upgrader stock tree，不維護第二份容易漂移的 managed copy。
- `fixtures/project-data/`：card、epics、context、artifact 四類下游資料。
- `fixtures/customized/`：對 managed server 加入客製內容，證明 dry-run/apply 均 fail closed。
- `fixtures/migration/`：schema v1 project payload，供完整 scope backup、apply、validate、repeat no-op 與 rollback 測試。
- `verify <project>`：governance、直接層級看板測試、全部 CLI/server `.mjs` 語法與 scripts shell 語法；缺少必要腳本或檢查失敗均非零。
- release 文件：版本、ownership、legacy baseline、migration、測試、雙語文件、diff 與 annotated tag；不自動發布。

## UI 證據

| Viewport | 螢幕截圖 | 備註 |
|---|---|---|
| 不適用 | 不適用 | 本任務未修改 UI；以升級後真實 server 的 cards/epics GET 與 card POST/DELETE API E2E 取代視覺驗證。 |

## 安全性與可維護性審查

### 發現的問題

- 無阻擋問題。
- 審查期間已修正：`verify` 子程序改為環境變數 allowlist，避免把來源程序的任意 token／secret 傳給目標測試。
- 審查期間已修正：Node 語法檢查明確要求 CLI 與看板 server；缺檔不會因另一個 module 存在而誤報通過。
- 審查期間已修正：中英文回復文件區分既有 manifest 與 legacy 無 manifest，並補上 migration snapshot 回復範圍。

### 核對結果

- 路徑、symlink、manifest schema、lock、stale plan/TOCTOU、backup escape 與 migration scope 均有 fail-closed 測試。
- 驗證命令以 `execFile` 的固定 command/args 執行，不經 shell 字串拼接；輸出有 buffer 與顯示長度上限。
- 沒有新增 production dependency、網路下載、遙測、遠端發布、自動 commit 或 destructive git 命令。
- 架構維持 Node.js built-ins、JSON 單一事實來源與 source/target 分離。

### 核准建議

- 核准；可進入人工驗收。

## 殘留風險

- `verify` 會執行目標 checkout 內的治理腳本與測試；環境變數已最小化，但程序仍擁有目前使用者的檔案與網路權限。文件已要求只對信任的 checkout 執行；這不是 sandbox。
- pre-upgrader fixture 依賴完整 source checkout 中的 Git object `7749c12`。一般 clone 可重跑；不含 Git 歷史的 source archive 無法重建該 fixture。
- `SIGKILL`、斷電與惡意的同使用者 TOCTOU 仍無法由 Node.js 交易自動攔截；backup/journal 與雙語人工回復步驟是最後防線。
- production migration registry 目前為空，代表 0.0.0/1.0.0 間沒有 project-data schema 差異；未來 schema 變更仍需 release author 登錄並審查完整 migration 鏈。
- 未對實際外部下游專案執行人工 dry-run；自動 fixture 不依賴外部專案，實際試跑保留給人工驗收。

## 完成定義

- 實作、可重現 fixtures、驗收矩陣、針對性測試、完整回歸、語法／governance 檢查、文件連結測試、安全審查與殘留風險均已記錄；TASK-013 的實作與自動驗證符合完成定義，等待人工驗收。
