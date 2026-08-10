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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Industry-Id']
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
const manufacturingService  = require('./services/manufacturingService');
const expenseRoutes         = require('./routes/expenses');
const purchaseRoutes        = require('./routes/purchases');
const purchaseReturnRoutes  = require('./routes/purchaseReturns');
const notificationTemplateRoutes = require('./routes/notificationTemplates'); // ← NOTIFICATION TEMPLATES
const hrmRoutes = require('./routes/hrm');
const essRoutes = require('./routes/ess');
const { startSalesTargetsSyncJob } = require('./services/salesTargetsSyncService'); // ← SALES TARGETS BACKGROUND SYNC (NEW)
const crmRoutes = require('./routes/crm');
const essentialsRoutes = require('./routes/essentials'); // ← ESSENTIALS MODULE (NEW)
const sellRoutes = require('./routes/sell');
const registerRoutes = require('./routes/register');
const settingsRoutes = require('./routes/settingsRoutes'); // adjust path
const reportsRoutes = require('./routes/reports'); // ← REPORTS MODULE (NEW)
const accountingRoutes = require('./routes/accounting'); // ← ACCOUNTING MODULE (NEW)
const industryRoutes = require('./routes/industries'); // ← INDUSTRY WORKSPACE MODULE (NEW)
const requireIndustry = require('./middleware/industry'); // ← INDUSTRY ISOLATION (NEW)
require('./services/industryService').ensureIndustrySchema(); // boot-time self-migration

app.use('/api/auth',                    authRoutes);
app.use('/api/users',                   userRoutes);
app.use('/api/roles',                   roleRoutes);
app.use('/api/sales-commission-agents', commissionAgentRoutes);
app.use('/api/contacts',                requireIndustry, contactRoutes); // ← CONTACTS MODULE (now industry-scoped)
app.use('/api/industries',              industryRoutes);      // ← INDUSTRY WORKSPACE MODULE (NEW)
app.use('/api/products',                requireIndustry, productRoutes);       // ← PRODUCT MODULE (now industry-scoped)
app.use('/api/stock-transfers',         requireIndustry, stockTransferRoutes); // ← STOCK TRANSFER MODULE (now industry-scoped)
app.use('/api/stock-adjustments',       requireIndustry, stockAdjustmentRoutes); // ← STOCK ADJUSTMENT (now industry-scoped)
app.use('/api/manufacturing',           requireIndustry, manufacturingRoutes);
app.use('/api/expenses',                requireIndustry, expenseRoutes); // ← EXPENSES MODULE (now industry-scoped)
app.use('/api/purchases',               requireIndustry, purchaseRoutes);
app.use('/api/purchase-returns',        requireIndustry, purchaseReturnRoutes);
app.use('/api/notification-templates',  notificationTemplateRoutes); // ← NOTIFICATION TEMPLATES
// NEW
app.use('/api/hrm', requireIndustry, hrmRoutes);
app.use('/api/ess', requireIndustry, essRoutes);
app.use('/api/crm', requireIndustry, crmRoutes);
app.use('/api/essentials', requireIndustry, essentialsRoutes); // ← ESSENTIALS MODULE (now industry-scoped)
app.use('/api', requireIndustry, sellRoutes); // ← SELL MODULE now industry-scoped
app.use('/api/register', registerRoutes);
app.use('/api/selling-price-groups', require('./routes/sellingPriceGroupRoutes'));// ← SELL MODULE (NEW) — sales-invoice, pos-sales, quotations, sales-returns, shipments, discounts, import/sales
app.use('/api/product-selling-prices', require('./routes/productSellingPriceRoutes'));
app.use('/api/settings', settingsRoutes);
app.use('/api/audit-logs', require('./routes/auditLogs'));
app.use('/api/reports', requireIndustry, reportsRoutes); // ← REPORTS MODULE (now industry-scoped)
app.use('/api/accounting', accountingRoutes); // ← ACCOUNTING MODULE (NEW)  
app.use('/api/product-selling-prices', require('./routes/productSellingPrices'));
// ── HEALTH CHECK ─────────────────────────────────────────────
startSalesTargetsSyncJob(); // ← begins background recalculation of Sales Target achievements (read-only against sales_invoices)

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
  console.log(`Server running on port ${PORT}`);

  // Auto-finish overdue Work Orders once on startup, then every 6 hours.
  // No new dependency — plain setInterval, same as the rest of this codebase.
  const AUTO_FINISH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
  manufacturingService.autoFinishOverdueWorkOrders().catch(err =>
    console.error('[AutoFinish] startup sweep failed:', err.message)
  );
setInterval(() => {
    manufacturingService.autoFinishOverdueWorkOrders().catch(err =>
      console.error('[AutoFinish] scheduled sweep failed:', err.message)
    );
  }, AUTO_FINISH_INTERVAL_MS);

  // Attendance Automation (Phase 4) — auto-marks Absent once office hours
  // + grace period have passed, skipping Holiday/Weekly-Off/Approved-Leave.
  // Checked every 15 minutes; the function itself no-ops until the cutoff
  // time, so this is cheap to run frequently.
const AUTO_ABSENT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  const hrmService = require('./services/hrmService');
  setInterval(() => {
    hrmService.autoMarkAbsentees().catch(err =>
      console.error('[AutoAbsent] scheduled sweep failed:', err.message)
    );
  }, AUTO_ABSENT_INTERVAL_MS);

const HRM_DAILY_CHECKS_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  hrmService.runHrmDailyChecks().catch(err =>
    console.error('[HrmDailyChecks] startup sweep failed:', err.message)
  );
  setInterval(() => {
    hrmService.runHrmDailyChecks().catch(err =>
      console.error('[HrmDailyChecks] scheduled sweep failed:', err.message)
    );
  }, HRM_DAILY_CHECKS_INTERVAL_MS);

  // Memos: publish any Draft memo whose scheduled publish_at time has
  // arrived. Same fire-on-startup + interval pattern as AutoAbsent above.
  const MEMO_PUBLISH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  const essentialsService = require('./services/essentialsService');
  essentialsService.runScheduledMemoPublish().catch(err =>
    console.error('[MemoPublish] startup sweep failed:', err.message)
  );
  setInterval(() => {
    essentialsService.runScheduledMemoPublish().catch(err =>
      console.error('[MemoPublish] scheduled sweep failed:', err.message)
    );
  }, MEMO_PUBLISH_INTERVAL_MS);
});
process.on('SIGINT', () => {
  console.log('\n📴 Shutting down...');
  pool.end();
  process.exit(0);
});

module.exports = app;