/**
 * ====================================================
 * SETTINGS CONTROLLER
 * Handles all Settings API requests
 * ====================================================
 */

const settingsService = require('./settingsService');

// ── BUSINESS SETTINGS ──────────────────────────────────────────
exports.getBusinessSettings = async (req, res) => {
  try {
    const businessId = req.user.business_id;
    const settings = await settingsService.getBusinessSettings(businessId);

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Business settings not found',
        code: 'SETTINGS_NOT_FOUND'
      });
    }

    res.status(200).json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('❌ Error fetching business settings:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch business settings',
      error: error.message
    });
  }
};

exports.updateBusinessSettings = async (req, res) => {
  try {
    const businessId = req.user.business_id;
    const settings = await settingsService.updateBusinessSettings(businessId, req.body);

    res.status(200).json({
      success: true,
      message: 'Business settings updated successfully',
      data: settings
    });
  } catch (error) {
    console.error('❌ Error updating business settings:', error.message);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to update business settings',
      code: 'UPDATE_FAILED'
    });
  }
};

// ── BUSINESS LOCATIONS ────────────────────────────────────────
exports.getBusinessLocations = async (req, res) => {
  try {
    const businessId = req.user.business_id;
    const locations = await settingsService.getBusinessLocations(businessId);

    res.status(200).json({
      success: true,
      data: locations,
      count: locations.length
    });
  } catch (error) {
    console.error('❌ Error fetching business locations:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch business locations',
      error: error.message
    });
  }
};

exports.createBusinessLocation = async (req, res) => {
  try {
    const businessId = req.user.business_id;
    const location = await settingsService.createBusinessLocation(businessId, req.body);

    res.status(201).json({
      success: true,
      message: 'Business location created successfully',
      data: location
    });
  } catch (error) {
    console.error('❌ Error creating business location:', error.message);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to create business location',
      code: 'CREATE_FAILED'
    });
  }
};

exports.updateBusinessLocation = async (req, res) => {
  try {
    const businessId = req.user.business_id;
    const { id } = req.params;
    const location = await settingsService.updateBusinessLocation(businessId, id, req.body);

    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'Business location not found',
        code: 'LOCATION_NOT_FOUND'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Business location updated successfully',
      data: location
    });
  } catch (error) {
    console.error('❌ Error updating business location:', error.message);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to update business location',
      code: 'UPDATE_FAILED'
    });
  }
};

exports.deactivateBusinessLocation = async (req, res) => {
  try {
    const businessId = req.user.business_id;
    const { id } = req.params;
    const location = await settingsService.deactivateBusinessLocation(businessId, id);

    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'Business location not found',
        code: 'LOCATION_NOT_FOUND'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Business location deactivated successfully',
      data: location
    });
  } catch (error) {
    console.error('❌ Error deactivating business location:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to deactivate business location',
      error: error.message
    });
  }
};

// ── TAX RATES ──────────────────────────────────────────────────
exports.getTaxRates = async (req, res) => {
  try {
    const businessId = req.user.business_id;
    const taxRates = await settingsService.getTaxRates(businessId);

    res.status(200).json({
      success: true,
      data: taxRates,
      count: taxRates.length
    });
  } catch (error) {
    console.error('❌ Error fetching tax rates:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tax rates',
      error: error.message
    });
  }
};

exports.createTaxRate = async (req, res) => {
  try {
    const businessId = req.user.business_id;
    const taxRate = await settingsService.createTaxRate(businessId, req.body);

    res.status(201).json({
      success: true,
      message: 'Tax rate created successfully',
      data: taxRate
    });
  } catch (error) {
    console.error('❌ Error creating tax rate:', error.message);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to create tax rate',
      code: 'CREATE_FAILED'
    });
  }
};

exports.updateTaxRate = async (req, res) => {
  try {
    const businessId = req.user.business_id;
    const { id } = req.params;
    const taxRate = await settingsService.updateTaxRate(businessId, id, req.body);

    if (!taxRate) {
      return res.status(404).json({
        success: false,
        message: 'Tax rate not found',
        code: 'TAX_RATE_NOT_FOUND'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Tax rate updated successfully',
      data: taxRate
    });
  } catch (error) {
    console.error('❌ Error updating tax rate:', error.message);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to update tax rate',
      code: 'UPDATE_FAILED'
    });
  }
};

exports.deleteTaxRate = async (req, res) => {
  try {
    const businessId = req.user.business_id;
    const { id } = req.params;
    const taxRate = await settingsService.deleteTaxRate(businessId, id);

    if (!taxRate) {
      return res.status(404).json({
        success: false,
        message: 'Tax rate not found',
        code: 'TAX_RATE_NOT_FOUND'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Tax rate deleted successfully',
      data: taxRate
    });
  } catch (error) {
    console.error('❌ Error deleting tax rate:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete tax rate',
      error: error.message
    });
  }
};

// ── INVOICE SETTINGS ───────────────────────────────────────────
exports.getInvoiceSettings = async (req, res) => {
  try {
    const businessId = req.user.business_id;
    const settings = await settingsService.getInvoiceSettings(businessId);

    res.status(200).json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('❌ Error fetching invoice settings:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoice settings',
      error: error.message
    });
  }
};

exports.updateInvoiceSettings = async (req, res) => {
  try {
    const businessId = req.user.business_id;
    const settings = await settingsService.updateInvoiceSettings(businessId, req.body);

    res.status(200).json({
      success: true,
      message: 'Invoice settings updated successfully',
      data: settings
    });
  } catch (error) {
    console.error('❌ Error updating invoice settings:', error.message);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to update invoice settings',
      code: 'UPDATE_FAILED'
    });
  }
};

// ── RECEIPT PRINTERS ───────────────────────────────────────────
exports.getReceiptPrinters = async (req, res) => {
  try {
    const businessId = req.user.business_id;
    const printers = await settingsService.getReceiptPrinters(businessId);

    res.status(200).json({
      success: true,
      data: printers,
      count: printers.length
    });
  } catch (error) {
    console.error('❌ Error fetching receipt printers:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch receipt printers',
      error: error.message
    });
  }
};

exports.createReceiptPrinter = async (req, res) => {
  try {
    const businessId = req.user.business_id;
    const printer = await settingsService.createReceiptPrinter(businessId, req.body);

    res.status(201).json({
      success: true,
      message: 'Receipt printer created successfully',
      data: printer
    });
  } catch (error) {
    console.error('❌ Error creating receipt printer:', error.message);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to create receipt printer',
      code: 'CREATE_FAILED'
    });
  }
};

exports.deleteReceiptPrinter = async (req, res) => {
  try {
    const businessId = req.user.business_id;
    const { id } = req.params;
    const printer = await settingsService.deleteReceiptPrinter(businessId, id);

    if (!printer) {
      return res.status(404).json({
        success: false,
        message: 'Receipt printer not found',
        code: 'PRINTER_NOT_FOUND'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Receipt printer deleted successfully',
      data: printer
    });
  } catch (error) {
    console.error('❌ Error deleting receipt printer:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete receipt printer',
      error: error.message
    });
  }
};

// ── EXPORT/IMPORT ────────────────────────────────────────────
exports.exportSettings = async (req, res) => {
  try {
    const businessId = req.user.business_id;
    const settings = await settingsService.exportAllSettings(businessId);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="settings-${new Date().toISOString().split('T')[0]}.json"`);
    res.status(200).json(settings);
  } catch (error) {
    console.error('❌ Error exporting settings:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to export settings',
      error: error.message
    });
  }
};

exports.importSettings = async (req, res) => {
  try {
    const businessId = req.user.business_id;

    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Invalid import data',
        code: 'INVALID_DATA'
      });
    }

    const result = await settingsService.importSettings(businessId, req.body);

    res.status(200).json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (error) {
    console.error('❌ Error importing settings:', error.message);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to import settings',
      code: 'IMPORT_FAILED'
    });
  }
};