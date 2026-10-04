#!/bin/sh
# ===========================================================
# tests/run.sh  ―  自動テストを実行する
# -----------------------------------------------------------
# 使い方: プロジェクトのいちばん上のフォルダで  sh tests/run.sh
#
# しくみ:
#   1. 計算に必要な js ファイルを1つにつなげる（画面を作るファイルは除く）
#   2. テスト用のかんたんな代役（print など）を先頭に足す
#   3. node（Node.js）か jsc（Macに入っているJavaScript実行機）で実行する
#
# 合格なら終了コード 0、不合格なら 1 を返します。
# ===========================================================

cd "$(dirname "$0")/.." || exit 1

BUNDLE="$(mktemp -t mamecho-test.XXXXXX)"

# 1行目: node で動かすときの print の代役（jsc には最初から print がある）
{
  echo "if (typeof print === 'undefined') { var print = function (text) { console.log(text); }; }"
  cat js/01-categories.js js/02-card-companies.js js/03-helpers.js js/04-state-and-storage.js \
      js/05-calculations.js js/06-credit-card-billing.js js/17-csv-and-backup.js \
      js/22-mail-import.js
  cat tests/tests.js
} > "$BUNDLE"

JSC="/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"

if command -v node >/dev/null 2>&1; then
  node "$BUNDLE"
  STATUS=$?
elif [ -x "$JSC" ]; then
  "$JSC" "$BUNDLE"
  STATUS=$?
else
  echo "node も jsc も見つかりません。Node.js をインストールしてください。"
  STATUS=2
fi

rm -f "$BUNDLE"
exit $STATUS
