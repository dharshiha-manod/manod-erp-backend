/**
 * ====================================================
 * services/notificationEngine.js
 * The "chef" that reads a saved template and actually
 * sends it out by email when a business event happens.
 *
 * This file is BRAND NEW. It does not change any
 * existing file's behavior. Other modules call into it
 * with one extra, non-blocking line after their own
 * save logic already succeeded.
 * ====================================================
 */

'use strict';
const nodemailer = require('nodemailer');
const pool = require('../config/database');
const notificationTemplateService = require('./notificationTemplateService');

// ── Build the email transporter once, reused for every send ──────────────────
// "Transporter" = nodemailer's term for "the connection that knows how to
// log into your email account and send mail through it."
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS } = process.env;

  if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASS) {
    console.warn(
      '[NotificationEngine] EMAIL_HOST / EMAIL_USER / EMAIL_PASS not set in .env — ' +
      'emails will be skipped until these are configured.'
    );
    return null;
  }

  transporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: Number(EMAIL_PORT) || 587,
    secure: Number(EMAIL_PORT) === 465, // true only for port 465
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS,
    },
  });

  return transporter;
}

// ── Replace {tag} placeholders with real values ──────────────────────────────
// Example: "Hi {contact_name}, your invoice {invoice_number} is ready"
// + { contact_name: "Ravi", invoice_number: "INV-102" }
// -> "Hi Ravi, your invoice INV-102 is ready"
function fillTags(text, values = {}) {
  if (!text) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => {
    const val = values[key];
    return val === undefined || val === null || val === '' ? '' : String(val);
  });
}

// ── Find the most recent supplier a product was bought from ──────────────────
// Joins purchase_items -> purchases -> contacts, ordered by purchase date,
// so we can tell the alert recipient exactly who to reorder from.
async function getLastSupplierForProduct(productId) {
  if (!productId) return null;
  try {
    const result = await pool.query(
      `SELECT
         p.supplier_id,
         p.supplier_name,
         c.email       AS supplier_email,
         c.phone       AS supplier_phone,
         p.purchase_date,
         pi.unit_cost
       FROM purchase_items pi
       JOIN purchases p ON p.id = pi.purchase_id
       LEFT JOIN contacts c ON c.id = p.supplier_id
       WHERE pi.product_id = $1
       ORDER BY p.purchase_date DESC, p.id DESC
       LIMIT 1`,
      [productId]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error('[NotificationEngine] getLastSupplierForProduct failed:', err.message);
    return null;
  }
}

// ── Who should get the internal low-stock alert? ──────────────────────────
// Combines:
//   1) Whatever addresses are listed in ADMIN_ALERT_EMAIL (.env), comma-separated
//   2) Any active user whose role contains "admin" or "inventory" (case-insensitive)
// This is INTERNAL STAFF ONLY — suppliers are never included here.
async function getInternalAlertEmails() {
  const emails = new Set();

  (process.env.ADMIN_ALERT_EMAIL || process.env.EMAIL_USER || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
    .forEach((e) => emails.add(e));

  try {
    const result = await pool.query(
      `SELECT email FROM users
       WHERE status = 'active'
         AND (LOWER(role) LIKE '%admin%' OR LOWER(role) LIKE '%inventory%')`
    );
    result.rows.forEach((r) => r.email && emails.add(r.email));
  } catch (err) {
    console.error('[NotificationEngine] getInternalAlertEmails role lookup failed:', err.message);
  }

  return [...emails];
}

// ── Low stock check + alert ───────────────────────────────────────────────
// Call this right after a sale reduces a product's current_stock.
// Looks up the product, compares against its alert_qty, and if stock is at
// or below that threshold, emails INTERNAL STAFF ONLY (admin / inventory roles).
// The supplier is looked up here only so the internal email can *show* who
// to reorder from — the supplier is never emailed automatically. Actually
// contacting the supplier (with a chosen quantity) is a separate, human-
// triggered step — see requestReorderFromSupplier() below.
async function checkAndAlertLowStock(productId) {
  if (!productId) return { skipped: true, reason: 'No productId provided' };

  let product;
  try {
    const result = await pool.query(
      `SELECT id, name, sku, COALESCE(current_stock,0) AS current_stock, COALESCE(alert_qty,0) AS alert_qty
       FROM products WHERE id = $1`,
      [productId]
    );
    product = result.rows[0];
  } catch (err) {
    console.error('[NotificationEngine] low stock product lookup failed:', err.message);
    return { skipped: true, reason: 'Product lookup failed' };
  }

  if (!product) return { skipped: true, reason: 'Product not found' };

  if (!product.alert_qty || product.current_stock > product.alert_qty) {
    return { skipped: true, reason: 'Stock above alert threshold' };
  }

  const supplier = await getLastSupplierForProduct(productId);

  const values = {
    product_name: product.name,
    sku: product.sku || '',
    current_stock: product.current_stock,
    alert_qty: product.alert_qty,
    supplier_name: supplier ? (supplier.supplier_name || '') : 'No previous supplier on record',
    supplier_email: supplier ? (supplier.supplier_email || '') : '',
    last_purchase_date: supplier ? new Date(supplier.purchase_date).toLocaleDateString() : '',
    last_purchase_price: supplier ? (supplier.unit_cost || '') : '',
  };

  const internalEmails = await getInternalAlertEmails();
  const results = { skipped: false, sentTo: [] };

  for (const email of internalEmails) {
    const r = await sendNotification('low_stock', { ...values, to: email });
    if (r.sent) results.sentTo.push(email);
  }

  console.log(`[Notify] Low stock alert for "${product.name}" (${product.current_stock}/${product.alert_qty}) -> sent to internal staff: ${results.sentTo.join(', ') || 'nobody (no email configured)'}`);

  return results;
}

// ── Manual reorder request to supplier ─────────────────────────────────────
// Human-triggered: an admin/inventory user looks at the low-stock alert,
// decides how many units to reorder, and clicks "Request Reorder". This is
// the ONLY place a supplier gets emailed about stock — never automatically.
// Uses the 'supplier_purchase_order' template so it reads like a proper PO
// request rather than an internal alert.
async function requestReorderFromSupplier(productId, quantity, requestedBy = {}) {
  if (!productId || !quantity || Number(quantity) <= 0) {
    return { skipped: true, reason: 'productId and a positive quantity are required' };
  }

  const productResult = await pool.query(
    `SELECT id, name, sku FROM products WHERE id = $1`,
    [productId]
  );
  const product = productResult.rows[0];
  if (!product) return { skipped: true, reason: 'Product not found' };

  const supplier = await getLastSupplierForProduct(productId);
  if (!supplier || !supplier.supplier_email) {
    return { skipped: true, reason: 'No supplier email on record for this product' };
  }

  const values = {
    product_name: product.name,
    sku: product.sku || '',
    supplier_name: supplier.supplier_name || '',
    quantity,
    requested_by: requestedBy.name || requestedBy.email || 'Manod ERP',
  };

  const r = await sendNotification('supplier_purchase_order', { ...values, to: supplier.supplier_email });
  console.log(`[Notify] Reorder request for "${product.name}" x${quantity} -> ${supplier.supplier_email} (${r.sent ? 'sent' : 'skipped: ' + r.reason})`);
  return r;
}

/**
 * SEND NOTIFICATION
 * @param {string} templateType  e.g. 'customer_new_sale', 'supplier_new_order'
 * @param {object} values        real data to fill into {tags}, must include
 *                                a `to` OR `email` field for the recipient address
 * @returns {Promise<{skipped:boolean, reason?:string, sent?:boolean}>}
 *
 * This function NEVER throws in a way that should crash a sale/purchase —
 * callers are expected to use it as: sendNotification(...).catch(console.error)
 */
async function sendNotification(templateType, values = {}) {
  console.log(`[Notify] sendNotification called for "${templateType}"`);

  // 1. Load the saved template for this event type
  const template = await notificationTemplateService.fetchTemplateByType(templateType);

  if (!template) {
    console.log(`[Notify] SKIPPED — no template saved for "${templateType}"`);
    return { skipped: true, reason: `No template saved for "${templateType}"` };
  }

  // 2. Respect the Auto Send Email toggle from the UI — if it's off, do nothing
  if (!template.auto_email) {
    console.log(`[Notify] SKIPPED — auto_email is OFF for "${templateType}"`);
    return { skipped: true, reason: `auto_email is OFF for "${templateType}"` };
  }

  if (!template.email_body) {
    console.log(`[Notify] SKIPPED — template "${templateType}" has no email body`);
    return { skipped: true, reason: `Template "${templateType}" has no email body` };
  }

  // 3. Figure out the recipient address
  const to = values.to || values.email;
  if (!to) {
    console.log(`[Notify] SKIPPED — no recipient email address in values:`, values);
    return { skipped: true, reason: 'No recipient email address provided' };
  }

  // 4. Fill in the {tags}
  const subject = fillTags(template.email_subject || `Notification: ${templateType}`, values);
  const html = fillTags(template.email_body, values);

  // 5. Send it
  const t = getTransporter();
  if (!t) {
    console.log(`[Notify] SKIPPED — email transporter not configured (.env missing EMAIL_HOST/USER/PASS)`);
    return { skipped: true, reason: 'Email transporter not configured (.env missing)' };
  }

  const fromName = process.env.EMAIL_FROM_NAME || 'Manod ERP';

  console.log(`[Notify] Sending email to ${to} — subject: "${subject}"`);

  await t.sendMail({
    from: `"${fromName}" <${process.env.EMAIL_USER}>`,
    to,
    cc: template.cc_email || undefined,
    bcc: template.bcc_email || undefined,
    subject,
    html,
  });

  console.log(`[Notify] SENT successfully to ${to}`);
  return { skipped: false, sent: true };
}

module.exports = {
  sendNotification,
  checkAndAlertLowStock,
  requestReorderFromSupplier,
  fillTags, // exported so it can be unit-tested or reused elsewhere
};