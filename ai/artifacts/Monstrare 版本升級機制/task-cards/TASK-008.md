# AI-Ready 任務卡

## Metadata

- 任務：建立版本與 manifest 架構基礎
- 上層規格：`ai/artifacts/Monstrare 版本升級機制/feature-spec.md`
- 上層 Epic：Monstrare 版本升級機制
- 上層 User Story：US-1 查看安裝版本、US-2 預覽升級
- 分軌：不適用
- 前置任務（dependsOn）：無
- 狀態：完成
- 風險等級：中
- Agent owner：待指定
- 人工核准者：使用者（2026-09-15，核准架構與任務卡；實作另開新 session）

## 目標

建立來源版本、檔案所有權、安裝 manifest、checksum 與安全路徑驗證的單一資料契約，供安裝與升級共用。

## 情境包（Context Pack）

- 相關檔案：`scripts/install-into-project.sh`、`scripts/check-governance.sh`、`ai/context/architecture-map.md`、本 Epic 架構筆記。
- 既有模式：Node.js 20、零 production dependency、來源 script 對明確 target 路徑操作。
- 假設：版本使用嚴格 SemVer，hash 使用 SHA-256。
- 未知事項：無；legacy baseline 由 TASK-010 處理。
- 允許變更的檔案：`VERSION`、`monstrare-package.json`、`scripts/monstrare.mjs`、`scripts/lib/manifest.mjs`、`scripts/lib/paths.mjs`、對應單元測試、`scripts/check-governance.sh`。
- 不得觸碰：`tools/kanban/cards/`、`tools/kanban/epics.json`、`ai/context/` 既有內容、看板 runtime 行為。

## 需求

- 定義來源 package manifest 與下游 install manifest schema。
- 展開、排序並驗證 managed、seed-only、project-data、source-only inventory。
- 實作 SHA-256、SemVer 解析、manifest 讀寫資料模型與純分類 helper。
- 實作 target root、相對路徑、symlink 與所有權重疊驗證。
- CLI 先提供參數解析與一致的錯誤／exit code 邊界，不在本卡執行安裝或升級寫入。

## 驗收標準

- 有效來源 manifest 可穩定產生相同排序的 inventory。
- 絕對路徑、`..`、重疊所有權、逃離來源或 target 的 symlink 全部被拒絕。
- install manifest 可 round-trip，且不包含檔案內容。
- SemVer 降版、未知 schema 與 malformed JSON fail closed。
- 現有看板與治理測試無回歸。

## 實作備註

純邏輯放在可由 `node:test` 直接 import 的 `.mjs`；寫入 helper 僅提供原子 temp + rename primitive，實際交易由 TASK-011 擁有。

## 驗證契約

- 單元測試：manifest schema、inventory、SHA-256、SemVer、路徑正規化、所有權重疊與 symlink escape。
- 整合測試：在臨時來源／target 產生並讀回 install manifest。
- E2E 測試：不適用，TASK-013 覆蓋。
- 型別檢查：不適用。
- Lint：不適用（專案無 lint 設定）。
- Build：`node --check scripts/monstrare.mjs` 及所有新增 `.mjs`。
- 螢幕截圖：不適用。
- 安全性檢查：路徑穿越、symlink 逃逸、廣泛 target、manifest 注入測試。

## 完成證據

- 變更的檔案：`VERSION`、`monstrare-package.json`、`package.json`、`scripts/monstrare.mjs`、`scripts/lib/manifest.mjs`、`scripts/lib/paths.mjs`、`scripts/check-governance.sh`、`test/monstrare/*.test.mjs`、`verification/TASK-008.md`。
- 執行過的指令：`npm test`、`npm run check`、新增 `.mjs` 的 `node --check`、`bash -n scripts/check-governance.sh`、真實來源 inventory 展開、`git diff --check`。
- 測試輸出：32/32 通過；真實來源 manifest 展開 129 個檔案（managed 59、seed-only 12、project-data 44、source-only 14），排序穩定且無所有權重疊。
- 螢幕截圖：不適用。
- 已知限制：本卡只建立 CLI 參數與錯誤邊界；install、status、upgrade、verify 的實際行為依 TASK-009 至 TASK-013 實作。路徑檢查與後續檔案操作之間仍有本機同使用者 TOCTOU 競態，交易階段需再次驗證。
- 後續任務：TASK-009、TASK-010。
