# 架構筆記：藍圖心智圖與即時同步

## 狀態

- 產品規格：已核准
- UI：Variant C 已核准
- 架構與任務卡：已由使用者核准（2026-09-05，開始 TASK-002）
- 風險：中

## 方案

- 保持零 production dependency，沿用單檔前端與 Node.js 內建模組。
- 前端將 `EPICS`/`TICKETS` 轉為「Epic 導覽清單 + 選定 Epic 的 Story/Task 階層圖」；佈局由純函式計算座標，SVG 繪製邊，HTML 節點保留可存取性。
- server 新增 `GET /api/events` SSE；以 `fs.watch` 觀察 `cards/` 與 `epics.json`，經 debounce 後只送出變更類型。
- client 收到事件後重取現有 GET API，不在事件中傳遞完整卡片，並以 debounce/sequence 避免舊回應覆蓋新回應。
- modal 若含 dirty input，更新內部資料但不重繪 modal；儲存或關閉後套用最新狀態。

## API 契約

`GET /api/events` 回應 `text/event-stream`，支援：

```text
event: change
data: {"resources":["cards"]}

event: change
data: {"resources":["epics"]}
```

- 連線建立時送出 `ready`；閒置連線定期送 comment heartbeat。
- API 寫入與檔案 watcher 可同時產生事件，由 debounce 合併 resources。
- client 斷線由 `EventSource` 自動重連，重連成功後執行一次完整 `loadAll()`。

## 狀態契約

- `selectedEpicName`：當前聚焦 Epic；若原選擇已不存在，回退到第一個 Epic。
- `collapsedBranches`：頁籤內 Set，key 由 Epic/Story 穩定名稱組成。
- `viewport`：縮放比例與平移量，新選 Epic 時回到全景。
- `syncState`：`connecting | live | reconnecting | error`。
- `modalDirty`：標題或內容与最後已儲存值不同時為 true。

## 預期變更檔案

- `tools/kanban/index.html`：心智圖視圖、佈局、互動、EventSource 與同步狀態。
- `tools/kanban/server.mjs`：SSE route、watcher、debounce、heartbeat 與 client cleanup。
- `tools/kanban/README.md`：操作、API、即時同步邊界與已知限制。
- `tools/kanban/screen-spec.md`：將已實作畫面規格對齊 Variant C。
- 測試檔：依專案現有零依賴策略，使用 `node:test` 新增 server/資料轉換測試，不引入新套件。

## 風險與緩解

- `fs.watch` 在不同平台的事件形態不一：事件只當 invalidation，客戶端總是重取真實資料。
- 快速拖曳與外部更新競態：寫入成功後以 server 回應為準，載入請求以 sequence 丟棄舊回應。
- 節點過多導致卡頓：Variant C 一次只呈現一個 Epic，並可收合 Story。
- 設計系統文件尚是佔位符：本次以正式看板現存 CSS variables 為基準，不擴張新配色。

## 審查關卡

- Product：已通過。
- UI：Variant C 已通過。
- Architecture：已通過。
- Security：實作時檢查 SSE 只 bind 本機、無任意路徑讀取、client 清理。
- Test：實作前核准本文驗證策略。
- Code review：所有實作卡完成後執行。
