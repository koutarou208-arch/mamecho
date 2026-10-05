/* ===========================================================
   03-helpers.js  ―  あちこちで使う「小さな道具」
   -----------------------------------------------------------
   金額を「¥1,234」の形にする、日付を計算する、など
   どの画面でも使う短い関数を集めています。
   どれも「何かを受け取って、結果を返すだけ」の単純な関数です。
   =========================================================== */


/* ===========================================================
   1. 画面の部品を探す
   =========================================================== */

/** 画面から部品を1つ探す。例: findOne('#screen') */
function findOne(selector, parent = document) {
  return parent.querySelector(selector);
}

/** 画面から部品をまとめて探す（配列で返す） */
function findAll(selector, parent = document) {
  return Array.from(parent.querySelectorAll(selector));
}

/**
 * 文字を安全に画面へ出すための変換。
 * 「<」などの記号をそのまま画面に書くと、HTMLの命令だと勘違いされて
 * 表示が壊れたり危険なことが起きたりします。それを防ぎます。
 * ユーザーが入力した文字やCSVの文字を画面に出すときは必ず通すこと。
 */
function escapeHtml(text) {
  const value = String(text === undefined || text === null ? '' : text);
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** だれとも重ならない番号（ID）を作る。入出金や口座に1つずつ付ける */
function makeId() {
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 8);
  return timePart + randomPart;
}


/* ===========================================================
   2. 金額
   =========================================================== */

const NUMBER_FORMAT = new Intl.NumberFormat('ja-JP');

/** 1234567 → "1,234,567" */
function formatNumber(number) {
  return NUMBER_FORMAT.format(Math.round(number));
}

/**
 * 金額を「¥1,234」の形にする。
 * マイナスは「−¥1,234」。showPlus: true にするとプラスに「+」を付ける。
 */
function formatYen(amount, options = {}) {
  const rounded = Math.round(amount);
  const body = '¥' + formatNumber(Math.abs(rounded));
  if (rounded < 0) {
    return '−' + body;
  }
  if (options.showPlus && rounded > 0) {
    return '+' + body;
  }
  return body;
}

/** グラフの目盛り用の短い金額。2500000 → "250万"、120000000 → "1.2億" */
function formatYenShort(amount) {
  const sign = amount < 0 ? '−' : '';
  const absolute = Math.abs(amount);
  if (absolute >= 100000000) {
    return sign + Number((absolute / 100000000).toFixed(2)) + '億';
  }
  if (absolute >= 10000) {
    return sign + formatNumber(Number((absolute / 10000).toFixed(1))) + '万';
  }
  return sign + formatNumber(absolute);
}

/**
 * スマホのカレンダーの小さいマス用の、短い金額（0円は空）。
 *   980 → "980"、1262 → "1.3千"、13870 → "1.4万"
 * （パソコンでは、ふつうの金額をそのまま出す）
 */
function calendarAmountShort(amount) {
  if (!amount) {
    return '';
  }
  if (amount >= 10000) {
    return (Math.round(amount / 1000) / 10) + '万';
  }
  if (amount >= 1000) {
    return (Math.round(amount / 100) / 10) + '千';
  }
  return String(Math.round(amount));
}

/**
 * 金額の入力欄の文字を数字にする（かんたんな電卓つき）。
 *   "1,200"     → 1200
 *   "1200+380"  → 1580
 *   ""          → null（何も入っていない）
 *   "abc"       → NaN（読めない）
 * 使える記号: + - * / ( )   全角の数字や「×」「÷」もOK
 */
function calculateAmount(text) {
  let source = String(text || '').normalize('NFKC');
  source = source.replace(/[,¥円\s]/g, '');
  source = source.replace(/[×xX]/g, '*').replace(/÷/g, '/').replace(/[−ー–]/g, '-');
  if (source === '') {
    return null;
  }
  if (!/^[-+*/().\d]+$/.test(source)) {
    return NaN;
  }

  // ここから下は「足し算・引き算より先に掛け算・割り算」をするための読み取り処理
  let position = 0;

  function readNumber() {
    const char = source[position];
    if (char === '(') {
      position = position + 1;
      const value = readSum();
      if (source[position] !== ')') {
        throw new Error('カッコが閉じていません');
      }
      position = position + 1;
      return value;
    }
    if (char === '-') {
      position = position + 1;
      return -readNumber();
    }
    if (char === '+') {
      position = position + 1;
      return readNumber();
    }
    const match = /^\d+(\.\d+)?/.exec(source.slice(position));
    if (!match) {
      throw new Error('数字がありません');
    }
    position = position + match[0].length;
    return parseFloat(match[0]);
  }

  function readProduct() {
    let value = readNumber();
    while (source[position] === '*' || source[position] === '/') {
      const operator = source[position];
      position = position + 1;
      const right = readNumber();
      if (operator === '*') {
        value = value * right;
      } else {
        value = value / right;
      }
    }
    return value;
  }

  function readSum() {
    let value = readProduct();
    while (source[position] === '+' || source[position] === '-') {
      const operator = source[position];
      position = position + 1;
      const right = readProduct();
      if (operator === '+') {
        value = value + right;
      } else {
        value = value - right;
      }
    }
    return value;
  }

  try {
    const result = readSum();
    if (position !== source.length || !Number.isFinite(result)) {
      return NaN;
    }
    return Math.round(result);
  } catch (error) {
    return NaN;
  }
}

/**
 * 金額の入力欄に、打ちながら3けたごとのカンマを入れる（「300000」→「300,000」）。
 *   text  … 入力欄の今の文字
 *   caret … カーソルの位置（何文字目のうしろにあるか）
 * 返す値: { text: カンマを入れた文字, caret: カンマを入れたあとのカーソルの位置 }
 * 数字とカンマだけのときに整える（「30万」や「1200+380」のような書き方はそのまま返す）。
 */
function formatDigitsWithCommas(text, caret) {
  const normalized = String(text).normalize('NFKC'); // 全角の数字を半角にする（1文字は1文字のまま）
  if (!/^[\d,]*$/.test(normalized)) {
    return { text: text, caret: caret };
  }
  // カーソルより左にある数字の数を数えておく
  let digitsBeforeCaret = 0;
  for (let index = 0; index < caret && index < normalized.length; index++) {
    if (normalized[index] !== ',') {
      digitsBeforeCaret = digitsBeforeCaret + 1;
    }
  }
  const digits = normalized.replace(/,/g, '');
  const formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // 同じ数の数字のうしろに、カーソルを戻す
  let newCaret = 0;
  let digitsSeen = 0;
  while (newCaret < formatted.length && digitsSeen < digitsBeforeCaret) {
    if (formatted[newCaret] !== ',') {
      digitsSeen = digitsSeen + 1;
    }
    newCaret = newCaret + 1;
  }
  return { text: formatted, caret: newCaret };
}

/**
 * データを消す前の確認: 「削除」（ひらがなの「さくじょ」でもよい）と入力されているか。
 * 指が当たっただけでは消えないように、消すボタンはこれが true のときだけ押せるようにする。
 */
function isDeleteWordTyped(text) {
  const word = String(text || '').normalize('NFKC').trim();
  return word === '削除' || word === 'さくじょ';
}

/** 端末で「視差効果を減らす（動きを減らす）」が選ばれているか。true ならアニメーションをしない */
function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 数の並びの「真ん中の値」（中央値）。極端な値に引っぱられにくい平均 */
function median(numbers) {
  if (numbers.length === 0) {
    return 0;
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}


/* ===========================================================
   3. 文字
   =========================================================== */

/**
 * 比べやすい形に文字をそろえる。
 * 全角英数字→半角、半角カナ→全角、英字→大文字、空白をまとめる。
 * 例: "ｾﾌﾞﾝ－ｲﾚﾌﾞﾝ" と "セブン-イレブン" を同じものとして扱うため。
 */
function normalizeText(text) {
  return String(text || '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}


/* ===========================================================
   4. 日付
   このアプリでは、日付を "2026-10-03" という文字で扱います。
   この形だと、文字のまま大小を比べられて便利だからです。
   （"2026-09-30" < "2026-10-01" が正しく判定できる）
   =========================================================== */

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

/** 1 → "01" のように2けたにする */
function pad2(number) {
  return String(number).padStart(2, '0');
}

/** Date（JavaScriptの日付）→ "2026-10-03" */
function dateToText(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

/** "2026-10-03" → Date */
function textToDate(text) {
  const parts = text.split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

/** 今日の日付（"2026-10-03"） */
function todayText() {
  return dateToText(new Date());
}

/** "2026-10-03" の形で、実際にある日付なら true */
function isValidDateText(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(text || ''))) {
    return false;
  }
  return dateToText(textToDate(text)) === text;
}

/** 日付を何日か進める（マイナスで戻す） */
function addDays(text, days) {
  const date = textToDate(text);
  date.setDate(date.getDate() + days);
  return dateToText(date);
}

/** 2つの日付の間が何日あるか（b − a） */
function daysBetween(textA, textB) {
  const milliseconds = textToDate(textB) - textToDate(textA);
  return Math.round(milliseconds / 86400000);
}

/** その月が何日まであるか。例: 2026年2月 → 28 */
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** 年と月から "2026-10" を作る */
function makeMonthText(year, month) {
  return year + '-' + pad2(month);
}

/** "2026-10" を何か月か進める。例: ("2026-11", 3) → "2027-02" */
function addMonths(monthText, count) {
  const parts = monthText.split('-');
  const total = Number(parts[0]) * 12 + (Number(parts[1]) - 1) + count;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return makeMonthText(year, month);
}

/** "2026-10" と "2027-01" の間が何か月あるか（b − a） */
function monthsBetween(monthTextA, monthTextB) {
  const a = monthTextA.split('-').map(Number);
  const b = monthTextB.split('-').map(Number);
  return (b[0] * 12 + b[1]) - (a[0] * 12 + a[1]);
}

/**
 * ある月の「○日」の日付を作る。31 は「月末」の意味。
 * その月にない日（2月30日など）は月末にそろえる。
 */
function dayInMonthText(monthText, day) {
  const parts = monthText.split('-').map(Number);
  const lastDay = daysInMonth(parts[0], parts[1]);
  const safeDay = Math.min(day, lastDay);
  return monthText + '-' + pad2(safeDay);
}

/** "2026-09-14" → "9月14日(月)" */
function formatMonthDay(text) {
  const date = textToDate(text);
  return (date.getMonth() + 1) + '月' + date.getDate() + '日(' + WEEKDAY_NAMES[date.getDay()] + ')';
}

/** "2026-09-14" → "9/14" */
function formatShortDate(text) {
  const date = textToDate(text);
  return (date.getMonth() + 1) + '/' + date.getDate();
}

/** "2026-10" → "2026年10月" */
function formatMonthText(monthText) {
  const parts = monthText.split('-').map(Number);
  return parts[0] + '年' + parts[1] + '月';
}

/**
 * 通帳ふうの和暦。 "2026-09-14" → "R8.09.14"
 * （令和は2019年5月から。それより前は平成）
 */
function toWarekiText(text) {
  const parts = text.split('-').map(Number);
  if (text >= '2019-05-01') {
    return 'R' + (parts[0] - 2018) + '.' + pad2(parts[1]) + '.' + pad2(parts[2]);
  }
  return 'H' + (parts[0] - 1988) + '.' + pad2(parts[1]) + '.' + pad2(parts[2]);
}


/* ===========================================================
   5. 画面のちょっとした表示
   =========================================================== */

let toastTimer = null;

/** 画面の下に短いお知らせを2.6秒だけ出す（例: 「保存しました」） */
function showToast(message) {
  const toast = findOne('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

/**
 * 指を横にすべらせた動きから、期間を動かす向きを決める。
 *   dx … 横にどれだけ動いたか（右が＋）  dy … 縦にどれだけ動いたか
 * 返す値: -1（前の期間へ） / 1（次の期間へ） / 0（何もしない）
 * 短い動きや、縦のほうが大きい動き（ふつうの上下スクロール）は 0 にします。
 */
function swipeStepOf(dx, dy) {
  const minimumDistance = 60;
  if (Math.abs(dx) < minimumDistance) {
    return 0;
  }
  if (Math.abs(dx) < Math.abs(dy) * 1.5) {
    return 0;
  }
  return dx > 0 ? -1 : 1;
}

/**
 * アイコン（小さな絵）のSVGを返す。
 * 線だけで描いた24×24の絵で、色は文字の色に合わせて変わります。
 */
const ICON_PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  book: '<path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z"/><path d="M4 17a3 3 0 0 1 3-3h11"/><path d="M8 8h6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  wallet: '<path d="M4 7.5V18a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2 2 2 0 0 1 2-2h12v4"/><path d="M16 14.5h.01"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  face: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9v1.5M15 9v1.5M12 9v4h-1M9.5 15.5c1.4 1.1 3.6 1.1 5 0"/>',
  calc: '<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M8.5 6.5h7"/><path d="M9 11h.01M12 11h.01M15 11h.01M9 14.5h.01M12 14.5h.01M15 14.5h.01M9 18h.01M12 18h.01M15 18h.01"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  warn: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  over: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m6 6 2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
};

function iconSvg(name) {
  const path = ICON_PATHS[name] || '';
  return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>';
}
