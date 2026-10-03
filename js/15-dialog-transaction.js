/* ===========================================================
   15-dialog-transaction.js  ―  入出金の記録・編集ダイアログ
   -----------------------------------------------------------
   「記録する」ボタンや、一覧の行を押したときに開く入力画面です。
   入力欄そのものは index.html の「ダイアログ1」に書いてあり、
   このファイルは「値を入れる・読み取る・保存する」を担当します。

   便利なしかけ:
     ・内容（お店の名前）を入れると、カテゴリを自動で選びます
     ・自分でカテゴリを直すと、そのお店のルールを覚えます
     ・金額の欄は「1200+380」のような計算ができます
     ・カードで支出を記録すると「支払い方法」が選べ、
       いつ・いくら引き落とされるかがその場で分かります
   =========================================================== */

// ダイアログの今の状態
const transactionDialog = {
  editing: null,          // 編集中の入出金（新しく記録するときは null）
  categoryTouched: false, // カテゴリを自分で選んだか（選んだら自動分類しない）
  categoryChanged: false, // 今回カテゴリを変えたか（変えたらルールを覚える）
};

const LAST_ACCOUNT_KEY = 'mamecho-last-account';


/* ===========================================================
   1. 開く
   =========================================================== */

/**
 * ダイアログを開く。
 *   transaction … 編集する入出金（新しく記録するなら null）
 *   preset      … 新しく記録するときの初期値 { account, date, type }
 */
function openTransactionDialog(transaction, preset) {
  const options = preset || {};
  transactionDialog.editing = transaction;
  transactionDialog.categoryTouched = Boolean(transaction);
  transactionDialog.categoryChanged = false;

  const type = transaction ? transaction.type : (options.type || 'expense');

  // 種類
  if (type !== 'adjust') {
    findOne('#transactionForm').elements.transactionType.value = type;
  }
  findOne('#transactionTypeGroup').hidden = type === 'adjust';
  findOne('#adjustLabel').hidden = type !== 'adjust';

  // 金額・日付・内容・メモ
  findOne('#transactionAmount').value = transaction ? String(transaction.amount) : '';
  findOne('#transactionDate').value = transaction ? transaction.date : (options.date || defaultDateForNewRecord());
  findOne('#transactionDescription').value = transaction ? (transaction.description || '') : '';
  findOne('#transactionMemo').value = transaction ? (transaction.memo || '') : '';
  findOne('#transactionInclude').checked = transaction ? transaction.include !== false : true;

  // 口座
  const accountId = transaction ? transaction.account : (options.account || lastUsedAccountId());
  const toAccountId = transaction ? transaction.toAccount : '';
  fillAccountSelects(accountId, toAccountId);

  // カテゴリ
  const categoryType = type === 'income' ? 'income' : 'expense';
  const categoryId = transaction && transaction.category ? transaction.category : getCategoriesForType(categoryType)[0].id;
  fillCategorySelect(findOne('#transactionCategory'), categoryType, categoryId);
  fillSubcategorySelect(findOne('#transactionSubcategory'), categoryId, transaction ? transaction.sub : '');

  // カードの支払い方法
  fillPaymentMethodFields(transaction);

  // 入力候補（過去の内容）
  let suggestions = '';
  for (const description of recentDescriptions(200)) {
    suggestions += '<option value="' + escapeHtml(description) + '"></option>';
  }
  findOne('#descriptionSuggestions').innerHTML = suggestions;

  // 見出しとボタン
  findOne('#transactionDialogTitle').textContent = transaction ? '入出金を編集' : '入出金を記録';
  findOne('#transactionDeleteButton').hidden = !transaction;
  findOne('#transactionSaveNextButton').hidden = Boolean(transaction);
  findOne('#transactionDeleteConfirm').hidden = true;
  findOne('#transactionError').textContent = '';
  findOne('#receiptStatus').textContent = '';
  findOne('#receiptRow').hidden = !canReadReceipts() || type === 'transfer' || type === 'adjust';

  applyTypeToDialog(type);
  updateAmountHint();
  findOne('#transactionDialog').showModal();
  setTimeout(() => findOne('#transactionAmount').focus(), 30);
}

/** 新しく記録するときの日付: 表示中の期間に今日があれば今日、なければ期間の最初の日 */
function defaultDateForNewRecord() {
  if (appState.period && !isCurrentPeriod(appState.period)) {
    return periodRange(appState.period).start;
  }
  return todayText();
}

/** 前回使った口座（このブラウザで覚えている） */
function lastUsedAccountId() {
  try {
    const saved = localStorage.getItem(LAST_ACCOUNT_KEY);
    if (saved && accountById[saved]) {
      return saved;
    }
  } catch (error) {
    // 保存できない環境では何もしない
  }
  const first = appState.profile.accounts[0];
  return first ? first.id : '';
}

/** 口座の選択肢を入れる */
function fillAccountSelects(fromId, toId) {
  let html = '';
  for (const kindId of ACCOUNT_KIND_ORDER) {
    const accounts = appState.profile.accounts.filter((account) => account.kind === kindId);
    if (accounts.length === 0) {
      continue;
    }
    html += '<optgroup label="' + ACCOUNT_KINDS[kindId].label + '">';
    for (const account of accounts) {
      html += '<option value="' + escapeHtml(account.id) + '">' + escapeHtml(account.name) + '</option>';
    }
    html += '</optgroup>';
  }
  if (html === '') {
    html = '<option value="">口座がありません（口座画面で追加）</option>';
  }
  findOne('#transactionAccount').innerHTML = html;
  findOne('#transactionToAccount').innerHTML = html;
  if (fromId) {
    findOne('#transactionAccount').value = fromId;
  }
  // 振替先は、振替元と違う口座を最初に選んでおく
  const toSelect = findOne('#transactionToAccount');
  if (toId) {
    toSelect.value = toId;
  } else {
    for (const option of toSelect.options) {
      if (option.value !== findOne('#transactionAccount').value) {
        toSelect.value = option.value;
        break;
      }
    }
  }
}


/* ===========================================================
   2. 種類やカードに合わせて、見せる欄を切りかえる
   =========================================================== */

/** 今選ばれている種類（'expense' / 'income' / 'transfer' / 'adjust'） */
function currentDialogType() {
  if (transactionDialog.editing && transactionDialog.editing.type === 'adjust') {
    return 'adjust';
  }
  return findOne('#transactionForm').elements.transactionType.value;
}

function applyTypeToDialog(type) {
  const isMoneyInOut = type === 'expense' || type === 'income';
  findOne('#categoryFields').hidden = !isMoneyInOut;
  findOne('#includeField').hidden = !isMoneyInOut;
  findOne('#toAccountField').hidden = type !== 'transfer';

  const accountLabels = { expense: '支払元', income: '入金先', transfer: '振替元', adjust: '口座' };
  findOne('#fromAccountLabel').textContent = accountLabels[type];

  if (type === 'adjust') {
    findOne('#amountHint').textContent = '増えた分はプラス、減った分はマイナス';
  } else {
    findOne('#amountHint').textContent = '「1200+380」のような計算もOK';
  }
  updatePaymentFieldsVisibility();
}

/** 種類のボタンが切りかわったとき */
function onTransactionTypeChange() {
  const type = currentDialogType();
  const categoryType = type === 'income' ? 'income' : 'expense';
  const categorySelect = findOne('#transactionCategory');
  fillCategorySelect(categorySelect, categoryType, getCategoriesForType(categoryType)[0].id);
  fillSubcategorySelect(findOne('#transactionSubcategory'), categorySelect.value, '');
  transactionDialog.categoryTouched = false;
  applyAutoCategory();
  applyTypeToDialog(type);
  findOne('#receiptRow').hidden = !canReadReceipts() || type === 'transfer';
}

/** 内容が入力されたら、カテゴリを自動で選ぶ（自分で選んでいない場合だけ） */
function applyAutoCategory() {
  if (transactionDialog.categoryTouched) {
    return;
  }
  const type = currentDialogType();
  if (type !== 'expense' && type !== 'income') {
    return;
  }
  const found = findAutoCategory(findOne('#transactionDescription').value, type);
  if (!found || !CATEGORY_BY_ID[found.category]) {
    return;
  }
  const categorySelect = findOne('#transactionCategory');
  categorySelect.value = found.category;
  fillSubcategorySelect(findOne('#transactionSubcategory'), found.category, found.sub);
}

/** 金額の欄に計算式が入っていたら、答えを下に出す */
function updateAmountHint() {
  const text = findOne('#transactionAmount').value;
  const hint = findOne('#amountHint');
  if (/[+*/×÷]/.test(text) || /\d-\d/.test(text)) {
    const value = calculateAmount(text);
    hint.textContent = Number.isNaN(value) || value === null ? '計算できません' : '= ' + formatYen(value);
  } else if (currentDialogType() !== 'adjust') {
    hint.textContent = '「1200+380」のような計算もOK';
  }
  updatePaymentPreview();
}


/* ===========================================================
   3. カードの支払い方法
   =========================================================== */

/** 支払い方法の選択肢を作る（カードの会社によって選べるものが違う） */
function fillPaymentMethodFields(transaction) {
  let installmentOptions = '';
  for (const count of INSTALLMENT_COUNTS) {
    installmentOptions += '<option value="' + count + '">' + count + '回</option>';
  }
  findOne('#transactionInstallments').innerHTML = installmentOptions;

  let skipOptions = '';
  for (let months = 1; months <= 6; months++) {
    skipOptions += '<option value="' + months + '">' + months + 'か月先</option>';
  }
  findOne('#transactionSkipMonths').innerHTML = skipOptions;

  refreshPaymentMethodOptions(transaction ? transaction.payMethod : 'once');
  findOne('#transactionInstallments').value = String(transaction && transaction.installments ? transaction.installments : 3);
  findOne('#transactionSkipMonths').value = String(transaction && transaction.skipMonths ? transaction.skipMonths : 1);
}

/** 選んでいるカードに合わせて、支払い方法の選択肢を入れかえる */
function refreshPaymentMethodOptions(selectedMethod) {
  const account = accountById[findOne('#transactionAccount').value];
  const select = findOne('#transactionPayMethod');
  if (!account || account.kind !== 'card') {
    select.innerHTML = '';
    return;
  }
  const settings = cardSettings(account);
  let html = '';
  for (const methodId of settings.methods) {
    html += '<option value="' + methodId + '">' + PAYMENT_METHODS[methodId].label + '</option>';
  }
  select.innerHTML = html;
  select.value = settings.methods.includes(selectedMethod) ? selectedMethod : 'once';
}

/** カードの支出のときだけ、支払い方法の欄を見せる */
function updatePaymentFieldsVisibility() {
  const account = accountById[findOne('#transactionAccount').value];
  const isCardExpense = currentDialogType() === 'expense' && account && account.kind === 'card';
  findOne('#paymentMethodFields').hidden = !isCardExpense;
  if (!isCardExpense) {
    return;
  }
  const method = findOne('#transactionPayMethod').value;
  findOne('#installmentField').hidden = method !== 'installment';
  findOne('#skipField').hidden = method !== 'skip';
  const info = PAYMENT_METHODS[method];
  let note = info ? info.note : '';
  const settings = cardSettings(account);
  if (method === 'once' && settings.autoRevolving) {
    note = 'このカードは登録型リボ（' + (settings.company.autoRevolvingName || '自動リボ') + '）に設定されているため、1回払いもリボ払いとして計算します。';
  }
  findOne('#paymentMethodNote').textContent = note;
  updatePaymentPreview();
}

/** 「いつ・いくら払うか」の見通しを出す */
function updatePaymentPreview() {
  const preview = findOne('#paymentPreview');
  const account = accountById[findOne('#transactionAccount').value];
  if (findOne('#paymentMethodFields').hidden || !account) {
    preview.textContent = '';
    return;
  }
  const text = describePaymentPreview(account, {
    date: findOne('#transactionDate').value,
    amount: calculateAmount(findOne('#transactionAmount').value),
    payMethod: findOne('#transactionPayMethod').value,
    installments: Number(findOne('#transactionInstallments').value),
    skipMonths: Number(findOne('#transactionSkipMonths').value),
  });
  preview.textContent = text ? '支払いの見通し: ' + text : '';
}


/* ===========================================================
   4. 保存・削除
   =========================================================== */

/**
 * 入力欄を読み取って、入出金の形にする。
 * 入力にまちがいがあれば { error: 'メッセージ' } を返す。
 */
function readTransactionForm() {
  const type = currentDialogType();
  const amount = calculateAmount(findOne('#transactionAmount').value);
  const date = findOne('#transactionDate').value;
  const accountId = findOne('#transactionAccount').value;

  if (amount === null || Number.isNaN(amount)) {
    return { error: '金額を数字で入れてください。' };
  }
  if (type !== 'adjust' && amount <= 0) {
    return { error: '金額は1円以上で入れてください。' };
  }
  if (type === 'adjust' && amount === 0) {
    return { error: '0円の残高修正は記録できません。' };
  }
  if (!isValidDateText(date)) {
    return { error: '日付を選んでください。' };
  }
  if (!accountId || !accountById[accountId]) {
    return { error: '口座を選んでください（口座がなければ口座画面で追加できます）。' };
  }

  const editing = transactionDialog.editing;
  const transaction = {
    id: editing ? editing.id : makeId(),
    date: date,
    type: type,
    amount: amount,
    account: accountId,
    description: findOne('#transactionDescription').value.trim(),
    memo: findOne('#transactionMemo').value.trim(),
    include: true,
    createdAt: editing ? editing.createdAt : Date.now(),
  };
  if (editing && editing.billMonth) {
    transaction.billMonth = editing.billMonth; // カードの引き落とし記録の印は残す
  }

  if (type === 'transfer') {
    const toAccountId = findOne('#transactionToAccount').value;
    if (!toAccountId || toAccountId === accountId) {
      return { error: '振替元と振替先には、別の口座を選んでください。' };
    }
    transaction.toAccount = toAccountId;
  }

  if (type === 'expense' || type === 'income') {
    transaction.category = findOne('#transactionCategory').value;
    transaction.sub = findOne('#transactionSubcategory').value;
    transaction.include = findOne('#transactionInclude').checked;
  }

  // カードの支払い方法
  if (!findOne('#paymentMethodFields').hidden) {
    transaction.payMethod = findOne('#transactionPayMethod').value || 'once';
    if (transaction.payMethod === 'installment') {
      transaction.installments = Number(findOne('#transactionInstallments').value);
    }
    if (transaction.payMethod === 'skip') {
      transaction.skipMonths = Number(findOne('#transactionSkipMonths').value);
    }
  }
  return { transaction: transaction };
}

/** 保存ボタン（keepOpen が true なら、保存したあと続けて入力できるようにする） */
function saveTransactionFromDialog(keepOpen) {
  const result = readTransactionForm();
  if (result.error) {
    findOne('#transactionError').textContent = result.error;
    return;
  }
  const transaction = result.transaction;
  const editing = transactionDialog.editing;

  // カテゴリを自分で直していたら、そのお店のルールを覚える
  let learned = false;
  if (transactionDialog.categoryChanged && transaction.description && transaction.category) {
    const guess = findAutoCategory(transaction.description, transaction.type);
    if (!guess || guess.category !== transaction.category || guess.sub !== transaction.sub) {
      rememberCategoryRule(transaction.description, transaction.type, transaction.category, transaction.sub);
      learned = true;
    }
  }

  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, transaction.account);
  } catch (error) {
    // 保存できない環境では何もしない
  }

  putTransaction(transaction, editing ? editing.date : null);
  if (learned) {
    saveProfile();
  }

  if (appState.isSample) {
    showToast('サンプル表示中のため、この記録は保存されません');
  } else {
    showToast(editing ? '更新しました' : '記録しました');
  }

  if (keepOpen) {
    // 日付・口座・種類はそのままで、金額・内容・メモだけ空にする
    transactionDialog.editing = null;
    transactionDialog.categoryTouched = false;
    transactionDialog.categoryChanged = false;
    findOne('#transactionAmount').value = '';
    findOne('#transactionDescription').value = '';
    findOne('#transactionMemo').value = '';
    findOne('#transactionError').textContent = '';
    updateAmountHint();
    findOne('#transactionAmount').focus();
  } else {
    findOne('#transactionDialog').close();
  }
}

/** 削除の確認で「削除する」を押したとき */
function deleteTransactionFromDialog() {
  const editing = transactionDialog.editing;
  if (!editing) {
    return;
  }
  deleteTransaction(editing);
  findOne('#transactionDialog').close();
  showToast('削除しました');
}


/* ===========================================================
   5. 入力欄の動きを登録する（アプリ起動時に1回だけ）
   =========================================================== */

function setupTransactionDialog() {
  const form = findOne('#transactionForm');

  form.addEventListener('submit', (event) => {
    event.preventDefault(); // ページが再読み込みされないようにする
    saveTransactionFromDialog(false);
  });

  for (const radio of findAll('input[name="transactionType"]')) {
    radio.addEventListener('change', onTransactionTypeChange);
  }

  findOne('#transactionDescription').addEventListener('input', applyAutoCategory);

  findOne('#transactionCategory').addEventListener('change', (event) => {
    transactionDialog.categoryTouched = true;
    transactionDialog.categoryChanged = true;
    fillSubcategorySelect(findOne('#transactionSubcategory'), event.target.value, '');
  });
  findOne('#transactionSubcategory').addEventListener('change', () => {
    transactionDialog.categoryTouched = true;
    transactionDialog.categoryChanged = true;
  });

  findOne('#transactionAmount').addEventListener('input', updateAmountHint);
  findOne('#transactionDate').addEventListener('change', updatePaymentPreview);

  findOne('#transactionAccount').addEventListener('change', () => {
    refreshPaymentMethodOptions(findOne('#transactionPayMethod').value);
    updatePaymentFieldsVisibility();
  });
  findOne('#transactionPayMethod').addEventListener('change', updatePaymentFieldsVisibility);
  findOne('#transactionInstallments').addEventListener('change', updatePaymentPreview);
  findOne('#transactionSkipMonths').addEventListener('change', updatePaymentPreview);

  // レシートの写真を選んだら読み取る（18-ai-features.js）
  findOne('#receiptFile').addEventListener('change', (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (file) {
      readReceiptImage(file);
    }
  });
}
