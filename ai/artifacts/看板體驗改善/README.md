# 看板體驗改善（已完成封存）

狀態：2026-09-07 已完成，作用中看板已清空。

這個目錄保存此 repository 相對原版 Monstrare 的看板客製紀錄，包括：

- `feature-spec.md`：藍圖心智圖與即時同步的需求、非目標與驗收標準。
- `screen-spec-藍圖心智圖.md`：畫面、互動、響應式與無障礙規格。
- `mockup-decision-藍圖心智圖.md`：三個版型比較及 Variant C 選型結果。
- `architecture-plan.md`：前端狀態、SSE 契約、資料流與風險緩解。
- `task-cards/`：六張已完成 task 的範圍與驗證契約。
- `verification/`：逐 task 驗證報告與持久化 UI 截圖。
- `mockups/`：選型時使用的三個可開啟 HTML mockup。

這些檔案是歷史與稽核證據，不是未完成 backlog。作用中的看板資料只讀取
`tools/kanban/cards/*.json` 與 `tools/kanban/epics.json`。
