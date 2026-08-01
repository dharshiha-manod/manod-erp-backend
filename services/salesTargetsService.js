// ═══════════════════════════════════════════════════════════════
// services/salesTargetsService.js
// Read-only integration with sales_invoices. Matches by employee
// full_name against sales_invoices.salesperson (text match — no FK
// exists on sales_invoices, so this is the only safe join available
// without modifying the Sell module).
// ═══════════════════════════════════════════════════════════════
const pool = require('../config/database');
const q = (text, params) => pool.query(text, params);

function monthBounds(monthYear) {
  if (!monthYear) return null;
  const [year, month] = monthYear.split('-');
  const start = `${year}-${month}-01`;
  const endDate = new Date(new Date(start).getFullYear(), new Date(start).getMonth() + 1, 0);
  return { start, end: endDate.toISOString().slice(0, 10) };
}

async function computeAchievement(employeeName, monthYear, employeeId = null, employeeSource = null) {
  const bounds = monthBounds(monthYear);
  if (!employeeName || !bounds) {
    return { achieved_amount: 0, order_achieved: 0, customer_achieved: 0, collection_achieved: 0 };
  }

  // Prefer an EXACT (case-insensitive) match on salesperson — the safest
  // interpretation of "assigned employee" given salesperson is free text
  // on sales_invoices. Only fall back to a partial ILIKE match if no
  // exact match exists at all, so "Priya" doesn't wrongly pull in
  // invoices salesperson-tagged "Priya S." or "Priya K.".
// Prefer the exact ID-based link (salesperson_employee_id/source) when
  // present — falls back to name match for older invoices that predate
  // this column, so nothing regresses.
  let exact = { rows: [{ achieved_amount: 0, order_achieved: 0, customer_achieved: 0, collection_achieved: 0 }] };
  if (employeeId) {
    exact = await q(
      `SELECT
         COALESCE(SUM(grand_total), 0) AS achieved_amount,
         COUNT(*) AS order_achieved,
         COUNT(DISTINCT customer_id) FILTER (WHERE customer_id IS NOT NULL) AS customer_achieved,
         COALESCE(SUM(paid_amount), 0) AS collection_achieved
       FROM sales_invoices
       WHERE salesperson_employee_id = $1 AND salesperson_source = $2
         AND doc_status = 'Submitted'
         AND invoice_date >= $3::date AND invoice_date <= $4::date`,
      [String(employeeId), employeeSource || 'user', bounds.start, bounds.end]
    );
  }
  const hasIdRows = Number(exact.rows[0].order_achieved) > 0;
  if (!hasIdRows) {
    exact = await q(
      `SELECT
         COALESCE(SUM(grand_total), 0) AS achieved_amount,
         COUNT(*) AS order_achieved,
         COUNT(DISTINCT customer_id) FILTER (WHERE customer_id IS NOT NULL) AS customer_achieved,
         COALESCE(SUM(paid_amount), 0) AS collection_achieved
       FROM sales_invoices
       WHERE LOWER(TRIM(salesperson)) = LOWER(TRIM($1))
         AND doc_status = 'Submitted'
         AND invoice_date >= $2::date AND invoice_date <= $3::date`,
      [employeeName, bounds.start, bounds.end]
    );
  }

  const hasExactRows = Number(exact.rows[0].order_achieved) > 0;
  const { rows } = hasExactRows ? exact : await q(
    `SELECT
       COALESCE(SUM(grand_total), 0) AS achieved_amount,
       COUNT(*) AS order_achieved,
       COUNT(DISTINCT customer_id) FILTER (WHERE customer_id IS NOT NULL) AS customer_achieved,
       COALESCE(SUM(paid_amount), 0) AS collection_achieved
     FROM sales_invoices
     WHERE salesperson ILIKE $1
       AND doc_status = 'Submitted'
       AND invoice_date >= $2::date AND invoice_date <= $3::date`,
    [employeeName, bounds.start, bounds.end]
  );

  const r = rows[0];
  return {
    achieved_amount: Number(r.achieved_amount),
    order_achieved: Number(r.order_achieved),
    customer_achieved: Number(r.customer_achieved),
    collection_achieved: Number(r.collection_achieved),
  };
}

function statusFor(target, achieved) {
  if (!target || target <= 0 || achieved <= 0) return 'Not Started';
  if (achieved > target) return 'Exceeded';
  if (achieved >= target) return 'Achieved';
  return 'In Progress';
}

// NEW
async function enrichTargets(targets) {
  const out = [];
  for (const t of targets) {
    const live = await computeAchievement(t.employee_name, t.month_year, t.employee_id, t.employee_source);

    // A target row is exactly ONE kind — Sales Amount, Number of Orders,
    // Number of Customers, or Collection Amount — depending on which
    // *_target column was actually set when it was created. Progress and
    // status must be computed from THAT matching pair, not always the
    // money pair — otherwise e.g. an "orders" target shows 0%/"Not Started"
    // even when order_achieved has fully met order_target.
    let targetVal, achievedVal;
    if (Number(t.target_amount) > 0) {
      targetVal = Number(t.target_amount);
      achievedVal = live.achieved_amount;
    } else if (Number(t.order_target) > 0) {
      targetVal = Number(t.order_target);
      achievedVal = live.order_achieved;
    } else if (Number(t.customer_target) > 0) {
      targetVal = Number(t.customer_target);
      achievedVal = live.customer_achieved;
    } else if (Number(t.collection_target) > 0) {
      targetVal = Number(t.collection_target);
      achievedVal = live.collection_achieved;
    } else {
      targetVal = Number(t.target_amount || 0);
      achievedVal = live.achieved_amount;
    }

    out.push({
      ...t,
      achieved_amount: live.achieved_amount,
      order_achieved: live.order_achieved,
      customer_achieved: live.customer_achieved,
      collection_achieved: live.collection_achieved,
      remaining_amount: Math.max(0, targetVal - achievedVal),
      achievement_pct: targetVal > 0 ? Math.round((achievedVal / targetVal) * 100) : 0,
      computed_status: statusFor(targetVal, achievedVal),
    });
  }
  return out;
}
module.exports = { computeAchievement, enrichTargets };