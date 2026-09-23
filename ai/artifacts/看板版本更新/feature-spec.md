# 功能規格書

## Metadata

- 功能：看板右上角版本更新入口
- 負責人：待指定
- 狀態：人工已核准（2026-09-18）
- 風險等級：高（會觸發專案檔案更新，但底層已有備份與回復邊界）

## 問題

使用者目前必須離開看板、切到終端，並依序執行 Monstrare `status`、
`upgrade --dry-run`、`upgrade` 與 `verify` 才能完成版本更新。這個流程難以被
發現，也無法在看板內先看到當前版本、目標版本、檔案變更與衝突。

要解決的核心不是「放一顆按鈕」，而是讓本機使用者能在不靜默覆寫
客製檔案或專案資料的前提下，從看板安全地預覽並套用既有 Monstrare
版本更新。

## 使用者

- 已把 Monstrare 安裝到本機專案、並透過瀏覽器使用治理看板的開發者。
- 希望在更新前先檢查衝突、並保留 cards、epics、context 與 artifacts 的專案維護者。

## 目標

- 在看板 topbar 右上角提供清楚、可以鍵盤操作的版本更新入口。
- 可從 server 端預先設定的 GitHub repository 查詢最新正式 release，並將
  經驗證的 release asset 當作升級 source。
- 在任何寫入前顯示已安裝版本、可用來源版本與 dry-run 結果。
- 永遠保留 `tools/kanban/cards/**`、`tools/kanban/epics.json`、`ai/context/**` 與
  `ai/artifacts/**` 等專案擁有資料。
- 出現未辨識版本、受管理檔案客製或過期計畫時 fail closed，不允許套用。
- 成功更新後清楚告知備份位置、驗證結果與重啟看板的必要性。

## 非目標

- MVP 不對目標專案執行 `git pull`、切換 branch/tag 或覆寫它的 `.git`。
- 不讓瀏覽器或 API caller 在請求內傳入任意 repository URL、ref 或下載 URL。
- MVP 不自動採用 draft、prerelease、branch head 或未符合 SemVer 的 tag。
- 不提供通用三方合併；衝突時只報告並停止。
- 不自動 commit、push、刪除備份或關閉使用者的終端。
- 不支援遠端網路使用；看板仍限定 bind 於 `127.0.0.1`。
- 不在未完成 dry-run 與人工確認的情況下提供「一鍵直接寫入」。

## 使用者故事（User Stories）

| 故事 | 身為／我想要／以便 | 驗收標準 |
|---|---|---|
| US-1 發現更新 | 身為看板使用者，我想在右上角看到更新入口，以便知道如何檢查版本。 | Desktop 與 mobile 皆可發現並操作；不會擠壓現有同步狀態與看板／藍圖 tabs。 |
| US-2 預覽變更 | 我想先查看版本差異與檔案分類，以便在寫入前判斷風險。 | 顯示 installed/source version 與 add/update/remove/preserve/conflict 計數；此步驟不寫檔。 |
| US-3 阻擋不安全更新 | 我想在有衝突或來源未設定時被阻擋，以便不會意外覆寫客製內容。 | `canApply=false` 時套用按鈕停用，畫面顯示原因與可執行的下一步。 |
| US-4 確認並更新 | 我想在看完預覽後確認套用，以便安全取得新版。 | 二次確認顯示 from/to 版本與寫入數量；server 重新計畫後才呼叫現有 transaction。 |
| US-5 了解結果 | 我想知道更新是否成功、備份在哪裡、是否要重啟，以便完成後續檢查。 | 成功、失敗、rollback 失敗與驗證失敗有不同訊息；成功後明確要求重啟 server。 |

## 使用者旅程

```text
開啟看板
→ 右上角顯示「檢查更新」
→ 點擊後開啟版本更新對話框，查詢 GitHub 最新正式 release
→ 下載並驗證 release asset 到 server 的受控暫存目錄，執行唯讀 dry-run
→ 顯示已安裝版本、來源版本、變更數量與衝突路徑
→ 無衝突時選擇「更新至 vX.Y.Z」
→ 在二次確認中再次檢視 from/to 與寫入數量
→ server 重算最新計畫並執行備份、staging、套用與驗證
→ 顯示結果、備份路徑與「請重啟看板 server」指示
```

## 功能需求

- WHEN 畫面載入，THE SYSTEM SHALL 在 topbar 右側把同步狀態、更新按鈕與視圖
  tabs 放入同一個 actions group，並保持清楚層次。
- WHEN GitHub repository 來源未設定或不合法，THE SYSTEM SHALL 保留按鈕可發現性，
  但在對話框中說明 server 端的設定方式，且不提供套用動作。
- WHEN 使用者點擊更新入口，THE SYSTEM SHALL 只從受信任的 GitHub API 查詢最新非 draft、
  非 prerelease 的正式 release，並拒絕不符合 SemVer 的 tag。
- WHEN 需要產生 dry-run，THE SYSTEM SHALL 將 release asset 下載到受控暫存目錄，
  驗證 asset digest、`VERSION`、`monstrare-package.json` 與 tag 一致後，才將其當作
  `sourceRoot`。
- WHEN 使用者檢查更新，THE SYSTEM SHALL 先執行對目標專案唯讀的升級計畫，
  不讀取或回傳 cards、context 或 artifacts 內容。
- WHEN dry-run 完成，THE SYSTEM SHALL 只回傳版本、狀態、分類計數、路徑與可套用狀態。
- WHEN 計畫含 `conflict`、不支援的 manifest/schema、降版或來源錯誤，THE SYSTEM SHALL
  停用套用按鈕並顯示可理解的原因。
- WHEN 使用者要套用更新，THE SYSTEM SHALL 要求二次確認，並送出預期 from/to
  版本與計畫摘要。
- WHEN server 收到套用請求，THE SYSTEM SHALL 重新執行 `planProjectUpgrade`，並且只在結果
  與使用者確認的版本／摘要一致時呼叫 `applyProjectUpgrade`。
- WHEN transaction 成功，THE SYSTEM SHALL 回傳 changed paths 數量、backup path 與版本。
- WHEN transaction 成功但後續驗證失敗，THE SYSTEM SHALL 明確標示「更新已套用、驗證失敗」，
  不得誤報為未更新或全部成功。
- WHEN 套用完成，THE SYSTEM SHALL 提醒使用者重啟看板 server；MVP 不猜測 npm、
  launchd 或其他外部 process manager 的重啟方式。
- WHEN 更新請求正在執行，THE SYSTEM SHALL 停用重複提交，顯示 loading 狀態，並由現有
  `.monstrare/upgrade.lock` 拒絕並行升級。

## 畫面

| 畫面 | 狀態 | 備註 |
|---|---|---|
| Topbar 版本入口 | 預設、hover、focus、停用、檢查中、有新版、mobile | 建議文案為「檢查更新」，不讓第一次點擊被誤解為立即寫入。 |
| 版本更新對話框 | 檢查中、下載與驗證中、已是最新、可更新、有衝突、來源未設定、網路錯誤 | 顯示 repository、release tag、版本與分類摘要；詳細路徑可收合。 |
| 更新確認 | 預設、送出中、計畫過期 | 顯示 from/to 與寫入檔案數，用明確動詞的主按鈕。 |
| 更新結果 | 成功、驗證失敗、套用失敗、rollback 失敗 | 顯示備份路徑、可復原性與重啟指示，錯誤時保留可複製訊息。 |

### 視覺方向

- 延用 `tools/kanban/index.html` 的 `--surface*`、`--ink*`、`--accent*`、`--warn*`、
  `--crit*` 與現有 modal 樣式，不新增孤立色碼。
- Desktop 的右側 actions 順序建議為：「同步狀態 → 檢查更新 → 看板／藍圖」。
- Mobile 優先保留 44×44px 觸控目標；文字改為短標籤「更新」，不只用無標籤 icon。
- 「檢查更新」是次要動作，視覺權重應低於對話框內的「更新至 vX.Y.Z」。

## 資料與 API

### GitHub 來源與目標路徑假設

- MVP 的唯一受信任來源固定為公開 GitHub repository `ttrrdfx/Monstrare`；
  瀏覽器、API caller 與啟動環境都不能改寫。
- 此公開 repository 的 latest release 查詢與 asset 下載不需 GitHub token。MVP 不實作
  private repository credentials；未來若增加，需另行定義 server-only secret 契約。
- 預設只採用 GitHub `latest release`；不相信 client 指定的 asset URL，也不自動使用
  repository default branch。
- 每個 release 發布專用、可重現建置的 `monstrare-vX.Y.Z.bundle.json` asset，
  並使用 GitHub asset metadata 中的 SHA-256 digest 驗證下載結果；若 release
  無可驗證 digest 則 fail closed。JSON bundle 只收錄 manifest 分類為 managed 或
  seed-only 的普通檔案，避免引入 archive 解壓器與 symlink 語意。
- 下載內容先存於 `mkdtemp` 建立的受控暫存目錄；限制回應大小、跳轉次數、
  entry 數與解碼後總大小，拒絕絕對路徑、`..`、重複路徑、不允許的 mode
  與 checksum 不符，完成或失敗後清理。
- 目標 project root 由看板模組位置推導；測試環境用獨立的
  `KANBAN_PROJECT_ROOT` 覆寫，不把目前表示 `tools/kanban` 資料根的 `KANBAN_ROOT`
  重用成不同語意。
- 暫存 source 與 target 必須不同，並沿用 `resolveSafeRoot`、inventory 與 symlink 邊界。

### 建議 API

`GET /api/upgrade/status`

- 只回傳本機已安裝版本、GitHub provider 是否已設定與最後一次檢查摘要；
  不發出外部網路請求。

`POST /api/upgrade/check`

- 輸入：`{}`；repository 與 credentials 只由 server 受控設定決定。
- 查詢 latest release，下載、驗證並具體化受信任 bundle，再呼叫唯讀的
  `planProjectUpgrade`。
- 輸出：`repository`、`releaseTag`、`installedVersion`、`sourceVersion`、
  `manifestStatus`、`applicable`、`counts`、`entries[{path, action, reason}]`、`planToken`、
  `expiresAt`、`message`。

`POST /api/upgrade/apply`

- 輸入：`{ expectedInstalledVersion, expectedSourceVersion, planToken, confirm: true }`。
- server 必須重新驗證已下載 asset 的 digest、重新計畫並比對計畫 token，
  不接受 client 傳入 repository、release、asset、source 或 target 路徑。
- 成功輸出：`changed`、`fromVersion`、`toVersion`、`changedCount`、`backupPath`、
  `verification`、`restartRequired: true`。
- 錯誤輸出：穩定 error code、可顯示訊息、可選 backup path；不回傳檔案內容或 diff。

### 計畫 token

- token 由 repository、release id/tag、asset digest、source/installed version、manifest status
  與排序後的 `{path, action, reason}` 產生 SHA-256，不含檔案內容。
- token 只用於偵測「使用者確認後計畫已改變」；底層 transaction 仍必須自行執行
  freshness 與 checksum 檢查。

## 安全性與隱私

- 身分驗證：MVP 無帳號系統；必須繼續只 bind `127.0.0.1`，不得因新 API
  改成 LAN 或公網可達。
- 權限：瀏覽器無法任意指定來源或目標路徑；只能使用 server 啟動時已確定的路徑。
- 敏感資料：MVP 不取得或儲存 GitHub token；也不輸出檔案內容、diff、
  環境變數全值或使用者 home 目錄。
- 來源信任：限定 GitHub API/asset 主機、HTTPS、redirect 次數、release 類型與 asset digest；
  不跟隨 release body 或 client input 中的下載連結。
- 濫用情境：阻擋 CSRF 類型的跨網站 POST；至少驗證 `Origin`/`Host`、
  `Content-Type: application/json`、明確 `confirm: true` 與計畫 token，並拒絕並行套用。
- 檔案安全：沿用既有 path normalization、realpath、symlink、checksum、lock、backup、
  staging、atomic replace 與 rollback 契約。
- 自我更新：server 更新了自己的 `index.html`/`server.mjs` 後，執行中的 process
  仍是舊版。成功畫面必須阻止使用者盲目 refresh，而是要求先在原終端重啟 server。

## 驗收標準

- Desktop 右上角可看到「檢查更新」，mobile 有至少 44×44px 的可觸控目標。
- 更新按鈕具備 default、hover、focus、disabled 與 loading 五態，並能用鍵盤完成整個預覽流程。
- 開啟對話框後會顯示已安裝版本、source 版本以及檔案分類計數。
- 僅檢查更新時，target 下的檔案內容、mtime 與 `.monstrare/` 都不變。
- repository 未設定、GitHub 無法連線或授權失敗、release/asset 缺失、digest 不符、
  版本不一致，或計畫存在衝突時不能套用。
- 用戶確認後如計畫改變，API 回傳 stale-plan 錯誤且零寫入。
- 安全更新後，managed 檔案升級、project-data checksum 不變、備份 journal
  完整，畫面顯示實際 backup path。
- 套用中的第二個請求被拒絕，且不留下混合版本。
- 來自非本看板 Origin 或非 JSON 的寫入請求被拒絕。
- 更新成功後畫面明確顯示需要重啟，不聲稱舊 process 已切換到新程式。
- 現有看板、藍圖、卡片編輯與 SSE 同步測試不回歸。

## 驗證計畫

- 單元測試：repository allowlist、release 過濾、SemVer/tag/manifest 一致性、digest 驗證、
  bundle path/entry/size/mode/checksum 限制、版本狀態 DTO、plan token、錯誤碼映射、Origin/Host 驗證。
- 整合測試：使用本機 fake GitHub HTTP server 與臨時 target，覆蓋
  404/403/rate limit/timeout/redirect、已是最新、digest 不符、惡意 bundle、conflict、stale plan、
  並行請求、套用失敗與 rollback。
- E2E：從可辨識的舊版 fixture 開啟看板，用 UI 預覽與套用，確認 cards/epics
  不變，重啟後版本狀態為最新。
- 視覺：擷圖驗證 desktop/mobile，並覆蓋 loading、有新版、conflict、success 四組核心狀態。
- 無障礙：鍵盤 focus order、dialog focus trap/return focus、`aria-live` 結果與對比度檢查。
- 回歸：`npm test`、`npm run check`、`git diff --check`。
- 手動：在乾淨 branch 上對一個真實下游專案執行，比對 CLI 與 UI 的 dry-run 與結果。

## 情境包

- 任務：規劃看板右上角版本更新按鈕與安全流程。
- 相關檔案：`tools/kanban/index.html`、`tools/kanban/server.mjs`、`scripts/lib/plan.mjs`、
  `scripts/lib/transaction.mjs`、`scripts/lib/verify.mjs`、現有看板/server/E2E 測試。
- 既有模式：topbar 已有同步狀態與 tabs；現有 modal/token 可重用；升級已有
  dry-run、checksum conflict、lock、backup、staging、rollback 與 verify。
- 假設：GitHub repository 會以正式 release 發佈含可驗證 SHA-256 digest 的專用
  Monstrare asset，而不只是推送 branch 或 tag。
- 已確認事項：來源為公開 GitHub repository `ttrrdfx/Monstrare`，MVP 不需 token。
- 允許變更的檔案（核准後）：看板 UI/server、相關升級 API adapter、測試、看板 README，
  以及必要的 design-system inventory 登記。
- 不得觸碰：真實 `tools/kanban/cards/*.json`、`epics.json`、現有 context/artifacts 內容（本規格目錄除外）、
  不相關產品程式。
- 驗證指令：`npm test`、`npm run check`、新增 upgrade API 整合測試、UI 截圖、
  `git diff --check`。
- 風險等級：高。
- 情境預算備註：已讀專案／架構／搜尋地圖、設計系統、topbar/modal/API route
  相關區段、升級規格與架構計畫；未展開與本功能無關的看板排版與卡片內容。

## 人工核准紀錄

- 2026-09-18：使用者確認來源固定為公開 GitHub repository `ttrrdfx/Monstrare`。
- 2026-09-18：使用者確認只從正式 GitHub Release 的專用 asset 更新，不直接使用
  branch head。
- 2026-09-18：使用者確認按鈕文案為「檢查更新」，實際寫入放在 dry-run
  後的二次確認。
- 2026-09-21：使用者選定 UI Variant A「置中摘要 Dialog」。
- 下一階段是架構、安全、測試計畫與任務卡核准；目前的產品/UI 核准不授權實作。
