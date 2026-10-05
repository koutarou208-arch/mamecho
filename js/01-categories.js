/* ===========================================================
   01-categories.js  ―  カテゴリと口座の種類（アプリの「辞書」）
   -----------------------------------------------------------
   このファイルには「決まりごと」だけが書いてあります。
   計算や画面を作る処理はありません。

   ここを書きかえると変わること:
     ・支出のカテゴリ（食費、日用品…）と、その中の細かい分類
     ・収入のカテゴリ（給与、副業…）
     ・口座の種類（銀行、クレジットカード…）
     ・お店の名前からカテゴリを自動で決めるルール

   ※ 各カテゴリの id（英語の名前）は、保存データの中で使われています。
     一度使い始めたら id は変えないでください（名前 name は変えてOK）。
   =========================================================== */


/* -----------------------------------------------------------
   支出のカテゴリ
     id    … プログラムの中で使う名前（英数字）
     name  … 画面に表示する名前
     mark  … 一覧の左に出る1文字のマーク
     subs  … 中項目（細かい分類）のリスト
     fixed … true なら「固定費」（毎月ほぼ同じ額が出ていくもの）
     tone  … マークの色の系統（似たものは同じ色。下の CATEGORY_TONES を参照）
   ----------------------------------------------------------- */
const EXPENSE_CATEGORIES = [
  { id: 'food',      name: '食費',         mark: '食', tone: 'meal', subs: ['食料品', '外食', 'カフェ', 'その他食費'] },
  { id: 'daily',     name: '日用品',       mark: '日', tone: 'meal', subs: ['日用品', 'ドラッグストア', 'ペット用品', '子育て用品'] },
  { id: 'hobby',     name: '趣味・娯楽',   mark: '遊', tone: 'fun', subs: ['書籍・漫画', '映画・音楽・ゲーム', 'サブスク', '旅行', 'その他趣味'] },
  { id: 'social',    name: '交際費',       mark: '交', tone: 'fun', subs: ['飲み会', 'プレゼント', '冠婚葬祭', 'その他交際費'] },
  { id: 'transport', name: '交通費',       mark: '駅', tone: 'move', subs: ['電車', 'バス', 'タクシー', '飛行機', 'その他交通費'] },
  { id: 'clothes',   name: '衣服・美容',   mark: '衣', tone: 'self', subs: ['衣服', '靴・バッグ', '美容院・理髪', '化粧品', 'クリーニング'] },
  { id: 'health',    name: '健康・医療',   mark: '医', tone: 'self', subs: ['病院・薬', 'フィットネス', 'ボディケア'] },
  { id: 'car',       name: '自動車',       mark: '車', tone: 'move', subs: ['ガソリン', '駐車場', '自動車保険', '車検・整備', '自動車ローン'] },
  { id: 'education', name: '教養・教育',   mark: '学', tone: 'self', subs: ['書籍', '習い事', '新聞・雑誌', '学費', '塾'] },
  { id: 'special',   name: '特別な支出',   mark: '特', subs: ['家具・家電', '住宅・リフォーム', '引っ越し', 'その他特別な支出'] },
  { id: 'utility',   name: '水道・光熱費', mark: '光', tone: 'fixed', subs: ['電気代', 'ガス・灯油代', '水道代'], fixed: true },
  { id: 'phone',     name: '通信費',       mark: '信', tone: 'fixed', subs: ['携帯電話', 'インターネット', '放送視聴料', '郵便・宅配'], fixed: true },
  { id: 'housing',   name: '住宅',         mark: '住', tone: 'fixed', subs: ['家賃・地代', '住宅ローン', '管理費・積立金'], fixed: true },
  { id: 'insurance', name: '保険',         mark: '保', tone: 'fixed', subs: ['生命保険', '医療保険', 'その他保険'], fixed: true },
  { id: 'tax',       name: '税・社会保障', mark: '税', tone: 'fixed', subs: ['所得税・住民税', '年金保険料', '健康保険', 'その他税'], fixed: true },
  { id: 'other',     name: 'その他',       mark: '他', subs: ['未分類', '雑費', 'カード手数料', 'カード引き落とし（仮）', '仕送り', '使途不明金'] },
  // 株式などの売買で出た損。収支には入るが、生活費ではないので予算の対象にはしない（investment: true）
  { id: 'tradeLoss', name: '投資の損失',   mark: '損', subs: ['株式の売却損', '投資信託の売却損', '先物・FX', 'その他の損失'], investment: true },
];

/** 予算や支出ランキングに使う「生活費のカテゴリ」（投資の損失はのぞく） */
const LIVING_EXPENSE_CATEGORIES = EXPENSE_CATEGORIES.filter((category) => !category.investment);


/* -----------------------------------------------------------
   収入のカテゴリ（書き方は支出と同じ）
   ----------------------------------------------------------- */
const INCOME_CATEGORIES = [
  { id: 'salary',   name: '給与',         mark: '給', subs: ['給与', '賞与'] },
  { id: 'business', name: '事業・副業',   mark: '業', subs: ['事業収入', '副業'] },
  { id: 'pension',  name: '年金',         mark: '年', subs: ['年金'] },
  { id: 'dividend', name: '配当・利息',   mark: '配', subs: ['配当', '分配金', '利息'] },
  { id: 'extra',    name: '臨時収入',     mark: '臨', subs: ['臨時収入', '還付金', 'お祝い'] },
  { id: 'otherIn',  name: 'その他入金',   mark: '入', subs: ['その他入金', '未分類'] },
  // 株式などの売買で出た益。収支に入る（trade は「売買益」の id）
  { id: 'trade',    name: '投資の利益',   mark: '益', subs: ['株式の売却益', '投資信託の売却益', '先物・FX', 'その他の利益'], investment: true },
];


/* -----------------------------------------------------------
   マークの色の系統（色は style.css の .mark.tone-○○ で決めている）
   色だけに頼らず、マークの漢字でも見分けられるようにしてある。
   tone のないカテゴリ（特別な支出・その他・投資の損失）は灰色。
   ----------------------------------------------------------- */
const CATEGORY_TONES = {
  meal:  '食べる・暮らす（だいだい色）',
  fun:   '楽しむ・付き合う（もも色）',
  move:  '移動する（みどり色）',
  self:  '自分に使う（からし色）',
  fixed: '毎月の固定費（むらさき色）',
};

/** カテゴリのマークに付ける色のクラス名を返す（例: ' tone-meal'）。色がなければ空の文字 */
function categoryToneClass(category) {
  if (category && category.tone) {
    return ' tone-' + category.tone;
  }
  return '';
}


/* -----------------------------------------------------------
   id からカテゴリを探すための早見表
   例: CATEGORY_BY_ID['food'] → 食費のカテゴリ情報
   ----------------------------------------------------------- */
const CATEGORY_BY_ID = {};
for (const category of EXPENSE_CATEGORIES) {
  CATEGORY_BY_ID[category.id] = { ...category, type: 'expense' };
}
for (const category of INCOME_CATEGORIES) {
  CATEGORY_BY_ID[category.id] = { ...category, type: 'income' };
}

/** 「支出」なら支出カテゴリの一覧を、「収入」なら収入カテゴリの一覧を返す */
function getCategoriesForType(type) {
  if (type === 'income') {
    return INCOME_CATEGORIES;
  }
  return EXPENSE_CATEGORIES;
}


/* -----------------------------------------------------------
   口座の種類
     label  … 画面に表示する名前
     group  … 資産の内訳グラフでどのグループに入るか（下の ASSET_GROUPS）
     isDebt … true なら「負債」（借りているお金）として扱う
   ----------------------------------------------------------- */
const ACCOUNT_KINDS = {
  cash:       { label: '現金',              group: 'cash',   isDebt: false },
  bank:       { label: '銀行口座',          group: 'cash',   isDebt: false },
  emoney:     { label: '電子マネー・決済',  group: 'emoney', isDebt: false },
  securities: { label: '証券・投資',        group: 'invest', isDebt: false },
  points:     { label: 'ポイント・マイル',  group: 'points', isDebt: false },
  card:       { label: 'クレジットカード',  group: 'debt',   isDebt: true },
  loan:       { label: 'ローン',            group: 'debt',   isDebt: true },
};

/** 口座画面で並べる順番 */
const ACCOUNT_KIND_ORDER = ['cash', 'bank', 'emoney', 'securities', 'points', 'card', 'loan'];

/** ホームの「資産の内訳」グラフのグループと色（色は style.css の --chart-1〜4） */
const ASSET_GROUPS = [
  { id: 'cash',   name: '預金・現金',       color: 'var(--chart-1)' },
  { id: 'emoney', name: '電子マネー',       color: 'var(--chart-2)' },
  { id: 'invest', name: '株式・投資信託',   color: 'var(--chart-3)' },
  { id: 'points', name: 'ポイント・マイル', color: 'var(--chart-4)' },
];


/* -----------------------------------------------------------
   自動分類ルール（はじめから入っているもの）
   ・「内容」にこの言葉がふくまれていたら、そのカテゴリにする
   ・上から順に調べて、最初に当てはまったものを使う
   ・英字は大文字で書く（比べるときに大文字にそろえるため）
   ・あなたが入力中にカテゴリを直すと、そのお店のルールが
     自動で覚えられ、こちらより優先されます（設定画面で確認可）
   ----------------------------------------------------------- */
const BUILT_IN_RULES = [
  // ---- 収入 ----
  { type: 'income', words: ['給与', '給料', 'キュウヨ', '賞与', 'ボーナス', 'シヨウヨ'], category: 'salary', sub: '給与' },
  { type: 'income', words: ['配当', '分配金'], category: 'dividend', sub: '配当' },
  { type: 'income', words: ['利息', 'リソク'], category: 'dividend', sub: '利息' },
  { type: 'income', words: ['還付'], category: 'extra', sub: '還付金' },
  { type: 'income', words: ['売却益', '譲渡益', '利益確定'], category: 'trade', sub: '株式の売却益' },
  { type: 'expense', words: ['売却損', '譲渡損', '損切り'], category: 'tradeLoss', sub: '株式の売却損' },

  // ---- 食費 ----
  { type: 'expense', words: ['セブン-イレブン', 'セブンイレブン', 'ローソン', 'ファミリーマート', 'ファミマ', 'ミニストップ', 'デイリーヤマザキ', 'セイコーマート'], category: 'food', sub: '食料品' },
  { type: 'expense', words: ['イオン', '西友', 'ライフ', 'マルエツ', 'イトーヨーカドー', '業務スーパー', 'オーケー', '成城石井', 'サミット', 'ヤオコー', 'スーパー'], category: 'food', sub: '食料品' },
  { type: 'expense', words: ['スターバックス', 'スタバ', 'ドトール', 'タリーズ', 'コメダ', 'カフェ'], category: 'food', sub: 'カフェ' },
  { type: 'expense', words: ['マクドナルド', '吉野家', 'すき家', '松屋', 'サイゼリヤ', 'ガスト', 'スシロー', 'くら寿司', '丸亀製麺', 'UBER EATS', 'ウーバーイーツ', '出前館', '居酒屋', '食堂', '定食'], category: 'food', sub: '外食' },

  // ---- 日用品 ----
  { type: 'expense', words: ['マツモトキヨシ', 'マツキヨ', 'ウエルシア', 'ツルハ', 'スギ薬局', 'ココカラファイン', 'サンドラッグ', 'ドラッグ'], category: 'daily', sub: 'ドラッグストア' },
  { type: 'expense', words: ['ダイソー', 'セリア', 'キャンドゥ', '無印良品', 'ニトリ', 'カインズ', 'ドン・キホーテ', 'ドンキ'], category: 'daily', sub: '日用品' },

  // ---- 趣味・娯楽 ----
  { type: 'expense', words: ['NETFLIX', 'ネットフリックス', 'SPOTIFY', 'スポティファイ', 'プライム会費', 'AMAZON PRIME', 'YOUTUBE', 'DISNEY', 'ディズニープラス', 'U-NEXT', 'DAZN', 'APPLE.COM'], category: 'hobby', sub: 'サブスク' },
  { type: 'expense', words: ['映画', 'シネマ', 'TOHO', 'ゲーム', 'NINTENDO', 'PLAYSTATION'], category: 'hobby', sub: '映画・音楽・ゲーム' },
  { type: 'expense', words: ['ホテル', '旅館', 'じゃらん', '楽天トラベル', 'BOOKING'], category: 'hobby', sub: '旅行' },

  // ---- 教養 ----
  { type: 'expense', words: ['紀伊國屋', 'ジュンク堂', '蔦屋', 'TSUTAYA', '書店', 'KINDLE'], category: 'education', sub: '書籍' },

  // ---- 交通費 ----
  { type: 'expense', words: ['JR', '東京メトロ', 'メトロ', '都営', 'SUICA', 'PASMO', 'ICOCA', '京王', '小田急', '東急', '西武', '東武', '京急', '京成', '相鉄', '阪急', '阪神', '近鉄', '南海', '名鉄', '電車'], category: 'transport', sub: '電車' },
  { type: 'expense', words: ['バス'], category: 'transport', sub: 'バス' },
  { type: 'expense', words: ['タクシー', 'GO タクシー', 'DIDI', 'S.RIDE'], category: 'transport', sub: 'タクシー' },
  { type: 'expense', words: ['ANA', 'JAL', 'ピーチ', 'PEACH', 'スカイマーク', 'ジェットスター'], category: 'transport', sub: '飛行機' },

  // ---- 自動車 ----
  { type: 'expense', words: ['ENEOS', 'エネオス', '出光', 'コスモ石油', 'ガソリン'], category: 'car', sub: 'ガソリン' },
  { type: 'expense', words: ['タイムズ', 'TIMES', 'リパーク', 'パーキング', '駐車'], category: 'car', sub: '駐車場' },

  // ---- 衣服・美容 ----
  { type: 'expense', words: ['ユニクロ', 'UNIQLO', 'GU', 'ZARA', 'H&M', 'しまむら', 'ワークマン'], category: 'clothes', sub: '衣服' },
  { type: 'expense', words: ['美容室', '美容院', 'ヘアサロン', '理容', 'QBハウス'], category: 'clothes', sub: '美容院・理髪' },

  // ---- 健康 ----
  { type: 'expense', words: ['病院', 'クリニック', '医院', '歯科', '薬局'], category: 'health', sub: '病院・薬' },
  { type: 'expense', words: ['ジム', 'フィットネス', 'エニタイム', 'チョコザップ'], category: 'health', sub: 'フィットネス' },

  // ---- 水道・光熱費 ----
  { type: 'expense', words: ['電力', '電気', 'でんき', 'TEPCO'], category: 'utility', sub: '電気代' },
  { type: 'expense', words: ['ガス'], category: 'utility', sub: 'ガス・灯油代' },
  { type: 'expense', words: ['水道'], category: 'utility', sub: '水道代' },

  // ---- 通信費 ----
  { type: 'expense', words: ['ドコモ', 'DOCOMO', 'AU ', 'KDDI', 'ソフトバンク', 'SOFTBANK', '楽天モバイル', 'AHAMO', 'POVO', 'LINEMO', 'UQ', 'ワイモバイル', 'Y!MOBILE', '携帯'], category: 'phone', sub: '携帯電話' },
  { type: 'expense', words: ['NTT', 'フレッツ', 'NURO', '光回線', 'プロバイダ', 'BIGLOBE', 'SO-NET'], category: 'phone', sub: 'インターネット' },
  { type: 'expense', words: ['NHK'], category: 'phone', sub: '放送視聴料' },

  // ---- 住宅・保険・税 ----
  { type: 'expense', words: ['家賃', '賃料'], category: 'housing', sub: '家賃・地代' },
  { type: 'expense', words: ['管理費', '修繕積立'], category: 'housing', sub: '管理費・積立金' },
  { type: 'expense', words: ['生命保険', '生命', '共済', '損保', '保険料'], category: 'insurance', sub: '生命保険' },
  { type: 'expense', words: ['住民税', '所得税', '固定資産税', '自動車税'], category: 'tax', sub: '所得税・住民税' },
  { type: 'expense', words: ['国民年金'], category: 'tax', sub: '年金保険料' },
  { type: 'expense', words: ['国民健康保険'], category: 'tax', sub: '健康保険' },

  // ---- その他 ----
  { type: 'expense', words: ['手数料'], category: 'other', sub: 'カード手数料' },
];
