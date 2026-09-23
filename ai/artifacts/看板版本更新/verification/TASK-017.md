# 驗證報告

## 摘要

- 任務：TASK-017 實作 Variant A 版本更新 UI 與狀態呈現
- 結果：實作與驗證通過；Code review／人工驗收待完成
- 驗證者：Codex（2026-09-21）
- Browser QA：5 / 5；核准的 Variant A 視覺層級、狀態文案、sticky actions、鍵盤焦點與 responsive 行為均符合任務卡，未觀察到阻擋性問題。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `node --test tools/kanban/upgrade-ui.test.mjs tools/kanban/roadmap-data.test.mjs tools/kanban/realtime-sync.test.mjs` | 通過 | 23 / 23；版本 reducer/selector、fixture、XSS/error mapping 與既有 UI 純函式。 |
| `npm run check` | 通過 | 126 / 126；全專案測試、syntax check、governance kit check。 |
| `git diff --check` | 通過 | 無 whitespace error。 |
| Browser QA（1440×900、390×844、320×700） | 通過 | 實際操作入口、預覽、二次確認、取消、套用、關閉與各 fixture 狀態。 |

## UI 證據

| Viewport | 狀態 | 螢幕截圖 |
|---|---|---|
| 1440×900 | 可更新 | `screenshots/TASK-017-desktop-available.jpg` |
| 1440×900 | 檢查中 | `screenshots/TASK-017-desktop-loading.jpg` |
| 1440×900 | 衝突阻擋 | `screenshots/TASK-017-desktop-blocked.jpg` |
| 1440×900 | 成功 | `screenshots/TASK-017-desktop-success.jpg` |
| 390×844 | 可更新 | `screenshots/TASK-017-mobile-available.jpg` |
| 390×844 | 檢查中 | `screenshots/TASK-017-mobile-loading.jpg` |
| 390×844 | 衝突阻擋 | `screenshots/TASK-017-mobile-blocked.jpg` |
| 390×844 | 成功 | `screenshots/TASK-017-mobile-success.jpg` |

## 瀏覽器驗證

- 320px 寬度：`documentElement.scrollWidth === innerWidth === 320`；dialog 寬 304px，無水平溢出。
- Mobile 互動目標：trigger 44px；dialog close 44px；summary 46.5px；footer buttons 44px。
- 焦點：開啟後落在 `#upgrade-title`；主 dialog 前後 Tab 都會循環；二次確認 Escape 回到 `#upgrade-request-apply`；關閉後回到 `#upgrade-trigger`。
- Inert：更新 dialog 開啟時 topbar、main 與既有 card modal 具有 `inert` attribute；關閉後還原。
- 套用鎖定：`applying` 期間沒有 enabled button，Escape 不會關閉 dialog，也不會重複送出。
- Card modal 隔離：未送出的 comment fixture 在開啟及關閉 upgrade dialog 後內容保持不變，card modal 不被重建或關閉。
- 額外狀態：`current`、`permission`、`error`、`verification-failed` 都顯示明確標題與合法動作，沒有空白 dialog。

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| 初版由二次確認按 Escape 返回後未還原主動作焦點 | 中 | 已修正並以瀏覽器重測。 |
| 初版進入 applying 後沒有把焦點移回主 dialog | 中 | 已修正；套用中焦點停在標題且 Escape 被鎖定。 |
| 1440×900 初次截圖高度受到暫時 viewport 狀態影響 | 低 | 已重擷取並以檔案尺寸確認為 1440×900。 |

## 殘留風險

- 本卡刻意只使用 Promise fixture adapter，不發真實 fetch；API DTO/error mapping 的實際串接由 TASK-018 負責。
- `inert`、focus trap 與 clipboard 已在本機 Chromium host 驗證；其他瀏覽器的相容性由後續端對端卡補強。
- 真實來源逾時、plan token 過期與 transaction/rollback 錯誤目前由穩定 fixture/code mapping 覆蓋，真實 server 整合仍屬 TASK-018/TASK-020。

## 交付狀態

- 核准 Variant A 已實作並回登 design-system inventory。
- 所有任務卡列出的純狀態、停用規則、安全輸出、鍵盤與 responsive 驗收均有自動化或瀏覽器證據。
- 看板 `TASK-017` 已同步至 `verify`，驗證報告與 evidence 已連結；Code review／人工驗收完成前不標記為 `done`。
- TASK-018 可據此準備串接，但須遵循看板的前置任務規則。
