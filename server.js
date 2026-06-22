/**
 * ====================================================
 * MANOD ERP BACKEND - MAIN SERVER
 * Node.js + Express + PostgreSQL
 * ====================================================
 */

const express = require('express');
const cors = require('cors');
require('dotenv').config();

// ── Initialize Express App ──
const app = express();

// ── MIDDLEWARE ──
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} | ${req.method} ${req.path}`);
  next();
});

// ── DATABASE ──
const pool = require('./config/database');

// ── ROUTES ──
const authRoutes            = require('./routes/auth');
const userRoutes            = require('./routes/users');
const roleRoutes            = require('./routes/roles');
const commissionAgentRoutes = require('./routes/commissionAgentsroutes');
const contactRoutes         = require('./routes/contacts');
const purchaseRoutes        = require('./routes/purchases');
const stockTransferRoutes   = require('./routes/stockTransfers');
const productRoutes = require('./routes/products');

// FIXED: products route file doesn't exist yet — add it back once you create routes/products.js
// const productRoutes = require('./routes/products');

app.use('/api/auth',                    authRoutes);
app.use('/api/users',                   userRoutes);
app.use('/api/roles',                   roleRoutes);
app.use('/api/sales-commission-agents', commissionAgentRoutes);
app.use('/api/purchases',               purchaseRoutes);
app.use('/api/contacts',                contactRoutes);
app.use('/api/stock-transfers',         stockTransferRoutes);
app.use('/api/products', productRoutes);

// app.use('/api/products', productRoutes); // ← uncomment once routes/products.js exists

// ── HEALTH CHECK ──
app.get('/api/health', (req, res) => {
  res.status(200).json({
    message: '✅ Backend is running!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// ── ROOT ──
app.get('/', (req, res) => {
  res.json({
    message: 'Manod ERP Backend API',
    version: '1.0.0',
    endpoints: {
      health:           '/api/health',
      auth:             '/api/auth',
      users:            '/api/users',
      roles:            '/api/roles',
      contacts:         '/api/contacts',
      purchases:        '/api/purchases',
      stockTransfers:   '/api/stock-transfers',
      commissionAgents: '/api/sales-commission-agents',
    },
  });
});

// ── 404 ──
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.path, method: req.method });
});

// ── ERROR HANDLER ──
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    timestamp: new Date().toISOString(),
  });
});

// ── START ──
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   🚀 MANOD ERP BACKEND STARTED               ║
╠══════════════════════════════════════════════╣
║   Server: http://localhost:${PORT}            ║
║   Environment: ${process.env.NODE_ENV || 'development'}             ║
╚══════════════════════════════════════════════╝
  `);
});

process.on('SIGINT', () => {
  console.log('\n📴 Shutting down server...');
  pool.end();
  process.exit(0);
});

module.exports = app;