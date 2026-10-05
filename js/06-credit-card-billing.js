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

/** 空欄なら null、数字なら数字にする */
function numberOrNull(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** 分割払いの手数料率（年%）。買い物をした日と回数で決まる */
function installmentRateFor(settings, count, dateText) {
  if (settings.override.installment !== null) {
    return settings.override.installment;
  }
  return pickRate(settings.company.rates.installment, dateText, count);
}

/** リボ払いの手数料率（年%）。dateText 時点の率 */
function revolvingRateFor(settings, dateText) {
  if (settings.override.revolving !== null) {
    return settings.override.revolving;
  }
  return pickRate(settings.company.rates.revolving, dateText);
}

/** スキップ払いの手数料率（年%）。買い物をした日の率 */
function skipRateFor(settings, dateText) {
  if (settings.override.skip !== null) {
    return settings.override.skip;
  }
  return pickRate(settings.company.rates.skip, dateText);
}

/** 画面に出す「今の手数料率」の文。例: 「分割 年14.7〜17.7%・リボ 年18%」 */
function currentRateText(settings, dateText) {
  function rangeText(rates, override) {
    if (override !== null) {
      return '年' + override + '%（自分で設定）';
    }
    const range = rateRangeAt(rates, dateText);
    if (!range) {
      return 'なし';
    }
    return range.min === range.max ? '年' + range.min + '%' : '年' + range.min + '〜' + range.max + '%';
  }
  let text = '分割 ' + rangeText(settings.company.rates.installment, settings.override.installment) +
    '・リボ ' + rangeText(settings.company.rates.revolving, settings.override.revolving);
  if (settings.methods.includes('skip')) {
    text += '・スキップ ' + rangeText(settings.company.rates.skip, settings.override.skip);
  }
  return text;
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
    // 自分で上書きした手数料率（空なら null。null のときは会社の表を日付で引く）
    override: {
      installment: numberOrNull(saved.installmentRate),
      revolving: numberOrNull(saved.revolvingRate),
      skip: numberOrNull(saved.skipRate),
    },
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
  // 0.0001 円を足すのは、小数の計算誤差で 449.9999… になり1円少なくなるのを防ぐため
  return Math.floor(amount * annualRate * months / 1200 + 0.0001);
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
    // 「月ごとの金額だけ」を手入力した支払い予定（新しい形は支出、古い形は残高修正）
    if (transaction.manualBill && transaction.account === account.id) {
      addToBill(transaction.billMonth, 'manual', transaction, '手入力の支払い予定（仮）', manualBillAmountOf(transaction), 0);
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
      const plan = installmentPlan(amount, count, installmentRateFor(settings, count, transaction.date));
      for (let index = 0; index < plan.length; index++) {
        const label = '分割払い ' + (index + 1) + '/' + count + '回目';
        addToBill(addMonths(firstMonth, index), 'installment', transaction, label, plan[index].principal, plan[index].fee);
      }
    } else if (method === 'skip') {
      const months = Math.min(6, Math.max(1, Number(transaction.skipMonths) || 1));
      const fee = skipFee(amount, months, skipRateFor(settings, transaction.date));
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
    const monthlyPrincipal = Math.max(1000, settings.revolvingMonthly);
    let balance = 0;
    let month = revolvingMonths[0];
    for (let guard = 0; guard < 360; guard++) {
      const monthlyRate = revolvingRateFor(settings, paymentDateOf(month, settings)) / 100 / 12;
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
      if (transaction.account === account.id && transaction.type === 'expense' && !transaction.manualBill && transaction.date >= range.start && transaction.date < range.end) {
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
    const rate = installmentRateFor(settings, count, draft.date);
    const plan = installmentPlan(amount, count, rate);
    let totalFee = 0;
    for (const part of plan) {
      totalFee = totalFee + part.fee;
    }
    const monthly = plan[0].principal + plan[0].fee;
    return firstPayDate + 'から' + count + '回 · 毎月 約' + formatYen(monthly) + ' · 手数料 合計 約' + formatYen(totalFee) + '（年率' + rate + '%）';
  }
  if (method === 'skip') {
    const months = Number(draft.skipMonths) || 1;
    const payMonth = addMonths(firstMonth, months);
    const skipRate = skipRateFor(settings, draft.date);
    const fee = skipFee(amount, months, skipRate);
    return formatMonthDay(paymentDateOf(payMonth, settings)) + 'に ' + formatYen(amount + fee) + '（手数料 ' + formatYen(fee) + ' · 年率' + skipRate + '%）';
  }
  if (method === 'revolving') {
    const revolvingRate = revolvingRateFor(settings, draft.date);
    const monthlyFee = Math.round(amount * revolvingRate / 100 / 12);
    return firstPayDate + 'から毎月' + formatYen(settings.revolvingMonthly) + 'ずつ元金を返済 · 手数料は残高に月 約' + formatYen(monthlyFee) + '〜（年率' + revolvingRate + '%）';
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

   【仮の支出】
   入れた金額は、そのカードの「支出」としても数えます。
   日付は、その請求の「締め日」（利用した期間の終わり）にします。
   例: 15日締めで2027年1月払いなら、2026年12月15日の支出。
   （入力した日にすると、先の月の分まで全部が今月に乗ってしまうため）
   明細のCSVが届くまで1か月ほどかかるので、その間も支出・予算に出すためです。
   CSVを取り込んだら、カード画面で明細の合計と比べて、仮の支出を消します（相殺）。
   消さないと、仮と明細の両方が入って二重になります。
   =========================================================== */

/** 仮の支出につける中項目の名前（「その他」の中。01-categories.js の subs にも入れてある） */
const MANUAL_BILL_SUB = 'カード引き落とし（仮）';

/**
 * 手入力した支払い予定の金額（プラスの数）を返す。
 * 古い保存データは「残高修正」（マイナスの金額）の形なので、どちらの形でも読めるようにする。
 */
function manualBillAmountOf(transaction) {
  return transaction.type === 'adjust' ? -transaction.amount : transaction.amount;
}

/** 仮の支出の日付: その請求の締め日（利用した期間の終わり） */
function manualBillDate(account, month) {
  return closingDateOf(month, cardSettings(account));
}

/**
 * 古い形（残高修正）で保存された手入力を、支出の形に直す。直したら true を返す。
 * 日付・請求月・id はそのまま。2回呼んでも2回目は何もしない。
 */
function upgradeManualBill(transaction) {
  if (!transaction.manualBill || transaction.type !== 'adjust') {
    return false;
  }
  transaction.type = 'expense';
  transaction.amount = -transaction.amount;
  transaction.category = 'other';
  transaction.sub = MANUAL_BILL_SUB;
  return true;
}

/**
 * 仮の支出の日付を、その請求の締め日に置き直す。置き直したら true を返す。
 * 「日付は決定済み」の印（dateFixed）がある記録には触らない（2回目以降と、自分で日付を直した記録）。
 */
function redateManualBill(transaction, account) {
  if (!transaction.manualBill || transaction.dateFixed || !account) {
    return false;
  }
  transaction.date = manualBillDate(account, transaction.billMonth);
  transaction.dateFixed = true;
  return true;
}

/**
 * 読み込んだ全データの手入力（仮の支出）を直す。
 *   ・古い形（残高修正）を支出の形にする
 *   ・日付を締め日に置き直す（日付が変わったら、月の箱も移す）
 * 直した月のリストを返す（保存し直すため）。何も直さなければ空。
 */
function upgradeAllManualBills() {
  const changedMonths = new Set();
  const accounts = appState.profile && appState.profile.accounts ? appState.profile.accounts : [];
  const moves = []; // 月の箱を移す記録 { transaction, fromMonth }
  for (const month of Object.keys(appState.monthly)) {
    for (const transaction of appState.monthly[month]) {
      if (!transaction.manualBill) {
        continue;
      }
      const isUpgraded = upgradeManualBill(transaction);
      const account = accounts.find((item) => item.id === transaction.account);
      const isRedated = redateManualBill(transaction, account);
      if (isUpgraded || isRedated) {
        changedMonths.add(month);
      }
      if (monthOfDate(transaction.date) !== month) {
        moves.push({ transaction: transaction, fromMonth: month });
      }
    }
  }
  for (const move of moves) {
    const toMonth = monthOfDate(move.transaction.date);
    appState.monthly[move.fromMonth] = appState.monthly[move.fromMonth].filter((item) => item.id !== move.transaction.id);
    if (!appState.monthly[toMonth]) {
      appState.monthly[toMonth] = [];
    }
    appState.monthly[toMonth].push(move.transaction);
    changedMonths.add(move.fromMonth);
    changedMonths.add(toMonth);
  }
  return [...changedMonths];
}

/** そのカードの、手入力した支払い予定の一覧（月の順） */
function manualBillsOf(account) {
  const list = allTransactions.filter((item) => item.manualBill && item.account === account.id);
  list.sort((a, b) => (a.billMonth < b.billMonth ? -1 : 1));
  return list;
}

/**
 * 手入力1件分の記録（仮の支出）を作る。日付はその請求の締め日。
 *   existing … 同じ月にすでに入れていた記録（あれば、id を引き継いで上書きする）
 */
function manualBillRecord(account, month, amount, existing) {
  return {
    id: existing ? existing.id : makeId(),
    date: manualBillDate(account, month),
    dateFixed: true,
    type: 'expense',
    amount: amount,
    account: account.id,
    category: 'other',
    sub: MANUAL_BILL_SUB,
    description: '支払い予定（仮）' + formatMonthText(month),
    memo: '月ごとの合計金額だけを入力。CSVを取り込んだら、カード画面で仮を消す（相殺）',
    include: true,
    createdAt: existing ? existing.createdAt : Date.now(),
    manualBill: true,
    billMonth: month,
  };
}

/**
 * 仮の入力と、取り込んだ明細を比べる（相殺してよいかの確認用）。
 *   entry   … 手入力の記録
 *   records … 比べる元の入出金（省略するとそのカードの全部）
 * 返すもの: { manualAmount: 仮の金額, detailAmount: 明細の合計, detailCount: 明細の件数, difference: 仮 − 明細, hasDetail }
 * 明細の合計は、同じ請求月に入っている手入力以外のもの（手数料つきの分割なども含む）。
 */
function manualBillCheck(account, entry, records) {
  const bill = buildCardBills(account, records).find((item) => item.month === entry.billMonth);
  const manualAmount = manualBillAmountOf(entry);
  let detailAmount = 0;
  let detailCount = 0;
  if (bill) {
    detailAmount = bill.total - bill.parts.manual;
    for (const detail of bill.details) {
      if (!(detail.transaction && detail.transaction.manualBill)) {
        detailCount = detailCount + 1;
      }
    }
  }
  return {
    manualAmount: manualAmount,
    detailAmount: detailAmount,
    detailCount: detailCount,
    difference: manualAmount - detailAmount,
    hasDetail: detailCount > 0,
  };
}

/**
 * 取り込んだ明細（records）のうち、仮の入力と比べられるようになったカードの一覧を返す。
 * 取り込みのあとに「カード画面で仮を消してください」と知らせるために使う。
 */
function cardsToOffset(records) {
  const found = [];
  const checkedIds = new Set();
  for (const record of records) {
    const account = accountById[record.account];
    if (!account || account.kind !== 'card' || checkedIds.has(account.id)) {
      continue;
    }
    checkedIds.add(account.id);
    if (manualBillsOf(account).some((entry) => manualBillCheck(account, entry).hasDetail)) {
      found.push(account);
    }
  }
  return found;
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
  const transaction = manualBillRecord(account, month, amount, existing);
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
