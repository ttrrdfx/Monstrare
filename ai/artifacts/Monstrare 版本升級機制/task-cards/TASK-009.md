# AI-Ready 任務卡

## Metadata

- 任務：實作 manifest 驅動的新安裝與相容 wrapper
- 上層規格：`ai/artifacts/Monstrare 版本升級機制/feature-spec.md`
- 上層 Epic：Monstrare 版本升級機制
- 上層 User Story：US-1 查看安裝版本、US-3 安全升級
- 分軌：不適用
- 前置任務（dependsOn）：TASK-008
- 狀態：已完成
- 風險等級：中
- Agent owner：Codex
- 人工核准者：使用者（2026-09-15，核准架構與任務卡；實作另開新 session）

## 目標

讓全新下游專案透過同一份 manifest 完成安裝並留下可供後續升級辨識的安裝紀錄，同時保留原 shell 指令相容性。

## 情境包（Context Pack）

- 相關檔案：`scripts/install-into-project.sh`、TASK-008 manifest／path API、`README.md` 的安裝契約。
- 既有模式：AGENTS/context/config 採 copy-if-missing，看板初次安裝時排除原始 repo 選型史料。
- 假設：target 已存在且可辨識為專案；Node.js 20 可用。
- 未知事項：下游是否有 `package.json` 不影響安裝，第一版不修改它。
- 允許變更的檔案：`scripts/install-into-project.sh`、`scripts/monstrare.mjs`、安裝 helper、安裝整合測試 fixtures。
- 不得觸碰：真實下游專案、Monstrare 自身 cards/epics、下游 `package.json` 與 lockfile。

## 需求

- `install <project>` 依 ownership 契約安裝 managed 與缺少的 seed-only 檔案。
- 不配送 source-only，不以來源 cards/epics 覆寫 target 資料。
- 全部成功後原子寫入 `.monstrare/manifest.json`。
- target 已有 install manifest 時拒絕重複 install，提示改用 status／upgrade。
- 現有 Bash 安裝指令委派新 CLI，保留原參數與清楚 exit code。

## 驗收標準

- 空白臨時專案可完成安裝，manifest 的 managed hash 與實際檔案一致。
- target 已有 AGENTS、context、config 或 artifacts 時內容保持不變。
- Monstrare 自身 mockup／artifact 與來源 cards/epics 不會出現在 target。
- 安裝中途模擬失敗時不留下宣稱完成的 manifest。
- 舊 shell 呼叫方式仍可成功安裝。

## 實作備註

新安裝可以共用 TASK-011 之前的簡化 staging primitive，但不可把「既有專案升級」邏輯偷放進本卡。

## 驗證契約

- 單元測試：install ownership selection、seed-only 判斷。
- 整合測試：空專案、已有種子檔、已有 cards/epics、重複安裝、模擬寫入失敗。
- E2E 測試：shell wrapper 對臨時專案安裝並啟動看板 smoke test。
- 型別檢查：不適用。
- Lint：不適用。
- Build：`node --check scripts/monstrare.mjs`、`bash -n scripts/install-into-project.sh`。
- 螢幕截圖：不適用。
- 安全性檢查：target 路徑、symlink、project-data 不覆寫與 source-only 排除。

## 完成證據

- 變更的檔案：`scripts/lib/install.mjs`、`scripts/monstrare.mjs`、`scripts/install-into-project.sh`、`test/monstrare/install.test.mjs`、`test/monstrare/cli.test.mjs`。
- 執行過的指令：`node --test test/monstrare/install.test.mjs test/monstrare/cli.test.mjs test/monstrare/manifest.test.mjs test/monstrare/paths.test.mjs`、`git diff --check`、`node --check scripts/monstrare.mjs`、`node --check scripts/lib/install.mjs`、`bash -n scripts/install-into-project.sh`、`npm run check`。
- 測試輸出：針對性測試 21/21 通過；完整檢查 39/39 通過，governance kit check passed。
- 螢幕截圖：不適用。
- 已知限制：首次安裝失敗時可能保留 manifest 寫入前已複製的 managed 檔案，但不會留下宣稱完成的 `.monstrare/manifest.json`；完整交易回復與並行 lock 由 TASK-011 負責。
- 後續任務：TASK-011、TASK-013。
