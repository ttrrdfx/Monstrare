# 功能規格書

## Metadata

- 功能：Monstrare 下游專案版本升級機制
- 負責人：待指定
- 狀態：人工已核准（2026-09-15）
- 風險等級：中

## 問題

Monstrare 原始 repository 的看板與治理套件會持續演進，但目前
`scripts/install-into-project.sh` 在目標專案已存在 `tools/kanban/` 時會跳過整個
目錄。結果是新安裝可取得新版看板，既有專案卻只能靠人工複製檔案更新，且容易
誤蓋 `cards/*.json`、`epics.json` 或下游專案的客製內容。

需要一個可辨識版本、可預覽差異、可安全更新套件擁有檔案，並保留專案擁有資料
的升級流程。

## 使用者

- 維護 Monstrare 原始 repository 的開發者。
- 已把 Monstrare 安裝到一個或多個既有專案的開發者或團隊。
- 需要在不遺失看板資料與專案脈絡的前提下取得新版功能的 AI agent。

## 目標

- 明確區分「Monstrare 套件擁有」與「下游專案擁有」的檔案。
- 每個已安裝專案可知道目前的 Monstrare 版本與可升級版本。
- 升級前可先 dry-run，列出將新增、更新、保留與衝突的檔案。
- 更新看板程式與治理套件時，保留卡片、Epic、context、artifacts 與專案設定。
- 若下游修改過受管理檔案，不靜默覆寫，而是停止該檔案並提供衝突報告。
- 升級後可用固定指令驗證治理檔案、看板測試與 server 語法。

## 非目標

- 第一版不自動搜尋或遠端更新所有電腦上的專案。
- 第一版不做通用的三方文字合併；衝突由使用者或 agent 明確處理。
- 不把看板改造成雲端服務，也不新增帳號、資料庫或 production dependency。
- 不自動修改下游專案的產品程式碼。
- 不替使用者自動 commit、push 或刪除備份。

## 使用者故事（User Stories）

| 故事 | 身為／我想要／以便 | 驗收標準 |
|---|---|---|
| US-1 查看安裝版本 | 身為下游專案維護者，我想知道目前安裝的 Monstrare 版本，以便判斷是否需要升級。 | 狀態指令顯示已安裝版本、來源版本與工作樹衝突摘要。 |
| US-2 預覽升級 | 身為下游專案維護者，我想先預覽升級影響，以便確認不會覆蓋專案資料。 | dry-run 分類列出新增、更新、保留、衝突；不寫入任何檔案。 |
| US-3 安全升級 | 身為下游專案維護者，我想套用新版看板與治理檔案，以便取得原始 repository 的新功能。 | 套件擁有且未被下游修改的檔案更新成功，專案擁有檔案內容與修改時間不變。 |
| US-4 保護客製內容 | 身為曾客製 Monstrare 的專案維護者，我想在衝突時得到清楚報告，以便決定保留或移植修改。 | 受管理檔案 checksum 與安裝紀錄不符時不覆寫，指令以非零狀態結束並列出檔案。 |
| US-5 驗證升級 | 身為維護者，我想在升級後執行一致的檢查，以便確認新版可運作。 | 驗證至少涵蓋 governance check、Node 語法與看板測試；結果清楚回報。 |

## 使用者旅程

```text
維護者先在 Monstrare 原始 repository 完成功能與版本發布
→ 到某個已安裝 Monstrare 的下游專案執行升級 dry-run
→ 檢查新增／更新／保留／衝突清單
→ 無衝突時套用升級；有衝突時先人工或由 agent 移植客製修改
→ 執行驗證
→ 經人工確認後，由專案自行 commit
```

## 功能需求

- WHEN 安裝到新專案，THE SYSTEM SHALL 寫入一份機器可讀的安裝 manifest，至少記錄版本、受管理檔案清單與各檔案 checksum。
- WHEN 對既有專案執行狀態或 dry-run，THE SYSTEM SHALL 比較來源檔案、安裝 manifest 與目標檔案，並分類為 `add`、`update`、`preserve`、`conflict`。
- WHEN 目標檔案屬於專案擁有資料，THE SYSTEM SHALL 永遠保留，不以來源 repository 的內容覆寫。
- WHEN 受管理檔案自上次安裝後未被修改，THE SYSTEM SHALL 允許升級成來源版本。
- WHEN 受管理檔案與 manifest checksum 不一致，THE SYSTEM SHALL 將其標記為衝突並預設不覆寫。
- WHEN 使用者未明確套用升級，THE SYSTEM SHALL 不寫入目標專案。
- WHEN 升級開始寫入，THE SYSTEM SHALL 先建立範圍明確、可辨識版本的備份或 staging 區，避免中途失敗留下混合版本。
- WHEN 升級全部成功，THE SYSTEM SHALL 以原子方式更新 manifest 為新版本與新 checksum。
- WHEN 版本包含資料格式變更，THE SYSTEM SHALL 透過有起訖版本的 migration 處理，且 migration 需可重跑或能偵測已執行。
- WHEN 升級完成，THE SYSTEM SHALL 顯示建議驗證指令與尚未解決的衝突。

### 檔案所有權初稿

| 類型 | 預設策略 | 代表路徑 |
|---|---|---|
| 套件擁有 | 可升級；下游有修改則衝突停止 | `ai/process/`、`ai/templates/`、`ai/checklists/`、`ai/skills/`、skill stubs、看板程式與測試 |
| 專案擁有 | 永遠保留 | `ai/context/`、`ai/artifacts/`、`tools/kanban/cards/`、`tools/kanban/epics.json` |
| 合併管理 | 僅補缺少內容或報告衝突，不整檔覆寫 | `AGENTS.md`、`CLAUDE.md`、`.codex/config.toml`、`package.json`、`.github/` |
| 原始 repo 歷史 | 不配送到下游 | `tools/kanban/mockups/`、`tools/kanban/mockup-decision.md`、`tools/kanban/screen-spec.md`、Monstrare 自身 artifacts |

## 畫面

本功能第一版不新增瀏覽器 UI。操作介面為 CLI，至少提供：

- `status`：顯示版本與修改狀態。
- `upgrade --dry-run <project>`：只預覽。
- `upgrade <project>`：套用無衝突更新。
- `verify <project>`：執行或提示專案適用的驗證。

實際指令名稱於架構規劃階段決定。

## 資料與 API

- 輸入：Monstrare 來源目錄、下游專案路徑、升級模式。
- 輸出：升級計畫、檔案分類、衝突報告、安裝 manifest、驗證結果。
- Manifest 假設：JSON 格式，存於下游專案的專用隱藏目錄；不包含密鑰或使用者資料。
- 驗證：拒絕不存在的目標、repository 根目錄之外的寫入、未知 manifest schema 與不支援的降版。
- 錯誤：任何衝突、migration 失敗或驗證失敗都需非零 exit code；不得宣稱升級完成。

## 安全性與隱私

- 身分驗證：不適用；本機 CLI。
- 權限：只操作使用者明確指定的專案路徑。
- 敏感資料：manifest 只記錄相對路徑、版本與 checksum，不收集檔案內容或遙測。
- 濫用情境：阻止路徑穿越、symlink 逃逸與把廣泛目錄誤當目標；不得把卡片、context、artifacts 納入覆寫集合。
- 回滾：升級前備份所有將覆寫的檔案；第一版由使用者明確執行復原，不自動執行 git reset。

## 驗收標準

- 全新安裝後存在有效 manifest，並能正確回報版本。
- 對現有舊版專案執行 dry-run 時，完全不修改目標檔案。
- 舊版 `tools/kanban/index.html`、`server.mjs`、測試與說明可升級到新版。
- `cards/*.json`、`epics.json`、`ai/context/`、`ai/artifacts/` 在升級前後逐檔 checksum 相同。
- 人工修改過的受管理檔案會列為衝突且保持原內容。
- 模擬中途失敗時，目標專案不會停在無法辨識的半套版本，且有可用備份。
- 升級完成後，Monstrare 自我檢查、看板測試與 server syntax check 通過。
- 文件清楚說明新安裝、既有專案升級、衝突處理與回滾流程。

## 驗證計畫

- 單元測試：manifest 解析、checksum、所有權分類、版本比較、路徑驗證。
- 整合測試：以臨時專案覆蓋新安裝、無衝突升級、有衝突升級、migration 失敗與回滾準備。
- E2E：從既有舊版 fixture 升級後啟動看板，讀取原有 cards/epics 並操作 API。
- 視覺：若升級內容包含看板 UI 變更，沿用該功能自己的截圖驗證；升級器本身不需視覺驗證。
- 手動：選一個實際下游專案先 dry-run，再於乾淨 branch 套用並檢查 git diff。

## 待人工核准的範圍

- 建議第一版採「checksum 衝突偵測＋停止」；不自動三方合併下游客製程式。
- 建議第一版只升級使用者逐一指定的本機專案；跨電腦與批次派送另列後續功能。
- 規格核准後才進入架構規劃與任務拆分，本文件不授權實作升級器。
