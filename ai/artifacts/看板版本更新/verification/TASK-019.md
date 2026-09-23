# TASK-019 驗證報告

## 摘要

- 任務：建立 GitHub Release 發布流程與維護文件。
- 結果：通過；`v1.0.0` 正式 Release、固定名稱 asset 與 SHA-256 digest 已完成真實驗證。
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
| GitHub Actions run `35818755376` | 預期失敗 | 首次真實 run 揭露 shallow checkout 缺少 legacy commit `7749c12`；發布 job 未執行，沒有 Release/asset。 |
| GitHub Actions run `35818994097` | 通過 | build 與 release job 全綠；以不移動既有 tag 的 `workflow_dispatch` 安全重跑。 |
| `gh api`、`gh release download`、`shasum -a 256`、`parseReleaseBundle` | 通過 | 遠端與下載 digest 均為 `sha256:298e42a441d08ee5d969efa846d5a4a93d2f7b7c4e350cb17824ebb16010ffd8`；bundle v1.0.0、createdFrom `8681d91…`、89 files。 |

## 安全性與審查發現

- 建置 job 僅 `contents: read`；發布 job 僅 `contents: write`，不 checkout／執行 repo code。權杖只在發布 shell step 提供，未寫入檔案或輸出。
- 外來 tag 透過環境變數傳入、嚴格 SemVer 驗證；輸出檔名由版本固定推導，無 shell 中的原始 GitHub expression 或 upload glob。發布時重新驗證版本、檔名、checksum、遠端 tag commit 與 release 非 draft／非 prerelease。
- 舊 asset digest 相同則跳過、不同或缺失則停止；mock 測試涵蓋相同／不同／缺失 digest、tag 移動、缺 asset、缺 release。網路／權限非 404 失敗不會被當成缺 release；不使用 `--clobber`，不自動刪除資產。
- 正式 GitHub API digest、下載內容與實際 runner 均已觀察並一致。第一次 run 發現 shallow checkout 後，workflow 改用完整歷史並提供固定既有 tag 的安全手動重跑；tag 未被移動。

## UI 證據

不適用（無 UI 變更）。

## 殘留風險與後續

- GitHub runner 警告固定的 checkout/setup-node/upload/download-artifact 版本內部 Node 20 已由 runner 強制切至 Node 24；本次成功，但後續應查核並升級官方 action SHA。
- GitHub runner 的 `ubuntu-latest` 預告將遷移至 Ubuntu 26；後續 release 前應持續以完整 workflow 驗證。
- 正式 Release：[v1.0.0](https://github.com/ttrrdfx/Monstrare/releases/tag/v1.0.0)；成功 run：[35818994097](https://github.com/ttrrdfx/Monstrare/actions/runs/35818994097)。
