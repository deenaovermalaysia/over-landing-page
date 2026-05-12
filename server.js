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

  // Regex: matches ONLY "MonthName" or "MonthName YYYY" — nothing else
  const MONTH_HEADER_RE = new RegExp('^(' + MONTH_NAMES_LIST.join('|') + ')\s*(\d{4})?$', 'i');

  function detectMonthHeader(row) {
    // Check each cell individually — the header can be in ANY column
    // (merged cells in Sheets return value only in the first cell of the merge)
    for (const cell of row) {
      const val = cleanStr(cell);
      if (!val) continue;
      const m = val.match(MONTH_HEADER_RE);
      if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    }
    return null;
  }

  rows.forEach(row => {
    if (!row || row.length === 0) return;

    const colA = cleanStr(row[0]);
    const colB = cleanStr(row[1]);

    // Skip header rows
    if (colA === 'Type' || colB === 'Campaign') return;

    // ── Month divider row ──────────────────────────────────────
    // Can appear with colA empty OR with month name in colA (merged cell starting at A)
    const isNotCampaignRow = colA !== 'Campaign' && colA !== 'Launch';
    if (isNotCampaignRow) {
      const foundMonth = detectMonthHeader(row);
      if (foundMonth) {
        if (pendingCampaign) { campaigns.push(pendingCampaign); pendingCampaign = null; }
        currentMonth = foundMonth;
        return;
      }

      // Empty colA + no month → units data row for pending campaign
      if (!colA && pendingCampaign) {
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

      // Extract year from startDate e.g. "09/04/2026" → "2026"
      const rawStart = cleanStr(row[3]);
      let year = '';
      if (rawStart && rawStart !== '-') {
        const yp = rawStart.split('/');
        if (yp.length === 3 && yp[2].length === 4) year = yp[2];
      }

      pendingCampaign = {
        month:        currentMonth,
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
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
