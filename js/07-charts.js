/* ===========================================================
   07-charts.js  ―  グラフを描く
   -----------------------------------------------------------
   グラフは SVG（線や四角を座標で指定して描く絵）で作っています。
   外部のグラフ用ライブラリは使っていません。

   入っているグラフ:
     drawAssetTrendChart     … 総資産の推移（面グラフ）
     drawIncomeExpenseChart  … 月ごとの収入と支出（上下の棒グラフ）
     assetCompositionHtml    … 資産の内訳（横一本の積み上げバー）
     rankingBarsHtml         … カテゴリ別の支出（横棒ランキング）
     createMoneyColumn3d     … 手取り計算の「立体の積み上げ柱」（指で回せる）

   グラフにマウスをのせる（スマホならタップする）と、吹き出しで数字が出ます。
   =========================================================== */


/* ===========================================================
   1. 画面の幅が変わったときに描き直すしくみ
   =========================================================== */

let chartDrawers = []; // 今の画面にあるグラフの「描く関数」の一覧

/** グラフを登録して、すぐ1回描く */
function registerChart(drawFunction) {
  chartDrawers.push(drawFunction);
  drawFunction();
}

/** 画面を切りかえるときに、前の画面のグラフを忘れる */
function clearCharts() {
  chartDrawers = [];
  hideTooltip();
}

/** 登録されているグラフをすべて描き直す */
function redrawCharts() {
  for (const draw of chartDrawers) {
    draw();
  }
}


/* ===========================================================
   2. 吹き出し（ツールチップ）
   =========================================================== */

/**
 * 吹き出しを出す。
 *   title … 一番上の小さな文字（例: "2026年9月"）
 *   rows  … [{ value: "¥1,234", label: "収入", color: "var(--income)", key: "rect" }]
 *           key は色の見本の形: "rect"（四角）/ "line"（線）/ "dot"（丸）
 */
function showTooltip(clientX, clientY, title, rows) {
  const tooltip = findOne('#tooltip');
  tooltip.replaceChildren(); // 中身を空にする

  const titleElement = document.createElement('div');
  titleElement.className = 'tooltip-title';
  titleElement.textContent = title; // textContent なら記号が入っていても安全
  tooltip.appendChild(titleElement);

  for (const row of rows) {
    const rowElement = document.createElement('div');
    rowElement.className = 'tooltip-row';
    if (row.color) {
      const key = document.createElement('span');
      key.className = 'key ' + (row.key || 'line');
      key.style.background = row.color;
      rowElement.appendChild(key);
    }
    const value = document.createElement('strong');
    value.textContent = row.value;
    rowElement.appendChild(value);
    const label = document.createElement('span');
    label.textContent = row.label || '';
    rowElement.appendChild(label);
    tooltip.appendChild(rowElement);
  }

  tooltip.hidden = false;
  // 画面からはみ出さない位置に置く
  const box = tooltip.getBoundingClientRect();
  let left = clientX + 14;
  if (left + box.width > window.innerWidth - 8) {
    left = clientX - box.width - 14;
  }
  let top = clientY - box.height - 12;
  if (top < 8) {
    top = clientY + 16;
  }
  tooltip.style.left = Math.max(8, left) + 'px';
  tooltip.style.top = top + 'px';
}

function hideTooltip() {
  const tooltip = findOne('#tooltip');
  if (tooltip) {
    tooltip.hidden = true;
  }
}

/**
 * data-tip-title / data-tip-value / data-tip-label を持つ部品に、
 * マウスをのせたら吹き出しが出るようにする。
 */
function attachSimpleTooltips(container) {
  for (const element of findAll('[data-tip-title]', container)) {
    element.addEventListener('pointermove', (event) => {
      showTooltip(event.clientX, event.clientY, element.dataset.tipTitle, [
        { value: element.dataset.tipValue, label: element.dataset.tipLabel || '', color: element.dataset.tipColor, key: 'rect' },
      ]);
    });
    element.addEventListener('pointerleave', hideTooltip);
  }
}


/* ===========================================================
   3. 目盛りをきりのいい数字にする
   例: 0〜3,456,789 → 0 / 100万 / 200万 / 300万 / 400万
   =========================================================== */

function niceScale(minValue, maxValue, tickCount) {
  let low = minValue;
  let high = maxValue;
  if (low === high) {
    high = low + 1;
  }
  const roughStep = (high - low) / tickCount;
  const power = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const fraction = roughStep / power;
  let niceFraction = 10;
  if (fraction <= 1) {
    niceFraction = 1;
  } else if (fraction <= 2) {
    niceFraction = 2;
  } else if (fraction <= 2.5) {
    niceFraction = 2.5;
  } else if (fraction <= 5) {
    niceFraction = 5;
  }
  const step = niceFraction * power;
  const niceMin = Math.floor(low / step) * step;
  const niceMax = Math.ceil(high / step) * step;
  const ticks = [];
  for (let value = niceMin; value <= niceMax + step / 2; value = value + step) {
    ticks.push(Math.round(value));
  }
  return { min: niceMin, max: niceMax, ticks: ticks };
}


/* ===========================================================
   4. 総資産の推移（面グラフ）
   points = [{ period, dateText, amount }, ...]（古い順）
   =========================================================== */

function drawAssetTrendChart(container, points) {
  if (points.length < 1) {
    container.innerHTML = '<p class="empty-note">口座を登録すると、ここに推移が表示されます。</p>';
    return;
  }

  // --- 大きさと余白 ---
  const width = Math.max(280, container.clientWidth || 600);
  const height = 190;
  const padLeft = 54;
  const padRight = 14;
  const padTop = 12;
  const padBottom = 26;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  // --- 数字 → 座標 の変換 ---
  const values = points.map((point) => point.amount);
  const scale = niceScale(Math.min(0, ...values), Math.max(0, ...values), 4);
  function xOf(index) {
    if (points.length === 1) {
      return padLeft + plotWidth; // 1つだけのときは右端に点を置く
    }
    return padLeft + plotWidth * (index / (points.length - 1));
  }
  function yOf(value) {
    return padTop + plotHeight * (1 - (value - scale.min) / (scale.max - scale.min));
  }

  let svg = '<svg viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" tabindex="0" role="img" aria-label="総資産の推移。左右の矢印キーで月を選べます">';

  // 横の目盛り線と金額
  for (const tick of scale.ticks) {
    const y = yOf(tick).toFixed(1);
    svg += '<line class="grid-line" x1="' + padLeft + '" x2="' + (width - padRight) + '" y1="' + y + '" y2="' + y + '"/>';
    svg += '<text class="axis-text" x="' + (padLeft - 8) + '" y="' + (Number(y) + 4) + '" text-anchor="end">' + formatYenShort(tick) + '</text>';
  }

  // 月の名前（多いときは間引く。いちばん右は必ず出す）
  const maxLabels = Math.max(2, Math.floor(plotWidth / 46));
  const labelStep = Math.ceil(points.length / maxLabels);
  for (let index = 0; index < points.length; index++) {
    if ((points.length - 1 - index) % labelStep === 0) {
      svg += '<text class="axis-text" x="' + xOf(index).toFixed(1) + '" y="' + (height - 6) + '" text-anchor="middle">' + periodShortTitle(points[index].period) + '</text>';
    }
  }

  // 面と線
  let linePath = '';
  for (let index = 0; index < points.length; index++) {
    linePath += (index === 0 ? 'M' : 'L') + xOf(index).toFixed(1) + ',' + yOf(points[index].amount).toFixed(1);
  }
  const zeroY = yOf(0).toFixed(1);
  const areaPath = linePath + 'L' + xOf(points.length - 1).toFixed(1) + ',' + zeroY + 'L' + xOf(0).toFixed(1) + ',' + zeroY + 'Z';
  svg += '<path d="' + areaPath + '" fill="var(--accent)" fill-opacity="0.1"/>';
  svg += '<path d="' + linePath + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';

  // いちばん右（最新）の点
  const lastIndex = points.length - 1;
  svg += '<circle cx="' + xOf(lastIndex).toFixed(1) + '" cy="' + yOf(points[lastIndex].amount).toFixed(1) + '" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>';

  // マウスに合わせて動く縦線と点（はじめは隠しておく）
  svg += '<line class="cross-line" data-role="cross" x1="0" x2="0" y1="' + padTop + '" y2="' + (height - padBottom) + '" visibility="hidden"/>';
  svg += '<circle data-role="focus" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>';
  svg += '<rect data-role="hit" x="' + padLeft + '" y="0" width="' + plotWidth + '" height="' + height + '" fill="transparent"/>';
  svg += '</svg>';
  container.innerHTML = svg;

  // --- マウス・キーボードの操作 ---
  const svgElement = findOne('svg', container);
  const cross = findOne('[data-role="cross"]', container);
  const focusDot = findOne('[data-role="focus"]', container);
  const hitArea = findOne('[data-role="hit"]', container);
  let activeIndex = lastIndex;

  function showPoint(index, clientX, clientY) {
    activeIndex = index;
    const x = xOf(index);
    const y = yOf(points[index].amount);
    cross.setAttribute('x1', x);
    cross.setAttribute('x2', x);
    cross.setAttribute('visibility', 'visible');
    focusDot.setAttribute('cx', x);
    focusDot.setAttribute('cy', y);
    focusDot.setAttribute('visibility', 'visible');
    const point = points[index];
    showTooltip(clientX, clientY, periodTitle(point.period) + '（' + formatShortDate(point.dateText) + '時点）', [
      { value: formatYen(point.amount), label: '総資産', color: 'var(--accent)', key: 'line' },
    ]);
  }
  function hidePoint() {
    cross.setAttribute('visibility', 'hidden');
    focusDot.setAttribute('visibility', 'hidden');
    hideTooltip();
  }

  hitArea.addEventListener('pointermove', (event) => {
    const box = svgElement.getBoundingClientRect();
    const pointerX = (event.clientX - box.left) * (width / box.width);
    let index = lastIndex === 0 ? 0 : Math.round(((pointerX - padLeft) / plotWidth) * lastIndex);
    index = Math.max(0, Math.min(lastIndex, index));
    showPoint(index, event.clientX, event.clientY);
  });
  hitArea.addEventListener('pointerleave', hidePoint);
  svgElement.addEventListener('blur', hidePoint);
  svgElement.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const nextIndex = event.key === 'ArrowLeft' ? Math.max(0, activeIndex - 1) : Math.min(lastIndex, activeIndex + 1);
    const box = svgElement.getBoundingClientRect();
    const clientX = box.left + xOf(nextIndex) * (box.width / width);
    const clientY = box.top + yOf(points[nextIndex].amount) * (box.height / height);
    showPoint(nextIndex, clientX, clientY);
  });
}


/* ===========================================================
   5. 月ごとの収入と支出（収入は上、支出は下に伸びる棒）
   rows = [{ period, income, expense }, ...]（古い順）
   =========================================================== */

/** 先だけ角が丸い棒の形（baseY から endY へ伸びる） */
function roundedBarPath(x, baseY, endY, barWidth, radius) {
  const height = Math.abs(endY - baseY);
  const r = Math.min(radius, height, barWidth / 2);
  const right = x + barWidth;
  if (endY < baseY) {
    // 上に伸びる棒
    return 'M' + x + ',' + baseY + 'V' + (endY + r) + 'Q' + x + ',' + endY + ' ' + (x + r) + ',' + endY +
      'H' + (right - r) + 'Q' + right + ',' + endY + ' ' + right + ',' + (endY + r) + 'V' + baseY + 'Z';
  }
  // 下に伸びる棒
  return 'M' + x + ',' + baseY + 'V' + (endY - r) + 'Q' + x + ',' + endY + ' ' + (x + r) + ',' + endY +
    'H' + (right - r) + 'Q' + right + ',' + endY + ' ' + right + ',' + (endY - r) + 'V' + baseY + 'Z';
}

function drawIncomeExpenseChart(container, rows) {
  if (rows.length === 0) {
    container.innerHTML = '<p class="empty-note">まだ収入・支出の記録がありません。</p>';
    return;
  }

  const width = Math.max(280, container.clientWidth || 600);
  const height = 240;
  const padLeft = 54;
  const padRight = 8;
  const padTop = 12;
  const padBottom = 26;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  let maxIncome = 0;
  let maxExpense = 0;
  for (const row of rows) {
    maxIncome = Math.max(maxIncome, row.income);
    maxExpense = Math.max(maxExpense, row.expense);
  }
  const scale = niceScale(-maxExpense, maxIncome, 5);
  function yOf(value) {
    return padTop + plotHeight * (1 - (value - scale.min) / (scale.max - scale.min));
  }
  const bandWidth = plotWidth / rows.length;
  const barWidth = Math.min(24, bandWidth * 0.56);
  function centerOf(index) {
    return padLeft + bandWidth * (index + 0.5);
  }
  const zeroY = yOf(0);

  let svg = '<svg viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" tabindex="0" role="img" aria-label="月ごとの収入と支出。左右の矢印キーで月を選べます">';

  for (const tick of scale.ticks) {
    const y = yOf(tick).toFixed(1);
    svg += '<line class="grid-line" x1="' + padLeft + '" x2="' + (width - padRight) + '" y1="' + y + '" y2="' + y + '"/>';
    svg += '<text class="axis-text" x="' + (padLeft - 8) + '" y="' + (Number(y) + 4) + '" text-anchor="end">' + formatYenShort(Math.abs(tick)) + '</text>';
  }

  const maxLabels = Math.max(2, Math.floor(plotWidth / 34));
  const labelStep = Math.ceil(rows.length / maxLabels);

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const left = centerOf(index) - barWidth / 2;
    if (row.income > 0) {
      svg += '<path d="' + roundedBarPath(left, zeroY - 1, yOf(row.income), barWidth, 4) + '" fill="var(--income)"/>';
    }
    if (row.expense > 0) {
      svg += '<path d="' + roundedBarPath(left, zeroY + 1, yOf(-row.expense), barWidth, 4) + '" fill="var(--expense)"/>';
    }
    // 収支（収入−支出）の点
    if (row.income > 0 || row.expense > 0) {
      svg += '<circle cx="' + centerOf(index).toFixed(1) + '" cy="' + yOf(row.income - row.expense).toFixed(1) + '" r="4" fill="var(--ink)" stroke="var(--surface)" stroke-width="2"/>';
    }
    if ((rows.length - 1 - index) % labelStep === 0) {
      svg += '<text class="axis-text" x="' + centerOf(index).toFixed(1) + '" y="' + (height - 6) + '" text-anchor="middle">' + periodShortTitle(row.period) + '</text>';
    }
  }
  svg += '<line class="base-line" x1="' + padLeft + '" x2="' + (width - padRight) + '" y1="' + zeroY + '" y2="' + zeroY + '"/>';
  svg += '<rect data-role="highlight" x="0" y="' + padTop + '" width="' + bandWidth + '" height="' + plotHeight + '" fill="var(--ink)" fill-opacity="0.05" visibility="hidden"/>';
  svg += '<rect data-role="hit" x="' + padLeft + '" y="0" width="' + plotWidth + '" height="' + height + '" fill="transparent"/>';
  svg += '</svg>';
  container.innerHTML = svg;

  const svgElement = findOne('svg', container);
  const highlight = findOne('[data-role="highlight"]', container);
  const hitArea = findOne('[data-role="hit"]', container);
  let activeIndex = rows.length - 1;

  function showMonth(index, clientX, clientY) {
    activeIndex = index;
    highlight.setAttribute('x', padLeft + bandWidth * index);
    highlight.setAttribute('visibility', 'visible');
    const row = rows[index];
    showTooltip(clientX, clientY, periodTitle(row.period), [
      { value: formatYen(row.income), label: '収入', color: 'var(--income)', key: 'rect' },
      { value: formatYen(row.expense), label: '支出', color: 'var(--expense)', key: 'rect' },
      { value: formatYen(row.income - row.expense, { showPlus: true }), label: '収支', color: 'var(--ink)', key: 'dot' },
    ]);
  }
  function hideMonth() {
    highlight.setAttribute('visibility', 'hidden');
    hideTooltip();
  }

  hitArea.addEventListener('pointermove', (event) => {
    const box = svgElement.getBoundingClientRect();
    const pointerX = (event.clientX - box.left) * (width / box.width);
    let index = Math.floor((pointerX - padLeft) / bandWidth);
    index = Math.max(0, Math.min(rows.length - 1, index));
    showMonth(index, event.clientX, event.clientY);
  });
  hitArea.addEventListener('pointerleave', hideMonth);
  svgElement.addEventListener('blur', hideMonth);
  svgElement.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const nextIndex = event.key === 'ArrowLeft' ? Math.max(0, activeIndex - 1) : Math.min(rows.length - 1, activeIndex + 1);
    const box = svgElement.getBoundingClientRect();
    const clientX = box.left + centerOf(nextIndex) * (box.width / width);
    showMonth(nextIndex, clientX, box.top + zeroY * (box.height / height));
  });
}


/* ===========================================================
   6. 資産の内訳（横一本の積み上げバー＋一覧）
   breakdown は assetBreakdownOn() の結果
   =========================================================== */

function assetCompositionHtml(breakdown) {
  const positiveGroups = breakdown.groups.filter((group) => group.amount > 0);
  let positiveTotal = 0;
  for (const group of positiveGroups) {
    positiveTotal = positiveTotal + group.amount;
  }
  if (positiveTotal <= 0) {
    return '<p class="empty-note">口座を登録すると、資産の内訳が表示されます。</p>';
  }

  let html = '<div class="stack-bar" role="img" aria-label="資産の内訳">';
  for (const group of positiveGroups) {
    const percent = ((group.amount / positiveTotal) * 100).toFixed(1);
    html += '<div class="stack-seg" style="flex:' + group.amount + ' 1 0; background:' + group.color + '"' +
      ' data-tip-title="' + escapeHtml(group.name) + '" data-tip-value="' + formatYen(group.amount) + '"' +
      ' data-tip-label="' + percent + '%" data-tip-color="' + group.color + '"></div>';
  }
  html += '</div>';

  html += '<ul class="legend-rows">';
  for (const group of breakdown.groups) {
    const percent = positiveTotal > 0 && group.amount > 0 ? ((group.amount / positiveTotal) * 100).toFixed(1) + '%' : '—';
    html += '<li><span class="key" style="background:' + group.color + '"></span><span>' + escapeHtml(group.name) + '</span>' +
      '<span class="num">' + formatYen(group.amount) + '</span><span class="pct num">' + percent + '</span></li>';
  }
  html += '<li><span class="key" style="background:transparent; box-shadow: inset 0 0 0 1px var(--rule-strong)"></span><span>負債（カード・ローン）</span>' +
    '<span class="num">' + formatYen(breakdown.debts) + '</span><span class="pct"></span></li>';
  html += '</ul>';
  return html;
}


/* ===========================================================
   7. 横棒のランキング（カテゴリ別の支出など）
   rows = [{ id, label, value }]（大きい順に並べて渡す）
   type = 'expense' か 'income'（棒の色が変わる）
   id が空の行（「その他」など）はクリックできない
   =========================================================== */

function rankingBarsHtml(rows, type) {
  if (rows.length === 0) {
    return '<p class="empty-note">この期間の記録はまだありません。</p>';
  }
  let maxValue = 0;
  for (const row of rows) {
    maxValue = Math.max(maxValue, row.value);
  }
  let html = '<div class="rank">';
  for (const row of rows) {
    const widthPercent = maxValue > 0 ? (row.value / maxValue) * 100 : 0;
    const inner =
      '<span class="rank-name">' + escapeHtml(row.label) + '</span>' +
      '<span class="rank-track"><span class="rank-bar ' + (type === 'income' ? 'income' : '') + '" style="display:block; width:' + widthPercent.toFixed(1) + '%"></span></span>' +
      '<span class="rank-value num">' + formatYen(row.value) + '</span>';
    if (row.id) {
      html += '<button type="button" class="rank-row" data-action="filter-category" data-category="' + escapeHtml(row.id) + '" aria-label="' + escapeHtml(row.label) + 'の入出金を見る">' + inner + '</button>';
    } else {
      html += '<div class="rank-row" style="cursor:default">' + inner + '</div>';
    }
  }
  html += '</div>';
  return html;
}


/* ===========================================================
   8. カードの「これから払う金額」の月別グラフ
   rows は cardDebtRows() の結果。棒は元金（青）と手数料（橙）の積み上げ。
   マウスをのせると、その月に払うお金と、払い終えたあとの残りの負債が出ます。
   =========================================================== */

function drawCardDebtChart(container, rows) {
  if (rows.length === 0) {
    container.innerHTML = '<p class="empty-note">これから払う金額はありません。</p>';
    return;
  }
  const width = Math.max(280, container.clientWidth || 600);
  const height = 220;
  const padLeft = 54;
  const padRight = 8;
  const padTop = 12;
  const padBottom = 26;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  let maxTotal = 0;
  for (const row of rows) {
    maxTotal = Math.max(maxTotal, row.principal + row.fee);
  }
  const scale = niceScale(0, maxTotal, 4);
  function yOf(value) {
    return padTop + plotHeight * (1 - (value - scale.min) / (scale.max - scale.min));
  }
  const bandWidth = plotWidth / rows.length;
  const barWidth = Math.min(24, bandWidth * 0.62);
  function centerOf(index) {
    return padLeft + bandWidth * (index + 0.5);
  }
  const zeroY = yOf(0);

  let svg = '<svg viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" tabindex="0" role="img" aria-label="月ごとのカード支払い予定。左右の矢印キーで月を選べます">';
  for (const tick of scale.ticks) {
    const y = yOf(tick).toFixed(1);
    svg += '<line class="grid-line" x1="' + padLeft + '" x2="' + (width - padRight) + '" y1="' + y + '" y2="' + y + '"/>';
    svg += '<text class="axis-text" x="' + (padLeft - 8) + '" y="' + (Number(y) + 4) + '" text-anchor="end">' + formatYenShort(tick) + '</text>';
  }

  const maxLabels = Math.max(2, Math.floor(plotWidth / 40));
  const labelStep = Math.ceil(rows.length / maxLabels);
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const left = centerOf(index) - barWidth / 2;
    const principalTop = yOf(row.principal);
    if (row.principal > 0) {
      svg += '<path d="' + roundedBarPath(left, zeroY, principalTop, barWidth, row.fee > 0 ? 0.1 : 4) + '" fill="var(--chart-1)"/>';
    }
    if (row.fee > 0) {
      // 手数料は元金の上に2pxのすき間をあけて積む
      const feeBase = principalTop - (row.principal > 0 ? 2 : 0);
      const feeTop = yOf(row.principal + row.fee) - (row.principal > 0 ? 2 : 0);
      svg += '<path d="' + roundedBarPath(left, feeBase, Math.min(feeTop, feeBase - 1), barWidth, 4) + '" fill="var(--chart-2)"/>';
    }
    if ((rows.length - 1 - index) % labelStep === 0) {
      const monthNumber = Number(row.month.slice(5));
      const labelText = monthNumber === 1 || index === 0 ? row.month.slice(2, 4) + '年' + monthNumber + '月' : monthNumber + '月';
      svg += '<text class="axis-text" x="' + centerOf(index).toFixed(1) + '" y="' + (height - 6) + '" text-anchor="middle">' + labelText + '</text>';
    }
  }
  svg += '<line class="base-line" x1="' + padLeft + '" x2="' + (width - padRight) + '" y1="' + zeroY + '" y2="' + zeroY + '"/>';
  svg += '<rect data-role="highlight" x="0" y="' + padTop + '" width="' + bandWidth + '" height="' + plotHeight + '" fill="var(--ink)" fill-opacity="0.05" visibility="hidden"/>';
  svg += '<rect data-role="hit" x="' + padLeft + '" y="0" width="' + plotWidth + '" height="' + height + '" fill="transparent"/>';
  svg += '</svg>';
  container.innerHTML = svg;

  const svgElement = findOne('svg', container);
  const highlight = findOne('[data-role="highlight"]', container);
  const hitArea = findOne('[data-role="hit"]', container);
  let activeIndex = 0;

  function showMonth(index, clientX, clientY) {
    activeIndex = index;
    highlight.setAttribute('x', padLeft + bandWidth * index);
    highlight.setAttribute('visibility', 'visible');
    const row = rows[index];
    const tipRows = [{ value: formatYen(row.principal + row.fee), label: '支払い合計', color: 'var(--ink)', key: 'dot' }];
    tipRows.push({ value: formatYen(row.principal), label: '元金', color: 'var(--chart-1)', key: 'rect' });
    if (row.fee > 0) {
      tipRows.push({ value: formatYen(row.fee), label: '手数料', color: 'var(--chart-2)', key: 'rect' });
    }
    tipRows.push({ value: formatYen(row.remainingAfter), label: 'この月のあとに残る負債', color: '', key: 'dot' });
    showTooltip(clientX, clientY, formatMonthText(row.month) + '（' + formatShortDate(row.payDate) + '引き落とし）', tipRows);
  }
  function hideMonth() {
    highlight.setAttribute('visibility', 'hidden');
    hideTooltip();
  }
  hitArea.addEventListener('pointermove', (event) => {
    const box = svgElement.getBoundingClientRect();
    const pointerX = (event.clientX - box.left) * (width / box.width);
    let index = Math.floor((pointerX - padLeft) / bandWidth);
    index = Math.max(0, Math.min(rows.length - 1, index));
    showMonth(index, event.clientX, event.clientY);
  });
  hitArea.addEventListener('pointerleave', hideMonth);
  svgElement.addEventListener('blur', hideMonth);
  svgElement.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const nextIndex = event.key === 'ArrowLeft' ? Math.max(0, activeIndex - 1) : Math.min(rows.length - 1, activeIndex + 1);
    const box = svgElement.getBoundingClientRect();
    showMonth(nextIndex, box.left + centerOf(nextIndex) * (box.width / width), box.top + zeroY * (box.height / height));
  });
}


/* ===========================================================
   8. 株の利益の安心ライン（日ごとの推移・折れ線）
   rows = [{ date, base, tradeNet, needed, remaining }, ...]（古い順）
   橙の線 … 安心ラインに届くために必要な株の利益（下がるほど安心に近づく）
   緑の線 … 株の損益の累計（橙の線より上なら安心）
   =========================================================== */

function drawDailySafetyChart(container, rows) {
  if (rows.length < 1) {
    return;
  }
  const width = Math.max(280, container.clientWidth || 600);
  const height = 200;
  const padLeft = 54;
  const padRight = 12;
  const padTop = 12;
  const padBottom = 24;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  let low = 0;
  let high = 0;
  for (const row of rows) {
    low = Math.min(low, row.tradeNet);
    high = Math.max(high, row.needed, row.tradeNet);
  }
  const scale = niceScale(low, Math.max(high, 1), 4);
  function xOf(index) {
    if (rows.length === 1) {
      return padLeft + plotWidth; // 1日だけのときは右端に点を置く
    }
    return padLeft + plotWidth * (index / (rows.length - 1));
  }
  function yOf(value) {
    return padTop + plotHeight * (1 - (value - scale.min) / (scale.max - scale.min));
  }

  let svg = '<svg viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img" aria-label="日ごとの、必要な株の利益と株の損益の累計">';
  for (const tick of scale.ticks) {
    const y = yOf(tick).toFixed(1);
    svg += '<line class="grid-line" x1="' + padLeft + '" x2="' + (width - padRight) + '" y1="' + y + '" y2="' + y + '"/>';
    svg += '<text class="axis-text" x="' + (padLeft - 8) + '" y="' + (Number(y) + 4) + '" text-anchor="end">' + formatYenShort(tick) + '</text>';
  }

  // 折れ線2本
  let neededPath = '';
  let tradePath = '';
  for (let index = 0; index < rows.length; index++) {
    const command = index === 0 ? 'M' : 'L';
    neededPath += command + xOf(index).toFixed(1) + ',' + yOf(rows[index].needed).toFixed(1);
    tradePath += command + xOf(index).toFixed(1) + ',' + yOf(rows[index].tradeNet).toFixed(1);
  }
  svg += '<path d="' + neededPath + '" fill="none" stroke="var(--expense)" stroke-width="2.5" stroke-linejoin="round"/>';
  svg += '<path d="' + tradePath + '" fill="none" stroke="var(--chart-3)" stroke-width="2.5" stroke-linejoin="round"/>';
  const last = rows.length - 1;
  svg += '<circle cx="' + xOf(last).toFixed(1) + '" cy="' + yOf(rows[last].needed).toFixed(1) + '" r="4" fill="var(--expense)" stroke="var(--surface)" stroke-width="2"/>';
  svg += '<circle cx="' + xOf(last).toFixed(1) + '" cy="' + yOf(rows[last].tradeNet).toFixed(1) + '" r="4" fill="var(--chart-3)" stroke="var(--surface)" stroke-width="2"/>';

  // 日付の目盛り（最初・真ん中・最後）
  const labelIndexes = [...new Set([0, Math.floor(last / 2), last])];
  for (const index of labelIndexes) {
    const anchor = index === 0 ? 'start' : (index === last ? 'end' : 'middle');
    svg += '<text class="axis-text" x="' + xOf(index).toFixed(1) + '" y="' + (height - 6) + '" text-anchor="' + anchor + '">' + formatShortDate(rows[index].date) + '</text>';
  }
  svg += '</svg>';
  container.innerHTML = svg;
}


/* ===========================================================
   立体の積み上げ柱（手取り計算）
   -----------------------------------------------------------
   額面を「手取り・社会保険料・税金」に分けて、1本の立体の柱で見せます。
   3Dのライブラリは使わず、柱の角の点を計算して、SVG の四角形で描いています。
     ・左右になぞると回る（離すと少しすべってから止まる）。キーボードなら ← →
     ・額面が変わると、段の高さがなめらかに変わる
     ・段（または横の説明）にさわると、その段だけを目立たせる
   高さは「額面に対する割合」です。少し上から見下ろすだけで遠近法は使わないので、
   どの向きから見ても、段の高さの割合はゆがみません。
   =========================================================== */

const COLUMN_TILT = 24 * Math.PI / 180;         // 見下ろす角度
const COLUMN_START_ANGLE = -32 * Math.PI / 180; // はじめの向き

/** 長さ1の向き（ベクトル）にする */
function normalizeVector3d(x, y, z) {
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
}

// 光が来る向き（画面の左上・手前から）。面がこの向きに近いほど明るい
const COLUMN_LIGHT = normalizeVector3d(-0.45, 0.75, 0.5);

/**
 * 立体の点 (x, y, z) を、画面の上の点にする（y が高さ）。
 *   angle … 縦の軸のまわりに回す角度（ラジアン）
 *   tilt  … 少し上から見下ろす角度（ラジアン）
 * 返す値: { x: 横（右が+）, y: 縦（上が+）, depth: 奥行き（手前ほど大きい） }
 */
function project3d(x, y, z, angle, tilt) {
  const turnedX = x * Math.cos(angle) + z * Math.sin(angle);
  const turnedZ = -x * Math.sin(angle) + z * Math.cos(angle);
  return {
    x: turnedX,
    y: y * Math.cos(tilt) - turnedZ * Math.sin(tilt),
    depth: y * Math.sin(tilt) + turnedZ * Math.cos(tilt),
  };
}

// 箱の面（底は見えないので使わない）。normal は面が向いている方向、corners は4つの角
// 角は [横, 高さ（0なら下・1なら上）, 奥行き] で、横と奥行きは -1 か 1
const BOX_SIDES = [
  { side: 'front', normal: [0, 0, 1], corners: [[-1, 0, 1], [1, 0, 1], [1, 1, 1], [-1, 1, 1]] },
  { side: 'right', normal: [1, 0, 0], corners: [[1, 0, 1], [1, 0, -1], [1, 1, -1], [1, 1, 1]] },
  { side: 'back', normal: [0, 0, -1], corners: [[1, 0, -1], [-1, 0, -1], [-1, 1, -1], [1, 1, -1]] },
  { side: 'left', normal: [-1, 0, 0], corners: [[-1, 0, -1], [-1, 0, 1], [-1, 1, 1], [-1, 1, -1]] },
  { side: 'top', normal: [0, 1, 0], corners: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
];

/**
 * 箱（柱の1段）の、こちらから見えている面だけを返す。
 *   box = { halfWidth: 底の正方形の半分の幅, bottom: 下の高さ, top: 上の高さ }
 * 返す値: [{ side: 'front' など, points: 画面の点4つ [{x, y}], light: 明るさ 0〜1 }]
 */
function boxFaces3d(box, angle, tilt) {
  const faces = [];
  for (const face of BOX_SIDES) {
    // 面の向きを、見ている人から見た向きに直す。奥を向いている面は見えない
    const normal = project3d(face.normal[0], face.normal[1], face.normal[2], angle, tilt);
    if (normal.depth <= 0.001) {
      continue;
    }
    const points = [];
    for (const corner of face.corners) {
      const height = corner[1] === 1 ? box.top : box.bottom;
      const point = project3d(corner[0] * box.halfWidth, height, corner[2] * box.halfWidth, angle, tilt);
      points.push({ x: point.x, y: point.y });
    }
    // 光の向きに近いほど明るい
    const facing = normal.x * COLUMN_LIGHT.x + normal.y * COLUMN_LIGHT.y + normal.depth * COLUMN_LIGHT.z;
    faces.push({ side: face.side, points: points, light: Math.max(0, Math.min(1, facing)) });
  }
  return faces;
}

/**
 * 立体の積み上げ柱を作る。
 *   container … 柱を入れる場所（div）
 * 返す値: {
 *   update(parts, animate) … 段の中身を変える。parts = [{ key, label, value, color }]（下の段から順に）
 *   highlight(key)         … その段だけ目立たせる（null で元に戻す）
 *   onHighlight            … 柱にさわって目立たせる段が変わったときに呼ぶ関数（使う側が入れる）
 * }
 */
function createMoneyColumn3d(container) {
  const viewWidth = 150;
  const viewHeight = 214;
  const halfWidth = 34;     // 柱の太さの半分
  const columnHeight = 150; // 柱の高さ（額面ぜんぶ）
  const gap = 2.5;          // 段と段のすき間（色の境目をはっきりさせる）
  const centerX = viewWidth / 2;
  const baseY = viewHeight - 34; // 柱の底の真ん中の、画面での位置
  const reduceMotion = prefersReducedMotion(); // 03-helpers.js

  // 今の状態
  const state = {
    parts: [],         // [{ key, label, color, share: 目標の割合, shown: 今見せている割合 }]
    angle: COLUMN_START_ANGLE,
    spin: 0,           // 回る速さ（ラジアン/秒）。0に近づいて止まる
    highlighted: null, // 目立たせている段の key
    drag: null,        // なぞっている最中の情報
    running: false,    // 動きの計算をしているか
    lastTime: 0,
  };

  // SVG を作る。段は3つまで。1段の見える面は3つまでなので、面ごとに「色」と「陰」の四角を用意しておく
  let svgHtml = '<svg class="money3d-svg" viewBox="0 0 ' + viewWidth + ' ' + viewHeight + '" role="img" tabindex="0">' +
    '<defs><radialGradient id="money3dShadow"><stop offset="0" stop-color="#000" stop-opacity="0.2"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>' +
    '<ellipse cx="' + centerX + '" cy="' + (baseY + 6) + '" rx="66" ry="17" fill="url(#money3dShadow)"/>';
  for (let partIndex = 0; partIndex < 3; partIndex++) {
    svgHtml += '<g class="money3d-part" data-index="' + partIndex + '">';
    for (let faceIndex = 0; faceIndex < 3; faceIndex++) {
      svgHtml += '<polygon class="money3d-face"/><polygon class="money3d-shade"/>';
    }
    svgHtml += '</g>';
  }
  svgHtml += '</svg>';
  container.innerHTML = svgHtml;
  const svg = container.querySelector('svg');
  const groups = svg.querySelectorAll('.money3d-part');

  /** 今の状態で、柱を描く */
  function draw() {
    let visibleCount = 0;
    for (const part of state.parts) {
      if (part.shown > 0.002) {
        visibleCount = visibleCount + 1;
      }
    }
    const usableHeight = columnHeight - gap * Math.max(visibleCount - 1, 0);
    let bottom = 0;
    for (let partIndex = 0; partIndex < groups.length; partIndex++) {
      const group = groups[partIndex];
      const part = state.parts[partIndex];
      if (!part || part.shown <= 0.002) {
        group.style.display = 'none';
        continue;
      }
      group.style.display = '';
      const top = bottom + part.shown * usableHeight;
      const faces = boxFaces3d({ halfWidth: halfWidth, bottom: bottom, top: top }, state.angle, COLUMN_TILT);
      bottom = top + gap;

      const polygons = group.querySelectorAll('polygon');
      for (let faceIndex = 0; faceIndex < 3; faceIndex++) {
        const facePolygon = polygons[faceIndex * 2];
        const shadePolygon = polygons[faceIndex * 2 + 1];
        const face = faces[faceIndex];
        if (!face) {
          facePolygon.style.display = 'none';
          shadePolygon.style.display = 'none';
          continue;
        }
        let pointsText = '';
        for (const point of face.points) {
          pointsText += (centerX + point.x).toFixed(1) + ',' + (baseY - point.y).toFixed(1) + ' ';
        }
        facePolygon.setAttribute('points', pointsText);
        shadePolygon.setAttribute('points', pointsText);
        facePolygon.style.display = '';
        shadePolygon.style.display = '';
        facePolygon.style.fill = part.color;
        // 上の面は白を少し重ねて明るく、横の面は光から遠いほど黒を重ねて暗くする
        if (face.side === 'top') {
          shadePolygon.style.fill = '#fff';
          shadePolygon.style.fillOpacity = '0.16';
        } else {
          shadePolygon.style.fill = '#000';
          shadePolygon.style.fillOpacity = (0.06 + 0.4 * (1 - face.light)).toFixed(3);
        }
      }
    }
  }

  /** 高さの変化や、回したあとのすべりが終わるまで、少しずつ動かす */
  function step(now) {
    if (!svg.isConnected) {
      state.running = false; // 画面が切りかわったら止める
      return;
    }
    const seconds = Math.min((now - state.lastTime) / 1000, 0.05);
    state.lastTime = now;
    let moving = false;
    for (const part of state.parts) {
      const difference = part.share - part.shown;
      if (Math.abs(difference) > 0.0005) {
        part.shown = part.shown + difference * (1 - Math.exp(-seconds / 0.13));
        moving = true;
      } else {
        part.shown = part.share;
      }
    }
    if (!state.drag && Math.abs(state.spin) > 0.03) {
      state.angle = state.angle + state.spin * seconds;
      state.spin = state.spin * Math.exp(-seconds / 0.45);
      moving = true;
    } else if (!state.drag) {
      state.spin = 0;
    }
    draw();
    if (moving) {
      requestAnimationFrame(step);
    } else {
      state.running = false;
    }
  }

  /** 動きの計算を始める（もう動いていれば何もしない） */
  function startMoving() {
    if (state.running) {
      return;
    }
    state.running = true;
    state.lastTime = performance.now();
    requestAnimationFrame(step);
  }

  /** 目立たせる段を変える */
  function setHighlight(key, tellOutside) {
    state.highlighted = key;
    for (let partIndex = 0; partIndex < groups.length; partIndex++) {
      const part = state.parts[partIndex];
      groups[partIndex].classList.toggle('is-dim', key !== null && Boolean(part) && part.key !== key);
    }
    if (tellOutside && column.onHighlight) {
      column.onHighlight(key);
    }
  }

  /** 画面のどの段にさわったか（段の外なら null） */
  function partKeyOf(target) {
    const group = target.closest ? target.closest('.money3d-part') : null;
    if (!group) {
      return null;
    }
    const part = state.parts[Number(group.dataset.index)];
    return part ? part.key : null;
  }

  // なぞって回す（縦になぞったときは、ふつうに画面がスクロールする）
  svg.addEventListener('pointerdown', (event) => {
    state.drag = { startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastTime: performance.now(), moved: false, key: partKeyOf(event.target) };
    state.spin = 0;
    try {
      svg.setPointerCapture(event.pointerId);
    } catch (error) {
      // つかめない環境では、そのまま
    }
  });
  svg.addEventListener('pointermove', (event) => {
    if (!state.drag) {
      if (event.pointerType === 'mouse') {
        const key = partKeyOf(event.target);
        if (key !== state.highlighted) {
          setHighlight(key, true);
        }
      }
      return;
    }
    const now = performance.now();
    const moveX = event.clientX - state.drag.lastX;
    if (Math.abs(event.clientX - state.drag.startX) > 6 || Math.abs(event.clientY - state.drag.startY) > 6) {
      state.drag.moved = true;
    }
    const turn = moveX * 0.012;
    state.angle = state.angle + turn;
    const elapsed = Math.max(now - state.drag.lastTime, 1) / 1000;
    state.spin = Math.max(-12, Math.min(12, turn / elapsed));
    state.drag.lastX = event.clientX;
    state.drag.lastTime = now;
    draw();
  });
  function endDrag(event, canceled) {
    if (!state.drag) {
      return;
    }
    const drag = state.drag;
    state.drag = null;
    if (!drag.moved && !canceled) {
      // なぞらずに押しただけ: その段を目立たせる（もう一度押すと元に戻す）
      setHighlight(drag.key === state.highlighted ? null : drag.key, true);
      state.spin = 0;
      return;
    }
    // 指を止めてから離したときや、動きを減らす設定のときは、すべらせない
    if (canceled || reduceMotion || performance.now() - drag.lastTime > 80) {
      state.spin = 0;
    }
    startMoving();
  }
  svg.addEventListener('pointerup', (event) => endDrag(event, false));
  svg.addEventListener('pointercancel', (event) => endDrag(event, true));
  svg.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse' && !state.drag && state.highlighted !== null) {
      setHighlight(null, true);
    }
  });
  // キーボードの ← → で回す
  svg.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    if (reduceMotion) {
      state.angle = state.angle + direction * 0.4;
      draw();
      return;
    }
    state.spin = direction * 4;
    startMoving();
  });

  const column = {
    onHighlight: null,

    update(parts, animate) {
      let total = 0;
      for (const part of parts) {
        total = total + Math.max(part.value, 0);
      }
      const isFirst = state.parts.length === 0;
      const newParts = [];
      for (let partIndex = 0; partIndex < parts.length; partIndex++) {
        const part = parts[partIndex];
        const old = state.parts[partIndex];
        newParts.push({
          key: part.key,
          label: part.label,
          color: part.color,
          share: total > 0 ? Math.max(part.value, 0) / total : 0,
          shown: old && old.key === part.key ? old.shown : 0,
        });
      }
      state.parts = newParts;

      // 読み上げ用の説明
      let description = '';
      for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
        description += parts[partIndex].label + formatYen(parts[partIndex].value) + '（' + Math.round(newParts[partIndex].share * 100) + '%）';
        description += partIndex > 0 ? '、' : '。';
      }
      svg.setAttribute('aria-label', '額面の内訳の立体の柱: ' + description + '左右になぞるか、← → キーで回せます。');

      if (!animate || reduceMotion) {
        for (const part of state.parts) {
          part.shown = part.share;
        }
        draw();
        return;
      }
      if (isFirst) {
        // はじめて出すときは、下から伸びながら少し回って止まる
        state.angle = COLUMN_START_ANGLE - 0.9;
        state.spin = 2.0;
      }
      startMoving();
    },

    highlight(key) {
      setHighlight(key, false);
    },
  };
  return column;
}
