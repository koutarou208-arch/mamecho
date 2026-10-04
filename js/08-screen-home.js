/* ===========================================================
   08-screen-home.js  ―  ホーム画面
   -----------------------------------------------------------
   開いたときに最初に出る画面です。上から:
     ・はじめての人への案内（記録がまだないときだけ）
     ・総資産と、その推移のグラフ
     ・資産の内訳
     ・今月の収支と予算の使い具合
     ・カードの引き落とし予定
     ・支出の内訳（カテゴリ別）
     ・最近の入出金

   画面ファイルの決まった形（ほかの画面も同じ）:
     title       … 上のバーに出る画面の名前
     usesPeriod  … 上のバーに「◀ 10月 ▶」の期間切りかえを出すか
     html()      … 画面の中身のHTMLを文字で返す
     afterRender() … HTMLを置いたあとにする仕事（グラフを描くなど）
   =========================================================== */

const HomeScreen = {
  title: 'ホーム',
  usesPeriod: true,

  html() {
    const period = appState.period;
    let html = '<div class="grid home-grid">';
    html += homeWelcomeHtml();
    html += homeAssetCardHtml(period);
    html += homeTradeSafetyCardHtml(period);
    html += homeCompositionCardHtml(period);
    html += homeMonthCardHtml(period);
    html += homeCardPaymentsHtml();
    html += homeSpendingCardHtml(period);
    html += homeRecentCardHtml();
    html += '</div>';
    return html;
  },

  afterRender() {
    const period = appState.period;
    const safetyArea = findOne('#safetyDayChart');
    if (safetyArea) {
      const dayRows = homeSafetyDayRows(period);
      registerChart(() => drawDailySafetyChart(safetyArea, dayRows));
    }
    const chartArea = findOne('#assetTrendChart');
    if (chartArea) {
      const points = assetHistory(period, 12);
      registerChart(() => drawAssetTrendChart(chartArea, points));
    }
    attachSimpleTooltips(findOne('#screen'));
  },
};


/* -----------------------------------------------------------
   はじめての人への案内（自分の家計簿で、記録が1件もないとき）
   ----------------------------------------------------------- */
function homeWelcomeHtml() {
  if (appState.isSample || allTransactions.length > 0) {
    return '';
  }
  return '<section class="card span-12 home-welcome">' +
    '<div class="card-head"><h2>はじめに</h2></div>' +
    '<ol class="welcome-steps">' +
    '<li><strong>口座を登録する</strong><span>財布・銀行・カードなどと、今の残高を入れます。</span><button class="btn small" data-action="go" data-screen="accounts">口座へ</button></li>' +
    '<li><strong>入出金を記録する</strong><span>右上の「記録する」から。CSVでまとめて取り込むこともできます。</span><button class="btn small" data-action="open-import">CSVを取り込む</button></li>' +
    '<li><strong>予算を決める</strong><span>カテゴリごとに月の上限を決めると、使いすぎが分かります。</span><button class="btn small" data-action="go" data-screen="budget">予算へ</button></li>' +
    '</ol></section>';
}


/* -----------------------------------------------------------
   総資産
   ----------------------------------------------------------- */
function homeAssetCardHtml(period) {
  const pointDate = pointInTimeOf(period);
  const breakdown = assetBreakdownOn(pointDate);
  const history = assetHistory(period, 12);

  let whenText = formatShortDate(pointDate) + '時点';
  if (isCurrentPeriod(period)) {
    whenText = '今日時点';
  }

  // 前の月の時点からどれだけ増えた（減った）か
  let deltaHtml = '<span class="delta flat">前月との比較はまだできません</span>';
  if (history.length >= 2) {
    const previous = history[history.length - 2].amount;
    const difference = breakdown.net - previous;
    let rate = '';
    if (previous > 0) {
      rate = '（' + (difference >= 0 ? '+' : '−') + Math.abs((difference / previous) * 100).toFixed(1) + '%）';
    }
    if (difference > 0) {
      deltaHtml = '<span class="delta up">' + iconSvg('up') + formatYen(difference, { showPlus: true }) + rate + '</span>';
    } else if (difference < 0) {
      deltaHtml = '<span class="delta down">' + iconSvg('down') + formatYen(difference) + rate + '</span>';
    } else {
      deltaHtml = '<span class="delta flat">±¥0</span>';
    }
    deltaHtml += ' <span class="delta-note">前月の同じ時点から</span>';
  }

  const sign = breakdown.net < 0 ? '−' : '';
  return '<section class="card span-7 home-asset">' +
    '<div class="card-head"><h2>総資産</h2><span class="sub">' + whenText + '</span></div>' +
    '<div class="hero-number">' + sign + '<span class="yen">¥</span>' + formatNumber(Math.abs(breakdown.net)) + '</div>' +
    '<div style="margin-block: 6px 14px">' + deltaHtml + '</div>' +
    '<div class="chart" id="assetTrendChart"></div>' +
    '</section>';
}


/* -----------------------------------------------------------
   資産の内訳
   ----------------------------------------------------------- */
function homeCompositionCardHtml(period) {
  const breakdown = assetBreakdownOn(pointInTimeOf(period));
  return '<section class="card span-5">' +
    '<div class="card-head"><h2>資産の内訳</h2><button class="link-btn" data-action="go" data-screen="accounts">口座を見る</button></div>' +
    assetCompositionHtml(breakdown) +
    '</section>';
}


/* -----------------------------------------------------------
   今月の収支と予算
   ----------------------------------------------------------- */
function homeMonthCardHtml(period) {
  const summary = summarizePeriod(period);
  const balance = summary.income - summary.expense;
  const isCurrent = isCurrentPeriod(period);

  let html = '<section class="card span-7">';
  html += '<div class="card-head"><h2>' + periodShortTitle(period) + 'の収支</h2><span class="sub">' + periodRangeText(period) + '</span>' +
    '<button class="link-btn" data-action="go" data-screen="report">家計簿を見る</button></div>';

  html += '<div class="stats">' +
    '<div class="stat"><span class="label"><span class="key" style="background:var(--income)"></span>収入</span><span class="value num income-text">' + formatYen(summary.income) + '</span></div>' +
    '<div class="stat"><span class="label"><span class="key" style="background:var(--expense)"></span>支出</span><span class="value num">' + formatYen(summary.expense) + '</span></div>' +
    '<div class="stat"><span class="label">収支</span><span class="value num total">' + formatYen(balance, { showPlus: true }) + '</span></div>' +
    '</div>';

  // --- 株式投資の損益（収支にふくまれている分） ---
  if (summary.tradeGain > 0 || summary.tradeLoss > 0) {
    const tradeClass = summary.tradeNet >= 0 ? 'up' : 'down';
    html += '<p class="small" style="margin-top:10px">株式投資の損益（収支にふくむ） ' +
      '<span class="delta ' + tradeClass + '">' + iconSvg(summary.tradeNet >= 0 ? 'up' : 'down') + formatYen(summary.tradeNet, { showPlus: true }) + '</span></p>';
  }

  html += '<hr class="divider">';

  // --- 予算 ---
  const budget = totalBudget();
  if (budget > 0) {
    const elapsed = elapsedRatio(period);
    const status = budgetStatus(summary.spending, budget, elapsed);
    const usedPercent = Math.min(100, (summary.spending / budget) * 100);
    const meterClass = status === 'good' ? '' : status;
    html += '<div class="row-gap" style="justify-content:space-between; margin-bottom:8px">' +
      '<span><strong>予算</strong> <span class="muted small">' + formatYen(summary.spending) + ' / ' + formatYen(budget) + '</span></span>' +
      statusChipHtml(status) + '</div>';
    html += '<div class="meter" role="img" aria-label="予算の' + Math.round((summary.spending / budget) * 100) + '%を使用">' +
      '<div class="meter-fill ' + meterClass + '" style="width:' + usedPercent.toFixed(1) + '%"></div>';
    if (isCurrent) {
      html += '<div class="meter-pace" style="left:calc(' + (elapsed * 100).toFixed(1) + '% - 1px)" title="今日までのペースの目安"></div>';
    }
    html += '</div>';

    // 残りの日数と1日あたり
    const remaining = budget - summary.spending;
    if (isCurrent) {
      const range = periodRange(period);
      const daysLeft = daysBetween(todayText(), range.end);
      if (remaining >= 0) {
        html += '<p class="small" style="margin-top:10px">残り' + daysLeft + '日 · 1日あたり <strong class="num">' + formatYen(Math.floor(remaining / Math.max(1, daysLeft))) + '</strong> まで使えます</p>';
      } else {
        html += '<p class="small" style="margin-top:10px">予算を <strong class="num">' + formatYen(-remaining) + '</strong> 超えています</p>';
      }
    } else {
      html += '<p class="small muted" style="margin-top:10px">' + (remaining >= 0 ? '予算内で終わりました（' + formatYen(remaining) + ' 残り）' : formatYen(-remaining) + ' 予算を超えました') + '</p>';
    }
  } else {
    html += '<p class="small muted">予算を決めると、使いすぎていないかがここに出ます。 <button class="link-btn" data-action="go" data-screen="budget">予算を決める</button></p>';
  }

  // --- 貯金目標 ---
  const goal = Number(appState.profile.settings.savingsGoal) || 0;
  if (goal > 0) {
    const left = goal - balance;
    html += '<p class="small" style="margin-top:6px">貯金目標 ' + formatYen(goal) + ' · ' +
      (left <= 0 ? '<span class="status-chip good">' + iconSvg('check') + '達成</span>' : 'あと <strong class="num">' + formatYen(left) + '</strong>') + '</p>';
  }

  // --- 先月の同じ時期との比較 ---
  if (isCurrent) {
    const range = periodRange(period);
    const passedDays = daysBetween(range.start, todayText()) + 1;
    const previousRange = periodRange(shiftPeriod(period, -1));
    const sameDayLastMonth = addDays(previousRange.start, passedDays);
    const previousSoFar = summarizeRange({ start: previousRange.start, end: sameDayLastMonth < previousRange.end ? sameDayLastMonth : previousRange.end });
    const difference = summary.spending - previousSoFar.spending;
    if (previousSoFar.spending > 0) {
      const word = difference <= 0 ? '少ない' : '多い';
      html += '<p class="small muted" style="margin-top:6px">先月の同じ時期より支出が ' + formatYen(Math.abs(difference)) + ' ' + word + 'ペースです</p>';
    }
  }

  html += '</section>';
  return html;
}


/** 安心ラインを日ごとに追った行（期間の最初の日から、今日または期間の最後の日まで） */
function homeSafetyDayRows(period) {
  const goal = Number(appState.profile.settings.savingsGoal) || 0;
  const range = periodRange(period);
  return dailySafetyRows(range, todayText(), goal);
}

/**
 * 「株でいくら利益が出れば安心か」を、ホームの上のほうに大きく出すカード。
 * （今の収支をもとにした計算で、投資のおすすめではありません）
 * 毎月の貯金目標があれば、それが安心ライン。なければ「赤字にならないこと」が安心ライン。
 */
function homeTradeSafetyCardHtml(period) {
  const summary = summarizePeriod(period);
  const hasNoRecords = summary.income === 0 && summary.expense === 0; // この期間の記録がまだ1件もない
  const goal = Number(appState.profile.settings.savingsGoal) || 0;
  const judge = judgeTradeSafety(summary, goal);
  const average = averageBaseBalance(period, 3);
  const lineName = goal > 0 ? '貯金目標 ' + formatYen(goal) : '赤字にならないこと';

  // 給与のルール: 支出が給与でまかなえなければ「アウト」（株の利益では救えない）
  const pastSummaries = [1, 2, 3].map((back) => summarizePeriod(shiftPeriod(period, -back)));
  const salaryNow = summary.categories.salary ? summary.categories.salary.total : 0;
  const salaryRule = judgeSalaryRule(salaryNow, averageSalaryOf(pastSummaries), summary.spending);

  // 大きな見出しの文と、色
  let headline = '';
  let meterClass = '';
  let chip = '';
  if (salaryRule.out) {
    headline = 'アウト：支出が給与でまかなえていません';
    chip = statusChipHtml('over', 'アウト');
    meterClass = 'over';
  } else if (hasNoRecords) {
    headline = 'この期間の記録がまだありません';
    chip = statusChipHtml('warn', '記録待ち');
    meterClass = 'warn';
  } else if (judge.status === 'safe') {
    headline = '株の利益がなくても安心です';
    chip = statusChipHtml('good', '安心');
  } else if (judge.status === 'covered') {
    headline = '株の利益で安心ラインに届きました';
    chip = statusChipHtml('good', '達成');
  } else {
    headline = 'あと <span class="num">' + formatYen(judge.remaining) + '</span> の株の利益で安心です';
    meterClass = 'warn';
    chip = statusChipHtml('warn', 'もう少し');
  }

  // 進み具合のバー（必要な利益のうち、今の株の損益でどれだけ埋まったか）
  let percent = 100;
  if (judge.needed > 0) {
    percent = Math.max(0, Math.min(100, (summary.tradeNet / judge.needed) * 100));
  }

  let html = '<section class="card span-12 safety-card' + (salaryRule.out ? ' safety-out' : '') + '">';
  html += '<div class="card-head"><h2>株の利益の安心ライン</h2>' + chip + '</div>';
  html += '<div class="row-gap" style="margin-bottom:10px">' +
    '<button type="button" class="btn small primary" data-action="new-trade" data-kind="gain" data-icon="plus">株の利益を記録</button>' +
    '<button type="button" class="btn small" data-action="new-trade" data-kind="loss" data-icon="plus">株の損失を記録</button></div>';
  html += '<p class="safety-headline">' + headline + '</p>';
  html += '<p class="small muted">安心ライン: ' + lineName + '</p>';

  // 給与のルールの説明（1行）
  if (salaryRule.basis === 'none') {
    html += '<p class="small muted" style="margin-top:4px">給与の記録がないので、「支出が給与でまかなえるか」は判定していません。</p>';
  } else {
    const basisText = salaryRule.basis === 'now' ? '今月の給与' : '給与（直近の平均）';
    if (salaryRule.out) {
      html += '<p class="small" style="margin-top:6px"><strong>' + basisText + ' ' + formatYen(salaryRule.salary) + '</strong> に対して、支出 ' + formatYen(salaryRule.spending) +
        '。<strong class="num">' + formatYen(salaryRule.gap) + '</strong> 足りません。株の利益が出ていても、アウトです。</p>';
    } else {
      html += '<p class="small muted" style="margin-top:4px">' + basisText + ' ' + formatYen(salaryRule.salary) + ' で、支出 ' + formatYen(salaryRule.spending) + ' をまかなえています（あと ' + formatYen(-salaryRule.gap) + '）</p>';
    }
  }
  html += '<div class="meter" style="margin-top:12px" role="img" aria-label="必要な利益の' + Math.round(percent) + '%まで届いています">' +
    '<div class="meter-fill ' + meterClass + '" style="width:' + percent.toFixed(1) + '%"></div></div>';
  html += '<div class="stats" style="margin-top:14px">' +
    '<div class="stat"><span class="label">株をのぞいた収支</span><span class="value num">' + formatYen(judge.base, { showPlus: true }) + '</span></div>' +
    '<div class="stat"><span class="label">必要な株の利益</span><span class="value num">' + formatYen(judge.needed) + '</span></div>' +
    '<div class="stat"><span class="label">この期間の株の損益</span><span class="value num">' + formatYen(summary.tradeNet, { showPlus: true }) + '</span></div>' +
    '</div>';

  const averageNeeded = Math.max(0, goal - average);
  if (averageNeeded > 0) {
    html += '<p class="small muted" style="margin-top:12px">ふだんの月（直近3か月）は、毎月 ' + formatYen(averageNeeded) + ' の利益が目安です</p>';
  } else {
    html += '<p class="small muted" style="margin-top:12px">ふだんの月（直近3か月）は、株なしで届いています</p>';
  }

  // 日ごとの推移（今日までを1日ずつ追う）
  const dayRows = homeSafetyDayRows(period);
  if (dayRows.length >= 1) {
    html += '<div class="legend" style="margin-top:14px">' +
      '<span><i class="key" style="background:var(--expense)"></i>必要な株の利益</span>' +
      '<span><i class="key" style="background:var(--chart-3)"></i>株の損益（累計）</span></div>';
    html += '<div class="chart" id="safetyDayChart"></div>';
    html += '<details class="more"><summary>日ごとに見る</summary><div class="table-wrap"><table class="data"><thead><tr><th>日</th><th>株をのぞく収支</th><th>株の損益</th><th>必要な利益</th></tr></thead><tbody>';
    for (let index = dayRows.length - 1; index >= 0; index--) {
      const row = dayRows[index];
      html += '<tr><td>' + formatMonthDay(row.date) + '</td><td class="num">' + formatYen(row.base, { showPlus: true }) + '</td><td class="num">' + formatYen(row.tradeNet, { showPlus: true }) + '</td><td class="num">' + formatYen(row.needed) + '</td></tr>';
    }
    html += '</tbody></table></div></details>';
  }
  html += '</section>';
  return html;
}


/* -----------------------------------------------------------
   カードの引き落とし予定
   ----------------------------------------------------------- */
function homeCardPaymentsHtml() {
  const cards = cardAccounts();
  if (cards.length === 0) {
    return '';
  }
  let html = '<section class="card span-5">';
  html += '<div class="card-head"><h2>カードの引き落とし予定</h2><button class="link-btn" data-action="go" data-screen="cards">カードを見る</button></div>';
  html += '<ul class="plain-list">';
  for (const card of cards) {
    const summary = cardSummary(card);
    let right = '<span class="muted small">予定なし</span>';
    let sub = escapeHtml(describeCycle(summary.settings));
    if (summary.nextBill) {
      right = '<strong class="num">' + formatYen(summary.nextBill.total) + '</strong>';
      sub = formatMonthDay(summary.nextBill.payDate) + ' 引き落とし';
      if (summary.isShort) {
        sub += ' · ' + statusChipHtml('over', '残高不足');
      }
    }
    if (summary.overdueBills.length > 0) {
      sub += ' · ' + statusChipHtml('warn', '未記録' + summary.overdueBills.length + '件');
    }
    html += '<li><span class="grow"><span>' + escapeHtml(card.name) + '</span><span class="small muted">' + sub + '</span></span>' + right + '</li>';
  }
  html += '</ul></section>';
  return html;
}


/* -----------------------------------------------------------
   支出の内訳（多い順に6つ ＋ その他）
   ----------------------------------------------------------- */
function homeSpendingCardHtml(period) {
  const summary = summarizePeriod(period);
  const rows = [];
  for (const category of LIVING_EXPENSE_CATEGORIES) {
    const bucket = summary.categories[category.id];
    if (bucket && bucket.total > 0) {
      rows.push({ id: category.id, label: category.name, value: bucket.total });
    }
  }
  rows.sort((a, b) => b.value - a.value);

  let shownRows = rows;
  if (rows.length > 7) {
    shownRows = rows.slice(0, 6);
    let rest = 0;
    for (const row of rows.slice(6)) {
      rest = rest + row.value;
    }
    shownRows.push({ id: '', label: 'そのほか' + (rows.length - 6) + '項目', value: rest });
  }

  const span = cardAccounts().length > 0 ? 'span-7' : 'span-5';
  return '<section class="card ' + span + '">' +
    '<div class="card-head"><h2>' + periodShortTitle(period) + 'の支出の内訳</h2></div>' +
    rankingBarsHtml(shownRows, 'expense') +
    '</section>';
}


/* -----------------------------------------------------------
   最近の入出金（今日までの新しいもの8件）
   ----------------------------------------------------------- */
function homeRecentCardHtml() {
  const today = todayText();
  const recent = allTransactions.filter((item) => item.date <= today).slice(0, 8);
  const span = cardAccounts().length > 0 ? 'span-5' : 'span-12';
  let html = '<section class="card ' + span + '">';
  html += '<div class="card-head"><h2>最近の入出金</h2><button class="link-btn" data-action="go" data-screen="transactions">すべて見る</button></div>';
  if (recent.length === 0) {
    html += '<p class="empty-note">まだ記録がありません。</p>';
  } else {
    html += '<div class="tx-list">';
    for (const transaction of recent) {
      html += transactionRowHtml(transaction, { showDate: true });
    }
    html += '</div>';
  }
  html += '</section>';
  return html;
}
