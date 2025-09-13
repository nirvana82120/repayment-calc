// engine.js — 입력 + 룰 → 결과(요청 로직 종합 반영)

export function computeAssessment(input, rules){
  const {
    // === 핵심: 가처분 100% 반영 ===
    paymentRate = 1.0,
    minMonthly  = 200000,
    maxMonthly  = 1000000,
    roundingUnit= 10000,

    // 자산/보증금/면제 룰
    rentToAssetRate = 0.5,
    depositExempt   = 1850000,
    insuranceExempt = 1500000,

    // 생계비 테이블
    costOfLiving = { table:{ "1":1430000, "2":2350000, "3":3010000, "4":3650000 }, perExtra:640000 },

    // 기본 기간(나이대)
    basePeriodByAge = { "19-30":24, "31-64":36, "65plus":24 },

    rentDepositPolicy = {},

    version = "rules-2025-01"
  } = rules || {};

  // ===== 불가/보류 1: 5년내 면책 =====
  if (input?.meta?.dischargeWithin5y) {
    return disallow("최근 5년 내 면책결정 이력으로 개인회생 신청 곤란(보류/불가 가능성)");
  }

  // 1) 생계비 (가구수 표 + 이혼 보정)
  const size = Math.max(1, Number(input.householdSize||1));
  const livingBase = getLivingCost(size, costOfLiving);

  const careType      = input?.divorce?.care || null; // "self"|"ex"|null
  const alimonyPay    = Number(input?.divorce?.alimonyPay||0);
  const supportFromEx = Number(input?.divorce?.supportFromEx||0);
  const onePerson     = getLivingCost(1, costOfLiving);

  let livingAdjusted = livingBase;
  if (input?.meta?.marital === 'divorced') {
    if (careType === 'self') livingAdjusted = Math.max(0, livingBase - alimonyPay);
    else if (careType === 'ex') livingAdjusted = Math.max(0, onePerson - supportFromEx);
  }

  // 2) 가처분/기본 월 변제금
  const monthlyIncome = Math.max(0, Number(input.monthlyIncome||0));
  const disposable    = Math.max(0, monthlyIncome - livingAdjusted);
  let baseMonthly = clamp(roundBy(disposable * paymentRate, roundingUnit), minMonthly, maxMonthly);

  // 3) 자산 계산
  const assetCalc = computeAssets(input, rules);
  const assetsEffective = assetCalc.total;

  // 4) 채무 합계 (담보 제외)
  const debts = input?.debts?.byType || {};
  const credit = Number(debts.credit||0);
  const tax    = Number(debts.tax||0);
  const priv   = Number(debts.private||0);
  const secured= Number(debts.secured||0);
  const totalDebtUsed = credit + tax + priv;
  const totalDebtAll  = totalDebtUsed + secured;

  // ===== 불가/보류 2: 재산 > 총채무 =====
  if (assetsEffective > totalDebtUsed && assetsEffective > 0){
    return disallow("총재산이 총채무보다 높아 개인회생이 곤란할 수 있습니다(보류/불가 가능성)");
  }

  // 5) 기본 기간(나이 우선)
  const ageKey  = input?.meta?.ageBand || '';
  const baseMon = basePeriodByAge[ageKey] ?? 36;

  // 6) 제약 충족 시나리오 계산
  const scenarioA = solvePlan({
    wantMonths: baseMon,
    baseMonthly,
    assets: assetsEffective,
    tax,
    totalDebt: totalDebtUsed,
    roundingUnit, minMonthly, maxMonthly
  });

  const scenarioB = solvePlan({
    wantMonths: Math.max(baseMon, 60),
    baseMonthly,
    assets: assetsEffective,
    tax,
    totalDebt: totalDebtUsed,
    roundingUnit, minMonthly, maxMonthly
  });

  // 더 낮은 월변제금을 기본 출력으로
  let best = scenarioA.monthly <= scenarioB.monthly ? scenarioA : scenarioB;

  // 7) 총채무보다 많이 내는 경우 → 기간 단축 (연장 금지)
  best = maybeShortenMonths(best.monthly, best.months, totalDebtUsed, roundingUnit, tax);

  // 8) 세금 1/2 규칙 생계비 경고
  const requiredDisposable = best.monthly / (paymentRate || 1);
  const impliedLiving = monthlyIncome - requiredDisposable;
  const livingTooLow = impliedLiving < (livingAdjusted / 2);

  const flags = [];
  if (livingTooLow) {
    flags.push("세금 우선변제로 월 변제금이 상승하여 생계비가 기준의 1/2 이하로 하락");
  }

  return {
    rulesVersion: version,
    monthlyRepayment: best.monthly,
    months: best.months,
    breakdown: {
      householdSize: size,
      monthlyIncome,
      livingCostBase: livingBase,
      livingCostAdjusted: livingAdjusted,
      disposable,
      assets: assetCalc,
      debts: { credit, tax, private: priv, secured, totalDebtUsed, totalDebtAll },
      options: { basePlan: scenarioA, max60Plan: scenarioB },
      flags
    }
  };
}

// ---------- 자산 계산 ----------
function computeAssets(input, rules){
  const a = normalizeAssets(input?.assets);
  const policy = rules?.rentDepositPolicy || {};
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
  let rentWorkAdj = workRent.reduce((s,r)=> s + (r.deposit||0), 0);
  const rentAdjTotal = rentHomeAdj + rentWorkAdj;

  const jeonseAdj = a.jeonse.reduce((s,j)=> s + Math.max(0, (j.deposit||0) - (j.loan||0)), 0);
  const ownAdj    = a.own.reduce((s,o)=> s + Math.max(0, (o.price||0) - (o.loan||0)), 0);
  const carAdj    = a.cars.reduce((s,c)=> s + Math.max(0, (c.price||0) - (c.loan||0)), 0);

  const depositsAdj   = Math.max(0, (a.deposits||0)  - (rules.depositExempt||0));
  const insuranceAdj  = Math.max(0, (a.insurance||0) - (rules.insuranceExempt||0));
  const securitiesAdj = Math.max(0, (a.securities||0));

  const total = rentAdjTotal + jeonseAdj + ownAdj + carAdj + depositsAdj + insuranceAdj + securitiesAdj;

  return {
    cityCategory: cat,
    rent: { homeProcessed:firstDepositBrief(homeRent), rentHomeAdj, rentWorkAdj, rentAdjTotal },
    jeonseAdj, ownAdj, carAdj, depositsAdj, insuranceAdj, securitiesAdj,
    total
  };
}
function firstDepositBrief(list){
  if (!list || !list.length) return null;
  return { first: list[0], others: list.length-1 };
}
function pickCityCategory(city, overSet, metroSet){
  if (!city) return "other";
  if (city.includes('서울')) return "seoul";
  if (overSet.has(city))  return "over";
  if (metroSet.has(city)) return "metro";
  return "other";
}

// ---------- 플랜 계산 ----------
function solvePlan({ wantMonths, baseMonthly, assets, tax, totalDebt, roundingUnit, minMonthly, maxMonthly }){
  let months = wantMonths;
  const half = Math.max(1, Math.floor(months/2));

  const mAssetMin = assets > 0 ? Math.ceil(assets / months / roundingUnit) * roundingUnit : 0;
  const mTaxMin   = tax    > 0 ? Math.ceil(tax    / half   / roundingUnit) * roundingUnit : 0;
  let monthly = Math.max(baseMonthly, mAssetMin, mTaxMin, minMonthly);
  monthly = clamp(roundBy(monthly, roundingUnit), minMonthly, maxMonthly);

  return { months, monthly, mAssetMin, mTaxMin };
}

function maybeShortenMonths(monthly, months, totalDebt, roundingUnit, tax){
  if (monthly * months <= 0) return { monthly, months };

  const currentTotal = monthly * months;
  // ✅ 총채무보다 많이 내는 경우에만 단축, 연장은 금지
  if (currentTotal <= totalDebt) return { monthly, months };

  let newMonths = Math.ceil(totalDebt / monthly);
  newMonths = Math.max(1, Math.min(months, newMonths));

  const half = Math.max(1, Math.floor(newMonths/2));
  const mTaxMin = tax > 0 ? Math.ceil(tax / half / roundingUnit) * roundingUnit : 0;
  const newMonthly = Math.max(monthly, mTaxMin);

  return { monthly: newMonthly, months: newMonths, mTaxMin };
}

// ---------- 공통 유틸 ----------
function disallow(msg){
  return { rulesVersion: "rules-2025-01", monthlyRepayment: 0, months: 0, breakdown: { flags: [msg] } };
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
function clamp(x,min,max){ return Math.min(Math.max(x,min), max); }
function roundBy(x,u){ return Math.round(x/u)*u; }
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
