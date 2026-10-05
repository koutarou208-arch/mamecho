/* ===========================================================
   23-app-start.js  ―  アプリの「司令塔」
   -----------------------------------------------------------
   いちばん最後に読み込まれるファイルです。
     ・画面の一覧（SCREENS）とメニュー
     ・renderApp … 今の画面を描く（データが変わるたびに呼ばれる）
     ・ACTIONS   … ボタンが押されたときに何をするかの一覧
     ・start     … アプリを起動する

   【ボタンのしくみ】
   HTMLのボタンには data-action="go" のような印が付いています。
   画面のどこかが押されると、その印の名前を ACTIONS から探して実行します。
   新しいボタンを作るときは、
     1. HTML に data-action="好きな名前" を付ける
     2. 下の ACTIONS に同じ名前で「すること」を書く
   の2つだけで動きます。
   =========================================================== */


/* ===========================================================
   1. 画面の一覧とメニュー
   =========================================================== */

// 画面の名前 → 画面ファイルで作った画面
const SCREENS = {
  home: HomeScreen,
  transactions: TransactionsScreen,
  report: ReportScreen,
  budget: BudgetScreen,
  cards: CardsScreen,
  accounts: AccountsScreen,
  takehome: TakeHomeScreen, // 22-take-home-pay.js
  settings: SettingsScreen,
};

// メニューに並べる順番とアイコン（mobile: true はスマホの下のタブにも出す）
const NAV_ITEMS = [
  { screen: 'home', label: 'ホーム', icon: 'home', mobile: true },
  { screen: 'transactions', label: '入出金', icon: 'list', mobile: true },
  { screen: 'report', label: '家計簿', icon: 'book', mobile: true },
  { screen: 'budget', label: '予算', icon: 'target', mobile: true },
  { screen: 'cards', label: 'カード', icon: 'card', mobile: true },
  { screen: 'accounts', label: '口座', icon: 'wallet', mobile: true },
  { screen: 'takehome', label: '手取り計算', icon: 'calc', mobile: false }, // スマホでは上のバーの電卓ボタン
  { screen: 'settings', label: '設定', icon: 'settings', mobile: false },
];

/** メニュー（左側とスマホの下）を作る */
function renderNavigation() {
  const sideNav = findOne('#sideNav');
  const tabBar = findOne('#tabBar');

  // ボタンは最初の1回だけ作る（押すたびに作り直すと、タップした瞬間にチカッと点滅するため）
  if (sideNav.children.length === 0) {
    let sideHtml = '';
    let tabHtml = '';
    for (const item of NAV_ITEMS) {
      sideHtml += '<button type="button" class="nav-item" data-action="go" data-screen="' + item.screen + '">' + iconSvg(item.icon) + item.label + '</button>';
      if (item.mobile) {
        tabHtml += '<button type="button" class="tab-item" data-action="go" data-screen="' + item.screen + '">' + iconSvg(item.icon) + item.label + '</button>';
      }
    }
    sideNav.innerHTML = sideHtml;
    tabBar.innerHTML = tabHtml;
  }

  // 今いる画面のボタンに印を付け替える
  for (const button of findAll('[data-screen]', sideNav).concat(findAll('[data-screen]', tabBar))) {
    if (button.dataset.screen === appState.screen) {
      button.setAttribute('aria-current', 'page');
    } else {
      button.removeAttribute('aria-current');
    }
  }

  // 下のタブの「今いる場所」の印を、選ばれたタブの位置へすべらせる
  let tabIndex = 0;
  let mobileIndex = 0;
  for (const item of NAV_ITEMS) {
    if (!item.mobile) {
      continue;
    }
    if (appState.screen === item.screen) {
      tabIndex = mobileIndex;
    }
    mobileIndex += 1;
  }
  findOne('#tabBar').style.setProperty('--tab-index', tabIndex);
}

/** data-icon="plus" のような印が付いた部品に、アイコンの絵を入れる */
function fillIcons(container) {
  for (const element of findAll('[data-icon]', container)) {
    if (!element.querySelector('svg.icon')) {
      element.insertAdjacentHTML('afterbegin', iconSvg(element.dataset.icon));
    }
  }
}


/* ===========================================================
   2. 画面を描く
   =========================================================== */

function renderApp() {
  renderNavigation();
  renderBanner();
  setSaveStatus(appState.saveStatus);

  const screenArea = findOne('#screen');

  // 暗号化ロック中: 中身は何も出さず、パスフレーズを求める
  if (appState.locked) {
    findOne('#screenTitle').textContent = 'ロック中';
    findOne('#periodBar').hidden = true;
    clearCharts();
    screenArea.innerHTML = lockedScreenHtml();
    return;
  }

  // まだデータを読み込み中
  if (!appState.profile) {
    findOne('#screenTitle').textContent = '読み込み中';
    findOne('#periodBar').hidden = true;
    screenArea.innerHTML = '<section class="card"><p class="empty-note">家計簿を読み込んでいます…<br>総資産、今月の収支、予算の進み具合がここに表示されます。</p></section>';
    return;
  }

  const screen = SCREENS[appState.screen] || HomeScreen;

  // 上のバー
  findOne('#screenTitle').textContent = screen.title;
  findOne('#periodBar').hidden = !screen.usesPeriod;
  findOne('#periodTitle').textContent = periodTitle(appState.period);
  findOne('#periodRange').textContent = periodRangeText(appState.period);
  findOne('#periodTodayButton').hidden = isCurrentPeriod(appState.period);

  // 描き直すと入力中の欄からカーソルが外れてしまうので、覚えておいて戻す
  const active = document.activeElement;
  let focusId = null;
  let selectionStart = null;
  let selectionEnd = null;
  if (active && active.id && screenArea.contains(active)) {
    focusId = active.id;
    selectionStart = active.selectionStart;
    selectionEnd = active.selectionEnd;
  }

  clearCharts();
  screenArea.innerHTML = screen.html();
  screen.afterRender();
  fillIcons(screenArea);

  if (focusId) {
    const element = document.getElementById(focusId);
    if (element) {
      element.focus();
      try {
        element.setSelectionRange(selectionStart, selectionEnd);
      } catch (error) {
        // 選択範囲が使えない部品（selectなど）は何もしない
      }
    }
  }

  // 通帳が開いていれば、そちらも最新にする
  if (findOne('#passbookDialog').open) {
    renderPassbook();
  }
}

/** 画面の上のお知らせ帯 */
function renderBanner() {
  const banner = findOne('#banner');
  if (appState.locked) {
    banner.innerHTML = '';
    return;
  }
  // 20-rules-alerts.js（制度変更のお知らせ）と、21-encryption-lock.js（パスフレーズで開いたあとの「Face ID を使いますか？」）
  const alertsHtml = biometricOfferHtml() + rulesAlertsHtml();
  if (appState.isSample) {
    banner.innerHTML = '<div class="banner"><p><strong>サンプルの家計簿を表示しています。</strong>架空の1年分のデータです。さわってみても保存はされません。</p>' +
      '<button type="button" class="btn primary small" data-action="start-own">自分の家計簿をはじめる</button></div>' + alertsHtml;
  } else if (appState.storageMode === 'memory') {
    banner.innerHTML = '<div class="banner"><p><strong>この環境では保存できません。</strong>ページを閉じると記録が消えます。設定からバックアップを保存できます。</p></div>' + alertsHtml;
  } else {
    banner.innerHTML = alertsHtml;
  }
  fillIcons(banner); // お知らせのボタンにもアイコンを入れる
}

/** 別の画面へ移る */
function goToScreen(screenName) {
  if (!SCREENS[screenName]) {
    return;
  }
  appState.screen = screenName;
  appState.budgetDraft = null;
  isWipeConfirmOpen = false;
  isDisableLockConfirmOpen = false;
  try {
    history.replaceState(null, '', '#' + screenName); // URLの最後に #cards などを付ける
  } catch (error) {
    // 使えない環境では何もしない
  }
  renderApp();
  window.scrollTo(0, 0);
}

/**
 * 月を切りかえたとき、画面の中身を横にすべらせる（透明にはしない＝点滅しない）。
 *   direction … 'next' なら右から、'previous' なら左から入ってくる
 */
function playScreenEnter(direction) {
  const screenArea = findOne('#screen');
  screenArea.classList.remove('enter-next', 'enter-previous');
  void screenArea.offsetWidth; // 同じ動きをもう一度させるためのおまじない
  screenArea.classList.add('enter-' + direction);
}

/** 期間を step だけ動かす（ボタンもスワイプもここを通る） */
function movePeriod(step) {
  appState.period = shiftPeriod(appState.period, step);
  appState.filters.date = '';
  renderApp();
  playScreenEnter(step > 0 ? 'next' : 'previous');
}

/**
 * 画面を左右になぞって、前の月・次の月へ動かせるようにする（スマホ向け）。
 * 入力欄・グラフ・横にスクロールする表の上では動かさない。
 */
function setupSwipe() {
  const screenArea = findOne('#screen');
  let startX = 0;
  let startY = 0;
  let tracking = false;

  screenArea.addEventListener('touchstart', (event) => {
    const blocked = event.target.closest('input, select, textarea, button, .chart, .scroll-x, table');
    tracking = !blocked && event.touches.length === 1;
    if (tracking) {
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    }
  }, { passive: true });

  screenArea.addEventListener('touchend', (event) => {
    if (!tracking) {
      return;
    }
    tracking = false;
    const screen = SCREENS[appState.screen];
    if (!screen || !screen.usesPeriod || appState.locked || !appState.profile) {
      return;
    }
    const touch = event.changedTouches[0];
    const step = swipeStepOf(touch.clientX - startX, touch.clientY - startY);
    if (step !== 0) {
      movePeriod(step);
    }
  }, { passive: true });
}

/** 入出金画面の絞り込みを全部外す */
function resetFilters() {
  appState.filters = { account: '', category: '', type: '', search: '', date: '' };
}


/* ===========================================================
   3. ボタンが押されたときにすること
   =========================================================== */

const ACTIONS = {
  // --- 画面の移動と期間 ---
  'go': (button) => goToScreen(button.dataset.screen),
  'change-period': (button) => movePeriod(Number(button.dataset.step)),
  'period-today': () => {
    appState.period = periodOf(todayText());
    appState.filters.date = '';
    renderApp();
  },
  'start-own': () => startOwnLedger(),

  // --- 入出金 ---
  'new-from-email': () => openTransactionDialog(null, { openNotice: true }),
  'new-trade': (button) => {
    // 株の売買の損益: 証券口座があればそれを選んでおく
    const securities = appState.profile.accounts.find((account) => account.kind === 'securities');
    const isGain = button.dataset.kind === 'gain';
    openTransactionDialog(null, {
      type: isGain ? 'income' : 'expense',
      category: isGain ? 'trade' : 'tradeLoss',
      account: securities ? securities.id : undefined,
    });
  },
  'new-transaction': (button) => openTransactionDialog(null, { account: button.dataset.account }),
  'edit-transaction': (button) => {
    const transaction = findTransaction(button.dataset.id);
    if (transaction) {
      openTransactionDialog(transaction, null);
    }
  },
  'save-transaction-next': () => saveTransactionFromDialog(true),
  'delete-transaction': () => {
    findOne('#transactionDeleteConfirm').hidden = false;
  },
  'delete-transaction-yes': () => deleteTransactionFromDialog(),
  'delete-transaction-no': () => {
    findOne('#transactionDeleteConfirm').hidden = true;
  },
  'pick-receipt': () => findOne('#receiptFile').click(),

  // --- 絞り込み ---
  'filter-category': (button) => {
    resetFilters();
    appState.filters.category = button.dataset.category;
    goToScreen('transactions');
  },
  'filter-date': (button) => {
    resetFilters();
    appState.filters.date = button.dataset.date;
    goToScreen('transactions');
  },
  'clear-date-filter': () => {
    appState.filters.date = '';
    renderApp();
  },
  'filter-type': (button) => {
    appState.filters.type = button.dataset.value;
    for (const other of findAll('[data-action="filter-type"]')) {
      other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
    }
    renderTransactionList();
  },
  'report-type': (button) => {
    appState.reportType = button.dataset.value;
    renderApp();
  },

  // --- 予算 ---
  'edit-budget': () => startBudgetEdit(),
  'fill-budget': (button) => fillBudgetDraft(button.dataset.source),
  'save-budget': () => saveBudgetDraft(),
  'cancel-budget': () => {
    appState.budgetDraft = null;
    renderApp();
  },

  // --- 口座とカード ---
  'add-account': (button) => openAccountDialog(null, button.dataset.kind),
  'edit-account': (button) => {
    const account = accountById[button.dataset.id];
    if (account) {
      openAccountDialog(account, null);
    }
  },
  'delete-account': () => askDeleteAccount(),
  'delete-account-yes': () => deleteAccountConfirmed(),
  'delete-account-no': () => {
    findOne('#accountDeleteConfirm').hidden = true;
  },
  'open-passbook': (button) => openPassbook(button.dataset.id),
  'toggle-adjust': () => {
    passbookState.adjustOpen = !passbookState.adjustOpen;
    renderPassbook();
  },
  'save-adjust': () => saveBalanceAdjustment(),
  'passbook-more': () => {
    passbookState.rowsShown = passbookState.rowsShown + 100;
    renderPassbook();
  },
  'record-bill': (button) => recordBillFromButton(button.dataset.id, button.dataset.month),
  'save-manual-bill': (button) => saveManualBillFromForm(button.dataset.id),
  'delete-manual-bill': (button) => deleteManualBillById(button.dataset.id),

  // --- 取り込み・書き出し ---
  'open-import': () => openImportDialog(),
  'import-back': () => {
    importState.step = 'choose';
    renderImport();
  },
  'import-run': () => runImport(),
  'export-csv': () => exportCsv(),
  'export-backup': () => exportBackup(),
  'show-backup-text': () => showBackupText(),
  'open-paste-restore': () => openPasteRestore(),
  'paste-restore-read': () => askRestoreFromText(findOne('#pasteBackupText').value),
  'restore-backup': () => findOne('#restoreFile').click(),
  'restore-yes': () => restoreBackupConfirmed(),
  'copy-text': () => copyTextDialogContent(),

  // --- 設定 ---
  'add-rule': () => addRuleFromForm(),
  'save-recurring': () => saveRecurringFromForm(),
  'edit-recurring': (button) => startRecurringEdit(Number(button.dataset.index)),
  'cancel-recurring': () => cancelRecurringEdit(),
  'delete-recurring': (button) => {
    deletingRecurringIndex = Number(button.dataset.index);
    renderApp();
  },
  'delete-recurring-no': () => {
    deletingRecurringIndex = null;
    renderApp();
  },
  'delete-recurring-yes': (button) => deleteRecurringConfirmed(Number(button.dataset.index)),
  'recur-from-found': (button) => startRecurringFromFound(Number(button.dataset.index)),
  'edit-rule': (button) => startRuleEdit(Number(button.dataset.index)),
  'cancel-rule-edit': () => cancelRuleEdit(),
  'delete-rule': (button) => deleteRule(Number(button.dataset.index)),
  'wipe': () => {
    isWipeConfirmOpen = true;
    renderApp();
  },
  'wipe-no': () => {
    isWipeConfirmOpen = false;
    renderApp();
  },
  'wipe-yes': () => {
    // 「削除」と入力したときだけ消す（ボタンも、入力するまで押せない）
    const word = findOne('#wipeConfirmWord');
    if (!word || !isDeleteWordTyped(word.value)) {
      return;
    }
    isWipeConfirmOpen = false;
    replaceAllData(createEmptyProfile(), {});
    showToast('すべてのデータを削除しました');
  },

  // --- 制度データのお知らせ・報告 ---
  'dismiss-rule-alerts': () => dismissRuleAlerts(),
  'copy-report': () => copyDiagnostics(),

  // --- 暗号化ロック ---
  'enable-lock': () => enableLockFromForm(),
  'lock-now': () => lockNow(),
  'open-lock-dialog': () => openLockDialog(),
  'disable-lock': () => {
    isDisableLockConfirmOpen = true;
    renderApp();
  },
  'disable-lock-no': () => {
    isDisableLockConfirmOpen = false;
    renderApp();
  },
  'disable-lock-yes': () => disableLockConfirmed(),
  'unlock-biometric': () => unlockWithBiometric(),
  'biometric-check': () => biometricCheckPassphrase(),
  'biometric-register': () => biometricRegister(),
  'biometric-offer-dismiss': () => {
    dismissBiometricOffer();
    renderApp();
    showToast('あとで「設定」→「セキュリティ」からも登録できます');
  },
  'biometric-confirm': () => biometricConfirm(),
  'biometric-cancel': () => {
    forgetBiometricPending();
    renderApp();
  },
  'biometric-forget': () => {
    forgetBiometric();
    renderApp();
    showToast('この端末の Face ID をやめました');
  },
  'forget-lock': () => {
    findOne('#lockForgetConfirm').hidden = false;
    findOne('#lockForgetWord').focus();
  },
  'forget-lock-no': () => resetForgetConfirm(),
  'forget-lock-yes': () => {
    // 「削除」と入力したときだけ消す（ボタンも、入力するまで押せない）
    if (isDeleteWordTyped(findOne('#lockForgetWord').value)) {
      wipeEncryptedData();
    }
  },

  // --- AI ---
  'run-review': () => runMonthlyReview(),
  'stop-review': () => stopMonthlyReview(),

  // --- ダイアログ ---
  'close-dialog': (button) => button.closest('dialog').close(),
};


/* ===========================================================
   4. 起動
   =========================================================== */

/**
 * アプリ本体のファイルを覚えておく係（sw.js）を登録する。
 * Claude の中で開いているとき（window.claude がある）や、https でないときは何もしない。
 */
function registerServiceWorker() {
  if (window.claude || !('serviceWorker' in navigator)) {
    return;
  }
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (location.protocol !== 'https:' && !isLocal) {
    return;
  }
  navigator.serviceWorker.register('sw.js').catch(() => {
    // 登録できなくても、アプリはふつうに使えるので何もしない
  });
}

function start() {
  // 画面のどこかが押されたら、data-action の名前で ACTIONS を探して実行
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) {
      return;
    }
    const action = ACTIONS[button.dataset.action];
    if (action) {
      event.preventDefault();
      action(button, event);
    }
  });

  // ダイアログの外側（暗いところ）を押したら閉じる
  for (const dialog of findAll('dialog')) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog && dialog.id !== 'lockDialog') { // ロック画面は外を押しても閉じない
        dialog.close();
      }
    });
  }

  // 画面の幅が変わったら、グラフを描き直す（0.15秒待ってから1回だけ）
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(redrawCharts, 150);
  });

  // バックアップのファイルが選ばれたら読み込む
  findOne('#restoreFile').addEventListener('change', (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (file) {
      readBackupFile(file);
    }
  });

  setupTransactionDialog();
  setupAccountDialog();
  setupLockDialog();
  setupSwipe();
  fillIcons(document);

  // URL の最後が #cards などなら、その画面から始める（あとで変わったときも追いかける）
  const hashScreen = location.hash.replace('#', '');
  if (SCREENS[hashScreen]) {
    appState.screen = hashScreen;
  }
  window.addEventListener('hashchange', () => {
    const screenName = location.hash.replace('#', '');
    if (SCREENS[screenName] && screenName !== appState.screen) {
      goToScreen(screenName);
    }
  });

  registerServiceWorker(); // ホーム画面に追加したアプリを、電波が弱くても開けるようにする
  renderApp();        // まず「読み込み中」を表示
  startStorage();     // データを読み込む（終わったら自動で描き直す）
  connectDownloads(); // ファイル保存の機能を調べる
  connectAiFeatures(); // Claude の機能を調べる
}

start();
