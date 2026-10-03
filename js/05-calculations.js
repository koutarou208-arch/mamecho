/* ===========================================================
   05-calculations.js  ―  計算（残高・収支・期間・自動分類）
   -----------------------------------------------------------
   画面には何も出さず、「数字を計算して返す」だけの関数を集めています。
   画面のファイル（08〜13）は、ここの関数を呼んで数字をもらいます。

   用語:
     入出金（transaction）… 1回のお金の出入り。形は下のとおり
       {
         id:          "xxxx",         だれとも重ならない番号
         date:        "2026-09-14",   日付
         type:        "expense",      種類 expense=支出 / income=収入 / transfer=振替 / adjust=残高修正
         amount:      1200,           金額（残高修正だけはマイナスもある）
         account:     "口座のid",      お金が出た（入った）口座
         toAccount:   "口座のid",      振替のときの行き先
         category:    "food",         大項目のid
         sub:         "外食",          中項目
         description: "定食 さくら",   内容（お店の名前など）
         memo:        "",             メモ
         include:     true,           収支の計算に含めるか
         createdAt:   1727900000000,  記録した時刻（並べる順番に使う）
         payMethod:   "once",         カードの支払い方法（カードのときだけ）
         installments: 12,            分割の回数（分割のときだけ）
         skipMonths:  2,              スキップする月数（スキップ払いのときだけ）
         billMonth:   "2026-10",      カードの引き落とし記録のとき、どの月の請求分か
       }
     期間（period）… { year: 2026, month: 10 } のような「何月分」
   =========================================================== */


/* ===========================================================
   1. すぐ探せるように並べなおした一覧
   データが変わるたびに rebuildIndexes() で作り直します。
   =========================================================== */

let allTransactions = []; // すべての入出金（新しい順）
let accountById = {};     // 口座のidから口座を探す早見表

function rebuildIndexes() {
  allTransactions = [];
  for (const month of Object.keys(appState.monthly)) {
    for (const transaction of appState.monthly[month]) {
      if (transaction && transaction.date) {
        allTransactions.push(transaction);
      }
    }
  }
  allTransactions.sort(compareNewestFirst);

  accountById = {};
  if (appState.profile) {
    for (const account of appState.profile.accounts) {
      accountById[account.id] = account;
    }
  }
}

/** 並べかえのルール: 日付が新しい順、同じ日なら記録が新しい順 */
function compareNewestFirst(a, b) {
  if (a.date !== b.date) {
    return a.date < b.date ? 1 : -1;
  }
  return (b.createdAt || 0) - (a.createdAt || 0);
}

/** idから入出金を探す */
function findTransaction(id) {
  for (const transaction of allTransactions) {
    if (transaction.id === id) {
      return transaction;
    }
  }
  return null;
}

/** 口座の名前（消された口座なら「削除された口座」） */
function accountName(accountId) {
  const account = accountById[accountId];
  return account ? account.name : '削除された口座';
}


/* ===========================================================
   2. 期間（「10月分」など）
   1か月の始まりの日（startDay）は設定で変えられます。
   例: startDay = 25 なら「10月度」は 10/25〜11/24
   =========================================================== */

function getStartDay() {
  if (appState.profile && appState.profile.settings.startDay) {
    return appState.profile.settings.startDay;
  }
  return 1;
}

/** ある日付がどの期間に入るか */
function periodOf(dateText) {
  const parts = dateText.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (day >= getStartDay()) {
    return { year: year, month: month };
  }
  // 始まりの日より前なら、前の月の期間に入る
  if (month === 1) {
    return { year: year - 1, month: 12 };
  }
  return { year: year, month: month - 1 };
}

/**
 * 期間の最初の日と最後の日。
 *   start … 最初の日
 *   end   … 次の期間の最初の日（この日は含まない）
 *   last  … 最後の日
 */
function periodRange(period) {
  const startDay = getStartDay();
  const startDate = new Date(period.year, period.month - 1, startDay);
  const endDate = new Date(period.year, period.month, startDay);
  const lastDate = new Date(period.year, period.month, startDay - 1);
  return {
    start: dateToText(startDate),
    end: dateToText(endDate),
    last: dateToText(lastDate),
  };
}

/** 期間を前後に動かす。shiftPeriod({2026,10}, -1) → {2026, 9} */
function shiftPeriod(period, count) {
  const total = period.year * 12 + (period.month - 1) + count;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function isSamePeriod(a, b) {
  return a.year === b.year && a.month === b.month;
}

/** 今日が入っている期間なら true */
function isCurrentPeriod(period) {
  return isSamePeriod(period, periodOf(todayText()));
}

/** "2026年10月"（始まりの日が1日以外なら "2026年10月度"） */
function periodTitle(period) {
  if (getStartDay() === 1) {
    return period.year + '年' + period.month + '月';
  }
  return period.year + '年' + period.month + '月度';
}

/** "10月" */
function periodShortTitle(period) {
  return period.month + '月';
}

/** "9/25〜10/24" */
function periodRangeText(period) {
  const range = periodRange(period);
  return formatShortDate(range.start) + '〜' + formatShortDate(range.last);
}

/** 期間のうち何割が過ぎたか（0〜1）。過去の期間は1、未来は0 */
function elapsedRatio(period) {
  const range = periodRange(period);
  const today = todayText();
  if (today < range.start) {
    return 0;
  }
  if (today > range.last) {
    return 1;
  }
  const totalDays = daysBetween(range.start, range.end);
  const passedDays = daysBetween(range.start, today) + 1;
  return passedDays / totalDays;
}

/** 期間の「時点」の日付（今の期間なら今日、過去なら最後の日） */
function pointInTimeOf(period) {
  const range = periodRange(period);
  const today = todayText();
  if (today >= range.start && today <= range.last) {
    return today;
  }
  return range.last;
}


/* ===========================================================
   3. 口座の残高
   残高の考え方:
     口座を登録したときの「基準日の朝の残高（opening）」に、
     基準日以降の入出金を足し引きして求めます。
     基準日より前の入出金（あとからCSVで取り込んだ過去の記録など）は
     「すでに opening に含まれている」とみなし、さかのぼって計算します。
   =========================================================== */

/** 1件の入出金が、ある口座の残高をいくら増やす（減らす）か */
function transactionEffect(transaction, accountId) {
  let effect = 0;
  if (transaction.type === 'expense' && transaction.account === accountId) {
    effect = effect - transaction.amount;
  }
  if (transaction.type === 'income' && transaction.account === accountId) {
    effect = effect + transaction.amount;
  }
  if (transaction.type === 'transfer') {
    if (transaction.account === accountId) {
      effect = effect - transaction.amount; // 振替元から出ていく
    }
    if (transaction.toAccount === accountId) {
      effect = effect + transaction.amount; // 振替先に入ってくる
    }
  }
  if (transaction.type === 'adjust' && transaction.account === accountId) {
    effect = effect + transaction.amount; // 残高修正（プラスもマイナスもある）
  }
  return effect;
}

/** ある口座に関係する入出金（古い順） */
function transactionsOfAccount(accountId) {
  const list = allTransactions.filter((item) => item.account === accountId || item.toAccount === accountId);
  list.reverse(); // allTransactions は新しい順なので、反対にして古い順にする
  return list;
}

/**
 * ある日の「終わり」時点の残高。
 * list を渡すと計算が速くなる（transactionsOfAccount の結果）。
 */
function balanceOn(account, dateText, list) {
  const records = list || transactionsOfAccount(account.id);

  // 口座の記録が始まる前の日なら 0 とする
  let firstDate = account.openDate;
  for (const record of records) {
    if (record.date < firstDate) {
      firstDate = record.date;
    }
  }
  if (dateText < firstDate) {
    return 0;
  }

  let balance = Number(account.opening) || 0;
  if (dateText >= account.openDate) {
    // 基準日から dateText までの入出金を足す
    for (const record of records) {
      if (record.date >= account.openDate && record.date <= dateText) {
        balance = balance + transactionEffect(record, account.id);
      }
    }
  } else {
    // 基準日より前の日 → 間の入出金を引いてさかのぼる
    for (const record of records) {
      if (record.date > dateText && record.date < account.openDate) {
        balance = balance - transactionEffect(record, account.id);
      }
    }
  }
  return balance;
}

/** 今の残高（未来の日付で入れた予定もふくむ） */
function currentBalance(account) {
  return balanceOn(account, '9999-12-31');
}

/**
 * ある日の資産の内訳。
 * 返す形: { groups: [{id, name, color, amount}], assets, debts, net }
 *   assets … 資産の合計 / debts … 負債の合計（マイナス）/ net … 純資産
 */
function assetBreakdownOn(dateText) {
  const amountByGroup = {};
  let debts = 0;
  for (const account of appState.profile.accounts) {
    const kind = ACCOUNT_KINDS[account.kind] || ACCOUNT_KINDS.cash;
    const balance = balanceOn(account, dateText);
    if (kind.isDebt) {
      debts = debts + balance;
    } else {
      amountByGroup[kind.group] = (amountByGroup[kind.group] || 0) + balance;
    }
  }

  const groups = [];
  let assets = 0;
  for (const group of ASSET_GROUPS) {
    const amount = amountByGroup[group.id] || 0;
    groups.push({ ...group, amount: amount });
    assets = assets + amount;
  }
  return { groups: groups, assets: assets, debts: debts, net: assets + debts };
}

/**
 * 純資産の移り変わり（グラフ用）。endPeriod から count か月さかのぼる。
 * 返す形: [{ period, dateText, amount }, ...]（古い順）
 */
function assetHistory(endPeriod, count) {
  const accounts = appState.profile.accounts;
  const recordsByAccount = {};
  for (const account of accounts) {
    recordsByAccount[account.id] = transactionsOfAccount(account.id);
  }

  const points = [];
  const today = todayText();
  for (let back = count - 1; back >= 0; back--) {
    const period = shiftPeriod(endPeriod, -back);
    const range = periodRange(period);
    if (range.start > today) {
      continue; // 未来の期間は描かない
    }
    const dateText = pointInTimeOf(period);

    let total = 0;
    let anyAccountExists = false;
    for (const account of accounts) {
      const records = recordsByAccount[account.id];
      let firstDate = account.openDate;
      for (const record of records) {
        if (record.date < firstDate) {
          firstDate = record.date;
        }
      }
      if (dateText >= firstDate) {
        anyAccountExists = true;
      }
      total = total + balanceOn(account, dateText, records);
    }
    if (anyAccountExists) {
      points.push({ period: period, dateText: dateText, amount: total });
    }
  }
  return points;
}


/* ===========================================================
   4. 収入と支出の集計
   =========================================================== */

/** 収支の計算に含める入出金なら true（振替や残高修正は含めない） */
function isCounted(transaction) {
  if (transaction.include === false) {
    return false;
  }
  return transaction.type === 'income' || transaction.type === 'expense';
}

/**
 * ある期間の収入・支出の合計と、カテゴリ別の内訳。
 * 返す形:
 *   {
 *     income: 300000, expense: 180000,
 *     tradeGain: 50000, tradeLoss: 20000, tradeNet: 30000,  … 株式投資の利益・損失・損益（収支にはふくまれる）
 *     spending: 160000,  … 支出から投資の損失をのぞいた「生活費」（予算と比べるのはこちら）
 *     categories: { food: { total: 42000, count: 31, subs: { '外食': 12000, ... } }, ... }
 *   }
 */
function summarizeRange(range) {
  const summary = { income: 0, expense: 0, tradeGain: 0, tradeLoss: 0, tradeNet: 0, spending: 0, categories: {} };
  for (const transaction of allTransactions) {
    if (transaction.date < range.start || transaction.date >= range.end) {
      continue;
    }
    if (!isCounted(transaction)) {
      continue;
    }
    const categoryId = transaction.category || 'other';
    const isInvestment = categoryId === 'trade' || categoryId === 'tradeLoss';
    if (transaction.type === 'income') {
      summary.income = summary.income + transaction.amount;
      if (categoryId === 'trade') {
        summary.tradeGain = summary.tradeGain + transaction.amount;
      }
    } else {
      summary.expense = summary.expense + transaction.amount;
      if (categoryId === 'tradeLoss') {
        summary.tradeLoss = summary.tradeLoss + transaction.amount;
      }
      if (!isInvestment) {
        summary.spending = summary.spending + transaction.amount;
      }
    }

    if (!summary.categories[categoryId]) {
      summary.categories[categoryId] = { total: 0, count: 0, subs: {} };
    }
    const bucket = summary.categories[categoryId];
    bucket.total = bucket.total + transaction.amount;
    bucket.count = bucket.count + 1;
    const subName = transaction.sub || '未分類';
    bucket.subs[subName] = (bucket.subs[subName] || 0) + transaction.amount;
  }
  summary.tradeNet = summary.tradeGain - summary.tradeLoss;
  return summary;
}

/** 期間の収支をまとめて計算（よく使うので近道を用意） */
function summarizePeriod(period) {
  return summarizeRange(periodRange(period));
}


/* ===========================================================
   5. 予算
   =========================================================== */

/** 予算の合計 */
function totalBudget() {
  let total = 0;
  const budgets = appState.profile.budgets;
  for (const categoryId of Object.keys(budgets)) {
    total = total + (Number(budgets[categoryId]) || 0);
  }
  return total;
}

/**
 * 予算の使い具合を3段階で判定する。
 *   'good' … 順調
 *   'warn' … 注意（8割をこえた、または日数のペースより使いすぎ）
 *   'over' … 超過
 *   'none' … 予算なし
 */
function budgetStatus(spent, budget, elapsed) {
  if (!budget || budget <= 0) {
    return 'none';
  }
  const usedRatio = spent / budget;
  if (usedRatio > 1) {
    return 'over';
  }
  if (usedRatio >= 0.8 || usedRatio > elapsed + 0.1) {
    return 'warn';
  }
  return 'good';
}

const STATUS_LABELS = {
  good: { text: '順調', icon: 'check' },
  warn: { text: '注意', icon: 'warn' },
  over: { text: '超過', icon: 'over' },
};

/**
 * 状態を「アイコン＋文字」の小さな札にする（色だけで伝えないため）。
 * text を渡すと、「順調」などの代わりにその文字を出す。
 */
function statusChipHtml(status, text) {
  const label = STATUS_LABELS[status];
  if (!label) {
    return '';
  }
  const shownText = text || label.text;
  return '<span class="status-chip ' + status + '">' + iconSvg(label.icon) + escapeHtml(shownText) + '</span>';
}


/* ===========================================================
   6. 自動分類（お店の名前からカテゴリを当てる）
   =========================================================== */

/**
 * 内容（description）からカテゴリを探す。見つからなければ null。
 * 返す形: { category: 'food', sub: '外食' }
 */
function findAutoCategory(description, type) {
  const text = normalizeText(description);
  if (text === '') {
    return null;
  }

  // 1. 自分で覚えさせたルールを先に見る
  for (const rule of appState.profile.rules) {
    if (rule.type === type && text.includes(rule.keyword)) {
      return { category: rule.category, sub: rule.sub };
    }
  }

  // 2. はじめから入っているルール（01-categories.js）
  for (const rule of BUILT_IN_RULES) {
    if (rule.type !== type) {
      continue;
    }
    for (const word of rule.words) {
      if (text.includes(normalizeText(word))) {
        return { category: rule.category, sub: rule.sub };
      }
    }
  }
  return null;
}

/**
 * 「このお店はこのカテゴリ」というルールを覚える。
 * すでに同じお店のルールがあれば上書きする。300件をこえたら古いものから消す。
 */
function rememberCategoryRule(description, type, category, sub) {
  const keyword = normalizeText(description);
  if (keyword === '') {
    return;
  }
  const rules = appState.profile.rules.filter((rule) => !(rule.keyword === keyword && rule.type === type));
  rules.unshift({ keyword: keyword, type: type, category: category, sub: sub });
  appState.profile.rules = rules.slice(0, 300);
}


/**
 * ルールの一覧のうち、index 番目を新しい内容に書きかえた「新しい一覧」を返す（元の一覧は変えない）。
 * 同じキーワード・同じ種類の別のルールがあれば、1つにまとめる。
 */
function replaceRuleAt(rules, index, newRule) {
  const replaced = { keyword: normalizeText(newRule.keyword), type: newRule.type, category: newRule.category, sub: newRule.sub };
  const result = [];
  for (let position = 0; position < rules.length; position++) {
    if (position === index) {
      result.push(replaced);
    } else if (!(rules[position].keyword === replaced.keyword && rules[position].type === replaced.type)) {
      result.push(rules[position]);
    }
  }
  return result;
}


/* ===========================================================
   7. 毎月の固定費・サブスクを見つける
   直近4か月のうち3か月以上、同じ内容・ほぼ同じ金額で出ている支出を探す。
   =========================================================== */

function findRecurringPayments(endPeriod) {
  const ranges = [];
  for (let back = 0; back < 4; back++) {
    ranges.push(periodRange(shiftPeriod(endPeriod, -back)));
  }

  // 内容ごとに、どの月に・いくら出ているかを集める
  const groups = new Map();
  for (const transaction of allTransactions) {
    if (transaction.type !== 'expense') {
      continue;
    }
    let rangeIndex = -1;
    for (let index = 0; index < ranges.length; index++) {
      if (transaction.date >= ranges[index].start && transaction.date < ranges[index].end) {
        rangeIndex = index;
      }
    }
    if (rangeIndex === -1) {
      continue;
    }
    const key = normalizeText(transaction.description);
    if (key === '') {
      continue;
    }
    if (!groups.has(key)) {
      groups.set(key, {
        description: transaction.description,
        category: transaction.category,
        sub: transaction.sub,
        months: new Set(),
        amounts: [],
        days: [],
        lastDate: transaction.date,
      });
    }
    const group = groups.get(key);
    group.months.add(rangeIndex);
    group.amounts.push(transaction.amount);
    group.days.push(Number(transaction.date.slice(8, 10)));
    if (transaction.date > group.lastDate) {
      group.lastDate = transaction.date;
    }
  }

  const results = [];
  for (const group of groups.values()) {
    if (group.months.size < 3) {
      continue; // 3か月未満しか出ていない
    }
    if (group.amounts.length > group.months.size * 1.5) {
      continue; // 月に何回も出ている（スーパーなど）は固定費ではない
    }
    const typicalAmount = median(group.amounts);
    let isStable = true;
    for (const amount of group.amounts) {
      if (Math.abs(amount - typicalAmount) > typicalAmount * 0.15) {
        isStable = false;
      }
    }
    const category = CATEGORY_BY_ID[group.category];
    const isFixedCategory = category && category.fixed;
    if (!isStable && !isFixedCategory) {
      continue; // 金額がばらばらなものは除く（光熱費などの固定費カテゴリは残す）
    }
    results.push({
      description: group.description,
      category: group.category,
      sub: group.sub,
      amount: typicalAmount,
      day: Math.round(median(group.days)),
      lastDate: group.lastDate,
    });
  }
  results.sort((a, b) => b.amount - a.amount);
  return results;
}


/* ===========================================================
   8. 入出金の絞り込み（入出金画面で使う）
   =========================================================== */

/**
 * 条件に合う入出金を返す（新しい順）。
 *   filters.account  … 口座のid（空ならすべて）
 *   filters.category … 大項目のid
 *   filters.type     … 'expense' / 'income' / 'transfer'（振替と残高修正）
 *   filters.search   … 内容・メモにふくまれる言葉
 *   filters.date     … 特定の日だけ（"2026-09-14"）。空なら range の期間
 */
function filterTransactions(filters, range) {
  const searchWord = normalizeText(filters.search);
  const results = [];
  for (const transaction of allTransactions) {
    if (filters.date) {
      if (transaction.date !== filters.date) {
        continue;
      }
    } else if (transaction.date < range.start || transaction.date >= range.end) {
      continue;
    }
    if (filters.account && transaction.account !== filters.account && transaction.toAccount !== filters.account) {
      continue;
    }
    if (filters.category && transaction.category !== filters.category) {
      continue;
    }
    if (filters.type === 'transfer') {
      if (transaction.type !== 'transfer' && transaction.type !== 'adjust') {
        continue;
      }
    } else if (filters.type && transaction.type !== filters.type) {
      continue;
    }
    if (searchWord) {
      const target = normalizeText((transaction.description || '') + ' ' + (transaction.memo || ''));
      if (!target.includes(searchWord)) {
        continue;
      }
    }
    results.push(transaction);
  }
  return results;
}

/** 入力の候補に出す「よく使う内容」（新しいものから重複なしで） */
function recentDescriptions(limit) {
  const seen = new Set();
  const results = [];
  for (const transaction of allTransactions) {
    const description = (transaction.description || '').trim();
    if (description && !seen.has(description)) {
      seen.add(description);
      results.push(description);
      if (results.length >= limit) {
        break;
      }
    }
  }
  return results;
}
