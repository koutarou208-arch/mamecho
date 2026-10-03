/* ===========================================================
   02-card-companies.js  ―  クレジットカード会社の「辞書」
   -----------------------------------------------------------
   カード会社ごとの決まりごとをまとめたファイルです。
     ・締め日（ここまでの利用分をまとめる日）
     ・支払日（銀行口座から引き落とされる日）
     ・ボーナス払いが使える期間と支払月
     ・使える支払い方法（分割・リボ・スキップ払い など）
     ・手数料率（実質年率）… いつから何%か、を日付つきで持っています

   【このファイルは毎月、自動で見直されます】
   tools/UPDATE_RULES.md の手順にしたがって、毎月1回、各社の公式ページを
   確認し、変わっていたらここを書きかえます（定期実行の設定済み）。
   書きかえたときは RULES_CHANGELOG に1件足され、アプリの上部に
   「制度が変わりました」というお知らせが出ます。

   【大事】ここに書いた数字は、各社が公表している情報をもとにした「目安」です。
   各社の confidence（確からしさ）を見てください:
     'official'  … 公式ページで確認できた
     'secondary' … 解説サイトやニュースなど、公式以外の情報から
     'inferred'  … 古い情報や他社の数字からの推定（あてにしすぎない）
   実際の数字はご自身のカードの明細や会員ページで確かめてください。
   アプリの口座設定画面から、カードごとに数字を上書きできます。

   書き方のルール:
     closingDay … 締め日（31 と書くと「月末」の意味）
     paymentDay … 支払日（31 と書くと「月末」の意味）
     monthsLater … 締めた月から何か月後に払うか（0=当月, 1=翌月, 2=翌々月）
     rates … 手数料率。 [{ from: '適用開始日', rate: 数字 または 回数ごとの表 }]
             日付は「買い物をした日」で判断します（古い買い物は古い率のまま）。
             回数ごとの表 { 3: 14.7, 6: 16.7 } は、買い物の回数以上で一番近い回数の率を使います。
   =========================================================== */


/* ===========================================================
   1. データのバージョンと、制度変更の履歴
   =========================================================== */

const RULES_META = {
  dataVersion: '2026.10.1',   // データを更新したら変える（年.月.連番）
  checkedAt: '2026-10-03',    // 最後に公式ページを確認した日
  staleAfterDays: 45,         // 確認から何日たったら「古いかも」と知らせるか
};

/**
 * 制度変更の履歴（新しいものを上に足す）。
 *   id        … 重ならない名前（お知らせを「読んだ」記録に使う）
 *   date      … 見つけた日（お知らせの表示期間の基準）
 *   effective … 変更が始まる日（未来ならこれから変わる）
 *   company   … 対象のカード会社 id（全社なら 'all'）
 *   title     … 一言まとめ
 *   detail    … くわしい説明
 *   source    … 出典のページ
 */
const RULES_CHANGELOG = [
  {
    id: '2026-10-jcb-18',
    date: '2026-10-03',
    effective: '2026-10-01',
    company: 'jcb',
    title: 'JCB: スキップ払い・分割・リボの手数料が年18.00%に',
    detail: '2026年10月1日のご利用分から、ショッピングスキップ・分割・リボ払い（登録型リボをふくむ）の手数料率が実質年率18.00%（月利1.50%）になりました。9月30日までの利用分は旧率のままです。',
    source: 'https://www.jcb.co.jp/release/oshirase_payment.html',
  },
  {
    id: '2026-10-mufg-nicos-up',
    date: '2026-10-03',
    effective: '2026-10-30',
    company: 'mufg',
    title: '三菱UFJニコス（MUFGカード・NICOS）: 分割・リボの手数料が上がります',
    detail: '分割払いは3回16.25%、12回19.50%などに、リボ払いは18.00%→19.80%に引き上げられます。会員規約の改定日は2026年10月30日と案内されていますが、適用時期はカードの種類によって異なるという記載もあり、日付は目安です。',
    source: 'https://www.cr.mufg.jp/member/new/20260701_01.html',
  },
  {
    id: '2026-10-nicos-up',
    date: '2026-10-03',
    effective: '2026-10-30',
    company: 'nicos',
    title: 'NICOSカード: 分割・リボの手数料が上がります',
    detail: '三菱UFJニコスのカード全体の改定です。リボ払いは18.00%→19.80%。',
    source: 'https://www.cr.mufg.jp/member/new/20260701_01.html',
  },
  {
    id: '2026-11-aeon-down',
    date: '2026-10-03',
    effective: '2026-11-11',
    company: 'aeon',
    title: 'イオンカード: 分割払いの手数料が下がる予定（未確認）',
    detail: '2026年11月11日から、ショッピング分割払いの手数料が実質年率14.70〜17.91%から9.69〜12.42%程度に下がるという情報があります。公式ページで確認できていないため、実際の請求で確かめてください。',
    source: 'https://www.aeon.co.jp/service/revo/installments_revo/',
  },
  {
    id: '2027-01-aupay-up',
    date: '2026-10-03',
    effective: '2027-01-01',
    company: 'aupay',
    title: 'au PAY カード: リボ19.80%・分割も引き上げ（管理番号5から始まるカード）',
    detail: '管理番号が「5」から始まるカードは、2027年1月請求分からリボ払いが19.80%、分割払いも3回16.31%・12回19.58%などになります。「9」から始まるカードの時期は未確認です。',
    source: 'https://www.kddi-fs.com/contents/important/850.html',
  },
  {
    id: '2026-06-rakuten-atobun',
    date: '2026-10-03',
    effective: '2026-06-01',
    company: 'rakuten',
    title: '楽天カード: 「あとから分割」の手数料が年17.64%に',
    detail: '2026年6月1日から、あとから分割払いの手数料が実質年率17.64%になりました（二次情報）。リボ払いは15.0%のままです。',
    source: 'https://www.rakuten-card.co.jp/adjustment/bonus/',
  },
  {
    id: '2026-03-smbc-revo-18',
    date: '2026-10-03',
    effective: '2026-03-31',
    company: 'smbc',
    title: '三井住友カード: リボ払いの手数料が年15.0%→18.0%に',
    detail: '2026年3月31日からリボ払いの手数料率が実質年率18.0%に改定されました。',
    source: 'https://www.smbc-card.com/mem/revo/revoato.jsp',
  },
];


/* ===========================================================
   2. 支払い方法の一覧
     label … 画面に表示する名前
     short … 一覧などで使う短い名前
     note  … 説明（入力画面に出ます）
   =========================================================== */

const PAYMENT_METHODS = {
  once: {
    label: '1回払い',
    short: '1回',
    note: '次の支払日にまとめて払います。手数料はかかりません。',
  },
  twice: {
    label: '2回払い',
    short: '2回',
    note: '2か月に分けて半分ずつ払います。手数料はかかりません。',
  },
  bonus: {
    label: 'ボーナス一括払い',
    short: 'ボーナス',
    note: '夏または冬のボーナス月にまとめて払います。手数料はかかりません。',
  },
  bonus2: {
    label: 'ボーナス2回払い',
    short: 'ボーナス2回',
    note: '夏と冬の2回に分けて払います。カード会社によって手数料がかかります。',
  },
  installment: {
    label: '分割払い',
    short: '分割',
    note: '3回以上に分けて払います。回数に応じて手数料がかかります。「あとから分割」で変えた場合もこれを選びます。',
  },
  revolving: {
    label: 'リボ払い',
    short: 'リボ',
    note: '毎月ほぼ決まった額を払います。残っている金額に毎月手数料がかかり続けます。「あとからリボ」もこれです。',
  },
  skip: {
    label: 'スキップ払い',
    short: 'スキップ',
    note: '1回払いの支払い月を1〜6か月先にずらします（JCB）。ずらした月数分の手数料がかかります。',
  },
};

/** 分割払いで選べる回数 */
const INSTALLMENT_COUNTS = [3, 5, 6, 10, 12, 15, 18, 20, 24, 30, 36];

/** よくあるボーナス払いの期間（夏は8月・冬は1月払い）。from / to は「月-日」 */
const STANDARD_BONUS = {
  summer: { from: '12-16', to: '06-15', payMonth: 8 },
  winter: { from: '07-16', to: '11-15', payMonth: 1 },
};

/** 日付が古い順に並んだ「いつから何%」の表のうち、dateText の時点で使うものを選ぶ */
const ALWAYS = '0000-00-00'; // 「ずっと前から」の意味の日付


/* ===========================================================
   3. 手数料率の表から率を取り出す道具
   =========================================================== */

/**
 * rates … [{ from, rate }]（from の古い順）
 * dateText … 買い物をした日（"2026-09-14"）
 * count … 分割の回数（分割以外は省略）
 * 回数ごとの表のときは「count 以上で一番近い回数」の率を使う（なければ最大の回数）。
 * ※間の回数は高いほうの率を使うので、費用は少し多めに出ます。
 */
function pickRate(rates, dateText, count) {
  if (!rates || rates.length === 0) {
    return 0;
  }
  let chosen = rates[0];
  for (const entry of rates) {
    if (entry.from <= dateText) {
      chosen = entry;
    }
  }
  const rate = chosen.rate;
  if (typeof rate === 'number') {
    return rate;
  }
  const keys = Object.keys(rate).map(Number).sort((a, b) => a - b);
  for (const key of keys) {
    if (key >= (count || keys[0])) {
      return rate[key];
    }
  }
  return rate[keys[keys.length - 1]];
}

/** 表の中の最小と最大の率（画面に「年14.7〜17.9%」と出すため） */
function rateRangeAt(rates, dateText) {
  if (!rates || rates.length === 0) {
    return null;
  }
  let chosen = rates[0];
  for (const entry of rates) {
    if (entry.from <= dateText) {
      chosen = entry;
    }
  }
  const values = typeof chosen.rate === 'number' ? [chosen.rate] : Object.values(chosen.rate);
  return { min: Math.min(...values), max: Math.max(...values) };
}


/* ===========================================================
   4. カード会社の一覧
     id           … プログラムの中で使う名前（変えないこと）
     name         … 表示名
     cycles       … 締め日と支払日の組み合わせ（複数ある会社は選べる）
     methods      … 使える支払い方法（上の PAYMENT_METHODS の名前）
     bonus        … ボーナス払いの期間（null ならボーナス払いなし）
     rates        … { installment: 分割, revolving: リボ, skip: スキップ払い }
     bonus2Fee    … ボーナス2回払いの手数料（100円あたり何円か）
     autoRevolvingName … 「登録型リボ（何も選ばなくても自動でリボになる設定）」の名前
     sources      … 確認に使う公式ページ（毎月の見直しで使う）
     confidence   … 確からしさ（ファイル先頭の説明を見てください）
     checkedAt    … この会社を最後に確認した日
     notes        … 補足（画面に表示されます）
   =========================================================== */

const CARD_COMPANIES = [
  {
    id: 'jcb',
    name: 'JCB',
    cycles: [{ label: '15日締め・翌月10日払い', closingDay: 15, paymentDay: 10, monthsLater: 1 }],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving', 'skip'],
    bonus: STANDARD_BONUS,
    rates: {
      // 改定前は回数などにより7.92〜15.00%。表の細部は未確認のため上限の15%で計算します
      installment: [{ from: ALWAYS, rate: 15.0 }, { from: '2026-10-01', rate: 18.0 }],
      revolving: [{ from: ALWAYS, rate: 15.0 }, { from: '2026-10-01', rate: 18.0 }],
      skip: [{ from: ALWAYS, rate: 15.0 }, { from: '2026-10-01', rate: 18.0 }],
    },
    bonus2Fee: 0,
    autoRevolvingName: '支払い名人（登録型リボ）',
    sources: ['https://www.jcb.co.jp/release/oshirase_payment.html', 'https://www.jcb.co.jp/payment/skip/index.html', 'https://j-faq.jcb.co.jp/faq/show/378?site_domain=default'],
    confidence: 'official',
    checkedAt: '2026-10-03',
    notes: 'スキップ払いは1回払いの支払い月を最大6か月先に変更できます（手数料＝利用額×月利×ずらした月数、2026年10月以降の利用分は月利1.50%）。対象は1回払いのみ。',
  },
  {
    id: 'smbc',
    name: '三井住友カード',
    cycles: [
      { label: '15日締め・翌月10日払い', closingDay: 15, paymentDay: 10, monthsLater: 1 },
      { label: '月末締め・翌月26日払い', closingDay: 31, paymentDay: 26, monthsLater: 1 },
    ],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    rates: {
      installment: [{ from: ALWAYS, rate: { 3: 14.70, 6: 16.68, 12: 17.69 } }],
      revolving: [{ from: ALWAYS, rate: 15.0 }, { from: '2026-03-31', rate: 18.0 }],
      skip: [],
    },
    bonus2Fee: 0,
    autoRevolvingName: 'マイ・ペイすリボ（登録型リボ）',
    sources: ['https://www.smbc-card.com/mem/revo/atokarabunkatsu.jsp', 'https://www.smbc-card.com/mem/revo/revoato.jsp'],
    confidence: 'official',
    checkedAt: '2026-10-03',
    notes: '締め日・支払日は2パターンから選べます。分割手数料は3回14.70%・6回16.68%・12回17.69%（それ以外の回数は近い回数の率で代用）。「あとから分割」「あとからリボ」で支払い方法をあとから変えられます。',
  },
  {
    id: 'rakuten',
    name: '楽天カード',
    cycles: [{ label: '月末締め・翌月27日払い', closingDay: 31, paymentDay: 27, monthsLater: 1 }],
    methods: ['once', 'twice', 'bonus', 'bonus2', 'installment', 'revolving'],
    bonus: { summer: { from: '02-01', to: '06-30', payMonth: 8 }, winter: { from: '08-01', to: '11-30', payMonth: 1 } },
    rates: {
      // 改定前の率は未確認のため、改定後の率を全期間に使います
      installment: [{ from: ALWAYS, rate: 17.64 }],
      revolving: [{ from: ALWAYS, rate: 15.0 }],
      skip: [],
    },
    bonus2Fee: 3.5,
    autoRevolvingName: '自動リボサービス（登録型リボ）',
    sources: ['https://www.rakuten-card.co.jp/adjustment/bonus/', 'https://support.rakuten-card.jp/faq/show/151?site_domain=guest'],
    confidence: 'official',
    checkedAt: '2026-10-03',
    notes: 'ボーナス払いは夏（2/1〜6/30利用）が6〜8月、冬（8/1〜11/30利用）が12〜1月の27日払い（お店によって異なり、ここでは遅い8月・1月で計算）。ボーナス2回払いは100円あたり3.5円。分割17.64%は「あとから分割」の率です。',
  },
  {
    id: 'aeon',
    name: 'イオンカード',
    cycles: [{ label: '10日締め・翌月2日払い', closingDay: 10, paymentDay: 2, monthsLater: 1 }],
    methods: ['once', 'twice', 'bonus', 'bonus2', 'installment', 'revolving'],
    bonus: { summer: { from: '11-21', to: '06-20', payMonth: 8 }, winter: { from: '06-21', to: '11-20', payMonth: 1 } },
    rates: {
      installment: [
        { from: ALWAYS, rate: { 3: 14.70, 6: 16.68, 12: 17.69, 24: 17.91 } },
        { from: '2026-11-11', rate: { 3: 10.05, 6: 11.19, 10: 12.04, 24: 12.42 } },
      ],
      revolving: [{ from: ALWAYS, rate: 18.0 }],
      skip: [],
    },
    bonus2Fee: 3.0,
    autoRevolvingName: '',
    sources: ['https://faq.aeon.co.jp/faq/show/448?site_domain=default', 'https://www.aeon.co.jp/service/revo/installments_revo/'],
    confidence: 'secondary',
    checkedAt: '2026-10-03',
    notes: 'ボーナス一括払いは1万円以上から。夏は7・8・9月の2日のいずれか（ここでは8月で計算）。ボーナス2回払いは5万円以上から・手数料3%。分割の手数料は2026年11月11日に下がるという情報があり、公式での確認はできていません。',
  },
  {
    id: 'saison',
    name: 'セゾンカード',
    cycles: [{ label: '10日締め・翌月4日払い', closingDay: 10, paymentDay: 4, monthsLater: 1 }],
    methods: ['once', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    rates: {
      installment: [{ from: ALWAYS, rate: { 3: 14.7, 5: 16.3, 10: 17.5, 36: 17.9 } }],
      revolving: [{ from: ALWAYS, rate: 18.0 }],
      skip: [],
    },
    bonus2Fee: 0,
    autoRevolvingName: '',
    sources: ['https://www.saisoncard.co.jp/creditcard/payment/info/', 'https://faq.saisoncard.co.jp/saison/detail?site=OA5LHO14&id=1339'],
    confidence: 'secondary',
    checkedAt: '2026-10-03',
    notes: 'ボーナス一括払いは8月4日または1月4日払い。リボは標準コースで18.00%（ゴールド15.00%・プラチナ12.00%）。「あとから分割」（3〜36回）、「あとからリボ」があります。',
  },
  {
    id: 'epos',
    name: 'エポスカード',
    cycles: [
      { label: '27日締め・翌月27日払い', closingDay: 27, paymentDay: 27, monthsLater: 1 },
      { label: '4日締め・翌月4日払い', closingDay: 4, paymentDay: 4, monthsLater: 1 },
    ],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    rates: {
      installment: [{ from: ALWAYS, rate: 15.0 }, { from: '2025-10-01', rate: 18.0 }],
      revolving: [{ from: ALWAYS, rate: 15.0 }, { from: '2025-10-01', rate: 18.0 }],
      skip: [],
    },
    bonus2Fee: 0,
    autoRevolvingName: '',
    sources: ['https://www.eposcard.co.jp/articles/news/rate-change.html', 'https://faq.eposcard.co.jp/faq/show/41?category_id=29&site_domain=default'],
    confidence: 'official',
    checkedAt: '2026-10-03',
    notes: '締め日・支払日は会員が選べます。2025年10月1日から、分割・リボとも実質年率18.0%です。',
  },
  {
    id: 'mufg',
    name: '三菱UFJカード',
    cycles: [{ label: '15日締め・翌月10日払い', closingDay: 15, paymentDay: 10, monthsLater: 1 }],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    rates: {
      installment: [
        { from: ALWAYS, rate: { 3: 14.75, 5: 16.25, 6: 16.75, 10: 17.50, 12: 17.75, 15: 17.75, 18: 18.00, 20: 18.00, 24: 18.00 } },
        { from: '2026-10-30', rate: { 3: 16.25, 5: 18.00, 6: 18.50, 10: 19.50, 12: 19.50, 15: 19.75, 18: 19.75, 20: 19.75, 24: 19.75 } },
      ],
      revolving: [{ from: ALWAYS, rate: 18.0 }, { from: '2026-10-30', rate: 19.8 }],
      skip: [],
    },
    bonus2Fee: 0,
    autoRevolvingName: '',
    sources: ['https://www.cr.mufg.jp/member/new/20260701_01.html', 'https://faq.cr.mufg.jp/mufgcard/detail?id=331'],
    confidence: 'official',
    checkedAt: '2026-10-03',
    notes: 'ボーナス一括払いは8月10日・1月10日払い。手数料の改定日は2026年10月30日として計算しています（適用時期はカードの種類で異なる可能性があります）。',
  },
  {
    id: 'nicos',
    name: 'NICOSカード',
    cycles: [{ label: '5日締め・当月27日払い', closingDay: 5, paymentDay: 27, monthsLater: 0 }],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    rates: {
      installment: [
        { from: ALWAYS, rate: { 3: 14.75, 5: 16.25, 6: 16.75, 10: 17.50, 12: 17.75, 15: 17.75, 18: 18.00, 20: 18.00, 24: 18.00 } },
        { from: '2026-10-30', rate: { 3: 16.25, 5: 18.00, 6: 18.50, 10: 19.50, 12: 19.50, 15: 19.75, 18: 19.75, 20: 19.75, 24: 19.75 } },
      ],
      revolving: [{ from: ALWAYS, rate: 18.0 }, { from: '2026-10-30', rate: 19.8 }],
      skip: [],
    },
    bonus2Fee: 0,
    autoRevolvingName: '',
    sources: ['https://www.cr.mufg.jp/member/new/20260701_01.html', 'https://faq.cr.mufg.jp/nicos/detail?id=1163'],
    confidence: 'official',
    checkedAt: '2026-10-03',
    notes: '締めた月と同じ月の27日に払う「当月払い」です。',
  },
  {
    id: 'dcard',
    name: 'dカード',
    cycles: [{ label: '15日締め・翌月10日払い', closingDay: 15, paymentDay: 10, monthsLater: 1 }],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    rates: {
      installment: [{ from: ALWAYS, rate: { 3: 12.00, 5: 13.25, 6: 13.75, 10: 14.25, 12: 14.50 } }],
      revolving: [{ from: ALWAYS, rate: 15.0 }],
      skip: [],
    },
    bonus2Fee: 0,
    autoRevolvingName: '',
    sources: ['https://dcard.docomo.ne.jp/st/service_payment/split_pay/how/afterinstallment.html', 'https://dcard.docomo.ne.jp/st/service_payment/revo/how/aboutafterrevo.html'],
    confidence: 'secondary',
    checkedAt: '2026-10-03',
    notes: '分割は3回12.00%〜12回14.50%（回数が多いと最大14.75%）。ボーナス払いの期間は標準の目安です。',
  },
  {
    id: 'aupay',
    name: 'au PAY カード',
    cycles: [
      { label: '15日締め・翌月10日払い', closingDay: 15, paymentDay: 10, monthsLater: 1 },
      { label: '10日締め・翌月4日払い', closingDay: 10, paymentDay: 4, monthsLater: 1 },
    ],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    rates: {
      installment: [
        { from: ALWAYS, rate: { 3: 14.70, 6: 16.68, 12: 17.69, 18: 17.89, 24: 17.88 } },
        { from: '2027-01-01', rate: { 3: 16.31, 6: 18.48, 12: 19.58, 18: 19.78, 24: 19.74 } },
      ],
      revolving: [{ from: ALWAYS, rate: 18.0 }, { from: '2027-01-01', rate: 19.8 }],
      skip: [],
    },
    bonus2Fee: 0,
    autoRevolvingName: '',
    sources: ['https://www.kddi-fs.com/contents/important/850.html', 'https://www.kddi-fs.com/function/promotion/bnpl/payment/'],
    confidence: 'secondary',
    checkedAt: '2026-10-03',
    notes: '管理番号が9から始まるカードは15日締め・翌月10日払い、5から始まるカードは10日締め・翌月4日払い。手数料の改定は管理番号5のカードで2027年1月請求分から（9のカードの時期は未確認）。',
  },
  {
    id: 'paypay',
    name: 'PayPayカード',
    cycles: [{ label: '月末締め・翌月27日払い', closingDay: 31, paymentDay: 27, monthsLater: 1 }],
    methods: ['once', 'twice', 'installment', 'revolving'],
    bonus: null,
    rates: {
      // 2025年8月1日の利用分から全回数で年18.0%（改定前は回数により低い率）
      installment: [{ from: ALWAYS, rate: 18.0 }],
      revolving: [{ from: ALWAYS, rate: 18.0 }],
      skip: [],
    },
    bonus2Fee: 0,
    autoRevolvingName: '',
    sources: ['https://www.paypay-card.co.jp/info/007723.html', 'https://www.paypay-card.co.jp/service/payment/installments/'],
    confidence: 'official',
    checkedAt: '2026-10-03',
    notes: '2025年8月1日の利用分から、分割は3〜48回すべて実質年率18.0%。ボーナス払いの取り扱いは未確認のため、選べないようにしています。',
  },
  {
    id: 'amex',
    name: 'アメリカン・エキスプレス',
    cycles: [
      { label: '20日ごろ締め・翌月10日払い', closingDay: 20, paymentDay: 10, monthsLater: 1 },
      { label: '1日ごろ締め・当月21日払い', closingDay: 1, paymentDay: 21, monthsLater: 0 },
      { label: '5日ごろ締め・当月26日払い', closingDay: 5, paymentDay: 26, monthsLater: 0 },
    ],
    methods: ['once', 'bonus', 'installment', 'revolving'],
    bonus: { summer: { from: '12-16', to: '07-15', payMonth: 8 }, winter: { from: '07-16', to: '12-15', payMonth: 12 } },
    rates: {
      installment: [{ from: ALWAYS, rate: 14.9 }],
      revolving: [{ from: ALWAYS, rate: 14.9 }],
      skip: [],
    },
    bonus2Fee: 0,
    autoRevolvingName: '',
    sources: ['https://www.americanexpress.com/ja-jp/services/payflex/ato-bunkatsu/', 'https://www.americanexpress.com/ja-jp/services/payflex/ato-revo/'],
    confidence: 'secondary',
    checkedAt: '2026-10-03',
    notes: '締め日は会員ごとに異なります（3パターン）。「あと分割」は3・6・12回、1万円以上が対象。ボーナス払いは事前申込が必要で、冬の期間は目安です。',
  },
  {
    id: 'view',
    name: 'ビューカード',
    cycles: [{ label: '月末締め・翌々月4日払い', closingDay: 31, paymentDay: 4, monthsLater: 2 }],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    rates: {
      // 3〜10回は12.0%、11〜24回は15.0%
      installment: [{ from: ALWAYS, rate: { 10: 12.0, 24: 15.0 } }],
      revolving: [{ from: ALWAYS, rate: 13.2 }],
      skip: [],
    },
    bonus2Fee: 0,
    autoRevolvingName: '',
    sources: ['https://faq.viewcard.co.jp/faq/show/117?site_domain=default', 'https://www.jreast.co.jp/en/card/guide/rev/payment.html'],
    confidence: 'secondary',
    checkedAt: '2026-10-03',
    notes: '支払いは締めた月の「翌々月」の4日です。ボーナス一括払いは8月4日・1月4日払い。',
  },
  {
    id: 'orico',
    name: 'オリコカード',
    cycles: [{ label: '月末締め・翌月27日払い', closingDay: 31, paymentDay: 27, monthsLater: 1 }],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    rates: {
      installment: [{ from: ALWAYS, rate: { 3: 14.8, 6: 16.7, 10: 17.6, 12: 17.7 } }],
      revolving: [{ from: ALWAYS, rate: 15.0 }],
      skip: [],
    },
    bonus2Fee: 0,
    autoRevolvingName: '',
    sources: ['https://www.orico.co.jp/creditcard/service/shopping/terms/'],
    confidence: 'secondary',
    checkedAt: '2026-10-03',
    notes: '分割は2〜36回、ボーナス一括・二括は手数料なし。リボは種類によって8.4〜18.0%の幅があります。',
  },
  {
    id: 'jaccs',
    name: 'ジャックスカード',
    cycles: [{ label: '月末締め・翌月27日払い', closingDay: 31, paymentDay: 27, monthsLater: 1 }],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    rates: {
      installment: [{ from: ALWAYS, rate: { 3: 14.75, 5: 16.25, 10: 17.75 } }],
      revolving: [{ from: ALWAYS, rate: 16.8 }],
      skip: [],
    },
    bonus2Fee: 0,
    autoRevolvingName: '',
    sources: ['https://faq.jaccs.co.jp/faq_detail.html?id=401'],
    confidence: 'secondary',
    checkedAt: '2026-10-03',
    notes: 'ボーナス払いの期間は標準の目安です。',
  },
  {
    id: 'uc',
    name: 'UCカード',
    cycles: [{ label: '10日締め・翌月5日払い', closingDay: 10, paymentDay: 5, monthsLater: 1 }],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    rates: {
      // 古い情報の可能性が高い数字です。カードの明細で必ず確かめてください
      installment: [{ from: ALWAYS, rate: { 3: 10.25, 5: 11.25, 10: 12.25, 24: 13.25 } }],
      revolving: [{ from: ALWAYS, rate: 15.0 }],
      skip: [],
    },
    bonus2Fee: 0,
    autoRevolvingName: '',
    sources: ['https://www2.uccard.co.jp/uc/money/cash/division.html'],
    confidence: 'inferred',
    checkedAt: '2026-10-03',
    notes: '手数料率は古い情報をもとにした推定です。実際の率はカードの会員ページで確認し、このカードの設定で上書きしてください。',
  },
  {
    id: 'life',
    name: 'ライフカード',
    cycles: [
      { label: '5日締め・当月27日払い', closingDay: 5, paymentDay: 27, monthsLater: 0 },
      { label: '5日締め・翌月3日払い', closingDay: 5, paymentDay: 3, monthsLater: 1 },
    ],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    rates: {
      installment: [{ from: ALWAYS, rate: { 3: 14.7, 5: 16.2, 10: 17.5, 12: 17.6 } }],
      revolving: [{ from: ALWAYS, rate: 19.8 }],
      skip: [],
    },
    bonus2Fee: 0,
    autoRevolvingName: '',
    sources: ['https://www.lifecard.co.jp/info/guidance_rot.html', 'https://www.lifecard.co.jp/howto/payment/installment/'],
    confidence: 'secondary',
    checkedAt: '2026-10-03',
    notes: 'リボと「あと分割」は2023年4月から実質年率19.8%（ここの分割の率は買い物時に回数を選ぶ場合の目安）。支払日は引き落とし口座の銀行によって決まります。',
  },
  {
    id: 'custom',
    name: 'その他（自分で設定）',
    cycles: [{ label: '月末締め・翌月27日払い', closingDay: 31, paymentDay: 27, monthsLater: 1 }],
    methods: ['once', 'twice', 'bonus', 'bonus2', 'installment', 'revolving', 'skip'],
    bonus: STANDARD_BONUS,
    rates: {
      installment: [{ from: ALWAYS, rate: 15.0 }],
      revolving: [{ from: ALWAYS, rate: 15.0 }],
      skip: [{ from: ALWAYS, rate: 15.0 }],
    },
    bonus2Fee: 0,
    autoRevolvingName: '',
    sources: [],
    confidence: 'inferred',
    checkedAt: '2026-10-03',
    notes: '一覧にないカードは、明細を見ながら締め日・支払日・手数料率を入力してください。',
  },
];

/** confidence を画面用のことばにする */
const CONFIDENCE_LABELS = {
  official: '公式ページで確認',
  secondary: '解説サイトなどの情報（公式では未確認）',
  inferred: '推定（要確認）',
};

/** id からカード会社を探す（見つからなければ「その他」を返す） */
function findCardCompany(companyId) {
  for (const company of CARD_COMPANIES) {
    if (company.id === companyId) {
      return company;
    }
  }
  return CARD_COMPANIES[CARD_COMPANIES.length - 1];
}
