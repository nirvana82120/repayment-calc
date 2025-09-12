// app-wire.js — ES Module (상대경로 기반; jsDelivr/로컬 모두 동작)
import { computeAssessment } from './engine.js';

const RULES_URL   = new URL('./rules-2025-01.json', import.meta.url);
const WEBHOOK_URL = ''; // (선택) 웹훅 쓰면 URL 입력

function $1(sel,root=document){ return root.querySelector(sel); }
function $all(sel,root=document){ return Array.from(root.querySelectorAll(sel)); }
function toNum(v){ return Number(String(v||'').replace(/[^\d]/g,''))||0; }
const fmt = (n)=> (Number(n)||0).toLocaleString('ko-KR');

// ---- 수집 로직(아임웹 UI 기준; 없으면 0 처리) ----
function getKidsCount(){
  const active = $1('#kidsChips .chip.active')?.dataset.kids;
  if (active === 'other') return toNum($1('#kidsOtherNum')?.value);
  return Number(active||0);
}
function getHouseholdSize(){
  const marital = $1('#maritalGrid .region-btn.active')?.dataset.marital;
  const spouse = marital === 'married' ? 1 : 0;
  const minors = getKidsCount();
  return 1 + spouse + (minors||0);
}
function collectAssets(){
  const rent = $all('#propRentList .rent-item').map(it=>({
    deposit: toNum($1('input[data-field="deposit"]', it)?.value),
    monthly: toNum($1('input[data-field="monthly"]', it)?.value),
    type: $1('.rent-type .chip.active', it)?.dataset.renttype || ''
  }));
  const jeonse = $all('#propJeonseList .jeonse-item').map(it=>({
    deposit: toNum($1('input[data-field="deposit"]', it)?.value),
    loan:    toNum($1('input[data-field="loan"]', it)?.value)
  }));
  const own = $all('#propOwnList .own-item').map(it=>({
    price: toNum($1('input[data-field="price"]', it)?.value),
    loan:  toNum($1('input[data-field="loan"]', it)?.value)
  }));
  const cars = $all('#carList .car-item').map(it=>({
    price: toNum($1('input[data-field="price"]', it)?.value),
    loan:  toNum($1('input[data-field="loan"]', it)?.value)
  }));
  return {
    rent, jeonse, own, cars,
    deposits: toNum($1('#depositAmount')?.value),
    insurance: toNum($1('#insuranceAmount')?.value),
    securities: toNum($1('#securitiesAmount')?.value)
  };
}
function collectDebts(){
  const credit  = toNum($1('#debtCreditAmount')?.value);
  const tax     = toNum($1('#debtTaxAmount')?.value);
  const priv    = toNum($1('#debtPrivateAmount')?.value);
  const secured = toNum($1('#debtSecuredAmount')?.value);
  return { byType: { credit, tax, private: priv, secured }, total: credit + tax + priv + secured };
}
function collectIncome(){
  const emp = toNum($1('#empIncome')?.value);
  const biz = toNum($1('#bizIncome')?.value);
  const pensionRowShown = $1('#pensionAmountRow')?.style.display !== 'none';
  const pen = pensionRowShown ? toNum($1('#pensionIncome')?.value) : 0;
  return { emp, biz, pen, total: emp + biz + pen };
}
function collectInput(){
  const income = collectIncome();
  const debts  = collectDebts();
  const assets = collectAssets();
  const homeRegion = $1('#regionGridHome .region-btn.active')?.dataset.region || '';
  const homeCity   = $1('#regionDetailHome .city-btn.active')?.dataset.city || '';
  const workRegion = $1('#regionGridWork .region-btn.active')?.dataset.region || '';
  const workCity   = $1('#regionDetailWork .city-btn.active')?.dataset.city || '';
  return {
    meta: {
      home: { region: homeRegion, city: homeCity },
      work: { region: workRegion, city: workCity },
      ageBand: $1('#ageGrid .region-btn.active')?.dataset.age || '',
      marital: $1('#maritalGrid .region-btn.active')?.dataset.marital || ''
    },
    householdSize: getHouseholdSize(),
    monthlyIncome: income.total,
    incomes: income,
    assets,
    debts
  };
}

// ---- 렌더/계산 ----
function renderOutput(out){
  if ($1('#finalRepayment')) $1('#finalRepayment').textContent = `${fmt(out.monthlyRepayment)}원`;
  if ($1('#finalPeriod'))    $1('#finalPeriod').textContent    = `${out.months}개월`;
  // 디버그(테스트 페이지용)
  const dbg = $1('#debug');
  if (dbg) dbg.textContent = JSON.stringify(out, null, 2);
}
async function loadRules(){
  const res = await fetch(RULES_URL, { cache:'no-store' });
  if(!res.ok) throw new Error('Failed to load rules');
  return res.json();
}
export async function runAssessment(overrideInput){
  const rules = await loadRules();
  const input = overrideInput || collectInput();
  const out   = computeAssessment(input, rules);
  return out;
}
async function calculateAndRender(){
  try{
    const out = await runAssessment();
    renderOutput(out);
    // (선택) 저장: WEBHOOK_URL 설정 시 입력+결과 전송
    if (WEBHOOK_URL) {
      const payload = collectInput();
      fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload, result: out, at: Date.now() })
      }).catch(()=>{});
    }
  } catch(err){
    console.error(err);
  }
}

// ---- 바인딩 ----
// test.html 용 버튼 바인딩
document.getElementById('calc')?.addEventListener('click', calculateAndRender);

// 실제 랜딩(모달 결과 단계 진입 시)에서 호출하고 싶다면 아래 함수를 사용하세요.
// window.runRepaymentCalc = calculateAndRender; // 필요 시 주석 해제
