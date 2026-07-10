/**
 * ====================================================
 * SETTINGS ROUTES
 * Business Settings, Locations, Tax Rates, Printers
 * ====================================================
 */

const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const settingsController = require('../controllers/settingsController');

// ── MIDDLEWARE ─────────────────────────────────────────────────
router.use(authenticate);

// ── BUSINESS SETTINGS ──────────────────────────────────────────
router.get('/business', settingsController.getBusinessSettings);
router.put('/business', settingsController.updateBusinessSettings);

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
router.delete('/printers/:id', settingsController.deleteReceiptPrinter);

// ── EXPORT/IMPORT ────────────────────────────────────────────
router.get('/export', settingsController.exportSettings);
router.post('/import', express.json(), settingsController.importSettings);

module.exports = router;