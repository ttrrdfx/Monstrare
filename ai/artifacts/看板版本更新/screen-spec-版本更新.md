# 畫面規格

## Metadata

- 功能：看板右上角版本更新入口
- 畫面：版本更新入口與預覽流程
- 狀態：Mockup 已核准（Variant A，2026-09-21）

## 目的

讓使用者從看板安全地檢查 `ttrrdfx/Monstrare` 的最新正式 GitHub Release，
在不寫入目標專案的前提下審閱 dry-run，然後透過二次確認套用更新。

主要決策是「這次更新是否安全、是否要套用」；次要資訊是版本差異、檔案分類、
衝突路徑、備份位置與重啟提示。

## 版面配置

- 主要區域：版本比較、安全狀態、add/update/remove/preserve/conflict 摘要。
- 次要區域：可收合的路徑明細、GitHub repository/release metadata、備份路徑。
- 導覽：入口放在現有 topbar 右側，順序為同步狀態 → 檢查更新 → 看板／藍圖。
- 動作：檢查更新、重試、展開詳細路徑、更新至 vX.Y.Z、取消、二次確認、複製錯誤／備份路徑。

## 狀態

| 狀態 | 必要行為 | 空狀態／錯誤文案 | 驗證方式 |
|---|---|---|---|
| 預設 | Topbar 顯示「檢查更新」，按鈕視覺權重低於視圖 tabs | — | Desktop 截圖、鍵盤 focus |
| 載入中 | 顯示「正在查詢 GitHub Release」與分階段 progress；不留空白對話框 | 「正在安全地檢查新版本…」 | Desktop/mobile 截圖、`aria-live` |
| 已是最新 | 顯示當前版本與最後檢查時間，只提供關閉／重新檢查 | 「你已使用最新的 Monstrare」 | 截圖、API fixture |
| 可更新 | 強調 from/to 版本，顯示變更計數，主動作為「更新至 vX.Y.Z」 | — | 截圖、鍵盤動線 |
| 有衝突 | 使用 warning 語意加文字，列出衝突路徑，停用套用動作 | 「發現本機客製，更新已阻擋」 | 截圖、disabled 檢查 |
| 網路／來源錯誤 | 保留對話框與錯誤摘要，提供重試與複製詳細訊息 | 「無法從 GitHub 檢查更新」 | 截圖、timeout/403 fixture |
| 套用中 | 鎖住關閉與重複送出，顯示備份→套用→驗證的進度 | 「正在建立備份並套用更新…」 | 截圖、並行請求測試 |
| 成功 | 顯示完成版本、變更數、備份路徑與「先重啟 server，不要直接重整」 | 「更新已套用，請重啟看板 server」 | 截圖、E2E |
| 驗證失敗 | 明確區分「已套用」與「驗證失敗」，顯示備份路徑 | 「更新已套用，但驗證未通過」 | 截圖、verify failure fixture |
| 權限不足 | 本機 server 無法寫入 target 時保留唯讀預覽，停用套用 | 「可預覽，但目前無法寫入專案」 | 截圖、權限 fixture |
| 行動裝置版 | 按鈕至少 44×44px；對話框成為近全螢幕，footer 動作不被捲動隱藏 | 同上 | 390×844 截圖 |

## 互動

| 動作 | 觸發條件 | 結果 | 失敗情境 |
|---|---|---|---|
| 開啟更新流程 | 點擊 topbar「檢查更新」或按 Enter/Space | 開啟 dialog/drawer，focus 移入標題並開始檢查 | 錯誤時 focus 留在錯誤摘要 |
| 展開詳細變更 | dry-run 成功 | 顯示分類路徑，不顯示檔案內容或 diff | 無路徑時不顯示空 accordion |
| 進入二次確認 | `applicable=true` 且有寫入變更 | 中斷式 alert dialog 重述 from/to、寫入數與備份行為 | plan 過期時返回預覽並重新檢查 |
| 套用更新 | 在 alert dialog 確認 | 送出 plan token，顯示套用進度 | 失敗時顯示穩定 error code 與 backup status |
| 關閉 | 非套用中狀態 | 回到看板，focus 回到 topbar 觸發按鈕 | 套用中不允許關閉 |

## 設計系統對照

- 用到的既有 design token：`--paper`、`--surface`、`--surface-sunken`、`--ink*`、
  `--line*`、`--accent*`、`--good*`、`--warn*`、`--crit*`、`--shadow-card`、
  `--shadow-modal`、`--font-ui`、`--font-mono`。
- 用到的既有元件：Topbar、Sync Status、View Tabs、Modal Overlay、Modal、Pill、Toast 的現有風格。
- 本畫面新做的元件：Version Update Trigger、Version Summary、Change Count Grid、
  Version Update Dialog、Update Confirmation Alert、Update Progress。全數只使用上述既有 token，
  Variant A mockup 已核准並登記到 `ai/context/design-system.md`；實作後才能標記為已實作。

## 視覺驗收標準

- 文字在 390px 手機版與 1440px 桌面版都不會被截斷。
- 主要動作在「可更新」狀態清楚明確；在衝突、權限不足與錯誤狀態不可套用。
- 錯誤、衝突、已是最新與成功不只靠顏色區分，同時有 icon、標題與文字。
- 色彩、字體、間距、圓角、陰影一律取自現有看板 CSS variables，沒有新增一次性視覺語言。
- 可捲動內容使用 sticky footer；二次確認使用獨立 alert dialog，不在同一個視覺層級內偽裝確認。
- 對話框開啟時底層內容 inert；開啟後 focus 移入，關閉後回到觸發按鈕。
- 行動裝置互動目標至少 44×44px，動作區不被 viewport 底部遮住。
