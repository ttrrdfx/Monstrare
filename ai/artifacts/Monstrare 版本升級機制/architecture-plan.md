# 架構筆記：Monstrare 下游專案版本升級機制

## 狀態

- 產品規格：使用者已核准（2026-09-15）
- UI：不適用，第一版為 CLI
- 架構與任務卡：使用者已核准（2026-09-15）
- 風險：中（跨 repository 檔案寫入、備份、移除與 migration）

## 情境包

- 任務：讓 Monstrare 原始 repository 的新版看板與治理檔案可安全升級到既有下游專案。
- 目標：可辨識版本、dry-run、保留專案資料、偵測客製衝突、失敗可回復。
- 相關檔案：`scripts/install-into-project.sh`、`scripts/check-governance.sh`、`tools/kanban/`、`README.md`、`README en_us.md`、`package.json`。
- 既有模式：Bash 安裝器、Node.js 20、零 production dependency、git 作為使用者持久化與最終回復層。
- 假設：升級器從最新版 Monstrare source checkout 執行，第一版不負責網路下載新版。
- 未知事項：實際下游專案的客製比例；架構以「可能有客製」的保守策略處理。
- 允許變更的檔案：版本／配送 manifest、安裝與升級 scripts、相關測試 fixture、雙語文件、驗證入口。
- 不得觸碰：真實作用中 `tools/kanban/cards/*.json`、`tools/kanban/epics.json`、既有 `ai/context/`、`ai/artifacts/` 與不相關產品程式。
- 驗證指令：`npm test`、`npm run check`、升級器的臨時專案整合測試、`git diff --check`。
- 風險等級：中。
- 情境預算備註：已讀專案／架構／搜尋地圖、現有安裝器、看板文件與既有實作計畫；未展開閱讀整份前端／server 實作，因本階段不修改其行為。

## 建議方案

建立一個從 Monstrare source repository 執行的零依賴 Node.js CLI。現有
`scripts/install-into-project.sh` 保留為相容入口，改為委派 CLI 的 `install`
命令。CLI 使用同一份配送 manifest 處理新安裝、狀態檢查、dry-run、升級與驗證，
避免複製規則分散在 Bash 與文件中。

```text
Monstrare source checkout
  ├─ VERSION
  ├─ monstrare-package.json        來源版本、所有權規則、配送 inventory
  ├─ scripts/monstrare.mjs         CLI 入口
  ├─ scripts/lib/*.mjs             規劃、hash、路徑、交易與 migration
  └─ scripts/manifests/*.json      可辨識的舊版 baseline
                 │
                 ▼
下游專案/.monstrare/manifest.json  已安裝版本、schema、受管理檔案 hash
下游專案/.monstrare/backups/...    每次升級的有限範圍備份
```

不採用直接 `cp -R` 覆寫整個 `tools/kanban/`，因為它無法區分程式與卡片資料；
也不在第一版導入 git subtree、npm package 或通用三方 merge，以免改變目前簡單的
clone／install 使用模型。

## 檔案所有權契約

### `managed`

由 Monstrare 擁有，可在 checksum 等於上次安裝值時更新：

- `ai/process/**`
- `ai/templates/**`
- `ai/checklists/**`
- `ai/skills/**`
- `ai/examples/**`
- `.claude/skills/**`、`.claude/agents/**`、`.codex/skills/**`
- `scripts/check-governance.sh`
- `tools/kanban/index.html`、`server.mjs`、`README.md`、測試與 `docs/**`

若新版 inventory 移除某個 managed 檔案，且下游內容仍等於舊 manifest hash，計畫
將它分類為 `remove`，套用前納入備份；若內容已修改則分類為 `conflict`，不刪除。

### `seed-only`

只在不存在時新增，存在時視為下游專案擁有，不整檔更新：

- `AGENTS.md`、`CLAUDE.md`
- `.codex/config.toml`
- `.github/pull_request_template.md`、`.github/ISSUE_TEMPLATE/ai_task.yml`
- `ai/context/*.md`
- `ai/artifacts/README.md`

後續若需要把新的規則片段合併到這類檔案，另做明確 migration，不以一般檔案升級
偷偷改寫。

### `project-data`

升級器永遠不得覆寫或刪除：

- `tools/kanban/cards/**`
- `tools/kanban/epics.json`
- `ai/context/**` 中已存在的檔案
- `ai/artifacts/**` 中已存在的檔案
- 下游產品程式、自己的 `package.json` 與 lockfile

### `source-only`

不配送：Monstrare 自身的 artifacts、看板 mockup 選型史料、`.git/` 與本 repo 的
客製追蹤文件。

## 來源與安裝 Manifest

來源 `monstrare-package.json` 建議契約：

```json
{
  "schemaVersion": 1,
  "version": "1.0.0",
  "minimumNode": "20.0.0",
  "managed": ["ai/process/**", "tools/kanban/index.html"],
  "seedOnly": ["AGENTS.md", "ai/context/*.md"],
  "excluded": ["tools/kanban/cards/**", "tools/kanban/epics.json"]
}
```

實際 inventory 在執行時由來源規則展開並排序；不接受 `..`、絕對路徑、來源目錄
外 symlink 或同時落入兩種所有權的檔案。

下游 `.monstrare/manifest.json` 建議契約：

```json
{
  "schemaVersion": 1,
  "installedVersion": "1.0.0",
  "installedAt": "2026-09-15T00:00:00.000Z",
  "files": {
    "tools/kanban/index.html": {
      "ownership": "managed",
      "sha256": "..."
    }
  }
}
```

- hash 使用 Node `crypto` 的 SHA-256。
- manifest 只記相對路徑、所有權、hash 與版本，不存檔案內容。
- 寫入使用同目錄暫存檔後 rename，manifest 永遠最後更新。
- 版本採嚴格 SemVer `major.minor.patch`；第一版拒絕未知 schema 與降版。

## CLI 契約

```text
node scripts/monstrare.mjs install <project>
node scripts/monstrare.mjs status <project> [--json]
node scripts/monstrare.mjs upgrade <project> --dry-run [--json]
node scripts/monstrare.mjs upgrade <project>
node scripts/monstrare.mjs verify <project>
```

- `<project>` 必須是明確存在的目錄；CLI 顯示 resolve 後的完整路徑。
- `status` 與 `--dry-run` 嚴格唯讀。
- 人類輸出列出來源版、安裝版與 `add/update/remove/preserve/conflict` 計數及檔案。
- `--json` 提供穩定、可由 agent 或 script 消費的相同計畫資料。
- 有衝突、無法辨識 legacy、migration／驗證失敗時使用非零 exit code。
- `scripts/install-into-project.sh <project>` 委派 `install`，保留既有呼叫方式。

## 升級計畫演算法

對每個來源 inventory 路徑比較三份狀態：來源新版、下游目前內容、下游安裝
manifest 的舊 hash。

| 條件 | 分類 | 寫入策略 |
|---|---|---|
| 新版有、下游無 | `add` | 新增 |
| 新版與下游 hash 相同 | `preserve` | 不寫入，只更新紀錄 |
| 下游 hash 等於舊 manifest、來源不同 | `update` | 備份後更新 |
| 舊 manifest 有、來源已移除、下游未修改 | `remove` | 備份後移除 |
| 下游與舊 manifest 不同 | `conflict` | 不寫入，整次升級預設停止 |
| project-data 或既有 seed-only | `preserve` | 永遠不覆寫 |

若完全沒有下游 manifest，CLI 進入 legacy 探測：

1. 將 managed 檔案 hash 與 `scripts/manifests/*.json` 的已知舊版 baseline 比對。
2. 全部可辨識時，建立記憶體中的舊 manifest 並產生正常升級計畫。
3. 任一既有 managed 檔案無法匹配時，標記 `conflict`；不猜測來源版本。
4. 第一批 baseline 至少涵蓋本功能實作前的 `7749c12`，若要支援 upstream
   `a187710` 安裝則以測試 fixture 證明。

## 寫入、備份與回復契約

1. 建立 `.monstrare/upgrade.lock`，已有有效 lock 時拒絕並行升級。
2. 完整產生計畫；有 conflict 時在任何寫入前停止。
3. 在 `.monstrare/backups/<timestamp>-<from>-to-<to>/` 備份將更新／移除的檔案與舊 manifest。
4. 在 target 內的 staging 目錄準備新檔並再次驗證 hash。
5. 依固定排序套用 `add/update/remove`；每個檔案以同目錄 temp + rename 取代。
6. 執行適用 migrations；migration 不得觸碰宣告範圍外的路徑。
7. 寫入新 manifest，移除 lock，保留備份供人工檢查。
8. 任一步驟失敗時，使用本次備份回復已碰觸檔案，保留失敗紀錄並回傳非零狀態。

CLI 不執行 `git reset`、`git clean` 或自動 commit。備份清理不是第一版自動行為。

## Migration 契約

- migration registry 以 `fromVersion -> toVersion` 明確排序。
- 每個 migration 宣告 `id`、適用版本、允許路徑與 `check/apply`。
- `check` 必須能判斷「需要、已完成、不相容」。
- `apply` 應可重跑，或在已完成時無操作。
- 任何 cards/epics schema migration 必須先複製原資料到本次備份，並在 fixture 上驗證。
- 第一版只建立框架，不製造沒有實際版本差異的資料 migration。

## 安全與失敗邊界

- 使用 `realpath`／`lstat` 驗證來源、target 與每個父路徑，不追隨逃離 target 的 symlink。
- 拒絕 `/`、使用者 home、Monstrare source 根目錄本身或沒有專案辨識檔的廣泛 target。
- inventory 必須是相對且正規化路徑；禁止 null byte、`..` 與絕對路徑。
- 未辨識版本、manifest schema、重疊所有權與 checksum 不符全部 fail closed。
- 不讀取或輸出卡片內容、context、artifact 或可能含敏感資訊的 diff；報告只列路徑與分類。
- 備份路徑固定在 target 的 `.monstrare/backups/`，不可由 manifest 注入。

## 預期變更檔案

- 新增 `VERSION`、`monstrare-package.json`。
- 新增 `scripts/monstrare.mjs`、`scripts/lib/*.mjs`、`scripts/migrations/*.mjs`。
- 新增 `scripts/manifests/*.json` 的 legacy baseline。
- 修改 `scripts/install-into-project.sh`，成為相容 wrapper。
- 修改 `scripts/check-governance.sh`，驗證來源 manifest 與必要新檔。
- 新增 `test/monstrare/*.test.mjs` 與臨時專案 fixtures。
- 修改 `package.json` 的測試入口。
- 修改 `README.md`、`README en_us.md`，記錄 release → dry-run → upgrade → verify 流程。
- 實作期間如無看板資料 schema 變更，不修改 `tools/kanban/cards/` 或 `epics.json`。

## 任務相依關係

```text
TASK-008 版本與 manifest 架構基礎
  ├─ TASK-009 新安裝與相容 wrapper
  └─ TASK-010 status、dry-run 與 legacy 探測
         └──────────┐
TASK-009 ───────────┴─ TASK-011 交易式升級、備份與回復
                           └─ TASK-012 migration 框架
TASK-009 + TASK-010 + TASK-011 + TASK-012
                           └─ TASK-013 E2E、文件與發布驗證
```

本 repository 已是成熟專案，沒有作用中的「專案設置」Epic，因此不新增不存在的
專案設置相依。任務卡只寫入 artifacts；除非使用者另行要求，不建立作用中看板 JSON。

## MECE 檢查

- TASK-008 只負責資料契約與純讀取／分類基礎。
- TASK-009 只負責新安裝，不處理既有專案升級。
- TASK-010 只負責唯讀狀態、升級計畫與 legacy 辨識。
- TASK-011 只負責無 migration 的安全寫入、備份、remove 與失敗回復。
- TASK-012 只負責跨版本 migration 編排與安全界線。
- TASK-013 只負責整體 fixture、驗證入口、雙語文件與發布證據。

六張卡合計覆蓋 feature spec 的版本、dry-run、安全升級、客製保護、migration 與
驗證；沒有兩張卡共同擁有同一段核心邏輯。

## 審查關卡

- Product：已通過。
- UI：不適用。
- Architecture：使用者已核准（2026-09-15）；實作後檢查所有權與交易邊界。
- Security：TASK-008、011、012 檢查路徑、symlink、備份與 migration 範圍。
- Test：TASK-013 對所有 feature-spec 驗收標準建立證據矩陣。
- Code review：每張實作卡完成後執行，TASK-013 做整體回歸。

## 殘留風險

- 第一版無法自動合併下游客製；衝突需人工或 agent 移植。
- 未收錄 baseline 的無 manifest 舊專案需要先人工辨識版本。
- 多檔案系統無真正全域 atomic rename；以 target 內 staging、逐檔 atomic replace、
  manifest 最後寫入與失敗回復降低半套版本風險。
- source checkout 本身如何取得新版仍靠 git pull／release；網路下載與簽章驗證不在第一版。
