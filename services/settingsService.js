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
            postal_code, tax_id, registration_number, logo_url, created_at, updated_at
     FROM business_settings 
     WHERE business_id = $1::integer`,
    [businessId]
  );
  return result.rows[0] || null;
};
const updateBusinessSettings = async (businessId, data) => {
  const existing = await getBusinessSettings(businessId);

  const business_name = data.business_name ?? existing?.business_name;
  const currency = data.currency ?? existing?.currency;
  const timezone = data.timezone ?? existing?.timezone;
  const language = data.language ?? existing?.language;
  const phone = data.phone ?? existing?.phone;
  const email = data.email ?? existing?.email;
  const address = data.address ?? existing?.address;
  const city = data.city ?? existing?.city;
  const state = data.state ?? existing?.state;
  const country = data.country ?? existing?.country;
  const postal_code = data.postal_code ?? existing?.postal_code;
  const tax_id = data.tax_id ?? existing?.tax_id;
  const registration_number = data.registration_number ?? existing?.registration_number;
  const logo_url = data.logo_url ?? existing?.logo_url;

  // Only require business_name/currency on first-ever creation
  if (!existing && (!business_name || !currency)) {
    throw new Error('Business name and currency are required');
  }

  const result = await pool.query(
    `INSERT INTO business_settings
       (business_id, business_name, currency, timezone, language, phone, email,
        address, city, state, country, postal_code, tax_id, registration_number, logo_url,
        created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (business_id) DO UPDATE SET
       business_name = EXCLUDED.business_name,
       currency = EXCLUDED.currency,
       timezone = EXCLUDED.timezone,
       language = EXCLUDED.language,
       phone = EXCLUDED.phone,
       email = EXCLUDED.email,
       address = EXCLUDED.address,
       city = EXCLUDED.city,
       state = EXCLUDED.state,
       country = EXCLUDED.country,
       postal_code = EXCLUDED.postal_code,
       tax_id = EXCLUDED.tax_id,
       registration_number = EXCLUDED.registration_number,
       logo_url = EXCLUDED.logo_url,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [businessId, business_name, currency, timezone, language, phone, email, address, city,
     state, country, postal_code, tax_id, registration_number, logo_url]
  );

  return result.rows[0];
};

// ── BUSINESS LOCATIONS ────────────────────────────────────────
const getBusinessLocations = async (businessId) => {
  const result = await pool.query(
    `SELECT id, location_id, business_id, location_name, address, city, 
            state, country, postal_code, phone, is_default, is_active, 
            email, website, alt_contact, invoice_scheme_pos, invoice_scheme_sale,
            invoice_layout_pos, invoice_layout_sale, price_group,
            custom_field_1, custom_field_2, custom_field_3, custom_field_4,
            payment_options, created_at, updated_at
     FROM business_locations 
     WHERE business_id = $1 AND is_active = true
     ORDER BY is_default DESC, location_name ASC`,
    [businessId]
  );
  return result.rows;
};

const createBusinessLocation = async (businessId, data) => {
  const {
    location_name, address, city, state, country, postal_code, phone, is_default,
    email, website, alt_contact, invoice_scheme_pos, invoice_scheme_sale,
    invoice_layout_pos, invoice_layout_sale, price_group,
    custom_field_1, custom_field_2, custom_field_3, custom_field_4, payment_options
  } = data;

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
      postal_code, phone, is_default, is_active,
      email, website, alt_contact, invoice_scheme_pos, invoice_scheme_sale,
      invoice_layout_pos, invoice_layout_sale, price_group,
      custom_field_1, custom_field_2, custom_field_3, custom_field_4, payment_options,
      created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true,
      $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING *`,
    [locationId, businessId, location_name, address, city, state, country, postal_code, phone, is_default || false,
     email || null, website || null, alt_contact || null, invoice_scheme_pos || null, invoice_scheme_sale || null,
     invoice_layout_pos || null, invoice_layout_sale || null, price_group || null,
     custom_field_1 || null, custom_field_2 || null, custom_field_3 || null, custom_field_4 || null,
     JSON.stringify(payment_options || {})]
  );

  return result.rows[0];
};
const updateBusinessLocation = async (businessId, locationId, data) => {
  const {
    location_name, address, city, state, country, postal_code, phone, is_default,
    email, website, alt_contact, invoice_scheme_pos, invoice_scheme_sale,
    invoice_layout_pos, invoice_layout_sale, price_group,
    custom_field_1, custom_field_2, custom_field_3, custom_field_4, payment_options
  } = data;

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
         email = COALESCE($9, email),
         website = COALESCE($10, website),
         alt_contact = COALESCE($11, alt_contact),
         invoice_scheme_pos = COALESCE($12, invoice_scheme_pos),
         invoice_scheme_sale = COALESCE($13, invoice_scheme_sale),
         invoice_layout_pos = COALESCE($14, invoice_layout_pos),
         invoice_layout_sale = COALESCE($15, invoice_layout_sale),
         price_group = COALESCE($16, price_group),
         custom_field_1 = COALESCE($17, custom_field_1),
         custom_field_2 = COALESCE($18, custom_field_2),
         custom_field_3 = COALESCE($19, custom_field_3),
         custom_field_4 = COALESCE($20, custom_field_4),
         payment_options = COALESCE($21, payment_options),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $22 AND business_id = $23
     RETURNING *`,
    [location_name, address, city, state, country, postal_code, phone, is_default,
     email, website, alt_contact, invoice_scheme_pos, invoice_scheme_sale,
     invoice_layout_pos, invoice_layout_sale, price_group,
     custom_field_1, custom_field_2, custom_field_3, custom_field_4,
     payment_options ? JSON.stringify(payment_options) : null,
     locationId, businessId]
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
    `SELECT id, business_id, invoice_prefix, invoice_start_number, number_digits, separator,
            show_tax_id, show_notes, notes_template, created_at, updated_at
     FROM invoice_settings 
     WHERE business_id = $1`,
    [businessId]
  );
  return result.rows[0] || null;
};

const updateInvoiceSettings = async (businessId, data) => {
  const { invoice_prefix, invoice_start_number, number_digits, separator, show_tax_id, show_notes, notes_template } = data;

  const result = await pool.query(
    `INSERT INTO invoice_settings
       (business_id, invoice_prefix, invoice_start_number, number_digits, separator, show_tax_id, show_notes, notes_template, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (business_id)
     DO UPDATE SET
       invoice_prefix = COALESCE(EXCLUDED.invoice_prefix, invoice_settings.invoice_prefix),
       invoice_start_number = COALESCE(EXCLUDED.invoice_start_number, invoice_settings.invoice_start_number),
       number_digits = COALESCE(EXCLUDED.number_digits, invoice_settings.number_digits),
       separator = COALESCE(EXCLUDED.separator, invoice_settings.separator),
       show_tax_id = COALESCE(EXCLUDED.show_tax_id, invoice_settings.show_tax_id),
       show_notes = COALESCE(EXCLUDED.show_notes, invoice_settings.show_notes),
       notes_template = COALESCE(EXCLUDED.notes_template, invoice_settings.notes_template),
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [businessId, invoice_prefix, invoice_start_number, number_digits, separator, show_tax_id, show_notes, notes_template]
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

const updateReceiptPrinter = async (businessId, printerId, data) => {
  const { printer_name, printer_model, ip_address, port, paper_width, is_default } = data;

  if (is_default) {
    await pool.query(
      `UPDATE receipt_printers SET is_default = false WHERE business_id = $1 AND id != $2`,
      [businessId, printerId]
    );
  }

  const result = await pool.query(
    `UPDATE receipt_printers 
     SET printer_name = COALESCE($1, printer_name),
         printer_model = COALESCE($2, printer_model),
         ip_address = COALESCE($3, ip_address),
         port = COALESCE($4, port),
         paper_width = COALESCE($5, paper_width),
         is_default = COALESCE($6, is_default),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $7 AND business_id = $8
     RETURNING *`,
    [printer_name, printer_model, ip_address, port, paper_width, is_default, printerId, businessId]
  );

  return result.rows[0] || null;
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

// ── BARCODE SETTINGS ───────────────────────────────────────────
const getBarcodeSettings = async (businessId) => {
  const result = await pool.query(
    `SELECT * FROM barcode_settings WHERE business_id = $1`,
    [businessId]
  );
  return result.rows[0] || null;
};

const updateBarcodeSettings = async (businessId, data) => {
  const {
    barcode_type, label_width, label_height, font, font_size, copies_per_print,
    show_barcode, show_product_name, show_price, show_sku,
    paper_size, labels_per_row, top_margin, left_margin, gap_between_labels
  } = data;

  const result = await pool.query(
    `INSERT INTO barcode_settings
       (business_id, barcode_type, label_width, label_height, font, font_size, copies_per_print,
        show_barcode, show_product_name, show_price, show_sku,
        paper_size, labels_per_row, top_margin, left_margin, gap_between_labels,
        created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (business_id) DO UPDATE SET
       barcode_type = EXCLUDED.barcode_type,
       label_width = EXCLUDED.label_width,
       label_height = EXCLUDED.label_height,
       font = EXCLUDED.font,
       font_size = EXCLUDED.font_size,
       copies_per_print = EXCLUDED.copies_per_print,
       show_barcode = EXCLUDED.show_barcode,
       show_product_name = EXCLUDED.show_product_name,
       show_price = EXCLUDED.show_price,
       show_sku = EXCLUDED.show_sku,
       paper_size = EXCLUDED.paper_size,
       labels_per_row = EXCLUDED.labels_per_row,
       top_margin = EXCLUDED.top_margin,
       left_margin = EXCLUDED.left_margin,
       gap_between_labels = EXCLUDED.gap_between_labels,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [businessId, barcode_type, label_width, label_height, font, font_size, copies_per_print,
     show_barcode, show_product_name, show_price, show_sku,
     paper_size, labels_per_row, top_margin, left_margin, gap_between_labels]
  );

  return result.rows[0];
};

// ── EXPORT/IMPORT ────────────────────────────────────────────
const exportAllSettings = async (businessIdInt, businessIdUuid) => {
  const business = await getBusinessSettings(businessIdInt);
  const locations = await getBusinessLocations(businessIdInt);
  const taxRates = await getTaxRates(businessIdUuid);
  const invoiceSettings = await getInvoiceSettings(businessIdUuid);
  const printers = await getReceiptPrinters(businessIdUuid);

  return {
    business,
    locations,
    taxRates,
    invoiceSettings,
    printers,
    exportDate: new Date().toISOString()
  };
};

const importSettings = async (businessIdInt, businessIdUuid, data) => {
  // Import locations
  if (data.locations && Array.isArray(data.locations)) {
    for (const loc of data.locations) {
      await createBusinessLocation(businessIdInt, {
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

  // Barcode Settings
  getBarcodeSettings,
  updateBarcodeSettings,
  
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
  updateReceiptPrinter,
  deleteReceiptPrinter,
  
  // Export/Import
  exportAllSettings,
  importSettings
};