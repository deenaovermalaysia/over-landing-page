// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
const state = {
  currentTab:     'MY',
  currentMonth:   null,
  allData:        [],
  hiddenProducts: new Set(),
  chartInstance:  null,
  compareChart:   null,
  compareMonths:  new Set(),
  dateFrom:       1,
  dateTo:         31,
};

const CHART_COLORS = [
  '#6366f1','#22c55e','#f59e0b','#ef4444','#a855f7',
  '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6','#8b5cf6','#64748b',
];
const MONTH_COLORS = ['#6366f1','#22c55e','#f59e0b','#ef4444','#a855f7','#06b6d4'];

function roasRating(v) {
  if (v >= 5) return { label:'Excellent', cls:'roas-excellent' };
  if (v >= 3) return { label:'Good',      cls:'roas-good'      };
  return           { label:'Poor',       cls:'roas-poor'      };
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR
// ═══════════════════════════════════════════════════════════════
const cal = { monthIdx:0, phase:'start', start:null, end:null };

function openCalendar() {
  cal.monthIdx = Math.max(0, state.allData.findIndex(m => m.monthName === state.currentMonth));
  cal.start = state.dateFrom;
  cal.end   = state.dateTo;
  cal.phase = 'start';

  const trigger = document.getElementById('dateRangeTrigger');
  const rect    = trigger.getBoundingClientRect();
  const popup   = document.getElementById('calPopup');
  popup.style.top  = (rect.bottom + 6) + 'px';
  popup.style.left = Math.min(rect.left, window.innerWidth - 285) + 'px';
  popup.style.display = 'block';

  buildCal();
  setTimeout(() => document.addEventListener('click', outsideCal), 10);
}

function outsideCal(e) {
  const popup   = document.getElementById('calPopup');
  const trigger = document.getElementById('dateRangeTrigger');
  if (popup && !popup.contains(e.target) && !trigger.contains(e.target)) closeCal();
}

function closeCal() {
  document.getElementById('calPopup').style.display = 'none';
  document.removeEventListener('click', outsideCal);
}

function buildCal() {
  const md = state.allData[cal.monthIdx];
  if (!md) return;
  const max = md.dates.length;
  const isFirst = cal.monthIdx === 0;
  const isLast  = cal.monthIdx === state.allData.length - 1;

  // Get weekday of 1st of month
  let dow = 0, yearStr = '';
  try {
    const p = md.dates[0].split('/');
    yearStr = p[2] || '';
    if (+p[2] > 2000) dow = new Date(+p[2], +p[1]-1, 1).getDay();
  } catch(e){}

  // Day grid
  let grid = '';
  for (let i = 0; i < dow; i++) grid += '<div class="cal-cell cal-empty"></div>';
  for (let d = 1; d <= max; d++) {
    const s = cal.start, e = cal.end;
    const lo = s && e ? Math.min(s,e) : s;
    const hi = s && e ? Math.max(s,e) : s;
    const isSel  = d === lo || d === hi;
    const inRange = lo && hi && d > lo && d < hi;
    grid += `<div class="cal-cell${isSel?' cal-sel':''}${inRange?' cal-range':''}" onclick="calDay(${d},${max})">${d}</div>`;
  }

  const selLabel = !cal.start ? '① Pick start day'
    : !cal.end ? `Day ${cal.start} &nbsp;→&nbsp; ② Pick end day`
    : `Day ${Math.min(cal.start,cal.end)} – Day ${Math.max(cal.start,cal.end)}`;

  document.getElementById('calPopup').innerHTML = `
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
    <div class="cal-dow"><span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span></div>
    <div class="cal-grid">${grid}</div>
    <div class="cal-foot"><span class="cal-sel-label">${selLabel}</span></div>`;
}

function calNav(dir) {
  const ni = cal.monthIdx + dir;
  if (ni < 0 || ni >= state.allData.length) return;
  cal.monthIdx = ni; cal.start = null; cal.end = null; cal.phase = 'start';
  buildCal();
}

function calDay(day, max) {
  if (cal.phase === 'start') {
    cal.start = day; cal.end = null; cal.phase = 'end';
    buildCal();
  } else {
    cal.end = day;
    if (cal.end < cal.start) { let t=cal.start; cal.start=cal.end; cal.end=t; }
    cal.phase = 'start';
    applyCalendar();
  }
}

function calPreset(type, max) {
  switch(type) {
    case 'full':    cal.start=1;                     cal.end=max;           break;
    case 'last7':   cal.start=Math.max(1,max-6);     cal.end=max;           break;
    case 'last14':  cal.start=Math.max(1,max-13);    cal.end=max;           break;
    case 'first7':  cal.start=1;                     cal.end=Math.min(7,max);  break;
    case 'first14': cal.start=1;                     cal.end=Math.min(14,max); break;
  }
  cal.phase='start'; applyCalendar();
}

function applyCalendar() {
  const md = state.allData[cal.monthIdx];
  if (md) state.currentMonth = md.monthName;
  state.dateFrom = Math.min(cal.start, cal.end);
  state.dateTo   = Math.max(cal.start, cal.end);
  updateTriggerLabel();
  closeCal();
  renderDashboard();
  renderCompare();
}

function updateTriggerLabel() {
  const el = document.getElementById('dateRangeLabel');
  if (!el) return;
  const m = (state.currentMonth || '').slice(0,3);
  el.textContent = state.dateFrom === state.dateTo
    ? `${m} · Day ${state.dateFrom}`
    : `${m} · Day ${state.dateFrom} – ${state.dateTo}`;
}

function resetDateRange() {
  const md = state.allData.find(m => m.monthName === state.currentMonth);
  const max = md ? md.dates.length : 31;
  state.dateFrom = 1; state.dateTo = max;
  updateTriggerLabel();
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Platform
  document.querySelectorAll('.platform-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.platform-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentTab = btn.dataset.tab;
      state.hiddenProducts.clear();
      loadData();
    });
  });

  // Calendar trigger — single click to open
  document.getElementById('dateRangeTrigger').addEventListener('click', openCalendar);

  // All-products checkbox
  document.getElementById('toggleAll').addEventListener('change', e => {
    const md = state.allData.find(m => m.monthName === state.currentMonth);
    if (!md) return;
    if (e.target.checked) state.hiddenProducts.clear();
    else md.products.forEach(p => state.hiddenProducts.add(p.name));
    renderDashboard();
    renderCompare();
  });

  // Auto-refresh every 5 min
  setInterval(() => loadData(true), 5 * 60 * 1000);

  loadData();
});

// ═══════════════════════════════════════════════════════════════
// FETCH DATA
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
    if (!res.ok || !json.success) throw new Error(json.detail||json.error||'Unknown error');

    state.allData = json.data;

    const now = new Date();
    document.getElementById('lastUpdated').textContent =
      now.toLocaleDateString('en-MY',{day:'2-digit',month:'short'}) + ' ' +
      now.toLocaleTimeString('en-MY',{hour:'2-digit',minute:'2-digit'});

    const prev = state.currentMonth;
    if (prev && json.data.find(m=>m.monthName===prev)) {
      state.currentMonth = prev;
    } else {
      state.currentMonth = json.data[0]?.monthName || null;
      resetDateRange();
    }
    updateTriggerLabel();

    // Pre-select all months for comparison
    if (state.compareMonths.size === 0) {
      json.data.forEach(m => state.compareMonths.add(m.monthName));
    }

    showState('content');
    renderDashboard();
    renderCompare();
  } catch(err) {
    console.error(err);
    if (!silent) { document.getElementById('errorMsg').textContent=err.message; showState('error'); }
  }
}

function showState(which) {
  document.getElementById('loadingState').style.display     = which==='loading'?'flex':'none';
  document.getElementById('errorState').style.display       = which==='error'  ?'flex':'none';
  document.getElementById('dashboardContent').style.display = which==='content'?'block':'none';
}

// ═══════════════════════════════════════════════════════════════
// SLICE BY DATE RANGE
// ═══════════════════════════════════════════════════════════════
function getSlice(monthData) {
  const from = state.dateFrom - 1;
  const to   = Math.min(state.dateTo, monthData.dates.length);
  const dates = monthData.dates.slice(from, to);

  const products = monthData.products.map(p => {
    const sliced = p.dailyROAS.slice(from, to);
    const valid  = sliced.filter(v => v!==null && v>0);
    const avg    = valid.length ? valid.reduce((a,b)=>a+b,0)/valid.length : 0;
    return {...p, dailyROAS:sliced, avgROAS:avg};
  });

  const gtS = monthData.grandTotal.dailyROAS.slice(from, to);
  const gtV = gtS.filter(v=>v!==null&&v>0);
  const grandTotal = {
    avgROAS:   gtV.length ? gtV.reduce((a,b)=>a+b,0)/gtV.length : 0,
    dailyROAS: gtS,
  };

  return { dates, products, grandTotal };
}

// ═══════════════════════════════════════════════════════════════
// RENDER DASHBOARD
// ═══════════════════════════════════════════════════════════════
function renderDashboard() {
  const md = state.allData.find(m=>m.monthName===state.currentMonth);
  if (!md) return;
  const slice = getSlice(md);
  renderToggles(slice.products, md.products);
  renderStats(slice);
  renderChart(slice, md.products);
  renderTable(slice.products);
  renderRanks(slice.products);
}

// ── All Checkbox sync ──────────────────────────────────────────
function syncAllCheckbox() {
  const md = state.allData.find(m=>m.monthName===state.currentMonth);
  if (!md) return;
  const cb = document.getElementById('toggleAll');
  const allOn  = md.products.every(p=>!state.hiddenProducts.has(p.name));
  const allOff = md.products.every(p=> state.hiddenProducts.has(p.name));
  cb.checked       = allOn;
  cb.indeterminate = !allOn && !allOff;
}

// ── Product Toggles ────────────────────────────────────────────
function renderToggles(products, allProducts) {
  const container = document.getElementById('productToggles');
  container.innerHTML = '';
  products.forEach(p => {
    const idx   = allProducts.findIndex(ap=>ap.name===p.name);
    const color = CHART_COLORS[idx>=0?idx%CHART_COLORS.length:0];
    const isHidden = state.hiddenProducts.has(p.name);
    const label = document.createElement('label');
    label.className = 'toggle-item' + (isHidden?'':' active');
    label.innerHTML = `
      <input type="checkbox" ${isHidden?'':'checked'} />
      <span class="toggle-dot" style="background:${color}"></span>
      ${p.name}`;
    label.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) { state.hiddenProducts.delete(p.name); label.classList.add('active'); }
      else                  { state.hiddenProducts.add(p.name);    label.classList.remove('active'); }
      const md2 = state.allData.find(m=>m.monthName===state.currentMonth);
      renderChart(getSlice(md2), md2.products);
      syncAllCheckbox();
    });
    container.appendChild(label);
  });
  syncAllCheckbox();
}

// ── Stat Cards ─────────────────────────────────────────────────
function renderStats(slice) {
  const { products, grandTotal, dates } = slice;
  document.getElementById('statAvg').textContent    = fmt(grandTotal.avgROAS);
  document.getElementById('statAvgSub').textContent = 'Grand total avg';
  const sorted = [...products].sort((a,b)=>b.avgROAS-a.avgROAS);
  const top=sorted[0], worst=sorted[sorted.length-1];
  document.getElementById('statTop').textContent    = top   ? top.name   : '—';
  document.getElementById('statTopSub').textContent = top   ? `ROAS: ${fmt(top.avgROAS)}`   : '';
  document.getElementById('statLow').textContent    = worst ? worst.name : '—';
  document.getElementById('statLowSub').textContent = worst ? `ROAS: ${fmt(worst.avgROAS)}` : '';
  const active = grandTotal.dailyROAS.filter(v=>v!==null&&v>0).length;
  document.getElementById('statDays').textContent    = active;
  document.getElementById('statDaysSub').textContent = `of ${dates.length} days shown`;
}

// ── Line Chart ─────────────────────────────────────────────────
function renderChart(slice, allProducts) {
  if (state.chartInstance) state.chartInstance.destroy();
  const {dates,products,grandTotal} = slice;
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
      borderWidth:2, pointRadius:2, pointHoverRadius:5, tension:0.3, spanGaps:false,
    };
  });

  datasets.push({label:'Grand Total',data:grandTotal.dailyROAS.map(v=>v===null?null:v),
    borderColor:'#f1f5f9',backgroundColor:'transparent',
    borderWidth:2.5,borderDash:[6,3],pointRadius:0,tension:0.3,spanGaps:false});
  datasets.push(
    {label:'— Good (3.0)',      data:Array(labels.length).fill(3),borderColor:'rgba(34,197,94,.45)',  borderWidth:1,borderDash:[4,4],pointRadius:0,tension:0,backgroundColor:'transparent'},
    {label:'— Excellent (5.0)',data:Array(labels.length).fill(5),borderColor:'rgba(168,85,247,.45)',borderWidth:1,borderDash:[4,4],pointRadius:0,tension:0,backgroundColor:'transparent'}
  );

  const rangeLabel = state.dateFrom===1&&state.dateTo>=dates.length
    ? state.currentMonth
    : `${state.currentMonth} Day ${state.dateFrom}–${state.dateTo}`;
  document.getElementById('chartBadge').textContent =
    `${rangeLabel} · ${state.currentTab==='MY'?'MY Website':state.currentTab==='SG'?'SG Website':'Marketplace'}`;

  state.chartInstance = new Chart(ctx,{type:'line',data:{labels,datasets},options:{
    responsive:true,maintainAspectRatio:false,
    interaction:{mode:'index',intersect:false},
    plugins:{
      legend:{position:'bottom',labels:{color:'#94a3b8',boxWidth:12,font:{size:11},padding:16}},
      tooltip:{backgroundColor:'#1e293b',borderColor:'#334155',borderWidth:1,
        titleColor:'#f1f5f9',bodyColor:'#94a3b8',
        callbacks:{label:ctx=>` ${ctx.dataset.label}: ${ctx.parsed.y!==null?fmt(ctx.parsed.y):'N/A'}`}},
    },
    scales:{
      x:{ticks:{color:'#64748b',font:{size:10},maxRotation:45},grid:{color:'#1e293b'}},
      y:{beginAtZero:true,ticks:{color:'#64748b',callback:v=>fmt(v)},grid:{color:'#273549'}},
    },
  }});
}

// ── Table ──────────────────────────────────────────────────────
function renderTable(products) {
  const tbody = document.getElementById('perfTableBody');
  tbody.innerHTML='';
  products.forEach(p=>{
    const {label,cls} = roasRating(p.avgROAS);
    const tr = document.createElement('tr');
    tr.innerHTML=`<td style="font-weight:600">${p.name}</td>
      <td><span style="font-size:1rem;font-weight:700;color:#f1f5f9">${fmt(p.avgROAS)}</span></td>
      <td><span class="roas-badge ${cls}">${label}</span></td>`;
    tbody.appendChild(tr);
  });
}

// ── Rank Lists ─────────────────────────────────────────────────
function renderRanks(products) {
  const s = [...products].sort((a,b)=>b.avgROAS-a.avgROAS);
  renderRankList('top5List',   s.slice(0,5),          true);
  renderRankList('worst5List', s.slice(-5).reverse(), false);
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
// COMPARE (always visible)
// ═══════════════════════════════════════════════════════════════
function renderCompare() {
  const selected = [...state.compareMonths];
  const noData   = document.getElementById('compareNoData');
  const chartWrap= document.getElementById('compareChartWrap');
  const tableWrap= document.getElementById('compareTableWrap');

  if (selected.length < 2) {
    noData.style.display='flex'; chartWrap.style.display='none'; tableWrap.style.display='none';
    document.getElementById('compareNoMsg').textContent =
      selected.length===0 ? 'Select at least 2 months to compare.' : 'Select one more month to compare.';
    return;
  }
  noData.style.display='none'; chartWrap.style.display='block'; tableWrap.style.display='block';

  const monthsData = selected.map(name => {
    const md  = state.allData.find(m=>m.monthName===name);
    const idx = state.allData.indexOf(md);
    return md ? {name, color:MONTH_COLORS[idx%MONTH_COLORS.length], slice:getSlice(md)} : null;
  }).filter(Boolean);

  const allNames = [...new Set(monthsData.flatMap(m=>m.slice.products.map(p=>p.name)))];

  // Bar chart
  if (state.compareChart) state.compareChart.destroy();
  const ctx = document.getElementById('compareChart').getContext('2d');
  state.compareChart = new Chart(ctx,{type:'bar',
    data:{
      labels:allNames,
      datasets:monthsData.map(md=>({
        label:md.name,
        data:allNames.map(n=>{ const p=md.slice.products.find(p=>p.name===n); return p?+p.avgROAS.toFixed(2):0; }),
        backgroundColor:md.color+'BB', borderColor:md.color, borderWidth:1, borderRadius:4,
      })),
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{position:'top',labels:{color:'#94a3b8',font:{size:11},padding:16}},
        tooltip:{backgroundColor:'#1e293b',borderColor:'#334155',borderWidth:1,
          titleColor:'#f1f5f9',bodyColor:'#94a3b8',
          callbacks:{label:ctx=>` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`}},
      },
      scales:{
        x:{ticks:{color:'#94a3b8',font:{size:10}},grid:{color:'#1e293b'}},
        y:{beginAtZero:true,ticks:{color:'#64748b',callback:v=>fmt(v)},grid:{color:'#273549'}},
      },
    },
  });

  // Table
  const thead=document.getElementById('compareTableHead');
  const tbody=document.getElementById('compareTableBody');
  thead.innerHTML='<tr><th>Product</th>'+monthsData.map(m=>`<th style="color:${m.color}">${m.name}</th>`).join('')+'<th>Best Month</th></tr>';
  tbody.innerHTML='';

  allNames.forEach(name=>{
    const vals=monthsData.map(m=>{ const p=m.slice.products.find(p=>p.name===name); return p?p.avgROAS:null; });
    const maxV=Math.max(...vals.filter(v=>v!==null));
    const bestI=vals.indexOf(maxV);
    const cells=vals.map((v,i)=>{
      const {cls}=v!==null?roasRating(v):{cls:''};
      return `<td class="${v===maxV&&v>0?'compare-best':''}" ><span class="roas-badge ${cls}">${v!==null?fmt(v):'—'}</span></td>`;
    }).join('');
    tbody.innerHTML+=`<tr><td style="font-weight:600">${name}</td>${cells}<td><span style="color:${monthsData[bestI]?.color};font-weight:700">${maxV>0?(monthsData[bestI]?.name||'—'):'—'}</span></td></tr>`;
  });

  const gtV=monthsData.map(m=>m.slice.grandTotal.avgROAS);
  const gtMax=Math.max(...gtV);
  tbody.innerHTML+=`<tr class="compare-gt"><td style="font-weight:700">Grand Total</td>${gtV.map((v,i)=>`<td class="${v===gtMax?'compare-best':''}"><strong style="color:#f1f5f9">${fmt(v)}</strong></td>`).join('')}<td><span style="color:${monthsData[gtV.indexOf(gtMax)]?.color};font-weight:700">${monthsData[gtV.indexOf(gtMax)]?.name||'—'}</span></td></tr>`;

  // Build/refresh month pill checkboxes
  buildComparePicker();
}

function buildComparePicker() {
  const c = document.getElementById('compareMonthPicker');
  const prev = c.innerHTML;
  if (prev && state.allData.length === c.children.length) return; // already built
  c.innerHTML = '';
  state.allData.forEach((m, i) => {
    const color = MONTH_COLORS[i % MONTH_COLORS.length];
    const checked = state.compareMonths.has(m.monthName);
    const label = document.createElement('label');
    label.className = 'cmp-pill' + (checked ? ' active' : '');
    label.style.setProperty('--mc', color);
    label.innerHTML = `<input type="checkbox" ${checked?'checked':''}><span class="cmp-dot"></span>${m.monthName}`;
    label.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) { state.compareMonths.add(m.monthName);    label.classList.add('active'); }
      else                  { state.compareMonths.delete(m.monthName); label.classList.remove('active'); }
      renderCompare();
    });
    c.appendChild(label);
  });
}

// ── Helpers ────────────────────────────────────────────────────
function fmt(n) {
  if (n===null||n===undefined||isNaN(n)) return '—';
  return Number(n).toFixed(2)+'x';
}
