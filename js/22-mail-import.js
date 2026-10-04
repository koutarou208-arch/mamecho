/* ===========================================================
   22-mail-import.js  ―  Gmail に届いたカードの利用メールを、自動で記録する
   -----------------------------------------------------------
   しくみ（3人の登場人物）:

     ① Gmail …………… JCB から「ショッピングご利用のお知らせ」が届く
     ② メール取り込み係 … あなたの Google アカウントの中で動く小さなプログラム
                            （Google Apps Script）。合言葉を知っている相手にだけ、
                            利用通知メールの「ご利用日時・ご利用金額・ご利用先・カード名称」の
                            行だけを渡す。ほかのメールは読まない。
     ③ まめ帳（このアプリ）… 開いたとき（と、画面に戻ってきたとき）に②に問い合わせて、
                            新しく届いた分を入出金として記録する。

   ・このアプリにはサーバーがないので、②を自分の Google アカウントに1回だけ置いてもらいます。
     ②のプログラムは、設定画面の「スクリプトをコピー」で、合言葉が入った状態でコピーできます。
   ・メールの文章の読み取りは、05-calculations.js の parseCardNoticeEmail（貼り付けと同じもの）。
   ・設定は appState.profile.settings.mailImport に保存します（暗号化ロック中は暗号化されます）。
   =========================================================== */


/* ===========================================================
   1. メール取り込み係（Google Apps Script）のプログラム
   =========================================================== */

// String.raw は、「\」をそのまま残すための書き方（スクリプトの中の \r や \n を壊さないため）
// __KEY__ のところに、アプリが作った合言葉が入ります。
const MAIL_SCRIPT_TEMPLATE = String.raw`/**
 * まめ帳 メール取り込み係（Google Apps Script）
 * ------------------------------------------------------------
 * Gmail に届いたカードの「ご利用のお知らせ」メールから、
 * 「ご利用日時」「ご利用金額」「ご利用先」「カード名称」の行だけを取り出して、まめ帳アプリに渡します。
 * ・合言葉（KEY）が合わない問い合わせには、何も返しません。
 * ・読むのは SEARCH に合うメールだけです。ほかのメールは読みません。
 * ・止めたいときは、右上の「デプロイ」→「デプロイを管理」で、このデプロイを「アーカイブ」してください。
 */

const KEY = '__KEY__';
const SEARCH = 'from:mail@qa.jcb.co.jp subject:ご利用のお知らせ newer_than:60d';
const LINE_PATTERN = /(利用日|利用金額|利用先|カード名称)/;

function doGet(e) {
  const params = (e && e.parameter) || {};
  // 合言葉が短すぎる・合わない問い合わせには、メールを読まずに断る
  if (KEY.length < 16 || params.key !== KEY) {
    return reply({ ok: false, error: 'bad_key' });
  }
  try {
    const since = Number(params.since) || 0;
    const items = [];
    const threads = GmailApp.search(SEARCH, 0, 50);
    for (const thread of threads) {
      for (const message of thread.getMessages()) {
        const receivedAt = message.getDate().getTime();
        if (receivedAt <= since) {
          continue;
        }
        const lines = message.getPlainBody().split(/\r?\n/).filter((line) => LINE_PATTERN.test(line));
        if (lines.length > 0) {
          items.push({ id: message.getId(), receivedAt: receivedAt, text: lines.join('\n').slice(0, 1000) });
        }
      }
    }
    items.sort((a, b) => a.receivedAt - b.receivedAt);
    return reply({ ok: true, items: items.slice(0, 200) });
  } catch (error) {
    // 失敗したときも、エラーの中身（メールの文が入るかもしれない）は返さない
    return reply({ ok: false, error: 'server_error' });
  }
}

function reply(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// 最初に1回だけ「実行」して、Gmail を読む許可を出すための関数
function test() {
  const threads = GmailApp.search(SEARCH, 0, 10);
  Logger.log('見つかったメール: ' + threads.length + '件');
}
`;

/** 合言葉の入ったスクリプトを作る */
function buildMailScript(key) {
  return MAIL_SCRIPT_TEMPLATE.replace('__KEY__', key);
}

/** だれにも当てられない合言葉（英数字32文字）を作る */
function makeMailKey() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const numbers = new Uint32Array(32);
  crypto.getRandomValues(numbers);
  let key = '';
  for (const number of numbers) {
    key = key + letters[number % letters.length];
  }
  return key;
}


/* ===========================================================
   2. 小さな計算（テストあり）
   =========================================================== */

/** Google のウェブアプリの URL（…/exec で終わる）なら true */
function isValidMailScriptUrl(url) {
  return /^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(String(url || '').trim());
}

/** 取り込み係への問い合わせの URL（since より後に届いたメールだけをもらう） */
function mailImportUrl(baseUrl, key, since) {
  return baseUrl + '?key=' + encodeURIComponent(key) + '&since=' + Number(since || 0);
}

/**
 * 取り込み係から届いた1通分を、入出金1件にする。記録しないもの（お支払いのお知らせなど）は null。
 *   item             … { id, receivedAt, text }
 *   accounts         … 口座の一覧
 *   defaultAccountId … カード名から口座が決まらなかったときに使う口座
 *   today            … 今日の日付（メールに日付がなかったときに使う）
 *   guess            … お店の名前から推測したカテゴリ { category, sub }（なければ null）
 */
function mailItemToTransaction(item, accounts, defaultAccountId, today, guess) {
  const text = String((item && item.text) || '');
  if (!/(利用金額|利用額)/.test(text.normalize('NFKC'))) {
    return null; // 「ご利用金額」がないメールは、カードを使った知らせではない
  }
  const notice = parseCardNoticeEmail(text, today);
  if (!notice) {
    return null;
  }
  let account = findCardAccountForNotice(notice.cardName, accounts);
  if (!account) {
    account = accounts.find((candidate) => candidate.id === defaultAccountId) || null;
  }
  if (!account) {
    return null;
  }
  const transaction = {
    id: 'mail-' + item.id,
    date: notice.date,
    type: 'expense',
    amount: notice.amount,
    account: account.id,
    category: guess ? guess.category : 'other',
    sub: guess ? guess.sub : '未分類',
    description: (notice.merchant || 'カードの利用').slice(0, 60),
    memo: 'カード利用メールから自動で記録',
    include: true,
    createdAt: Date.now(),
    fromMail: true,
  };
  if (account.kind === 'card') {
    transaction.payMethod = 'once';
  }
  return transaction;
}

/** もう同じ記録があるか（同じID、または同じ日・同じ金額・同じお店の支出） */
function isDuplicateMailTransaction(transaction, existingItems) {
  for (const item of existingItems) {
    if (item.id === transaction.id) {
      return true;
    }
    if (item.type === 'expense' && item.date === transaction.date && item.amount === transaction.amount &&
        normalizeText(item.description) === normalizeText(transaction.description)) {
      return true;
    }
  }
  return false;
}

/** 「どこまで取り込んだか」の目印を進める（いちばん新しいメールの時刻と、取り込んだメールのID 300件） */
function updateMailCursor(state, items) {
  let lastReceivedAt = Number(state.lastReceivedAt) || 0;
  const importedIds = (state.importedIds || []).slice();
  for (const item of items) {
    if (item.receivedAt > lastReceivedAt) {
      lastReceivedAt = item.receivedAt;
    }
    if (!importedIds.includes(item.id)) {
      importedIds.push(item.id);
    }
  }
  return { lastReceivedAt: lastReceivedAt, importedIds: importedIds.slice(-300) };
}


/* ===========================================================
   3. 設定の読み書き
   =========================================================== */

// 画面だけで使う状態（保存しない）
const mailImportState = {
  running: false,          // 問い合わせ中
  lastTriedAt: 0,          // 最後に問い合わせた時刻
  message: '',             // 設定画面に出す、最後の結果
  disconnectConfirm: false, // 「接続を解除」の確認を出しているか
};

/** メール取り込みの設定（足りない項目は補う） */
function mailImportSettings() {
  const settings = appState.profile.settings;
  if (!settings.mailImport) {
    settings.mailImport = {};
  }
  const config = settings.mailImport;
  config.url = config.url || '';
  config.key = config.key || '';
  config.account = config.account || '';
  config.lastReceivedAt = Number(config.lastReceivedAt) || 0;
  config.importedIds = Array.isArray(config.importedIds) ? config.importedIds : [];
  config.importedCount = Number(config.importedCount) || 0;
  return config;
}

/** カード名から口座が決まらないときの口座（決めていなければ、最初のカード → 最初の口座） */
function defaultMailAccountId() {
  const config = mailImportSettings();
  if (accountById[config.account]) {
    return config.account;
  }
  const accounts = appState.profile.accounts;
  const firstCard = accounts.find((account) => account.kind === 'card');
  if (firstCard) {
    return firstCard.id;
  }
  return accounts.length > 0 ? accounts[0].id : '';
}


/* ===========================================================
   4. 取り込む
   =========================================================== */

/** 取り込み係に問い合わせて、新しいメールの分を記録する（manual: 自分でボタンを押したとき） */
async function runMailImport(manual) {
  if (!appState.profile || appState.isSample || appState.locked) {
    if (manual) {
      showToast('サンプル表示中・ロック中は取り込めません');
    }
    return;
  }
  const config = mailImportSettings();
  if (!config.url || !config.key || mailImportState.running) {
    return;
  }

  mailImportState.running = true;
  mailImportState.lastTriedAt = Date.now();
  if (manual) {
    mailImportState.message = '確認しています…';
    renderApp();
  }

  try {
    // credentials: 'omit' … Google のログイン情報を送らない
    // referrerPolicy: 'no-referrer' … どのページから来たかを送らない
    // cache: 'no-store' … カードの利用の中身を、ブラウザのキャッシュ（端末の中の一時保存）に残さない
    const response = await fetch(mailImportUrl(config.url, config.key, config.lastReceivedAt), {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    const data = await response.json();
    if (!appState.profile || appState.isSample || appState.locked) {
      return; // 待っている間にロックされた・別のデータに変わった
    }
    if (!data || data.ok !== true) {
      if (data && data.error === 'bad_key') {
        mailImportState.message = '合言葉が合いません。「スクリプトをコピー」でコピーし直して、もう一度デプロイしてください。';
      } else if (data && data.error === 'server_error') {
        mailImportState.message = '取り込み係の中でエラーが起きました。Google の画面で「test」を実行して、許可が出ているか確かめてください。';
      } else {
        mailImportState.message = '取り込み係から、思っていない返事が来ました。';
      }
      return;
    }
    const added = addMailItems(Array.isArray(data.items) ? data.items : []);
    mailImportState.message = formatShortDate(todayText()) + ' ' + new Date().toTimeString().slice(0, 5) + ' に確認 · ' +
      (added > 0 ? added + '件 記録しました' : '新しいメールはありませんでした');
    if (added > 0) {
      showToast('カード利用メールから ' + added + '件 記録しました');
    } else if (manual) {
      showToast('新しいメールはありませんでした');
    }
  } catch (error) {
    mailImportState.message = 'つながりませんでした。URLを確かめてください（Claude の中で開いているときは使えません。アプリ版で使ってください）。';
  } finally {
    mailImportState.running = false;
    if (appState.screen === 'settings') {
      renderApp();
    }
  }
}

/** 届いたメールを入出金にして記録する。記録した件数を返す */
function addMailItems(items) {
  const config = mailImportSettings();
  const today = todayText();
  const fresh = items.filter((item) => item && item.id && !config.importedIds.includes(item.id));
  const newTransactions = [];

  for (const item of fresh) {
    const notice = parseCardNoticeEmail(item.text, today);
    const guess = notice && notice.merchant ? findAutoCategory(notice.merchant, 'expense') : null;
    const transaction = mailItemToTransaction(item, appState.profile.accounts, defaultMailAccountId(), today, guess);
    if (!transaction) {
      continue;
    }
    const monthItems = appState.monthly[monthOfDate(transaction.date)] || [];
    if (isDuplicateMailTransaction(transaction, monthItems.concat(newTransactions))) {
      continue; // 自分で先に入れていた分などは、二重にしない
    }
    newTransactions.push(transaction);
  }

  // 目印を進める（記録しなかったメールも「見た」ことにする）
  const cursor = updateMailCursor(config, fresh);
  config.lastReceivedAt = cursor.lastReceivedAt;
  config.importedIds = cursor.importedIds;
  config.importedCount = config.importedCount + newTransactions.length;

  if (fresh.length === 0) {
    return 0;
  }
  const changedMonths = new Set();
  for (const transaction of newTransactions) {
    const month = monthOfDate(transaction.date);
    if (!appState.monthly[month]) {
      appState.monthly[month] = [];
    }
    appState.monthly[month].push(transaction);
    changedMonths.add(month);
  }
  afterDataChange([...changedMonths], true);
  return newTransactions.length;
}

/** アプリを開いたとき・画面に戻ってきたときに呼ぶ（5分に1回まで） */
function autoMailImport() {
  if (!appState.profile || appState.isSample || appState.locked) {
    return;
  }
  const config = mailImportSettings();
  if (!config.url || !config.key) {
    return;
  }
  if (Date.now() - mailImportState.lastTriedAt < 5 * 60 * 1000) {
    return;
  }
  runMailImport(false);
}


/* ===========================================================
   5. 設定画面のカード
   =========================================================== */

function mailImportCardHtml() {
  const config = mailImportSettings();
  const isConnected = config.url !== '' && config.key !== '';

  let html = '<section class="card span-12" id="mailImportCard">';
  html += '<div class="card-head"><h2>メールから自動で記録（Gmail）</h2>' +
    (isConnected ? statusChipHtml('good', '接続中') : '<span class="sub">未設定</span>') + '</div>';
  html += '<p class="small muted">JCB の「ショッピングご利用のお知らせ」メールが届いたら、アプリを開いたときに自動で記録します。</p>';

  if (isConnected) {
    html += '<p class="small" style="margin-top:8px">' + escapeHtml(mailImportState.message || 'これまでに ' + config.importedCount + '件 記録しました') + '</p>';
    html += '<div class="row-gap" style="margin-top:10px">' +
      '<button type="button" class="btn small primary" data-action="mail-import-now"' + (mailImportState.running ? ' disabled' : '') + '>今すぐ取り込む</button>' +
      '<button type="button" class="btn small ghost danger-text" data-action="mail-disconnect">接続を解除</button></div>';
    if (mailImportState.disconnectConfirm) {
      html += '<div class="confirm-box" style="margin-top:10px"><p>アプリ側の接続を解除します。これまでに記録された分は消えません。Google 側のスクリプトは、Google の画面でアーカイブしてください。</p>' +
        '<div class="row-gap"><button type="button" class="btn danger small" data-action="mail-disconnect-yes">解除する</button>' +
        '<button type="button" class="btn ghost small" data-action="mail-disconnect-no">やめる</button></div></div>';
    }
  }

  // つなぎ方（未設定なら最初から開いておく）
  let accountOptions = '';
  const selectedAccount = defaultMailAccountId();
  for (const account of appState.profile.accounts) {
    accountOptions += '<option value="' + escapeHtml(account.id) + '"' + (account.id === selectedAccount ? ' selected' : '') + '>' + escapeHtml(account.name) + '</option>';
  }
  html += '<details class="more"' + (isConnected ? '' : ' open') + '><summary>' + (isConnected ? 'つなぎ直す' : 'つなぎ方（最初に1回だけ・パソコン推奨）') + '</summary>';
  html += '<ol class="mail-steps">' +
    '<li><button type="button" class="btn small" data-action="mail-copy-script">スクリプトをコピー</button> を押して、「コピーする」</li>' +
    '<li>パソコンで <strong>script.google.com</strong> を開き（Gmail と同じ Google アカウント）、「新しいプロジェクト」。最初からある文字を全部消して貼り付け、保存</li>' +
    '<li>上の関数の選択を「test」にして「実行」→「権限を確認」→ アカウントを選ぶ →「このアプリは Google で確認されていません」と出たら「詳細」→「（プロジェクト名）に移動」→「許可」</li>' +
    '<li>右上の「デプロイ」→「新しいデプロイ」→ 歯車で「ウェブアプリ」を選び、次のユーザーとして実行「自分」、アクセスできるユーザー「全員」→「デプロイ」</li>' +
    '<li>出てきた「ウェブアプリ」の URL（…/exec で終わる）を、下に貼り付けて「つなぐ」</li>' +
    '</ol>';
  html += '<div class="mail-form">' +
    '<label class="field"><span>ウェブアプリの URL</span><input id="mailScriptUrl" autocomplete="off" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" value="' + escapeHtml(config.url) + '"></label>' +
    '<label class="field"><span>合言葉（スクリプトの KEY と同じもの）</span><input id="mailScriptKey" type="password" autocomplete="off" value="' + escapeHtml(config.key) + '" placeholder="「スクリプトをコピー」で自動で入ります"></label>' +
    '<label class="field"><span>カードが分からないときの口座</span><select id="mailDefaultAccount">' + accountOptions + '</select></label>' +
    '</div>';
  html += '<label class="check" style="margin-top:8px"><input type="checkbox" id="mailIncludePast"><span>過去60日のメールも取り込む（自分で入れた分と重なることがあります）</span></label>';
  html += '<p class="form-error" id="mailImportError" role="alert"></p>';
  html += '<div class="row-gap" style="margin-top:8px"><button type="button" class="btn primary" data-action="mail-connect">つなぐ</button></div>';
  html += '<p class="hint" style="margin-top:10px">取り込み係は、あなたの Google アカウントの中で動き、JCB の利用通知メールの「日時・金額・利用先・カード名」の行だけを渡します。合言葉を知らない人には何も返しません。合言葉とスクリプトは人に見せないでください（バックアップには入りません）。</p>';
  html += '<p class="hint">合言葉が漏れたかもしれないときは <button type="button" class="btn small ghost" data-action="mail-new-key">合言葉を作り直す</button> を押して、出てきたスクリプトを Google に貼り直し、「デプロイを管理」→ 鉛筆 →「新しいバージョン」で更新してください。古い合言葉は使えなくなります。</p>';
  html += '</details>';
  html += '</section>';
  return html;
}

/** 「スクリプトをコピー」: 合言葉の入ったスクリプトを画面に出す */
function showMailScript() {
  const config = mailImportSettings();
  const typedKey = findOne('#mailScriptKey') ? findOne('#mailScriptKey').value.trim() : '';
  if (typedKey !== '') {
    config.key = typedKey;
  }
  if (config.key === '') {
    config.key = makeMailKey();
  }
  saveProfile();
  findOne('#textDialogTitle').textContent = 'メール取り込み係のスクリプト';
  findOne('#textDialogHint').textContent = '「コピーする」を押して、Google Apps Script（script.google.com）の新しいプロジェクトに貼り付けます。合言葉が入っているので、人には見せないでください。';
  findOne('#textDialogContent').value = buildMailScript(config.key);
  findOne('#textDialog').showModal();
}

/** 「合言葉を作り直す」: 新しい合言葉にして、スクリプトを出す（Google 側も貼り直しが必要） */
function renewMailKey() {
  const config = mailImportSettings();
  config.key = makeMailKey();
  saveProfile();
  showMailScript();
  findOne('#textDialogHint').textContent = '新しい合言葉が入ったスクリプトです。Google のスクリプトを全部これに置きかえて保存し、「デプロイ」→「デプロイを管理」→ 鉛筆 →「バージョン: 新バージョン」→「デプロイ」で更新してください。';
}

/** 「つなぐ」: URL などを保存して、すぐ問い合わせてみる */
function connectMailImport() {
  const errorArea = findOne('#mailImportError');
  const url = findOne('#mailScriptUrl').value.trim();
  const key = findOne('#mailScriptKey').value.trim();
  if (!isValidMailScriptUrl(url)) {
    errorArea.textContent = 'URL は「https://script.google.com/macros/s/」で始まり「/exec」で終わるものを貼り付けてください。';
    return;
  }
  if (key.length < 16) {
    errorArea.textContent = '合言葉がありません。「スクリプトをコピー」を押すと自動で入ります。';
    return;
  }
  const config = mailImportSettings();
  config.url = url;
  config.key = key;
  config.account = findOne('#mailDefaultAccount').value;
  config.lastReceivedAt = findOne('#mailIncludePast').checked ? 0 : Date.now();
  config.importedIds = [];
  mailImportState.message = '';
  mailImportState.disconnectConfirm = false;
  saveProfile();
  runMailImport(true);
}

/** 「接続を解除する」 */
function disconnectMailImport() {
  const config = mailImportSettings();
  config.url = '';
  mailImportState.message = '';
  mailImportState.disconnectConfirm = false;
  saveProfile();
  showToast('メール取り込みの接続を解除しました');
}
