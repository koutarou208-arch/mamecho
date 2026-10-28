/* ===========================================================
   tests/security-check.js  ―  安全の見張り（「5重の扉」の扉1と扉5）
   -----------------------------------------------------------
   run.sh から、ほかのテストの前に呼ばれます。
   アプリのファイルの「文字」を読んで、次のことを確かめます（アプリのプログラムは動かしません）。

     扉1「外へ送れない」
       A. index.html の「安全のための約束」（CSP）が、決めたとおりのままか
       B. index.html が読み込むものが、すべて自分のサイトのファイルか
       C. そのプログラムに、外と通信する・ほかのページへ移る・文字をプログラムとして動かす部品がないか
       D. sw.js（電波がなくても開けるようにする係）が、自分のサイトのファイルしか取りに行かないか
     扉5「すり替えさせない」
       E. 毎月自動で書きかえる js/02-card-companies.js が「データだけ」か
          （更新の係が、ページの中の悪い指示にだまされてプログラムを書き足しても、ここで止まる）
       F. CSV を読む部品（PapaParse）が、入れたときのままか（指紋をくらべる）

   1つでも見つかったら、理由を表示して不合格（終了コード 1）にします。
   node でも、Mac の jsc でも動きます。
   =========================================================== */

// node で動かすときの print の代役（jsc には最初から print がある）
if (typeof print === 'undefined') { var print = function (text) { console.log(text); }; }

/* ---------- 決めたとおりの値（変えるときは、理由を説明して許可を取ってから） ---------- */

// index.html の「安全のための約束」（CSP）。自分のサイト以外と通信しない・よそのプログラムを読まない
const EXPECTED_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'";

// CSV を読む部品（js/vendor/papaparse.min.js）の指紋。新しい版に入れかえるときだけ書きかえる
// （PapaParse 5.7.0。npm で配られているものと同じ中身であることを確かめた: sha256 4d5d2d6e…cfac33e）
const PAPAPARSE_FINGERPRINT = 'd41b5303-18874';

// アプリのプログラムに入っていてはいけない部品（見つかったら不合格）
const FORBIDDEN_IN_APP = [
  { pattern: /(^|[^\w$])fetch\s*\(/, why: 'fetch（外と通信する道具）' },
  { pattern: /XMLHttpRequest/, why: 'XMLHttpRequest（外と通信する道具）' },
  { pattern: /WebSocket/, why: 'WebSocket（外と通信する道具）' },
  { pattern: /sendBeacon/, why: 'sendBeacon（外へこっそり送る道具）' },
  { pattern: /EventSource/, why: 'EventSource（外と通信する道具）' },
  { pattern: /RTCPeerConnection/, why: 'RTCPeerConnection（外と通信する道具）' },
  { pattern: /importScripts|(^|[^\w$])import\s*\(/, why: 'あとからプログラムを読み込む' },
  { pattern: /(^|[^\w$.])eval\s*\(|new\s+Function|set(Timeout|Interval)\s*\(\s*['"`]/, why: '文字をプログラムとして動かす' },
  { pattern: /window\.open\s*\(|(^|[^\w$.])open\s*\(/, why: '新しいページを開く（URL に中身をのせて送れてしまう）' },
  { pattern: /location(\.href)?\s*=(?!=)|location\.(assign|replace)\s*\(/, why: 'ほかのページへ移る（URL に中身をのせて送れてしまう）' },
  { pattern: /document\.write|document\.cookie|\.postMessage\s*\(/, why: 'document.write / cookie / postMessage' },
];


/* ---------- 道具 ---------- */

const problems = [];

/** 問題を1つ記録する */
function reportProblem(text) {
  problems.push(text);
}

/** ファイルの中身を文字として読む（node と jsc で読み方がちがう） */
function readText(path) {
  if (typeof require === 'function') {
    return require('fs').readFileSync(path, 'utf8');
  }
  return readFile(path);
}

/** 文字の何文字目が何行目か */
function lineNumberAt(text, position) {
  return text.slice(0, position).split('\n').length;
}

/**
 * 文字の「指紋」（FNV-1a という計算）。1文字でも変わると、ちがう値になる。
 * 長さも付けておく（例: "1a2b3c4d-19520"）
 */
function fingerprintOf(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash = hash ^ text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16) + '-' + text.length;
}


/* ---------- A・B. index.html ---------- */

/** index.html を調べて、読み込んでいるプログラム（js）の一覧を返す */
function checkIndexHtml() {
  const html = readText('index.html');

  // A. 安全のための約束（CSP）
  const cspMatch = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  if (!cspMatch) {
    reportProblem('index.html に「安全のための約束」（Content-Security-Policy）がありません');
  } else if (cspMatch[1] !== EXPECTED_CSP) {
    reportProblem('index.html の「安全のための約束」（Content-Security-Policy）が変わっています: ' + cspMatch[1]);
  }
  if (html.indexOf('<meta name="referrer" content="no-referrer">') < 0) {
    reportProblem('index.html に <meta name="referrer" content="no-referrer"> がありません');
  }

  // B. プログラムは、すべて自分のサイトの js ファイル（ページの中に直接プログラムを書かない）
  const scriptFiles = [];
  const scriptTags = html.match(/<script\b[^>]*>/g) || [];
  for (const tag of scriptTags) {
    const fileMatch = tag.match(/^<script src="(js\/[\w./-]+\.js)">$/);
    if (!fileMatch) {
      reportProblem('index.html に、自分のサイトの js ファイルではないプログラムがあります: ' + tag);
      continue;
    }
    if (html.indexOf(tag + '</script>') < 0) {
      reportProblem('index.html の ' + tag + ' の中に、プログラムが直接書かれています');
    }
    scriptFiles.push(fileMatch[1]);
  }
  // 見た目のファイルなど（link）も、自分のサイトのものだけ
  const linkTags = html.match(/<link\b[^>]*>/g) || [];
  for (const tag of linkTags) {
    if (/href="[^"]*\/\//.test(tag)) {
      reportProblem('index.html が、よそのサイトのファイルを読み込んでいます: ' + tag);
    }
  }
  // ほかのページをはめこむ部品は使わない（form は使うが、CSP の form-action 'none' でどこへも送れない）
  const embedMatch = html.match(/<(iframe|frame|object|embed|base)\b/i);
  if (embedMatch) {
    reportProblem('index.html に <' + embedMatch[1] + '> があります（このアプリでは使いません）');
  }
  return scriptFiles;
}


/* ---------- C. アプリのプログラム ---------- */

function checkAppScripts(scriptFiles) {
  for (const path of scriptFiles) {
    const text = readText(path);
    if (path === 'js/vendor/papaparse.min.js') {
      // F. 外から持ってきた部品は、中身を読むかわりに「入れたときのままか」を指紋でくらべる
      //    （PapaParse には、ネットから CSV を取ってくる機能があるが、このアプリでは使わない。CSP でも止まる）
      const fingerprint = fingerprintOf(text);
      if (fingerprint !== PAPAPARSE_FINGERPRINT) {
        reportProblem('CSV を読む部品（' + path + '）の中身が変わっています（指紋 ' + fingerprint + '）');
      }
      continue;
    }
    if (path.indexOf('js/vendor/') === 0) {
      reportProblem('知らない外部の部品があります: ' + path + '（足すときは理由を説明して許可を取る）');
      continue;
    }
    checkForbidden(path, text);
  }
}

/** 入っていてはいけない部品を探す */
function checkForbidden(path, text) {
  for (const rule of FORBIDDEN_IN_APP) {
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index++) {
      if (rule.pattern.test(lines[index])) {
        reportProblem(path + ' の ' + (index + 1) + '行目に「' + rule.why + '」があります: ' + lines[index].trim());
      }
    }
  }
}


/* ---------- D. sw.js ---------- */

function checkServiceWorker() {
  const text = readText('sw.js');
  // 自分のサイト以外へのお願いには、手を出さない
  if (!/if \(url\.origin !== self\.location\.origin\) \{\s*return;\s*\}/.test(text)) {
    reportProblem('sw.js に「自分のサイトのファイルだけ扱う」の行がありません');
  }
  // 取りに行く（fetch）のは、ページが頼んだファイルを1か所だけ
  const fetchCount = (text.match(/(^|[^\w$])fetch\s*\(/g) || []).length;
  if (fetchCount !== 1) {
    reportProblem('sw.js でファイルを取りに行く（fetch）ところが ' + fetchCount + ' か所あります（1か所のはず）');
  }
  const otherRules = FORBIDDEN_IN_APP.filter((rule) => rule.why.indexOf('fetch（') !== 0);
  for (const rule of otherRules) {
    if (rule.pattern.test(text)) {
      reportProblem('sw.js に「' + rule.why + '」があります');
    }
  }
}


/* ---------- E. js/02-card-companies.js は「データだけ」 ---------- */

/**
 * 02 の文字を「字句」（ことばの最小の単位）に分ける。
 * 使えない文字があったら、その場所で止めて問題を返す。
 * 戻り値: { tokens: [{ kind, text, line }], problem: '' }
 */
function tokenizeCardData(text) {
  // 上から順に: 空白、/* コメント */、// コメント、'文字'、"文字"、数字、名前、記号
  const tokenPattern = /(\s+)|(\/\*[\s\S]*?\*\/)|(\/\/[^\n]*)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|(-?\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([{}[\]:,;=])/y;
  const tokens = [];
  let position = 0;
  while (position < text.length) {
    tokenPattern.lastIndex = position;
    const match = tokenPattern.exec(text);
    if (!match) {
      return { tokens: tokens, problem: lineNumberAt(text, position) + '行目に、データでは使わない文字「' + text.slice(position, position + 10) + '」があります' };
    }
    const line = lineNumberAt(text, position);
    if (match[4] !== undefined) {
      tokens.push({ kind: 'string', text: match[4], line: line });
    } else if (match[5] !== undefined) {
      tokens.push({ kind: 'number', text: match[5], line: line });
    } else if (match[6] !== undefined) {
      tokens.push({ kind: 'name', text: match[6], line: line });
    } else if (match[7] !== undefined) {
      tokens.push({ kind: 'mark', text: match[7], line: line });
    }
    // 空白とコメントは読み飛ばす
    position = tokenPattern.lastIndex;
  }
  return { tokens: tokens, problem: '' };
}

/**
 * 02 の文字が「データだけ」かを調べる。問題があればその理由の文、なければ ''。
 *
 * 書いてよいのは、次の形だけ:
 *   const 大文字の名前 = 値;
 *   値 … '文字' / 数字 / true / false / null / [値, 値, …] / { 名前: 値, … }
 *        このファイルで先に作った大文字の名前（ALWAYS など）
 * それ以外（function、=>、( )、+、` など）が1つでもあれば「データではない」とみなす。
 */
function cardDataProblem(text) {
  const result = tokenizeCardData(text);
  if (result.problem) {
    return result.problem;
  }
  const tokens = result.tokens;
  const knownNames = [];
  let index = 0;

  /** 次の字句が、決まった記号やことばかを確かめて、1つ進む */
  function expect(kind, wantedText, what) {
    const token = tokens[index];
    if (!token || token.kind !== kind || (wantedText !== null && token.text !== wantedText)) {
      throw new Error((token ? token.line + '行目' : '最後') + 'で「' + what + '」のはずが「' + (token ? token.text : '（終わり）') + '」になっています');
    }
    index = index + 1;
    return token;
  }

  /** 値を1つ読む */
  function readValue() {
    const token = tokens[index];
    if (!token) {
      throw new Error('値の途中でファイルが終わっています');
    }
    if (token.kind === 'string' || token.kind === 'number') {
      index = index + 1;
      return;
    }
    if (token.kind === 'name') {
      if (token.text === 'true' || token.text === 'false' || token.text === 'null' || knownNames.indexOf(token.text) >= 0) {
        index = index + 1;
        return;
      }
      throw new Error(token.line + '行目の「' + token.text + '」は、データとして使えない名前です');
    }
    if (token.text === '[') {
      readList();
      return;
    }
    if (token.text === '{') {
      readObject();
      return;
    }
    throw new Error(token.line + '行目に、値のかわりに「' + token.text + '」があります');
  }

  /** [値, 値, …] を読む（最後の , はあってもよい） */
  function readList() {
    expect('mark', '[', '[');
    while (tokens[index] && tokens[index].text !== ']') {
      readValue();
      if (tokens[index] && tokens[index].text === ',') {
        index = index + 1;
      } else {
        break;
      }
    }
    expect('mark', ']', ']');
  }

  /** { 名前: 値, … } を読む（最後の , はあってもよい） */
  function readObject() {
    expect('mark', '{', '{');
    while (tokens[index] && tokens[index].text !== '}') {
      const key = tokens[index];
      if (!key || (key.kind !== 'name' && key.kind !== 'string' && key.kind !== 'number')) {
        throw new Error((key ? key.line + '行目' : '最後') + 'で、項目の名前のかわりに「' + (key ? key.text : '（終わり）') + '」があります');
      }
      index = index + 1;
      expect('mark', ':', ':');
      readValue();
      if (tokens[index] && tokens[index].text === ',') {
        index = index + 1;
      } else {
        break;
      }
    }
    expect('mark', '}', '}');
  }

  try {
    while (index < tokens.length) {
      expect('name', 'const', 'const');
      const name = expect('name', null, '名前');
      if (!/^[A-Z][A-Z0-9_]*$/.test(name.text)) {
        throw new Error(name.line + '行目の名前「' + name.text + '」は、大文字と _ だけで書いてください');
      }
      expect('mark', '=', '=');
      readValue();
      expect('mark', ';', ';');
      knownNames.push(name.text);
    }
  } catch (error) {
    return error.message;
  }
  return '';
}

function checkCardData() {
  const problem = cardDataProblem(readText('js/02-card-companies.js'));
  if (problem) {
    reportProblem('js/02-card-companies.js はデータだけのファイルです。' + problem);
  }
}


/* ---------- E のしくみ自体を確かめる（悪い例を本当に止められるか） ---------- */

function checkCardDataChecker() {
  const goodExamples = [
    "const A = { id: 'jcb', rate: 15.0, list: [1, 2,], ok: true, none: null, };\nconst B = [{ from: A, 3: 14.7, 'x': -1 }];",
    '/* コメント */ // コメント\nconst NOTE = "a\\"b";',
  ];
  const badExamples = [
    "const A = fetch('https://example.com');",
    "const A = { id: 'x' + location.href };",
    "const A = (() => 1)();",
    "function A() {}",
    "const A = { get rate() { return 1; } };",
    "const A = `${1}`;",
    "const A = [][\"con\" + \"structor\"];",
    "const A = { rate: B };",
    "const a = 1;",
    "const A = 1;\nopen('x');",
    "const A = 1",
  ];
  for (const example of goodExamples) {
    const problem = cardDataProblem(example);
    if (problem) {
      reportProblem('データの見張りが、正しいデータを止めてしまいます: ' + problem + ' … ' + example);
    }
  }
  for (const example of badExamples) {
    if (!cardDataProblem(example)) {
      reportProblem('データの見張りが、データではないものを通してしまいます: ' + example);
    }
  }
}


/* ---------- 実行 ---------- */

const scriptFiles = checkIndexHtml();
checkAppScripts(scriptFiles);
checkServiceWorker();
checkCardData();
checkCardDataChecker();

if (problems.length > 0) {
  print('【安全チェック】' + problems.length + ' 件の問題があります');
  for (const problem of problems) {
    print('  ・' + problem);
  }
  if (typeof quit === 'function') {
    quit(1);
  } else if (typeof process !== 'undefined') {
    process.exit(1);
  }
} else {
  print('【安全チェック】外へ送る部品なし・約束（CSP）どおり・02 はデータだけ・PapaParse は元のまま（' + scriptFiles.length + ' ファイル）');
}
