// ── State ──────────────────────────────────────────────────────
const state = {
  currentTab: 'MY',
  currentMonth: null,
  allData: [],
  hiddenProducts: new Set(),
  chartInstance: null,
  dateFrom: 1,
  dateTo: 31,
  refreshTimer: null,
};

const CHART_COLORS = [
  '#6366f1','#22c55e','#f59e0b','#ef4444','#a855f7',
  '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6',
  '#8b5cf6','#64748b',
];

// ── ROAS Rating ────────────────────────────────────────────────
// < 3 = Poor, 3–5 = Good, > 5 = Excellent
function roasRating(v) {
  if (v >= 5)  return { label: 'Excellent', cls: 'roas-excellent' };
  if (v >= 3)  return { label: 'Good',      cls: 'roas-good'      };
  return             { label: 'Poor',       cls: 'roas-poor'      };
}

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Platform buttons
  document.querySelectorAll('.platform-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.platform-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentTab = btn.dataset.tab;
      state.hiddenProducts.clear();
      loadData();
    });
  });

  // Month filter
  document.getElementById('monthFilter').addEventListener('change', e => {
    state.currentMonth = e.target.value;
    resetDateRange();
    renderDashboard();
  });

  // Date range apply button
  document.getElementById('applyDateBtn').addEventListener('click', () => {
    const monthData = state.allData.find(m => m.monthName === state.currentMonth);
    const maxDay = monthData ? monthData.dates.length : 31;

    let from = parseInt(document.getElementById('dateFrom').value) || 1;
    let to   = parseInt(document.getElementById('dateTo').value)   || maxDay;

    from = Math.max(1, Math.min(from, maxDay));
    to   = Math.max(from, Math.min(to, maxDay));

    document.getElementById('dateFrom').value = from;
    document.getElementById('dateTo').value   = to;

    state.dateFrom = from;
    state.dateTo   = to;

    renderDashboard();
  });

  // Auto-refresh every 5 minutes
  state.refreshTimer = setInterval(() => {
    loadData(true); // silent refresh
  }, 5 * 60 * 1000);

  loadData();
});

// ── Manual Refresh ─────────────────────────────────────────────
function manualRefresh() {
  const btn  = document.getElementById('refreshBtn');
  const icon = document.getElementById('refreshIcon');
  btn.disabled = true;
  icon.style.animation = 'spin 0.6s linear infinite';
  loadData(false).finally(() => {
    btn.disabled = false;
    icon.style.animation = '';
  });
}

// ── Fetch Data ─────────────────────────────────────────────────
async function loadData(silent = false) {
  if (!silent) showState('loading');

  try {
    const res = await fetch(`/api/roas?tab=${state.currentTab}`, {
      credentials: 'same-origin'
    });

    if (res.status === 401) {
      window.location.href = '/login.html';
      return;
    }

    const json = await res.json();

    if (!res.ok || !json.success) {
      throw new Error(json.detail || json.error || 'Unknown error');
    }

    state.allData = json.data;
    document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString();

    // Populate month dropdown
    const monthSelect = document.getElementById('monthFilter');
    const prevMonth = state.currentMonth;
    monthSelect.innerHTML = '';
    json.data.forEach((m, i) => {
      const opt = document.createElement('option');
      opt.value = m.monthName;
      opt.textContent = m.monthName;
      monthSelect.appendChild(opt);
    });

    // Keep selected month if still available, otherwise use first
    if (prevMonth && json.data.find(m => m.monthName === prevMonth)) {
      monthSelect.value = prevMonth;
      state.currentMonth = prevMonth;
    } else {
      state.currentMonth = json.data[0]?.monthName || null;
      monthSelect.value = state.currentMonth;
      resetDateRange();
    }

    showState('content');
    renderDashboard();

  } catch (err) {
    console.error(err);
    if (!silent) {
      document.getElementById('errorMsg').textContent = err.message;
      showState('error');
    }
  }
}

// ── Reset Date Range to full month ─────────────────────────────
function resetDateRange() {
  const monthData = state.allData.find(m => m.monthName === state.currentMonth);
  const maxDay = monthData ? monthData.dates.length : 31;
  state.dateFrom = 1;
  state.dateTo   = maxDay;
  document.getElementById('dateFrom').value = 1;
  document.getElementById('dateTo').value   = maxDay;
}

// ── Show State ─────────────────────────────────────────────────
function showState(which) {
  document.getElementById('loadingState').style.display    = which === 'loading' ? 'flex'  : 'none';
  document.getElementById('errorState').style.display      = which === 'error'   ? 'flex'  : 'none';
  document.getElementById('dashboardContent').style.display = which === 'content' ? 'block' : 'none';
}

// ── Get Filtered Date Slice ────────────────────────────────────
function getSlice(monthData) {
  const from = state.dateFrom - 1;              // 0-indexed
  const to   = Math.min(state.dateTo, monthData.dates.length); // exclusive end

  const dates = monthData.dates.slice(from, to);

  const products = monthData.products.map(p => {
    const slicedDaily = p.dailyROAS.slice(from, to);
    const valid = slicedDaily.filter(v => v !== null && v > 0);
    const avgROAS = valid.length > 0
      ? valid.reduce((a, b) => a + b, 0) / valid.length
      : 0;
    return { ...p, dailyROAS: slicedDaily, avgROAS };
  });

  const gtSlice = monthData.grandTotal.dailyROAS.slice(from, to);
  const gtValid = gtSlice.filter(v => v !== null && v > 0);
  const grandTotal = {
    avgROAS: gtValid.length > 0 ? gtValid.reduce((a, b) => a + b, 0) / gtValid.length : 0,
    dailyROAS: gtSlice,
  };

  return { dates, products, grandTotal };
}

// ── Render Dashboard ───────────────────────────────────────────
function renderDashboard() {
  const monthData = state.allData.find(m => m.monthName === state.currentMonth);
  if (!monthData) return;

  const slice = getSlice(monthData);

  renderProductToggles(slice.products, monthData.products);
  renderStatCards(slice);
  renderChart(slice);
  renderTable(slice.products);
  renderRankLists(slice.products);
}

// ── Product Toggles ────────────────────────────────────────────
function renderProductToggles(products, allProducts) {
  const container = document.getElementById('productToggles');
  container.innerHTML = '';
  products.forEach((p, i) => {
    // Use original product index for consistent colour
    const colorIdx = allProducts.findIndex(ap => ap.name === p.name);
    const color = CHART_COLORS[(colorIdx >= 0 ? colorIdx : i) % CHART_COLORS.length];

    const label = document.createElement('label');
    label.className = 'toggle-item' + (state.hiddenProducts.has(p.name) ? '' : ' active');
    label.innerHTML = `
      <input type="checkbox" ${state.hiddenProducts.has(p.name) ? '' : 'checked'} />
      <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></span>
      ${p.name}
    `;
    label.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) {
        state.hiddenProducts.delete(p.name);
        label.classList.add('active');
      } else {
        state.hiddenProducts.add(p.name);
        label.classList.remove('active');
      }
      const monthData = state.allData.find(m => m.monthName === state.currentMonth);
      renderChart(getSlice(monthData));
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
  const top   = sorted[0];
  const worst = sorted[sorted.length - 1];

  document.getElementById('statTop').textContent    = top   ? top.name   : '—';
  document.getElementById('statTopSub').textContent = top   ? `ROAS: ${fmt(top.avgROAS)}`   : '';
  document.getElementById('statLow').textContent    = worst ? worst.name : '—';
  document.getElementById('statLowSub').textContent = worst ? `ROAS: ${fmt(worst.avgROAS)}` : '';

  const activeDays = grandTotal.dailyROAS.filter(v => v !== null && v > 0).length;
  document.getElementById('statDays').textContent    = activeDays;
  document.getElementById('statDaysSub').textContent = `of ${dates.length} days shown`;
}

// ── Chart ──────────────────────────────────────────────────────
function renderChart(slice) {
  if (state.chartInstance) state.chartInstance.destroy();

  const ctx = document.getElementById('roasChart').getContext('2d');
  const { dates, products, grandTotal } = slice;

  const monthData  = state.allData.find(m => m.monthName === state.currentMonth);
  const allProducts = monthData ? monthData.products : products;

  const visibleProducts = products.filter(p => !state.hiddenProducts.has(p.name));

  const labels = dates.map(d => {
    const parts = d.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : d;
  });

  const datasets = visibleProducts.map(p => {
    const colorIdx = allProducts.findIndex(ap => ap.name === p.name);
    return {
      label: p.name,
      data: p.dailyROAS.map(v => v === null ? null : v),
      borderColor: CHART_COLORS[(colorIdx >= 0 ? colorIdx : 0) % CHART_COLORS.length],
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 2,
      pointHoverRadius: 5,
      tension: 0.3,
      spanGaps: false,
    };
  });

  // Grand total dashed line
  datasets.push({
    label: 'Grand Total',
    data: grandTotal.dailyROAS.map(v => v === null ? null : v),
    borderColor: '#f1f5f9',
    backgroundColor: 'transparent',
    borderWidth: 2.5,
    borderDash: [6, 3],
    pointRadius: 0,
    tension: 0.3,
    spanGaps: false,
  });

  // ROAS threshold lines
  const goodLine = {
    label: 'Good (3.0)',
    data: Array(labels.length).fill(3),
    borderColor: 'rgba(34,197,94,0.4)',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderDash: [4, 4],
    pointRadius: 0,
    tension: 0,
  };
  const excellentLine = {
    label: 'Excellent (5.0)',
    data: Array(labels.length).fill(5),
    borderColor: 'rgba(168,85,247,0.4)',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderDash: [4, 4],
    pointRadius: 0,
    tension: 0,
  };
  datasets.push(goodLine, excellentLine);

  const rangeLabel = state.dateFrom === 1 && state.dateTo >= dates.length + state.dateFrom - 1
    ? state.currentMonth
    : `${state.currentMonth} Day ${state.dateFrom}–${state.dateTo}`;

  document.getElementById('chartBadge').textContent =
    `${rangeLabel} · ${state.currentTab === 'MY' ? 'MY Website' : state.currentTab === 'SG' ? 'SG Website' : 'Marketplace'}`;

  state.chartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#94a3b8',
            boxWidth: 12,
            font: { size: 11 },
            padding: 16,
            filter: item => !['Good (3.0)', 'Excellent (5.0)'].includes(item.text) || true,
          },
        },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: '#334155',
          borderWidth: 1,
          titleColor: '#f1f5f9',
          bodyColor: '#94a3b8',
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y !== null ? fmt(ctx.parsed.y) : 'N/A'}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#64748b', font: { size: 10 }, maxRotation: 45 },
          grid:  { color: '#1e293b' },
        },
        y: {
          beginAtZero: true,
          ticks: { color: '#64748b', callback: v => fmt(v) },
          grid:  { color: '#273549' },
        },
      },
    },
  });
}

// ── Performance Table (no Trend column) ───────────────────────
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

// ── Top 5 / Worst 5 ────────────────────────────────────────────
function renderRankLists(products) {
  const sorted = [...products].sort((a, b) => b.avgROAS - a.avgROAS);
  renderRankList('top5List',   sorted.slice(0, 5),          true);
  renderRankList('worst5List', sorted.slice(-5).reverse(),  false);
}

function renderRankList(id, items, isTop) {
  const ul = document.getElementById(id);
  ul.innerHTML = '';
  items.forEach((p, i) => {
    const color = isTop ? '#22c55e' : '#ef4444';
    const li = document.createElement('li');
    li.className = 'rank-item';
    li.innerHTML = `
      <span class="rank-num">${i + 1}</span>
      <span class="rank-name">${p.name}</span>
      <span class="rank-val" style="color:${color}">${fmt(p.avgROAS)}</span>
    `;
    ul.appendChild(li);
  });
}

// ── Helpers ────────────────────────────────────────────────────
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toFixed(2) + 'x';
}
// CSS additions - append to style.css
