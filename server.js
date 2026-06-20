/**
 * ====================================================
 * MANOD ERP BACKEND - MAIN SERVER (UPDATED)
 * Node.js + Express + PostgreSQL
 * ====================================================
 */

const express = require('express');
const cors = require('cors');
require('dotenv').config();


// ── Initialize Express App ──
const app = express();

// ── MIDDLEWARE ──
// Enable CORS (allow requests from frontend)
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parse JSON body
app.use(express.json());

// Parse URL encoded body
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} | ${req.method} ${req.path}`);
  next();
});

// ── DATABASE CONNECTION TEST ──
const pool = require('./config/database');

// ── ROUTES ──
// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const roleRoutes = require('./routes/roles');
const commissionAgentRoutes = require('./routes/commissionAgentsroutes'); // ← NEW
const contactRoutes = require('./routes/contacts'); 

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/sales-commission-agents', commissionAgentRoutes); // ← NEW
app.use('/api/contacts', contactRoutes); // ← NEW

// ── HEALTH CHECK ENDPOINT ──
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    message: '✅ Backend is running!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

// ── ROOT ENDPOINT ──
app.get('/', (req, res) => {
  res.json({
    message: 'Manod ERP Backend API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      users: '/api/users',
      roles: '/api/roles',
      commissionAgents: '/api/sales-commission-agents' // ← NEW
    }
  });
});

// ── 404 HANDLER ──
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});

// ── ERROR HANDLER ──
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    timestamp: new Date().toISOString()
  });
});

// ── START SERVER ──
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   🚀 MANOD ERP BACKEND STARTED               ║
╠══════════════════════════════════════════════╣
║   Server: http://localhost:${PORT}            ║
║   Environment: ${process.env.NODE_ENV}                ║
║   Database: ${process.env.DB_NAME}                   ║
║   New Module: Sales Commission Agents ✓     ║
╚══════════════════════════════════════════════╝
  `);
});

// ── Handle Shutdown ──
process.on('SIGINT', () => {
  console.log('\n📴 Shutting down server...');
  pool.end();
  process.exit(0);
});

module.exports = app;
