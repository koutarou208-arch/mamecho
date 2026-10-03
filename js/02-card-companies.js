/* ===========================================================
   02-card-companies.js  ―  クレジットカード会社の「辞書」
   -----------------------------------------------------------
   カード会社ごとの決まりごとをまとめたファイルです。
     ・締め日（ここまでの利用分をまとめる日）
     ・支払日（銀行口座から引き落とされる日）
     ・ボーナス払いが使える期間と支払月
     ・使える支払い方法（分割・リボ・スキップ払い など）
     ・手数料率（実質年率）

   【大事】ここに書いた日付や手数料率は、各社が公表している情報を
   もとにした「目安」です（2026年10月時点で調べた内容）。
   カード会社はルールを変えることがあるので、実際の数字は
   ご自身のカードの明細や会員ページで確かめてください。
   アプリの口座設定画面から、カードごとに数字を上書きできます。

   書き方のルール:
     closingDay … 締め日（31 と書くと「月末」の意味）
     paymentDay … 支払日（31 と書くと「月末」の意味）
     monthsLater … 締めた月から何か月後に払うか（0=当月, 1=翌月, 2=翌々月）
   =========================================================== */


/* -----------------------------------------------------------
   支払い方法の一覧
     label … 画面に表示する名前
     short … 一覧などで使う短い名前
     note  … 説明（入力画面に出ます）
   ----------------------------------------------------------- */
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


/* -----------------------------------------------------------
   よくあるボーナス払いの期間
   （多くのカード会社が使っている「夏は8月・冬は1月払い」の型）
     from / to … 利用した日がこの期間なら（月-日）
     payMonth  … この月の支払日に払う
   ----------------------------------------------------------- */
const STANDARD_BONUS = {
  summer: { from: '12-16', to: '06-15', payMonth: 8 },
  winter: { from: '07-16', to: '11-15', payMonth: 1 },
};


/* -----------------------------------------------------------
   カード会社の一覧
     id           … プログラムの中で使う名前（変えないこと）
     name         … 表示名
     cycles       … 締め日と支払日の組み合わせ（複数ある会社は選べる）
     methods      … 使える支払い方法（上の PAYMENT_METHODS の名前）
     bonus        … ボーナス払いの期間（null ならボーナス払いなし）
     installmentRate … 分割払いの手数料（実質年率 %）
     revolvingRate   … リボ払いの手数料（実質年率 %）
     skipRate        … スキップ払いの手数料（実質年率 %）
     bonus2Fee       … ボーナス2回払いの手数料（100円あたり何円か）
     autoRevolvingName … 「登録型リボ（何も選ばなくても自動でリボになる設定）」の名前
     notes        … 補足（画面に表示されます）
     verified     … true なら公式サイト等で数字を確認済み
   ----------------------------------------------------------- */
const CARD_COMPANIES = [
  {
    id: 'jcb',
    name: 'JCB',
    cycles: [{ label: '15日締め・翌月10日払い', closingDay: 15, paymentDay: 10, monthsLater: 1 }],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving', 'skip'],
    bonus: { summer: { from: '12-16', to: '06-15', payMonth: 8 }, winter: { from: '07-16', to: '11-15', payMonth: 1 } },
    installmentRate: 18.0,
    revolvingRate: 18.0,
    skipRate: 18.0,
    bonus2Fee: 0,
    autoRevolvingName: '支払い名人（登録型リボ）',
    notes: '2026年10月1日以降の利用分から、スキップ払い・分割・リボの手数料は実質年率18.00%（月利1.50%）。スキップ払いは1回払いの支払い月を最大6か月先に変更できます（手数料＝利用額×月利×ずらした月数）。',
    verified: true,
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
    installmentRate: 15.0,
    revolvingRate: 18.0,
    skipRate: 0,
    bonus2Fee: 0,
    autoRevolvingName: 'マイ・ペイすリボ（登録型リボ）',
    notes: '締め日・支払日は2パターンから選べます。分割手数料は回数によって異なります（目安で15%に設定）。「あとから分割」「あとからリボ」で支払い方法をあとから変えられます。',
    verified: true,
  },
  {
    id: 'rakuten',
    name: '楽天カード',
    cycles: [{ label: '月末締め・翌月27日払い', closingDay: 31, paymentDay: 27, monthsLater: 1 }],
    methods: ['once', 'twice', 'bonus', 'bonus2', 'installment', 'revolving'],
    bonus: { summer: { from: '02-01', to: '06-30', payMonth: 8 }, winter: { from: '08-01', to: '11-30', payMonth: 1 } },
    installmentRate: 15.0,
    revolvingRate: 15.0,
    skipRate: 0,
    bonus2Fee: 3.5,
    autoRevolvingName: '自動リボサービス（登録型リボ）',
    notes: 'ボーナス払いは夏（2/1〜6/30利用）が6〜8月、冬（8/1〜11/30利用）が12〜1月の27日払い。お店によって支払月が変わるため、ここでは遅い方（8月・1月）で計算します。ボーナス2回払いは100円あたり3.5円の手数料。',
    verified: true,
  },
  {
    id: 'aeon',
    name: 'イオンカード',
    cycles: [{ label: '10日締め・翌月2日払い', closingDay: 10, paymentDay: 2, monthsLater: 1 }],
    methods: ['once', 'twice', 'bonus', 'bonus2', 'installment', 'revolving'],
    bonus: { summer: { from: '11-21', to: '06-20', payMonth: 8 }, winter: { from: '06-21', to: '11-20', payMonth: 1 } },
    installmentRate: 15.0,
    revolvingRate: 15.0,
    skipRate: 0,
    bonus2Fee: 3.0,
    autoRevolvingName: '',
    notes: 'ボーナス一括払いは1万円以上から。夏は7・8・9月の2日のいずれか（ここでは8月で計算）。ボーナス2回払いは5万円以上から・手数料3%。',
    verified: true,
  },
  {
    id: 'saison',
    name: 'セゾンカード',
    cycles: [{ label: '10日締め・翌月4日払い', closingDay: 10, paymentDay: 4, monthsLater: 1 }],
    methods: ['once', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    installmentRate: 15.0,
    revolvingRate: 15.0,
    skipRate: 0,
    bonus2Fee: 0,
    autoRevolvingName: '',
    notes: 'ボーナス一括払いは8月4日または1月4日払い。「あとから分割」（3〜36回）、「あとからリボ」があります。',
    verified: true,
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
    installmentRate: 18.0,
    revolvingRate: 18.0,
    skipRate: 0,
    bonus2Fee: 0,
    autoRevolvingName: '',
    notes: '締め日・支払日は会員が選べます。あとから分割（3〜36回）は実質年率18.0%。',
    verified: true,
  },
  {
    id: 'mufg',
    name: '三菱UFJカード',
    cycles: [{ label: '15日締め・翌月10日払い', closingDay: 15, paymentDay: 10, monthsLater: 1 }],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    installmentRate: 15.0,
    revolvingRate: 15.0,
    skipRate: 0,
    bonus2Fee: 0,
    autoRevolvingName: '',
    notes: 'ボーナス一括払いは8月10日・1月10日払い。',
    verified: true,
  },
  {
    id: 'nicos',
    name: 'NICOSカード',
    cycles: [{ label: '5日締め・当月27日払い', closingDay: 5, paymentDay: 27, monthsLater: 0 }],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    installmentRate: 15.0,
    revolvingRate: 15.0,
    skipRate: 0,
    bonus2Fee: 0,
    autoRevolvingName: '',
    notes: '締めた月と同じ月の27日に払う「当月払い」です。',
    verified: true,
  },
  {
    id: 'dcard',
    name: 'dカード',
    cycles: [{ label: '15日締め・翌月10日払い', closingDay: 15, paymentDay: 10, monthsLater: 1 }],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    installmentRate: 15.0,
    revolvingRate: 15.0,
    skipRate: 0,
    bonus2Fee: 0,
    autoRevolvingName: '',
    notes: 'ボーナス払いの期間・手数料率は目安です。',
    verified: false,
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
    installmentRate: 15.0,
    revolvingRate: 15.0,
    skipRate: 0,
    bonus2Fee: 0,
    autoRevolvingName: '',
    notes: '管理番号によって締め日・支払日が違います（9から始まる番号は15日締め、5から始まる番号は10日締め）。',
    verified: true,
  },
  {
    id: 'paypay',
    name: 'PayPayカード',
    cycles: [{ label: '月末締め・翌月27日払い', closingDay: 31, paymentDay: 27, monthsLater: 1 }],
    methods: ['once', 'installment', 'revolving'],
    bonus: null,
    installmentRate: 18.0,
    revolvingRate: 18.0,
    skipRate: 0,
    bonus2Fee: 0,
    autoRevolvingName: '',
    notes: '使える支払い方法・手数料率は目安です。',
    verified: false,
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
    bonus: STANDARD_BONUS,
    installmentRate: 15.0,
    revolvingRate: 15.0,
    skipRate: 0,
    bonus2Fee: 0,
    autoRevolvingName: '',
    notes: '締め日は会員ごとに異なります（3パターン）。明細の締め日に合わせて選んでください。',
    verified: true,
  },
  {
    id: 'view',
    name: 'ビューカード',
    cycles: [{ label: '月末締め・翌々月4日払い', closingDay: 31, paymentDay: 4, monthsLater: 2 }],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    installmentRate: 15.0,
    revolvingRate: 15.0,
    skipRate: 0,
    bonus2Fee: 0,
    autoRevolvingName: '',
    notes: '支払いは締めた月の「翌々月」です。ボーナス払いの期間は目安です。',
    verified: true,
  },
  {
    id: 'orico',
    name: 'オリコカード',
    cycles: [{ label: '月末締め・翌月27日払い', closingDay: 31, paymentDay: 27, monthsLater: 1 }],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    installmentRate: 15.0,
    revolvingRate: 15.0,
    skipRate: 0,
    bonus2Fee: 0,
    autoRevolvingName: '',
    notes: 'ボーナス払いの期間・手数料率は目安です。',
    verified: true,
  },
  {
    id: 'jaccs',
    name: 'ジャックスカード',
    cycles: [{ label: '月末締め・翌月27日払い', closingDay: 31, paymentDay: 27, monthsLater: 1 }],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    installmentRate: 15.0,
    revolvingRate: 15.0,
    skipRate: 0,
    bonus2Fee: 0,
    autoRevolvingName: '',
    notes: 'ボーナス払いの期間・手数料率は目安です。',
    verified: true,
  },
  {
    id: 'uc',
    name: 'UCカード',
    cycles: [{ label: '10日締め・翌月5日払い', closingDay: 10, paymentDay: 5, monthsLater: 1 }],
    methods: ['once', 'twice', 'bonus', 'installment', 'revolving'],
    bonus: STANDARD_BONUS,
    installmentRate: 15.0,
    revolvingRate: 15.0,
    skipRate: 0,
    bonus2Fee: 0,
    autoRevolvingName: '',
    notes: 'ボーナス払いの期間・手数料率は目安です。',
    verified: true,
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
    installmentRate: 15.0,
    revolvingRate: 15.0,
    skipRate: 0,
    bonus2Fee: 0,
    autoRevolvingName: '',
    notes: '支払日は引き落とし口座の銀行によって決まります。',
    verified: true,
  },
  {
    id: 'custom',
    name: 'その他（自分で設定）',
    cycles: [{ label: '月末締め・翌月27日払い', closingDay: 31, paymentDay: 27, monthsLater: 1 }],
    methods: ['once', 'twice', 'bonus', 'bonus2', 'installment', 'revolving', 'skip'],
    bonus: STANDARD_BONUS,
    installmentRate: 15.0,
    revolvingRate: 15.0,
    skipRate: 15.0,
    bonus2Fee: 0,
    autoRevolvingName: '',
    notes: '一覧にないカードは、明細を見ながら締め日・支払日・手数料率を入力してください。',
    verified: false,
  },
];


/** id からカード会社を探す（見つからなければ「その他」を返す） */
function findCardCompany(companyId) {
  for (const company of CARD_COMPANIES) {
    if (company.id === companyId) {
      return company;
    }
  }
  return CARD_COMPANIES[CARD_COMPANIES.length - 1];
}
