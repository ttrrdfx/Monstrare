# 驗證報告

## 摘要

- 任務：TASK-015 實作固定 GitHub Release 取得與安全暫存
- 結果：通過
- 驗證者：Codex

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `node --test test/monstrare/github-release.test.mjs test/monstrare/release-bundle.test.mjs` | 通過 | 24/24；TASK-015 13 項與 TASK-014 11 項契約測試全部通過。 |
| `node --check scripts/lib/github-release.mjs` | 通過 | Provider、download 與 session store 語法正確。 |
| `npm run check` | 通過 | 102/102 tests；syntax check 與 governance kit check 通過。 |
| `git diff --check` | 通過 | 無 whitespace error。 |

## UI 證據

| Viewport | 螢幕截圖 | 備註 |
|---|---|---|
| 桌面版 | 不適用 | TASK-015 無 UI 或 HTTP route 變更。 |
| 行動裝置版 | 不適用 | TASK-015 無 UI 或 HTTP route 變更。 |

## 驗收覆蓋

- 本機 fake HTTP transport fixture 證明固定 API URL 可取得正式 release，下載並以
  GitHub metadata SHA-256 驗證 outer bytes，再委派 TASK-014 validator/materializer；
  產生的 `sourceRoot` 可讀取正確 `VERSION`。
- Provider options 對未知欄位 fail closed，無 repository、API URL 或 hostname override；
  production 不讀取環境變數 token，所有 request 均無 `Authorization`。
- Draft、prerelease、非 `v<SemVer>` tag、asset 缺失／重複、digest 缺失／非 canonical、
  固定 repository/tag asset URL 不一致、outer digest、bundle/version/manifest 不一致皆拒絕。
- 每一個 redirect hop 都重新驗證 HTTPS、精確 hostname、標準 HTTPS port；允許最多三跳，
  blocked host/protocol 與超限都回穩定錯誤碼。
- Request header timeout、response body timeout、metadata/download byte limit、中斷 body、
  403、rate limit 與 404 路徑皆有測試；失敗 response body 不進錯誤訊息。
- Temp source 在下載、digest、bundle 或 materialize 失敗時 cleanup；成功後 cleanup 可重複呼叫。
- Session token 由 production `crypto.randomUUID()` 產生；store 只保留一個 active session，
  新 session 清理舊 root，TTL 最長 15 分鐘，過期與手動 cleanup 可重複呼叫且不擲錯。
- `scripts/lib/github-release.mjs` 由既有 `scripts/lib/**` manifest pattern 分類為 managed；
  未新增 production dependency。

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| 取消 rejected/redirect response body 若等待底層 `cancel()`，可能使 timeout 後仍阻塞 | 中 | 已修復：取消改為 non-blocking best effort，body 失敗同時 abort controller。 |
| 固定 asset URL 原先未明確拒絕 URL fragment | 低 | 已修復：固定 repository/tag/path 驗證同時要求 query 與 fragment 皆空。 |
| 注入 clock 若超出 JavaScript Date 範圍，session 日期序列化可能拋出非穩定錯誤 | 低 | 已修復：建立 session 前驗證 now/expiry 都是可序列化日期。 |
| 未發現其他阻擋性正確性、安全、隱私、授權、架構偏移或維護性問題 | 無 | 核准。 |

## 高風險關卡

- 網路／SSRF：latest endpoint 與 repository 為 module 常數；初始 asset 必須是
  `github.com/ttrrdfx/Monstrare/releases/download/<tag>/<exact-name>`；API 與 asset
  redirect 使用分離的精確 host allowlist，不接受 HTTP、userinfo 或非 443 port。
- 供應鏈／完整性：asset 名稱唯一且對應 tag；metadata digest 必須是 canonical
  `sha256:<hex>`；先比對 raw bytes，再驗證 bundle schema、per-file hash、VERSION、
  manifest ownership 與 release version，完成後才 materialize。
- 資源耗盡：metadata 1 MiB、download 32 MiB 硬上限不可提高；同時檢查
  `Content-Length` 與 streaming byte count；request/response 各自 timeout，redirect 最多三跳。
- 檔案／清理：production 以 `mkdtemp` 建立獨立 temp root；沿用 TASK-014 空白 root、
  symlink/path/mode/hash 邊界；失敗與 session disposal 不回顯絕對路徑並 best-effort cleanup。
- 敏感資料：公開 repository 模式不讀取或儲存 token；request 不送 Authorization；
  錯誤不包含 response body、bundle 內容、環境變數、home 或 temp path。
- 可維護性：provider、受限 transport helpers、session store 與 orchestration 各自聚焦；
  transport/clock/temp factory 僅作測試 seam，production source constants 不可由 options 覆寫。

## 殘留風險

- 真實 GitHub asset digest 與 redirect 平台行為尚未在 staging release 驗證，依核准範圍
  留給 TASK-019／020；本卡只使用本機 fake provider/transport，未建立或發布真實 release。
- OS 權限或外部程序持有檔案時，temp cleanup 可能失敗；cleanup 採 best effort，session
  仍立即失效且不會把未清理 root 當作可用來源。
- 本卡沒有 HTTP routes、dry-run plan 或 apply 編排；分別由 TASK-016 與後續卡片負責。

## 核准建議

核准。TASK-015 的固定來源、下載邊界、雙層完整性驗證、temp lifecycle 與 session
原語已符合任務卡；可供 TASK-016 編排 API 與唯讀 plan。
