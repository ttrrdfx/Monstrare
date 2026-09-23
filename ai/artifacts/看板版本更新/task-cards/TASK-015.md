# AI-Ready 任務卡

## Metadata

- 任務：實作固定 GitHub Release 取得與安全暫存
- 上層規格：`ai/artifacts/看板版本更新/feature-spec.md`
- 上層 Epic：看板版本更新
- 上層 User Story：US-2 預覽變更、US-3 阻擋不安全更新
- 分軌：後端
- 前置任務（dependsOn）：TASK-014
- 狀態：完成（2026-09-21）
- 風險等級：高
- Agent owner：Codex
- 人工核准者：使用者（2026-09-21，核准架構、安全與測試契約；TASK-014 已完成）

## 目標

只從固定公開 repository `ttrrdfx/Monstrare` 取得最新正式 release，將 digest 驗證過的專用 bundle 安全轉成有限時間的本地 source session。

## 情境包（Context Pack）

- 相關檔案：TASK-014 `scripts/lib/release-bundle.mjs`、`scripts/lib/plan.mjs`、`scripts/lib/paths.mjs`、本 Epic `architecture-plan.md`。
- 既有模式：Node.js 20 內建 `fetch`/`https`、`mkdtemp`、`resolveSafeRoot`、穩定 error code、零 production dependency。
- 假設：GitHub release API 會提供可驗證的 asset SHA-256 digest；無 digest 即 fail closed。
- 未知事項：真實 GitHub redirect 鏈與 rate-limit header 將由 TASK-019/020 的 staging 驗證補證。
- 允許變更的檔案：`scripts/lib/github-release.mjs`、`test/monstrare/github-release.test.mjs`、`monstrare-package.json`、必要的共用 error helper。
- 不得觸碰：看板 HTTP routes/UI、下游 target、真實 cards/epics、環境變數 token 支援。
- 驗證指令：`node --test test/monstrare/github-release.test.mjs test/monstrare/release-bundle.test.mjs`、`node --check scripts/lib/github-release.mjs`、`npm run check`。

## 需求

- 生產程式內建固定 repository/API/asset 命名規則，不從 caller 取得任意 URL。
- 過濾 draft/prerelease/非 `v<SemVer>` tag，並只接受唯一個精確命名、帶 SHA-256 digest 的 asset。
- 限定 HTTPS、精確 hostname allowlist、最多 3 次 redirect、timeout 與 32 MiB streaming 上限。
- 對 404、403/rate limit、timeout、redirect 越界、asset 缺失/重複、digest 不符定義穩定 error code。
- 下載後先驗證 outer digest，再委派 TASK-014 validator/materializer；不將未驗證資料當 sourceRoot。
- 建立 in-memory session store：opaque random token、plan digest metadata、15 分鐘 TTL、單一 active session、可重複呼叫 cleanup。
- 提供可注入的 transport/clock/temp factory 供測試，但 production repository/host 不可被請求或環境變數覆寫。

## 非目標

- 不建立 HTTP route、不套用更新、不執行 verify。
- 不支援 private repository、GitHub token、branch head 或 caller 指定 tag。
- 不信任 release body 中的 URL 或 checksum 文字。

## 驗收標準

- Fake provider 的正常 release 可產生已驗證 sourceRoot、release metadata 與有效 session token。
- Caller 無法透過 API 參數或 env 把來源改到非 `ttrrdfx/Monstrare`。
- 每一個 redirect hop 都重新驗證 protocol/host；越界、過多 redirect、timeout 與超限都中止並清理。
- Release/tag/asset/digest/bundle/version/manifest 不一致全部 fail closed。
- 新 session 會清理舊 temp root；過期或手動 cleanup 可重複執行而不擲錯。
- Log/error 不包含 bundle 內容、response body、Authorization 或本機 home path。

## 實作備註

- 將 provider、download transport、session store 保持為獨立單一職責函式；API orchestration 留給 TASK-016。
- 驗證 hostname 時用 URL parser 後的完整 hostname 清單，不使用 `endsWith("githubusercontent.com")` 類的寬鬆比對。
- 下載與 temp root 清理需在 `finally` 或 session disposal 後可觀測。

## 驗證契約

- 單元測試：release 過濾、asset 命名/digest、SemVer、host allowlist、redirect/timeout/size、TTL/session disposal。
- 整合測試：本機 fake HTTPS/HTTP transport fixture 覆蓋 200、403、404、rate limit、timeout、redirect 鏈、中斷 body、digest 不符與惡意 bundle。
- E2E 測試：不適用，TASK-020 覆蓋。
- 型別檢查：不適用。
- Lint：不適用。
- Build：`node --check scripts/lib/github-release.mjs`。
- 螢幕截圖：不適用。
- 安全性檢查：SSRF/redirect bypass、size exhaustion、digest confusion、temp cleanup、secret/logging review。

## 完成證據

- 變更的檔案：`scripts/lib/github-release.mjs`、
  `test/monstrare/github-release.test.mjs`、本任務卡、
  `ai/artifacts/看板版本更新/verification/TASK-015.md` 與
  `tools/kanban/cards/TASK-015.json`。
- 行為變更：新增固定 `ttrrdfx/Monstrare` latest formal release provider、精確
  HTTPS hostname allowlist、受限 redirect/timeout/streaming download、GitHub asset
  SHA-256 與 TASK-014 bundle 雙層驗證、安全 temp materialization，以及單一 active、
  15 分鐘 TTL 的 in-memory release session store。
- 執行過的指令：
  - `node --test test/monstrare/github-release.test.mjs test/monstrare/release-bundle.test.mjs`
  - `node --check scripts/lib/github-release.mjs`
  - `npm run check`
  - `git diff --check`
- 測試輸出：針對性測試 24/24 通過；完整 `npm run check` 102/102 tests 通過，
  syntax check 與 governance kit check 通過；diff whitespace check 通過。
- 螢幕截圖：不適用。
- 安全性審查：固定 repository/API/asset path，caller 無法設定來源；每個 redirect
  hop 重新驗證 HTTPS、精確 host 與標準 port；metadata/download 分別受 byte 與 timeout
  上限保護；錯誤不回顯 response/bundle 內容、Authorization 或 temp/home path；所有
  下載、digest、bundle、materialize 失敗皆清理 temp handle。
- 已知限制：真實 GitHub asset digest 與 redirect 平台行為依核准計畫留給
  TASK-019／020 staging 驗證；OS 拒絕刪除時 cleanup 為 best effort，session 仍會
  fail closed 並失效；本卡未建立 HTTP route、未套用更新、未建立或發布真實 release。
- 後續任務：TASK-016。
- 驗證報告：`ai/artifacts/看板版本更新/verification/TASK-015.md`。
