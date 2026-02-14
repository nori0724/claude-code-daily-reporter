#!/bin/bash
# rerun.sh - 特定日付のレポート再生成スクリプト
# 使用例: ./rerun.sh 2026-02-10

set -e

# スクリプトのディレクトリを取得
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# 引数チェック
if [ $# -lt 1 ]; then
    echo "Usage: $0 <date> [options]"
    echo ""
    echo "Arguments:"
    echo "  <date>      Target date in YYYY-MM-DD format"
    echo ""
    echo "Options:"
    echo "  --simple    Generate simple report (no categorization)"
    echo "  --verbose   Enable verbose output"
    echo "  --dry-run   Show tasks without executing"
    echo ""
    echo "Examples:"
    echo "  $0 2026-02-10"
    echo "  $0 2026-02-10 --simple"
    echo "  $0 2026-02-10 --dry-run --verbose"
    exit 1
fi

DATE="$1"
shift

# 日付形式の検証
if ! [[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "ERROR: Invalid date format. Use YYYY-MM-DD"
    exit 1
fi

# オプションの解析（配列を使用して安全に処理）
OPTIONS=()
while [ $# -gt 0 ]; do
    case "$1" in
        --simple)
            OPTIONS+=("--simple")
            ;;
        --verbose|-v)
            OPTIONS+=("--verbose")
            ;;
        --dry-run)
            OPTIONS+=("--dry-run")
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
    shift
done

echo "=== Daily Reporter Rerun ==="
echo "Target date: $DATE"
echo "Options: ${OPTIONS[*]}"
echo ""

# 依存関係の確認
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
    echo "Installing dependencies..."
    cd "$PROJECT_DIR"
    npm install
fi

# 実行
cd "$PROJECT_DIR"
echo "Executing..."
npx tsx src/index.ts --date "$DATE" "${OPTIONS[@]}"
