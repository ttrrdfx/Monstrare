# AI-Ready 任務卡

## Metadata

- 任務：實作 Variant A 版本更新 UI 與狀態呈現
- 上層規格：`ai/artifacts/看板版本更新/feature-spec.md`
- 上層 Epic：看板版本更新
- 上層 User Story：US-1 發現更新、US-2 預覽變更、US-3 阻擋不安全更新、US-5 了解結果
- 分軌：前端
- 前置任務（dependsOn）：TASK-014
- 狀態：審查中（2026-09-22；實作與驗證完成，Code review／人工驗收待完成）
- 風險等級：中
- Agent owner：Codex
- 人工核准者：使用者（2026-09-21，核准 Variant A、架構與測試契約；TASK-014 已完成）

## 目標

將已核准的 Variant A 置中摘要 Dialog 實作到現有單檔看板 UI，建立可獨立測試的版本更新狀態機，但本卡不串真實 API。

## 情境包（Context Pack）

- 畫面名稱：看板 Topbar 版本更新入口與預覽對話框（Variant A）。
- 目標 viewport：1440×900 desktop、390×844 mobile；支援 320px 以上不產生水平溢出。
- 相關檔案：`tools/kanban/index.html`、`tools/kanban/upgrade-ui.test.mjs`、`ai/context/design-system.md`、`screen-spec-版本更新.md`、`mockup-decision-版本更新.md`、`mockups/版本更新-variant-a.html`。
- 既有模式：CSS variables、topbar/view-tabs、modal overlay、pill/toast、`escapeHtml`、可被測試抽取的 `export function` 標記區段。
- 假設：API DTO/error codes 以架構筆記為契約；本卡用 fixture/injected adapter 驅動。
- 未知事項：無；Variant A 已選定。
- 允許變更的檔案：`tools/kanban/index.html`、`tools/kanban/upgrade-ui.test.mjs`、`ai/context/design-system.md`（實作完成後狀態更新）、本任務卡與驗證報告，以及本卡 `tools/kanban/cards/TASK-017.json` 的進度與證據欄位。
- 不得觸碰：`tools/kanban/server.mjs`、upgrade backend modules、其他 cards/epics、現有 card modal 的儲存邏輯。本卡 `TASK-017.json` 的進度與證據欄位依看板同步規則更新。
- 重用 design token/元件：`--paper`、`--surface*`、`--ink*`、`--line*`、`--accent*`、`--good*`、`--warn*`、`--crit*`、`--shadow-modal`、`--font-ui`、`--font-mono`；Topbar、Sync Status、View Tabs、Modal、Pill、Toast。
- 新元件：Version Update Trigger/Summary/Change Count Grid/Dialog/Confirmation Alert/Progress；已以 Variant A 登記 inventory，本卡實作後改為「已實作」。
- 驗證指令：`node --test tools/kanban/upgrade-ui.test.mjs tools/kanban/roadmap-data.test.mjs tools/kanban/realtime-sync.test.mjs`、`npm run check`、browser desktop/mobile screenshot、`git diff --check`。

## 需求

- Topbar 加入「檢查更新」，順序為同步狀態 → 更新 → 視圖 tabs；mobile 顯示「更新」且觸控目標至少 44×44px。
- 建立與 card modal 完全獨立的 dialog root/state，不變更 `openId`、`modalDirtyFields` 或 card form DOM。
- 以純 reducer/selector 表示 `idle/checking/current/available/blocked/error/confirming/applying/success/verification-failed`。
- 呈現 loading、空/已是最新、可更新、conflict、來源/網路錯誤、權限不足、套用中、成功、驗證失敗與 mobile 狀態。
- 變更計數固定顯示 add/update/remove/preserve/conflict；詳細路徑可收合，不顯示檔案內容/diff。
- `applicable=false`、無寫入變更、過期、權限不足與 applying 期間都以 selector 統一停用不合法動作。
- Dialog/alert 實作 focus initial/trap/return、background inert、Escape 規則、`aria-modal`、`aria-labelledby`、`aria-live`、reduced motion。
- 來自 fixture/API 的 path/message 只透過 `textContent` 或 `escapeHtml` 輸出。

## 非目標

- 不發真實 fetch、不建立 server routes、不套用檔案更新。
- 不改版 Variant B/C，不新增 drawer/wizard 框架。
- 不重寫現有 card modal 或看板/藍圖 layout。

## 驗收標準

- Desktop 與 mobile 的入口、對話框、sticky actions 符合 Variant A 視覺層級，不擠壓同步狀態或 tabs。
- 所有列出狀態都可由 fixture 單獨呈現，無空白 dialog、無只靠顏色表意、無被截斷關鍵文字。
- 合法狀態轉移與所有停用條件有單元測試；非法事件不會跳至 applying/success。
- 可只用鍵盤完成開啟、審閱、開啟二次確認、取消與關閉；關閉後 focus 回到 trigger。
- 開啟 upgrade dialog 前已編輯但未儲存的 card modal 資料不被清除或重繪。
- 390×844 與 1440×900 螢幕截圖通過；320px 無水平溢出，interactive targets 符合 44px。

## 實作備註

- 在 `index.html` 中將 upgrade 純函式放入自己的測試標記區段，不破壞現有 test extraction marker。
- 視覺值優先從現有 token 組合；若必須新增語意 token，同步記錄 design-system，不硬寫孤立色碼。
- 本卡的 adapter 可用 Promise fixture；真實 fetch/error mapping 由 TASK-018 擁有。

## 驗證契約

- 單元測試：reducer/selector、計數與 path grouping、按鈕 enablement、穩定 error-to-view mapping、HTML escaping。
- 整合測試：fixture adapter 驅動所有核心狀態，並驗證 card modal dirty state 不變。
- E2E 測試：鍵盤/focus/inert 手動或瀏覽器驗證；真實 API 由 TASK-020 覆蓋。
- 型別檢查：不適用。
- Lint：不適用。
- Build：使用現有 HTML inline script syntax/governance 檢查。
- 螢幕截圖：1440×900 與 390×844，至少 loading、available、blocked、success 四組。
- 安全性檢查：XSS path/message fixture、防重複送出、applying 不可關閉、無任意 URL/path input。

## 完成證據

- 變更的檔案：`tools/kanban/index.html`、`tools/kanban/upgrade-ui.test.mjs`、
  `ai/context/design-system.md`、`ai/artifacts/看板版本更新/verification/TASK-017.md`、
  `tools/kanban/cards/TASK-017.json` 與本任務卡。
- 執行過的指令：`node --test tools/kanban/upgrade-ui.test.mjs tools/kanban/roadmap-data.test.mjs tools/kanban/realtime-sync.test.mjs`、`npm run check`、`git diff --check`。
- 測試輸出：針對性測試 23/23、全專案測試 126/126 通過；syntax 與治理檢查通過。
- 螢幕截圖：`verification/screenshots/TASK-017-desktop-*.jpg`、
  `verification/screenshots/TASK-017-mobile-*.jpg`（詳見驗證報告）。
- 已知限制：本卡僅使用 fixture adapter，不串接真實 API；Code review 與人工驗收待完成。
- 驗證報告：`ai/artifacts/看板版本更新/verification/TASK-017.md`。
- 後續任務：TASK-018。
