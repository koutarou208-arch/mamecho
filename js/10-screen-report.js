/* ===========================================================
   10-screen-report.js  ―  家計簿（レポート）画面
   -----------------------------------------------------------
   お金の流れをふり返るための画面です。
     ・収支の推移 … 1年分の「収入（上）」と「支出（下）」の棒グラフ
     ・カテゴリ別 … 大項目ごとの金額・割合・先月との差・3か月平均
                    行を押すと中項目の内訳が開きます
     ・固定費と変動費 … 毎月決まって出ていくお金を自動で見つけます
     ・カレンダー … 日ごとの支出。多い日ほど色が濃くなります
     ・AIの振り返り … Claude に今月の家計の感想をもらう（使える環境のみ）
   =========================================================== */

const ReportScreen = {
  title: '家計簿',
  usesPeriod: true,

  html() {
    const period = appState.period;
    let html = '<div class="grid">';
    html += reportFlowCardHtml(period);
    html += reportCategoryCardHtml(period);
    html += reportFixedCostCardHtml(period);
    const aiCard = aiReviewCardHtml(); // 18-ai-features.js（使えないときは空）
    html += reportCalendarCardHtml(period, aiCard === '' ? 'span-12' : 'span-7');
    html += aiCard;
    html += '</div>';
    return html;
  },

  afterRender() {
    const chartArea = findOne('#flowChart');
    const rows = reportFlowRows(appState.period);
    registerChart(() => drawIncomeExpenseChart(chartArea, rows));
  },
};


/* -----------------------------------------------------------
   収支の推移
   ----------------------------------------------------------- */

/** 12か月分の収入・支出（記録がない最初のほうの月は省く。最低6か月は出す） */
function reportFlowRows(endPeriod) {
  const rows = [];
  for (let back = 11; back >= 0; back--) {
    const period = shiftPeriod(endPeriod, -back);
    const summary = summarizePeriod(period);
    rows.push({ period: period, income: summary.income, expense: summary.expense });
  }
  while (rows.length > 6 && rows[0].income === 0 && rows[0].expense === 0) {
    rows.shift();
  }
  return rows;
}

function reportFlowCardHtml(period) {
  const rows = reportFlowRows(period);
  let totalIncome = 0;
  let totalExpense = 0;
  for (const row of rows) {
    totalIncome = totalIncome + row.income;
    totalExpense = totalExpense + row.expense;
  }

  let html = '<section class="card span-12">';
  html += '<div class="card-head"><h2>収支の推移</h2><span class="sub">直近' + rows.length + 'か月 · 収支の合計 ' + formatYen(totalIncome - totalExpense, { showPlus: true }) + '</span></div>';
  html += '<div class="legend">' +
    '<span><i class="key" style="background:var(--income)"></i>収入</span>' +
    '<span><i class="key" style="background:var(--expense)"></i>支出</span>' +
    '<span><i class="key dot" style="background:var(--ink)"></i>収支（収入−支出）</span></div>';
  html += '<div class="chart" id="flowChart"></div>';

  // 表で見る（グラフが見づらい人・数字を確かめたい人のため）
  html += '<details class="more"><summary>表で見る</summary><div class="table-wrap"><table class="data"><thead><tr><th>月</th><th>収入</th><th>支出</th><th>収支</th></tr></thead><tbody>';
  for (const row of rows) {
    html += '<tr><td>' + periodTitle(row.period) + '</td><td class="num">' + formatYen(row.income) + '</td><td class="num">' + formatYen(row.expense) + '</td><td class="num">' + formatYen(row.income - row.expense, { showPlus: true }) + '</td></tr>';
  }
  html += '</tbody></table></div></details>';
  html += '</section>';
  return html;
}


/* -----------------------------------------------------------
   カテゴリ別
   ----------------------------------------------------------- */
function reportCategoryCardHtml(period) {
  const type = appState.reportType; // 'expense' か 'income'
  const summary = summarizePeriod(period);
  const previous = summarizePeriod(shiftPeriod(period, -1));
  const pastThree = [1, 2, 3].map((back) => summarizePeriod(shiftPeriod(period, -back)));
  const total = type === 'income' ? summary.income : summary.expense;

  let html = '<section class="card span-7">';
  html += '<div class="card-head"><h2>カテゴリ別</h2>' +
    '<div class="seg" role="group" aria-label="支出と収入の切りかえ" style="margin-left:auto">' +
    '<button type="button" data-action="report-type" data-value="expense" aria-pressed="' + (type === 'expense') + '">支出</button>' +
    '<button type="button" data-action="report-type" data-value="income" aria-pressed="' + (type === 'income') + '">収入</button>' +
    '</div></div>';

  // 金額の多い順に並べる
  const rows = [];
  for (const category of getCategoriesForType(type)) {
    const bucket = summary.categories[category.id];
    const previousBucket = previous.categories[category.id];
    let threeMonthTotal = 0;
    for (const past of pastThree) {
      if (past.categories[category.id]) {
        threeMonthTotal = threeMonthTotal + past.categories[category.id].total;
      }
    }
    const amount = bucket ? bucket.total : 0;
    const previousAmount = previousBucket ? previousBucket.total : 0;
    if (amount === 0 && previousAmount === 0) {
      continue;
    }
    rows.push({ category: category, bucket: bucket, amount: amount, previousAmount: previousAmount, average: threeMonthTotal / 3 });
  }
  rows.sort((a, b) => b.amount - a.amount);

  if (rows.length === 0) {
    html += '<p class="empty-note">この期間の記録はまだありません。</p></section>';
    return html;
  }

  html += '<div class="cat-table">';
  html += '<div class="cat-head"><span>大項目</span><span>' + periodShortTitle(period) + '</span><span>割合</span><span>先月との差</span><span>3か月平均</span></div>';
  for (const row of rows) {
    const share = total > 0 ? (row.amount / total) * 100 : 0;
    html += '<details><summary class="cat-row">';
    html += '<span class="cat-name"><span class="mark ' + (type === 'income' ? 'income' : '') + '" aria-hidden="true">' + row.category.mark + '</span><span>' + row.category.name + '</span></span>';
    html += '<span class="num">' + formatYen(row.amount) + '</span>';
    html += '<span class="share"><span class="share-track"><span class="share-bar ' + (type === 'income' ? 'income' : '') + '" style="display:block; width:' + share.toFixed(1) + '%"></span></span><span class="num small">' + share.toFixed(0) + '%</span></span>';
    html += '<span class="num">' + differenceHtml(row.amount - row.previousAmount, type) + '</span>';
    html += '<span class="num muted">' + formatYen(row.average) + '</span>';
    html += '</summary>';

    // 中項目の内訳
    html += '<div class="sub-rows">';
    if (row.bucket) {
      const subs = Object.entries(row.bucket.subs).sort((a, b) => b[1] - a[1]);
      for (const sub of subs) {
        html += '<div class="sub-row"><span>' + escapeHtml(sub[0]) + '</span><span class="num">' + formatYen(sub[1]) + '</span></div>';
      }
    }
    html += '<div><button type="button" class="link-btn" style="padding-left:0" data-action="filter-category" data-category="' + row.category.id + '">' + row.category.name + 'の入出金を見る</button></div>';
    html += '</div></details>';
  }
  html += '<div class="cat-row cat-total"><span>合計</span><span class="num">' + formatYen(total) + '</span><span></span><span class="num">' +
    differenceHtml(total - (type === 'income' ? previous.income : previous.expense), type) + '</span><span></span></div>';
  html += '</div></section>';
  return html;
}

/**
 * 先月との差を「▲ +¥1,200」の形にする。
 * 支出が増えたら注意の色、収入が増えたら良い色（矢印と符号もつけて色だけに頼らない）。
 */
function differenceHtml(difference, type) {
  if (difference === 0) {
    return '<span class="muted">±¥0</span>';
  }
  const isGood = type === 'income' ? difference > 0 : difference < 0;
  const className = isGood ? 'delta up' : 'delta down';
  const icon = difference > 0 ? 'up' : 'down';
  return '<span class="' + className + '" style="justify-content:flex-end">' + iconSvg(icon) + formatYen(difference, { showPlus: true }) + '</span>';
}


/* -----------------------------------------------------------
   固定費と変動費
   ----------------------------------------------------------- */
function reportFixedCostCardHtml(period) {
  const summary = summarizePeriod(period);
  let fixed = 0;
  for (const category of EXPENSE_CATEGORIES) {
    if (category.fixed && summary.categories[category.id]) {
      fixed = fixed + summary.categories[category.id].total;
    }
  }
  const variable = summary.expense - fixed;
  const fixedShare = summary.expense > 0 ? Math.round((fixed / summary.expense) * 100) : 0;

  const recurring = findRecurringPayments(period);
  let recurringTotal = 0;
  for (const item of recurring) {
    recurringTotal = recurringTotal + item.amount;
  }

  let html = '<section class="card span-5">';
  html += '<div class="card-head"><h2>固定費と変動費</h2></div>';
  html += '<div class="stats" style="grid-template-columns:repeat(2, minmax(0,1fr))">' +
    '<div class="stat"><span class="label">固定費（住宅・光熱・通信・保険・税）</span><span class="value num">' + formatYen(fixed) + '</span><span class="small muted">支出の' + fixedShare + '%</span></div>' +
    '<div class="stat"><span class="label">変動費（それ以外）</span><span class="value num">' + formatYen(variable) + '</span><span class="small muted">支出の' + (summary.expense > 0 ? 100 - fixedShare : 0) + '%</span></div>' +
    '</div>';
  html += '<hr class="divider">';
  html += '<div class="card-head" style="margin-bottom:4px"><h2>毎月の支払い・サブスク</h2><span class="sub">月 約' + formatYen(recurringTotal) + '</span></div>';
  if (recurring.length === 0) {
    html += '<p class="small muted">3か月以上続けて同じように出ている支払いが見つかると、ここに出ます。</p>';
  } else {
    html += '<ul class="plain-list">';
    for (const item of recurring.slice(0, 10)) {
      const category = CATEGORY_BY_ID[item.category];
      html += '<li><span class="grow"><span>' + escapeHtml(item.description) + '</span><span class="small muted">毎月' + item.day + '日ごろ · ' + escapeHtml(category ? category.name : '') + '</span></span><span class="num">' + formatYen(item.amount) + '</span></li>';
    }
    html += '</ul>';
  }
  html += '</section>';
  return html;
}


/* -----------------------------------------------------------
   カレンダー（日ごとの支出）
   ----------------------------------------------------------- */
function reportCalendarCardHtml(period, spanClass) {
  const range = periodRange(period);
  const today = todayText();

  // 日ごとの支出と、収入があった日
  const expenseByDate = {};
  const incomeDates = new Set();
  for (const transaction of allTransactions) {
    if (transaction.date < range.start || transaction.date >= range.end || !isCounted(transaction)) {
      continue;
    }
    if (transaction.type === 'expense') {
      expenseByDate[transaction.date] = (expenseByDate[transaction.date] || 0) + transaction.amount;
    } else {
      incomeDates.add(transaction.date);
    }
  }

  // 色の濃さの区切り（支出があった日の金額を4つに分ける）
  const amounts = Object.values(expenseByDate).sort((a, b) => a - b);
  function levelOf(amount) {
    if (!amount) {
      return 0;
    }
    const position = amounts.indexOf(amount) / Math.max(1, amounts.length - 1);
    if (position < 0.25) {
      return 1;
    }
    if (position < 0.5) {
      return 2;
    }
    if (position < 0.8) {
      return 3;
    }
    return 4;
  }

  let html = '<section class="card ' + spanClass + '">';
  html += '<div class="card-head"><h2>カレンダー</h2></div>';
  html += '<div class="calendar">';
  for (let index = 0; index < 7; index++) {
    const className = index === 0 ? ' sun' : index === 6 ? ' sat' : '';
    html += '<div class="cal-weekday' + className + '">' + WEEKDAY_NAMES[index] + '</div>';
  }

  // 1日目の曜日まで空白をうめる
  const firstWeekday = textToDate(range.start).getDay();
  for (let blank = 0; blank < firstWeekday; blank++) {
    html += '<div class="cal-day blank"></div>';
  }

  let date = range.start;
  while (date < range.end) {
    const day = Number(date.slice(8, 10));
    const expense = expenseByDate[date] || 0;
    const level = levelOf(expense);
    const dayLabel = date === range.start || day === 1 ? formatShortDate(date) : String(day);
    const classes = 'cal-day level-' + level + (date === today ? ' today' : '');
    const ariaLabel = formatMonthDay(date) + ' 支出' + formatYen(expense) + (incomeDates.has(date) ? '・収入あり' : '');
    html += '<button type="button" class="' + classes + '" data-action="filter-date" data-date="' + date + '" aria-label="' + ariaLabel + '">' +
      '<span class="cal-date"><span>' + dayLabel + '</span>' + (incomeDates.has(date) ? '<span class="cal-income-dot" title="収入あり"></span>' : '') + '</span>' +
      '<span class="cal-amount num">' + (expense > 0 ? formatNumber(expense) : '') + '</span></button>';
    date = addDays(date, 1);
  }
  html += '</div>';
  html += '<div class="cal-scale"><span>支出が少ない</span><i class="level-1 cal-day"></i><i class="level-2 cal-day"></i><i class="level-3 cal-day"></i><i class="level-4 cal-day"></i><span>多い</span>' +
    '<span style="margin-left:12px; display:inline-flex; align-items:center; gap:4px"><span class="cal-income-dot"></span>収入あり</span></div>';
  html += '</section>';
  return html;
}
