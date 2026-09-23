# Monstrare

[English](README%20en_us.md) | **繁體中文**

[![Version](https://img.shields.io/badge/version-1.0.0-6d5dfc.svg)](VERSION)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**一套可直接放進 repository 的 AI coding governance kit：先把需求說清楚、留下可審查的證據，再讓非小型變更進入 production。**

Monstrare 把 Agent 工作規則、規格與任務範本、品質關卡，以及一個本機 Kanban 看板一起放進專案。Claude Code、Codex 或其他 agentic 工具只要讀取 repository 內的入口檔，就能沿用同一套協作方式，不依賴某台電腦上的隱藏設定。

目前版本為 **v1.0.0**，需要 **Node.js 20 以上**，沒有 production dependency。

## 它解決什麼問題

- Agent 從模糊 prompt 直接開始寫，最後產生難以審查的大型 diff。
- 「看起來可以」就被當成完成，缺少測試、截圖、build 或殘留風險紀錄。
- 架構、安全性與資料邊界等問題，直到程式碼完成後才被發現。
- 團隊沒有共同的規格、任務就緒條件、驗收標準與人工核准位置。
- Monstrare 本身升級時，容易誤蓋下游專案的看板資料或客製內容。

## v1.0.0 包含什麼

- **依規模治理**：小型、明確的工作可直接處理；需求模糊、跨元件或高風險工作才啟動完整關卡。
- **Repository-native 工作流程**：規格、task card、驗證報告與 review gate 全都能被 git 追蹤。
- **本機 AI 看板**：六條車道、Epic／User Story 聚焦樹、WIP 提示、詳情編輯與 JSON API。
- **即時同步**：同一本機 server 下，API 寫入、JSON 編輯與 git 替換會透過 SSE 通知已開啟頁籤更新。
- **版本化安裝與升級**：manifest、checksum、dry-run、衝突保護、備份、交易式回復與 migration 框架。
- **可重現驗證**：固定的 `npm test`、`npm run check` 與 `node scripts/monstrare.mjs verify` 入口。

此 repository 以原版 Monstrare `a187710` 為基準。看板客製歷史見 [`CUSTOMIZATIONS.md`](CUSTOMIZATIONS.md)；v1.0.0 升級器的規格與驗證證據見 [`ai/artifacts/Monstrare 版本升級機制/verification/TASK-013.md`](ai/artifacts/Monstrare%20版本升級機制/verification/TASK-013.md)。

## 工作流程

非小型變更依 `ai/process/workflow.md` 經過下列階段；實際需要哪些關卡由工作規模與風險決定，不是每個 typo 都要走完整流程。

| 階段 | 主要輸出 | 人工關卡 |
| --- | --- | --- |
| 收件 | 問題、目標、限制、未知事項 | 需求模糊時先釐清 |
| 情境探索 | 相關檔案、既有模式、風險與驗證指令 | — |
| 規格 | `feature-spec.md`、非目標、驗收標準 | 核准需求 |
| UI 選型 | screen spec、2–3 個 mockup 變體與取捨 | 選定方向 |
| 架構與任務 | 變更邊界、契約、回滾計畫、AI-ready task card | 高風險審查 |
| 實作 | 範圍受限的小型 diff | 範圍改變時停下確認 |
| 驗證與審查 | 測試、lint、build、安全檢查、截圖與 review | 人工驗收 |

Agent 的輸出不等於核准。詳細規則見 [`AGENTS.md`](AGENTS.md)、[`ai/process/review-gates.md`](ai/process/review-gates.md) 與 [`ai/process/definition-of-done.md`](ai/process/definition-of-done.md)。

## 快速開始

### 方案 A：直接以 Monstrare 建立新專案

```bash
git clone https://github.com/ttrrdfx/Monstrare.git my-project
cd my-project
```

若你確定不需要保留 Monstrare 的 git 歷史，再重新初始化；`rm -rf .git` 會永久刪除 clone 下來的歷史：

```bash
rm -rf .git
git init
```

接著把 `README.md`、`README en_us.md` 與 `package.json` 改成你的專案資訊，在這個目錄開啟 Claude Code 或 Codex，直接描述想建立的產品。全新專案可以從 `project-kickoff` skill 開始，逐層確認 Epic → User Story → Task。

```text
我要做一個線上預約系統。請用 project-kickoff 規劃完整 backlog，先不要實作。
```

### 方案 B：安裝到既有專案

先 commit 或備份目標專案，再從另一個 Monstrare source checkout 執行：

```bash
git clone https://github.com/ttrrdfx/Monstrare.git /absolute/path/to/Monstrare
node /absolute/path/to/Monstrare/scripts/monstrare.mjs install /absolute/path/to/project
```

也可在 Monstrare source 根目錄使用相容 wrapper：

```bash
scripts/install-into-project.sh /absolute/path/to/project
```

首次安裝會：

- 複製 Monstrare 管理的流程、skills、看板程式與驗證工具。
- 對已存在的 seed-only 檔案（例如 `AGENTS.md`、`CLAUDE.md`、`ai/context/*.md`）保持原內容。
- 建立空的 `tools/kanban/cards/` 與 `epics.json`（僅在不存在時）。
- 寫入 `.monstrare/manifest.json`，記錄版本、所有權與 SHA-256 checksum。

`install` 適用於尚未安裝 Monstrare 的專案；若已存在 manifest，CLI 會要求改用 `status` 或 `upgrade`。沒有 manifest 的舊版 Monstrare 專案也不要重跑 `install`，請走下一節的 legacy 升級流程。由於首次安裝會寫入 managed 路徑，務必先 commit，並在完成後檢查 `git diff`。

安裝後建議先建立專案情境：

```text
使用 project-search 建立 ai/context/project-map.md 與 ai/context/code-search-guide.md，先不要實作。
```

## CLI 指令

所有指令都從新版 Monstrare source checkout 執行，且 source 與 target 必須是不同目錄。

| 指令 | 用途 | 是否寫入 target |
| --- | --- | --- |
| `install <project>` | 首次安裝並建立 manifest | 是 |
| `status <project>` | 顯示來源版、安裝版、檔案分類與衝突 | 否 |
| `upgrade <project> --dry-run` | 預覽完整升級計畫 | 否 |
| `upgrade <project>` | 套用無衝突的升級 | 是 |
| `verify <project>` | 執行目標專案的治理、測試與語法檢查 | 只執行檢查；目標測試本身仍可能有副作用 |

`status` 與 `upgrade` 支援 `--json`，方便 agent 或 script 消費。衝突、無法辨識的 legacy、驗證失敗與不合法用法都會回傳非零 exit code。

## 升級既有安裝

本機看板的版本更新只接受 GitHub **正式 Release** 上固定名稱的
`monstrare-vX.Y.Z.bundle.json` asset（需核對 digest）；不使用 draft、prerelease
或任意 checkout。看板上先執行 dry-run、檢查衝突與備份，再二次確認套用；
套用後執行驗證並**重啟看板 server**。下方 CLI 範例是原有的本機 source
升級途徑，不代表看板會直接讀取該 checkout。發布／失敗重跑指引見
[`tools/kanban/docs/releasing.md`](tools/kanban/docs/releasing.md)。

先取得並切換到要安裝的 release，再依序執行狀態檢查、dry-run、升級與驗證：

```bash
monstrare_source=/absolute/path/to/Monstrare
target_project=/absolute/path/to/project

git -C "$monstrare_source" fetch --tags
git -C "$monstrare_source" checkout v1.0.0
node "$monstrare_source/scripts/monstrare.mjs" status "$target_project"
node "$monstrare_source/scripts/monstrare.mjs" upgrade "$target_project" --dry-run
node "$monstrare_source/scripts/monstrare.mjs" upgrade "$target_project"
node "$monstrare_source/scripts/monstrare.mjs" verify "$target_project"
git -C "$target_project" diff --stat
```

### 如何閱讀 dry-run

| 分類 | 意義 | 升級行為 |
| --- | --- | --- |
| `add` | 新版有、target 缺少 | 新增 |
| `update` | managed 檔未被下游修改 | 備份後更新 |
| `remove` | 上游已移除，且 target 仍是原安裝內容 | 備份後移除 |
| `preserve` | 已是最新版，或屬於專案資料／seed-only | 不改內容 |
| `conflict` | managed 檔被修改、類型不符或無法安全辨識 | 整次升級停止 |

`status` 與 `upgrade --dry-run` 嚴格唯讀。若有 `conflict`，實際 `upgrade` 會在建立 lock 或備份前停止，不會覆寫客製檔。先 commit 現況，再決定保留、移植或還原衝突內容，重新執行 dry-run；v1.0.0 不提供自動三方 merge。

沒有 `.monstrare/manifest.json` 的舊安裝會以 bundled baseline 保守辨識。目前內建 `7749c12` baseline；無法唯一辨識的版本會 fail closed，不會猜測或寫入。

### 備份與失敗回復

成功升級會保留 `.monstrare/backups/<timestamp>-<from>-to-<to>/`：

- `journal.json` 記錄 `add`／`update`／`remove`、migration 與交易狀態。
- `files/` 保存被更新或刪除前的檔案。
- `manifest.json` 保存既有安裝的舊 manifest。
- `migrations/<id>/snapshot.json` 保存 migration 宣告範圍內的資料快照（若有 migration）。

一般 JavaScript 例外會自動回復，journal 會標記為 `rolled-back`。若遇到斷電、`SIGKILL` 或 `rollback-failed`，停止對 target 寫入並保留整個備份：依 journal 把 `update`／`remove` 從 `files/` 放回原相對路徑、刪除本次 `add` 的新檔，再還原舊 manifest；legacy 專案原本沒有 manifest，應移除本次新增的 `.monstrare/manifest.json`。有 migration 時也要依 snapshot 還原其完整宣告範圍。完成後重跑 `verify` 並檢查 git diff。

升級器不會執行 `git reset`、`git clean`、自動 commit、push、下載新版或刪除備份。

## 檔案所有權

`monstrare-package.json` 是配送與所有權的單一事實來源：

| 類型 | 升級策略 | 代表路徑 |
| --- | --- | --- |
| `managed` | 未修改時可更新；下游有修改則衝突停止 | `ai/process/`、`ai/skills/`、`scripts/lib/`、看板程式與測試 |
| `seedOnly` | 缺少時新增；一旦存在即由專案擁有 | `AGENTS.md`、`CLAUDE.md`、`.codex/config.toml`、`ai/context/*.md` |
| `projectData` | 永遠保留，不覆寫、不刪除 | `ai/artifacts/`、`tools/kanban/cards/`、`tools/kanban/epics.json` |
| `sourceOnly` | 只留在 Monstrare source，不配送 | 根 README、`CUSTOMIZATIONS.md`、發布測試與看板選型史料 |

## AI 看板

```bash
npm run kanban
```

終端機會顯示實際網址。Server 只 bind `127.0.0.1`，預設從 port `4420` 開始；若被占用會依序嘗試下一個 port，也可用 `KANBAN_PORT` 指定起始 port。

![看板畫面](tools/kanban/docs/board-screenshot.png)

看板把完整的 12 階段治理政策簡化為六條操作車道：Backlog → Blocked → Ready → Implementing → Verify → Done。你可以新增卡片、拖曳排序、編輯 owner／risk／agent、勾選 Readiness 與 Review Gates、加入留言，或切換到「藍圖」查看 Epic → User Story → Task 聚焦樹。

![藍圖畫面](tools/kanban/docs/roadmap-screenshot.png)

每次操作會直接寫回 `tools/kanban/cards/*.json`；沒有資料庫或雲端帳號，git 就是持久化與跨機器同步層。同一本機 server 的頁籤會透過 SSE 自動重取更新；若詳情視窗有未儲存輸入，背景更新不會覆蓋正在編輯的欄位。

完整 schema、API、WIP 上限、同步契約與操作方式見 [`tools/kanban/README.md`](tools/kanban/README.md)。

## 設計品質

UI 工作由兩層共同約束：

1. `ai/context/design-system.md` 記錄 design token、元件與版面 inventory，後續功能優先重用。
2. `ai/skills/design-craft.md` 與 `ai/checklists/design-review-checklist.md` 規範 type scale、間距、色彩、depth、互動狀態與交付檢查。

小型視覺修正可直接實作；新畫面或重大互動流程才需要 screen spec、mockup 變體與人工選型。

## 專案結構

```text
AGENTS.md                     # Codex 與其他 agent 的 repository 規則
CLAUDE.md                     # Claude Code 入口
.claude/skills/               # Claude Code skill stubs
.claude/agents/               # Claude Code subagents
.codex/skills/                # Codex skill stubs
ai/process/                   # 工作流程、DoR／DoD 與 review gates
ai/skills/                    # 各平台 skill 共用的正本
ai/templates/                 # 規格、task card、驗證報告範本
ai/context/                   # 專案、架構、設計系統與搜尋地圖
ai/artifacts/                 # 專案擁有的規格、任務與驗證證據
scripts/monstrare.mjs         # install／status／upgrade／verify CLI
scripts/lib/                  # manifest、plan、transaction、migration、verify
scripts/manifests/            # 可辨識的 legacy baseline
test/monstrare/               # 安裝與升級器測試
tools/kanban/                 # 本機看板、JSON API、SSE 與測試
monstrare-package.json        # 版本、Node 下限與檔案所有權
```

## 驗證

不需要先安裝 npm 套件：

```bash
npm test        # 執行全部看板與升級器測試
npm run check   # 測試 + Node/shell 語法 + governance 完整性
```

驗證已涵蓋 manifest／checksum、唯讀 dry-run、legacy 辨識、衝突保護、project-data 保留、交易式回復、migration 範圍、升級後 API E2E 與 README 本機連結。

`node scripts/monstrare.mjs verify <project>` 會執行 target checkout 內的治理 script 與測試；它不是 sandbox，只能對你信任的 checkout 使用。

## 已知限制與安全邊界

- 看板是本機工具，沒有帳號或權限系統；SSE 不提供跨機器即時同步。
- git merge 衝突仍需人工處理；同一卡片的同時儲存採最後成功寫入者狀態。
- v1.0.0 不自動合併下游客製的 managed 檔案，也不批次派送到多個專案。
- 沒有 manifest 且不符合 bundled baseline 的舊安裝會被拒絕，需要人工確認來源版本。
- 斷電、`SIGKILL` 與同一使用者惡意置換路徑的極小 TOCTOU 視窗，仍需依 backup／journal 與 git 人工復原。
- Migration module 是受信任的 source code；新增 migration 必須經 code review。

## 維護者發布檢查清單

發布只由維護者明確執行；CLI 不會自動建立 tag 或 push。

- 同步更新 `VERSION` 與 `monstrare-package.json` 的嚴格 SemVer，並確認 `minimumNode`。
- 檢查 `managed`／`seedOnly`／`projectData`／`sourceOnly`；要支援新的無 manifest 舊版時，新增並測試對應 baseline。
- 資料 schema 有差異時，在 `scripts/migrations/index.mjs` 登錄完整、連續、可重跑的 migration 鏈。
- 執行 `npm run check` 與 `git diff --check`，確認 legacy、衝突、project-data、fault injection、migration、verify 與 E2E 全部通過。
- 同步核對中英文 README 的版本、指令、本機連結、備份、衝突與回復說明。
- 人工檢查 release diff 與 `git status`，再建立 annotated tag：

```bash
git tag -a v1.0.0 -m "Monstrare v1.0.0"
```

推送版本 tag 會觸發 GitHub Actions 的正式 Release bundle 建置；推送前先照
[`發布維運手冊`](tools/kanban/docs/releasing.md) 完成版本、可重現建置與
digest 檢查。此清單不會自動建立或推送 tag。

## 靈感來源

Monstrare 借鏡 BMAD Method、GitHub Spec Kit、Kiro Specs、Task Master、Serena、SuperClaude、Archon、Plandex，以及 CodeRabbit／Qodo 的規格優先、情境探索、受控執行與審查概念；這些工具沒有被 vendor 進 repository，Monstrare 可以獨立使用或與它們共存。

## License

[MIT](LICENSE)
