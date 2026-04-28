// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
const state = {
  currentTab:     'MY',
  allData:        [],
  rangeStart:     { monthIdx:0, day:1 },
  rangeEnd:       { monthIdx:0, day:1 },
  hiddenProducts: new Set(),
  chartInstance:  null,
  compareChart:   null,
  compareMonths:  new Set(),
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

// ═══════════════════════════════════════════════════════════════
// CALENDAR
// ═══════════════════════════════════════════════════════════════
const cal = {
  open:      false,
  viewIdx:   0,
  phase:    'start',  // 'start' | 'end'
  tempStart: null,
  tempEnd:   null,
};

// ── Open / Close ───────────────────────────────────────────────
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
  popup.style.left = Math.min(rect.left, window.innerWidth - 290) + 'px';
  popup.style.display = 'block';

  buildCal();
}

function closeCal() {
  cal.open = false;
  const p = document.getElementById('calPopup');
  if (p) p.style.display = 'none';
}

// ── Outside-click using COORDINATES (not DOM node) ─────────────
// This is the key fix: innerHTML rebuild destroys the clicked node
// so popup.contains(e.target) always returns false after rebuild.
document.addEventListener('click', function(e) {
  if (!cal.open) return;

  // Ignore clicks on the trigger itself
  const trigger = document.getElementById('dateRangeTrigger');
  if (trigger && trigger.contains(e.target)) return;

  // Use bounding rect so a rebuilt innerHTML doesn't fool us
  const popup = document.getElementById('calPopup');
  if (!popup) return;
  const r = popup.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right &&
                 e.clientY >= r.top  && e.clientY <= r.bottom;
  if (!inside) closeCal();
});

// ── Build calendar HTML ────────────────────────────────────────
function buildCal() {
  const popup = document.getElementById('calPopup');
  const md    = state.allData[cal.viewIdx];
  if (!md || !popup) return;

  const max     = md.dates.length;
  const isFirst = cal.viewIdx === 0;
  const isLast  = cal.viewIdx === state.allData.length - 1;

  // First day-of-week of this month
  let dow = 0, yearStr = '';
  try {
    const p = md.dates[0].split('/');
    yearStr = p[2] || '';
    if (+p[2] > 2000) dow = new Date(+p[2], +p[1]-1, 1).getDay();
  } catch(e) {}

  // Day cells
  let grid = '';
  for (let i = 0; i < dow; i++) grid += '<div class="cal-cell cal-empty"></div>';
  for (let d = 1; d <= max; d++) {
    const cls = getDayCls(d, cal.viewIdx);
    grid += `<div class="cal-cell ${cls}" onclick="calDay(${d})">${d}</div>`;
  }

  // Status + Apply button
  const ts = cal.tempStart, te = cal.tempEnd;
  let statusHtml = '<span class="cal-status">① Click a start date</span>';
  let applyBtn   = '';

  if (ts && cal.phase === 'end' && !te) {
    const tsName = (state.allData[ts.monthIdx]?.monthName||'').slice(0,3);
    statusHtml = `<span class="cal-status">${tsName} ${ts.day} &rarr; ② Click end date</span>`;
  } else if (ts && te) {
    const [lo, hi] = normaliseRange(ts, te);
    const loName   = (state.allData[lo.monthIdx]?.monthName||'').slice(0,3);
    const hiName   = (state.allData[hi.monthIdx]?.monthName||'').slice(0,3);
    const sameDay  = lo.monthIdx===hi.monthIdx && lo.day===hi.day;
    const label    = sameDay
      ? `${loName} ${lo.day}`
      : lo.monthIdx===hi.monthIdx
        ? `${loName} ${lo.day} – ${hi.day}`
        : `${loName} ${lo.day} – ${hiName} ${hi.day}`;
    statusHtml = `<span class="cal-status cal-status--ready">${label}</span>`;
    applyBtn   = `<button class="cal-apply-btn" onclick="applyCalendar()">Apply</button>`;
  }

  popup.innerHTML = `
    <div class="cal-head">
      <button class="cal-nav" onclick="calNav(-1)" ${isFirst?'disabled':''}>&#8249;</button>
      <span class="cal-title">${md.monthName} ${yearStr}</span>
      <button class="cal-nav" onclick="calNav(1)"  ${isLast?'disabled':''}>&#8250;</button>
    </div>
    <div class="cal-presets">
      <button onclick="calPreset('full',${max})">Full Month</button>
      <button onclick="calPreset('last7',${max})">Last 7 Days</button>
      <button onclick="calPreset('last14',${max})">Last 14 Days</button>
      <button onclick="calPreset('first7',${max})">First 7 Days</button>
      <button onclick="calPreset('first14',${max})">First 14 Days</button>
    </div>
    <div class="cal-dow">
      <span>Su</span><span>Mo</span><span>Tu</span><span>We</span>
      <span>Th</span><span>Fr</span><span>Sa</span>
    </div>
    <div class="cal-grid">${grid}</div>
    <div class="cal-foot">
      ${statusHtml}
      ${applyBtn}
    </div>`;
}

function getDayCls(day, viewIdx) {
  const ts = cal.tempStart, te = cal.tempEnd;
  if (!ts) return '';
  const key  = rkey(viewIdx, day);
  const sKey = rkey(ts.monthIdx, ts.day);
  const eKey = te ? rkey(te.monthIdx, te.day) : sKey;
  const lo = Math.min(sKey, eKey), hi = Math.max(sKey, eKey);
  if (key === lo || key === hi) return 'cal-sel';
  if (key > lo && key < hi)    return 'cal-range';
  return '';
}

// ── Navigation ─────────────────────────────────────────────────
function calNav(dir) {
  const ni = cal.viewIdx + dir;
  if (ni < 0 || ni >= state.allData.length) return;
  cal.viewIdx = ni;
  buildCal();
}

// ── Day click — two-click selection, then Apply ────────────────
function calDay(day) {
  if (cal.phase === 'start') {
    // First click: set start, clear end
    cal.tempStart = { monthIdx: cal.viewIdx, day };
    cal.tempEnd   = null;
    cal.phase     = 'end';
  } else {
    // Second click: set end
    cal.tempEnd = { monthIdx: cal.viewIdx, day };
    cal.phase   = 'start';
    // Allow single-day: if same coords just keep as-is
  }
  buildCal();
}

// ── Presets — auto-apply immediately ──────────────────────────
function calPreset(type, max) {
  const mi = cal.viewIdx;
  switch(type) {
    case 'full':    cal.tempStart={monthIdx:mi,day:1};              cal.tempEnd={monthIdx:mi,day:max};            break;
    case 'last7':   cal.tempStart={monthIdx:mi,day:Math.max(1,max-6)};  cal.tempEnd={monthIdx:mi,day:max};       break;
    case 'last14':  cal.tempStart={monthIdx:mi,day:Math.max(1,max-13)}; cal.tempEnd={monthIdx:mi,day:max};       break;
    case 'first7':  cal.tempStart={monthIdx:mi,day:1};              cal.tempEnd={monthIdx:mi,day:Math.min(7,max)};  break;
    case 'first14': cal.tempStart={monthIdx:mi,day:1};              cal.tempEnd={monthIdx:mi,day:Math.min(14,max)}; break;
  }
  cal.phase = 'start';
  applyCalendar(); // presets apply immediately
}

// ── Apply ──────────────────────────────────────────────────────
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
  const sm = (state.allData[rs.monthIdx]?.monthName||'').slice(0,3);
  const em = (state.allData[re.monthIdx]?.monthName||'').slice(0,3);
  if (rs.monthIdx===re.monthIdx && rs.day===re.day) {
    el.textContent = `${sm} ${rs.day}`;
  } else if (rs.monthIdx===re.monthIdx) {
    el.textContent = `${sm} ${rs.day} – ${re.day}`;
  } else {
    el.textContent = `${sm} ${rs.day} – ${em} ${re.day}`;
  }
}

// ── Default: current month, day 1 → yesterday ─────────────────
function setDefaultRange() {
  const today = new Date();
  const yest  = new Date(today); yest.setDate(today.getDate() - 1);
  const yDay  = yest.getDate();
  const yMon  = MONTH_NAMES[yest.getMonth()];

  let mi = state.allData.findIndex(m => m.monthName === yMon);
  if (mi < 0) mi = state.allData.length - 1;

  const md  = state.allData[mi];
  const day = md ? Math.min(yDay, md.dates.length) : 1;

  state.rangeStart = { monthIdx: mi, day: 1   };
  state.rangeEnd   = { monthIdx: mi, day: day  };
  updateTriggerLabel();
}

// ═══════════════════════════════════════════════════════════════
// CROSS-MONTH SLICE
// ═══════════════════════════════════════════════════════════════
function getCrossMonthSlice() {
  const rs = state.rangeStart, re = state.rangeEnd;
  if (!state.allData.length) return { dates:[], products:[], grandTotal:{avgROAS:0,dailyROAS:[]} };

  let allDates = [], gtDaily = [];
  const productMap = {};

  for (let mi = rs.monthIdx; mi <= re.monthIdx; mi++) {
    const md = state.allData[mi];
    if (!md) continue;
    const from = (mi === rs.monthIdx) ? rs.day - 1 : 0;
    const to   = (mi === re.monthIdx) ? re.day     : md.dates.length;

    allDates = allDates.concat(md.dates.slice(from, to));
    gtDaily  = gtDaily.concat(md.grandTotal.dailyROAS.slice(from, to));

    md.products.forEach(p => {
      if (!productMap[p.name]) productMap[p.name] = { name:p.name, dailyROAS:[] };
      productMap[p.name].dailyROAS = productMap[p.name].dailyROAS.concat(
        p.dailyROAS.slice(from, to)
      );
    });
  }

  const products = Object.values(productMap).map(p => {
    const valid = p.dailyROAS.filter(v => v!==null && v>0);
    return { ...p, avgROAS: valid.length ? valid.reduce((a,b)=>a+b,0)/valid.length : 0 };
  });

  const gtV = gtDaily.filter(v => v!==null && v>0);
  return {
    dates: allDates,
    products,
    grandTotal: {
      avgROAS:   gtV.length ? gtV.reduce((a,b)=>a+b,0)/gtV.length : 0,
      dailyROAS: gtDaily,
    },
  };
}

function getFullMonthSlice(md) {
  const products = md.products.map(p => {
    const valid = p.dailyROAS.filter(v=>v!==null&&v>0);
    return { ...p, avgROAS: valid.length ? valid.reduce((a,b)=>a+b,0)/valid.length : 0 };
  });
  const gtV = md.grandTotal.dailyROAS.filter(v=>v!==null&&v>0);
  return {
    dates: md.dates, products,
    grandTotal: { avgROAS: gtV.length?gtV.reduce((a,b)=>a+b,0)/gtV.length:0, dailyROAS:md.grandTotal.dailyROAS },
  };
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.platform-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.platform-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      state.currentTab = btn.dataset.tab;
      state.hiddenProducts.clear();
      loadData();
    });
  });

  document.getElementById('dateRangeTrigger').addEventListener('click', openCalendar);

  document.getElementById('toggleAll').addEventListener('change', e => {
    const allNames = new Set(state.allData.flatMap(m=>m.products.map(p=>p.name)));
    if (e.target.checked) state.hiddenProducts.clear();
    else allNames.forEach(n=>state.hiddenProducts.add(n));
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
    const res  = await fetch(`/api/roas?tab=${state.currentTab}`, { credentials:'same-origin' });
    if (res.status===401) { window.location.href='/login.html'; return; }
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.detail||json.error||'Unknown');

    state.allData = json.data;

    const now = new Date();
    document.getElementById('lastUpdated').textContent =
      now.toLocaleDateString('en-MY',{day:'2-digit',month:'short'}) + ' ' +
      now.toLocaleTimeString('en-MY',{hour:'2-digit',minute:'2-digit'});

    if (!state.allData[state.rangeStart.monthIdx]) setDefaultRange();
    else updateTriggerLabel();

    if (state.compareMonths.size===0) {
      json.data.forEach(m=>state.compareMonths.add(m.monthName));
    }

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
// RENDER
// ═══════════════════════════════════════════════════════════════
function renderDashboard() {
  const slice = getCrossMonthSlice();
  const allProducts = state.allData.flatMap(m=>m.products)
    .filter((p,i,a)=>a.findIndex(x=>x.name===p.name)===i);
  renderToggles(slice.products, allProducts);
  renderStats(slice);
  renderChart(slice, allProducts);
  renderTable(slice.products);
  renderRanks(slice.products);
}

function syncAllCheckbox() {
  const allNames = new Set(state.allData.flatMap(m=>m.products.map(p=>p.name)));
  const cb = document.getElementById('toggleAll');
  const allOn  = [...allNames].every(n=>!state.hiddenProducts.has(n));
  const allOff = [...allNames].every(n=> state.hiddenProducts.has(n));
  cb.checked = allOn; cb.indeterminate = !allOn && !allOff;
}

function renderToggles(products, allProducts) {
  const c = document.getElementById('productToggles'); c.innerHTML='';
  products.forEach(p => {
    const idx   = allProducts.findIndex(ap=>ap.name===p.name);
    const color = CHART_COLORS[idx>=0?idx%CHART_COLORS.length:0];
    const hidden = state.hiddenProducts.has(p.name);
    const label = document.createElement('label');
    label.className = 'toggle-item'+(hidden?'':' active');
    label.innerHTML = `<input type="checkbox" ${hidden?'':'checked'}/>
      <span class="toggle-dot" style="background:${color}"></span>${p.name}`;
    label.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) { state.hiddenProducts.delete(p.name); label.classList.add('active'); }
      else                  { state.hiddenProducts.add(p.name);    label.classList.remove('active'); }
      renderChart(getCrossMonthSlice(), allProducts);
      syncAllCheckbox();
    });
    c.appendChild(label);
  });
  syncAllCheckbox();
}

function renderStats(slice) {
  const { products, grandTotal, dates } = slice;
  document.getElementById('statAvg').textContent    = fmt(grandTotal.avgROAS);
  document.getElementById('statAvgSub').textContent = 'Grand total avg';
  const sorted = [...products].sort((a,b)=>b.avgROAS-a.avgROAS);
  const top=sorted[0], worst=sorted[sorted.length-1];
  document.getElementById('statTop').textContent    = top   ? top.name   : '—';
  document.getElementById('statTopSub').textContent = top   ? `ROAS: ${fmt(top.avgROAS)}` : '';
  document.getElementById('statLow').textContent    = worst ? worst.name : '—';
  document.getElementById('statLowSub').textContent = worst ? `ROAS: ${fmt(worst.avgROAS)}` : '';
  const active = grandTotal.dailyROAS.filter(v=>v!==null&&v>0).length;
  document.getElementById('statDays').textContent    = active;
  document.getElementById('statDaysSub').textContent = `of ${dates.length} days`;
}

function renderChart(slice, allProducts) {
  if (state.chartInstance) state.chartInstance.destroy();
  const { dates, products, grandTotal } = slice;
  const ctx     = document.getElementById('roasChart').getContext('2d');
  const visible = products.filter(p=>!state.hiddenProducts.has(p.name));
  const labels  = dates.map(d=>{ const p=d.split('/'); return p.length>=2?`${p[0]}/${p[1]}`:d; });

  const datasets = visible.map(p => {
    const idx = (allProducts||products).findIndex(ap=>ap.name===p.name);
    return {
      label:p.name,
      data:p.dailyROAS.map(v=>v===null?null:v),
      borderColor:CHART_COLORS[idx>=0?idx%CHART_COLORS.length:0],
      backgroundColor:'transparent',
      borderWidth:2,pointRadius:2,pointHoverRadius:5,tension:0.3,spanGaps:false,
    };
  });
  datasets.push({label:'Grand Total',data:grandTotal.dailyROAS.map(v=>v===null?null:v),
    borderColor:'#f1f5f9',backgroundColor:'transparent',
    borderWidth:2.5,borderDash:[6,3],pointRadius:0,tension:0.3,spanGaps:false});
  datasets.push(
    {label:'— Good (3.0)',      data:Array(labels.length).fill(3),borderColor:'rgba(34,197,94,.45)',  borderWidth:1,borderDash:[4,4],pointRadius:0,tension:0,backgroundColor:'transparent'},
    {label:'— Excellent (5.0)',data:Array(labels.length).fill(5),borderColor:'rgba(168,85,247,.45)',borderWidth:1,borderDash:[4,4],pointRadius:0,tension:0,backgroundColor:'transparent'}
  );

  document.getElementById('chartBadge').textContent =
    document.getElementById('dateRangeLabel').textContent + ' · ' +
    (state.currentTab==='MY'?'MY Website':state.currentTab==='SG'?'SG Website':'Marketplace');

  state.chartInstance = new Chart(ctx,{type:'line',data:{labels,datasets},options:{
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

function renderTable(products) {
  const tbody=document.getElementById('perfTableBody'); tbody.innerHTML='';
  products.forEach(p=>{
    const {label,cls}=roasRating(p.avgROAS);
    const tr=document.createElement('tr');
    tr.innerHTML=`<td style="font-weight:600">${p.name}</td>
      <td><span style="font-size:1rem;font-weight:700;color:#f1f5f9">${fmt(p.avgROAS)}</span></td>
      <td><span class="roas-badge ${cls}">${label}</span></td>`;
    tbody.appendChild(tr);
  });
}

function renderRanks(products) {
  const s=[...products].sort((a,b)=>b.avgROAS-a.avgROAS);
  renderRankList('top5List',   s.slice(0,5));
  renderRankList('worst5List', s.slice(-5).reverse());
}
function renderRankList(id, items) {
  const ul=document.getElementById(id); ul.innerHTML='';
  items.forEach((p,i)=>{
    const {cls}=roasRating(p.avgROAS);
    const li=document.createElement('li'); li.className='rank-item';
    li.innerHTML=`<span class="rank-num">${i+1}</span>
      <span class="rank-name">${p.name}</span>
      <span class="roas-badge ${cls}" style="font-size:.76rem">${fmt(p.avgROAS)}</span>`;
    ul.appendChild(li);
  });
}

// ═══════════════════════════════════════════════════════════════
// COMPARE
// ═══════════════════════════════════════════════════════════════
function renderCompare() {
  const selected  = [...state.compareMonths];
  const noData    = document.getElementById('compareNoData');
  const chartWrap = document.getElementById('compareChartWrap');
  const tableWrap = document.getElementById('compareTableWrap');

  buildComparePicker();

  if (selected.length < 2) {
    noData.style.display='flex'; chartWrap.style.display='none'; tableWrap.style.display='none';
    document.getElementById('compareNoMsg').textContent =
      selected.length===0 ? 'Select at least 2 months.' : 'Select one more month.';
    return;
  }
  noData.style.display='none'; chartWrap.style.display='block'; tableWrap.style.display='block';

  const monthsData = selected.map(name=>{
    const md  = state.allData.find(m=>m.monthName===name);
    const idx = state.allData.indexOf(md);
    return md ? { name, color:MONTH_COLORS[idx%MONTH_COLORS.length], slice:getFullMonthSlice(md) } : null;
  }).filter(Boolean);

  const allNames = [...new Set(monthsData.flatMap(m=>m.slice.products.map(p=>p.name)))];

  if (state.compareChart) state.compareChart.destroy();
  const ctx = document.getElementById('compareChart').getContext('2d');
  state.compareChart = new Chart(ctx,{type:'bar',
    data:{
      labels:allNames,
      datasets:monthsData.map(md=>({
        label:md.name,
        data:allNames.map(n=>{ const p=md.slice.products.find(p=>p.name===n); return p?+p.avgROAS.toFixed(2):0; }),
        backgroundColor:md.color+'BB',borderColor:md.color,borderWidth:1,borderRadius:4,
      })),
    },
    options:{
      responsive:true,maintainAspectRatio:false,
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
    const vals=monthsData.map(m=>{ const p=m.slice.products.find(p=>p.name===name); return p?p.avgROAS:null; });
    const maxV=Math.max(...vals.filter(v=>v!==null));
    const bi  =vals.indexOf(maxV);
    const cells=vals.map((v)=>{
      const {cls}=v!==null?roasRating(v):{cls:''};
      return `<td class="${v===maxV&&v>0?'compare-best':''}"><span class="roas-badge ${cls}">${v!==null?fmt(v):'—'}</span></td>`;
    }).join('');
    tbody.innerHTML+=`<tr><td style="font-weight:600">${name}</td>${cells}<td><span style="color:${monthsData[bi]?.color};font-weight:700">${maxV>0?(monthsData[bi]?.name||'—'):'—'}</span></td></tr>`;
  });
  const gtV=monthsData.map(m=>m.slice.grandTotal.avgROAS);
  const gtMax=Math.max(...gtV), gtBi=gtV.indexOf(gtMax);
  tbody.innerHTML+=`<tr class="compare-gt"><td style="font-weight:700">Grand Total</td>${gtV.map((v,i)=>`<td class="${v===gtMax?'compare-best':''}"><strong style="color:#f1f5f9">${fmt(v)}</strong></td>`).join('')}<td><span style="color:${monthsData[gtBi]?.color};font-weight:700">${monthsData[gtBi]?.name||'—'}</span></td></tr>`;
}

function buildComparePicker() {
  const c = document.getElementById('compareMonthPicker');
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
      if (e.target.checked) { state.compareMonths.add(m.monthName);    label.classList.add('active'); }
      else                  { state.compareMonths.delete(m.monthName); label.classList.remove('active'); }
      renderCompare();
    });
    c.appendChild(label);
  });
}

function fmt(n) {
  if (n===null||n===undefined||isNaN(n)) return '—';
  return Number(n).toFixed(2)+'x';
}
