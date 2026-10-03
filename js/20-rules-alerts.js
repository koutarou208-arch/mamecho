/* ===========================================================
   20-rules-alerts.js  ―  制度変更のお知らせと、不具合の報告
   -----------------------------------------------------------
   カード会社の制度（手数料率など）が変わったときに、画面の上に
   お知らせを出します。お知らせのもとになるのは
   js/02-card-companies.js の RULES_CHANGELOG です。

   お知らせが出る条件:
     ・自分が登録しているカードの会社に関する変更である
     ・変更の開始日が、60日前より新しい（これから変わるものも含む）
     ・まだ「読んだ」にしていない
   さらに、データの最終確認日から45日以上たっていたら
   「データが古いかもしれません」と知らせます。

   「読んだ」の記録は、このブラウザの localStorage に保存します
   （お知らせの表示のためだけで、家計簿のデータとは別です）。
   =========================================================== */

const SEEN_RULES_KEY = 'mamecho-seen-rules';
const ALERT_WINDOW_DAYS = 60;   // 変更の開始日がこの日数より前なら、もう知らせない
const APP_VERSION = '1.2.0';    // アプリの版（機能を足したら上げる）


/* ===========================================================
   1. 「読んだ」の記録
   =========================================================== */

function readSeenRuleIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_RULES_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeSeenRuleIds(ids) {
  try {
    localStorage.setItem(SEEN_RULES_KEY, JSON.stringify(ids.slice(-200)));
  } catch (error) {
    // 保存できない環境では、ページを開くたびにまた表示されるだけ
  }
}


/* ===========================================================
   2. お知らせの一覧を作る
   =========================================================== */

/** 自分が使っているカード会社の id の一覧（口座に登録されたカードから） */
function myCardCompanyIds() {
  const ids = new Set();
  if (appState.profile) {
    for (const account of appState.profile.accounts) {
      if (account.kind === 'card') {
        ids.add(findCardCompany((account.card || {}).company).id);
      }
    }
  }
  return ids;
}

/** 表示するお知らせ（まだ読んでいない、自分に関係する変更） */
function pendingRuleAlerts() {
  const today = todayText();
  const oldest = addDays(today, -ALERT_WINDOW_DAYS);
  const seen = new Set(readSeenRuleIds());
  const mine = myCardCompanyIds();
  return RULES_CHANGELOG.filter((change) =>
    !seen.has(change.id) &&
    change.effective >= oldest &&
    (change.company === 'all' || mine.has(change.company)));
}

/** データが古いかもしれないとき、何日たったかを返す（古くなければ 0） */
function staleDataDays() {
  const days = daysBetween(RULES_META.checkedAt, todayText());
  return days > RULES_META.staleAfterDays ? days : 0;
}

/** 画面の上に出すお知らせのHTML（なければ空の文字） */
function rulesAlertsHtml() {
  const alerts = pendingRuleAlerts();
  const staleDays = staleDataDays();
  if (alerts.length === 0 && staleDays === 0) {
    return '';
  }
  const today = todayText();

  let html = '<div class="banner notice" role="status">';
  html += '<div class="notice-body">';
  for (const change of alerts.slice(0, 3)) {
    const isFuture = change.effective > today;
    const heading = isFuture ? '制度が変わります（' + formatShortDate(change.effective) + 'から）' : '制度が変わりました（' + formatShortDate(change.effective) + 'から適用中）';
    html += '<p><strong>' + escapeHtml(heading) + '</strong><br>' +
      escapeHtml(change.title) + '<br><span class="small muted">' + escapeHtml(change.detail) + '</span> ' +
      '<a href="' + escapeHtml(change.source) + '" target="_blank" rel="noopener noreferrer">出典</a></p>';
  }
  if (alerts.length > 3) {
    html += '<p class="small muted">ほか ' + (alerts.length - 3) + '件は設定の「制度データ」で見られます。</p>';
  }
  if (staleDays > 0) {
    html += '<p><strong>手数料率などのデータが古いかもしれません。</strong><br><span class="small muted">最後に公式ページを確認してから ' + staleDays + '日たっています（' + escapeHtml(RULES_META.checkedAt) + '）。毎月の自動更新が止まっている可能性があります。</span></p>';
  }
  html += '</div>';
  html += '<div class="notice-actions">' +
    '<button type="button" class="btn small" data-action="go" data-screen="cards">カードを見る</button>' +
    (alerts.length > 0 ? '<button type="button" class="btn small ghost" data-action="dismiss-rule-alerts">読んだ</button>' : '') +
    '</div></div>';
  return html;
}

/** 「読んだ」を押したとき */
function dismissRuleAlerts() {
  const seen = new Set(readSeenRuleIds());
  for (const change of pendingRuleAlerts()) {
    seen.add(change.id);
  }
  writeSeenRuleIds([...seen]);
  renderApp();
}


/* ===========================================================
   3. 設定画面の「制度データ」カード
   =========================================================== */

function rulesDataCardHtml() {
  const staleDays = staleDataDays();
  let html = '<section class="card span-12">';
  html += '<div class="card-head"><h2>制度データ</h2><span class="sub">カード会社の締め日・手数料率など</span></div>';
  html += '<div class="stats" style="grid-template-columns:repeat(3, minmax(0,1fr))">' +
    '<div class="stat"><span class="label">データのバージョン</span><span class="value num" style="font-size:18px">' + escapeHtml(RULES_META.dataVersion) + '</span></div>' +
    '<div class="stat"><span class="label">最後に公式ページを確認した日</span><span class="value num" style="font-size:18px">' + escapeHtml(RULES_META.checkedAt) + '</span>' +
    (staleDays > 0 ? '<span class="small">' + statusChipHtml('warn', staleDays + '日たっています') + '</span>' : '') + '</div>' +
    '<div class="stat"><span class="label">アプリの版</span><span class="value num" style="font-size:18px">' + APP_VERSION + '</span></div>' +
    '</div>';
  html += '<p class="hint" style="margin-top:10px">このデータは毎月1回、各社の公式ページを見直して更新されます。更新があると、使っているカードに関係する変更が画面の上にお知らせされます。</p>';

  html += '<details class="more"><summary>制度変更の履歴（' + RULES_CHANGELOG.length + '件）</summary><ul class="plain-list">';
  for (const change of RULES_CHANGELOG) {
    html += '<li><span class="grow"><span style="white-space:normal">' + escapeHtml(change.title) + '</span>' +
      '<span class="small muted" style="white-space:normal">' + escapeHtml(change.effective) + ' から · ' + escapeHtml(change.detail) + '</span></span>' +
      '<a href="' + escapeHtml(change.source) + '" target="_blank" rel="noopener noreferrer" class="small">出典</a></li>';
  }
  html += '</ul></details>';

  html += '<details class="more"><summary>カード会社ごとの確からしさ</summary><ul class="plain-list">';
  for (const company of CARD_COMPANIES) {
    html += '<li><span class="grow"><span>' + escapeHtml(company.name) + '</span><span class="small muted" style="white-space:normal">' +
      escapeHtml(CONFIDENCE_LABELS[company.confidence]) + ' · ' + escapeHtml(company.checkedAt) + ' 確認</span></span>' +
      (company.sources[0] ? '<a href="' + escapeHtml(company.sources[0]) + '" target="_blank" rel="noopener noreferrer" class="small">公式</a>' : '') + '</li>';
  }
  html += '</ul></details>';

  html += '<div class="row-gap" style="margin-top:14px"><button type="button" class="btn small" data-action="copy-report">不具合・数字のちがいを報告する文をコピー</button>' +
    '<span class="hint">個人の金額や名前は入りません。Claude に貼り付けて「ここがおかしい」と伝えてください。</span></div>';
  html += '</section>';
  return html;
}

/** 不具合の報告用の文（個人のデータは入れない） */
function buildDiagnosticsText() {
  const lines = [];
  lines.push('【まめ帳 報告用の情報】');
  lines.push('アプリの版: ' + APP_VERSION);
  lines.push('制度データ: ' + RULES_META.dataVersion + '（確認日 ' + RULES_META.checkedAt + '）');
  lines.push('今の画面: ' + appState.screen);
  lines.push('保存先: ' + appState.storageMode + (lockState.enabled ? '（暗号化あり）' : ''));
  lines.push('サンプル表示: ' + (appState.isSample ? 'はい' : 'いいえ'));
  if (appState.profile) {
    lines.push('口座の数: ' + appState.profile.accounts.length + ' / 入出金の数: ' + allTransactions.length);
    const companies = [...myCardCompanyIds()].join(', ');
    lines.push('登録しているカード会社: ' + (companies || 'なし'));
  }
  lines.push('ブラウザ: ' + navigator.userAgent);
  lines.push('');
  lines.push('【おかしいところ】（ここに書いてください。どの画面で何をしたら、何が表示されたか。金額は入れなくて大丈夫です）');
  return lines.join('\n');
}

async function copyDiagnostics() {
  const text = buildDiagnosticsText();
  try {
    await navigator.clipboard.writeText(text);
    showToast('コピーしました。Claude に貼り付けてください');
  } catch (error) {
    findOne('#textDialogTitle').textContent = '報告用の情報';
    findOne('#textDialogContent').value = text;
    findOne('#textDialog').showModal();
  }
}
