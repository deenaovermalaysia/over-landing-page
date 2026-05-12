// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
const state = {
  currentTab:     'MY',
  allData:        [],
  salesData:      {},
  rangeStart:     { monthIdx:0, day:1 },
  rangeEnd:       { monthIdx:0, day:1 },
  hiddenProducts: new Set(),
  chartInstance:  null,
  compareChart:   null,
  compareMonths:  new Set(),
  sortOrder:      'none',
};

const CHART_COLORS = [
  '#6366f1','#22c55e','#f59e0b','#ef4444','#a855f7',
  '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6','#8b5cf6','#64748b',
];
const MONTH_COLORS = ['#6366f1','#22c55e','#f59e0b','#ef4444','#a855f7','#06b6d4'];
const MONTH_NAMES  = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];

function roasRating(v) {
  if (v >= 5) return { label:'Excellent', cls:'roas-excellent' };
  if (v >= 3) return { label:'Good',      cls:'roas-good'      };
  return           { label:'Poor',       cls:'roas-poor'      };
}

function rkey(mi, d) { return mi * 1000 + d; }
function normaliseRange(a, b) {
  return rkey(a.monthIdx,a.day) <= rkey(b.monthIdx,b.day) ? [a,b] : [b,a];
}

// ── Today / Yesterday ─────────────────────────────────────────
const TODAY     = new Date();
const TODAY_MON = MONTH_NAMES[TODAY.getMonth()];
const TODAY_DAY = TODAY.getDate();
const YEST      = new Date(TODAY); YEST.setDate(TODAY.getDate() - 1);
const YEST_MON  = MONTH_NAMES[YEST.getMonth()];
const YEST_DAY  = YEST.getDate();

// Find index (0-based) of actualDay in md.dates[]
function getDayIndex(md, actualDay) {
  return md.dates.findIndex(d => parseInt(d.split('/')[0]) === actualDay);
}

// ── Data availability helpers ──────────────────────────────────
// Does md have any non-null, non-zero ROAS at array index idx?
function hasDataAtIdx(md, idx) {
  if (!md || idx < 0 || idx >= md.dates.length) return false;
  const gt = md.grandTotal.dailyROAS[idx];
  if (gt !== null && gt > 0) return true;
  return md.products.some(p => { const v = p.dailyROAS[idx]; return v !== null && v > 0; });
}

// Does monthIdx/actualDay have any data?
function hasData(monthIdx, actualDay) {
  const md = state.allData[monthIdx];
  if (!md) return false;
  return hasDataAtIdx(md, getDayIndex(md, actualDay));
}

// Last calendar day that has actual data in md
function getLastDataDay(md) {
  for (let i = md.dates.length - 1; i >= 0; i--) {
    if (hasDataAtIdx(md, i)) return parseInt(md.dates[i].split('/')[0]);
  }
  return parseInt(md.dates[md.dates.length - 1].split('/')[0]);
}

// First calendar day that has actual data in md
function getFirstDataDay(md) {
  for (let i = 0; i < md.dates.length; i++) {
    if (hasDataAtIdx(md, i)) return parseInt(md.dates[i].split('/')[0]);
  }
  return parseInt(md.dates[0].split('/')[0]);
}

function isToday(monthIdx, actualDay) {
  const md = state.allData[monthIdx];
  return !!md && md.monthName === TODAY_MON && actualDay === TODAY_DAY;
}

function isSingleDay() {
  return state.rangeStart.monthIdx === state.rangeEnd.monthIdx &&
         state.rangeStart.day      === state.rangeEnd.day;
}

function getSelectedDateStr() {
  if (!isSingleDay()) return null;
  const md = state.allData[state.rangeStart.monthIdx];
  if (!md) return null;
  const idx = getDayIndex(md, state.rangeStart.day);
  return idx >= 0 ? md.dates[idx] : null;
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR
// ═══════════════════════════════════════════════════════════════
const cal = {
  open:      false,
  viewIdx:   0,
  phase:    'start',
  tempStart: null,
  tempEnd:   null,
};

function openCalendar() {
  cal.viewIdx   = state.rangeStart.monthIdx;
  cal.tempStart = { ...state.rangeStart };
  cal.tempEnd   = { ...state.rangeEnd };
  cal.phase     = 'start';
  cal.open      = true;

  const trigger = document.getElementById('dateRangeTrigger');
  const rect    = trigger.getBoundingClientRect();
  const popup   = document.getElementById('calPopup');
  popup.style.top  = (rect.bottom + 6) + 'px';
  popup.style.left = Math.min(rect.left, window.innerWidth - 295) + 'px';
  popup.style.display = 'block';
  buildCal();
}

function closeCal() {
  cal.open = false;
  const p = document.getElementById('calPopup');
  if (p) p.style.display = 'none';
}

document.addEventListener('click', function(e) {
  if (!cal.open) return;
  const trigger = document.getElementById('dateRangeTrigger');
  if (trigger && trigger.contains(e.target)) return;
  const popup = document.getElementById('calPopup');
  if (!popup) return;
  const r = popup.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right ||
      e.clientY < r.top  || e.clientY > r.bottom) closeCal();
});

function buildCal() {
  const popup = document.getElementById('calPopup');
  const md    = state.allData[cal.viewIdx];
  if (!md || !popup) return;

  const isFirst = cal.viewIdx === 0;
  const isLast  = cal.viewIdx === state.allData.length - 1;

  // Parse year + month from first available date string, or fall back to month name
  let year = TODAY.getFullYear(), month = 1, yearStr = String(year);
  try {
    if (md.dates.length > 0) {
      const p = md.dates[0].split('/');
      month    = parseInt(p[1]);         // 1-based month
      year     = parseInt(p[2]);
      yearStr  = p[2] || '';
    } else {
      month = MONTH_NAMES.indexOf(md.monthName) + 1;
    }
  } catch(e) {}

  // Full month grid: weekday of the 1st, total days in month
  const firstDow    = new Date(year, month - 1, 1).getDay();   // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();       // 28/29/30/31

  // Build a Map of  actualDay → array-index  for days present in md.dates
  const dayIndexMap = new Map();
  md.dates.forEach((dateStr, idx) => {
    dayIndexMap.set(parseInt(dateStr.split('/')[0]), idx);
  });

  // Build grid — show ALL days of the month
  let grid = '';
  for (let i = 0; i < firstDow; i++) grid += '<div class="cal-cell cal-empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const idx          = dayIndexMap.has(d) ? dayIndexMap.get(d) : -1;
    const hasActualData = idx >= 0 && hasDataAtIdx(md, idx);
    const todayMk      = isToday(cal.viewIdx, d);
    const selCls       = hasActualData ? getDayCls(d, cal.viewIdx) : '';
    const todayCls     = todayMk       ? ' cal-today'   : '';
    const greyClass    = hasActualData ? ''              : ' cal-no-data';
    const onclick      = hasActualData ? `onclick="calDay(${d})"` : '';
    grid += `<div class="cal-cell ${selCls}${todayCls}${greyClass}" ${onclick}>${d}</div>`;
  }

  // Footer
  const ts = cal.tempStart, te = cal.tempEnd;
  let statusHtml = '<span class="cal-status">① Click a start date</span>';
  let applyBtn   = '';

  if (ts && cal.phase === 'end' && !te) {
    const tsName = (state.allData[ts.monthIdx]?.monthName || '').slice(0,3);
    statusHtml = `<span class="cal-status">${tsName} ${ts.day} &rarr; ② Click end date</span>`;
  } else if (ts && te) {
    const [lo, hi] = normaliseRange(ts, te);
    const loN = (state.allData[lo.monthIdx]?.monthName || '').slice(0,3);
    const hiN = (state.allData[hi.monthIdx]?.monthName || '').slice(0,3);
    const same = lo.monthIdx === hi.monthIdx && lo.day === hi.day;
    const lbl  = same ? `${loN} ${lo.day} (single day)`
      : lo.monthIdx === hi.monthIdx ? `${loN} ${lo.day} – ${hi.day}`
      : `${loN} ${lo.day} – ${hiN} ${hi.day}`;
    statusHtml = `<span class="cal-status cal-status--ready">${lbl}</span>`;
    applyBtn   = `<button class="cal-apply-btn" onclick="applyCalendar()">Apply</button>`;
  }

  popup.innerHTML = `
    <div class="cal-head">
      <button class="cal-nav" onclick="calNav(-1)" ${isFirst?'disabled':''}>&#8249;</button>
      <span class="cal-title">${md.monthName} ${yearStr}</span>
      <button class="cal-nav" onclick="calNav(1)"  ${isLast?'disabled':''}>&#8250;</button>
    </div>
    <div class="cal-presets">
      <button onclick="calPreset('yest')">Yesterday</button>
      <button onclick="calPreset('last7')">Last 7 Days</button>
      <button onclick="calPreset('last14')">Last 14 Days</button>
      <button onclick="calPreset('first7')">First 7 Days</button>
      <button onclick="calPreset('full')">Full Month</button>
    </div>
    <div class="cal-dow">
      <span>Su</span><span>Mo</span><span>Tu</span><span>We</span>
      <span>Th</span><span>Fr</span><span>Sa</span>
    </div>
    <div class="cal-grid">${grid}</div>
    <div class="cal-legend-row">
      <span class="cal-today-dot"></span>Today (${TODAY_MON.slice(0,3)} ${TODAY_DAY})
      &nbsp;·&nbsp;
      <span class="cal-nodata-dot"></span>No data yet
    </div>
    <div class="cal-foot">${statusHtml}${applyBtn}</div>`;
}

function getDayCls(actualDay, viewIdx) {
  const ts = cal.tempStart, te = cal.tempEnd;
  if (!ts) return '';
  const key  = rkey(viewIdx, actualDay);
  const sKey = rkey(ts.monthIdx, ts.day);
  const eKey = te ? rkey(te.monthIdx, te.day) : sKey;
  const lo   = Math.min(sKey, eKey), hi = Math.max(sKey, eKey);
  if (key === lo || key === hi) return 'cal-sel';
  if (key > lo && key < hi)    return 'cal-range';
  return '';
}

function calNav(dir) {
  const ni = cal.viewIdx + dir;
  if (ni < 0 || ni >= state.allData.length) return;
  cal.viewIdx = ni;
  buildCal();
}

function calDay(actualDay) {
  if (!hasData(cal.viewIdx, actualDay)) return; // guard: no-data dates
  if (cal.phase === 'start') {
    cal.tempStart = { monthIdx: cal.viewIdx, day: actualDay };
    cal.tempEnd   = null;
    cal.phase     = 'end';
  } else {
    cal.tempEnd = { monthIdx: cal.viewIdx, day: actualDay };
    cal.phase   = 'start';
  }
  buildCal();
}

function calPreset(type) {
  if (type === 'yest') {
    let yMi = state.allData.findIndex(m => m.monthName === YEST_MON);
    if (yMi < 0) yMi = state.allData.length - 1;
    const yMd = state.allData[yMi];
    if (!yMd || !yMd.dates.length) return;
    // Use yesterday if it has data, otherwise last day with data
    let day;
    const yIdx = getDayIndex(yMd, YEST_DAY);
    if (yIdx >= 0 && hasDataAtIdx(yMd, yIdx)) {
      day = YEST_DAY;
    } else {
      day = getLastDataDay(yMd);
    }
    cal.tempStart = { monthIdx: yMi, day };
    cal.tempEnd   = { monthIdx: yMi, day };
    cal.phase     = 'start';
    applyCalendar();
    return;
  }

  const mi  = cal.viewIdx;
  const md  = state.allData[mi];
  if (!md || !md.dates.length) return;

  // Use actual data range, not just header range
  const firstDay = getFirstDataDay(md);
  const lastDay  = getLastDataDay(md);

  switch(type) {
    case 'full':
      cal.tempStart = { monthIdx:mi, day:firstDay };
      cal.tempEnd   = { monthIdx:mi, day:lastDay  };
      break;
    case 'last7':
      cal.tempStart = { monthIdx:mi, day:Math.max(firstDay, lastDay - 6) };
      cal.tempEnd   = { monthIdx:mi, day:lastDay };
      break;
    case 'last14':
      cal.tempStart = { monthIdx:mi, day:Math.max(firstDay, lastDay - 13) };
      cal.tempEnd   = { monthIdx:mi, day:lastDay };
      break;
    case 'first7':
      cal.tempStart = { monthIdx:mi, day:firstDay };
      cal.tempEnd   = { monthIdx:mi, day:Math.min(lastDay, firstDay + 6) };
      break;
  }
  cal.phase = 'start';
  applyCalendar();
}

function applyCalendar() {
  if (!cal.tempStart || !cal.tempEnd) return;
  const [lo, hi] = normaliseRange(cal.tempStart, cal.tempEnd);
  state.rangeStart = lo;
  state.rangeEnd   = hi;
  updateTriggerLabel();
  closeCal();
  renderDashboard();
  renderCompare();
}

function updateTriggerLabel() {
  const el = document.getElementById('dateRangeLabel');
  if (!el) return;
  const rs = state.rangeStart, re = state.rangeEnd;
  const sm = (state.allData[rs.monthIdx]?.monthName || '').slice(0,3);
  const em = (state.allData[re.monthIdx]?.monthName || '').slice(0,3);
  if (rs.monthIdx === re.monthIdx && rs.day === re.day) {
    el.textContent = `${sm} ${rs.day}`;
  } else if (rs.monthIdx === re.monthIdx) {
    el.textContent = `${sm} ${rs.day} – ${re.day}`;
  } else {
    el.textContent = `${sm} ${rs.day} – ${em} ${re.day}`;
  }
}

// ── Default: last date WITH ACTUAL DATA ───────────────────────
function setDefaultRange() {
  if (!state.allData.length) return;
  // Walk backwards to find last month with any data
  let mi = state.allData.length - 1;
  while (mi >= 0 && !state.allData[mi].dates.length) mi--;
  if (mi < 0) return;

  const md      = state.allData[mi];
  const lastDay = getLastDataDay(md); // last day that has actual ROAS data

  state.rangeStart = { monthIdx: mi, day: lastDay };
  state.rangeEnd   = { monthIdx: mi, day: lastDay };
  updateTriggerLabel();
}

// ═══════════════════════════════════════════════════════════════
// DATA SLICE
// ═══════════════════════════════════════════════════════════════
function getCrossMonthSlice() {
  const rs = state.rangeStart, re = state.rangeEnd;
  if (!state.allData.length) return { dates:[], products:[], grandTotal:{avgROAS:0,dailyROAS:[]} };

  let allDates=[], gtDaily=[];
  const productMap={};

  for (let mi = rs.monthIdx; mi <= re.monthIdx; mi++) {
    const md = state.allData[mi]; if (!md) continue;
    let fromIdx = 0, toIdx = md.dates.length;
    if (mi === rs.monthIdx) { const fi = getDayIndex(md, rs.day); fromIdx = fi >= 0 ? fi : 0; }
    if (mi === re.monthIdx) { const ti = getDayIndex(md, re.day); toIdx = ti >= 0 ? ti + 1 : md.dates.length; }

    allDates = allDates.concat(md.dates.slice(fromIdx, toIdx));
    gtDaily  = gtDaily.concat(md.grandTotal.dailyROAS.slice(fromIdx, toIdx));
    md.products.forEach(p => {
      if (!productMap[p.name]) productMap[p.name] = { name:p.name, dailyROAS:[] };
      productMap[p.name].dailyROAS = productMap[p.name].dailyROAS.concat(p.dailyROAS.slice(fromIdx, toIdx));
    });
  }

  const products = Object.values(productMap).map(p => {
    const valid = p.dailyROAS.filter(v => v !== null && v > 0);
    return { ...p, avgROAS: valid.length ? valid.reduce((a,b)=>a+b,0)/valid.length : 0 };
  });
  const gtV = gtDaily.filter(v => v !== null && v > 0);
  return {
    dates: allDates, products,
    grandTotal: { avgROAS: gtV.length ? gtV.reduce((a,b)=>a+b,0)/gtV.length : 0, dailyROAS: gtDaily },
  };
}

function getFullMonthSlice(md) {
  const products = md.products.map(p => {
    const v = p.dailyROAS.filter(v=>v!==null&&v>0);
    return { ...p, avgROAS: v.length ? v.reduce((a,b)=>a+b,0)/v.length : 0 };
  });
  const gtV = md.grandTotal.dailyROAS.filter(v=>v!==null&&v>0);
  return {
    dates:md.dates, products,
    grandTotal:{ avgROAS:gtV.length?gtV.reduce((a,b)=>a+b,0)/gtV.length:0, dailyROAS:md.grandTotal.dailyROAS },
  };
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.platform-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.platform-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentTab = btn.dataset.tab;
      state.hiddenProducts.clear();
      loadData();
    });
  });

  document.getElementById('dateRangeTrigger').addEventListener('click', openCalendar);

  document.getElementById('toggleAll').addEventListener('change', e => {
    const allNames = new Set(state.allData.flatMap(m => m.products.map(p => p.name)));
    if (e.target.checked) state.hiddenProducts.clear();
    else allNames.forEach(n => state.hiddenProducts.add(n));
    renderDashboard();
  });

  setInterval(() => loadData(true), 5 * 60 * 1000);
  loadData();
});

// ═══════════════════════════════════════════════════════════════
// FETCH
// ═══════════════════════════════════════════════════════════════
function manualRefresh() {
  const btn=document.getElementById('refreshBtn'), icon=document.getElementById('refreshIcon');
  btn.disabled=true; icon.classList.add('spinning');
  loadData(false).finally(()=>{ btn.disabled=false; icon.classList.remove('spinning'); });
}

async function loadData(silent=false) {
  if (!silent) showState('loading');
  try {
    const res = await fetch(`/api/roas?tab=${state.currentTab}`, { credentials:'same-origin' });
    if (res.status===401) { window.location.href='/login.html'; return; }
    const json = await res.json();
    if (!res.ok||!json.success) throw new Error(json.detail||json.error||'Unknown');

    state.allData   = json.data;
    state.salesData = json.salesData || {};

    const now = new Date();
    document.getElementById('lastUpdated').textContent =
      now.toLocaleDateString('en-MY',{day:'2-digit',month:'short'})+' '+
      now.toLocaleTimeString('en-MY',{hour:'2-digit',minute:'2-digit'});

    // Set default only on first load or if stored range is invalid
    const rs = state.rangeStart;
    if (!state.allData[rs.monthIdx] || getDayIndex(state.allData[rs.monthIdx], rs.day) < 0) {
      setDefaultRange();
    } else {
      updateTriggerLabel();
    }

    if (state.compareMonths.size===0) json.data.forEach(m=>state.compareMonths.add(m.monthName));

    showState('content');
    renderDashboard();
    renderCompare();
  } catch(err) {
    console.error(err);
    if (!silent) { document.getElementById('errorMsg').textContent=err.message; showState('error'); }
  }
}

function showState(w) {
  document.getElementById('loadingState').style.display     = w==='loading'?'flex':'none';
  document.getElementById('errorState').style.display       = w==='error'  ?'flex':'none';
  document.getElementById('dashboardContent').style.display = w==='content'?'block':'none';
}

// ═══════════════════════════════════════════════════════════════
// SORT
// ═══════════════════════════════════════════════════════════════
function toggleSort() {
  state.sortOrder = state.sortOrder==='desc' ? 'asc' : state.sortOrder==='asc' ? 'none' : 'desc';
  const btn = document.getElementById('sortBtn');
  if (btn) btn.innerHTML = state.sortOrder==='desc' ? '&#8595; High &rarr; Low'
                         : state.sortOrder==='asc'  ? '&#8593; Low &rarr; High'
                         : '&#8597; Sort';
  renderTable(getCrossMonthSlice().products);
}

// ═══════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════
function renderDashboard() {
  const slice = getCrossMonthSlice();
  const allProducts = state.allData.flatMap(m=>m.products)
    .filter((p,i,a)=>a.findIndex(x=>x.name===p.name)===i);
  renderToggles(slice.products, allProducts);
  renderStats(slice);
  if (isSingleDay()) renderBarChart(slice, allProducts);
  else               renderLineChart(slice, allProducts);
  renderTable(slice.products);
  renderRanks(slice.products);
}

function syncAllCheckbox() {
  const allNames = new Set(state.allData.flatMap(m=>m.products.map(p=>p.name)));
  const cb = document.getElementById('toggleAll');
  const allOn  = [...allNames].every(n=>!state.hiddenProducts.has(n));
  const allOff = [...allNames].every(n=> state.hiddenProducts.has(n));
  cb.checked=allOn; cb.indeterminate=!allOn&&!allOff;
}

function renderToggles(products, allProducts) {
  const c = document.getElementById('productToggles'); c.innerHTML='';
  products.forEach(p=>{
    const idx   = allProducts.findIndex(ap=>ap.name===p.name);
    const color = CHART_COLORS[idx>=0?idx%CHART_COLORS.length:0];
    const hidden = state.hiddenProducts.has(p.name);
    const label = document.createElement('label');
    label.className='toggle-item'+(hidden?'':' active');
    label.innerHTML=`<input type="checkbox" ${hidden?'':'checked'}/>
      <span class="toggle-dot" style="background:${color}"></span>${p.name}`;
    label.querySelector('input').addEventListener('change',e=>{
      if (e.target.checked){state.hiddenProducts.delete(p.name);label.classList.add('active');}
      else                 {state.hiddenProducts.add(p.name);   label.classList.remove('active');}
      const slice=getCrossMonthSlice();
      if (isSingleDay()) renderBarChart(slice,allProducts);
      else               renderLineChart(slice,allProducts);
      syncAllCheckbox();
    });
    c.appendChild(label);
  });
  syncAllCheckbox();
}

function renderStats(slice) {
  const {products,grandTotal,dates}=slice;
  document.getElementById('statAvg').textContent   =fmt(grandTotal.avgROAS);
  document.getElementById('statAvgSub').textContent='Grand total avg';
  const sorted=[...products].sort((a,b)=>b.avgROAS-a.avgROAS);
  const top=sorted[0],worst=sorted[sorted.length-1];
  document.getElementById('statTop').textContent   =top  ?top.name  :'—';
  document.getElementById('statTopSub').textContent=top  ?`ROAS: ${fmt(top.avgROAS)}`  :'';
  document.getElementById('statLow').textContent   =worst?worst.name:'—';
  document.getElementById('statLowSub').textContent=worst?`ROAS: ${fmt(worst.avgROAS)}`:'';
  const active=grandTotal.dailyROAS.filter(v=>v!==null&&v>0).length;
  document.getElementById('statDays').textContent   =active;
  document.getElementById('statDaysSub').textContent=`of ${dates.length} day${dates.length!==1?'s':''}`;
}

// ── LINE CHART ─────────────────────────────────────────────────
function renderLineChart(slice, allProducts) {
  if (state.chartInstance) state.chartInstance.destroy();
  const {dates,products,grandTotal}=slice;
  const ctx    =document.getElementById('roasChart').getContext('2d');
  const visible=products.filter(p=>!state.hiddenProducts.has(p.name));
  const labels =dates.map(d=>{const p=d.split('/');return p.length>=2?`${p[0]}/${p[1]}`:d;});

  const datasets=visible.map(p=>{
    const idx=(allProducts||products).findIndex(ap=>ap.name===p.name);
    return {label:p.name,data:p.dailyROAS.map(v=>v===null?null:v),
      borderColor:CHART_COLORS[idx>=0?idx%CHART_COLORS.length:0],
      backgroundColor:'transparent',borderWidth:2,pointRadius:2,pointHoverRadius:5,tension:0.3,spanGaps:false};
  });
  datasets.push({label:'Grand Total',data:grandTotal.dailyROAS.map(v=>v===null?null:v),
    borderColor:'#f1f5f9',backgroundColor:'transparent',
    borderWidth:2.5,borderDash:[6,3],pointRadius:0,tension:0.3,spanGaps:false});
  datasets.push(
    {label:'— Good (3.0)',      data:Array(labels.length).fill(3),borderColor:'rgba(34,197,94,.45)',  borderWidth:1,borderDash:[4,4],pointRadius:0,tension:0,backgroundColor:'transparent'},
    {label:'— Excellent (5.0)',data:Array(labels.length).fill(5),borderColor:'rgba(168,85,247,.45)',borderWidth:1,borderDash:[4,4],pointRadius:0,tension:0,backgroundColor:'transparent'}
  );

  updateChartBadge();
  state.chartInstance=new Chart(ctx,{type:'line',data:{labels,datasets},options:{
    responsive:true,maintainAspectRatio:false,
    interaction:{mode:'index',intersect:false},
    plugins:{
      legend:{position:'bottom',labels:{color:'#94a3b8',boxWidth:12,font:{size:11},padding:16}},
      tooltip:{backgroundColor:'#1e293b',borderColor:'#334155',borderWidth:1,
        titleColor:'#f1f5f9',bodyColor:'#94a3b8',
        callbacks:{label:c=>` ${c.dataset.label}: ${c.parsed.y!==null?fmt(c.parsed.y):'N/A'}`}},
    },
    scales:{
      x:{ticks:{color:'#64748b',font:{size:10},maxRotation:45},grid:{color:'#1e293b'}},
      y:{beginAtZero:true,ticks:{color:'#64748b',callback:v=>fmt(v)},grid:{color:'#273549'}},
    },
  }});
}

// ── BAR CHART (single day) ─────────────────────────────────────
function renderBarChart(slice, allProducts) {
  if (state.chartInstance) state.chartInstance.destroy();
  const {products}=slice;
  const ctx    =document.getElementById('roasChart').getContext('2d');
  // Include ALL products (even ROAS=0) so they're visible in chart
  const visible=products.filter(p=>!state.hiddenProducts.has(p.name));
  const labels =visible.map(p=>p.name);
  const values =visible.map(p=>+p.avgROAS.toFixed(2));
  const colors =visible.map(p=>{
    const idx=(allProducts||products).findIndex(ap=>ap.name===p.name);
    return CHART_COLORS[idx>=0?idx%CHART_COLORS.length:0];
  });

  const dateStr=getSelectedDateStr();

  updateChartBadge();
  state.chartInstance=new Chart(ctx,{
    type:'bar',
    data:{
      labels,
      datasets:[
        {
          label:'ROAS', data:values,
          backgroundColor:colors.map(c=>c+'BB'),
          borderColor:colors,
          borderWidth:1,
          borderRadius:6,
          minBarLength:5,  // ← ROAS=0 bars still get 5px height → hoverable
        },
        {label:'Good (3.0)',      data:Array(labels.length).fill(3),type:'line',borderColor:'rgba(34,197,94,.55)',  borderWidth:1.5,borderDash:[5,4],pointRadius:0,fill:false,tension:0,backgroundColor:'transparent'},
        {label:'Excellent (5.0)',data:Array(labels.length).fill(5),type:'line',borderColor:'rgba(168,85,247,.55)',borderWidth:1.5,borderDash:[5,4],pointRadius:0,fill:false,tension:0,backgroundColor:'transparent'},
      ],
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:'#1e293b',borderColor:'#334155',borderWidth:1,
          titleColor:'#f1f5f9',bodyColor:'#94a3b8',
          callbacks:{
            title: items=>items[0]?.label||'',
            label: ctx=>{
              if (ctx.dataset.type==='line') return ` ${ctx.dataset.label}`;
              const productName=ctx.label;
              const lines=[` ROAS: ${fmt(ctx.parsed.y)}`];

              // Always look up Ads Spent + Sales — even if ROAS=0
              const dayData=(dateStr&&state.salesData)?state.salesData[dateStr]||{}:{};
              let adsSpent=null, sales=null;

              if (productName==='OB + OB Pro') {
                const obE=dayData['OB'], obPE=dayData['OB Pro'];
                // Show even if both are 0
                if (obE!==undefined||obPE!==undefined) {
                  adsSpent=(obE?.adsSpent||0)+(obPE?.adsSpent||0);
                  sales   =(obE?.sales   ||0)+(obPE?.sales   ||0);
                }
              } else {
                const entry=dayData[productName];
                // entry exists (even if adsSpent=0 & sales=0) → show it
                if (entry!==undefined) { adsSpent=entry.adsSpent; sales=entry.sales; }
              }

              if (adsSpent!==null) {
                const fmtRM=v=>'RM '+v.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
                lines.push(` Ads Spent: ${fmtRM(adsSpent)}`);
                lines.push(` Sales: ${fmtRM(sales)}`);
              }
              return lines;
            },
          },
        },
      },
      scales:{
        x:{ticks:{color:'#94a3b8',font:{size:11}},grid:{color:'#1e293b'}},
        y:{beginAtZero:true,ticks:{color:'#64748b',callback:v=>fmt(v)},grid:{color:'#273549'}},
      },
    },
  });
}

function updateChartBadge(){
  document.getElementById('chartBadge').textContent=
    document.getElementById('dateRangeLabel').textContent+' · '+
    (state.currentTab==='MY'?'MY Website':state.currentTab==='SG'?'SG Website':'Marketplace');
}

function renderTable(products) {
  const tbody=document.getElementById('perfTableBody'); tbody.innerHTML='';
  let sorted=[...products];
  if (state.sortOrder==='desc') sorted.sort((a,b)=>b.avgROAS-a.avgROAS);
  else if (state.sortOrder==='asc') sorted.sort((a,b)=>a.avgROAS-b.avgROAS);
  sorted.forEach(p=>{
    const {label,cls}=roasRating(p.avgROAS);
    const tr=document.createElement('tr');
    tr.innerHTML=`<td style="font-weight:600">${p.name}</td>
      <td><span style="font-size:1rem;font-weight:700;color:#f1f5f9">${fmt(p.avgROAS)}</span></td>
      <td><span class="roas-badge ${cls}">${label}</span></td>`;
    tbody.appendChild(tr);
  });
}

function renderRanks(products){
  const s=[...products].sort((a,b)=>b.avgROAS-a.avgROAS);
  renderRankList('top5List',  s.slice(0,5));
  renderRankList('worst5List',s.slice(-5).reverse());
}
function renderRankList(id,items){
  const ul=document.getElementById(id);ul.innerHTML='';
  items.forEach((p,i)=>{
    const {cls}=roasRating(p.avgROAS);
    const li=document.createElement('li');li.className='rank-item';
    li.innerHTML=`<span class="rank-num">${i+1}</span>
      <span class="rank-name">${p.name}</span>
      <span class="roas-badge ${cls}" style="font-size:.76rem">${fmt(p.avgROAS)}</span>`;
    ul.appendChild(li);
  });
}

// ═══════════════════════════════════════════════════════════════
// COMPARE
// ═══════════════════════════════════════════════════════════════
function renderCompare(){
  const selected =[...state.compareMonths];
  const noData   =document.getElementById('compareNoData');
  const chartWrap=document.getElementById('compareChartWrap');
  const tableWrap=document.getElementById('compareTableWrap');
  buildComparePicker();

  if (selected.length<2){
    noData.style.display='flex';chartWrap.style.display='none';tableWrap.style.display='none';
    document.getElementById('compareNoMsg').textContent=
      selected.length===0?'Select at least 2 months.':'Select one more month.';
    return;
  }
  noData.style.display='none';chartWrap.style.display='block';tableWrap.style.display='block';

  const monthsData=selected.map(name=>{
    const md =state.allData.find(m=>m.monthName===name);
    const idx=state.allData.indexOf(md);
    return md?{name,color:MONTH_COLORS[idx%MONTH_COLORS.length],slice:getFullMonthSlice(md)}:null;
  }).filter(Boolean);

  const allNames=[...new Set(monthsData.flatMap(m=>m.slice.products.map(p=>p.name)))];

  if (state.compareChart) state.compareChart.destroy();
  const ctx=document.getElementById('compareChart').getContext('2d');
  state.compareChart=new Chart(ctx,{type:'bar',
    data:{labels:allNames,datasets:monthsData.map(md=>({
      label:md.name,
      data:allNames.map(n=>{const p=md.slice.products.find(p=>p.name===n);return p?+p.avgROAS.toFixed(2):0;}),
      backgroundColor:md.color+'BB',borderColor:md.color,borderWidth:1,borderRadius:4,
    }))},
    options:{responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{position:'top',labels:{color:'#94a3b8',font:{size:11},padding:16}},
        tooltip:{backgroundColor:'#1e293b',borderColor:'#334155',borderWidth:1,
          titleColor:'#f1f5f9',bodyColor:'#94a3b8',
          callbacks:{label:c=>` ${c.dataset.label}: ${fmt(c.parsed.y)}`}},
      },
      scales:{
        x:{ticks:{color:'#94a3b8',font:{size:10}},grid:{color:'#1e293b'}},
        y:{beginAtZero:true,ticks:{color:'#64748b',callback:v=>fmt(v)},grid:{color:'#273549'}},
      },
    },
  });

  const thead=document.getElementById('compareTableHead');
  const tbody=document.getElementById('compareTableBody');
  thead.innerHTML='<tr><th>Product</th>'+monthsData.map(m=>`<th style="color:${m.color}">${m.name}</th>`).join('')+'<th>Best</th></tr>';
  tbody.innerHTML='';
  allNames.forEach(name=>{
    const vals=monthsData.map(m=>{const p=m.slice.products.find(p=>p.name===name);return p?p.avgROAS:null;});
    const maxV=Math.max(...vals.filter(v=>v!==null)),bi=vals.indexOf(maxV);
    const cells=vals.map(v=>{const {cls}=v!==null?roasRating(v):{cls:''};
      return `<td class="${v===maxV&&v>0?'compare-best':''}"><span class="roas-badge ${cls}">${v!==null?fmt(v):'—'}</span></td>`;
    }).join('');
    tbody.innerHTML+=`<tr><td style="font-weight:600">${name}</td>${cells}<td><span style="color:${monthsData[bi]?.color};font-weight:700">${maxV>0?(monthsData[bi]?.name||'—'):'—'}</span></td></tr>`;
  });
  const gtV=monthsData.map(m=>m.slice.grandTotal.avgROAS);
  const gtMax=Math.max(...gtV),gtBi=gtV.indexOf(gtMax);
  tbody.innerHTML+=`<tr class="compare-gt"><td style="font-weight:700">Grand Total</td>${gtV.map((v,i)=>`<td class="${v===gtMax?'compare-best':''}"><strong style="color:#f1f5f9">${fmt(v)}</strong></td>`).join('')}<td><span style="color:${monthsData[gtBi]?.color};font-weight:700">${monthsData[gtBi]?.name||'—'}</span></td></tr>`;
}

function buildComparePicker(){
  const c=document.getElementById('compareMonthPicker');
  if (c.children.length===state.allData.length) return;
  c.innerHTML='';
  state.allData.forEach((m,i)=>{
    const color=MONTH_COLORS[i%MONTH_COLORS.length];
    const checked=state.compareMonths.has(m.monthName);
    const label=document.createElement('label');
    label.className='cmp-pill'+(checked?' active':'');
    label.style.setProperty('--mc',color);
    label.innerHTML=`<input type="checkbox" ${checked?'checked':''}><span class="cmp-dot"></span>${m.monthName}`;
    label.querySelector('input').addEventListener('change',e=>{
      if (e.target.checked){state.compareMonths.add(m.monthName);   label.classList.add('active');}
      else                 {state.compareMonths.delete(m.monthName);label.classList.remove('active');}
      renderCompare();
    });
    c.appendChild(label);
  });
}

function fmt(n){
  if (n===null||n===undefined||isNaN(n)) return '—';
  return Number(n).toFixed(2)+'x';
}

// ═══════════════════════════════════════════════════════════════
// CAMPAIGN PERFORMANCE
// ═══════════════════════════════════════════════════════════════
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL  = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

const camp = {
  allData:     [],
  filtered:    [],
  chart:       null,
  loaded:      false,
  filterYear:  '',
  filterMonth: '',
  filterType:  '',
  filterPlat:  '',
};

// ── Load ────────────────────────────────────────────────────────
async function loadCampaigns() {
  if (camp.loaded) { buildCampPickers(); filterCampaigns(); return; }

  document.getElementById('campLoadingState').style.display = 'flex';
  document.getElementById('campErrorState').style.display   = 'none';
  document.getElementById('campContent').style.display      = 'none';

  try {
    const res  = await fetch('/api/campaigns', { credentials:'same-origin' });
    if (res.status === 401) { window.location.href='/login.html'; return; }
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.detail || json.error || 'Unknown');

    camp.allData = json.data;
    camp.loaded  = true;

    document.getElementById('campLoadingState').style.display = 'none';
    document.getElementById('campContent').style.display      = 'block';

    buildCampPickers();
    filterCampaigns();
  } catch(err) {
    console.error(err);
    document.getElementById('campLoadingState').style.display = 'none';
    document.getElementById('campErrorState').style.display   = 'flex';
    document.getElementById('campErrorMsg').textContent = err.message;
    camp.loaded = false;
  }
}

// ── Build year pills + month grid ────────────────────────────────
function buildCampPickers() {
  const years = [...new Set(camp.allData.map(c => c.year).filter(Boolean))].sort();

  // Year pills
  const yearDiv = document.getElementById('campYearPicker');
  yearDiv.innerHTML = '';

  ['', ...years].forEach(y => {
    const btn = document.createElement('button');
    btn.className = 'camp-year-btn' + (camp.filterYear === y ? ' active' : '');
    btn.textContent = y || 'All';
    btn.onclick = () => setCampYear(y);
    yearDiv.appendChild(btn);
  });

  buildMonthGrid();
}

function buildMonthGrid() {
  // Which months have data in the selected year
  const relevant = camp.filterYear
    ? camp.allData.filter(c => c.year === camp.filterYear)
    : camp.allData;

  const monthsWithData = new Set(relevant.map(c => c.month).filter(Boolean));

  const grid = document.getElementById('campMonthGrid');
  grid.innerHTML = '';

  MONTH_SHORT.forEach((short, i) => {
    const full     = MONTH_FULL[i];
    const hasData  = monthsWithData.has(full);
    const selected = camp.filterMonth === full;

    const cell = document.createElement('div');
    // Priority: selected > has-data > no-data
    cell.className = 'camp-month-cell ' + (selected ? 'selected' : hasData ? 'has-data' : 'no-data');
    cell.textContent = short;
    cell.title = hasData
      ? (selected ? `Click to deselect ${full}` : `Filter to ${full}`)
      : `No campaigns in ${full}${camp.filterYear ? ' '+camp.filterYear : ''}`;

    if (hasData) {
      cell.onclick = () => setCampMonth(camp.filterMonth === full ? '' : full);
    }

    grid.appendChild(cell);
  });
}

function setCampYear(year) {
  camp.filterYear  = year;
  camp.filterMonth = '';   // reset month when year changes
  buildCampPickers();
  filterCampaigns();
}

function setCampMonth(month) {
  camp.filterMonth = month;
  buildMonthGrid();
  filterCampaigns();
}

function setCampFilter(kind, btn) {
  const cls = kind === 'type' ? 'camp-type-btn' : 'camp-plat-btn';
  document.querySelectorAll('.' + cls).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (kind === 'type') camp.filterType = btn.dataset.v;
  else                  camp.filterPlat = btn.dataset.v;
  filterCampaigns();
}

function filterCampaigns() {
  camp.filtered = camp.allData.filter(c => {
    if (camp.filterYear  && c.year  !== camp.filterYear)                          return false;
    if (camp.filterMonth && c.month !== camp.filterMonth)                         return false;
    if (camp.filterType  && c.type  !== camp.filterType)                          return false;
    if (camp.filterPlat  && !c.platforms.some(p => p.includes(camp.filterPlat))) return false;
    return true;
  });
  renderCampaigns();
}

// ── Helpers ──────────────────────────────────────────────────────
function calcLift(before, during) {
  if (before === null || during === null) return null;
  if (before === 0) return during > 0 ? 999 : null;
  return ((during - before) / before) * 100;
}

function fmtLift(lift) {
  if (lift === null) return { text:'N/A', cls:'lift-na'    };
  if (lift === 999)  return { text:'∞',   cls:'lift-great' };
  const sign = lift >= 0 ? '+' : '';
  return {
    text: `${sign}${lift.toFixed(1)}%`,
    cls:  lift > 20 ? 'lift-great' : lift > 0 ? 'lift-good' : 'lift-bad',
  };
}

function fmtUnits(n) { return n === null ? '—' : n.toLocaleString(); }

// ── Render ───────────────────────────────────────────────────────
function renderCampaigns() {
  const data = camp.filtered;

  // Stat cards
  const withData = data.filter(c => c.unitsBefore !== null && c.unitsDuring !== null);
  const lifts    = withData.map(c => calcLift(c.unitsBefore, c.unitsDuring)).filter(l => l !== null && l !== 999);
  const avgLift  = lifts.length ? lifts.reduce((a,b)=>a+b,0)/lifts.length : null;
  const declined = withData.filter(c => (calcLift(c.unitsBefore, c.unitsDuring) || 0) < 0).length;

  let bestLift = null, bestName = '—';
  withData.forEach(c => {
    const l = calcLift(c.unitsBefore, c.unitsDuring);
    if (l !== null && (bestLift === null || l > bestLift)) { bestLift = l; bestName = c.name; }
  });

  document.getElementById('campStatTotal').textContent    = data.length;
  document.getElementById('campStatSub').textContent      = `of ${camp.allData.length} total`;
  document.getElementById('campStatBest').textContent     = bestLift !== null ? fmtLift(bestLift).text : '—';
  document.getElementById('campStatBestName').textContent = bestName;
  document.getElementById('campStatAvg').textContent      = avgLift !== null ? fmtLift(avgLift).text : '—';
  document.getElementById('campStatDecline').textContent  = declined;

  const parts = [];
  if (camp.filterYear)  parts.push(camp.filterYear);
  if (camp.filterMonth) parts.push(camp.filterMonth);
  if (camp.filterType)  parts.push(camp.filterType);
  if (camp.filterPlat)  parts.push(camp.filterPlat);
  const badge = parts.length ? parts.join(' · ') : 'All campaigns';
  document.getElementById('campChartBadge').textContent = badge;
  document.getElementById('campTableCount').textContent = `${data.length} campaigns`;

  // ── Bar chart with detailed tooltip ─────────────────────────
  if (camp.chart) camp.chart.destroy();
  const ctx = document.getElementById('campChart').getContext('2d');
  const labels = data.map(c => {
    const period = c.month ? c.month.slice(0,3) + (c.year ? " '" + c.year.slice(2) : '') : '';
    const name   = c.name.length > 22 ? c.name.slice(0,20) + '…' : c.name;
    return period ? `${name} (${period})` : name;
  });

  camp.chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label:'Before', data:data.map(c=>c.unitsBefore||0), backgroundColor:'rgba(100,116,139,.55)', borderColor:'#64748b', borderWidth:1, borderRadius:3 },
        { label:'During', data:data.map(c=>c.unitsDuring||0), backgroundColor:'rgba(99,102,241,.75)',  borderColor:'#6366f1', borderWidth:1, borderRadius:3 },
        { label:'After',  data:data.map(c=>c.unitsAfter||0),  backgroundColor:'rgba(34,197,94,.6)',   borderColor:'#22c55e', borderWidth:1, borderRadius:3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: { position:'top', labels:{ color:'#94a3b8', font:{size:11}, padding:16 } },
        tooltip: {
          backgroundColor:'#1e293b', borderColor:'#334155', borderWidth:1,
          titleColor:'#f1f5f9', bodyColor:'#94a3b8',
          callbacks: {
            // Full campaign name as tooltip title
            title: items => {
              const c = data[items[0]?.dataIndex];
              if (!c) return '';
              const period = [c.month, c.year].filter(Boolean).join(' ');
              return [c.name, period].filter(Boolean).join('  ·  ');
            },
            // Before/During/After units
            label: ctx => {
              const labels = { Before:'Before', During:'During', After:'After' };
              const n = ctx.parsed.y;
              return ` ${ctx.dataset.label}: ${n === 0 ? '—' : n.toLocaleString()} units`;
            },
            // Date ranges + lift as footer
            afterBody: items => {
              const c = data[items[0]?.dataIndex];
              if (!c) return [];
              const lines = [];
              if (c.beforeRange) lines.push(`📅 Before:  ${c.beforeRange}`);
              if (c.duringRange) lines.push(`📅 During:  ${c.duringRange}`);
              if (c.afterRange)  lines.push(`📅 After:   ${c.afterRange}`);
              const lift = calcLift(c.unitsBefore, c.unitsDuring);
              if (lift !== null) lines.push(`📈 Lift:    ${fmtLift(lift).text}`);
              if (c.giftItem)   lines.push(`🎁 Gift:    ${c.giftItem}${c.giftClaimed ? ' ('+c.giftClaimed+' claimed)' : ''}`);
              return lines;
            },
          },
        },
      },
      scales: {
        x: { ticks:{ color:'#94a3b8', font:{size:9}, maxRotation:35 }, grid:{ color:'#1e293b' } },
        y: { beginAtZero:true, ticks:{ color:'#64748b' }, grid:{ color:'#273549' } },
      },
    },
  });

  // ── Table ────────────────────────────────────────────────────
  const tbody = document.getElementById('campTableBody');
  tbody.innerHTML = '';

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:24px">No campaigns match filters.</td></tr>`;
    return;
  }

  data.forEach(c => {
    const lift = calcLift(c.unitsBefore, c.unitsDuring);
    const { text:liftText, cls:liftCls } = fmtLift(lift);
    const rowCls = lift===null?'' : lift>20?'camp-row-great' : lift>0?'camp-row-good' : 'camp-row-bad';

    const platHtml = c.platforms.map(p => {
      const pcls = p.includes('MY Web')?'plat-my':p.includes('SG')?'plat-sg':'plat-off';
      return `<span class="plat-badge ${pcls}">${p}</span>`;
    }).join('');

    const period = [c.month, c.year].filter(Boolean).join(' ') || '—';
    const duringStr = c.duringRange ||
      (c.startDate ? c.startDate + (c.endDate && c.endDate!=='-' ? ' – '+c.endDate : '') : '—');

    const tr = document.createElement('tr');
    tr.className = rowCls;
    tr.innerHTML = `
      <td style="font-size:.78rem;font-weight:600">${period}</td>
      <td><span class="type-badge type-${c.type.toLowerCase()}">${c.type}</span></td>
      <td style="max-width:200px;white-space:normal;font-weight:600;font-size:.82rem">${c.name}</td>
      <td>${platHtml}</td>
      <td style="font-size:.73rem;color:var(--muted);min-width:130px">${duringStr}</td>
      <td style="text-align:right">${fmtUnits(c.unitsBefore)}</td>
      <td style="text-align:right;font-weight:700">${fmtUnits(c.unitsDuring)}</td>
      <td style="text-align:right">${fmtUnits(c.unitsAfter)}</td>
      <td style="text-align:right"><span class="${liftCls}">${liftText}</span></td>
      <td style="font-size:.78rem">${c.giftItem||'—'}</td>
      <td style="text-align:right">${c.giftClaimed!==null?c.giftClaimed:'—'}</td>`;
    tbody.appendChild(tr);
  });
}

// ═══════════════════════════════════════════════════════════════
// LIVE HOST
// ═══════════════════════════════════════════════════════════════
const lh = { data:null, chart:null, loaded:false };

async function loadLiveHost(slotsMonth) {
  const url = '/api/live-host' + (slotsMonth ? '?slotsMonth='+encodeURIComponent(slotsMonth) : '');
  document.getElementById('lhLoading').style.display = 'flex';
  document.getElementById('lhError').style.display   = 'none';
  document.getElementById('lhContent').style.display = 'none';
  try {
    const res  = await fetch(url, { credentials:'same-origin' });
    if (res.status===401) { window.location.href='/login.html'; return; }
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.detail || json.error);
    lh.data   = json;
    lh.loaded = true;
    // Populate month dropdown
    const sel = document.getElementById('lhSlotsMonth');
    if (json.slotTabs && json.slotTabs.length) {
      sel.innerHTML = json.slotTabs.map(t =>
        `<option value="${t}" ${t===json.slotsMonth?'selected':''}>${t}</option>`
      ).join('');
    } else {
      sel.innerHTML = `<option value="${json.slotsMonth}">${json.slotsMonth}</option>`;
    }
    document.getElementById('lhLoading').style.display = 'none';
    document.getElementById('lhContent').style.display = 'block';
    renderLiveHost();
  } catch(err) {
    console.error(err);
    document.getElementById('lhLoading').style.display = 'none';
    document.getElementById('lhError').style.display   = 'flex';
    document.getElementById('lhErrorMsg').textContent  = err.message;
  }
}

function renderLiveHost() {
  const { hosts, missedLives, slotsMonth } = lh.data;
  // Stat cards
  const allLes = hosts.map(h=>h.avgLes).filter(v=>v>0);
  const overallAvg = allLes.length ? (allLes.reduce((a,b)=>a+b,0)/allLes.length).toFixed(2) : '—';
  const best = hosts[0];
  const totalSessions = hosts.reduce((a,h)=>a+h.sessions, 0);
  document.getElementById('lhStatAvgLes').textContent    = overallAvg;
  document.getElementById('lhStatBestHost').textContent  = best ? best.host : '—';
  document.getElementById('lhStatBestLes').textContent   = best ? `LES: ${best.avgLes}` : '';
  document.getElementById('lhStatSessions').textContent  = totalSessions;
  document.getElementById('lhStatSessionsSub').textContent = `across ${hosts.length} hosts`;
  document.getElementById('lhStatMissed').textContent    = missedLives.missed;
  document.getElementById('lhStatMissedSub').textContent = `${slotsMonth} · ${missedLives.totalConducted}/${missedLives.totalScheduled} conducted`;
  document.getElementById('lhChartBadge').textContent    = 'All sessions · ' + slotsMonth;

  // Bar chart — LES per host
  if (lh.chart) lh.chart.destroy();
  const TIER_COLORS = { Legendary:'#f59e0b', Master:'#6366f1', Amateur:'#22c55e' };
  const colors = hosts.map(h => TIER_COLORS[h.tier] || '#64748b');
  lh.chart = new Chart(document.getElementById('lhChart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: hosts.map(h=>h.host),
      datasets: [{
        label:'Avg LES', data:hosts.map(h=>h.avgLes),
        backgroundColor:colors.map(c=>c+'BB'), borderColor:colors, borderWidth:1, borderRadius:6,
      }],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend:{display:false},
        tooltip:{
          backgroundColor:'#1e293b', borderColor:'#334155', borderWidth:1,
          titleColor:'#f1f5f9', bodyColor:'#94a3b8',
          callbacks:{
            title: items => {
              const h = hosts[items[0].dataIndex];
              return `${h.host} · ${h.tier}`;
            },
            label: ctx => ` Avg LES: ${ctx.parsed.y}`,
            afterBody: items => {
              const h = hosts[items[0].dataIndex];
              return [` Sessions: ${h.sessions}`, ` Total Hours: ${h.totalHours}h`, ` Total Revenue: RM${h.totalRevenue.toLocaleString('en-MY',{minimumFractionDigits:2})}`];
            },
          },
        },
      },
      scales:{
        x:{ticks:{color:'#94a3b8',font:{size:11}},grid:{color:'#1e293b'}},
        y:{beginAtZero:true,ticks:{color:'#64748b'},grid:{color:'#273549'}},
      },
    },
  });

  // Table
  const tbody = document.getElementById('lhTableBody');
  tbody.innerHTML = '';
  hosts.forEach(h => {
    const tierColor = { Legendary:'#f59e0b', Master:'#6366f1', Amateur:'#22c55e' }[h.tier] || '#64748b';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:700">${h.host}</td>
      <td><span style="color:${tierColor};font-weight:600;font-size:.78rem">${h.tier}</span></td>
      <td>${h.sessions}</td>
      <td style="text-align:right">${h.totalHours}h</td>
      <td style="text-align:right">RM ${h.totalRevenue.toLocaleString('en-MY',{minimumFractionDigits:2})}</td>
      <td style="text-align:right;font-weight:700;color:#f1f5f9">${h.avgLes || '—'}</td>`;
    tbody.appendChild(tr);
  });
}

// ═══════════════════════════════════════════════════════════════
// TIKTOK
// ═══════════════════════════════════════════════════════════════
const tt = { data:null, chart:null, loaded:false, currentTab:null };

async function loadTikTok(tab) {
  const url = '/api/tiktok' + (tab ? '?tab='+encodeURIComponent(tab) : '');
  document.getElementById('ttLoading').style.display = 'flex';
  document.getElementById('ttError').style.display   = 'none';
  document.getElementById('ttContent').style.display = 'none';
  try {
    const res  = await fetch(url, { credentials:'same-origin' });
    if (res.status===401) { window.location.href='/login.html'; return; }
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.detail || json.error);
    tt.data = json; tt.currentTab = json.tab;
    // Populate dropdown
    const sel = document.getElementById('ttMonthSelect');
    if (json.availTabs && json.availTabs.length) {
      sel.innerHTML = json.availTabs.map(t=>
        `<option value="${t}" ${t===json.tab?'selected':''}>${t}</option>`
      ).join('');
    }
    document.getElementById('ttLoading').style.display = 'none';
    document.getElementById('ttContent').style.display = 'block';
    renderTikTok();
  } catch(err) {
    console.error(err);
    document.getElementById('ttLoading').style.display = 'none';
    document.getElementById('ttError').style.display   = 'flex';
    document.getElementById('ttErrorMsg').textContent  = err.message;
  }
}

function renderTikTok() {
  const { totalRevenue, totalProfit, daily, tab } = tt.data;
  const fmtRM = v => 'RM ' + v.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
  const margin = totalRevenue > 0 ? ((totalProfit/totalRevenue)*100).toFixed(1)+'%' : '—';
  const roasDays = daily.filter(d=>d.roas>0);
  const avgRoas  = roasDays.length ? (roasDays.reduce((a,d)=>a+d.roas,0)/roasDays.length).toFixed(2)+'x' : '—';

  document.getElementById('ttStatRevenue').textContent   = fmtRM(totalRevenue);
  document.getElementById('ttStatProfit').textContent    = fmtRM(totalProfit);
  document.getElementById('ttStatMargin').textContent    = margin;
  document.getElementById('ttStatRoas').textContent      = avgRoas;
  document.getElementById('ttChartBadge').textContent    = tab;

  if (tt.chart) tt.chart.destroy();
  const activeDays = daily.filter(d=>d.sales>0);
  const labels = activeDays.map(d=>{ const p=d.date.split('/'); return `${p[0]}/${p[1]}`; });

  tt.chart = new Chart(document.getElementById('ttChart').getContext('2d'), {
    type:'line',
    data:{
      labels,
      datasets:[
        {label:'TikTok Sales',data:activeDays.map(d=>d.sales),borderColor:'#22c55e',backgroundColor:'rgba(34,197,94,.1)',borderWidth:2,pointRadius:2,tension:0.3,fill:true},
        {label:'Profit',      data:activeDays.map(d=>d.profit),borderColor:'#6366f1',backgroundColor:'transparent',borderWidth:2,pointRadius:2,tension:0.3},
        {label:'Ads Cost',    data:activeDays.map(d=>d.adsCost),borderColor:'#ef4444',backgroundColor:'transparent',borderWidth:1.5,borderDash:[4,3],pointRadius:0,tension:0.3},
      ],
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{position:'bottom',labels:{color:'#94a3b8',font:{size:11},padding:16}},
        tooltip:{backgroundColor:'#1e293b',borderColor:'#334155',borderWidth:1,
          titleColor:'#f1f5f9',bodyColor:'#94a3b8',
          callbacks:{label:c=>` ${c.dataset.label}: RM${c.parsed.y.toLocaleString('en-MY',{minimumFractionDigits:2})}`}},
      },
      scales:{
        x:{ticks:{color:'#64748b',font:{size:10},maxRotation:45},grid:{color:'#1e293b'}},
        y:{beginAtZero:true,ticks:{color:'#64748b',callback:v=>'RM'+v.toLocaleString()},grid:{color:'#273549'}},
      },
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// SINGAPORE
// ═══════════════════════════════════════════════════════════════
const sg = { data:null, chart:null, loaded:false, currentTab:null };

async function loadSingapore(tab) {
  const url = '/api/singapore' + (tab ? '?tab='+encodeURIComponent(tab) : '');
  document.getElementById('sgLoading').style.display = 'flex';
  document.getElementById('sgError').style.display   = 'none';
  document.getElementById('sgContent').style.display = 'none';
  try {
    const res  = await fetch(url, { credentials:'same-origin' });
    if (res.status===401) { window.location.href='/login.html'; return; }
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.detail || json.error);
    sg.data = json; sg.currentTab = json.tab;
    const sel = document.getElementById('sgMonthSelect');
    if (json.availTabs && json.availTabs.length) {
      sel.innerHTML = json.availTabs.map(t=>
        `<option value="${t}" ${t===json.tab?'selected':''}>${t}</option>`
      ).join('');
    }
    document.getElementById('sgLoading').style.display = 'none';
    document.getElementById('sgContent').style.display = 'block';
    renderSingapore();
  } catch(err) {
    console.error(err);
    document.getElementById('sgLoading').style.display = 'none';
    document.getElementById('sgError').style.display   = 'flex';
    document.getElementById('sgErrorMsg').textContent  = err.message;
  }
}

function renderSingapore() {
  const { totalRevenueSGD, totalRevenueRM, totalProfit, daily, tab } = sg.data;
  const fmtSGD = v => '$' + v.toLocaleString('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtRM  = v => 'RM ' + v.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
  const margin = totalRevenueSGD > 0 ? ((totalProfit/totalRevenueSGD)*100).toFixed(1)+'%' : '—';
  const roasDays = daily.filter(d=>d.roas>0);
  const avgRoas  = roasDays.length ? (roasDays.reduce((a,d)=>a+d.roas,0)/roasDays.length).toFixed(2)+'x' : '—';

  document.getElementById('sgStatSGD').textContent    = fmtSGD(totalRevenueSGD);
  document.getElementById('sgStatRM').textContent     = `≈ ${fmtRM(totalRevenueRM)}`;
  document.getElementById('sgStatProfit').textContent = fmtSGD(totalProfit);
  document.getElementById('sgStatMargin').textContent = margin;
  document.getElementById('sgStatRoas').textContent   = avgRoas;
  document.getElementById('sgChartBadge').textContent = tab;

  if (sg.chart) sg.chart.destroy();
  const activeDays = daily.filter(d=>d.totalSales>0);
  const labels = activeDays.map(d=>{ const p=d.date.split('/'); return `${p[0]}/${p[1]}`; });

  sg.chart = new Chart(document.getElementById('sgChart').getContext('2d'), {
    type:'line',
    data:{
      labels,
      datasets:[
        {label:'Total Sales (SGD)',data:activeDays.map(d=>d.totalSales),borderColor:'#22c55e',backgroundColor:'rgba(34,197,94,.1)',borderWidth:2,pointRadius:2,tension:0.3,fill:true},
        {label:'Website SG',      data:activeDays.map(d=>d.websiteSG), borderColor:'#6366f1',backgroundColor:'transparent',borderWidth:1.5,pointRadius:2,tension:0.3},
        {label:'Shopee SG',       data:activeDays.map(d=>d.shopeeSG),  borderColor:'#f59e0b',backgroundColor:'transparent',borderWidth:1.5,pointRadius:2,tension:0.3},
      ],
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{position:'bottom',labels:{color:'#94a3b8',font:{size:11},padding:16}},
        tooltip:{backgroundColor:'#1e293b',borderColor:'#334155',borderWidth:1,
          titleColor:'#f1f5f9',bodyColor:'#94a3b8',
          callbacks:{label:c=>` ${c.dataset.label}: $${c.parsed.y.toLocaleString('en-SG',{minimumFractionDigits:2})}`}},
      },
      scales:{
        x:{ticks:{color:'#64748b',font:{size:10},maxRotation:45},grid:{color:'#1e293b'}},
        y:{beginAtZero:true,ticks:{color:'#64748b',callback:v=>'$'+v.toLocaleString()},grid:{color:'#273549'}},
      },
    },
  });
}
