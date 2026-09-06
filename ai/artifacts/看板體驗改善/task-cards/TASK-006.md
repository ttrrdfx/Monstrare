# AI-Ready 任務卡

## Metadata
- 任務：即時同步與心智圖 E2E／視覺驗證
- 上層規格：`feature-spec.md` 全部驗收標準
- 上層 Epic：看板體驗改善
- 上層 User Story：驗證與回歸測試
- 分軌：不適用
- 前置任務（dependsOn）：TASK-003、TASK-005
- 狀態：驗證中
- 風險等級：中
- Agent owner：待指定
- 人工核准者：待核准架構計畫

## 目標
建立完整可重現的自動化與視覺證據，確認新功能達標且現有看板行為無回歸。

## 情境包（Context Pack）
- 相關檔案：所有本 Epic 實作、spec、screen spec、mockup。
- 既有模式：`node:test`、本機 server、瀏覽器截圖驗證。
- 假設：驗證不修改 production 邏輯，除非發現範圍內 defect。
- 未知事項：無。
- 允許變更的檔案：測試檔、`ai/artifacts/看板體驗改善/verification/`、範圍內 defect 對應檔。
- 不得觸碰：不相關 workflow/template、使用者未提交變更。

## 需求
- 覆蓋雙頁籤、直接 JSON、git 替換、server restart、dirty modal 與快速連續事件。
- 使用 50 Task/10 Story 驗證大型聚焦樹，覆蓋 desktop/mobile/loading/empty/error/collapsed。
- 建立驗證報告，列出指令、結果、截圖與殘留風險。

## 驗收標準
- feature spec 每項驗收條件都有對應證據或明確失敗紀錄。
- 所有自動測試、syntax check 與核心手動流程通過。
- 螢幕截圖對齊 Variant C，無文字截斷、不可讀重疊或低對比。

## 實作備註
測試必須使用臨時資料目錄，不改寫使用者真實 cards/epics。

## 驗證契約
- 單元測試：執行全部 `node:test`。
- 整合測試：API/SSE/watcher 全路徑。
- E2E 測試：雙頁籤、斷線恢復、dirty modal。
- 型別檢查：不適用。
- Lint：不適用。
- Build：`node --check tools/kanban/server.mjs`與實際啟動。
- 螢幕截圖：1440×900、390px、七種資料/連線狀態。
- 安全性檢查：localhost bind、HTML escaping、SSE client cleanup、無路徑穿透。

## 完成證據
- 變更的檔案：`tools/kanban/index.html`、`tools/kanban/roadmap-data.test.mjs`、`ai/artifacts/看板體驗改善/verification/TASK-006.md`。
- 執行過的指令：`node --test tools/kanban/*.test.mjs`、server/module syntax check、`git diff --check`、臨時資料 E2E。
- 測試輸出：17/17 自動測試通過；雙頁籤、直接 JSON、dirty modal、server restart、大型樹與觸控板倍率正規化皆通過。
- 螢幕截圖：已擷取 1440×900 預設/大型與 390×844 大型/loading/empty/error/collapsed 狀態，細節見驗證報告。
- 已知限制：pinch 未使用真實行動裝置硬體自動化；截圖保留於 Codex 執行紀錄，未提交二進位檔。
- 後續任務：人工驗收與 code review。
