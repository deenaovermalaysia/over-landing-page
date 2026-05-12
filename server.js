// server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');
const path = require('path');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  }
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  res.redirect('/login.html');
}

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/', (req, res) => {
  res.redirect(req.session?.loggedIn ? '/dashboard.html' : '/login.html');
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.DASHBOARD_USERNAME && password === process.env.DASHBOARD_PASSWORD) {
    req.session.loggedIn = true;
    req.session.username = username;
    res.redirect('/dashboard.html');
  } else {
    res.redirect('/login.html?error=1');
  }
});

app.get('/dashboard.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login.html'));
});

// ─── Google Auth ──────────────────────────────────────────────
function getGoogleAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

const TAB_NAMES = {
  MY:          'Product Daily ROAS (MY Website)',
  Marketplace: 'Product Daily ROAS (Marketplace)',
  SG:          'Product Daily ROAS (SG Website)',
};

const NAME_MAP = {
  '1.2L OVER Cup': 'OVER Cup',
  '1.2L Cup':      'OVER Cup',
  '1.2l Cup':      'OVER Cup',
  '1.2L over Cup': 'OVER Cup',
};

function normaliseName(raw) {
  return NAME_MAP[raw.trim()] || raw.trim();
}

// ─── Parse ROAS sheet (columns G onwards) ────────────────────
function parseROASData(rows) {
  const COL_NAME = 0, COL_AVG = 1, COL_DATE_START = 2;
  const BLOCK_SIZE = 14, MAX_PRODUCTS = 10;
  const months = [];

  for (let blockStart = 0; blockStart < rows.length; blockStart += BLOCK_SIZE) {
    const titleRow = rows[blockStart];
    if (!titleRow || !titleRow[COL_NAME]) break;
    const monthName = String(titleRow[COL_NAME]).trim();
    if (!monthName) break;

    const headerRow = rows[blockStart + 1] || [];
    const dates = [];
    for (let col = COL_DATE_START; col < headerRow.length; col++) {
      if (headerRow[col] !== undefined && headerRow[col] !== '') {
        dates.push(String(headerRow[col]));
      } else break;
    }

    const rawProducts = [];
    for (let r = blockStart + 2; r <= blockStart + 1 + MAX_PRODUCTS; r++) {
      const row = rows[r] || [];
      const rawName = row[COL_NAME] ? String(row[COL_NAME]).trim() : '';
      if (!rawName) continue;
      const name = normaliseName(rawName);
      const avgROAS = parseFloat(row[COL_AVG]) || 0;
      const dailyROAS = dates.map((_, i) => {
        const val = row[COL_DATE_START + i];
        if (val === 'NA' || val === undefined || val === null || val === '') return null;
        return parseFloat(val) || 0;
      });
      rawProducts.push({ name, avgROAS, dailyROAS });
    }

    // Merge OB + OB Pro
    const obIdx    = rawProducts.findIndex(p => p.name === 'OB');
    const obProIdx = rawProducts.findIndex(p => p.name === 'OB Pro');
    let products = [...rawProducts];

    if (obIdx !== -1 && obProIdx !== -1) {
      const ob = rawProducts[obIdx], obPro = rawProducts[obProIdx];
      const mergedAvg = (ob.avgROAS + obPro.avgROAS) / 2;
      const mergedDaily = ob.dailyROAS.map((v, i) => {
        const v2 = obPro.dailyROAS[i];
        if (v === null && v2 === null) return null;
        const vals = [v, v2].filter(x => x !== null);
        return vals.reduce((a, b) => a + b, 0) / vals.length;
      });
      const firstIdx = Math.min(obIdx, obProIdx);
      products = rawProducts.filter((_, i) => i !== obIdx && i !== obProIdx);
      products.splice(firstIdx, 0, { name: 'OB + OB Pro', avgROAS: mergedAvg, dailyROAS: mergedDaily });
    }

    const gtRow = rows[blockStart + 12] || [];
    const grandTotal = {
      avgROAS: parseFloat(gtRow[COL_AVG]) || 0,
      dailyROAS: dates.map((_, i) => {
        const val = gtRow[COL_DATE_START + i];
        if (val === 'NA' || val === undefined || val === null || val === '') return null;
        return parseFloat(val) || 0;
      }),
    };

    months.push({ monthName, dates, products, grandTotal });
  }
  return months;
}

// ─── Parse Sales data (columns A:E) ──────────────────────────
// Returns: { "27/4/2026": { "Wave 2.0": { adsSpent, sales }, ... }, ... }
function parseSalesData(rows) {
  const lookup = {};
  const cleanNum = s => parseFloat(String(s || '0').replace(/[^0-9.]/g, '')) || 0;

  rows.forEach(row => {
    if (!row || row.length < 4) return;
    const dateStr = String(row[0] || '').trim();
    const rawName = String(row[1] || '').trim();
    // Must look like d/m/yyyy
    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) return;
    if (!rawName) return;

    const name = normaliseName(rawName);
    const adsSpent = cleanNum(row[2]);
    const sales    = cleanNum(row[3]);

    if (!lookup[dateStr]) lookup[dateStr] = {};
    // Accumulate (handles duplicates)
    if (!lookup[dateStr][name]) lookup[dateStr][name] = { adsSpent: 0, sales: 0 };
    lookup[dateStr][name].adsSpent += adsSpent;
    lookup[dateStr][name].sales    += sales;
  });

  return lookup;
}

// ─── API ──────────────────────────────────────────────────────
app.get('/api/roas', requireAuth, async (req, res) => {
  try {
    const { tab } = req.query;
    const tabName = TAB_NAMES[tab];
    if (!tabName) return res.status(400).json({ error: 'Invalid tab' });

    const auth   = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // Fetch ROAS table (G3:AM500) and raw sales (A:E) in one batch call
    const batch = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: process.env.SPREADSHEET_ID,
      ranges: [
        `'${tabName}'!G3:AM500`,
        `'${tabName}'!A:E`,
      ],
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const roasRows  = batch.data.valueRanges[0].values || [];
    const salesRows = batch.data.valueRanges[1].values || [];

    const data      = parseROASData(roasRows);
    const salesData = parseSalesData(salesRows);

    res.json({ success: true, tab, data, salesData });
  } catch (err) {
    console.error('[Sheets Error]', err.message);
    res.status(500).json({ error: 'Failed to fetch sheet data', detail: err.message });
  }
});


// ─── Parse Campaign Performances ─────────────────────────────
const MONTH_NAMES_LIST = ['January','February','March','April','May','June',
                           'July','August','September','October','November','December'];

function parseCampaignData(rows) {
  const campaigns = [];
  let currentMonth = '';
  let pendingCampaign = null;

  const cleanNum = s => {
    const str = String(s || '').trim();
    if (str === '-' || str === '' || str === 'NA') return null;
    const n = parseFloat(str.replace(/[^0-9.]/g, ''));
    return isNaN(n) ? null : n;
  };

  const cleanStr = s => String(s || '').trim();

  rows.forEach(row => {
    if (!row || row.length === 0) return;

    const colA = cleanStr(row[0]);
    const colB = cleanStr(row[1]);

    // Skip header rows
    if (colA === 'Type' || colB === 'Campaign') return;

    // Check for month divider: A is empty, and any col has a month name
    if (!colA) {
      // Look for month name anywhere in the row
      const rowText = row.map(c => cleanStr(c)).join(' ').toUpperCase();
      const foundMonth = MONTH_NAMES_LIST.find(m => rowText.includes(m.toUpperCase()));

      if (foundMonth) {
        // It's a month divider row — save any pending and update month
        if (pendingCampaign) { campaigns.push(pendingCampaign); pendingCampaign = null; }
        currentMonth = foundMonth;
        return;
      }

      // Otherwise it's a units data row for the pending campaign
      if (pendingCampaign) {
        pendingCampaign.unitsBefore = cleanNum(row[5]);
        pendingCampaign.unitsDuring = cleanNum(row[6]);
        pendingCampaign.unitsAfter  = cleanNum(row[7]);
        campaigns.push(pendingCampaign);
        pendingCampaign = null;
      }
      return;
    }

    // Campaign or Launch row
    if (colA === 'Campaign' || colA === 'Launch') {
      if (pendingCampaign) campaigns.push(pendingCampaign);

      // Parse platform badges — they come as text like "MY Web  SG Web"
      const rawPlatform = cleanStr(row[2]);
      const platforms = [];
      if (rawPlatform.includes('MY Web') || rawPlatform.includes('MY Web')) platforms.push('MY Web');
      if (rawPlatform.includes('SG Web'))     platforms.push('SG Web');
      if (rawPlatform.includes('MY Offline')) platforms.push('MY Offline');
      if (platforms.length === 0 && rawPlatform) platforms.push(rawPlatform);

      // Derive month + year from Start Date "DD/MM/YYYY" — reliable, no header parsing needed
      const rawStart = cleanStr(row[3]);
      let year = '', month = currentMonth;
      if (rawStart && rawStart !== '-') {
        const yp = rawStart.split('/');
        if (yp.length === 3 && yp[2].length === 4) {
          year = yp[2];
          const mIdx = parseInt(yp[1], 10) - 1;
          if (mIdx >= 0 && mIdx < 12) month = MONTH_NAMES_LIST[mIdx];
        }
      }

      pendingCampaign = {
        month,
        year,
        type:         colA,
        name:         cleanStr(row[1]),
        platforms,
        startDate:    rawStart,
        endDate:      cleanStr(row[4]),
        beforeRange:  cleanStr(row[5]),
        duringRange:  cleanStr(row[6]),
        afterRange:   cleanStr(row[7]),
        giftItem:     cleanStr(row[8]),
        giftClaimed:  cleanNum(row[9]),
        insight:      cleanStr(row[10]),
        unitsBefore:  null,
        unitsDuring:  null,
        unitsAfter:   null,
      };
    }
  });

  if (pendingCampaign) campaigns.push(pendingCampaign);
  return campaigns;
}

// ─── API: Campaign Performances ───────────────────────────────
app.get('/api/campaigns', requireAuth, async (req, res) => {
  try {
    const auth   = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range:         "'Campaign Performances'!A:K",
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const rows = response.data.values || [];
    const data = parseCampaignData(rows);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[Campaign Error]', err.message);
    res.status(500).json({ error: 'Failed to fetch campaign data', detail: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// EXTERNAL SPREADSHEET IDs
// ═══════════════════════════════════════════════════════════════
const LIVE_HOST_REVENUE_ID = '1OfzMUVUmeF_GwsDDEhyCQFdTW7hXKGqFUfkDVQNYUA4';
const LIVE_HOST_SLOTS_ID   = '1IznHjn982ZKcm5ezznRGriEFm8OeB-1ShgoHmzVCkjE';
const TIKTOK_ID            = '1fAd8o_GOW30pzt2vEvG8N0f6DSQuG8lNDR4kikhLdKk';
const SINGAPORE_ID         = '1Ok11uMRU6-eTV5RIF-EaYjq7EPWPD293BPMU-0NQirs';

function extCleanNum(s) {
  const n = parseFloat(String(s || '').replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ─── Live Host parsers ────────────────────────────────────────
function parseHostRevenue(rows) {
  const hostMap = {};
  rows.forEach((row, i) => {
    if (i === 0) return; // skip header
    const host = String(row[3] || '').trim();
    if (!host || host === 'Host') return;
    const tier     = String(row[4] || '').trim();
    const hours    = extCleanNum(String(row[6] || '').replace(/[^0-9.]/g, ''));
    const revenue  = extCleanNum(String(row[8] || '').replace(/[^0-9.]/g, ''));
    const lesStr   = row[32] ? String(row[32]).replace(/[^0-9.]/g, '') : '';
    const les      = lesStr ? extCleanNum(lesStr) : null;
    if (!hostMap[host]) hostMap[host] = { host, tier, sessions:0, totalHours:0, totalRevenue:0, lesValues:[] };
    hostMap[host].sessions++;
    hostMap[host].totalHours   += hours;
    hostMap[host].totalRevenue += revenue;
    if (les !== null && les > 0) hostMap[host].lesValues.push(les);
  });
  return Object.values(hostMap).map(h => ({
    host: h.host, tier: h.tier, sessions: h.sessions,
    totalHours:   +h.totalHours.toFixed(1),
    totalRevenue: +h.totalRevenue.toFixed(2),
    avgLes: h.lesValues.length ? +(h.lesValues.reduce((a,b)=>a+b,0)/h.lesValues.length).toFixed(2) : 0,
  })).sort((a,b) => b.avgLes - a.avgLes);
}

function parseMissedLives(rows) {
  let totalScheduled = 0, totalConducted = 0, missed = 0;
  rows.forEach(row => {
    const label = String(row[0] || '').toLowerCase();
    const val   = parseInt(String(row[1] || '').replace(/[^0-9]/g, '')) || 0;
    if (label.includes('scheduled')) totalScheduled = val;
    if (label.includes('conducted')) totalConducted = val;
    if (label.includes('missed'))    missed = val;
  });
  return { totalScheduled, totalConducted, missed };
}

app.get('/api/live-host', requireAuth, async (req, res) => {
  try {
    const auth   = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const { slotsMonth } = req.query;
    const now = new Date();
    const slotTab = slotsMonth || `${MONTH_NAMES_LIST[now.getMonth()]} (${now.getFullYear()})`;

    const revenueRes = await sheets.spreadsheets.values.get({
      spreadsheetId: LIVE_HOST_REVENUE_ID,
      range: "'Host Revenue'!A:AG",
      valueRenderOption: 'FORMATTED_VALUE',
    });

    let missedLives = { totalScheduled:0, totalConducted:0, missed:0 };
    try {
      const slotsRes = await sheets.spreadsheets.values.get({
        spreadsheetId: LIVE_HOST_SLOTS_ID,
        range: `'${slotTab}'!K20:L30`,
        valueRenderOption: 'FORMATTED_VALUE',
      });
      missedLives = parseMissedLives(slotsRes.data.values || []);
    } catch(e) { console.warn('[Live Slots] Tab not found:', slotTab); }

    // Generate last 12 months as slot tab names e.g. "May (2026)"
    const nowLH = new Date();
    const slotTabs = [];
    const MONTHS_LH = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
    for (let i = 0; i < 12; i++) {
      const d = new Date(nowLH.getFullYear(), nowLH.getMonth() - i, 1);
      slotTabs.push(`${MONTHS_LH[d.getMonth()]} (${d.getFullYear()})`);
    }

    const hosts = parseHostRevenue(revenueRes.data.values || []);
    res.json({ success:true, hosts, missedLives, slotsMonth: slotTab, slotTabs });
  } catch(err) {
    console.error('[Live Host]', err.message);
    res.status(500).json({ error:'Failed', detail: err.message });
  }
});

// ─── TikTok parsers ───────────────────────────────────────────
function parseTikTokData(rows) {
  let totalRevenue = 0, totalProfit = 0;
  // Row 1 (index 0): total revenue across cols A–H (cells starting with RM)
  // Row 2 (index 1): total profit across cols A–H
  [[rows[0], 'rev'], [rows[1], 'prof']].forEach(([row, key]) => {
    (row || []).forEach(cell => {
      const s = String(cell || '').trim();
      if (s.startsWith('RM')) {
        const v = extCleanNum(s);
        if (v > 0) {
          if (key === 'rev' && !totalRevenue) totalRevenue = v;
          if (key === 'prof' && !totalProfit) totalProfit  = v;
        }
      }
    });
  });
  // Row 4+ (index 3+): daily data — date in col A, matching Singapore layout
  const daily = [];
  for (let i = 3; i < rows.length; i++) {
    const row = rows[i] || [];
    const ds = String(row[0] || '').trim();
    if (!ds || !/\d{1,2}\/\d{2}\/\d{4}/.test(ds)) continue;
    daily.push({
      date:     ds,
      sales:    extCleanNum(row[1]),
      adsCost:  extCleanNum(row[2]),
      cogs:     extCleanNum(row[3]),
      platFees: extCleanNum(row[4]),
      hostCost: extCleanNum(row[5]),
      kolFees:  extCleanNum(row[6]),
      profit:   extCleanNum(row[7]),
      roas:     extCleanNum(row[8]),
    });
  }
  return { totalRevenue, totalProfit, daily };
}

// ─── TikTok: list available month tabs ───────────────────────
app.get('/api/tiktok/tabs', requireAuth, async (req, res) => {
  try {
    const auth   = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const meta   = await sheets.spreadsheets.get({ spreadsheetId: TIKTOK_ID });
    const allTabNames = meta.data.sheets.map(s => s.properties.title);

    // Match full month names: "January 2026", "February 2026", etc.
    const MONTH_PATTERN = /^([A-Za-z]+)\s+(\d{4})$/;
    const FULL_MONTHS   = ['January','February','March','April','May','June',
                           'July','August','September','October','November','December'];
    const availMonths   = [];
    allTabNames.forEach(t => {
      const m = t.match(MONTH_PATTERN);
      if (!m) return;
      const rawMonth = m[1], year = m[2];
      // Case-insensitive match to a full month name
      const full = FULL_MONTHS.find(fm => fm.toLowerCase() === rawMonth.toLowerCase());
      if (!full) return;
      availMonths.push({ tab: t, month: full, year });
    });
    // Sort newest first
    availMonths.sort((a, b) => {
      const byYear = parseInt(b.year) - parseInt(a.year);
      if (byYear !== 0) return byYear;
      return FULL_MONTHS.indexOf(b.month) - FULL_MONTHS.indexOf(a.month);
    });

    res.json({ success: true, availMonths });
  } catch(err) {
    console.error('[TikTok Tabs]', err.message);
    res.status(500).json({ error: 'Failed', detail: err.message });
  }
});

app.get('/api/tiktok', requireAuth, async (req, res) => {
  try {
    const auth   = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const { tab } = req.query;
    if (!tab) return res.status(400).json({ error: 'tab required' });

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: TIKTOK_ID,
      range: `'${tab}'!A1:J35`,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const data = parseTikTokData(resp.data.values || []);
    res.json({ success: true, tab, ...data });
  } catch(err) {
    console.error('[TikTok]', err.message);
    res.status(500).json({ error: 'Failed', detail: err.message });
  }
});

// ─── Singapore parsers ────────────────────────────────────────
function parseSingaporeData(rows) {
  // Row 1 (index 0): "TOTAL Revenue" with $ and RM values across cols A-I
  // Row 2 (index 1): "TOTAL Profit (exclude operation)" with $ value
  let totalRevenueSGD = 0, totalRevenueRM = 0, totalProfit = 0, profitMargin = 0;

  (rows[0] || []).forEach(cell => {
    const s = String(cell || '').trim();
    if (s.startsWith('$') && !totalRevenueSGD)  totalRevenueSGD = extCleanNum(s);
    if (s.startsWith('RM') && !totalRevenueRM)   totalRevenueRM  = extCleanNum(s);
  });
  (rows[1] || []).forEach(cell => {
    const s = String(cell || '').trim();
    if (s.startsWith('$') && !totalProfit)        totalProfit  = extCleanNum(s);
    if (s.endsWith('%') && !profitMargin)          profitMargin = extCleanNum(s);
  });

  // Row 4+ (index 3+): daily data — date in col A (index 0) for this range
  const daily = [];
  for (let i = 3; i < rows.length; i++) {
    const row = rows[i] || [];
    const ds = String(row[0] || '').trim();
    if (!ds || !/\d{1,2}\/\d{2}\/\d{4}/.test(ds)) continue;
    // Cols: A=Date, B=Shopee Ads MY SG($), C=Google Ads($), D=Meta Ads($),
    //       E=Meta Ads(RM), F=Shopee MY SG, G=Shopee SG, H=Website SG(Shopify), I=Total Sales
    const totalSales = extCleanNum(row[8]);
    if (totalSales === 0 && !row[1]) continue; // skip truly empty rows
    daily.push({
      date:       ds,
      shopeeAdsSGD: extCleanNum(row[1]),
      googleAds:    extCleanNum(row[2]),
      metaAdsSGD:   extCleanNum(row[3]),
      metaAdsRM:    extCleanNum(row[4]),
      shopeeMY:     extCleanNum(row[5]),
      shopeeSG:     extCleanNum(row[6]),
      websiteSG:    extCleanNum(row[7]),
      totalSales,
    });
  }

  return { totalRevenueSGD, totalRevenueRM, totalProfit, profitMargin, daily };
}

// ─── Singapore: list available month tabs ─────────────────────
app.get('/api/singapore/tabs', requireAuth, async (req, res) => {
  try {
    const auth   = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const meta   = await sheets.spreadsheets.get({ spreadsheetId: SINGAPORE_ID });
    const allTabNames = meta.data.sheets.map(s => s.properties.title);

    // Match tabs like "May 2026", "Feb 2026", "January 2026" etc.
    const MONTH_PATTERN = /^([A-Za-z]+)\s+(\d{4})$/;
    const MONTH_NAMES_MAP = {
      jan:'January',feb:'February',mar:'March',apr:'April',may:'May',jun:'June',
      jul:'July',aug:'August',sep:'September',oct:'October',nov:'November',dec:'December',
    };
    const availMonths = [];
    allTabNames.forEach(t => {
      const m = t.match(MONTH_PATTERN);
      if (!m) return;
      const rawMonth = m[1], year = m[2];
      // Normalise to full month name
      const key = rawMonth.toLowerCase().slice(0,3);
      const fullMonth = MONTH_NAMES_MAP[key] || rawMonth;
      availMonths.push({ tab: t, month: fullMonth, year });
    });
    // Sort newest first
    availMonths.sort((a, b) => {
      const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const byYear = parseInt(b.year) - parseInt(a.year);
      if (byYear !== 0) return byYear;
      return MONTHS.indexOf(b.month) - MONTHS.indexOf(a.month);
    });

    res.json({ success: true, availMonths });
  } catch(err) {
    console.error('[SG Tabs]', err.message);
    res.status(500).json({ error: 'Failed', detail: err.message });
  }
});

app.get('/api/singapore', requireAuth, async (req, res) => {
  try {
    const auth   = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const { tab } = req.query;
    if (!tab) return res.status(400).json({ error: 'tab required' });

    // Fetch rows 1-2 (totals) + row 3 (headers) + daily data: A1:I35
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SINGAPORE_ID,
      range: `'${tab}'!A1:I35`,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const data = parseSingaporeData(resp.data.values || []);
    res.json({ success: true, tab, ...data });
  } catch(err) {
    console.error('[Singapore]', err.message);
    res.status(500).json({ error: 'Failed', detail: err.message });
  }
});

app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
