/* ===========================================================
   18-ai-features.js  ―  Claude（AI）を使う機能
   -----------------------------------------------------------
   Claude のアーティファクトとして開いたときだけ使える機能です。
   （ファイルを直接ブラウザで開いたときは、ボタン自体が出ません）

     ・レシートの写真から、日付・お店・金額・カテゴリを読み取る
     ・今月の家計を Claude にふり返ってもらう

   使うと、見ている人の Claude の利用枠を少し使います。
   最初に使うときに「許可しますか？」の確認が出ます。
   =========================================================== */

let sampleFeature = null;     // Claude に質問する機能（使えないときは null）
let canSendImages = false;    // 画像を送れるか
let reviewController = null;  // ふり返りを途中で止めるためのもの
let reviewText = '';          // ふり返りの結果（画面を描き直しても消えないように覚えておく）

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
    } catch (error) {
      canSendImages = false;
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
  for (const category of EXPENSE_CATEGORIES) {
    categoryList += category.id + ': ' + category.name + '（' + category.subs.join('／') + '）\n';
  }
  const prompt =
    'この画像はお店のレシートまたは領収書です。内容を読み取り、次の形のJSONオブジェクトだけを返してください。\n' +
    '{"date": "YYYY-MM-DD または null", "store": "お店の名前", "total": 支払った合計金額（整数）, "category": "カテゴリID", "sub": "中項目"}\n' +
    '- total は税込の合計金額。お預かりやお釣りの金額ではありません。\n' +
    '- 年が読めないときは ' + new Date().getFullYear() + ' 年とします。\n' +
    '- category と sub は次の一覧から最も近いものを選びます:\n' + categoryList;

  try {
    const result = await sampleFeature.json(prompt, { images: [file] });
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
   2. 今月のふり返り
   =========================================================== */

/** 家計簿画面に出すカード（使えないときは空の文字を返す） */
function aiReviewCardHtml() {
  if (!sampleFeature) {
    return '';
  }
  const running = reviewController !== null;
  let html = '<section class="card span-5">';
  html += '<div class="card-head"><h2>AIのふり返り</h2><span class="sub">' + periodShortTitle(appState.period) + 'の数字をもとに Claude がコメントします</span></div>';
  html += '<div class="ai-output" id="aiOutput" aria-live="polite">' + escapeHtml(reviewText || 'ボタンを押すと、良かった点・気になる点・来月できることを短くまとめます。') + '</div>';
  html += '<div class="row-gap" style="margin-top:12px">';
  if (running) {
    html += '<button type="button" class="btn" data-action="stop-review">止める</button>';
  } else {
    html += '<button type="button" class="btn primary" data-action="run-review" data-icon="sparkle">ふり返ってもらう</button>';
  }
  html += '</div>';
  html += '<p class="hint" style="margin-top:8px">金融商品のおすすめはしません。見ている人の Claude の利用枠を使います。</p>';
  html += '</section>';
  return html;
}

/** Claude に送る文章を作る（数字だけを送り、お店の名前などは送らない） */
function buildReviewPrompt() {
  const period = appState.period;
  const summary = summarizePeriod(period);
  const previous = summarizePeriod(shiftPeriod(period, -1));
  const budgets = appState.profile.budgets;

  let lines = '';
  for (const category of EXPENSE_CATEGORIES) {
    const now = summary.categories[category.id] ? summary.categories[category.id].total : 0;
    const before = previous.categories[category.id] ? previous.categories[category.id].total : 0;
    const budget = Number(budgets[category.id]) || 0;
    if (now === 0 && before === 0 && budget === 0) {
      continue;
    }
    lines += '- ' + category.name + ': 今月 ' + now + '円 / 先月 ' + before + '円' + (budget ? ' / 予算 ' + budget + '円' : '') + '\n';
  }

  return '家計簿アプリの利用者に、今月の家計のふり返りを日本語で書いてください。\n' +
    '形式: 「良かった点」1つ、「気になる点」2つ、「来月できること」3つ を、それぞれ短い箇条書きで。全体で300字程度。見出し記号（#）は使わない。\n' +
    '具体的な数字にふれ、責めない口調で。投資・金融商品のおすすめはしない。\n\n' +
    '期間: ' + periodTitle(period) + '（' + periodRangeText(period) + '、期間の' + Math.round(elapsedRatio(period) * 100) + '%が経過）\n' +
    '収入: ' + summary.income + '円（先月 ' + previous.income + '円）\n' +
    '支出: ' + summary.expense + '円（先月 ' + previous.expense + '円）\n' +
    '予算合計: ' + totalBudget() + '円\n' +
    '貯金目標: ' + (Number(appState.profile.settings.savingsGoal) || 0) + '円\n' +
    'カテゴリ別:\n' + lines;
}

async function runMonthlyReview() {
  if (!sampleFeature || reviewController) {
    return;
  }
  reviewController = new AbortController();
  reviewText = '考えています…';
  renderApp();

  try {
    const result = await sampleFeature(buildReviewPrompt(), {
      signal: reviewController.signal,
      onText: (update) => {
        reviewText = update.text;
        const output = findOne('#aiOutput');
        if (output) {
          output.textContent = update.text;
        }
      },
    });
    reviewText = result.text + (result.truncated ? '\n（途中で切れました）' : '');
  } catch (error) {
    hideAiIfPermanent(error);
    reviewText = (error && error.text ? error.text + '\n\n' : '') + aiErrorMessage(error);
  } finally {
    reviewController = null;
    renderApp();
  }
}

function stopMonthlyReview() {
  if (reviewController) {
    reviewController.abort();
  }
}
