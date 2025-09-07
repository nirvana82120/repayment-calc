// engine.js — ES Module (외부에서 import)
// 입력(input) + 룰(rules) → 결과(output)을 계산하는 순수 함수

export function computeAssessment(input, rules) {
  const {
    paymentRate = 0.30,
    minMonthly = 200000,
    maxMonthly = 1000000,
    roundingUnit = 10000,
    rentToAssetRate = 0.5,
    carExempt = 5000000,
    depositExempt = 2000000,
    costOfLiving = { table: { "1": 1200000 }, perExtra: 300000 },
    periodByDebt = [
      { lte: 10000000, months: 36 },
      { lte: 50000000, months: 48 },
      { gt:  50000000, months: 60 }
    ],
    version = "rules-2025-01"
  } = rules || {};

  // 1) 가구 생계비
  const livingCost = getLivingCost(input.householdSize || 1, costOfLiving);

  // 2) 가처분 소득
  const monthlyIncome = Math.max(0, Number(input.monthlyIncome || 0));
  const disposable = Math.max(0, monthlyIncome - livingCost);

  // 3) 자산 참고값(현 버전은 월 변제금에 직접 반영 X, 추후 고도화 가능)
  const assets = normalizeAssets(input.assets);
  const carNet = Math.max(0, assets.carTotal - assets.carLoanTotal);
  const carAdj = Math.max(0, carNet - carExempt);

  const rentDepositSum = assets.rentItems.reduce((s, it) => s + (it.deposit||0), 0);
  const jeonseNet = assets.jeonseItems.reduce((s, it) => s + Math.max(0, (it.deposit||0) - (it.loan||0)), 0);
  const ownEquity = assets.ownItems.reduce((s, it) => s + Math.max(0, (it.price||0) - (it.loan||0)), 0);

  const depositsAdj  = Math.max(0, (assets.deposits||0)  - depositExempt);
  const insuranceAdj = Math.max(0, (assets.insurance||0));
  const securitiesAdj= Math.max(0, (assets.securities||0));

  const adjustedAssets =
      Math.max(0, rentDepositSum) * rentToAssetRate +
      Math.max(0, jeonseNet)      * rentToAssetRate +
      ownEquity + carAdj + depositsAdj + insuranceAdj + securitiesAdj;

  // 4) 월 변제금 = 가처분 × 변제율 (+ 하한/상한, n만원 단위 반올림)
  let monthly = disposable * paymentRate;
  monthly = clamp(monthly, minMonthly, maxMonthly);
  monthly = roundBy(monthly, roundingUnit);

  // 5) 변제기간(총채무 구간별 규칙)
  const totalDebt = Math.max(0, Number(input.debts?.total || 0));
  const months = pickMonthsByDebt(totalDebt, periodByDebt);

  return {
    rulesVersion: version,
    monthlyRepayment: monthly,
    months,
    breakdown: {
      householdSize: input.householdSize || 1,
      monthlyIncome,
      livingCost,
      disposable,
      totalDebt,
      adjustedAssets,
      components: {
        rentDepositSum, jeonseNet, ownEquity, carAdj, depositsAdj, insuranceAdj, securitiesAdj
      }
    }
  };
}

// ---------- helpers ----------
function getLivingCost(size, col) {
  const table = col?.table || {};
  const perExtra = Number(col?.perExtra || 0);
  const keys = Object.keys(table).map(k => Number(k)).filter(n => !Number.isNaN(n)).sort((a,b)=>a-b);
  if (table[String(size)]) return Number(table[String(size)]);
  if (keys.length === 0) return 0;
  const maxKey = keys[keys.length - 1];
  const base = Number(table[String(maxKey)]);
  const extra = Math.max(0, size - maxKey);
  return base + extra * perExtra;
}
function clamp(x, min, max){ return Math.min(Math.max(x, min), max); }
function roundBy(x, unit){ return Math.round(x / unit) * unit; }
function pickMonthsByDebt(total, rules){
  for (const r of rules) {
    if (typeof r.lte === 'number' && total <= r.lte) return r.months;
  }
  const last = rules[rules.length - 1];
  return last?.months || 60;
}
function normalizeAssets(a = {}) {
  const rentItems   = Array.isArray(a.rent)   ? a.rent   : [];
  const jeonseItems = Array.isArray(a.jeonse) ? a.jeonse : [];
  const ownItems    = Array.isArray(a.own)    ? a.own    : [];
  const cars        = Array.isArray(a.cars)   ? a.cars   : [];

  const carTotal = cars.reduce((s,c)=> s + (Number(c.price)||0), 0);
  const carLoanTotal = cars.reduce((s,c)=> s + (Number(c.loan)||0), 0);

  return {
    rentItems, jeonseItems, ownItems, cars,
    carTotal, carLoanTotal,
    deposits: Number(a.deposits||0),
    insurance: Number(a.insurance||0),
    securities: Number(a.securities||0)
  };
}
