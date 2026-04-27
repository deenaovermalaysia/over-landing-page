// server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 hour session
}));

// ─── Auth Middleware ──────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  res.redirect('/login.html');
}

// ─── Static Files (login.html is public) ─────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  index: false // prevent auto-serving index.html
}));

// ─── Routes ──────────────────────────────────────────────────

// Redirect root to login
app.get('/', (req, res) => {
  if (req.session && req.session.loggedIn) {
    res.redirect('/dashboard.html');
  } else {
    res.redirect('/login.html');
  }
});

// Serve login page
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Handle login form
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

// Protect dashboard — must be BEFORE static middleware for this route
app.get('/dashboard.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Logout
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

// Tab name mapping
const TAB_NAMES = {
  MY:          'Product Daily ROAS (MY Website)',
  Marketplace: 'Product Daily ROAS (Marketplace)',
  SG:          'Product Daily ROAS (SG Website)',
};

// ─── Parse ROAS Sheet Data ────────────────────────────────────
// Fetching from G3:AM500, so index 0 = col G, index 1 = col H, index 2 = col I
function parseROASData(rows) {
  const COL_NAME       = 0; // G — product name or month title
  const COL_AVG        = 1; // H — average ROAS over all dates
  const COL_DATE_START = 2; // I — first date (Day 1)
  const BLOCK_SIZE     = 14; // rows per month block
  const MAX_PRODUCTS   = 10; // rows 3–12 within each block

  const months = [];

  for (let blockStart = 0; blockStart < rows.length; blockStart += BLOCK_SIZE) {
    const titleRow = rows[blockStart];
    if (!titleRow || !titleRow[COL_NAME]) break;

    const monthName = String(titleRow[COL_NAME]).trim();
    if (!monthName) break;

    // Header row: parse date labels from column I onwards
    const headerRow = rows[blockStart + 1] || [];
    const dates = [];
    for (let col = COL_DATE_START; col < headerRow.length; col++) {
      if (headerRow[col] !== undefined && headerRow[col] !== '') {
        dates.push(String(headerRow[col]));
      } else {
        break;
      }
    }

    // Product rows (up to 10)
    const products = [];
    for (let r = blockStart + 2; r <= blockStart + 1 + MAX_PRODUCTS; r++) {
      const row = rows[r] || [];
      const name = row[COL_NAME] ? String(row[COL_NAME]).trim() : '';
      if (!name) continue;

      const avgROAS = parseFloat(row[COL_AVG]) || 0;

      const dailyROAS = dates.map((_, i) => {
        const val = row[COL_DATE_START + i];
        if (val === 'NA' || val === undefined || val === null || val === '') return null;
        return parseFloat(val) || 0;
      });

      products.push({ name, avgROAS, dailyROAS });
    }

    // Grand total row (index 12 within block)
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
      return res.status(400).json({ error: `Invalid tab. Use: MY, Marketplace, or SG` });
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