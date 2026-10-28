/* ===========================================================
   14-screen-settings.js  ―  設定画面
   -----------------------------------------------------------
     ・1か月の始まりの日（給料日に合わせるなど）
     ・データの取り込み・書き出し（CSV・バックアップ）
     ・自動分類ルールの確認と追加
     ・数字の点検（二重に数えていないか・数字が合っているか）
     ・保存先の表示と、データの全削除
   =========================================================== */

// 「すべてのデータを削除」の確認を出しているか
let isWipeConfirmOpen = false;

const SettingsScreen = {
  title: '設定',
  usesPeriod: false,

  html() {
    // よく使うもの（CSVの取り込み・固定費・自動分類）を上に、めったに変えないもの（集計期間・制度データ）を下に
    let html = '<div class="grid">';
    html += settingsDataCardHtml();
    html += settingsNumberCheckCardHtml();
    html += settingsRecurringCardHtml();
    html += settingsRulesCardHtml();
    html += lockCardHtml();            // 21-encryption-lock.js
    html += settingsPeriodCardHtml();
    html += rulesDataCardHtml();       // 20-rules-alerts.js
    html += settingsStorageCardHtml();
    html += '</div>';
    return html;
  },

  afterRender() {
    // 月の始まりの日を変えたら、すぐ保存
    findOne('#startDaySelect').addEventListener('change', (event) => {
      appState.profile.settings.startDay = Number(event.target.value);
      appState.period = periodOf(todayText());
      saveProfile();
      showToast('1か月の始まりを' + event.target.value + '日にしました');
    });

    // ルール追加フォームの「種類」「大項目」を変えたら、下の選択肢を入れかえる
    const typeSelect = findOne('#ruleType');
    const categorySelect = findOne('#ruleCategory');
    const subSelect = findOne('#ruleSub');
    typeSelect.addEventListener('change', () => {
      fillCategorySelect(categorySelect, typeSelect.value, '');
      fillSubcategorySelect(subSelect, categorySelect.value, '');
    });
    categorySelect.addEventListener('change', () => {
      fillSubcategorySelect(subSelect, categorySelect.value, '');
    });
    fillCategorySelect(categorySelect, 'expense', '');
    fillSubcategorySelect(subSelect, categorySelect.value, '');
    restoreRuleForm(typeSelect, categorySelect, subSelect);

    setupRecurringForm();

    // 「＋ 追加する」を開いた・閉じたを覚えておく（描き直しても、開いたままにする）
    for (const details of findAll('details[data-form-box]')) {
      details.addEventListener('toggle', () => {
        settingsOpenForms[details.dataset.formBox] = details.open;
      });
    }

    // 「すべてのデータを削除」: 「削除」と入力したときだけ、消すボタンを押せるようにする
    const wipeWord = findOne('#wipeConfirmWord');
    if (wipeWord) {
      wipeWord.addEventListener('input', () => {
        findOne('#wipeYesButton').disabled = !isDeleteWordTyped(wipeWord.value);
      });
    }

  },
};

// 設定の「＋ 追加する」の入力欄を開いているか（'recurring' / 'rule' → true）
const settingsOpenForms = {};

// 今「直す」を押しているルール（{ keyword, type }。なければ null）
// 番号（何番目か）で覚えると、新しいルールが増えたときに別のルールを指してしまうので、キーワードと種類で覚える
let editingRuleKey = null;
// 「×」を押して削除の確認を出しているルール（{ keyword, type }。なければ null）
let deletingRuleKey = null;
// ルールの入力欄の書きかけ（ほかのボタンで画面を描き直しても消えないように覚えておく。なければ null）
let ruleFormDraft = null;

/** ルールの一覧の中で、key（{ keyword, type }）に当たるルールの番号。見つからなければ -1 */
function rulePosition(key) {
  if (!key) {
    return -1;
  }
  return appState.profile.rules.findIndex((rule) => rule.keyword === key.keyword && rule.type === key.type);
}

/**
 * ルールの入力欄に内容を入れる: 直しているルールがあればその内容、なければ書きかけ。
 * あわせて、打った内容を書きかけとして覚えるようにする。
 */
function restoreRuleForm(typeSelect, categorySelect, subSelect) {
  const keywordInput = findOne('#ruleKeyword');
  const editingRule = appState.profile.rules[rulePosition(editingRuleKey)];
  const values = editingRule || ruleFormDraft;
  if (values) {
    keywordInput.value = values.keyword || '';
    typeSelect.value = values.type || 'expense';
    fillCategorySelect(categorySelect, typeSelect.value, values.category || '');
    fillSubcategorySelect(subSelect, categorySelect.value, values.sub || '');
  }
  const remember = () => {
    ruleFormDraft = { keyword: keywordInput.value, type: typeSelect.value, category: categorySelect.value, sub: subSelect.value };
  };
  for (const element of [keywordInput, typeSelect, categorySelect, subSelect]) {
    element.addEventListener('input', remember);
    element.addEventListener('change', remember);
  }
}


/* -----------------------------------------------------------
   固定費（家賃など）を毎月自動で記録する
   登録すると、毎月の指定日に入出金として自動で記録される（記録の計算は 05-calculations.js、
   自動で記録する処理は 04-state-and-storage.js の applyRecurringRules）。
   ----------------------------------------------------------- */

// 入力欄に入れておく内容: { index: 直している固定費の番号（新しく作るなら null）, values: {...} }（なければ null）
let recurringFormState = null;
// 「削除」を押して確認待ちになっている固定費の番号（なければ null）
let deletingRecurringIndex = null;

function recurringDayText(day) {
  return Number(day) >= 31 ? '月末' : Number(day) + '日';
}

function settingsRecurringCardHtml() {
  const list = appState.profile.recurring;
  const isEditing = recurringFormState !== null && recurringFormState.index !== null;

  let html = '<section class="card span-12" id="recurringCard">';
  html += '<div class="card-head"><h2>固定費（毎月自動で記録）</h2><span class="sub">家賃・サブスクなど</span></div>';

  // 登録ずみの一覧
  if (list.length === 0) {
    html += '<p class="hint">まだありません。下から登録すると、毎月の指定日に自動で記録されます。</p>';
  } else {
    html += '<ul class="plain-list">';
    for (let index = 0; index < list.length; index++) {
      const rule = list[index];
      const category = CATEGORY_BY_ID[rule.category];
      html += '<li><span class="grow"><span>' + escapeHtml(rule.description) + '</span><span class="small muted">毎月' + recurringDayText(rule.day) + ' · ' +
        formatYen(rule.amount) + ' · ' + escapeHtml(category ? category.name : '') + ' · ' + escapeHtml(accountName(rule.account)) + '</span></span>' +
        '<button type="button" class="btn small ghost" data-action="edit-recurring" data-index="' + index + '">直す</button>' +
        '<button type="button" class="icon-btn" data-action="delete-recurring" data-index="' + index + '" aria-label="この固定費を削除">' + iconSvg('close') + '</button></li>';
      if (deletingRecurringIndex === index) {
        html += confirmBoxHtml('「' + escapeHtml(rule.description) + '」の固定費を削除します。これまでに記録された分は消えません。', '削除する',
          'delete-recurring-yes', 'delete-recurring-no', { tag: 'li', small: true, data: 'data-index="' + index + '"' });
      }
    }
    html += '</ul>';
  }

  // 追加・更新のフォーム
  let dayOptions = '';
  for (let day = 1; day <= 31; day++) {
    dayOptions += '<option value="' + day + '">' + (day === 31 ? '月末' : day + '日') + '</option>';
  }
  // 入力欄は「＋ 固定費を追加する」を押したときだけ開く（直しているとき・書きかけ・まだ1つもないときは、はじめから開く）
  const isFormOpen = isEditing || recurringFormState !== null || list.length === 0 || settingsOpenForms.recurring;
  html += '<details class="more form-box" data-form-box="recurring"' + (isFormOpen ? ' open' : '') + '><summary>' + (isEditing ? '固定費を直す' : '＋ 固定費を追加する') + '</summary>';
  html += '<div class="recurring-form">' +
    '<label class="field"><span>名前</span><input id="recurringName" autocomplete="off" placeholder="例: 家賃"></label>' +
    '<label class="field"><span>金額</span><div class="amount-input"><span aria-hidden="true">¥</span><input id="recurringAmount" inputmode="numeric" autocomplete="off" placeholder="80000"></div></label>' +
    '<label class="field"><span>毎月の日</span><select id="recurringDay">' + dayOptions + '</select></label>' +
    '<label class="field"><span>大項目</span><select id="recurringCategory"></select></label>' +
    '<label class="field"><span>中項目</span><select id="recurringSub"></select></label>' +
    '<label class="field"><span>支払元の口座</span><select id="recurringAccount"></select></label>' +
    '<label class="field"><span>いつの月から</span><input type="month" id="recurringStart"></label>' +
    '</div>';
  html += '<p class="form-error" id="recurringError" role="alert"></p>';
  html += '<div class="row-gap" style="margin-top:8px"><button type="button" class="btn primary" data-action="save-recurring">' + (isEditing ? '更新' : '追加') + '</button>' +
    (recurringFormState !== null ? '<button type="button" class="btn ghost" data-action="cancel-recurring">やめる</button>' : '') + '</div>';
  html += '</details>';
  html += '</section>';
  return html;
}

/** 固定費フォームの選択肢を作り、直すときは内容を入れておく */
function setupRecurringForm() {
  const categorySelect = findOne('#recurringCategory');
  const subSelect = findOne('#recurringSub');
  const accountSelect = findOne('#recurringAccount');
  if (!categorySelect) {
    return;
  }
  const values = recurringFormState ? recurringFormState.values : {};

  fillCategorySelect(categorySelect, 'expense', values.category || 'housing');
  fillSubcategorySelect(subSelect, categorySelect.value, values.sub || '');
  categorySelect.addEventListener('change', () => fillSubcategorySelect(subSelect, categorySelect.value, ''));

  let accountHtml = '';
  for (const account of appState.profile.accounts) {
    const selected = account.id === values.account ? ' selected' : '';
    accountHtml += '<option value="' + escapeHtml(account.id) + '"' + selected + '>' + escapeHtml(account.name) + '</option>';
  }
  accountSelect.innerHTML = accountHtml;

  findOne('#recurringName').value = values.description || '';
  findOne('#recurringAmount').value = values.amount ? String(values.amount) : '';
  findOne('#recurringDay').value = String(values.day || 1);
  findOne('#recurringStart').value = values.startMonth || todayText().slice(0, 7);

  // 打った内容を書きかけとして覚える（ほかのボタンで画面を描き直しても消えないように）
  const fieldIds = ['#recurringName', '#recurringAmount', '#recurringDay', '#recurringStart', '#recurringCategory', '#recurringSub', '#recurringAccount'];
  const remember = () => {
    const index = recurringFormState ? recurringFormState.index : null;
    recurringFormState = {
      index: index,
      values: {
        description: findOne('#recurringName').value,
        amount: findOne('#recurringAmount').value,
        day: findOne('#recurringDay').value,
        startMonth: findOne('#recurringStart').value,
        category: categorySelect.value,
        sub: subSelect.value,
        account: accountSelect.value,
      },
    };
  };
  for (const id of fieldIds) {
    findOne(id).addEventListener('input', remember);
    findOne(id).addEventListener('change', remember);
  }
}

/** 「追加」「更新」が押されたとき */
function saveRecurringFromForm() {
  const errorArea = findOne('#recurringError');
  const description = findOne('#recurringName').value.trim();
  const amount = calculateAmount(findOne('#recurringAmount').value);
  const startMonth = findOne('#recurringStart').value;
  if (description === '') {
    errorArea.textContent = '名前を入れてください（例: 家賃）。';
    return;
  }
  if (amount === null || Number.isNaN(amount) || amount <= 0) {
    errorArea.textContent = '金額を1円以上の数字で入れてください。';
    return;
  }
  if (!/^\d{4}-\d{2}$/.test(startMonth)) {
    errorArea.textContent = 'いつの月からかを選んでください。';
    return;
  }
  const accountId = findOne('#recurringAccount').value;
  if (!accountById[accountId]) {
    errorArea.textContent = '口座を選んでください。';
    return;
  }

  const fields = {
    description: description,
    amount: amount,
    category: findOne('#recurringCategory').value,
    sub: findOne('#recurringSub').value,
    account: accountId,
    day: Number(findOne('#recurringDay').value),
    startMonth: startMonth,
  };
  const list = appState.profile.recurring;
  if (recurringFormState !== null && recurringFormState.index !== null && list[recurringFormState.index]) {
    // 直す: 記録ずみの月（generatedUntil）はそのまま。これからの月から新しい内容になる
    Object.assign(list[recurringFormState.index], fields);
    showToast('固定費を更新しました');
  } else {
    list.push({ id: makeId(), generatedUntil: '', ...fields });
    showToast('固定費を追加しました');
  }
  recurringFormState = null;
  settingsOpenForms.recurring = false; // 登録できたら入力欄はたたむ
  saveProfile();
  applyRecurringRules(); // 指定日がもう過ぎている月があれば、すぐ記録する
}

function startRecurringEdit(index) {
  const rule = appState.profile.recurring[index];
  if (!rule) {
    return;
  }
  recurringFormState = { index: index, values: { ...rule } };
  renderApp();
  findOne('#recurringName').scrollIntoView({ block: 'center' });
}

/** 家計簿の「毎月の支払い・サブスク」から、固定費に登録する（入力欄に内容を入れた状態で設定画面を開く） */
function startRecurringFromFound(index) {
  const found = findRecurringPayments(appState.period)[index];
  if (!found) {
    return;
  }
  recurringFormState = {
    index: null,
    values: { description: found.description, amount: found.amount, category: found.category, sub: found.sub, day: found.day, account: '' },
  };
  goToScreen('settings');
  findOne('#recurringName').scrollIntoView({ block: 'center' });
}

function cancelRecurringEdit() {
  recurringFormState = null;
  settingsOpenForms.recurring = false;
  renderApp();
}

function deleteRecurringConfirmed(index) {
  appState.profile.recurring.splice(index, 1);
  deletingRecurringIndex = null;
  recurringFormState = null;
  saveProfile();
  showToast('固定費を削除しました');
}


/* -----------------------------------------------------------
   1か月の始まりの日
   ----------------------------------------------------------- */
function settingsPeriodCardHtml() {
  const startDay = getStartDay();
  let options = '';
  for (let day = 1; day <= 28; day++) {
    options += '<option value="' + day + '"' + (day === startDay ? ' selected' : '') + '>' + day + '日</option>';
  }
  const period = periodOf(todayText());
  return '<section class="card span-6">' +
    '<div class="card-head"><h2>集計期間</h2></div>' +
    '<div class="setting"><label for="startDaySelect"><strong>1か月の始まりの日</strong><br><span class="hint">給料日が25日なら「25日」に</span></label>' +
    '<select id="startDaySelect">' + options + '</select></div>' +
    '<p class="small muted" style="margin-top:12px">今の期間: ' + periodTitle(period) + '（' + periodRangeText(period) + '）</p>' +
    '</section>';
}


/* -----------------------------------------------------------
   データの取り込み・書き出し
   ----------------------------------------------------------- */
function settingsDataCardHtml() {
  return '<section class="card span-6">' +
    '<div class="card-head"><h2>データの取り込み・書き出し</h2></div>' +
    '<div class="settings-list">' +
    '<div class="setting"><span><strong>CSVを取り込む</strong></span>' +
    '<button type="button" class="btn small" data-action="open-import" data-icon="upload">取り込む</button></div>' +
    '<div class="setting"><span><strong>CSVで書き出す</strong></span>' +
    '<button type="button" class="btn small" data-action="export-csv" data-icon="download">書き出す</button></div>' +
    '<div class="setting"><span><strong>バックアップ</strong></span>' +
    '<span class="row-gap"><button type="button" class="btn small" data-action="export-backup" data-icon="download">保存</button>' +
    '<button type="button" class="btn small" data-action="restore-backup" data-icon="upload">戻す</button></span></div>' +
    '<div class="setting"><span><strong>別のスマホ・アプリへ移す</strong></span>' +
    '<span class="row-gap"><button type="button" class="btn small" data-action="show-backup-text">文字でコピー</button>' +
    '<button type="button" class="btn small" data-action="open-paste-restore">貼り付けて戻す</button></span></div>' +
    '<p class="hint">' + escapeHtml(backupSafetyText()) + '</p>' + // 17-csv-and-backup.js
    importUndoHtml() +
    '</div>' +
    flippedCopiesHtml() +
    '</section>';
}

// 「前回の取り込みを取り消す」の確認を出しているか / 「向きが逆の明細」の一覧を開いているか
let isImportUndoConfirmOpen = false;
let isFlippedListOpen = false;

/** 前回の取り込みを取り消す行（取り込んだ明細が残っているときだけ） */
function importUndoHtml() {
  const imported = lastImportedTransactions(); // 17-csv-and-backup.js
  if (imported.length === 0) {
    return '';
  }
  const lastImport = appState.profile.settings.lastImport;
  let html = '<div class="setting"><span><strong>前回の取り込み</strong><br><span class="hint">' +
    escapeHtml(lastImport.fileName || 'CSV') + ' · ' + escapeHtml(lastImport.at || '') + ' · 残り' + imported.length + '件</span></span>' +
    '<button type="button" class="btn small" data-action="undo-import">取り消す</button></div>';
  if (isImportUndoConfirmOpen) {
    html += confirmBoxHtml('前回の取り込みで入った ' + imported.length + '件を削除します。ほかの明細は消えません。', imported.length + '件を削除',
      'undo-import-yes', 'undo-import-no');
  }
  return html;
}

/** 向きが逆に入った明細（前の版の取り込みで、収入が支出になったものなど）のお知らせと一覧 */
function flippedCopiesHtml() {
  const pairs = findFlippedCopies(allTransactions); // 17-csv-and-backup.js
  if (pairs.length === 0) {
    return '';
  }
  let html = '<div class="confirm-box" style="margin-top:14px"><p><strong>向きが逆に入った明細が ' + pairs.length + '件あります。</strong>' +
    '同じ日・同じ金額・同じ内容で、収入と支出が1件ずつあります。あとから入った方（取り込みで向きが逆になったもの）を消せます。</p>';
  if (!isFlippedListOpen) {
    html += '<div class="row-gap"><button type="button" class="btn small" data-action="show-flipped">一覧を見る</button></div></div>';
    return html;
  }
  html += '<ul class="plain-list">';
  for (const pair of pairs.slice(0, 100)) {
    const copy = pair.copy;
    html += '<li><span class="grow"><span>' + escapeHtml(copy.description || '（内容なし）') + '</span>' +
      '<span class="small muted">' + copy.date + ' · ' + escapeHtml(accountName(copy.account)) + ' · 正しい方: ' + (pair.original.type === 'income' ? '収入' : '支出') + '</span></span>' +
      '<span class="num">消す方: ' + (copy.type === 'income' ? '収入 ' : '支出 ') + formatYen(copy.amount) + '</span></li>';
  }
  html += '</ul><div class="row-gap"><button type="button" class="btn danger" data-action="delete-flipped-yes">あとから入った ' + pairs.length + '件を削除</button>' +
    '<button type="button" class="btn ghost" data-action="hide-flipped">やめる</button></div></div>';
  return html;
}


/* -----------------------------------------------------------
   数字の点検（中身は 06-credit-card-billing.js の findNumberProblems）
   この端末の中だけで調べて、結果を画面に出す（外へは何も送らない）
   ----------------------------------------------------------- */

let isNumberCheckOpen = false;          // 点検の結果を出しているか
let isDuplicateFixConfirmOpen = false;  // 「同じ記録を1つにする」の確認を出しているか

function settingsNumberCheckCardHtml() {
  let html = '<section class="card span-12" id="numberCheckCard">' +
    '<div class="card-head"><h2>数字の点検</h2><span class="sub">二重に数えていないか・数字が合っているか</span></div>';
  if (!isNumberCheckOpen) {
    html += '<p class="hint">カードの請求が多すぎる・少なすぎるなど、数字がおかしいと思ったときに押してください。この端末の中だけで調べて、外へは何も送りません。</p>' +
      '<div class="row-gap" style="margin-top:10px"><button type="button" class="btn primary" data-action="run-number-check">点検する</button></div>';
    return html + '</section>';
  }

  const result = findNumberProblems();
  if (result.problems.length === 0) {
    html += '<p>' + statusChipHtml('good', '問題なし') + ' 二重に数えている記録や、合わない数字は見つかりませんでした。</p>';
  } else {
    html += '<p>' + statusChipHtml('warn', result.problems.length + '件') + ' 気になるところが見つかりました。上から順に確かめてください。</p>';
    html += '<ul class="check-list">';
    for (const problem of result.problems) {
      html += '<li class="check-item"><p><strong>' + escapeHtml(problem.title) + '</strong></p>' +
        numberCheckLinesHtml(problem) +
        '<p class="hint">' + escapeHtml(problem.explain) + '</p>' +
        numberCheckActionHtml(problem) + '</li>';
    }
    html += '</ul>';
  }

  // カードごとの「これから払う金額」の内訳（どの行が多いかで、原因が分かる）
  if (result.cards.length > 0) {
    html += '<h3 class="check-subhead">カードの「これから払う金額」の内訳</h3>' +
      '<p class="hint">まだ記録していない請求を全部足したものです。多すぎるときは、どの行が多いかを見てください。</p>';
    for (const card of result.cards) {
      html += '<div class="check-breakdown"><div class="check-breakdown-head"><span>' + escapeHtml(card.account.name) + '</span>' +
        '<strong class="num">' + formatYen(card.total) + '</strong></div>';
      if (card.rows.length === 0) {
        html += '<p class="small muted">これから払う請求はありません。</p>';
      }
      for (const row of card.rows) {
        html += '<div class="sub-row"><span>' + escapeHtml(row.label) + '</span><span class="num">' + formatYen(row.amount) + '</span></div>';
      }
      html += '<button type="button" class="link-btn" data-action="go-card" data-id="' + escapeHtml(card.account.id) + '">カード画面で見る</button></div>';
    }
  }
  html += '<div class="row-gap" style="margin-top:14px"><button type="button" class="btn small" data-action="run-number-check">もう一度点検する</button>' +
    '<button type="button" class="btn small ghost" data-action="close-number-check">閉じる</button></div>';
  return html + '</section>';
}

/** 点検の1件の中身（記録1件ずつのときは、押すとその記録が開く） */
function numberCheckLinesHtml(problem) {
  let html = '<ul class="check-lines">';
  for (let index = 0; index < problem.lines.length; index++) {
    const recordId = problem.recordIds[index];
    if (recordId) {
      html += '<li><button type="button" class="sub-row sub-link" data-action="edit-transaction" data-id="' + escapeHtml(recordId) + '">' +
        '<span>' + escapeHtml(problem.lines[index]) + '</span>' + iconSvg('chevron-right') + '</button></li>';
    } else {
      html += '<li>' + escapeHtml(problem.lines[index]) + '</li>';
    }
  }
  return html + '</ul>';
}

/** 点検の1件の下に出すボタン（同じ記録を1つにする・カード画面へ） */
function numberCheckActionHtml(problem) {
  if (problem.action.kind === 'fix-duplicates') {
    if (isDuplicateFixConfirmOpen) {
      return confirmBoxHtml('同じ記録のうち、余分なほうを消して1つにします。', '1つにする', 'fix-duplicates-yes', 'fix-duplicates-no');
    }
    return '<div class="row-gap"><button type="button" class="btn small" data-action="fix-duplicates">1つにする</button></div>';
  }
  if (problem.action.kind === 'card') {
    return '<div class="row-gap"><button type="button" class="btn small" data-action="go-card" data-id="' + escapeHtml(problem.action.id) + '">カード画面へ</button></div>';
  }
  return ''; // 記録1件ずつのときは、上の行を押すと開く
}

/** カード画面などから「数字の点検」へ移って、点検の結果を出す */
function goToNumberCheck() {
  goToScreen('settings');
  isNumberCheckOpen = true;
  renderApp();
  requestAnimationFrame(() => {
    const card = findOne('#numberCheckCard');
    if (card) {
      card.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
  });
}


/* -----------------------------------------------------------
   自動分類ルール
   ----------------------------------------------------------- */
function settingsRulesCardHtml() {
  const rules = appState.profile.rules;
  const isEditingRule = rulePosition(editingRuleKey) !== -1;
  const deletingIndex = rulePosition(deletingRuleKey);
  let html = '<section class="card span-12">';
  html += '<div class="card-head"><h2>自動分類ルール</h2><span class="sub">キーワード → カテゴリ</span></div>';

  // 追加フォーム（「＋ ルールを自分で追加する」を押したときだけ開く。直しているとき・書きかけのときは、はじめから開く）
  const isRuleFormOpen = isEditingRule || ruleFormDraft !== null || settingsOpenForms.rule;
  html += '<p class="hint">お店の名前（キーワード）が入った記録を、決めたカテゴリに自動で分けます。記録するときにカテゴリを直すと、ここに自動で増えます。</p>';
  html += '<details class="more form-box" data-form-box="rule"' + (isRuleFormOpen ? ' open' : '') + '><summary>' + (isEditingRule ? 'ルールを直す' : '＋ ルールを自分で追加する') + '</summary>';
  html += '<div class="rule-form">' +
    '<label class="field"><span>キーワード（お店の名前など）</span><input id="ruleKeyword" autocomplete="off" placeholder="例: まるみや"></label>' +
    '<label class="field"><span>種類</span><select id="ruleType"><option value="expense">支出</option><option value="income">収入</option></select></label>' +
    '<label class="field"><span>大項目</span><select id="ruleCategory"></select></label>' +
    '<label class="field"><span>中項目</span><select id="ruleSub"></select></label>' +
    '<div class="row-gap" style="align-self:end">' +
    '<button type="button" class="btn primary" data-action="add-rule">' + (isEditingRule ? '更新' : '追加') + '</button>' +
    (isEditingRule ? '<button type="button" class="btn ghost" data-action="cancel-rule-edit">やめる</button>' : '') +
    '</div></div></details>';

  html += '<p class="small muted" style="margin-block:14px 6px">あなたのルール（' + rules.length + '件）</p>';
  if (rules.length === 0) {
    html += '<p class="hint">まだありません。</p>';
  } else {
    html += '<ul class="plain-list">';
    for (let index = 0; index < rules.length; index++) {
      const rule = rules[index];
      const category = CATEGORY_BY_ID[rule.category];
      html += '<li><span class="grow"><span>' + escapeHtml(rule.keyword) + '</span><span class="small muted">' +
        (rule.type === 'income' ? '収入' : '支出') + ' → ' + escapeHtml(category ? category.name : rule.category) + ' / ' + escapeHtml(rule.sub) + '</span></span>' +
        '<button type="button" class="btn small ghost" data-action="edit-rule" data-index="' + index + '">直す</button>' +
        '<button type="button" class="icon-btn" data-action="delete-rule" data-index="' + index + '" aria-label="このルールを削除">' + iconSvg('close') + '</button></li>';
      if (deletingIndex === index) {
        html += confirmBoxHtml('「' + escapeHtml(rule.keyword) + '」のルールを削除します。これまでの記録のカテゴリは変わりません。', '削除する',
          'delete-rule-yes', 'delete-rule-no', { tag: 'li', small: true });
      }
    }
    html += '</ul>';
  }

  // はじめから入っているルール（見るだけ）
  html += '<details class="more"><summary>はじめから入っているルールを見る（' + BUILT_IN_RULES.length + '件）</summary><ul class="plain-list">';
  for (const rule of BUILT_IN_RULES) {
    const category = CATEGORY_BY_ID[rule.category];
    html += '<li><span class="grow"><span style="white-space:normal">' + escapeHtml(rule.words.join('、')) + '</span><span class="small muted">→ ' + escapeHtml(category.name) + ' / ' + escapeHtml(rule.sub) + '</span></span></li>';
  }
  html += '</ul><p class="hint">これらは js/01-categories.js の BUILT_IN_RULES で変更できます。</p></details>';
  html += '</section>';
  return html;
}

/** ルール追加ボタンが押されたとき */
function addRuleFromForm() {
  const keyword = findOne('#ruleKeyword').value.trim();
  if (keyword === '') {
    showToast('キーワードを入れてください');
    return;
  }
  const editingIndex = rulePosition(editingRuleKey);
  ruleFormDraft = null; // 書きかけは使い終わった
  settingsOpenForms.rule = false; // 登録できたら入力欄はたたむ
  if (editingIndex !== -1) {
    const newRule = { keyword: keyword, type: findOne('#ruleType').value, category: findOne('#ruleCategory').value, sub: findOne('#ruleSub').value };
    appState.profile.rules = replaceRuleAt(appState.profile.rules, editingIndex, newRule);
    editingRuleKey = null;
    saveProfile();
    showToast('ルールを更新しました');
    return;
  }
  editingRuleKey = null;
  rememberCategoryRule(keyword, findOne('#ruleType').value, findOne('#ruleCategory').value, findOne('#ruleSub').value);
  saveProfile();
  showToast('ルールを追加しました');
}

/** ルールの「直す」ボタンが押されたとき（入力欄に内容を入れて、更新できるようにする） */
function startRuleEdit(index) {
  const rule = appState.profile.rules[index];
  if (!rule) {
    return;
  }
  editingRuleKey = { keyword: rule.keyword, type: rule.type };
  ruleFormDraft = null;
  renderApp();
  findOne('#ruleKeyword').scrollIntoView({ block: 'center' });
}

/** 「やめる」が押されたとき */
function cancelRuleEdit() {
  editingRuleKey = null;
  ruleFormDraft = null;
  settingsOpenForms.rule = false;
  renderApp();
}

/** ルールの「×」が押されたとき: 削除してよいかの確認を出す（index が -1 なら確認を閉じる） */
function askDeleteRule(index) {
  const rule = appState.profile.rules[index];
  deletingRuleKey = rule ? { keyword: rule.keyword, type: rule.type } : null;
  renderApp();
}

/** 確認で「削除する」が押されたとき */
function deleteRuleConfirmed() {
  const index = rulePosition(deletingRuleKey);
  deletingRuleKey = null;
  if (index === -1) {
    renderApp();
    return;
  }
  if (rulePosition(editingRuleKey) === index) {
    editingRuleKey = null;
  }
  appState.profile.rules.splice(index, 1);
  saveProfile();
  showToast('ルールを削除しました');
}


/* -----------------------------------------------------------
   保存先とデータの全削除
   ----------------------------------------------------------- */
function settingsStorageCardHtml() {
  let explanation = '';
  if (appState.isSample) {
    explanation = '今はサンプルを表示しています。変更は保存されません。';
  } else if (appState.storageMode === 'cloud') {
    explanation = 'あなたのClaudeアカウントに保存しています。このページを共有しても、他の人にはあなたのデータは見えません（その人自身のデータが表示されます）。';
  } else if (appState.storageMode === 'browser') {
    explanation = 'このブラウザの中に保存しています。別の端末やブラウザとは共有されません。ブラウザの履歴やサイトデータを消すと、記録も消えます。ときどきバックアップを保存してください。';
  } else {
    explanation = 'この環境では保存できません。ページを閉じると記録は消えます。';
  }

  let html = '<section class="card span-12">';
  html += '<div class="card-head"><h2>保存先</h2><span class="sub">' + escapeHtml(describeSaveStatus()) + '</span></div>';
  html += '<p class="small">' + explanation + '</p>';

  if (appState.isSample) {
    html += '<div class="row-gap" style="margin-top:12px"><button type="button" class="btn primary" data-action="start-own">自分の家計簿をはじめる</button></div>';
  } else if (!isWipeConfirmOpen) {
    html += '<div class="row-gap" style="margin-top:12px"><button type="button" class="btn ghost danger-text" data-action="wipe">すべてのデータを削除</button></div>';
  } else {
    html += '<div class="confirm-box" style="margin-top:12px"><p>口座・入出金・予算・ルールをすべて削除します。元に戻せません。先にバックアップを保存することをおすすめします。</p>' +
      '<label class="field"><span>まちがえて消さないように、「削除」と入力してください</span><input id="wipeConfirmWord" autocomplete="off" autocapitalize="off" spellcheck="false"></label>' +
      '<div class="row-gap"><button type="button" class="btn danger" data-action="wipe-yes" id="wipeYesButton" disabled>すべて削除する</button>' +
      '<button type="button" class="btn ghost" data-action="wipe-no">やめる</button></div></div>';
  }
  html += '</section>';
  return html;
}


/* -----------------------------------------------------------
   カテゴリの選択肢を作る（ほかの画面・ダイアログでも使う）
   ----------------------------------------------------------- */

/** 大項目の <select> に選択肢を入れる */
function fillCategorySelect(select, type, selectedId) {
  let html = '';
  for (const category of getCategoriesForType(type)) {
    html += '<option value="' + category.id + '"' + (category.id === selectedId ? ' selected' : '') + '>' + category.name + '</option>';
  }
  select.innerHTML = html;
}

/** 中項目の <select> に選択肢を入れる */
function fillSubcategorySelect(select, categoryId, selectedSub) {
  const category = CATEGORY_BY_ID[categoryId];
  const subs = category ? [...category.subs] : [];
  // 保存されている中項目が一覧にない場合（CSVなど）も選べるようにする
  if (selectedSub && !subs.includes(selectedSub)) {
    subs.push(selectedSub);
  }
  let html = '';
  for (const sub of subs) {
    html += '<option value="' + escapeHtml(sub) + '"' + (sub === selectedSub ? ' selected' : '') + '>' + escapeHtml(sub) + '</option>';
  }
  select.innerHTML = html;
}
