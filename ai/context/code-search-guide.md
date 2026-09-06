# 程式碼搜尋指南

狀態：已更新（2026-09-07）。

## 搜尋入口

| 需求 | 從這裡開始 | 搜尋關鍵字 |
|---|---|---|
| 看板 UI／樣式 | `tools/kanban/index.html` | `renderLanes`, `renderRoadmap`, `openModal` |
| 藍圖資料與佈局 | `tools/kanban/index.html` | `buildSelectedEpicTree`, `buildFocusedTreeLayout` |
| 縮放／平移 | `tools/kanban/index.html` | `fitViewport`, `wheelZoomFactor`, `zoomRoadmap` |
| 前端即時同步 | `tools/kanban/index.html` | `startRealtimeSync`, `loadResources`, `modalDirtyFields` |
| HTTP／SSE server | `tools/kanban/server.mjs` | `/api/events`, `handleEvents`, `queueChange` |
| Card 驗證 | `tools/kanban/server.mjs` | `validateCard`, `checkDependsOn`, `fillDefaults` |
| 測試 | `tools/kanban/*.test.mjs` | `node:test`, `KANBAN_ROOT`, `KANBAN_PORT` |
| 工作規則 | `AGENTS.md`, `ai/process/` | `小型且明確`, `review gate`, `definition-of-ready` |
| 客製變更 | `CUSTOMIZATIONS.md` | `a187710`, `即時同步`, `聚焦樹` |

## 已知符號

| 符號 | 意義 | 位置 |
|---|---|---|
| `buildEpicProgress` | 建立 Epic 導覽與聚合進度 | `tools/kanban/index.html` |
| `buildSelectedEpicTree` | 把 epics/cards 轉為單一 Epic 階層 | `tools/kanban/index.html` |
| `buildFocusedTreeLayout` | 計算可收合節點、連線與畫布尺寸 | `tools/kanban/index.html` |
| `createLatestRequestGate` | 防止過期 GET 回應覆寫新狀態 | `tools/kanban/index.html` |
| `handleEvents` | 建立 SSE response | `tools/kanban/server.mjs` |
| `queueChange` | 合併 cards/epics invalidation | `tools/kanban/server.mjs` |
| `startRealtime` | 啟動 watcher 與 heartbeat | `tools/kanban/server.mjs` |

## 給 Agent 的備註

- 優先做精確符號搜尋，再做大範圍文字搜尋。
- 發現對未來任務有幫助的搜尋結果時，記錄在這裡。
- `index.html` 的可測純函式以 `export function` 宣告；測試會抽取標記區段，
  修改標記或 module 邊界時同步更新測試。
- server 測試以臨時 `KANBAN_ROOT` 啟動隔離資料，不應改寫真實看板。
