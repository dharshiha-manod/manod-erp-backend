/**
 * ====================================================
 * MANOD ERP BACKEND - MAIN SERVER
 * Node.js + Express + PostgreSQL
 * ====================================================
 */

const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const app = express();

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(cors({
  origin:         process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files (Essentials → Documents attachments live here)
app.use('/uploads', express.static('uploads'));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} | ${req.method} ${req.path}`);
  next();
});

// ── DATABASE ──────────────────────────────────────────────────
const pool = require('./config/database');

// ── ROUTES ───────────────────────────────────────────────────
const authRoutes            = require('./routes/auth');
const userRoutes            = require('./routes/users');
const roleRoutes            = require('./routes/roles');
const commissionAgentRoutes = require('./routes/commissionAgentsroutes');
const contactRoutes         = require('./routes/contacts');
const productRoutes         = require('./routes/products');   // ← PRODUCT MODULE
const stockTransferRoutes   = require('./routes/stockTransfers'); // ← STOCK TRANSFER MODULE (NEW)
const stockAdjustmentRoutes = require('./routes/stockAdjustments'); // ← STOCK ADJUSTMENT
const manufacturingRoutes   = require('./routes/manufacturing');
const expenseRoutes         = require('./routes/expenses');
const purchaseRoutes        = require('./routes/purchases');
const purchaseReturnRoutes  = require('./routes/purchaseReturns');
const notificationTemplateRoutes = require('./routes/notificationTemplates'); // ← NOTIFICATION TEMPLATES
const hrmRoutes = require('./routes/hrm');
const crmRoutes = require('./routes/crm');
const essentialsRoutes = require('./routes/essentials'); // ← ESSENTIALS MODULE (NEW)
const sellRoutes = require('./routes/sell');
const registerRoutes = require('./routes/register');
const settingsRoutes = require('./routes/settingsRoutes'); // adjust path
const reportsRoutes = require('./routes/reports'); // ← REPORTS MODULE (NEW)
const accountingRoutes = require('./routes/accounting'); // ← ACCOUNTING MODULE (NEW)



app.use('/api/auth',                    authRoutes);
app.use('/api/users',                   userRoutes);
app.use('/api/roles',                   roleRoutes);
app.use('/api/sales-commission-agents', commissionAgentRoutes);
app.use('/api/contacts',                contactRoutes);
app.use('/api/products',                productRoutes);       // ← PRODUCT MODULE
app.use('/api/stock-transfers',         stockTransferRoutes); // ← STOCK TRANSFER MODULE (NEW)
app.use('/api/stock-adjustments',       stockAdjustmentRoutes); // ← STOCK ADJUSTMENT
app.use('/api/manufacturing',           manufacturingRoutes);
app.use('/api/expenses',                expenseRoutes);
app.use('/api/purchases',               purchaseRoutes);
app.use('/api/purchase-returns',        purchaseReturnRoutes);
app.use('/api/notification-templates',  notificationTemplateRoutes); // ← NOTIFICATION TEMPLATES
app.use('/api/hrm', hrmRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/essentials', essentialsRoutes); // ← ESSENTIALS MODULE (NEW)
app.use('/api', sellRoutes);
app.use('/api/register', registerRoutes);
app.use('/api/selling-price-groups', require('./routes/sellingPriceGroupRoutes'));// ← SELL MODULE (NEW) — sales-invoice, pos-sales, quotations, sales-returns, shipments, discounts, import/sales
app.use('/api/product-selling-prices', require('./routes/productSellingPriceRoutes'));
app.use('/api/settings', settingsRoutes);
app.use('/api/reports', reportsRoutes); // ← REPORTS MODULE (NEW)
app.use('/api/accounting', accountingRoutes); // ← ACCOUNTING MODULE (NEW)  
app.use('/api/product-selling-prices', require('./routes/productSellingPrices'));
// ── HEALTH CHECK ─────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.status(200).json({
    message:     '✅ Backend is running!',
    timestamp:   new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

// ── ROOT ─────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    message:  'Manod ERP Backend API',
    version:  '1.0.0',
    endpoints: {
      health:                   '/api/health',
      auth:                     '/api/auth',
      users:                    '/api/users',
      roles:                    '/api/roles',
      commissionAgents:         '/api/sales-commission-agents',
      contacts:                 '/api/contacts',
      products:                 '/api/products',
      brands:                   '/api/products/brands',
      units:                    '/api/products/units',
      variations:               '/api/products/variations',
      categories:               '/api/products/categories',
      warranties:               '/api/products/warranties',
      stockTransfers:           '/api/stock-transfers',
      stockAdjustments:         '/api/stock-adjustments',
      manufacturing:            '/api/manufacturing',
      expenses:                 '/api/expenses',
      purchases:                '/api/purchases',
      purchaseReturns:          '/api/purchase-returns',
      notificationTemplates:    '/api/notification-templates',
      essentials:               '/api/essentials',
      salesInvoice:             '/api/sales-invoice',
      posSales:                 '/api/pos-sales',
      quotations:               '/api/quotations',
      salesReturns:             '/api/sales-returns',
      shipments:                '/api/shipments',
      discounts:                '/api/discounts',
      importSales:              '/api/import/sales'
    }
  });
});

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.path, method: req.method });
});

// ── ERROR HANDLER ────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(err.status || 500).json({
    error:     err.message || 'Internal Server Error',
    timestamp: new Date().toISOString()
  });
});

// ── START ────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   🚀 MANOD ERP BACKEND STARTED               ║
╠══════════════════════════════════════════════╣
║   Server: http://localhost:${PORT}            ║
║   Environment: ${process.env.NODE_ENV || 'development'}              ║
║   Products Module ✓                         ║
║   Warranties Module ✓                       ║
║   Opening Stock Import ✓                    ║
║   Stock Transfer Module ✓                   ║
║   Notification Templates Module ✓           ║
║   Essentials Module ✓                       ║
║   Sell Module ✓                             ║
╚══════════════════════════════════════════════╝
  `);
});

process.on('SIGINT', () => {
  console.log('\n📴 Shutting down...');
  pool.end();
  process.exit(0);
});

module.exports = app;