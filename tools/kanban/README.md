# 治理看板

以 git 為同步機制的本地 Kanban 小工具，零依賴（只用 Node 內建模組），用來把 [`ai/process/kanban.md`](../../ai/process/kanban.md) 定義的 AI 協作治理流程視覺化：每張任務卡從 Backlog 一路推進到 Done 的過程中，會經過哪些欄位、需要哪些 Readiness 檢查與人工核准，都在這個看板上一目了然。

**看板分頁**（水平車道，Backlog → Blocked → Ready → Implementing → Verify → Done）：

![看板分頁截圖](docs/board-screenshot.png)

**藍圖分頁**（Epic 導覽 + User Story → Task 聚焦樹，資料來自 [`epics.json`](epics.json)）：

![藍圖分頁截圖](docs/roadmap-screenshot.png)

## 這是什麼、為什麼需要它

治理套件（Monstrare）要求每個非小型變更都要經過「規格 → 架構 → 任務卡 → 實作 → 驗證 → 審查 → 人工驗收」的關卡流程。光靠文件很難追蹤「現在有哪些任務卡在哪個關卡、卡在誰手上、是不是超過 WIP 上限」，這個看板就是那個流程的即時視覺化 + 輕量資料庫：每張卡是一個 git tracked 的 JSON 檔，拖曳、勾選、留言都會即時寫回檔案，靠 `git commit` / `git push` 同步給團隊或其他 agent，不需要額外的資料庫或帳號系統。

原本 1:1 對應 `ai/process/kanban.md` 的 12 個治理階段，後改為 6 欄的精簡流程：`backlog`（Backlog 待辦）→ `blocked`（Blocked）→ `ready`（Ready 就緒）→ `implementing`（Implementing 進行中）→ `verify`（Verify 驗證中）→ `done`（Done 完成）。`ai/process/kanban.md` 本身未變，仍是完整的 12 階段治理政策；本工具是該政策的一種簡化實作，不要求逐欄對應（`ai/process/kanban.md` 也明講這一點）。

版面沿用 Mockup 階段選定的 **Variant A（控制塔）** 風格：水平車道逐一對應每個階段。另外兩個候選版面（階段分組、稽核清單表格）保留在 [`mockups/index.html`](mockups/index.html) 供參考，詳見 [`mockup-decision.md`](mockup-decision.md)（該文件與種子資料仍反映舊的 12 階段命名，僅供追溯選型過程，不代表目前欄位）。這些選型紀錄只存在 Monstrare 原始 repo；`scripts/install-into-project.sh` 安裝到其他專案時不會複製，所以在你的專案裡看不到這幾個檔案是正常的。

頁面右上角有兩個分頁：

- **看板**：6 車道控制塔（上述 Variant A）。
- **藍圖**：左側（手機為頂部）選擇 Epic，主畫布顯示 Epic → User Story → Task 聚焦樹；支援縮放、平移、回到全景、分支收合與鍵盤導覽。每個 Epic／User Story 都會即時算出完成度（`stage === "done"` 的卡片數 / 總卡片數）。資料來自 [`epics.json`](epics.json)，任務卡透過 `epic` / `userStory` 兩個欄位對應回去；卡片若指定了 Epic 但沒指定對應的 User Story，會落在該 Epic 底下的「（未分類任務）」桶，不會憑空消失。

`epics.json` 與 `cards/` 預設是空的模板狀態。開始一個新專案時，走 `ai/skills/project-kickoff.md` 的流程：先確認技術棧，再逐層讓人工勾選 Epic、User Story，最後把拆好的 Task 一張張寫成 `cards/` 底下的 JSON 檔（或透過本機 server 的 `POST /api/cards`）。

## 啟動

```bash
node tools/kanban/server.mjs
# 或
npm run kanban
```

瀏覽器開 <http://127.0.0.1:4420>（server 只 bind 127.0.0.1，port 4420 被占用時會直接報錯，不自動換 port；若啟動失敗，先用 `lsof -i :4420` 找出佔用的程序）。

## 怎麼操作

- **新增卡片**：點任一車道底部的「+ 新增卡片」，輸入標題即可（id 由 server 自動配號）。
- **移動卡片**：直接把卡片拖到別的車道（跨欄即改變 `stage`），同欄內拖曳可調整 `order`。
- **編輯詳情**：點卡片本體開啟詳情面板，可改 owner／risk／agent／Readiness 勾選／Review Gates 勾選／留言等所有欄位。
- **看整體進度**：切到右上角「藍圖」分頁，選擇 Epic 後瀏覽聚焦樹；可用工具列、滾輪、拖曳、觸控或鍵盤操作（需先在 [`epics.json`](epics.json) 定義 Epic／User Story）。
- 所有操作都是即時寫回 `cards/*.json`，沒有「儲存」按鈕；要復原就用 `git checkout` 還原檔案再重新整理頁面。

## 資料與同步

- 資料來源就是 [`cards/`](cards/) 目錄，**一張卡一個 JSON 檔**，git tracked。
- 看板上的所有操作（拖曳、勾選 Readiness/Gates、編輯欄位、新增、刪除、留言）即時寫回對應 JSON 檔。
- 同步 = git：`git commit` / `git push` 就是存檔與分享，多人協作靠 git 合併。
- 也可以直接改 JSON 檔（或 `git checkout` 還原）；server 會透過 SSE 通知已連線的 client 重取資料。
- `cards/*.json` 與 `epics.json` 的快速連續變更會合併成一則 invalidation 事件，事件不包含卡片內容。
- 頁首同步狀態會顯示「正在連線／即時同步／重新連線中／同步連線失敗」；斷線後由瀏覽器自動重連，恢復時完整重取 cards 與 epics。
- 外部變更會自動刷新看板、WIP 與藍圖；若詳情 modal 內仍有未儲存輸入，輸入不會被重繪，待儲存或關閉後才套用最新資料。
- 新卡片的預設 owner 與留言作者取自本機 `git config user.name`（server 啟動時讀一次，經 `GET /api/config` 提供給前端）；沒設定時 owner 留空、留言作者顯示「匿名」。

## WIP 上限

`implementing`（Implementing 進行中）上限 3、`verify`（Verify 驗證中）上限 5，沿用 `ai/process/kanban.md` 對 Agent Working / Needs Review 的建議值。車道張數超過上限時，車道標頭的計數 badge 會變紅。上限只在 `index.html` 的 `WIP_CAPS` 裡（純前端視覺化，server 不做強制）。

## Card JSON schema

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | string | 專案代碼前綴 + 流水號（`server.mjs` 的 `ID_PREFIX`，預設是 `TASK-`，請依專案自訂），新增時由 server 配號 |
| `title` | string | 標題（非空） |
| `content` | string | 補充說明（純文字，不支援 markdown） |
| `stage` | string | `backlog` / `blocked` / `ready` / `implementing` / `verify` / `done` 之一 |
| `risk` | string | `low` / `medium` / `high` |
| `owner` | string | 人工負責人 |
| `agent` | string | 執行的 AI agent 名稱，留空代表純人工 |
| `approvalRequired` | boolean | 是否需要人工核准 |
| `createdAt` | string | 建立日期 `YYYY-MM-DD`，新增時由 server 填當天 |
| `epic` | string | 對應 `epics.json` 裡某個 Epic 的 `name`，留空代表未分類 |
| `userStory` | string | 對應該 Epic 底下某個 User Story 的 `name`，留空代表未分類 |
| `dependsOn` | array | 前置任務卡片 id 陣列（字串），預設 `[]`；要推進到 `ready`／`implementing`／`verify`／`done` 前，陣列裡列出的卡片都必須是 `done`，見下方「dependsOn 硬防呆」 |
| `order` | number | 欄內排序，整數、欄內從 1 起 |
| `readiness` | object | 對應 `ai/templates/kanban-card.md` 的 7 項 Readiness，各為 boolean |
| `gates` | object | 6 個 Review Gates（product/ui/architecture/security/test/code_review），各為 boolean |
| `links` | object | 6 種關聯文件路徑（featureSpec/screenSpec/mockupDecision/taskCard/verificationReport/pr），字串、可留空 |
| `refs` | array | repo 相對路徑（string 陣列，唯讀顯示） |
| `evidence` | object | `{ commands: string[], findings: string[], residual: string }` |
| `comments` | array | 留言 `{ name, time, text }` |

檔案以 2 空格縮排 + 結尾換行寫入，減少 git diff 噪音。

## API（server.mjs）

| Method | Path | 說明 |
| --- | --- | --- |
| `GET` | `/api/config` | 看板設定（目前只有 `owner`：本機 `git config user.name`，作為新卡 owner 與留言作者的預設值） |
| `GET` | `/api/epics` | 讀取 [`epics.json`](epics.json)（Epic → User Story 定義，唯讀，沒有寫入 API，要改就直接編輯檔案） |
| `GET` | `/api/events` | SSE 即時變更事件流；連線先送 `ready`，資料變更送 `change`，閒置時送 heartbeat comment |
| `GET` | `/api/cards` | 全部卡片（陣列） |
| `PUT` | `/api/cards/:id` | 覆寫單卡（body 為完整 card） |
| `PUT` | `/api/cards` | bulk 覆寫（body 為陣列，拖曳排序用） |
| `POST` | `/api/cards` | 新增卡（server 配下一個流水號） |
| `DELETE` | `/api/cards/:id` | 刪卡（刪檔） |

非法 id / stage / risk 格式一律回 400；PUT/POST body 缺少物件型欄位時由 server 補預設值。

### 即時變更事件

`GET /api/events` 使用 `text/event-stream`。連線建立時先送 `ready`；server API 寫入或直接修改／替換 `cards/*.json`、`epics.json` 時，經短暫 debounce 後送出：

```text
event: change
data: {"resources":["cards","epics"]}
```

`resources` 只會包含 `cards`、`epics`，client 收到後應呼叫既有 GET API 重取資料。server 定期送出 `: heartbeat` comment 維持閒置連線；client 斷線與 server 關閉時會清除連線、watcher 與 timer。

### dependsOn 硬防呆

`PUT /api/cards/:id`、`PUT /api/cards`（bulk）、`POST /api/cards` 對 `dependsOn` 一律做以下檢查，違反時回 400、不寫入檔案：

- **格式**：必須是字串陣列，且每個元素要符合 id 格式 `^{ID_PREFIX}-\d{3,}$`。
- **自我依賴**：不可包含卡片自己的 id。
- **存在性**：陣列裡的每個 id 都必須是目前真的存在的卡片（含這次請求裡一起送進來的其他卡）。
- **循環依賴**：以 `dependsOn` 建圖做 DFS，偵測到循環（例如 `A -> B -> A`）就拒絕，錯誤訊息會列出循環路徑。
- **推進阻擋**：若這次要把 `stage` 改成 `ready`／`implementing`／`verify`／`done` 之一，`dependsOn` 列出的卡片必須全部是 `done`，否則回 400 並列出還沒完成的卡片 id 與標題。移動到 `backlog`／`blocked` 不受此限制。

刪除卡片不會自動清除其他卡對它的 `dependsOn` 參照；看板 UI 讀到參照不存在的 id 時會顯示警示，但不會擋任何操作。

## 驗證

```bash
npm test
npm run check
```

`npm test` 執行藍圖資料／佈局、即時同步與 server SSE 測試；`npm run check`
另外檢查 server 語法和治理套件必要檔案。server 整合測試使用臨時
`KANBAN_ROOT` 與動態 port，不會改寫真正的 `cards/` 或 `epics.json`。

## 已知限制（v1）

- 沒有帳號系統，身分只取自本機 git 設定，無法區分同名使用者、也沒有權限控管。
- `content` / 留言不支援 markdown 渲染，純文字顯示。
- SSE 只通知連到同一個本機 server 的 client；跨機器同步仍需透過 git，衝突也仍由 git 處理。
- 手機版藍圖已最佳化；六欄看板仍以橫向捲動為主，小螢幕不會改成單欄切換器。
- 兩位使用者同時儲存同一卡片沒有字段級 merge，採最後成功寫入者的完整卡片狀態。
