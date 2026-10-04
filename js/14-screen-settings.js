/* ===========================================================
   14-screen-settings.js  ―  設定画面
   -----------------------------------------------------------
     ・1か月の始まりの日（給料日に合わせるなど）
     ・データの取り込み・書き出し（CSV・バックアップ）
     ・自動分類ルールの確認と追加
     ・保存先の表示と、データの全削除
   =========================================================== */

// 「すべてのデータを削除」の確認を出しているか
let isWipeConfirmOpen = false;

const SettingsScreen = {
  title: '設定',
  usesPeriod: false,

  html() {
    let html = '<div class="grid">';
    html += settingsPeriodCardHtml();
    html += settingsDataCardHtml();
    html += lockCardHtml();            // 21-encryption-lock.js
    html += rulesDataCardHtml();       // 20-rules-alerts.js
    html += settingsRecurringCardHtml();
    html += mailImportCardHtml();      // 22-mail-import.js
    html += settingsRulesCardHtml();
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

    setupRecurringForm();

    // 直しているルールがあれば、その内容を入力欄に入れておく
    const editingRule = appState.profile.rules[editingRuleIndex];
    if (editingRuleIndex !== null && editingRule) {
      findOne('#ruleKeyword').value = editingRule.keyword;
      typeSelect.value = editingRule.type;
      fillCategorySelect(categorySelect, editingRule.type, editingRule.category);
      fillSubcategorySelect(subSelect, editingRule.category, editingRule.sub);
    }
  },
};

// 今「直す」を押しているルールの番号（なければ null）
let editingRuleIndex = null;


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
        html += '<li class="confirm-box"><p>「' + escapeHtml(rule.description) + '」の固定費を削除します。これまでに記録された分は消えません。</p>' +
          '<div class="row-gap"><button type="button" class="btn danger small" data-action="delete-recurring-yes" data-index="' + index + '">削除する</button>' +
          '<button type="button" class="btn ghost small" data-action="delete-recurring-no">やめる</button></div></li>';
      }
    }
    html += '</ul>';
  }

  // 追加・更新のフォーム
  let dayOptions = '';
  for (let day = 1; day <= 31; day++) {
    dayOptions += '<option value="' + day + '">' + (day === 31 ? '月末' : day + '日') + '</option>';
  }
  html += '<p class="small muted" style="margin-block:14px 6px">' + (isEditing ? '固定費を直す' : '固定費を追加') + '</p>';
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
    '</div></section>';
}


/* -----------------------------------------------------------
   自動分類ルール
   ----------------------------------------------------------- */
function settingsRulesCardHtml() {
  const rules = appState.profile.rules;
  let html = '<section class="card span-12">';
  html += '<div class="card-head"><h2>自動分類ルール</h2><span class="sub">キーワード → カテゴリ</span></div>';

  // 追加フォーム
  html += '<div class="rule-form">' +
    '<label class="field"><span>キーワード（お店の名前など）</span><input id="ruleKeyword" autocomplete="off" placeholder="例: まるみや"></label>' +
    '<label class="field"><span>種類</span><select id="ruleType"><option value="expense">支出</option><option value="income">収入</option></select></label>' +
    '<label class="field"><span>大項目</span><select id="ruleCategory"></select></label>' +
    '<label class="field"><span>中項目</span><select id="ruleSub"></select></label>' +
    '<div class="row-gap" style="align-self:end">' +
    '<button type="button" class="btn primary" data-action="add-rule">' + (editingRuleIndex !== null ? '更新' : '追加') + '</button>' +
    (editingRuleIndex !== null ? '<button type="button" class="btn ghost" data-action="cancel-rule-edit">やめる</button>' : '') +
    '</div></div>';

  html += '<p class="small muted" style="margin-block:14px 6px">あなたのルール（' + rules.length + '件）· 入力中にカテゴリを直すと自動で増えます</p>';
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
  if (editingRuleIndex !== null && appState.profile.rules[editingRuleIndex]) {
    const newRule = { keyword: keyword, type: findOne('#ruleType').value, category: findOne('#ruleCategory').value, sub: findOne('#ruleSub').value };
    appState.profile.rules = replaceRuleAt(appState.profile.rules, editingRuleIndex, newRule);
    editingRuleIndex = null;
    saveProfile();
    showToast('ルールを更新しました');
    return;
  }
  rememberCategoryRule(keyword, findOne('#ruleType').value, findOne('#ruleCategory').value, findOne('#ruleSub').value);
  saveProfile();
  showToast('ルールを追加しました');
}

/** ルールの「直す」ボタンが押されたとき（入力欄に内容を入れて、更新できるようにする） */
function startRuleEdit(index) {
  editingRuleIndex = index;
  renderApp();
  findOne('#ruleKeyword').scrollIntoView({ block: 'center' });
}

/** 「やめる」が押されたとき */
function cancelRuleEdit() {
  editingRuleIndex = null;
  renderApp();
}

/** ルール削除ボタンが押されたとき */
function deleteRule(index) {
  editingRuleIndex = null;
  appState.profile.rules.splice(index, 1);
  saveProfile();
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
      '<div class="row-gap"><button type="button" class="btn danger" data-action="wipe-yes">すべて削除する</button>' +
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
