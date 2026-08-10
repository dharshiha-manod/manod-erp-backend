/**
 * ====================================================
 * SETTINGS ROUTES
 * Business Settings, Locations, Tax Rates, Printers
 * ====================================================
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const authenticate = require('../middleware/auth');
const requireIndustry = require('../middleware/industry');
const settingsController = require('../controllers/settingsController');

// ── LOGO UPLOAD (multer, same pattern as essentials.js) ─────────
const LOGO_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'logos');
fs.mkdirSync(LOGO_UPLOAD_DIR, { recursive: true });

const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, LOGO_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});
const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB cap for logos
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

// ── MIDDLEWARE ─────────────────────────────────────────────────
router.use(authenticate);
// NEW
// ── GENERAL SETTINGS (industry-scoped) ──────────────────────────
router.get('/general', requireIndustry, settingsController.getGeneralSettings);
router.put('/general', requireIndustry, settingsController.updateGeneralSettings);

// ── BUSINESS SETTINGS ──────────────────────────────────────────
router.get('/business', settingsController.getBusinessSettings);
router.put('/business', settingsController.updateBusinessSettings);
router.post('/business/logo', uploadLogo.single('logo'), settingsController.uploadBusinessLogo);

// ── BUSINESS LOCATIONS (industry-scoped) ────────────────────────
router.get('/locations', requireIndustry, settingsController.getBusinessLocations);
router.post('/locations', requireIndustry, settingsController.createBusinessLocation);
router.put('/locations/:id', requireIndustry, settingsController.updateBusinessLocation);
// NEW
router.patch('/locations/:id/deactivate', requireIndustry, settingsController.deactivateBusinessLocation);
router.delete('/locations/:id', requireIndustry, settingsController.deleteBusinessLocation);

// ── TAX RATES (industry-scoped) ─────────────────────────────────
router.get('/tax-rates', requireIndustry, settingsController.getTaxRates);
router.post('/tax-rates', requireIndustry, settingsController.createTaxRate);
router.put('/tax-rates/:id', requireIndustry, settingsController.updateTaxRate);
router.delete('/tax-rates/:id', requireIndustry, settingsController.deleteTaxRate);

// ── INVOICE SETTINGS ───────────────────────────────────────────

router.get('/invoice', requireIndustry, settingsController.getInvoiceSettings);
router.put('/invoice', requireIndustry, settingsController.updateInvoiceSettings);

// ── RECEIPT PRINTERS (industry-scoped) ──────────────────────────
router.get('/printers', requireIndustry, settingsController.getReceiptPrinters);
router.post('/printers', requireIndustry, settingsController.createReceiptPrinter);
router.put('/printers/:id', requireIndustry, settingsController.updateReceiptPrinter);
router.delete('/printers/:id', requireIndustry, settingsController.deleteReceiptPrinter);

// ── BARCODE SETTINGS (industry-scoped) ──────────────────────────
router.get('/barcode', requireIndustry, settingsController.getBarcodeSettings);
router.put('/barcode', requireIndustry, settingsController.updateBarcodeSettings);

// ── EXPORT/IMPORT (industry-scoped) ─────────────────────────────
router.get('/export', requireIndustry, settingsController.exportSettings);
router.post('/import', requireIndustry, express.json(), settingsController.importSettings);

module.exports = router;