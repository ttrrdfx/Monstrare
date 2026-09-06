# AI-Ready 任務卡

## Metadata
- 任務：看板體驗改善架構基礎
- 上層規格：`ai/artifacts/看板體驗改善/feature-spec.md`
- 上層 Epic：看板體驗改善
- 上層 User Story：藍圖心智圖
- 分軌：前端
- 前置任務（dependsOn）：無
- 狀態：完成
- 風險等級：中
- Agent owner：待指定
- 人工核准者：使用者於對話中指示執行 TASK-001（2026-09-05）

## 目標
建立 Variant C 所需的前端狀態與階層資料轉換基礎，不先實作畫布互動。

## 情境包（Context Pack）
- 相關檔案：`tools/kanban/index.html`、`tools/kanban/epics.json`、已核准 spec/mockup。
- 既有模式：單檔 vanilla JS，`EPICS`/`TICKETS` 為 client state，`renderAll()` 統一重繪。
- 假設：Epic/User Story 名稱在當前 schema 中是關聯 key。
- 未知事項：無。
- 允許變更的檔案：`tools/kanban/index.html`、對應 `node:test` 測試檔。
- 不得觸碰：Card schema、寫入 API、dependsOn 規則。

## 需求
- 建立 selected Epic、collapsed branches、viewport 與 sync state 的明確狀態容器。
- 建立純函式，產生 Epic 進度與選定 Epic 的 Story/Task 樹，包含未分類任務。
- 保留現有 roadmap 功能，本卡不更換畫面。

## 驗收標準
- 每張 Task 剛好出現一次，進度計算與現有邏輯一致。
- selected Epic 不存在時安全回退到第一個 Epic；空資料不拋錯。
- 現有看板、modal、拖曳與 API 儲存行為無回歸。

## 實作備註
優先抽出可測試純函式；若單檔無法被 `node:test` import，可在不新增 dependency 下將純函式移至小型 `.mjs` module。

## 驗證契約
- 單元測試：進度、未分類、空 Epic、選擇回退。
- 整合測試：現有資料可完整 render。
- E2E 測試：不適用（後續卡覆蓋）。
- 型別檢查：不適用。
- Lint：不適用（專案無 lint 設定）。
- Build：`node --check tools/kanban/server.mjs`。
- 螢幕截圖：不適用。
- 安全性檢查：不接受任意 HTML，節點文字必須 escape。

## 完成證據
- 變更的檔案：`tools/kanban/index.html`、`tools/kanban/roadmap-data.test.mjs`
- 執行過的指令：`node --test tools/kanban/roadmap-data.test.mjs`、`node --check tools/kanban/server.mjs`、本機 server API smoke test
- 測試輸出：5 項測試通過；瀏覽器實測看板、藍圖與任務詳情 modal 正常，console 無 error/warn
- 螢幕截圖：不適用
- 已知限制：本卡不實作新畫面
- 後續任務：TASK-002、TASK-004
