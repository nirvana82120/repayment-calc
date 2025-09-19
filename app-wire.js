// app-wire.js — 엔진/룰 자동 로드 + 상세 입력 수집 확장 + 변제율/경고 고정
// =================================================================================
const SELF_URL = new URL(import.meta.url);
const V = SELF_URL.searchParams.get('v') || '';

function withV(u) {
  const url = (u instanceof URL) ? new URL(u) : new URL(String(u));
  if (V) url.searchParams.set('v', V);
  return url.toString();
}

const ENGINE_URL = withV(new URL('engine.js',          SELF_URL));
const RULES_URL  = withV(new URL('rules-2025-01.json', SELF_URL));

/** ▼▼ 이미 발급받은 Apps Script 웹앱 /exec URL 유지 ▼▼ */
const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbzSgz9PhKr7axqi-a2LrSZBbRbsbpzEqG0XeidttG5EKkGryaxVkENVgbi70vC9g5zYQg/exec';
/** ▲▲ */

// ---- 엔진 import ----
const enginePromise = import(ENGINE_URL);

// ---- 유틸 ----
const $1   = (sel, root=document)=> root.querySelector(sel);
const $all = (sel, root=document)=> Array.from(root.querySelectorAll(sel));
const toNum= (v)=> Number(String(v||'').replace(/[^\d]/g,''))||0;
const fmt  = (n)=> (Number(n)||0).toLocaleString('ko-KR');

// ---------- Step6 파생(원본 + 확장) ----------
function getKidsCountMarried(){
  const active = $1('#kidsChips .chip.active')?.dataset.kids;
  if (active === 'other') return toNum($1('#kidsOtherNum')?.value);
  return Number(active||0);
}
function getDivorceCareType(){ return $1('#divorceCareChips .chip.active')?.dataset.care || null; }
function getDivorceKids(){ const btn = $1('#divorceKidsChips .chip.active'); const n = btn?.dataset.divorcekids; return n ? Number(n) : 0; }
function getSpouseJob(){
  const btn = $1('#spouseChips .chip.active');
  const key = btn?.dataset.spouse || '';
  if (!key) return '';
  return ({ none:'무직', employee:'직장인', biz:'자영업자' })[key] || key;
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

// ---------- 상세 수집(확장) ----------
// 소득: 선택 탭 상태 + 금액
function collectIncomeDetailed(){
  const emp = toNum($1('#empIncome')?.value);
  const biz = toNum($1('#bizIncome')?.value);

  const pensionTabOn = !!$1('.income-tab[data-tab="pension"].active');
  const pensionYes   = !!$1('#cardPension .chip[data-pension="yes"].active');
  const pen = (pensionTabOn && pensionYes) ? toNum($1('#pensionIncome')?.value) : 0;

  const selected = {
    emp: !!$1('.income-tab[data-tab="emp"].active'),
    biz: !!$1('.income-tab[data-tab="biz"].active'),
    pension: pensionTabOn,
    pensionYes
  };

  return { emp, biz, pen, total:(emp+biz+pen), selected };
}

// 가족/결혼 상세
function collectFamily(){
  const marital = $1('#maritalGrid .region-btn.active')?.dataset.marital || ''; // married/divorced/single/widowed
  const care = getDivorceCareType(); // self/ex/null

  return {
    marital,
    // 결혼 선택 시 상세
    kidsMarried: (marital==='married') ? (getKidsCountMarried()||0) : 0,
    spouseJob:   (marital==='married') ? getSpouseJob() : '',
    // 이혼 선택 시 상세
    divorceCare: (marital==='divorced') ? (care||'') : '',
    divorceKids: (marital==='divorced' && care==='self') ? (getDivorceKids()||0) : 0,
    alimonyPay:  (marital==='divorced' && care==='self') ? toNum($1('#alimonyPay')?.value) : 0,
    supportFromEx:(marital==='divorced' && care==='ex') ? toNum($1('#supportFromEx')?.value) : 0
  };
}

// 기존 이혼 보정(엔진용) + 자녀수 포함
function collectDivorceAdjust(){
  const marital = $1('#maritalGrid .region-btn.active')?.dataset.marital || '';
  if (marital !== 'divorced') return { marital, care: null, divorceKids:0, alimonyPay: 0, supportFromEx: 0 };
  const care = $1('#divorceCareChips .chip.active')?.dataset.care || null;
  return {
    marital,
    care,
    divorceKids: (care==='self') ? getDivorceKids() : 0,
    alimonyPay:  (care==='self') ? toNum($1('#alimonyPay')?.value) : 0,
    supportFromEx: (care==='ex') ? toNum($1('#supportFromEx')?.value) : 0
  };
}

// 자산(원자료)
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

// 자산 원자료 총합(청산가치 계산 전, 보고용)
function sumAssetsRaw(a){
  if (!a) return 0;
  const rentDepSum   = (a.rent||[]).reduce((s,r)=> s + (Number(r.deposit)||0), 0);
  const jeonseDepSum = (a.jeonse||[]).reduce((s,j)=> s + (Number(j.deposit)||0), 0);
  const ownPriceSum  = (a.own||[]).reduce((s,o)=> s + (Number(o.price)||0), 0);
  const carPriceSum  = (a.cars||[]).reduce((s,c)=> s + (Number(c.price)||0), 0);
  const others       = Number(a.deposits||0) + Number(a.insurance||0) + Number(a.securities||0);
  return rentDepSum + jeonseDepSum + ownPriceSum + carPriceSum + others;
}

// 채무
function collectDebts(){
  const credit  = toNum($1('#debtCreditAmount')?.value);
  const tax     = toNum($1('#debtTaxAmount')?.value);
  const priv    = toNum($1('#debtPrivateAmount')?.value);
  const secured = toNum($1('#debtSecuredAmount')?.value);
  return { byType:{ credit, tax, private: priv, secured }, total: credit + tax + priv + secured };
}

// 지역/메타 + 모든 입력 모으기(엔진 호환 유지, 확장 필드 추가)
function collectInput(){
  const incomes  = collectIncomeDetailed();
  const assets   = collectAssets();
  const debts    = collectDebts();
  const family   = collectFamily();
  const divorce  = collectDivorceAdjust();

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
      marital: family.marital || '',
      dischargeWithin5y: ($1('#dischargeGrid .region-btn.active')?.dataset.discharge === 'yes')
    },
    householdSize: getHouseholdSize(),
    monthlyIncome: incomes.total,              // 엔진 호환
    incomes,                                   // {emp,biz,pen,total,selected{...}}
    family,                                    // {marital,kidsMarried,spouseJob,divorceCare,divorceKids,alimonyPay,supportFromEx}
    assets,                                    // 원자료(월세/전세/자가/차/예금/보험/주식)
    assetsRawTotal: sumAssetsRaw(assets),      // 보고용 총합(청산가치 전)
    debts,                                     // {byType{}, total}
    divorce                                    // 엔진 보정(이혼)용
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

// ---------- Webhook 전송 ----------
function sendWebhook({ event, result, contact }) {
  if (!WEBHOOK_URL) return;
  const payload = collectInput();

  const body = {
    event,
    page: location.href,
    referrer: document.referrer || '',
    ua: navigator.userAgent || '',
    input: payload,
    result,
    contact: contact || null,
    at: Date.now()
  };

  try{
    fetch(WEBHOOK_URL, {
      method: 'POST',
      mode: 'no-cors',      // CORS 프리플라이트 방지
      keepalive: true,      // 탭 닫힘 중에도 최대한 전송
      body: JSON.stringify(body)
    }).catch(()=>{});
  }catch(_){}
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
    val.className = 'result-period';
    const unit = document.createElement('span');
    unit.className = 'result-unit';
    unit.textContent = '%';
    row.appendChild(label); row.appendChild(val); row.appendChild(unit);
    main.appendChild(row);

    const note = document.createElement('p');
    note.id = 'finalRateNote';
    note.className = 'small-note';
    note.textContent = '※ 변제율 = (월×기간) ÷ 무담보총액 × 100, 소수 1자리(0.5% 미만 내림)';
    main.appendChild(note);
  }
  return { row, rateEl: $1('#finalRate', row), noteEl: $1('#finalRateNote', row.parentElement) };
}
function showFixedWarnings(){
  const warnWrap = $1('.result-warning');
  if(!warnWrap) return;
  let warnBox = warnWrap.querySelector('ul');
  if(!warnBox){ warnBox = document.createElement('ul'); warnWrap.appendChild(warnBox); }
  warnBox.innerHTML = '';
  const lines = [
    '주의: 본 결과는 입력 기준 추정치입니다. 증빙 확인 시 변제금·기간이 달라질 수 있습니다.',
    '추가 생계비 인정(특이사유) 여부에 따라 월 납부액이 변동됩니다.',
    '최근 대출·1년치 계좌/카드 사용내역에 따라 산정이 크게 달라질 수 있어 전문가 확인이 반드시 필요합니다.'
  ];
  lines.forEach(t=>{ const li=document.createElement('li'); li.textContent=t; warnBox.appendChild(li); });
}

// ---------- consultOnly 전용 UI ----------
function renderConsultOnly(out){
  const main = $1('.result-main');
  if (main) {
    main.innerHTML = `
      <div class="consult-only" style="display:flex;flex-direction:column;align-items:center;gap:10px;">
        <div class="result-amount" style="color:#dc2626;">전문상담이 반드시 필요합니다</div>
        <p class="small-note" style="text-align:center;color:#374151;margin:0;">
          ${(out?.breakdown?.flags && out.breakdown.flags[0]) ? '사유: ' + out.breakdown.flags[0] : ''}
        </p>
      </div>
    `;
  }
  const {row, noteEl} = ensureRateUI();
  if(row) row.style.display = 'none';
  if(noteEl) noteEl.style.display = 'none';
  const warn = $1('.result-warning');
  if (warn) warn.style.display = 'none';
  const rep = $1('#finalRepayment'); if(rep) rep.textContent = '';
  const per = $1('#finalPeriod');    if(per) per.textContent = '';
}

// ---------- 렌더 & 중복전송 방지 ----------
let __lastResult = null;
let __sent_assessment = false;
let __sent_consult    = false;

function renderOutput(out){
  __lastResult = out;
  const rep = $1('#finalRepayment');
  const per = $1('#finalPeriod');

  if (out?.consultOnly) {
    renderConsultOnly(out);
    console.log('[assessment][consultOnly]', out);
    return;
  }

  showFixedWarnings();

  if (rep) rep.textContent = `${fmt(out.monthlyRepayment)}원`;
  if (per) per.textContent = `${out.months}개월`;

  const { row, rateEl, noteEl } = ensureRateUI();
  try{
    const unsecured = Number(out?.breakdown?.debts?.unsecuredTotal || 0);
    if (unsecured > 0) {
      const totalPay = Number(out.monthlyRepayment||0) * Number(out.months||0);
      let rate = (totalPay / unsecured) * 100;
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

    // 결과 스텝이 열릴 때: 무료진단 이벤트 전송 (1회만)
    if (!__sent_assessment) {
      __sent_assessment = true;
      sendWebhook({ event: 'assessment_done', result: out });
    }
  }catch(e){ console.error(e); }
}

document.addEventListener('DOMContentLoaded', ()=>{
  window.__runAssessment = runAssessment; // 수동 테스트용
  const resultSection = document.querySelector('section.cm-step[data-step="10"]');
  if (!resultSection) return;

  if (!resultSection.hidden) calculateAndRender();

  const mo = new MutationObserver(()=>{
    if (!resultSection.hidden) calculateAndRender();
  });
  mo.observe(resultSection, { attributes:true, attributeFilter:['hidden'] });

  // 상담신청 submit 훅: 개인정보 포함 전송 (1회만) + 더블클릭 방지
  const submitBtn = document.getElementById('submitConsult');
  submitBtn?.addEventListener('click', async ()=>{
    if (__sent_consult) return;        // 중복 방지
    __sent_consult = true;
    submitBtn.disabled = true;

    const contact = {
      name:  ($1('#clientName')?.value || '').trim(),
      phone: ($1('#clientPhone')?.value || '').trim(),
      preferredDate: $1('#preferredDate')?.value || '',
      preferredTime: $1('#preferredTime')?.value || ''
    };
    const result = __lastResult || await runAssessment();
    sendWebhook({ event: 'consult_submitted', result, contact });

    alert('상담 신청이 완료되었습니다. 곧 연락드리겠습니다.');
  });
});
