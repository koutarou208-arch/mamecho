/* ===========================================================
   tests/tests.js  ―  自動テスト
   -----------------------------------------------------------
   「計算やデータがまちがっていないか」を自動で確かめます。
   実行のしかたは tests/run.sh を見てください（ターミナルで sh tests/run.sh）。
   すべて「OK」と出れば合格、「NG」が1つでもあれば不合格です。

   カードのデータ（js/02-card-companies.js）を毎月書きかえたあとと、
   計算のプログラムを直したあとは、必ずこのテストを通してから公開します。

   【書き方】
     check('テストの名前', 結果)  … 結果が true なら OK
     same('テストの名前', 実際の値, 期待する値)  … 2つが同じなら OK
   =========================================================== */

let failures = 0;
let passes = 0;

function check(name, condition) {
  if (condition) {
    passes = passes + 1;
    print('  OK  ' + name);
  } else {
    failures = failures + 1;
    print('  NG  ' + name);
  }
}

function same(name, actual, expected) {
  if (actual === expected) {
    passes = passes + 1;
    print('  OK  ' + name);
  } else {
    failures = failures + 1;
    print('  NG  ' + name + '   実際: ' + JSON.stringify(actual) + ' / 期待: ' + JSON.stringify(expected));
  }
}

function section(title) {
  print('\n■ ' + title);
}

/** 検証用のカード口座を作る */
function makeCard(companyId, extra) {
  return { id: 'test-card', name: 'テストカード', kind: 'card', opening: 0, openDate: '2026-01-01', card: { company: companyId, cycleIndex: 0, ...(extra || {}) } };
}
function buy(date, amount, extra) {
  return { id: 'b' + date + amount, date: date, type: 'expense', amount: amount, account: 'test-card', category: 'other', sub: '', description: 'テスト', memo: '', include: true, createdAt: 1, ...(extra || {}) };
}


/* ===========================================================
   1. カード会社データの形
   =========================================================== */
section('カード会社データの形');

const knownMethods = Object.keys(PAYMENT_METHODS);
const confidenceKinds = Object.keys(CONFIDENCE_LABELS);
const ids = new Set();
for (const company of CARD_COMPANIES) {
  const name = company.name;
  check(name + ': id が重ならない', !ids.has(company.id));
  ids.add(company.id);

  check(name + ': 締め日・支払日が1〜31', company.cycles.length > 0 && company.cycles.every((c) =>
    c.closingDay >= 1 && c.closingDay <= 31 && c.paymentDay >= 1 && c.paymentDay <= 31 && [0, 1, 2].includes(c.monthsLater)));
  check(name + ': 支払い方法が辞書にある', company.methods.length > 0 && company.methods.every((m) => knownMethods.includes(m)));
  check(name + ': 1回払いが使える', company.methods.includes('once'));
  check(name + ': confidence が正しい', confidenceKinds.includes(company.confidence));
  check(name + ': checkedAt が日付', isValidDateText(company.checkedAt));
  check(name + ': 出典（sources）がある（その他を除く）', company.id === 'custom' || company.sources.length > 0);

  // 手数料率の表
  let ratesOk = true;
  for (const kind of ['installment', 'revolving', 'skip']) {
    const list = company.rates[kind];
    if (!Array.isArray(list)) {
      ratesOk = false;
      continue;
    }
    for (let index = 0; index < list.length; index++) {
      const entry = list[index];
      if (index > 0 && entry.from <= list[index - 1].from) {
        ratesOk = false; // from は古い順
      }
      const values = typeof entry.rate === 'number' ? [entry.rate] : Object.values(entry.rate);
      if (values.length === 0 || values.some((v) => typeof v !== 'number' || v < 0 || v > 25)) {
        ratesOk = false; // 手数料率は0〜25%の数字
      }
    }
  }
  check(name + ': 手数料率の表が正しい', ratesOk);
  check(name + ': 分割・リボが使えるなら率がある',
    (!company.methods.includes('installment') || company.rates.installment.length > 0) &&
    (!company.methods.includes('revolving') || company.rates.revolving.length > 0) &&
    (!company.methods.includes('skip') || company.rates.skip.length > 0));

  if (company.bonus) {
    const monthDayOk = (text) => /^\d{2}-\d{2}$/.test(text);
    check(name + ': ボーナス期間の書き方', monthDayOk(company.bonus.summer.from) && monthDayOk(company.bonus.summer.to) &&
      monthDayOk(company.bonus.winter.from) && monthDayOk(company.bonus.winter.to));
  } else {
    check(name + ': ボーナスなしなら bonus 払いを選べない', !company.methods.includes('bonus') && !company.methods.includes('bonus2'));
  }
}

section('制度変更の履歴');
const changeIds = new Set();
for (const change of RULES_CHANGELOG) {
  check(change.id + ': id が重ならない', !changeIds.has(change.id));
  changeIds.add(change.id);
  check(change.id + ': 日付と出典がある', isValidDateText(change.date) && isValidDateText(change.effective) && /^https?:\/\//.test(change.source));
  check(change.id + ': 対象の会社が存在する', change.company === 'all' || CARD_COMPANIES.some((c) => c.id === change.company));
}
check('データのバージョンと確認日がある', /^\d{4}\.\d{1,2}\.\d+$/.test(RULES_META.dataVersion) && isValidDateText(RULES_META.checkedAt));


/* ===========================================================
   2. 手数料率を日付で引く
   =========================================================== */
section('手数料率を日付で引く');

const jcb = cardSettings(makeCard('jcb'));
same('JCB 分割: 2026-09-30 の買い物は15%', installmentRateFor(jcb, 12, '2026-09-30'), 15.0);
same('JCB 分割: 2026-10-01 の買い物は18%', installmentRateFor(jcb, 12, '2026-10-01'), 18.0);
same('JCB スキップ: 2026-10-01以降は18%', skipRateFor(jcb, '2026-10-05'), 18.0);
const mufg = cardSettings(makeCard('mufg'));
same('三菱UFJ リボ: 10/29 は18%', revolvingRateFor(mufg, '2026-10-29'), 18.0);
same('三菱UFJ リボ: 10/30 は19.8%', revolvingRateFor(mufg, '2026-10-30'), 19.8);
same('三菱UFJ 分割12回: 改定後は19.5%', installmentRateFor(mufg, 12, '2026-11-01'), 19.5);
same('回数の間は高いほうの率（4回→5回の率）', installmentRateFor(mufg, 4, '2026-11-01'), 18.0);
same('回数が表より多いときは最後の率', installmentRateFor(mufg, 36, '2026-11-01'), 19.75);
const view = cardSettings(makeCard('view'));
same('ビュー 分割10回は12%', installmentRateFor(view, 10, '2026-10-03'), 12.0);
same('ビュー 分割12回は15%', installmentRateFor(view, 12, '2026-10-03'), 15.0);
const overridden = cardSettings(makeCard('jcb', { installmentRate: 9.9 }));
same('自分で上書きした率が優先される', installmentRateFor(overridden, 12, '2026-10-03'), 9.9);


/* ===========================================================
   3. 日付の計算（締め日・支払日・ボーナス）
   =========================================================== */
section('日付の計算');

same('JCB 9/15 の買い物は10月分', billingMonthOf('2026-09-15', jcb), '2026-10');
same('JCB 9/16 の買い物は11月分', billingMonthOf('2026-09-16', jcb), '2026-11');
same('JCB 11月の請求の支払日は11/10', paymentDateOf('2026-11', jcb), '2026-11-10');
const rakuten = cardSettings(makeCard('rakuten'));
same('楽天 9/30（月末）の買い物は10月分', billingMonthOf('2026-09-30', rakuten), '2026-10');
same('楽天 10/1 の買い物は11月分', billingMonthOf('2026-10-01', rakuten), '2026-11');
same('2月は月末が28日', paymentDateOf('2027-02', cardSettings(makeCard('rakuten', { paymentDay: 31, cycleIndex: 'custom', closingDay: 31, monthsLater: 1 }))), '2027-02-28');
const viewCard = cardSettings(makeCard('view'));
same('ビュー 9月の買い物は11月払い（翌々月）', billingMonthOf('2026-09-20', viewCard), '2026-11');
same('ビュー 支払日は4日', paymentDateOf('2026-11', viewCard), '2026-11-04');
same('JCB ボーナス: 2026-03-01 は8月払い', bonusMonthOf('2026-03-01', jcb.bonus), '2026-08');
same('JCB ボーナス: 2026-09-01 は翌年1月払い', bonusMonthOf('2026-09-01', jcb.bonus), '2027-01');
same('JCB ボーナス: 2026-12-20 は翌年8月払い', bonusMonthOf('2026-12-20', jcb.bonus), '2027-08');
same('JCB ボーナス: 2026-07-01 は期間外', bonusMonthOf('2026-07-01', jcb.bonus), null);
same('ボーナス2回目は反対のボーナス月', secondBonusMonth('2026-08', jcb.bonus), '2027-01');


/* ===========================================================
   4. 手数料の計算
   =========================================================== */
section('手数料の計算');

same('JCB公式の例: 1万円・3か月・年18% = 450円', skipFee(10000, 3, 18), 450);
same('3万円・1か月・年15% = 375円', skipFee(30000, 1, 15), 375);
for (const count of [3, 6, 10, 12, 24, 36]) {
  const plan = installmentPlan(100000, count, 17.64);
  let principal = 0;
  let fee = 0;
  for (const part of plan) {
    principal = principal + part.principal;
    fee = fee + part.fee;
  }
  same('分割' + count + '回: 元金の合計が元の金額', principal, 100000);
  check('分割' + count + '回: 回数どおり・手数料はプラス', plan.length === count && fee > 0);
}
const noFee = installmentPlan(30000, 3, 0);
same('手数料0%の分割は3等分', noFee.map((part) => part.principal + part.fee).join(','), '10000,10000,10000');


/* ===========================================================
   5. カードの請求（買い物 → 何月にいくら）
   =========================================================== */
section('カードの請求');

function billOf(account, records, month) {
  return buildCardBills(account, records).find((bill) => bill.month === month);
}

// 1回払い
let account = makeCard('jcb');
let bill = billOf(account, [buy('2026-09-10', 5000), buy('2026-09-14', 3000)], '2026-10');
same('1回払い: 同じ締め期間の買い物が合算される', bill && bill.total, 8000);
same('1回払い: 支払日', bill && bill.payDate, '2026-10-10');

// 2回払い
bill = billOf(account, [buy('2026-09-10', 10001, { payMethod: 'twice' })], '2026-10');
same('2回払い: 1回目は半分（端数は2回目）', bill && bill.total, 5000);
same('2回払い: 2回目', billOf(account, [buy('2026-09-10', 10001, { payMethod: 'twice' })], '2026-11').total, 5001);

// スキップ払い（JCB）
const skipped = [buy('2026-10-06', 42000, { payMethod: 'skip', skipMonths: 2 })];
bill = billOf(account, skipped, '2027-01');
same('スキップ払い: 2か月先の月に請求される', bill && bill.principal, 42000);
same('スキップ払い: 手数料（年18%・2か月）', bill && bill.fee, 1260);
check('スキップ払い: 元の月（11月）には請求されない', !billOf(account, skipped, '2026-11'));
const oldSkip = [buy('2026-09-06', 42000, { payMethod: 'skip', skipMonths: 2 })];
same('スキップ払い: 9月の買い物は旧率（年15%）', billOf(account, oldSkip, '2026-12').fee, 1050);

// ボーナス払い
bill = billOf(account, [buy('2026-03-01', 38600, { payMethod: 'bonus' })], '2026-08');
same('ボーナス一括: 8月にまとめて', bill && bill.total, 38600);
bill = billOf(account, [buy('2026-07-01', 38600, { payMethod: 'bonus' })], '2026-08');
check('ボーナス一括: 期間外は1回払い扱いになる', bill && bill.parts.bonus === 0 && bill.parts.once === 38600);

// 分割払い
const split = [buy('2026-10-12', 89800, { payMethod: 'installment', installments: 12 })];
const splitBills = buildCardBills(account, split);
let splitPrincipal = 0;
for (const item of splitBills) {
  splitPrincipal = splitPrincipal + item.principal;
}
same('分割12回: 12か月分の請求になる', splitBills.length, 12);
same('分割12回: 元金の合計', splitPrincipal, 89800);
same('分割12回: 1回目は11月', splitBills[0].month, '2026-11');

// リボ払い
account = makeCard('jcb', { revolvingMonthly: 10000 });
const revolving = buildCardBills(account, [buy('2026-10-03', 148000, { payMethod: 'revolving' })]);
let revolvingPrincipal = 0;
for (const item of revolving) {
  revolvingPrincipal = revolvingPrincipal + item.principal;
}
same('リボ: 元金の合計', revolvingPrincipal, 148000);
same('リボ: 1回目は毎月1万円', revolving[0].principal, 10000);
same('リボ: 1回目は手数料なし（残高がまだ無いため）', revolving[0].fee, 0);
check('リボ: 2回目から手数料がつく', revolving[1].fee > 0);

// 登録型リボ
account = makeCard('jcb', { autoRevolving: true, revolvingMonthly: 20000 });
bill = buildCardBills(account, [buy('2026-10-03', 50000)])[0];
same('登録型リボ: 1回払いでもリボ扱い（1回目は2万円）', bill.principal, 20000);

// 月ごとの手入力
account = makeCard('jcb');
bill = billOf(account, [{ id: 'm1', date: '2026-10-03', type: 'adjust', amount: -150000, account: 'test-card', description: '支払い予定', memo: '', include: true, createdAt: 1, manualBill: true, billMonth: '2027-01' }], '2027-01');
same('手入力: 指定した月に金額が出る', bill && bill.principal, 150000);
same('手入力: 内訳の種類は manual', bill && bill.parts.manual, 150000);

// 引き落としの記録で消し込まれる
const paid = buildCardBills(account, [
  buy('2026-09-10', 5000),
  { id: 'p1', date: '2026-10-10', type: 'transfer', amount: 5000, account: 'bank', toAccount: 'test-card', description: '引き落とし', memo: '', include: true, createdAt: 2, billMonth: '2026-10' },
]).find((item) => item.month === '2026-10');
check('引き落としを記録すると「記録済み」になる', paid && paid.paid === true);


/* ===========================================================
   6. 金額・日付・CSVの読み取り
   =========================================================== */
section('金額・日付・CSV');

same('金額: 1200+380', calculateAmount('1200+380'), 1580);
same('金額: カンマと円記号', calculateAmount('¥1,234'), 1234);
same('金額: カッコと掛け算', calculateAmount('(1+2)*3'), 9);
same('金額: 全角', calculateAmount('１２００＋３８０'), 1580);
check('金額: 読めない文字は NaN', Number.isNaN(calculateAmount('abc')));
same('金額: 空欄は null', calculateAmount(''), null);
check('金額: 危険な文字（関数など）は NaN', Number.isNaN(calculateAmount('alert(1)')));

same('CSV日付: 2026/9/14', parseDateCell('2026/9/14'), '2026-09-14');
same('CSV日付: 2026年9月14日', parseDateCell('2026年9月14日'), '2026-09-14');
same('CSV日付: 20260914', parseDateCell('20260914'), '2026-09-14');
same('CSV日付: R8.9.14', parseDateCell('R8.9.14'), '2026-09-14');
same('CSV日付: 存在しない日付は null', parseDateCell('2026/2/30'), null);
same('CSV金額: △1,200 はマイナス', parseAmountCell('△1,200'), -1200);
same('CSV金額: (1,200) はマイナス', parseAmountCell('(1,200)'), -1200);
same('CSV金額: 1,200円', parseAmountCell('1,200円'), 1200);
const csv = parseCsv('日付,内容,金額\n2026/9/1,"店,名",-100\n2026/9/2,"A""B",200\n');
same('CSV: 行の数', csv.length, 3);
same('CSV: カンマをふくむ文字', csv[1][1], '店,名');
same('CSV: " のエスケープ', csv[2][1], 'A"B');

same('日付: 月の足し算（年またぎ）', addMonths('2026-11', 3), '2027-02');
same('日付: 月末の補正', dayInMonthText('2027-02', 31), '2027-02-28');
same('日付: 和暦', toWarekiText('2026-09-14'), 'R8.09.14');
same('金額の表示', formatYen(-1234567), '−¥1,234,567');
same('HTMLの記号を無害にする', escapeHtml('<b>"&'), '&lt;b&gt;&quot;&amp;');

// スマホの横スワイプ（右へ=前の月 / 左へ=次の月 / 縦に動いたら何もしない）
same('スワイプ: 右へ大きく → 前へ(-1)', swipeStepOf(90, 10), -1);
same('スワイプ: 左へ大きく → 次へ(+1)', swipeStepOf(-90, -5), 1);
same('スワイプ: 短い動きは無視', swipeStepOf(30, 0), 0);
same('スワイプ: 縦のほうが大きければ無視', swipeStepOf(80, 90), 0);


section('株式投資の損益（収支に含める）');
allTransactions = [
  { id: 'a', type: 'income', date: '2026-10-05', amount: 300000, category: 'salary' },
  { id: 'b', type: 'expense', date: '2026-10-06', amount: 100000, category: 'food' },
  { id: 'c', type: 'income', date: '2026-10-10', amount: 50000, category: 'trade' },
  { id: 'd', type: 'expense', date: '2026-10-12', amount: 20000, category: 'tradeLoss' },
];
const tradeSummary = summarizeRange({ start: '2026-10-01', end: '2026-11-01' });
same('投資: 収支は利益・損失をふくむ（収入）', tradeSummary.income, 350000);
same('投資: 収支は利益・損失をふくむ（支出）', tradeSummary.expense, 120000);
same('投資: 利益', tradeSummary.tradeGain, 50000);
same('投資: 損失', tradeSummary.tradeLoss, 20000);
same('投資: 損益の合計', tradeSummary.tradeNet, 30000);
same('投資: 生活費の支出（予算の対象）は損失をのぞく', tradeSummary.spending, 100000);
check('投資: 損失カテゴリは予算の対象外', !LIVING_EXPENSE_CATEGORIES.some((item) => item.id === 'tradeLoss'));
check('投資: 損失カテゴリは支出の選択肢にある', EXPENSE_CATEGORIES.some((item) => item.id === 'tradeLoss'));
check('投資: 利益カテゴリは収入の選択肢にある', INCOME_CATEGORIES.some((item) => item.id === 'trade'));
allTransactions = [];

section('自動分類ルールの修正');
const baseRules = [
  { keyword: 'AAA', type: 'expense', category: 'food', sub: '外食' },
  { keyword: 'BBB', type: 'expense', category: 'daily', sub: '日用品' },
  { keyword: 'CCC', type: 'income', category: 'salary', sub: '給与' },
];
const editedRules = replaceRuleAt(baseRules, 1, { keyword: 'bbb2', type: 'expense', category: 'hobby', sub: 'サブスク' });
same('ルール修正: 件数は変わらない', editedRules.length, 3);
same('ルール修正: 同じ位置が書きかわる', editedRules[1].category, 'hobby');
same('ルール修正: キーワードは正規化される', editedRules[1].keyword, 'BBB2');
same('ルール修正: 元の配列は変えない', baseRules[1].category, 'daily');
const mergedRules = replaceRuleAt(baseRules, 1, { keyword: 'AAA', type: 'expense', category: 'hobby', sub: 'サブスク' });
same('ルール修正: 同じキーワードの別ルールとは1つにまとまる', mergedRules.length, 2);
same('ルール修正: まとまったルールは新しい内容', mergedRules.filter((rule) => rule.keyword === 'AAA')[0].category, 'hobby');

section('株の利益の安心ライン');
// 投資をのぞく収支 = 収入 − 投資の利益 − 生活費の支出
const safeA = judgeTradeSafety({ income: 350000, tradeGain: 50000, tradeNet: 30000, spending: 100000 }, 0);
same('安心ライン: 投資をのぞく収支', safeA.base, 200000);
same('安心ライン: 黒字なら必要な利益は0', safeA.needed, 0);
same('安心ライン: 黒字なら「投資なしで安心」', safeA.status, 'safe');
const safeB = judgeTradeSafety({ income: 250000, tradeGain: 0, tradeNet: 0, spending: 280000 }, 0);
same('安心ライン: 赤字ならその分が必要な利益', safeB.needed, 30000);
same('安心ライン: 利益がまだなければ「不足」', safeB.status, 'short');
same('安心ライン: あと', safeB.remaining, 30000);
const safeC = judgeTradeSafety({ income: 280000, tradeGain: 40000, tradeNet: 40000, spending: 280000 }, 0);
same('安心ライン: 投資をのぞくと赤字（-40000）', safeC.base, -40000);
same('安心ライン: 利益で埋まれば「達成」', safeC.status, 'covered');
same('安心ライン: 達成ならあとは0', safeC.remaining, 0);
const safeD = judgeTradeSafety({ income: 300000, tradeGain: 0, tradeNet: 0, spending: 250000 }, 80000);
same('安心ライン: 貯金目標があれば目標までが必要な利益', safeD.needed, 30000);
const safeE = judgeTradeSafety({ income: 300000, tradeGain: 10000, tradeNet: -5000, spending: 250000 }, 0);
same('安心ライン: 投資で損でも本業が黒字なら安心', safeE.status, 'safe');

section('安心ラインを日ごとに追う');
allTransactions = [
  { id: 'd1', type: 'income', date: '2026-10-01', amount: 200000, category: 'salary' },
  { id: 'd2', type: 'expense', date: '2026-10-02', amount: 230000, category: 'housing' },
  { id: 'd3', type: 'income', date: '2026-10-03', amount: 40000, category: 'trade' },
  { id: 'd4', type: 'expense', date: '2026-10-04', amount: 10000, category: 'tradeLoss' },
];
const dayRows = dailySafetyRows({ start: '2026-10-01', end: '2026-11-01' }, '2026-10-04', 0);
same('日ごと: 今日までの日数ぶんの行', dayRows.length, 4);
same('日ごと: 1日目は黒字なので必要な利益0', dayRows[0].needed, 0);
same('日ごと: 2日目は赤字（-30000）', dayRows[1].base, -30000);
same('日ごと: 2日目に必要な利益', dayRows[1].needed, 30000);
same('日ごと: 3日目の株の損益', dayRows[2].tradeNet, 40000);
same('日ごと: 3日目は株の利益でカバー', dayRows[2].remaining, 0);
same('日ごと: 4日目の株の損益（損失をひく）', dayRows[3].tradeNet, 30000);
same('日ごと: 日付が入る', dayRows[3].date, '2026-10-04');
const dayRowsEarly = dailySafetyRows({ start: '2026-10-01', end: '2026-10-03' }, '2026-12-31', 0);
same('日ごと: 期間の最後の日までで止まる', dayRowsEarly.length, 2);
allTransactions = [];

/* ===========================================================
   結果
   =========================================================== */
print('\n==========================================');
print('合格 ' + passes + ' 件 / 不合格 ' + failures + ' 件');
if (failures > 0) {
  print('→ 不合格があります。公開しないでください。');
  if (typeof quit === 'function') {
    quit(1);
  } else if (typeof process !== 'undefined') {
    process.exit(1);
  }
} else {
  print('→ すべて合格です。');
}
