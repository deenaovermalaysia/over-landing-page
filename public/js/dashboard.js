// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
const state = {
  currentTab:     'MY',
  allData:        [],
  salesData:      {},   // { dateStr: { productName: { adsSpent, sales } } }
  rangeStart:     { monthIdx:0, day:1 },  // day = ACTUAL calendar day number
  rangeEnd:       { monthIdx:0, day:1 },
  hiddenProducts: new Set(),
  chartInstance:  null,
  compareChart:   null,
  compareMonths:  new Set(),
  sortOrder:      'none',  // 'none' | 'desc' | 'asc'
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

// rkey: monotonic sort key across months; actual day numbers (1-31) used
function rkey(mi, d) { return mi * 1000 + d; }
function normaliseRange(a, b) {
  return rkey(a.monthIdx,a.day) <= rkey(b.monthIdx,b.day) ? [a,b] : [b,a];
}

// ── Today / Yesterday ─────────────────────────────────────────
const TODAY      = new Date();
const TODAY_MON  = MONTH_NAMES[TODAY.getMonth()];
const TODAY_DAY  = TODAY.getDate();
const YEST       = new Date(TODAY); YEST.setDate(TODAY.getDate() - 1);
const YEST_MON   = MONTH_NAMES[YEST.getMonth()];
const YEST_DAY   = YEST.getDate();

// Find the day index (0-based) within md.dates[] for a given actual day number
function getDayIndex(md, actualDay) {
  return md.dates.findIndex(d => parseInt(d.split('/')[0]) === actualDay);
}

// Is this actual day in a future (no-data-yet) position?
function isFuture(monthIdx, actualDay) {
  const todayMi = state.allData.findIndex(m => m.monthName === TODAY_MON);
  if (todayMi === -1) return false;
  if (monthIdx > todayMi) return true;
  if (monthIdx < todayMi) return false;
  return actualDay >= TODAY_DAY; // same month as today: today and beyond = no data yet
}

function isToday(monthIdx, actualDay) {
  const md = state.allData[monthIdx];
  return !!md && md.monthName === TODAY_MON && actualDay === TODAY_DAY;
}

function isSingleDay() {
  return state.rangeStart.monthIdx === state.rangeEnd.monthIdx &&
         state.rangeStart.day      === state.rangeEnd.day;
}

// Get the date string (e.g. "27/4/2026") for single-day selection
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

// Coordinate-based outside-click — safe after innerHTML rebuild
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

  // Compute weekday of the FIRST ACTUAL DATE in this month (not day 1)
  let dowFirst = 0, yearStr = '';
  try {
    const p = md.dates[0].split('/');
    yearStr = p[2] || '';
    const firstActualDay = parseInt(p[0]);
    const month = parseInt(p[1]);
    const year  = parseInt(p[2]);
    if (year > 2000) dowFirst = new Date(year, month - 1, firstActualDay).getDay();
  } catch(e) {}

  // Build day grid using ACTUAL day numbers from dates array
  let grid = '';
  for (let i = 0; i < dowFirst; i++) grid += '<div class="cal-cell cal-empty"></div>';

  md.dates.forEach(dateStr => {
    const actualDay = parseInt(dateStr.split('/')[0]);
    const future   = isFuture(cal.viewIdx, actualDay);
    const todayMk  = isToday(cal.viewIdx, actualDay);
    const selCls   = future ? '' : getDayCls(actualDay, cal.viewIdx);
    const todayCls = todayMk ? ' cal-today' : '';
    const futCls   = future  ? ' cal-future' : '';
    const onclick  = future  ? '' : `onclick="calDay(${actualDay})"`;
    grid += `<div class="cal-cell ${selCls}${todayCls}${futCls}" ${onclick}>${actualDay}</div>`;
  });

  // Footer
  const ts = cal.tempStart, te = cal.tempEnd;
  let statusHtml = '<span class="cal-status">① Click a start date</span>';
  let applyBtn   = '';

  if (ts && cal.phase === 'end' && !te) {
    const tsName = (state.allData[ts.monthIdx]?.monthName || '').slice(0,3);
    statusHtml = `<span class="cal-status">${tsName} ${ts.day} &rarr; ② Click end date (or same day again)</span>`;
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
      <span class="cal-today-dot"></span>
      Today (${TODAY_MON.slice(0,3)} ${TODAY_DAY}) — data available up to yesterday
    </div>
    <div class="cal-foot">${statusHtml}${applyBtn}</div>`;
}

// Highlight cells that are within the temp selection
function getDayCls(actualDay, viewIdx) {
  const ts = cal.tempStart, te = cal.tempEnd;
  if (!ts) return '';
  const key  = rkey(viewIdx, actualDay);
  const sKey = rkey(ts.monthIdx, ts.day);
  const eKey = te ? rkey(te.monthIdx, te.day) : sKey;
  const lo = Math.min(sKey, eKey), hi = Math.max(sKey, eKey);
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
  if (isFuture(cal.viewIdx, actualDay)) return;
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
  // "Yesterday" — navigate to YEST_MON and select YEST_DAY
  if (type === 'yest') {
    let yMi = state.allData.findIndex(m => m.monthName === YEST_MON);
    if (yMi < 0) yMi = state.allData.length - 1;
    const yMd = state.allData[yMi];
    if (!yMd || !yMd.dates.length) return;
    // Find actual day closest to YEST_DAY (in case yesterday isn't in data)
    const idx = getDayIndex(yMd, YEST_DAY);
    const day = idx >= 0 ? YEST_DAY
      : parseInt(yMd.dates[yMd.dates.length - 1].split('/')[0]);
    cal.tempStart = { monthIdx: yMi, day };
    cal.tempEnd   = { monthIdx: yMi, day };
    cal.phase     = 'start';
    applyCalendar();
    return;
  }

  const mi  = cal.viewIdx;
  const md  = state.allData[mi];
  if (!md || !md.dates.length) return;

  const firstDay = parseInt(md.dates[0].split('/')[0]);
  const lastDay  = parseInt(md.dates[md.dates.length - 1].split('/')[0]);

  switch(type) {
    case 'full':
      cal.tempStart = { monthIdx: mi, day: firstDay };
      cal.tempEnd   = { monthIdx: mi, day: lastDay };
      break;
    case 'last7':
      cal.tempStart = { monthIdx: mi, day: Math.max(firstDay, lastDay - 6) };
      cal.tempEnd   = { monthIdx: mi, day: lastDay };
      break;
    case 'last14':
      cal.tempStart = { monthIdx: mi, day: Math.max(firstDay, lastDay - 13) };
      cal.tempEnd   = { monthIdx: mi, day: lastDay };
      break;
    case 'first7':
      cal.tempStart = { monthIdx: mi, day: firstDay };
      cal.tempEnd   = { monthIdx: mi, day: Math.min(lastDay, firstDay + 6) };
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

// ── Default: LAST available date in all data ──────────────────
function setDefaultRange() {
  if (!state.allData.length) return;

  // Find the last month that has any dates
  let mi = state.allData.length - 1;
  while (mi >= 0 && !state.allData[mi].dates.length) mi--;
  if (mi < 0) return;

  const md      = state.allData[mi];
  const lastStr = md.dates[md.dates.length - 1]; // e.g. "27/4/2026"
  const lastDay = parseInt(lastStr.split('/')[0]);

  state.rangeStart = { monthIdx: mi, day: lastDay };
  state.rangeEnd   = { monthIdx: mi, day: lastDay };
  updateTriggerLabel();
}

// ═══════════════════════════════════════════════════════════════
// DATA SLICE — uses actual day numbers to find indices
// ═══════════════════════════════════════════════════════════════
function getCrossMonthSlice() {
  const rs = state.rangeStart, re = state.rangeEnd;
  if (!state.allData.length) return { dates:[], products:[], grandTotal:{avgROAS:0,dailyROAS:[]} };

  let allDates=[], gtDaily=[];
  const productMap={};

  for (let mi = rs.monthIdx; mi <= re.monthIdx; mi++) {
    const md = state.allData[mi]; if (!md) continue;

    let fromIdx = 0;
    let toIdx   = md.dates.length;

    if (mi === rs.monthIdx) {
      const fi = getDayIndex(md, rs.day);
      fromIdx = fi >= 0 ? fi : 0;
    }
    if (mi === re.monthIdx) {
      const ti = getDayIndex(md, re.day);
      toIdx = ti >= 0 ? ti + 1 : md.dates.length;
    }

    allDates = allDates.concat(md.dates.slice(fromIdx, toIdx));
    gtDaily  = gtDaily.concat(md.grandTotal.dailyROAS.slice(fromIdx, toIdx));

    md.products.forEach(p => {
      if (!productMap[p.name]) productMap[p.name] = { name: p.name, dailyROAS: [] };
      productMap[p.name].dailyROAS = productMap[p.name].dailyROAS.concat(
        p.dailyROAS.slice(fromIdx, toIdx)
      );
    });
  }

  const products = Object.values(productMap).map(p => {
    const valid = p.dailyROAS.filter(v => v !== null && v > 0);
    return { ...p, avgROAS: valid.length ? valid.reduce((a,b)=>a+b,0)/valid.length : 0 };
  });
  const gtV = gtDaily.filter(v => v !== null && v > 0);
  return {
    dates: allDates, products,
    grandTotal: {
      avgROAS: gtV.length ? gtV.reduce((a,b)=>a+b,0)/gtV.length : 0,
      dailyROAS: gtDaily,
    },
  };
}

function getFullMonthSlice(md) {
  const products = md.products.map(p => {
    const v = p.dailyROAS.filter(v=>v!==null&&v>0);
    return { ...p, avgROAS: v.length ? v.reduce((a,b)=>a+b,0)/v.length : 0 };
  });
  const gtV = md.grandTotal.dailyROAS.filter(v=>v!==null&&v>0);
  return {
    dates: md.dates, products,
    grandTotal: {
      avgROAS: gtV.length ? gtV.reduce((a,b)=>a+b,0)/gtV.length : 0,
      dailyROAS: md.grandTotal.dailyROAS,
    },
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
  const btn = document.getElementById('refreshBtn');
  const icon = document.getElementById('refreshIcon');
  btn.disabled = true; icon.classList.add('spinning');
  loadData(false).finally(() => { btn.disabled = false; icon.classList.remove('spinning'); });
}

async function loadData(silent = false) {
  if (!silent) showState('loading');
  try {
    const res  = await fetch(`/api/roas?tab=${state.currentTab}`, { credentials:'same-origin' });
    if (res.status === 401) { window.location.href = '/login.html'; return; }
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.detail || json.error || 'Unknown');

    state.allData   = json.data;
    state.salesData = json.salesData || {};

    const now = new Date();
    document.getElementById('lastUpdated').textContent =
      now.toLocaleDateString('en-MY', { day:'2-digit', month:'short' }) + ' ' +
      now.toLocaleTimeString('en-MY', { hour:'2-digit', minute:'2-digit' });

    // Set default range only if not yet set or invalid
    if (!state.allData[state.rangeStart.monthIdx] ||
        getDayIndex(state.allData[state.rangeStart.monthIdx], state.rangeStart.day) < 0) {
      setDefaultRange();
    } else {
      updateTriggerLabel();
    }

    if (state.compareMonths.size === 0) {
      json.data.forEach(m => state.compareMonths.add(m.monthName));
    }

    showState('content');
    renderDashboard();
    renderCompare();
  } catch(err) {
    console.error(err);
    if (!silent) { document.getElementById('errorMsg').textContent = err.message; showState('error'); }
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
  state.sortOrder = state.sortOrder === 'desc' ? 'asc'
                  : state.sortOrder === 'asc'  ? 'none'
                  : 'desc';
  const btn = document.getElementById('sortBtn');
  if (btn) {
    btn.innerHTML = state.sortOrder === 'desc' ? '↓ High → Low'
                  : state.sortOrder === 'asc'  ? '↑ Low → High'
                  : '↕ Sort';
  }
  renderTable(getCrossMonthSlice().products);
}

// ═══════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════
function renderDashboard() {
  const slice = getCrossMonthSlice();
  const allProducts = state.allData.flatMap(m => m.products)
    .filter((p,i,a) => a.findIndex(x=>x.name===p.name) === i);
  renderToggles(slice.products, allProducts);
  renderStats(slice);
  if (isSingleDay()) renderBarChart(slice, allProducts);
  else               renderLineChart(slice, allProducts);
  renderTable(slice.products);
  renderRanks(slice.products);
}

function syncAllCheckbox() {
  const allNames = new Set(state.allData.flatMap(m => m.products.map(p => p.name)));
  const cb = document.getElementById('toggleAll');
  const allOn  = [...allNames].every(n => !state.hiddenProducts.has(n));
  const allOff = [...allNames].every(n =>  state.hiddenProducts.has(n));
  cb.checked = allOn; cb.indeterminate = !allOn && !allOff;
}

function renderToggles(products, allProducts) {
  const c = document.getElementById('productToggles'); c.innerHTML = '';
  products.forEach(p => {
    const idx   = allProducts.findIndex(ap => ap.name === p.name);
    const color = CHART_COLORS[idx >= 0 ? idx % CHART_COLORS.length : 0];
    const hidden = state.hiddenProducts.has(p.name);
    const label = document.createElement('label');
    label.className = 'toggle-item' + (hidden ? '' : ' active');
    label.innerHTML = `<input type="checkbox" ${hidden?'':'checked'}/>
      <span class="toggle-dot" style="background:${color}"></span>${p.name}`;
    label.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) { state.hiddenProducts.delete(p.name); label.classList.add('active'); }
      else                  { state.hiddenProducts.add(p.name);    label.classList.remove('active'); }
      const slice = getCrossMonthSlice();
      if (isSingleDay()) renderBarChart(slice, allProducts);
      else               renderLineChart(slice, allProducts);
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
  const sorted = [...products].sort((a,b) => b.avgROAS - a.avgROAS);
  const top = sorted[0], worst = sorted[sorted.length-1];
  document.getElementById('statTop').textContent    = top   ? top.name   : '—';
  document.getElementById('statTopSub').textContent = top   ? `ROAS: ${fmt(top.avgROAS)}`   : '';
  document.getElementById('statLow').textContent    = worst ? worst.name : '—';
  document.getElementById('statLowSub').textContent = worst ? `ROAS: ${fmt(worst.avgROAS)}` : '';
  const active = grandTotal.dailyROAS.filter(v => v!==null && v>0).length;
  document.getElementById('statDays').textContent    = active;
  document.getElementById('statDaysSub').textContent = `of ${dates.length} day${dates.length!==1?'s':''}`;
}

// ── LINE CHART ─────────────────────────────────────────────────
function renderLineChart(slice, allProducts) {
  if (state.chartInstance) state.chartInstance.destroy();
  const { dates, products, grandTotal } = slice;
  const ctx     = document.getElementById('roasChart').getContext('2d');
  const visible = products.filter(p => !state.hiddenProducts.has(p.name));
  const labels  = dates.map(d => { const p=d.split('/'); return p.length>=2?`${p[0]}/${p[1]}`:d; });

  const datasets = visible.map(p => {
    const idx = (allProducts||products).findIndex(ap => ap.name === p.name);
    return {
      label: p.name,
      data: p.dailyROAS.map(v => v===null?null:v),
      borderColor: CHART_COLORS[idx>=0?idx%CHART_COLORS.length:0],
      backgroundColor: 'transparent',
      borderWidth:2, pointRadius:2, pointHoverRadius:5, tension:0.3, spanGaps:false,
    };
  });
  datasets.push({
    label:'Grand Total',data:grandTotal.dailyROAS.map(v=>v===null?null:v),
    borderColor:'#f1f5f9',backgroundColor:'transparent',
    borderWidth:2.5,borderDash:[6,3],pointRadius:0,tension:0.3,spanGaps:false,
  });
  datasets.push(
    {label:'— Good (3.0)',      data:Array(labels.length).fill(3),borderColor:'rgba(34,197,94,.45)',  borderWidth:1,borderDash:[4,4],pointRadius:0,tension:0,backgroundColor:'transparent'},
    {label:'— Excellent (5.0)',data:Array(labels.length).fill(5),borderColor:'rgba(168,85,247,.45)',borderWidth:1,borderDash:[4,4],pointRadius:0,tension:0,backgroundColor:'transparent'}
  );

  updateChartBadge();
  state.chartInstance = new Chart(ctx, {
    type:'line', data:{ labels, datasets },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{
        legend:{ position:'bottom', labels:{ color:'#94a3b8', boxWidth:12, font:{size:11}, padding:16 } },
        tooltip:{
          backgroundColor:'#1e293b', borderColor:'#334155', borderWidth:1,
          titleColor:'#f1f5f9', bodyColor:'#94a3b8',
          callbacks:{ label: c => ` ${c.dataset.label}: ${c.parsed.y!==null?fmt(c.parsed.y):'N/A'}` },
        },
      },
      scales:{
        x:{ ticks:{color:'#64748b',font:{size:10},maxRotation:45}, grid:{color:'#1e293b'} },
        y:{ beginAtZero:true, ticks:{color:'#64748b',callback:v=>fmt(v)}, grid:{color:'#273549'} },
      },
    },
  });
}

// ── BAR CHART (single day) ─────────────────────────────────────
function renderBarChart(slice, allProducts) {
  if (state.chartInstance) state.chartInstance.destroy();
  const { products } = slice;
  const ctx     = document.getElementById('roasChart').getContext('2d');
  const visible = products.filter(p => !state.hiddenProducts.has(p.name));
  const labels  = visible.map(p => p.name);
  const values  = visible.map(p => +p.avgROAS.toFixed(2));
  const colors  = visible.map(p => {
    const idx = (allProducts||products).findIndex(ap => ap.name === p.name);
    return CHART_COLORS[idx>=0?idx%CHART_COLORS.length:0];
  });

  const dateStr = getSelectedDateStr();

  updateChartBadge();
  state.chartInstance = new Chart(ctx, {
    type:'bar',
    data:{
      labels,
      datasets:[
        {
          label:'ROAS', data:values,
          backgroundColor: colors.map(c => c+'BB'),
          borderColor: colors,
          borderWidth:1, borderRadius:6,
        },
        { label:'Good (3.0)',      data:Array(labels.length).fill(3), type:'line', borderColor:'rgba(34,197,94,.55)',  borderWidth:1.5, borderDash:[5,4], pointRadius:0, fill:false, tension:0, backgroundColor:'transparent' },
        { label:'Excellent (5.0)',data:Array(labels.length).fill(5), type:'line', borderColor:'rgba(168,85,247,.55)',borderWidth:1.5, borderDash:[5,4], pointRadius:0, fill:false, tension:0, backgroundColor:'transparent' },
      ],
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{ display:false },
        tooltip:{
          backgroundColor:'#1e293b', borderColor:'#334155', borderWidth:1,
          titleColor:'#f1f5f9', bodyColor:'#94a3b8',
          callbacks:{
            title: items => items[0]?.label || '',
            label: ctx => {
              if (ctx.dataset.type === 'line') return ` ${ctx.dataset.label}`;
              const productName = ctx.label;
              const lines = [` ROAS: ${fmt(ctx.parsed.y)}`];

              // Look up Ads Spent + Sales
              if (dateStr && state.salesData) {
                const dayData = state.salesData[dateStr] || {};
                let adsSpent = null, sales = null;

                if (productName === 'OB + OB Pro') {
                  const obE  = dayData['OB'];
                  const obPE = dayData['OB Pro'];
                  if (obE || obPE) {
                    adsSpent = (obE?.adsSpent||0) + (obPE?.adsSpent||0);
                    sales    = (obE?.sales   ||0) + (obPE?.sales   ||0);
                  }
                } else {
                  const entry = dayData[productName];
                  if (entry) { adsSpent = entry.adsSpent; sales = entry.sales; }
                }

                if (adsSpent !== null) {
                  const fmtRM = v => 'RM ' + v.toLocaleString('en-MY', {minimumFractionDigits:2, maximumFractionDigits:2});
                  lines.push(` Ads Spent: ${fmtRM(adsSpent)}`);
                  lines.push(` Sales: ${fmtRM(sales)}`);
                }
              }
              return lines;
            },
          },
        },
      },
      scales:{
        x:{ ticks:{color:'#94a3b8',font:{size:11}}, grid:{color:'#1e293b'} },
        y:{ beginAtZero:true, ticks:{color:'#64748b',callback:v=>fmt(v)}, grid:{color:'#273549'} },
      },
    },
  });
}

function updateChartBadge() {
  document.getElementById('chartBadge').textContent =
    document.getElementById('dateRangeLabel').textContent + ' · ' +
    (state.currentTab==='MY'?'MY Website':state.currentTab==='SG'?'SG Website':'Marketplace');
}

// ── Table (with sort) ──────────────────────────────────────────
function renderTable(products) {
  const tbody = document.getElementById('perfTableBody');
  tbody.innerHTML = '';

  let sorted = [...products];
  if (state.sortOrder === 'desc') sorted.sort((a,b) => b.avgROAS - a.avgROAS);
  else if (state.sortOrder === 'asc') sorted.sort((a,b) => a.avgROAS - b.avgROAS);

  sorted.forEach(p => {
    const { label, cls } = roasRating(p.avgROAS);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:600">${p.name}</td>
      <td><span style="font-size:1rem;font-weight:700;color:#f1f5f9">${fmt(p.avgROAS)}</span></td>
      <td><span class="roas-badge ${cls}">${label}</span></td>`;
    tbody.appendChild(tr);
  });
}

function renderRanks(products) {
  const s = [...products].sort((a,b) => b.avgROAS - a.avgROAS);
  renderRankList('top5List',   s.slice(0,5));
  renderRankList('worst5List', s.slice(-5).reverse());
}
function renderRankList(id, items) {
  const ul = document.getElementById(id); ul.innerHTML = '';
  items.forEach((p,i) => {
    const { cls } = roasRating(p.avgROAS);
    const li = document.createElement('li'); li.className = 'rank-item';
    li.innerHTML = `<span class="rank-num">${i+1}</span>
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
      selected.length===0?'Select at least 2 months.':'Select one more month.';
    return;
  }
  noData.style.display='none'; chartWrap.style.display='block'; tableWrap.style.display='block';

  const monthsData = selected.map(name => {
    const md  = state.allData.find(m => m.monthName === name);
    const idx = state.allData.indexOf(md);
    return md ? { name, color: MONTH_COLORS[idx%MONTH_COLORS.length], slice: getFullMonthSlice(md) } : null;
  }).filter(Boolean);

  const allNames = [...new Set(monthsData.flatMap(m => m.slice.products.map(p => p.name)))];

  if (state.compareChart) state.compareChart.destroy();
  const ctx = document.getElementById('compareChart').getContext('2d');
  state.compareChart = new Chart(ctx, {
    type:'bar',
    data:{
      labels: allNames,
      datasets: monthsData.map(md => ({
        label: md.name,
        data: allNames.map(n => { const p=md.slice.products.find(p=>p.name===n); return p?+p.avgROAS.toFixed(2):0; }),
        backgroundColor: md.color+'BB', borderColor: md.color, borderWidth:1, borderRadius:4,
      })),
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{
        legend:{ position:'top', labels:{ color:'#94a3b8', font:{size:11}, padding:16 } },
        tooltip:{
          backgroundColor:'#1e293b', borderColor:'#334155', borderWidth:1,
          titleColor:'#f1f5f9', bodyColor:'#94a3b8',
          callbacks:{ label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` },
        },
      },
      scales:{
        x:{ ticks:{color:'#94a3b8',font:{size:10}}, grid:{color:'#1e293b'} },
        y:{ beginAtZero:true, ticks:{color:'#64748b',callback:v=>fmt(v)}, grid:{color:'#273549'} },
      },
    },
  });

  const thead = document.getElementById('compareTableHead');
  const tbody = document.getElementById('compareTableBody');
  thead.innerHTML = '<tr><th>Product</th>' +
    monthsData.map(m => `<th style="color:${m.color}">${m.name}</th>`).join('') +
    '<th>Best</th></tr>';
  tbody.innerHTML = '';

  allNames.forEach(name => {
    const vals = monthsData.map(m => { const p=m.slice.products.find(p=>p.name===name); return p?p.avgROAS:null; });
    const maxV = Math.max(...vals.filter(v=>v!==null));
    const bi   = vals.indexOf(maxV);
    const cells = vals.map(v => {
      const { cls } = v!==null ? roasRating(v) : { cls:'' };
      return `<td class="${v===maxV&&v>0?'compare-best':''}"><span class="roas-badge ${cls}">${v!==null?fmt(v):'—'}</span></td>`;
    }).join('');
    tbody.innerHTML += `<tr><td style="font-weight:600">${name}</td>${cells}<td><span style="color:${monthsData[bi]?.color};font-weight:700">${maxV>0?(monthsData[bi]?.name||'—'):'—'}</span></td></tr>`;
  });

  const gtV   = monthsData.map(m => m.slice.grandTotal.avgROAS);
  const gtMax = Math.max(...gtV), gtBi = gtV.indexOf(gtMax);
  tbody.innerHTML += `<tr class="compare-gt"><td style="font-weight:700">Grand Total</td>${gtV.map((v,i)=>`<td class="${v===gtMax?'compare-best':''}"><strong style="color:#f1f5f9">${fmt(v)}</strong></td>`).join('')}<td><span style="color:${monthsData[gtBi]?.color};font-weight:700">${monthsData[gtBi]?.name||'—'}</span></td></tr>`;
}

function buildComparePicker() {
  const c = document.getElementById('compareMonthPicker');
  if (c.children.length === state.allData.length) return;
  c.innerHTML = '';
  state.allData.forEach((m, i) => {
    const color   = MONTH_COLORS[i % MONTH_COLORS.length];
    const checked = state.compareMonths.has(m.monthName);
    const label   = document.createElement('label');
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

function fmt(n) {
  if (n===null||n===undefined||isNaN(n)) return '—';
  return Number(n).toFixed(2) + 'x';
}
