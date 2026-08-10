/**
 * ====================================================
 * SETTINGS SERVICE LAYER
 * Database operations for Business Settings
 * ====================================================
 */
const pool = require('../config/database');
const industryService = require('./industryService');

// Mirrors INDUSTRY_PRESETS in GeneralSettings.jsx — used as a server-side
// fallback so industry-specific defaults are available everywhere (Add
// Product, etc.) even before the admin has ever clicked "Update Settings"
// for a given workspace.
const INDUSTRY_FIELD_DEFAULTS = {
  jewellery_manufacturing: {
    default_unit: "Gram",
    default_category: "Jewellery",
    industry_fields: {
      gold_purity: true, gross_weight: true, net_weight: true,
      stone_weight: true, wastage_percentage: true, making_charge: true, hallmark: true,
    },
  },
  automobile_manufacturing: {
    default_unit: "Piece",
    default_category: "Automobile",
    industry_fields: {
      vin: true, engine_number: true, chassis_number: true, model_year: true, variant: true,
    },
  },
  furniture_manufacturing: {
    default_unit: "Piece",
    default_category: "Furniture",
    industry_fields: {
      wood_type: true, material: true, dimensions: true, finish: true,
    },
  },
  textile_manufacturing: {
    default_unit: "Meter",
    default_category: "Textile",
    industry_fields: {
      fabric_type: true, gsm: true, roll_length: true, pattern: true, color: true,
    },
  },
  garments_manufacturing: {
    default_unit: "Piece",
    default_category: "Garments",
    industry_fields: {
      size: true, color: true, fabric_type: true, season: true, gender: true,
    },
  },
};
// ── BUSINESS SETTINGS ──────────────────────────────────────────
// NEW
const getBusinessSettings = async (businessId) => {
  const result = await pool.query(
    `SELECT id, business_id, business_name, currency, timezone, 
            language, phone, email, address, city, state, country, 
            postal_code, tax_id, registration_number, logo_url, created_at, updated_at,
            profit_percent, stock_method, transaction_edit_days, date_format, time_format,
            currency_precision, qty_precision, symbol_placement, financial_year_start_month, start_date
     FROM business_settings 
     WHERE business_id = $1::integer`,
    [businessId]
  );
  return result.rows[0] || null;
};

// ── GENERAL SETTINGS ───────────────────────────────────────────

const getGeneralSettings = async (businessId, industryId) => {
  const result = await pool.query(
    `SELECT * FROM general_settings WHERE business_id = $1::integer AND industry_id = $2::integer`,
    [businessId, industryId]
  );
  return result.rows[0] || null;
};
// industry_type is intentionally NOT accepted here — it is owned by the
// industries table (set once at workspace creation) and derived on every
// read in getMergedGeneralSettings(), never stored per-save in this table.
const updateGeneralSettings = async (businessId, industryId, data) => {
  const {
    default_unit, default_tax, default_category,
    auto_sku_generation, barcode_enabled, batch_tracking_enabled, serial_tracking_enabled,
    product_images_enabled, manufacturing_date_enabled, expiry_date_enabled, product_variants_enabled,
    industry_fields,
    allow_negative_stock, low_stock_alert_enabled, multi_warehouse_enabled,
    stock_reservation_enabled, stock_transfer_enabled, default_warehouse,
    bom_required, production_planning_enabled, work_orders_enabled,
    quality_check_enabled, scrap_management_enabled, machine_tracking_enabled, auto_production_number,
  } = data;

  const result = await pool.query(
    `INSERT INTO general_settings (
       business_id, industry_id,
       default_unit, default_tax, default_category,
       auto_sku_generation, barcode_enabled, batch_tracking_enabled, serial_tracking_enabled,
       product_images_enabled, manufacturing_date_enabled, expiry_date_enabled, product_variants_enabled,
       industry_fields,
       allow_negative_stock, low_stock_alert_enabled, multi_warehouse_enabled,
       stock_reservation_enabled, stock_transfer_enabled, default_warehouse,
       bom_required, production_planning_enabled, work_orders_enabled,
       quality_check_enabled, scrap_management_enabled, machine_tracking_enabled, auto_production_number,
       created_at, updated_at
   ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )
     ON CONFLICT (business_id, industry_id) DO UPDATE SET
       default_unit = EXCLUDED.default_unit,
       default_tax = EXCLUDED.default_tax,
       default_category = EXCLUDED.default_category,
       auto_sku_generation = EXCLUDED.auto_sku_generation,
       barcode_enabled = EXCLUDED.barcode_enabled,
       batch_tracking_enabled = EXCLUDED.batch_tracking_enabled,
       serial_tracking_enabled = EXCLUDED.serial_tracking_enabled,
       product_images_enabled = EXCLUDED.product_images_enabled,
       manufacturing_date_enabled = EXCLUDED.manufacturing_date_enabled,
       expiry_date_enabled = EXCLUDED.expiry_date_enabled,
       product_variants_enabled = EXCLUDED.product_variants_enabled,
       industry_fields = EXCLUDED.industry_fields,
       allow_negative_stock = EXCLUDED.allow_negative_stock,
       low_stock_alert_enabled = EXCLUDED.low_stock_alert_enabled,
       multi_warehouse_enabled = EXCLUDED.multi_warehouse_enabled,
       stock_reservation_enabled = EXCLUDED.stock_reservation_enabled,
       stock_transfer_enabled = EXCLUDED.stock_transfer_enabled,
       default_warehouse = EXCLUDED.default_warehouse,
       bom_required = EXCLUDED.bom_required,
       production_planning_enabled = EXCLUDED.production_planning_enabled,
       work_orders_enabled = EXCLUDED.work_orders_enabled,
       quality_check_enabled = EXCLUDED.quality_check_enabled,
       scrap_management_enabled = EXCLUDED.scrap_management_enabled,
       machine_tracking_enabled = EXCLUDED.machine_tracking_enabled,
       auto_production_number = EXCLUDED.auto_production_number,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      businessId, industryId,
      default_unit, default_tax, default_category,
      auto_sku_generation, barcode_enabled, batch_tracking_enabled, serial_tracking_enabled,
      product_images_enabled, manufacturing_date_enabled, expiry_date_enabled, product_variants_enabled,
      JSON.stringify(industry_fields || {}),
      allow_negative_stock, low_stock_alert_enabled, multi_warehouse_enabled,
      stock_reservation_enabled, stock_transfer_enabled, default_warehouse,
      bom_required, production_planning_enabled, work_orders_enabled,
      quality_check_enabled, scrap_management_enabled, machine_tracking_enabled, auto_production_number,
    ]
  );
  return result.rows[0];
};

// NEW — merge helper the controller calls; keeps company-wide fields
// (business_settings) and industry-specific fields (general_settings) separate
// in storage but combined in the API response, per your GENERAL SETTINGS DECISION.
// NEW
// NEW
const getMergedGeneralSettings = async (businessId, industryId) => {
  const business = await getBusinessSettings(businessId);
  const industrySettings = await getGeneralSettings(businessId, industryId);
  const industryRow = await industryService.getIndustryById(businessId, industryId);
  const industryType = industryRow?.industry_type || "general_manufacturing";
  const preset = INDUSTRY_FIELD_DEFAULTS[industryType];

  const merged = {
    company_name: business?.business_name || "",
    currency: business?.currency || "INR",
    financial_year: business?.financial_year_start_month || "",
    timezone: business?.timezone || "Asia/Kolkata",
    date_format: business?.date_format || "mm/dd/yyyy",
    ...(industrySettings || {}),
    // Fall back to the industry preset only when nothing has been saved yet
    // for this workspace — an explicit saved value always wins.
    default_unit: industrySettings?.default_unit || preset?.default_unit || "",
    default_category: industrySettings?.default_category || preset?.default_category || "",
    industry_fields:
      industrySettings?.industry_fields && Object.keys(industrySettings.industry_fields).length > 0
        ? industrySettings.industry_fields
        : preset ? { ...preset.industry_fields } : {},
    // industry_type is owned by the header workspace selector (industries table),
    // never by a saved general_settings value — always wins, no fallback-only logic.
    industry_type: industryType,
  };

  return merged;
};
// ── BUSINESS LOCATIONS ────────────────────────────────────────
const getBusinessLocations = async (businessId, industryId) => {
  const result = await pool.query(
    `SELECT id, location_id, business_id, location_name, address, city, 
            state, country, postal_code, phone, is_default, is_active, 
            email, website, alt_contact, invoice_scheme_pos, invoice_scheme_sale,
            invoice_layout_pos, invoice_layout_sale, price_group,
            custom_field_1, custom_field_2, custom_field_3, custom_field_4,
            payment_options, created_at, updated_at
     FROM business_locations 
     WHERE business_id = $1 AND industry_id = $2 AND is_active = true
     ORDER BY is_default DESC, location_name ASC`,
    [businessId, industryId]
  );
  return result.rows;
};

const createBusinessLocation = async (businessId, industryId, data) => {
  const {
    location_name, address, city, state, country, postal_code, phone, is_default,
    email, website, alt_contact, invoice_scheme_pos, invoice_scheme_sale,
    invoice_layout_pos, invoice_layout_sale, price_group,
    custom_field_1, custom_field_2, custom_field_3, custom_field_4, payment_options
  } = data;

  if (!location_name) throw new Error('Location name is required');

  // If marking as default, unset other defaults — only within this industry
  if (is_default) {
    await pool.query(
      `UPDATE business_locations SET is_default = false WHERE business_id = $1 AND industry_id = $2`,
      [businessId, industryId]
    );
  }

  // Generate location ID like BL0001, BL0002, etc., scoped per industry.
  // Derived from MAX(existing numeric suffix) rather than COUNT(*), so
  // deleted rows don't cause a previously-used id to be reissued. Wrapped
  // in a retry loop against the unique constraint to stay safe under
  // concurrent inserts (e.g. an accidental double-click / double request).
  const maxAttempts = 5;
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const maxResult = await pool.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(location_id FROM 3) AS INTEGER)), 0) AS max_num
       FROM business_locations
       WHERE business_id = $1 AND industry_id = $2 AND location_id ~ '^BL[0-9]+$'`,
      [businessId, industryId]
    );
    const nextNum = parseInt(maxResult.rows[0].max_num) + 1 + attempt;
    const locationId = `BL${String(nextNum).padStart(4, '0')}`;

    try {
      const result = await pool.query(
        `INSERT INTO business_locations 
         (location_id, business_id, industry_id, location_name, address, city, state, country, 
          postal_code, phone, is_default, is_active,
          email, website, alt_contact, invoice_scheme_pos, invoice_scheme_sale,
          invoice_layout_pos, invoice_layout_sale, price_group,
          custom_field_1, custom_field_2, custom_field_3, custom_field_4, payment_options,
          created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true,
          $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING *`,
        [locationId, businessId, industryId, location_name, address, city, state, country, postal_code, phone, is_default || false,
         email || null, website || null, alt_contact || null, invoice_scheme_pos || null, invoice_scheme_sale || null,
         invoice_layout_pos || null, invoice_layout_sale || null, price_group || null,
         custom_field_1 || null, custom_field_2 || null, custom_field_3 || null, custom_field_4 || null,
         JSON.stringify(payment_options || {})]
      );
      return result.rows[0];
    } catch (err) {
      // 23505 = unique_violation. Retry with a fresh id; anything else, bail out.
      if (err.code === '23505' && err.constraint === 'business_locations_location_id_key') {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Failed to generate a unique location ID');
};
// NEW
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
  const profit_percent = data.profit_percent ?? existing?.profit_percent;
  const stock_method = data.stock_method ?? existing?.stock_method;
  const transaction_edit_days = data.transaction_edit_days ?? existing?.transaction_edit_days;
  const date_format = data.date_format ?? existing?.date_format;
  const time_format = data.time_format ?? existing?.time_format;
  const currency_precision = data.currency_precision ?? existing?.currency_precision;
  const qty_precision = data.qty_precision ?? existing?.qty_precision;
  const symbol_placement = data.symbol_placement ?? existing?.symbol_placement;
  const financial_year_start_month = data.financial_year_start_month ?? existing?.financial_year_start_month;
  const start_date = data.start_date ?? existing?.start_date;

  // Only require business_name/currency on first-ever creation
  if (!existing && (!business_name || !currency)) {
    throw new Error('Business name and currency are required');
  }

  const result = await pool.query(
    `INSERT INTO business_settings
       (business_id, business_name, currency, timezone, language, phone, email,
        address, city, state, country, postal_code, tax_id, registration_number, logo_url,
        profit_percent, stock_method, transaction_edit_days, date_format, time_format,
        currency_precision, qty_precision, symbol_placement, financial_year_start_month, start_date,
        created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
             $16,$17,$18,$19,$20,$21,$22,$23,$24,$25, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
       profit_percent = EXCLUDED.profit_percent,
       stock_method = EXCLUDED.stock_method,
       transaction_edit_days = EXCLUDED.transaction_edit_days,
       date_format = EXCLUDED.date_format,
       time_format = EXCLUDED.time_format,
       currency_precision = EXCLUDED.currency_precision,
       qty_precision = EXCLUDED.qty_precision,
       symbol_placement = EXCLUDED.symbol_placement,
       financial_year_start_month = EXCLUDED.financial_year_start_month,
       start_date = EXCLUDED.start_date,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [businessId, business_name, currency, timezone, language, phone, email, address, city,
     state, country, postal_code, tax_id, registration_number, logo_url,
     profit_percent, stock_method, transaction_edit_days, date_format, time_format,
     currency_precision, qty_precision, symbol_placement, financial_year_start_month, start_date]
  );

  return result.rows[0];
};

// NEW
const deactivateBusinessLocation = async (businessId, industryId, locationId) => {
  const result = await pool.query(
    `UPDATE business_locations 
     SET is_active = false, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2 AND industry_id = $3
     RETURNING *`,
    [locationId, businessId, industryId]
  );
  return result.rows[0] || null;
};

const deleteBusinessLocation = async (businessId, industryId, locationId) => {
  const result = await pool.query(
    `DELETE FROM business_locations
     WHERE id = $1 AND business_id = $2 AND industry_id = $3
     RETURNING *`,
    [locationId, businessId, industryId]
  );
  return result.rows[0] || null;
};

// ── TAX RATES ──────────────────────────────────────────────────
const getTaxRates = async (businessId, industryId) => {
  const result = await pool.query(
    `SELECT id, tax_id, business_id, tax_name, rate, description, 
            is_default, is_active, created_at, updated_at
     FROM tax_rates 
     WHERE business_id = $1 AND industry_id = $2 AND is_active = true
     ORDER BY rate DESC, tax_name ASC`,
    [businessId, industryId]
  );
  return result.rows;
};

// NEW — paste this in its place
const createTaxRate = async (businessId, industryId, data) => {
  const { tax_name, rate, description, is_default } = data;

  if (!tax_name || rate === undefined) {
    throw new Error('Tax name and rate are required');
  }

  // Generate tax ID — scoped per industry
  const countResult = await pool.query(
    `SELECT COUNT(*) as count FROM tax_rates WHERE business_id = $1 AND industry_id = $2`,
    [businessId, industryId]
  );
  const count = parseInt(countResult.rows[0].count) + 1;
  const taxId = `TAX${String(count).padStart(4, '0')}`;

  // If marking as default, unset other defaults — only within this industry
  if (is_default) {
    await pool.query(
      `UPDATE tax_rates SET is_default = false WHERE business_id = $1 AND industry_id = $2`,
      [businessId, industryId]
    );
  }

  const result = await pool.query(
    `INSERT INTO tax_rates 
     (tax_id, business_id, industry_id, tax_name, rate, description, is_default, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING *`,
    [taxId, businessId, industryId, tax_name, rate, description || null, is_default || false]
  );

  return result.rows[0];
};
const updateBusinessLocation = async (businessId, industryId, locationId, data) => {
  const {
    location_name, address, city, state, country, postal_code, phone, is_default,
    email, website, alt_contact, invoice_scheme_pos, invoice_scheme_sale,
    invoice_layout_pos, invoice_layout_sale, price_group,
    custom_field_1, custom_field_2, custom_field_3, custom_field_4, payment_options
  } = data;

  if (is_default) {
    await pool.query(
      `UPDATE business_locations SET is_default = false WHERE business_id = $1 AND industry_id = $2 AND id != $3`,
      [businessId, industryId, locationId]
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
     WHERE id = $22 AND business_id = $23 AND industry_id = $24
     RETURNING *`,
    [location_name, address, city, state, country, postal_code, phone, is_default,
     email, website, alt_contact, invoice_scheme_pos, invoice_scheme_sale,
     invoice_layout_pos, invoice_layout_sale, price_group,
     custom_field_1, custom_field_2, custom_field_3, custom_field_4,
     payment_options ? JSON.stringify(payment_options) : null,
     locationId, businessId, industryId]
  );

  return result.rows[0] || null;
};
// NEW
const updateTaxRate = async (businessId, industryId, taxId, data) => {
  const { tax_name, rate, description, is_default } = data;

  if (is_default) {
    await pool.query(
      `UPDATE tax_rates SET is_default = false WHERE business_id = $1 AND industry_id = $2 AND id != $3`,
      [businessId, industryId, taxId]
    );
  }

  const result = await pool.query(
    `UPDATE tax_rates 
     SET tax_name = COALESCE($1, tax_name),
         rate = COALESCE($2, rate),
         description = COALESCE($3, description),
         is_default = COALESCE($4, is_default),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $5 AND business_id = $6 AND industry_id = $7
     RETURNING *`,
    [tax_name, rate, description, is_default, taxId, businessId, industryId]
  );

  return result.rows[0] || null;
};

const deleteTaxRate = async (businessId, industryId, taxId) => {
  const result = await pool.query(
    `UPDATE tax_rates 
     SET is_active = false, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2 AND industry_id = $3
     RETURNING *`,
    [taxId, businessId, industryId]
  );
  return result.rows[0] || null;
};

// ── INVOICE SETTINGS ───────────────────────────────────────────
// NEW
const getInvoiceSettings = async (businessId, industryId) => {
  const result = await pool.query(
    `SELECT id, business_id, invoice_prefix, invoice_start_number, number_digits, separator,
            show_tax_id, show_notes, notes_template, created_at, updated_at
     FROM invoice_settings 
     WHERE business_id = $1 AND industry_id = $2`,
    [businessId, industryId]
  );
  return result.rows[0] || null;
};

const updateInvoiceSettings = async (businessId, industryId, data) => {
  const { invoice_prefix, invoice_start_number, number_digits, separator, show_tax_id, show_notes, notes_template } = data;

  const result = await pool.query(
    `INSERT INTO invoice_settings
       (business_id, industry_id, invoice_prefix, invoice_start_number, number_digits, separator, show_tax_id, show_notes, notes_template, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (business_id, industry_id)
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
    [businessId, industryId, invoice_prefix, invoice_start_number, number_digits, separator, show_tax_id, show_notes, notes_template]
  );

  return result.rows[0] || null;
};

// ── RECEIPT PRINTERS ───────────────────────────────────────────
const getReceiptPrinters = async (businessId, industryId) => {
  const result = await pool.query(
    `SELECT id, printer_id, business_id, printer_name, printer_model, 
            ip_address, port, paper_width, is_default, is_active, 
            created_at, updated_at
     FROM receipt_printers 
     WHERE business_id = $1 AND industry_id = $2 AND is_active = true
     ORDER BY is_default DESC, printer_name ASC`,
    [businessId, industryId]
  );
  return result.rows;
};

const createReceiptPrinter = async (businessId, industryId, data) => {
  const { printer_name, printer_model, ip_address, port, paper_width, is_default } = data;

  if (!printer_name) throw new Error('Printer name is required');

  const countResult = await pool.query(
    `SELECT COUNT(*) as count FROM receipt_printers WHERE business_id = $1 AND industry_id = $2`,
    [businessId, industryId]
  );
  const count = parseInt(countResult.rows[0].count) + 1;
  const printerId = `PRT${String(count).padStart(4, '0')}`;

  if (is_default) {
    await pool.query(
      `UPDATE receipt_printers SET is_default = false WHERE business_id = $1 AND industry_id = $2`,
      [businessId, industryId]
    );
  }

  const result = await pool.query(
    `INSERT INTO receipt_printers 
     (printer_id, business_id, industry_id, printer_name, printer_model, ip_address, port, 
      paper_width, is_default, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING *`,
    [printerId, businessId, industryId, printer_name, printer_model || null, ip_address || null, port || null, paper_width || 80, is_default || false]
  );

  return result.rows[0];
};

const updateReceiptPrinter = async (businessId, industryId, printerId, data) => {
  const { printer_name, printer_model, ip_address, port, paper_width, is_default } = data;

  if (is_default) {
    await pool.query(
      `UPDATE receipt_printers SET is_default = false WHERE business_id = $1 AND industry_id = $2 AND id != $3`,
      [businessId, industryId, printerId]
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
     WHERE id = $7 AND business_id = $8 AND industry_id = $9
     RETURNING *`,
    [printer_name, printer_model, ip_address, port, paper_width, is_default, printerId, businessId, industryId]
  );

  return result.rows[0] || null;
};

const deleteReceiptPrinter = async (businessId, industryId, printerId) => {
  const result = await pool.query(
    `UPDATE receipt_printers 
     SET is_active = false, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2 AND industry_id = $3
     RETURNING *`,
    [printerId, businessId, industryId]
  );
  return result.rows[0] || null;
};

// ── BARCODE SETTINGS ───────────────────────────────────────────
const getBarcodeSettings = async (businessId, industryId) => {
  const result = await pool.query(
    `SELECT * FROM barcode_settings WHERE business_id = $1 AND industry_id = $2`,
    [businessId, industryId]
  );
  return result.rows[0] || null;
};

// NOTE: ON CONFLICT target changed from (business_id) to (business_id, industry_id).
// Run scripts/fix-barcode-settings-unique-constraint.js once to swap the DB
// constraint accordingly, or this upsert will fail/collide across industries.
const updateBarcodeSettings = async (businessId, industryId, data) => {
  const {
    barcode_type, label_width, label_height, font, font_size, copies_per_print,
    show_barcode, show_product_name, show_price, show_sku,
    paper_size, labels_per_row, top_margin, left_margin, gap_between_labels
  } = data;

  const result = await pool.query(
    `INSERT INTO barcode_settings
       (business_id, industry_id, barcode_type, label_width, label_height, font, font_size, copies_per_print,
        show_barcode, show_product_name, show_price, show_sku,
        paper_size, labels_per_row, top_margin, left_margin, gap_between_labels,
        created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (business_id, industry_id) DO UPDATE SET
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
    [businessId, industryId, barcode_type, label_width, label_height, font, font_size, copies_per_print,
     show_barcode, show_product_name, show_price, show_sku,
     paper_size, labels_per_row, top_margin, left_margin, gap_between_labels]
  );

  return result.rows[0];
};

// ── EXPORT/IMPORT ────────────────────────────────────────────
const exportAllSettings = async (businessIdInt, businessIdUuid, industryId) => {
  // business_settings is intentionally global/company-wide — not industry-scoped
  const business = await getBusinessSettings(businessIdInt);
  const locations = await getBusinessLocations(businessIdInt, industryId);
  const taxRates = await getTaxRates(businessIdUuid, industryId);
  const invoiceSettings = await getInvoiceSettings(businessIdUuid, industryId);
  const printers = await getReceiptPrinters(businessIdUuid, industryId);

  return {
    business,
    locations,
    taxRates,
    invoiceSettings,
    printers,
    exportDate: new Date().toISOString()
  };
};

const importSettings = async (businessIdInt, businessIdUuid, industryId, data) => {
  // Import locations
  if (data.locations && Array.isArray(data.locations)) {
    for (const loc of data.locations) {
      await createBusinessLocation(businessIdInt, industryId, {
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
      await createTaxRate(businessIdUuid, industryId, {
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
  updateGeneralSettings,
  getMergedGeneralSettings,
  getBusinessSettings,
  updateBusinessSettings,
  
// NEW
  // Business Locations
  getBusinessLocations,
  createBusinessLocation,
  updateBusinessLocation,
  deactivateBusinessLocation,
  deleteBusinessLocation,
  
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