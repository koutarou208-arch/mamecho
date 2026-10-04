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

section('バックアップを文字で受けわたす');
const sampleBackup = { app: 'mamecho', version: 1, profile: { accounts: [{ id: 'a' }] }, monthly: { '2026-10': [{ id: 't' }] } };
const backupText = backupToText(sampleBackup);
check('バックアップの文字: 1行にまとまる（貼り付けやすい）', backupText.indexOf('\n') === -1);
same('バックアップの文字: 読み戻すと口座の数が同じ', parseBackupText(backupText).profile.accounts.length, 1);
same('バックアップの文字: 前後の空白・改行があっても読める', parseBackupText('  \n' + backupText + '\n ').monthly['2026-10'].length, 1);
same('バックアップの文字: 先頭の目に見えない印（BOM）があっても読める', parseBackupText('\uFEFF' + backupText).app, 'mamecho');
same('バックアップの文字: JSONでなければ null', parseBackupText('こんにちは'), null);
same('バックアップの文字: 空なら null', parseBackupText(''), null);
same('バックアップの文字: 口座がない形は null', parseBackupText('{"profile":{},"monthly":{}}'), null);
same('バックアップの文字: 入出金の入れ物がない形は null', parseBackupText('{"profile":{"accounts":[]}}'), null);

section('固定費（毎月自動で記録）');
const rentRule = { id: 'r1', description: '家賃', amount: 80000, category: 'housing', sub: '家賃・地代', account: 'bank1', day: 27, startMonth: '2026-08', generatedUntil: '' };
const dueA = recurringDueList(rentRule, '2026-10-03');
same('固定費: まだ来ていない今月分は作らない（件数）', dueA.length, 2);
same('固定費: 開始月から作る', dueA[0].month, '2026-08');
same('固定費: 日付は毎月の指定日', dueA[1].date, '2026-09-27');
same('固定費: 指定日が来たらその月も作る', recurringDueList(rentRule, '2026-10-27').length, 3);
same('固定費: 作った月の次から作る', recurringDueList({ ...rentRule, generatedUntil: '2026-09' }, '2026-10-27')[0].month, '2026-10');
same('固定費: すべて作った後は何も作らない', recurringDueList({ ...rentRule, generatedUntil: '2026-10' }, '2026-10-27').length, 0);
same('固定費: 開始月が先なら何も作らない', recurringDueList({ ...rentRule, startMonth: '2026-12' }, '2026-10-27').length, 0);
const endRule = { ...rentRule, day: 31, startMonth: '2027-02' };
same('固定費: 31日は月末（2月は28日）', recurringDueList(endRule, '2027-02-28')[0].date, '2027-02-28');
same('固定費: 月末はまだ来ていなければ作らない', recurringDueList(endRule, '2027-02-27').length, 0);
const recTx = makeRecurringTransaction(rentRule, '2026-09', '2026-09-27');
same('固定費: 記録のID（別の端末で作っても重ならない）', recTx.id, 'rec-r1-2026-09');
same('固定費: 支出として記録する', recTx.type, 'expense');
same('固定費: 金額', recTx.amount, 80000);
same('固定費: 日付', recTx.date, '2026-09-27');
same('固定費: カテゴリ', recTx.category, 'housing');
same('固定費: 口座', recTx.account, 'bank1');
same('固定費: 名前を内容にする', recTx.description, '家賃');
check('固定費: 元の固定費の印がつく', recTx.recurringId === 'r1');
const monthItems = [{ type: 'expense', date: '2026-09-25', description: '家賃', amount: 80000, account: 'bank1' }];
check('固定費: 同じ月に同じ内容・金額の記録があれば二重にしない', hasSimilarTransaction(monthItems, rentRule, '2026-09'));
check('固定費: 金額がちがえば別の記録', !hasSimilarTransaction([{ ...monthItems[0], amount: 5000 }], rentRule, '2026-09'));
check('固定費: ちがう月なら別の記録', !hasSimilarTransaction(monthItems, rentRule, '2026-10'));
same('固定費: 保存データに固定費の一覧がなくても空で始まる', normalizeProfile({ accounts: [] }).recurring.length, 0);
same('固定費: 保存データの固定費はそのまま残る', normalizeProfile({ accounts: [], recurring: [rentRule] }).recurring[0].amount, 80000);

section('支出が給与でまかなえなければアウト');
const ruleOk = judgeSalaryRule(300000, 0, 250000);
same('給与ルール: 給与が支出以上ならアウトではない', ruleOk.out, false);
same('給与ルール: 差額（支出−給与）', ruleOk.gap, -50000);
same('給与ルール: 今月の給与で見る', ruleOk.basis, 'now');
const ruleOut = judgeSalaryRule(200000, 0, 250000);
same('給与ルール: 支出が給与をこえたらアウト', ruleOut.out, true);
same('給与ルール: 足りない額', ruleOut.gap, 50000);
const ruleEdge = judgeSalaryRule(250000, 0, 250000);
same('給与ルール: ちょうど同じならアウトではない', ruleEdge.out, false);
const ruleAvg = judgeSalaryRule(0, 300000, 100000);
same('給与ルール: 今月まだ給与がなければ直近の平均で見る', ruleAvg.basis, 'average');
same('給与ルール: 平均の給与を使う', ruleAvg.salary, 300000);
same('給与ルール: 平均で足りていればアウトではない', ruleAvg.out, false);
const ruleAvgOut = judgeSalaryRule(0, 200000, 250000);
same('給与ルール: 平均でも足りなければアウト', ruleAvgOut.out, true);
const ruleUnknown = judgeSalaryRule(0, 0, 50000);
same('給与ルール: 給与の記録が全くなければ判定しない（アウトにしない）', ruleUnknown.out, false);
same('給与ルール: 判定できない印', ruleUnknown.basis, 'none');
same('給与ルール: 支出もなければアウトではない', judgeSalaryRule(0, 0, 0).out, false);

allTransactions = [
  { id: 's1', type: 'income', date: '2026-07-25', amount: 300000, category: 'salary' },
  { id: 's2', type: 'income', date: '2026-08-25', amount: 320000, category: 'salary' },
  { id: 's3', type: 'income', date: '2026-08-26', amount: 50000, category: 'business' },
  { id: 's4', type: 'income', date: '2026-09-25', amount: 0, category: 'salary' },
];
same('給与の平均: 給与があった月だけで平均する', averageSalaryOf([
  summarizeRange({ start: '2026-07-01', end: '2026-08-01' }),
  summarizeRange({ start: '2026-08-01', end: '2026-09-01' }),
  summarizeRange({ start: '2026-09-01', end: '2026-10-01' }),
]), 310000);
same('給与の平均: 給与の記録がなければ0', averageSalaryOf([summarizeRange({ start: '2025-01-01', end: '2025-02-01' })]), 0);
allTransactions = [];

section('カード利用通知メールの読み取り');
const noticeMail = [
  'いつも【ＯＳ】ＪＣＢカードＷ　ｐｌｕｓ　Ｌをご利用いただきありがとうございます。',
  'JCBカードのご利用がありましたのでご連絡します。',
  '',
  'カード名称　：　【ＯＳ】ＪＣＢカードＷ　ｐｌｕｓ　Ｌ',
  '【ご利用日時(日本時間)】　2026/10/04 20:18',
  '【ご利用金額】　1,000円',
  '【ご利用先】　テストショウテン',
  '',
  '▼ご留意点',
].join('\n');
const noticeA = parseCardNoticeEmail(noticeMail, '2026-10-05');
check('メール: 読み取れる', noticeA !== null);
same('メール: 日付', noticeA.date, '2026-10-04');
same('メール: 金額（カンマと「円」を取る）', noticeA.amount, 1000);
same('メール: ご利用先', noticeA.merchant, 'テストショウテン');
check('メール: カード名にJCBがふくまれる', noticeA.cardName.indexOf('JCB') !== -1);
const noticeB = parseCardNoticeEmail('利用日：2026年9月3日\n利用金額：¥12,345\n利用先：サンプル書店', '2026-10-05');
same('メール: 別の書き方の日付（年月日）', noticeB.date, '2026-09-03');
same('メール: 別の書き方の金額（円マーク）', noticeB.amount, 12345);
same('メール: 別の書き方のご利用先', noticeB.merchant, 'サンプル書店');
const noticeC = parseCardNoticeEmail('ご利用日時：10/04 20:18\nご利用金額：500円\nご利用先：テスト', '2026-10-05');
same('メール: 年がなければ今年', noticeC.date, '2026-10-04');
check('メール: 金額がなければ読めない', parseCardNoticeEmail('ご利用日時：2026/10/04\nご利用先：テスト', '2026-10-05') === null);
check('メール: 関係ない文章は読めない', parseCardNoticeEmail('こんにちは。今日はいい天気ですね。', '2026-10-05') === null);
check('メール: 空は読めない', parseCardNoticeEmail('', '2026-10-05') === null);
const noticeD = parseCardNoticeEmail('ご利用金額：800円\nご利用先：テスト', '2026-10-05');
same('メール: 日付がなければ今日', noticeD.date, '2026-10-05');
const noticeAccounts = [
  { id: 'bank1', kind: 'bank', name: '銀行' },
  { id: 'card1', kind: 'card', name: 'メインカード', card: { company: 'jcb' } },
  { id: 'card2', kind: 'card', name: 'サブ', card: { company: 'smbc' } },
];
same('メール: カード名から口座を選ぶ（JCB）', findCardAccountForNotice('【OS】JCBカードW plus L', noticeAccounts).id, 'card1');
check('メール: 合うカードがなければ null', findCardAccountForNotice('どこかのカード', noticeAccounts) === null);

section('安全のための確認');
const secretProfile = { accounts: [], settings: { startDay: 25, mailImport: { url: 'https://script.google.com/macros/s/X/exec', key: 'SECRETKEYSECRETKEY12', lastReceivedAt: 5 } } };
const exported = profileForExport(secretProfile);
check('書き出し: バックアップに合言葉を入れない', JSON.stringify(exported).indexOf('SECRETKEYSECRETKEY12') === -1);
check('書き出し: バックアップに取り込み係のURLを入れない', JSON.stringify(exported).indexOf('script.google.com') === -1);
same('書き出し: ほかの設定はそのまま', exported.settings.startDay, 25);
same('書き出し: 元のデータは変えない', secretProfile.settings.mailImport.key, 'SECRETKEYSECRETKEY12');
same('読み込み: 古い版で保存されたメール取り込みの鍵は捨てる', normalizeProfile({ accounts: [], settings: { startDay: 25, mailImport: { key: 'OLDSECRETOLDSECRET', url: 'https://script.google.com/macros/s/X/exec' } } }).settings.mailImport, undefined);
same('読み込み: ほかの設定は残る', normalizeProfile({ accounts: [], settings: { startDay: 25, mailImport: { key: 'x' } } }).settings.startDay, 25);
same('CSV: = で始まる文字は式にならないようにする', csvTextCell('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"');
same('CSV: + で始まる文字も同じ', csvTextCell('+81'), "'+81");
same('CSV: @ で始まる文字も同じ', csvTextCell('@SUM(1)'), "'@SUM(1)");
same('CSV: ふつうの文字はそのまま', csvTextCell('スーパー'), 'スーパー');
same('CSV: 金額（数字）はそのまま', csvCell(-1200), '-1200');

section('サンプルのデータ');
const sampleForTest = createSampleData();
check('サンプル: 固定費の一覧（空）がある（家計簿・設定の画面が落ちないように）', Array.isArray(sampleForTest.profile.recurring));
check('サンプル: 読み込みの補いを通しても同じ形', Array.isArray(normalizeProfile(sampleForTest.profile).recurring));

section('暗号化ロックのパスフレーズ');
same('パスフレーズ: 12文字以上が必要', MIN_PASSPHRASE_LENGTH, 12);
check('パスフレーズ: 短いものは断る', passphraseProblem('neko2026') !== '');
check('パスフレーズ: 11文字も断る', passphraseProblem('abcdefghijk') !== '');
check('パスフレーズ: 同じ文字のくり返しは断る', passphraseProblem('aaaaaaaaaaaaaaaa') !== '');
check('パスフレーズ: 数字が並んでいるだけのものは断る', passphraseProblem('123456789012') !== '');
same('パスフレーズ: 単語をつなげた長いものはOK', passphraseProblem('neko-sakura-umi-hoshi'), '');
same('パスフレーズ: 日本語の文もOK', passphraseProblem('きょうはねこがよくねむる日'), '');

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
