/**
 * ============================================================
 * services/taxCalcService.js
 * Single shared GST calculation engine.
 *
 * Every module that charges/records tax (Sales, POS, Purchases,
 * Manufacturing) calls calculateGST() from here instead of
 * computing CGST/SGST/IGST itself. That's what makes GST numbers
 * consistent and "auto-linked" across the whole ERP — one source
 * of truth for the split logic.
 *
 * Does NOT touch existing tax_amt / tax_amount columns — this is
 * additive. Existing modules keep working even if they never
 * call this file.
 * ============================================================
 */
const pool = require('../config/database');

let schemaReady = false;
const ensureSchema = async () => {
  if (schemaReady) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gst_settings (
        id SERIAL PRIMARY KEY,
        business_gstin VARCHAR(15),
        business_state VARCHAR(100),
        default_cgst_rate NUMERIC(5,2) DEFAULT 9,
        default_sgst_rate NUMERIC(5,2) DEFAULT 9,
        default_igst_rate NUMERIC(5,2) DEFAULT 18,
        default_cess_rate NUMERIC(5,2) DEFAULT 0,
        reverse_charge_enabled BOOLEAN DEFAULT FALSE,
        filing_frequency VARCHAR(20) DEFAULT 'Monthly',
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // Seed one settings row if none exists, so the engine always has config.
    const { rows } = await pool.query(`SELECT id FROM gst_settings LIMIT 1`);
    if (!rows.length) {
      await pool.query(`
        INSERT INTO gst_settings (business_state, default_cgst_rate, default_sgst_rate, default_igst_rate)
        VALUES (NULL, 9, 9, 18)
      `);
    }

    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS gstin VARCHAR(15);`);
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS gst_registered BOOLEAN DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(10);`);

    for (const col of [
      'hsn_code VARCHAR(10)',
      'cgst_rate NUMERIC(5,2) DEFAULT 0',
      'sgst_rate NUMERIC(5,2) DEFAULT 0',
      'igst_rate NUMERIC(5,2) DEFAULT 0',
      'cess_rate NUMERIC(5,2) DEFAULT 0',
      'cgst_amt NUMERIC(14,2) DEFAULT 0',
      'sgst_amt NUMERIC(14,2) DEFAULT 0',
      'igst_amt NUMERIC(14,2) DEFAULT 0',
      'cess_amt NUMERIC(14,2) DEFAULT 0',
    ]) {
      await pool.query(`ALTER TABLE sales_invoice_items ADD COLUMN IF NOT EXISTS ${col};`);
      await pool.query(`ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS ${col};`);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS gst_payments (
        id SERIAL PRIMARY KEY,
        period VARCHAR(20) NOT NULL,
        payment_date DATE NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        mode VARCHAR(30),
        reference_no VARCHAR(60),
        challan_no VARCHAR(60),
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS gst_reconciliation (
        id SERIAL PRIMARY KEY,
        purchase_id INTEGER,
        supplier_name VARCHAR(200),
        supplier_bill_ref VARCHAR(100),
        purchase_amount NUMERIC(14,2),
        supplier_amount NUMERIC(14,2),
        match_status VARCHAR(20) DEFAULT 'Pending',
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    schemaReady = true;
  } catch (err) {
    console.error('taxCalcService schema migration warning:', err.message);
    schemaReady = true;
  }
};

/** Returns the single active gst_settings row (creates default if missing). */
const getSettings = async () => {
  await ensureSchema();
  const { rows } = await pool.query(`SELECT * FROM gst_settings ORDER BY id LIMIT 1`);
  return rows[0] || {
    business_state: null, default_cgst_rate: 9, default_sgst_rate: 9,
    default_igst_rate: 18, default_cess_rate: 0, reverse_charge_enabled: false,
  };
};

/**
 * Core calculation. Pure function — no DB calls — so it's cheap to call
 * per line item during invoice/purchase/POS creation.
 *
 * @param {number} baseAmount   Taxable value (exclusive of tax)
 * @param {number} totalRatePct Combined GST rate, e.g. 18 for 18%
 * @param {string} buyerState   State of the customer/supplier
 * @param {string} sellerState  Business's registered state (from gst_settings)
 * @param {number} cessRatePct  Optional cess rate, default 0
 * @returns {{cgst:number, sgst:number, igst:number, cess:number, taxableValue:number, totalTax:number}}
 */
const calculateGST = (baseAmount, totalRatePct = 0, buyerState = null, sellerState = null, cessRatePct = 0) => {
  const base = Number(baseAmount) || 0;
  const rate = Number(totalRatePct) || 0;
  const cessRate = Number(cessRatePct) || 0;

  const isInterState = !!buyerState && !!sellerState &&
    buyerState.trim().toLowerCase() !== sellerState.trim().toLowerCase();

  let cgst = 0, sgst = 0, igst = 0;
  if (isInterState) {
    igst = +(base * (rate / 100)).toFixed(2);
  } else {
    cgst = +(base * (rate / 200)).toFixed(2);
    sgst = +(base * (rate / 200)).toFixed(2);
  }
  const cess = +(base * (cessRate / 100)).toFixed(2);
  const totalTax = +(cgst + sgst + igst + cess).toFixed(2);

  return { cgst, sgst, igst, cess, taxableValue: base, totalTax, isInterState };
};

module.exports = { ensureSchema, getSettings, calculateGST };