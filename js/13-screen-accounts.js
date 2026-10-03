/* ===========================================================
   13-screen-accounts.js  ―  口座画面
   -----------------------------------------------------------
   財布・銀行・電子マネー・証券・ポイント・カードなど、
   お金の置き場所（口座）ごとの残高を一覧にします。
   口座を押すと、通帳のような明細（16-dialog-account.js）が開きます。
   =========================================================== */

const AccountsScreen = {
  title: '口座',
  usesPeriod: false,

  html() {
    const breakdown = assetBreakdownOn('9999-12-31');
    const period = periodOf(todayText());
    const range = periodRange(period);

    let html = '<div class="grid">';

    // --- まとめ ---
    html += '<section class="card span-12">';
    html += '<div class="card-head"><h2>すべての口座</h2><span class="sub">今の残高（予定として入れた先の日付の記録もふくむ）</span>' +
      '<button type="button" class="btn small primary" style="margin-left:auto" data-action="add-account" data-icon="plus">口座を追加</button></div>';
    html += '<div class="stats">' +
      '<div class="stat"><span class="label">資産</span><span class="value num">' + formatYen(breakdown.assets) + '</span></div>' +
      '<div class="stat"><span class="label">負債</span><span class="value num">' + formatYen(breakdown.debts) + '</span></div>' +
      '<div class="stat"><span class="label">純資産</span><span class="value num total">' + formatYen(breakdown.net) + '</span></div>' +
      '</div></section>';

    // --- 種類ごと ---
    for (const kindId of ACCOUNT_KIND_ORDER) {
      const accounts = appState.profile.accounts.filter((account) => account.kind === kindId);
      if (accounts.length === 0) {
        continue;
      }
      let subtotal = 0;
      for (const account of accounts) {
        subtotal = subtotal + currentBalance(account);
      }
      html += '<section class="card span-6">';
      html += '<div class="card-head"><h2>' + ACCOUNT_KINDS[kindId].label + '</h2><span class="sub num">合計 ' + formatYen(subtotal) + '</span></div>';
      for (const account of accounts) {
        html += accountRowHtml(account, range);
      }
      html += '</section>';
    }

    html += '</div>';
    return html;
  },

  afterRender() {
    fillIcons(findOne('#screen'));
  },
};


/** 口座1行分 */
function accountRowHtml(account, range) {
  const balance = currentBalance(account);

  // 今月の増減
  let change = 0;
  for (const transaction of allTransactions) {
    if (transaction.date >= range.start && transaction.date < range.end) {
      change = change + transactionEffect(transaction, account.id);
    }
  }

  let meta = '今月 ' + formatYen(change, { showPlus: true });
  if (account.kind === 'card') {
    const summary = cardSummary(account);
    if (summary.nextBill) {
      meta = '次の引き落とし ' + formatShortDate(summary.nextBill.payDate) + ' ' + formatYen(summary.nextBill.total);
    } else {
      meta = '引き落とし予定なし';
    }
  }

  return '<button type="button" class="account-row" data-action="open-passbook" data-id="' + escapeHtml(account.id) + '">' +
    '<span style="display:grid; min-width:0"><span class="name">' + escapeHtml(account.name) + '</span><span class="meta">' + escapeHtml(meta) + '</span></span>' +
    '<span class="balance num">' + formatYen(balance) + '</span>' +
    '</button>';
}
