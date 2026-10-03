/* ===========================================================
   04-state-and-storage.js  ―  アプリの記憶と、データの保存
   -----------------------------------------------------------
   【前半】appState … アプリが「今」覚えていることの入れ物
   【後半】保存のしくみ … データをどこに、どうやって保存するか

   保存先は、開いた場所によって自動で選ばれます:
     1. Claude のアーティファクトとして開いたとき
        → あなたのClaudeアカウントに保存（あなた専用。他の人には見えません）
     2. ファイルを直接ブラウザで開いたとき
        → そのブラウザの中に保存（localStorage という仕組み）
     3. どちらも使えないとき
        → 保存しない（画面を閉じると消える）

   保存するデータの形:
     profile         … 設定・口座・予算・自動分類ルール（1つの箱）
     m-2026-09 など  … その月の入出金のリスト（1か月ごとに1つの箱）
     lock            … 暗号化ロックをオンにしたときだけ。鍵を作るための情報（秘密ではない）

   【暗号化ロック】21-encryption-lock.js
   オンにすると、箱の中身は書き込む直前にパスフレーズで暗号化され、
   読み込んだ直後に元に戻します。保存先には暗号文しか残りません。
   そのため、この4番のファイルでは「保存の直前・読み込みの直後」に
   encryptForStorage / decryptFromStorage を通します。
   =========================================================== */


/* ===========================================================
   1. アプリの記憶（appState）
   =========================================================== */

const appState = {
  // どこに保存しているか: 'loading'（準備中）/'cloud'/'browser'/'memory'
  storageMode: 'loading',

  // サンプルデータを表示中なら true（このときは保存しない）
  isSample: false,

  // 設定・口座・予算・ルール（形は createEmptyProfile を参照）
  profile: null,

  // 入出金。月ごとに分けて入れている
  //   例: { '2026-09': [入出金, 入出金, ...], '2026-10': [...] }
  monthly: {},

  // 今表示している画面の名前（'home' / 'transactions' など）
  screen: 'home',

  // 表示中の期間 { year: 2026, month: 10 }
  period: null,

  // 入出金画面の絞り込み条件
  filters: { account: '', category: '', type: '', search: '', date: '' },

  // 家計簿画面で「支出」と「収入」のどちらを表示するか
  reportType: 'expense',

  // 予算を編集中のときの下書き（編集していないときは null）
  budgetDraft: null,

  // 保存の状態: '' / 'saving' / 'saved' / 'error'
  saveStatus: '',

  // 暗号化ロックでロック中なら true（このときは何も表示せず、保存もしない）
  locked: false,
};

/** 何もないところから始めるときの設定 */
function createEmptyProfile() {
  return {
    version: 1,
    settings: {
      startDay: 1,       // 1か月の始まりの日（給料日に合わせて25日にする人も多い）
      savingsGoal: 0,    // 毎月の貯金目標
    },
    accounts: [
      { id: makeId(), name: '財布', kind: 'cash', opening: 0, openDate: todayText() },
    ],
    budgets: {},          // 例: { food: 50000, daily: 8000 }
    rules: [],            // 自分で覚えさせた自動分類ルール
  };
}

/**
 * 保存されていた設定を読み込むときに、足りない項目を補う。
 * （古いバージョンで保存したデータでも動くようにするため）
 */
function normalizeProfile(raw) {
  const empty = createEmptyProfile();
  const profile = raw || {};
  return {
    version: 1,
    settings: { ...empty.settings, ...(profile.settings || {}) },
    accounts: Array.isArray(profile.accounts) ? profile.accounts : [],
    budgets: profile.budgets || {},
    rules: Array.isArray(profile.rules) ? profile.rules : [],
  };
}


/* ===========================================================
   2. 保存のしくみ（準備）
   =========================================================== */

const BROWSER_STORAGE_KEY = 'mamecho-kakeibo-v1';

// Claudeアカウントに保存するときに使う情報
const cloud = {
  db: null,               // 保存の窓口
  basePath: '',           // 自分専用の保存場所 'data/users/<あなたのID>'
  firstAnswerArrived: false,
  waitingWrites: new Map(), // これから書き込む内容（箱の名前 → 中身）
  writingNow: new Set(),    // 今まさに書き込み中の箱の名前
  queue: Promise.resolve(), // 届いたデータを「1つずつ順番に」処理するための列
  heldDocs: null,           // ロック中に届いた暗号文（解除したら読む）
};

/**
 * アプリを開いたときに1回だけ呼ばれる。保存先を決めてデータを読み込む。
 */
async function startStorage() {
  let db = null;
  let user = null;

  // window.claude があるのは、Claude のアーティファクトとして開いたときだけ
  if (window.claude && typeof window.claude.use === 'function') {
    try {
      const results = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      db = results[0];
      user = results[1];
    } catch (error) {
      db = null;
    }
  }

  let userId = null;
  if (user) {
    try {
      userId = await user.id();
    } catch (error) {
      userId = null;
    }
  }

  if (db && userId) {
    connectCloud(db, userId);
  } else {
    loadFromBrowser();
  }
}


/* ===========================================================
   3. Claudeアカウントへの保存
   =========================================================== */

/** 自分専用の保存場所を見張り、データが届いたら画面に反映する */
function connectCloud(db, userId) {
  appState.storageMode = 'cloud';
  cloud.db = db;
  cloud.basePath = 'data/users/' + userId;

  const collection = db.collection(cloud.basePath);

  // サーバーの返事が6秒たっても来ない場合は「まだデータがない」とみなす
  setTimeout(() => {
    if (!cloud.firstAnswerArrived) {
      cloud.firstAnswerArrived = true;
      if (appState.profile === null) {
        showSampleData();
        finishLoading();
      }
    }
  }, 6000);

  // onSnapshot … データが変わるたびに（他の端末で変えた場合も）呼ばれる
  collection.onSnapshot(
    (snapshot) => receiveCloudSnapshot(snapshot),
    (error) => {
      setSaveStatus('error');
      showToast('データの同期が止まりました。ページを開き直してください。');
      console.warn('db error', error);
    }
  );
}

/** 保存場所から届いたデータを appState に入れる（複数届いても1つずつ順番に処理する） */
function receiveCloudSnapshot(snapshot) {
  cloud.queue = cloud.queue
    .then(() => processCloudSnapshot(snapshot))
    .catch((error) => console.warn('snapshot error', error));
}

async function processCloudSnapshot(snapshot) {
  // 最初の1回: 端末に残っていた古い情報（キャッシュ）が空なら、サーバーの返事を待つ
  if (!cloud.firstAnswerArrived) {
    if (snapshot.empty && snapshot.metadata.fromCache) {
      return;
    }
    cloud.firstAnswerArrived = true;
  }

  const documents = snapshot.docs;

  // まだ何も保存されていない → サンプルを見せる
  if (documents.length === 0) {
    if (appState.profile === null) {
      showSampleData();
    }
    finishLoading();
    return;
  }

  // 届いたデータは書きかえ禁止の状態なので、コピーしてから使う
  const raw = documents.map((documentSnapshot) => ({
    name: documentSnapshot.id,
    data: JSON.parse(JSON.stringify(documentSnapshot.data() || {})),
  }));
  await applyCloudDocuments(raw);
}

/**
 * 届いた箱（暗号化されていれば元に戻して）appState に入れる。
 * raw = [{ name: 'profile', data: {...} }, ...]
 */
async function applyCloudDocuments(raw) {
  // --- 暗号化ロックの確認 ---
  // （自分でオン/オフにした直後30秒は、古いデータが届いても勘違いしないよう無視する）
  const lockEntry = raw.find((entry) => entry.name === 'lock');
  const justChanged = Date.now() - Math.max(lockState.justEnabledAt, lockState.justDisabledAt) < 30000;
  if (lockEntry && !(justChanged && !lockState.enabled)) {
    adoptLockSettings(lockEntry.data);
  } else if (!lockEntry && lockState.enabled && !isCloudWriteBusy('lock') && !justChanged) {
    forgetLock(); // 別の端末でロックがオフにされた
  }
  if (lockState.enabled && !lockState.key) {
    cloud.heldDocs = raw;   // 鍵がないので、パスフレーズが入るまで読まずに置いておく
    enterLockedState();
    return;
  }
  cloud.heldDocs = null;

  // 本物のデータが届いたので、サンプル表示はやめる
  if (appState.isSample) {
    appState.isSample = false;
    appState.profile = null;
    appState.monthly = {};
  }

  const arrivedNames = new Set();
  for (const entry of raw) {
    if (entry.name === 'lock') {
      continue;
    }
    arrivedNames.add(entry.name);

    // 自分が今書き込んでいる最中の箱は、画面の内容のほうが新しいので上書きしない
    if (isCloudWriteBusy(entry.name)) {
      continue;
    }

    let data = entry.data;
    try {
      data = await decryptFromStorage(data); // 暗号化されていなければそのまま返る
    } catch (error) {
      console.warn('decrypt error', entry.name, error);
      showToast('一部のデータを読み取れませんでした（パスフレーズが違うか、データが壊れています）。');
      continue;
    }
    if (entry.name === 'profile') {
      appState.profile = normalizeProfile(data);
    } else if (entry.name.startsWith('m-')) {
      const month = entry.name.slice(2);
      appState.monthly[month] = Array.isArray(data.items) ? data.items : [];
    }
  }

  // 他の端末で消された月を、こちらでも消す
  for (const month of Object.keys(appState.monthly)) {
    const name = 'm-' + month;
    if (!arrivedNames.has(name) && !isCloudWriteBusy(name)) {
      delete appState.monthly[month];
    }
  }

  if (appState.profile === null) {
    appState.profile = createEmptyProfile();
  }
  appState.locked = false;
  finishLoading();
}

/** その箱を今書き込み中（または書き込み待ち）なら true */
function isCloudWriteBusy(name) {
  return cloud.waitingWrites.has(name) || cloud.writingNow.has(name);
}

/**
 * 箱への書き込みを予約する。content が null なら箱を削除する。
 * 同じ箱への書き込みは「1つずつ順番に」行う決まりなので、
 * 書き込み中なら終わってから最新の内容だけを書き込む。
 */
function queueCloudWrite(name, content) {
  // 書き込む内容をこの瞬間の形でコピーしておく（あとで変わっても影響しないように）
  const snapshotOfContent = content === null ? null : JSON.parse(JSON.stringify(content));
  cloud.waitingWrites.set(name, snapshotOfContent);
  if (!cloud.writingNow.has(name)) {
    runCloudWrites(name);
  }
}

async function runCloudWrites(name) {
  cloud.writingNow.add(name);
  setSaveStatus('saving');

  while (cloud.waitingWrites.has(name)) {
    const content = cloud.waitingWrites.get(name);
    cloud.waitingWrites.delete(name);
    let stored = content;
    try {
      stored = content === null ? null : await encryptForStorage(name, content);
    } catch (error) {
      setSaveStatus('error');
      showToast('暗号化に失敗したため保存しませんでした。');
      console.warn('encrypt error', error);
      continue;
    }
    await writeOneCloudDocument(name, stored, false);
  }

  cloud.writingNow.delete(name);
  if (cloud.writingNow.size === 0 && appState.saveStatus !== 'error') {
    setSaveStatus('saved');
  }
}

async function writeOneCloudDocument(name, content, isRetry) {
  const reference = cloud.db.doc(cloud.basePath + '/' + name);
  try {
    if (content === null) {
      await reference.delete();
    } else {
      await reference.set(content);
    }
  } catch (error) {
    const code = error && error.code;
    // 一時的なエラーなら、少し待って1回だけやり直す
    if (code === 'unavailable' && !isRetry) {
      const waitMs = 500 + Math.random() * 1000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      await writeOneCloudDocument(name, content, true);
      return;
    }
    setSaveStatus('error');
    if (code === 'quota_exceeded') {
      showToast('保存できる量の上限です。古い記録を書き出してから削除してください。');
    } else if (code === 'invalid_argument') {
      showToast('保存できませんでした（この画面では書き込みが許可されていません）。');
    } else {
      showToast('保存できませんでした。通信状態を確かめてください。');
    }
    console.warn('save error', name, error);
  }
}


/* ===========================================================
   4. ブラウザの中への保存（localStorage）
   =========================================================== */

const browserStore = {
  heldEnc: null,                 // ロック中に読み込んだ暗号文
  saveChain: Promise.resolve(),  // 保存を「1つずつ順番に」行うための列
};

function loadFromBrowser() {
  let savedText = null;
  try {
    savedText = localStorage.getItem(BROWSER_STORAGE_KEY);
    appState.storageMode = 'browser';
  } catch (error) {
    appState.storageMode = 'memory'; // ブラウザが保存を許可していない
  }

  let saved = null;
  try {
    saved = savedText ? JSON.parse(savedText) : null;
  } catch (error) {
    saved = null;
  }

  // 暗号化されて保存されている → パスフレーズが入るまで読まない
  if (saved && saved.lock && saved.enc) {
    adoptLockSettings(saved.lock);
    browserStore.heldEnc = saved.enc;
    enterLockedState();
    return;
  }

  if (saved && saved.profile) {
    appState.profile = normalizeProfile(saved.profile);
    appState.monthly = saved.monthly || {};
  } else {
    showSampleData();
  }
  finishLoading();
}

/** ブラウザへの保存を予約する（暗号化がオンなら暗号化してから） */
function saveToBrowser() {
  browserStore.saveChain = browserStore.saveChain
    .then(writeBrowserNow)
    .catch((error) => {
      setSaveStatus('error');
      showToast('このブラウザに保存できませんでした。');
      console.warn('browser save error', error);
    });
}

async function writeBrowserNow() {
  const body = { profile: appState.profile, monthly: appState.monthly };
  let text;
  if (lockState.enabled && lockState.key) {
    text = JSON.stringify({ lock: currentLockDocument(), enc: await encryptJson(body) });
  } else {
    text = JSON.stringify(body);
  }
  localStorage.setItem(BROWSER_STORAGE_KEY, text);
  setSaveStatus('saved');
}


/* ===========================================================
   5. 保存の入口（どの画面からもこれを呼ぶ）
   =========================================================== */

/**
 * 変わった部分を保存する。
 *   changedMonths  … 入出金が変わった月のリスト（例: ['2026-09']）
 *   profileChanged … 設定・口座・予算が変わったら true
 */
function saveChanges(changedMonths, profileChanged) {
  if (appState.isSample || appState.locked) {
    return; // サンプルとロック中は保存しない
  }

  if (appState.storageMode === 'cloud') {
    if (profileChanged) {
      queueCloudWrite('profile', appState.profile);
    }
    for (const month of changedMonths) {
      const items = appState.monthly[month] || [];
      if (items.length === 0) {
        queueCloudWrite('m-' + month, null); // 空になった月の箱は消す
      } else {
        const content = { month: month, items: items };
        if (JSON.stringify(content).length > 170000) {
          showToast(month + ' の記録が多すぎて保存できない可能性があります。');
        }
        queueCloudWrite('m-' + month, content);
      }
    }
  } else if (appState.storageMode === 'browser') {
    saveToBrowser();
  }
}

/** 左下の「保存済み」などの表示を更新する */
function setSaveStatus(status) {
  appState.saveStatus = status;
  const element = findOne('#saveStatus');
  if (!element) {
    return;
  }
  element.dataset.status = status;
  element.textContent = describeSaveStatus();
}

function describeSaveStatus() {
  if (appState.isSample) {
    return 'サンプル表示中（保存されません）';
  }
  if (appState.saveStatus === 'saving') {
    return '保存中…';
  }
  if (appState.saveStatus === 'error') {
    return '保存できませんでした';
  }
  const lockText = lockState.enabled ? '・暗号化' : '';
  if (appState.storageMode === 'cloud') {
    return 'Claudeアカウントに保存（自分専用' + lockText + '）';
  }
  if (appState.storageMode === 'browser') {
    return 'このブラウザに保存' + (lockState.enabled ? '（暗号化）' : '');
  }
  if (appState.storageMode === 'memory') {
    return '保存できない環境です';
  }
  return '読み込み中…';
}


/* ===========================================================
   6. サンプル表示と「自分の家計簿をはじめる」
   =========================================================== */

/** サンプルデータを画面に出す（保存はしない） */
function showSampleData() {
  if (appState.isSample) {
    return;
  }
  const sample = createSampleData(); // 18-sample-data.js にある
  appState.isSample = true;
  appState.profile = sample.profile;
  appState.monthly = sample.monthly;
}

/** サンプルを捨てて、空の家計簿から始める */
function startOwnLedger() {
  appState.isSample = false;
  appState.profile = createEmptyProfile();
  appState.monthly = {};
  appState.period = periodOf(todayText());
  saveChanges([], true);
  rebuildIndexes();
  goToScreen('accounts');
  showToast('自分の家計簿を作りました。まずは口座を登録しましょう。');
}

/** 読み込みが終わったら呼ぶ（期間を決めて画面を描く） */
function finishLoading() {
  if (appState.period === null && appState.profile) {
    appState.period = periodOf(todayText());
  }
  rebuildIndexes();
  setSaveStatus(appState.saveStatus);
  renderApp();
}


/* ===========================================================
   7. データを変える関数
   入出金を追加・変更・削除するときは、必ずここの関数を使う。
   （保存と画面の更新までまとめてやってくれる）
   =========================================================== */

/** "2026-09-14" → "2026-09"（どの月の箱に入れるか） */
function monthOfDate(dateText) {
  return dateText.slice(0, 7);
}

/** データが変わったあとの「計算し直し → 保存 → 画面を描き直し」 */
function afterDataChange(changedMonths, profileChanged) {
  rebuildIndexes();
  saveChanges(changedMonths, profileChanged);
  renderApp();
}

/**
 * 入出金を1件追加（または上書き）する。
 * 編集のときは oldDate に「変更前の日付」を渡す（月の箱を移すため）。
 */
function putTransaction(transaction, oldDate) {
  const changedMonths = new Set();

  if (oldDate) {
    const oldMonth = monthOfDate(oldDate);
    const list = appState.monthly[oldMonth] || [];
    appState.monthly[oldMonth] = list.filter((item) => item.id !== transaction.id);
    changedMonths.add(oldMonth);
  }

  const month = monthOfDate(transaction.date);
  if (!appState.monthly[month]) {
    appState.monthly[month] = [];
  }
  appState.monthly[month].push(transaction);
  changedMonths.add(month);

  afterDataChange([...changedMonths], false);
}

/** 入出金をまとめて追加する（CSVの取り込みなど） */
function putManyTransactions(transactions) {
  const changedMonths = new Set();
  for (const transaction of transactions) {
    const month = monthOfDate(transaction.date);
    if (!appState.monthly[month]) {
      appState.monthly[month] = [];
    }
    appState.monthly[month].push(transaction);
    changedMonths.add(month);
  }
  afterDataChange([...changedMonths], false);
}

/** 入出金を1件削除する */
function deleteTransaction(transaction) {
  const month = monthOfDate(transaction.date);
  const list = appState.monthly[month] || [];
  appState.monthly[month] = list.filter((item) => item.id !== transaction.id);
  afterDataChange([month], false);
}

/**
 * 条件に合う入出金をまとめて削除する（口座を消すときなど）。
 * shouldDelete は「消すなら true を返す関数」。消した月のリストを返す。
 */
function deleteTransactionsWhere(shouldDelete) {
  const changedMonths = [];
  for (const month of Object.keys(appState.monthly)) {
    const before = appState.monthly[month];
    const after = before.filter((item) => !shouldDelete(item));
    if (after.length !== before.length) {
      appState.monthly[month] = after;
      changedMonths.push(month);
    }
  }
  return changedMonths;
}

/** 設定・口座・予算などを変えたあとに呼ぶ */
function saveProfile() {
  afterDataChange([], true);
}

/**
 * データを丸ごと入れかえる（バックアップから戻すとき・全部消すとき）。
 */
function replaceAllData(newProfile, newMonthly) {
  const oldMonths = Object.keys(appState.monthly);
  appState.isSample = false;
  appState.profile = normalizeProfile(newProfile);
  appState.monthly = newMonthly || {};

  // 以前あった月も「変わった月」に入れて、空なら箱を消してもらう
  const allMonths = new Set([...oldMonths, ...Object.keys(appState.monthly)]);
  appState.period = periodOf(todayText());
  afterDataChange([...allMonths], true);
}
