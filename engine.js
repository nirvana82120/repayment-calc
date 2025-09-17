// engine.js — 입력 + 룰 → 결과
// 규칙: 최저월 300,000 / 나이대 기본기간 / 자산으로 기간 상향 / 과납 방지 / 세금 하한 제거
export function computeAssessment(input, rules) {
  const {
    paymentRate = 1.0,
    minMonthly  = 300000,   // ✅ 30만원
    maxMonthly  = null,
    roundingUnit= 10000,

    // 생계비
    costOfLiving = { table:{ "1":1430000, "2":2350000, "3":3010000, "4":3650000, "5":4260000 }, perExtra:640000 },

    // 공제
    depositExempt   = 1850000,
    insuranceExempt = 1500000,

    // 월세 보증금 지역정책
    rentDepositPolicy = {},

    // 기간
    basePeriodByAge = { "19-30":24, "31-64":36, "65plus":24 },
    maxPeriod       = 60,

    version = "rules-2025-01b"
  } = rules || {};

  const roundU = (x)=> Math.round(x/roundingUnit)*roundingUnit;
  const ceilU  = (x)=> Math.ceil(x/roundingUnit)*roundingUnit;
  const clamp  = (x,min,max)=> Math.min(Math.max(x,min), max);
  const effMax = Number.isFinite(maxMonthly) && maxMonthly != null ? maxMonthly : Infinity;

  const consult = (msg)=> ({ consultOnly:true, rulesVersion:version, monthlyRepayment:0, months:0, breakdown:{ flags:[msg] } });

  // 0) 입력 검증
  const monthlyIncome = Math.max(0, Number(input?.monthlyIncome||0));
  if (input?.meta?.dischargeWithin5y) return consult("최근 5년 내 면책결정 이력으로 전문상담 필요");
  if (monthlyIncome <= 1_000_000)     return consult("소득 합계가 100만원 이하로 전문상담 필요");

  // 생계비
  const size   = Math.max(1, Number(input?.householdSize||1));
  const livingBase = getLivingCost(size, costOfLiving);

  // 이혼 보정
  const careType      = input?.divorce?.care || null;
  const alimonyPay    = Number(input?.divorce?.alimonyPay||0);
  const supportFromEx = Number(input?.divorce?.supportFromEx||0);
  const onePerson     = getLivingCost(1, costOfLiving);

  let livingAdjusted = livingBase;
  if (input?.meta?.marital === 'divorced') {
    if (careType === 'self') livingAdjusted = Math.max(0, livingBase - alimonyPay);
    else if (careType === 'ex') livingAdjusted = onePerson + supportFromEx;
  }

  const disposable = Math.max(0, monthlyIncome - livingAdjusted);

  // 1) 월 변제금
  let monthly = roundU(Math.max(disposable * paymentRate, minMonthly));
  monthly = clamp(monthly, minMonthly, effMax);

  // 2) 재산(청산가치)
  const assetCalc   = computeAssets(input, { rentDepositPolicy, depositExempt, insuranceExempt });
  const assetsTotal = assetCalc.total;

  // 3) 채무
  const debts = input?.debts?.byType || {};
  const credit  = Number(debts.credit||0);
  const tax     = Number(debts.tax||0);
  const priv    = Number(debts.private||0);
  const secured = Number(debts.secured||0);
  const unsecuredTotal = credit + tax + priv;
  const allDebtTotal   = unsecuredTotal + secured;

  if (unsecuredTotal > 1_000_000_000) return consult("무담보채무가 10억원을 초과하여 전문상담 필요");
  if (secured        > 1_500_000_000) return consult("담보채무가 15억원을 초과하여 전문상담 필요");
  if (assetsTotal > unsecuredTotal && assetsTotal > 0) {
    return consult("총재산이 무담보채무를 초과하여 개인회생 곤란(전문상담 필요)");
  }

  // 4) 기간 — 나이대 기본 → 자산 상향 → 과납 단축
  const ageKey = input?.meta?.ageBand || '';
  const baseByAge = ({ "19-30":24, "31-64":36, "65plus":24, ...basePeriodByAge })[ageKey] ?? 36;

  let months = baseByAge;
  let flaggedAssetUp = false;
  let flaggedOverpayDown = false;

  // 자산으로 상향
  if (assetsTotal > 0 && monthly * months < assetsTotal) {
    months = Math.ceil(assetsTotal / monthly);
    flaggedAssetUp = true;
  }

  // 과납 방지(무담보보다 많이 내지 않도록 단축)
  if (unsecuredTotal > 0 && monthly * months > unsecuredTotal) {
    const need = Math.ceil(unsecuredTotal / monthly);
    if (need < months) {
      months = need;
      flaggedOverpayDown = true;
    }
  }

  months = Math.max(1, Math.min(maxPeriod, months));
  monthly = roundU(Math.max(minMonthly, monthly));

  const flags = [];
  if (flaggedAssetUp)     flags.push("청산가치 충족을 위해 기간 상향");
  if (flaggedOverpayDown) flags.push("무담보채무 초과 방지를 위해 기간 단축");
  if (!flaggedAssetUp && !flaggedOverpayDown) flags.push("나이대 기본기간 적용");

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

// ===== 재산 평가 =====
function computeAssets(input, { rentDepositPolicy, depositExempt, insuranceExempt }) {
  const a = normalizeAssets(input?.assets);
  const policy = rentDepositPolicy || {};
  const cats = policy.categories || {};
  const overCities  = new Set(policy.overCities || []);
  const metroCities = new Set(policy.metroCities || []);

  const homeCityOrRegion = input?.meta?.home?.city || input?.meta?.home?.region || '';
  const cat = pickCityCategory(homeCityOrRegion, overCities, metroCities);
  const catRule = cats[cat] || cats.other || { threshold:0, deduct:0 };

  const homeRent = a.rent.filter(r=>r.type==='home');
  const workRent = a.rent.filter(r=>r.type==='work');

  let rentHomeAdj = 0;
  if (homeRent.length > 0) {
    const first = homeRent[0];
    const dep = Number(first.deposit||0);
    if (dep <= (catRule.threshold||0)) {
      rentHomeAdj += Math.max(0, dep - (catRule.deduct||0));
    } else {
      rentHomeAdj += dep;
    }
    for (let i=1;i<homeRent.length;i++){
      rentHomeAdj += Number(homeRent[i].deposit||0);
    }
  }
  const rentWorkAdj   = workRent.reduce((s,r)=> s + Number(r.deposit||0), 0);
  const rentAdjTotal  = rentHomeAdj + rentWorkAdj;

  const jeonseAdj     = a.jeonse.reduce((s,j)=> s + Math.max(0, Number(j.deposit||0) - Number(j.loan||0)), 0);
  const ownAdj        = a.own.reduce((s,o)=> s + Math.max(0, Number(o.price||0) - Number(o.loan||0)), 0);
  const carAdj        = a.cars.reduce((s,c)=> s + Math.max(0, Number(c.price||0) - Number(c.loan||0)), 0);
  const depositsAdj   = Math.max(0, Number(a.deposits||0)  - Number(depositExempt||0));
  const insuranceAdj  = Math.max(0, Number(a.insurance||0) - Number(insuranceExempt||0));
  const securitiesAdj = Math.max(0, Number(a.securities||0));

  const total = rentAdjTotal + jeonseAdj + ownAdj + carAdj + depositsAdj + insuranceAdj + securitiesAdj;

  return {
    cityCategory: cat,
    rent: { rentHomeAdj, rentWorkAdj, rentAdjTotal },
    jeonseAdj, ownAdj, carAdj, depositsAdj, insuranceAdj, securitiesAdj,
    total
  };
}
function pickCityCategory(cityOrRegion, overSet, metroSet) {
  if (!cityOrRegion) return "other";
  const raw   = String(cityOrRegion).trim();
  const lower = raw.toLowerCase();
  if (raw.includes('서울') || lower === 'seoul') return "seoul";
  if (overSet.has(raw))  return "over";
  if (metroSet.has(raw)) return "metro";
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
function normalizeAssets(a={}) {
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
