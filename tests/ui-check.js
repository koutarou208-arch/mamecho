/* ===========================================================
   tests/ui-check.js  ―  画面の全パターンのテスト（本物のブラウザで動かす）
   -----------------------------------------------------------
   使い方: プロジェクトのいちばん上のフォルダで
             node tests/ui-check.js         … すべて（数分かかる）
             node tests/ui-check.js quick   … 幅3つ・明るい画面だけ（早い）
             node tests/ui-check.js quick layout … さらに、ボタンを押すテストを飛ばす（はみ出しだけ。1分ほど）
   Playwright（ブラウザを自動で動かす道具）が入っている環境で動きます
   （Claude の作業環境には入っています）。sh tests/run.sh とは別に、画面を変えたときに動かします。

   試すもの（全部の組み合わせ）:
     幅 11とおり（320〜1440px）× 明るい画面・暗い画面 × データ2とおり（サンプル・たくさん入れた家計簿）
       × 全部の画面（ホーム・入出金・家計簿・予算・カード・口座・手取り・設定と、その中の切りかえ）
       × ダイアログ（入出金の入力・編集、口座・カードの設定、通帳、CSV取り込み、ロック、Claude 用のまとめ）
   確かめること:
     ・画面やカードの右はしから、はみ出す部品がない（横にずれない）
     ・ページのエラー（プログラムの止まり）が出ない
     ・全部のボタンを1つずつ押しても、エラーが出ない（スマホ幅とパソコン幅）

   このテストは自分のコンピュータの中だけで動きます（小さなサーバーをその場で立てて開く。外とは通信しない）。
   =========================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const QUICK = process.argv[2] === 'quick';
const WIDTHS = QUICK ? [320, 393, 1280] : [320, 360, 375, 390, 393, 414, 430, 768, 1024, 1280, 1440];
const THEMES = QUICK ? ['light'] : ['light', 'dark'];
const DATA_SETS = ['sample', 'rich'];
const MONKEY_WIDTHS = process.argv.includes('layout') ? [] : [393, 1280]; // 全部のボタンを押してみる幅

// 押すと、ファイルを選ぶ画面・ダウンロード・Face ID・ページの読み直しなどになり、自動では試せないボタン
const SKIP_ACTIONS = /^(reload-app|start-own|export-csv|export-backup|restore-backup|copy-text|copy-report|wipe-yes|forget-lock-yes|lock-now|unlock-biometric|biometric-|pick-receipt|open-lock-dialog)/;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/** プロジェクトのファイルを配る小さなサーバーを立てる（このコンピュータの中だけ） */
function startServer() {
  const server = http.createServer((request, response) => {
    const urlPath = decodeURIComponent(request.url.split('?')[0]);
    const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** Playwright を読み込む（入っている場所が環境によってちがうため、順に探す） */
function loadPlaywright() {
  try {
    return require('playwright');
  } catch (error) {
    return require('/opt/node22/lib/node_modules/playwright');
  }
}

async function launchBrowser(chromium) {
  try {
    return await chromium.launch();
  } catch (error) {
    return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  }
}


/* ---------- ブラウザの中で動かすもの ---------- */

/**
 * 画面の中で、はみ出している部品・切れて見えなくなっている部品を探す（見つけたものの説明のリストを返す）。
 *   scope … 調べる場所（'#screen, dialog[open]' なら画面とダイアログ、'dialog[open]' ならダイアログだけ）
 */
function findOverflowInPage(scope) {
  const found = [];
  const viewportWidth = document.documentElement.clientWidth;
  const pathOf = (element) => {
    const parts = [];
    while (element && element.nodeType === 1 && parts.length < 4) {
      parts.unshift(element.tagName.toLowerCase() + (element.id ? '#' + element.id : '') + (element.classList.length ? '.' + [...element.classList].slice(0, 2).join('.') : ''));
      element = element.parentElement;
    }
    return parts.join(' > ');
  };
  const seen = new Set();
  // いちばん近い「はみ出した分を切る」親（overflow が hidden か clip）
  const clippingParentOf = (element) => {
    let parent = element.parentElement;
    while (parent && parent !== document.body) {
      const overflowX = getComputedStyle(parent).overflowX;
      if (overflowX === 'hidden' || overflowX === 'clip') {
        return parent;
      }
      parent = parent.parentElement;
    }
    return null;
  };
  // 部品（札・ボタン・箱）が、自分の親の枠の右からはみ出しているか（となりの金額などに重なる）
  const sticksOutOfParent = (element, style, rect) => {
    const parent = element.parentElement;
    if (!parent || style.display === 'inline' || style.position === 'absolute' || style.position === 'fixed') {
      return false;
    }
    const parentStyle = getComputedStyle(parent);
    if (parentStyle.display === 'inline' || parentStyle.overflowX !== 'visible' || ['svg', 'g'].includes(parent.tagName.toLowerCase())) {
      return false;
    }
    return rect.right > parent.getBoundingClientRect().right + 2; // 1〜2px は、小数の丸めのずれなので数えない
  };
  for (const root of document.querySelectorAll(scope || '#screen, dialog[open]')) {
    for (const element of root.querySelectorAll('*')) {
      if (element.closest('svg') && element.tagName.toLowerCase() !== 'svg') {
        continue;
      }
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || element.closest('.scroll-x, .table-wrap, .passbook')) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        continue;
      }
      const box = element.parentElement && element.parentElement.closest('.card, dialog, .dialog-body, section, .home-grid > *');
      const boxRect = box ? box.getBoundingClientRect() : null;
      let reason = '';
      const clipper = clippingParentOf(element);
      const clipRect = clipper ? clipper.getBoundingClientRect() : null;
      if (clipRect && rect.right > clipRect.right + 0.5 && style.display !== 'inline') {
        // 部品（札・ボタンなど）が親のはしで切れて、見えなくなっている（文字の「…」は、わざと切っているので数えない）
        reason = '切れて見えない ' + Math.round(rect.right - clipRect.right) + 'px';
      } else if (clipRect && rect.right > clipRect.right + 0.5) {
        reason = '';
      } else if (rect.right > viewportWidth + 0.5) {
        reason = '画面の右を越える ' + Math.round(rect.right - viewportWidth) + 'px';
      } else if (boxRect && rect.right > boxRect.right + 0.5 && element.tagName.toLowerCase() !== 'dialog') {
        reason = 'カードの右を越える ' + Math.round(rect.right - boxRect.right) + 'px';
      } else if (rect.left < -0.5) {
        reason = '画面の左を越える';
      } else if (sticksOutOfParent(element, style, rect)) {
        reason = '親の枠からはみ出す（となりに重なる） ' + Math.round(rect.right - element.parentElement.getBoundingClientRect().right) + 'px';
      } else if (element.childElementCount === 0 && element.scrollWidth > element.clientWidth + 1 && style.overflow === 'visible' && style.display !== 'inline') {
        reason = '中身が枠より広い ' + (element.scrollWidth - element.clientWidth) + 'px';
      }
      if (reason) {
        const text = (element.childElementCount === 0 ? element.textContent : '').trim().slice(0, 20);
        const key = pathOf(element) + reason;
        if (!seen.has(key)) {
          seen.add(key);
          found.push(reason + ' | ' + pathOf(element) + (text ? ' | 「' + text + '」' : ''));
        }
      }
    }
  }
  const pageOverflow = document.documentElement.scrollWidth - viewportWidth;
  if (pageOverflow > 0) {
    found.unshift('ページ全体が横にはみ出す ' + pageOverflow + 'px');
  }
  return found;
}

/** たくさんのデータを入れた家計簿をつくる（長い名前・大きな金額・全部の払い方・仮の入力・会話など） */
async function buildRichLedgerInPage() {
  await startOwnLedger();
  const today = todayText();
  let seed = 12345;
  const randomNumber = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const between = (min, max) => min + Math.floor(randomNumber() * (max - min + 1));
  const pick = (list) => list[Math.floor(randomNumber() * list.length)];
  const start = addDays(today, -400);
  const accounts = appState.profile.accounts;
  accounts.push({ id: 'ui-bank', name: 'とても長い名前のメインバンク普通預金口座', kind: 'bank', opening: 12345678, openDate: start });
  accounts.push({ id: 'ui-bank2', name: 'ネット銀行', kind: 'bank', opening: 300000, openDate: start });
  accounts.push({ id: 'ui-sec', name: '証券口座', kind: 'securities', opening: 2500000, openDate: start });
  accounts.push({ id: 'ui-emoney', name: '電子マネー', kind: 'emoney', opening: 5000, openDate: start });
  const cards = [
    { id: 'ui-jcb', name: 'JCBカード（とても長いカードの名前が入ります）', kind: 'card', opening: -123456, openDate: start, card: { company: 'jcb', cycleIndex: 0, payFrom: 'ui-bank', limit: 1000000, pointRate: 0.5 } },
    { id: 'ui-epos', name: 'エポス', kind: 'card', opening: 0, openDate: start, card: { company: 'epos', cycleIndex: 0, payFrom: 'ui-bank' } },
    { id: 'ui-smbc', name: '三井住友', kind: 'card', opening: 0, openDate: start, card: { company: 'smbc', cycleIndex: 1, payFrom: 'ui-bank2', autoRevolving: true, revolvingMonthly: 1000 } },
    { id: 'ui-custom', name: '自分で決めたカード', kind: 'card', opening: 0, openDate: start, card: { company: 'custom', cycleIndex: 'custom', closingDay: 20, paymentDay: 5, monthsLater: 2, payFrom: 'ui-bank' } },
  ];
  for (const card of cards) {
    accounts.push(card);
  }
  rebuildIndexes();
  const stores = ['スーパー', 'コンビニ', 'とても長いお店の名前がここに入りますとても長いお店の名前がここに入ります', '電気代', 'カフェ', 'ドラッグストア', 'Amazon.co.jp マーケットプレイス'];
  const records = [];
  for (let index = 0; index < 400; index++) {
    const date = addDays(today, -between(0, 240));
    const kind = randomNumber();
    const category = pick(EXPENSE_CATEGORIES);
    const base = { id: 'ui' + index, date: date, memo: index % 7 === 0 ? 'メモ' : '', include: true, createdAt: index };
    if (kind < 0.5) {
      const card = pick(cards);
      records.push({ ...base, type: 'expense', amount: between(100, 300000), account: card.id, category: category.id, sub: pick(category.subs), description: pick(stores),
        payMethod: pick(cardSettings(card).methods), installments: pick(INSTALLMENT_COUNTS), skipMonths: between(1, 6) });
    } else if (kind < 0.8) {
      records.push({ ...base, type: 'expense', amount: between(100, 200000), account: pick(['ui-bank', 'ui-bank2', 'ui-emoney']), category: category.id, sub: pick(category.subs), description: pick(stores) });
    } else if (kind < 0.92) {
      records.push({ ...base, type: 'income', amount: between(1000, 600000), account: 'ui-bank', category: 'salary', sub: '給与', description: '給与' });
    } else {
      records.push({ ...base, type: 'transfer', amount: between(1000, 100000), account: 'ui-bank', toAccount: 'ui-bank2', description: '振替' });
    }
  }
  records.push({ id: 'ui-big', date: today, type: 'expense', amount: 12345678, account: 'ui-bank', category: 'special', sub: '家具・家電', description: 'とても大きな買い物', memo: '', include: true, createdAt: 999 });
  putManyTransactions(records);
  for (let step = 1; step <= 6; step++) {
    saveManualBill(accountById['ui-jcb'], addMonths(today.slice(0, 7), step), 190000 + step * 1000);
  }
  appState.profile.budgets = { food: 40000, daily: 10000, hobby: 20000, transport: 5000 };
  appState.profile.settings.savingsGoal = 50000;
  appState.profile.chat = [
    { role: 'user', text: '今月はどう？', at: today },
    { role: 'assistant', text: 'とても長い答え。'.repeat(40), at: today },
  ];
  saveProfile();
  renderApp();
}

/** 画面を開く（"report:income" のように、画面の中の切りかえもふくむ） */
function openScreenInPage(target) {
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
  const [name, mode] = target.split(':');
  if (name === 'report') {
    appState.reportType = mode === 'income' ? 'income' : 'expense';
  }
  goToScreen(name);
  if (mode === 'edit') {
    const button = document.querySelector('[data-action="edit-budget"]');
    if (button) {
      button.click();
    }
  }
  if (mode === 'check') {
    isNumberCheckOpen = true;
    renderApp();
  }
  document.querySelectorAll('#screen details').forEach((details) => {
    details.open = true;
  });
}

/** ダイアログを開く */
function openDialogInPage(name) {
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
  goToScreen('home');
  const firstRecord = allTransactions[0];
  const actions = {
    '入出金（新しく）': () => openTransactionDialog(null),
    '入出金（編集）': () => openTransactionDialog(firstRecord || null),
    '口座（新しく）': () => openAccountDialog(null, 'bank'),
    'カード（新しく）': () => openAccountDialog(null, 'card'),
    'カード（設定）': () => openAccountDialog(appState.profile.accounts.find((account) => account.kind === 'card') || null, 'card'),
    '通帳': () => openPassbook(appState.profile.accounts[0].id),
    'CSV取り込み': () => openImportDialog(),
    'ロック': () => openLockDialog(),
    'Claude 用のまとめ': () => openClaudeSummary(),
  };
  actions[name]();
}

/** 画面の中のボタンを1つずつ押す（押すたびにダイアログを閉じて、画面を開き直す） */
async function pressEveryButton(page, target, problems, label) {
  let pressed = 0;
  await page.evaluate(openScreenInPage, target);
  const count = await page.evaluate(() => document.querySelectorAll('#screen [data-action]').length);
  for (let index = 0; index < count; index++) {
    const before = page.errorsSeen.length;
    const info = await page.evaluate(([position, skipPattern]) => {
      const button = document.querySelectorAll('#screen [data-action]')[position];
      if (!button || new RegExp(skipPattern).test(button.dataset.action) || button.disabled) {
        return null;
      }
      const text = (button.getAttribute('aria-label') || button.textContent || '').trim().slice(0, 20);
      button.click();
      return button.dataset.action + '「' + text + '」';
    }, [index, SKIP_ACTIONS.source]);
    if (!info) {
      continue;
    }
    pressed = pressed + 1;
    await page.waitForTimeout(60);
    if (page.errorsSeen.length > before) {
      problems.push(label + ' ' + target + ' ' + info + ' を押すとエラー: ' + page.errorsSeen.slice(before).join(' | '));
    }
    await page.evaluate(openScreenInPage, target);
  }
  return pressed;
}


/* ---------- 実行 ---------- */

async function main() {
  const server = await startServer();
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/index.html';
  const { chromium } = loadPlaywright();
  const browser = await launchBrowser(chromium);
  const problems = [];
  const screens = ['home', 'transactions', 'report', 'report:income', 'budget', 'budget:edit', 'cards', 'accounts', 'takehome', 'settings', 'settings:check'];
  const dialogs = ['入出金（新しく）', '入出金（編集）', '口座（新しく）', 'カード（新しく）', 'カード（設定）', '通帳', 'CSV取り込み', 'ロック', 'Claude 用のまとめ'];
  let checkedViews = 0;
  let pressedButtons = 0;
  const startedAt = Date.now();

  for (const width of WIDTHS) {
    for (const theme of THEMES) {
      for (const dataSet of DATA_SETS) {
        const label = '[' + width + 'px・' + (theme === 'dark' ? '暗い' : '明るい') + '・' + (dataSet === 'rich' ? 'たくさん' : 'サンプル') + ']';
        const isPhone = width < 600;
        const context = await browser.newContext({ viewport: { width: width, height: isPhone ? 844 : 900 }, isMobile: isPhone, hasTouch: isPhone, colorScheme: theme });
        const page = await context.newPage();
        page.errorsSeen = [];
        page.on('pageerror', (error) => page.errorsSeen.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') {
            page.errorsSeen.push(message.text());
          }
        });
        await page.goto(baseUrl);
        await page.waitForTimeout(700);
        if (dataSet === 'rich') {
          await page.evaluate(buildRichLedgerInPage);
          await page.waitForTimeout(300);
        }
        for (const target of screens) {
          await page.evaluate(openScreenInPage, target);
          await page.waitForTimeout(120);
          for (const issue of await page.evaluate(findOverflowInPage, '#screen')) {
            problems.push(label + ' ' + target + ': ' + issue);
          }
          checkedViews = checkedViews + 1;
        }
        for (const name of dialogs) {
          await page.evaluate(openDialogInPage, name);
          await page.waitForTimeout(120);
          for (const issue of await page.evaluate(findOverflowInPage, 'dialog[open]')) {
            problems.push(label + ' ' + name + ': ' + issue);
          }
          checkedViews = checkedViews + 1;
        }
        await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close()));
        if (dataSet === 'rich' && theme === 'light' && MONKEY_WIDTHS.includes(width)) {
          for (const target of screens) {
            pressedButtons = pressedButtons + await pressEveryButton(page, target, problems, label);
          }
        }
        if (page.errorsSeen.length > 0) {
          problems.push(label + ' ページのエラー: ' + [...new Set(page.errorsSeen)].slice(0, 5).join(' | '));
        }
        await context.close();
      }
    }
  }
  await browser.close();
  server.close();

  const combinations = WIDTHS.length * THEMES.length * DATA_SETS.length;
  console.log('画面の全パターンのテスト: ' + combinations + 'とおり（幅' + WIDTHS.length + ' × 明暗' + THEMES.length + ' × データ' + DATA_SETS.length + '）、' +
    '画面とダイアログ ' + checkedViews + ' 枚、ボタン ' + pressedButtons + ' 回（' + Math.round((Date.now() - startedAt) / 1000) + '秒）');
  if (problems.length > 0) {
    console.log('問題 ' + problems.length + ' 件:');
    for (const problem of problems.slice(0, 60)) {
      console.log('  ・' + problem);
    }
    process.exit(1);
  }
  console.log('→ はみ出し・エラーはありませんでした。');
}

// node tests/ui-check.js で動かしたときだけ実行する（ほかのファイルから道具として読み込むこともできる）
if (require.main === module) {
  main();
}
module.exports = { startServer, loadPlaywright, launchBrowser, findOverflowInPage, buildRichLedgerInPage, openScreenInPage, openDialogInPage };
