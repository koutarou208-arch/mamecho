/* ===========================================================
   tests/patterns.js  ―  全パターンのテスト（組み合わせを機械で全部つくって試す）
   -----------------------------------------------------------
   tests.js は「この例なら、こうなる」を1つずつ確かめます。
   このファイルは、ありうる組み合わせを機械的に全部つくって、
   「どんな場合でも必ず成り立つはずの決まり」を確かめます。たとえば、
     ・お金が消えたり増えたりしない（元金を全部足すと、使った金額になる）
     ・支払日は締め日より後、買い物をした日より後
     ・合計と内訳が合う
     ・期間と期間のあいだに、すき間も重なりもない

   試すもの:
     1. 日付と期間 … 2024〜2030年のすべての日 × 1か月の始まりの日（1〜28日）
     2. カードの請求 … すべてのカード会社 × すべての締め日・支払日 × すべての支払い方法 × 2026〜2028年のすべての日
     3. 自分で決めた締め日・支払日 … 締め日1〜31日 × 支払日1〜31日 × 当月・翌月・翌々月
     4. まぜこぜの家計簿 … 乱数で300通りつくる（請求・残高・月の合計・数字の点検・Claude 用のまとめ・
                           バックアップ・CSV の行き帰り）。乱数は毎回同じ並びなので、結果も毎回同じ
     5. CSV の金額の書き方 … 符号・カンマ・円・全角・小数などの組み合わせ
     6. 手取り計算 … 額面5万〜200万円 × 年齢 × 家族 × ボーナス × 交通費
     7. 記録の出し入れ … 足す・直す・こわれた形をまぜて1万回

   1通りずつ「OK」を出すと何十万行にもなるので、決まりごとに1行にまとめて、
   「何通り試したか」と、だめだったときは「どの組み合わせか（3つまで）」を出します。
   tests.js のあとにつなげて動かします（check・same・section は tests.js のもの）。
   =========================================================== */

/* ---------- 道具 ---------- */

/** 決まりごと1つ分の入れ物（何通り試して、いくつだめだったか） */
function startRule(name) {
  return { name: name, count: 0, failed: 0, examples: [] };
}

/** 1通り分の結果を記録する。だめなら、説明（describe が返す文）を3つまで覚える */
function recordRule(rule, ok, describe) {
  rule.count = rule.count + 1;
  if (!ok) {
    rule.failed = rule.failed + 1;
    if (rule.examples.length < 3) {
      rule.examples.push(describe());
    }
  }
}

/** 決まりごとの結果を1行で出す */
function finishRule(rule) {
  check(rule.name + '（' + formatNumber(rule.count) + '通り）', rule.count > 0 && rule.failed === 0);
  if (rule.failed > 0) {
    print('      だめだった数: ' + formatNumber(rule.failed));
    for (const example of rule.examples) {
      print('      例: ' + example);
    }
  }
}

/**
 * 毎回同じ並びになる乱数（mulberry32 という方法）。
 * seed（種）が同じなら、同じ数が同じ順に出る（テストの結果を毎回同じにするため）。
 */
function makeTestRandom(seed) {
  let state = seed >>> 0;
  function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value = value ^ (value + Math.imul(value ^ (value >>> 7), value | 61));
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
  return {
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (probability) => next() < probability,
  };
}

/** start から end までの日付（1日ずつ） */
function datesBetween(start, end) {
  const dates = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

/** うるう年か（日付の道具を使わずに、決まりから計算する。答え合わせ用） */
function isLeapYearForTest(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** その月の日数（答え合わせ用。アプリの daysInMonth とは別の方法で計算する） */
function daysInMonthForTest(year, month) {
  if (month === 2) {
    return isLeapYearForTest(year) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** 請求1回分の数字が合っているか（合計 = 元金 + 手数料 = 明細の合計、元金 = 欄の合計、整数）。合わなければ理由 */
function billMathProblemForTest(bill) {
  let partsTotal = 0;
  for (const value of Object.values(bill.parts)) {
    partsTotal = partsTotal + value;
  }
  let detailsTotal = 0;
  for (const detail of bill.details) {
    detailsTotal = detailsTotal + detail.principal + detail.fee;
  }
  for (const value of [bill.total, bill.principal, bill.fee, partsTotal, detailsTotal]) {
    if (!Number.isInteger(value)) {
      return '整数でない数がある';
    }
  }
  if (bill.total !== bill.principal + bill.fee) {
    return '合計 ≠ 元金 + 手数料';
  }
  if (bill.principal !== partsTotal) {
    return '元金 ≠ 欄の合計';
  }
  if (bill.total !== detailsTotal) {
    return '合計 ≠ 明細の合計';
  }
  if (bill.fee < 0) {
    return '手数料がマイナス';
  }
  return '';
}

/** テストの前の状態（家計簿のデータ）を覚えておき、あとで戻すための入れ物 */
function saveGlobalsForTest() {
  return { profile: appState.profile, monthly: appState.monthly, transactions: allTransactions, accounts: accountById };
}

function restoreGlobalsForTest(saved) {
  appState.profile = saved.profile;
  appState.monthly = saved.monthly;
  allTransactions = saved.transactions;
  accountById = saved.accounts;
}

/** テスト用の家計簿をアプリに入れる（月の箱に入れて、一覧を作り直す） */
function installLedgerForTest(ledger) {
  appState.profile = {
    settings: { startDay: ledger.startDay || 1, savingsGoal: 0 },
    accounts: ledger.accounts,
    budgets: {},
    rules: [],
    recurring: [],
    chat: [],
  };
  appState.monthly = {};
  for (const record of ledger.records) {
    placeTransaction(appState.monthly, { ...record });
  }
  rebuildIndexes();
}


/* ===========================================================
   1. 日付と期間
   =========================================================== */
function runDatePatternTests() {
  section('全パターン: 日付と期間');
  const saved = saveGlobalsForTest();
  appState.profile = { settings: { startDay: 1 }, accounts: [], budgets: {}, rules: [], recurring: [], chat: [] };
  const allDates = datesBetween('2024-01-01', '2030-12-31'); // うるう年（2024・2028年）もふくむ

  const inPeriod = startRule('期間: どの日も、ちょうど1つの期間に入る（始まりの日1〜28日 × 2024〜2030年の毎日）');
  const tiling = startRule('期間: となりの期間と、すき間も重なりもない（1か月は28〜31日）');
  for (let startDay = 1; startDay <= 28; startDay++) {
    appState.profile.settings.startDay = startDay;
    for (const date of allDates) {
      const range = periodRange(periodOf(date));
      recordRule(inPeriod, range.start <= date && date < range.end && addDays(range.end, -1) === range.last,
        () => '始まり' + startDay + '日 ' + date + ' → ' + range.start + '〜' + range.last);
    }
    let period = { year: 2024, month: 1 };
    for (let count = 0; count < 84; count++) {
      const next = shiftPeriod(period, 1);
      const range = periodRange(period);
      const days = daysBetween(range.start, range.end);
      recordRule(tiling, periodRange(next).start === range.end && days >= 28 && days <= 31 && isSamePeriod(shiftPeriod(next, -1), period),
        () => '始まり' + startDay + '日 ' + period.year + '-' + period.month + ' → ' + range.start + '〜' + range.end);
      period = next;
    }
  }
  finishRule(inPeriod);
  finishRule(tiling);

  const months = startRule('月の計算: 何か月か進めて、同じだけ戻すと元の月（2020〜2035年 × −25〜+25か月）');
  for (let year = 2020; year <= 2035; year++) {
    for (let month = 1; month <= 12; month++) {
      const monthText = makeMonthText(year, month);
      for (let step = -25; step <= 25; step++) {
        const total = year * 12 + (month - 1) + step; // 答え合わせ: 「年×12＋月」で数える
        const expected = makeMonthText(Math.floor(total / 12), (total % 12) + 1);
        recordRule(months, addMonths(monthText, step) === expected && addMonths(expected, -step) === monthText,
          () => monthText + ' + ' + step + ' → ' + addMonths(monthText, step) + '（正しくは ' + expected + '）');
      }
    }
  }
  finishRule(months);

  const days = startRule('月の「○日」: その月にない日（2月30日など）は月末にそろう（2024〜2030年 × 1〜31日）');
  for (let year = 2024; year <= 2030; year++) {
    for (let month = 1; month <= 12; month++) {
      const monthText = makeMonthText(year, month);
      for (let day = 1; day <= 31; day++) {
        const expected = monthText + '-' + pad2(Math.min(day, daysInMonthForTest(year, month)));
        const actual = dayInMonthText(monthText, day);
        recordRule(days, actual === expected && isValidDateText(actual) && daysInMonth(year, month) === daysInMonthForTest(year, month),
          () => monthText + ' の ' + day + '日 → ' + actual + '（正しくは ' + expected + '）');
      }
    }
  }
  finishRule(days);
  restoreGlobalsForTest(saved);
}


/* ===========================================================
   2. カードの請求（すべてのカード会社 × 締め日・支払日 × 支払い方法 × 毎日）
   =========================================================== */
function runCardPatternTests() {
  section('全パターン: カードの請求（すべてのカード会社 × 締め日・支払日 × 支払い方法 × 2026〜2028年の毎日）');
  const random = makeTestRandom(20261028);
  const edgeAmounts = [1, 2, 3, 99, 100, 101, 999, 1000, 1001, 9999, 10000, 10001, 12345, 99999, 100000, 299999, 1000000];
  const purchaseDates = datesBetween('2026-01-01', '2028-12-31'); // うるう日（2028-02-29）もふくむ

  const firstBill = startRule('1回払い: 買った日のあとの、最初の締め日の請求に入る');
  const dates = startRule('支払日は締め日より後で、買った日より後');
  const conserve = startRule('お金が消えない・増えない（どの払い方でも、元金を全部足すと使った金額）');
  const billMath = startRule('請求1回ごとに 合計 = 元金 + 手数料 = 明細の合計（1円未満の端数なし）');
  const shapes = startRule('払い方ごとの回数と月（2回払い・分割・スキップ・リボ・ボーナス・ボーナス2回）');
  const payAll = startRule('全部の引き落としを記録すると、カードの残高（借金）が0円に戻る');

  for (const company of CARD_COMPANIES) {
    for (let cycleIndex = 0; cycleIndex < company.cycles.length; cycleIndex++) {
      for (const autoRevolving of [false, true]) {
        const account = {
          id: 'pattern-card', name: 'パターンカード', kind: 'card', opening: 0, openDate: '2020-01-01',
          card: { company: company.id, cycleIndex: cycleIndex, autoRevolving: autoRevolving, payFrom: 'pattern-bank' },
        };
        const bank = { id: 'pattern-bank', name: 'パターン銀行', kind: 'bank', opening: 0, openDate: '2020-01-01' };
        const settings = cardSettings(account);
        const label = company.name + '（' + describeCycle(settings) + (autoRevolving ? '・登録型リボ' : '') + '）';

        for (let dayIndex = 0; dayIndex < purchaseDates.length; dayIndex++) {
          const date = purchaseDates[dayIndex];
          // 登録型リボは「1回払い」だけ試す（ほかの払い方は、ふつうのときと同じ）
          const methods = autoRevolving ? ['once'] : company.methods;
          for (const method of methods) {
            const amount = dayIndex % 3 === 0 ? edgeAmounts[(dayIndex / 3) % edgeAmounts.length] : random.int(1, 500000);
            const installments = INSTALLMENT_COUNTS[dayIndex % INSTALLMENT_COUNTS.length];
            const skipMonths = (dayIndex % 6) + 1;
            const purchase = {
              id: 'pattern-buy', date: date, type: 'expense', amount: amount, account: 'pattern-card',
              payMethod: method, installments: installments, skipMonths: skipMonths,
              category: 'other', sub: '', description: 'パターン', memo: '', include: true, createdAt: 1,
            };
            const bills = buildCardBills(account, [purchase]);
            const describe = () => label + ' ' + date + ' ' + method + (method === 'installment' ? installments + '回' : '') +
              (method === 'skip' ? skipMonths + 'か月' : '') + ' ' + amount + '円 → ' +
              bills.map((bill) => bill.payDate + ':' + bill.principal + '+' + bill.fee).join(', ');

            // どの払い方でも成り立つ決まり
            let principalSum = 0;
            let mathProblem = '';
            let datesOk = true;
            for (const bill of bills) {
              principalSum = principalSum + bill.principal;
              mathProblem = mathProblem || billMathProblemForTest(bill);
              if (!(bill.payDate > bill.closeDate && bill.payDate > date && bill.closeDate === closingDateOf(bill.month, settings) &&
                bill.payDate === paymentDateOf(bill.month, settings))) {
                datesOk = false;
              }
            }
            recordRule(conserve, principalSum === amount, describe);
            recordRule(billMath, mathProblem === '', () => mathProblem + ' ' + describe());
            recordRule(dates, datesOk, describe);

            // 1回払いの請求の月（答え合わせ: 締め日を1か月ずつ見て、買った日以後の最初の締め日を探す）
            const firstMonth = billingMonthOf(date, settings);
            let expectedFirst = '';
            for (let step = -1; step <= 4 && expectedFirst === ''; step++) {
              const month = addMonths(date.slice(0, 7), step);
              if (closingDateOf(month, settings) >= date && closingDateOf(addMonths(month, -1), settings) < date) {
                expectedFirst = month;
              }
            }
            const actualMethod = effectivePayMethod(purchase, settings);
            if (actualMethod === 'once') {
              recordRule(firstBill, bills.length === 1 && bills[0].month === expectedFirst && firstMonth === expectedFirst,
                () => describe() + '（正しくは ' + expectedFirst + ' の請求）');
            }

            // 払い方ごとの形
            let shapeOk = true;
            const months = bills.map((bill) => bill.month);
            if (actualMethod === 'twice') {
              const half = Math.floor(amount / 2);
              const expected = [{ month: firstMonth, principal: half }, { month: addMonths(firstMonth, 1), principal: amount - half }]
                .filter((item) => item.principal > 0);
              shapeOk = JSON.stringify(bills.map((bill) => ({ month: bill.month, principal: bill.principal }))) === JSON.stringify(expected);
            } else if (actualMethod === 'installment') {
              const lastMonth = addMonths(firstMonth, installments - 1);
              shapeOk = months.every((month) => month >= firstMonth && month <= lastMonth) &&
                (amount < 100 * installments || bills.length === installments);
            } else if (actualMethod === 'skip') {
              const rate = skipRateFor(settings, date);
              shapeOk = bills.length === 1 && bills[0].month === addMonths(firstMonth, skipMonths) && bills[0].fee === skipFee(amount, skipMonths, rate);
            } else if (actualMethod === 'revolving') {
              const monthlyPrincipal = Math.max(1000, settings.revolvingMonthly);
              let expectedMonth = firstMonth;
              for (const bill of bills) {
                if (bill.month !== expectedMonth || bill.principal > monthlyPrincipal) {
                  shapeOk = false;
                }
                expectedMonth = addMonths(expectedMonth, 1);
              }
            } else if (method === 'bonus' || method === 'bonus2') {
              // ボーナス払いの月が使えるなら、ボーナス月の請求。使えない時期は1回払いと同じ
              const bonusMonth = bills.length > 0 ? bills[0].month : '';
              if (bills.length > 0 && bills[0].parts.once === amount) {
                shapeOk = bills.length === 1 && bonusMonth === firstMonth;
              } else if (method === 'bonus') {
                shapeOk = bills.length === 1 && bills[0].parts.bonus === amount && bonusMonth >= firstMonth;
              } else {
                const totalFee = Math.floor(amount * settings.bonus2Fee / 100);
                shapeOk = bills.length >= 1 && bills.length <= 2 && bonusMonth >= firstMonth &&
                  bills.reduce((total, bill) => total + bill.fee, 0) === totalFee &&
                  (bills.length === 1 || (bills[1].month > bills[0].month && addMonths(bills[0].month, 12) >= bills[1].month));
              }
            }
            recordRule(shapes, shapeOk, describe);

            // 全部の引き落としを記録したら、カードの借金は0円に戻る（10日に1回だけ試す）
            if (dayIndex % 10 === 0) {
              const records = [purchase];
              let feeTotal = 0;
              for (const bill of bills) {
                if (bill.principal > 0) {
                  records.push({ id: 'pay-' + bill.month, date: bill.payDate, type: 'transfer', amount: bill.principal, account: 'pattern-bank', toAccount: 'pattern-card', billMonth: bill.month, include: true, createdAt: 2 });
                }
                if (bill.fee > 0) {
                  feeTotal = feeTotal + bill.fee;
                  records.push({ id: 'fee-' + bill.month, date: bill.payDate, type: 'expense', amount: bill.fee, account: 'pattern-bank', category: 'other', sub: 'カード手数料', billMonth: bill.month, paidCard: 'pattern-card', include: true, createdAt: 3 });
                }
              }
              const after = buildCardBills(account, records);
              const cardRecords = records.filter((record) => record.account === 'pattern-card' || record.toAccount === 'pattern-card');
              const bankRecords = records.filter((record) => record.account === 'pattern-bank' || record.toAccount === 'pattern-bank');
              recordRule(payAll, after.every((bill) => bill.paid) && balanceOn(account, '9999-12-31', cardRecords) === 0 &&
                balanceOn(bank, '9999-12-31', bankRecords) === -(amount + feeTotal), describe);
            }
          }
        }
      }
    }
  }
  finishRule(firstBill);
  finishRule(dates);
  finishRule(conserve);
  finishRule(billMath);
  finishRule(shapes);
  finishRule(payAll);

  // リボの返し方がとても少なく（月1,000円）、使った額がとても多いとき
  const longRevolving = startRule('リボ: 返し終わるまで何十年かかっても、元金が消えない（月1,000円 × 最大500万円）');
  for (const company of CARD_COMPANIES.filter((item) => item.methods.includes('revolving'))) {
    const account = { id: 'pattern-card', name: 'パターンカード', kind: 'card', opening: 0, openDate: '2020-01-01', card: { company: company.id, cycleIndex: 0, revolvingMonthly: 1000 } };
    for (const amount of [359000, 360001, 1000000, 5000000]) {
      const purchase = { id: 'big', date: '2026-10-01', type: 'expense', amount: amount, account: 'pattern-card', payMethod: 'revolving', category: 'other', sub: '', description: 'パターン', include: true, createdAt: 1 };
      const bills = buildCardBills(account, [purchase]);
      const principalSum = bills.reduce((total, bill) => total + bill.principal, 0);
      recordRule(longRevolving, principalSum === amount && bills.every((bill) => billMathProblemForTest(bill) === ''),
        () => company.name + ' ' + amount + '円 → 元金の合計 ' + principalSum + '円（' + bills.length + '回）');
    }
  }
  finishRule(longRevolving);
}


/* ===========================================================
   3. 自分で決めた締め日・支払日（締め日1〜31 × 支払日1〜31 × 当月・翌月・翌々月）
   =========================================================== */
function runCustomCyclePatternTests() {
  section('全パターン: 自分で決めた締め日・支払日');
  const accepted = startRule('入力できる組み合わせなら、2024〜2030年のどの月も、支払日は締め日より後');
  const rejected = startRule('支払日が締め日より前・同じ日になる月がある組み合わせは、入力のときに止める');
  const billing = startRule('入力できる組み合わせで、買った日のあとの最初の締め日の請求に入り、買った日より後に払う');
  const random = makeTestRandom(31);
  for (let closingDay = 1; closingDay <= 31; closingDay++) {
    for (let paymentDay = 1; paymentDay <= 31; paymentDay++) {
      for (let monthsLater = 0; monthsLater <= 2; monthsLater++) {
        // 答え合わせ: 2024〜2030年の毎月で、締め日と支払日を別の方法で計算してくらべる
        let alwaysAfter = true;
        for (let year = 2024; year <= 2030; year++) {
          for (let month = 1; month <= 12; month++) {
            const closeTotal = year * 12 + (month - 1) - monthsLater;
            const closeYear = Math.floor(closeTotal / 12);
            const closeMonth = (closeTotal % 12) + 1;
            const closeDate = makeMonthText(closeYear, closeMonth) + '-' + pad2(Math.min(closingDay, daysInMonthForTest(closeYear, closeMonth)));
            const payDate = makeMonthText(year, month) + '-' + pad2(Math.min(paymentDay, daysInMonthForTest(year, month)));
            if (!(payDate > closeDate)) {
              alwaysAfter = false;
            }
          }
        }
        const problem = cycleProblem(closingDay, paymentDay, monthsLater);
        const describe = () => closingDay + '日締め・' + ['当月', '翌月', '翌々月'][monthsLater] + paymentDay + '日払い → ' + (problem || '入力できる');
        if (problem === '') {
          recordRule(accepted, alwaysAfter, describe);
          const account = { id: 'pattern-card', name: 'パターンカード', kind: 'card', opening: 0, openDate: '2020-01-01',
            card: { company: 'custom', cycleIndex: 'custom', closingDay: closingDay, paymentDay: paymentDay, monthsLater: monthsLater } };
          const settings = cardSettings(account);
          for (let count = 0; count < 12; count++) {
            const date = addDays('2026-01-01', random.int(0, 1095));
            const bills = buildCardBills(account, [{ id: 'b', date: date, type: 'expense', amount: 1000, account: 'pattern-card', payMethod: 'once', include: true, createdAt: 1 }]);
            const bill = bills[0];
            recordRule(billing, bills.length === 1 && bill.closeDate >= date && closingDateOf(addMonths(bill.month, -1), settings) < date && bill.payDate > bill.closeDate,
              () => describe() + ' / ' + date + ' に買う → ' + (bill ? bill.closeDate + ' 締め・' + bill.payDate + ' 払い' : '請求なし'));
          }
        } else {
          recordRule(rejected, !alwaysAfter, describe);
        }
      }
    }
  }
  finishRule(accepted);
  finishRule(rejected);
  finishRule(billing);
}


/* ===========================================================
   4. まぜこぜの家計簿（乱数で300通り）
   =========================================================== */

// お店の名前（「カード」「引き落とし」「支払」などの言葉や、カード会社の名前を入れない）
const PATTERN_STORES = ['スーパーまるまる', 'コンビニ', 'ドラッグストア', '書店', '定食屋', '映画館', '電気代', 'ガス代', '水道代', 'ジム',
  '美容院', 'パン屋', '花屋', '家電量販店', '雑貨店', 'ホームセンター', '薬局', 'カフェ', '回転ずし', '八百屋'];
// まぎらわしい文字（カンマ・引用符・改行・絵文字・全角・式に見える文字）
const PATTERN_TRICKY_TEXTS = ['a,b', '"引用"', '改行\nあり', '🐱ねこ', '＝ぜんかく', '=1+1', '+81', '-マイナス', '@あっと', 'タブ\tあり', '\'クォート', '  前後に空白  '];

/** 乱数で家計簿を1つつくる */
function makeRandomLedgerForTest(random, index) {
  const accounts = [
    { id: 'L-bank', name: 'ヒミツ銀行' + index, kind: 'bank', opening: random.int(0, 2000000), openDate: '2026-01-01' },
    { id: 'L-cash', name: 'ヒミツの財布' + index, kind: 'cash', opening: random.int(0, 30000), openDate: '2026-01-01' },
  ];
  const cardCount = random.int(1, 3);
  for (let number = 1; number <= cardCount; number++) {
    const company = random.pick(CARD_COMPANIES);
    accounts.push({
      id: 'L-card' + number, name: 'ヒミツカード' + index + '-' + number, kind: 'card',
      opening: random.chance(0.2) ? -random.int(1, 300000) : 0, openDate: '2026-01-01',
      card: {
        company: company.id, cycleIndex: random.int(0, company.cycles.length - 1), payFrom: 'L-bank',
        autoRevolving: random.chance(0.1), revolvingMonthly: random.pick([1000, 5000, 10000, 30000]),
      },
    });
  }
  const cards = accounts.filter((account) => account.kind === 'card');
  const records = [];
  const usedManualMonths = {};
  const recordCount = random.int(0, 60);
  for (let number = 0; number < recordCount; number++) {
    const id = 'L' + index + '-' + number;
    const date = addDays('2026-01-01', random.int(0, 729));
    const store = random.chance(0.1) ? random.pick(PATTERN_TRICKY_TEXTS) + random.pick(PATTERN_STORES) : random.pick(PATTERN_STORES);
    const memo = random.chance(0.3) ? 'ないしょメモ' + index + '-' + number : '';
    const kind = random.int(1, 100);
    const expenseCategory = random.pick(EXPENSE_CATEGORIES);
    const base = { id: id, date: date, memo: memo, include: random.chance(0.95), createdAt: number };
    if (kind <= 40) {
      const card = random.pick(cards);
      const company = cardSettings(card).company;
      records.push({ ...base, type: 'expense', amount: random.int(1, 300000), account: card.id, category: expenseCategory.id,
        sub: random.pick(expenseCategory.subs), description: store, payMethod: random.pick(company.methods),
        installments: random.pick(INSTALLMENT_COUNTS), skipMonths: random.int(1, 6) });
    } else if (kind <= 45) {
      records.push({ ...base, type: 'income', amount: random.int(1, 30000), account: random.pick(cards).id, category: 'otherIn', sub: '未分類', description: '返品 ' + store });
    } else if (kind <= 65) {
      records.push({ ...base, type: 'expense', amount: random.int(1, 200000), account: random.pick(['L-bank', 'L-cash']), category: expenseCategory.id, sub: random.pick(expenseCategory.subs), description: store });
    } else if (kind <= 77) {
      const incomeCategory = random.pick(INCOME_CATEGORIES);
      records.push({ ...base, type: 'income', amount: random.int(1, 500000), account: 'L-bank', category: incomeCategory.id, sub: random.pick(incomeCategory.subs), description: random.pick(['給与', '配当', 'お祝い', store]) });
    } else if (kind <= 85) {
      records.push({ ...base, type: 'transfer', amount: random.int(1, 50000), account: 'L-bank', toAccount: 'L-cash', description: '財布へ' });
    } else if (kind <= 88) {
      records.push({ ...base, type: 'adjust', amount: random.int(-5000, 5000) || 1, account: random.pick(['L-bank', 'L-cash']), description: '残高修正' });
    } else {
      // 「月の支払い金額だけ」の手入力（同じカード・同じ月には1つだけ）
      const card = random.pick(cards);
      const month = addMonths('2026-02', random.int(0, 23));
      usedManualMonths[card.id] = usedManualMonths[card.id] || {};
      if (!usedManualMonths[card.id][month]) {
        usedManualMonths[card.id][month] = true;
        records.push({ ...manualBillRecord(card, month, random.int(1000, 300000), null), id: id, memo: memo });
      }
    }
  }
  return { accounts: accounts, records: records, startDay: random.int(1, 28) };
}

function runLedgerPatternTests() {
  section('全パターン: まぜこぜの家計簿（乱数で300通り。毎回同じ乱数）');
  const saved = saveGlobalsForTest();
  const random = makeTestRandom(1027);
  const LEDGER_COUNT = 300;

  const billMath = startRule('家計簿: カードの請求1回ごとに 合計 = 元金 + 手数料 = 明細の合計');
  const conserve = startRule('家計簿: カードの請求の元金を全部足すと、カードで使った額 − 返金 + 手入力 + 登録時の借金');
  const partition = startRule('家計簿: カードの請求は「これから」「支払日を過ぎて未記録」「記録済み」「0円以下」にもれなく分かれる');
  const breakdown = startRule('家計簿: 数字の点検の内訳を全部足すと、これから払う金額の合計');
  const aiBills = startRule('家計簿: Claude 用のカードの予定を全部足すと「これから払う合計」');
  const periods = startRule('家計簿: 月ごとの合計を全部足すと、全部の記録の合計（どの月の始まりの日でも）');
  const categories = startRule('家計簿: 月ごとに カテゴリの合計 = 収入 + 支出、中項目の合計 = カテゴリの合計');
  const drill = startRule('家計簿: 中項目を開いたときの明細を足すと、中項目の金額');
  const balances = startRule('家計簿: 残高は、前の日の残高 + その日の入出金（どの口座・どの日でも）');
  const noFalseAlarm = startRule('家計簿: ふつうの記録だけなら、数字の点検はまちがいを知らせない');
  const faults = startRule('家計簿: わざとまちがいを入れると、数字の点検が必ず見つける');
  const summary = startRule('家計簿: Claude 用のまとめに、口座の名前・メモが入らず、カードの合計が合う');
  const backup = startRule('家計簿: バックアップの文字にして戻すと、まったく同じ');
  const csv = startRule('家計簿: CSV に書き出して取り込むと、同じ日付・金額・内容・メモになる');
  const csvTwice = startRule('家計簿: 同じ CSV をもう一度取り込んでも、1件も増えない');

  for (let index = 0; index < LEDGER_COUNT; index++) {
    const ledger = makeRandomLedgerForTest(random, index);
    installLedgerForTest(ledger);
    const today = addDays('2026-01-01', random.int(0, 729));
    const cards = ledger.accounts.filter((account) => account.kind === 'card');
    const label = '家計簿' + index + '（今日=' + today + '）';

    // カードの請求
    for (const card of cards) {
      const settings = cardSettings(card);
      const bills = buildCardBills(card, null, true); // 合計0円の請求（返金で打ち消した月）もふくめる
      let mathProblem = '';
      let principalSum = 0;
      for (const bill of bills) {
        mathProblem = mathProblem || billMathProblemForTest(bill);
        principalSum = principalSum + bill.principal;
      }
      recordRule(billMath, mathProblem === '', () => label + ' ' + card.id + ' ' + mathProblem);

      let expected = Number(card.opening) < 0 ? -Number(card.opening) : 0;
      for (const record of allTransactions) {
        if (record.account !== card.id) {
          continue;
        }
        if (record.manualBill) {
          expected = expected + manualBillAmountOf(record);
        } else if (record.type === 'expense' || record.type === 'transfer') {
          expected = expected + record.amount;
        } else if (record.type === 'income') {
          expected = expected - record.amount;
        }
      }
      recordRule(conserve, principalSum === expected, () => label + ' ' + card.id + '（' + describeCycle(settings) + '）元金の合計 ' + principalSum + ' / 正しくは ' + expected);

      const summaryOfCard = cardSummary(card, today);
      const unpaid = summaryOfCard.bills.filter((bill) => !bill.paid);
      const sumTotal = (list) => list.reduce((total, bill) => total + bill.total, 0);
      const nonPositive = unpaid.filter((bill) => bill.total <= 0);
      recordRule(partition, sumTotal(unpaid) === sumTotal(summaryOfCard.upcomingBills) + sumTotal(summaryOfCard.overdueBills) + sumTotal(nonPositive) &&
        summaryOfCard.upcomingBills.length + summaryOfCard.overdueBills.length + nonPositive.length === unpaid.length &&
        summaryOfCard.remaining.total === unpaid.reduce((total, bill) => total + bill.principal, 0), () => label + ' ' + card.id);
      const cardCheck = cardBreakdown(summaryOfCard);
      recordRule(breakdown, cardCheck.rows.reduce((total, row) => total + row.amount, 0) === cardCheck.total && cardCheck.total === sumTotal(unpaid),
        () => label + ' ' + card.id + ' 内訳 ' + JSON.stringify(cardCheck.rows) + ' / 合計 ' + cardCheck.total);
    }
    for (const item of cardBillsForAi(today)) {
      const listed = item.upcomingBills.reduce((total, bill) => total + bill.total, 0) + (item.moreBills ? item.moreBills.total : 0);
      recordRule(aiBills, listed === item.upcomingTotal && item.upcomingBills.length + (item.moreBills ? item.moreBills.count : 0) === item.upcomingCount,
        () => label + ' ' + item.card + ' 予定の合計 ' + listed + ' / これから払う合計 ' + item.upcomingTotal);
    }

    // 月ごとの合計（この家計簿の「月の始まりの日」で）
    let periodIncome = 0;
    let periodExpense = 0;
    let period = periodOf('2025-12-01');
    const lastPeriod = periodOf('2028-02-28');
    while (period.year * 12 + period.month <= lastPeriod.year * 12 + lastPeriod.month) {
      const result = summarizePeriod(period);
      periodIncome = periodIncome + result.income;
      periodExpense = periodExpense + result.expense;
      let categoryTotal = 0;
      let subsOk = true;
      let drillOk = true;
      const range = periodRange(period);
      for (const categoryId of Object.keys(result.categories)) {
        const bucket = result.categories[categoryId];
        categoryTotal = categoryTotal + bucket.total;
        let subTotal = 0;
        for (const subName of Object.keys(bucket.subs)) {
          subTotal = subTotal + bucket.subs[subName];
          const found = transactionsInSub(range, categoryId, subName);
          if (found.reduce((total, record) => total + record.amount, 0) !== bucket.subs[subName]) {
            drillOk = false;
          }
        }
        if (subTotal !== bucket.total) {
          subsOk = false;
        }
      }
      recordRule(categories, categoryTotal === result.income + result.expense && subsOk, () => label + ' ' + period.year + '-' + period.month);
      recordRule(drill, drillOk, () => label + ' ' + period.year + '-' + period.month);
      period = shiftPeriod(period, 1);
    }
    let countedIncome = 0;
    let countedExpense = 0;
    for (const record of allTransactions) {
      if (isCounted(record)) {
        if (record.type === 'income') {
          countedIncome = countedIncome + record.amount;
        } else {
          countedExpense = countedExpense + record.amount;
        }
      }
    }
    recordRule(periods, periodIncome === countedIncome && periodExpense === countedExpense,
      () => label + '（始まり' + ledger.startDay + '日）月の合計 ' + periodIncome + '/' + periodExpense + ' / 記録の合計 ' + countedIncome + '/' + countedExpense);

    // 残高: 前の日の残高 + その日の入出金
    for (const account of ledger.accounts) {
      const list = transactionsOfAccount(account.id);
      for (let count = 0; count < 8; count++) {
        const date = count === 0 ? account.openDate : count === 1 ? addDays(account.openDate, -1) : addDays('2025-12-01', random.int(0, 820));
        let dayEffect = 0;
        for (const record of list) {
          if (record.date === date) {
            dayEffect = dayEffect + transactionEffect(record, account.id);
          }
        }
        const before = balanceOn(account, addDays(date, -1), list);
        const after = balanceOn(account, date, list);
        let firstDate = account.openDate;
        for (const record of list) {
          if (record.date < firstDate) {
            firstDate = record.date;
          }
        }
        const ok = date <= firstDate ? true : after === before + dayEffect;
        recordRule(balances, ok && Number.isInteger(after), () => label + ' ' + account.id + ' ' + date + ': ' + before + ' + ' + dayEffect + ' ≠ ' + after);
      }
    }

    // 数字の点検: ふつうの記録だけなら、まちがいを知らせない
    const result = findNumberProblems(today);
    const falseAlarms = result.problems.filter((problem) =>
      ['duplicate', 'manual-twice', 'payment-as-bank-expense', 'payment-as-card-expense', 'payment-as-refund', 'minus-amount', 'broken-record', 'calc-mismatch'].includes(problem.kind));
    recordRule(noFalseAlarm, falseAlarms.length === 0, () => label + ' ' + falseAlarms.map((problem) => problem.kind + ':' + problem.lines[0]).join(' / '));

    // Claude 用のまとめ
    const text = claudeSummaryText(periodOf(today), today);
    const leaked = ledger.accounts.filter((account) => text.includes(account.name)).map((account) => account.name)
      .concat(ledger.records.filter((record) => record.memo && text.includes(record.memo)).map((record) => record.memo));
    let cardTotalsOk = true;
    for (const item of cardBillsForAi(today)) {
      if (item.upcomingCount > 0 && !text.includes('（全' + item.upcomingCount + '回）。これから払う合計 ' + formatNumber(item.upcomingTotal) + '円')) {
        cardTotalsOk = false;
      }
    }
    recordRule(summary, leaked.length === 0 && cardTotalsOk && !text.includes('NaN') && !text.includes('undefined'),
      () => label + ' もれた: ' + leaked.join(', ') + ' / カードの合計 ' + (cardTotalsOk ? 'OK' : 'ちがう'));

    // バックアップの行き帰り
    const backupData = { app: 'mamecho', version: 1, exportedAt: '2026-10-28T00:00:00.000Z', profile: appState.profile, monthly: appState.monthly };
    const restored = parseBackupText(backupToText(backupData));
    recordRule(backup, restored !== null && JSON.stringify(restored) === JSON.stringify(backupData), () => label);

    // CSV の書き出し → 取り込み
    const exported = allTransactions.filter((record) => record.type !== 'adjust' && record.type !== 'transfer');
    const rows = parseCsv(transactionsToCsvText(allTransactions));
    const csvSettings = {
      hasHeader: true, amountMode: 'signed', invert: false, accountId: 'L-bank',
      columns: { include: 0, date: 1, description: 2, amount: 3, account: 4, category: 5, sub: 6, memo: 7, transfer: 8, out: -1, in: -1 },
    };
    const imported = convertCsvRows(rows, csvSettings, [], ledger.accounts);
    let csvOk = imported.ready.length === exported.length && imported.skipped.length === 0;
    const remainingToMatch = new Map();
    for (const record of exported) {
      const description = /^[=+\-@\t\r]/.test(record.description || '') ? "'" + record.description : (record.description || '');
      const key = [record.date, record.type, record.amount, record.account, description.trim(), (record.memo || '').trim(), record.include !== false].join('|');
      remainingToMatch.set(key, (remainingToMatch.get(key) || 0) + 1);
    }
    for (const record of imported.ready) {
      const key = [record.date, record.type, record.amount, record.account, record.description, record.memo, record.include].join('|');
      if (!remainingToMatch.get(key)) {
        csvOk = false;
      } else {
        remainingToMatch.set(key, remainingToMatch.get(key) - 1);
      }
    }
    recordRule(csv, csvOk, () => label + ' 書き出し ' + exported.length + '件 / 取り込み ' + imported.ready.length + '件 / 読めない行 ' + imported.skipped.length);
    const importedAgain = convertCsvRows(rows, csvSettings, imported.ready, ledger.accounts);
    recordRule(csvTwice, importedAgain.ready.length === 0 && importedAgain.duplicates === imported.ready.length, () => label + ' 2回目に増えた ' + importedAgain.ready.length + '件');

    // わざとまちがいを入れる（最初の100通りだけ。1つずつ入れて、点検が見つけるか）
    if (index < 100) {
      const card = cards[0];
      const someRecord = ledger.records[0];
      const injections = [
        ['payment-as-bank-expense', { id: 'x1', date: today, type: 'expense', amount: 50000, account: 'L-bank', category: 'other', sub: '未分類', description: 'カード', include: true, createdAt: 9 }],
        ['payment-as-card-expense', { id: 'x2', date: today, type: 'expense', amount: 30000, account: card.id, category: 'other', sub: '', description: '口座振替 引き落とし', include: true, createdAt: 9 }],
        ['payment-as-refund', { id: 'x3', date: today, type: 'income', amount: 30000, account: card.id, category: 'otherIn', sub: '', description: 'お支払い', include: true, createdAt: 9 }],
        ['minus-amount', { id: 'x4', date: today, type: 'expense', amount: -500, account: 'L-bank', category: 'other', sub: '', description: 'マイナス', include: true, createdAt: 9 }],
        ['broken-record', { id: 'x5', date: '2026-02-30', type: 'expense', amount: 500, account: 'L-bank', category: 'other', sub: '', description: 'こわれた日付', include: true, createdAt: 9 }],
        ['broken-record', { id: 'x6', date: today, type: 'expense', amount: 1.5, account: 'L-bank', category: 'other', sub: '', description: '小数', include: true, createdAt: 9 }],
        ['broken-record', { id: 'x7', date: today, type: 'expense', amount: 500, account: 'L-deleted', category: 'other', sub: '', description: '消した口座', include: true, createdAt: 9 }],
      ];
      const manual = ledger.records.find((record) => record.manualBill);
      if (manual) {
        injections.push(['manual-twice', { ...manual, id: 'x8' }]);
      }
      for (const [kind, extra] of injections) {
        installLedgerForTest({ ...ledger, records: ledger.records.concat([extra]) });
        recordRule(faults, findNumberProblems(today).problems.some((problem) => problem.kind === kind), () => label + ' ' + kind + ' を見つけられない');
      }
      if (someRecord) {
        installLedgerForTest(ledger);
        const otherMonth = addMonths(monthOfDate(someRecord.date), 3);
        appState.monthly[otherMonth] = (appState.monthly[otherMonth] || []).concat([{ ...someRecord }]);
        rebuildIndexes();
        const duplicateKinds = findNumberProblems(today).problems.map((problem) => problem.kind);
        recordRule(faults, duplicateKinds.includes('duplicate'), () => label + ' duplicate を見つけられない');
        recordRule(faults, !duplicateKinds.includes('calc-mismatch'), () => label + ' 同じ記録が2つのとき、まちがえて「計算が合わない」と知らせる');
        removeDuplicateCopies(appState.monthly);
        rebuildIndexes();
        recordRule(faults, !findNumberProblems(today).problems.some((problem) => problem.kind === 'duplicate'), () => label + ' 1つにしても duplicate が残る');
      }
    }
  }
  for (const rule of [billMath, conserve, partition, breakdown, aiBills, periods, categories, drill, balances, noFalseAlarm, faults, summary, backup, csv, csvTwice]) {
    finishRule(rule);
  }
  restoreGlobalsForTest(saved);
}


/* ===========================================================
   5. CSV の金額の書き方
   =========================================================== */
function runAmountPatternTests() {
  section('全パターン: CSV の金額の書き方（符号・カンマ・円・全角・小数・空白の組み合わせ）');
  const bases = ['1', '7', '12', '123', '1234', '12345', '123456', '1234567', '12345678', '999999999999999', '1234567890123456'];
  const signs = ['なし', '-', '−', '－', '▲', '△', '(かっこ)', 'うしろに-', '+'];
  const currencies = ['', '¥', '￥', '\\'];
  const suffixes = ['', '円'];
  const decimals = ['', '.00', '.0', '.5', '.05'];
  const spaces = ['なし', '外側', '内側'];
  const fullWidthMap = { 0: '０', 1: '１', 2: '２', 3: '３', 4: '４', 5: '５', 6: '６', 7: '７', 8: '８', 9: '９', ',': '，', '.': '．', '(': '（', ')': '）', '+': '＋' };
  const rule = startRule('金額: 読める書き方は正しい整数に、読めない書き方（小数・16けた以上）は読まない');
  for (const base of bases) {
    for (const useCommas of [false, true]) {
      const digits = useCommas ? base.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : base;
      for (const currency of currencies) {
        for (const suffix of suffixes) {
          for (const sign of signs) {
            for (const decimal of decimals) {
              for (const space of spaces) {
                for (const fullWidth of [false, true]) {
                  let number = currency + (space === '内側' ? ' ' : '') + digits + decimal + suffix;
                  if (sign === '(かっこ)') {
                    number = '(' + number + ')';
                  } else if (sign === 'うしろに-') {
                    number = number + '-';
                  } else if (sign !== 'なし') {
                    number = sign + number;
                  }
                  if (fullWidth) {
                    number = number.split('').map((char) => fullWidthMap[char] || char).join('');
                  }
                  if (space === '外側') {
                    number = '  ' + number + ' ';
                  }
                  const negative = ['-', '−', '－', '▲', '△', '(かっこ)', 'うしろに-'].includes(sign);
                  const readable = (decimal === '' || /^\.0+$/.test(decimal)) && base.length <= 15;
                  const expected = readable ? (negative ? -Number(base) : Number(base)) : null;
                  const actual = parseAmountCell(number);
                  recordRule(rule, actual === expected && (amountCellProblem(number) === '') === readable,
                    () => '「' + number + '」→ ' + actual + '（正しくは ' + expected + '）');
                }
              }
            }
          }
        }
      }
    }
  }
  finishRule(rule);
}


/* ===========================================================
   6. 手取り計算
   =========================================================== */
function runTakeHomePatternTests() {
  section('全パターン: 手取り計算（額面5万〜200万円 × 年齢 × 家族 × ボーナス × 交通費）');
  const sums = startRule('手取り: 手取り = 額面 − 社会保険料 − 税金、社会保険料 = 内訳の合計、1年分 = 毎月 × 12 + ボーナス');
  const signs = startRule('手取り: どの金額も0円以上の整数');
  const ages = startRule('手取り: 介護保険は40〜64歳だけ、厚生年金は70歳からなし');
  const family = startRule('手取り: 養う家族が多いほど、税金は同じか少ない');
  const raise = startRule('手取り: 額面が5万円増えると、手取りも増える');
  const ageGroups = ['under40', 'from40to64', 'from65to69', 'from70'];
  const families = [{ spouse: false, dependents: 0 }, { spouse: true, dependents: 0 }, { spouse: true, dependents: 2 }];
  for (let gross = 50000; gross <= 2000000; gross = gross + 5000) {
    for (const ageGroup of ageGroups) {
      for (const bonusYearly of [0, 600000]) {
        for (const commute of [0, 15000]) {
          const results = families.map((item) => calculateTakeHomePay({ monthlyGross: gross, commute: commute, bonusYearly: bonusYearly, ageGroup: ageGroup, prefecture: '東京都', spouse: item.spouse, dependents: item.dependents }));
          const describe = (result) => () => gross + '円 ' + ageGroup + ' ボーナス' + bonusYearly + ' 交通費' + commute + ' → ' + JSON.stringify(result.monthly);
          for (const result of results) {
            const monthly = result.monthly;
            const yearly = result.yearly;
            const bonusInsurance = result.bonus ? result.bonus.socialInsurance : 0;
            recordRule(sums, monthly.takeHome === monthly.gross - monthly.socialInsurance - monthly.incomeTax - monthly.residentTax &&
              monthly.socialInsurance === monthly.health + monthly.care + monthly.childSupport + monthly.pension + monthly.employment &&
              yearly.socialInsurance === monthly.socialInsurance * 12 + bonusInsurance &&
              yearly.gross === gross * 12 + bonusYearly &&
              yearly.takeHome === yearly.gross - yearly.socialInsurance - yearly.incomeTax - yearly.residentTax, describe(result));
            const values = Object.values(monthly).concat(Object.values(yearly)).concat(result.bonus ? Object.values(result.bonus) : []);
            recordRule(signs, values.every((value) => Number.isInteger(value) && value >= 0), describe(result));
            recordRule(ages, (ageGroup === 'from40to64' ? monthly.care > 0 : monthly.care === 0) && (ageGroup === 'from70' ? monthly.pension === 0 : monthly.pension > 0), describe(result));
          }
          const taxes = results.map((result) => result.yearly.incomeTax + result.yearly.residentTax);
          recordRule(family, taxes[1] <= taxes[0] && taxes[2] <= taxes[1], describe(results[0]));
          if (gross + 50000 <= 2000000) {
            const higher = calculateTakeHomePay({ monthlyGross: gross + 50000, commute: commute, bonusYearly: bonusYearly, ageGroup: ageGroup, prefecture: '東京都', spouse: false, dependents: 0 });
            recordRule(raise, higher.monthly.takeHome > results[0].monthly.takeHome, describe(results[0]));
          }
        }
      }
    }
  }
  for (const rule of [sums, signs, ages, family, raise]) {
    finishRule(rule);
  }
}


/* ===========================================================
   7. 記録の出し入れ（足す・直す・こわれた形をまぜて1万回）
   =========================================================== */
function runRecordPlacementPatternTests() {
  section('全パターン: 記録の出し入れ（二重にならない・なくならない）');
  const random = makeTestRandom(7);
  const monthly = {};
  const knownIds = [];
  const once = startRule('記録を入れたり直したりすると、その記録は必ず1つだけ');
  const tidy = startRule('同じ記録を1つにすると、二重がなくなり、記録はどれも消えない');
  for (let step = 0; step < 10000; step++) {
    const action = random.int(1, 100);
    const date = addDays('2026-01-01', random.int(0, 729));
    if (action <= 40 || knownIds.length === 0) {
      const id = 'r' + step;
      knownIds.push(id);
      placeTransaction(monthly, { id: id, date: date, amount: step });
      recordRule(once, duplicateCountForTest(monthly, id) === 1, () => '足した ' + id);
    } else if (action <= 85) {
      const id = random.pick(knownIds);
      placeTransaction(monthly, { id: id, date: date, amount: step });
      recordRule(once, duplicateCountForTest(monthly, id) === 1, () => '直した ' + id);
    } else if (action <= 97) {
      // 前の版で起きうる、こわれた形（同じ記録の写しが、別の月の箱に入っている）
      const id = random.pick(knownIds);
      const month = monthOfDate(date);
      monthly[month] = (monthly[month] || []).concat([{ id: id, date: addDays(date, -40), amount: -1 }]);
    } else {
      removeDuplicateCopies(monthly);
      const ids = new Set();
      for (const list of Object.values(monthly)) {
        for (const item of list) {
          ids.add(item.id);
        }
      }
      recordRule(tidy, duplicateRecordGroups(monthly).length === 0 && knownIds.every((id) => ids.has(id)), () => '1つにしたあと');
    }
  }
  finishRule(once);
  finishRule(tidy);
}

/** 月の箱ぜんぶで、その id の記録がいくつあるか */
function duplicateCountForTest(monthly, id) {
  let count = 0;
  for (const list of Object.values(monthly)) {
    for (const item of list) {
      if (item.id === id) {
        count = count + 1;
      }
    }
  }
  return count;
}


/* ===========================================================
   暗号化したバックアップの行き帰り（node のときだけ。tests/finish.js から呼ぶ）
   =========================================================== */
async function runEncryptionPatternTests() {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return;
  }
  section('全パターン: 暗号化したバックアップの行き帰り（乱数の家計簿20通り）');
  const saved = saveGlobalsForTest();
  const savedLock = { enabled: lockState.enabled, key: lockState.key, salt: lockState.salt, iter: lockState.iter };
  lockState.salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
  lockState.iter = 100000;
  lockState.key = await deriveKey('パターンのパスフレーズ', lockState.salt, lockState.iter);
  lockState.enabled = true;
  const random = makeTestRandom(99);
  const rule = startRule('暗号化して戻すと、まったく同じ家計簿になり、暗号文に名前・メモ・お店が入らない');
  for (let index = 0; index < 20; index++) {
    const ledger = makeRandomLedgerForTest(random, index);
    installLedgerForTest(ledger);
    const backupData = { app: 'mamecho', version: 1, exportedAt: '2026-10-28T00:00:00.000Z', profile: appState.profile, monthly: appState.monthly };
    const envelope = await encryptBackupForExport(backupData);
    const envelopeText = backupToText(envelope);
    const opened = await decryptBackup(parseEncryptedBackupText(envelopeText), null);
    const secrets = ledger.accounts.map((account) => account.name).concat(ledger.records.map((record) => record.memo).filter(Boolean)).concat(PATTERN_STORES);
    recordRule(rule, opened !== null && JSON.stringify(opened.profile) === JSON.stringify(backupData.profile) &&
      JSON.stringify(opened.monthly) === JSON.stringify(backupData.monthly) && !secrets.some((secret) => envelopeText.includes(secret)), () => '家計簿' + index);
  }
  finishRule(rule);
  lockState.enabled = savedLock.enabled;
  lockState.key = savedLock.key;
  lockState.salt = savedLock.salt;
  lockState.iter = savedLock.iter;
  restoreGlobalsForTest(saved);
}


/* ---------- 実行 ---------- */
runDatePatternTests();
runCardPatternTests();
runCustomCyclePatternTests();
runLedgerPatternTests();
runAmountPatternTests();
runTakeHomePatternTests();
runRecordPlacementPatternTests();
