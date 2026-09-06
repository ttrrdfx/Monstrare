# AI-Ready 任務卡

## Metadata
- 任務：實作 Variant C 聚焦樹畫面
- 上層規格：`feature-spec.md` 與 `screen-spec-藍圖心智圖.md`
- 上層 Epic：看板體驗改善
- 上層 User Story：藍圖心智圖
- 分軌：前端
- 前置任務（dependsOn）：TASK-001
- 狀態：完成
- 風險等級：中
- Agent owner：待指定
- 人工核准者：使用者（2026-09-05）

## 目標
以選定的 Variant C 取代現有藍圖直向卡片清單，完成 Epic 導覽列與選定 Epic 聚焦樹的靜態呈現。

## 情境包（Context Pack）
- 相關檔案：`tools/kanban/index.html`、核准的 Variant C HTML、TASK-001 產出。
- 既有模式：CSS variables、`escapeHtml`、事件委派、原有 modal。
- 假設：不引入圖形 library。
- 未知事項：無。
- 允許變更的檔案：`tools/kanban/index.html`、`tools/kanban/screen-spec.md`。
- 不得觸碰：看板六欄邏輯、server API、modal 欄位。

## 需求
- 實作 Epic 左側導覽，顯示名稱與聚合進度。
- 實作選定 Epic 的 Story/Task 節點與 SVG 連線，保留階段、風險與完成狀態。
- 補齊 loading/empty/error/read-only/mobile 視覺狀態。

## 驗收標準
- 桌面與 390px 寬度對齊核准 mockup，手機 Epic 列改為水平捲動。
- 50 Task/10 Story 樣本中節點文字可讀，可透過收合避免過長畫面。
- 點 Task 仍能開啟原有 modal；未分類任務可見。

## 實作備註
樣式只用現有 token；新元件實作後回登 `ai/context/design-system.md` inventory。

## 驗證契約
- 單元測試：節點座標與連線輸出。
- 整合測試：Task 點擊與 modal 串接。
- E2E 測試：切換 Epic、空狀態、未分類。
- 型別檢查：不適用。
- Lint：不適用。
- Build：啟動 `node tools/kanban/server.mjs`。
- 螢幕截圖：1440×900、390px 與空/錯誤狀態。
- 安全性檢查：所有 JSON 文字均 escape。

## 完成證據
- 變更的檔案：`tools/kanban/index.html`、`tools/kanban/roadmap-data.test.mjs`、`tools/kanban/screen-spec.md`、`ai/context/design-system.md`
- 執行過的指令：`node --test tools/kanban/roadmap-data.test.mjs`、`node --check tools/kanban/server.mjs`、現有 server API curl 驗證
- 測試輸出：7 項測試全部通過；瀏覽器驗證 Epic 選取、Story 收合與 Task modal 串接
- 螢幕截圖：`ai/artifacts/看板體驗改善/verification/screenshots/TASK-002-*.jpg`
- 已知限制：本卡不包含 pan/zoom 完整互動
- 後續任務：TASK-003
