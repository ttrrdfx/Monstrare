# TASK-018 驗證報告

## 結果

- 版本更新 UI 已接上 `status`、`check`、`apply` API 與獨立二次確認。
- 驗證通過；Code review 與人工驗收尚未完成，看板停在 `verify`。
- Browser QA：4 / 5。桌面流程、焦點、套用鎖定與結果可操作；本卡未重新做行動版及真實 GitHub Release 的瀏覽器測試。

## 指令與證據

| 指令 | 結果 |
|---|---|
| `node --test tools/kanban/upgrade-integration.test.mjs tools/kanban/upgrade-ui.test.mjs tools/kanban/upgrade-api.test.mjs` | 31 / 31 通過 |
| `npm run check` | 133 / 133，全專案測試、syntax、governance 通過 |
| `git diff --check` | 通過 |

`upgrade-integration.test.mjs` 覆蓋本機 status 讀取、不自動 check、精確 apply body、取消、計畫過期、過時 response、重複送出、stale 自動重查、唯讀狀態競態、驗證失敗，以及真實本機 HTTP handler 配假 provider 的完整旅程。

## 瀏覽器驗證

使用本機假資料 HTTP 服務供應看板頁面，不存取 GitHub，也不寫入專案。成功與驗證失敗各走一次 UI 流程：開頁只有 status，開啟視窗才 check；二次確認重述 v1.0.0 → v1.1.0 與新增 1／更新 2／移除 1；套用時按鈕停用、Escape 不關閉；完成後顯示寫入數、專案相對備份路徑、驗證摘要及重啟提示。每段旅程的服務端計數都是 check 1 次、apply 1 次，頁面沒有自動重載。

| 狀態 | 截圖 |
|---|---|
| 可更新 | [TASK-018-available.png](screenshots/TASK-018-available.png) |
| 二次確認 | [TASK-018-confirm.png](screenshots/TASK-018-confirm.png) |
| 套用中 | [TASK-018-applying.png](screenshots/TASK-018-applying.png) |
| 成功 | [TASK-018-success.png](screenshots/TASK-018-success.png) |
| 已套用但驗證失敗 | [TASK-018-verification-failed.png](screenshots/TASK-018-verification-failed.png) |

## 安全性與限制

- Apply body 僅包含 expected versions、opaque plan token、`confirm: true`；伺服器繼續執行同源、計畫新鮮度與交易防護。
- API 錯誤原文不插入 HTML；路徑及驗證訊息用 `textContent`。rollback 失敗會顯示可用的專案相對備份路徑。
- 瀏覽器使用假資料 HTTP 服務；真實 GitHub 網路、bundle 驗證、不同瀏覽器和行動版回歸留待 TASK-020。成功與失敗截圖都不是對本專案的實際更新。
- 原有看板與治理檔案已有未提交變更；本卡未清理或覆寫那些變更。
