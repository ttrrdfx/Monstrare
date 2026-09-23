# TASK-020 驗證報告

## 摘要

- 任務：完成版本更新端對端、安全與視覺驗證。
- 發布前結果：通過；137 / 137 測試、syntax、governance、跨層 E2E 與既有瀏覽器證據均符合契約。
- 真實 Release：通過；`v1.0.0` workflow、公開 asset、GitHub digest 與下載內容一致。
- 驗證者：Codex（2026-09-23）。

## 可重跑指令

| 指令 | 結果 | 涵蓋範圍 |
|---|---|---|
| `node --test test/monstrare/update-e2e.test.mjs` | 1 / 1 通過 | 真實 bundle builder → fake GitHub metadata/asset → HTTP check/apply → transaction journal → verify → 重啟後 status。 |
| `npm run check` | 137 / 137 通過 | 全部 regression、release/bundle、SSRF/redirect/digest/timeout、API/CSRF/stale/concurrency、UI、Node/shell syntax、governance。 |
| `git diff --check` | 通過 | whitespace 檢查。 |
| Browser QA（本機 Chromium） | 通過，5 / 5 | 既有 1440×900、390×844、320×700 狀態證據；本次再確認真實 server 的入口、loading 與無 Release error state。 |

## Feature spec 驗收矩陣

| 驗收項目 | 證據 | 結果 |
|---|---|---|
| Desktop/mobile 入口、44px 目標、無溢出 | TASK-017 desktop/mobile screenshots；320px `scrollWidth` 與互動尺寸紀錄 | 通過 |
| 鍵盤、focus trap/return、Escape/applying、狀態文案 | TASK-017 browser QA；TASK-018 真實 adapter UI 流程；`upgrade-ui.test.mjs` | 通過 |
| Check 唯讀，顯示版本與分類 | `update-e2e.test.mjs` 在 check 前後比對 project-data，且 `.monstrare` 不存在 | 通過 |
| 不安全來源、錯誤 release/asset、digest/version/path/size 限制 | `github-release.test.mjs`、`release-bundle.test.mjs` | 通過 |
| CSRF、非 JSON、任意來源/目標、過期 token、stale/concurrent | `upgrade-api.test.mjs`、`upgrade-integration.test.mjs` | 通過 |
| Apply 交易、rollback/fault、verify failure、restart-required | `transaction.test.mjs`、`upgrade-api.test.mjs`、`update-e2e.test.mjs` | 通過 |
| Managed 更新、project-data 保留、journal 完整 | `update-e2e.test.mjs` 比對既有哨兵、completed journal 與 install manifest | 通過 |
| 重啟後版本與看板 API | `update-e2e.test.mjs` 啟動更新後 server，檢查 v1.0.0、cards、epics | 通過 |
| 現有看板/藍圖/card/SSE/CLI 不回歸 | `npm run check` 全套 137 / 137 | 通過 |
| 真實 GitHub Release 與 digest | run `35818994097`；Release API、下載重算與 bundle parser | 通過 |

## UI 與無障礙證據

- 核心狀態截圖沿用 TASK-017 的 1440×900 與 390×844 loading／available／conflict／success，以及 TASK-018 的 available／confirm／applying／success／verification-failed；這些是同一版實作且已納入本次 regression。
- 本次實際瀏覽器再次看到 `#upgrade-trigger`、對話框載入態、錯誤態與可重新檢查動作；在尚未發布 Release 時，畫面正確宣告「目標專案沒有被修改」。
- Release 發布後，本機真實 server 成功下載並驗證 v1.0.0，呈現 `GitHub Release · verified`；因本機在 tag 後修改 runbook，dry-run 正確顯示一個 conflict 並停用套用，證明真實 provider 到 UI 的 fail-closed 路徑。
- 視覺層級、既有 design token、文字標籤與非僅靠色彩的語意符合 design review。沒有新增 UI 樣式。
- 本次瀏覽器控制介面未提供 console log 讀取；TASK-017/018 已完成同版 Browser QA，完整自動化沒有新增 browser-side error。此限制保留為低風險註記，不虛構 console 證據。

## 安全性與可維護性審查

- 發現並修正：最初把 TASK-020 E2E 放在會配送的 `tools/kanban/*.test.mjs`，會使下游 verify 缺少 source-only fixture；已移到 `test/monstrare/update-e2e.test.mjs`，實際下游 verify 改為通過。
- 未發現未解決的高／中嚴重度問題。來源 repository/hosts 固定、HTTPS redirect 逐跳驗證、bundle 在 materialize 前完整驗證、POST 同源與 body schema fail closed、交易有 lock/backup/rollback。
- Workflow action 使用官方完整 commit SHA；build 只讀、release job 才有 `contents: write`，不使用 upload glob 或 `--clobber`，重跑以 digest 判斷。
- 真實 Release 證據：正式非 draft/prerelease Release id `394302121`，asset id `582969163`、864862 bytes，digest `sha256:298e42a441d08ee5d969efa846d5a4a93d2f7b7c4e350cb17824ebb16010ffd8`；下載重算一致，bundle 為 v1.0.0、createdFrom `8681d91…`、89 files。
- 殘留風險：官方 actions 的 Node 20 runtime 已被 runner 強制切至 Node 24，且 `ubuntu-latest` 預告遷移 Ubuntu 26；本次成功但後續應更新 pin 並持續驗證。

## Review gates

- Product：feature spec 的 US-1～US-5 均有證據。
- UI：既有桌面／行動、鍵盤、焦點與狀態證據通過。
- Architecture：固定 provider → bundle → plan → transaction → verify 邊界未偏移。
- Security：沒有未解決高／中嚴重度發現。
- Test：發布前 137 / 137 通過；真實 Release、下載 digest 與 UI provider gate 通過。
- Code review：核准；無未解決高／中嚴重度發現。
