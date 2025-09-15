// engine.js — 입력 + 룰 → 결과
// 정책: 변제금은 가처분 기준으로 산출(최소한 유지) → "기간"으로 먼저 청산가치(재산) 충족 시도 →
// 60개월로도 부족할 때만 월 변제금을 상향하여 재산 이상을 맞춘다.

export function computeAssessment(input, rules){
  const {
    paymentRate = 1.0,
    minMonthly  = 200000,
    maxMonthly  = null,
    roundingUnit= 10000,
    depositExempt   = 1850000,
    insuranceExempt = 1500000,
    costOfLiving = { table:{ "1":1430000, "2":2350000, "3":3010000, "4":3650000, "5":4260000 }, perExtra:640000 },
    basePeriodByAge = { "19-30":24, "31-64":36, "65plus":24 },
    rentDepositPolicy = {},
    version = "rules-2025-01"
  } = rules || {};

  // ===== helpers =====
  const roundU = (x)=> Math.round(x/roundingUnit)*roundingUnit;
  const floorU = (x)=> Math.floor(x/roundingUnit)*roundingUnit;
  const ceilU  = (x)=> Math.ceil(x/roundingUnit)*roundingUnit;
  const clamp  = (x,min,max)=> Math.min(Math.max(x,min), max);
  const effMax = Number.isFinite(maxMonthly) && maxMonthly != null ? maxMonthly : Infinity;
  const MIN_BUSINESS = 300000; // 영업 최소 변제기준(하한 가정)

  const consult = (msg)=> ({
    consultOnly: true,
    rulesVersion: version,
    monthlyRepayment: 0,
    months: 0,
    breakdown: { flags:[msg] }
  });

  // ===== 0) 입력/기본 검증 =====
  const monthlyIncome = Math.max(0, Number(input?.monthlyIncome||0));
  if (input?.meta?.dischargeWithin5y) return consult("최근 5년 내 면책결정 이력으로 전문상담 필요");
  if (monthlyIncome <= 1_000_000)     return consult("소득 합계가 100만원 이하로 전문상담 필요");

  // 가구원 및 생계비
  const size = Math.max(1, Number(input?.householdSize||1));
  const livingBase = getLivingCost(size, costOfLiving);

  // 이혼 보정
  const careType      = input?.divorce?.care || null;
  const alimonyPay    = Number(input?.divorce?.alimonyPay||0);
  const supportFromEx = Number(input?.divorce?.supportFromEx||0);
  const onePerson     = getLivingCost(1, costOfLiving);

  let livingAdjusted = livingBase;
  if (input?.meta?.marital === 'divorced') {
    if (careType === 'self') livingAdjusted = Math.max(0, livingBase - alimonyPay);
    else if (careType === 'ex') livingAdjusted = onePerson + supportFromEx; // 가산
  }

  const disposable = Math.max(0, monthlyIncome - livingAdjusted);

  // ===== 1) 기본 월 변제금(가능한 한 낮게 유지) =====
  let monthlyBase;
  if (disposable <= 0)                 monthlyBase = MIN_BUSINESS;
  else if (disposable <= 300000)       return consult("가처분 소득이 30만원 이하로 전문상담 필요");
  else                                 monthlyBase = roundU(disposable * (paymentRate || 1));

  let monthly = clamp(roundU(Math.max(monthlyBase, minMonthly, MIN_BUSINESS)), MIN_BUSINESS, effMax);

  // ===== 2) 재산(청산가치) 평가 =====
  const assetCalc = computeAssets(input, { rentDepositPolicy, depositExempt, insuranceExempt });
  const assetsTotal = assetCalc.total;

  // ===== 3) 채무 구성 =====
  const debts = input?.debts?.byType || {};
  const credit  = Number(debts.credit||0);
  const tax     = Number(debts.tax||0);
  const priv    = Number(debts.private||0);
  const secured = Number(debts.secured||0);

  const unsecuredTotal = credit + tax + priv;
  const allDebtTotal   = unsecuredTotal + secured;

  // 상한 체크(10억/15억)
  if (unsecuredTotal > 1_000_000_000) return consult("무담보채무가 10억원을 초과하여 전문상담 필요");
  if (secured        > 1_500_000_000) return consult("담보채무가 15억원을 초과하여 전문상담 필요");

  // 재산이 무담보총액을 초과하면 개인회생 곤란
  if (assetsTotal > unsecuredTotal && assetsTotal > 0) {
    return consult("총재산이 무담보채무를 초과하여 개인회생 곤란(전문상담 필요)");
  }

  // ===== 4) 기간 산정 — 기간으로 먼저 재산충족 시도 =====
  const ageKey = input?.meta?.ageBand || '';
  let months = ({ "19-30":24, "31-64":36, "65plus":24, ...basePeriodByAge })[ageKey] ?? 36;

  // (1) 기본기간에서 시작해 '기간만' 늘려 재산 충족 시도(최대 60개월)
  if (assetsTotal > 0) {
    const needByPeriod = Math.ceil(assetsTotal / monthly);
    months = Math.min(60, Math.max(months, needByPeriod));
  }

  // ===== 5) 세금 우선변제(월 하한) 반영 — 월 변제금 상향될 수 있음 =====
  const half = Math.max(1, Math.floor(months/2));
  const mTaxMin = tax > 0 ? floorU(tax / half) : 0;
  if (mTaxMin > monthly) {
    monthly = clamp(roundU(Math.max(monthly, mTaxMin, MIN_BUSINESS)), MIN_BUSINESS, effMax);
  }

  // 세금 하한 적용으로 월이 올라갔다면 재산충족 재점검(기간 우선)
  if (assetsTotal > 0 && monthly * months < assetsTotal) {
    const needByPeriod2 = Math.ceil(assetsTotal / monthly);
    months = Math.min(60, Math.max(months, needByPeriod2));
  }

  // ===== 6) 60개월로도 재산 미충족이면 그때만 '월'을 올림 =====
  if (assetsTotal > 0 && months >= 60 && monthly * months < assetsTotal) {
    const needMonthly = ceilU(assetsTotal / months);
    monthly = clamp(needMonthly, MIN_BUSINESS, effMax);
  }

  // ===== 7) 과납 방지 — 무담보채무 초과 시 개월수 조정 =====
  if (unsecuredTotal > 0 && monthly * months > unsecuredTotal) {
    months = Math.max(1, Math.ceil(unsecuredTotal / monthly));
  }

  // 최종 보정
  months  = Math.max(1, Math.min(60, months));
  monthly = Math.max(MIN_BUSINESS, roundU(monthly));

  // 부가 플래그
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

// ===== 재산 평가 =====
function computeAssets(input, { rentDepositPolicy, depositExempt, insuranceExempt }){
  const a = normalizeAssets(input?.assets);
  const policy = rentDepositPolicy || {};
  const cats = policy.categories || {};
  const overCities  = new Set(policy.overCities || []);
  const metroCities = new Set(policy.metroCities || []);

  // city가 비어있으면 region 문자열을 대신 사용(예: 'seoul')
  const homeCityOrRegion = input?.meta?.home?.city || input?.meta?.home?.region || '';
  const cat = pickCityCategory(homeCityOrRegion, overCities, metroCities);
  const catRule = cats[cat] || cats.other || { threshold:0, deduct:0 };

  const homeRent = a.rent.filter(r=>r.type==='home');
  const workRent = a.rent.filter(r=>r.type==='work');

  // 보증금(거주지): 첫 항목에만 지역별 임계/차감 적용, 나머지는 전액
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
  const rentWorkAdj = workRent.reduce((s,r)=> s + Number(r.deposit||0), 0);
  const rentAdjTotal = rentHomeAdj + rentWorkAdj;

  const jeonseAdj = a.jeonse.reduce((s,j)=> s + Math.max(0, Number(j.deposit||0) - Number(j.loan||0)), 0);
  const ownAdj    = a.own.reduce((s,o)=> s + Math.max(0, Number(o.price||0) - Number(o.loan||0)), 0);
  const carAdj    = a.cars.reduce((s,c)=> s + Math.max(0, Number(c.price||0) - Number(c.loan||0)), 0);

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

function pickCityCategory(cityOrRegion, overSet, metroSet){
  if (!cityOrRegion) return "other";
  const raw   = String(cityOrRegion).trim();
  const lower = raw.toLowerCase();

  // ✅ 영문 region 코드 'seoul'도 서울로 인식
  if (raw.includes('서울') || lower === 'seoul') return "seoul";

  // 기존 한글 매칭(정확 일치)
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

