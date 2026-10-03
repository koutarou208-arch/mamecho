/* ===========================================================
   19-sample-data.js  ―  お試し用のサンプルデータ
   -----------------------------------------------------------
   はじめて開いたとき（まだ何も保存されていないとき）に表示する、
   架空の1人暮らしの会社員の1年分の家計です。
   画面上部の「自分の家計簿をはじめる」を押すと消えます。
   サンプルは保存されません。

   毎回同じ内容になるように、決まった「種（seed）」から
   でたらめな数を作っています（makeRandom）。
   =========================================================== */

/**
 * 決まった種から、毎回同じ順番の「でたらめな数（0〜1）」を作る道具。
 * （mulberry32 という有名な作り方。中身は理解しなくて大丈夫です）
 */
function makeRandom(seed) {
  let state = seed;
  return function () {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createSampleData() {
  const random = makeRandom(20261003);
  function between(min, max) {
    return Math.round(min + random() * (max - min));
  }
  function pick(list) {
    return list[Math.floor(random() * list.length)];
  }

  const today = new Date();
  const todayString = dateToText(today);
  const start = new Date(today.getFullYear(), today.getMonth() - 12, 1);
  const startText = dateToText(start);

  // --- 口座 ---
  const accounts = {
    wallet: { id: 'sample-wallet', name: '財布', kind: 'cash', opening: 18000, openDate: startText },
    bank: { id: 'sample-bank', name: 'メインバンク 普通預金', kind: 'bank', opening: 842000, openDate: startText },
    savings: { id: 'sample-savings', name: '貯蓄用 定期預金', kind: 'bank', opening: 1500000, openDate: startText },
    card: {
      id: 'sample-card', name: 'メインカード（JCB）', kind: 'card', opening: 0, openDate: startText,
      card: { company: 'jcb', cycleIndex: 0, payFrom: 'sample-bank', limit: 800000, pointRate: 0.5 },
    },
    ic: { id: 'sample-ic', name: '交通系IC', kind: 'emoney', opening: 3200, openDate: startText },
    qr: { id: 'sample-qr', name: 'QRコード決済', kind: 'emoney', opening: 6400, openDate: startText },
    nisa: { id: 'sample-nisa', name: 'つみたてNISA', kind: 'securities', opening: 1180000, openDate: startText },
    points: { id: 'sample-points', name: '共通ポイント', kind: 'points', opening: 4120, openDate: startText },
  };

  // --- 入出金を作る道具 ---
  const records = [];
  const balance = {}; // チャージが必要かを判断するための、口座ごとの残高
  for (const key of Object.keys(accounts)) {
    balance[accounts[key].id] = accounts[key].opening;
  }
  let counter = 0;

  function add(date, type, amount, account, extra) {
    counter = counter + 1;
    const record = {
      id: 'sample-' + counter.toString(36),
      date: date,
      type: type,
      amount: amount,
      account: account.id,
      description: '',
      memo: '',
      include: true,
      createdAt: counter,
      ...extra,
    };
    records.push(record);
    for (const id of Object.keys(balance)) {
      balance[id] = balance[id] + transactionEffect(record, id);
    }
    return record;
  }
  function spend(date, account, amount, description, category, sub, extra) {
    add(date, 'expense', amount, account, { description: description, category: category, sub: sub, ...(extra || {}) });
  }
  function move(date, from, to, amount, description) {
    add(date, 'transfer', amount, from, { toAccount: to.id, description: description });
  }

  // --- 1日ずつ進めながら、ありそうな入出金を作る ---
  const day = new Date(start);
  while (dateToText(day) <= todayString) {
    const date = dateToText(day);
    const dayOfMonth = day.getDate();
    const weekday = day.getDay(); // 0=日曜 … 6=土曜
    const month = day.getMonth() + 1;
    const monthIndex = (day.getFullYear() - start.getFullYear()) * 12 + (day.getMonth() - start.getMonth());
    const isWeekday = weekday >= 1 && weekday <= 5;
    const isWinter = month === 12 || month === 1 || month === 2;
    const isSummer = month === 7 || month === 8;

    // 収入
    if (dayOfMonth === 25) {
      add(date, 'income', 286400, accounts.bank, { description: 'ミナト商事 給与', category: 'salary', sub: '給与' });
    }
    if (dayOfMonth === 10 && (month === 6 || month === 12)) {
      add(date, 'income', month === 12 ? 452000 : 418000, accounts.bank, { description: 'ミナト商事 賞与', category: 'salary', sub: '賞与' });
    }
    if (dayOfMonth === 15 && random() < 0.4) {
      add(date, 'income', between(20, 60) * 1000, accounts.bank, { description: 'デザイン案件 報酬', category: 'business', sub: '副業' });
    }
    if (dayOfMonth === 20 && month % 3 === 0) {
      add(date, 'income', 2400, accounts.bank, { description: 'ETF 分配金', category: 'dividend', sub: '分配金' });
    }

    // 毎月の固定費
    if (dayOfMonth === 27) {
      spend(date, accounts.bank, 84000, '家賃', 'housing', '家賃・地代');
      spend(date, accounts.bank, 6800, '生命保険料', 'insurance', '生命保険');
    }
    if (dayOfMonth === 15) {
      spend(date, accounts.card, isWinter || isSummer ? between(9000, 12500) : between(5500, 7500), '東京電力 電気料金', 'utility', '電気代');
    }
    if (dayOfMonth === 18) {
      spend(date, accounts.card, isWinter ? between(5200, 6800) : between(3200, 4200), '東京ガス ガス料金', 'utility', 'ガス・灯油代');
    }
    if (dayOfMonth === 20 && month % 2 === 0) {
      spend(date, accounts.bank, between(4800, 5600), '水道局 水道料金', 'utility', '水道代');
    }
    if (dayOfMonth === 20) {
      spend(date, accounts.card, 4980, 'ドコモ 携帯料金', 'phone', '携帯電話');
    }
    if (dayOfMonth === 22) {
      spend(date, accounts.card, 5280, '光回線 月額料金', 'phone', 'インターネット');
    }
    if (dayOfMonth === 5) {
      spend(date, accounts.card, 1590, 'Netflix', 'hobby', 'サブスク');
    }
    if (dayOfMonth === 12) {
      spend(date, accounts.card, 980, 'Spotify', 'hobby', 'サブスク');
    }
    if (dayOfMonth === 14) {
      spend(date, accounts.card, 600, 'Amazonプライム', 'hobby', 'サブスク');
    }
    if (dayOfMonth === 3) {
      spend(date, accounts.card, 7700, 'エニタイムフィットネス', 'health', 'フィットネス');
    }
    if (dayOfMonth === 8 && month % 2 === 0) {
      spend(date, accounts.card, 5500, '美容室 ルーチェ', 'clothes', '美容院・理髪');
    }

    // 貯金と投資
    if (dayOfMonth === 1) {
      move(date, accounts.bank, accounts.nisa, 30000, 'つみたて投資');
    }
    if (dayOfMonth === 2) {
      move(date, accounts.bank, accounts.savings, 50000, '先取り貯金');
    }
    if (dayOfMonth === 28) {
      const change = Math.round(balance[accounts.nisa.id] * (random() * 0.06 - 0.018));
      add(date, 'adjust', change, accounts.nisa, { description: '評価額の更新' });
      add(date, 'adjust', between(300, 900), accounts.points, { description: 'ポイント付与' });
    }

    // 毎日の買い物
    if (weekday === 0 || weekday === 3) {
      spend(date, random() < 0.6 ? accounts.card : accounts.qr, between(2200, 6800), pick(['ライフ', 'イオン', '業務スーパー', 'オーケー']), 'food', '食料品');
    }
    if (isWeekday && random() < 0.35) {
      spend(date, accounts.qr, between(280, 980), pick(['セブン-イレブン', 'ローソン', 'ファミリーマート']), 'food', '食料品');
    }
    if (isWeekday && random() < 0.45) {
      spend(date, accounts.wallet, between(85, 130) * 10, pick(['定食 さくら', 'カレーハウス ルゥ', 'そば処 みやこ', 'ラーメン 一番星']), 'food', '外食');
    }
    if (random() < 0.22) {
      spend(date, accounts.ic, between(38, 72) * 10, pick(['スターバックス', 'ドトール', 'タリーズ']), 'food', 'カフェ');
    }
    if ((!isWeekday && random() < 0.5) || (isWeekday && random() < 0.15)) {
      spend(date, accounts.ic, between(17, 68) * 10, 'JR 乗車', 'transport', '電車');
    }
    if ((weekday === 5 || weekday === 6) && random() < 0.4) {
      const isDrinking = random() < 0.4;
      spend(date, accounts.card, between(28, 68) * 100, pick(['居酒屋 とり吉', '焼肉 じゅうじゅう', 'イタリアン ポルト']), isDrinking ? 'social' : 'food', isDrinking ? '飲み会' : '外食');
    }
    if (random() < 0.08) {
      spend(date, accounts.qr, between(600, 3200), pick(['マツモトキヨシ', 'ウエルシア']), 'daily', 'ドラッグストア');
    }
    if (random() < 0.05) {
      spend(date, accounts.card, between(330, 4800), pick(['ダイソー', '無印良品', 'ニトリ']), 'daily', '日用品');
    }
    if (random() < 0.03) {
      spend(date, accounts.card, between(1990, 7990), pick(['ユニクロ', 'GU']), 'clothes', '衣服');
    }
    if (random() < 0.04) {
      spend(date, accounts.card, between(880, 2400), '紀伊國屋書店', 'education', '書籍');
    }
    if (random() < 0.02) {
      spend(date, accounts.wallet, between(1200, 3800), 'さくらクリニック', 'health', '病院・薬');
    }

    // 大きな買い物（カードのいろいろな支払い方法の例）
    if (monthIndex === 3 && dayOfMonth === 12) {
      spend(date, accounts.card, 89800, '家電量販店 冷蔵庫', 'special', '家具・家電', { payMethod: 'installment', installments: 12 });
    }
    if (monthIndex === 6 && dayOfMonth === 14) {
      spend(date, accounts.card, 12000, '誕生日プレゼント', 'social', 'プレゼント');
    }
    if (monthIndex === 8 && dayOfMonth === 20) {
      spend(date, accounts.card, 38600, 'ホテル予約（旅行）', 'hobby', '旅行', { payMethod: 'bonus' });
    }
    if (monthIndex === 9 && dayOfMonth === 3) {
      spend(date, accounts.card, 148000, 'ノートパソコン', 'special', '家具・家電', { payMethod: 'revolving' });
    }
    if (monthIndex === 10 && dayOfMonth === 6) {
      spend(date, accounts.card, 42000, 'スーツ', 'clothes', '衣服', { payMethod: 'skip', skipMonths: 2 });
    }
    if (monthIndex === 11 && dayOfMonth === 9) {
      spend(date, accounts.card, 49980, 'ゲーム機', 'hobby', '映画・音楽・ゲーム', { payMethod: 'twice' });
    }

    // 残高が少なくなったらチャージ・引き出し
    if (balance[accounts.wallet.id] < 5000) {
      move(date, accounts.bank, accounts.wallet, 20000, 'ATM 引き出し');
    }
    if (balance[accounts.ic.id] < 1500) {
      move(date, accounts.card, accounts.ic, 5000, 'オートチャージ');
    }
    if (balance[accounts.qr.id] < 2000) {
      move(date, accounts.bank, accounts.qr, 10000, 'チャージ');
    }

    day.setDate(day.getDate() + 1);
  }

  // --- カードの引き落とし（支払日が今日までの請求をすべて記録する） ---
  const cardRecords = records.filter((record) => record.account === accounts.card.id || record.toAccount === accounts.card.id);
  const bills = buildCardBills(accounts.card, cardRecords);
  for (const bill of bills) {
    if (bill.payDate > todayString || bill.total <= 0) {
      continue;
    }
    const label = formatMonthText(bill.month) + '請求分';
    add(bill.payDate, 'transfer', bill.principal, accounts.bank, {
      toAccount: accounts.card.id, description: accounts.card.name + ' 引き落とし（' + label + '）', billMonth: bill.month,
    });
    if (bill.fee > 0) {
      add(bill.payDate, 'expense', bill.fee, accounts.bank, {
        description: accounts.card.name + ' 手数料（' + label + '）', category: 'other', sub: 'カード手数料', billMonth: bill.month,
      });
    }
  }

  // --- 月ごとの箱に分ける ---
  const monthly = {};
  for (const record of records) {
    const month = record.date.slice(0, 7);
    if (!monthly[month]) {
      monthly[month] = [];
    }
    monthly[month].push(record);
  }

  const profile = {
    version: 1,
    settings: { startDay: 1, savingsGoal: 50000 },
    accounts: Object.values(accounts),
    budgets: {
      food: 52000, daily: 8000, hobby: 15000, social: 10000, transport: 6000, clothes: 10000,
      health: 12000, utility: 15000, phone: 11000, housing: 84000, insurance: 7000, education: 4000,
    },
    rules: [],
  };
  return { profile: profile, monthly: monthly };
}
