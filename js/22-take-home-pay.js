/* ===========================================================
   22-take-home-pay.js  ―  手取り計算
   -----------------------------------------------------------
   額面（会社から支払われるお給料の合計）を入れると、
   社会保険料・所得税・住民税を引いた「手取り」を自動で計算します。
     1. 料率と税のきまり（TAKE_HOME_RULES）… 毎年見直す
     2. 計算（calculateTakeHomePay など）… tests/tests.js でテストしています
     3. 画面（TakeHomeScreen）

   【計算のもと（2026年度＝令和8年度）】
     ・健康保険・介護保険・子ども子育て支援金 … 協会けんぽ「令和8年度保険料率」
         健康保険は都道府県ごと（3月分から）。支援金は4月分から全国一律 0.23%
     ・厚生年金 … 18.3%（会社と半分ずつ）
     ・雇用保険 … 厚生労働省「令和8年度の雇用保険料率」一般の事業は本人 5/1000
     ・所得税 … 国税庁「源泉所得税の改正のあらまし（令和8年4月）」
         基礎控除と給与所得控除の引き上げ（2026年分の年末調整から）
     ・住民税 … 所得割 10%・均等割 5,000円（森林環境税をふくむ）・基礎控除 43万円

   【いつ見直すか】
     ・毎年3月ごろ … 協会けんぽの健康保険料率（都道府県ごと）と介護保険料率
     ・毎年4月ごろ … 雇用保険料率・子ども子育て支援金率
     ・毎年12月ごろ … 税制改正（基礎控除・給与所得控除・税率）
     数字は公式の資料だけで確かめ、直したら checkedAt と reviewAfter も直す。

   入れた額面は、アプリを開いている間だけ使います（保存も送信もしません）。
   =========================================================== */


/* ===========================================================
   1. 料率と税のきまり（2026年度）
   =========================================================== */

const TAKE_HOME_RULES = {
  yearLabel: '2026年度',
  checkedAt: '2026-10-04',   // 公式の資料で数字を確かめた日
  reviewAfter: '2027-03-01', // この日からは新しい料率になっているかもしれない

  // 健康保険料率（%）協会けんぽ・令和8年3月分から。会社と半分ずつ払う
  healthRates: [
    { prefecture: '北海道', rate: 10.28 }, { prefecture: '青森県', rate: 9.85 }, { prefecture: '岩手県', rate: 9.51 },
    { prefecture: '宮城県', rate: 10.10 }, { prefecture: '秋田県', rate: 10.01 }, { prefecture: '山形県', rate: 9.75 },
    { prefecture: '福島県', rate: 9.50 }, { prefecture: '茨城県', rate: 9.52 }, { prefecture: '栃木県', rate: 9.82 },
    { prefecture: '群馬県', rate: 9.68 }, { prefecture: '埼玉県', rate: 9.67 }, { prefecture: '千葉県', rate: 9.73 },
    { prefecture: '東京都', rate: 9.85 }, { prefecture: '神奈川県', rate: 9.92 }, { prefecture: '新潟県', rate: 9.21 },
    { prefecture: '富山県', rate: 9.59 }, { prefecture: '石川県', rate: 9.70 }, { prefecture: '福井県', rate: 9.71 },
    { prefecture: '山梨県', rate: 9.55 }, { prefecture: '長野県', rate: 9.63 }, { prefecture: '岐阜県', rate: 9.80 },
    { prefecture: '静岡県', rate: 9.61 }, { prefecture: '愛知県', rate: 9.93 }, { prefecture: '三重県', rate: 9.77 },
    { prefecture: '滋賀県', rate: 9.88 }, { prefecture: '京都府', rate: 9.89 }, { prefecture: '大阪府', rate: 10.13 },
    { prefecture: '兵庫県', rate: 10.12 }, { prefecture: '奈良県', rate: 9.91 }, { prefecture: '和歌山県', rate: 10.06 },
    { prefecture: '鳥取県', rate: 9.86 }, { prefecture: '島根県', rate: 9.94 }, { prefecture: '岡山県', rate: 10.05 },
    { prefecture: '広島県', rate: 9.78 }, { prefecture: '山口県', rate: 10.15 }, { prefecture: '徳島県', rate: 10.24 },
    { prefecture: '香川県', rate: 10.02 }, { prefecture: '愛媛県', rate: 9.98 }, { prefecture: '高知県', rate: 10.05 },
    { prefecture: '福岡県', rate: 10.11 }, { prefecture: '佐賀県', rate: 10.55 }, { prefecture: '長崎県', rate: 10.06 },
    { prefecture: '熊本県', rate: 10.08 }, { prefecture: '大分県', rate: 10.08 }, { prefecture: '宮崎県', rate: 9.77 },
    { prefecture: '鹿児島県', rate: 10.13 }, { prefecture: '沖縄県', rate: 9.44 },
  ],
  careRate: 1.62,          // 介護保険料率（%）40〜64歳の人だけ。会社と半分ずつ
  childSupportRate: 0.23,  // 子ども・子育て支援金率（%）会社と半分ずつ
  pensionRate: 18.3,       // 厚生年金保険料率（%）会社と半分ずつ
  employmentRate: 0.5,     // 雇用保険料率（%）本人が払う分（一般の事業）

  bonusHealthCapPerYear: 5730000,     // ボーナスの健康保険・介護・支援金は、1年（4月〜3月）573万円まで
  bonusPensionCapPerPayment: 1500000, // ボーナスの厚生年金は、1回150万円まで
  commuteTaxFreeLimit: 150000,        // 交通費（電車・バス）は月15万円まで税金がかからない
  residentPerCapita: 5000,            // 住民税の均等割（市町村3,000円・都道府県1,000円・森林環境税1,000円）
};

// 標準報酬月額の表（健康保険）: [お給料がこの金額以上なら, 保険料の計算に使う金額]
// 厚生年金も同じ表を使うが、8.8万円〜65万円の間におさめる（pensionStandardPayOf）
const STANDARD_PAY_TABLE = [
  [0, 58000], [63000, 68000], [73000, 78000], [83000, 88000], [93000, 98000],
  [101000, 104000], [107000, 110000], [114000, 118000], [122000, 126000], [130000, 134000],
  [138000, 142000], [146000, 150000], [155000, 160000], [165000, 170000], [175000, 180000],
  [185000, 190000], [195000, 200000], [210000, 220000], [230000, 240000], [250000, 260000],
  [270000, 280000], [290000, 300000], [310000, 320000], [330000, 340000], [350000, 360000],
  [370000, 380000], [395000, 410000], [425000, 440000], [455000, 470000], [485000, 500000],
  [515000, 530000], [545000, 560000], [575000, 590000], [605000, 620000], [635000, 650000],
  [665000, 680000], [695000, 710000], [730000, 750000], [770000, 790000], [810000, 830000],
  [855000, 880000], [905000, 930000], [955000, 980000], [1005000, 1030000], [1055000, 1090000],
  [1115000, 1150000], [1175000, 1210000], [1235000, 1270000], [1295000, 1330000], [1355000, 1390000],
];

// 所得税の税率（課税される所得が upTo 円まで → rate%、そこから minus 円を引く）
const INCOME_TAX_BRACKETS = [
  { upTo: 1949000, rate: 5, minus: 0 },
  { upTo: 3299000, rate: 10, minus: 97500 },
  { upTo: 6949000, rate: 20, minus: 427500 },
  { upTo: 8999000, rate: 23, minus: 636000 },
  { upTo: 17999000, rate: 33, minus: 1536000 },
  { upTo: 39999000, rate: 40, minus: 2796000 },
  { upTo: Infinity, rate: 45, minus: 4796000 },
];


/* ===========================================================
   2. 計算
   =========================================================== */

/**
 * 金額の入力を数字にする。「300000」「300,000」のほか「30万」「30万5000」も読める。
 * 空なら null、読めなければ NaN を返す。
 */
function takeHomeAmountOf(text) {
  let source = String(text || '').normalize('NFKC').replace(/[,\s円¥]/g, '');
  if (source === '') {
    return null;
  }
  // 「万」を「×10000＋」に置きかえて、ふつうの計算（calculateAmount）にまかせる
  source = source.replace(/万/g, '*10000+');
  if (source.endsWith('+')) {
    source = source.slice(0, -1);
  }
  return calculateAmount(source);
}

/** 標準報酬月額（健康保険）: 毎月のお給料を表に当てはめた、保険料の計算に使う金額 */
function standardMonthlyPayOf(monthlyPay) {
  let standard = STANDARD_PAY_TABLE[0][1];
  for (const row of STANDARD_PAY_TABLE) {
    if (monthlyPay >= row[0]) {
      standard = row[1];
    }
  }
  return standard;
}

/** 厚生年金の標準報酬月額: 健康保険と同じ表で、8.8万円〜65万円の間におさめる */
function pensionStandardPayOf(standardPay) {
  return Math.min(Math.max(standardPay, 88000), 650000);
}

/**
 * 保険料の本人の分の端数: 「numerator ÷ denominator」円を、
 * 50銭以下なら切り捨て、50銭より多ければ切り上げる（給料から引くときの決まり）。
 * 小数の誤差でずれないように、割り算の「あまり」を整数のまま比べる。
 */
function roundEmployeeShare(numerator, denominator) {
  const yen = Math.floor(numerator / denominator);
  const remainder = numerator - yen * denominator;
  if (remainder * 2 > denominator) {
    return yen + 1;
  }
  return yen;
}

/** base 円に rate%（会社と半分ずつ）をかけた、本人が払う保険料 */
function halfPremiumOf(base, rate) {
  // 9.85% → 9850 のように整数にしてから計算する（base × 9850 ÷ 100000 ÷ 2）
  return roundEmployeeShare(base * Math.round(rate * 1000), 200000);
}

/** 都道府県の健康保険料率（%）。見つからなければ東京都 */
function healthRateOf(prefecture) {
  let tokyoRate = 0;
  for (const row of TAKE_HOME_RULES.healthRates) {
    if (row.prefecture === prefecture) {
      return row.rate;
    }
    if (row.prefecture === '東京都') {
      tokyoRate = row.rate;
    }
  }
  return tokyoRate;
}

/**
 * 1か月分（またはボーナス1回分）の社会保険料（本人の分）。
 *   healthBase  … 健康保険・介護・支援金のもとになる金額（標準報酬月額 / 標準賞与額）
 *   pensionBase … 厚生年金のもとになる金額
 *   pay         … 雇用保険のもとになる、実際に払われた金額
 *   conditions  … { prefecture: 都道府県, ageGroup: 年齢の区分 }
 */
function socialInsuranceOf(healthBase, pensionBase, pay, conditions) {
  const healthRate = healthRateOf(conditions.prefecture);
  const health = halfPremiumOf(healthBase, healthRate);

  // 介護保険（40〜64歳）は健康保険と合わせて端数を処理するので、合計から健康保険の分を引いて出す
  let care = 0;
  if (conditions.ageGroup === 'from40to64') {
    care = halfPremiumOf(healthBase, healthRate + TAKE_HOME_RULES.careRate) - health;
  }

  const childSupport = halfPremiumOf(healthBase, TAKE_HOME_RULES.childSupportRate);

  // 厚生年金は70歳になるまで
  let pension = 0;
  if (conditions.ageGroup !== 'from70') {
    pension = halfPremiumOf(pensionBase, TAKE_HOME_RULES.pensionRate);
  }

  // 雇用保険は本人の分だけの料率なので、半分にはしない（pay × 5 ÷ 1000）
  const employment = roundEmployeeShare(pay * Math.round(TAKE_HOME_RULES.employmentRate * 1000), 100000);

  return {
    health: health,
    care: care,
    childSupport: childSupport,
    pension: pension,
    employment: employment,
    total: health + care + childSupport + pension + employment,
  };
}

/**
 * 給与所得（お給料の収入から「給与所得控除」を引いた額）。2026年分（令和8年分）のきまり。
 * 収入660万円未満は、国税庁の「年末調整等のための給与所得控除後の給与等の金額の表」と
 * 同じになるように、4,000円きざみで計算する。
 */
function salaryIncomeOf(revenue) {
  if (revenue < 741000) {
    return 0;
  }
  // 2026年・2027年は、収入220万円未満なら74万円を引く（220万円の手前は国税庁の表のとおり）
  if (revenue < 2191000) {
    return revenue - 740000;
  }
  if (revenue < 2193000) {
    return 1451000;
  }
  if (revenue < 2196000) {
    return 1453000;
  }
  if (revenue < 2200000) {
    return 1456000;
  }
  if (revenue < 6600000) {
    const roundedRevenue = Math.floor(revenue / 4000) * 4000;
    if (revenue < 3600000) {
      return roundedRevenue * 7 / 10 - 80000;  // 控除は「収入×30%＋8万円」
    }
    return roundedRevenue * 8 / 10 - 440000;   // 控除は「収入×20%＋44万円」
  }
  if (revenue < 8500000) {
    return Math.floor(revenue * 9 / 10) - 1100000; // 控除は「収入×10%＋110万円」
  }
  return revenue - 1950000; // 控除は195万円まで
}

/** 所得税の基礎控除（2026年分）。所得（合計所得金額）が多いと減る */
function incomeTaxBasicDeductionOf(totalIncome) {
  if (totalIncome <= 4890000) {
    return 1040000; // 62万円 ＋ 2026・2027年の上乗せ42万円
  }
  if (totalIncome <= 6550000) {
    return 670000;  // 62万円 ＋ 上乗せ5万円
  }
  if (totalIncome <= 23500000) {
    return 620000;
  }
  if (totalIncome <= 24000000) {
    return 480000;
  }
  if (totalIncome <= 24500000) {
    return 320000;
  }
  if (totalIncome <= 25000000) {
    return 160000;
  }
  return 0;
}

/** 住民税の基礎控除 */
function residentTaxBasicDeductionOf(totalIncome) {
  if (totalIncome <= 24000000) {
    return 430000;
  }
  if (totalIncome <= 24500000) {
    return 290000;
  }
  if (totalIncome <= 25000000) {
    return 150000;
  }
  return 0;
}

/**
 * 配偶者控除（配偶者は70歳未満で、収入が少なく扶養に入っているとする）。
 * 本人の所得が900万円をこえると減り、1000万円をこえると0になる。
 */
function spouseDeductionOf(totalIncome, forResidentTax) {
  if (totalIncome <= 9000000) {
    return forResidentTax ? 330000 : 380000;
  }
  if (totalIncome <= 9500000) {
    return forResidentTax ? 220000 : 260000;
  }
  if (totalIncome <= 10000000) {
    return forResidentTax ? 110000 : 130000;
  }
  return 0;
}

/**
 * 1年分の所得税（復興特別所得税 2.1% をふくむ。年末調整と同じ計算）。
 *   revenue         … 税金がかかるお給料の1年分（非課税の交通費は除く）
 *   socialInsurance … 1年に払った社会保険料（全額が控除になる）
 *   family          … { spouse: 配偶者を扶養しているか, dependents: ほかに扶養している人数 }
 */
function incomeTaxForYear(revenue, socialInsurance, family) {
  const income = salaryIncomeOf(revenue);
  let deductions = socialInsurance + incomeTaxBasicDeductionOf(income) + family.dependents * 380000;
  if (family.spouse) {
    deductions = deductions + spouseDeductionOf(income, false);
  }
  const taxable = Math.floor(Math.max(income - deductions, 0) / 1000) * 1000; // 1000円未満は切り捨て

  let tax = 0;
  for (const bracket of INCOME_TAX_BRACKETS) {
    if (taxable <= bracket.upTo) {
      tax = taxable * bracket.rate / 100 - bracket.minus;
      break;
    }
  }
  // 復興特別所得税（2.1%）を足して、100円未満を切り捨てる
  return Math.floor(tax * 1021 / 100000) * 100;
}

/**
 * 1年分の住民税（所得割10%＋均等割）。この収入の年の次の年の6月から引かれる分。
 * 所得が少なくて非課税になる線は、東京23区などの大きな市（1級地）のもの。
 * 引数は incomeTaxForYear と同じ。
 */
function residentTaxForYear(revenue, socialInsurance, family) {
  const income = salaryIncomeOf(revenue);
  const supportedCount = family.dependents + (family.spouse ? 1 : 0); // 扶養している人数（配偶者もふくむ）

  // 所得が少ない人は非課税（均等割の線のほうが低い）
  let perCapitaLine = 350000 * (1 + supportedCount) + 100000;
  let incomeLevyLine = perCapitaLine;
  if (supportedCount > 0) {
    perCapitaLine = perCapitaLine + 210000;
    incomeLevyLine = incomeLevyLine + 320000;
  }
  if (income <= perCapitaLine) {
    return 0;
  }
  const perCapita = TAKE_HOME_RULES.residentPerCapita;
  if (income <= incomeLevyLine) {
    return perCapita;
  }

  let deductions = socialInsurance + residentTaxBasicDeductionOf(income) + family.dependents * 330000;
  if (family.spouse) {
    deductions = deductions + spouseDeductionOf(income, true);
  }
  const taxable = Math.floor(Math.max(income - deductions, 0) / 1000) * 1000;

  // 調整控除: 所得税と住民税の控除の差（基礎控除なら5万円）に応じて、少し減らす
  let deductionGap = 50000 + family.dependents * 50000;
  if (family.spouse) {
    deductionGap = deductionGap + spouseDeductionOf(income, false) - spouseDeductionOf(income, true);
  }
  let adjustmentBase = 0;
  if (income <= 25000000) {
    if (taxable <= 2000000) {
      adjustmentBase = Math.min(deductionGap, taxable);
    } else {
      adjustmentBase = Math.max(deductionGap - (taxable - 2000000), 50000);
    }
  }

  // 市町村 6%（調整控除は3%）・都道府県 4%（調整控除は2%）。それぞれ100円未満を切り捨てる
  const cityLevy = Math.max(Math.floor((taxable * 6 - adjustmentBase * 3) / 10000) * 100, 0);
  const prefectureLevy = Math.max(Math.floor((taxable * 4 - adjustmentBase * 2) / 10000) * 100, 0);
  return cityLevy + prefectureLevy + perCapita;
}

/**
 * 手取りを計算する。額面が0以下なら null。
 *   input = {
 *     monthlyGross … 額面の月給（交通費もふくむ総支給額）
 *     commute      … そのうち交通費（非課税）。なければ 0
 *     bonusYearly  … ボーナスの1年の合計（額面）。なければ 0
 *     ageGroup     … 'under40' / 'from40to64' / 'from65to69' / 'from70'
 *     prefecture   … 都道府県（協会けんぽの料率を使う）
 *     spouse       … 配偶者を扶養しているか
 *     dependents   … ほかに扶養している家族の人数（16歳以上の子・親など）
 *   }
 * 返す値: { standardPay, pensionStandardPay, monthly: {...}, bonus: {...} または null, yearly: {...} }
 */
function calculateTakeHomePay(input) {
  const monthlyGross = Math.round(Number(input.monthlyGross) || 0);
  if (monthlyGross <= 0) {
    return null;
  }
  const bonusYearly = Math.max(Math.round(Number(input.bonusYearly) || 0), 0);
  let commute = Math.max(Math.round(Number(input.commute) || 0), 0);
  commute = Math.min(commute, TAKE_HOME_RULES.commuteTaxFreeLimit, monthlyGross);
  const conditions = { prefecture: input.prefecture || '東京都', ageGroup: input.ageGroup || 'under40' };
  const family = { spouse: Boolean(input.spouse), dependents: Math.max(Math.floor(Number(input.dependents) || 0), 0) };

  // 1. 毎月の社会保険料（交通費もふくめた額面で決まる）
  const standardPay = standardMonthlyPayOf(monthlyGross);
  const pensionStandardPay = pensionStandardPayOf(standardPay);
  const monthlyInsurance = socialInsuranceOf(standardPay, pensionStandardPay, monthlyGross, conditions);

  // 2. ボーナスの社会保険料（夏と冬の2回に半分ずつ払われるとして計算）
  let bonusInsurance = null;
  if (bonusYearly > 0) {
    const firstPayment = Math.floor(bonusYearly / 2);
    const payments = [firstPayment, bonusYearly - firstPayment];
    bonusInsurance = { health: 0, care: 0, childSupport: 0, pension: 0, employment: 0, total: 0 };
    let healthCapLeft = TAKE_HOME_RULES.bonusHealthCapPerYear;
    for (const payment of payments) {
      const standardBonus = Math.floor(payment / 1000) * 1000; // 標準賞与額（1000円未満は切り捨て）
      const healthBase = Math.min(standardBonus, healthCapLeft);
      healthCapLeft = healthCapLeft - healthBase;
      const pensionBase = Math.min(standardBonus, TAKE_HOME_RULES.bonusPensionCapPerPayment);
      const once = socialInsuranceOf(healthBase, pensionBase, payment, conditions);
      for (const key of Object.keys(bonusInsurance)) {
        bonusInsurance[key] = bonusInsurance[key] + once[key];
      }
    }
  }

  // 3. 税金。所得税は1年分を出して、ボーナスで増えた分はボーナスから引くものとする
  const bonusInsuranceTotal = bonusInsurance ? bonusInsurance.total : 0;
  const yearlyInsurance = monthlyInsurance.total * 12 + bonusInsuranceTotal;
  const taxableMonthly = monthlyGross - commute;
  const incomeTaxSalaryOnly = incomeTaxForYear(taxableMonthly * 12, monthlyInsurance.total * 12, family);
  const incomeTaxYear = incomeTaxForYear(taxableMonthly * 12 + bonusYearly, yearlyInsurance, family);
  const residentTaxYear = residentTaxForYear(taxableMonthly * 12 + bonusYearly, yearlyInsurance, family);

  const monthlyIncomeTax = Math.round(incomeTaxSalaryOnly / 12);
  const monthlyResidentTax = Math.round(residentTaxYear / 12); // 住民税は1年分を12回に分けて引く
  const monthly = {
    gross: monthlyGross,
    health: monthlyInsurance.health,
    care: monthlyInsurance.care,
    childSupport: monthlyInsurance.childSupport,
    pension: monthlyInsurance.pension,
    employment: monthlyInsurance.employment,
    socialInsurance: monthlyInsurance.total,
    incomeTax: monthlyIncomeTax,
    residentTax: monthlyResidentTax,
    takeHome: monthlyGross - monthlyInsurance.total - monthlyIncomeTax - monthlyResidentTax,
  };

  let bonus = null;
  if (bonusInsurance) {
    const bonusIncomeTax = incomeTaxYear - incomeTaxSalaryOnly;
    bonus = {
      gross: bonusYearly,
      health: bonusInsurance.health,
      care: bonusInsurance.care,
      childSupport: bonusInsurance.childSupport,
      pension: bonusInsurance.pension,
      employment: bonusInsurance.employment,
      socialInsurance: bonusInsurance.total,
      incomeTax: bonusIncomeTax,
      takeHome: bonusYearly - bonusInsurance.total - bonusIncomeTax,
    };
  }

  const yearlyGross = monthlyGross * 12 + bonusYearly;
  const yearly = {
    gross: yearlyGross,
    socialInsurance: yearlyInsurance,
    incomeTax: incomeTaxYear,
    residentTax: residentTaxYear,
    takeHome: yearlyGross - yearlyInsurance - incomeTaxYear - residentTaxYear,
  };

  return { standardPay: standardPay, pensionStandardPay: pensionStandardPay, monthly: monthly, bonus: bonus, yearly: yearly };
}


/* ===========================================================
   3. 画面
   =========================================================== */

// 入力欄の中身（アプリを開いている間だけ覚えておく。家計簿のデータには保存しない）
const takeHomeForm = {
  monthlyGross: '',
  bonusYearly: '',
  commute: '',
  ageGroup: 'under40',
  prefecture: '東京都',
  spouse: false,
  dependents: 0,
  conditionsOpen: false, // 「条件」を開いているか
};

// いま画面に出している結果のもとになった入力（同じなら描き直さない）
let takeHomeShownValues = '';

const TAKE_HOME_AGE_GROUPS = [
  { id: 'under40', label: '40歳未満' },
  { id: 'from40to64', label: '40〜64歳' },
  { id: 'from65to69', label: '65〜69歳' },
  { id: 'from70', label: '70歳以上' },
];

const TakeHomeScreen = {
  title: '手取り', // スマホの上のバーに1行で収まるように短く（メニューでは「手取り計算」）
  usesPeriod: false,

  html() {
    takeHomeShownValues = takeHomeFormValues();
    return '<div class="grid">' + takeHomeFormHtml() +
      '<div class="span-7 takehome-results" id="takeHomeResult">' + takeHomeResultHtml() + '</div></div>';
  },

  afterRender() {
    // 入力が変わるたびに、結果だけを描き直す（入力中の欄はそのまま）
    const form = findOne('#takeHomeForm');
    form.addEventListener('input', readTakeHomeForm);
    form.addEventListener('change', readTakeHomeForm);
    const conditions = findOne('#takeHomeConditions');
    conditions.addEventListener('toggle', () => {
      takeHomeForm.conditionsOpen = conditions.open;
    });
  },
};

/** 入力欄のかたまり */
function takeHomeFormHtml() {
  let ageOptions = '';
  for (const group of TAKE_HOME_AGE_GROUPS) {
    ageOptions += '<option value="' + group.id + '"' + (group.id === takeHomeForm.ageGroup ? ' selected' : '') + '>' + group.label + '</option>';
  }
  let prefectureOptions = '';
  for (const row of TAKE_HOME_RULES.healthRates) {
    prefectureOptions += '<option' + (row.prefecture === takeHomeForm.prefecture ? ' selected' : '') + '>' + escapeHtml(row.prefecture) + '</option>';
  }
  let dependentOptions = '';
  for (let count = 0; count <= 6; count++) {
    dependentOptions += '<option value="' + count + '"' + (count === takeHomeForm.dependents ? ' selected' : '') + '>' + count + '人</option>';
  }

  return '<section class="card span-5 takehome-form" id="takeHomeForm">' +
    '<label class="field"><span>額面（1か月の総支給額）</span>' +
    '<div class="amount-input"><span aria-hidden="true">¥</span><input id="takeHomeGross" inputmode="numeric" autocomplete="off" placeholder="300000" value="' + escapeHtml(takeHomeForm.monthlyGross) + '"></div></label>' +
    '<details class="more" id="takeHomeConditions"' + (takeHomeForm.conditionsOpen ? ' open' : '') + '>' +
    '<summary>条件: <span id="takeHomeConditionText">' + takeHomeConditionHtml() + '</span></summary>' +
    '<div class="takehome-fields">' +
    '<label class="field"><span>年齢</span><select id="takeHomeAge">' + ageOptions + '</select></label>' +
    '<label class="field"><span>都道府県</span><select id="takeHomePrefecture">' + prefectureOptions + '</select></label>' +
    '<label class="field"><span>ボーナス（年間）</span><div class="amount-input"><span aria-hidden="true">¥</span>' +
    '<input id="takeHomeBonus" inputmode="numeric" autocomplete="off" placeholder="0" value="' + escapeHtml(takeHomeForm.bonusYearly) + '"></div></label>' +
    '<label class="field"><span>うち交通費（月）</span><div class="amount-input"><span aria-hidden="true">¥</span>' +
    '<input id="takeHomeCommute" inputmode="numeric" autocomplete="off" placeholder="0" value="' + escapeHtml(takeHomeForm.commute) + '"></div></label>' +
    '<label class="check takehome-row"><input type="checkbox" id="takeHomeSpouse"' + (takeHomeForm.spouse ? ' checked' : '') + '>配偶者を扶養している</label>' +
    '<label class="takehome-row"><span>扶養している子・親（16歳以上）</span><select id="takeHomeDependents">' + dependentOptions + '</select></label>' +
    '</div></details>' +
    '</section>';
}

/** 入力欄の中身を1つの文字にまとめる（変わったかどうかを比べるため） */
function takeHomeFormValues() {
  return JSON.stringify([takeHomeForm.monthlyGross, takeHomeForm.bonusYearly, takeHomeForm.commute,
    takeHomeForm.ageGroup, takeHomeForm.prefecture, takeHomeForm.spouse, takeHomeForm.dependents]);
}

/** 入力欄が変わったとき: 中身を覚えて、条件の1行と結果を描き直す */
function readTakeHomeForm() {
  takeHomeForm.monthlyGross = findOne('#takeHomeGross').value;
  takeHomeForm.bonusYearly = findOne('#takeHomeBonus').value;
  takeHomeForm.commute = findOne('#takeHomeCommute').value;
  takeHomeForm.ageGroup = findOne('#takeHomeAge').value;
  takeHomeForm.prefecture = findOne('#takeHomePrefecture').value;
  takeHomeForm.spouse = findOne('#takeHomeSpouse').checked;
  takeHomeForm.dependents = Number(findOne('#takeHomeDependents').value);

  // 入力欄から指を離しただけ（change）で中身が同じなら、描き直さない。
  // 描き直すと、ちょうどタップした「条件」などが入れかわって、タップが効かなくなるため。
  const values = takeHomeFormValues();
  if (values === takeHomeShownValues) {
    return;
  }
  takeHomeShownValues = values;
  findOne('#takeHomeConditionText').innerHTML = takeHomeConditionHtml();
  findOne('#takeHomeResult').innerHTML = takeHomeResultHtml();
}

/**
 * 「条件」の1行（例: 40歳未満・東京都・扶養なし・ボーナスなし）。
 * スマホで「ボーナスな／し」のように言葉の途中で折り返さないよう、1つずつ <span> で囲む。
 */
function takeHomeConditionHtml() {
  const parts = takeHomeConditionParts();
  let html = '';
  for (let index = 0; index < parts.length; index++) {
    html += '<span>' + escapeHtml(parts[index]) + (index < parts.length - 1 ? '・' : '') + '</span>';
  }
  return html;
}

/** 「条件」の1行に並べる言葉の一覧 */
function takeHomeConditionParts() {
  const parts = [];
  for (const group of TAKE_HOME_AGE_GROUPS) {
    if (group.id === takeHomeForm.ageGroup) {
      parts.push(group.label);
    }
  }
  parts.push(takeHomeForm.prefecture);
  const supportedCount = takeHomeForm.dependents + (takeHomeForm.spouse ? 1 : 0);
  parts.push(supportedCount > 0 ? '扶養' + supportedCount + '人' : '扶養なし');
  const bonus = takeHomeAmountOf(takeHomeForm.bonusYearly);
  parts.push(bonus > 0 ? 'ボーナス年' + formatYenShort(bonus) + '円' : 'ボーナスなし');
  const commute = takeHomeAmountOf(takeHomeForm.commute);
  if (commute > 0) {
    parts.push('交通費' + formatYenShort(commute) + '円');
  }
  return parts;
}

/** 入力のまちがいを1つ返す（なければ空） */
function takeHomeInputProblem(gross, bonus, commute) {
  if (Number.isNaN(gross) || gross <= 0 || gross > 100000000) {
    return '額面は数字で入れてください（例: 300000 や 30万）。';
  }
  if (Number.isNaN(bonus) || bonus < 0 || bonus > 1000000000) {
    return 'ボーナスは数字で入れてください（なければ空のまま）。';
  }
  if (Number.isNaN(commute) || commute < 0 || commute > gross) {
    return '交通費は、額面より少ない数字で入れてください（なければ空のまま）。';
  }
  return '';
}

/** 結果のカード（毎月・ボーナス・1年） */
function takeHomeResultHtml() {
  const gross = takeHomeAmountOf(takeHomeForm.monthlyGross);
  if (gross === null) {
    return '<section class="card"><p class="empty-note">額面を入れると、手取りがすぐに出ます。</p></section>';
  }
  // ボーナスと交通費は、空なら0（読めない文字なら NaN のままにして、下でまちがいを知らせる）
  let bonus = takeHomeAmountOf(takeHomeForm.bonusYearly);
  if (bonus === null) {
    bonus = 0;
  }
  let commute = takeHomeAmountOf(takeHomeForm.commute);
  if (commute === null) {
    commute = 0;
  }
  const problem = takeHomeInputProblem(gross, bonus, commute);
  if (problem !== '') {
    return '<section class="card"><p class="form-error" role="alert">' + problem + '</p></section>';
  }

  const result = calculateTakeHomePay({
    monthlyGross: gross,
    bonusYearly: bonus,
    commute: commute,
    ageGroup: takeHomeForm.ageGroup,
    prefecture: takeHomeForm.prefecture,
    spouse: takeHomeForm.spouse,
    dependents: takeHomeForm.dependents,
  });
  const monthly = result.monthly;

  // 毎月
  let html = '<section class="card">' +
    '<div class="card-head"><h2>毎月の手取り</h2><span class="sub">額面の' + takeHomePercent(monthly.takeHome, monthly.gross) + '</span></div>' +
    '<div class="hero-number"><span class="yen">¥</span>' + formatNumber(monthly.takeHome) + '</div>' +
    takeHomeRowsHtml([
      { label: '健康保険', amount: monthly.health },
      { label: '介護保険', amount: monthly.care, hideWhenZero: true },
      { label: '子ども・子育て支援金', amount: monthly.childSupport },
      { label: '厚生年金', amount: monthly.pension, hideWhenZero: true },
      { label: '雇用保険', amount: monthly.employment },
      { label: '所得税', amount: monthly.incomeTax },
      { label: '住民税', amount: monthly.residentTax },
      { label: '引かれる合計', amount: monthly.gross - monthly.takeHome, total: true },
    ]) +
    '</section>';

  // ボーナス
  if (result.bonus) {
    html += '<section class="card">' +
      '<div class="card-head"><h2>ボーナスの手取り</h2><span class="sub">1年分・額面の' + takeHomePercent(result.bonus.takeHome, result.bonus.gross) + '</span></div>' +
      '<div class="hero-number"><span class="yen">¥</span>' + formatNumber(result.bonus.takeHome) + '</div>' +
      takeHomeRowsHtml([
        { label: '社会保険料', amount: result.bonus.socialInsurance },
        { label: '所得税', amount: result.bonus.incomeTax },
      ]) +
      '</section>';
  }

  // 1年
  const yearly = result.yearly;
  html += '<section class="card">' +
    '<div class="card-head"><h2>1年の手取り</h2><span class="sub">年収 ' + formatYen(yearly.gross) + ' の' + takeHomePercent(yearly.takeHome, yearly.gross) + '</span></div>' +
    '<div class="hero-number"><span class="yen">¥</span>' + formatNumber(yearly.takeHome) + '</div>' +
    takeHomeRowsHtml([
      { label: '社会保険料', amount: yearly.socialInsurance },
      { label: '所得税', amount: yearly.incomeTax },
      { label: '住民税', amount: yearly.residentTax },
    ]) +
    '</section>';

  html += takeHomeNotesHtml(result);
  return html;
}

/** 「額面の80%」の数字の部分 */
function takeHomePercent(takeHome, gross) {
  return Math.round(takeHome / gross * 100) + '%';
}

/** 引かれる額の一覧。rows = [{ label, amount, hideWhenZero, total }] */
function takeHomeRowsHtml(rows) {
  let html = '<ul class="plain-list takehome-list">';
  for (const row of rows) {
    if (row.hideWhenZero && row.amount === 0) {
      continue;
    }
    html += '<li' + (row.total ? ' class="takehome-total"' : '') + '><span>' + row.label + '</span><span class="num">' + formatYen(-row.amount) + '</span></li>';
  }
  html += '</ul>';
  return html;
}

/** 計算のしかたと、もとにした資料 */
function takeHomeNotesHtml(result) {
  let html = '<div class="takehome-notes">';
  if (todayText() >= TAKE_HOME_RULES.reviewAfter) {
    html += '<p class="hint"><strong>' + TAKE_HOME_RULES.yearLabel + 'の料率で計算しています。新しい料率に変わっているかもしれません。</strong></p>';
  }
  html += '<p class="hint">' + TAKE_HOME_RULES.yearLabel + 'の料率と税のきまりで計算した目安です。住民税は前の年の収入にかかるので、働きはじめた年は引かれません。</p>';
  html += '<details class="more"><summary>計算のしかた</summary><ul class="takehome-howto">' +
    '<li>健康保険・厚生年金などは、額面を表に当てはめた「標準報酬月額」（' + formatYen(result.standardPay) + '）に料率をかけています。' +
    '健康保険は協会けんぽの料率（' + escapeHtml(takeHomeForm.prefecture) + ' ' + healthRateOf(takeHomeForm.prefecture).toFixed(2) + '%）で、会社の健康保険組合に入っている人は少しちがいます。</li>' +
    '<li>雇用保険は、ふつうの会社の料率（0.5%）です。</li>' +
    '<li>交通費は、社会保険料にはふくめ、税金はかからない分として計算しています（月15万円まで）。</li>' +
    '<li>所得税は、年末調整のあとの1年分を12で割った額です。毎月の天引きとは少しちがい、差は12月の年末調整で精算されます。</li>' +
    '<li>住民税は、この収入が1年続いたときに、次の年の6月から引かれる額の目安です。</li>' +
    '<li>ボーナスは、2回に分けて払われるとして計算しています。</li>' +
    '<li>もとにした資料: 協会けんぽ「令和8年度保険料率」、厚生労働省「令和8年度の雇用保険料率」、国税庁「源泉所得税の改正のあらまし（令和8年4月）」（' + TAKE_HOME_RULES.checkedAt + ' に確認）</li>' +
    '</ul></details>';
  html += '</div>';
  return html;
}
