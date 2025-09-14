// engine.js — 입력 + 룰 → 결과 (2025-09-14 기준 설계 반영)

export function computeAssessment(input, rules){
  const {
    paymentRate = 1.0,
    minMonthly  = 200000,
    maxMonthly  = 1000000,
    roundingUnit= 10000,
    depositExempt   = 1850000,
    insuranceExempt = 1500000,
    costOfLiving = { table:{ "1":1430000, "2":2350000, "3":3010000, "4":3650000, "5":4260000 }, perExtra:640000 },
    basePeriodByAge = { "19-30":24, "31-64":36, "65plus":24 },
    rentDepositPolicy = {},
    version = "rules-2025-01"
  } = rules || {};

  const round10k = (x)=> Math.round(x/roundingUnit)*roundingUnit;
  const floor10k = (x)=> Math.floor(x/roundingUnit)*roundingUnit;
  const ceil10k  = (x)=> Math.ceil(x/roundingUnit)*roundingUnit;
  const clamp    = (x,min,max)=> Math.min(Math.max(x,min), max);
  const effMax   = Number.isFinite(maxMonthly) ? maxMonthly : Infinity;
  const MIN_BUSINESS = 300000;

  const consult = (msg)=> ({
    consultOnly: true,
    rulesVersion: version,
    monthlyRepayment: 0,
    months: 0,
    breakdown: { flags:[msg] }
  });

  const monthlyIncome = Math.max(0, Number(input?.monthlyIncome||0));
  if (input?.meta?.dischargeWithin5y) return consult("최근 5년 내 면책결정 이력으로 전문상담 필요");
  if (monthlyIncome <= 1_000_000)     return consult("소득 합계가 100만원 이하로 전문상담 필요");

  const size = Math.max(1, Number(input?.householdSize||1));
  const livingBase = getLivingCost(size, costOfLiving);

  const careType      = input?.divorce?.care || null;
  const alimonyPay    = Number(input?.divorce?.alimonyPay||0);
  const supportFromEx = Number(input?.divorce?.supportFromEx||0);
  const onePerson     = getLivingCost(1, costOfLiving);

  let livingAdjusted = livingBase;
  if (input?.meta?.marital === 'divorced') {
    if (careType === 'self') livingAdjusted = Math.max(0, livingBase - alimonyPay);
    else if (careType === 'ex') livingAdjusted = onePerson + supportFromEx; // +지원금(가산)
  }

  const disposable = Math.max(0, monthlyIncome - livingAdjusted);

  let monthlyBase;
  if (disposable <= 0)       monthlyBase = MIN_BUSINESS;
  else if (disposable <= 300000) return consult("가처분 소득이 30만원 이하로 전문상담 필요");
  else                         monthlyBase = round10k(disposable * (paymentRate || 1));

  const assetCalc = computeAssets(input, { rentDepositPolicy, depositExempt, insuranceExempt });
  const assetsTotal = assetCalc.total;

  const debts = input?.debts?.byType || {};
  const credit = Number(debts.credit||0);
  const tax    = Number(debts.tax||0);
  const priv   = Number(debts.private||0);
  const secured= Number(debts.secured||0);

  const unsecuredTotal = credit + tax + priv;
  const allDebtTotal   = unsecuredTotal + secured;

  if (unsecuredTotal > 1_0000_0000) return consult("무담보채무가 10억원을 초과하여 전문상담 필요");
  if (secured        > 1_5000_0000) return consult("담보채무가 15억원을 초과하여 전문상담 필요");
  if (assetsTotal > unsecuredTotal && assetsTotal > 0) {
    return consult("총재산이 무담보채무를 초과하여 개인회생 곤란(전문상담 필요)");
  }

  const ageKey  = input?.meta?.ageBand || '';
  let months = ( { "19-30":24, "31-64":36, "65plus":24, ...basePeriodByAge } )[ageKey] ?? 36;

  const half = Math.max(1, Math.floor(months/2));
  const mTaxMin = tax > 0 ? floor10k(tax / half) : 0;

  let monthly = Math.max(monthlyBase, mTaxMin, MIN_BUSINESS);
  monthly = clamp(round10k(monthly), MIN_BUSINESS, effMax);

  if (assetsTotal > 0) {
    const needMonths = Math.ceil(assetsTotal / monthly);
    months = Math.min(60, Math.max(months, needMonths));
    if (monthly * months < assetsTotal) {
      monthly = Math.max(MIN_BUSINESS, ceil10k(assetsTotal / months));
    }
  }

  if (monthly * months > unsecuredTotal) {
    months = Math.max(1, Math.ceil(unsecuredTotal / monthly));
  }

  months  = Math.max(1, Math.min(60, months));
  monthly = Math.max(MIN_BUSINESS, round10k(monthly));

  const requiredDisposable = monthly / (paymentRate || 1);
  const impliedLiving = monthlyIncome - requiredDisposable;
  const flags = [];
  if (tax > 0 && mTaxMin > 0) flags.push("세금 우선변제 반영으로 월 변제금이 상향될 수 있음");
  if (impliedLiving < (livingAdjusted / 2)) flags.push("세금 우선변제로 생계비가 기준의 1/2 이하로 하락 가능");

  return {
    consultOnly: false,
    rulesVersion: version,
    monthlyRepayment: monthly,
    months,
    breakdown: {
      householdSize: size,
      monthlyIncome,
      livingCostBase: livingBase,
      livingCostAdjusted: livingAdjusted,
      disposable,
      assets: assetCalc,
      debts: { credit, tax, private: priv, secured, unsecuredTotal, allDebtTotal },
      flags
    }
  };
}

function computeAssets(input, { rentDepositPolicy, depositExempt, insuranceExempt }){
  const a = normalizeAssets(input?.assets);
  const policy = rentDepositPolicy || {};
  const cats = policy.categories || {};
  const overCities  = new Set(policy.overCities || []);
  const metroCities = new Set(policy.metroCities || []);

  const homeCity = input?.meta?.home?.city || input?.meta?.home?.region || '';
  const cat = pickCityCategory(homeCity, overCities, metroCities);
  const catRule = cats[cat] || cats.other || { threshold:0, deduct:0 };

  const homeRent = a.rent.filter(r=>r.type==='home');
  const workRent = a.rent.filter(r=>r.type==='work');

  let rentHomeAdj = 0;
  if (homeRent.length > 0) {
    const first = homeRent[0];
    if ((first.deposit||0) <= catRule.threshold){
      rentHomeAdj += Math.max(0, (first.deposit||0) - catRule.deduct);
    } else {
      rentHomeAdj += (first.deposit||0);
    }
    for (let i=1;i<homeRent.length;i++){
      rentHomeAdj += (homeRent[i].deposit||0);
    }
  }
  const rentWorkAdj = workRent.reduce((s,r)=> s + (r.deposit||0), 0);
  const rentAdjTotal = rentHomeAdj + rentWorkAdj;

  const jeonseAdj = a.jeonse.reduce((s,j)=> s + Math.max(0, (j.deposit||0) - (j.loan||0)), 0);
  const ownAdj    = a.own.reduce((s,o)=> s + Math.max(0, (o.price||0) - (o.loan||0)), 0);
  const carAdj    = a.cars.reduce((s,c)=> s + Math.max(0, (c.price||0) - (c.loan||0)), 0);

  const depositsAdj   = Math.max(0, (a.deposits||0)  - (depositExempt||0));
  const insuranceAdj  = Math.max(0, (a.insurance||0) - (insuranceExempt||0));
  const securitiesAdj = Math.max(0, (a.securities||0));

  const total = rentAdjTotal + jeonseAdj + ownAdj + carAdj + depositsAdj + insuranceAdj + securitiesAdj;

  return {
    cityCategory: cat,
    rent: { rentHomeAdj, rentWorkAdj, rentAdjTotal },
    jeonseAdj, ownAdj, carAdj, depositsAdj, insuranceAdj, securitiesAdj,
    total
  };
}

function pickCityCategory(city, overSet, metroSet){
  if (!city) return "other";
  if (city.includes('서울')) return "seoul";
  if (overSet.has(city))  return "over";
  if (metroSet.has(city)) return "metro";
  return "other";
}

function getLivingCost(size, col){
  const table = col?.table || {};
  const per   = Number(col?.perExtra||0);
  const keys = Object.keys(table).map(k=>Number(k)).filter(n=>!Number.isNaN(n)).sort((a,b)=>a-b);
  if (table[String(size)]) return Number(table[String(size)]);
  if (!keys.length) return 0;
  const maxKey = keys[keys.length-1];
  const base   = Number(table[String(maxKey)]);
  const extra  = Math.max(0, size - maxKey);
  return base + extra*per;
}

function normalizeAssets(a={}){
  const rent   = Array.isArray(a.rent)?a.rent:[];
  const jeonse = Array.isArray(a.jeonse)?a.jeonse:[];
  const own    = Array.isArray(a.own)?a.own:[];
  const cars   = Array.isArray(a.cars)?a.cars:[];
  return {
    rent, jeonse, own, cars,
    deposits:Number(a.deposits||0),
    insurance:Number(a.insurance||0),
    securities:Number(a.securities||0)
  };
}
