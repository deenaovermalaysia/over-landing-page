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

app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
