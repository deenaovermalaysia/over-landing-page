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
  dateFrom:       1,
  dateTo:         31,
  compareActive:  false,
  compareMonths:  new Set(),
};

const CHART_COLORS = [
  '#6366f1','#22c55e','#f59e0b','#ef4444','#a855f7',
  '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6','#8b5cf6','#64748b',
];
const MONTH_COLORS = [
  '#6366f1','#22c55e','#f59e0b','#ef4444','#a855f7','#06b6d4',
];

// ── ROAS Rating ────────────────────────────────────────────────
function roasRating(v) {
  if (v >= 5) return { label: 'Excellent', cls: 'roas-excellent' };
  if (v >= 3) return { label: 'Good',      cls: 'roas-good'      };
  return           { label: 'Poor',       cls: 'roas-poor'      };
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR
// ═══════════════════════════════════════════════════════════════
const cal = { phase: 'start', start: null, end: null };

function openCalendar() {
  const monthData = state.allData.find(m => m.monthName === state.currentMonth);
  if (!monthData) return;
  cal.start = state.dateFrom;
  cal.end   = state.dateTo;
  cal.phase = 'start';
  const popup = document.getElementById('calPopup');
  popup.style.display = 'block';
  buildCalendar(monthData);

  // Close if clicking outside
  setTimeout(() => {
    document.addEventListener('click', outsideCalClick);
  }, 10);
}

function outsideCalClick(e) {
  const popup = document.getElementById('calPopup');
  const trigger = document.getElementById('dateRangeTrigger');
  if (!popup.contains(e.target) && !trigger.contains(e.target)) {
    closeCalendar();
  }
}

function closeCalendar() {
  document.getElementById('calPopup').style.display = 'none';
  document.removeEventListener('click', outsideCalClick);
}

function buildCalendar(monthData) {
  const maxDay = monthData.dates.length;

  // Parse year/month from first date string e.g. "1/1/2026"
  let startDow = 0;
  try {
    const parts = monthData.dates[0].split('/');
    const d = parseInt(parts[0]), m = parseInt(parts[1]), y = parseInt(parts[2]);
    if (y > 2000) startDow = new Date(y, m - 1, 1).getDay();
  } catch(e) {}

  // Presets row
  let html = `
    <div class="cal-header">
      <span class="cal-month-name">${monthData.monthName}</span>
      <button class="cal-close-btn" onclick="closeCalendar()">✕</button>
    </div>
    <div class="cal-presets">
      <button onclick="calPreset('full',${maxDay})">Full Month</button>
      <button onclick="calPreset('first7',${maxDay})">First 7</button>
      <button onclick="calPreset('first14',${maxDay})">First 14</button>
      <button onclick="calPreset('last7',${maxDay})">Last 7</button>
      <button onclick="calPreset('last14',${maxDay})">Last 14</button>
    </div>
    <div class="cal-dow-row">
      <div>Su</div><div>Mo</div><div>Tu</div><div>We</div>
      <div>Th</div><div>Fr</div><div>Sa</div>
    </div>
    <div class="cal-grid">`;

  for (let i = 0; i < startDow; i++) html += '<div class="cal-cell cal-cell--empty"></div>';

  for (let day = 1; day <= maxDay; day++) {
    const isStart    = day === cal.start;
    const isEnd      = day === cal.end;
    const inRange    = cal.start && cal.end && day > cal.start && day < cal.end;
    let cls = 'cal-cell';
    if (isStart || isEnd) cls += ' cal-selected';
    else if (inRange)     cls += ' cal-in-range';
    html += `<div class="${cls}" onclick="calDayClick(${day},${maxDay})">${day}</div>`;
  }

  html += `</div>
    <div class="cal-footer">
      <span class="cal-hint">${
        cal.phase === 'start'
          ? '① Click start day'
          : `Start: Day ${cal.start} &nbsp;→&nbsp; ② Click end day`
      }</span>
      <button class="cal-apply" onclick="applyCalendar()" ${cal.start && cal.end ? '' : 'disabled'}>
        Apply
      </button>
    </div>`;

  document.getElementById('calPopup').innerHTML = html;
}

function calDayClick(day, maxDay) {
  if (cal.phase === 'start') {
    cal.start = day; cal.end = null; cal.phase = 'end';
  } else {
    if (day < cal.start) { cal.end = cal.start; cal.start = day; }
    else                  { cal.end = day; }
    cal.phase = 'start';
  }
  const monthData = state.allData.find(m => m.monthName === state.currentMonth);
  buildCalendar(monthData);
}

function calPreset(preset, maxDay) {
  switch (preset) {
    case 'full':    cal.start = 1;                        cal.end = maxDay;           break;
    case 'first7':  cal.start = 1;                        cal.end = Math.min(7,  maxDay); break;
    case 'first14': cal.start = 1;                        cal.end = Math.min(14, maxDay); break;
    case 'last7':   cal.start = Math.max(1, maxDay - 6);  cal.end = maxDay;           break;
    case 'last14':  cal.start = Math.max(1, maxDay - 13); cal.end = maxDay;           break;
  }
  cal.phase = 'start';
  const monthData = state.allData.find(m => m.monthName === state.currentMonth);
  buildCalendar(monthData);
}

function applyCalendar() {
  if (!cal.start || !cal.end) return;
  state.dateFrom = cal.start;
  state.dateTo   = cal.end;
  updateDateTriggerLabel();
  closeCalendar();
  renderDashboard();
  if (state.compareActive) renderCompare();
}

function updateDateTriggerLabel() {
  const el = document.getElementById('dateRangeLabel');
  if (!el) return;
  el.textContent = (state.dateFrom === 1 && state.dateTo === 31)
    ? 'Full Month'
    : `Day ${state.dateFrom} – Day ${state.dateTo}`;
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

  // Month
  document.getElementById('monthFilter').addEventListener('change', e => {
    state.currentMonth = e.target.value;
    resetDateRange();
    renderDashboard();
    if (state.compareActive) renderCompare();
  });

  // Date trigger — double-click to open calendar
  document.getElementById('dateRangeTrigger').addEventListener('dblclick', openCalendar);

  // Compare toggle
  document.getElementById('compareToggle').addEventListener('click', toggleCompare);

  // Auto-refresh every 5 min
  setInterval(() => loadData(true), 5 * 60 * 1000);

  loadData();
});

// ═══════════════════════════════════════════════════════════════
// COMPARE MODE
// ═══════════════════════════════════════════════════════════════
function toggleCompare() {
  state.compareActive = !state.compareActive;
  const btn   = document.getElementById('compareToggle');
  const panel = document.getElementById('comparePanel');

  if (state.compareActive) {
    btn.classList.add('active');
    panel.style.display = 'block';
    // Pre-select current month
    if (state.currentMonth) state.compareMonths.add(state.currentMonth);
    buildCompareMonthPicker();
    renderCompare();
  } else {
    btn.classList.remove('active');
    panel.style.display = 'none';
    state.compareMonths.clear();
  }
}

function buildCompareMonthPicker() {
  const container = document.getElementById('compareMonthPicker');
  container.innerHTML = '';
  state.allData.forEach((m, i) => {
    const label = document.createElement('label');
    label.className = 'compare-month-item' + (state.compareMonths.has(m.monthName) ? ' active' : '');
    label.style.setProperty('--mc', MONTH_COLORS[i % MONTH_COLORS.length]);
    label.innerHTML = `
      <input type="checkbox" ${state.compareMonths.has(m.monthName) ? 'checked' : ''} />
      <span class="compare-month-dot"></span>
      ${m.monthName}
    `;
    label.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) { state.compareMonths.add(m.monthName);    label.classList.add('active'); }
      else                  { state.compareMonths.delete(m.monthName); label.classList.remove('active'); }
      renderCompare();
    });
    container.appendChild(label);
  });
}

function renderCompare() {
  const selected = [...state.compareMonths];
  const noDataEl = document.getElementById('compareNoData');
  const chartEl  = document.getElementById('compareChartWrap');
  const tableEl  = document.getElementById('compareTableWrap');

  if (selected.length < 2) {
    noDataEl.style.display = 'flex';
    chartEl.style.display  = 'none';
    tableEl.style.display  = 'none';
    noDataEl.textContent   = selected.length === 0
      ? 'Select at least 2 months to compare.'
      : 'Select one more month to compare.';
    return;
  }

  noDataEl.style.display = 'none';
  chartEl.style.display  = 'block';
  tableEl.style.display  = 'block';

  // Slice each month with the current date range
  const monthsData = selected.map((name, i) => {
    const md = state.allData.find(m => m.monthName === name);
    if (!md) return null;
    return { name, color: MONTH_COLORS[state.allData.indexOf(md) % MONTH_COLORS.length], slice: getSlice(md) };
  }).filter(Boolean);

  // All product names (union)
  const allNames = [...new Set(monthsData.flatMap(m => m.slice.products.map(p => p.name)))];

  // ── Grouped Bar Chart ──────────────────────────────────────
  if (state.compareChart) state.compareChart.destroy();

  const ctx = document.getElementById('compareChart').getContext('2d');
  const datasets = monthsData.map(md => ({
    label: md.name,
    data: allNames.map(name => {
      const p = md.slice.products.find(p => p.name === name);
      return p ? parseFloat(p.avgROAS.toFixed(2)) : 0;
    }),
    backgroundColor: md.color + 'BB',
    borderColor:     md.color,
    borderWidth: 1,
    borderRadius: 4,
  }));

  state.compareChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: allNames, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: '#94a3b8', font: { size: 11 }, padding: 16 } },
        tooltip: {
          backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1,
          titleColor: '#f1f5f9', bodyColor: '#94a3b8',
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` },
        },
        annotation: {},
      },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: '#1e293b' } },
        y: {
          beginAtZero: true,
          ticks: { color: '#64748b', callback: v => fmt(v) },
          grid: { color: '#273549' },
        },
      },
    },
  });

  // ── Comparison Table ───────────────────────────────────────
  const tbody = document.getElementById('compareTableBody');
  const thead = document.getElementById('compareTableHead');

  // Header
  thead.innerHTML = '<tr><th>Product</th>' +
    monthsData.map(m => `<th style="color:${m.color}">${m.name}</th>`).join('') +
    '<th>Best Month</th></tr>';

  // Body
  tbody.innerHTML = '';
  allNames.forEach(name => {
    const vals = monthsData.map(md => {
      const p = md.slice.products.find(p => p.name === name);
      return p ? p.avgROAS : null;
    });
    const maxVal = Math.max(...vals.filter(v => v !== null));
    const bestIdx = vals.indexOf(maxVal);

    const cells = vals.map((v, i) => {
      const { cls } = v !== null ? roasRating(v) : { cls: '' };
      const isBest = v === maxVal && v > 0;
      return `<td class="${isBest ? 'compare-best' : ''}">
        <span class="roas-badge ${cls}">${v !== null ? fmt(v) : '—'}</span>
      </td>`;
    }).join('');

    const bestMonth = bestIdx >= 0 && maxVal > 0
      ? `<span style="color:${monthsData[bestIdx].color};font-weight:700">${monthsData[bestIdx].name}</span>`
      : '—';

    tbody.innerHTML += `<tr>
      <td style="font-weight:600">${name}</td>
      ${cells}
      <td>${bestMonth}</td>
    </tr>`;
  });

  // Grand total row
  const gtVals = monthsData.map(md => md.slice.grandTotal.avgROAS);
  const gtMax  = Math.max(...gtVals);
  tbody.innerHTML += `<tr class="compare-gt-row">
    <td style="font-weight:700;color:#f1f5f9">Grand Total</td>
    ${gtVals.map((v, i) => `<td class="${v === gtMax ? 'compare-best' : ''}">
      <strong style="color:#f1f5f9">${fmt(v)}</strong>
    </td>`).join('')}
    <td><span style="color:${monthsData[gtVals.indexOf(gtMax)]?.color};font-weight:700">
      ${monthsData[gtVals.indexOf(gtMax)]?.name || '—'}
    </span></td>
  </tr>`;
}

// ═══════════════════════════════════════════════════════════════
// FETCH DATA
// ═══════════════════════════════════════════════════════════════
function manualRefresh() {
  const btn  = document.getElementById('refreshBtn');
  const icon = document.getElementById('refreshIcon');
  btn.disabled = true;
  icon.classList.add('spinning');
  loadData(false).finally(() => { btn.disabled = false; icon.classList.remove('spinning'); });
}

async function loadData(silent = false) {
  if (!silent) showState('loading');
  try {
    const res = await fetch(`/api/roas?tab=${state.currentTab}`, { credentials: 'same-origin' });
    if (res.status === 401) { window.location.href = '/login.html'; return; }
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.detail || json.error || 'Unknown error');

    state.allData = json.data;

    const now = new Date();
    document.getElementById('lastUpdated').textContent =
      now.toLocaleDateString('en-MY', { day:'2-digit', month:'short' }) + ' ' +
      now.toLocaleTimeString('en-MY', { hour:'2-digit', minute:'2-digit' });

    const monthSelect  = document.getElementById('monthFilter');
    const prevMonth    = state.currentMonth;
    monthSelect.innerHTML = '';
    json.data.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.monthName; opt.textContent = m.monthName;
      monthSelect.appendChild(opt);
    });

    if (prevMonth && json.data.find(m => m.monthName === prevMonth)) {
      monthSelect.value  = prevMonth;
      state.currentMonth = prevMonth;
    } else {
      state.currentMonth = json.data[0]?.monthName || null;
      monthSelect.value  = state.currentMonth;
      resetDateRange();
    }

    showState('content');
    renderDashboard();
    if (state.compareActive) { buildCompareMonthPicker(); renderCompare(); }
  } catch (err) {
    console.error(err);
    if (!silent) { document.getElementById('errorMsg').textContent = err.message; showState('error'); }
  }
}

function resetDateRange() {
  const md = state.allData.find(m => m.monthName === state.currentMonth);
  const max = md ? md.dates.length : 31;
  state.dateFrom = 1; state.dateTo = max;
  updateDateTriggerLabel();
}

function showState(which) {
  document.getElementById('loadingState').style.display     = which === 'loading' ? 'flex'  : 'none';
  document.getElementById('errorState').style.display       = which === 'error'   ? 'flex'  : 'none';
  document.getElementById('dashboardContent').style.display = which === 'content' ? 'block' : 'none';
}

// ═══════════════════════════════════════════════════════════════
// SLICE DATA BY DATE RANGE
// ═══════════════════════════════════════════════════════════════
function getSlice(monthData) {
  const from = state.dateFrom - 1;
  const to   = Math.min(state.dateTo, monthData.dates.length);
  const dates = monthData.dates.slice(from, to);

  const products = monthData.products.map(p => {
    const sliced = p.dailyROAS.slice(from, to);
    const valid  = sliced.filter(v => v !== null && v > 0);
    const avg    = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
    return { ...p, dailyROAS: sliced, avgROAS: avg };
  });

  const gtSlice = monthData.grandTotal.dailyROAS.slice(from, to);
  const gtValid = gtSlice.filter(v => v !== null && v > 0);
  const grandTotal = {
    avgROAS:   gtValid.length ? gtValid.reduce((a, b) => a + b, 0) / gtValid.length : 0,
    dailyROAS: gtSlice,
  };

  return { dates, products, grandTotal };
}

// ═══════════════════════════════════════════════════════════════
// RENDER DASHBOARD
// ═══════════════════════════════════════════════════════════════
function renderDashboard() {
  const md = state.allData.find(m => m.monthName === state.currentMonth);
  if (!md) return;
  const slice = getSlice(md);
  renderProductToggles(slice.products, md.products);
  renderStatCards(slice);
  renderChart(slice, md.products);
  renderTable(slice.products);
  renderRankLists(slice.products);
}

// ── Bulk Toggle ────────────────────────────────────────────────
function bulkToggle(all) {
  const md = state.allData.find(m => m.monthName === state.currentMonth);
  if (!md) return;
  if (all) state.hiddenProducts.clear();
  else     md.products.forEach(p => state.hiddenProducts.add(p.name));
  renderDashboard();
}

// ── Product Toggles ────────────────────────────────────────────
function renderProductToggles(products, allProducts) {
  const container = document.getElementById('productToggles');
  container.innerHTML = '';
  products.forEach(p => {
    const idx   = allProducts.findIndex(ap => ap.name === p.name);
    const color = CHART_COLORS[idx >= 0 ? idx % CHART_COLORS.length : 0];
    const label = document.createElement('label');
    label.className = 'toggle-item' + (state.hiddenProducts.has(p.name) ? '' : ' active');
    label.innerHTML = `
      <input type="checkbox" ${state.hiddenProducts.has(p.name) ? '' : 'checked'} />
      <span class="toggle-dot" style="background:${color}"></span>
      ${p.name}
    `;
    label.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) { state.hiddenProducts.delete(p.name); label.classList.add('active'); }
      else                  { state.hiddenProducts.add(p.name);    label.classList.remove('active'); }
      const md = state.allData.find(m => m.monthName === state.currentMonth);
      renderChart(getSlice(md), md.products);
    });
    container.appendChild(label);
  });
}

// ── Stat Cards ─────────────────────────────────────────────────
function renderStatCards(slice) {
  const { products, grandTotal, dates } = slice;
  document.getElementById('statAvg').textContent    = fmt(grandTotal.avgROAS);
  document.getElementById('statAvgSub').textContent = 'Grand total avg';
  const sorted = [...products].sort((a, b) => b.avgROAS - a.avgROAS);
  const top = sorted[0], worst = sorted[sorted.length - 1];
  document.getElementById('statTop').textContent    = top   ? top.name   : '—';
  document.getElementById('statTopSub').textContent = top   ? `ROAS: ${fmt(top.avgROAS)}`   : '';
  document.getElementById('statLow').textContent    = worst ? worst.name : '—';
  document.getElementById('statLowSub').textContent = worst ? `ROAS: ${fmt(worst.avgROAS)}` : '';
  const activeDays = grandTotal.dailyROAS.filter(v => v !== null && v > 0).length;
  document.getElementById('statDays').textContent    = activeDays;
  document.getElementById('statDaysSub').textContent = `of ${dates.length} days shown`;
}

// ── Chart ──────────────────────────────────────────────────────
function renderChart(slice, allProducts) {
  if (state.chartInstance) state.chartInstance.destroy();
  const { dates, products, grandTotal } = slice;
  const ctx     = document.getElementById('roasChart').getContext('2d');
  const visible = products.filter(p => !state.hiddenProducts.has(p.name));
  const labels  = dates.map(d => { const pts = d.split('/'); return pts.length >= 2 ? `${pts[0]}/${pts[1]}` : d; });

  const datasets = visible.map(p => {
    const idx = (allProducts || products).findIndex(ap => ap.name === p.name);
    return {
      label: p.name,
      data: p.dailyROAS.map(v => v === null ? null : v),
      borderColor: CHART_COLORS[idx >= 0 ? idx % CHART_COLORS.length : 0],
      backgroundColor: 'transparent',
      borderWidth: 2, pointRadius: 2, pointHoverRadius: 5, tension: 0.3, spanGaps: false,
    };
  });

  datasets.push({
    label: 'Grand Total',
    data: grandTotal.dailyROAS.map(v => v === null ? null : v),
    borderColor: '#f1f5f9', backgroundColor: 'transparent',
    borderWidth: 2.5, borderDash: [6, 3], pointRadius: 0, tension: 0.3, spanGaps: false,
  });
  datasets.push(
    { label: '— Good (3.0)',      data: Array(labels.length).fill(3), borderColor:'rgba(34,197,94,0.45)',  borderWidth:1, borderDash:[4,4], pointRadius:0, tension:0, backgroundColor:'transparent' },
    { label: '— Excellent (5.0)', data: Array(labels.length).fill(5), borderColor:'rgba(168,85,247,0.45)', borderWidth:1, borderDash:[4,4], pointRadius:0, tension:0, backgroundColor:'transparent' }
  );

  const rangeLabel = state.dateFrom === 1 && state.dateTo >= dates.length
    ? state.currentMonth
    : `${state.currentMonth} Day ${state.dateFrom}–${state.dateTo}`;
  document.getElementById('chartBadge').textContent =
    `${rangeLabel} · ${state.currentTab === 'MY' ? 'MY Website' : state.currentTab === 'SG' ? 'SG Website' : 'Marketplace'}`;

  state.chartInstance = new Chart(ctx, {
    type: 'line', data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 12, font: { size: 11 }, padding: 16 } },
        tooltip: {
          backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1,
          titleColor: '#f1f5f9', bodyColor: '#94a3b8',
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y !== null ? fmt(ctx.parsed.y) : 'N/A'}` },
        },
      },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 10 }, maxRotation: 45 }, grid: { color: '#1e293b' } },
        y: { beginAtZero: true, ticks: { color: '#64748b', callback: v => fmt(v) }, grid: { color: '#273549' } },
      },
    },
  });
}

// ── Performance Table ──────────────────────────────────────────
function renderTable(products) {
  const tbody = document.getElementById('perfTableBody');
  tbody.innerHTML = '';
  products.forEach(p => {
    const { label, cls } = roasRating(p.avgROAS);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:600">${p.name}</td>
      <td><span style="font-size:1rem;font-weight:700;color:#f1f5f9">${fmt(p.avgROAS)}</span></td>
      <td><span class="roas-badge ${cls}">${label}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Rank Lists ─────────────────────────────────────────────────
function renderRankLists(products) {
  const sorted = [...products].sort((a, b) => b.avgROAS - a.avgROAS);
  renderRankList('top5List',   sorted.slice(0, 5),         true);
  renderRankList('worst5List', sorted.slice(-5).reverse(), false);
}
function renderRankList(id, items, isTop) {
  const ul = document.getElementById(id);
  ul.innerHTML = '';
  items.forEach((p, i) => {
    const { cls } = roasRating(p.avgROAS);
    const li = document.createElement('li');
    li.className = 'rank-item';
    li.innerHTML = `
      <span class="rank-num">${i + 1}</span>
      <span class="rank-name">${p.name}</span>
      <span class="roas-badge ${cls}" style="font-size:0.78rem">${fmt(p.avgROAS)}</span>
    `;
    ul.appendChild(li);
  });
}

// ── Helpers ────────────────────────────────────────────────────
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toFixed(2) + 'x';
}
