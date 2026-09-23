# TASK-019 驗證報告

## 摘要

- 任務：建立 GitHub Release 發布流程與維護文件。
- 結果：本機實作與驗證通過；真實 tag／GitHub Release 未授權執行，人工驗收與 code review 尚待完成。
- 驗證者：Codex（2026-09-22）。

## 指令

| 指令 | 結果 | 備註 |
|---|---|---|
| `node --test test/monstrare/release-workflow.test.mjs` | 通過 | 3/3；tag/version、SHA pin／權限／asset 範圍、mock GitHub 重跑與失敗路徑。 |
| `npm run check` | 通過 | 136/136 tests；syntax check 與 governance kit check 均通過。 |
| `npm run package-release -- --created-from <HEAD> --output <temp>/first.json` 與第二次建置、`shasum -a 256`、`cmp` | 通過 | 同一工作樹兩次 SHA-256 完全相同；此時為未提交工作樹，非正式乾淨 tag checkout。 |
| `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/release.yml")'` | 通過 | YAML 可解析且含 build/release 兩個 job；沒有 actionlint，本機未驗證 GitHub runner 真實執行。 |
| `git diff --check` | 通過 | 既有 tracked diff 無 whitespace error。 |
| 官方 action tag `git ls-remote`（checkout v4.2.2、setup-node v4.4.0、upload-artifact v4.6.2、download-artifact v4.3.0） | 通過 | 四個完整 SHA 與官方 tag 解析值一致。 |

## 安全性與審查發現

- 建置 job 僅 `contents: read`；發布 job 僅 `contents: write`，不 checkout／執行 repo code。權杖只在發布 shell step 提供，未寫入檔案或輸出。
- 外來 tag 透過環境變數傳入、嚴格 SemVer 驗證；輸出檔名由版本固定推導，無 shell 中的原始 GitHub expression 或 upload glob。發布時重新驗證版本、檔名、checksum、遠端 tag commit 與 release 非 draft／非 prerelease。
- 舊 asset digest 相同則跳過、不同或缺失則停止；mock 測試涵蓋相同／不同／缺失 digest、tag 移動、缺 asset、缺 release。網路／權限非 404 失敗不會被當成缺 release；不使用 `--clobber`，不自動刪除資產。
- 正式 GitHub API digest 生成延遲與實際 runner 行為仍未觀察，發布後人工 gate 與回復手冊已列出。沒有新 production dependency、migration 或 runtime 行為變更。

## UI 證據

不適用（無 UI 變更）。

## 殘留風險與後續

- 工作樹包含使用者未提交變更與 TASK-014 原有未追蹤檔案，無法聲稱已在乾淨 checkout 上重現；正式 tag 的 GitHub-hosted runner 驗收需另行授權，交由 TASK-020 記錄。
- 真實 API 權限、release asset digest 時序與 GitHub redirect／下載對接須在 staging 驗證。若發布途中失敗，可能留下沒有有效 asset 的正式 release，需先停止下游更新、人工檢查並依 runbook 處理。
- Code review／人工驗收尚未完成；看板停留 `verify`，不得標 `done`。
