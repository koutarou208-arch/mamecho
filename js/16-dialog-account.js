/* ===========================================================
   16-dialog-account.js  ―  口座の追加・編集と、通帳ふうの明細
   -----------------------------------------------------------
   【前半】口座の追加・編集ダイアログ（index.html の「ダイアログ2」）
           クレジットカードのときは、カード会社・締め日・支払日・
           引き落とし口座・手数料率などの欄も出ます。
   【後半】口座の明細（index.html の「ダイアログ3」）
           銀行の通帳のように、日付・摘要・出金・入金・残高を並べます。
           「残高を修正」で、アプリの残高を実際の残高に合わせられます。
   =========================================================== */


/* ===========================================================
   1. 口座の追加・編集
   =========================================================== */

const accountDialog = {
  editing: null, // 編集中の口座（新しく追加するときは null）
};

/**
 * ダイアログを開く。
 *   account    … 編集する口座（追加なら null）
 *   presetKind … 追加するときの種類の初期値（例: 'card'）
 */
function openAccountDialog(account, presetKind) {
  accountDialog.editing = account;

  // 種類の選択肢
  let kindOptions = '';
  for (const kindId of ACCOUNT_KIND_ORDER) {
    kindOptions += '<option value="' + kindId + '">' + ACCOUNT_KINDS[kindId].label + '</option>';
  }
  findOne('#accountKind').innerHTML = kindOptions;

  const kind = account ? account.kind : (presetKind || 'bank');
  findOne('#accountKind').value = kind;
  findOne('#accountName').value = account ? account.name : '';
  findOne('#accountDate').value = account ? account.openDate : todayText();

  // 負債（カード・ローン）は「借りている額」をプラスで入力してもらう
  const opening = account ? Number(account.opening) || 0 : 0;
  const shownOpening = ACCOUNT_KINDS[kind].isDebt ? -opening : opening;
  findOne('#accountBalance').value = account ? String(shownOpening) : '';

  fillCardFields(account);
  onAccountKindChange();

  findOne('#accountDialogTitle').textContent = account ? '口座を編集' : '口座を追加';
  findOne('#accountDeleteButton').hidden = !account;
  findOne('#accountDeleteConfirm').hidden = true;
  findOne('#accountError').textContent = '';
  findOne('#accountDialog').showModal();
  setTimeout(() => findOne('#accountName').focus(), 30);
}

/** 種類が変わったとき: カードの欄を出し入れし、残高の説明を変える */
function onAccountKindChange() {
  const kind = findOne('#accountKind').value;
  const isDebt = ACCOUNT_KINDS[kind].isDebt;
  findOne('#cardFields').hidden = kind !== 'card';
  if (isDebt) {
    findOne('#accountBalanceLabel').textContent = '未払いの残高（借りている額）';
    findOne('#accountBalanceHint').textContent = '基準日の朝の時点で、まだ払っていない金額を入れてください（なければ0）。';
  } else {
    findOne('#accountBalanceLabel').textContent = '残高';
    findOne('#accountBalanceHint').textContent = '基準日の朝の時点の残高を入れてください。それ以降の入出金が自動で足し引きされます。';
  }
}


/* -----------------------------------------------------------
   カードの欄
   ----------------------------------------------------------- */

function fillCardFields(account) {
  const saved = account && account.card ? account.card : {};

  // カード会社
  let companyOptions = '';
  for (const company of CARD_COMPANIES) {
    companyOptions += '<option value="' + company.id + '">' + escapeHtml(company.name) + '</option>';
  }
  findOne('#cardCompany').innerHTML = companyOptions;
  findOne('#cardCompany').value = saved.company || 'jcb';

  // 締め日・支払日の「日」の選択肢（31は月末）
  let dayOptions = '';
  for (let day = 1; day <= 31; day++) {
    dayOptions += '<option value="' + day + '">' + (day === 31 ? '月末' : day + '日') + '</option>';
  }
  findOne('#cardClosingDay').innerHTML = dayOptions;
  findOne('#cardPaymentDay').innerHTML = dayOptions;

  // 引き落とし口座（カード・ローン以外）
  let payFromOptions = '<option value="">未設定</option>';
  for (const other of appState.profile.accounts) {
    if (!ACCOUNT_KINDS[other.kind].isDebt) {
      payFromOptions += '<option value="' + escapeHtml(other.id) + '">' + escapeHtml(other.name) + '</option>';
    }
  }
  findOne('#cardPayFrom').innerHTML = payFromOptions;
  findOne('#cardPayFrom').value = saved.payFrom || '';

  findOne('#cardLimit').value = saved.limit ? String(saved.limit) : '';
  findOne('#cardAutoRevolving').checked = saved.autoRevolving === true;
  findOne('#cardInstallmentRate').value = valueOr(saved.installmentRate, '');
  findOne('#cardRevolvingRate').value = valueOr(saved.revolvingRate, '');
  findOne('#cardSkipRate').value = valueOr(saved.skipRate, '');
  findOne('#cardBonus2Fee').value = valueOr(saved.bonus2Fee, '');
  findOne('#cardRevolvingMonthly').value = valueOr(saved.revolvingMonthly, '');
  findOne('#cardPointRate').value = valueOr(saved.pointRate, '');

  onCardCompanyChange(saved);
}

/** カード会社を選んだとき: 締め日・支払日の選択肢と、説明・初期値を入れかえる */
function onCardCompanyChange(saved) {
  const savedCard = saved || {};
  const company = findCardCompany(findOne('#cardCompany').value);

  let cycleOptions = '';
  for (let index = 0; index < company.cycles.length; index++) {
    cycleOptions += '<option value="' + index + '">' + escapeHtml(company.cycles[index].label) + '</option>';
  }
  cycleOptions += '<option value="custom">自分で入力する</option>';
  const cycleSelect = findOne('#cardCycle');
  cycleSelect.innerHTML = cycleOptions;
  cycleSelect.value = String(valueOr(savedCard.cycleIndex, 0));
  if (cycleSelect.value === '') {
    cycleSelect.value = '0';
  }

  // 自分で入力する場合の初期値
  const cycle = company.cycles[0];
  findOne('#cardClosingDay').value = String(valueOr(savedCard.closingDay, cycle.closingDay));
  findOne('#cardPaymentDay').value = String(valueOr(savedCard.paymentDay, cycle.paymentDay));
  findOne('#cardMonthsLater').value = String(valueOr(savedCard.monthsLater, cycle.monthsLater));

  // 手数料率の欄には、会社の標準値を薄く表示しておく
  const today = todayText();
  function standardText(rates) {
    const range = rateRangeAt(rates, today);
    if (!range) {
      return '';
    }
    return '標準 ' + (range.min === range.max ? range.min : range.min + '〜' + range.max);
  }
  findOne('#cardInstallmentRate').placeholder = standardText(company.rates.installment);
  findOne('#cardRevolvingRate').placeholder = standardText(company.rates.revolving);
  findOne('#cardSkipRate').placeholder = company.methods.includes('skip') ? standardText(company.rates.skip) : 'この会社にはありません';
  findOne('#cardBonus2Fee').placeholder = company.methods.includes('bonus2') ? '標準 ' + company.bonus2Fee : 'この会社にはありません';
  findOne('#cardRevolvingMonthly').placeholder = '標準 10000';

  findOne('#cardAutoRevolvingLabel').textContent = company.autoRevolvingName
    ? company.autoRevolvingName + 'を使っている（1回払いも自動でリボになる）'
    : '登録型リボ（1回払いで払っても自動でリボになる設定）を使っている';

  findOne('#cardCompanyNote').textContent = company.notes + '（確からしさ: ' + CONFIDENCE_LABELS[company.confidence] + ' · ' + company.checkedAt + ' 確認）';
  onCardCycleChange();
}

function onCardCycleChange() {
  findOne('#cardCustomCycle').hidden = findOne('#cardCycle').value !== 'custom';
}

/** カードの欄を読み取る。まちがいがあれば { error } を返す */
function readCardFields() {
  const card = {
    company: findOne('#cardCompany').value,
    payFrom: findOne('#cardPayFrom').value,
    autoRevolving: findOne('#cardAutoRevolving').checked,
  };

  const cycleValue = findOne('#cardCycle').value;
  if (cycleValue === 'custom') {
    card.cycleIndex = 'custom';
    card.closingDay = Number(findOne('#cardClosingDay').value);
    card.paymentDay = Number(findOne('#cardPaymentDay').value);
    card.monthsLater = Number(findOne('#cardMonthsLater').value);
  } else {
    card.cycleIndex = Number(cycleValue);
  }

  const limit = calculateAmount(findOne('#cardLimit').value);
  if (limit !== null) {
    if (Number.isNaN(limit) || limit < 0) {
      return { error: '利用枠は数字で入れてください。' };
    }
    card.limit = limit;
  }
  const monthly = calculateAmount(findOne('#cardRevolvingMonthly').value);
  if (monthly !== null) {
    if (Number.isNaN(monthly) || monthly < 1000) {
      return { error: 'リボで毎月返す元金は1,000円以上で入れてください。' };
    }
    card.revolvingMonthly = monthly;
  }

  // 手数料率など（空欄なら会社の標準を使うので保存しない）
  const rateFields = [
    ['#cardInstallmentRate', 'installmentRate', '分割払いの手数料'],
    ['#cardRevolvingRate', 'revolvingRate', 'リボ払いの手数料'],
    ['#cardSkipRate', 'skipRate', 'スキップ払いの手数料'],
    ['#cardBonus2Fee', 'bonus2Fee', 'ボーナス2回払いの手数料'],
    ['#cardPointRate', 'pointRate', 'ポイント還元率'],
  ];
  for (const field of rateFields) {
    const text = findOne(field[0]).value.normalize('NFKC').replace('%', '').trim();
    if (text === '') {
      continue;
    }
    const number = parseFloat(text);
    if (!Number.isFinite(number) || number < 0 || number > 100) {
      return { error: field[2] + 'は0〜100の数字で入れてください。' };
    }
    card[field[1]] = number;
  }
  return { card: card };
}


/* -----------------------------------------------------------
   保存・削除
   ----------------------------------------------------------- */

function saveAccountFromDialog() {
  const name = findOne('#accountName').value.trim();
  const kind = findOne('#accountKind').value;
  const openDate = findOne('#accountDate').value;
  const balance = calculateAmount(findOne('#accountBalance').value);
  const errorArea = findOne('#accountError');

  if (name === '') {
    errorArea.textContent = '名前を入れてください。';
    return;
  }
  if (Number.isNaN(balance)) {
    errorArea.textContent = '残高は数字で入れてください。';
    return;
  }
  if (!isValidDateText(openDate)) {
    errorArea.textContent = '基準日を選んでください。';
    return;
  }

  const isDebt = ACCOUNT_KINDS[kind].isDebt;
  const opening = isDebt ? -(balance || 0) : (balance || 0);

  let card = null;
  if (kind === 'card') {
    const result = readCardFields();
    if (result.error) {
      errorArea.textContent = result.error;
      return;
    }
    card = result.card;
  }

  const editing = accountDialog.editing;
  if (editing) {
    editing.name = name;
    editing.kind = kind;
    editing.opening = opening;
    editing.openDate = openDate;
    if (card) {
      editing.card = card;
    } else {
      delete editing.card;
    }
  } else {
    const account = { id: makeId(), name: name, kind: kind, opening: opening, openDate: openDate };
    if (card) {
      account.card = card;
    }
    appState.profile.accounts.push(account);
  }

  findOne('#accountDialog').close();
  saveProfile();
  if (passbookState.accountId && findOne('#passbookDialog').open) {
    renderPassbook();
  }
  showToast(editing ? '口座を更新しました' : '口座を追加しました');
}

/** 「この口座を削除」を押したとき: 確認を出す */
function askDeleteAccount() {
  const account = accountDialog.editing;
  let count = 0;
  for (const transaction of allTransactions) {
    if (transaction.account === account.id || transaction.toAccount === account.id) {
      count = count + 1;
    }
  }
  findOne('#accountDeleteMessage').textContent = '「' + account.name + '」と、この口座の入出金 ' + count + '件を削除します。元に戻せません。';
  findOne('#accountDeleteConfirm').hidden = false;
}

/** 確認で「削除する」を押したとき */
function deleteAccountConfirmed() {
  const account = accountDialog.editing;
  const changedMonths = deleteTransactionsWhere((transaction) => transaction.account === account.id || transaction.toAccount === account.id);
  appState.profile.accounts = appState.profile.accounts.filter((item) => item.id !== account.id);
  // ほかのカードの引き落とし口座になっていたら外す
  for (const other of appState.profile.accounts) {
    if (other.card && other.card.payFrom === account.id) {
      other.card.payFrom = '';
    }
  }
  findOne('#accountDialog').close();
  if (findOne('#passbookDialog').open) {
    findOne('#passbookDialog').close();
  }
  afterDataChange(changedMonths, true);
  showToast('口座を削除しました');
}

function setupAccountDialog() {
  findOne('#accountForm').addEventListener('submit', (event) => {
    event.preventDefault();
    saveAccountFromDialog();
  });
  findOne('#accountKind').addEventListener('change', onAccountKindChange);
  findOne('#cardCompany').addEventListener('change', () => onCardCompanyChange(null));
  findOne('#cardCycle').addEventListener('change', onCardCycleChange);
}


/* ===========================================================
   2. 通帳ふうの明細
   =========================================================== */

const passbookState = {
  accountId: null,  // 表示中の口座
  rowsShown: 60,    // 表示する行数（「さらに前を表示」で増える）
  adjustOpen: false, // 残高修正の入力欄を開いているか
};

function openPassbook(accountId) {
  passbookState.accountId = accountId;
  passbookState.rowsShown = 60;
  passbookState.adjustOpen = false;
  renderPassbook();
  findOne('#passbookDialog').showModal();
}

/** 明細の中身を作る */
function renderPassbook() {
  const account = accountById[passbookState.accountId];
  const body = findOne('#passbookBody');
  if (!account) {
    body.innerHTML = '<p class="empty-note">この口座は見つかりません。</p>';
    return;
  }
  const kind = ACCOUNT_KINDS[account.kind];
  const isDebt = kind.isDebt;
  const balance = currentBalance(account);
  findOne('#passbookTitle').textContent = account.name;

  // --- 上の部分: 残高とボタン ---
  let html = '<div class="passbook-balance"><span class="small muted">' + kind.label + (isDebt ? ' · 未払いの残高' : ' · 残高') + '</span>' +
    '<span class="hero-number" style="font-size:32px">' + formatYen(isDebt ? -balance : balance) + '</span></div>';
  html += '<div class="passbook-actions">' +
    '<button type="button" class="btn small primary" data-action="new-transaction" data-account="' + escapeHtml(account.id) + '" data-icon="plus">この口座で記録</button>' +
    '<button type="button" class="btn small" data-action="toggle-adjust">' + (account.kind === 'securities' ? '評価額を更新' : '残高を修正') + '</button>' +
    '<button type="button" class="btn small ghost" data-action="edit-account" data-id="' + escapeHtml(account.id) + '">口座の設定</button>' +
    '</div>';

  // --- 残高修正の入力欄 ---
  if (passbookState.adjustOpen) {
    html += '<div class="confirm-box" style="border-color:var(--accent); background:var(--accent-soft)">' +
      '<label class="field"><span>' + (isDebt ? '実際の未払い残高' : '実際の残高（通帳・アプリで見た金額）') + '</span>' +
      '<div class="amount-input"><span aria-hidden="true">¥</span><input id="adjustTarget" inputmode="numeric" autocomplete="off" value="' + (isDebt ? -balance : balance) + '"></div></label>' +
      '<p class="hint">差額を「残高修正」として今日の日付で記録します。収支の計算には入りません。</p>' +
      '<div class="row-gap"><button type="button" class="btn primary small" data-action="save-adjust">修正する</button>' +
      '<button type="button" class="btn ghost small" data-action="toggle-adjust">やめる</button></div></div>';
  }

  // --- 通帳の表 ---
  const records = transactionsOfAccount(account.id); // 古い順
  // 最後の残高から逆にたどって、各行の「差引残高」を求める
  const rows = [];
  let balanceAfter = balance;
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index];
    const effect = transactionEffect(record, account.id);
    rows.unshift({ record: record, effect: effect, balanceAfter: balanceAfter });
    balanceAfter = balanceAfter - effect;
  }
  const shownRows = rows.slice(-passbookState.rowsShown);
  const hiddenCount = rows.length - shownRows.length;
  const carryBalance = shownRows.length > 0 ? shownRows[0].balanceAfter - shownRows[0].effect : balance;

  const outLabel = isDebt ? 'ご利用金額' : 'お支払金額';
  const inLabel = isDebt ? 'ご入金額' : 'お預り金額';
  const balanceLabel = isDebt ? 'ご利用残高' : '差引残高';

  html += '<div class="passbook"><div class="passbook-head"><span>ご入出金明細</span><span>' + escapeHtml(kind.label) + '</span></div>';
  html += '<table><thead><tr><th>年月日</th><th>摘要</th><th>' + outLabel + '</th><th>' + inLabel + '</th><th>' + balanceLabel + '</th></tr></thead><tbody>';
  html += '<tr class="carry"><td></td><td>' + (hiddenCount > 0 ? '前ページより繰越' : '繰越') + '</td><td></td><td></td><td>' + passbookAmount(isDebt ? -carryBalance : carryBalance) + '</td></tr>';
  for (const row of shownRows) {
    const record = row.record;
    let summaryText = record.description;
    if (!summaryText) {
      if (record.type === 'transfer') {
        summaryText = record.account === account.id ? '振替 → ' + accountName(record.toAccount) : '振替 ← ' + accountName(record.account);
      } else if (record.type === 'adjust') {
        summaryText = '残高修正';
      } else {
        const category = CATEGORY_BY_ID[record.category];
        summaryText = category ? category.name : '';
      }
    }
    const outAmount = row.effect < 0 ? passbookAmount(-row.effect) : '';
    const inAmount = row.effect > 0 ? passbookAmount(row.effect) : '';
    html += '<tr><td>' + toWarekiText(record.date) + '</td><td title="' + escapeHtml(summaryText) + '">' + escapeHtml(summaryText) + '</td>' +
      '<td>' + outAmount + '</td><td>' + inAmount + '</td><td>' + passbookAmount(isDebt ? -row.balanceAfter : row.balanceAfter) + '</td></tr>';
  }
  html += '</tbody></table></div>';

  if (hiddenCount > 0) {
    html += '<div class="row-gap" style="justify-content:center; margin-top:8px"><button type="button" class="btn small ghost" data-action="passbook-more">さらに前を表示（あと' + hiddenCount + '件）</button></div>';
  }
  if (rows.length === 0) {
    html += '<p class="empty-note">この口座の入出金はまだありません。</p>';
  }

  body.innerHTML = html;
  fillIcons(body);
}

/** 通帳ふうの金額表示（前に「*」を付ける。書きかえ防止のための通帳の習慣） */
function passbookAmount(amount) {
  if (amount < 0) {
    return '−*' + formatNumber(-amount);
  }
  return '*' + formatNumber(amount);
}

/** 残高修正の「修正する」を押したとき */
function saveBalanceAdjustment() {
  const account = accountById[passbookState.accountId];
  const target = calculateAmount(findOne('#adjustTarget').value);
  if (target === null || Number.isNaN(target)) {
    showToast('実際の残高を数字で入れてください');
    return;
  }
  const isDebt = ACCOUNT_KINDS[account.kind].isDebt;
  const newBalance = isDebt ? -target : target;
  const difference = newBalance - currentBalance(account);
  if (difference === 0) {
    showToast('残高は合っています');
    passbookState.adjustOpen = false;
    renderPassbook();
    return;
  }

  let description = '残高修正';
  if (account.kind === 'securities') {
    description = '評価額の更新';
  } else if (account.kind === 'points') {
    description = 'ポイント残高の更新';
  }
  passbookState.adjustOpen = false;
  putTransaction({
    id: makeId(),
    date: todayText(),
    type: 'adjust',
    amount: difference,
    account: account.id,
    description: description,
    memo: '',
    include: true,
    createdAt: Date.now(),
  }, null);
  renderPassbook();
  showToast('残高を修正しました（' + formatYen(difference, { showPlus: true }) + '）');
}
