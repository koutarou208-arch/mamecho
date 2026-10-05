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
let idleTimer = null;
let biometricAutoTried = false;   // このロック画面で、自動の Face ID をもう出したか（アプリを裏に回すと、また出せる）
let biometricInProgress = false;  // Face ID で確かめている最中か（重ねて出さない）


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
  forgetBiometricPending(); // Face ID 登録の途中だったら、確認ずみのパスフレーズも忘れる
  appState.locked = true;
  appState.profile = null;
  appState.monthly = {};
  rebuildIndexes();
  closeAllDialogsExcept('lockDialog');
  renderApp();
  biometricAutoTried = false;
  openLockDialog();
}

function closeAllDialogsExcept(keepId) {
  for (const dialog of findAll('dialog')) {
    if (dialog.id !== keepId && dialog.open) {
      dialog.close();
    }
  }
}

/**
 * ロック画面を出す。
 * この端末に Face ID を登録してあれば、Face ID を大きなボタンで出して、自動で Face ID を始める。
 */
function openLockDialog() {
  const dialog = findOne('#lockDialog');
  findOne('#lockPassphrase').value = '';
  findOne('#lockError').textContent = '';
  findOne('#lockFaceIdStatus').textContent = '';
  resetForgetConfirm();
  const canUseBiometric = biometricUsableNow();
  findOne('#lockFaceIdArea').hidden = !canUseBiometric;
  findOne('#lockPassphraseLead').hidden = canUseBiometric;
  // Face ID が出ないときは、その理由を出す（Claude の中・未登録・使えない端末）
  const hint = findOne('#lockFaceIdHint');
  hint.textContent = BIOMETRIC_STATUS_HINTS[biometricStatusHere()] || '';
  hint.hidden = canUseBiometric || hint.textContent === '';
  // Face ID があるときは Face ID が主役。パスフレーズの「開く」は控えめにする
  findOne('#lockSubmit').classList.toggle('primary', !canUseBiometric);
  if (!dialog.open) {
    dialog.showModal();
  }
  if (canUseBiometric) {
    startBiometricAutomatically();
  } else {
    setTimeout(() => findOne('#lockPassphrase').focus(), 30); // Face ID が使えるときは、キーボードを出さない
  }
}

/** 「パスフレーズを忘れたとき」の削除の確認を、閉じた状態に戻す */
function resetForgetConfirm() {
  findOne('#lockForgetDetails').open = false;
  findOne('#lockForgetConfirm').hidden = true;
  findOne('#lockForgetWord').value = '';
  findOne('#lockForgetYes').disabled = true;
}

/** ロック中に #screen に出す内容 */
function lockedScreenHtml() {
  return '<section class="card"><div class="empty-note">' +
    '<p><strong>暗号化ロック中です</strong></p>' +
    '<p>' + (biometricUsableNow() ? 'Face ID かパスフレーズで開きます。' : 'パスフレーズを入れると家計簿が開きます。') + '</p>' +
    '<p style="margin-top:12px"><button type="button" class="btn primary" data-action="open-lock-dialog">ロックを解除する</button></p>' +
    '</div></section>';
}


/* ===========================================================
   4. ロックを解除する
   =========================================================== */

async function unlockFromDialog() {
  const passphrase = findOne('#lockPassphrase').value;
  if (passphrase === '') {
    findOne('#lockError').textContent = 'パスフレーズを入れてください。';
    return;
  }
  await unlockWithPassphrase(passphrase);
}

/**
 * パスフレーズでロックを解除する（パスフレーズの入力からも、Face ID からも使う）。開けたら true。
 *   openedWithBiometric … Face ID から呼ばれたときは true（そのときは Face ID をおすすめしない）
 */
async function unlockWithPassphrase(passphrase, openedWithBiometric) {
  const errorArea = findOne('#lockError');
  const button = findOne('#lockSubmit');
  button.disabled = true;
  errorArea.textContent = '確認しています…';

  // 打ったままのものと、全角・半角をそろえたものを順に試す
  let foundKey = null;
  let foundPassphrase = '';
  for (const candidate of passphraseCandidates(passphrase)) {
    try {
      const key = await deriveKey(candidate, lockState.salt, lockState.iter);
      // パスフレーズが合っているかを、確認用の暗号文で確かめる
      const proof = await decryptJson(lockState.check, key);
      if (proof && proof.ok === 'mamecho') {
        foundKey = key;
        foundPassphrase = candidate;
        break;
      }
    } catch (error) {
      // 合わなかった。次の候補を試す
    }
  }
  if (!foundKey) {
    errorArea.textContent = 'パスフレーズが違います。大文字・小文字や記号も区別します。';
    button.disabled = false;
    return false;
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
    return false;
  }

  button.disabled = false;
  findOne('#lockDialog').close();
  startIdleTimer();
  // パスフレーズで開いたとき: この端末で Face ID が使えて、まだ登録していなければ、登録をすすめる
  const offer = shouldOfferBiometric({
    available: biometricAvailableHere(),
    registered: biometricRecordUsable(loadBiometricRecord(), lockState.salt),
    dismissed: biometricOfferDismissed(),
    openedWithBiometric: Boolean(openedWithBiometric),
  });
  if (offer) {
    biometricState.pendingPassphrase = foundPassphrase; // 登録が終わるか、やめるか、ロックしたらすぐ忘れる
    biometricState.step = 'ready';
    biometricState.message = '';
    biometricState.offerAfterUnlock = true;
    renderApp();
  }
  showToast('ロックを解除しました');
  return true;
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
  if (biometricAvailableHere()) {
    // 打ったばかりのパスフレーズで、そのまま Face ID を登録できるようにする（もう一度打たなくてよい）
    biometricState.pendingPassphrase = first.normalize('NFKC');
    biometricState.step = 'ready';
    biometricState.message = '続けて「Face ID を登録する」を押すと、次から Face ID で開けます。';
  }
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
  forgetBiometric();
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
  forgetBiometric();
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
    const status = biometricStatusHere();
    if (status === 'not-registered') {
      html += '<p class="hint" style="margin-top:6px">オンにすると、続けて Face ID も登録できます（この端末で、開くときに Face ID が出ます）。</p>';
    } else if (status === 'claude') {
      html += '<p class="hint" style="margin-top:6px">' + BIOMETRIC_STATUS_HINTS.claude + '</p>';
    }
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
    html += biometricSectionHtml();
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

  // 「パスフレーズを忘れたとき」: 「削除」と入力したときだけ、消すボタンを押せるようにする
  findOne('#lockForgetWord').addEventListener('input', (event) => {
    findOne('#lockForgetYes').disabled = !isDeleteWordTyped(event.target.value);
  });

  // アプリを裏に回して、また開いたとき: ロック中なら、もう一度自動で Face ID を出す
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      biometricAutoTried = false;
    } else {
      startBiometricAutomatically();
    }
  });

  for (const eventName of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(eventName, noteActivity, { passive: true });
  }
}


/* ===========================================================
   8. Face ID（顔認証）・指紋で開く
   -----------------------------------------------------------
   しくみ:
     ・スマホの「パスキー」（Face ID で守られた鍵）を1つ作る。
     ・パスキーの PRF という機能で、Face ID を通ったときだけ取り出せる「秘密の数」をもらう。
     ・その秘密の数から作った鍵で、パスフレーズを暗号化して、この端末にだけ保存する。
     ・開くとき: Face ID → 秘密の数 → パスフレーズを元に戻す → いつもどおりパスフレーズで開く。
   ・Face ID を通らないと、パスフレーズは元に戻せません（ほかのサイトやアプリからも使えません）。
   ・保存はこの端末のこのアプリの中だけ。バックアップやほかの端末には入りません。
   ・Claude の中では使えません（ホーム画面のまめ帳で使う）。iPhone は iOS 18 以降。
   =========================================================== */

const BIOMETRIC_STORAGE_KEY = 'mamecho-biometric-v1';

// 設定画面での登録の途中経過（保存しない）
const biometricState = {
  step: '',                 // '' / 'ready'（パスフレーズ確認ずみ） / 'confirm'（最後の Face ID 待ち）
  pendingPassphrase: '',    // 確認ずみのパスフレーズ（登録が終わったらすぐ消す）
  pendingCredentialId: '',  // 作ったパスキーのID
  pendingPrfSalt: '',       // 秘密の数を取り出すときの「まぜもの」
  message: '',
  offerAfterUnlock: false,  // パスフレーズで開いたあとに「Face ID を使いますか？」を出しているか
};

/** Face ID が使える場所か（WebAuthn がある・Claude の中ではない・https） */
function biometricEnvironmentOk(hasWebAuthn, inClaude, isSecure) {
  return Boolean(hasWebAuthn) && !inClaude && Boolean(isSecure);
}

function biometricAvailableHere() {
  return biometricEnvironmentOk(
    Boolean(window.PublicKeyCredential && navigator.credentials),
    Boolean(window.claude),
    Boolean(window.isSecureContext)
  );
}

/**
 * Face ID の状態を1つのことばで返す（ロック画面で、出ない理由を説明するため）。
 *   'ready'          … この端末で Face ID で開ける
 *   'claude'         … Claude の中で開いている（Face ID はホーム画面のまめ帳で使う）
 *   'not-registered' … 使える端末だが、この端末ではまだ登録していない
 *   'unsupported'    … この端末・ブラウザでは使えない
 */
function biometricStatusOf(inClaude, available, registered) {
  if (inClaude) {
    return 'claude';
  }
  if (!available) {
    return 'unsupported';
  }
  if (!registered) {
    return 'not-registered';
  }
  return 'ready';
}

// ロック画面で Face ID が出ないときに、理由として出すことば
const BIOMETRIC_STATUS_HINTS = {
  claude: 'Face ID は、ホーム画面のまめ帳（猫のアイコン）で開いたときに使えます。Claude の中では使えません。',
  'not-registered': 'この端末では、まだ Face ID を登録していません。パスフレーズで開くと、すぐ登録できます。',
  unsupported: 'この端末・ブラウザでは Face ID を使えません（iPhone は iOS 18 以降）。',
};

/** 今の端末の Face ID の状態（biometricStatusOf を参照） */
function biometricStatusHere() {
  return biometricStatusOf(Boolean(window.claude), biometricAvailableHere(), biometricRecordUsable(loadBiometricRecord(), lockState.salt));
}

/**
 * パスフレーズで開いたあとに「次から Face ID で開けるようにしますか？」と聞くか。
 *   conditions = { available: Face ID が使える場所か, registered: 登録ずみか,
 *                  dismissed: 「今はしない」を押したか, openedWithBiometric: Face ID で開いたか }
 */
function shouldOfferBiometric(conditions) {
  return Boolean(conditions.available && !conditions.registered && !conditions.dismissed && !conditions.openedWithBiometric);
}

// 「今はしない」を押したことを、この端末に覚えておく（家計簿のデータとは別）
const BIOMETRIC_OFFER_DISMISSED_KEY = 'mamecho-faceid-offer-dismissed';

function biometricOfferDismissed() {
  try {
    return localStorage.getItem(BIOMETRIC_OFFER_DISMISSED_KEY) === '1';
  } catch (error) {
    return false;
  }
}

function dismissBiometricOffer() {
  try {
    localStorage.setItem(BIOMETRIC_OFFER_DISMISSED_KEY, '1');
  } catch (error) {
    // 覚えられない環境では、次に開いたときにまた聞くだけ
  }
  forgetBiometricPending();
}

/** パスフレーズで開いたあとに、画面の上に出す「Face ID を使いますか？」（出さないときは空） */
function biometricOfferHtml() {
  if (!biometricState.offerAfterUnlock || appState.locked) {
    return '';
  }
  let buttons = '';
  if (biometricState.step === 'ready') {
    buttons = '<button type="button" class="btn primary small" data-action="biometric-register" data-icon="face">Face ID を使う</button>';
  } else if (biometricState.step === 'confirm') {
    buttons = '<button type="button" class="btn primary small" data-action="biometric-confirm" data-icon="face">Face ID で確認する</button>';
  } else {
    return '';
  }
  let html = '<div class="banner"><p><strong>次から Face ID で開けるようにしますか？</strong>この端末だけで使います。</p>';
  if (biometricState.message) {
    html += '<p class="small">' + escapeHtml(biometricState.message) + '</p>';
  }
  html += '<div class="row-gap">' + buttons + '<button type="button" class="btn ghost small" data-action="biometric-offer-dismiss">今はしない</button></div></div>';
  return html;
}

/** この端末で、今のロックを Face ID で開けるか（使える場所で、登録の記録が今のロックのもの） */
function biometricUsableNow() {
  return biometricAvailableHere() && biometricRecordUsable(loadBiometricRecord(), lockState.salt);
}

/**
 * 自動で Face ID を出してよいか。
 *   conditions = {
 *     usable: この端末で Face ID が使えるか, locked: ロック中か, dialogOpen: ロック画面が出ているか,
 *     visible: アプリが画面に出ているか, alreadyTried: このロック画面でもう出したか, inProgress: 確認中か
 *   }
 * 1回やめたら勝手にくり返さない（アプリを裏に回してまた開くと、もう一度出す）。
 */
function shouldAutoStartBiometric(conditions) {
  return Boolean(conditions.usable && conditions.locked && conditions.dialogOpen && conditions.visible &&
    !conditions.alreadyTried && !conditions.inProgress);
}

/** ロック画面が出たとき・アプリをまた開いたときに、自動で Face ID を始める */
function startBiometricAutomatically() {
  const allowed = shouldAutoStartBiometric({
    usable: biometricUsableNow(),
    locked: appState.locked,
    dialogOpen: findOne('#lockDialog').open,
    visible: document.visibilityState === 'visible',
    alreadyTried: biometricAutoTried,
    inProgress: biometricInProgress,
  });
  if (!allowed) {
    return;
  }
  biometricAutoTried = true;
  // 画面が出そろってから始める
  setTimeout(() => unlockWithBiometric(true), 250);
}

/** この端末に保存した Face ID の記録が、今のロックで使えるか */
function biometricRecordUsable(record, lockSalt) {
  if (!record || !record.credentialId || !record.prfSalt || !record.iv || !record.data) {
    return false;
  }
  return record.lockSalt === lockSalt;
}

function loadBiometricRecord() {
  try {
    return JSON.parse(localStorage.getItem(BIOMETRIC_STORAGE_KEY) || 'null');
  } catch (error) {
    return null;
  }
}

function forgetBiometric() {
  try {
    localStorage.removeItem(BIOMETRIC_STORAGE_KEY);
  } catch (error) {
    // 何もしない
  }
  biometricState.step = '';
  biometricState.pendingPassphrase = '';
  biometricState.pendingCredentialId = '';
  biometricState.pendingPrfSalt = '';
}

/** 登録の途中でやめる（確認ずみのパスフレーズもすぐ忘れる） */
function forgetBiometricPending() {
  biometricState.step = '';
  biometricState.pendingPassphrase = '';
  biometricState.pendingCredentialId = '';
  biometricState.pendingPrfSalt = '';
  biometricState.message = '';
  biometricState.offerAfterUnlock = false;
}

/** 秘密の数（PRF）から、パスフレーズを守る鍵を作る */
async function keyFromPrf(prfBytes) {
  const material = await crypto.subtle.importKey('raw', prfBytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('mamecho-faceid-v1') },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Face ID を通して、秘密の数をもらう */
async function biometricPrf(credentialIdBase64, prfSaltBase64) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: base64ToBytes(credentialIdBase64) }],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: base64ToBytes(prfSaltBase64) } } },
    },
  });
  const results = assertion.getClientExtensionResults();
  if (!results.prf || !results.prf.results || !results.prf.results.first) {
    throw new Error('prf_unsupported');
  }
  return new Uint8Array(results.prf.results.first);
}

/** 失敗の理由を、画面に出すことばにする */
function biometricErrorMessage(error) {
  if (error && error.name === 'NotAllowedError') {
    return 'Face ID がキャンセルされたか、時間切れになりました。';
  }
  if (error && error.message === 'prf_unsupported') {
    return 'この端末では使えません（iPhone は iOS 18 以降の、ホーム画面のまめ帳で使えます）。';
  }
  return 'Face ID の登録・確認に失敗しました。';
}

/** 登録 1: パスフレーズが正しいか確かめる */
async function biometricCheckPassphrase() {
  const input = findOne('#biometricPassphrase');
  const passphrase = input ? input.value : '';
  biometricState.message = '確認しています…';
  renderApp();
  for (const candidate of passphraseCandidates(passphrase)) {
    try {
      const key = await deriveKey(candidate, lockState.salt, lockState.iter);
      const proof = await decryptJson(lockState.check, key);
      if (proof && proof.ok === 'mamecho') {
        biometricState.pendingPassphrase = candidate;
        biometricState.step = 'ready';
        biometricState.message = 'パスフレーズを確認しました。「Face ID を登録する」を押してください。';
        renderApp();
        return;
      }
    } catch (error) {
      // 次の候補へ
    }
  }
  biometricState.message = 'パスフレーズが違います。';
  renderApp();
}

/** 登録 2: パスキーを作る（ボタンを押してすぐ Face ID を出す） */
async function biometricRegister() {
  const prfSalt = crypto.getRandomValues(new Uint8Array(32));
  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        rp: { name: 'まめ帳', id: location.hostname },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'まめ帳', displayName: 'まめ帳' },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
        timeout: 60000,
        extensions: { prf: { eval: { first: prfSalt } } },
      },
    });
    const results = credential.getClientExtensionResults();
    biometricState.pendingCredentialId = bytesToBase64(new Uint8Array(credential.rawId));
    biometricState.pendingPrfSalt = bytesToBase64(prfSalt);
    if (results.prf && results.prf.results && results.prf.results.first) {
      await biometricFinish(new Uint8Array(results.prf.results.first));
      return;
    }
    if (results.prf && results.prf.enabled === false) {
      throw new Error('prf_unsupported');
    }
    // 作ったときに秘密の数が出ない端末では、もう一度 Face ID を通してもらう
    biometricState.step = 'confirm';
    biometricState.message = '最後に、もう一度 Face ID で確認してください。';
  } catch (error) {
    biometricState.message = biometricErrorMessage(error);
    if (error && error.message === 'prf_unsupported') {
      // この端末では使えないので、開くたびに聞かないようにする
      dismissBiometricOffer();
      showToast(biometricErrorMessage(error));
    }
  }
  renderApp();
}

/** 登録 3（必要な端末だけ）: もう一度 Face ID を通して、秘密の数をもらう */
async function biometricConfirm() {
  try {
    const prf = await biometricPrf(biometricState.pendingCredentialId, biometricState.pendingPrfSalt);
    await biometricFinish(prf);
    return;
  } catch (error) {
    biometricState.message = biometricErrorMessage(error);
  }
  renderApp();
}

/** 秘密の数でパスフレーズを暗号化して、この端末に保存する */
async function biometricFinish(prf) {
  const key = await keyFromPrf(prf);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(biometricState.pendingPassphrase));
  const record = {
    v: 1,
    credentialId: biometricState.pendingCredentialId,
    prfSalt: biometricState.pendingPrfSalt,
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
    lockSalt: lockState.salt,
    createdAt: Date.now(),
  };
  localStorage.setItem(BIOMETRIC_STORAGE_KEY, JSON.stringify(record));
  biometricState.step = '';
  biometricState.pendingPassphrase = '';
  biometricState.message = '';
  biometricState.offerAfterUnlock = false;
  renderApp();
  showToast('次から Face ID で開けます');
}

/**
 * ロック画面の「Face ID で開く」。ロック画面が出たときは自動でも呼ばれる（automatic が true）。
 */
async function unlockWithBiometric(automatic) {
  if (biometricInProgress || !appState.locked) {
    return; // もう確認中か、もう開いている
  }
  const record = loadBiometricRecord();
  const status = findOne('#lockFaceIdStatus');
  if (!biometricRecordUsable(record, lockState.salt)) {
    findOne('#lockError').textContent = 'この端末では Face ID が登録されていません。パスフレーズを入れてください。';
    return;
  }
  biometricInProgress = true;
  status.textContent = 'Face ID で確認しています…';
  let passphrase = '';
  try {
    const prf = await biometricPrf(record.credentialId, record.prfSalt);
    const key = await keyFromPrf(prf);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(record.iv) }, key, base64ToBytes(record.data));
    passphrase = new TextDecoder().decode(decrypted);
  } catch (error) {
    biometricInProgress = false;
    // 自動のときは、本人がやめたとは限らないので、責めない言い方にする
    status.textContent = automatic ? '上のボタンを押すと Face ID で開けます。' : biometricErrorMessage(error) + 'もう一度ボタンを押すか、パスフレーズで開けます。';
    return;
  }
  biometricInProgress = false;
  status.textContent = '';
  const opened = await unlockWithPassphrase(passphrase, true);
  if (!opened) {
    findOne('#lockError').textContent = 'Face ID の記録が古くなっています。パスフレーズで開いて、設定で登録し直してください。';
  }
}

/** 設定画面の「Face ID で開く」の欄 */
function biometricSectionHtml() {
  let html = '<div class="biometric-box" style="margin-top:16px">';
  html += '<p><strong>Face ID・指紋で開く</strong></p>';
  if (!biometricAvailableHere()) {
    html += '<p class="hint">' + (window.claude ? 'ホーム画面のまめ帳（アプリ版）で使えます。' : 'この端末・ブラウザでは使えません。') + '</p></div>';
    return html;
  }
  if (biometricRecordUsable(loadBiometricRecord(), lockState.salt)) {
    html += '<p class="small" style="margin-top:4px">' + statusChipHtml('good', 'この端末では Face ID で開けます') + '</p>';
    html += '<div class="row-gap" style="margin-top:8px"><button type="button" class="btn small ghost danger-text" data-action="biometric-forget">Face ID をやめる</button></div>';
    html += '<p class="hint" style="margin-top:6px">やめても、iPhone の「パスワード」アプリにパスキー（まめ帳）が残ります。いらなければそこで削除できます。</p>';
    html += '</div>';
    return html;
  }
  if (biometricState.step === '') {
    html += '<p class="small muted" style="margin-top:4px">パスフレーズの代わりに Face ID で開けるようにします（この端末だけ）。まずパスフレーズを確かめます。</p>';
    html += '<div class="lock-form"><label class="field"><span>今のパスフレーズ</span><input type="password" id="biometricPassphrase" autocomplete="current-password"></label>' +
      '<button type="button" class="btn" data-action="biometric-check">次へ</button></div>';
  } else if (biometricState.step === 'ready') {
    html += '<div class="row-gap" style="margin-top:8px"><button type="button" class="btn primary" data-action="biometric-register">Face ID を登録する</button>' +
      '<button type="button" class="btn ghost" data-action="biometric-cancel">やめる</button></div>';
  } else if (biometricState.step === 'confirm') {
    html += '<div class="row-gap" style="margin-top:8px"><button type="button" class="btn primary" data-action="biometric-confirm">Face ID で確認する</button>' +
      '<button type="button" class="btn ghost" data-action="biometric-cancel">やめる</button></div>';
  }
  if (biometricState.message) {
    html += '<p class="small" style="margin-top:8px" role="status">' + escapeHtml(biometricState.message) + '</p>';
  }
  html += '</div>';
  return html;
}

