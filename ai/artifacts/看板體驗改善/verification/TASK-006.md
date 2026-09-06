# 驗證報告

## 摘要

- 任務：TASK-006 即時同步與心智圖 E2E／視覺驗證
- 結果：通過
- 驗證者：Codex
- 日期：2026-09-07

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `node --test tools/kanban/*.test.mjs` | 通過 | 17/17；資料轉換、收合、wheel delta 正規化、同步 gate、API/SSE、直接檔案替換、heartbeat 與 client cleanup。 |
| `node --check tools/kanban/server.mjs` | 通過 | server syntax check。 |
| `node --input-type=module --check`（擷取 `index.html` module script） | 通過 | browser module syntax check。 |
| `git diff --check` | 通過 | 無 whitespace error。 |
| 臨時 `KANBAN_ROOT`、50 Task / 10 Story、兩個 browser tabs | 通過 | 未改寫真實 `tools/kanban/cards` 或 `epics.json`。 |

## E2E 證據

| 情境 | 結果 | 證據 |
|---|---|---|
| 雙頁籤與直接 JSON | 通過 | 外部直接改寫 `TASK-001.json` 後，第二頁籤在不 reload 下顯示新標題，狀態維持「即時同步」。 |
| dirty modal | 通過 | 第一頁籤保留「本地尚未儲存草稿」，背景看板仍取得外部更新。 |
| server restart | 通過 | server 停止後顯示「重新連線中」；同 port 重啟後自動回到「即時同步」並保留最新資料。 |
| 快速連續事件 | 通過 | 單元測試確認 cards/epics invalidation 合併且 latest request gate 拒絕過期回應。 |
| 觸控板／滾輪縮放倍率 | 通過 | 倍率依累積 `deltaY` 計算，不再依事件數固定跳 10%；正反相同輸入可精確回到原倍率。瀏覽器實測 `0.699454 → 0.788632 → 0.699454`。 |
| git 替換語意 | 通過 | watcher 測試以 temp file + rename 覆蓋原檔，收到 cards change event。 |
| 大型聚焦樹 | 通過 | DOM 為 1 Epic、10 Story、50 Task、60 edges；desktop/mobile 均無 body 水平溢出。 |
| 收合 | 通過 | 收合後 0 Story / 0 Task，Epic 根節點重新 fit 並保持可見、可讀。 |

## UI 證據

本次以 Codex in-app browser 實際擷取並人工檢視下列七種狀態；preview state 可用 query string 重現：

| Viewport／狀態 | 結果 | 備註 |
|---|---|---|
| 1440×900 預設藍圖 | 通過 | 6 Task / 3 Story，與 Variant C 的左側 Epic 導覽及聚焦樹結構一致。 |
| 1440×900 大型資料 | 通過 | 50 Task / 10 Story 完整 render；全景縮放後可再放大檢視。 |
| 390×844 大型資料 | 通過 | 無 body overflow；三個工具列按鈕皆為 44×44px。 |
| 390×844 loading | 通過 | `?roadmapState=loading` 顯示 skeleton。 |
| 390×844 empty | 通過 | `?roadmapState=empty` 顯示說明與建立資料指引。 |
| 390×844 error | 通過 | `?roadmapState=error` 顯示明確錯誤與 44px 以上重試按鈕。 |
| 390×844 collapsed | 通過 | 收合後 Epic 根節點尺寸約 201×114px、位於 viewport 內。 |

瀏覽器 console 在預設桌面流程無 warning/error。畫面未發現文字截斷造成資訊遺失、節點重疊或低對比問題。

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| 大型全景收合後沿用舊 viewport，根節點移出畫面且過小 | 中 | 已修正：收合/展開後重新 fit；Epic 完全收合時縮小 layout width；已補單元斷言與 mobile 視覺回歸。 |
| 觸控板把每個細小 wheel event 固定換算成 10% 縮放，造成倍率指數跳動且正反不對稱 | 中 | 已修正：以 delta 與 deltaMode 正規化後使用指數倍率，限制單次極端輸入；已補事件切分不變性與反向對稱測試。 |
| server 僅 bind `127.0.0.1` | 資訊 | 通過。 |
| card route 先 `decodeURIComponent` 再以嚴格 `ID_RE` 驗證 | 資訊 | 無路徑穿透。 |
| 動態 HTML 文字走 `escapeHtml` | 資訊 | 通過。 |
| SSE close/error 與 write failure 清理 client | 資訊 | 測試通過。 |

## 殘留風險

- 瀏覽器截圖保留在本次 Codex 執行紀錄中，repository 內未新增二進位截圖檔；所有狀態皆可用本報告列出的 viewport、fixture 規模與 query string 重現。
- 多點觸控 pinch 仍是人工與程式碼路徑驗證，未透過真實行動裝置硬體自動化。
- TASK-006 可進入人工驗收／code review；production dependency、公開 API 與真實資料均未變更。
