/**
 * ====================================================
 * services/reportService.js
 *
 * Read-only aggregation queries for the Reports module.
 * Mirrors the query style already used across
 * productService.js / stockAdjustmentService.js —
 * plain pg pool, parameterized WHERE clauses, no ORM.
 *
 * IMPORTANT: This file only SELECTs. It never mutates
 * products / stock_adjustments / purchases / sales_* etc,
 * so none of the existing CRUD logic is touched.
 * ====================================================
 */

'use strict';

const pool = require('../config/database');

// ── Shared date-range WHERE helper ───────────────────────────────────────────
function pushDateRange(params, whereArr, column, date_from, date_to) {
  if (date_from) {
    params.push(date_from);
    whereArr.push(`${column} >= $${params.length}::date`);
  }
  if (date_to) {
    params.push(date_to);
    whereArr.push(`${column} < ($${params.length}::date + INTERVAL '1 day')`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVITY LOG REPORT  → activity_logs table (live)
// ═══════════════════════════════════════════════════════════════════════════
const getActivityLogReport = async (filters = {}) => {
  const { user = '', module = '', search = '', date_from = '', date_to = '', page = 1, limit = 25 } = filters;

  const where = ['1=1'];
  const params = [];

  if (user) {
    params.push(`%${user}%`);
    where.push(`al.user_name ILIKE $${params.length}`);
  }
  if (module) {
    params.push(`%${module}%`);
    where.push(`al.module ILIKE $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(al.action ILIKE $${params.length} OR al.detail ILIKE $${params.length} OR al.user_name ILIKE $${params.length})`);
  }
  pushDateRange(params, where, 'al.created_at', date_from, date_to);

  const whereClause = where.join(' AND ');

  const countRes = await pool.query(`SELECT COUNT(*) FROM activity_logs al WHERE ${whereClause}`, params);
  const total = parseInt(countRes.rows[0].count, 10);

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const dataParams = [...params, parseInt(limit, 10), offset];

  const { rows } = await pool.query(
    `SELECT al.id, al.created_at, al.user_name, al.module, al.action, al.detail, al.ip_address
     FROM activity_logs al
     WHERE ${whereClause}
     ORDER BY al.created_at DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  const summaryRes = await pool.query(
    `SELECT
       COUNT(*) AS total_events,
       COUNT(*) FILTER (WHERE al.created_at::date = CURRENT_DATE) AS today_count,
       COUNT(DISTINCT al.user_name) AS users_active,
       COUNT(DISTINCT al.module) AS module_count
     FROM activity_logs al
     WHERE ${whereClause}`,
    params
  );

  return { rows, total, summary: summaryRes.rows[0] };
};

// ═══════════════════════════════════════════════════════════════════════════
// 1. STOCK REPORT  → Products + current_stock + business_locations
// ═══════════════════════════════════════════════════════════════════════════
const getStockReport = async (filters = {}) => {
  const { location = '', category = '', brand = '', page = 1, limit = 25 } = filters;

  const where = ['1=1'];
  const params = [];

  if (location) {
    params.push(`%${location}%`);
    where.push(`p.business_location ILIKE $${params.length}`);
  }
  if (category) {
    params.push(`%${category}%`);
    where.push(`pc.name ILIKE $${params.length}`);
  }
  if (brand) {
    params.push(`%${brand}%`);
    where.push(`pb.name ILIKE $${params.length}`);
  }

  const whereClause = where.join(' AND ');

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM products p
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     LEFT JOIN product_brands     pb ON pb.id = p.brand_id
     WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const dataParams = [...params, parseInt(limit, 10), offset];

  const { rows } = await pool.query(
    `SELECT
       p.id, p.name AS product, p.sku,
       pc.name AS category, pb.name AS brand,
       p.business_location AS location,
       COALESCE(p.current_stock, 0) AS qty,
       COALESCE(p.alert_qty, 0) AS reorder_point,
       COALESCE(p.current_stock, 0) * COALESCE(p.purchase_price_exc_tax, 0) AS stock_value,
       CASE
         WHEN COALESCE(p.current_stock, 0) <= 0 THEN 'Out of Stock'
         WHEN COALESCE(p.current_stock, 0) < COALESCE(p.alert_qty, 0) THEN 'Low Stock'
         ELSE 'In Stock'
       END AS status
     FROM products p
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     LEFT JOIN product_brands     pb ON pb.id = p.brand_id
     WHERE ${whereClause}
     ORDER BY p.name ASC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  const summaryRes = await pool.query(
    `SELECT
       COUNT(*) AS total_skus,
       COALESCE(SUM(COALESCE(p.current_stock,0) * COALESCE(p.purchase_price_exc_tax,0)), 0) AS total_stock_value,
       COUNT(*) FILTER (WHERE COALESCE(p.current_stock,0) < COALESCE(p.alert_qty,0)) AS low_or_out_count,
       (SELECT COUNT(*) FROM business_locations) AS warehouse_count
     FROM products p
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     LEFT JOIN product_brands     pb ON pb.id = p.brand_id
     WHERE ${whereClause}`,
    params
  );

  return { rows, total, summary: summaryRes.rows[0] };
};

// ═══════════════════════════════════════════════════════════════════════════
// 2. STOCK ADJUSTMENT REPORT → stock_adjustments + items + products
// ═══════════════════════════════════════════════════════════════════════════
const getStockAdjustmentReport = async (filters = {}) => {
  const {
    location = '', adjustment_type = '', date_from = '', date_to = '',
    page = 1, limit = 25,
  } = filters;

  const where = ['1=1'];
  const params = [];

  if (location) {
    params.push(location);
    where.push(`sa.location = $${params.length}`);
  }
  if (adjustment_type) {
    params.push(adjustment_type);
    where.push(`sa.adjustment_type = $${params.length}`);
  }
  pushDateRange(params, where, 'sa.adjustment_date', date_from, date_to);

  const whereClause = where.join(' AND ');

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM stock_adjustments sa WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const dataParams = [...params, parseInt(limit, 10), offset];

  const { rows } = await pool.query(
    `SELECT
       sa.id, sa.reference_no AS ref, sa.adjustment_date AS date,
       sa.adjustment_type AS type, sa.location, sa.reason,
       sa.total_amount AS value,
       u.full_name AS added_by,
       COALESCE(
         (SELECT string_agg(p.name, ', ')
          FROM stock_adjustment_items sai
          LEFT JOIN products p ON p.id = sai.product_id
          WHERE sai.stock_adjustment_id = sa.id), '—'
       ) AS products,
       COALESCE(
         (SELECT SUM(sai.quantity)
          FROM stock_adjustment_items sai
          WHERE sai.stock_adjustment_id = sa.id), 0
       ) AS qty
     FROM stock_adjustments sa
     LEFT JOIN users u ON u.id = sa.created_by
     WHERE ${whereClause}
     ORDER BY sa.adjustment_date DESC, sa.id DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  const summaryRes = await pool.query(
    `SELECT
       COUNT(*) AS total_adjustments,
       COUNT(*) FILTER (WHERE sa.adjustment_type = 'Addition')  AS additions,
       COUNT(*) FILTER (WHERE sa.adjustment_type = 'Deduction') AS deductions,
       COALESCE(SUM(
         CASE WHEN sa.adjustment_type = 'Addition' THEN sa.total_amount
              WHEN sa.adjustment_type = 'Deduction' THEN -sa.total_amount
              ELSE 0 END
       ), 0) AS net_value_change
     FROM stock_adjustments sa
     WHERE ${whereClause}`,
    params
  );

  return { rows, total, summary: summaryRes.rows[0] };
};

// ═══════════════════════════════════════════════════════════════════════════
// 3. ITEMS REPORT → products + SUM(purchase_items) + SUM(sales_invoice_items)
//    Purchases match by product_id (reliable FK).
//    Sales match by LOWER(sku) — sales_invoice_items.product_id is always
//    NULL at insert time (confirmed in sellService.createInvoice), so SKU
//    is the only reliable join key on the sell side.
// ═══════════════════════════════════════════════════════════════════════════
const getItemsReport = async (filters = {}) => {
  const { category = '', brand = '', page = 1, limit = 25 } = filters;

  const where = ['1=1'];
  const params = [];

  if (category) {
    params.push(`%${category}%`);
    where.push(`pc.name ILIKE $${params.length}`);
  }
  if (brand) {
    params.push(`%${brand}%`);
    where.push(`pb.name ILIKE $${params.length}`);
  }

  const whereClause = where.join(' AND ');

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM products p
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     LEFT JOIN product_brands     pb ON pb.id = p.brand_id
     WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const dataParams = [...params, parseInt(limit, 10), offset];

  const { rows } = await pool.query(
    `SELECT
       p.id, p.name AS product, p.sku,
       pc.name AS category, pb.name AS brand,
       COALESCE(pur.total_purchased, 0) AS purchased,
       COALESCE(sel.total_sold, 0) AS units_sold,
       COALESCE(p.current_stock, 0) AS balance,
       COALESCE(p.purchase_price_exc_tax, 0) AS purchase_price,
       COALESCE(p.selling_price_exc_tax, 0) AS sell_price,
       CASE
         WHEN COALESCE(p.purchase_price_exc_tax, 0) = 0 THEN 0
         ELSE ROUND(
           ((COALESCE(p.selling_price_exc_tax,0) - p.purchase_price_exc_tax)
             / p.purchase_price_exc_tax) * 100
         )
       END AS margin_pct
     FROM products p
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     LEFT JOIN product_brands     pb ON pb.id = p.brand_id
     LEFT JOIN (
       SELECT product_id, SUM(quantity) AS total_purchased
       FROM purchase_items
       WHERE product_id IS NOT NULL
       GROUP BY product_id
     ) pur ON pur.product_id = p.id
     LEFT JOIN (
       SELECT LOWER(sku) AS sku_key, SUM(qty) AS total_sold
       FROM sales_invoice_items
       WHERE sku IS NOT NULL
       GROUP BY LOWER(sku)
     ) sel ON sel.sku_key = LOWER(p.sku)
     WHERE ${whereClause}
     ORDER BY p.name ASC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  const summaryRes = await pool.query(
    `SELECT
       COUNT(*) AS total_products,
       COALESCE((SELECT SUM(qty) FROM sales_invoice_items), 0) AS total_units_sold,
       (SELECT COUNT(DISTINCT category_id) FROM products WHERE category_id IS NOT NULL) AS category_count
     FROM products p
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     LEFT JOIN product_brands     pb ON pb.id = p.brand_id
     WHERE ${whereClause}`,
    params
  );

  return { rows, total, summary: summaryRes.rows[0] };
};

// ═══════════════════════════════════════════════════════════════════════════
// 4. PRODUCT PURCHASE REPORT → purchase_items + purchases
// ═══════════════════════════════════════════════════════════════════════════
const getProductPurchaseReport = async (filters = {}) => {
  const {
    product = '', supplier = '', date_from = '', date_to = '',
    page = 1, limit = 25,
  } = filters;

  const where = ['1=1'];
  const params = [];

  if (product) {
    params.push(`%${product}%`);
    where.push(`pi.product_name ILIKE $${params.length}`);
  }
  if (supplier) {
    params.push(`%${supplier}%`);
    where.push(`pu.supplier_name ILIKE $${params.length}`);
  }
  pushDateRange(params, where, 'pu.purchase_date', date_from, date_to);

  const whereClause = where.join(' AND ');

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM purchase_items pi
     JOIN purchases pu ON pu.id = pi.purchase_id
     WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const dataParams = [...params, parseInt(limit, 10), offset];

  const { rows } = await pool.query(
    `SELECT
       pu.purchase_date AS date,
       pu.reference_no AS invoice_no,
       pi.product_name AS product,
       pi.product_sku AS sku,
       pu.supplier_name AS supplier,
       pi.quantity AS qty,
       pi.unit_cost,
       pi.line_total AS amount,
       pu.payment_status AS status
     FROM purchase_items pi
     JOIN purchases pu ON pu.id = pi.purchase_id
     WHERE ${whereClause}
     ORDER BY pu.purchase_date DESC, pi.id DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  const summaryRes = await pool.query(
    `SELECT
       COUNT(*) AS total_purchases,
       COALESCE(SUM(pi.line_total), 0) AS total_amount,
       COUNT(*) FILTER (WHERE pu.payment_status = 'Paid') AS paid_count,
       COUNT(*) FILTER (WHERE pu.payment_status = 'Due')  AS due_count,
       COALESCE(SUM(pi.quantity), 0) AS total_qty
     FROM purchase_items pi
     JOIN purchases pu ON pu.id = pi.purchase_id
     WHERE ${whereClause}`,
    params
  );

  return { rows, total, summary: summaryRes.rows[0] };
};

// ═══════════════════════════════════════════════════════════════════════════
// 5. PRODUCT SELL REPORT → sales_invoice_items + sales_invoices
//    (customer is a plain text column on sales_invoices, no contacts FK)
// ═══════════════════════════════════════════════════════════════════════════
const getProductSellReport = async (filters = {}) => {
  const {
    product = '', customer = '', date_from = '', date_to = '',
    page = 1, limit = 25,
  } = filters;

  const where = ['1=1'];
  const params = [];

  if (product) {
    params.push(`%${product}%`);
    where.push(`si.product ILIKE $${params.length}`);
  }
  if (customer) {
    params.push(`%${customer}%`);
    where.push(`inv.customer ILIKE $${params.length}`);
  }
  pushDateRange(params, where, 'inv.invoice_date', date_from, date_to);

  const whereClause = where.join(' AND ');

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM sales_invoice_items si
     JOIN sales_invoices inv ON inv.id = si.invoice_id
     WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const dataParams = [...params, parseInt(limit, 10), offset];

  const { rows } = await pool.query(
    `SELECT
       inv.invoice_date AS date,
       inv.invoice_no,
       si.product,
       si.sku,
       inv.customer,
       si.qty,
       si.unit_price,
       si.line_total AS amount,
       inv.payment_status AS status
     FROM sales_invoice_items si
     JOIN sales_invoices inv ON inv.id = si.invoice_id
     WHERE ${whereClause}
     ORDER BY inv.invoice_date DESC, si.id DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  const summaryRes = await pool.query(
    `SELECT
       COUNT(*) AS total_orders,
       COALESCE(SUM(si.line_total), 0) AS total_revenue,
       COUNT(*) FILTER (WHERE inv.payment_status != 'Due') AS paid_or_received_count,
       COUNT(*) FILTER (WHERE inv.payment_status = 'Due')  AS due_count,
       COALESCE(SUM(si.qty), 0) AS total_units
     FROM sales_invoice_items si
     JOIN sales_invoices inv ON inv.id = si.invoice_id
     WHERE ${whereClause}`,
    params
  );

  return { rows, total, summary: summaryRes.rows[0] };
};

// ═══════════════════════════════════════════════════════════════════════════
// 6. EXPENSE REPORT → expenses + expense_categories + users
//    (mirrors expenseService.fetchAllExpenses joins/columns exactly —
//     read-only, does not touch expenses table logic)
// ═══════════════════════════════════════════════════════════════════════════
const getExpenseReport = async (filters = {}) => {
  const {
    category = '', location = '', date_from = '', date_to = '',
    page = 1, limit = 25,
  } = filters;

  const where = ['1=1'];
  const params = [];

  if (category) {
    params.push(`%${category}%`);
    where.push(`c.name ILIKE $${params.length}`);
  }
  if (location) {
    params.push(`%${location}%`);
    where.push(`e.location ILIKE $${params.length}`);
  }
  pushDateRange(params, where, 'e.expense_date', date_from, date_to);

  const whereClause = where.join(' AND ');

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM expenses e
     LEFT JOIN expense_categories c ON c.id = e.category_id
     WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const dataParams = [...params, parseInt(limit, 10), offset];

  const { rows } = await pool.query(
    `SELECT
       e.expense_date AS date,
       e.expense_number AS ref,
       c.name AS category,
       e.expense_for AS note,
       e.location,
       COALESCE(e.total_amount, 0) AS amount,
       u.full_name AS added_by
     FROM expenses e
     LEFT JOIN expense_categories c ON c.id = e.category_id
     LEFT JOIN users u ON u.id = e.added_by
     WHERE ${whereClause}
     ORDER BY e.expense_date DESC, e.id DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  const summaryRes = await pool.query(
    `SELECT
       COUNT(*) AS total_expenses,
       COALESCE(SUM(e.total_amount), 0) AS total_amount,
       (SELECT COUNT(DISTINCT location) FROM expenses WHERE location IS NOT NULL AND location != '') AS location_count,
       (
         SELECT c2.name FROM expenses e2
         LEFT JOIN expense_categories c2 ON c2.id = e2.category_id
         GROUP BY c2.name ORDER BY SUM(e2.total_amount) DESC NULLS LAST LIMIT 1
       ) AS top_category
     FROM expenses e
     LEFT JOIN expense_categories c ON c.id = e.category_id
     WHERE ${whereClause}`,
    params
  );

  return { rows, total, summary: summaryRes.rows[0] };
};

// ═══════════════════════════════════════════════════════════════════════════
// 7. SALES REPRESENTATIVE REPORT → sales_invoices grouped by salesperson
//    (salesperson is a plain text column, no FK — matches SalespersonCombobox
//     values used at invoice creation time in sellService.js)
//
//    Extra columns added (per business requirement) and how each is sourced:
//      employee_id        → users.id, matched by full_name = salesperson
//                            (best-effort text match — salesperson has no FK
//                            to users, so unmatched reps get null → '—')
//      customers_handled  → COUNT(DISTINCT customer) on this rep's invoices
//      quotations         → COUNT(*) from quotations where salesperson matches
//      sales_orders       → always 0 — there is no separate "Sales Order"
//                            entity in this schema (only quotations,
//                            sales_invoices, sales_returns, pos_sales exist)
//      sales_invoices      → COUNT(*) of this rep's invoices
//      payments_collected → SUM(paid_amount)
//      outstanding        → SUM(grand_total - paid_amount), floored at 0/row
//      sales_returns      → COUNT(*) from sales_returns, joined back to the
//                            rep via sales_returns.invoice_ref → sales_invoices.salesperson
//                            (sales_returns has no salesperson column itself)
//      commission         → best-effort match against sales_commission_agents
//                            by name; recomputed from that agent's
//                            commission_type/commission_rate against this
//                            rep's total_sales (mirrors commissionAgentService's
//                            own calculateCommission logic). 0 if no agent
//                            record matches the rep's name.
//      target/achievement → always 0 — no target column exists anywhere in
//                            the schema (sales_commission_agents has no
//                            target field either)
// ═══════════════════════════════════════════════════════════════════════════
const getSalesRepresentativeReport = async (filters = {}) => {
  const {
    sales_rep = '', location = '', date_from = '', date_to = '',
    page = 1, limit = 25,
  } = filters;

  const where = [`inv.salesperson IS NOT NULL`, `inv.salesperson != ''`];
  const params = [];

  if (sales_rep) {
    params.push(`%${sales_rep}%`);
    where.push(`inv.salesperson ILIKE $${params.length}`);
  }
  if (location) {
    params.push(`%${location}%`);
    where.push(`inv.warehouse ILIKE $${params.length}`);
  }
  pushDateRange(params, where, 'inv.invoice_date', date_from, date_to);

  const whereClause = where.join(' AND ');

  // Count + summary both use only the main invoice filters — untouched
  // from the original implementation.
  const countRes = await pool.query(
    `SELECT COUNT(DISTINCT inv.salesperson) FROM sales_invoices inv WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);

  // Data query needs its own param list: same date range re-applied to the
  // quotations / sales_returns lateral subqueries below, each needing its
  // own positional placeholders.
  const dataParams = [...params];

  const quotWhere = [`q2.salesperson ILIKE rs.representative`];
  if (date_from) { dataParams.push(date_from); quotWhere.push(`q2.quot_date >= $${dataParams.length}`); }
  if (date_to)   { dataParams.push(date_to);   quotWhere.push(`q2.quot_date <= $${dataParams.length}`); }

  const retWhere = [`inv2.salesperson ILIKE rs.representative`];
  if (date_from) { dataParams.push(date_from); retWhere.push(`sr2.return_date >= $${dataParams.length}`); }
  if (date_to)   { dataParams.push(date_to);   retWhere.push(`sr2.return_date <= $${dataParams.length}`); }

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  dataParams.push(parseInt(limit, 10), offset);

  const { rows } = await pool.query(
    `WITH rep_sales AS (
       SELECT
         inv.salesperson AS representative,
         STRING_AGG(DISTINCT inv.warehouse, ', ') AS territory,
         COUNT(DISTINCT inv.customer) AS customers_handled,
         COUNT(*) AS sales_invoices,
         COALESCE(SUM(inv.grand_total), 0) AS total_sales,
         COALESCE(SUM(inv.paid_amount), 0) AS payments_collected,
         COALESCE(SUM(GREATEST(inv.grand_total - inv.paid_amount, 0)), 0) AS outstanding,
         CASE WHEN COUNT(*) = 0 THEN 0 ELSE ROUND(SUM(inv.grand_total) / COUNT(*)) END AS avg_order
       FROM sales_invoices inv
       WHERE ${whereClause}
       GROUP BY inv.salesperson
     )
     SELECT
       rs.representative,
       u.id AS employee_id,
       rs.territory,
       rs.customers_handled,
       COALESCE(q.quote_count, 0) AS quotations,
       0 AS sales_orders,
       rs.sales_invoices,
       rs.total_sales,
       rs.payments_collected,
       rs.outstanding,
       COALESCE(r.return_count, 0) AS sales_returns,
       COALESCE(
         CASE
           WHEN ca.commission_type ILIKE 'percentage' THEN ROUND(rs.total_sales * ca.commission_rate / 100)
           WHEN ca.commission_type ILIKE 'fixed'       THEN ca.commission_rate
           WHEN ca.commission_type ILIKE 'tiered' THEN
             CASE
               WHEN rs.total_sales <= 100000 THEN ROUND(rs.total_sales * 2 / 100)
               WHEN rs.total_sales <= 500000 THEN ROUND(rs.total_sales * 4 / 100)
               ELSE ROUND(rs.total_sales * 6 / 100)
             END
           ELSE 0
         END, 0
       ) AS commission,
       0 AS target,
       0 AS achievement_pct,
       rs.avg_order
     FROM rep_sales rs
     LEFT JOIN LATERAL (
       SELECT id FROM users WHERE full_name ILIKE rs.representative LIMIT 1
     ) u ON true
     LEFT JOIN LATERAL (
       SELECT commission_type, commission_rate FROM sales_commission_agents
       WHERE name ILIKE rs.representative LIMIT 1
     ) ca ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS quote_count FROM quotations q2 WHERE ${quotWhere.join(' AND ')}
     ) q ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS return_count
       FROM sales_returns sr2
       JOIN sales_invoices inv2 ON inv2.invoice_no = sr2.invoice_ref
       WHERE ${retWhere.join(' AND ')}
     ) r ON true
     ORDER BY rs.total_sales DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  // Keep "orders" fallback field identical to the old response shape so
  // anything still reading it (e.g. Reports.jsx COLS fallback) doesn't break,
  // and normalize a blank territory (rep only ever sold with no warehouse set).
  rows.forEach(r => {
    r.orders = r.sales_invoices;
    r.territory = r.territory || '—';
  });

  const summaryRes = await pool.query(
    `SELECT
       COUNT(DISTINCT inv.salesperson) AS total_reps,
       COALESCE(SUM(inv.grand_total), 0) AS team_revenue,
       (
         SELECT inv2.salesperson FROM sales_invoices inv2
         WHERE inv2.salesperson IS NOT NULL AND inv2.salesperson != ''
         GROUP BY inv2.salesperson
         ORDER BY SUM(inv2.grand_total) DESC LIMIT 1
       ) AS top_performer,
       (
         SELECT COALESCE(SUM(inv3.grand_total), 0) FROM sales_invoices inv3
         WHERE inv3.salesperson = (
           SELECT inv4.salesperson FROM sales_invoices inv4
           WHERE inv4.salesperson IS NOT NULL AND inv4.salesperson != ''
           GROUP BY inv4.salesperson
           ORDER BY SUM(inv4.grand_total) DESC LIMIT 1
         )
       ) AS top_performer_sales
     FROM sales_invoices inv
     WHERE ${whereClause}`,
    params
  );

  return { rows, total, summary: summaryRes.rows[0] };
};

// ═══════════════════════════════════════════════════════════════════════════
// 8. PURCHASE PAYMENT REPORT → purchases (payment fields) + purchase_payments
// ═══════════════════════════════════════════════════════════════════════════
const getPurchasePaymentReport = async (filters = {}) => {
  const {
    supplier = '', payment_method = '', date_from = '', date_to = '',
    page = 1, limit = 25,
  } = filters;

  const where = ['1=1'];
  const params = [];

  if (supplier) {
    params.push(`%${supplier}%`);
    where.push(`p.supplier_name ILIKE $${params.length}`);
  }
  if (payment_method) {
    params.push(`%${payment_method}%`);
    where.push(`pm.method ILIKE $${params.length}`);
  }
  pushDateRange(params, where, 'p.purchase_date', date_from, date_to);

  const whereClause = where.join(' AND ');

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM purchases p
     LEFT JOIN LATERAL (
       SELECT string_agg(DISTINCT pp.payment_method, ', ') AS method
       FROM purchase_payments pp WHERE pp.purchase_id = p.id
     ) pm ON true
     WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const dataParams = [...params, parseInt(limit, 10), offset];

  const { rows } = await pool.query(
    `SELECT
       p.purchase_date AS date,
       p.supplier_name AS supplier,
       p.reference_no AS invoice,
       COALESCE(p.grand_total, 0) AS amount,
       COALESCE(p.amount_paid, 0) AS paid,
       COALESCE(p.payment_due, 0) AS balance,
       COALESCE(pm.method, '—') AS method,
       p.payment_status AS status
     FROM purchases p
     LEFT JOIN LATERAL (
       SELECT string_agg(DISTINCT pp.payment_method, ', ') AS method
       FROM purchase_payments pp WHERE pp.purchase_id = p.id
     ) pm ON true
     WHERE ${whereClause}
     ORDER BY p.purchase_date DESC, p.id DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  const summaryRes = await pool.query(
    `SELECT
       COUNT(*) AS total_invoices,
       COALESCE(SUM(p.grand_total), 0) AS total_billed,
       COALESCE(SUM(p.amount_paid), 0) AS total_paid,
       COALESCE(SUM(p.payment_due), 0) AS outstanding,
       COUNT(*) FILTER (WHERE p.payment_status = 'Paid') AS fully_paid_count
     FROM purchases p
     WHERE ${whereClause}`,
    params
  );

  return { rows, total, summary: summaryRes.rows[0] };
};

// ═══════════════════════════════════════════════════════════════════════════
// 9. SELL PAYMENT REPORT → sales_invoices (payment fields)
//    balance = grand_total - paid_amount (no separate balance column exists)
// ═══════════════════════════════════════════════════════════════════════════
const getSellPaymentReport = async (filters = {}) => {
  const {
    customer = '', payment_method = '', date_from = '', date_to = '',
    page = 1, limit = 25,
  } = filters;

  const where = ['1=1'];
  const params = [];

  if (customer) {
    params.push(`%${customer}%`);
    where.push(`inv.customer ILIKE $${params.length}`);
  }
  if (payment_method) {
    params.push(`%${payment_method}%`);
    where.push(`inv.payment_method ILIKE $${params.length}`);
  }
  pushDateRange(params, where, 'inv.invoice_date', date_from, date_to);

  const whereClause = where.join(' AND ');

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM sales_invoices inv WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const dataParams = [...params, parseInt(limit, 10), offset];

  const { rows } = await pool.query(
    `SELECT
       inv.invoice_date AS date,
       inv.customer,
       inv.invoice_no AS invoice,
       COALESCE(inv.grand_total, 0) AS amount,
       COALESCE(inv.paid_amount, 0) AS received,
       GREATEST(COALESCE(inv.grand_total, 0) - COALESCE(inv.paid_amount, 0), 0) AS balance,
       COALESCE(inv.payment_method, '—') AS method,
       inv.payment_status AS status
     FROM sales_invoices inv
     WHERE ${whereClause}
     ORDER BY inv.invoice_date DESC, inv.id DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

 const summaryRes = await pool.query(
    `SELECT
       COUNT(*) AS total_invoices,
       COALESCE(SUM(inv.grand_total), 0) AS total_billed,
       COALESCE(SUM(inv.paid_amount), 0) AS total_received,
       COALESCE(SUM(GREATEST(inv.grand_total - inv.paid_amount, 0)), 0) AS outstanding,
       COUNT(*) FILTER (WHERE inv.payment_status = 'Paid') AS fully_received_count
     FROM sales_invoices inv
     WHERE ${whereClause}`,
    params
  );

  return { rows, total, summary: summaryRes.rows[0] };
};

// ═══════════════════════════════════════════════════════════════════════════
// 10. PROFIT / LOSS REPORT → sales_invoices (revenue) - expenses - purchases
//     Grouped by calendar month. Revenue = SUM(grand_total) from sales_invoices.
//     Expenses = SUM(total_amount) from expenses + SUM(grand_total) from purchases
//     (purchases counted as cost of goods, matching how Purchase & Sale report
//     treats "purchased" amount).
// ═══════════════════════════════════════════════════════════════════════════
const getProfitLossReport = async (filters = {}) => {
  const { location = '', date_from = '', date_to = '', page = 1, limit = 12 } = filters;

  const revWhere = ['1=1'];
  const revParams = [];
  pushDateRange(revParams, revWhere, 'inv.invoice_date', date_from, date_to);
  const revWhereClause = revWhere.join(' AND ');

  const expWhere = ['1=1'];
  const expParams = [];
  if (location) {
    expParams.push(`%${location}%`);
    expWhere.push(`e.location ILIKE $${expParams.length}`);
  }
  pushDateRange(expParams, expWhere, 'e.expense_date', date_from, date_to);
  const expWhereClause = expWhere.join(' AND ');

  const purWhere = ['1=1'];
  const purParams = [];
  pushDateRange(purParams, purWhere, 'p.purchase_date', date_from, date_to);
  const purWhereClause = purWhere.join(' AND ');

  const { rows: revRows } = await pool.query(
    `SELECT TO_CHAR(inv.invoice_date, 'YYYY-MM') AS ym, COALESCE(SUM(inv.grand_total), 0) AS revenue
     FROM sales_invoices inv WHERE ${revWhereClause}
     GROUP BY ym`,
    revParams
  );
  const { rows: expRows } = await pool.query(
    `SELECT TO_CHAR(e.expense_date, 'YYYY-MM') AS ym, COALESCE(SUM(e.total_amount), 0) AS expenses
     FROM expenses e WHERE ${expWhereClause}
     GROUP BY ym`,
    expParams
  );
  const { rows: purRows } = await pool.query(
    `SELECT TO_CHAR(p.purchase_date, 'YYYY-MM') AS ym, COALESCE(SUM(p.grand_total), 0) AS purchases
     FROM purchases p WHERE ${purWhereClause}
     GROUP BY ym`,
    purParams
  );

  const map = {};
  revRows.forEach((r) => { map[r.ym] = map[r.ym] || { ym: r.ym, revenue: 0, expenses: 0, purchases: 0 }; map[r.ym].revenue = Number(r.revenue); });
  expRows.forEach((r) => { map[r.ym] = map[r.ym] || { ym: r.ym, revenue: 0, expenses: 0, purchases: 0 }; map[r.ym].expenses = Number(r.expenses); });
  purRows.forEach((r) => { map[r.ym] = map[r.ym] || { ym: r.ym, revenue: 0, expenses: 0, purchases: 0 }; map[r.ym].purchases = Number(r.purchases); });

  const allMonths = Object.values(map).sort((a, b) => b.ym.localeCompare(a.ym));

  const total = allMonths.length;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const pageMonths = allMonths.slice(offset, offset + parseInt(limit, 10));

  const rows = pageMonths.map((m) => {
    const totalExpenses = m.expenses + m.purchases;
    const netProfit = m.revenue - totalExpenses;
    const margin = m.revenue > 0 ? (netProfit / m.revenue) * 100 : 0;
    return {
      period: m.ym,
      revenue: m.revenue,
      expenses: totalExpenses,
      net_profit: netProfit,
      margin_pct: Math.round(margin * 10) / 10,
    };
  });

  const totalRevenue = allMonths.reduce((s, m) => s + m.revenue, 0);
  const totalExpensesAll = allMonths.reduce((s, m) => s + m.expenses + m.purchases, 0);
  const netProfitAll = totalRevenue - totalExpensesAll;
  const avgMargin = totalRevenue > 0 ? (netProfitAll / totalRevenue) * 100 : 0;

  let bestMonth = null;
  allMonths.forEach((m) => {
    const profit = m.revenue - (m.expenses + m.purchases);
    if (!bestMonth || profit > bestMonth.profit) bestMonth = { ym: m.ym, profit };
  });

  const summary = {
    total_revenue: totalRevenue,
    total_expenses: totalExpensesAll,
    net_profit: netProfitAll,
    avg_margin: Math.round(avgMargin * 10) / 10,
    best_month: bestMonth ? bestMonth.ym : null,
    best_month_profit: bestMonth ? bestMonth.profit : 0,
  };

  return { rows, total, summary };
};

// ═══════════════════════════════════════════════════════════════════════════
// 11. TAX REPORT → sales_invoices.tax_amt (output/sales tax) grouped by quarter
//     + purchases.tax_amount (input/purchase tax) grouped by quarter.
//     Schema has one combined tax_amt per doc (no CGST/SGST/IGST split
//     columns anywhere), so this report shows Taxable Amount, Sales Tax,
//     Purchase Tax and Net Tax Payable (Sales Tax - Purchase Tax) per quarter.
// ═══════════════════════════════════════════════════════════════════════════
const getTaxReport = async (filters = {}) => {
  const { date_from = '', date_to = '', page = 1, limit = 10 } = filters;

  const salesWhere = ['1=1'];
  const salesParams = [];
  pushDateRange(salesParams, salesWhere, 'inv.invoice_date', date_from, date_to);
  const salesWhereClause = salesWhere.join(' AND ');

  const purWhere = ['1=1'];
  const purParams = [];
  pushDateRange(purParams, purWhere, 'p.purchase_date', date_from, date_to);
  const purWhereClause = purWhere.join(' AND ');

  const { rows: salesRows } = await pool.query(
    `SELECT TO_CHAR(inv.invoice_date, 'YYYY-"Q"Q') AS period,
            COALESCE(SUM(inv.grand_total - inv.tax_amt), 0) AS taxable,
            COALESCE(SUM(inv.tax_amt), 0) AS sales_tax
     FROM sales_invoices inv WHERE ${salesWhereClause}
     GROUP BY period`,
    salesParams
  );
  const { rows: purRows } = await pool.query(
    `SELECT TO_CHAR(p.purchase_date, 'YYYY-"Q"Q') AS period,
            COALESCE(SUM(p.tax_amount), 0) AS purchase_tax
     FROM purchases p WHERE ${purWhereClause}
     GROUP BY period`,
    purParams
  );

  const map = {};
  salesRows.forEach((r) => {
    map[r.period] = map[r.period] || { period: r.period, taxable: 0, sales_tax: 0, purchase_tax: 0 };
    map[r.period].taxable = Number(r.taxable);
    map[r.period].sales_tax = Number(r.sales_tax);
  });
  purRows.forEach((r) => {
    map[r.period] = map[r.period] || { period: r.period, taxable: 0, sales_tax: 0, purchase_tax: 0 };
    map[r.period].purchase_tax = Number(r.purchase_tax);
  });

  const allPeriods = Object.values(map).sort((a, b) => b.period.localeCompare(a.period));

  const total = allPeriods.length;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const pagePeriods = allPeriods.slice(offset, offset + parseInt(limit, 10));

  const rows = pagePeriods.map((r) => ({
    period: r.period,
    taxable_amount: r.taxable,
    sales_tax: r.sales_tax,
    purchase_tax: r.purchase_tax,
    net_tax_payable: r.sales_tax - r.purchase_tax,
  }));

  const totalTaxable = allPeriods.reduce((s, r) => s + r.taxable, 0);
  const totalSalesTax = allPeriods.reduce((s, r) => s + r.sales_tax, 0);
  const totalPurchaseTax = allPeriods.reduce((s, r) => s + r.purchase_tax, 0);
const summary = {
    total_taxable: totalTaxable,
    total_sales_tax: totalSalesTax,
    total_purchase_tax: totalPurchaseTax,
    net_tax_payable: totalSalesTax - totalPurchaseTax,
  };

  // ── Per-product tax breakdown (grouped by product + tax rate) ─────────────
  const { rows: productTaxRows } = await pool.query(
    `SELECT
       si.product,
       si.tax AS tax_rate,
       COALESCE(SUM(si.line_total - (si.line_total * si.tax / (100 + si.tax))), 0) AS taxable_amount,
       COALESCE(SUM(si.line_total * si.tax / (100 + si.tax)), 0) AS tax_collected
     FROM sales_invoice_items si
     JOIN sales_invoices inv ON inv.id = si.invoice_id
     WHERE ${salesWhereClause}
     GROUP BY si.product, si.tax
     ORDER BY tax_collected DESC`,
    salesParams
  );

  const byProduct = productTaxRows.map((r) => ({
    product: r.product,
    tax_rate: Number(r.tax_rate),
    taxable_amount: Number(r.taxable_amount),
    tax_collected: Number(r.tax_collected),
  }));

 return { rows, total, summary, byProduct };
};

// ═══════════════════════════════════════════════════════════════════════════
// 12. TRENDING PRODUCTS REPORT → sales_invoice_items ranked by units sold
//     in the filtered date range, with growth vs the immediately preceding
//     period of equal length. No "rating" column exists anywhere in the
//     schema, so that fabricated field is dropped rather than faked.
// ═══════════════════════════════════════════════════════════════════════════
const getTrendingProductsReport = async (filters = {}) => {
  const { location = '', category = '', date_from = '', date_to = '', page = 1, limit = 10 } = filters;

  const where = ['1=1'];
  const params = [];
  if (category) {
    params.push(`%${category}%`);
    where.push(`pc.name ILIKE $${params.length}`);
  }
  pushDateRange(params, where, 'inv.invoice_date', date_from, date_to);
  const whereClause = where.join(' AND ');

const countRes = await pool.query(
    `SELECT COUNT(DISTINCT si.product_id) FROM sales_invoice_items si
     JOIN sales_invoices inv ON inv.id = si.invoice_id
     LEFT JOIN products p ON p.id::text = si.product_id::text
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const dataParams = [...params, parseInt(limit, 10), offset];

  const { rows } = await pool.query(
    `SELECT
       si.product,
       MAX(si.sku) AS sku,
       MAX(pc.name) AS category,
       COALESCE(SUM(si.qty), 0) AS units_sold,
       COALESCE(SUM(si.line_total), 0) AS revenue
     FROM sales_invoice_items si
     JOIN sales_invoices inv ON inv.id = si.invoice_id
     LEFT JOIN products p ON p.id::text = si.product_id::text
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     WHERE ${whereClause}
     GROUP BY si.product
     ORDER BY units_sold DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  // Growth vs prior period of equal length (only computed when a date range was given)
  let growthMap = {};
  if (date_from && date_to) {
    const fromDate = new Date(date_from);
    const toDate = new Date(date_to);
    const spanMs = toDate.getTime() - fromDate.getTime();
    const prevTo = new Date(fromDate.getTime() - 24 * 60 * 60 * 1000);
    const prevFrom = new Date(prevTo.getTime() - spanMs);
    const prevParams = [prevFrom.toISOString().slice(0, 10), prevTo.toISOString().slice(0, 10)];
    const { rows: prevRows } = await pool.query(
      `SELECT si.product, COALESCE(SUM(si.qty), 0) AS units_sold
       FROM sales_invoice_items si
       JOIN sales_invoices inv ON inv.id = si.invoice_id
       WHERE inv.invoice_date >= $1::date AND inv.invoice_date <= $2::date
       GROUP BY si.product`,
      prevParams
    );
    prevRows.forEach((r) => { growthMap[r.product] = Number(r.units_sold); });
  }

  const rowsWithGrowth = rows.map((r) => {
    const current = Number(r.units_sold);
    const prev = growthMap[r.product] || 0;
    let growthPct = null;
    if (date_from && date_to) {
      growthPct = prev > 0 ? Math.round(((current - prev) / prev) * 1000) / 10 : (current > 0 ? 100 : 0);
    }
    return {
      product: r.product,
      sku: r.sku,
      category: r.category,
      units_sold: current,
      revenue: Number(r.revenue),
      growth_pct: growthPct,
    };
  });
const summaryRes = await pool.query(
    `SELECT
       COUNT(DISTINCT si.product) AS product_count,
       COALESCE(SUM(si.qty), 0) AS total_units,
       COALESCE(SUM(si.line_total), 0) AS total_revenue
     FROM sales_invoice_items si
     JOIN sales_invoices inv ON inv.id = si.invoice_id
     LEFT JOIN products p ON p.id::text = si.product_id::text
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     WHERE ${whereClause}`,
    params
  );

    const topRes = await pool.query(
    `SELECT si.product, COALESCE(SUM(si.qty), 0) AS units_sold, COALESCE(SUM(si.line_total), 0) AS revenue
     FROM sales_invoice_items si
     JOIN sales_invoices inv ON inv.id = si.invoice_id
     LEFT JOIN products p ON p.id::text = si.product_id::text
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     WHERE ${whereClause}
     GROUP BY si.product
     ORDER BY units_sold DESC
     LIMIT 1`,
    params
  );
  const top = topRes.rows[0] || null;

  const summary = {
    ...summaryRes.rows[0],
    top_product: top ? top.product : null,
    top_product_units: top ? Number(top.units_sold) : 0,
  };

  return { rows: rowsWithGrowth, total, summary };
};

// ═══════════════════════════════════════════════════════════════════════════
// 13. SUPPLIER & CUSTOMER REPORT → contacts joined with purchases (by
//     supplier_id FK) and sales_invoices (matched by customer name, since
//     sales_invoices has no customer_id FK — only a free-text `customer`
//     column). "Settled" and "Due" are derived from grand_total vs the
//     due/balance fields available on each side; no fabricated numbers.
// ═══════════════════════════════════════════════════════════════════════════
const getSupplierCustomerReport = async (filters = {}) => {
  const { contact_type = '', name = '', page = 1, limit = 10 } = filters;

  const where = ['1=1'];
  const params = [];
  if (contact_type && contact_type !== 'All') {
    params.push(contact_type === 'Supplier' ? 'Suppliers' : 'Customers');
    params.push('Both');
    where.push(`(c.contact_type = $${params.length - 1} OR c.contact_type = $${params.length})`);
  }
  if (name) {
    params.push(`%${name}%`);
    where.push(`(c.contact_name ILIKE $${params.length} OR c.business_name ILIKE $${params.length})`);
  }
  const whereClause = where.join(' AND ');

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM contacts c WHERE ${whereClause} AND c.contact_type IN ('Suppliers','Customers','Both')`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const dataParams = [...params, parseInt(limit, 10), offset];

 const { rows } = await pool.query(
 `SELECT
       c.id,
       c.email,
       COALESCE(c.business_name, c.contact_name) AS name,
       c.contact_type,
       COALESCE(pur.total_purchased, 0) AS total_purchased,
       COALESCE(pur.total_purchase_paid, 0) AS purchase_paid,
       COALESCE(sel.total_sold, 0) AS total_sold,
       COALESCE(sel.total_sell_received, 0) AS sell_received
     FROM contacts c
     LEFT JOIN (
       SELECT supplier_id, COALESCE(SUM(grand_total),0) AS total_purchased,
              COALESCE(SUM(amount_paid), 0) AS total_purchase_paid
       FROM purchases GROUP BY supplier_id
     ) pur ON pur.supplier_id = c.id
     LEFT JOIN (
       SELECT customer, COALESCE(SUM(grand_total),0) AS total_sold,
              COALESCE(SUM(paid_amount), 0) AS total_sell_received
       FROM sales_invoices GROUP BY customer
     ) sel ON sel.customer = COALESCE(c.business_name, c.contact_name)
     WHERE ${whereClause} AND c.contact_type IN ('Suppliers','Customers','Both')
     ORDER BY (COALESCE(pur.total_purchased,0) + COALESCE(sel.total_sold,0)) DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  const rowsOut = rows.map((r) => {
    const total = Number(r.total_purchased) + Number(r.total_sold);
    const settled = Number(r.purchase_paid) + Number(r.sell_received);
    const due = total - settled;
    let status = 'Paid';
    if (due > 0 && settled > 0) status = 'Partial';
    else if (due > 0 && settled === 0) status = 'Due';
  return {
      id: r.id,
      email: r.email || '',
      name: r.name,
      type: r.contact_type === 'Both' ? 'Both' : (r.contact_type === 'Suppliers' ? 'Supplier' : 'Customer'),
      total,
      settled,
      due,
      status,
    };
  });

  const summaryRes = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE contact_type IN ('Suppliers','Both')) AS supplier_count,
       COUNT(*) FILTER (WHERE contact_type IN ('Customers','Both')) AS customer_count
     FROM contacts WHERE contact_type IN ('Suppliers','Customers','Both')`
  );
const totalsRes = await pool.query(
    `SELECT
       COALESCE((SELECT SUM(grand_total) FROM purchases), 0) AS total_purchased,
       COALESCE((SELECT SUM(grand_total) FROM sales_invoices), 0) AS total_sold,
       COALESCE((SELECT SUM(amount_paid) FROM purchases), 0) AS purchase_paid,
       COALESCE((SELECT SUM(paid_amount) FROM sales_invoices), 0) AS sell_received`
  );
  const t = totalsRes.rows[0];
  const totalBusiness = Number(t.total_purchased) + Number(t.total_sold);
  const totalSettled = Number(t.purchase_paid) + Number(t.sell_received);

  const summary = {
    supplier_count: summaryRes.rows[0].supplier_count,
    customer_count: summaryRes.rows[0].customer_count,
    total_business: totalBusiness,
    total_settled: totalSettled,
    total_due: totalBusiness - totalSettled,
  };

  return { rows: rowsOut, total, summary };
};
// ═══════════════════════════════════════════════════════════════════════════
// 13b. CONTACT LEDGER → single contact's full purchase/sale history, used by
//      the "Send Ledger" email button on the Supplier & Customer Report.
// ═══════════════════════════════════════════════════════════════════════════
const getContactLedger = async (contactId) => {
  if (!contactId) return null;

  const contactRes = await pool.query(
    `SELECT id, COALESCE(business_name, contact_name) AS name, contact_type, email, phone
     FROM contacts WHERE id = $1`,
    [contactId]
  );
  const contact = contactRes.rows[0];
  if (!contact) return null;

  const includeSupplierSide = contact.contact_type === 'Suppliers' || contact.contact_type === 'Both';
  const includeCustomerSide = contact.contact_type === 'Customers' || contact.contact_type === 'Both';

  let purchaseRows = [];
  if (includeSupplierSide) {
    const r = await pool.query(
      `SELECT
         p.purchase_date AS date,
         p.reference_no  AS ref,
         COALESCE(p.grand_total, 0) AS amount,
         COALESCE(p.amount_paid, 0) AS paid,
         COALESCE(p.payment_due, 0) AS balance,
         p.payment_status AS status
       FROM purchases p
       WHERE p.supplier_id = $1
       ORDER BY p.purchase_date DESC, p.id DESC`,
      [contactId]
    );
    purchaseRows = r.rows.map((row) => ({ type: 'Purchase', ...row }));
  }

  let saleRows = [];
  if (includeCustomerSide) {
    const r = await pool.query(
      `SELECT
         inv.invoice_date AS date,
         inv.invoice_no   AS ref,
         COALESCE(inv.grand_total, 0) AS amount,
         COALESCE(inv.paid_amount, 0) AS paid,
         GREATEST(COALESCE(inv.grand_total, 0) - COALESCE(inv.paid_amount, 0), 0) AS balance,
         inv.payment_status AS status
       FROM sales_invoices inv
       WHERE inv.customer = $1
       ORDER BY inv.invoice_date DESC, inv.id DESC`,
      [contact.name]
    );
    saleRows = r.rows.map((row) => ({ type: 'Sale', ...row }));
  }

  const transactions = [...purchaseRows, ...saleRows].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );

  const totalPurchased = purchaseRows.reduce((sum, r) => sum + Number(r.amount), 0);
  const purchasePaid = purchaseRows.reduce((sum, r) => sum + Number(r.paid), 0);
  const totalSold = saleRows.reduce((sum, r) => sum + Number(r.amount), 0);
  const sellReceived = saleRows.reduce((sum, r) => sum + Number(r.paid), 0);

  const total = totalPurchased + totalSold;
  const settled = purchasePaid + sellReceived;
  const due = total - settled;

  const summary = {
    total_purchased: totalPurchased,
    purchase_paid: purchasePaid,
    total_sold: totalSold,
    sell_received: sellReceived,
    total,
    settled,
    due,
  };

  return { contact, summary, transactions };
};
// ═══════════════════════════════════════════════════════════════════════════
// 14. CUSTOMER GROUPS REPORT → customer_groups joined to contacts (real FK)
//     for customer counts, then to sales_invoices matched by customer name
//     (sales_invoices has no customer_id FK — same limitation as the
//     Supplier & Customer report). "Growth" is this-period vs prior-period
//     of equal length, only computed when a date range is supplied.
// ═══════════════════════════════════════════════════════════════════════════
const getCustomerGroupsReport = async (filters = {}) => {
  const { group = '', date_from = '', date_to = '', page = 1, limit = 10 } = filters;

  const where = ['1=1'];
  const params = [];
  if (group) {
    params.push(`%${group}%`);
    where.push(`cg.name ILIKE $${params.length}`);
  }
  const whereClause = where.join(' AND ');

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM customer_groups cg WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  // Build the date-join clause manually with placeholders that continue
  // straight on from `params`, rather than reusing pushDateRange (which
  // always numbers from $1 and would collide here).
  const dataParams = [...params];
  const dateJoinConds = [];
  if (date_from) {
    dataParams.push(date_from);
    dateJoinConds.push(`inv.invoice_date >= $${dataParams.length}`);
  }
  if (date_to) {
    dataParams.push(date_to);
    dateJoinConds.push(`inv.invoice_date <= $${dataParams.length}`);
  }
  const dateJoinClause = dateJoinConds.length ? `AND ${dateJoinConds.join(' AND ')}` : '';

  dataParams.push(parseInt(limit, 10), offset);

  const { rows } = await pool.query(
    `SELECT
       cg.id, cg.name AS group_name,
       COUNT(DISTINCT c.id) AS customer_count,
       COALESCE(SUM(inv.grand_total), 0) AS total_sales
     FROM customer_groups cg
     LEFT JOIN contacts c ON c.customer_group_id = cg.id
     LEFT JOIN sales_invoices inv
       ON inv.customer = COALESCE(c.business_name, c.contact_name)
       ${dateJoinClause}
     WHERE ${whereClause}
     GROUP BY cg.id, cg.name
     ORDER BY total_sales DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  // Top product per group (best-effort via customer-name match)
  const topProductMap = {};
  for (const r of rows) {
    const { rows: tp } = await pool.query(
      `SELECT si.product, COALESCE(SUM(si.qty),0) AS units
       FROM sales_invoice_items si
       JOIN sales_invoices inv ON inv.id = si.invoice_id
       JOIN contacts c ON inv.customer = COALESCE(c.business_name, c.contact_name)
       WHERE c.customer_group_id = $1
       GROUP BY si.product
       ORDER BY units DESC
       LIMIT 1`,
      [r.id]
    );
    topProductMap[r.id] = tp[0]?.product || null;
  }

  // Growth vs prior period of equal length
  let growthMap = {};
  if (date_from && date_to) {
    const fromDate = new Date(date_from);
    const toDate = new Date(date_to);
    const spanMs = toDate.getTime() - fromDate.getTime();
    const prevTo = new Date(fromDate.getTime() - 24 * 60 * 60 * 1000);
    const prevFrom = new Date(prevTo.getTime() - spanMs);
    const { rows: prevRows } = await pool.query(
      `SELECT cg.id, COALESCE(SUM(inv.grand_total),0) AS total_sales
       FROM customer_groups cg
       LEFT JOIN contacts c ON c.customer_group_id = cg.id
       LEFT JOIN sales_invoices inv
         ON inv.customer = COALESCE(c.business_name, c.contact_name)
         AND inv.invoice_date >= $1::date AND inv.invoice_date <= $2::date
       GROUP BY cg.id`,
      [prevFrom.toISOString().slice(0, 10), prevTo.toISOString().slice(0, 10)]
    );
    prevRows.forEach((r) => { growthMap[r.id] = Number(r.total_sales); });
  }

  const rowsOut = rows.map((r) => {
    const current = Number(r.total_sales);
    const prev = growthMap[r.id] || 0;
    let growthPct = null;
    if (date_from && date_to) {
      growthPct = prev > 0 ? Math.round(((current - prev) / prev) * 1000) / 10 : (current > 0 ? 100 : 0);
    }
    const count = Number(r.customer_count);
    return {
      group: r.group_name,
      customers: count,
      total_sales: current,
      avg_per_customer: count > 0 ? current / count : 0,
      top_product: topProductMap[r.id],
      growth_pct: growthPct,
    };
  });

  const totalCustomersRes = await pool.query(`SELECT COUNT(*) FROM contacts WHERE customer_group_id IS NOT NULL`);
  const totalSalesAll = rowsOut.reduce((s, r) => s + r.total_sales, 0);
  const best = rowsOut.reduce((a, b) => (b.total_sales > (a?.total_sales || 0) ? b : a), null);
  const fastest = date_from && date_to
    ? rowsOut.reduce((a, b) => ((b.growth_pct ?? -Infinity) > (a?.growth_pct ?? -Infinity) ? b : a), null)
    : null;

  const summary = {
    total_groups: total,
    total_customers: parseInt(totalCustomersRes.rows[0].count, 10),
    total_sales: totalSalesAll,
    best_group: best?.group || null,
    best_group_sales: best?.total_sales || 0,
    fastest_growth_group: fastest?.group || null,
    fastest_growth_pct: fastest?.growth_pct ?? null,
  };

  return { rows: rowsOut, total, summary };
};

// ═══════════════════════════════════════════════════════════════════════════
// 15. PURCHASE & SALE REPORT → purchase_items vs sales_invoice_items,
//     matched by product name (both are text columns — safer than joining
//     by product_id, since purchase_items.product_id is INTEGER while
//     sales_invoice_items.product_id is UUID, per the earlier schema fix).
// ═══════════════════════════════════════════════════════════════════════════
const getPurchaseSaleReport = async (filters = {}) => {
  const { product = '', category = '', date_from = '', date_to = '', page = 1, limit = 10 } = filters;

  const purWhere = ['1=1'];
  const purParams = [];
  if (product) {
    purParams.push(`%${product}%`);
    purWhere.push(`pi.product_name ILIKE $${purParams.length}`);
  }
  pushDateRange(purParams, purWhere, 'p.purchase_date', date_from, date_to);
  const purWhereClause = purWhere.join(' AND ');

  const sellWhere = ['1=1'];
  const sellParams = [];
  if (product) {
    sellParams.push(`%${product}%`);
    sellWhere.push(`si.product ILIKE $${sellParams.length}`);
  }
  pushDateRange(sellParams, sellWhere, 'inv.invoice_date', date_from, date_to);
  const sellWhereClause = sellWhere.join(' AND ');

  const { rows: purRows } = await pool.query(
    `SELECT pi.product_name AS product, MAX(pi.product_sku) AS sku,
            COALESCE(SUM(pi.line_total), 0) AS purchased,
            COALESCE(SUM(pi.quantity), 0) AS qty_purchased
     FROM purchase_items pi
     JOIN purchases p ON p.id = pi.purchase_id
     WHERE ${purWhereClause}
     GROUP BY pi.product_name`,
    purParams
  );
  const { rows: sellRows } = await pool.query(
    `SELECT si.product, COALESCE(SUM(si.line_total), 0) AS sold,
            COALESCE(SUM(si.qty), 0) AS qty_sold
     FROM sales_invoice_items si
     JOIN sales_invoices inv ON inv.id = si.invoice_id
     WHERE ${sellWhereClause}
     GROUP BY si.product`,
    sellParams
  );

  const map = {};
  purRows.forEach((r) => {
    map[r.product] = map[r.product] || { product: r.product, sku: r.sku, purchased: 0, sold: 0, qtySold: 0 };
    map[r.product].purchased = Number(r.purchased);
  });
  sellRows.forEach((r) => {
    map[r.product] = map[r.product] || { product: r.product, sku: null, purchased: 0, sold: 0, qtySold: 0 };
    map[r.product].sold = Number(r.sold);
    map[r.product].qtySold = Number(r.qty_sold);
  });

  let allProducts = Object.values(map);

  // Category filter applied here since neither purchase_items nor
  // sales_invoice_items store category directly — look it up via products.
  if (category) {
    const { rows: catRows } = await pool.query(
      `SELECT p.name AS product FROM products p
       LEFT JOIN product_categories pc ON pc.id = p.category_id
       WHERE pc.name ILIKE $1`,
      [`%${category}%`]
    );
    const catSet = new Set(catRows.map((r) => r.product));
    allProducts = allProducts.filter((r) => catSet.has(r.product));
  }

  allProducts.sort((a, b) => (b.purchased + b.sold) - (a.purchased + a.sold));

  const total = allProducts.length;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const pageRows = allProducts.slice(offset, offset + parseInt(limit, 10));

  const rowsOut = pageRows.map((r) => {
    const gain = r.sold - r.purchased;
    const gainPct = r.purchased > 0 ? Math.round((gain / r.purchased) * 1000) / 10 : (r.sold > 0 ? 100 : 0);
    return {
      product: r.product,
      purchased: r.purchased,
      sold: r.sold,
      gain,
      gain_pct: gainPct,
      qty_sold: r.qtySold,
    };
  });

  const totalPurchased = allProducts.reduce((s, r) => s + r.purchased, 0);
  const totalSold = allProducts.reduce((s, r) => s + r.sold, 0);
  const totalGain = totalSold - totalPurchased;
  const avgMargin = totalPurchased > 0 ? Math.round((totalGain / totalPurchased) * 1000) / 10 : 0;

  const summary = {
    total_purchased: totalPurchased,
    total_sold: totalSold,
    total_gain: totalGain,
    avg_margin: avgMargin,
    product_count: total,
  };

  return { rows: rowsOut, total, summary };
};

// ═══════════════════════════════════════════════════════════════════════════
// 16. REGISTER REPORT → register_sessions (real POS cash register shifts)
// ═══════════════════════════════════════════════════════════════════════════
const getRegisterReport = async (filters = {}) => {
  const { location = '', user = '', date_from = '', date_to = '', page = 1, limit = 25 } = filters;

  const where = ['1=1'];
  const params = [];

  if (location) {
    params.push(`%${location}%`);
    where.push(`rs.location ILIKE $${params.length}`);
  }
  if (user) {
    params.push(`%${user}%`);
    where.push(`u.full_name ILIKE $${params.length}`);
  }
  pushDateRange(params, where, 'rs.opened_at', date_from, date_to);

  const whereClause = where.join(' AND ');

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM register_sessions rs
     LEFT JOIN users u ON u.id = rs.cashier_id
     WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const dataParams = [...params, parseInt(limit, 10), offset];

  const { rows } = await pool.query(
    `SELECT
       rs.id,
       rs.opened_at::date AS date,
       rs.shift,
       u.full_name AS user_name,
       rs.location,
       COALESCE(rs.opening_balance, 0) AS opening_bal,
       COALESCE(rs.cash_in, 0) AS cash_in,
       COALESCE(rs.cash_out, 0) AS cash_out,
       COALESCE(rs.closing_balance, 0) AS closing_bal,
       COALESCE(rs.total_sales, 0) AS total_sales,
       rs.status
     FROM register_sessions rs
     LEFT JOIN users u ON u.id = rs.cashier_id
     WHERE ${whereClause}
     ORDER BY rs.opened_at DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  const summaryRes = await pool.query(
    `SELECT
       COUNT(*) AS total_shifts,
       COALESCE(SUM(rs.total_sales), 0) AS total_sales,
       COALESCE(SUM(rs.cash_in), 0) AS total_cash_in,
       COALESCE(SUM(rs.cash_out), 0) AS total_cash_out,
       COUNT(DISTINCT rs.cashier_id) AS cashier_count
     FROM register_sessions rs
     LEFT JOIN users u ON u.id = rs.cashier_id
     WHERE ${whereClause}`,
    params
  );

  return { rows, total, summary: summaryRes.rows[0] };
};

// ═══════════════════════════════════════════════════════════════════════════
// 11b. TAX BY PRODUCT REPORT → sales_invoice_items grouped by product + tax %
//      Shows which products generated how much tax, at which GST rate,
//      within the same date range as the main Tax Report.
// ═══════════════════════════════════════════════════════════════════════════
const getTaxByProductReport = async (filters = {}) => {
  const { date_from = '', date_to = '', page = 1, limit = 25 } = filters;

  const where = ['1=1'];
  const params = [];
  pushDateRange(params, where, 'inv.invoice_date', date_from, date_to);
  const whereClause = where.join(' AND ');

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM (
       SELECT si.product, si.tax
       FROM sales_invoice_items si
       JOIN sales_invoices inv ON inv.id = si.invoice_id
       WHERE ${whereClause}
       GROUP BY si.product, si.tax
     ) t`,
    params
  );
  const total = parseInt(countRes.rows[0].count, 10);

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const dataParams = [...params, parseInt(limit, 10), offset];

  const { rows } = await pool.query(
    `SELECT
       si.product,
       MAX(si.sku) AS sku,
       si.tax AS tax_rate,
       COALESCE(SUM(si.qty * si.unit_price * (1 - si.discount/100)), 0) AS taxable_amount,
       COALESCE(SUM((si.qty * si.unit_price * (1 - si.discount/100)) * (si.tax/100)), 0) AS tax_collected,
       COALESCE(SUM(si.qty), 0) AS qty_sold
     FROM sales_invoice_items si
     JOIN sales_invoices inv ON inv.id = si.invoice_id
     WHERE ${whereClause}
     GROUP BY si.product, si.tax
     ORDER BY tax_collected DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  const summaryRes = await pool.query(
    `SELECT
       COUNT(DISTINCT si.product) AS product_count,
       COALESCE(SUM((si.qty * si.unit_price * (1 - si.discount/100)) * (si.tax/100)), 0) AS total_tax_collected
     FROM sales_invoice_items si
     JOIN sales_invoices inv ON inv.id = si.invoice_id
     WHERE ${whereClause}`,
    params
  );

  return { rows, total, summary: summaryRes.rows[0] };
};
// ═══════════════════════════════════════════════════════════════════════════
// SALES BY CATEGORY REPORT → sales_invoice_items joined to products/categories
//    via SKU (same join key as getItemsReport, since sales_invoice_items
//    has no reliable product_id). Returns % share of revenue per category.
// ═══════════════════════════════════════════════════════════════════════════
const getSalesByCategoryReport = async (filters = {}) => {
  const { date_from = '', date_to = '' } = filters;

  const where = ['1=1'];
  const params = [];
  pushDateRange(params, where, 'inv.invoice_date', date_from, date_to);
  const whereClause = where.join(' AND ');

  const { rows } = await pool.query(
    `SELECT
       COALESCE(pc.name, 'Uncategorized') AS category,
       COALESCE(SUM(si.line_total), 0) AS revenue
     FROM sales_invoice_items si
     JOIN sales_invoices inv ON inv.id = si.invoice_id
     LEFT JOIN products p ON LOWER(p.sku) = LOWER(si.sku)
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     WHERE ${whereClause}
     GROUP BY COALESCE(pc.name, 'Uncategorized')
     ORDER BY revenue DESC`,
    params
  );

  const total = rows.reduce((s, r) => s + Number(r.revenue), 0);

  const data = rows.map((r) => ({
    category: r.category,
    revenue: Number(r.revenue),
    pct: total > 0 ? Math.round((Number(r.revenue) / total) * 1000) / 10 : 0,
  }));

  return { data };
};
module.exports = {
  getNetProfitSummary: async (filters = {}) => {
    const { rows, summary } = await getProfitLossReport(filters);
    return { rows, summary };
  },
  getActivityLogReport,
  getSalesByCategoryReport,
  getStockReport,
  getStockAdjustmentReport,
  getItemsReport,
  getProductPurchaseReport,
  getProductSellReport,
  getExpenseReport,
  getSalesRepresentativeReport,
  getPurchasePaymentReport,
  getSellPaymentReport,
  getProfitLossReport,
  getTaxReport,
  getTaxByProductReport,
  getTrendingProductsReport,
getSupplierCustomerReport,
  getContactLedger,
  getCustomerGroupsReport,
  getPurchaseSaleReport,
  getRegisterReport,
};