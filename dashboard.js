// ── State ──────────────────────────────────────────────────────
const state = {
  currentTab: 'MY',
  currentMonth: null,
  allData: [],           // all months from API
  hiddenProducts: new Set(),
  chartInstance: null,
};

// Chart colors for up to 12 products
const CHART_COLORS = [
  '#6366f1','#22c55e','#f59e0b','#ef4444','#a855f7',
  '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6',
  '#8b5cf6','#64748b',
];

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
    renderDashboard();
  });

  loadData();
});

// ── Fetch Data ─────────────────────────────────────────────────
async function loadData() {
  showState('loading');

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

    // Update last updated time
    document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString();

    // Populate month dropdown
    const monthSelect = document.getElementById('monthFilter');
    monthSelect.innerHTML = '';
    json.data.forEach((m, i) => {
      const opt = document.createElement('option');
      opt.value = m.monthName;
      opt.textContent = m.monthName;
      monthSelect.appendChild(opt);
      if (i === 0) state.currentMonth = m.monthName;
    });

    showState('content');
    renderDashboard();

  } catch (err) {
    console.error(err);
    document.getElementById('errorMsg').textContent = err.message;
    showState('error');
  }
}

// ── Show State ─────────────────────────────────────────────────
function showState(which) {
  document.getElementById('loadingState').style.display   = which === 'loading' ? 'flex' : 'none';
  document.getElementById('errorState').style.display     = which === 'error'   ? 'flex' : 'none';
  document.getElementById('dashboardContent').style.display = which === 'content' ? 'block' : 'none';
}

// ── Render Dashboard ───────────────────────────────────────────
function renderDashboard() {
  const monthData = state.allData.find(m => m.monthName === state.currentMonth);
  if (!monthData) return;

  renderProductToggles(monthData.products);
  renderStatCards(monthData);
  renderChart(monthData);
  renderTable(monthData.products);
  renderRankLists(monthData.products);
}

// ── Product Toggles ────────────────────────────────────────────
function renderProductToggles(products) {
  const container = document.getElementById('productToggles');
  container.innerHTML = '';
  products.forEach((p, i) => {
    const label = document.createElement('label');
    label.className = 'toggle-item' + (state.hiddenProducts.has(p.name) ? '' : ' active');
    label.innerHTML = `
      <input type="checkbox" ${state.hiddenProducts.has(p.name) ? '' : 'checked'} />
      <span style="width:10px;height:10px;border-radius:50%;background:${CHART_COLORS[i % CHART_COLORS.length]};flex-shrink:0;"></span>
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
      renderChart(state.allData.find(m => m.monthName === state.currentMonth));
    });
    container.appendChild(label);
  });
}

// ── Stat Cards ─────────────────────────────────────────────────
function renderStatCards(monthData) {
  const products = monthData.products;
  const gt = monthData.grandTotal;

  // Overall avg ROAS from grand total
  document.getElementById('statAvg').textContent = fmt(gt.avgROAS);
  document.getElementById('statAvgSub').textContent = `Grand total avg`;

  // Top product
  const sorted = [...products].sort((a, b) => b.avgROAS - a.avgROAS);
  const top = sorted[0];
  const worst = sorted[sorted.length - 1];

  document.getElementById('statTop').textContent = top ? top.name : '—';
  document.getElementById('statTopSub').textContent = top ? `ROAS: ${fmt(top.avgROAS)}` : '';

  document.getElementById('statLow').textContent = worst ? worst.name : '—';
  document.getElementById('statLowSub').textContent = worst ? `ROAS: ${fmt(worst.avgROAS)}` : '';

  // Active days (non-null entries in grand total daily)
  const activeDays = gt.dailyROAS.filter(v => v !== null && v > 0).length;
  document.getElementById('statDays').textContent = activeDays;
  document.getElementById('statDaysSub').textContent = `of ${monthData.dates.length} days`;
}

// ── Chart ──────────────────────────────────────────────────────
function renderChart(monthData) {
  if (state.chartInstance) state.chartInstance.destroy();

  const ctx = document.getElementById('roasChart').getContext('2d');
  const visibleProducts = monthData.products.filter(p => !state.hiddenProducts.has(p.name));

  // Use short date labels (strip year if present)
  const labels = monthData.dates.map(d => {
    const parts = d.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : d;
  });

  const datasets = visibleProducts.map((p, i) => ({
    label: p.name,
    data: p.dailyROAS.map(v => v === null ? null : v),
    borderColor: CHART_COLORS[monthData.products.indexOf(p) % CHART_COLORS.length],
    backgroundColor: 'transparent',
    borderWidth: 2,
    pointRadius: 2,
    pointHoverRadius: 5,
    tension: 0.3,
    spanGaps: false,
  }));

  // Add grand total line
  datasets.push({
    label: 'Grand Total',
    data: monthData.grandTotal.dailyROAS.map(v => v === null ? null : v),
    borderColor: '#f1f5f9',
    backgroundColor: 'transparent',
    borderWidth: 2.5,
    borderDash: [6, 3],
    pointRadius: 0,
    tension: 0.3,
    spanGaps: false,
  });

  // Update badge
  document.getElementById('chartBadge').textContent =
    `${state.currentMonth} · ${state.currentTab === 'MY' ? 'MY Website' : state.currentTab === 'SG' ? 'SG Website' : 'Marketplace'}`;

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

// ── Performance Table ──────────────────────────────────────────
function renderTable(products) {
  const tbody = document.getElementById('perfTableBody');
  tbody.innerHTML = '';

  const maxROAS = Math.max(...products.map(p => p.avgROAS), 0.01);

  products.forEach(p => {
    const ratingClass = p.avgROAS >= 3 ? 'roas-excellent' :
                        p.avgROAS >= 2 ? 'roas-good' :
                        p.avgROAS >= 1 ? 'roas-average' : 'roas-poor';
    const ratingLabel = p.avgROAS >= 3 ? 'Excellent' :
                        p.avgROAS >= 2 ? 'Good' :
                        p.avgROAS >= 1 ? 'Average' : 'Poor';
    const barWidth = Math.round((p.avgROAS / maxROAS) * 100);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:600">${p.name}</td>
      <td><span style="font-size:1rem;font-weight:700;color:#f1f5f9">${fmt(p.avgROAS)}</span></td>
      <td><span class="roas-badge ${ratingClass}">${ratingLabel}</span></td>
      <td>
        <div class="trend-bar-wrap">
          <div class="trend-bar" style="width:${barWidth}%"></div>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Top 5 / Worst 5 ────────────────────────────────────────────
function renderRankLists(products) {
  const sorted = [...products].sort((a, b) => b.avgROAS - a.avgROAS);

  const top5   = sorted.slice(0, 5);
  const worst5 = sorted.slice(-5).reverse();

  renderRankList('top5List',   top5,   true);
  renderRankList('worst5List', worst5, false);
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