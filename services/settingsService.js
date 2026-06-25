/**
 * ====================================================
 * SETTINGS SERVICE LAYER
 * Database operations for Business Settings
 * ====================================================
 */

const pool = require('../config/database');

// ── BUSINESS SETTINGS ──────────────────────────────────────────
const getBusinessSettings = async (businessId) => {
  const result = await pool.query(
    `SELECT id, business_id, business_name, currency, timezone, 
            language, phone, email, address, city, state, country, 
            postal_code, tax_id, registration_number, created_at, updated_at
     FROM business_settings 
     WHERE business_id = $1`,
    [businessId]
  );
  return result.rows[0] || null;
};

const updateBusinessSettings = async (businessId, data) => {
  const {
    business_name, currency, timezone, language, phone, email,
    address, city, state, country, postal_code, tax_id, registration_number
  } = data;

  // Validate required fields
  if (!business_name || !currency) {
    throw new Error('Business name and currency are required');
  }

  const result = await pool.query(
    `UPDATE business_settings 
     SET business_name = $1, currency = $2, timezone = $3, language = $4,
         phone = $5, email = $6, address = $7, city = $8, state = $9,
         country = $10, postal_code = $11, tax_id = $12, registration_number = $13,
         updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $14
     RETURNING *`,
    [business_name, currency, timezone, language, phone, email, address, city,
     state, country, postal_code, tax_id, registration_number, businessId]
  );

  return result.rows[0];
};

// ── BUSINESS LOCATIONS ────────────────────────────────────────
const getBusinessLocations = async (businessId) => {
  const result = await pool.query(
    `SELECT id, location_id, business_id, location_name, address, city, 
            state, country, postal_code, phone, is_default, is_active, 
            created_at, updated_at
     FROM business_locations 
     WHERE business_id = $1 AND is_active = true
     ORDER BY is_default DESC, location_name ASC`,
    [businessId]
  );
  return result.rows;
};

const createBusinessLocation = async (businessId, data) => {
  const { location_name, address, city, state, country, postal_code, phone, is_default } = data;

  if (!location_name) throw new Error('Location name is required');

  // Generate location ID like BL0001, BL0002, etc.
  const countResult = await pool.query(
    `SELECT COUNT(*) as count FROM business_locations WHERE business_id = $1`,
    [businessId]
  );
  const count = parseInt(countResult.rows[0].count) + 1;
  const locationId = `BL${String(count).padStart(4, '0')}`;

  // If marking as default, unset other defaults
  if (is_default) {
    await pool.query(
      `UPDATE business_locations SET is_default = false WHERE business_id = $1`,
      [businessId]
    );
  }

  const result = await pool.query(
    `INSERT INTO business_locations 
     (location_id, business_id, location_name, address, city, state, country, 
      postal_code, phone, is_default, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING *`,
    [locationId, businessId, location_name, address, city, state, country, postal_code, phone, is_default || false]
  );

  return result.rows[0];
};

const updateBusinessLocation = async (businessId, locationId, data) => {
  const { location_name, address, city, state, country, postal_code, phone, is_default } = data;

  if (is_default) {
    await pool.query(
      `UPDATE business_locations SET is_default = false WHERE business_id = $1 AND id != $2`,
      [businessId, locationId]
    );
  }

  const result = await pool.query(
    `UPDATE business_locations 
     SET location_name = COALESCE($1, location_name),
         address = COALESCE($2, address),
         city = COALESCE($3, city),
         state = COALESCE($4, state),
         country = COALESCE($5, country),
         postal_code = COALESCE($6, postal_code),
         phone = COALESCE($7, phone),
         is_default = COALESCE($8, is_default),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $9 AND business_id = $10
     RETURNING *`,
    [location_name, address, city, state, country, postal_code, phone, is_default, locationId, businessId]
  );

  return result.rows[0] || null;
};

const deactivateBusinessLocation = async (businessId, locationId) => {
  const result = await pool.query(
    `UPDATE business_locations 
     SET is_active = false, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2
     RETURNING *`,
    [locationId, businessId]
  );
  return result.rows[0] || null;
};

// ── TAX RATES ──────────────────────────────────────────────────
const getTaxRates = async (businessId) => {
  const result = await pool.query(
    `SELECT id, tax_id, business_id, tax_name, rate, description, 
            is_default, is_active, created_at, updated_at
     FROM tax_rates 
     WHERE business_id = $1 AND is_active = true
     ORDER BY rate DESC, tax_name ASC`,
    [businessId]
  );
  return result.rows;
};

const createTaxRate = async (businessId, data) => {
  const { tax_name, rate, description, is_default } = data;

  if (!tax_name || rate === undefined) {
    throw new Error('Tax name and rate are required');
  }

  // Generate tax ID
  const countResult = await pool.query(
    `SELECT COUNT(*) as count FROM tax_rates WHERE business_id = $1`,
    [businessId]
  );
  const count = parseInt(countResult.rows[0].count) + 1;
  const taxId = `TAX${String(count).padStart(4, '0')}`;

  // If marking as default, unset other defaults
  if (is_default) {
    await pool.query(
      `UPDATE tax_rates SET is_default = false WHERE business_id = $1`,
      [businessId]
    );
  }

  const result = await pool.query(
    `INSERT INTO tax_rates 
     (tax_id, business_id, tax_name, rate, description, is_default, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING *`,
    [taxId, businessId, tax_name, rate, description || null, is_default || false]
  );

  return result.rows[0];
};

const updateTaxRate = async (businessId, taxId, data) => {
  const { tax_name, rate, description, is_default } = data;

  if (is_default) {
    await pool.query(
      `UPDATE tax_rates SET is_default = false WHERE business_id = $1 AND id != $2`,
      [businessId, taxId]
    );
  }

  const result = await pool.query(
    `UPDATE tax_rates 
     SET tax_name = COALESCE($1, tax_name),
         rate = COALESCE($2, rate),
         description = COALESCE($3, description),
         is_default = COALESCE($4, is_default),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $5 AND business_id = $6
     RETURNING *`,
    [tax_name, rate, description, is_default, taxId, businessId]
  );

  return result.rows[0] || null;
};

const deleteTaxRate = async (businessId, taxId) => {
  const result = await pool.query(
    `UPDATE tax_rates 
     SET is_active = false, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2
     RETURNING *`,
    [taxId, businessId]
  );
  return result.rows[0] || null;
};

// ── INVOICE SETTINGS ───────────────────────────────────────────
const getInvoiceSettings = async (businessId) => {
  const result = await pool.query(
    `SELECT id, business_id, invoice_prefix, invoice_start_number, 
            show_tax_id, show_notes, notes_template, created_at, updated_at
     FROM invoice_settings 
     WHERE business_id = $1`,
    [businessId]
  );
  return result.rows[0] || null;
};

const updateInvoiceSettings = async (businessId, data) => {
  const { invoice_prefix, invoice_start_number, show_tax_id, show_notes, notes_template } = data;

  const result = await pool.query(
    `UPDATE invoice_settings 
     SET invoice_prefix = COALESCE($1, invoice_prefix),
         invoice_start_number = COALESCE($2, invoice_start_number),
         show_tax_id = COALESCE($3, show_tax_id),
         show_notes = COALESCE($4, show_notes),
         notes_template = COALESCE($5, notes_template),
         updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $6
     RETURNING *`,
    [invoice_prefix, invoice_start_number, show_tax_id, show_notes, notes_template, businessId]
  );

  return result.rows[0] || null;
};

// ── RECEIPT PRINTERS ───────────────────────────────────────────
const getReceiptPrinters = async (businessId) => {
  const result = await pool.query(
    `SELECT id, printer_id, business_id, printer_name, printer_model, 
            ip_address, port, paper_width, is_default, is_active, 
            created_at, updated_at
     FROM receipt_printers 
     WHERE business_id = $1 AND is_active = true
     ORDER BY is_default DESC, printer_name ASC`,
    [businessId]
  );
  return result.rows;
};

const createReceiptPrinter = async (businessId, data) => {
  const { printer_name, printer_model, ip_address, port, paper_width, is_default } = data;

  if (!printer_name) throw new Error('Printer name is required');

  const countResult = await pool.query(
    `SELECT COUNT(*) as count FROM receipt_printers WHERE business_id = $1`,
    [businessId]
  );
  const count = parseInt(countResult.rows[0].count) + 1;
  const printerId = `PRT${String(count).padStart(4, '0')}`;

  if (is_default) {
    await pool.query(
      `UPDATE receipt_printers SET is_default = false WHERE business_id = $1`,
      [businessId]
    );
  }

  const result = await pool.query(
    `INSERT INTO receipt_printers 
     (printer_id, business_id, printer_name, printer_model, ip_address, port, 
      paper_width, is_default, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING *`,
    [printerId, businessId, printer_name, printer_model || null, ip_address || null, port || null, paper_width || 80, is_default || false]
  );

  return result.rows[0];
};

const deleteReceiptPrinter = async (businessId, printerId) => {
  const result = await pool.query(
    `UPDATE receipt_printers 
     SET is_active = false, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2
     RETURNING *`,
    [printerId, businessId]
  );
  return result.rows[0] || null;
};

// ── EXPORT/IMPORT ────────────────────────────────────────────
const exportAllSettings = async (businessId) => {
  const business = await getBusinessSettings(businessId);
  const locations = await getBusinessLocations(businessId);
  const taxRates = await getTaxRates(businessId);
  const invoiceSettings = await getInvoiceSettings(businessId);
  const printers = await getReceiptPrinters(businessId);

  return {
    business,
    locations,
    taxRates,
    invoiceSettings,
    printers,
    exportDate: new Date().toISOString()
  };
};

const importSettings = async (businessId, data) => {
  // Import locations
  if (data.locations && Array.isArray(data.locations)) {
    for (const loc of data.locations) {
      await createBusinessLocation(businessId, {
        location_name: loc.location_name,
        address: loc.address,
        city: loc.city,
        state: loc.state,
        country: loc.country,
        postal_code: loc.postal_code,
        phone: loc.phone,
        is_default: loc.is_default
      });
    }
  }

  // Import tax rates
  if (data.taxRates && Array.isArray(data.taxRates)) {
    for (const tax of data.taxRates) {
      await createTaxRate(businessId, {
        tax_name: tax.tax_name,
        rate: tax.rate,
        description: tax.description,
        is_default: tax.is_default
      });
    }
  }

  return { success: true, message: 'Settings imported successfully' };
};

module.exports = {
  // Business Settings
  getBusinessSettings,
  updateBusinessSettings,
  
  // Business Locations
  getBusinessLocations,
  createBusinessLocation,
  updateBusinessLocation,
  deactivateBusinessLocation,
  
  // Tax Rates
  getTaxRates,
  createTaxRate,
  updateTaxRate,
  deleteTaxRate,
  
  // Invoice Settings
  getInvoiceSettings,
  updateInvoiceSettings,
  
  // Receipt Printers
  getReceiptPrinters,
  createReceiptPrinter,
  deleteReceiptPrinter,
  
  // Export/Import
  exportAllSettings,
  importSettings
};