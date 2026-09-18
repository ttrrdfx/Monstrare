# 驗證報告

## 摘要

- 任務：TASK-009 實作 manifest 驅動的新安裝與相容 wrapper
- 結果：通過
- 驗證者：Codex（2026-09-15）

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `node --test test/monstrare/install.test.mjs test/monstrare/cli.test.mjs test/monstrare/manifest.test.mjs test/monstrare/paths.test.mjs` | 通過 | 21/21；涵蓋所有權選擇、空專案、既有種子／專案資料、重複安裝、模擬失敗、symlink 逃逸與 wrapper E2E |
| `git diff --check` | 通過 | 無 whitespace error |
| `node --check scripts/monstrare.mjs` | 通過 | CLI 語法正確 |
| `node --check scripts/lib/install.mjs` | 通過 | install helper 語法正確 |
| `bash -n scripts/install-into-project.sh` | 通過 | shell wrapper 語法正確 |
| `npm run check` | 通過 | 39/39 tests；server syntax 與 governance kit check 通過 |

## UI 證據

| Viewport | 螢幕截圖 | 備註 |
|---|---|---|
| 不適用 | 不適用 | 本卡只變更 CLI／安裝流程；E2E 以啟動看板並讀取首頁、cards、epics 驗證 |

## 審查發現

| 發現 | 嚴重程度 | 狀態 |
|---|---|---|
| managed／seed-only 選擇遵守來源 manifest，project-data 與 source-only 不配送 | 無 | 通過 |
| target 與每個配送路徑經安全解析，外逃 symlink 在寫入前拒絕 | 無 | 通過 |
| 安裝 manifest 最後原子寫入；模擬 copy failure 不留下完成 manifest | 無 | 通過 |
| 未新增 production dependency、未修改下游 package.json／lockfile | 無 | 通過 |

## 殘留風險

- 首次安裝在 manifest 寫入前失敗時，已複製的 managed 檔案可能留在 target；因 manifest 不存在，不會被誤判為完成安裝。完整 rollback 與 lock 屬 TASK-011。
- 路徑檢查與檔案操作間仍有本機同使用者 TOCTOU 競態，沿用 TASK-008 已記錄限制；不支援不可信任的共同使用者操作同一 target。
- 未發現需阻擋 TASK-009 的正確性、安全性、隱私或維護性問題；核准建議：核准。
