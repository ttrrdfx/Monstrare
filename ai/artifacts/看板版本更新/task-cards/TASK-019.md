# AI-Ready 任務卡

## Metadata

- 任務：建立 GitHub Release 發布流程與維護文件
- 上層規格：`ai/artifacts/看板版本更新/feature-spec.md`
- 上層 Epic：看板版本更新
- 上層 User Story：US-2 預覽變更、US-3 阻擋不安全更新
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-014
- 狀態：實作與本機驗證完成，待 code review／人工驗收（2026-09-22）
- 風險等級：高
- Agent owner：Codex
- 人工核准者：使用者（2026-09-21，核准架構、供應鏈安全與測試契約；待 TASK-014 完成）

## 目標

建立受控、可重現的 tag-to-release 流程，將 TASK-014 bundle 以固定名稱附到 GitHub 正式 Release，並提供維護者可重跑的驗證與回復指引。

## 情境包（Context Pack）

- 相關檔案：TASK-014 `scripts/package-release.mjs`、`VERSION`、`monstrare-package.json`、`package.json`、`README.md`、`README en_us.md`、`tools/kanban/README.md`、`.github/`。
- 既有模式：`npm run check`、嚴格 SemVer/version manifest、GitHub 作為原始 repository，無 production deployment。
- 假設：正式版本以 `v<SemVer>` tag 觸發，GitHub-hosted runner 提供 Node 20 與 `gh`。
- 未知事項：實作時需查核當時 GitHub 官方 action 的建議完整 commit SHA；不在規劃文件虛構。
- 允許變更的檔案：`.github/workflows/release.yml`、`package.json`、`README.md`、`README en_us.md`、`tools/kanban/README.md`、`tools/kanban/docs/releasing.md`、必要的 workflow static test。
- 不得觸碰：runtime provider/API/UI、cards/epics、未經使用者授權的真實 tag/release/push。
- 驗證指令：`npm run check`、bundle 連續建置/hash 比對、workflow static validation、`git diff --check`。

## 需求

- 新增 tag `v*` 觸發的 workflow，job 預設無寫入權限，僅 upload/release step 給最小 `contents: write`。
- Checkout/setup 等 action 只使用 GitHub 官方 action，並 pin 至實作當時已查核的完整 commit SHA，不用浮動 major tag。
- 上傳前驗證 tag/VERSION/manifest/bundle version 四者一致，執行 `npm ci`、`npm run check` 與 deterministic bundle 建置。
- 只上傳精確計算的 `monstrare-vX.Y.Z.bundle.json`；不使用 glob 把其他 workspace 檔案當 asset。
- 以 GitHub 原生能力建立/更新當前 tag 的正式 release；不發布 draft/prerelease，不重用其他 tag 的 asset。
- 文件記錄版本提升、本地 dry-run、tag/push、workflow 證據、asset/digest 確認、失敗重跑、移除壞 asset 與下游更新驗收。
- 維持中英文件主要安裝/升級語意一致；詳細 operator runbook 可集中在單一文件。

## 非目標

- 本卡不建立、push 或刪除任何真實 tag/release；這些是需要另行明確授權的外部變更。
- 不新增第三方 npm dependency 或非官方 marketplace action。
- 不自動清理舊 release/asset，不管理 GitHub credentials。

## 驗收標準

- 本地模擬 tag/version 一致時可生成唯一正確命名的 bundle；不一致時在上傳前失敗。
- Workflow 先通過全部 tests/checks 才能取得 release 寫入權限與上傳。
- Workflow 沒有寬鬆 glob、沒有未 pin 第三方 action、沒有 shell 插值未加以處理的 tag/filename。
- 重跑同一 tag 不會靜默產生不同內容；若 asset 已存在且 digest 不同，workflow fail closed。
- Runbook 讓維護者可在沒有 Codex 的情況下重現建置、核對 digest、重跑或回復壞 asset。
- README 清楚說明看板更新只來自正式 release asset、需 dry-run/二次確認與 server 重啟。

## 實作備註

- 動態 tag 先用嚴格 regex/SemVer helper 驗證後再用；shell step 透過 environment file 傳值，不把原始 GitHub expression 插進 shell command。
- 使用 `gh` 時只指定當前 repository/tag/精確 asset path，不列出或處理其他 repository。
- 實作時若 GitHub 原生 digest 生成有延遲，runbook 要把「確認 digest 已可用」列為發布後 gate。

## 驗證契約

- 單元測試：tag/version/filename 一致性、workflow 禁止的浮動 action/glob/shell interpolation 樣式。
- 整合測試：在乾淨 checkout 產生兩次相同 bundle，執行 `npm run check`，不進行網路上傳。
- E2E 測試：真實 staging/tag release 上傳只在使用者另行授權後執行；TASK-020 記錄手動契約。
- 型別檢查：不適用。
- Lint：workflow YAML/static check；專案 JS 無 lint。
- Build：`npm run package-release -- --ref <sha> --output <temp-path>`（實際 script 名以 TASK-014 為準）。
- 螢幕截圖：不適用。
- 安全性檢查：workflow permissions、action SHA pinning、script injection、asset scope、digest mismatch、secret/log redaction。

## 完成證據

- 變更的檔案：`.github/workflows/release.yml`、`test/monstrare/release-workflow.test.mjs`、
  `tools/kanban/docs/releasing.md`、中英文 README、`tools/kanban/README.md`、本卡、
  看板本卡與驗證報告。
- 執行過的指令：`node --test test/monstrare/release-workflow.test.mjs`、
  `npm run check`、兩次 `npm run package-release` 與 hash/`cmp` 比對、
  Ruby YAML parse、官方 action tag `git ls-remote`、`git diff --check`。
- 測試輸出：針對性 3/3、完整 136/136 通過；連續 bundle 建置 byte-for-byte 相同。
- 螢幕截圖：不適用。
- 已知限制：本卡沒有真實 tag／release 上傳，也無乾淨 checkout staging 結果；
  GitHub runner 與 digest 延遲留給 TASK-020，code review 與人工驗收尚未完成。
- 後續任務：TASK-020。
- 驗證報告：`ai/artifacts/看板版本更新/verification/TASK-019.md`。
