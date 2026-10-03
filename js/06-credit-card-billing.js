/* ===========================================================
   06-credit-card-billing.js  ―  クレジットカードの請求の計算
   -----------------------------------------------------------
   カードで買い物をすると、すぐにお金が出ていくわけではありません。
     ① 締め日までの利用分がまとめられ（請求が確定）
     ② 支払日に銀行口座から引き落とされます
   さらに「分割」「リボ」「ボーナス払い」「スキップ払い」などを選ぶと、
   いつ・いくら払うかが変わり、手数料がかかることもあります。

   このファイルは、カードの利用記録から
     「何月の何日に、いくら引き落とされるか」
   を計算します。画面（12-screen-cards.js）はこの結果を表示するだけです。

   用語:
     請求（bill）… ある支払日に引き落とされる1回分
       {
         month:     "2026-11",      何月の支払いか
         payDate:   "2026-11-10",   引き落とし日
         closeDate: "2026-10-15",   この請求が確定する締め日
         parts:     { once: 0, installment: 0, ... }  支払い方法ごとの元金
         principal: 元金の合計（買ったものの代金）
         fee:       手数料の合計
         total:     principal + fee（実際に引き落とされる額）
         details:   [{ transaction, label, principal, fee }]  1件ずつの内訳
         paid:      引き落としを記録済みなら true
       }
   ※ 計算はカード会社の一般的なルールにもとづく目安です。
     土日祝日で支払日がずれることなどは考えていません。
   =========================================================== */


/* ===========================================================
   1. カードの設定を読む
   =========================================================== */

/** 値が入っていなければ代わりの値を使う（0 は「入っている」とみなす） */
function valueOr(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return value;
}

/**
 * カード口座の設定を、カード会社の初期値と合わせて返す。
 * （口座ごとに上書きした数字があれば、そちらを使う）
 */
function cardSettings(account) {
  const saved = account.card || {};
  const company = findCardCompany(saved.company);
  const cycle = company.cycles[valueOr(saved.cycleIndex, 0)] || company.cycles[0];
  return {
    company: company,
    closingDay: Number(valueOr(saved.closingDay, cycle.closingDay)),
    paymentDay: Number(valueOr(saved.paymentDay, cycle.paymentDay)),
    monthsLater: Number(valueOr(saved.monthsLater, cycle.monthsLater)),
    payFrom: saved.payFrom || '',
    limit: Number(valueOr(saved.limit, 0)),
    installmentRate: Number(valueOr(saved.installmentRate, company.installmentRate)),
    revolvingRate: Number(valueOr(saved.revolvingRate, company.revolvingRate)),
    skipRate: Number(valueOr(saved.skipRate, company.skipRate)),
    bonus2Fee: Number(valueOr(saved.bonus2Fee, company.bonus2Fee)),
    revolvingMonthly: Number(valueOr(saved.revolvingMonthly, 10000)),
    autoRevolving: saved.autoRevolving === true,
    pointRate: Number(valueOr(saved.pointRate, 0)),
    methods: company.methods,
    bonus: company.bonus,
  };
}

/** 締め日・支払日を「15日締め・翌月10日払い」のような文にする */
function describeCycle(settings) {
  const closing = settings.closingDay >= 31 ? '月末' : settings.closingDay + '日';
  const payment = settings.paymentDay >= 31 ? '月末' : settings.paymentDay + '日';
  const monthWords = ['当月', '翌月', '翌々月'];
  const monthWord = monthWords[settings.monthsLater] || settings.monthsLater + 'か月後の';
  return closing + '締め・' + monthWord + payment + '払い';
}


/* ===========================================================
   2. 日付の計算（締め日・支払日）
   =========================================================== */

/** 利用日がどの月の締めに入るか（"2026-09-20" で15日締め → "2026-10"） */
function closingMonthOf(dateText, closingDay) {
  const month = dateText.slice(0, 7);
  const closingDate = dayInMonthText(month, closingDay); // 31は月末になる
  if (dateText <= closingDate) {
    return month;
  }
  return addMonths(month, 1);
}

/** 利用日の分を何月に払うか（1回払いの場合） */
function billingMonthOf(dateText, settings) {
  return addMonths(closingMonthOf(dateText, settings.closingDay), settings.monthsLater);
}

/** 何月の請求の引き落とし日 */
function paymentDateOf(billMonth, settings) {
  return dayInMonthText(billMonth, settings.paymentDay);
}

/** 何月の請求が確定する締め日 */
function closingDateOf(billMonth, settings) {
  return dayInMonthText(addMonths(billMonth, -settings.monthsLater), settings.closingDay);
}

/** "06-15" のような月日が、ボーナス払いの期間に入っているか */
function isInBonusSeason(monthDay, season) {
  if (season.from <= season.to) {
    return monthDay >= season.from && monthDay <= season.to;
  }
  // 12-16〜06-15 のように年をまたぐ期間
  return monthDay >= season.from || monthDay <= season.to;
}

/**
 * ボーナス一括払いの支払月。使えない時期なら null。
 * 例: JCBで 2026-03-01 に利用 → "2026-08"
 */
function bonusMonthOf(dateText, bonus) {
  if (!bonus) {
    return null;
  }
  const monthDay = dateText.slice(5);
  const year = Number(dateText.slice(0, 4));
  const seasons = [bonus.summer, bonus.winter];
  for (const season of seasons) {
    if (!isInBonusSeason(monthDay, season)) {
      continue;
    }
    // 期間が終わる年（12/16〜6/15 で12月に使ったら、終わるのは翌年）
    let endYear = year;
    if (monthDay > season.to) {
      endYear = year + 1;
    }
    const endMonth = Number(season.to.slice(0, 2));
    // 支払月が期間の終わりより後ならその年、前なら翌年
    const payYear = season.payMonth >= endMonth ? endYear : endYear + 1;
    return makeMonthText(payYear, season.payMonth);
  }
  return null;
}

/** ボーナス2回払いの2回目（1回目のあとの、もう一方のボーナス月） */
function secondBonusMonth(firstMonth, bonus) {
  const firstMonthNumber = Number(firstMonth.slice(5));
  const otherMonthNumber = firstMonthNumber === bonus.summer.payMonth ? bonus.winter.payMonth : bonus.summer.payMonth;
  let month = addMonths(firstMonth, 1);
  while (Number(month.slice(5)) !== otherMonthNumber) {
    month = addMonths(month, 1);
  }
  return month;
}


/* ===========================================================
   3. 手数料の計算
   =========================================================== */

/**
 * 分割払いの毎月の支払い（元利均等方式の目安）。
 * 返す形: [{ principal: 元金, fee: 手数料 }, ...]（回数分）
 */
function installmentPlan(amount, count, annualRate) {
  const monthlyRate = annualRate / 100 / 12;
  let payment;
  if (monthlyRate === 0) {
    payment = amount / count;
  } else {
    payment = amount * monthlyRate / (1 - Math.pow(1 + monthlyRate, -count));
  }
  payment = Math.floor(payment);

  const plan = [];
  let remaining = amount;
  for (let number = 1; number <= count; number++) {
    const fee = Math.round(remaining * monthlyRate);
    let principal = payment - fee;
    if (number === count || principal > remaining) {
      principal = remaining; // 最後の回で残りをぜんぶ払う
    }
    remaining = remaining - principal;
    plan.push({ principal: principal, fee: fee });
  }
  return plan;
}

/** スキップ払いの手数料 = 利用額 × 月利 × ずらした月数 */
function skipFee(amount, months, annualRate) {
  return Math.floor(amount * (annualRate / 100 / 12) * months);
}


/* ===========================================================
   4. 請求の一覧を作る（このファイルの中心）
   =========================================================== */

/** そのカードの入出金に、実際に使う支払い方法 */
function effectivePayMethod(transaction, settings) {
  const method = transaction.payMethod || 'once';
  if (method === 'once' && settings.autoRevolving) {
    return 'revolving'; // 登録型リボ: 1回払いも自動でリボになる
  }
  return method;
}

/** 支払い方法を一覧用の短い文字にする（1回払いは空） */
function paymentMethodLabel(transaction) {
  const method = transaction.payMethod || 'once';
  if (method === 'once') {
    return '';
  }
  if (method === 'installment') {
    return '分割' + (transaction.installments || 3) + '回';
  }
  if (method === 'skip') {
    return 'スキップ' + (transaction.skipMonths || 1) + 'か月';
  }
  const info = PAYMENT_METHODS[method];
  return info ? info.short : '';
}

/**
 * カード1枚分の請求を、月ごとにまとめて返す（古い順）。
 * records を渡すと、保存済みのデータの代わりにそれを使う（サンプル作成用）。
 */
function buildCardBills(account, records) {
  const settings = cardSettings(account);
  const billsByMonth = {};

  // 指定した月の請求の入れ物を用意する（なければ作る）
  function billFor(month) {
    if (!billsByMonth[month]) {
      billsByMonth[month] = {
        month: month,
        payDate: paymentDateOf(month, settings),
        closeDate: closingDateOf(month, settings),
        parts: { opening: 0, manual: 0, once: 0, twice: 0, bonus: 0, bonus2: 0, installment: 0, revolving: 0, skip: 0 },
        principal: 0,
        fee: 0,
        total: 0,
        details: [],
        paid: false,
        paidAmount: 0,
      };
    }
    return billsByMonth[month];
  }

  // 請求に1件分を書き足す
  function addToBill(month, part, transaction, label, principal, fee) {
    const bill = billFor(month);
    bill.parts[part] = bill.parts[part] + principal;
    bill.principal = bill.principal + principal;
    bill.fee = bill.fee + fee;
    bill.total = bill.total + principal + fee;
    bill.details.push({ transaction: transaction, label: label, principal: principal, fee: fee });
  }

  // --- (1) 登録時の未払い残高（カードの残高がマイナスで登録されていたら） ---
  if (Number(account.opening) < 0) {
    let month = monthOfDate(account.openDate);
    if (paymentDateOf(month, settings) < account.openDate) {
      month = addMonths(month, 1);
    }
    addToBill(month, 'opening', null, '登録時の未払い残高', -Number(account.opening), 0);
  }

  // --- (2) 利用1件ずつ、支払い方法に合わせて請求に振り分ける ---
  const revolvingAdds = {}; // リボに回った金額（請求月 → 金額）
  const cardRecords = records || transactionsOfAccount(account.id);

  for (const transaction of cardRecords) {
    // 「月ごとの金額だけ」を手入力した支払い予定（金額はマイナスで保存されている）
    if (transaction.type === 'adjust' && transaction.manualBill && transaction.account === account.id) {
      addToBill(transaction.billMonth, 'manual', transaction, '手入力の支払い予定', -transaction.amount, 0);
      continue;
    }
    // カードの利用（支出）と、カードからのチャージ（振替元がカード）だけが請求の対象
    let amount = 0;
    if (transaction.type === 'expense' && transaction.account === account.id) {
      amount = transaction.amount;
    } else if (transaction.type === 'transfer' && transaction.account === account.id) {
      amount = transaction.amount;
    } else if (transaction.type === 'income' && transaction.account === account.id) {
      // 返品・返金（マイナスの利用として1回払いの分から引く）
      addToBill(billingMonthOf(transaction.date, settings), 'once', transaction, '返金', -transaction.amount, 0);
      continue;
    } else {
      continue;
    }

    const method = transaction.type === 'expense' ? effectivePayMethod(transaction, settings) : 'once';
    const firstMonth = billingMonthOf(transaction.date, settings);

    if (method === 'twice') {
      const firstHalf = Math.floor(amount / 2);
      addToBill(firstMonth, 'twice', transaction, '2回払い 1/2回目', firstHalf, 0);
      addToBill(addMonths(firstMonth, 1), 'twice', transaction, '2回払い 2/2回目', amount - firstHalf, 0);
    } else if (method === 'bonus' && bonusMonthOf(transaction.date, settings.bonus)) {
      addToBill(bonusMonthOf(transaction.date, settings.bonus), 'bonus', transaction, 'ボーナス一括払い', amount, 0);
    } else if (method === 'bonus2' && bonusMonthOf(transaction.date, settings.bonus)) {
      const month1 = bonusMonthOf(transaction.date, settings.bonus);
      const month2 = secondBonusMonth(month1, settings.bonus);
      const totalFee = Math.floor(amount * settings.bonus2Fee / 100);
      const half = Math.floor(amount / 2);
      const halfFee = Math.floor(totalFee / 2);
      addToBill(month1, 'bonus2', transaction, 'ボーナス2回払い 1/2回目', half, halfFee);
      addToBill(month2, 'bonus2', transaction, 'ボーナス2回払い 2/2回目', amount - half, totalFee - halfFee);
    } else if (method === 'installment') {
      const count = Number(transaction.installments) || 3;
      const plan = installmentPlan(amount, count, settings.installmentRate);
      for (let index = 0; index < plan.length; index++) {
        const label = '分割払い ' + (index + 1) + '/' + count + '回目';
        addToBill(addMonths(firstMonth, index), 'installment', transaction, label, plan[index].principal, plan[index].fee);
      }
    } else if (method === 'skip') {
      const months = Math.min(6, Math.max(1, Number(transaction.skipMonths) || 1));
      const fee = skipFee(amount, months, settings.skipRate);
      addToBill(addMonths(firstMonth, months), 'skip', transaction, 'スキップ払い（' + months + 'か月後）', amount, fee);
    } else if (method === 'revolving') {
      revolvingAdds[firstMonth] = (revolvingAdds[firstMonth] || 0) + amount;
    } else {
      // 1回払い（ボーナス期間外にボーナス払いを選んだ場合もここ）
      addToBill(firstMonth, 'once', transaction, '1回払い', amount, 0);
    }
  }

  // --- (3) リボ払いを月ごとに計算する ---
  //   毎月: 前月から残っている元金に手数料がかかる → 決まった額の元金を払う
  const revolvingMonths = Object.keys(revolvingAdds).sort();
  if (revolvingMonths.length > 0) {
    const lastAddMonth = revolvingMonths[revolvingMonths.length - 1];
    const monthlyRate = settings.revolvingRate / 100 / 12;
    const monthlyPrincipal = Math.max(1000, settings.revolvingMonthly);
    let balance = 0;
    let month = revolvingMonths[0];
    for (let guard = 0; guard < 360; guard++) {
      const fee = Math.round(balance * monthlyRate);
      balance = balance + (revolvingAdds[month] || 0);
      const principal = Math.min(balance, monthlyPrincipal);
      balance = balance - principal;
      if (principal > 0 || fee > 0) {
        addToBill(month, 'revolving', null, 'リボ払い（残り ' + formatYen(balance) + '）', principal, fee);
      }
      if (balance <= 0 && month >= lastAddMonth) {
        break;
      }
      month = addMonths(month, 1);
    }
  }

  // --- (4) 引き落としを記録済みかどうか ---
  for (const transaction of cardRecords) {
    if (transaction.type === 'transfer' && transaction.toAccount === account.id && transaction.billMonth) {
      const bill = billsByMonth[transaction.billMonth];
      if (bill) {
        bill.paid = true;
        bill.paidAmount = bill.paidAmount + transaction.amount;
      }
    }
  }

  const bills = Object.values(billsByMonth).filter((bill) => bill.total !== 0 || bill.paid);
  bills.sort((a, b) => (a.month < b.month ? -1 : 1));
  return bills;
}


/* ===========================================================
   5. カード1枚のまとめ（画面に出す数字）
   =========================================================== */

/**
 * 返す形:
 *   {
 *     settings, bills,
 *     nextBill:      次に引き落とされる請求（なければ null）
 *     overdueBills:  支払日を過ぎたのに記録されていない請求
 *     upcomingBills: これからの請求（支払日が今日以降）
 *     remaining:     これから払う元金 { installment, revolving, bonus, skip, total }
 *     available:     利用可能額の目安（利用枠が未設定なら null）
 *     payFromAccount, payFromBalance, isShort: 引き落とし口座の残高が足りないか
 *     pointsThisPeriod: 今の期間の利用でもらえるポイントの目安
 *   }
 */
function cardSummary(account) {
  const settings = cardSettings(account);
  const bills = buildCardBills(account);
  const today = todayText();

  const overdueBills = bills.filter((bill) => !bill.paid && bill.payDate < today && bill.total > 0);
  const upcomingBills = bills.filter((bill) => !bill.paid && bill.payDate >= today && bill.total > 0);
  const nextBill = upcomingBills.length > 0 ? upcomingBills[0] : null;

  const remaining = { installment: 0, revolving: 0, bonus: 0, skip: 0, manual: 0, total: 0 };
  for (const bill of bills) {
    if (bill.paid) {
      continue;
    }
    remaining.installment = remaining.installment + bill.parts.installment;
    remaining.revolving = remaining.revolving + bill.parts.revolving;
    remaining.bonus = remaining.bonus + bill.parts.bonus + bill.parts.bonus2;
    remaining.skip = remaining.skip + bill.parts.skip;
    remaining.manual = remaining.manual + bill.parts.manual;
    remaining.total = remaining.total + bill.principal;
  }

  const owed = -currentBalance(account); // カードの残高はマイナス＝借りている額
  const available = settings.limit > 0 ? settings.limit - Math.max(0, owed) : null;

  const payFromAccount = accountById[settings.payFrom] || null;
  const payFromBalance = payFromAccount ? currentBalance(payFromAccount) : null;
  let isShort = false;
  if (payFromAccount && nextBill) {
    isShort = payFromBalance < nextBill.total;
  }

  // 今の期間の利用額 × 還元率
  let pointsThisPeriod = 0;
  if (settings.pointRate > 0) {
    const range = periodRange(periodOf(today));
    let used = 0;
    for (const transaction of allTransactions) {
      if (transaction.account === account.id && transaction.type === 'expense' && transaction.date >= range.start && transaction.date < range.end) {
        used = used + transaction.amount;
      }
    }
    pointsThisPeriod = Math.floor(used * settings.pointRate / 100);
  }

  return {
    settings: settings,
    bills: bills,
    nextBill: nextBill,
    overdueBills: overdueBills,
    upcomingBills: upcomingBills,
    remaining: remaining,
    available: available,
    payFromAccount: payFromAccount,
    payFromBalance: payFromBalance,
    isShort: isShort,
    pointsThisPeriod: pointsThisPeriod,
  };
}

/** カード口座の一覧 */
function cardAccounts() {
  return appState.profile.accounts.filter((account) => account.kind === 'card');
}


/* ===========================================================
   6. 入力画面で「いつ・いくら払うか」を前もって見せる
   =========================================================== */

/**
 * これから記録する利用について、支払いの見通しを文にする。
 * draft = { date, amount, payMethod, installments, skipMonths }
 */
function describePaymentPreview(account, draft) {
  const settings = cardSettings(account);
  const amount = draft.amount;
  if (!amount || amount <= 0 || !isValidDateText(draft.date)) {
    return '';
  }
  const firstMonth = billingMonthOf(draft.date, settings);
  const firstPayDate = formatMonthDay(paymentDateOf(firstMonth, settings));
  let method = draft.payMethod || 'once';
  if (method === 'once' && settings.autoRevolving) {
    method = 'revolving';
  }

  if (method === 'twice') {
    const second = formatMonthDay(paymentDateOf(addMonths(firstMonth, 1), settings));
    return firstPayDate + 'と' + second + 'に約' + formatYen(amount / 2) + 'ずつ（手数料なし）';
  }
  if (method === 'bonus' || method === 'bonus2') {
    const bonusMonth = bonusMonthOf(draft.date, settings.bonus);
    if (!bonusMonth) {
      return 'この日はボーナス払いの期間外です。1回払いとして計算します（' + firstPayDate + '）。';
    }
    const bonusDate = formatMonthText(bonusMonth) + settings.paymentDay + '日';
    if (method === 'bonus') {
      return bonusDate + 'に' + formatYen(amount) + '（手数料なし）';
    }
    const fee = Math.floor(amount * settings.bonus2Fee / 100);
    const secondMonth = secondBonusMonth(bonusMonth, settings.bonus);
    return bonusDate + 'と' + formatMonthText(secondMonth) + 'の2回 · 手数料 約' + formatYen(fee);
  }
  if (method === 'installment') {
    const count = Number(draft.installments) || 3;
    const plan = installmentPlan(amount, count, settings.installmentRate);
    let totalFee = 0;
    for (const part of plan) {
      totalFee = totalFee + part.fee;
    }
    const monthly = plan[0].principal + plan[0].fee;
    return firstPayDate + 'から' + count + '回 · 毎月 約' + formatYen(monthly) + ' · 手数料 合計 約' + formatYen(totalFee) + '（年率' + settings.installmentRate + '%）';
  }
  if (method === 'skip') {
    const months = Number(draft.skipMonths) || 1;
    const payMonth = addMonths(firstMonth, months);
    const fee = skipFee(amount, months, settings.skipRate);
    return formatMonthDay(paymentDateOf(payMonth, settings)) + 'に ' + formatYen(amount + fee) + '（手数料 ' + formatYen(fee) + ' · 年率' + settings.skipRate + '%）';
  }
  if (method === 'revolving') {
    const monthlyFee = Math.round(amount * settings.revolvingRate / 100 / 12);
    return firstPayDate + 'から毎月' + formatYen(settings.revolvingMonthly) + 'ずつ元金を返済 · 手数料は残高に月 約' + formatYen(monthlyFee) + '〜（年率' + settings.revolvingRate + '%）';
  }
  return firstPayDate + 'に ' + formatYen(amount) + '（手数料なし）';
}


/* ===========================================================
   7. 引き落としを記録する
   =========================================================== */

/**
 * 請求1回分の引き落としを記録する。
 *   ・元金 → 引き落とし口座からカードへの「振替」
 *   ・手数料 → 引き落とし口座からの「支出」（その他 > カード手数料）
 */
function recordBillPayment(account, bill) {
  const settings = cardSettings(account);
  if (!settings.payFrom || !accountById[settings.payFrom]) {
    showToast('先にカードの「引き落とし口座」を設定してください。');
    return false;
  }
  const label = formatMonthText(bill.month) + '請求分';
  const newRecords = [];
  if (bill.principal > 0) {
    newRecords.push({
      id: makeId(),
      date: bill.payDate,
      type: 'transfer',
      amount: bill.principal,
      account: settings.payFrom,
      toAccount: account.id,
      description: account.name + ' 引き落とし（' + label + '）',
      memo: '',
      include: true,
      createdAt: Date.now(),
      billMonth: bill.month,
    });
  }
  if (bill.fee > 0) {
    newRecords.push({
      id: makeId(),
      date: bill.payDate,
      type: 'expense',
      amount: bill.fee,
      account: settings.payFrom,
      category: 'other',
      sub: 'カード手数料',
      description: account.name + ' 手数料（' + label + '）',
      memo: '分割・リボ・スキップ払いなどの手数料',
      include: true,
      createdAt: Date.now() + 1,
      billMonth: bill.month,
    });
  }
  if (newRecords.length === 0) {
    return false;
  }
  putManyTransactions(newRecords);
  return true;
}


/* ===========================================================
   8. 月ごとの支払い金額だけを手入力する
   -----------------------------------------------------------
   「2027年1月に15万円払う」のように、買い物1件ずつではなく
   月の合計だけを入れる方法です（JCBの会員サイトで見た確定額など）。
   カードの残高（未払い＝負債）にも足され、引き落としを記録すると
   ふつうの請求と同じように消えます。
   同じ月にもう一度入れると、金額が上書きされます（0円か空欄で削除）。
   =========================================================== */

/** そのカードの、手入力した支払い予定の一覧（月の順） */
function manualBillsOf(account) {
  const list = allTransactions.filter((item) => item.manualBill && item.account === account.id);
  list.sort((a, b) => (a.billMonth < b.billMonth ? -1 : 1));
  return list;
}

/** 手入力の金額を保存する。amount が 0 なら削除。エラーのときは文を返す */
function saveManualBill(account, month, amount) {
  const existing = manualBillsOf(account).find((item) => item.billMonth === month);
  if (!amount || amount <= 0) {
    if (existing) {
      deleteTransaction(existing);
      return '';
    }
    return '金額を入れてください。';
  }
  const transaction = {
    id: existing ? existing.id : makeId(),
    date: existing ? existing.date : todayText(),
    type: 'adjust',
    amount: -amount,                 // カードの残高はマイナスが「借りている」
    account: account.id,
    description: '支払い予定（手入力）' + formatMonthText(month),
    memo: '月ごとの合計金額だけを入力',
    include: true,
    createdAt: existing ? existing.createdAt : Date.now(),
    manualBill: true,
    billMonth: month,
  };
  putTransaction(transaction, existing ? existing.date : null);
  return '';
}

/** グラフ用: これから払う金額を月ごとに並べる（払いのない月は0で埋める） */
function cardDebtRows(summary) {
  const unpaid = summary.bills.filter((bill) => !bill.paid && bill.total > 0);
  if (unpaid.length === 0) {
    return [];
  }
  const byMonth = {};
  let remaining = 0;
  for (const bill of unpaid) {
    byMonth[bill.month] = bill;
    remaining = remaining + bill.principal;
  }
  const firstMonth = unpaid[0].month;
  const lastMonth = unpaid[unpaid.length - 1].month;
  const rows = [];
  let month = firstMonth;
  for (let count = 0; count < 36 && month <= lastMonth; count++) {
    const bill = byMonth[month];
    const principal = bill ? bill.principal : 0;
    remaining = remaining - principal;
    rows.push({
      month: month,
      payDate: paymentDateOf(month, summary.settings),
      principal: principal,
      fee: bill ? bill.fee : 0,
      remainingAfter: remaining,
    });
    month = addMonths(month, 1);
  }
  return rows;
}
