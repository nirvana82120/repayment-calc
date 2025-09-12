// app-wire.js — ES Module : 결과 화면이 열릴 때 외부 엔진으로 계산/렌더
import { computeAssessment } from './engine.js';

const RULES_URL   = new URL('./rules-2025-01.json', import.meta.url);
const WEBHOOK_URL = ''; // (선택) 입력/결과 전송할 웹훅이 있으면 URL 입력

// --------- 유틸 ---------
const $1   = (sel,root=document)=> root.querySelector(sel);
const $all = (sel,root=document)=> Array.from(root.querySelectorAll(sel));
const toNum = (v)=> Number(String(v||'').replace(/[^\d]/g,''))||0;
const fmt   = (n)=> (Number(n)||0).toLocaleString('ko-KR');

// --------- 입력 수집 (현재 UI 구조에 맞춤) ---------
function getKidsCount(){
  const active = $1('#kidsChips .chip.active')?.dataset.kids;
  if (active === 'other') return toNum($1('#kidsOtherNum')?.value);
  return Number(active||0);
}
function getHouseholdSize(){
  const marital = $1('#maritalGrid .region-btn.active')?.dataset.marital;
  const spouse = marital === 'married' ? 1 : 0; // 현재 규격: 결혼이면 배우자 1인 추가
  const minors = getKidsCount();
  return 1 + spouse + (minors||0);
}
function collectAssets(){
  const rent = $all('#propRentList .rent-item').map(it=>({
    deposit: toNum($1('input[data-field="deposit"]', it)?.value),
    monthly: toNum($1('input[data-field="monthly"]', it)?.value),
    type: $1('.rent-type .chip.active', it)?.dataset.renttype || '' // home/work
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
    deposits:   toNum($1('#depositAmount')?.value),
    insurance:  toNum($1('#insuranceAmount')?.value),
    securities: toNum($1('#securitiesAmount')?.value)
  };
}
function collectDebts(){
  const credit  = toNum($1('#debtCreditAmount')?.value);
  const tax     = toNum($1('#debtTaxAmount')?.value);
  const priv    = toNum($1('#debtPrivateAmount')?.value);
  const secured = toNum($1('#debtSecuredAmount')?.value);
  return {
    byType: { credit, tax, private: priv, secured },
    total:  credit + tax + priv + secured
  };
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
      ageBand: $1('#ageGrid .region-btn.active')?.dataset.age || '' // "19-30"|"31-64"|"65plus"
    },
    householdSize: getHouseholdSize(),
    monthlyIncome: income.total,
    incomes: income,
    assets,
    debts
  };
}

// --------- 렌더 ---------
function renderOutput(out){
  console.log('[engine] result:', out);
  const repEl = $1('#finalRepayment');
  const perEl = $1('#finalPeriod');
  if (repEl) repEl.textContent = `${fmt(out.monthlyRepayment)}원`;
  if (perEl) perEl.textContent = `${out.months}개월`;
}

// --------- 룰 로드 ---------
async function loadRules(){
  console.log('[engine] RULES_URL =', String(RULES_URL));
  const res = await fetch(RULES_URL, { cache:'no-store' });
  if(!res.ok) throw new Error('Failed to load rules');
  return res.json();
}

// --------- 실행 함수 ---------
export async function runAssessment(overrideInput){
  const rules = await loadRules();
  const input = overrideInput || collectInput();
  const out   = computeAssessment(input, rules);
  return out;
}

// 결과 섹션이 보이는 순간 자동 계산 → 렌더
async function calculateAndRender(){
  try{
    const out = await runAssessment();
    renderOutput(out);

    // (선택) 결과/입력을 웹훅으로 전송
    if (WEBHOOK_URL){
      const payload = collectInput();
      fetch(WEBHOOK_URL, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ payload, result: out, at: Date.now() })
      }).catch(()=>{});
    }
  }catch(err){
    console.error('[engine] calculate failed:', err);
  }
}

// --------- 결과 화면 표시 감지(가장 확실) ---------
document.addEventListener('DOMContentLoaded', () => {
  // 디버깅용 전역 훅
  window.__runAssessment = runAssessment;

  const resultSection = document.querySelector('section.cm-step[data-step="10"]');
  if (!resultSection) {
    console.warn('[engine] result section not found');
    return;
  }

  // 이미 열려있으면 바로 계산
  if (!resultSection.hidden) calculateAndRender();

  // hidden 속성 변경을 감지
  const mo = new MutationObserver(() => {
    const visible = !resultSection.hidden;
    if (visible) calculateAndRender();
  });
  mo.observe(resultSection, { attributes:true, attributeFilter:['hidden'] });
});
