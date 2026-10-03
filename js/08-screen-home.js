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
    let html = '<div class="grid">';
    html += homeWelcomeHtml();
    html += homeAssetCardHtml(period);
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
  return '<section class="card span-12">' +
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
  return '<section class="card span-7">' +
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

  html += homeTradeSafetyHtml(period, summary);

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


/**
 * 「株の利益がどれくらいあれば安心か」の表示（今の収支をもとにした計算。投資のおすすめではない）。
 * 毎月の貯金目標があれば、それを安心ラインにする。なければ「赤字にならない」ことが安心ライン。
 */
function homeTradeSafetyHtml(period, summary) {
  if (summary.income === 0 && summary.expense === 0) {
    return ''; // 記録がまだない期間は出さない
  }
  const goal = Number(appState.profile.settings.savingsGoal) || 0;
  const judge = judgeTradeSafety(summary, goal);
  const average = averageBaseBalance(period, 3);
  const lineName = goal > 0 ? '貯金目標' : '赤字にならないライン';

  let chip = '';
  let message = '';
  if (judge.status === 'safe') {
    chip = statusChipHtml('good', '株なしで安心');
    message = '投資をのぞいた収支は <strong class="num">' + formatYen(judge.base, { showPlus: true }) + '</strong>。' + lineName + 'に届いています';
  } else if (judge.status === 'covered') {
    chip = statusChipHtml('good', '利益で安心');
    message = '投資をのぞくと <strong class="num">' + formatYen(judge.base, { showPlus: true }) + '</strong>。株の利益で' + lineName + 'に届きました';
  } else {
    chip = statusChipHtml('warn', 'あと ' + formatYen(judge.remaining));
    message = '投資をのぞくと <strong class="num">' + formatYen(judge.base, { showPlus: true }) + '</strong>。' + lineName + 'まで、株で <strong class="num">' + formatYen(judge.needed) + '</strong> の利益が必要です';
  }

  let html = '<div class="trade-safety" style="margin-top:12px">';
  html += '<div class="row-gap" style="justify-content:space-between"><strong>株の利益の安心ライン</strong>' + chip + '</div>';
  html += '<p class="small" style="margin-top:6px">' + message + '</p>';
  const averageNeeded = Math.max(0, goal - average);
  if (averageNeeded > 0) {
    html += '<p class="small muted" style="margin-top:4px">ふだんの月（直近3か月）は、毎月 ' + formatYen(averageNeeded) + ' の利益で' + lineName + 'に届きます</p>';
  } else {
    html += '<p class="small muted" style="margin-top:4px">ふだんの月（直近3か月）は、投資なしで' + lineName + 'に届いています</p>';
  }
  html += '</div>';
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
