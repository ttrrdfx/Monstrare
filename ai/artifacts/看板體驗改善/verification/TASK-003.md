# 驗證報告

## 摘要

- 任務：TASK-003 實作心智圖互動與無障礙導覽
- 結果：通過
- 驗證者：Codex

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `node --test tools/kanban/roadmap-data.test.mjs` | 通過 | 10/10；涵蓋縮放上下限、全景置中、Story/Epic 收合與進度保留 |
| `node --check tools/kanban/server.mjs` | 通過 | 本機 server 語法檢查 |
| `git diff --check` | 通過 | 無 whitespace error |

## UI 證據

| Viewport | 螢幕截圖 | 備註 |
|---|---|---|
| 桌面版 | 本次 Codex 瀏覽器驗證內嵌擷取 | 全景顯示三層節點；工具列與連線正常 |
| 桌面版收合 | 本次 Codex 瀏覽器驗證內嵌擷取 | Epic 收合後只保留根節點與聚合進度，焦點留在根節點 |
| 390×844 | 本次 Codex 瀏覽器驗證內嵌擷取 | 全景約 30%，所有節點置中且位於視口內；工具按鈕為 44px |

## 互動驗證

| 動作 | 結果 |
|---|---|
| 工具列 +/− 與全景 | 通過；縮放保持游標／視口中心，達上下限時停用對應按鈕 |
| 滾輪縮放 | 通過；實測 transform scale 由 `0.29529` 變為 `0.324819` |
| 拖曳平移 | 通過；實測 translate 由 `(114, 32)` 變為 `(174, 82)` |
| 觸控 | 通過程式審查；Pointer Events 支援單指平移與雙指縮放，工具按鈕可作觸控替代 |
| Story 收合 | 通過；子 Task 與連線移除，聚合進度及頁籤內狀態保留 |
| Epic 收合 | 通過；所有後代移除，根節點進度保留 |
| 鍵盤 | 通過；Tab 順序依 Epic → Story → Task DOM 順序，方向鍵移動節點焦點，Enter/Space 觸發原生按鈕動作，`+`/`-`/`0` 控制視口 |
| 無障礙名稱與焦點 | 通過；工具具 `aria-label`/`aria-keyshortcuts`，收合具 `aria-expanded`，focus ring 可見，縮放百分比由 live region 宣告 |

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| 隱藏分頁量測寬度為 0，首次全景偏移 | 中 | 已修正為顯示藍圖後再 fit |
| 50% 下限無法在 390px 顯示完整 1104px 樹 | 中 | 已將下限改為 25%，390px 全景約 30% |
| 收合重新 render 可能遺失鍵盤焦點 | 中 | 已依 Story/Epic identity 還原焦點 |
| Pointer listener 使用文件層事件委派 | 低 | 固定 listener 僅一份；pointerup/cancel 會清理 gesture state 與 capture UI 狀態 |

## 檢查清單與殘留風險

- UI 延用現有 CSS tokens、繁中字體 stack、focus-visible 與 reduced-motion 模式；新增間距和字級符合既有 scale。
- loading、empty、error、readonly 狀態沿用 TASK-002，互動工具只在 ready/readonly 畫面呈現。
- 瀏覽器 console 檢查結果：0 warning、0 error。
- 本次未建立持久化 screenshot 檔；畫面擷取保留於本次 Codex 驗證紀錄，完整 E2E／視覺基準仍由 TASK-006 負責。
- 雙指縮放尚未以自動化多點觸控裝置測試；目前有 Pointer Events 實作與人工程式審查證據。
