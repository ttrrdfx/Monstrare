# Mockup 決策

## Metadata

- 功能：看板右上角版本更新入口
- 畫面：版本更新入口與預覽流程
- 決策負責人：使用者
- 狀態：已選定 Variant A（2026-09-21）

## 變體

| 變體 | 說明 | 優點 | 風險 |
|---|---|---|---|
| A — 置中摘要 Dialog | 延用現有 modal，以版本對照、安全結論、變更計數與可收合明細為主 | 最貼近現有看板；實作小；主要決策集中；二次確認容易獨立 | 路徑很多時需在 modal 內捲動 |
| B — 右側細節 Drawer | 從右側展開 440px 面板，保留左側看板脈絡，詳細變更以縱向區塊呈現 | 容納長清單最好；看板仍可辨識；可擴充為完整更新中心 | 專案現在沒有 drawer；手機需另做近全螢幕版；實作複雜度中 |
| C — 三步驟 Wizard | 以「1 檢查來源 → 2 審閱變更 → 3 確認套用」明示流程 | 安全邊界最清楚；對新手最有引導性；容易顯示當前進度 | 狀態與返回行為最多；簡單更新也顯得繁複；無法直接重用現有 modal 結構 |

## 設計系統對照

- 重用的 token／元件：現有看板 `--surface*`、`--ink*`、`--line*`、`--accent*`、
  `--good*`、`--warn*`、`--crit*`、shadow/font variables，以及 Topbar、Sync Status、View Tabs、
  Modal、Pill、Toast 的視覺模式。
- 新做並登記回 inventory 的元件：Version Update Trigger、Version Summary、
  Change Count Grid、Version Update Dialog、Update Confirmation Alert、Update Progress。
  Variant A 目前為「mockup 已核准」，實作後才轉為「已實作」。

## 選定的變體

- 變體：A — 置中摘要 Dialog
- 為何選這個：A 最貼近現有 modal 與 topbar，對於低頻但高風險的更新動作，
  能用最少的新互動模式保持清楚層次。
- 實作前要求的修改：無；依 Variant A mockup 的版面與狀態規格實作。

## 人工核准

- 核准者：使用者
- 日期：2026-09-21
- 備註：使用者選擇 A；UI mockup 關卡通過，可進入 architecture plan 與 task cards。
