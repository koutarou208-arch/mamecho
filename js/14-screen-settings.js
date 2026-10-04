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
