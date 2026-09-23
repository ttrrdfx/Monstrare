# AI-Ready 任務卡

## Metadata

- 任務：建立版本更新 Release bundle 與共用契約基礎
- 上層規格：`ai/artifacts/看板版本更新/feature-spec.md`
- 上層 Epic：看板版本更新
- 上層 User Story：US-2 預覽變更、US-3 阻擋不安全更新
- 分軌：後端
- 前置任務（dependsOn）：無
- 狀態：完成（2026-09-21）
- 風險等級：高
- Agent owner：待指定
- 人工核准者：使用者（2026-09-21，核准架構、安全與測試契約）

## 目標

建立可重現、可在寫入前完整驗證的 Monstrare JSON release bundle，並產生可供既有 planner 讀取的受控暫存 sourceRoot。

## 情境包（Context Pack）

- 相關檔案：`monstrare-package.json`、`scripts/lib/manifest.mjs`、`scripts/lib/paths.mjs`、`scripts/check-governance.sh`、`package.json`、本 Epic `architecture-plan.md`。
- 既有模式：manifest inventory 展開、ownership 分類、SHA-256、嚴格 SemVer、Node.js 20、零 production dependency。
- 假設：release asset 命名為 `monstrare-vX.Y.Z.bundle.json`，只收錄 managed/seed-only 普通檔案。
- 未知事項：無；bundle schema 與上限已在架構筆記固定。
- 允許變更的檔案：`scripts/lib/release-bundle.mjs`、`scripts/package-release.mjs`、`test/monstrare/release-bundle.test.mjs`、`monstrare-package.json`、`package.json`、`scripts/check-governance.sh`。
- 不得觸碰：`tools/kanban/cards/**`、`tools/kanban/epics.json`、既有 plan/transaction 行為、真實 GitHub Release。
- 驗證指令：`node --test test/monstrare/release-bundle.test.mjs`、`node --check scripts/package-release.mjs`、`npm run check`、`git diff --check`。

## 需求

- 定義 `schemaVersion: 1` bundle：`version`、`createdFrom`、排序後 `files[]`，每檔含 path/ownership/mode/sha256/contentBase64。
- Builder 使用現有 source manifest 展開 inventory，排除 project-data/source-only，並在輸出前驗證自身。
- Builder 採 canonical JSON 與穩定順序；相同 commit 連續建置必須 byte-for-byte 相同。
- Validator 拒絕未知 schema、錯誤版本、不合法/重複路徑、錯誤 ownership/mode/hash/base64 與大小/數量超限。
- Materializer 只將已通過完整驗證的普通檔案寫入 caller 提供的空白 temp root，並重新驗證寫入 hash。
- 為新檔案補上 manifest ownership 與 governance 檢查，不新增 npm dependency。

## 非目標

- 不存取 GitHub、不建立 HTTP API、不寫入下游 target。
- 不處理 archive、symlink、device 或任意 mode。
- 不自動建立 tag/release，不上傳產物。

## 驗收標準

- 真實 source 可產生單一 bundle，包含 `VERSION`、manifest 與全部 managed/seed-only 普通檔案，不含 cards/epics/artifacts/source-only。
- 連續建置兩次的 asset SHA-256 相同。
- 將 bundle 具體化後，`planProjectUpgrade` 可把該目錄當作 sourceRoot。
- 範例、絕對路徑、`..`、NUL、重複路徑、hash 不符、不允許 mode、5001 entries、下載/解碼後超限都在任何 materialize 前被拒絕。
- 驗證失敗時不留下部分 source tree，不輸出檔案內容。
- 現有 `npm run check` 通過。

## 實作備註

- 重用現有 manifest/path/hash helper，不再建第二套 SemVer 或 ownership parser。
- 驗證與 materialize 分離；先建立完整的 immutable normalized model，再寫入 temp root。
- `createdFrom` 來自建置時明確傳入的 commit SHA，不使用當前時間，避免破壞可重現性。

## 驗證契約

- 單元測試：schema/canonical ordering、inventory ownership、path/mode/base64/hash、entry/大小限制。
- 整合測試：建置真實 source 兩次並比對 hash；materialize 到臨時目錄後呼叫 planner。
- E2E 測試：不適用，TASK-020 覆蓋。
- 型別檢查：不適用。
- Lint：不適用（專案無 lint 設定）。
- Build：`node --check scripts/package-release.mjs scripts/lib/release-bundle.mjs`。
- 螢幕截圖：不適用。
- 安全性檢查：path traversal、NUL、duplicate path、symlink 語意排除、size bomb、hash 不符、敏感內容不進 log。

## 完成證據

- 變更的檔案：`scripts/lib/release-bundle.mjs`、`scripts/package-release.mjs`、
  `test/monstrare/release-bundle.test.mjs`、`monstrare-package.json`、`package.json`、
  `scripts/check-governance.sh`、本任務卡與
  `ai/artifacts/看板版本更新/verification/TASK-014.md`。
- 行為變更：新增可重現 JSON release bundle 的 builder／validator／parser／serializer／
  materializer、明確 commit SHA 的封裝 CLI，以及 manifest ownership 與 governance 檢查。
- 執行過的指令：
  - `node --test test/monstrare/release-bundle.test.mjs`
  - `node --check scripts/package-release.mjs scripts/lib/release-bundle.mjs`
  - `npm run package-release -- --help`
  - `npm run check`
  - `git diff --check`
- 測試輸出：針對性測試 11/11 通過；完整 `npm run check` 89/89 tests 通過，
  syntax check 與 governance kit check 通過；diff whitespace check 通過。
- 螢幕截圖：不適用。
- 安全性審查：路徑、ownership、mode、base64、hash、entry/byte 上限皆 fail closed；
  materializer 要求空白安全 root、拒絕 symlink 語意、以 `wx` 寫入並重驗 hash；錯誤不回顯檔案內容。
- 已知限制：本卡不驗證 GitHub asset digest、不存取網路、不建立真實 release；同一本機使用者
  主動競態置換路徑的殘留 TOCTOU 風險由空白 root、逐層 symlink 檢查、exclusive create 與
  寫後 hash 驗證降低，跨流程邊界由 TASK-015／020 再驗證。
- 後續任務：TASK-015、TASK-017、TASK-019。
- 驗證報告：`ai/artifacts/看板版本更新/verification/TASK-014.md`。
