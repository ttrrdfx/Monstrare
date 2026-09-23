# 架構筆記：看板 GitHub Release 版本更新

## 狀態

- 產品規格：使用者已核准（2026-09-18）
- UI：Variant A 「置中摘要 Dialog」已核准（2026-09-21）
- 架構與任務卡：使用者已核准（2026-09-21）
- 風險：高（外部網路、release 供應鏈、檔案寫入與自我更新）

## 情境包

- 任務：在看板右上角增加「檢查更新」，安全地從固定 GitHub Release 預覽與套用 Monstrare 更新。
- 目標：不接受用戶端來源或路徑；先驗證來源、唯讀 dry-run 與二次確認，再重用既有 transaction/verify。
- 相關檔案：`tools/kanban/index.html`、`tools/kanban/server.mjs`、`scripts/lib/plan.mjs`、`scripts/lib/transaction.mjs`、`scripts/lib/verify.mjs`、`scripts/lib/manifest.mjs`、`scripts/lib/paths.mjs`、`monstrare-package.json`、`package.json`。
- 既有模式：單檔無框架 UI、Node.js 20 內建模組、`node:test`、固定 `127.0.0.1`、純函式 UI state、checksum plan、lock/backup/staging/journal/rollback。
- 假設：公開 repository `ttrrdfx/Monstrare` 的正式 release 會附有專用 JSON bundle 與 GitHub 可驗證的 SHA-256 digest。
- 未知事項：第一個真實 release 的 GitHub asset digest/redirect 行為需在發布驗證卡確認；不阻擋本地 fake-provider 實作。
- 允許變更：新增 release bundle/provider/API modules、看板 UI/server、測試、發布 workflow、維護文件、manifest 與 design-system inventory。
- 不得觸碰：真實 `tools/kanban/cards/*.json`、`tools/kanban/epics.json`、不相關 artifacts/context、Git history、用戶密鑰，以及未在計畫中的專案檔案。
- 驗證指令：各卡指定 `node --test ...`；收尾執行 `npm test`、`npm run check`、`git diff --check` 與 desktop/mobile 視覺驗證。
- 情境預算：只閱讀了專案/架構/搜尋地圖、核准規格、topbar/modal/API route 入口與既有 upgrade 核心契約；未擴張到無關版面或卡片內容。

## 建議方案

保持零 production dependency，在現有 upgrade 核心前加上一層受限的
GitHub provider 與 bundle 驗證器，再以薄 API adapter 暴露給 Variant A UI。

```text
GitHub latest formal release (fixed ttrrdfx/Monstrare)
  → GitHub provider (HTTPS, host allowlist, timeout, redirect/size limit)
  → monstrare-vX.Y.Z.bundle.json (digest + schema + per-file hash validation)
  → controlled temporary sourceRoot
  → planProjectUpgrade (read-only)
  → ephemeral Upgrade Session (opaque token, digest, plan snapshot, TTL)
  → GET status / POST check / POST apply
  ↔ Variant A centered dialog + independent confirmation alert
  → applyProjectUpgrade → verifyProject → restart-required result
```

不直接使用 branch head，也不在 server 內執行 `git pull`。這能把來源
鎖定在可識別、可驗證、可重現的 release asset，並且不會操作目標
project 的 `.git`。

## 共用 Release Bundle 契約

使用 `monstrare-vX.Y.Z.bundle.json`，而非 `.tar.gz`。這是對已核准「正式 Release
專用 asset」的技術細化：本專案的檔案量適中，JSON bundle 可以不引入
archive 依賴，並在具體化前先拒絕 traversal、symlink 與特殊檔案語意。

```json
{
  "schemaVersion": 1,
  "version": "1.2.3",
  "createdFrom": "git-commit-sha",
  "files": [
    {
      "path": "tools/kanban/index.html",
      "ownership": "managed",
      "mode": 420,
      "sha256": "hex-sha256",
      "contentBase64": "..."
    }
  ]
}
```

建置器只收錄 `monstrare-package.json` 展開後的 `managed` 與 `seed-only`
普通檔案；`project-data` 與 `source-only` 不得進入 bundle。包內必須含
`VERSION`、`monstrare-package.json` 與 planner 所需 legacy baseline。

驗證器必須：

- 只接受 `schemaVersion: 1`、嚴格 SemVer，且 bundle/version/tag/manifest 一致。
- 路徑必須是正規化 POSIX 相對路徑；拒絕絕對路徑、`..`、NUL、空路徑與重複路徑。
- 只允許普通檔案 mode `0644`/`0755`；具體化時自行建立目錄，不處理 symlink/device。
- 限制下載 32 MiB、5000 entries 與解碼後 64 MiB；單檔及總量超限都 fail closed。
- 先驗證 GitHub asset digest，再驗證每檔 SHA-256；只將通過的內容寫入 `mkdtemp` sourceRoot。
- 輸出採 canonical JSON 排序與穩定檔案順序，同一 commit 可重現建置相同 asset。

## GitHub Provider 與網路邊界

- Repository owner/name 寫在 server module 常數，不從 query/body/environment 讀取。
- 只查詢 GitHub latest release API，並二次確認 `draft=false`、`prerelease=false`、tag 為 `v<SemVer>`。
- 只選取與 tag 精確對應的唯一 bundle asset；缺失、重複或無 SHA-256 digest 都拒絕。
- 所有請求必須 HTTPS。Redirect 最多 3 次，每一 hop 的 hostname 都必須通過精確 allowlist，不以寬鬆 suffix 匹配。
- API/download 分別有 connect/response timeout，並在讀取期間執行 byte limit；不先完整載入無界限 body。
- 不使用 token、不寫入 Authorization header、不記錄 response body；對 403/rate-limit 回傳穩定錯誤碼與可重試訊息。
- 生產只使用固定 GitHub endpoint；測試透過 constructor 注入 transport/base URL，不增加 production 可調整來源。

## 暫存 Upgrade Session

`POST /api/upgrade/check` 完成後，server 只在記憶體保留一個作用中 session：

```text
planToken -> release id/tag + asset digest + sourceRoot + plan digest + expiresAt
```

- token 使用 `crypto.randomUUID()` 作為 opaque lookup key；另對 repository/release/digest/version/
  排序 plan entries 產生 SHA-256 plan digest。
- TTL 為 15 分鐘；新檢查會廢止與清理舊 session，過期、失敗、成功與 server
  shutdown 都嘗試清理 temp root。
- 重啟 server 會使所有 plan token 失效，這是預期的 fail-closed 行為。
- apply 前重新驗證 asset/bundle hash、重新呼叫 `planProjectUpgrade`，並比對
  expected versions 與 plan digest；不相同回 `UPGRADE_PLAN_STALE` 且零寫入。

## API 契約

所有 error 回應為：

```json
{
  "error": {
    "code": "UPGRADE_PLAN_STALE",
    "message": "版本計畫已改變，請重新檢查。",
    "retryable": true
  }
}
```

### `GET /api/upgrade/status`

- 不發網路請求。
- 回傳 `installedVersion`、`provider: { repository, configured }`、`lastCheck`
  與可寫性摘要；不回傳任何檔案內容。

### `POST /api/upgrade/check`

- Body 必須是 `{}` 或空 JSON object，不接受 repository/tag/URL/path。
- 回傳 `repository`、`releaseTag`、`installedVersion`、`sourceVersion`、
  `manifestStatus`、`applicable`、`counts`、`entries[{path,action,reason}]`、
  `planToken`、`expiresAt`、`message`。
- `entries` 只有相對路徑與分類，無內容、diff、target root 或 home path。

### `POST /api/upgrade/apply`

- Body：`{ expectedInstalledVersion, expectedSourceVersion, planToken, confirm: true }`。
- 輸入 schema 必須精確，多餘屬性也拒絕；`confirm !== true` 不得套用。
- 同一 process 只允許一個 apply，並保留底層 `.monstrare/upgrade.lock` 作為跨 process 防線。
- 成功回傳 `changed`、`fromVersion`、`toVersion`、`changedCount`、
  project-relative `backupPath`、`verification`、`restartRequired: true`。
- Transaction 內部失敗沿用既有 rollback。Transaction 已 commit 後的
  `verifyProject` 失敗不自動 rollback，改回 `UPDATE_APPLIED_VERIFICATION_FAILED`，
  清楚告知已更新、備份位置與需人工處理。

## HTTP 寫入防護

- Server 繼續只 bind `127.0.0.1`，不開 CORS。
- 所有 upgrade POST 只接受 `Content-Type: application/json`，並限制 body size。
- `Host` 只允許當前 listening port 上的 `127.0.0.1` 或 `localhost`；瀏覽器
  `Origin` 的 host/port 必須與當次 `Host` 完全一致，
  `Sec-Fetch-Site: cross-site` 直接拒絕。
- 不以 CORS header、cookie 或 query token 繞過同來源檢查。CLI 如未來要呼叫
  API，需另行定義不降低瀏覽器邊界的授權方式。

## UI 與狀態契約

- Topbar 順序為「同步狀態 → 檢查更新 → 看板/藍圖 tabs」；mobile 文案縮為「更新」，仍有至少 44×44px 觸控面積。
- 新對話框專用獨立 state，不重用卡片 modal 的 `openId`/dirty fields；二次確認再用獨立 alert dialog。
- 純 state reducer 覆蓋 `idle | checking | current | available | blocked | error |
  confirming | applying | success | verification-failed`；DOM renderer 只消費 state。
- 對話框開啟時移入 focus、封鎖底層 inert、限制 focus，關閉後回到 trigger。
  `Escape` 在 applying 期間不關閉；訊息更新經 `aria-live`。
- 所有 API 文字以 `textContent` 或現有 `escapeHtml` 輸出，不將 path/message 直接插入 HTML。
- 更新成功後不自動 reload；顯示「請回終端重啟 server」，避免舊 process 配新 frontend 的混合狀態。

## 預期變更檔案

- 新增 `scripts/lib/release-bundle.mjs`、`scripts/package-release.mjs` 與對應測試。
- 新增 `scripts/lib/github-release.mjs`、`tools/kanban/upgrade-api.mjs` 與對應測試。
- 修改 `tools/kanban/server.mjs`、`tools/kanban/index.html`、`tools/kanban/README.md`。
- 修改 `monstrare-package.json`、`package.json`、`scripts/check-governance.sh`，納入新的 managed/runtime/release 檢查。
- 新增 `.github/workflows/release.yml` 與發布維運文件；workflow 使用最小
  `contents: write` 權限、固定 action commit SHA，且 tag/version/check 未通過時不上傳。
- 實作期間不修改真實 cards/epics，也不自動建立 tag 或發布 release。

## 任務相依關係

```text
TASK-014 Release bundle 與契約基礎
  ├─ TASK-015 GitHub Release 取得與安全暫存
  │    └─ TASK-016 版本更新 API 與寫入防護 ─┐
  ├─ TASK-017 Variant A UI 與純狀態 ────────├─ TASK-018 UI/API 串接
  └─ TASK-019 GitHub Release 發布流程 ────────────────┐
TASK-018 + TASK-019 ─────────────────────────────────└─ TASK-020 E2E、安全與視覺驗證
```

本 repository 沒有作用中的「專案設置」Epic，所以不虛構該依賴。
TASK-008–013 已建立並驗證底層 plan/transaction/verify，本 Epic 將它們視為
既有能力，不重複實作。任務卡只存在 artifacts；除非使用者另行要求，
不新增或修改作用中看板 JSON。

## MECE 檢查

- TASK-014 只擁有 bundle schema、deterministic builder 與 materializer。
- TASK-015 只擁有 GitHub 網路邊界、asset 選擇、下載與暫存 session 原語。
- TASK-016 只擁有 server API、DTO/error mapping、CSRF/並行防護與對既有 upgrade 核心的編排。
- TASK-017 只擁有核准的 Variant A 畫面、無網路的純狀態與無障礙行為。
- TASK-018 只擁有真實 API adapter、二次確認與端對端狀態串接。
- TASK-019 只擁有 tag 到 release asset 的發布流程與維運文件，不更改 runtime。
- TASK-020 只擁有跨層驗收、安全惡意 fixture、視覺證據與最終 review，不增加新功能。

七張卡合計覆蓋來源建置、下載驗證、dry-run/apply API、Variant A、發布與完整
驗收，沒有共同擁有同一段核心邏輯。

## 審查關卡

- Product：已通過。
- UI Mockup：Variant A 已通過。
- Architecture：使用者已核准（2026-09-21）；實作時依本文檢查 bundle 契約、自我更新與 verify 失敗語意。
- Security：使用者已核准安全計畫（2026-09-21）；實作後仍需對 host allowlist、digest/bundle、CSRF、temp/path 與 release workflow 供應鏈提供證據。
- Test：使用者已核准驗證計畫（2026-09-21）；各卡必須完成對應契約，TASK-020 統一收尾。
- Code review / merge：每張卡附完成證據；TASK-020 統一對照規格。

## 安全性與可維護性審查

### 發現的問題

- 嚴重程度：高（已在計畫中解決）
- 檔案/行號：`ai/artifacts/看板版本更新/feature-spec.md`（GitHub 來源契約）
- 問題：若直接解壓不受限 archive，會引入 path traversal、symlink、特殊檔案與解壓炸彈風險。
- 影響：來源 asset 可能越界寫入或耗盡本機資源。
- 建議修法：改用有 schema、per-file hash、數量/大小/mode 上限的 JSON bundle，先完整驗證再具體化。本文與 feature spec 已納入。

- 嚴重程度：高（已在計畫中解決）
- 檔案/行號：`tools/kanban/server.mjs`（新 POST API 邊界）
- 問題：本機 server 沒有帳號系統；只限 loopback 不能單獨防止惡意網站對寫入 endpoint 發起請求。
- 影響：若 POST 邊界過寬，使用者開著看板時可能被誘發更新。
- 建議修法：保留 loopback、不開 CORS，加上嚴格 Host/Origin/Sec-Fetch-Site/JSON/body schema/confirm/token 驗證與並行鎖。

- 嚴重程度：中（已在計畫中解決）
- 檔案/行號：`tools/kanban/index.html`（新對話框）
- 問題：直接重用卡片 modal/open state 會與 dirty card 、SSE redraw 與 focus 恢復產生競態。
- 影響：使用者可能遺失未儲存輸入、誤關更新對話框或在套用中重複送出。
- 建議修法：使用獨立 upgrade state/reducer/dialog root，不觸碰 `openId` 與 `modalDirtyFields`；套用中禁止關閉與重複送出。

### 殘留風險

- GitHub 平台與 asset digest/redirect 行為屬外部契約；需在真實 release 發布前用 staging/tag fixture 驗證。
- Node.js 檔案操作仍有同一本機使用者主動置換路徑的極小 TOCTOU 視窗；底層 transaction 已以重新驗證、lock、staging 與 rollback 降低風險。
- 更新會覆寫正在執行的 server 原始檔，但無法原地替換記憶體中 process；必須由使用者重啟。
- Verify 失敗發生在 transaction commit 後，自動 rollback 可能造成更大不確定性；MVP 保留備份並要求人工決策。

### 核准建議

**核准（2026-09-21）。** 計畫已處理本次發現的高風險邊界，使用者已核准
架構、安全與測試計畫；實作仍必須逐卡提供驗證與審查證據。
