# AI-Ready 任務卡

## Metadata

- 任務：串接版本更新 UI/API 與二次確認
- 上層規格：`ai/artifacts/看板版本更新/feature-spec.md`
- 上層 Epic：看板版本更新
- 上層 User Story：US-1 發現更新、US-2 預覽變更、US-3 阻擋不安全更新、US-4 確認並更新、US-5 了解結果
- 分軌：前後端串接
- 前置任務（dependsOn）：TASK-016、TASK-017
- 狀態：草稿
- 風險等級：高
- Agent owner：待指定
- 人工核准者：使用者（2026-09-21，核准架構、安全與測試契約；待 TASK-016、TASK-017 完成）

## 目標

將 Variant A 的狀態機串上真實 status/check/apply API，以獨立二次確認完成從預覽到寫入結果的完整用戶旅程。

## 情境包（Context Pack）

- 相關檔案：TASK-016 `tools/kanban/upgrade-api.mjs`、TASK-017 `tools/kanban/index.html`、`tools/kanban/upgrade-api.test.mjs`、`tools/kanban/upgrade-ui.test.mjs`、`screen-spec-版本更新.md`。
- 既有模式：同來源 `api()` fetch helper、request gate、SSE invalidation、穩定 error envelope、dialog state reducer。
- 假設：TASK-016/017 的 API/UI contract 已各自通過。
- 未知事項：無。
- 允許變更的檔案：`tools/kanban/index.html`、`tools/kanban/upgrade-integration.test.mjs`、必要時小幅修正 `tools/kanban/upgrade-api.mjs` 的 adapter 邊界（不改公開 DTO）。
- 不得觸碰：GitHub provider/bundle 核心、release workflow、真實 cards/epics、既有 transaction 行為。
- 驗證指令：`node --test tools/kanban/upgrade-integration.test.mjs tools/kanban/upgrade-ui.test.mjs tools/kanban/upgrade-api.test.mjs`、`npm run check`、browser 旅程驗證。

## 需求

- 開頁用 `GET status` 取得已安裝版本/provider 狀態；不自動觸發 GitHub 檢查。
- 點擊 trigger 開啟 dialog 後呼叫 `POST check`，將 loading/current/available/blocked/error 映射到已定義狀態。
- 只在 `applicable=true`、有寫入變更與 plan token 未過期時啟用「更新至 vX.Y.Z」。
- 按下更新先開獨立 alert dialog，重述 from/to、add/update/remove 寫入數與備份行為；只有明確確認才送 apply。
- Apply body 只含 expected versions、opaque plan token 與 `confirm: true`；不傳 source/repository/path。
- 對 stale plan 自動回到 checking 並告知重新檢查；對 rate limit/network/busy/rollback/verification failure 顯示不同、可操作的訊息。
- Applying 期間停用所有送出/關閉，並防止連點、過期 response 或 SSE redraw 改寫目前狀態。
- Success/verification-failed 顯示 project-relative backup path、changed count、verification summary 與「重啟 server，勿直接重整」；不自動 reload。

## 非目標

- 不新增 API 或變更 DTO、不修改 release/bundle 核心。
- 不自動 retry apply、自動 restart server 或自動 rollback verify failure。
- 不在成功後自動重載頁面。

## 驗收標準

- 從 trigger 到 check 結果、開啟/取消/確認、apply 進度、成功或失敗的每一步都可重現且只產生一次預期 request。
- 二次確認顯示的版本/寫入數與 apply body 來自同一份未過期 check result。
- 過期或被後來檢查取代的 response 不會覆寫新 state；stale token 不會直接重送 apply。
- 無網路、GitHub rate limit、conflict、權限不足、busy、rollback failure、verification failure 皆有不同文案與允許動作。
- 套用期間多次點擊/按 Enter/Escape 不會產生第二個 apply 或關閉 dialog。
- 成功與驗證失敗都清楚告知「已套用」與重啟需求；不宣稱舊 process 已更新。

## 實作備註

- 可延伸現有 `api()` 或建立專用 upgrade adapter，但必須保持現有 card API 錯誤行為不變。
- 以 sequence/AbortController 防止過期 check response；apply 不自動 retry。
- 只在串接層做 DTO 到 view state 的映射，不把 server error 原文直接當 HTML。

## 驗證契約

- 單元測試：DTO-to-state/error mapping、request body、stale response gate、double-submit guard。
- 整合測試：fake fetch 覆蓋 status/check/apply 完整旅程、各錯誤碼、cancel/confirm 與 plan expiry。
- E2E 測試：以真實本機 server + fake provider 驗證一次完整 UI 旅程；全方位矩陣由 TASK-020 收尾。
- 型別檢查：不適用。
- Lint：不適用。
- Build：現有 inline script syntax/governance 檢查。
- 螢幕截圖：available 二次確認、applying、success、verification-failed。
- 安全性檢查：不傳任意 URL/path、XSS message/path、CSRF 失敗映射、重複送出、過期 plan。

## 完成證據

- 變更的檔案：待實作後填寫。
- 執行過的指令：待實作後填寫。
- 測試輸出：待實作後填寫。
- 螢幕截圖：待實作後填寫。
- 已知限制：待實作後填寫。
- 後續任務：TASK-020。
