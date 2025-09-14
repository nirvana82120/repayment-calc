// app-wire.js — 외부 엔진으로 계산/렌더 (커밋 해시 고정)

// ===== 커밋 해시 고정(매우 중요) =====
const COMMIT = 'ec18d88'; // ← 최신 커밋 7자리로 유지/갱신

// 외부 엔진/룰 절대경로 (커밋 고정) + 캐시 무력화 쿼리
const ENGINE_URL = `https://cdn.jsdelivr.net/gh/nirvana82120/repayment-calc@${COMMIT}/engine.js?v=2025-09-14-07`;
const RULES_URL  = `https://cdn.jsdelivr.net/gh/nirvana82120/repayment-calc@${COMMIT}/rules-2025-01.json?v=2025-09-14-07`;

// (선택) 결과 수집용 웹훅
const WEBHOOK_URL = '';

// ---- 엔진 import(동적 import로 전환) ----
const enginePromise = import(ENGINE_URL);

// ---- 유틸 ----
const $1   = (sel,root=document)=> root.querySelector(sel);
const $all = (sel,root=document)=> Array.from(root.querySelectorAll(sel));
const toNum= (v)=> Number(String(v||'').replace(/[^\d]/g,''))||0;
const fmt  = (n)=> (Number(n)||0).toLocaleString('ko-KR');

// ---------- Step6 파생 ----------
function getKidsCountMarried(){
  const active = $1('#kidsChips .chip.active')?.dataset.kids;
  if (active === 'other') return toNum($1('#kidsOtherNum')?.value);
  return Number(active||0);
}
function getDivorceCareType(){ return $1('#divorceCareChips .chip.active')?.dataset.care || null; }
function getDivorceKids(){ const btn = $1('#divorceKidsChips .chip.active'); const n = btn?.dataset.divorcekids; return n ? Number(n) : 0; }
function getHouseholdSize(){
  const marital = $1('#maritalGrid .region-btn.active')?.dataset.marital;
  if (marital === 'married') return 1 + (getKidsCountMarried()||0);
  if (marital === 'divorced') {
    const care = getDivorceCareType();
    if (care === 'self') return 1 + (getDivorceKids()||0);
    if (care === 'ex')   return 1;
  }
  return 1;
}

// ---------- 수집 ----------
function collectIncome(){
  const emp = toNum($1('#empIncome')?.value);
  const biz = toNum($1('#bizIncome')?.value);
  const penShown = $1('#pensionAmountRow')?.style.display !== 'none';
  const pen = penShown ? toNum($1('#pensionIncome')?.value) : 0;
  return { emp, biz, pen, total: emp + biz + pen };
}
function collectDebts(){
  const credit  = toNum($1('#debtCreditAmount')?.value);
  const tax     = toNum($1('#debtTaxAmount')?.value);
  const priv    = toNum($1('#debtPrivateAmount')?.value);
  const secured = toNum($1('#debtSecuredAmount')?.value);
  return { byType:{ credit, tax, private: priv, secured }, total: credit + tax + priv + secured };
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
    deposits:   toNum($1('#depositAmount')?.value),
    insurance:  toNum($1('#insuranceAmount')?.value),
    securities: toNum($1('#securitiesAmount')?.value)
  };
}
function collectDivorceAdjust(){
  const marital = $1('#maritalGrid .region-btn.active')?.dataset.marital || '';
  if (marital !== 'divorced') return { marital, care: null, alimonyPay: 0, supportFromEx: 0 };
  return {
    marital,
    care: $1('#divorceCareChips .chip.active')?.dataset.care || null,
    alimonyPay: toNum($1('#alimonyPay')?.value),
    supportFromEx: toNum($1('#supportFromEx')?.value)
  };
}
function collectInput(){
  const income  = collectIncome();
  const debts   = collectDebts();
  const assets  = collectAssets();
  const divorce = collectDivorceAdjust();

  const homeRegion = $1('#regionGridHome .region-btn.active')?.dataset.region || '';
  const homeCity   = $1('#regionDetailHome .city-btn.active')?.dataset.city || '';
  const workRegion = $1('#regionGridWork .region-btn.active')?.dataset.region || '';
  const workCity   = $1('#regionDetailWork .city-btn.active')?.dataset.city || '';

  return {
    meta: {
      home: { region: homeRegion, city: homeCity },
      work: { region: workRegion, city: workCity },
      ageBand: $1('#ageGrid .region-btn.active')?.dataset.age || '',
      marital: $1('#maritalGrid .region-btn.active')?.dataset.marital || '',
      dischargeWithin5y: ($1('#dischargeGrid .region-btn.active')?.dataset.discharge === 'yes')
    },
    householdSize: getHouseholdSize(),
    monthlyIncome: income.total,
    incomes: income,
    assets,
    debts,
    divorce
  };
}

// ---------- 렌더 ----------
function renderOutput(out){
  const rep = $1('#finalRepayment');
  const per = $1('#finalPeriod');
  const warnBox = $1('.result-warning ul');

  // 초기화
  if (warnBox) warnBox.innerHTML = '';

  if (out?.consultOnly) {
    if (rep) rep.textContent = '전문상담 필요';
    if (per) per.textContent = '';
    if (warnBox) {
      const li = document.createElement('li');
      li.textContent = (out?.breakdown?.flags?.[0]) || '정확한 진단을 위해 전문상담이 필요합니다.';
      warnBox.appendChild(li);
    }
    console.log('[assessment][consultOnly]', out);
    return;
  }

  if (rep) rep.textContent = `${fmt(out.monthlyRepayment)}원`;
  if (per) per.textContent = `${out.months}개월`;

  // flags 표시
  if (warnBox && out?.breakdown?.flags?.length){
    out.breakdown.flags.forEach(msg=>{
      const li = document.createElement('li');
      li.textContent = msg;
      warnBox.appendChild(li);
    });
  }
  console.log('[assessment]', out);
}

// ---------- 실행 ----------
async function loadRules(){
  const res = await fetch(RULES_URL, { cache:'no-store' });
  if(!res.ok) throw new Error('Failed to load rules');
  return res.json();
}
export async function runAssessment(overrideInput){
  const { computeAssessment } = await enginePromise; // ★ 동적 import
  const rules = await loadRules();
  const input = overrideInput || collectInput();
  return computeAssessment(input, rules);
}
async function calculateAndRender(){
  try{
    // Step10 진입 시 "계산중…" 프리셋
    const rep = $1('#finalRepayment');
    const per = $1('#finalPeriod');
    if (rep) rep.textContent = '계산중…';
    if (per) per.textContent = '';

    const out = await runAssessment();
    renderOutput(out);

    if (WEBHOOK_URL){
      const payload = collectInput();
      fetch(WEBHOOK_URL, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ payload, result: out, at: Date.now() })
      }).catch(()=>{});
    }
  }catch(e){ console.error(e); }
}

// 결과 스텝(10) 열릴 때 계산
document.addEventListener('DOMContentLoaded', ()=>{
  window.__runAssessment = runAssessment; // 수동 테스트용
  const resultSection = document.querySelector('section.cm-step[data-step="10"]');
  if (!resultSection) return;

  // 이미 열려있다면 즉시
  if (!resultSection.hidden) calculateAndRender();

  // 열릴 때 감지
  const mo = new MutationObserver(()=>{ if (!resultSection.hidden) calculateAndRender(); });
  mo.observe(resultSection, { attributes:true, attributeFilter:['hidden'] });
});
