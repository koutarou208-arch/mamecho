/* ===========================================================
   11-screen-budget.js  ―  予算画面
   -----------------------------------------------------------
   カテゴリごとに「1か月にいくらまで使うか」を決めて、
   今どれくらい使ったかをバーで表示します。

   バーの中の黒い縦線は「今日までに使っていいペース」の目安です。
   （期間の半分が過ぎたら、縦線はバーの真ん中にあります）
   バーが縦線より右に出ていたら、使うペースが速いということです。

   「予算を編集」を押すと入力欄に切りかわります（appState.budgetDraft）。
   =========================================================== */

const BudgetScreen = {
  title: '予算',
  usesPeriod: true,

  html() {
    if (appState.budgetDraft !== null) {
      return budgetEditHtml();
    }
    return budgetViewHtml(appState.period);
  },

  afterRender() {
    // 編集中なら、入力のたびに下書きへ書き写す
    if (appState.budgetDraft === null) {
      return;
    }
    for (const input of findAll('[data-budget-input]')) {
      input.addEventListener('input', () => {
        appState.budgetDraft[input.dataset.budgetInput] = input.value;
      });
    }
  },
};


/* -----------------------------------------------------------
   見るモード
   ----------------------------------------------------------- */
function budgetViewHtml(period) {
  const summary = summarizePeriod(period);
  const budgets = appState.profile.budgets;
  const budget = totalBudget();
  const elapsed = elapsedRatio(period);
  const range = periodRange(period);
  const totalDays = daysBetween(range.start, range.end);
  const passedDays = Math.round(elapsed * totalDays);

  let html = '<div class="grid">';

  // --- 全体のまとめ ---
  html += '<section class="card span-12">';
  html += '<div class="card-head"><h2>' + periodShortTitle(period) + 'の予算</h2><span class="sub">' + periodRangeText(period) + ' · ' + passedDays + '日目 / ' + totalDays + '日</span>' +
    '<button type="button" class="btn small" style="margin-left:auto" data-action="edit-budget">予算を編集</button></div>';

  if (budget === 0) {
    html += '<p class="empty-note">まだ予算がありません。「予算を編集」から決められます。</p>';
    html += '</section></div>';
    return html;
  }

  const left = budget - summary.spending;
  const status = budgetStatus(summary.spending, budget, elapsed);
  html += '<div class="stats">' +
    '<div class="stat"><span class="label">予算</span><span class="value num">' + formatYen(budget) + '</span></div>' +
    '<div class="stat"><span class="label">使った金額</span><span class="value num">' + formatYen(summary.spending) + '</span></div>' +
    '<div class="stat"><span class="label">残り</span><span class="value num total">' + formatYen(left) + '</span></div>' +
    '</div>';
  html += '<div style="margin-top:14px">' + budgetMeterHtml(summary.spending, budget, elapsed, status) + '</div>';
  html += '<p class="small muted" style="margin-top:8px">黒い縦線は「今日までに使っていい金額」の目安です。' + statusChipHtml(status) + '</p>';
  html += '</section>';

  // --- カテゴリごと ---
  html += '<section class="card span-8"><div class="card-head"><h2>カテゴリごと</h2></div><div class="budget-list">';
  const unbudgeted = [];
  for (const category of LIVING_EXPENSE_CATEGORIES) {
    const limit = Number(budgets[category.id]) || 0;
    const spent = summary.categories[category.id] ? summary.categories[category.id].total : 0;
    if (limit <= 0) {
      if (spent > 0) {
        unbudgeted.push({ category: category, spent: spent });
      }
      continue;
    }
    const categoryStatus = budgetStatus(spent, limit, elapsed);
    const remain = limit - spent;
    html += '<div class="budget-row">';
    html += '<span class="cat-name"><span class="mark" aria-hidden="true">' + category.mark + '</span><span>' + category.name + '</span></span>';
    html += '<div class="meter-wrap">' + budgetMeterHtml(spent, limit, elapsed, categoryStatus) +
      '<div class="budget-figures"><span class="num">' + formatYen(spent) + ' / ' + formatYen(limit) + '</span>' +
      '<span class="num">' + (remain >= 0 ? '残り ' + formatYen(remain) : formatYen(-remain) + ' 超過') + '</span></div></div>';
    html += statusChipHtml(categoryStatus);
    html += '</div>';
  }
  html += '</div>';
  if (unbudgeted.length > 0) {
    html += '<hr class="divider"><p class="small muted" style="margin-bottom:6px">予算を決めていない支出</p><ul class="plain-list">';
    for (const item of unbudgeted) {
      html += '<li><span>' + item.category.name + '</span><span class="num">' + formatYen(item.spent) + '</span></li>';
    }
    html += '</ul>';
  }
  html += '</section>';

  // --- 貯金目標 ---
  const goal = Number(appState.profile.settings.savingsGoal) || 0;
  const saved = summary.income - summary.expense;
  html += '<section class="card span-4"><div class="card-head"><h2>貯金目標</h2></div>';
  if (goal > 0) {
    const goalPercent = Math.max(0, Math.min(100, (saved / goal) * 100));
    html += '<div class="stat"><span class="label">' + periodShortTitle(period) + 'の収支 / 目標</span><span class="value num">' + formatYen(saved, { showPlus: true }) + ' <span class="muted small">/ ' + formatYen(goal) + '</span></span></div>';
    html += '<div class="meter" style="margin-top:12px"><div class="meter-fill" style="width:' + goalPercent.toFixed(1) + '%; background:var(--accent)"></div></div>';
    html += '<p class="small" style="margin-top:10px">' + (saved >= goal ? statusChipHtml('good', '達成') : 'あと <strong class="num">' + formatYen(goal - saved) + '</strong>') + '</p>';
  } else {
    html += '<p class="small muted">「予算を編集」から毎月の貯金目標を決められます。収入から支出を引いた残りが目標に届いたかを表示します。</p>';
  }
  html += '</section>';

  html += '</div>';
  return html;
}

/** 予算のバー（ペースの縦線つき） */
function budgetMeterHtml(spent, limit, elapsed, status) {
  const percent = Math.min(100, (spent / limit) * 100);
  const fillClass = status === 'good' ? '' : status;
  let html = '<div class="meter" role="img" aria-label="' + Math.round((spent / limit) * 100) + '%使用">';
  html += '<div class="meter-fill ' + fillClass + '" style="width:' + percent.toFixed(1) + '%"></div>';
  if (elapsed > 0 && elapsed < 1) {
    html += '<div class="meter-pace" style="left:calc(' + (elapsed * 100).toFixed(1) + '% - 1px)"></div>';
  }
  html += '</div>';
  return html;
}


/* -----------------------------------------------------------
   編集モード
   ----------------------------------------------------------- */
function budgetEditHtml() {
  const draft = appState.budgetDraft;
  let html = '<section class="card">';
  html += '<div class="card-head"><h2>予算を編集</h2></div>';
  html += '<div class="row-gap" style="margin-bottom:12px">' +
    '<button type="button" class="btn small" data-action="fill-budget" data-source="last">先月の実績で入れる</button>' +
    '<button type="button" class="btn small" data-action="fill-budget" data-source="average">3か月平均で入れる</button>' +
    '</div>';

  for (const category of LIVING_EXPENSE_CATEGORIES) {
    html += '<div class="budget-edit-row">' +
      '<label for="budget-' + category.id + '" class="cat-name"><span class="mark" aria-hidden="true">' + category.mark + '</span><span>' + category.name + '</span></label>' +
      '<input id="budget-' + category.id + '" class="budget-input" inputmode="numeric" data-budget-input="' + category.id + '" value="' + escapeHtml(draft[category.id] || '') + '" placeholder="なし">' +
      '</div>';
  }
  html += '<div class="budget-edit-row" style="margin-top:8px">' +
    '<label for="budget-savingsGoal" class="cat-name"><span class="mark" aria-hidden="true">貯</span><span>毎月の貯金目標</span></label>' +
    '<input id="budget-savingsGoal" class="budget-input" inputmode="numeric" data-budget-input="savingsGoal" value="' + escapeHtml(draft.savingsGoal || '') + '" placeholder="なし">' +
    '</div>';

  html += '<p class="form-error" id="budgetError" role="alert"></p>';
  html += '<div class="row-gap" style="margin-top:16px; justify-content:flex-end">' +
    '<button type="button" class="btn ghost" data-action="cancel-budget">やめる</button>' +
    '<button type="button" class="btn primary" data-action="save-budget">保存</button></div>';
  html += '</section>';
  return html;
}

/** 「予算を編集」を押したとき: 今の予算を下書きにコピーする */
function startBudgetEdit() {
  const draft = {};
  for (const category of LIVING_EXPENSE_CATEGORIES) {
    const value = appState.profile.budgets[category.id];
    draft[category.id] = value ? String(value) : '';
  }
  const goal = appState.profile.settings.savingsGoal;
  draft.savingsGoal = goal ? String(goal) : '';
  appState.budgetDraft = draft;
  renderApp();
}

/** 先月の実績（または3か月平均）で下書きをうめる */
function fillBudgetDraft(source) {
  const months = source === 'average' ? 3 : 1;
  for (const category of LIVING_EXPENSE_CATEGORIES) {
    let total = 0;
    for (let back = 1; back <= months; back++) {
      const summary = summarizePeriod(shiftPeriod(appState.period, -back));
      if (summary.categories[category.id]) {
        total = total + summary.categories[category.id].total;
      }
    }
    const average = total / months;
    appState.budgetDraft[category.id] = average > 0 ? String(Math.ceil(average / 1000) * 1000) : '';
  }
  renderApp();
}

/** 下書きを確かめて保存する */
function saveBudgetDraft() {
  const newBudgets = {};
  for (const category of LIVING_EXPENSE_CATEGORIES) {
    const value = calculateAmount(appState.budgetDraft[category.id]);
    if (value === null) {
      continue; // 空欄は予算なし
    }
    if (Number.isNaN(value) || value < 0) {
      findOne('#budgetError').textContent = category.name + 'の金額が読めません。数字で入れてください。';
      return;
    }
    if (value > 0) {
      newBudgets[category.id] = value;
    }
  }
  const goal = calculateAmount(appState.budgetDraft.savingsGoal);
  if (goal !== null && (Number.isNaN(goal) || goal < 0)) {
    findOne('#budgetError').textContent = '貯金目標の金額が読めません。';
    return;
  }

  appState.profile.budgets = newBudgets;
  appState.profile.settings.savingsGoal = goal || 0;
  appState.budgetDraft = null;
  saveProfile();
  showToast('予算を保存しました');
}
