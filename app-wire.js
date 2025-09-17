// app-wire.js — 외부 엔진/룰을 같은 세그먼트(@prod/해시)에서 자동 로드 + ?v 동기 캐시버스팅
// ================================================================
// 1) 경로/캐시 세팅: import.meta.url 기준으로 engine.js / rules-2025-01.json 생성
//    - Myweb에서 <script type="module" src="...@prod/app-wire.js?v=YYYY-MM-DD-NN"> 로 붙었으면
//      이 파일은 동일 세그먼트(@prod)의 engine.js / rules-2025-01.json을 같은 ?v로 로드합니다.
// ================================================================
const SELF_URL = new URL(import.meta.url);
const V = SELF_URL.searchParams.get('v') || ''; // 캐시 버스팅 파라미터(?v=…)

/** 같은 ?v를 유지해 하위 리소스에도 캐시버스트 적용 */
function withV(u) {
  const url = (u instanceof URL) ? new URL(u) : new URL(String(u));
  if (V) url.searchParams.set('v', V);
  return url.toString();
}

// 같은 세그먼트 하위의 sibling 파일 경로 생성
const ENGINE_URL = withV(new URL('engine.js',          SELF_URL));
const RULES_URL  = withV(new URL('rules-2025-01.json', SELF_URL));

// (선택) 결과 수집 웹훅 – 필요 시 채워 사용
const WEBHOOK_URL = '';

// ---- 엔진 import(동적 import) ----
const enginePromise = import(ENGINE_URL);

// ---- 유틸 ----
const $1   = (sel, root=document)=> root.querySelector(sel);
const $all = (sel, root=document)=> Array.from(root.querySelectorAll(sel));
const toNum= (v)=> Number(String(v||'').replace(/[^\d]/g,''))||0;
const fmt  = (n)=> (Number(n)||0).toLocaleString('ko-KR');

// ---------- Step6 파생 ----------
function getKidsCountMarried(){
  const active = $1('#kidsChips .chip.active')?.dataset.kids;
  if (active === 'other') return toNum($1('#kidsOtherNum')?.value);
  return Number(active||0);
}
function getDivorceCareType(){ return $1('#divorceCareChips .chip.active')?.dataset.care || null; }
function getDivorceKids(){
  const btn = $1('#divorceKidsChips .chip.active');
  const n = btn?.dataset.divorcekids;
  return n ? Number(n) : 0;
}
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
  let   homeCity   = $1('#regionDetailHome .city-btn.active')?.dataset.city || '';
  const workRegion = $1('#regionGridWork .region-btn.active')?.dataset.region || '';
  let   workCity   = $1('#regionDetailWork .city-btn.active')?.dataset.city || '';

  // 서울 선택인데 city 비었으면 보정
  if (!homeCity && homeRegion === 'seoul') homeCity = '서울특별시';
  if (!workCity && workRegion === 'seoul') workCity = '서울특별시';

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
  const { computeAssessment } = await enginePromise; // 동적 import
  const rules = await loadRules();
  const input = overrideInput || collectInput();
  return computeAssessment(input, rules);
}

async function calculateAndRender(){
  try{
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

  if (!resultSection.hidden) calculateAndRender();

  const mo = new MutationObserver(()=>{
    if (!resultSection.hidden) calculateAndRender();
  });
  mo.observe(resultSection, { attributes:true, attributeFilter:['hidden'] });
});
