/* ===========================================================
   18-ai-features.js  ―  Claude（AI）を使う機能
   -----------------------------------------------------------
   Claude のアーティファクトとして開いたときだけ使える機能です。
   （ファイルを直接ブラウザで開いたときは、ボタン自体が出ません）

     ・レシートの写真から、日付・お店・金額・カテゴリを読み取る
     ・「Claude と話す」: 月の収支のまとめと、ふつうの言葉での会話

   使うと、見ている人の Claude の利用枠を少し使います（お金は増えません）。
   最初に使うときに「許可しますか？」の確認が出ます。

   【Claude に渡すもの・渡さないもの】（2026-10-27 に利用者と決めた）
     渡す   … 集計した数字（月ごとの収入・支出、カテゴリと中項目の合計、予算、カードの引き落とし予定）
              お店ごとの合計（お店の名前と金額）は、Claude が必要なときに問い合わせたときだけ
     渡さない … メモ・口座の名前・1件ずつの明細。カードは「カード1（JCB）」のように会社名だけ
   =========================================================== */

let sampleFeature = null;     // Claude に質問する機能（使えないときは null）
let canSendImages = false;    // 画像を送れるか
let canUseTools = false;      // Claude がアプリに数字を問い合わせる（ツール）ことができるか

/** アプリ起動時に呼ぶ: Claude の機能が使えるか調べる */
async function connectAiFeatures() {
  if (!window.claude || typeof window.claude.use !== 'function') {
    return;
  }
  try {
    sampleFeature = await window.claude.use('sample');
  } catch (error) {
    sampleFeature = null;
  }
  if (sampleFeature) {
    try {
      const limits = await sampleFeature.limits();
      canSendImages = Boolean(limits && limits.images);
      canUseTools = Boolean(limits && limits.tools);
    } catch (error) {
      canSendImages = false;
      canUseTools = false;
    }
  }
  renderApp(); // ボタンを出すために描き直す
}

/** レシート読み取りが使えるか */
function canReadReceipts() {
  return Boolean(sampleFeature) && canSendImages;
}

/** エラーの種類ごとの、画面に出すことば */
function aiErrorMessage(error) {
  const code = error && error.code;
  const messages = {
    not_granted: 'Claude の利用が許可されませんでした。',
    sampling_disabled: 'このアカウントでは Claude を使えません。',
    rate_limited: '混み合っているか、利用の上限に達しました。少し時間をおいてお試しください。',
    session_expired: 'もう一度サインインしてください。',
    image_rejected: 'この画像は読み取れませんでした。別の写真を選んでください。',
    refused: 'この内容には答えられませんでした。',
    invalid_json: '読み取った結果をうまく解釈できませんでした。もう一度お試しください。',
    empty_completion: '答えが返ってきませんでした。もう一度お試しください。',
    cancelled: '止めました。',
    tools_unavailable: 'この画面では、くわしい数字の問い合わせが使えませんでした。もう一度送ってください。',
    prompt_too_large: '会話が長くなりすぎました。「会話を消す」を押してから聞き直してください。',
  };
  return messages[code] || '通信に失敗しました。もう一度お試しください。';
}

/** 二度と使えない種類のエラーなら、機能を隠す */
function hideAiIfPermanent(error) {
  const permanentCodes = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];
  if (error && permanentCodes.includes(error.code)) {
    sampleFeature = null;
  }
  if (error && error.code === 'images_unavailable') {
    canSendImages = false;
  }
  if (error && error.code === 'tools_unavailable') {
    canUseTools = false; // 次からは、問い合わせ（ツール）なしで聞く
  }
}


/* ===========================================================
   1. レシートの読み取り
   =========================================================== */

async function readReceiptImage(file) {
  const status = findOne('#receiptStatus');
  const button = findOne('#receiptButton');
  status.textContent = '読み取り中…（10〜40秒ほどかかります）';
  button.disabled = true;

  // カテゴリの一覧を Claude に伝える
  let categoryList = '';
  for (const category of LIVING_EXPENSE_CATEGORIES) {
    categoryList += category.id + ': ' + category.name + '（' + category.subs.join('／') + '）\n';
  }
  const prompt =
    'この画像はお店のレシートまたは領収書です。内容を読み取り、次の形のJSONオブジェクトだけを返してください。\n' +
    '{"date": "YYYY-MM-DD または null", "store": "お店の名前", "total": 支払った合計金額（整数）, "category": "カテゴリID", "sub": "中項目"}\n' +
    '- total は税込の合計金額。お預かりやお釣りの金額ではありません。\n' +
    '- 年が読めないときは ' + new Date().getFullYear() + ' 年とします。\n' +
    '- category と sub は次の一覧から最も近いものを選びます:\n' + categoryList;

  const openCountAtStart = transactionDialog.openCount; // 読み取りを始めたときのダイアログ
  try {
    const result = await sampleFeature.json(prompt, { images: [file] });
    // 結果が届く前にダイアログを閉じた・別の記録を開いたときは、入れない
    if (transactionDialog.openCount !== openCountAtStart || !findOne('#transactionDialog').open) {
      return;
    }
    applyReceiptResult(result);
    status.textContent = '読み取りました。内容を確かめてから保存してください。';
  } catch (error) {
    hideAiIfPermanent(error);
    status.textContent = aiErrorMessage(error);
    if (!canReadReceipts()) {
      findOne('#receiptRow').hidden = true;
    }
  } finally {
    button.disabled = false;
  }
}

/** 読み取った結果を入力欄に入れる（おかしな値は入れない） */
function applyReceiptResult(result) {
  if (!result || typeof result !== 'object') {
    return;
  }
  if (result.date && isValidDateText(String(result.date))) {
    findOne('#transactionDate').value = String(result.date);
  }
  if (result.store) {
    findOne('#transactionDescription').value = String(result.store).slice(0, 60);
  }
  const total = Number(result.total);
  if (Number.isFinite(total) && total > 0) {
    findOne('#transactionAmount').value = String(Math.round(total));
  }
  // カテゴリ（支出のカテゴリだけ受け付ける）
  const category = CATEGORY_BY_ID[result.category];
  if (category && category.type === 'expense') {
    findOne('#transactionForm').elements.transactionType.value = 'expense';
    applyTypeToDialog('expense');
    fillCategorySelect(findOne('#transactionCategory'), 'expense', category.id);
    const sub = category.subs.includes(result.sub) ? result.sub : category.subs[0];
    fillSubcategorySelect(findOne('#transactionSubcategory'), category.id, sub);
    transactionDialog.categoryTouched = true;
  }
  updateAmountHint();
}


/* ===========================================================
   2. Claude と話す（月のまとめと、ふつうの言葉での会話）
   -----------------------------------------------------------
   しくみ:
     ① 利用者が質問を書く（または「○月のまとめ」を押す）
     ② 説明の文（答え方の決まり＋家計簿の数字）と、これまでの会話を Claude に送る
     ③ Claude は、ほかの月の数字やお店ごとの合計が必要なら、アプリに問い合わせる（ツール）
     ④ 答えが少しずつ届くので、画面の吹き出しにそのまま出す
     ⑤ 会話は家計簿のデータ（profile.chat）に保存する（暗号化ロックがオンなら暗号化される）
   =========================================================== */

const CHAT_SEND_LIMIT = 20;   // Claude に送る、これまでの会話の数（古いものは送らない）
const CHAT_SAVE_LIMIT = 30;   // 保存しておく会話の数
const CHAT_TEXT_LIMIT = 2500; // 保存する1つの発言の長さ（文字）
const STORE_LIMIT = 30;       // お店ごとの合計で、多い順に渡す数

let chatController = null;    // 答えを途中で止めるためのもの（答えを待っていないときは null）
let chatDraft = '';           // 入力欄の書きかけ（画面を描き直しても消えないように）
let isChatClearConfirmOpen = false; // 「会話を消す」の確認を出しているか

/** "2026-10" → { year: 2026, month: 10 }。読めなければ null */
function periodFromMonthText(monthText) {
  const match = /^(\d{4})-(\d{1,2})$/.exec(String(monthText || '').trim());
  if (!match) {
    return null;
  }
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    return null;
  }
  return { year: Number(match[1]), month: month };
}

/** { year, month } → "2026-10" */
function monthTextOfPeriod(period) {
  return period.year + '-' + pad2(period.month);
}

/**
 * Claude に渡す、ある月の数字（集計した数字だけ。お店の名前・メモ・口座の名前は入れない）。
 */
function monthFactsForAi(period) {
  const summary = summarizePeriod(period);
  const previous = summarizePeriod(shiftPeriod(period, -1));
  const budgets = appState.profile.budgets || {};

  // カテゴリごとの合計（多い順）。中項目ごとの合計もつける
  function categoryList(categories) {
    const list = [];
    for (const category of categories) {
      const bucket = summary.categories[category.id];
      if (!bucket) {
        continue;
      }
      const before = previous.categories[category.id] ? previous.categories[category.id].total : 0;
      list.push({ category: category.name, total: bucket.total, lastMonth: before, subs: { ...bucket.subs } });
    }
    list.sort((a, b) => b.total - a.total);
    return list;
  }

  // 予算（決めているカテゴリだけ）
  const budgetList = [];
  for (const category of LIVING_EXPENSE_CATEGORIES) {
    const budget = Number(budgets[category.id]) || 0;
    if (budget === 0) {
      continue;
    }
    const used = summary.categories[category.id] ? summary.categories[category.id].total : 0;
    budgetList.push({ category: category.name, budget: budget, used: used });
  }

  return {
    month: monthTextOfPeriod(period),
    title: periodTitle(period),
    range: periodRangeText(period),
    elapsedPercent: Math.round(elapsedRatio(period) * 100),
    income: summary.income,
    spending: summary.spending,
    balance: summary.income - summary.spending,
    investmentGainLoss: summary.tradeNet,
    lastMonth: { income: previous.income, spending: previous.spending },
    expenseByCategory: categoryList(EXPENSE_CATEGORIES),
    incomeByCategory: categoryList(INCOME_CATEGORIES),
    budgets: budgetList,
    savingsGoal: Number(appState.profile.settings.savingsGoal) || 0,
  };
}

/** Claude に渡す、count か月分の収入・支出・収支の流れ（古い順） */
function monthsOverviewForAi(endPeriod, count) {
  const rows = [];
  for (let back = count - 1; back >= 0; back--) {
    const period = shiftPeriod(endPeriod, -back);
    const summary = summarizePeriod(period);
    rows.push({ month: monthTextOfPeriod(period), income: summary.income, spending: summary.spending, balance: summary.income - summary.spending });
  }
  return rows;
}

/** Claude に渡す、カードの引き落とし予定。カードの名前は出さず「カード1（JCB）」のように会社名だけ */
function cardBillsForAi() {
  const result = [];
  const cards = cardAccounts();
  for (let index = 0; index < cards.length; index++) {
    const summary = cardSummary(cards[index]);
    result.push({
      card: 'カード' + (index + 1) + '（' + summary.settings.company.name + '）',
      upcomingBills: summary.upcomingBills.slice(0, 6).map((bill) => ({ payDate: bill.payDate, total: bill.total, fee: bill.fee })),
      remainingPrincipal: summary.remaining.total,
    });
  }
  return result;
}

/**
 * Claude に渡す、ある月のお店ごとの支出の合計（多い順に STORE_LIMIT 件）。
 * Claude が「お店ごと」を知りたいときに問い合わせたときだけ使う（利用者の許可ずみ）。
 *   categoryName … '食費' のようにカテゴリの名前でしぼる（'' ならすべて）
 * お店の名前は入出金の「内容」。メモ・口座の名前は入れない。仮の支出（支払い予定の手入力）は入れない。
 */
function storeTotalsForAi(period, categoryName) {
  const range = periodRange(period);
  const groups = new Map();
  for (const transaction of allTransactions) {
    if (transaction.type !== 'expense' || transaction.manualBill || !isCounted(transaction)) {
      continue;
    }
    if (transaction.date < range.start || transaction.date >= range.end) {
      continue;
    }
    const category = CATEGORY_BY_ID[transaction.category || 'other'];
    if (categoryName && (!category || category.name !== categoryName)) {
      continue;
    }
    const key = normalizeText(transaction.description) || '（内容なし）';
    if (!groups.has(key)) {
      groups.set(key, { store: transaction.description || '（内容なし）', total: 0, count: 0 });
    }
    const group = groups.get(key);
    group.total = group.total + transaction.amount;
    group.count = group.count + 1;
  }
  return [...groups.values()].sort((a, b) => b.total - a.total).slice(0, STORE_LIMIT);
}

/** Claude への説明の文（答え方の決まりと、今の家計簿の数字） */
function chatInstructions() {
  const period = appState.period;
  const data = {
    today: todayText(),
    monthStartsOn: getStartDay() + '日',
    viewingMonth: monthFactsForAi(period),
    last12Months: monthsOverviewForAi(period, 12),
    cardBills: cardBillsForAi(),
  };
  return 'あなたは家計簿アプリ「まめ帳」の中で、利用者の家計の相談にのるアシスタントです。\n' +
    '答え方の決まり:\n' +
    '- 日本語で、やさしく短く答える。初めての人にも分かる言葉で。むずかしい言葉は言いかえる。\n' +
    '- 下の「家計簿のデータ」と、ツールで調べた数字だけをもとに答える。分からないことは分からないと言い、数字を作らない。\n' +
    '- マークダウンは使わない（# の見出し・表・** の強調は使わない）。箇条書きは「・」で。\n' +
    '- 金額は「12,345円」のように書く。責めない口調で。\n' +
    '- 投資・金融商品・保険の具体的なおすすめはしない。税金や法律は一般的な話にとどめる。\n' +
    (canUseTools ? '- ほかの月の詳しい数字は get_month、お店ごとの支出は get_store_totals で調べられる。必要なときだけ使う。\n' : '- お店ごとの支出は分からない（聞かれたら、カテゴリの数字で答えられる範囲で答える）。\n') +
    '\n家計簿のデータ（JSON。金額は円）:\n' + JSON.stringify(data);
}

/** Claude に送る会話を作る: 説明の文（user）＋ 直近 CHAT_SEND_LIMIT 件の会話。最後は利用者の発言 */
function chatTurnsForClaude(instructions, messages) {
  const recent = messages.slice(-CHAT_SEND_LIMIT);
  const turns = [{ role: 'user', content: instructions }];
  for (const message of recent) {
    if (message.text) {
      turns.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.text });
    }
  }
  return turns;
}

/** 保存する会話を、決まった数と長さにおさめる（保存するデータが大きくなりすぎないように） */
function trimSavedChat(messages) {
  return messages.slice(-CHAT_SAVE_LIMIT).map((message) => ({ ...message, text: String(message.text || '').slice(0, CHAT_TEXT_LIMIT) }));
}

/** Claude がアプリに問い合わせられること（ツール）。返すのは集計した数字だけ */
function chatTools() {
  return [
    {
      name: 'get_month',
      description: 'ある月の収入・支出・カテゴリと中項目ごとの合計・予算を返す。家計簿のデータに無い月を知りたいときに使う。',
      inputSchema: { type: 'object', properties: { month: { type: 'string', description: '"2026-10" の形' } }, required: ['month'] },
      execute: (input) => {
        const period = periodFromMonthText(input.month);
        if (!period) {
          throw new Error('month は "2026-10" の形で指定してください');
        }
        return monthFactsForAi(period);
      },
    },
    {
      name: 'get_store_totals',
      description: 'ある月の、お店（入出金の内容）ごとの支出の合計と回数を、多い順に最大30件返す。カテゴリの名前（例: 食費）でしぼれる。',
      inputSchema: { type: 'object', properties: { month: { type: 'string', description: '"2026-10" の形' }, category: { type: 'string', description: 'カテゴリの名前（例: 食費）。しぼらないなら空' } }, required: ['month'] },
      execute: (input) => {
        const period = periodFromMonthText(input.month);
        if (!period) {
          throw new Error('month は "2026-10" の形で指定してください');
        }
        return storeTotalsForAi(period, String(input.category || ''));
      },
    },
  ];
}

/** 家計簿画面に出す「Claude と話す」のカード */
function aiChatCardHtml() {
  let html = '<section class="card span-12" id="aiChatCard">';
  html += '<div class="card-head"><h2>Claude と話す</h2><span class="sub">家計簿の数字をもとに、ふつうの言葉で答えます</span></div>';

  // Claude 版でないとき（ホーム画面のアプリ・ブラウザ）は使えないので、案内だけ出す
  if (!sampleFeature) {
    html += '<p class="hint">この機能は、Claude 版のまめ帳（claude.ai で開いたとき）で使えます。ホーム画面のアプリでは、お金のかかる鍵が要るため使えません。</p>';
    html += '</section>';
    return html;
  }

  const messages = appState.profile.chat || [];
  const running = chatController !== null;
  html += '<div class="chat-log" id="chatLog" aria-live="polite">';
  if (messages.length === 0) {
    html += '<p class="hint">たとえば「先月より食費は増えた？」「12月のカードの引き落としはいくら？」「固定費を減らすなら何から？」のように聞けます。</p>';
  }
  for (const message of messages) {
    html += chatBubbleHtml(message.role, message.text);
  }
  html += '</div>';

  // すぐ聞けるボタン
  const monthName = periodShortTitle(appState.period);
  html += '<div class="row-gap chat-quick">' +
    '<button type="button" class="btn small" data-action="chat-ask" data-text="' + escapeHtml(monthName + 'の収支をまとめて。良かった点・気になる点・来月できることを教えて。') + '"' + (running ? ' disabled' : '') + '>' + monthName + 'のまとめ</button>' +
    '<button type="button" class="btn small" data-action="chat-ask" data-text="' + escapeHtml(monthName + 'は、先月とくらべて何が変わった？') + '"' + (running ? ' disabled' : '') + '>先月とくらべて</button>' +
    '<button type="button" class="btn small" data-action="chat-ask" data-text="' + escapeHtml('むりなく節約するなら、どこから手をつけるといい？') + '"' + (running ? ' disabled' : '') + '>節約のヒント</button>' +
    '</div>';

  // 入力欄
  html += '<div class="chat-input">' +
    '<textarea id="chatInput" rows="2" placeholder="ここに質問を書く" aria-label="Claude への質問">' + escapeHtml(chatDraft) + '</textarea>' +
    (running
      ? '<button type="button" class="btn" data-action="chat-stop">止める</button>'
      : '<button type="button" class="btn primary" data-action="chat-send">送る</button>') +
    '</div>';

  html += '<p class="hint" style="margin-top:8px">Claude には集計した数字と、聞かれたときはお店ごとの合計を渡します（メモ・口座の名前は渡しません）。会話は家計簿と一緒に保存されます。見ている人の Claude の利用枠を使います。</p>';
  if (messages.length > 0 && !running) {
    if (isChatClearConfirmOpen) {
      html += confirmBoxHtml('これまでの会話をすべて消します。家計簿の記録は消えません。', '会話を消す', 'chat-clear-yes', 'chat-clear-no');
    } else {
      html += '<div class="row-gap"><button type="button" class="btn small ghost danger-text" data-action="chat-clear">会話を消す</button></div>';
    }
  }
  html += '</section>';
  return html;
}

/** 吹き出し1つ分 */
function chatBubbleHtml(role, text) {
  const who = role === 'assistant' ? 'Claude' : 'あなた';
  return '<div class="chat-bubble ' + (role === 'assistant' ? 'from-claude' : 'from-me') + '"><span class="chat-who">' + who + '</span>' +
    '<div class="chat-text">' + escapeHtml(text) + '</div></div>';
}

/** 入力欄の書きかけを覚える（家計簿画面を描いたあとに呼ぶ） */
function setupChatInput() {
  const input = findOne('#chatInput');
  if (!input) {
    return;
  }
  input.addEventListener('input', () => {
    chatDraft = input.value;
  });
  // パソコン: Ctrl+Enter（Mac は ⌘+Enter）で送る。ふつうの Enter は改行
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      sendChatFromInput();
    }
  });
}

/** ホームの「Claude に聞く」: 家計簿画面の「Claude と話す」へ移って、入力欄を出す */
function goToChat() {
  goToScreen('report');
  requestAnimationFrame(() => {
    const card = findOne('#aiChatCard');
    if (card) {
      card.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
  });
}

/** 入力欄の文を送る */
function sendChatFromInput() {
  const input = findOne('#chatInput');
  const text = input ? input.value.trim() : '';
  if (text === '') {
    showToast('質問を書いてください');
    return;
  }
  chatDraft = '';
  askClaude(text);
}

/** Claude に聞く（入力欄からも、「○月のまとめ」などのボタンからも、ここを通る） */
async function askClaude(text) {
  if (!sampleFeature || chatController) {
    return;
  }
  const profile = appState.profile;
  profile.chat = trimSavedChat([...(profile.chat || []), { role: 'user', text: text, at: todayText() }]);
  chatController = new AbortController();
  isChatClearConfirmOpen = false;
  renderApp();

  // 答えを入れる吹き出しを先に出しておき、届いた分から書きかえる
  const log = findOne('#chatLog');
  let answerText = null;
  if (log) {
    log.insertAdjacentHTML('beforeend', chatBubbleHtml('assistant', '考えています…（10〜60秒ほど）'));
    answerText = log.lastElementChild.querySelector('.chat-text');
    answerText.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  let answer = '';
  try {
    const options = {
      signal: chatController.signal,
      cache: false,
      onText: (update) => {
        answer = update.text;
        if (answerText) {
          answerText.textContent = update.text;
        }
      },
    };
    if (canUseTools) {
      options.tools = chatTools();
      delete options.cache; // ツールを使うときは cache を渡さない決まり
    }
    const result = await sampleFeature(chatTurnsForClaude(chatInstructions(), profile.chat), options);
    answer = result.text + (result.truncated ? '\n（途中で切れました。短く聞き直してください）' : '');
  } catch (error) {
    hideAiIfPermanent(error);
    answer = (error && error.text ? error.text + '\n\n' : '') + aiErrorMessage(error);
  } finally {
    chatController = null;
  }
  profile.chat = trimSavedChat([...profile.chat, { role: 'assistant', text: answer, at: todayText() }]);
  saveProfile(); // 会話を保存して、画面を描き直す（サンプル表示中は保存されない）
}

/** 「止める」 */
function stopClaude() {
  if (chatController) {
    chatController.abort();
  }
}

/** 「会話を消す」の確認で「会話を消す」を押したとき */
function clearChatConfirmed() {
  isChatClearConfirmOpen = false;
  appState.profile.chat = [];
  saveProfile();
  showToast('会話を消しました');
}
