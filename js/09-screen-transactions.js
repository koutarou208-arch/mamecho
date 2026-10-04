/* ===========================================================
   09-screen-transactions.js  ―  入出金の一覧画面
   -----------------------------------------------------------
   期間内の入出金を、日付ごとにまとめて表示します。
   口座・カテゴリ・種類・言葉で絞り込めます。
   1行を押すと、編集画面（15-dialog-transaction.js）が開きます。

   このファイルには、ほかの画面でも使う
   「入出金1行のHTMLを作る関数」transactionRowHtml も入っています。
   =========================================================== */

const TransactionsScreen = {
  title: '入出金',
  usesPeriod: true,

  html() {
    const filters = appState.filters;
    let html = '<section class="card">';

    // --- 絞り込みの部品 ---
    html += '<div class="filters">';
    html += '<select id="filterAccount" aria-label="口座で絞り込む"><option value="">すべての口座</option>';
    for (const account of appState.profile.accounts) {
      const selected = filters.account === account.id ? ' selected' : '';
      html += '<option value="' + escapeHtml(account.id) + '"' + selected + '>' + escapeHtml(account.name) + '</option>';
    }
    html += '</select>';

    html += '<select id="filterCategory" aria-label="カテゴリで絞り込む"><option value="">すべてのカテゴリ</option>';
    html += '<optgroup label="支出">';
    for (const category of EXPENSE_CATEGORIES) {
      const selected = filters.category === category.id ? ' selected' : '';
      html += '<option value="' + category.id + '"' + selected + '>' + category.name + '</option>';
    }
    html += '</optgroup><optgroup label="収入">';
    for (const category of INCOME_CATEGORIES) {
      const selected = filters.category === category.id ? ' selected' : '';
      html += '<option value="' + category.id + '"' + selected + '>' + category.name + '</option>';
    }
    html += '</optgroup></select>';

    html += '<div class="seg" role="group" aria-label="種類で絞り込む">';
    const typeButtons = [['', 'すべて'], ['expense', '支出'], ['income', '収入'], ['transfer', '振替']];
    for (const button of typeButtons) {
      const pressed = filters.type === button[0] ? 'true' : 'false';
      html += '<button type="button" data-action="filter-type" data-value="' + button[0] + '" aria-pressed="' + pressed + '">' + button[1] + '</button>';
    }
    html += '</div>';

    html += '<input type="search" id="filterSearch" placeholder="内容・メモで検索" value="' + escapeHtml(filters.search) + '" aria-label="内容・メモで検索">';
    html += '</div>';

    // 日付で絞り込み中なら、それを外すボタン
    if (filters.date) {
      html += '<div class="row-gap" style="margin-bottom:12px">' +
        '<button type="button" class="filter-chip" data-action="clear-date-filter">' + formatMonthDay(filters.date) + ' の記録だけ表示中 ' + iconSvg('close') + '</button></div>';
    }

    html += '<div class="row-gap" style="margin-bottom:10px"><button type="button" class="btn small" data-action="new-from-email" data-icon="plus">カード利用のメールから記録</button></div>';
    html += '<div class="summary-line" id="transactionSummary"></div>';
    html += '<div class="tx-list" id="transactionListArea"></div>';
    html += '</section>';
    return html;
  },

  afterRender() {
    renderTransactionList();

    // 選んだり入力したりしたら、一覧だけを描き直す（入力中の文字が消えないように）
    findOne('#filterAccount').addEventListener('change', (event) => {
      appState.filters.account = event.target.value;
      renderTransactionList();
    });
    findOne('#filterCategory').addEventListener('change', (event) => {
      appState.filters.category = event.target.value;
      renderTransactionList();
    });
    findOne('#filterSearch').addEventListener('input', (event) => {
      appState.filters.search = event.target.value;
      renderTransactionList();
    });
  },
};


/** 絞り込み条件に合う入出金を、日付ごとにまとめて表示する */
function renderTransactionList() {
  const listArea = findOne('#transactionListArea');
  const summaryArea = findOne('#transactionSummary');
  if (!listArea) {
    return;
  }

  const list = filterTransactions(appState.filters, periodRange(appState.period));

  // 合計
  let income = 0;
  let expense = 0;
  for (const transaction of list) {
    if (isCounted(transaction) && transaction.type === 'income') {
      income = income + transaction.amount;
    }
    if (isCounted(transaction) && transaction.type === 'expense') {
      expense = expense + transaction.amount;
    }
  }
  summaryArea.innerHTML =
    '<span>' + list.length + '件</span>' +
    '<span>収入 <strong class="num income-text">' + formatYen(income) + '</strong></span>' +
    '<span>支出 <strong class="num">' + formatYen(expense) + '</strong></span>';

  if (list.length === 0) {
    listArea.innerHTML = '<p class="empty-note">条件に合う入出金はありません。</p>';
    return;
  }

  // 日付ごとにまとめる
  let html = '';
  let currentDate = '';
  for (let index = 0; index < list.length; index++) {
    const transaction = list[index];
    if (transaction.date !== currentDate) {
      currentDate = transaction.date;
      // その日の支出の合計
      let dayExpense = 0;
      for (const item of list) {
        if (item.date === currentDate && isCounted(item) && item.type === 'expense') {
          dayExpense = dayExpense + item.amount;
        }
      }
      html += '<div class="tx-day"><span>' + formatMonthDay(currentDate) + '</span>' +
        (dayExpense > 0 ? '<span class="num">支出 ' + formatYen(dayExpense) + '</span>' : '<span></span>') + '</div>';
    }
    html += transactionRowHtml(transaction, {});
  }
  listArea.innerHTML = html;
}


/**
 * 入出金1行分のHTML（ホームやカード画面でも使う）。
 * options.showDate が true なら、日付も小さく表示する。
 */
function transactionRowHtml(transaction, options) {
  let markText = '';
  let markClass = transaction.type;
  let meta = '';
  let fallbackName = '';

  if (transaction.type === 'transfer') {
    markText = '振';
    meta = accountName(transaction.account) + ' → ' + accountName(transaction.toAccount);
    fallbackName = '振替';
  } else if (transaction.type === 'adjust') {
    markText = '調';
    meta = '残高修正 · ' + accountName(transaction.account);
    fallbackName = '残高修正';
  } else {
    const category = CATEGORY_BY_ID[transaction.category] || CATEGORY_BY_ID.other;
    markText = category.mark;
    meta = (transaction.sub || category.name) + ' · ' + accountName(transaction.account);
    fallbackName = category.name;
  }
  if (options && options.showDate) {
    meta = formatShortDate(transaction.date) + ' · ' + meta;
  }

  // 小さな札（計算対象外・カードの支払い方法）
  let tags = '';
  if (transaction.include === false) {
    tags += '<span class="tag">計算対象外</span>';
  }
  const account = accountById[transaction.account];
  if (account && account.kind === 'card' && transaction.type === 'expense') {
    const methodLabel = paymentMethodLabel(transaction);
    if (methodLabel) {
      tags += '<span class="tag">' + escapeHtml(methodLabel) + '</span>';
    }
  }

  // 金額の見せ方
  let amountText = formatYen(transaction.amount);
  if (transaction.type === 'expense') {
    amountText = formatYen(-transaction.amount);
  } else if (transaction.type === 'income' || transaction.type === 'adjust') {
    amountText = formatYen(transaction.amount, { showPlus: true });
  }

  const excludedClass = transaction.include === false ? ' excluded' : '';
  return '<button type="button" class="tx' + excludedClass + '" data-action="edit-transaction" data-id="' + escapeHtml(transaction.id) + '">' +
    '<span class="mark ' + markClass + '" aria-hidden="true">' + escapeHtml(markText) + '</span>' +
    '<span class="tx-main">' +
    '<span class="tx-desc">' + escapeHtml(transaction.description || fallbackName) + tags + '</span>' +
    '<span class="tx-meta">' + escapeHtml(meta) + '</span>' +
    '</span>' +
    '<span class="tx-amount num ' + transaction.type + '">' + amountText + '</span>' +
    '</button>';
}
