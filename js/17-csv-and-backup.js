/* ===========================================================
   17-csv-and-backup.js  ―  CSVの取り込み・書き出しと、バックアップ
   -----------------------------------------------------------
   CSV（カンマで区切った表のファイル）は、銀行やカード会社のサイトから
   明細としてダウンロードできることが多い形式です。

   取り込みの流れ:
     1. ファイルを選ぶ（文字コード Shift_JIS / UTF-8 は自動で判定）
     2. CSV を表にする（よそで作られた部品 PapaParse を使う。js/vendor）
     3. どの列が「日付」「内容」「金額」かを選ぶ（見出しから自動で推測）
     4. 件数と合計額を明細と見くらべてから取り込む
        ・金額は文字から整数で読む（小数で計算しない）。小数や読めない行は理由つきで飛ばす
        ・同じ口座・同じ日付・同じ金額・同じ摘要の明細が、すでにある数だけ飛ばす（重複）

   マネーフォワード ME の「入出金履歴」CSV は、
   大項目・中項目・保有金融機関まで自動で読み取ります。
   =========================================================== */


/* ===========================================================
   1. ファイルの保存（書き出し）
   =========================================================== */

let downloadsFeature = null; // Claudeの「ファイルを保存する」機能（使えないときは null）

/** アプリ起動時に呼ぶ: ファイル保存の機能が使えるか調べる */
async function connectDownloads() {
  if (window.claude && typeof window.claude.use === 'function') {
    try {
      downloadsFeature = await window.claude.use('downloads');
    } catch (error) {
      downloadsFeature = null;
    }
  }
}

/**
 * ファイルを保存してもらう。
 * 使える方法を順に試し、どれもだめなら内容を画面に表示してコピーしてもらう。
 */
async function offerDownload(filename, text) {
  // (1) Claude のアーティファクトとして開いているとき
  if (downloadsFeature) {
    try {
      await downloadsFeature.save({ filename: filename, data: text });
      showToast('ファイルを保存しました');
      return;
    } catch (error) {
      const code = error && error.code;
      if (code === 'declined') {
        return; // 自分で「保存しない」を選んだ
      }
      if (code === 'rate_limited') {
        showToast('少し待ってから、もう一度お試しください');
        return;
      }
      // それ以外は (3) へ
    }
  }

  // (2) ファイルを直接ブラウザで開いているとき（ふつうのダウンロード）
  if (!window.claude) {
    try {
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    } catch (error) {
      // (3) へ
    }
  }

  // (3) 画面に表示してコピーしてもらう
  findOne('#textDialogTitle').textContent = filename;
  findOne('#textDialogHint').textContent = 'この環境ではファイルを保存できないため、内容を表示しています。コピーしてテキストファイルに貼り付けてください。';
  findOne('#textDialogContent').value = text;
  findOne('#textDialog').showModal();
}

/** 「コピーする」ボタン */
async function copyTextDialogContent() {
  const area = findOne('#textDialogContent');
  try {
    await navigator.clipboard.writeText(area.value);
    showToast('コピーしました');
  } catch (error) {
    area.focus();
    area.select();
    showToast('選択しました。⌘C（Ctrl+C）でコピーしてください');
  }
}


/* ===========================================================
   2. CSVの書き出し
   =========================================================== */

/** CSVの1マス分の文字（カンマや " が入っていたら " でかこむ） */
function csvCell(value) {
  const text = String(value === undefined || value === null ? '' : value);
  if (/[",\r\n]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

/**
 * 文字の列用のCSVの1マス。「=」「+」「-」「@」で始まる文字は、表計算ソフトで開いたときに
 * 式として実行されてしまうことがあるので、先頭に ' を付けてただの文字にする（メールなどから来た文字の対策）。
 */
function csvTextCell(value) {
  let text = String(value === undefined || value === null ? '' : value);
  if (/^[=+\-@\t\r]/.test(text)) {
    text = "'" + text;
  }
  return csvCell(text);
}

/** すべての入出金をCSVにする（マネーフォワード ME に近い列の並び） */
/** 入出金をCSVの書き出しに出す（マネーフォワード ME と同じ形。支出はマイナス、収入はプラス） */
function exportCsv() {
  // 先頭の ﻿ は、Excel で開いたときに文字化けしないための印
  offerDownload('mamecho-' + todayText() + '.csv', '﻿' + transactionsToCsvText(allTransactions));
}

/** 入出金の一覧を、CSVの文字にする（画面にさわらないので、テストできる） */
function transactionsToCsvText(transactions) {
  const lines = [];
  lines.push(['計算対象', '日付', '内容', '金額（円）', '保有金融機関', '大項目', '中項目', 'メモ', '振替', '支払い方法', 'ID'].join(','));
  for (const transaction of transactions) {
    if (transaction.type === 'adjust') {
      continue; // 残高修正は書き出さない（バックアップには入る）
    }
    const category = CATEGORY_BY_ID[transaction.category];
    let signedAmount = transaction.amount;
    if (transaction.type === 'expense' || transaction.type === 'transfer') {
      signedAmount = -transaction.amount;
    }
    let categoryName = category ? category.name : '';
    let subName = transaction.sub || '';
    if (transaction.type === 'income') {
      categoryName = '収入';
      subName = transaction.sub || (category ? category.name : '');
    }
    if (transaction.type === 'transfer') {
      categoryName = '';
      subName = '';
    }
    const row = [
      csvCell(isCounted(transaction) ? 1 : 0),
      csvCell(transaction.date.replace(/-/g, '/')),
      csvTextCell(transaction.description || ''),
      csvCell(signedAmount),
      csvTextCell(accountName(transaction.account)),
      csvTextCell(categoryName),
      csvTextCell(subName),
      csvTextCell(transaction.memo || ''),
      csvCell(transaction.type === 'transfer' ? 1 : 0),
      csvTextCell(transaction.type === 'expense' ? paymentMethodLabel(transaction) : ''),
      csvTextCell(transaction.id),
    ];
    lines.push(row.join(','));
  }
  return lines.join('\r\n');
}


/* ===========================================================
   3. バックアップ（JSON）
   =========================================================== */

/**
 * バックアップに入れる設定（元のデータは変えずに写しを作る）。
 * 以前の版にあった「Gmail から自動で記録」の鍵（合言葉と URL）が残っていても、書き出さない。
 */
function profileForExport(profile) {
  const copy = JSON.parse(JSON.stringify(profile));
  if (copy.settings) {
    delete copy.settings.mailImport;
  }
  return copy;
}

function exportBackup() {
  const backup = {
    app: 'mamecho',
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: profileForExport(appState.profile),
    monthly: appState.monthly,
  };
  offerDownload('mamecho-backup-' + todayText() + '.json', JSON.stringify(backup, null, 1));
}

/** バックアップのデータを、貼り付けやすい1行の文字にする */
function backupToText(backup) {
  return JSON.stringify(backup);
}

/**
 * バックアップの文字を読んで、データにして返す。読めなければ null。
 * 前後の空白・改行や、先頭の目に見えない印（BOM）はむししてよい。
 */
function parseBackupText(text) {
  let source = String(text || '').replace(/^\uFEFF/, '').trim();
  if (source === '') {
    return null;
  }
  let backup = null;
  try {
    backup = JSON.parse(source);
  } catch (error) {
    return null;
  }
  if (!backup || !backup.profile || !Array.isArray(backup.profile.accounts) || !backup.monthly || typeof backup.monthly !== 'object') {
    return null;
  }
  return backup;
}

let pendingRestore = null; // 読み込んだバックアップ（確認待ち）

/** バックアップの文字を読んで、「置きかえますか？」の確認を出す（ファイルでも貼り付けでも共通） */
function askRestoreFromText(text) {
  const backup = parseBackupText(text);
  if (!backup) {
    showToast('「まめ帳」のバックアップとして読めませんでした');
    return;
  }
  pendingRestore = backup;
  let count = 0;
  for (const month of Object.keys(backup.monthly)) {
    count = count + (backup.monthly[month] || []).length;
  }
  findOne('#importTitle').textContent = 'バックアップから戻す';
  findOne('#importBody').innerHTML =
    '<p>このバックアップ（口座 ' + backup.profile.accounts.length + '件・入出金 ' + count + '件' +
    (backup.exportedAt ? '・' + escapeHtml(String(backup.exportedAt).slice(0, 10)) + ' に保存' : '') + '）で、今のデータをすべて置きかえます。</p>' +
    '<div class="confirm-box"><p>今のデータは消えます。元に戻せません。</p><div class="row-gap">' +
    '<button type="button" class="btn danger" data-action="restore-yes">置きかえる</button>' +
    '<button type="button" class="btn ghost" data-action="close-dialog">やめる</button></div></div>';
  findOne('#importDialog').showModal();
}

/** バックアップのファイルが選ばれたとき */
function readBackupFile(file) {
  const reader = new FileReader();
  reader.onload = () => askRestoreFromText(String(reader.result));
  reader.readAsText(file);
}

/** 「文字でコピー」: バックアップを画面に出して、コピーできるようにする（別の端末に貼り付けて使う） */
function showBackupText() {
  const backup = {
    app: 'mamecho',
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: profileForExport(appState.profile),
    monthly: appState.monthly,
  };
  findOne('#textDialogTitle').textContent = 'バックアップの文字';
  findOne('#textDialogHint').textContent = '「コピーする」を押して、別のスマホやアプリ版の「貼り付けて戻す」に貼り付けます。家計簿の中身がそのまま入っているので、人には見せないでください。';
  findOne('#textDialogContent').value = backupToText(backup);
  findOne('#textDialog').showModal();
}

/** 「貼り付けて戻す」: 貼り付ける欄を出す */
function openPasteRestore() {
  findOne('#importTitle').textContent = '貼り付けて戻す';
  findOne('#importBody').innerHTML =
    '<p>コピーしたバックアップの文字を、下の欄に貼り付けてください。</p>' +
    '<textarea id="pasteBackupText" rows="8" placeholder="ここに貼り付け"></textarea>' +
    '<div class="row-gap" style="margin-top:12px"><button type="button" class="btn primary" data-action="paste-restore-read">読み込む</button>' +
    '<button type="button" class="btn ghost" data-action="close-dialog">やめる</button></div>';
  findOne('#importDialog').showModal();
}

function restoreBackupConfirmed() {
  if (!pendingRestore) {
    return;
  }
  replaceAllData(pendingRestore.profile, pendingRestore.monthly);
  pendingRestore = null;
  findOne('#importDialog').close();
  showToast('バックアップから戻しました');
}


/* ===========================================================
   4. CSVの読み取り
   =========================================================== */

/** ファイルの中身（バイト）を文字にする。UTF-8 で読めなければ Shift_JIS で読む */
function decodeCsvBytes(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch (error) {
    try {
      return new TextDecoder('shift_jis').decode(buffer);
    } catch (error2) {
      return new TextDecoder().decode(buffer);
    }
  }
}

/**
 * CSVの文字を、行と列の表（2重の配列）にする。
 * 読み取りは PapaParse（js/vendor）。区切り（カンマ・タブ）の判定、"" で囲んだ中のカンマや改行も任せる。
 * 中身が空の行は飛ばす。
 */
function parseCsv(text) {
  const parsed = Papa.parse(String(text), { skipEmptyLines: 'greedy' });
  const rows = [];
  for (const row of parsed.data) {
    if (row.some((value) => String(value).trim() !== '')) {
      rows.push(row.map((value) => String(value)));
    }
  }
  return rows;
}

/**
 * いろいろな書き方の日付を "2026-09-14" にする。読めなければ null。
 * 対応: 2026/9/14, 2026-09-14, 2026年9月14日, 20260914, R8.9.14, 令和8年9月14日
 */
function parseDateCell(value) {
  const text = String(value || '').normalize('NFKC').trim();
  let match = text.match(/^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})/);
  if (match) {
    return makeDateText(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) {
    return makeDateText(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  match = text.match(/^(R|H|令和|平成)\s*(\d{1,2})[/\-.年](\d{1,2})[/\-.月](\d{1,2})/i);
  if (match) {
    const era = match[1].toUpperCase();
    const baseYear = era === 'R' || era === '令和' ? 2018 : 1988;
    return makeDateText(baseYear + Number(match[2]), Number(match[3]), Number(match[4]));
  }
  return null;
}

function makeDateText(year, month, day) {
  const text = year + '-' + pad2(month) + '-' + pad2(day);
  return isValidDateText(text) ? text : null;
}

/**
 * 金額のマスが読めないときの理由を返す（読めるなら空文字）。
 * 小数で計算しないように、金額は「数字の並び」として調べる。
 */
function amountCellProblem(value) {
  const text = String(value || '').normalize('NFKC').trim();
  if (text === '') {
    return '金額が空';
  }
  // マイナスの印・カッコ・円記号・カンマ・空白をとった残り
  const body = text.replace(/[△▲\-−+()¥\\円,\s]/g, '');
  if (/^\d+\.\d+$/.test(body)) {
    return /^\d+\.0+$/.test(body) ? '' : '小数の金額'; // 1200.00 は 1200 として読む
  }
  if (!/^\d+$/.test(body)) {
    return '金額が読めない';
  }
  if (body.length > 15) {
    return '金額が大きすぎる';
  }
  return '';
}

/**
 * いろいろな書き方の金額を、整数（円）にする。読めなければ null。
 * 「△1,200」「▲1,200」「(1,200)」「-1,200」「1,200-」はマイナスとして読む（会計の書き方）。
 * 小数の金額（1234.5 など）は、勝手に丸めずに null にする（理由は amountCellProblem）。
 */
function parseAmountCell(value) {
  if (amountCellProblem(value) !== '') {
    return null;
  }
  const text = String(value).normalize('NFKC').trim();
  const isNegative = /^[△▲\-−]/.test(text) || /^\(.*\)$/.test(text) || /[\-−]$/.test(text);
  const digits = text.replace(/[^\d.]/g, '').split('.')[0]; // 「.00」のうしろは捨てる
  const number = Number(digits); // 数字だけの文字なので、ぴったり整数になる
  return isNegative ? -number : number;
}


/* ===========================================================
   5. 取り込みダイアログ
   =========================================================== */

const importState = {
  step: 'choose',     // 'choose'（ファイル選び）か 'map'（列の対応づけ）
  fileName: '',
  lineOffset: 0,      // 見出しの前にあって読み飛ばした説明の行の数
  rows: [],           // CSVの表（説明の行を除いたもの）
  hasHeader: true,    // 1行目が見出しか
  amountMode: 'signed', // 'signed'（金額が1列）か 'split'（出金と入金が別の列）
  invert: false,      // プラスの金額を支出として扱うか（カード明細）
  accountId: '',      // 取り込み先の口座
  columns: { date: -1, description: -1, amount: -1, out: -1, in: -1, category: -1, sub: -1, memo: -1, account: -1, transfer: -1, include: -1 },
};

/** 見出しの名前から列の意味を推測するためのパターン */
const HEADER_PATTERNS = {
  date: /日付|取引日|利用日|年月日|お取引日|DATE/i,
  description: /内容|摘要|取引内容|利用店|ご利用先|店名|加盟店|明細|DESCRIPTION/i,
  amount: /金額|AMOUNT/i,
  out: /出金|引出|お支払|支払金額/,
  in: /入金|預入|お預り|預り金額/,
  sub: /中項目|サブカテゴリ/,
  category: /大項目|カテゴリ/,
  memo: /メモ|備考/,
  account: /保有金融機関|金融機関|口座/,
  transfer: /^振替$/,
  include: /計算対象/,
};

function openImportDialog() {
  importState.step = 'choose';
  findOne('#importTitle').textContent = 'CSVを取り込む';
  renderImport();
  findOne('#importDialog').showModal();
}

/** ダイアログの中身を作る */
function renderImport() {
  const body = findOne('#importBody');
  if (importState.step === 'choose') {
    body.innerHTML =
      '<p>銀行やカード会社のサイトからダウンロードした明細のCSVファイルを選んでください。</p>' +
      '<label class="field"><span>CSVファイル</span><input type="file" id="importFile" accept=".csv,.txt,text/csv"></label>' +
      '<p class="hint">文字コード（Shift_JIS / UTF-8）は自動で判定します。マネーフォワード ME の「入出金履歴」CSVは、カテゴリや金融機関まで自動で読み取ります。</p>';
    findOne('#importFile').addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (file) {
        readImportFile(file);
      }
    });
    return;
  }

  // --- 列の対応づけ ---
  const headerRow = importState.rows[0] || [];
  function columnOptions(selectedIndex, allowNone) {
    let html = allowNone ? '<option value="-1">使わない</option>' : '';
    for (let index = 0; index < headerRow.length; index++) {
      const label = importState.hasHeader ? headerRow[index] : (index + 1) + '列目（例: ' + headerRow[index] + '）';
      html += '<option value="' + index + '"' + (index === selectedIndex ? ' selected' : '') + '>' + escapeHtml(String(label).slice(0, 30)) + '</option>';
    }
    return html;
  }
  const columns = importState.columns;

  let accountOptions = '';
  for (const account of appState.profile.accounts) {
    accountOptions += '<option value="' + escapeHtml(account.id) + '"' + (account.id === importState.accountId ? ' selected' : '') + '>' + escapeHtml(account.name) + '</option>';
  }

  let html = '<p class="small muted">' + escapeHtml(importState.fileName) + ' · ' + importState.rows.length + '行' +
    (importState.lineOffset > 0 ? ' · 先頭の説明の' + importState.lineOffset + '行は読み飛ばしました' : '') + '</p>';
  html += '<label class="check"><input type="checkbox" id="importHasHeader"' + (importState.hasHeader ? ' checked' : '') + '><span>1行目は見出し（列の名前）</span></label>';
  html += '<div class="field-row">' +
    '<label class="field"><span>日付の列</span><select data-import-column="date">' + columnOptions(columns.date, false) + '</select></label>' +
    '<label class="field"><span>内容の列</span><select data-import-column="description">' + columnOptions(columns.description, true) + '</select></label></div>';

  html += '<div class="seg" role="radiogroup" aria-label="金額の形">' +
    '<input type="radio" name="importAmountMode" id="amountSigned" value="signed"' + (importState.amountMode === 'signed' ? ' checked' : '') + '><label for="amountSigned">金額が1つの列</label>' +
    '<input type="radio" name="importAmountMode" id="amountSplit" value="split"' + (importState.amountMode === 'split' ? ' checked' : '') + '><label for="amountSplit">出金と入金が別の列</label></div>';
  if (importState.amountMode === 'signed') {
    html += '<div class="field-row"><label class="field"><span>金額の列</span><select data-import-column="amount">' + columnOptions(columns.amount, false) + '</select></label>' +
      '<label class="check" style="align-self:end"><input type="checkbox" id="importInvert"' + (importState.invert ? ' checked' : '') + '><span>プラスの金額を「支出」として読む（カードの明細など）</span></label></div>';
  } else {
    html += '<div class="field-row"><label class="field"><span>出金（支払い）の列</span><select data-import-column="out">' + columnOptions(columns.out, false) + '</select></label>' +
      '<label class="field"><span>入金（預け入れ）の列</span><select data-import-column="in">' + columnOptions(columns.in, false) + '</select></label></div>';
  }

  html += '<div class="field-row"><label class="field"><span>取り込み先の口座</span><select id="importAccount">' + accountOptions + '</select></label>' +
    '<label class="field"><span>大項目の列（あれば）</span><select data-import-column="category">' + columnOptions(columns.category, true) + '</select></label></div>';
  html += '<details class="more"><summary>そのほかの列（中項目・メモ・口座名など）</summary><div class="sheet-body" style="padding:12px 0 0">' +
    '<div class="field-row"><label class="field"><span>中項目の列</span><select data-import-column="sub">' + columnOptions(columns.sub, true) + '</select></label>' +
    '<label class="field"><span>メモの列</span><select data-import-column="memo">' + columnOptions(columns.memo, true) + '</select></label></div>' +
    '<div class="field-row"><label class="field"><span>口座名の列（名前が合えばその口座に入れる）</span><select data-import-column="account">' + columnOptions(columns.account, true) + '</select></label>' +
    '<label class="field"><span>振替の印の列（1なら飛ばす）</span><select data-import-column="transfer">' + columnOptions(columns.transfer, true) + '</select></label></div>' +
    '</div></details>';

  // --- プレビュー ---
  const result = convertImportRows();
  const totals = result.totals;
  // このファイルの明細の合計（明細書・ご利用明細の合計と、1円まで見くらべられるように）
  html += '<div class="import-summary">' +
    '<p class="small muted">このファイルの明細（明細書の合計と見くらべてください）</p>' +
    '<div class="import-totals">' +
    '<div><span class="small muted">支出 ' + totals.expenseCount + '件</span><strong class="num">' + formatYen(totals.expense) + '</strong></div>' +
    '<div><span class="small muted">収入・返金 ' + totals.incomeCount + '件</span><strong class="num">' + formatYen(totals.income) + '</strong></div>' +
    '<div><span class="small muted">差し引き（支出−収入）</span><strong class="num">' + formatYen(totals.expense - totals.income) + '</strong></div>' +
    '</div>' +
    importTotalCheckHtml(statementTotalCheck(result)) +
    '<p class="small"><strong>' + result.ready.length + '件</strong>を取り込みます' +
    (result.duplicates ? ' · すでにある ' + result.duplicates + '件は飛ばします（重複）' : '') +
    (result.transfers ? ' · 振替 ' + result.transfers + '件は飛ばします' : '') + '</p>';
  if (result.skipped.length > 0) {
    html += '<details class="more"><summary>読めずに飛ばした行 ' + result.skipped.length + '件（合計に入っていません）</summary><ul class="plain-list">';
    for (const skipped of result.skipped.slice(0, 50)) {
      html += '<li><span class="grow"><span>' + skipped.line + '行目: ' + escapeHtml(skipped.reason) + '</span>' +
        '<span class="small muted">' + escapeHtml(skipped.text) + '</span></span></li>';
    }
    html += '</ul></details>';
  }
  html += '</div>';
  html += '<div class="preview-table"><table class="data"><thead><tr><th>日付</th><th>内容</th><th>金額</th><th>分類</th></tr></thead><tbody>';
  for (const transaction of result.ready.slice(0, 8)) {
    const category = CATEGORY_BY_ID[transaction.category];
    html += '<tr><td>' + transaction.date + '</td><td style="text-align:left; max-width:14em; overflow:hidden; text-overflow:ellipsis">' + escapeHtml(transaction.description) + '</td>' +
      '<td class="num">' + (transaction.type === 'expense' ? formatYen(-transaction.amount) : formatYen(transaction.amount, { showPlus: true })) + '</td>' +
      '<td style="text-align:left">' + escapeHtml((category ? category.name : '') + ' / ' + (transaction.sub || '')) + '</td></tr>';
  }
  html += '</tbody></table></div>';
  html += '<div class="row-gap" style="justify-content:flex-end">' +
    '<button type="button" class="btn ghost" data-action="import-back">ファイルを選び直す</button>' +
    '<button type="button" class="btn primary" data-action="import-run"' + (result.ready.length === 0 ? ' disabled' : '') + '>' + result.ready.length + '件を取り込む</button></div>';

  body.innerHTML = html;

  // 選び直したら、状態を書きかえて描き直す
  for (const select of findAll('[data-import-column]', body)) {
    select.addEventListener('change', () => {
      importState.columns[select.dataset.importColumn] = Number(select.value);
      renderImport();
    });
  }
  findOne('#importHasHeader').addEventListener('change', (event) => {
    importState.hasHeader = event.target.checked;
    renderImport();
  });
  for (const radio of findAll('input[name="importAmountMode"]', body)) {
    radio.addEventListener('change', () => {
      importState.amountMode = radio.value;
      renderImport();
    });
  }
  const invertBox = findOne('#importInvert');
  if (invertBox) {
    invertBox.addEventListener('change', (event) => {
      importState.invert = event.target.checked;
      renderImport();
    });
  }
  findOne('#importAccount').addEventListener('change', (event) => {
    importState.accountId = event.target.value;
    renderImport();
  });
}

/**
 * 見出しの行を探す。銀行やカードの CSV には、見出しの前に「○○カード ご利用明細」
 * 「お名前」などの説明の行があることが多いので、それを読み飛ばすため。
 * 返す値: { index: 見出しの行の番号（なければ -1）, dataStart: 明細が始まる行の番号 }
 */
function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 15);
  // 「日付」と「金額（出金・入金）」の名前が両方ある行を、見出しとみなす
  for (let index = 0; index < limit; index++) {
    const cells = rows[index].map((cell) => String(cell).trim());
    const hasDateName = cells.some((cell) => HEADER_PATTERNS.date.test(cell) && parseDateCell(cell) === null);
    const hasMoneyName = cells.some((cell) => HEADER_PATTERNS.amount.test(cell) || HEADER_PATTERNS.out.test(cell) || HEADER_PATTERNS.in.test(cell));
    if (hasDateName && hasMoneyName) {
      return { index: index, dataStart: index + 1 };
    }
  }
  // 見出しがなければ、日付が入っている最初の行から明細とみなす
  for (let index = 0; index < limit; index++) {
    if (rows[index].some((cell) => parseDateCell(cell) !== null)) {
      return { index: -1, dataStart: index };
    }
  }
  return { index: -1, dataStart: 0 };
}

/**
 * カードの明細か（金額のプラスが「支払い」の意味）を見分ける。
 * マネーフォワード ME の形（大項目・保有金融機関の列がある）は、支出がマイナスなのでカードではない。
 * 見出しにカードらしい名前（利用金額・利用店・支払区分など）があればカード。
 * なければ、金額のほとんど（9割より多く）がプラスならカード（返品の分だけマイナスになる）。
 */
function looksLikeCardStatement(headerRow, amounts) {
  // マネーフォワード ME（とこのアプリの書き出し）の形は、支出が最初からマイナスなので、ひっくり返さない
  const names = headerRow.map((cell) => String(cell).trim());
  if (names.includes('大項目') && (names.includes('保有金融機関') || names.includes('計算対象'))) {
    return false;
  }
  const cardWords = /利用金額|ご利用金額|利用店|ご利用先|加盟店|支払区分|お支払い区分|ご利用者/;
  if (headerRow.some((cell) => cardWords.test(String(cell)))) {
    return true;
  }
  if (amounts.length === 0) {
    return false;
  }
  const positives = amounts.filter((value) => value > 0).length;
  return positives / amounts.length > 0.9;
}

/**
 * ファイルの「合計」の行と、計算した合計を見くらべる（明細と1円まで合っているかの確認）。
 * 返す値: { status: 'match'（一致）/ 'mismatch'（ちがう）/ 'none'（合計の行がない）, fileTotal, computed, difference }
 */
function statementTotalCheck(result) {
  if (result.totalRows.length === 0) {
    return { status: 'none', fileTotal: 0, computed: 0, difference: 0 };
  }
  const fileTotal = result.totalRows[result.totalRows.length - 1].amount;
  const net = Math.abs(result.totals.expense - result.totals.income);
  // 合計の行は「差し引き」のことも、「支出だけ（返品を引かない）」のこともある
  if (fileTotal === net || fileTotal === result.totals.expense || fileTotal === result.totals.income) {
    return { status: 'match', fileTotal: fileTotal, computed: fileTotal, difference: 0 };
  }
  return { status: 'mismatch', fileTotal: fileTotal, computed: net, difference: Math.abs(fileTotal - net) };
}

/** 合計の行との照合の結果を、1行で出す */
function importTotalCheckHtml(check) {
  if (check.status === 'match') {
    return '<p>' + statusChipHtml('good', 'ファイルの合計行（' + formatYen(check.fileTotal) + '）と1円まで一致') + '</p>';
  }
  if (check.status === 'mismatch') {
    return '<p>' + statusChipHtml('over', '合計行は ' + formatYen(check.fileTotal) + '、計算は ' + formatYen(check.computed) + '（差 ' + formatYen(check.difference) + '）') + '</p>' +
      '<p class="hint">飛ばした行と、「プラスの金額を支出として読む」の設定を確かめてください。</p>';
  }
  return '';
}

/** ファイルを読んで、列の意味を推測する */
function readImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const text = decodeCsvBytes(reader.result);
    const allRows = parseCsv(text);
    if (allRows.length === 0) {
      showToast('このファイルには読める行がありませんでした');
      return;
    }
    // 見出しの前の説明の行は読み飛ばす（何行飛ばしたかは、行番号のずれとして覚えておく）
    const header = findHeaderRow(allRows);
    const firstRow = header.index >= 0 ? header.index : header.dataStart;
    importState.fileName = file.name;
    importState.lineOffset = firstRow;
    importState.rows = allRows.slice(firstRow);
    guessImportColumns();
    importState.step = 'map';
    renderImport();
  };
  reader.readAsArrayBuffer(file);
}

/** 見出しや中身から、どの列が何かを推測する */
function guessImportColumns() {
  const rows = importState.rows;
  const first = rows[0];
  const columns = { date: -1, description: -1, amount: -1, out: -1, in: -1, category: -1, sub: -1, memo: -1, account: -1, transfer: -1, include: -1 };

  // 1行目に日付が1つもなければ、見出しの行とみなす
  importState.hasHeader = !first.some((cell) => parseDateCell(cell) !== null);

  if (importState.hasHeader) {
    const used = new Set();
    const order = ['date', 'out', 'in', 'sub', 'category', 'transfer', 'include', 'memo', 'account', 'description', 'amount'];
    for (const key of order) {
      for (let index = 0; index < first.length; index++) {
        if (used.has(index)) {
          continue;
        }
        if (HEADER_PATTERNS[key].test(String(first[index]).trim())) {
          columns[key] = index;
          used.add(index);
          break;
        }
      }
    }
  }

  // 見出しで見つからなかったら、中身から推測する
  const sample = rows.slice(importState.hasHeader ? 1 : 0, 30);
  if (columns.date === -1) {
    for (let index = 0; index < first.length; index++) {
      if (sample.filter((row) => parseDateCell(row[index]) !== null).length > sample.length / 2) {
        columns.date = index;
        break;
      }
    }
  }
  if (columns.amount === -1 && (columns.out === -1 || columns.in === -1)) {
    for (let index = first.length - 1; index >= 0; index--) {
      if (index === columns.date) {
        continue;
      }
      if (sample.filter((row) => parseAmountCell(row[index]) !== null).length > sample.length / 2) {
        columns.amount = index;
        break;
      }
    }
  }
  if (columns.description === -1) {
    for (let index = 0; index < first.length; index++) {
      if (index !== columns.date && index !== columns.amount && sample.some((row) => parseAmountCell(row[index]) === null && String(row[index] || '').trim() !== '')) {
        columns.description = index;
        break;
      }
    }
  }
  if (columns.date === -1) {
    columns.date = 0;
  }

  importState.columns = columns;
  importState.amountMode = columns.out !== -1 && columns.in !== -1 ? 'split' : 'signed';
  if (importState.amountMode === 'signed' && columns.amount === -1) {
    columns.amount = Math.min(first.length - 1, 1);
  }

  // カードの明細（プラス＝支払い）なら、プラスを支出として読む
  importState.invert = false;
  if (importState.amountMode === 'signed') {
    const amounts = sample.map((row) => parseAmountCell(row[columns.amount])).filter((value) => value !== null);
    importState.invert = looksLikeCardStatement(importState.hasHeader ? first : [], amounts);
  }

  // 取り込み先の口座の初期値:
  //   カードの明細らしい → 最初のカード / 銀行の明細らしい（出金・入金が別） → 最初の銀行口座 / それ以外 → 前回使った口座
  importState.accountId = lastUsedAccountId();
  const cards = cardAccounts();
  const banks = appState.profile.accounts.filter((account) => account.kind === 'bank');
  if (importState.invert && cards.length > 0) {
    importState.accountId = cards[0].id;
  } else if (importState.amountMode === 'split' && banks.length > 0) {
    importState.accountId = banks[0].id;
  }
}

/** 大項目・中項目の名前から、このアプリのカテゴリを探す（マネーフォワード ME の名前に対応） */
function categoryFromNames(mainName, subName, type) {
  const main = normalizeText(mainName);
  const sub = normalizeText(subName);
  if (main === '' || main === '未分類') {
    return null;
  }
  if (type === 'income') {
    const incomeMap = [['賞与', 'salary', '賞与'], ['給与', 'salary', '給与'], ['事業', 'business', '事業収入'], ['副業', 'business', '副業'], ['年金', 'pension', '年金'], ['配当', 'dividend', '配当'], ['利息', 'dividend', '利息'], ['一時', 'extra', '臨時収入']];
    for (const pair of incomeMap) {
      if (sub.includes(pair[0]) || main.includes(pair[0])) {
        return { category: pair[1], sub: pair[2] };
      }
    }
  }
  for (const category of getCategoriesForType(type)) {
    if (normalizeText(category.name) === main) {
      let matchedSub = category.subs[0];
      for (const candidate of category.subs) {
        if (normalizeText(candidate) === sub) {
          matchedSub = candidate;
        }
      }
      if (sub !== '' && matchedSub === category.subs[0] && normalizeText(category.subs[0]) !== sub) {
        matchedSub = String(subName).trim(); // 知らない中項目はそのまま残す
      }
      return { category: category.id, sub: matchedSub };
    }
  }
  return null;
}

/**
 * 同じ明細かどうかを見分けるための「指紋」: 日付・金額（収入か支出か）・口座・摘要。
 * 摘要は全角半角・大文字小文字・前後の空白のちがいをそろえて比べる。
 */
function duplicateKey(transaction) {
  return [transaction.date, transaction.type, transaction.amount, transaction.account, normalizeText(transaction.description)].join('|');
}

/** 今の画面の設定で、CSVの行を入出金に変換する（中身は convertCsvRows） */
function convertImportRows() {
  return convertCsvRows(importState.rows, importState, allTransactions, appState.profile.accounts);
}

/**
 * CSVの表を入出金に変換する（画面にさわらないので、テストできる）。
 *   rows     … parseCsv の結果
 *   settings … { hasHeader, columns: { date, description, amount, out, in, ... の列番号 }, amountMode, invert, accountId }
 *   existingTransactions … すでにある入出金（重複を見つけるため）
 *   accounts … 口座の一覧（口座名の列があるときに使う。なくてよい）
 * 返す形: {
 *   totalRows  … ファイルにある「合計」の行 [{ line, amount }]（照合用）
 *   ready      … 取り込む入出金
 *   duplicates … すでにあるので飛ばした件数
 *   transfers  … 振替の印があって飛ばした件数
 *   skipped    … 読めずに飛ばした行 [{ line: 何行目, reason: 理由, text: 行の中身 }]
 *   totals     … このファイルの明細の合計（重複もふくむ。明細と見くらべる用）
 *                { expense, expenseCount, income, incomeCount }（すべて整数の円）
 * }
 */
function convertCsvRows(rows, settings, existingTransactions, accounts) {
  const columns = settings.columns;
  const accountList = accounts || [];
  const result = { ready: [], duplicates: 0, transfers: 0, skipped: [], totalRows: [], totals: { expense: 0, expenseCount: 0, income: 0, incomeCount: 0 } };
  const lineOffset = settings.lineOffset || 0; // 読み飛ばした説明の行の数

  // すでにある明細の「指紋」ごとの件数（同じ明細が2件あれば2）
  const existingCounts = new Map();
  for (const transaction of existingTransactions) {
    const key = duplicateKey(transaction);
    existingCounts.set(key, (existingCounts.get(key) || 0) + 1);
  }

  function cellOf(row, key) {
    const index = columns[key];
    return index >= 0 ? String(row[index] === undefined ? '' : row[index]).trim() : '';
  }
  function skip(line, reason, row) {
    result.skipped.push({ line: line, reason: reason, text: row.join(' / ').slice(0, 80) });
  }

  for (let rowIndex = settings.hasHeader ? 1 : 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const line = lineOffset + rowIndex + 1; // ファイルの何行目か（空の行は数えない）
    const date = parseDateCell(cellOf(row, 'date'));
    if (!date) {
      // 「ご利用合計」などの合計の行は、明細に入れずに、照合のために金額を覚えておく
      const rowText = normalizeText(row.join(' '));
      const totalText = settings.amountMode === 'split' ? (cellOf(row, 'out') || cellOf(row, 'in')) : cellOf(row, 'amount');
      const totalAmount = parseAmountCell(totalText);
      if (rowText.includes('合計') && totalAmount !== null) {
        result.totalRows.push({ line: line, amount: Math.abs(totalAmount) });
        skip(line, '合計の行（明細には入れない）', row);
        continue;
      }
      skip(line, '日付が読めない', row);
      continue;
    }

    // 金額（プラス＝収入、マイナス＝支出 にそろえる）
    let signed = 0;
    if (settings.amountMode === 'split') {
      const outText = cellOf(row, 'out');
      const inText = cellOf(row, 'in');
      const problem = (outText === '' ? '' : amountCellProblem(outText)) || (inText === '' ? '' : amountCellProblem(inText));
      if (problem) {
        skip(line, problem, row);
        continue;
      }
      const outAmount = outText === '' ? 0 : Math.abs(parseAmountCell(outText));
      const inAmount = inText === '' ? 0 : parseAmountCell(inText);
      signed = inAmount - outAmount;
    } else {
      const amountText = cellOf(row, 'amount');
      const problem = amountCellProblem(amountText);
      if (problem) {
        skip(line, problem, row);
        continue;
      }
      signed = parseAmountCell(amountText);
      if (settings.invert) {
        signed = -signed;
      }
    }
    if (signed === 0) {
      skip(line, '金額が0円', row);
      continue;
    }
    if (cellOf(row, 'transfer') === '1') {
      result.transfers = result.transfers + 1;
      continue;
    }

    const type = signed < 0 ? 'expense' : 'income';
    const amount = Math.abs(signed);
    const description = cellOf(row, 'description');

    // 口座: 口座名の列があって名前が合えばその口座、なければ選んだ口座
    let accountId = settings.accountId;
    const accountText = normalizeText(cellOf(row, 'account'));
    if (accountText) {
      for (const account of accountList) {
        const name = normalizeText(account.name);
        if (name === accountText || accountText.includes(name) || name.includes(accountText)) {
          accountId = account.id;
        }
      }
    }

    // カテゴリ: CSVの大項目 → 自動分類ルール → 未分類
    let found = categoryFromNames(cellOf(row, 'category'), cellOf(row, 'sub'), type);
    if (!found) {
      found = findAutoCategory(description, type);
    }
    if (!found) {
      found = type === 'income' ? { category: 'otherIn', sub: '未分類' } : { category: 'other', sub: '未分類' };
    }

    const transaction = {
      id: makeId(),
      date: date,
      type: type,
      amount: amount,
      account: accountId,
      category: found.category,
      sub: found.sub,
      description: description,
      memo: cellOf(row, 'memo'),
      include: cellOf(row, 'include') !== '0',
      createdAt: Date.now() + rowIndex,
    };

    // 明細の合計（重複もふくめて、このファイルにある分すべて）
    if (type === 'expense') {
      result.totals.expense = result.totals.expense + amount;
      result.totals.expenseCount = result.totals.expenseCount + 1;
    } else {
      result.totals.income = result.totals.income + amount;
      result.totals.incomeCount = result.totals.incomeCount + 1;
    }

    // 重複: 同じ指紋の明細が、すでにある数だけ飛ばす
    const key = duplicateKey(transaction);
    const remaining = existingCounts.get(key) || 0;
    if (remaining > 0) {
      existingCounts.set(key, remaining - 1);
      result.duplicates = result.duplicates + 1;
      continue;
    }
    result.ready.push(transaction);
  }
  return result;
}

/**
 * 向きが逆になって入ってしまった明細を探す（前の版で、収入を支出として取り込んだものなど）。
 * 同じ口座・日付・金額・摘要で、収入と支出が1件ずつあれば、あとから入った方を「消す候補」にする。
 * 返す値: [{ original: 先にあった明細, copy: あとから入った逆向きの明細 }]
 */
function findFlippedCopies(transactions) {
  const groups = new Map();
  for (const transaction of transactions) {
    if (transaction.type !== 'income' && transaction.type !== 'expense') {
      continue;
    }
    const key = [transaction.date, transaction.amount, transaction.account, normalizeText(transaction.description)].join('|');
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(transaction);
  }
  const pairs = [];
  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    const sorted = [...group].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const waiting = []; // まだ相手が見つかっていない、先に入った明細
    for (const transaction of sorted) {
      const partnerIndex = waiting.findIndex((older) => older.type !== transaction.type);
      if (partnerIndex >= 0) {
        pairs.push({ original: waiting[partnerIndex], copy: transaction });
        waiting.splice(partnerIndex, 1);
      } else {
        waiting.push(transaction);
      }
    }
  }
  return pairs;
}

/** 前回の取り込みで入った明細（まだ残っているもの） */
function lastImportedTransactions() {
  const lastImport = appState.profile ? appState.profile.settings.lastImport : null;
  if (!lastImport) {
    return [];
  }
  return allTransactions.filter((transaction) => transaction.importId === lastImport.id);
}

/** 「前回の取り込みを取り消す」: 前回の取り込みで入った明細を消す */
function undoLastImport() {
  const lastImport = appState.profile.settings.lastImport;
  if (!lastImport) {
    return;
  }
  const changedMonths = deleteTransactionsWhere((transaction) => transaction.importId === lastImport.id);
  delete appState.profile.settings.lastImport;
  afterDataChange(changedMonths, true); // 消した月と、設定（前回の取り込み）を保存する
  showToast('前回の取り込みを取り消しました');
}

/** 「向きが逆の重複」を消す（あとから入った方だけ） */
function deleteFlippedCopies() {
  const copyIds = new Set(findFlippedCopies(allTransactions).map((pair) => pair.copy.id));
  const changedMonths = deleteTransactionsWhere((transaction) => copyIds.has(transaction.id));
  afterDataChange(changedMonths, false); // 消した月を保存する
  showToast(copyIds.size + '件を削除しました');
}

/** 「○件を取り込む」を押したとき */
function runImport() {
  const result = convertImportRows();
  if (result.ready.length === 0) {
    return;
  }
  // 取り込みの印（どの取り込みで入ったか）をつけて、あとで「取り消す」ができるようにする
  const importId = 'imp-' + makeId();
  for (const transaction of result.ready) {
    transaction.importId = importId;
  }
  appState.profile.settings.lastImport = { id: importId, count: result.ready.length, fileName: importState.fileName, at: todayText() };
  putManyTransactions(result.ready);
  saveProfile();
  findOne('#importDialog').close();
  showToast(result.ready.length + '件を取り込みました' + (appState.isSample ? '（サンプル表示中のため保存はされません）' : ''));
}
