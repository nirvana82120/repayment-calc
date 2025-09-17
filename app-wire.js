// app-wire.js — 외부 엔진/룰 자동 로드 + 변제율/경고문 고정 표시
// ================================================================
// 1) import.meta.url 기준으로 같은 세그먼트(@hash)의 engine.js / rules-2025-01.json 로드
// 2) 결과 화면에 변제율 표시 + 고정 3줄 경고문 렌더
// ================================================================
const SELF_URL = new URL(import.meta.url);
const V = SELF_URL.searchParams.get('v') || '';

function withV(u) {
  const url = (u instanceof URL) ? new URL(u) : new URL(String(u));
  if (V) url.searchParams.set('v', V);
  return url.toString();
}

const ENGINE_URL = withV(new URL('engine.js',           SELF_URL));
const RULES_URL  = withV(new URL('rules-2025-01.json',  SELF_URL));

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
  let   homeCity   = $1('#regionDetailHome .city-btn.active')?.dataset.city || '';
  const workRegion = $1('#regionGridWork .region-btn.active')?.dataset.region || '';
  let   workCity   = $1('#regionDetailWork .city-btn.active')?.dataset.city || '';

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

// ---------- Rules/Assessment ----------
async function loadRules(){
  const res = await fetch(RULES_URL, { cache:'no-store' });
  if(!res.ok) throw new Error('Failed to load rules');
  return res.json();
}
export async function runAssessment(overrideInput){
  const { computeAssessment } = await enginePromise;
  const rules = await loadRules();
  const input = overrideInput || collectInput();
  return computeAssessment(input, rules);
}

// ---------- UI Helpers (변제율/경고 고정) ----------
function ensureRateUI(){
  const main = $1('.result-main');
  if(!main) return { row:null, rateEl:null, noteEl:null };
  let row = main.querySelector('.result-item.rate');
  if(!row){
    row = document.createElement('div');
    row.className = 'result-item rate';
    const label = document.createElement('span');
    label.className = 'result-label';
    label.textContent = '변제율';
    const val = document.createElement('span');
    val.id = 'finalRate';
    val.className = 'result-period'; // 녹색 스타일 재사용
    const unit = document.createElement('span');
    unit.className = 'result-unit';
    unit.textContent = '%';
    row.appendChild(label); row.appendChild(val); row.appendChild(unit);
    main.appendChild(row);

    // 공식 안내 문구
    const note = document.createElement('p');
    note.id = 'finalRateNote';
    note.className = 'small-note';
    note.textContent = '※ 변제율 = (월×기간) ÷ 무담보총액 × 100, 소수 1자리(0.5% 미만 내림)';
    main.appendChild(note);
  }
  return { row, rateEl: $1('#finalRate', row), noteEl: $1('#finalRateNote', row.parentElement) };
}

function showFixedWarnings(){
  const warnBox = $1('.result-warning ul') || (function(){
    const wb = $1('.result-warning'); if(!wb) return null;
    const u = document.createElement('ul'); wb.appendChild(u); return u;
  })();
  if(!warnBox) return;
  warnBox.innerHTML = '';
  const lines = [
    '주의: 본 결과는 입력 기준 추정치입니다. 증빙 확인 시 변제금·기간이 달라질 수 있습니다.',
    '추가 생계비 인정(특이사유) 여부에 따라 월 납부액이 변동됩니다.',
    '최근 대출·1년치 계좌/카드 사용내역에 따라 산정이 크게 달라질 수 있어 전문가 확인이 반드시 필요합니다.'
  ];
  lines.forEach(t=>{ const li=document.createElement('li'); li.textContent=t; warnBox.appendChild(li); });
}

// ---------- 렌더 ----------
function renderOutput(out){
  const rep = $1('#finalRepayment');
  const per = $1('#finalPeriod');

  // 항상 경고 고정 3줄 표시
  showFixedWarnings();

  // 상담 전용 케이스
  if (out?.consultOnly) {
    if (rep) rep.textContent = '전문상담 필요';
    if (per) per.textContent = '';
    // 변제율 숨김
    const {row, noteEl} = ensureRateUI();
    if(row) row.style.display = 'none';
    if(noteEl) noteEl.style.display = 'none';
    console.log('[assessment][consultOnly]', out);
    return;
  }

  // 금액/기간 표시
  if (rep) rep.textContent = `${fmt(out.monthlyRepayment)}원`;
  if (per) per.textContent = `${out.months}개월`;

  // 변제율 표시
  const { row, rateEl, noteEl } = ensureRateUI();
  try{
    const unsecured = Number(out?.breakdown?.debts?.unsecuredTotal || 0);
    if (unsecured > 0) {
      const totalPay = Number(out.monthlyRepayment||0) * Number(out.months||0);
      let rate = (totalPay / unsecured) * 100;
      // 소수 1자리, 0.5% 미만 내림
      rate = Math.floor(rate * 10) / 10;
      if (rateEl) rateEl.textContent = rate.toLocaleString('ko-KR', { minimumFractionDigits:1, maximumFractionDigits:1 });
      if (row) row.style.display = 'flex';
      if (noteEl) noteEl.style.display = '';
    } else {
      if (row) row.style.display = 'none';
      if (noteEl) noteEl.style.display = 'none';
    }
  }catch(e){ console.warn('rate render error', e); }

  console.log('[assessment]', out);
}

// ---------- 실행 ----------
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

  const mo = new MutationObserver(()=>{ if (!resultSection.hidden) calculateAndRender(); });
  mo.observe(resultSection, { attributes:true, attributeFilter:['hidden'] });
});
