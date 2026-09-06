# AI-Ready 任務卡

## Metadata
- 任務：實作心智圖互動與無障礙導覽
- 上層規格：`screen-spec-藍圖心智圖.md`
- 上層 Epic：看板體驗改善
- 上層 User Story：藍圖心智圖
- 分軌：前端
- 前置任務（dependsOn）：TASK-002
- 狀態：完成
- 風險等級：中
- Agent owner：Codex
- 人工核准者：使用者（2026-09-05）

## 目標
讓聚焦樹可平移、縮放、回到全景與收合，並能用鍵盤完成核心導覽。

## 情境包（Context Pack）
- 相關檔案：`tools/kanban/index.html`、TASK-002 產出。
- 既有模式：事件委派、focus-visible、reduced-motion。
- 假設：視口狀態不持久寫入檔案。
- 未知事項：無。
- 允許變更的檔案：`tools/kanban/index.html`、前端測試檔。
- 不得觸碰：server route 與 Card schema。

## 需求
- 加入滾輪/按鈕縮放、拖曳平移、回到全景與縮放上下限。
- Epic/Story 收合需保留進度，重新 render 不丟失頁籤內收合狀態。
- 定義節點 tab order、Enter/Space 動作、focus ring、disabled/loading 狀態與 reduced-motion。

## 驗收標準
- 滑鼠、觸控與鍵盤均可進行核心導覽；工具按鈕可存取名稱正確。
- 縮放不超出上下限，全景操作可讓所有可見節點回到視口。
- 收合不改變原始資料與進度，切換 Epic 後視口回復全景。

## 實作備註
以 CSS transform 移動畫布，不直接改寫每個節點的 DOM 座標。

## 驗證契約
- 單元測試：zoom clamp、fit-to-view、collapse filtering。
- 整合測試：事件與狀態轉換。
- E2E 測試：鍵盤、點擊、收合、切 Epic。
- 型別檢查：不適用。
- Lint：不適用。
- Build：啟動本機 server。
- 螢幕截圖：預設、收合、390px。
- 安全性檢查：觸控/滑鼠 listener 在不需要時清理。

## 完成證據
- 變更的檔案：`tools/kanban/index.html`、`tools/kanban/roadmap-data.test.mjs`、本任務卡、`verification/TASK-003.md`、`tools/kanban/cards/TASK-003.json`
- 執行過的指令：`node --test tools/kanban/roadmap-data.test.mjs`、`node --check tools/kanban/server.mjs`、`git diff --check`
- 測試輸出：10/10 通過；console 無 warning/error
- 螢幕截圖：透過瀏覽器工具完成桌面預設、Epic 收合與 390×844 全景擷取；未另寫入 repository
- 已知限制：不儲存節點自由座標
- 後續任務：TASK-006
