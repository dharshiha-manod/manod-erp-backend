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

// ── BUSINESS SETTINGS ──────────────────────────────────────────
router.get('/business', settingsController.getBusinessSettings);
router.put('/business', settingsController.updateBusinessSettings);
router.post('/business/logo', uploadLogo.single('logo'), settingsController.uploadBusinessLogo);

// ── BUSINESS LOCATIONS ────────────────────────────────────────
router.get('/locations', settingsController.getBusinessLocations);
router.post('/locations', settingsController.createBusinessLocation);
router.put('/locations/:id', settingsController.updateBusinessLocation);
router.patch('/locations/:id/deactivate', settingsController.deactivateBusinessLocation);

// ── TAX RATES ──────────────────────────────────────────────────
router.get('/tax-rates', settingsController.getTaxRates);
router.post('/tax-rates', settingsController.createTaxRate);
router.put('/tax-rates/:id', settingsController.updateTaxRate);
router.delete('/tax-rates/:id', settingsController.deleteTaxRate);

// ── INVOICE SETTINGS ───────────────────────────────────────────
router.get('/invoice', settingsController.getInvoiceSettings);
router.put('/invoice', settingsController.updateInvoiceSettings);

// ── RECEIPT PRINTERS ───────────────────────────────────────────
router.get('/printers', settingsController.getReceiptPrinters);
router.post('/printers', settingsController.createReceiptPrinter);
router.put('/printers/:id', settingsController.updateReceiptPrinter);
router.delete('/printers/:id', settingsController.deleteReceiptPrinter);

// ── BARCODE SETTINGS ───────────────────────────────────────────
router.get('/barcode', settingsController.getBarcodeSettings);
router.put('/barcode', settingsController.updateBarcodeSettings);

// ── EXPORT/IMPORT ────────────────────────────────────────────
router.get('/export', settingsController.exportSettings);
router.post('/import', express.json(), settingsController.importSettings);

module.exports = router;