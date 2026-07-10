/**
 * ====================================================
 * services/purchaseService.js
 * Business logic & all SQL queries for the Purchase module.
 * Controller stays thin — every DB call lives here.
 * ====================================================
 */
const pool = require('../config/database');

// ── SCHEMA MIGRATION (idempotent) ────────────────────────────────────────────
// purchase_items didn't have a product_id column, so purchases could never
// be linked back to products to adjust stock.
let schemaReady = false;
const ensureSchema = async () => {
  if (schemaReady) return;
  try {
    await pool.query(`ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS product_id INTEGER;`);
    schemaReady = true;
  } catch (err) {
    console.error('purchase_items schema migration warning:', err.message);
    schemaReady = true;
  }
};

// ── STOCK IMPACT ──────────────────────────────────────────────────────────────
// 'apply'   → purchase received, stock goes UP
// 'reverse' → purchase un-received / deleted, stock goes back DOWN
const applyPurchaseStockImpact = async (purchaseId, direction, client = pool) => {
  const items = await client.query(
    `SELECT product_id, quantity FROM purchase_items WHERE purchase_id = $1 AND product_id IS NOT NULL`,
    [purchaseId]
  );
  for (const item of items.rows) {
    const delta = direction === 'apply'
      ? Math.abs(parseFloat(item.quantity))
      : -Math.abs(parseFloat(item.quantity));
    await client.query(
      `UPDATE products SET current_stock = GREATEST(0, COALESCE(current_stock, 0) + $1), updated_at = NOW() WHERE id = $2`,
      [delta, item.product_id]
    );
  }
};

// ── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * Auto-generate the next reference number: PO-0001, PO-0002, …
 */
const generateReferenceNo = async () => {
  const result = await pool.query(
    `SELECT reference_no FROM purchases
     WHERE reference_no LIKE 'PO-%'
     ORDER BY id DESC LIMIT 1`
  );
  let next = 1;
  if (result.rows.length > 0) {
    const lastNum = parseInt(result.rows[0].reference_no.replace('PO-', ''), 10);
    if (!isNaN(lastNum)) next = lastNum + 1;
  }
  return `PO-${String(next).padStart(4, '0')}`;
};

/**
 * Recalculate and persist payment_status on the purchases row.
 * Called after every payment insert / delete.
 */
const recalcPaymentStatus = async (purchaseId, client = pool) => {
  const paid = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS total_paid FROM purchase_payments WHERE purchase_id = $1`,
    [purchaseId]
  );
  const totalPaid = parseFloat(paid.rows[0].total_paid) || 0;

  const purchase = await client.query(
    `SELECT grand_total FROM purchases WHERE id = $1`,
    [purchaseId]
  );
  if (purchase.rows.length === 0) return;
  const grandTotal = parseFloat(purchase.rows[0].grand_total) || 0;
  const due = Math.max(0, grandTotal - totalPaid);

  let paymentStatus = 'Due';
  if (totalPaid >= grandTotal && grandTotal > 0) paymentStatus = 'Paid';
  else if (totalPaid > 0)                         paymentStatus = 'Partial';

  await client.query(
    `UPDATE purchases SET amount_paid = $1, payment_due = $2, payment_status = $3 WHERE id = $4`,
    [totalPaid, due, paymentStatus, purchaseId]
  );
};

// ── CALCULATE FINANCIALS FROM BODY ───────────────────────────────────────────
const calcFinancials = (body, items) => {
  const subtotal      = items.reduce((s, i) => s + (parseFloat(i.line_total) || 0), 0);
  const discountType  = body.discount_type  || 'None';
  const discountAmt   = parseFloat(body.discount_amount) || 0;
  const discountValue = discountType === 'Percentage'
    ? subtotal * (discountAmt / 100)
    : discountType === 'Fixed' ? discountAmt : 0;

  const taxLabel = body.tax_label || 'None';
  const taxRates = { 'GST 5%': 0.05, 'GST 12%': 0.12, 'GST 18%': 0.18 };
  const taxRate  = taxRates[taxLabel] || 0;
  const taxAmt   = (subtotal - discountValue) * taxRate;

  const shipping   = parseFloat(body.shipping_charges) || 0;
  const grandTotal = subtotal - discountValue + taxAmt + shipping;
  const amountPaid = parseFloat(body.amount_paid) || parseFloat(body.payment_amount) || 0;
  const paymentDue = Math.max(0, grandTotal - amountPaid);

  let paymentStatus = 'Due';
  if (amountPaid >= grandTotal && grandTotal > 0) paymentStatus = 'Paid';
  else if (amountPaid > 0)                        paymentStatus = 'Partial';

  return {
    subtotal: +subtotal.toFixed(2),
    discount_amount:  +discountValue.toFixed(2),
    tax_amount:       +taxAmt.toFixed(2),
    grand_total:      +grandTotal.toFixed(2),
    amount_paid:      +amountPaid.toFixed(2),
    payment_due:      +paymentDue.toFixed(2),
    payment_status:   paymentStatus,
  };
};

// ── FETCH ALL PURCHASES (paginated + filtered) ───────────────────────────────
const fetchAllPurchases = async (filters = {}) => {
  const {
    page = 1, limit = 25, search = '',
    supplier_id = '', purchase_status = '', payment_status = '',
    date_from = '', date_to = '', location = '',
  } = filters;

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  let q = `
    SELECT
      p.id, p.reference_no, p.invoice_no, p.purchase_date, p.location,
      p.supplier_id, p.supplier_name,
      p.purchase_status, p.payment_status,
      p.subtotal, p.discount_amount, p.tax_amount, p.shipping_charges,
      p.grand_total, p.amount_paid, p.payment_due,
      p.notes, p.pay_term, p.created_at,
      p.added_by,
      COALESCE(u.full_name, u.email, '') AS added_by_name
    FROM purchases p
    LEFT JOIN users u ON u.id::text = p.added_by::text
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    q += ` AND (
      LOWER(p.reference_no)   LIKE LOWER($${n}) OR
      LOWER(p.invoice_no)     LIKE LOWER($${n}) OR
      LOWER(p.supplier_name)  LIKE LOWER($${n}) OR
      LOWER(p.location)       LIKE LOWER($${n})
    )`;
  }
  if (supplier_id) {
    params.push(supplier_id);
    q += ` AND p.supplier_id = $${params.length}`;
  }
  if (purchase_status) {
    params.push(purchase_status);
    q += ` AND p.purchase_status = $${params.length}`;
  }
  if (payment_status) {
    params.push(payment_status);
    q += ` AND p.payment_status = $${params.length}`;
  }
  if (location) {
    params.push(`%${location}%`);
    q += ` AND LOWER(p.location) LIKE LOWER($${params.length})`;
  }
  if (date_from) {
    params.push(date_from);
    q += ` AND DATE(p.purchase_date AT TIME ZONE 'Asia/Kolkata') >= $${params.length}::date`;
  }
  if (date_to) {
    params.push(date_to);
    q += ` AND DATE(p.purchase_date AT TIME ZONE 'Asia/Kolkata') <= $${params.length}::date`;
  }

  // Count before pagination
  const countQ = q.replace(
    /SELECT[\s\S]*?FROM purchases/,
    'SELECT COUNT(*) FROM purchases'
  );
  const countResult = await pool.query(countQ, params);
  const total = parseInt(countResult.rows[0].count, 10);

  q += ` ORDER BY p.purchase_date DESC, p.id DESC`;
  params.push(parseInt(limit, 10));
  q += ` LIMIT $${params.length}`;
  params.push(offset);
  q += ` OFFSET $${params.length}`;

  const result = await pool.query(q, params);
  return { rows: result.rows, total };
};

// ── FETCH ONE PURCHASE (full detail with items + payments) ───────────────────
const fetchPurchaseById = async (id) => {
  const purchaseResult = await pool.query(
    `SELECT * FROM purchases p
     WHERE p.id = $1`,
    [id]
  );
  if (purchaseResult.rows.length === 0) return null;

  const items = await pool.query(
    `SELECT * FROM purchase_items WHERE purchase_id = $1 ORDER BY id`,
    [id]
  );
  const payments = await pool.query(
    `SELECT * FROM purchase_payments pp
     WHERE pp.purchase_id = $1
     ORDER BY pp.paid_on DESC`,
    [id]
  );

  return {
    ...purchaseResult.rows[0],
    items:    items.rows,
    payments: payments.rows,
  };
};

// ── CREATE PURCHASE ──────────────────────────────────────────────────────────
const createPurchase = async (body, userId) => {
  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) throw new Error('At least one product item is required');

    const referenceNo = body.reference_no?.trim()
      ? body.reference_no.trim()
      : await generateReferenceNo();

    // Check reference uniqueness
    const dupCheck = await client.query(
      `SELECT id FROM purchases WHERE reference_no = $1`, [referenceNo]
    );
    if (dupCheck.rows.length > 0) throw new Error(`Reference number "${referenceNo}" already exists`);

    const fin = calcFinancials(body, items);

    // Resolve supplier name
    let supplierName = body.supplier_name || null;
    if (!supplierName && body.supplier_id) {
      const sup = await client.query(`SELECT name FROM contacts WHERE id = $1`, [body.supplier_id]);
      if (sup.rows.length > 0) supplierName = sup.rows[0].name;
    }

 const purchaseStatus = (() => {
      const s = body.purchase_status || 'Ordered';
      return ['Received', 'Ordered', 'Pending', 'Cancelled'].includes(s) ? s : 'Ordered';
    })();

    const purchaseResult = await client.query(
      `INSERT INTO purchases (
        reference_no, invoice_no, purchase_date,
        supplier_id, supplier_name, location,
        purchase_status, payment_status,
        subtotal, discount_type, discount_amount,
        tax_label, tax_amount, shipping_charges,
        grand_total, amount_paid, payment_due,
        notes, shipping_details, document_path,
        pay_term, added_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
        $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
      ) RETURNING *`,
      [
        referenceNo,
        body.invoice_no        || null,
        body.purchase_date     || new Date(),
        body.supplier_id       || null,
        supplierName,
        body.location          || 'Manodtechnologies (BL0001)',
        purchaseStatus,
        fin.payment_status,
        fin.subtotal,
        body.discount_type     || 'None',
        fin.discount_amount,
        body.tax_label         || 'None',
        fin.tax_amount,
        parseFloat(body.shipping_charges) || 0,
        fin.grand_total,
        fin.amount_paid,
        fin.payment_due,
        body.notes             || null,
        body.shipping_details  || null,
        body.document_path     || null,
        body.pay_term          || null,
        userId                 || null,
      ]
    );

    const purchase = purchaseResult.rows[0];

    // Insert line items
    for (const item of items) {
      const qty      = parseFloat(item.quantity)     || 1;
      const cost     = parseFloat(item.unit_cost)    || 0;
      const disc     = parseFloat(item.discount_pct) || 0;
      const lineTotal = qty * cost * (1 - disc / 100);
      const selling  = cost * (1 + (parseFloat(item.margin_pct) || 0) / 100);

     await client.query(
        `INSERT INTO purchase_items (
          purchase_id, product_id, product_name, product_sku,
          quantity, unit_cost, discount_pct, line_total,
          margin_pct, selling_price
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          purchase.id,
          parseInt(item.product_id || item.id, 10) || null,
          item.product_name || item.name || 'Unnamed Product',
          item.product_sku  || item.sku  || null,
          qty, cost, disc,
          +lineTotal.toFixed(2),
          parseFloat(item.margin_pct) || 0,
          +selling.toFixed(4),
        ]
      );
    }

    // Purchase received → increase stock for every linked product
    if (purchaseStatus === 'Received') {
      await applyPurchaseStockImpact(purchase.id, 'apply', client);
    }

    // Insert initial payment if provided
    if (fin.amount_paid > 0) {
      await client.query(
        `INSERT INTO purchase_payments (
          purchase_id, amount, payment_method, paid_on, note, added_by
        ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          purchase.id,
          fin.amount_paid,
          body.payment_method || 'Cash',
          body.payment_date   || new Date(),
          body.payment_note   || null,
          userId              || null,
        ]
      );
    }

    await client.query('COMMIT');
    console.log(`✅ Purchase created: ${purchase.reference_no} (id: ${purchase.id})`);
    return purchase;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── UPDATE PURCHASE ──────────────────────────────────────────────────────────
const updatePurchase = async (id, body, userId) => {
  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(`SELECT * FROM purchases WHERE id = $1`, [id]);
    if (existing.rows.length === 0) throw new Error('Purchase not found');
    const prevStatus = existing.rows[0].purchase_status;

    // If it was already Received, reverse stock now — items may be replaced
    // and/or status may change below, so we reconcile from a clean slate.
    if (prevStatus === 'Received') {
      await applyPurchaseStockImpact(id, 'reverse', client);
    }

    const items = Array.isArray(body.items) ? body.items : null;
    const fin   = items ? calcFinancials(body, items) : null;

    // Build dynamic SET clause
    const sets   = [];
    const params = [];

    const setField = (col, val) => {
      if (val !== undefined) {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      }
    };

    setField('invoice_no',       body.invoice_no);
    setField('purchase_date',    body.purchase_date);
    setField('location',         body.location);
    setField('purchase_status',  body.purchase_status);
    setField('notes',            body.notes);
    setField('shipping_details', body.shipping_details);
    setField('document_path',    body.document_path);
    setField('pay_term',         body.pay_term);
    setField('discount_type',    body.discount_type);
    setField('tax_label',        body.tax_label);
    setField('shipping_charges', body.shipping_charges !== undefined ? parseFloat(body.shipping_charges) : undefined);

    if (fin) {
      setField('subtotal',        fin.subtotal);
      setField('discount_amount', fin.discount_amount);
      setField('tax_amount',      fin.tax_amount);
      setField('grand_total',     fin.grand_total);
      setField('amount_paid',     fin.amount_paid);
      setField('payment_due',     fin.payment_due);
      setField('payment_status',  fin.payment_status);
    }

    if (sets.length === 0 && !items) throw new Error('No fields to update');

    if (sets.length > 0) {
      params.push(id);
      await client.query(
        `UPDATE purchases SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
        params
      );
    }

  // Replace line items if provided
    if (items) {
      await client.query(`DELETE FROM purchase_items WHERE purchase_id = $1`, [id]);
      for (const item of items) {
        const qty      = parseFloat(item.quantity)     || 1;
        const cost     = parseFloat(item.unit_cost)    || 0;
        const disc     = parseFloat(item.discount_pct) || 0;
        const lineTotal = qty * cost * (1 - disc / 100);
        const selling  = cost * (1 + (parseFloat(item.margin_pct) || 0) / 100);

        await client.query(
          `INSERT INTO purchase_items (
            purchase_id, product_id, product_name, product_sku,
            quantity, unit_cost, discount_pct, line_total,
            margin_pct, selling_price
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            id,
            parseInt(item.product_id || item.id, 10) || null,
            item.product_name || item.name || 'Unnamed Product',
            item.product_sku  || item.sku  || null,
            qty, cost, disc,
            +lineTotal.toFixed(2),
            parseFloat(item.margin_pct) || 0,
            +selling.toFixed(4),
          ]
        );
      }
      // Re-sync payment status after total changes
      await recalcPaymentStatus(id, client);
    }

    // Apply stock if the purchase ends up Received (whether it just changed
    // to Received, or was Received all along and items got replaced)
    const finalStatus = body.purchase_status || prevStatus;
    if (finalStatus === 'Received') {
      await applyPurchaseStockImpact(id, 'apply', client);
    }

    await client.query('COMMIT');
    console.log(`✅ Purchase updated: id ${id}`);
    return fetchPurchaseById(id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── DELETE PURCHASE ──────────────────────────────────────────────────────────
const deletePurchase = async (id) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(`SELECT purchase_status FROM purchases WHERE id = $1`, [id]);
    if (existing.rows.length === 0) throw new Error('Purchase not found');

    // Reverse stock before the items get cascade-deleted with the purchase
    if (existing.rows[0].purchase_status === 'Received') {
      await applyPurchaseStockImpact(id, 'reverse', client);
    }

    const result = await client.query(
      `DELETE FROM purchases WHERE id = $1 RETURNING id, reference_no`,
      [id]
    );

    await client.query('COMMIT');
    console.log(`🗑️  Purchase deleted: ${result.rows[0].reference_no}`);
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
// ── ADD PAYMENT ──────────────────────────────────────────────────────────────
const addPayment = async (purchaseId, body, userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const purchase = await client.query(`SELECT id, grand_total FROM purchases WHERE id = $1`, [purchaseId]);
    if (purchase.rows.length === 0) throw new Error('Purchase not found');

    const amount = parseFloat(body.amount);
    if (!amount || amount <= 0) throw new Error('Payment amount must be greater than 0');

    const result = await client.query(
      `INSERT INTO purchase_payments (
        purchase_id, amount, payment_method, paid_on, note, added_by
      ) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        purchaseId,
        amount,
        body.payment_method || 'Cash',
        body.paid_on        || new Date(),
        body.note           || null,
        userId              || null,
      ]
    );

    await recalcPaymentStatus(purchaseId, client);
    await client.query('COMMIT');
    console.log(`✅ Payment added to purchase ${purchaseId}: ₹${amount}`);
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── DELETE PAYMENT ───────────────────────────────────────────────────────────
const deletePayment = async (purchaseId, paymentId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `DELETE FROM purchase_payments WHERE id = $1 AND purchase_id = $2 RETURNING *`,
      [paymentId, purchaseId]
    );
    if (result.rows.length === 0) throw new Error('Payment not found');

    await recalcPaymentStatus(purchaseId, client);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── DASHBOARD STATS ──────────────────────────────────────────────────────────
const getPurchaseStats = async () => {
  const result = await pool.query(`
    SELECT
      COUNT(*)                                              AS total_purchases,
      COALESCE(SUM(grand_total), 0)                        AS total_value,
      COALESCE(SUM(amount_paid), 0)                        AS total_paid,
      COALESCE(SUM(payment_due), 0)                        AS total_due,
      COUNT(*) FILTER (WHERE payment_status = 'Due')       AS due_count,
      COUNT(*) FILTER (WHERE payment_status = 'Partial')   AS partial_count,
      COUNT(*) FILTER (WHERE payment_status = 'Paid')      AS paid_count,
      COUNT(*) FILTER (WHERE purchase_status = 'Ordered')  AS ordered_count,
      COUNT(*) FILTER (WHERE purchase_status = 'Received') AS received_count,
      COUNT(*) FILTER (WHERE purchase_status = 'Pending')  AS pending_count,
      COUNT(*) FILTER (WHERE purchase_status = 'Cancelled') AS cancelled_count
    FROM purchases
  `);
  return result.rows[0];
};

// ── SUPPLIER DROPDOWN (for Add/Edit form) ────────────────────────────────────
const getSuppliersList = async () => {
  const result = await pool.query(
    `SELECT id, name, contact_id, mobile, email
     FROM contacts
     WHERE contact_type IN ('Suppliers', 'Both')
     ORDER BY name`
  );
  return result.rows;
};

// ── PRODUCT SEARCH (for Add Purchase product dropdown) ───────────────────────
const searchProducts = async (query = '') => {
  try {
    const params = [];
    let q = `SELECT * FROM products WHERE 1=1`;
    if (query.trim()) {
      params.push(`%${query.trim()}%`);
      q += ` AND (
        LOWER(name) LIKE LOWER($${params.length}) OR
        LOWER(COALESCE(sku, '')) LIKE LOWER($${params.length})
      )`;
    }
    q += ` ORDER BY name LIMIT 50`;
    const result = await pool.query(q, params);

// Normalise column names — handle different product table schemas
    return result.rows.map(p => ({
      id:            p.id,
      name:          p.name || p.product_name || '',
      sku:           p.sku  || p.product_sku  || '',
      default_price: p.purchase_price_exc_tax || p.purchase_price_inc_tax || 0,
      selling_price: p.selling_price_exc_tax || 0,
      unit_name:     p.unit || p.unit_name || '',
    }));
  } catch (err) {
    console.error('Product search error:', err.message);
    return []; // Return empty array — don't crash the server
  }
};

module.exports = {
  fetchAllPurchases,
  fetchPurchaseById,
  createPurchase,
  updatePurchase,
  deletePurchase,
  addPayment,
  deletePayment,
  getPurchaseStats,
  getSuppliersList,
  searchProducts,
};