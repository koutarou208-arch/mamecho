/* ===========================================================
   08-screen-home.js  ―  ホーム画面
   -----------------------------------------------------------
   開いたときに最初に出る画面です。スマホでは、毎日見るものを上にする
   （今月の収支 → 総資産 → 株の安心ライン → カードの引き落とし → 最近の入出金 → 内訳。並べかえは style.css）。
   パソコンでは上から:
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
      // たたんであったグラフは、開いたときに幅に合わせて描き直す
      findOne('#safetyMore').addEventListener('toggle', redrawCharts);
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
    '<li><strong>口座を登録する</strong><span>財布・銀行・カードと、今の残高</span><button class="btn small" data-action="go" data-screen="accounts">口座へ</button></li>' +
    '<li><strong>入出金を記録する</strong><span>＋ボタンから（CSVでまとめても）</span><button class="btn small" data-action="open-import">CSVを取り込む</button></li>' +
    '<li><strong>予算を決める</strong><span>使いすぎが分かります</span><button class="btn small" data-action="go" data-screen="budget">予算へ</button></li>' +
    '</ol></section>';
}


/* -----------------------------------------------------------
   総資産
   ----------------------------------------------------------- */

let isAssetChangeOpen = false; // 総資産の「増えた・減った」の内訳を開いているか

function homeAssetCardHtml(period) {
  const pointDate = pointInTimeOf(period);
  const breakdown = assetBreakdownOn(pointDate);
  const history = assetHistory(period, 12);

  const today = todayText();
  const isFuture = isFuturePeriod(period, today);
  let whenText = formatShortDate(pointDate) + '時点';
  if (isCurrentPeriod(period)) {
    whenText = '今日時点';
  } else if (isFuture) {
    whenText = formatShortDate(pointDate) + '時点（見込み）'; // 入れてある予定だけで計算した数字
  }

  // くらべる相手（今月なら先月末、過去の月ならその前の月末、先の月なら今日）から、どれだけ増えた（減った）か。
  // 押すと、なぜかの内訳が開く
  let deltaHtml = '<span class="delta flat">前月との比較はまだできません</span>';
  let changePanelHtml = '';
  const previousPoint = previousAssetPoint(history, pointDate);
  if (previousPoint) {
    const previous = previousPoint.amount;
    const difference = breakdown.net - previous;
    let rate = '';
    // 先の月の見込みは、今日とくらべた%を出さない（今日の残高が少ないと「+4000%」のような、役に立たない数字になるため）
    if (previous > 0 && !isFuture) {
      rate = '（' + (difference >= 0 ? '+' : '−') + Math.abs((difference / previous) * 100).toFixed(1) + '%）';
    }
    if (difference > 0) {
      deltaHtml = '<span class="delta up">' + iconSvg('up') + formatYen(difference, { showPlus: true }) + rate + '</span>';
    } else if (difference < 0) {
      deltaHtml = '<span class="delta down">' + iconSvg('down') + formatYen(difference) + rate + '</span>';
    } else {
      deltaHtml = '<span class="delta flat">±¥0</span>';
    }
    deltaHtml = '<button type="button" class="delta-button" data-action="toggle-asset-change" aria-expanded="' + (isAssetChangeOpen ? 'true' : 'false') + '">' +
      deltaHtml + ' <span class="delta-note">' + assetChangeBaseText(previousPoint, today) + '</span>' +
      '<span class="delta-why">' + (isAssetChangeOpen ? 'とじる' : 'なぜ？') + iconSvg(isAssetChangeOpen ? 'up' : 'down') + '</span></button>';
    if (isAssetChangeOpen) {
      changePanelHtml = assetChangePanelHtml(previousPoint.dateText, pointDate, period);
    }
  }

  const sign = breakdown.net < 0 ? '−' : '';
  return '<section class="card span-7 home-asset">' +
    '<div class="card-head"><h2>総資産</h2><span class="sub">' + whenText + '</span></div>' +
    '<div class="hero-number">' + sign + '<span class="yen">¥</span>' + formatNumber(Math.abs(breakdown.net)) + '</div>' +
    '<div style="margin-block: 6px 14px">' + deltaHtml + '</div>' +
    changePanelHtml + // 「なぜ？」を押したら、そのすぐ下に開く
    assetProjectionHtml(period, isFuture, breakdown.net) +
    '<div class="chart" id="assetTrendChart"></div>' +
    '</section>';
}

/**
 * 総資産の見込みの行（05 の monthEndProjection・recordsAddedAfter と、おぼえた見込み profile.projections）。
 *   今の月     … 「月末（11/30）の見込み ¥273,558」。おぼえた見込みから動いていれば、その差も出す
 *   終わった月 … 「見込み（11/2に計算）¥273,558 → 実際 ¥268,000 ずれ −¥5,558」と、ずれの理由
 *   先の月     … 出さない（数字そのものが見込みのため）
 *   actual … 見ている月の最後の日の総資産
 */
function assetProjectionHtml(period, isFuture, actual) {
  if (isFuture) {
    return '';
  }
  const lastDate = periodRange(period).last;
  let memo = (appState.profile.projections || {})[periodKey(period)];
  if (memo && memo.endDate !== lastDate) {
    memo = null; // 「1か月の始まりの日」を変える前の見込みは、月の最後の日がちがうので、くらべない
  }
  if (isCurrentPeriod(period)) {
    const projection = monthEndProjection(period);
    // 折り返すときは、ことばと金額が別の行に分かれないように、まとまりごとに span でくくる
    let html = '<p class="projection-line"><span>月末（' + formatShortDate(projection.endDate) + '）の見込み <strong class="num no-break">' + formatYen(projection.amount) + '</strong></span>';
    if (memo && memo.amount !== projection.amount) {
      html += ' <span class="muted">（' + formatShortDate(memo.made) + 'の見込みから <span class="no-break">' + formatYen(projection.amount - memo.amount, { showPlus: true }) + '</span>）</span>';
    }
    return html + '</p>';
  }
  if (!memo) {
    return ''; // この機能を使いはじめる前の月は、見込みをおぼえていない
  }
  const gap = actual - memo.amount;
  const gapClass = gap > 0 ? 'up' : (gap < 0 ? 'down' : 'flat');
  let html = '<p class="projection-line">' +
    '<span>見込み（' + formatShortDate(memo.made) + 'に計算）<span class="no-break">' + formatYen(memo.amount) + '</span></span> ' +
    '<span class="no-break">→ 実際 <strong class="num">' + formatYen(actual) + '</strong></span> ' +
    '<span class="delta ' + gapClass + '">ずれ ' + (gap === 0 ? '±¥0' : formatYen(gap, { showPlus: true })) + '</span></p>';
  const added = gap === 0 ? { count: 0, total: 0 } : recordsAddedAfter(lastDate, memo.at);
  return html + '<p class="hint projection-note">' + textWithWholeAmountsHtml(projectionGapReasonText(gap, added)) + '</p>';
}

/**
 * 総資産の「増えた・減った」の内訳（05 の assetChangeBreakdown）。
 * 種類ごと（収入・支出・計算対象外・残高修正・新しい口座）、口座ごと、大きく動いた記録を出す。
 * 今月を見ているときは、今日より先の日付の記録（まだ総資産に入っていない分）も知らせる。
 */
function assetChangePanelHtml(fromDate, toDate, period) {
  const change = assetChangeBreakdown(fromDate, toDate);
  const today = todayText();
  const isFuture = isFuturePeriod(period, today);
  const fromText = fromDate === today ? '今日（' + formatShortDate(fromDate) + '）' : formatShortDate(fromDate);
  let toText = formatShortDate(toDate);
  if (isCurrentPeriod(period)) {
    toText = '今日（' + formatShortDate(toDate) + '）';
  } else if (isFuture) {
    toText = formatShortDate(toDate) + '（見込み）';
  }
  let html = '<div class="asset-change">';
  // 見出しの「？」: 振替（カードの引き落とし・口座のあいだの移動）は総資産を変えないこと
  html += '<p class="asset-change-title">' + fromText + ' → ' + toText + ' の増減 <strong class="num">' + formatYen(change.total, { showPlus: true }) + '</strong>' +
    tipButtonHtml('tip-asset-transfer') + '</p>' +
    tipTextHtml('tip-asset-transfer', '振替（カードの引き落とし・口座のあいだの移動）は、お金が口座のあいだを動くだけなので、総資産は変わりません。');
  if (isFuture) {
    html += '<p class="hint" style="margin-bottom:6px">入れてある予定だけの見込みです（まだ入れていない支出のぶん、少なくなります）</p>';
  }
  if (change.parts.length === 0) {
    html += '<p class="small muted">この間に、総資産を動かす記録はありません。</p>';
  }
  for (const part of change.parts) {
    html += '<div class="sub-row"><span>' + part.label + (part.count > 0 ? '（' + part.count + '件）' : '') + '</span>' +
      '<span class="num">' + formatYen(part.amount, { showPlus: true }) + '</span></div>';
  }
  if (change.accounts.length > 0) {
    html += '<p class="asset-change-head">口座ごと</p>';
    for (const item of change.accounts) {
      html += '<div class="sub-row"><span>' + escapeHtml(item.account.name) + '</span><span class="num">' + formatYen(item.amount, { showPlus: true }) + '</span></div>';
    }
  }
  if (change.records.length > 0) {
    // 入出金の一覧と同じ形で出す（内容が空でも、カテゴリ・中項目・口座で何のお金か分かるように。09 の transactionRowHtml）
    html += '<p class="asset-change-head">大きく動いた記録</p><div class="tx-list">';
    for (const item of change.records) {
      html += transactionRowHtml(item.transaction, { showDate: true });
    }
    html += '</div>';
  }
  // カードの引き落としを「支出」で入れたらしい記録があれば、二重に減って見えることを知らせる（06 の点検と同じ見分け方）
  const cardWords = cardPaymentWords();
  const paymentLike = change.records.filter((item) => looksLikeCardPaymentFromBank(item.transaction, cardWords));
  if (paymentLike.length > 0) {
    html += '<div class="confirm-box" style="margin-top:10px"><p>「' + escapeHtml(paymentLike[0].transaction.description || '（内容なし）') + '」は、' +
      'カードの引き落としを「支出」で入れたかもしれません（カードの買い物と二重に減って見えます）</p>' +
      '<div class="row-gap"><button type="button" class="btn small" data-action="go-number-check">数字の点検で確かめる</button></div></div>';
  }
  if (isCurrentPeriod(period)) {
    const future = futureCountedTotals(periodRange(period), todayText());
    if (future.count > 0) {
      html += '<p class="hint" style="margin-top:10px">先の日付の記録 ' + future.count + '件（収入 ' + formatYen(future.income) +
        '・支出 ' + formatYen(future.expense) + '）は、その日に総資産に入ります</p>';
    }
  }
  html += '</div>';
  return html;
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

  let html = '<section class="card span-7 home-month">';
  // 期間（11/1〜11/30）は画面の上の月の下に出ているので、ここには書かない
  html += '<div class="card-head"><h2>' + periodShortTitle(period) + 'の収支</h2>' +
    '<span class="row-gap" style="margin-left:auto; gap:4px">' +
    '<button class="link-btn" data-action="go-chat">Claude に聞く</button>' +
    '<button class="link-btn" data-action="go" data-screen="report">家計簿を見る</button></span></div>';

  html += '<div class="stats">' +
    // 収入・支出は押すと、家計簿の「カテゴリ別」（内訳）がその種類で開く
    '<button type="button" class="stat stat-link" data-action="show-breakdown" data-value="income" aria-label="収入の内訳を見る"><span class="label"><span class="key" style="background:var(--income)"></span>収入</span><span class="value num income-text">' + formatYen(summary.income) + iconSvg('chevron-right') + '</span></button>' +
    '<button type="button" class="stat stat-link" data-action="show-breakdown" data-value="expense" aria-label="支出の内訳を見る"><span class="label"><span class="key" style="background:var(--expense)"></span>支出</span><span class="value num">' + formatYen(summary.expense) + iconSvg('chevron-right') + '</span></button>' +
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
        html += '<p class="small" style="margin-top:10px">1日あたり <strong class="num">' + formatYen(Math.floor(remaining / Math.max(1, daysLeft))) + '</strong> まで<span class="muted"> · あと' + daysLeft + '日</span></p>';
      } else {
        html += '<p class="small" style="margin-top:10px">予算を <strong class="num">' + formatYen(-remaining) + '</strong> 超えています</p>';
      }
    } else {
      html += '<p class="small muted" style="margin-top:10px">' + (remaining >= 0 ? '予算内で終わりました（' + formatYen(remaining) + ' 残り）' : formatYen(-remaining) + ' 予算を超えました') + '</p>';
    }
  } else {
    html += '<p class="small muted">予算を決めると、使いすぎていないかがここに出ます。 <button class="link-btn" data-action="go" data-screen="budget">予算を決める</button></p>';
  }

  // 貯金目標の「あと いくら」は、すぐ下の「株の利益の安心ライン」のカードに出ているので、ここには書かない

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
      html += '<p class="small muted" style="margin-top:6px">支出は先月の今ごろより ' + formatYen(Math.abs(difference)) + ' ' + word + '</p>';
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
    '<button type="button" class="btn small primary" data-action="new-trade" data-kind="gain" data-icon="plus">利益を記録</button>' +
    '<button type="button" class="btn small" data-action="new-trade" data-kind="loss" data-icon="plus">損失を記録</button></div>';
  html += '<p class="safety-headline">' + headline + '</p>';
  html += '<p class="small muted">安心ライン: ' + lineName + '</p>';
  // ここから下（説明・メーター・数字・グラフ）は「くわしく」にたたむ。アウトのときは最初から開く
  html += '<details class="more safety-more" id="safetyMore"' + (salaryRule.out ? ' open' : '') + '><summary>くわしく</summary>';

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
  html += '</details>';
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
  let html = '<section class="card span-5 home-cardpay">';
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
   最近の入出金（今日までの新しいもの5件。ぜんぶは「すべて見る」で）
   ----------------------------------------------------------- */
function homeRecentCardHtml() {
  const today = todayText();
  const recent = allTransactions.filter((item) => item.date <= today).slice(0, 5);
  const span = cardAccounts().length > 0 ? 'span-5' : 'span-12';
  let html = '<section class="card home-recent ' + span + '">';
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
