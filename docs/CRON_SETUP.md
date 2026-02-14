# Cron設定ガイド

Daily Reporter を定期実行するための cron 設定ガイドです。

## 前提条件

1. **Node.js**: v18以上がインストールされていること
2. **Claude Code認証**: `claude` コマンドで認証済みであること（SDKが自動的に認証を使用）
3. **依存関係**: `npm install` が完了していること
4. **スクリプト権限**: 実行権限が付与されていること

```bash
chmod +x scripts/run-daily.sh
```

## 基本的なcron設定

### crontab の編集

```bash
crontab -e
```

### 設定例

```cron
# タイムゾーンをJSTに設定
TZ=Asia/Tokyo

# 平日の朝6時に実行
0 6 * * 1-5 /path/to/claude-code-daily-reporter/scripts/run-daily.sh

# 毎日朝7時に実行（休日含む）
0 7 * * * /path/to/claude-code-daily-reporter/scripts/run-daily.sh
```

## 環境変数の設定

cronジョブでは環境変数が制限されるため、必要に応じて設定します。

### 方法1: ラッパースクリプトを使用

```bash
#!/bin/bash
# scripts/cron-wrapper.sh

# Node.jsのパスを設定（nvm使用時）
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Claude認証情報のパス（通常は自動検出）
# export CLAUDE_CONFIG_DIR="$HOME/.claude"

# プロジェクトディレクトリに移動して実行
cd /path/to/claude-code-daily-reporter
./scripts/run-daily.sh
```

crontabでは:
```cron
0 6 * * 1-5 /path/to/scripts/cron-wrapper.sh
```

### 方法2: crontab内で直接設定

```cron
TZ=Asia/Tokyo
PATH=/usr/local/bin:/usr/bin:/bin
NVM_DIR=/Users/username/.nvm

0 6 * * 1-5 source $NVM_DIR/nvm.sh && /path/to/scripts/run-daily.sh
```

## ロックファイルの挙動

`run-daily.sh` は多重起動を防止するため、ロックディレクトリを使用します。

### ロック機構

1. **ロック取得**: `data/run.lock.d/` ディレクトリを作成
2. **PIDファイル**: `data/run.lock.d/pid` にプロセスIDを記録
3. **古いロックの検出**: PIDファイルのプロセスが存在しない場合、ロックを削除
4. **クリーンアップ**: スクリプト終了時にロックを自動削除

### ロックが残った場合

通常、スクリプトは正常終了時にロックを自動削除します。異常終了した場合でも、次回実行時に古いロックを検出・削除します。

手動でロックを解除する場合:
```bash
rm -rf data/run.lock.d
```

## ログの確認

### 日次ログ

```bash
# 今日のログ
cat logs/$(date +%Y-%m-%d).log

# 直近のログ
ls -lt logs/*.log | head -5
```

### 実行ステータス

```bash
# 最新のステータス
tail -5 logs/run_status.jsonl

# 成功した実行のみ
grep '"status":"success"' logs/run_status.jsonl | tail -5

# 失敗した実行
grep -E '"status":"(fatal_error|partial_failure)"' logs/run_status.jsonl
```

## 出力の確認

生成されたレポートは `output/daily-reports/` に保存されます。

```bash
# 最新のレポート
ls -lt output/daily-reports/*.md | head -5

# 今日のレポートを表示
cat output/daily-reports/daily-report-$(date +%Y-%m-%d).md
```

## トラブルシューティング

### 1. Node.jsが見つからない

**症状**: ログに `ERROR: Node.js is not installed` と表示される

**解決策**:
- ラッパースクリプトでnvmを読み込む
- または、フルパスでnodeを指定: `/usr/local/bin/node`

### 2. 認証エラー

**症状**: Claude APIの認証エラー

**解決策**:
1. ターミナルで `claude` を実行して認証
2. 認証情報が `~/.claude` に保存されていることを確認

### 3. ロックが解除されない

**症状**: `SKIPPED: Another instance is running` が継続する

**解決策**:
```bash
# ロックの状態を確認
ls -la data/run.lock.d/

# 手動解除
rm -rf data/run.lock.d
```

### 4. 設定ファイルが見つからない

**症状**: `ERROR: Missing config file` と表示される

**解決策**:
```bash
# 必要な設定ファイルを確認
ls -la config/
# 必要: sources.json, queries.json, tag-synonyms.json, dedup-thresholds.json, default.json
```

### 5. タイムゾーンの問題

**症状**: レポートの日付がずれている

**解決策**:
- crontabに `TZ=Asia/Tokyo` を追加
- または、スクリプト内で `export TZ=Asia/Tokyo` を設定

## 再実行

特定の日付のレポートを再生成する場合:

```bash
# 指定した日付で再実行
npx tsx src/index.ts --date 2024-02-10

# または rerun.sh を使用（存在する場合）
./scripts/rerun.sh 2024-02-10
```

## KPI監視

監視テストを夜間に実行してKPIを計測:

```cron
# 毎晩23時に監視テストを実行
0 23 * * * cd /path/to/project && npm run test:monitoring >> logs/monitoring.log 2>&1
```

## macOS固有の注意事項

### launchdを使用する場合

macOSではcronの代わりにlaunchdを使用することも可能です:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.user.daily-reporter</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/scripts/run-daily.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>6</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/path/to/logs/launchd.log</string>
    <key>StandardErrorPath</key>
    <string>/path/to/logs/launchd-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
```

保存場所: `~/Library/LaunchAgents/com.user.daily-reporter.plist`

```bash
# ロード
launchctl load ~/Library/LaunchAgents/com.user.daily-reporter.plist

# アンロード
launchctl unload ~/Library/LaunchAgents/com.user.daily-reporter.plist

# 手動実行
launchctl start com.user.daily-reporter
```

## ログローテーション

長期運用ではログファイルが蓄積されるため、ログローテーションを設定します。

### macOS/Linuxでのlogrotate設定

```conf
# /etc/logrotate.d/daily-reporter
/path/to/claude-code-daily-reporter/logs/*.log {
    daily
    rotate 30
    compress
    missingok
    notifempty
    dateext
}
```

### 手動でのログ整理

```bash
# 30日より古いログを削除
find logs/ -name "*.log" -mtime +30 -delete

# run_status.jsonlの古いエントリを整理（最新1000行を保持）
tail -1000 logs/run_status.jsonl > logs/run_status.jsonl.tmp && mv logs/run_status.jsonl.tmp logs/run_status.jsonl
```

## セキュリティ考慮事項

1. **認証情報**: Claude認証情報はユーザーディレクトリに保存されるため、適切な権限設定を維持
2. **ログファイル**: センシティブな情報がログに含まれる可能性があるため、アクセス権限を制限
3. **出力ディレクトリ**: 生成されたレポートへのアクセスを必要な人のみに制限
