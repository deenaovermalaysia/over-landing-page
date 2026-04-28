// server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');
const path = require('path');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────
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

// ─── Auth Middleware ──────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.redirect('/login.html');
}

// ─── Static Files ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  index: false
}));

// ─── Routes ──────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.session && req.session.loggedIn) {
    res.redirect('/dashboard.html');
  } else {
    res.redirect('/login.html');
  }
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (
    username === process.env.DASHBOARD_USERNAME &&
    password === process.env.DASHBOARD_PASSWORD
  ) {
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
  req.session.destroy(() => {
    res.redirect('/login.html');
  });
});

// ─── Google Sheets Helper ─────────────────────────────────────
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

// ─── Product Name Normalisation ───────────────────────────────
const NAME_MAP = {
  '1.2L OVER Cup': 'OVER Cup',
  '1.2L Cup':      'OVER Cup',
  '1.2l Cup':      'OVER Cup',
  '1.2L over Cup': 'OVER Cup',
};

function normaliseName(raw) {
  return NAME_MAP[raw.trim()] || raw.trim();
}

// ─── Parse ROAS Sheet Data ────────────────────────────────────
function parseROASData(rows) {
  const COL_NAME       = 0;
  const COL_AVG        = 1;
  const COL_DATE_START = 2;
  const BLOCK_SIZE     = 14;
  const MAX_PRODUCTS   = 10;

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
      } else {
        break;
      }
    }

    // Parse raw product rows
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

    // ── Merge OB + OB Pro into one combined entry ─────────────
    const obIdx    = rawProducts.findIndex(p => p.name === 'OB');
    const obProIdx = rawProducts.findIndex(p => p.name === 'OB Pro');

    let products = [...rawProducts];

    if (obIdx !== -1 && obProIdx !== -1) {
      const ob    = rawProducts[obIdx];
      const obPro = rawProducts[obProIdx];

      const mergedAvg = (ob.avgROAS + obPro.avgROAS) / 2;
      const mergedDaily = ob.dailyROAS.map((v, i) => {
        const v2 = obPro.dailyROAS[i];
        if (v === null && v2 === null) return null;
        const vals = [v, v2].filter(x => x !== null);
        return vals.reduce((a, b) => a + b, 0) / vals.length;
      });

      const merged = { name: 'OB + OB Pro', avgROAS: mergedAvg, dailyROAS: mergedDaily };

      // Replace OB with merged, remove OB Pro
      const firstIdx = Math.min(obIdx, obProIdx);
      products = rawProducts.filter((_, i) => i !== obIdx && i !== obProIdx);
      products.splice(firstIdx, 0, merged);
    }

    // Grand total row
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

// ─── API: ROAS Data ───────────────────────────────────────────
app.get('/api/roas', requireAuth, async (req, res) => {
  try {
    const { tab } = req.query;
    const tabName = TAB_NAMES[tab];

    if (!tabName) {
      return res.status(400).json({ error: 'Invalid tab. Use: MY, Marketplace, or SG' });
    }

    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `'${tabName}'!G3:AM500`,
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const rows = response.data.values || [];
    const data = parseROASData(rows);

    res.json({ success: true, tab, data });
  } catch (err) {
    console.error('[Sheets Error]', err.message);
    res.status(500).json({ error: 'Failed to fetch sheet data', detail: err.message });
  }
});

// ─── Start Server ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
