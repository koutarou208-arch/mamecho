/* ===========================================================
   21-encryption-lock.js  ―  暗号化ロック（パスフレーズ）
   -----------------------------------------------------------
   家計簿のデータを、あなただけが知っている「パスフレーズ」で暗号化します。

   ■ しくみ（かんたんな説明）
     ・パスフレーズから「鍵」を作る（PBKDF2 という方法。わざと時間がかかる計算で、
       パスフレーズを当てずっぽうで試すのを大変にします）
     ・データを保存する直前に、その鍵で暗号化する（AES-GCM という方法）
     ・保存先には暗号文（意味のない文字の並び）しか残らない
     ・読み込んだら、パスフレーズから作った鍵で元に戻す
     鍵とパスフレーズは、画面を開いている間のメモリにだけ置き、保存しません。

   ■ これで守れるもの・守れないもの
     守れる   … 保存先（Claudeのサーバーや、ブラウザの保存領域）にあるデータ。
                サービスの運営側や、ほかの人が保存先をのぞいても読めません。
     守れない … ・パスフレーズを忘れたとき（だれにも元に戻せません）
                ・バックアップやCSVとして書き出したファイル（暗号化されません）
                ・画面を開いてロックを解除している間に、画面をのぞかれること
                ・AIのふり返りを使ったとき（集計した数字だけが Claude に送られます）

   ■ 暗号化がオフのとき
     Claude のアーティファクトとして開いた場合、データは「あなた専用の保存場所」に入り、
     ページの作者であっても、ほかの人は読めない仕組みです（Claude 側の仕様）。
     暗号化ロックは、それに加えてもう1枚かける鍵です。

   ■ 保存される「lock」の箱
     { v: 1, salt: 鍵を作るときのまぜもの, iter: 計算の回数, check: 確認用の暗号文 }
     この箱は秘密ではありません（パスフレーズが合っているかを確かめるために使います）。
   =========================================================== */

const lockState = {
  enabled: false,   // 暗号化ロックがオンか
  key: null,        // 鍵（パスフレーズが入るまで null）
  salt: '',         // 鍵を作るときのまぜもの（base64）
  iter: 600000,     // 鍵を作るときの計算回数
  check: null,      // パスフレーズが合っているか確かめる暗号文
  justEnabledAt: 0, // オンにした直後の時刻（古いデータが届いて勘違いするのを防ぐ）
  justDisabledAt: 0, // オフにした直後の時刻
};

const MIN_PASSPHRASE_LENGTH = 8;           // これより短いパスフレーズは使えない
const RECOMMENDED_PASSPHRASE_LENGTH = 12;  // これより短いと「当てられやすい」注意を出す（使うことはできる）
let weakPassphraseAcknowledged = '';      // 注意を見たうえで「それでも使う」と2回目を押したパスフレーズ
const AUTO_LOCK_MINUTES = 10;   // 操作しないままこの時間がたつと自動でロック

let isDisableLockConfirmOpen = false;
let isForgetWipeConfirmOpen = false;
let idleTimer = null;


/* ===========================================================
   1. 暗号の道具
   =========================================================== */

/** バイト列 → 文字（base64） */
function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

/** 文字（base64） → バイト列 */
function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** パスフレーズと salt から鍵を作る */
async function deriveKey(passphrase, saltBase64, iterations) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: base64ToBytes(saltBase64), iterations: iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,                       // 鍵そのものは取り出せない
    ['encrypt', 'decrypt']
  );
}

/** データ（オブジェクト）を暗号化する。毎回ちがう iv（使い捨ての乱数）を使う */
async function encryptJson(value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, lockState.key, bytes);
  return { enc: 1, iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(encrypted)) };
}

/** 暗号文を元のデータに戻す。鍵がちがうと例外になる */
async function decryptJson(box, key) {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(box.iv) },
    key || lockState.key,
    base64ToBytes(box.data)
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}


/* ===========================================================
   2. 保存・読み込みの出入り口（04 から呼ばれる）
   =========================================================== */

/** 保存する直前に呼ぶ。暗号化がオンなら暗号文にして返す。'lock' の箱はそのまま */
async function encryptForStorage(name, content) {
  if (name === 'lock' || !lockState.enabled || !lockState.key) {
    return content;
  }
  return encryptJson(content);
}

/** 読み込んだ直後に呼ぶ。暗号文なら元に戻して返す。そうでなければそのまま */
async function decryptFromStorage(data) {
  if (data && data.enc === 1) {
    if (!lockState.key) {
      throw new Error('鍵がありません');
    }
    return decryptJson(data);
  }
  return data;
}

/** 保存先の 'lock' の箱の中身 */
function currentLockDocument() {
  return { v: 1, salt: lockState.salt, iter: lockState.iter, check: lockState.check };
}

/** 保存先に 'lock' の箱があったとき、その内容を取り込む（別の端末でパスフレーズが変わったら鍵を捨てる） */
function adoptLockSettings(lockDocument) {
  const changed = lockState.salt !== lockDocument.salt;
  lockState.enabled = true;
  lockState.salt = lockDocument.salt;
  lockState.iter = lockDocument.iter || 600000;
  lockState.check = lockDocument.check;
  if (changed) {
    lockState.key = null;
  }
}

/** ロックの情報をすべて忘れる（ロックがオフになったとき） */
function forgetLock() {
  lockState.enabled = false;
  lockState.key = null;
  lockState.salt = '';
  lockState.check = null;
}


/* ===========================================================
   3. ロック中の画面
   =========================================================== */

/** ロック状態にして、パスフレーズを求める */
function enterLockedState() {
  appState.locked = true;
  appState.profile = null;
  appState.monthly = {};
  rebuildIndexes();
  closeAllDialogsExcept('lockDialog');
  renderApp();
  openLockDialog();
}

function closeAllDialogsExcept(keepId) {
  for (const dialog of findAll('dialog')) {
    if (dialog.id !== keepId && dialog.open) {
      dialog.close();
    }
  }
}

function openLockDialog() {
  const dialog = findOne('#lockDialog');
  findOne('#lockPassphrase').value = '';
  findOne('#lockError').textContent = '';
  isForgetWipeConfirmOpen = false;
  findOne('#lockForgetConfirm').hidden = true;
  if (!dialog.open) {
    dialog.showModal();
  }
  setTimeout(() => findOne('#lockPassphrase').focus(), 30);
}

/** ロック中に #screen に出す内容 */
function lockedScreenHtml() {
  return '<section class="card"><div class="empty-note">' +
    '<p><strong>暗号化ロック中です</strong></p>' +
    '<p>パスフレーズを入れると家計簿が開きます。</p>' +
    '<p style="margin-top:12px"><button type="button" class="btn primary" data-action="open-lock-dialog">パスフレーズを入れる</button></p>' +
    '</div></section>';
}


/* ===========================================================
   4. ロックを解除する
   =========================================================== */

async function unlockFromDialog() {
  const passphrase = findOne('#lockPassphrase').value;
  const errorArea = findOne('#lockError');
  const button = findOne('#lockSubmit');
  if (passphrase === '') {
    errorArea.textContent = 'パスフレーズを入れてください。';
    return;
  }
  button.disabled = true;
  errorArea.textContent = '確認しています…';

  // 打ったままのものと、全角・半角をそろえたものを順に試す
  let foundKey = null;
  for (const candidate of passphraseCandidates(passphrase)) {
    try {
      const key = await deriveKey(candidate, lockState.salt, lockState.iter);
      // パスフレーズが合っているかを、確認用の暗号文で確かめる
      const proof = await decryptJson(lockState.check, key);
      if (proof && proof.ok === 'mamecho') {
        foundKey = key;
        break;
      }
    } catch (error) {
      // 合わなかった。次の候補を試す
    }
  }
  if (!foundKey) {
    errorArea.textContent = 'パスフレーズが違います。大文字・小文字や記号も区別します。';
    button.disabled = false;
    return;
  }
  lockState.key = foundKey;

  try {
    if (appState.storageMode === 'cloud') {
      if (!cloud.heldDocs) {
        await loadHeldDocsFromCloud();
      }
      await applyCloudDocuments(cloud.heldDocs || []);
    } else if (browserStore.heldEnc) {
      const body = await decryptJson(browserStore.heldEnc);
      appState.profile = normalizeProfile(body.profile);
      appState.monthly = body.monthly || {};
      browserStore.heldEnc = null;
      appState.locked = false;
      finishLoading();
    }
  } catch (error) {
    console.warn('unlock error', error);
    lockState.key = null;
    errorArea.textContent = 'データを読み取れませんでした。';
    button.disabled = false;
    return;
  }

  button.disabled = false;
  findOne('#lockDialog').close();
  startIdleTimer();
  showToast('ロックを解除しました');
}

/** 「いますぐロックする」 */
async function lockNow() {
  if (!lockState.enabled || appState.locked) {
    return;
  }
  stopIdleTimer();
  // 書き込み中のデータがあれば、終わるのを少し待つ（最大3秒）
  for (let waited = 0; waited < 30 && cloud.writingNow.size > 0; waited++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // ロック前の暗号文を持ち直す（もう一度解除できるように）
  if (appState.storageMode === 'cloud') {
    await loadHeldDocsFromCloud();
  } else {
    try {
      const saved = JSON.parse(localStorage.getItem(BROWSER_STORAGE_KEY) || 'null');
      browserStore.heldEnc = saved && saved.enc ? saved.enc : null;
    } catch (error) {
      browserStore.heldEnc = null;
    }
  }
  lockState.key = null;
  enterLockedState();
}

/** クラウドの暗号文をもう一度読み直して、ロック中に保持する */
async function loadHeldDocsFromCloud() {
  try {
    const snapshot = await cloud.db.collection(cloud.basePath).get();
    cloud.heldDocs = snapshot.docs.map((documentSnapshot) => ({
      name: documentSnapshot.id,
      data: JSON.parse(JSON.stringify(documentSnapshot.data() || {})),
    }));
  } catch (error) {
    cloud.heldDocs = null;
    console.warn('reload error', error);
  }
}


/* ===========================================================
   5. 自動ロック（操作がないまましばらくたったら）
   =========================================================== */

function startIdleTimer() {
  stopIdleTimer();
  if (!lockState.enabled || !lockState.key) {
    return;
  }
  idleTimer = setTimeout(() => {
    showToast('操作がなかったため、自動でロックしました');
    lockNow();
  }, AUTO_LOCK_MINUTES * 60 * 1000);
}

function stopIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = null;
}

/** 操作があったらタイマーをやり直す */
function noteActivity() {
  if (idleTimer !== null) {
    startIdleTimer();
  }
}


/* ===========================================================
   6. ロックをオンにする・オフにする（設定画面から）
   =========================================================== */

/** 新しいパスフレーズが使えるかを調べる。使えなければ理由の文、使えれば '' */
function passphraseProblem(text) {
  if (String(text || '').length < MIN_PASSPHRASE_LENGTH) {
    return 'パスフレーズは' + MIN_PASSPHRASE_LENGTH + '文字以上にしてください。';
  }
  return '';
}

/**
 * 使えるけれど、当てられやすいパスフレーズへの注意。なければ ''。
 * （暗号そのものは破れなくても、パスフレーズが弱いと「当てずっぽう」で開けられてしまうため）
 */
function passphraseWarning(text) {
  const value = String(text || '');
  if (value.length < RECOMMENDED_PASSPHRASE_LENGTH) {
    return RECOMMENDED_PASSPHRASE_LENGTH + '文字より短いパスフレーズは、暗号文を盗まれたときに当てられやすくなります。';
  }
  if (new Set(value).size <= 2) {
    return '同じ文字のくり返しは当てられやすいです。';
  }
  if (/^[0-9]+$/.test(value)) {
    return '数字だけのパスフレーズは当てられやすいです。';
  }
  return '';
}

/**
 * ロックを解除するときに試すパスフレーズの候補。
 * 打ったままのものに加えて、全角・半角をそろえたもの（NFKC）も試す
 * （iPhone の日本語キーボードで、数字や英字が全角になってしまったときのため）。
 */
function passphraseCandidates(text) {
  const raw = String(text || '');
  const list = [raw, raw.normalize('NFKC'), raw.normalize('NFC')];
  const unique = [];
  for (const item of list) {
    if (!unique.includes(item)) {
      unique.push(item);
    }
  }
  return unique;
}

async function enableLockFromForm() {
  const first = findOne('#lockNewPassphrase').value;
  const second = findOne('#lockNewPassphrase2').value;
  const errorArea = findOne('#lockSetupError');
  const button = findOne('#lockEnableButton');

  if (appState.isSample) {
    errorArea.textContent = 'サンプル表示中は設定できません。先に「自分の家計簿をはじめる」を押してください。';
    return;
  }
  const problem = passphraseProblem(first);
  if (problem) {
    errorArea.textContent = problem;
    return;
  }
  // 当てられやすいパスフレーズは、注意を見せて、もう一度押されたら使う
  const warning = passphraseWarning(first);
  if (warning && weakPassphraseAcknowledged !== first) {
    weakPassphraseAcknowledged = first;
    errorArea.textContent = warning + 'このまま使うときは、もう一度「暗号化ロックをオンにする」を押してください。';
    return;
  }
  weakPassphraseAcknowledged = '';
  if (first !== second) {
    errorArea.textContent = '2回入れたパスフレーズが一致しません。';
    return;
  }
  if (!window.crypto || !crypto.subtle) {
    errorArea.textContent = 'この環境では暗号化を使えません。';
    return;
  }
  button.disabled = true;
  errorArea.textContent = '鍵を作っています…（数秒かかります）';

  try {
    const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
    // 全角・半角をそろえてから鍵を作る（あとでどちらで打っても開けるように）
    const key = await deriveKey(first.normalize('NFKC'), salt, 600000);
    lockState.salt = salt;
    lockState.iter = 600000;
    lockState.key = key;
    lockState.enabled = true;
    lockState.justEnabledAt = Date.now();
    lockState.check = await encryptJson({ ok: 'mamecho' });
  } catch (error) {
    forgetLock();
    errorArea.textContent = '暗号化の準備に失敗しました。';
    button.disabled = false;
    console.warn('enable lock error', error);
    return;
  }

  // 保存し直す: 先に鍵の情報、そのあと全データを暗号化して書き直す
  if (appState.storageMode === 'cloud') {
    queueCloudWrite('lock', currentLockDocument());
    queueCloudWrite('profile', appState.profile);
    for (const month of Object.keys(appState.monthly)) {
      queueCloudWrite('m-' + month, { month: month, items: appState.monthly[month] });
    }
  } else {
    saveToBrowser();
  }
  button.disabled = false;
  startIdleTimer();
  renderApp();
  showToast('暗号化ロックをオンにしました。パスフレーズは忘れないでください');
}

async function disableLockConfirmed() {
  isDisableLockConfirmOpen = false;
  stopIdleTimer();
  // 先にロックをオフにする → このあとの書き込みは暗号化されずに保存される
  lockState.enabled = false;
  lockState.justDisabledAt = Date.now();
  if (appState.storageMode === 'cloud') {
    queueCloudWrite('profile', appState.profile);
    for (const month of Object.keys(appState.monthly)) {
      queueCloudWrite('m-' + month, { month: month, items: appState.monthly[month] });
    }
    queueCloudWrite('lock', null);   // 最後に鍵の情報を消す
  } else {
    saveToBrowser();
  }
  forgetLock();
  renderApp();
  showToast('暗号化ロックをオフにしました');
}

/** 「パスフレーズを忘れた」: 暗号化されたデータを削除して、新しく始める */
function wipeEncryptedData() {
  if (appState.storageMode === 'cloud') {
    const names = new Set(['lock', 'profile']);
    for (const entry of cloud.heldDocs || []) {
      names.add(entry.name);
    }
    for (const name of names) {
      queueCloudWrite(name, null);
    }
    cloud.heldDocs = null;
  } else {
    try {
      localStorage.removeItem(BROWSER_STORAGE_KEY);
    } catch (error) {
      // 何もしない
    }
    browserStore.heldEnc = null;
  }
  forgetLock();
  appState.locked = false;
  appState.profile = createEmptyProfile();
  appState.monthly = {};
  appState.isSample = false;
  findOne('#lockDialog').close();
  saveChanges([], true);
  finishLoading();
  showToast('データを削除して、新しい家計簿にしました');
}


/* ===========================================================
   7. 設定画面の「セキュリティ」カード
   =========================================================== */

function lockCardHtml() {
  let html = '<section class="card span-12">';
  html += '<div class="card-head"><h2>セキュリティ</h2><span class="sub">暗号化ロック</span></div>';

  html += '<p class="small">パスフレーズで家計簿のデータを暗号化します。オンにすると、保存先にあるデータは暗号文になり、<strong>パスフレーズを知っている人しか読めません</strong>' +
    '（サービスの運営側やページの作者にも読めません）。開くたびにパスフレーズが必要になり、' + AUTO_LOCK_MINUTES + '分操作しないと自動でロックします。</p>';

  if (!lockState.enabled) {
    html += '<div class="lock-form">' +
      '<label class="field"><span>パスフレーズ（' + MIN_PASSPHRASE_LENGTH + '文字以上。' + RECOMMENDED_PASSPHRASE_LENGTH + '文字以上・単語を4つつなげるのがおすすめ）</span><input type="password" id="lockNewPassphrase" autocomplete="new-password"></label>' +
      '<label class="field"><span>もう一度</span><input type="password" id="lockNewPassphrase2" autocomplete="new-password"></label>' +
      '<button type="button" class="btn primary" id="lockEnableButton" data-action="enable-lock">暗号化ロックをオンにする</button></div>';
    html += '<p class="form-error" id="lockSetupError" role="alert"></p>';
  } else {
    html += '<p style="margin-top:10px">' + statusChipHtml('good', '暗号化ロック オン') + '</p>';
    html += '<div class="row-gap" style="margin-top:12px"><button type="button" class="btn" data-action="lock-now">いますぐロックする</button>';
    if (!isDisableLockConfirmOpen) {
      html += '<button type="button" class="btn ghost danger-text" data-action="disable-lock">ロックをオフにする</button>';
    }
    html += '</div>';
    if (isDisableLockConfirmOpen) {
      html += '<div class="confirm-box" style="margin-top:12px"><p>暗号化をやめて、データを元の（暗号化されない）形で保存し直します。</p>' +
        '<div class="row-gap"><button type="button" class="btn danger" data-action="disable-lock-yes">オフにする</button>' +
        '<button type="button" class="btn ghost" data-action="disable-lock-no">やめる</button></div></div>';
    }
  }

  html += '<ul class="plain-list" style="margin-top:14px">' +
    '<li><span class="grow"><span style="white-space:normal"><strong>パスフレーズを忘れると、だれにもデータを元に戻せません。</strong></span>' +
    '<span class="small muted" style="white-space:normal">忘れても復元する方法はありません。紙などに控えておくことをおすすめします。</span></span></li>' +
    '<li><span class="grow"><span style="white-space:normal">書き出したCSVやバックアップのファイルは、暗号化されません。</span>' +
    '<span class="small muted" style="white-space:normal">ファイルの保管場所に気をつけてください。</span></span></li>' +
    '<li><span class="grow"><span style="white-space:normal">「AIのふり返り」を使ったときは、集計した数字だけが Claude に送られます。</span>' +
    '<span class="small muted" style="white-space:normal">お店の名前やメモは送りません。使いたくなければ、ボタンを押さなければ送られません。</span></span></li>' +
    '</ul>';
  html += '</section>';
  return html;
}

/** ロックの画面まわりのボタンを登録する（アプリ起動時に1回だけ） */
function setupLockDialog() {
  findOne('#lockForm').addEventListener('submit', (event) => {
    event.preventDefault();
    unlockFromDialog();
  });
  // Escape キーで閉じられないようにする（ロック中は閉じさせない）
  findOne('#lockDialog').addEventListener('cancel', (event) => event.preventDefault());

  for (const eventName of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(eventName, noteActivity, { passive: true });
  }
}
