# 驗證報告

## 摘要

- 任務：TASK-004 建立 server 即時變更事件流
- 結果：通過
- 驗證者：Codex

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `node --test tools/kanban/server-events.test.mjs tools/kanban/roadmap-data.test.mjs` | 通過 | 12/12；其中 2 項 SSE/server 整合測試，10 項既有回歸測試 |
| `node --check tools/kanban/server.mjs` | 通過 | server 語法檢查 |
| `git diff --check` | 通過 | 無 whitespace error |

## 涵蓋範圍

| 驗收行為 | 結果 |
|---|---|
| SSE headers 與初始 `ready` event | 通過 |
| POST、單卡 PUT、bulk PUT、DELETE 觸發 `cards` | 通過 |
| 直接寫入 card JSON 觸發 `cards` | 通過 |
| 以 rename 原子替換 card 檔案仍可偵測 | 通過 |
| cards/epics 快速連續事件 debounce 並合併 resources | 通過；輸出順序固定為 `cards`, `epics` |
| heartbeat comment | 通過 |
| client 斷線後 server 可繼續寫入 | 通過 |
| SIGTERM 關閉時結束 SSE 並釋放 watcher/timer/process | 通過 |

## UI 證據

- 不適用；本卡僅變更 server、測試與文件，client EventSource 屬 TASK-005。

## 安全性與審查發現

- server 仍固定 bind `127.0.0.1`，沒有新增 production dependency。
- watcher 路徑只來自 server 設定的 `cards/` 與 `epics.json`，不使用 request 輸入組合檔案路徑。
- event payload 只含固定的 `cards` / `epics` resource 名稱，不傳送 card 內容。
- 未改變現有 JSON API 的輸入輸出契約。

## 殘留風險

- `fs.watch` 事件形態會因平台而異；實作只把事件當 invalidation，不依賴 event type，且 API 寫入會主動排入通知。
- SSE 僅服務連線到同一本機 server 的 client；跨機器同步仍依賴 git。
- 完整 client 重連、請求 sequence 與端到端同步將由 TASK-005/006 處理。
