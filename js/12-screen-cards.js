/* ===========================================================
   12-screen-cards.js  ―  カード画面
   -----------------------------------------------------------
   クレジットカードごとに、
     ・次の引き落とし日と金額（確定しているか）
     ・引き落とし口座の残高が足りるか
     ・分割・リボ・ボーナス払いなどで、これから払う残り
     ・この先の請求の一覧（押すと1件ずつの内訳）
     ・支払日を過ぎたのに記録していない引き落とし
   を表示します。計算は 06-credit-card-billing.js が担当しています。

   いちばん下には「支払い方法のしくみ」の説明があります。
   =========================================================== */

const CardsScreen = {
  title: 'カード',
  usesPeriod: false,

  html() {
    const cards = cardAccounts();
    let html = '<div class="grid">';
    if (cards.length === 0) {
      html += '<section class="card span-12"><p class="empty-note">クレジットカードがまだ登録されていません。</p>' +
        '<div class="row-gap" style="justify-content:center"><button type="button" class="btn primary" data-action="add-account" data-kind="card">カードを登録する</button></div></section>';
    }
    for (const card of cards) {
      html += cardPanelHtml(card);
    }
    html += paymentMethodGuideHtml();
    html += '</div>';
    return html;
  },

  afterRender() {
    for (const card of cardAccounts()) {
      const chartArea = findOne('[data-debt-chart="' + card.id + '"]');
      if (chartArea) {
        const rows = cardDebtRows(cardSummary(card));
        registerChart(() => drawCardDebtChart(chartArea, rows));
      }
    }
    attachSimpleTooltips(findOne('#screen'));
  },
};

// 「支払い予定をまとめて入力」の欄を開いたままにするカード（口座id → true）
const openManualPanels = {};


/** カード1枚分のパネル */
function cardPanelHtml(account) {
  const summary = cardSummary(account);
  const settings = summary.settings;
  const today = todayText();

  let html = '<section class="card span-12">';
  html += '<div class="card-head">' +
    '<h2 style="font-size:16px; color:var(--ink)">' + escapeHtml(account.name) + '</h2>' +
    '<span class="sub">' + escapeHtml(settings.company.name) + ' · ' + describeCycle(settings) + (settings.autoRevolving ? ' · 登録型リボ設定中' : '') + '</span>' +
    '<button type="button" class="link-btn" data-action="edit-account" data-id="' + escapeHtml(account.id) + '">カードの設定</button></div>';

  // --- 上段: 次の引き落とし・引き落とし口座・利用可能額・ポイント ---
  html += '<div class="stats card-stats">';
  if (summary.nextBill) {
    const bill = summary.nextBill;
    const confirmed = today > bill.closeDate;
    html += '<div class="stat"><span class="label">次の引き落とし ' + formatMonthDay(bill.payDate) + '</span>' +
      '<span class="value num">' + formatYen(bill.total) + '</span>' +
      '<span class="small muted">' + (confirmed ? '請求確定' : formatShortDate(bill.closeDate) + 'の締めまで増えます') + (bill.fee > 0 ? ' · うち手数料 ' + formatYen(bill.fee) : '') + '</span></div>';
  } else {
    html += '<div class="stat"><span class="label">次の引き落とし</span><span class="value num">¥0</span><span class="small muted">予定はありません</span></div>';
  }

  if (summary.payFromAccount) {
    const chip = summary.nextBill ? (summary.isShort ? statusChipHtml('over', '残高不足') : statusChipHtml('good', '足りています')) : '';
    html += '<div class="stat"><span class="label">引き落とし口座: ' + escapeHtml(summary.payFromAccount.name) + '</span>' +
      '<span class="value num">' + formatYen(summary.payFromBalance) + '</span><span class="small">' + chip + '</span></div>';
  } else {
    html += '<div class="stat"><span class="label">引き落とし口座</span><span class="value" style="font-size:14px">未設定</span>' +
      '<button type="button" class="link-btn" style="padding-left:0; text-align:left" data-action="edit-account" data-id="' + escapeHtml(account.id) + '">設定すると残高不足をお知らせします</button></div>';
  }

  if (summary.available !== null) {
    html += '<div class="stat"><span class="label">利用可能額（目安）</span><span class="value num">' + formatYen(summary.available) + '</span><span class="small muted">利用枠 ' + formatYen(settings.limit) + '</span></div>';
  } else if (settings.pointRate > 0) {
    html += '<div class="stat"><span class="label">今月のポイント（目安）</span><span class="value num">' + formatNumber(summary.pointsThisPeriod) + ' pt</span><span class="small muted">還元率 ' + settings.pointRate + '%</span></div>';
  } else {
    html += '<div class="stat"><span class="label">これから払う元金</span><span class="value num">' + formatYen(summary.remaining.total) + '</span><span class="small muted">記録済みの引き落としを除く</span></div>';
  }
  html += '</div>';

  // --- 支払日を過ぎたのに記録されていない請求 ---
  if (summary.overdueBills.length > 0) {
    html += '<div class="confirm-box" style="margin-top:14px; border-color:var(--warn); background:color-mix(in oklab, var(--warn) 10%, var(--surface))">' +
      '<p>' + statusChipHtml('warn', '未記録') + ' 支払日を過ぎた請求が' + summary.overdueBills.length + '件あります。引き落とされていたら「記録する」を押してください。</p><div class="row-gap">';
    for (const bill of summary.overdueBills.slice(-3)) {
      html += '<button type="button" class="btn small" data-action="record-bill" data-id="' + escapeHtml(account.id) + '" data-month="' + bill.month + '">' +
        formatMonthDay(bill.payDate) + ' ' + formatYen(bill.total) + ' を記録する</button>';
    }
    html += '</div></div>';
  }

  // --- 残高の内訳（分割・リボ・ボーナス・スキップ） ---
  const remaining = summary.remaining;
  if (remaining.installment + remaining.revolving + remaining.bonus + remaining.skip + remaining.manual > 0) {
    html += '<div class="remaining-row">';
    if (remaining.installment > 0) {
      html += '<span>分割払いの残り <strong class="num">' + formatYen(remaining.installment) + '</strong></span>';
    }
    if (remaining.revolving > 0) {
      html += '<span>リボ払いの残り <strong class="num">' + formatYen(remaining.revolving) + '</strong></span>';
    }
    if (remaining.bonus > 0) {
      html += '<span>ボーナス払いの残り <strong class="num">' + formatYen(remaining.bonus) + '</strong></span>';
    }
    if (remaining.skip > 0) {
      html += '<span>スキップ払いの残り <strong class="num">' + formatYen(remaining.skip) + '</strong></span>';
    }
    if (remaining.manual > 0) {
      html += '<span>手入力の支払い予定 <strong class="num">' + formatYen(remaining.manual) + '</strong></span>';
    }
    html += '</div>';
  }

  // --- 月ごとの支払い予定のグラフ（負債がいつ・どれだけ減っていくか） ---
  html += '<hr class="divider">';
  html += '<div class="card-head" style="margin-bottom:4px"><h2>これから払う金額（月別）</h2><span class="sub">これから払う負債の合計 ' + formatYen(summary.remaining.total) + '</span></div>';
  html += '<div class="legend"><span><i class="key" style="background:var(--chart-1)"></i>元金</span><span><i class="key" style="background:var(--chart-2)"></i>手数料</span></div>';
  html += '<div class="chart" data-debt-chart="' + escapeHtml(account.id) + '"></div>';
  html += manualBillFormHtml(account, settings);

  // --- これからの請求の一覧 ---
  html += '<hr class="divider">';
  html += '<div class="card-head" style="margin-bottom:4px"><h2>これからの請求</h2></div>';
  if (summary.upcomingBills.length === 0) {
    html += '<p class="small muted">これからの請求はありません。</p>';
  } else {
    html += '<div class="bill-table">';
    html += '<div class="bill-row bill-head"><span>引き落とし日</span><span>状態</span><span>元金</span><span>手数料</span><span>合計</span></div>';
    for (const bill of summary.upcomingBills.slice(0, 12)) {
      html += billRowHtml(account, bill, today);
    }
    html += '</div>';
  }

  // --- 過去の請求（直近3回） ---
  const pastBills = summary.bills.filter((bill) => bill.payDate < today).slice(-3).reverse();
  if (pastBills.length > 0) {
    html += '<details class="more"><summary>過去の請求（直近3回）</summary><div class="bill-table" style="margin-top:8px">';
    for (const bill of pastBills) {
      html += billRowHtml(account, bill, today);
    }
    html += '</div></details>';
  }

  // --- カード会社の補足 ---
  html += '<p class="hint" style="margin-top:12px">' + escapeHtml(settings.company.notes) +
    '（確からしさ: ' + CONFIDENCE_LABELS[settings.company.confidence] + ' · ' + settings.company.checkedAt + ' 確認）' +
    ' 手数料の率（いま）: ' + escapeHtml(currentRateText(settings, todayText())) + '。カードの設定から変更できます。</p>';
  html += '</section>';
  return html;
}


/** 請求1回分の行（押すと内訳が開く） */
function billRowHtml(account, bill, today) {
  let state = '';
  if (bill.paid) {
    state = statusChipHtml('good', '記録済み');
  } else if (bill.payDate < today) {
    state = statusChipHtml('warn', '未記録');
  } else if (today > bill.closeDate) {
    state = '<span class="tag" style="margin:0">確定</span>';
  } else {
    state = '<span class="tag" style="margin:0">未確定</span>';
  }

  let html = '<details><summary class="bill-row">' +
    '<span>' + formatMonthDay(bill.payDate) + '</span>' +
    '<span>' + state + '</span>' +
    '<span class="num">' + formatYen(bill.principal) + '</span>' +
    '<span class="num muted">' + (bill.fee > 0 ? formatYen(bill.fee) : '—') + '</span>' +
    '<span class="num"><strong>' + formatYen(bill.total) + '</strong></span>' +
    '</summary><div class="sub-rows" style="padding-left:12px">';

  for (const detail of bill.details) {
    const name = detail.transaction ? (detail.transaction.description || '（内容なし）') + '（' + formatShortDate(detail.transaction.date) + '利用）' : '';
    html += '<div class="sub-row"><span>' + escapeHtml(detail.label) + (name ? ' · ' + escapeHtml(name) : '') + '</span>' +
      '<span class="num">' + formatYen(detail.principal) + (detail.fee > 0 ? ' ＋手数料 ' + formatYen(detail.fee) : '') + '</span></div>';
  }
  if (!bill.paid) {
    html += '<div style="margin-top:6px"><button type="button" class="btn small" data-action="record-bill" data-id="' + escapeHtml(account.id) + '" data-month="' + bill.month + '">この引き落としを記録する</button>' +
      '</div>';
  }
  html += '</div></details>';
  return html;
}


/** 支払い方法のしくみ（勉強用の説明） */
function paymentMethodGuideHtml() {
  let html = '<section class="card span-12"><details><summary class="card-head" style="cursor:pointer; margin:0"><h2>支払い方法のしくみ（読みもの）</h2><span class="sub">分割・リボ・スキップ払いの違い</span></summary>';
  html += '<ul class="plain-list" style="margin-top:8px">';
  for (const methodId of Object.keys(PAYMENT_METHODS)) {
    const method = PAYMENT_METHODS[methodId];
    html += '<li><span class="grow"><span>' + method.label + '</span><span class="small muted" style="white-space:normal">' + method.note + '</span></span></li>';
  }
  html += '</ul>';
  html += '<p class="small" style="margin-top:10px">「締め日」までに使った分が、「支払日」にまとめて口座から引き落とされます。' +
    'たとえば「15日締め・翌月10日払い」なら、9月16日〜10月15日に使った分が11月10日に引き落とされます。' +
    '分割・リボ・スキップ払いは手数料（利息）がかかるので、同じ買い物でも払う総額が増えます。</p>';
  html += '</details></section>';
  return html;
}


/** 「記録する」ボタンが押されたとき */
function recordBillFromButton(accountId, month) {
  const account = accountById[accountId];
  if (!account) {
    return;
  }
  const bills = buildCardBills(account);
  const bill = bills.find((item) => item.month === month);
  if (!bill) {
    return;
  }
  if (recordBillPayment(account, bill)) {
    showToast(formatMonthDay(bill.payDate) + 'の引き落としを記録しました');
  }
}


/**
 * 「月の合計金額だけ入れる」欄。
 * 例: 2027年1月に150,000円。入れた月はカードの残高（負債）に足され、グラフにも出ます。
 */
function manualBillFormHtml(account, settings) {
  const today = todayText();
  // 選べる月: 支払日がまだ来ていない月から36か月分
  let month = billingMonthOf(today, settings);
  if (paymentDateOf(month, settings) < today) {
    month = addMonths(month, 1);
  }
  let options = '';
  for (let count = 0; count < 36; count++) {
    options += '<option value="' + month + '">' + formatMonthText(month) + '（' + formatShortDate(paymentDateOf(month, settings)) + '払い）</option>';
    month = addMonths(month, 1);
  }

  const entries = manualBillsOf(account);
  const isOpen = openManualPanels[account.id] || entries.length > 0;
  let html = '<details class="more"' + (isOpen ? ' open' : '') + '><summary>月の支払い金額だけをまとめて入力する</summary>';
  html += '<p class="hint" style="margin-top:8px">月の合計だけを入れられます。同じ月に入れ直すと上書きされます。</p>';
  html += '<div class="manual-bill-form">' +
    '<label class="field"><span>支払う月</span><select id="manualMonth-' + escapeHtml(account.id) + '">' + options + '</select></label>' +
    '<label class="field"><span>金額</span><div class="amount-input"><span aria-hidden="true">¥</span>' +
    '<input id="manualAmount-' + escapeHtml(account.id) + '" inputmode="numeric" autocomplete="off" placeholder="150000"></div></label>' +
    '<button type="button" class="btn primary" data-action="save-manual-bill" data-id="' + escapeHtml(account.id) + '">入れる</button></div>';
  html += '<p class="form-error" data-manual-error="' + escapeHtml(account.id) + '" role="alert"></p>';

  if (entries.length > 0) {
    html += '<ul class="plain-list">';
    for (const entry of entries) {
      html += '<li><span class="grow"><span>' + formatMonthText(entry.billMonth) + '</span></span>' +
        '<strong class="num">' + formatYen(-entry.amount) + '</strong>' +
        '<button type="button" class="icon-btn" data-action="delete-manual-bill" data-id="' + escapeHtml(entry.id) + '" aria-label="' + formatMonthText(entry.billMonth) + 'の手入力を削除">' + iconSvg('close') + '</button></li>';
    }
    html += '</ul>';
  }
  html += '</details>';
  return html;
}

/** 「入れる」ボタンが押されたとき */
function saveManualBillFromForm(accountId) {
  const account = accountById[accountId];
  if (!account) {
    return;
  }
  const month = findOne('#manualMonth-' + accountId).value;
  const amount = calculateAmount(findOne('#manualAmount-' + accountId).value);
  const errorArea = findOne('[data-manual-error="' + accountId + '"]');
  if (amount === null || Number.isNaN(amount) || amount <= 0) {
    errorArea.textContent = '金額を1円以上の数字で入れてください。';
    return;
  }
  openManualPanels[accountId] = true;
  const error = saveManualBill(account, month, amount);
  if (error) {
    errorArea.textContent = error;
    return;
  }
  showToast(formatMonthText(month) + 'の支払い予定を ' + formatYen(amount) + ' にしました');
}

/** 手入力した1件を消す */
function deleteManualBillById(id) {
  const entry = findTransaction(id);
  if (entry) {
    deleteTransaction(entry);
    showToast('削除しました');
  }
}
