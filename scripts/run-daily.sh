#!/bin/bash
# run-daily.sh - 日次レポート生成スクリプト（cron実行用）
# 多重起動防止ロック付き

set -e

# スクリプトのディレクトリを取得
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# パス設定
LOCK_DIR="$PROJECT_DIR/data/run.lock.d"
LOCK_PID_FILE="$LOCK_DIR/pid"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/$(date +%Y-%m-%d).log"
STATUS_FILE="$LOG_DIR/run_status.jsonl"

# クロスプラットフォーム対応のタイムスタンプ関数
get_timestamp() {
    if date -Iseconds >/dev/null 2>&1; then
        date -Iseconds
    else
        # macOS向けフォールバック
        date -u +"%Y-%m-%dT%H:%M:%S+00:00"
    fi
}

# ログ関数
log() {
    echo "[$(get_timestamp)] $1" | tee -a "$LOG_FILE"
}

# ステータス記録関数
record_status() {
    local status="$1"
    local reason="$2"
    local metrics="$3"

    local timestamp=$(get_timestamp)

    if [ -n "$metrics" ]; then
        echo "{\"status\":\"$status\",\"reason\":\"$reason\",\"timestamp\":\"$timestamp\",$metrics}" >> "$STATUS_FILE"
    else
        echo "{\"status\":\"$status\",\"reason\":\"$reason\",\"timestamp\":\"$timestamp\"}" >> "$STATUS_FILE"
    fi
}

# ログディレクトリの作成
mkdir -p "$LOG_DIR"
mkdir -p "$PROJECT_DIR/data"

# クリーンアップ関数（ロック解除）
cleanup() {
    rm -rf "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

# ロック取得（古いロックの検出機能付き）
if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo $$ > "$LOCK_PID_FILE"
else
    # 既存ロックのチェック
    if [ -f "$LOCK_PID_FILE" ]; then
        OLD_PID=$(cat "$LOCK_PID_FILE" 2>/dev/null)
        if [ -n "$OLD_PID" ] && ! kill -0 "$OLD_PID" 2>/dev/null; then
            log "WARNING: Removing stale lock from PID $OLD_PID"
            rm -rf "$LOCK_DIR"
            if mkdir "$LOCK_DIR" 2>/dev/null; then
                echo $$ > "$LOCK_PID_FILE"
            else
                log "SKIPPED: Failed to acquire lock after removing stale lock"
                record_status "skipped" "lock_conflict"
                exit 0
            fi
        else
            log "SKIPPED: Another instance (PID: $OLD_PID) is running"
            record_status "skipped" "lock_conflict"
            exit 0
        fi
    else
        log "SKIPPED: Lock exists but no PID file (lock: $LOCK_DIR)"
        record_status "skipped" "lock_conflict"
        exit 0
    fi
fi

log "=== Daily Reporter Started ==="
log "Project directory: $PROJECT_DIR"

# Node.jsの確認
if ! command -v node &> /dev/null; then
    log "ERROR: Node.js is not installed"
    record_status "fatal_error" "nodejs_not_found"
    exit 2
fi

# 依存関係の確認
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
    log "Installing dependencies..."
    cd "$PROJECT_DIR"
    npm install >> "$LOG_FILE" 2>&1
fi

# 設定ファイルの確認
REQUIRED_CONFIGS=(
    "config/sources.json"
    "config/queries.json"
    "config/tag-synonyms.json"
    "config/dedup-thresholds.json"
    "config/default.json"
)

for config in "${REQUIRED_CONFIGS[@]}"; do
    if [ ! -f "$PROJECT_DIR/$config" ]; then
        log "ERROR: Missing config file: $config"
        record_status "fatal_error" "missing_config"
        exit 2
    fi
done

# メイン処理の実行
log "Executing main process..."
START_TIME=$(date +%s)

cd "$PROJECT_DIR"

# TypeScript実行（npx tsx使用）
if npx tsx src/index.ts >> "$LOG_FILE" 2>&1; then
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))

    log "=== Daily Reporter Completed ==="
    log "Execution time: ${DURATION}s"

    record_status "success" "completed" "\"executionTimeMs\":$((DURATION * 1000))"
    exit 0
else
    EXIT_CODE=$?
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))

    log "=== Daily Reporter Failed (exit code: $EXIT_CODE) ==="
    log "Execution time: ${DURATION}s"

    if [ $EXIT_CODE -eq 2 ]; then
        record_status "fatal_error" "execution_failed" "\"executionTimeMs\":$((DURATION * 1000))"
    else
        record_status "partial_failure" "execution_error" "\"executionTimeMs\":$((DURATION * 1000))"
    fi

    exit $EXIT_CODE
fi
