# Monstrare 客製變更紀錄

本文件記錄此 repository 在原版 Monstrare 基礎上完成的客製化。比較基準為
`a187710`（`Give artifacts a home and make the installer produce a self-sufficient project`）。
完成日期為 2026-09-07。

## 變更摘要

### 1. 藍圖改為可操作的聚焦樹

原本的藍圖是 Epic → User Story → Task 的直向清單；現在改為 Variant C
「Epic 導覽 + 單一 Epic 聚焦樹」：

- 左側顯示所有 Epic 與聚合進度，行動版改為可水平捲動的導覽列。
- 主畫布以 HTML 節點與 SVG 連線呈現 Epic、User Story、Task 三層關係。
- 自動計算完成數、總數與百分比；未能匹配 User Story 的 Task 會進入
  「未分類任務」，不會消失。
- 支援切換 Epic、收合 Epic／User Story、點 Task 開啟原有詳情視窗。
- 支援按鈕、鍵盤、滾輪、拖曳與 Pointer Events：縮放範圍 25%–160%、
  平移、雙指縮放及回到全景。
- v1.0.1 起雙指捲動與滑鼠滾輪平移，雙指開合或 Ctrl／⌘ 加滾輪縮放；
  操作期間停用 transform 過場以保持跟手。縮放以游標或視口中心為錨點，
  wheel delta 經正規化，避免細小事件造成倍率跳動。
- 補上 loading、empty、error、read-only 與大型資料狀態，並提供可重現的
  `?roadmapState=loading|empty|error|readonly` 預覽參數。
- 加入 focus ring、ARIA 名稱、`aria-expanded`、live region 與鍵盤方向導覽。

主要實作位於 `tools/kanban/index.html`；畫面規格、mockup 選型和驗證證據位於
`ai/artifacts/看板體驗改善/`。

### 2. 看板加入本機即時同步

原本頁面只在首次載入時讀取資料；現在同一個本機 server 下的頁籤可自動反映
API、直接檔案編輯及 git 替換所造成的變更：

- 新增 `GET /api/events` Server-Sent Events（SSE）端點。
- server 使用 `fs.watch` 監看 `cards/` 與 `epics.json`。
- 快速連續事件經 debounce 合併，只傳送 `cards`／`epics` invalidation 類型，
  不在事件中傳送卡片內容。
- 連線建立時送出 `ready`，閒置時送 heartbeat，斷線與 server 關閉時清理
  response、watcher 與 timer。
- 前端顯示「正在連線／即時同步／重新連線中／同步連線失敗」。
- 收到事件後重取既有 GET API，並用 request sequence 阻止舊回應覆蓋新資料。
- 詳情視窗有尚未儲存的輸入時，只更新背景資料，不重繪使用者正在編輯的內容；
  儲存或關閉後再套用最新狀態。

這仍是本機工具，不是網際網路協同服務。跨電腦同步與衝突處理仍由 git 負責。

### 3. 工作規則改為依風險分級

`AGENTS.md` 從「所有工作一律走完整治理流程」調整為比例原則：

- 小型、明確的修正可直接調查、實作與驗證。
- 多元件、跨系統或需求模糊的功能才啟動規格、架構與 mockup 流程。
- 只有使用者要求使用看板，或工作本來就由看板追蹤時，才建立／更新 task。
- UI 工作依規模決定是否需要 mockup；高風險工作保留安全與回滾關卡。
- 強調保留使用者未提交變更、限制修改範圍及提供相稱驗證。

`.codex/config.toml` 也改用目前的專案層級設定鍵，保留可選模型設定，並將
sandbox 限制為 workspace write。

### 4. 文件、設計系統與可維護性

- 修正中英文 README 導覽；繁體中文為 `README.md`，英文為
  `README en_us.md`。
- 補上本客製變更紀錄，以及實際的專案地圖、架構地圖與程式碼搜尋指南。
- 在 `ai/context/design-system.md` 登記 Epic Nav、Mind-map canvas、Hierarchy
  node、Connector 與 Sync Status 等新元件。
- 擴充 `tools/kanban/README.md`，記錄 SSE 契約、同步行為與邊界。
- `package.json` 新增 `npm test` 與 `npm run check`，讓完整驗證有固定入口。

### 5. 測試與驗證

新增三組零外部依賴的 `node:test` 測試：

- `roadmap-data.test.mjs`：資料轉換、進度、排序、佈局、收合、全景與縮放。
- `server-events.test.mjs`：SSE headers、API 寫入、直接檔案修改／替換、
  debounce、heartbeat 與 client cleanup。
- `realtime-sync.test.mjs`：事件解析／合併與 latest-request gate。

完整的逐 task 驗證報告及桌面／行動版截圖保存在
`ai/artifacts/看板體驗改善/verification/`。

## 看板資料狀態

上述六張實作 task 已完成並從作用中的看板移除：

- `tools/kanban/cards/` 只保留 `.gitkeep`。
- `tools/kanban/epics.json` 已重設為 `{ "epics": [] }`。
- 規格、task card、mockup 與驗證報告保留在 `ai/artifacts/看板體驗改善/`，
  作為已完成工作的歷史紀錄，不會載入看板。

## 驗證方式

需求：Node.js 20 以上版本；無 production dependency。

```bash
npm test
npm run check
npm run kanban
```

最後一個指令會啟動 `http://127.0.0.1:4420`。空白看板可直接新增下一批 task；
加入 Epic／User Story 時，編輯 `tools/kanban/epics.json`。

## 已知限制

- 即時同步只涵蓋連到同一本機 Node server 的頁籤；跨機器仍需 git。
- 多人同時儲存同一卡片沒有字段級 merge，採最後成功寫入者的完整卡片狀態。
- 行動版藍圖已最佳化；六欄看板在窄螢幕仍以橫向捲動為主。
- 多點 pinch 已覆蓋程式路徑與人工驗證，但未用真實行動裝置做自動化測試。
