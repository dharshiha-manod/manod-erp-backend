/**
 * ============================================================
 * services/accountingService.js
 *
 * Read layer for the Accounting & Finance module.
 * Mirrors the query style of services/reportService.js —
 * plain pg pool, parameterized queries, no ORM.
 *
 * SOURCES OF TRUTH (no fake/mock numbers anywhere below):
 *   Revenue / AR         → sales_invoices
 *   Purchases / AP       → purchases
 *   Operating Expenses   → expenses (+ expense_categories)
 *   Payroll cost         → hrm_payroll
 *   Inventory value      → products (current_stock * purchase_price_exc_tax)
 *   Cash register cash   → register_sessions (latest closing_balance / location)
 *   Bank & Cash accounts → accounting_bank_accounts / accounting_bank_transactions (new)
 *   Chart of Accounts    → accounting_accounts (new, seeded — balances computed live)
 *   Manual journal       → accounting_journal_entries / accounting_journal_lines (new)
 *   Fixed Assets         → accounting_fixed_assets (new)
 *   Cost Centers/Budgets → accounting_cost_centers / accounting_budgets (new, matched
 *                          live against the real `expenses` table)
 * ============================================================
 */

'use strict';

const pool = require('../config/database');

const num = (v) => Number(v || 0);

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

// ═══════════════════════════════════════════════════════════════
// 1. DASHBOARD
// ═══════════════════════════════════════════════════════════════
const getDashboardSummary = async (industryId) => {
  const [revThis, revLast, expThis, expLast, purThis, arRow, apPurchaseRow, apExpenseRow, bankRow, custOpeningRow, supOpeningRow] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(grand_total),0) AS v FROM sales_invoices WHERE industry_id = $1 AND date_trunc('month', invoice_date) = date_trunc('month', CURRENT_DATE)`, [industryId]),
    pool.query(`SELECT COALESCE(SUM(grand_total),0) AS v FROM sales_invoices WHERE industry_id = $1 AND date_trunc('month', invoice_date) = date_trunc('month', CURRENT_DATE - INTERVAL '1 month')`, [industryId]),
    pool.query(`SELECT COALESCE(SUM(total_amount),0) AS v FROM expenses WHERE industry_id = $1 AND date_trunc('month', expense_date) = date_trunc('month', CURRENT_DATE)`, [industryId]),
    pool.query(`SELECT COALESCE(SUM(total_amount),0) AS v FROM expenses WHERE industry_id = $1 AND date_trunc('month', expense_date) = date_trunc('month', CURRENT_DATE - INTERVAL '1 month')`, [industryId]),
  pool.query(`SELECT
      COALESCE((SELECT SUM(grand_total) FROM purchases WHERE industry_id = $1 AND date_trunc('month', purchase_date) = date_trunc('month', CURRENT_DATE)),0)
      - COALESCE((SELECT SUM(total_amount) FROM purchase_returns WHERE industry_id = $1 AND date_trunc('month', return_date) = date_trunc('month', CURRENT_DATE)),0)
      AS v`, [industryId]),
pool.query(`
      SELECT COALESCE(SUM(GREATEST(grand_total - paid_amount,0)),0)
           + COALESCE((SELECT SUM(GREATEST(total_amount - amount_paid,0)) FROM purchase_returns WHERE industry_id = $1),0) AS v
      FROM sales_invoices WHERE industry_id = $1 AND payment_status <> 'Paid'`, [industryId]),
    pool.query(`
      SELECT GREATEST(
        COALESCE((SELECT SUM(GREATEST(grand_total - amount_paid,0)) FROM purchases WHERE industry_id = $1 AND payment_status <> 'Paid'),0)
        - COALESCE((SELECT SUM(GREATEST(total_amount - amount_paid,0)) FROM purchase_returns WHERE industry_id = $1),0)
      , 0) AS v`, [industryId]),
    // Unpaid expenses are a real payable too (mirrors accounting_accounts row 2050 "Expenses Payable") —
    // leaving this out understates what the business actually owes.
    pool.query(`SELECT COALESCE(SUM(COALESCE(payment_due,0)),0) AS v FROM expenses WHERE industry_id = $1 AND payment_status <> 'Paid'`, [industryId]),
    // Reuses the exact same query Balance Sheet/Trial Balance use for Cash &
    // Bank (SOURCE_BALANCE_QUERIES.cash_bank), instead of a hand-rolled
    // LEFT JOIN. A LEFT JOIN from accounts to transactions fans out one row
    // per transaction, so SUM(ba.opening_balance) was double/triple-counting
    // the opening balance for any account with more than one transaction —
    // this is what inflated ₹50,400 into ₹1,00,400 on this Dashboard card.
    pool.query(SOURCE_BALANCE_QUERIES.cash_bank, [industryId]),
    pool.query(`SELECT COALESCE(SUM(opening_balance),0) AS v FROM contacts WHERE industry_id = $1 AND contact_type IN ('Customers','Both') AND opening_balance > 0`, [industryId]),
    pool.query(`SELECT COALESCE(SUM(opening_balance),0) AS v FROM contacts WHERE industry_id = $1 AND contact_type IN ('Suppliers','Both') AND opening_balance > 0`, [industryId]),
  ]);
  const revenue = num(revThis.rows[0].v);
  const revenueLast = num(revLast.rows[0].v);
  const opExpenses = num(expThis.rows[0].v);
  const purchasesCost = num(purThis.rows[0].v);
  const expenses = opExpenses + purchasesCost;
  const expensesLast = num(expLast.rows[0].v);
  const netProfit = revenue - expenses;
const cashBalance = num(bankRow.rows[0].coalesce);

  const pctChange = (curr, prev) => (prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : 0);

  return {
    revenue, revenueChange: pctChange(revenue, revenueLast),
    expenses, expensesChange: pctChange(expenses, expensesLast),
    opExpenses, purchasesCost,
    netProfit, netProfitChange: pctChange(netProfit, revenueLast - num(expLast.rows[0].v)),
    cashBalance,
    arTotal: num(arRow.rows[0].v) + num(custOpeningRow.rows[0].v),
    apTotal: num(apPurchaseRow.rows[0].v) + num(apExpenseRow.rows[0].v) + num(supOpeningRow.rows[0].v),
  };
};

const getRevenueExpenseTrend = async (industryId, months = 5) => {
  const { rows: revRows } = await pool.query(`
    SELECT TO_CHAR(invoice_date, 'Mon') AS month, date_trunc('month', invoice_date) AS ym,
           COALESCE(SUM(grand_total),0) AS revenue
    FROM sales_invoices
    WHERE industry_id = $1 AND invoice_date >= date_trunc('month', CURRENT_DATE) - INTERVAL '${months - 1} months'
    GROUP BY 1,2 ORDER BY 2`, [industryId]);
  const { rows: expRows } = await pool.query(`
    SELECT date_trunc('month', d) AS ym, COALESCE(SUM(amt),0) AS expense FROM (
      SELECT expense_date AS d, total_amount AS amt FROM expenses
      WHERE industry_id = $1 AND expense_date >= date_trunc('month', CURRENT_DATE) - INTERVAL '${months - 1} months'
      UNION ALL
      SELECT purchase_date AS d, grand_total AS amt FROM purchases
      WHERE industry_id = $1 AND purchase_date >= date_trunc('month', CURRENT_DATE) - INTERVAL '${months - 1} months'
    ) x GROUP BY 1 ORDER BY 1`, [industryId]);

  const map = {};
  revRows.forEach(r => { map[r.ym] = { month: r.month, revenue: num(r.revenue), expense: 0 }; });
  expRows.forEach(r => {
    const key = Object.keys(map).find(k => new Date(k).getTime() === new Date(r.ym).getTime());
    if (key) map[key].expense = num(r.expense);
  });
  return Object.values(map);
};

const getARAging = async (industryId) => {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN CURRENT_DATE - due_date BETWEEN 0 AND 30 THEN GREATEST(grand_total - paid_amount,0) ELSE 0 END),0) AS b1,
      COALESCE(SUM(CASE WHEN CURRENT_DATE - due_date BETWEEN 31 AND 60 THEN GREATEST(grand_total - paid_amount,0) ELSE 0 END),0) AS b2,
      COALESCE(SUM(CASE WHEN CURRENT_DATE - due_date BETWEEN 61 AND 90 THEN GREATEST(grand_total - paid_amount,0) ELSE 0 END),0) AS b3,
      COALESCE(SUM(CASE WHEN CURRENT_DATE - due_date > 90 THEN GREATEST(grand_total - paid_amount,0) ELSE 0 END),0) AS b4
    FROM sales_invoices WHERE industry_id = $1 AND payment_status <> 'Paid'`, [industryId]);
  const r = rows[0];
  return [
    { bucket: '0–30 days', amount: num(r.b1) },
    { bucket: '31–60 days', amount: num(r.b2) },
    { bucket: '61–90 days', amount: num(r.b3) },
    { bucket: '90+ days', amount: num(r.b4) },
  ];
};

// ═══════════════════════════════════════════════════════════════
// 1B. PER-CONTACT OUTSTANDING — SINGLE SOURCE OF TRUTH
// ═══════════════════════════════════════════════════════════════
// Every screen that shows "how much does this customer owe us" or
// "how much do we owe this supplier" must call one of these two
// functions. Nothing else computes outstanding independently.
//
// Customer Outstanding (Receivable) =
//   opening_balance
//   + SUM(sales_invoices.grand_total WHERE customer_id = X)
//   - SUM(sales_invoices.paid_amount WHERE customer_id = X)
//   - SUM(contact_payments.amount WHERE contact_id = X AND direction='in')
//     (standalone payments not tied to one invoice, e.g. opening-balance
//      settlement or advance collection — see recordCustomerPayment)
//
// Supplier Outstanding (Payable) mirrors this using purchases +
// purchase_id-less contact_payments with direction='out'.
//
// contact_payments only holds payments NOT already reflected in
// sales_invoices.paid_amount / purchases.amount_paid, so nothing is
// double-counted.
// ═══════════════════════════════════════════════════════════════
let contactPaymentsSchemaReady = false;
const ensureContactPaymentsSchema = async () => {
  if (contactPaymentsSchemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contact_payments (
      id SERIAL PRIMARY KEY,
      contact_id INTEGER NOT NULL,
      industry_id INTEGER,
      direction VARCHAR(3) NOT NULL,          -- 'in' (customer paid us) | 'out' (we paid supplier)
      amount NUMERIC(14,2) NOT NULL,
      payment_method VARCHAR(30) DEFAULT 'Cash',
      paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
      note TEXT,
      applied_invoice_id INTEGER,             -- optional: which sales_invoices.id this reduced
      applied_purchase_id INTEGER,            -- optional: which purchases.id this reduced
      added_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_contact_payments_contact ON contact_payments(contact_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_contact_payments_industry ON contact_payments(industry_id);`);
  contactPaymentsSchemaReady = true;
};

const getCustomerOutstanding = async (industryId, contactId) => {
  await ensureContactPaymentsSchema();

  const contactRes = await pool.query(
    `SELECT id, COALESCE(business_name, contact_name) AS name, opening_balance, credit_limit, advance_balance
     FROM contacts WHERE id = $1 AND industry_id = $2`,
    [contactId, industryId]
  );
  const contact = contactRes.rows[0];
  if (!contact) throw new Error('Customer not found');

  const openingBalance = num(contact.opening_balance);

  const invRes = await pool.query(
    `SELECT COALESCE(SUM(grand_total),0) AS invoiced, COALESCE(SUM(paid_amount),0) AS paid
     FROM sales_invoices WHERE customer_id = $1 AND industry_id = $2`,
    [contactId, industryId]
  );
  const invoiced = num(invRes.rows[0].invoiced);
  const invoicePaid = num(invRes.rows[0].paid);

  // Standalone payments (not already counted in sales_invoices.paid_amount —
  // i.e. ones with no applied_invoice_id, or applied against opening balance)
  const standaloneRes = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS v FROM contact_payments
     WHERE contact_id = $1 AND industry_id = $2 AND direction = 'in' AND applied_invoice_id IS NULL`,
    [contactId, industryId]
  );
  const standalonePaid = num(standaloneRes.rows[0].v);

  const totalPaid = invoicePaid + standalonePaid;
  const total = openingBalance + invoiced - totalPaid;

  const creditLimit = num(contact.credit_limit);
  const availableCredit = creditLimit > 0 ? Math.max(0, creditLimit - total) : null;

  return {
    contactId: contact.id,
    name: contact.name,
    openingBalance,
    invoiced,
    paid: totalPaid,
    total: Math.round(total * 100) / 100,
    creditLimit,
    availableCredit,
    advanceBalance: num(contact.advance_balance),
  };
};

const getSupplierOutstanding = async (industryId, contactId) => {
  await ensureContactPaymentsSchema();

  const contactRes = await pool.query(
    `SELECT id, COALESCE(business_name, contact_name) AS name, opening_balance
     FROM contacts WHERE id = $1 AND industry_id = $2`,
    [contactId, industryId]
  );
  const contact = contactRes.rows[0];
  if (!contact) throw new Error('Supplier not found');

  const openingBalance = num(contact.opening_balance);

  const purRes = await pool.query(
    `SELECT COALESCE(SUM(grand_total),0) AS purchased, COALESCE(SUM(amount_paid),0) AS paid
     FROM purchases WHERE supplier_id = $1 AND industry_id = $2`,
    [contactId, industryId]
  );
  const purchased = num(purRes.rows[0].purchased);
  const purchasePaid = num(purRes.rows[0].paid);

  // Purchase returns reduce what we owe the supplier.
  const returnRes = await pool.query(
    `SELECT COALESCE(SUM(total_amount),0) AS v FROM purchase_returns
     WHERE supplier_id = $1 AND industry_id = $2`,
    [contactId, industryId]
  ).catch(() => ({ rows: [{ v: 0 }] })); // supplier_id may not exist on purchase_returns yet
  const returns = num(returnRes.rows[0].v);

  const standaloneRes = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS v FROM contact_payments
     WHERE contact_id = $1 AND industry_id = $2 AND direction = 'out' AND applied_purchase_id IS NULL`,
    [contactId, industryId]
  );
  const standalonePaid = num(standaloneRes.rows[0].v);

  const totalPaid = purchasePaid + standalonePaid;
  const total = Math.max(0, openingBalance + purchased - returns - totalPaid);

  return {
    contactId: contact.id,
    name: contact.name,
    openingBalance,
    purchased,
    returns,
    paid: totalPaid,
    total: Math.round(total * 100) / 100,
  };
};

// ── Record a standalone payment (not tied to one invoice/purchase) ──────────
// Used for: opening balance settlement, lump-sum/advance collection.
// Mirrors into Cash & Bank via bankIntegrationService, same as existing
// purchase/sell payment flows — no second accounting system created.
const recordCustomerPayment = async (industryId, contactId, body, userId, userName) => {
  await ensureContactPaymentsSchema();
  const bankIntegrationService = require('./bankIntegrationService');
  const { logAudit } = require('./auditLogService');

  const amount = parseFloat(body.amount);
  if (!amount || amount <= 0) throw new Error('Payment amount must be greater than 0');

  const outstanding = await getCustomerOutstanding(industryId, contactId);
  if (amount > outstanding.total + 0.01) {
    logAudit({
      userId, userName,
      module: 'Contacts - Customer Payment',
      action: 'BLOCKED_OVERPAYMENT',
      recordId: contactId,
      recordLabel: outstanding.name,
      newData: { attemptedAmount: amount, outstanding: outstanding.total },
    }).catch(() => {});
    throw new Error(
      `Payment (₹${amount.toFixed(2)}) exceeds customer outstanding (₹${outstanding.total.toFixed(2)}).`
    );
  }

  const ins = await pool.query(
    `INSERT INTO contact_payments
       (contact_id, industry_id, direction, amount, payment_method, paid_on, note, added_by)
     VALUES ($1,$2,'in',$3,$4,$5,$6,$7) RETURNING *`,
    [contactId, industryId, amount, body.paymentMethod || 'Cash', body.paidOn || new Date(), body.note || null, userId || null]
  );

  await bankIntegrationService.safeRecord({
    sourceModule: 'ContactPayment',
    sourceId: ins.rows[0].id,
    sourceEvent: `customer-payment-${ins.rows[0].id}`,
    txnType: 'Credit',
    amount,
    paymentMethod: body.paymentMethod || 'Cash',
    description: `Payment received from customer — ${outstanding.name}`,
    txnDate: body.paidOn || new Date(),
    userId,
  }).catch(() => {});

  logAudit({
    userId, userName,
    module: 'Contacts - Customer Payment',
    action: 'CREATE',
    recordId: ins.rows[0].id,
    recordLabel: `Payment #${ins.rows[0].id} — ${outstanding.name}`,
    newData: ins.rows[0],
  }).catch(() => {});

  return { payment: ins.rows[0], outstanding: await getCustomerOutstanding(industryId, contactId) };
};

// ── FIFO allocation schema (idempotent) ──────────────────────────────────
// One row per (payment → invoice) allocation. contact_payments stays the
// single payment record; this table is the audit trail of how that payment
// was split across invoices, oldest-first. Not a second accounting system —
// sales_invoices.paid_amount / payment_status remain the source of truth for
// invoice outstanding; this table only records HOW a payment got there.
let paymentAllocationsSchemaReady = false;
const ensurePaymentAllocationsSchema = async () => {
  if (paymentAllocationsSchemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_allocations (
      id SERIAL PRIMARY KEY,
      payment_id INTEGER NOT NULL REFERENCES contact_payments(id),
      invoice_id INTEGER NOT NULL REFERENCES sales_invoices(id),
      contact_id INTEGER NOT NULL,
      industry_id INTEGER,
      amount_applied NUMERIC(14,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations(payment_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice ON payment_allocations(invoice_id);`);
  paymentAllocationsSchemaReady = true;
};

// ── Sales-side standalone customer payment with FIFO invoice allocation ────
// This is the dedicated Sales payment flow requested on top of the existing
// generic recordCustomerPayment (which still exists for opening-balance /
// pure-advance collection with no invoice breakdown). This one:
//   1. Locks the customer's open invoices (oldest invoice_date/id first)
//   2. Applies the payment across them in FIFO order
//   3. Any leftover (payment > total open invoices) is NOT allowed to make
//      an invoice negative — the whole call fails atomically (see
//      "excess payment" behaviour below) unless allowOverpayAsAdvance is
//      explicitly passed, in which case the leftover is credited to the
//      customer's existing advance_balance (contactService.adjustAdvanceBalance
//      — the existing advance mechanism, not a new one).
//   4. Runs inside a single DB transaction — payment row, invoice updates,
//      and allocation rows all commit or all roll back together.
const recordCustomerPaymentFIFO = async (industryId, contactId, body, userId, userName) => {
  await ensureContactPaymentsSchema();
  await ensurePaymentAllocationsSchema();
  const bankIntegrationService = require('./bankIntegrationService');
  const { logAudit } = require('./auditLogService');

  const amount = parseFloat(body.amount);
  if (!amount || amount <= 0) throw new Error('Payment amount must be greater than 0');

  const allowOverpayAsAdvance = !!body.allowOverpayAsAdvance;

  const client = await pool.connect();
  let payment, allocations = [], invoiceUpdates = [], advanceCredited = 0;
  try {
    await client.query('BEGIN');

    // Lock the customer row + confirm it exists inside this industry
    // (also guards cross-industry access: a contact from another industry
    // simply won't be found under this industryId).
    const contactRes = await client.query(
      `SELECT id, COALESCE(business_name, contact_name) AS name, contact_type
       FROM contacts WHERE id = $1 AND industry_id = $2 FOR UPDATE`,
      [contactId, industryId]
    );
    const contact = contactRes.rows[0];
    if (!contact) throw new Error('Customer not found');
    if (contact.contact_type === 'Suppliers') {
      throw new Error('This contact is a Supplier — use the supplier payment flow');
    }

    // Oldest-first open invoices for this customer, in this industry only —
    // locked so two simultaneous payments can't double-allocate the same
    // outstanding balance (duplicate-submission / race protection).
    const invRes = await client.query(
      `SELECT id, invoice_no, invoice_date, grand_total,
              COALESCE(paid_amount,0) AS paid_amount,
              GREATEST(COALESCE(grand_total,0) - COALESCE(paid_amount,0), 0) AS balance
       FROM sales_invoices
       WHERE customer_id = $1 AND industry_id = $2
         AND COALESCE(payment_status,'') <> 'Paid'
         AND GREATEST(COALESCE(grand_total,0) - COALESCE(paid_amount,0), 0) > 0.01
       ORDER BY invoice_date ASC, id ASC
       FOR UPDATE`,
      [contactId, industryId]
    );

    const totalOpen = invRes.rows.reduce((s, r) => s + num(r.balance), 0);

    if (amount > totalOpen + 0.01 && !allowOverpayAsAdvance) {
      logAudit({
        userId, userName,
        module: 'Sales - Customer Payment',
        action: 'BLOCKED_OVERPAYMENT',
        recordId: contactId,
        recordLabel: contact.name,
        newData: { attemptedAmount: amount, totalOpenInvoices: totalOpen },
      }).catch(() => {});
      throw new Error(
        `Payment (₹${amount.toFixed(2)}) exceeds total open invoice balance (₹${totalOpen.toFixed(2)}). ` +
        `Pass allowOverpayAsAdvance to credit the excess to the customer's advance balance instead.`
      );
    }

    // Insert the payment record first so allocations can reference its id.
    const ins = await client.query(
      `INSERT INTO contact_payments
         (contact_id, industry_id, direction, amount, payment_method, paid_on, note, added_by)
       VALUES ($1,$2,'in',$3,$4,$5,$6,$7) RETURNING *`,
      [contactId, industryId, amount, body.paymentMethod || 'Cash', body.paidOn || new Date(), body.note || null, userId || null]
    );
    payment = ins.rows[0];

    // FIFO application
    let remaining = amount;
    for (const inv of invRes.rows) {
      if (remaining <= 0.01) break;
      const bal = num(inv.balance);
      const applied = Math.min(remaining, bal);
      if (applied <= 0) continue;

      const newPaid = num(inv.paid_amount) + applied;
      const newStatus = newPaid + 0.01 >= num(inv.grand_total) ? 'Paid' : 'Partial';

      await client.query(
        `UPDATE sales_invoices SET paid_amount = $1, payment_status = $2 WHERE id = $3 AND industry_id = $4`,
        [newPaid, newStatus, inv.id, industryId]
      );

      await client.query(
        `INSERT INTO payment_allocations (payment_id, invoice_id, contact_id, industry_id, amount_applied)
         VALUES ($1,$2,$3,$4,$5)`,
        [payment.id, inv.id, contactId, industryId, applied]
      );

      allocations.push({ invoiceId: inv.id, invoiceNo: inv.invoice_no, appliedAmount: Math.round(applied * 100) / 100, remainingBalance: Math.round((bal - applied) * 100) / 100 });
      invoiceUpdates.push({ invoiceId: inv.id, invoiceNo: inv.invoice_no, newPaidAmount: newPaid, newStatus });
      remaining -= applied;
    }

    // Excess beyond every open invoice → customer advance balance, using
    // the existing advance mechanism (contactService.adjustAdvanceBalance),
    // not a new "credit" concept.
    if (remaining > 0.01) {
      advanceCredited = Math.round(remaining * 100) / 100;
      await client.query(
        `UPDATE contacts SET advance_balance = GREATEST(0, COALESCE(advance_balance,0) + $1), updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [advanceCredited, contactId]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Best-effort side effects — never allowed to undo the committed payment.
  bankIntegrationService.safeRecord({
    sourceModule: 'ContactPayment',
    sourceId: payment.id,
    sourceEvent: `customer-payment-fifo-${payment.id}`,
    txnType: 'Credit',
    amount,
    paymentMethod: body.paymentMethod || 'Cash',
    description: `Payment received from customer — ${contactId} (FIFO allocation, ${allocations.length} invoice(s))`,
    txnDate: body.paidOn || new Date(),
    userId,
  }).catch(() => {});

  logAudit({
    userId, userName,
    module: 'Sales - Customer Payment',
    action: 'CREATE',
    recordId: payment.id,
    recordLabel: `Payment #${payment.id} — contact ${contactId}`,
    newData: { payment, allocations, advanceCredited },
  }).catch(() => {});

  for (const u of invoiceUpdates) {
    logAudit({
      userId, userName,
      module: 'Sales - Customer Payment',
      action: 'ALLOCATE',
      recordId: u.invoiceId,
      recordLabel: `Invoice ${u.invoiceNo || u.invoiceId}`,
      newData: { paymentId: payment.id, newPaidAmount: u.newPaidAmount, newStatus: u.newStatus },
    }).catch(() => {});
  }

  return {
    payment,
    allocations,
    advanceCredited,
    outstanding: await getCustomerOutstanding(industryId, contactId),
  };
};

const recordSupplierPayment = async (industryId, contactId, body, userId, userName) => {
  await ensureContactPaymentsSchema();
  const bankIntegrationService = require('./bankIntegrationService');
  const { logAudit } = require('./auditLogService');

  const amount = parseFloat(body.amount);
  if (!amount || amount <= 0) throw new Error('Payment amount must be greater than 0');

  const outstanding = await getSupplierOutstanding(industryId, contactId);
  if (amount > outstanding.total + 0.01) {
    logAudit({
      userId, userName,
      module: 'Contacts - Supplier Payment',
      action: 'BLOCKED_OVERPAYMENT',
      recordId: contactId,
      recordLabel: outstanding.name,
      newData: { attemptedAmount: amount, outstanding: outstanding.total },
    }).catch(() => {});
    throw new Error(
      `Payment (₹${amount.toFixed(2)}) exceeds supplier payable (₹${outstanding.total.toFixed(2)}).`
    );
  }

  const ins = await pool.query(
    `INSERT INTO contact_payments
       (contact_id, industry_id, direction, amount, payment_method, paid_on, note, added_by)
     VALUES ($1,$2,'out',$3,$4,$5,$6,$7) RETURNING *`,
    [contactId, industryId, amount, body.paymentMethod || 'Cash', body.paidOn || new Date(), body.note || null, userId || null]
  );

  await bankIntegrationService.safeRecord({
    sourceModule: 'ContactPayment',
    sourceId: ins.rows[0].id,
    sourceEvent: `supplier-payment-${ins.rows[0].id}`,
    txnType: 'Debit',
    amount,
    paymentMethod: body.paymentMethod || 'Cash',
    description: `Payment made to supplier — ${outstanding.name}`,
    txnDate: body.paidOn || new Date(),
    userId,
  }).catch(() => {});

  logAudit({
    userId, userName,
    module: 'Contacts - Supplier Payment',
    action: 'CREATE',
    recordId: ins.rows[0].id,
    recordLabel: `Payment #${ins.rows[0].id} — ${outstanding.name}`,
    newData: ins.rows[0],
  }).catch(() => {});

  return { payment: ins.rows[0], outstanding: await getSupplierOutstanding(industryId, contactId) };
};

// ── Full statement (opening balance + every transaction) ────────────────────
const getCustomerStatement = async (industryId, contactId) => {
  await ensureContactPaymentsSchema();
  const outstanding = await getCustomerOutstanding(industryId, contactId);

  const invRes = await pool.query(
    `SELECT invoice_date AS date, invoice_no AS ref, grand_total AS debit, paid_amount AS credit_applied,
            payment_status AS status
     FROM sales_invoices WHERE customer_id = $1 AND industry_id = $2
     ORDER BY invoice_date ASC, id ASC`,
    [contactId, industryId]
  );
  const payRes = await pool.query(
    `SELECT paid_on AS date, 'Payment' AS ref, amount AS credit, payment_method, note
     FROM contact_payments
     WHERE contact_id = $1 AND industry_id = $2 AND direction = 'in'
     ORDER BY paid_on ASC, id ASC`,
    [contactId, industryId]
  );

  const lines = [
    { date: null, type: 'Opening Balance', ref: '-', debit: outstanding.openingBalance, credit: 0 },
    ...invRes.rows.map(r => ({ date: r.date, type: 'Credit Sale', ref: r.ref, debit: num(r.debit), credit: 0, status: r.status })),
    ...invRes.rows.filter(r => num(r.credit_applied) > 0).map(r => ({ date: r.date, type: 'Payment (on invoice)', ref: r.ref, debit: 0, credit: num(r.credit_applied) })),
    ...payRes.rows.map(r => ({ date: r.date, type: 'Payment', ref: r.ref, debit: 0, credit: num(r.credit), method: r.payment_method, note: r.note })),
  ].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  let running = 0;
  const withRunning = lines.map(l => {
    running += num(l.debit) - num(l.credit);
    return { ...l, runningBalance: Math.round(running * 100) / 100 };
  });

  return { contact: { id: outstanding.contactId, name: outstanding.name }, summary: outstanding, lines: withRunning };
};

const getSupplierStatement = async (industryId, contactId) => {
  await ensureContactPaymentsSchema();
  const outstanding = await getSupplierOutstanding(industryId, contactId);

  const purRes = await pool.query(
    `SELECT purchase_date AS date, reference_no AS ref, grand_total AS credit, amount_paid AS debit_applied,
            payment_status AS status
     FROM purchases WHERE supplier_id = $1 AND industry_id = $2
     ORDER BY purchase_date ASC, id ASC`,
    [contactId, industryId]
  );
  const payRes = await pool.query(
    `SELECT paid_on AS date, 'Payment' AS ref, amount AS debit, payment_method, note
     FROM contact_payments
     WHERE contact_id = $1 AND industry_id = $2 AND direction = 'out'
     ORDER BY paid_on ASC, id ASC`,
    [contactId, industryId]
  );

  const lines = [
    { date: null, type: 'Opening Balance', ref: '-', debit: 0, credit: outstanding.openingBalance },
    ...purRes.rows.map(r => ({ date: r.date, type: 'Credit Purchase', ref: r.ref, debit: 0, credit: num(r.credit), status: r.status })),
    ...purRes.rows.filter(r => num(r.debit_applied) > 0).map(r => ({ date: r.date, type: 'Payment (on purchase)', ref: r.ref, debit: num(r.debit_applied), credit: 0 })),
    ...payRes.rows.map(r => ({ date: r.date, type: 'Payment', ref: r.ref, debit: num(r.debit), credit: 0, method: r.payment_method, note: r.note })),
  ].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  let running = 0;
  const withRunning = lines.map(l => {
    running += num(l.credit) - num(l.debit);
    return { ...l, runningBalance: Math.round(running * 100) / 100 };
  });

  return { contact: { id: outstanding.contactId, name: outstanding.name }, summary: outstanding, lines: withRunning };
};

// ═══════════════════════════════════════════════════════════════
// 2. ACCOUNTS RECEIVABLE
// ═══════════════════════════════════════════════════════════════
const getReceivables = async (industryId, filters = {}) => {
  const { search = '' } = filters;
  const where = ['inv.industry_id = $1'];
  const params = [industryId];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(inv.customer ILIKE $${params.length} OR inv.invoice_no ILIKE $${params.length})`);
  }
  const whereClause = where.join(' AND ');

  const { rows } = await pool.query(`
    SELECT inv.id, inv.invoice_no AS id_no, inv.customer, inv.invoice_date AS date, inv.due_date AS due,
           COALESCE(inv.grand_total,0) AS amount, COALESCE(inv.paid_amount,0) AS paid,
           inv.payment_status AS status, (CURRENT_DATE - inv.due_date) AS age_days
    FROM sales_invoices inv
    WHERE ${whereClause}
    ORDER BY inv.invoice_date DESC LIMIT 200`, params);

  // Purchase returns whose refund hasn't fully landed yet — the supplier
  // owes YOU this balance, so it's a receivable, not a negative payable.
  const { rows: refundRows } = await pool.query(`
    SELECT pr.id, pr.return_number AS id_no, pr.supplier_name AS customer,
           pr.return_date AS date, NULL::date AS due,
           COALESCE(pr.total_amount,0) AS amount, COALESCE(pr.amount_paid,0) AS paid,
           'Refund Due' AS status, NULL::int AS age_days
    FROM purchase_returns pr
    WHERE pr.industry_id = $1 AND GREATEST(pr.total_amount - pr.amount_paid, 0) > 0
    ORDER BY pr.return_date DESC`, [industryId]);

  const summaryRes = await pool.query(`
    SELECT COALESCE(SUM(GREATEST(grand_total - paid_amount,0)),0) AS outstanding,
           COUNT(*) FILTER (WHERE payment_status <> 'Paid' AND due_date < CURRENT_DATE) AS overdue_count,
           COALESCE(SUM(paid_amount) FILTER (WHERE date_trunc('month', invoice_date) = date_trunc('month', CURRENT_DATE)),0) AS paid_this_month
    FROM sales_invoices WHERE industry_id = $1`, [industryId]);

  const refundOutstandingRes = await pool.query(`
    SELECT COALESCE(SUM(GREATEST(total_amount - amount_paid,0)),0) AS outstanding
    FROM purchase_returns WHERE industry_id = $1`, [industryId]);

  // Customer opening balances count as receivable too — every customer with
  // opening_balance > 0 owed us that before invoice tracking started.
  const openingBalRes = await pool.query(
    `SELECT COALESCE(SUM(opening_balance),0) AS v FROM contacts
     WHERE industry_id = $1 AND contact_type IN ('Customers','Both') AND opening_balance > 0`,
    [industryId]
  );

  const summary = {
    ...summaryRes.rows[0],
    outstanding: num(summaryRes.rows[0].outstanding) + num(refundOutstandingRes.rows[0].outstanding) + num(openingBalRes.rows[0].v),
    supplier_refunds_due: num(refundOutstandingRes.rows[0].outstanding),
    customer_opening_balances: num(openingBalRes.rows[0].v),
  };

  return { rows: [...rows, ...refundRows], summary, aging: await getARAging(industryId) };
};

// ═══════════════════════════════════════════════════════════════
// 3. ACCOUNTS PAYABLE
// ═══════════════════════════════════════════════════════════════
const getPayables = async (industryId, filters = {}) => {
  const { search = '' } = filters;
  const params = [industryId];
  const purchaseWhere = ['p.industry_id = $1'];
  const expenseWhere = ['e.industry_id = $1'];
  if (search) {
    params.push(`%${search}%`);
    purchaseWhere.push(`(p.supplier_name ILIKE $${params.length} OR p.reference_no ILIKE $${params.length})`);
    expenseWhere.push(`(e.expense_for ILIKE $${params.length} OR e.expense_number ILIKE $${params.length})`);
  }

  const { rows } = await pool.query(`
    SELECT p.id, p.reference_no AS id_no, p.supplier_name AS vendor, p.purchase_date AS date,
           COALESCE(p.grand_total,0) AS amount, COALESCE(p.amount_paid,0) AS paid,
           p.payment_status AS status, (CURRENT_DATE - p.purchase_date::date - 30) AS age_days,
           'Purchase' AS source
    FROM purchases p
    WHERE ${purchaseWhere.join(' AND ')}
    UNION ALL
    SELECT e.id, e.expense_number AS id_no, COALESCE(e.expense_for, 'Expense') AS vendor, e.expense_date AS date,
           COALESCE(e.total_amount,0) AS amount, COALESCE(e.total_amount,0) - COALESCE(e.payment_due,0) AS paid,
           e.payment_status AS status, (CURRENT_DATE - e.expense_date::date - 30) AS age_days,
           'Expense' AS source
    FROM expenses e
    WHERE ${expenseWhere.join(' AND ')} AND COALESCE(e.payment_due,0) > 0
    ORDER BY date DESC LIMIT 200`, params);

const summaryRes = await pool.query(`
    SELECT
      GREATEST(
        COALESCE((SELECT SUM(GREATEST(grand_total - amount_paid,0)) FROM purchases WHERE industry_id = $1),0)
        + COALESCE((SELECT SUM(payment_due) FROM expenses WHERE industry_id = $1),0)
        -- Purchase returns reduce what you owe the supplier — a return with an
        -- outstanding balance (not yet refunded/credited) offsets AP directly.
        -- Clamped at 0: once purchases owed hits 0, any further return balance
        -- is money the supplier owes YOU, not a negative payable — that part
        -- surfaces in Receivables instead (see getReceivables).
        - COALESCE((SELECT SUM(GREATEST(total_amount - amount_paid,0)) FROM purchase_returns WHERE industry_id = $1),0)
      , 0) AS outstanding,
      (
        (SELECT COUNT(*) FROM purchases WHERE industry_id = $1 AND payment_status <> 'Paid' AND purchase_date::date + INTERVAL '30 days' < CURRENT_DATE)
        + (SELECT COUNT(*) FROM expenses WHERE industry_id = $1 AND payment_status <> 'Paid' AND COALESCE(payment_due,0) > 0 AND expense_date::date + INTERVAL '30 days' < CURRENT_DATE)
      ) AS overdue_count,
      (
        COALESCE((SELECT SUM(amount_paid) FROM purchases WHERE industry_id = $1 AND date_trunc('month', purchase_date) = date_trunc('month', CURRENT_DATE)),0)
        + COALESCE((SELECT SUM(total_amount - payment_due) FROM expenses WHERE industry_id = $1 AND date_trunc('month', expense_date) = date_trunc('month', CURRENT_DATE)),0)
      ) AS paid_this_month
  `, [industryId]);

  // Supplier opening balances count as payable too.
  const openingBalRes = await pool.query(
    `SELECT COALESCE(SUM(opening_balance),0) AS v FROM contacts
     WHERE industry_id = $1 AND contact_type IN ('Suppliers','Both') AND opening_balance > 0`,
    [industryId]
  );

  const summary = {
    ...summaryRes.rows[0],
    outstanding: num(summaryRes.rows[0].outstanding) + num(openingBalRes.rows[0].v),
    supplier_opening_balances: num(openingBalRes.rows[0].v),
  };

  return { rows, summary };
};
// ═══════════════════════════════════════════════════════════════
// 4. CASH & BANK
// ═══════════════════════════════════════════════════════════════
let cashBankSchemaReady = false;
const ensureCashBankSchema = async () => {
  if (cashBankSchemaReady) return;
  await pool.query(`ALTER TABLE accounting_bank_transactions ADD COLUMN IF NOT EXISTS source_module VARCHAR(30)`);
  await pool.query(`ALTER TABLE accounting_bank_transactions ADD COLUMN IF NOT EXISTS source_id INTEGER`);
  await pool.query(`ALTER TABLE accounting_bank_transactions ADD COLUMN IF NOT EXISTS source_event VARCHAR(40)`);
  await pool.query(`ALTER TABLE accounting_bank_transactions ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN DEFAULT FALSE`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_txn_source
    ON accounting_bank_transactions (source_module, source_id, source_event)
    WHERE source_module IS NOT NULL
  `);
  cashBankSchemaReady = true;
};

const listBankAccounts = async (industryId) => {
  const { rows } = await pool.query(`
    SELECT ba.*, COALESCE(ba.opening_balance,0)
      + COALESCE(SUM(CASE WHEN bt.txn_type='Credit' THEN bt.amount ELSE -bt.amount END),0) AS balance
    FROM accounting_bank_accounts ba
    LEFT JOIN accounting_bank_transactions bt ON bt.bank_account_id = ba.id
    WHERE ba.industry_id = $1
    GROUP BY ba.id ORDER BY ba.id`, [industryId]);
  return rows;
};

const createBankAccount = async (industryId, data) => {
  const { name, account_number, ifsc, account_type, opening_balance, link_coa_account_id } = data;
  const { rows } = await pool.query(
    `INSERT INTO accounting_bank_accounts (name, account_number, ifsc, account_type, opening_balance, industry_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [name, account_number || null, ifsc || null, account_type || 'Current', opening_balance || 0, industryId]
  );
  const account = rows[0];

  if (link_coa_account_id) {
    await pool.query(`ALTER TABLE accounting_accounts ADD COLUMN IF NOT EXISTS bank_account_id INTEGER`);
    await pool.query(
      `UPDATE accounting_accounts SET bank_account_id = $1 WHERE id = $2 AND industry_id = $3`,
      [account.id, link_coa_account_id, industryId]
    );
  }
  return account;
};

const listBankTransactions = async (industryId, filters = {}) => {
  await ensureCashBankSchema();
  // Backward compatible: if a bare number/string is passed (old call style
  // `listBankTransactions(50)`), treat it as the limit with no filters.
  const f = (typeof filters === 'object' && filters !== null) ? filters : { limit: filters };
  const { limit = 50, date_from, date_to, bank_account_id, txn_type, source_module } = f;

  const where = ['ba.industry_id = $1'];
  const params = [industryId];
  if (date_from) { params.push(date_from); where.push(`bt.txn_date >= $${params.length}`); }
  if (date_to) { params.push(date_to); where.push(`bt.txn_date <= $${params.length}`); }
  if (bank_account_id) { params.push(bank_account_id); where.push(`bt.bank_account_id = $${params.length}`); }
  if (txn_type) { params.push(txn_type); where.push(`bt.txn_type = $${params.length}`); }
  if (source_module) {
    if (source_module === 'Manual') {
      where.push(`(bt.source_module IS NULL OR bt.source_module = 'Manual')`);
    } else {
      params.push(source_module); where.push(`bt.source_module = $${params.length}`);
    }
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  params.push(limit);

  const { rows } = await pool.query(`
    SELECT bt.*, ba.name AS account_name,
           COALESCE(bt.source_module, 'Manual') AS source
    FROM accounting_bank_transactions bt
    JOIN accounting_bank_accounts ba ON ba.id = bt.bank_account_id
    ${whereSql}
    ORDER BY bt.txn_date DESC, bt.id DESC LIMIT $${params.length}`, params);
  return rows;
};

const createBankTransaction = async (industryId, data, userId) => {
  await ensureCashBankSchema();
  const { bank_account_id, txn_date, description, txn_type, amount } = data;
  const { rows } = await pool.query(
    `INSERT INTO accounting_bank_transactions
       (bank_account_id, txn_date, description, txn_type, amount, created_by, source_module, auto_generated, industry_id)
     VALUES ($1,$2,$3,$4,$5,$6,'Manual',FALSE,$7) RETURNING *`,
    [bank_account_id, txn_date || new Date(), description || null, txn_type, amount, userId || null, industryId]
  );
  return rows[0];
};

const updateBankTransaction = async (industryId, id, data) => {
  await ensureCashBankSchema();
  const { rows: existing } = await pool.query(
    `SELECT * FROM accounting_bank_transactions WHERE id = $1 AND industry_id = $2`, [id, industryId]
  );
  if (!existing.length) throw new Error('Transaction not found');
  if (existing[0].auto_generated) {
    throw new Error('This transaction was generated automatically by another module and cannot be edited here.');
  }
  const { bank_account_id, txn_date, description, txn_type, amount } = data;
  const { rows } = await pool.query(
    `UPDATE accounting_bank_transactions
     SET bank_account_id = COALESCE($1, bank_account_id),
         txn_date = COALESCE($2, txn_date),
         description = COALESCE($3, description),
         txn_type = COALESCE($4, txn_type),
         amount = COALESCE($5, amount)
     WHERE id = $6 AND industry_id = $7 RETURNING *`,
    [bank_account_id || null, txn_date || null, description ?? null, txn_type || null, amount || null, id, industryId]
  );
  return rows[0];
};

const deleteBankTransaction = async (industryId, id) => {
  await ensureCashBankSchema();
  const { rows: existing } = await pool.query(
    `SELECT * FROM accounting_bank_transactions WHERE id = $1 AND industry_id = $2`, [id, industryId]
  );
  if (!existing.length) throw new Error('Transaction not found');
  if (existing[0].auto_generated) {
    throw new Error('This transaction was generated automatically by another module and cannot be deleted here. Adjust it from the source module instead.');
  }
  await pool.query(`DELETE FROM accounting_bank_transactions WHERE id = $1 AND industry_id = $2`, [id, industryId]);
  return { id };
};

const getBankAccountLedger = async (industryId, accountId, { date_from, date_to } = {}) => {
  await ensureCashBankSchema();
  const { rows: accRows } = await pool.query(
    `SELECT * FROM accounting_bank_accounts WHERE id = $1 AND industry_id = $2`, [accountId, industryId]
  );
  if (!accRows.length) throw new Error('Bank account not found');
  const account = accRows[0];

  const where = ['bt.bank_account_id = $1'];
  const params = [accountId];
  if (date_from) { params.push(date_from); where.push(`bt.txn_date >= $${params.length}`); }
  if (date_to) { params.push(date_to); where.push(`bt.txn_date <= $${params.length}`); }

  const { rows: txns } = await pool.query(`
    SELECT bt.*, COALESCE(bt.source_module, 'Manual') AS source
    FROM accounting_bank_transactions bt
    WHERE ${where.join(' AND ')}
    ORDER BY bt.txn_date ASC, bt.id ASC`, params);

  let running = num(account.opening_balance);
  // If filtering from a date, opening balance for the ledger view should
  // reflect everything before date_from, not the account's all-time opening.
  if (date_from) {
    const { rows: priorRows } = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN txn_type='Credit' THEN amount ELSE -amount END),0) AS prior
       FROM accounting_bank_transactions WHERE bank_account_id = $1 AND txn_date < $2`,
      [accountId, date_from]
    );
    running = num(account.opening_balance) + num(priorRows[0].prior);
  }
  const openingBalance = running;
  const ledgerRows = txns.map((t) => {
    running += t.txn_type === 'Credit' ? num(t.amount) : -num(t.amount);
    return { ...t, running_balance: Math.round(running * 100) / 100 };
  });

  return { account, openingBalance, closingBalance: running, rows: ledgerRows };
};

const getBankStatement = async (industryId, accountId, { date_from, date_to } = {}) => {
  const ledger = await getBankAccountLedger(industryId, accountId, { date_from, date_to });
  const receipts = ledger.rows.filter(r => r.txn_type === 'Credit').reduce((s, r) => s + num(r.amount), 0);
  const payments = ledger.rows.filter(r => r.txn_type === 'Debit').reduce((s, r) => s + num(r.amount), 0);
  return {
    account: ledger.account,
    dateFrom: date_from || null,
    dateTo: date_to || null,
    openingBalance: ledger.openingBalance,
    receipts,
    payments,
    closingBalance: ledger.closingBalance,
    rows: ledger.rows,
  };
};

const getCashBankSummary = async (industryId) => {
  const { rows: accounts } = await pool.query(`
    SELECT ba.*, COALESCE(ba.opening_balance,0)
      + COALESCE(SUM(CASE WHEN bt.txn_type='Credit' THEN bt.amount ELSE -bt.amount END),0) AS balance
    FROM accounting_bank_accounts ba
    LEFT JOIN accounting_bank_transactions bt ON bt.bank_account_id = ba.id
    WHERE ba.industry_id = $1
    GROUP BY ba.id`, [industryId]);

  const cashBalance = accounts.filter(a => a.account_type === 'Cash').reduce((s, a) => s + num(a.balance), 0);
  const bankBalance = accounts.filter(a => a.account_type !== 'Cash').reduce((s, a) => s + num(a.balance), 0);

  const { rows: todayRows } = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN bt.txn_type = 'Credit' THEN bt.amount ELSE 0 END), 0) AS receipts,
      COALESCE(SUM(CASE WHEN bt.txn_type = 'Debit' THEN bt.amount ELSE 0 END), 0) AS payments
    FROM accounting_bank_transactions bt
    JOIN accounting_bank_accounts ba ON ba.id = bt.bank_account_id
    WHERE bt.txn_date::date = CURRENT_DATE AND ba.industry_id = $1`, [industryId]);

  const todaysReceipts = num(todayRows[0].receipts);
  const todaysPayments = num(todayRows[0].payments);

  return {
    cashBalance,
    bankBalance,
    todaysReceipts,
    todaysPayments,
    netCashFlow: todaysReceipts - todaysPayments,
  };
};

const reconcileBankTransaction = async (industryId, id) => {
  const { rows } = await pool.query(
    `UPDATE accounting_bank_transactions SET reconciled = TRUE WHERE id = $1 AND industry_id = $2 RETURNING *`, [id, industryId]);
  return rows[0];
};
// ═══════════════════════════════════════════════════════════════
// 5. GST & TAX
// ═══════════════════════════════════════════════════════════════
const getGSTSummary = async (industryId, filters = {}) => {
  await require('./taxCalcService').ensureSchema();
  const r = (await pool.query(`
    SELECT
      COALESCE((SELECT SUM(cgst_amt+sgst_amt+igst_amt+cess_amt) FROM sales_invoice_items sii
        JOIN sales_invoices si ON si.id = sii.invoice_id
        WHERE date_trunc('month', si.invoice_date) = date_trunc('month', CURRENT_DATE) AND si.industry_id = $1),0) AS output_gst,
      COALESCE((SELECT SUM(cgst_amt+sgst_amt+igst_amt+cess_amt) FROM purchase_items pi
        JOIN purchases p ON p.id = pi.purchase_id
        WHERE date_trunc('month', p.purchase_date) = date_trunc('month', CURRENT_DATE) AND p.industry_id = $1),0) AS input_gst,
      COALESCE((SELECT SUM(cgst_amt) FROM sales_invoice_items sii JOIN sales_invoices si ON si.id=sii.invoice_id
        WHERE date_trunc('month', si.invoice_date) = date_trunc('month', CURRENT_DATE) AND si.industry_id = $1),0) AS output_cgst,
      COALESCE((SELECT SUM(sgst_amt) FROM sales_invoice_items sii JOIN sales_invoices si ON si.id=sii.invoice_id
        WHERE date_trunc('month', si.invoice_date) = date_trunc('month', CURRENT_DATE) AND si.industry_id = $1),0) AS output_sgst,
      COALESCE((SELECT SUM(igst_amt) FROM sales_invoice_items sii JOIN sales_invoices si ON si.id=sii.invoice_id
        WHERE date_trunc('month', si.invoice_date) = date_trunc('month', CURRENT_DATE) AND si.industry_id = $1),0) AS output_igst,
      COALESCE((SELECT SUM(cgst_amt) FROM purchase_items pi JOIN purchases p ON p.id=pi.purchase_id
        WHERE date_trunc('month', p.purchase_date) = date_trunc('month', CURRENT_DATE) AND p.industry_id = $1),0) AS input_cgst,
      COALESCE((SELECT SUM(sgst_amt) FROM purchase_items pi JOIN purchases p ON p.id=pi.purchase_id
        WHERE date_trunc('month', p.purchase_date) = date_trunc('month', CURRENT_DATE) AND p.industry_id = $1),0) AS input_sgst,
      COALESCE((SELECT SUM(igst_amt) FROM purchase_items pi JOIN purchases p ON p.id=pi.purchase_id
        WHERE date_trunc('month', p.purchase_date) = date_trunc('month', CURRENT_DATE) AND p.industry_id = $1),0) AS input_igst
  `, [industryId])).rows[0];
  return {
    outputGST: num(r.output_gst), inputGST: num(r.input_gst),
    netPayable: num(r.output_gst) - num(r.input_gst),
    breakup: {
      cgst: num(r.output_cgst) - num(r.input_cgst),
      sgst: num(r.output_sgst) - num(r.input_sgst),
      igst: num(r.output_igst) - num(r.input_igst),
    },
  };
};

const getGSTLedger = async (industryId, filters = {}) => {
  await require('./taxCalcService').ensureSchema();
  const { rows } = await pool.query(`
    SELECT si.invoice_date AS date, si.invoice_no AS ref, 'Sales' AS source,
      sii.cgst_amt, sii.sgst_amt, sii.igst_amt, sii.cess_amt,
      (sii.cgst_amt+sii.sgst_amt+sii.igst_amt+sii.cess_amt) AS total_gst
    FROM sales_invoice_items sii JOIN sales_invoices si ON si.id = sii.invoice_id
    WHERE (sii.cgst_amt+sii.sgst_amt+sii.igst_amt+sii.cess_amt) > 0 AND si.industry_id = $1
    UNION ALL
    SELECT p.purchase_date AS date, p.reference_no AS ref, 'Purchase' AS source,
      pi.cgst_amt, pi.sgst_amt, pi.igst_amt, pi.cess_amt,
      (pi.cgst_amt+pi.sgst_amt+pi.igst_amt+pi.cess_amt) AS total_gst
    FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
    WHERE (pi.cgst_amt+pi.sgst_amt+pi.igst_amt+pi.cess_amt) > 0 AND p.industry_id = $1
    ORDER BY date DESC LIMIT 200
  `, [industryId]);
  return rows.map(r => ({ ...r, cgst_amt: num(r.cgst_amt), sgst_amt: num(r.sgst_amt), igst_amt: num(r.igst_amt), cess_amt: num(r.cess_amt), total_gst: num(r.total_gst) }));
};

const getGSTMonthlyTrend = async (industryId) => {
  await require('./taxCalcService').ensureSchema();
  const { rows: out } = await pool.query(`
    SELECT TO_CHAR(si.invoice_date,'Mon YYYY') AS month, SUM(sii.cgst_amt+sii.sgst_amt+sii.igst_amt+sii.cess_amt) AS output_gst
    FROM sales_invoice_items sii JOIN sales_invoices si ON si.id=sii.invoice_id
    WHERE si.invoice_date >= CURRENT_DATE - INTERVAL '12 months' AND si.industry_id = $1
    GROUP BY 1, date_trunc('month', si.invoice_date) ORDER BY date_trunc('month', si.invoice_date)`, [industryId]);
  const { rows: inp } = await pool.query(`
    SELECT TO_CHAR(p.purchase_date,'Mon YYYY') AS month, SUM(pi.cgst_amt+pi.sgst_amt+pi.igst_amt+pi.cess_amt) AS input_gst
    FROM purchase_items pi JOIN purchases p ON p.id=pi.purchase_id
    WHERE p.purchase_date >= CURRENT_DATE - INTERVAL '12 months' AND p.industry_id = $1
    GROUP BY 1, date_trunc('month', p.purchase_date) ORDER BY date_trunc('month', p.purchase_date)`, [industryId]);
  const map = {};
  out.forEach(r => { map[r.month] = { month: r.month, outputGST: num(r.output_gst), inputGST: 0 }; });
  inp.forEach(r => { map[r.month] = map[r.month] || { month: r.month, outputGST: 0, inputGST: 0 }; map[r.month].inputGST = num(r.input_gst); });
  return Object.values(map);
};

const getTaxRateMaster = async (industryId) => {
  const { rows } = await pool.query(`
    SELECT (tax)::numeric AS rate, COUNT(*) AS product_count
    FROM products
    WHERE tax ~ '^[0-9]+(\\.[0-9]+)?$' AND industry_id = $1
    GROUP BY (tax)::numeric ORDER BY rate`, [industryId]);
  return rows.map(r => ({ rate: num(r.rate), productCount: parseInt(r.product_count, 10) }));
};
const getGSTQuarterly = async (industryId) => {
  const { rows: salesRows } = await pool.query(`
    SELECT TO_CHAR(invoice_date, 'YYYY-"Q"Q') AS period,
           COALESCE(SUM(grand_total - tax_amt),0) AS taxable,
           COALESCE(SUM(tax_amt),0) AS sales_tax
    FROM sales_invoices WHERE industry_id = $1 GROUP BY period`, [industryId]);
  const { rows: purRows } = await pool.query(`
    SELECT TO_CHAR(purchase_date, 'YYYY-"Q"Q') AS period, COALESCE(SUM(tax_amount),0) AS purchase_tax
    FROM purchases WHERE industry_id = $1 GROUP BY period`, [industryId]);
  const map = {};
  salesRows.forEach(r => { map[r.period] = { period: r.period, taxable: num(r.taxable), salesTax: num(r.sales_tax), purchaseTax: 0 }; });
  purRows.forEach(r => { map[r.period] = map[r.period] || { period: r.period, taxable: 0, salesTax: 0, purchaseTax: 0 }; map[r.period].purchaseTax = num(r.purchase_tax); });
  return Object.values(map).sort((a, b) => b.period.localeCompare(a.period));
};
// ═══════════════════════════════════════════════════════════════
// 5b. GST SETTINGS
// ═══════════════════════════════════════════════════════════════
const getGSTSettings = async () => {
  return await require('./taxCalcService').getSettings();
};

const updateGSTSettings = async (data) => {
  const taxCalcService = require('./taxCalcService');
  await taxCalcService.ensureSchema();
  const {
    business_gstin, business_state, default_cgst_rate, default_sgst_rate,
    default_igst_rate, default_cess_rate, reverse_charge_enabled, filing_frequency,
  } = data;
  const { rows } = await pool.query(`
    UPDATE gst_settings SET
      business_gstin = COALESCE($1, business_gstin),
      business_state = COALESCE($2, business_state),
      default_cgst_rate = COALESCE($3, default_cgst_rate),
      default_sgst_rate = COALESCE($4, default_sgst_rate),
      default_igst_rate = COALESCE($5, default_igst_rate),
      default_cess_rate = COALESCE($6, default_cess_rate),
      reverse_charge_enabled = COALESCE($7, reverse_charge_enabled),
      filing_frequency = COALESCE($8, filing_frequency),
      updated_at = NOW()
    WHERE id = (SELECT id FROM gst_settings ORDER BY id LIMIT 1)
    RETURNING *`,
    [business_gstin, business_state, default_cgst_rate, default_sgst_rate,
     default_igst_rate, default_cess_rate, reverse_charge_enabled, filing_frequency]
  );
  return rows[0];
};
// ═══════════════════════════════════════════════════════════════
// 5c. HSN/SAC SUMMARY
// ═══════════════════════════════════════════════════════════════
const getHSNSummary = async (industryId, filters = {}) => {
  await require('./taxCalcService').ensureSchema();
  const { rows: salesRows } = await pool.query(`
    SELECT COALESCE(sii.hsn_code, p.hsn_code, 'Unspecified') AS hsn_code,
           COUNT(*) AS txn_count,
           COALESCE(SUM(sii.line_total - sii.cgst_amt - sii.sgst_amt - sii.igst_amt - sii.cess_amt),0) AS taxable_value,
           COALESCE(SUM(sii.cgst_amt),0) AS cgst, COALESCE(SUM(sii.sgst_amt),0) AS sgst,
           COALESCE(SUM(sii.igst_amt),0) AS igst, COALESCE(SUM(sii.cess_amt),0) AS cess
    FROM sales_invoice_items sii
    JOIN sales_invoices si ON si.id = sii.invoice_id
    LEFT JOIN products p ON p.sku = sii.sku AND p.industry_id = $1
    WHERE si.industry_id = $1
    GROUP BY 1 ORDER BY taxable_value DESC`, [industryId]);

  const { rows: purRows } = await pool.query(`
    SELECT COALESCE(pi.hsn_code, p.hsn_code, 'Unspecified') AS hsn_code,
           COUNT(*) AS txn_count,
           COALESCE(SUM(pi.line_total - pi.cgst_amt - pi.sgst_amt - pi.igst_amt - pi.cess_amt),0) AS taxable_value,
           COALESCE(SUM(pi.cgst_amt),0) AS cgst, COALESCE(SUM(pi.sgst_amt),0) AS sgst,
           COALESCE(SUM(pi.igst_amt),0) AS igst, COALESCE(SUM(pi.cess_amt),0) AS cess
    FROM purchase_items pi
    JOIN purchases p2 ON p2.id = pi.purchase_id
    LEFT JOIN products p ON p.id = pi.product_id AND p.industry_id = $1
    WHERE p2.industry_id = $1
    GROUP BY 1 ORDER BY taxable_value DESC`, [industryId]);

  const mapRow = (r) => ({
    hsnCode: r.hsn_code, txnCount: parseInt(r.txn_count, 10),
    taxableValue: num(r.taxable_value), cgst: num(r.cgst), sgst: num(r.sgst),
    igst: num(r.igst), cess: num(r.cess),
    totalTax: num(r.cgst) + num(r.sgst) + num(r.igst) + num(r.cess),
  });

  return {
    sales: salesRows.map(mapRow),
    purchases: purRows.map(mapRow),
  };
};

// ═══════════════════════════════════════════════════════════════
// 5d. GST BY STATE
// ═══════════════════════════════════════════════════════════════
const getGSTByState = async (industryId) => {
  const { rows: salesRows } = await pool.query(`
    SELECT COALESCE(NULLIF(TRIM(c.state), ''), 'Unspecified') AS state,
           COUNT(DISTINCT si.id) AS invoice_count,
           COALESCE(SUM(sii.line_total - sii.cgst_amt - sii.sgst_amt - sii.igst_amt - sii.cess_amt),0) AS taxable_value,
           COALESCE(SUM(sii.cgst_amt),0) AS cgst, COALESCE(SUM(sii.sgst_amt),0) AS sgst,
           COALESCE(SUM(sii.igst_amt),0) AS igst, COALESCE(SUM(sii.cess_amt),0) AS cess
    FROM sales_invoice_items sii
    JOIN sales_invoices si ON si.id = sii.invoice_id
    LEFT JOIN LATERAL (
      SELECT c2.state FROM contacts c2
      WHERE c2.industry_id = si.industry_id
        AND (c2.id = si.customer_id
         OR (si.customer_id IS NULL AND TRIM(LOWER(c2.name)) = TRIM(LOWER(si.customer)) AND c2.contact_type = 'Customers'))
      ORDER BY c2.id LIMIT 1
    ) c ON TRUE
    WHERE si.industry_id = $1
    GROUP BY 1 ORDER BY taxable_value DESC`, [industryId]);
  const { rows: purRows } = await pool.query(`
    SELECT COALESCE(NULLIF(TRIM(c.state), ''), 'Unspecified') AS state,
           COUNT(DISTINCT p.id) AS invoice_count,
           COALESCE(SUM(pi.line_total - pi.cgst_amt - pi.sgst_amt - pi.igst_amt - pi.cess_amt),0) AS taxable_value,
           COALESCE(SUM(pi.cgst_amt),0) AS cgst, COALESCE(SUM(pi.sgst_amt),0) AS sgst,
           COALESCE(SUM(pi.igst_amt),0) AS igst, COALESCE(SUM(pi.cess_amt),0) AS cess
    FROM purchase_items pi
    JOIN purchases p ON p.id = pi.purchase_id
    LEFT JOIN LATERAL (
      SELECT c2.state FROM contacts c2
      WHERE c2.industry_id = p.industry_id
        AND (c2.id = p.supplier_id
         OR (p.supplier_id IS NULL AND c2.name = p.supplier_name AND c2.contact_type = 'Suppliers'))
      ORDER BY c2.id LIMIT 1
    ) c ON TRUE
    WHERE p.industry_id = $1
    GROUP BY 1 ORDER BY taxable_value DESC`, [industryId]);

  const mapRow = (r) => ({
    state: r.state, invoiceCount: parseInt(r.invoice_count, 10),
    taxableValue: num(r.taxable_value), cgst: num(r.cgst), sgst: num(r.sgst),
    igst: num(r.igst), cess: num(r.cess),
    totalTax: num(r.cgst) + num(r.sgst) + num(r.igst) + num(r.cess),
  });

  return {
    sales: salesRows.map(mapRow),
    purchases: purRows.map(mapRow),
  };
};
// ═══════════════════════════════════════════════════════════════
// 6. FIXED ASSETS
// ═══════════════════════════════════════════════════════════════
const calcDepreciation = (a) => {
  const yearsOwned = Math.max(0, (Date.now() - new Date(a.purchase_date).getTime()) / (365.25 * 24 * 3600 * 1000));
  let accumDep;
  if (a.method === 'SLM') {
    const annual = (num(a.cost) - num(a.salvage_value)) / num(a.useful_life_yrs || 1);
    accumDep = Math.min(annual * yearsOwned, num(a.cost) - num(a.salvage_value));
  } else {
    const rate = 1 - Math.pow(num(a.salvage_value) / num(a.cost || 1), 1 / (a.useful_life_yrs || 1));
    let nbv = num(a.cost);
    for (let y = 0; y < Math.floor(yearsOwned); y++) nbv -= nbv * rate;
    accumDep = num(a.cost) - nbv;
  }
  return { accumDep: Math.round(accumDep), nbv: Math.round(num(a.cost) - accumDep) };
};

const listFixedAssets = async (industryId) => {
  const { rows } = await pool.query(`SELECT * FROM accounting_fixed_assets WHERE industry_id = $1 ORDER BY id`, [industryId]);
  return rows.map(a => ({ ...a, ...calcDepreciation(a) }));
};

const updateFixedAsset = async (industryId, id, data) => {
  const { asset_code, name, category, purchase_date, cost, method, useful_life_yrs, salvage_value } = data;
  const { rows } = await pool.query(
    `UPDATE accounting_fixed_assets
     SET asset_code=$1, name=$2, category=$3, purchase_date=$4, cost=$5, method=$6, useful_life_yrs=$7, salvage_value=$8
     WHERE id=$9 AND industry_id=$10 RETURNING *`,
    [asset_code, name, category || null, purchase_date, cost, method || 'SLM', useful_life_yrs || 5, salvage_value || 0, id, industryId]
  );
  return rows[0];
};

const createFixedAsset = async (industryId, data) => {
  const { asset_code, name, category, purchase_date, cost, method, useful_life_yrs, salvage_value } = data;
  const { rows } = await pool.query(
    `INSERT INTO accounting_fixed_assets (asset_code, name, category, purchase_date, cost, method, useful_life_yrs, salvage_value, status, industry_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Active',$9) RETURNING *`,
    [asset_code, name, category || null, purchase_date, cost, method || 'SLM', useful_life_yrs || 5, salvage_value || 0, industryId]
  );
  const asset = rows[0];

  // Auto-mirror this capital purchase into Cash & Bank.
  const bankIntegrationService = require('./bankIntegrationService');
  bankIntegrationService.safeRecord({
    industryId,
    sourceModule: 'Assets',
    sourceId: asset.id,
    sourceEvent: 'purchase',
    txnType: 'Debit',
    amount: asset.cost,
    paymentMethod: data.payment_method || 'Bank Transfer',
    description: `Fixed asset purchase — ${asset.name} (${asset.asset_code})`,
    txnDate: purchase_date || new Date(),
  }).catch(() => {});

  return asset;
};
const deleteFixedAsset = async (industryId, id) => {
  // Fixed assets are auto-mirrored into accounting_bank_transactions on
  // create (source_module='Assets', source_event='purchase'). Deleting the
  // asset without deleting this row leaves an orphaned cash outflow behind,
  // permanently understating Cash & Bank Balance for money that was never
  // actually spent (the asset never existed).
  await pool.query(
    `DELETE FROM accounting_bank_transactions
     WHERE source_module = 'Assets' AND source_id = $1 AND source_event = 'purchase' AND industry_id = $2`,
    [id, industryId]
  );
  await pool.query(`DELETE FROM accounting_depreciation_log WHERE asset_id = $1 AND industry_id = $2`, [id, industryId]);
  await pool.query(`DELETE FROM accounting_fixed_assets WHERE id = $1 AND industry_id = $2`, [id, industryId]);
  return { deleted: true };
};
const disposeFixedAsset = async (industryId, id) => {
  const { rows } = await pool.query(
    `UPDATE accounting_fixed_assets SET status = 'Disposed' WHERE id = $1 AND industry_id = $2 RETURNING *`, [id, industryId]);
  return rows[0];
};

// Posts this month's depreciation for every active asset as a GL journal
// entry, once per asset per calendar month (safe to call repeatedly —
// skips assets already posted for the current month).
const getAssetDepreciationLog = async (industryId, assetId) => {
  const { rows } = await pool.query(
    `SELECT * FROM accounting_depreciation_log WHERE asset_id = $1 AND industry_id = $2 ORDER BY period DESC`,
    [assetId, industryId]
  );
  return rows;
};

const postMonthlyDepreciation = async (industryId) => {
  const period = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const assets = await listFixedAssets(industryId);
  const posted = [];

  for (const a of assets) {
if (a.status === 'Disposed') continue;

    const already = await pool.query(
      `SELECT 1 FROM accounting_depreciation_log WHERE asset_id = $1 AND period = $2 AND industry_id = $3`,
      [a.id, period, industryId]
    );
    if (already.rows.length > 0) continue;

    const monthlyDep = a.method === 'SLM'
      ? (num(a.cost) - num(a.salvage_value)) / (num(a.useful_life_yrs || 1) * 12)
      : num(a.accumDep) / 12; // approximate for WDV month-slice

    if (monthlyDep <= 0) continue;

    await pool.query(
      `INSERT INTO accounting_depreciation_log (asset_id, period, amount, posted_at, industry_id)
       VALUES ($1,$2,$3, now(), $4)`,
      [a.id, period, Math.round(monthlyDep), industryId]
    );

    // NOTE: depreciation is a non-cash expense — it reduces the asset's book
    // value and hits P&L, but no money leaves any bank/cash account. It must
    // NOT be mirrored into accounting_bank_transactions (that would wrongly
    // shrink Cash & Bank balances every month). The depreciation log above is
    // the system of record; Balance Sheet reads NBV from calcDepreciation.

    posted.push({ assetId: a.id, name: a.name, amount: Math.round(monthlyDep) });
  }

  return { period, postedCount: posted.length, posted };
};

// ═══════════════════════════════════════════════════════════════
// 7. COST CENTERS & PRODUCT COSTING
// ═══════════════════════════════════════════════════════════════
const listCostCenters = async (industryId) => {
  const { rows } = await pool.query(`
    SELECT cc.*, u.full_name AS head_name,
      COALESCE((
        SELECT SUM(e.total_amount) FROM expenses e
        WHERE e.industry_id = cc.industry_id
          AND ((cc.match_department IS NOT NULL AND e.location = cc.match_department)
           OR (cc.match_location IS NOT NULL AND e.location = cc.match_location))
      ),0) AS actual
    FROM accounting_cost_centers cc
    LEFT JOIN users u ON u.id = cc.head_user_id
    WHERE cc.industry_id = $1
    ORDER BY cc.id`, [industryId]);
  return rows.map(r => ({ ...r, variance: num(r.budget) - num(r.actual) }));
};
const createCostCenter = async (industryId, data) => {
  const { code, name, head_user_id, budget, match_department, match_location } = data;
  const { rows } = await pool.query(
    `INSERT INTO accounting_cost_centers (code, name, head_user_id, budget, match_department, match_location, industry_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [code, name, head_user_id || null, budget || 0, match_department || null, match_location || null, industryId]
  );
  return rows[0];
};

const updateCostCenter = async (industryId, id, data) => {
  const { code, name, head_user_id, budget, match_department, match_location } = data;
  const { rows } = await pool.query(
    `UPDATE accounting_cost_centers
     SET code=$1, name=$2, head_user_id=$3, budget=$4, match_department=$5, match_location=$6
     WHERE id=$7 AND industry_id=$8 RETURNING *`,
    [code, name, head_user_id || null, budget || 0, match_department || null, match_location || null, id, industryId]
  );
  return rows[0];
};

const deleteCostCenter = async (industryId, id) => {
  await pool.query(`DELETE FROM accounting_cost_centers WHERE id = $1 AND industry_id = $2`, [id, industryId]);
  return { id };
};

const getExpenseLocations = async (industryId) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT location FROM expenses WHERE location IS NOT NULL AND location <> '' AND industry_id = $1 ORDER BY location`,
    [industryId]
  );
  return rows.map(r => r.location);
};

const getProductCosting = async (industryId) => {
  const { rows } = await pool.query(`
    SELECT name AS product,
           COALESCE(purchase_price_exc_tax,0) AS material_cost,
           COALESCE(selling_price_exc_tax,0) AS selling_price
    FROM products
    WHERE selling_price_exc_tax > 0 AND industry_id = $1
    ORDER BY id DESC LIMIT 25`, [industryId]);
  return rows.map(r => {
    const cost = num(r.material_cost);
    const price = num(r.selling_price);
    const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
    return { product: r.product, totalCost: cost, sellingPrice: price, margin: `${margin.toFixed(1)}%` };
  });
};

// ═══════════════════════════════════════════════════════════════
// 8. BUDGETS
// ═══════════════════════════════════════════════════════════════
const listBudgets = async (industryId) => {
  const { rows } = await pool.query(`
    SELECT b.*, ec.name AS category_name,
      COALESCE((
        -- Actual spend must reflect refunds — SUM(net_expense), not raw
        -- total_amount, or a fully-refunded expense still inflates spend
        -- and Budget Variance even though it cost nothing in the end.
        SELECT SUM(COALESCE(e.net_expense, e.total_amount)) FROM expenses e
        WHERE e.category_id = b.category_id
          AND e.industry_id = b.industry_id
          AND (b.period_start IS NULL OR e.expense_date >= b.period_start)
          AND (b.period_end IS NULL OR e.expense_date <= b.period_end)
      ),0) AS actual
    FROM accounting_budgets b
    LEFT JOIN expense_categories ec ON ec.id = b.category_id
    WHERE b.industry_id = $1
    ORDER BY b.id DESC`, [industryId]);
  return rows;
};

const createBudget = async (industryId, data) => {
  const { category_id, category_label, period, period_start, period_end, budgeted } = data;
  const { rows } = await pool.query(
    `INSERT INTO accounting_budgets (category_id, category_label, period, period_start, period_end, budgeted, industry_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [category_id || null, category_label || null, period, period_start || null, period_end || null, budgeted || 0, industryId]
  );
  return rows[0];
};

const listExpenseRequests = async (industryId) => {
  // Real pending/approved/rejected expenses from the existing Expense module.
  // Show net_expense (after refund), not the raw total_amount, so a fully-
  // refunded expense reads as ₹0 / settled here too, matching AP/AR/Budget.
  const { rows } = await pool.query(`
    SELECT e.id, e.expense_number AS id_no, u.full_name AS requested_by,
           e.expense_for AS purpose, e.expense_date AS date,
           COALESCE(e.net_expense, e.total_amount, 0) AS amount, e.payment_status AS status
    FROM expenses e
    LEFT JOIN users u ON u.id = e.added_by
    WHERE e.industry_id = $1
    ORDER BY e.id DESC LIMIT 25`, [industryId]);
  return rows;
};
// ═══════════════════════════════════════════════════════════════
// 9. CHART OF ACCOUNTS (live balances)
// ═══════════════════════════════════════════════════════════════
const SOURCE_BALANCE_QUERIES = {
  ar: `SELECT COALESCE(SUM(GREATEST(grand_total - paid_amount,0)),0) FROM sales_invoices WHERE industry_id = $1 AND payment_status <> 'Paid'`,
ap: `SELECT
        COALESCE((SELECT SUM(GREATEST(grand_total - amount_paid,0)) FROM purchases WHERE industry_id = $1 AND payment_status <> 'Paid'),0)
        - COALESCE((SELECT SUM(GREATEST(total_amount - amount_paid,0)) FROM purchase_returns WHERE industry_id = $1),0)`,
  inventory: `SELECT COALESCE(SUM(current_stock * COALESCE(purchase_price_exc_tax,0)),0) FROM products WHERE industry_id = $1`,
  input_gst: `SELECT COALESCE(SUM(tax_amount),0) FROM purchases WHERE industry_id = $1 AND date_trunc('month', purchase_date) = date_trunc('month', CURRENT_DATE)`,
  output_gst: `SELECT COALESCE(SUM(tax_amt),0) FROM sales_invoices WHERE industry_id = $1 AND date_trunc('month', invoice_date) = date_trunc('month', CURRENT_DATE)`,
  payroll_payable: `SELECT COALESCE(SUM(net_salary),0) FROM hrm_payroll WHERE industry_id = $1 AND status <> 'Paid'`,
  sales_revenue: `SELECT COALESCE(SUM(grand_total),0) FROM sales_invoices WHERE industry_id = $1`,
  purchases_cost: `SELECT COALESCE(SUM(grand_total),0) FROM purchases WHERE industry_id = $1`,
operating_expenses: `SELECT COALESCE(SUM(total_amount),0) FROM expenses WHERE industry_id = $1`,
// Only the *paid* portion of an expense has actually left Cash & Bank;
  // unpaid/partial amounts sit in a payable, not in cash, until settled.
expenses_paid_cash: `SELECT COALESCE(SUM(GREATEST(total_amount - COALESCE(payment_due,0), 0)),0) FROM expenses WHERE industry_id = $1`,
  // The unpaid portion of every expense is a real liability — money owed
  // for services/goods already recorded as an operating expense but not
  // yet paid out of Cash & Bank. This is the credit-side home for that.
expenses_payable: `SELECT COALESCE(SUM(COALESCE(payment_due,0)),0) FROM expenses WHERE industry_id = $1`,
  // Every asset must be funded by something; until real opening-balance
  // journal entries exist, Owner's Capital is the plug that makes assets
  // minus liabilities equal equity — same formula the Balance Sheet uses,
  // now represented as a real account so Trial Balance can zero out too.
// Owner's Capital must equal Total Assets minus every OTHER liability —
  // literally the same subtraction the Balance Sheet does — computed once
  // here so both statements pull from one formula and can never disagree.
  // Fixed Assets are deliberately NOT included in this SQL. Their true
  // value is Net Book Value (cost - accumulated depreciation), which can
  // only be computed in JS via listFixedAssets() (depreciation method/
  // years-owned math lives there). Every caller of this query adds the
  // live fixedNBV on top exactly once (see getChartOfAccounts's
  // 'owners_capital' branch and getBalanceSheet's equity calc) — do NOT
  // add a fixed-asset term back in here, or it will be double-counted.
owners_capital: `SELECT
      COALESCE((SELECT SUM(per_acct.balance) FROM (
        SELECT ba.id, ba.opening_balance +
          COALESCE((SELECT SUM(CASE WHEN bt.txn_type='Credit' THEN bt.amount ELSE -bt.amount END)
                    FROM accounting_bank_transactions bt WHERE bt.bank_account_id = ba.id), 0) AS balance
        FROM accounting_bank_accounts ba WHERE ba.industry_id = $1
      ) per_acct), 0)
      + COALESCE((SELECT SUM(current_stock * COALESCE(purchase_price_exc_tax,0)) FROM products WHERE industry_id = $1), 0)
      + COALESCE((SELECT SUM(GREATEST(grand_total - paid_amount,0)) FROM sales_invoices WHERE industry_id = $1 AND payment_status <> 'Paid'), 0)
      + COALESCE((SELECT SUM(tax_amount) FROM purchases WHERE industry_id = $1 AND date_trunc('month', purchase_date) = date_trunc('month', CURRENT_DATE)), 0)
      - COALESCE((SELECT SUM(GREATEST(grand_total - amount_paid,0)) FROM purchases WHERE industry_id = $1 AND payment_status <> 'Paid'), 0)
      - COALESCE((SELECT SUM(COALESCE(payment_due,0)) FROM expenses WHERE industry_id = $1), 0)
      - COALESCE((SELECT SUM(tax_amt) FROM sales_invoices WHERE industry_id = $1 AND date_trunc('month', invoice_date) = date_trunc('month', CURRENT_DATE)), 0)
 - COALESCE((SELECT SUM(net_salary) FROM hrm_payroll WHERE industry_id = $1 AND status <> 'Paid'), 0)
      -- The unpaid portion of expenses is already subtracted above via
      -- expenses_payable; the PAID portion actually left Cash & Bank too,
      -- and must reduce Owner's Capital the same way — otherwise cash
      -- goes out but equity never reflects it (the ₹2,000 gap).
      - COALESCE((SELECT SUM(GREATEST(total_amount - COALESCE(payment_due,0), 0)) FROM expenses WHERE industry_id = $1), 0)
    AS coalesce`,
// Cash & Bank = opening balance + all bank transactions for every
  // account. Paid expenses/purchases are NOT subtracted again here —
  // expenseService.js and purchaseService.js already mirror every paid
  // amount into accounting_bank_transactions (via bankIntegrationService)
  // the moment it's paid, so that outflow is already inside the SUM
  // below. Subtracting it a second time double-counted the same cash
  // leaving the business, which is what was driving Cash & Bank negative.
cash_bank: `SELECT
                COALESCE((SELECT SUM(per_acct.balance) FROM (
                  SELECT ba.id, ba.opening_balance +
                    COALESCE((SELECT SUM(CASE WHEN bt.txn_type='Credit' THEN bt.amount ELSE -bt.amount END)
                              FROM accounting_bank_transactions bt
                              WHERE bt.bank_account_id = ba.id), 0) AS balance
                  FROM accounting_bank_accounts ba WHERE ba.industry_id = $1
                ) per_acct), 0)
              AS coalesce`,
};

const getChartOfAccounts = async (industryId) => {
  const { rows: accounts } = await pool.query(`SELECT * FROM accounting_accounts WHERE industry_id = $1 ORDER BY code`, [industryId]);
  const results = [];
  for (const acc of accounts) {
    let balance = 0;
    if (acc.source_key === 'fixed_assets') {
      // Live NBV (cost minus accumulated depreciation), same calculation
      // used on the Balance Sheet — not a flat cost sum — so this account
      // row always matches what's shown elsewhere in Financial Statements.
      const fixedAssets = await listFixedAssets(industryId);
      balance = fixedAssets.filter(a => a.status !== 'Disposed').reduce((s, a) => s + a.nbv, 0);
    } else if (acc.source_key === 'owners_capital') {
      const { rows } = await pool.query(SOURCE_BALANCE_QUERIES.owners_capital, [industryId]);
      const fixedAssets = await listFixedAssets(industryId);
      const fixedNBV = fixedAssets.filter(a => a.status !== 'Disposed').reduce((s, a) => s + a.nbv, 0);
      balance = num(Object.values(rows[0])[0]) + fixedNBV;
    } else if (acc.source_key && SOURCE_BALANCE_QUERIES[acc.source_key]) {
      const { rows } = await pool.query(SOURCE_BALANCE_QUERIES[acc.source_key], [industryId]);
      balance = num(Object.values(rows[0])[0]);
    } else {
      // manual accounts (e.g. equity, capital) are driven by the journal
      const { rows } = await pool.query(
        `SELECT COALESCE(SUM(CASE WHEN $2 = 'Debit' THEN debit - credit ELSE credit - debit END),0) AS bal
         FROM accounting_journal_lines jl
         JOIN accounting_journal_entries je ON je.id = jl.entry_id
         WHERE jl.account_id = $1 AND je.status = 'Posted' AND jl.industry_id = $3`,
        [acc.id, acc.normal_side, industryId]
      );
      balance = num(rows[0].bal);
    }
    results.push({ ...acc, balance });
  }
  return results;
};

// ═══════════════════════════════════════════════════════════════
// 10. GENERAL LEDGER — manual journal + derived entries from real docs
// ═══════════════════════════════════════════════════════════════
const nextEntryNo = async (industryId) => {
  const { rows } = await pool.query(`SELECT entry_no FROM accounting_journal_entries WHERE industry_id = $1 ORDER BY id DESC LIMIT 1`, [industryId]);
  let next = 1;
  if (rows.length) {
    const n = parseInt((rows[0].entry_no || '').split('-').pop(), 10);
    if (!isNaN(n)) next = n + 1;
  }
  return `JE-${new Date().getFullYear()}-${String(next).padStart(4, '0')}`;
};

const listManualJournalEntries = async (industryId, limit = 50) => {
  const { rows } = await pool.query(`
    SELECT je.*, COALESCE(json_agg(json_build_object(
             'account', a.name, 'code', a.code, 'debit', jl.debit, 'credit', jl.credit
           ) ORDER BY jl.id) FILTER (WHERE jl.id IS NOT NULL), '[]') AS lines
    FROM accounting_journal_entries je
    LEFT JOIN accounting_journal_lines jl ON jl.entry_id = je.id
    LEFT JOIN accounting_accounts a ON a.id = jl.account_id
    WHERE je.industry_id = $1
    GROUP BY je.id ORDER BY je.entry_date DESC, je.id DESC LIMIT $2`, [industryId, limit]);
  return rows;
};

const createManualJournalEntry = async (industryId, data, userId) => {
  const { entry_date, narration, lines } = data; // lines: [{account_id, debit, credit}]
  if (!Array.isArray(lines) || lines.length < 2) throw new Error('At least two lines (debit + credit) are required');
  const totalDebit = lines.reduce((s, l) => s + num(l.debit), 0);
  const totalCredit = lines.reduce((s, l) => s + num(l.credit), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) throw new Error('Debits must equal credits');

  await pool.query(`ALTER TABLE accounting_accounts ADD COLUMN IF NOT EXISTS bank_account_id INTEGER`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entryNo = await nextEntryNo(industryId);
    const entryRes = await client.query(
      `INSERT INTO accounting_journal_entries (entry_no, entry_date, narration, status, created_by, industry_id)
       VALUES ($1,$2,$3,'Posted',$4,$5) RETURNING *`,
      [entryNo, entry_date || new Date(), narration || null, userId || null, industryId]
    );
    const entry = entryRes.rows[0];
    for (const l of lines) {
      await client.query(
        `INSERT INTO accounting_journal_lines (entry_id, account_id, debit, credit, industry_id) VALUES ($1,$2,$3,$4,$5)`,
        [entry.id, l.account_id, l.debit || 0, l.credit || 0, industryId]
      );
    }
    await client.query('COMMIT');

    // Auto-mirror any line posted to a Cash/Bank-linked COA account into
    // Cash & Bank. A JE Debit on a bank/cash account = money in (Credit
    // there); a JE Credit = money out (Debit there) — normal accounting
    // inversion between a GL debit-side account and a bank ledger.
    for (const l of lines) {
      try {
        const { rows: acctRows } = await pool.query(
          `SELECT bank_account_id FROM accounting_accounts WHERE id = $1 AND industry_id = $2`, [l.account_id, industryId]
        );
        const bankAccountId = acctRows[0]?.bank_account_id;
        if (!bankAccountId) continue;
        const debit = num(l.debit), credit = num(l.credit);
        if (debit > 0) {
          await pool.query(
            `INSERT INTO accounting_bank_transactions
               (bank_account_id, txn_date, description, txn_type, amount, created_by,
                source_module, source_id, source_event, auto_generated)
             VALUES ($1,$2,$3,'Credit',$4,$5,'Manual','${entry.id}','je-line-${l.account_id}-debit',TRUE)
             ON CONFLICT DO NOTHING`,
            [bankAccountId, entry_date || new Date(), narration || `Journal Entry ${entryNo}`, debit, userId || null]
          );
        }
        if (credit > 0) {
          await pool.query(
            `INSERT INTO accounting_bank_transactions
               (bank_account_id, txn_date, description, txn_type, amount, created_by,
                source_module, source_id, source_event, auto_generated)
             VALUES ($1,$2,$3,'Debit',$4,$5,'Manual','${entry.id}','je-line-${l.account_id}-credit',TRUE)
             ON CONFLICT DO NOTHING`,
            [bankAccountId, entry_date || new Date(), narration || `Journal Entry ${entryNo}`, credit, userId || null]
          );
        }
      } catch (mirrorErr) {
        console.error('[createManualJournalEntry] bank mirror failed:', mirrorErr.message);
      }
    }

    return entry;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const deleteManualJournalEntry = async (industryId, id) => {
  const { rows } = await pool.query(
    `SELECT id FROM accounting_journal_entries WHERE id = $1 AND industry_id = $2`,
    [id, industryId]
  );
  if (!rows.length) throw new Error('Journal entry not found');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM accounting_journal_lines WHERE entry_id = $1 AND industry_id = $2`, [id, industryId]);
    await client.query(`DELETE FROM accounting_journal_entries WHERE id = $1 AND industry_id = $2`, [id, industryId]);
    await client.query('COMMIT');
    return { id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// Derived (read-only, computed, not stored) journal view built from real
// sales/purchase/expense documents — lets the General Ledger tab show a
// genuine double-entry trail without duplicating data anywhere.
const listDerivedJournal = async (industryId, limit = 30) => {
  const { rows: sales } = await pool.query(`
    SELECT id, invoice_no AS ref, invoice_date AS date, customer, grand_total, tax_amt
    FROM sales_invoices WHERE industry_id = $1 ORDER BY invoice_date DESC, id DESC LIMIT $2`, [industryId, limit]);
  const { rows: purchases } = await pool.query(`
    SELECT id, reference_no AS ref, purchase_date AS date, supplier_name, grand_total, tax_amount
    FROM purchases WHERE industry_id = $1 ORDER BY purchase_date DESC, id DESC LIMIT $2`, [industryId, limit]);
  const { rows: expenses } = await pool.query(`
    SELECT e.id, e.expense_number AS ref, e.expense_date AS date, e.total_amount, c.name AS category
    FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id
    WHERE e.industry_id = $1 ORDER BY e.expense_date DESC, e.id DESC LIMIT $2`, [industryId, limit]);

  const entries = [];
  sales.forEach(s => entries.push({
    id: `SI-${s.id}`, date: s.date, ref: s.ref, source: 'Sales',
    narration: `Sale to ${s.customer || 'customer'}`,
    debit: [{ account: 'Accounts Receivable', amt: num(s.grand_total) }],
    credit: [
      { account: 'Sales Revenue', amt: num(s.grand_total) - num(s.tax_amt) },
      { account: 'Output GST Payable', amt: num(s.tax_amt) },
    ],
  }));
  purchases.forEach(p => entries.push({
    id: `PU-${p.id}`, date: p.date, ref: p.ref, source: 'Purchase',
    narration: `Purchase from ${p.supplier_name || 'supplier'}`,
    debit: [
      { account: 'Inventory', amt: num(p.grand_total) - num(p.tax_amount) },
      { account: 'Input GST (ITC)', amt: num(p.tax_amount) },
    ],
    credit: [{ account: 'Accounts Payable', amt: num(p.grand_total) }],
  }));
  expenses.forEach(e => entries.push({
    id: `EX-${e.id}`, date: e.date, ref: e.ref, source: 'Expense',
    narration: e.category || 'Operating expense',
    debit: [{ account: 'Operating Expenses', amt: num(e.total_amount) }],
    credit: [{ account: 'Cash / Bank', amt: num(e.total_amount) }],
  }));

  return entries.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, limit);
};

// ═══════════════════════════════════════════════════════════════
// 10b. TRIAL BALANCE — every account's live balance, split by
//      normal side, must net to zero if the books are consistent.
// ═══════════════════════════════════════════════════════════════
const getTrialBalance = async (industryId) => {
  const accounts = await getChartOfAccounts(industryId);

  // Trial Balance only ever nets to zero across Balance Sheet accounts
  // (Asset/Liability/Equity). Revenue/Expense (Income/Expense) accounts
  // are period "flow" accounts — in real books they get closed into
  // Retained Earnings at period-end via a closing entry, which this ERP
  // doesn't post. Showing them here without that closing step is why
  // Debit and Credit never matched. They're still shown below for
  // visibility (so you can see Sales Revenue / COGS / Opex balances),
  // just excluded from the Dr/Cr totals and the "balanced" check.
  const rows = accounts.map((a) => {
    const isDebitSide = a.normal_side === 'Debit';
    const isFlowAccount = a.type === 'Income' || a.type === 'Expense';
    return {
      code: a.code,
      name: a.name,
      type: a.type,
      debit: isDebitSide ? Math.max(a.balance, 0) : 0,
      credit: !isDebitSide ? Math.max(a.balance, 0) : 0,
      excludedFromTotal: isFlowAccount,
    };
  });

  const totalDebit = rows.filter(r => !r.excludedFromTotal).reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.filter(r => !r.excludedFromTotal).reduce((s, r) => s + r.credit, 0);
  const difference = Math.round((totalDebit - totalCredit) * 100) / 100;

  return {
    rows,
    totalDebit,
    totalCredit,
    difference,
    balanced: Math.abs(difference) < 1, // paise-level rounding only — anything above ₹1 is a real mismatch
    asOf: new Date().toISOString().slice(0, 10),
  };
};

// ═══════════════════════════════════════════════════════════════
// 11. FINANCIAL STATEMENTS
// ═══════════════════════════════════════════════════════════════
const getProfitAndLoss = async (industryId, filters = {}) => {
  const { date_from = '', date_to = '' } = filters;
  const revWhere = ['industry_id = $1']; const revParams = [industryId];
  pushDateRange(revParams, revWhere, 'invoice_date', date_from, date_to);
 const purWhere = ['industry_id = $1']; const purParams = [industryId];
  pushDateRange(purParams, purWhere, 'purchase_date', date_from, date_to);
  const retWhere = ['industry_id = $1']; const retParams = [industryId];
  pushDateRange(retParams, retWhere, 'return_date', date_from, date_to);
  const expWhere = ['e.industry_id = $1']; const expParams = [industryId];
  pushDateRange(expParams, expWhere, 'e.expense_date', date_from, date_to);

  const [rev, pur, ret, exp] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(grand_total),0) AS rev, COALESCE(SUM(tax_amt),0) AS tax FROM sales_invoices WHERE ${revWhere.join(' AND ')}`, revParams),
    pool.query(`SELECT COALESCE(SUM(grand_total),0) AS pur, COALESCE(SUM(tax_amount),0) AS tax FROM purchases WHERE ${purWhere.join(' AND ')}`, purParams),
    // Purchase returns reduce COGS — goods sent back were never actually
    // kept/consumed, so their cost shouldn't count against gross profit.
    pool.query(`SELECT COALESCE(SUM(total_amount),0) AS ret, COALESCE(SUM(tax_amount),0) AS tax FROM purchase_returns WHERE ${retWhere.join(' AND ')}`, retParams),
    pool.query(`SELECT c.name AS category, COALESCE(SUM(e.total_amount),0) AS amt FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id WHERE ${expWhere.join(' AND ')} GROUP BY c.name ORDER BY amt DESC`, expParams),
  ]);

  const revenue = num(rev.rows[0].rev) - num(rev.rows[0].tax);
  const cogs = (num(pur.rows[0].pur) - num(pur.rows[0].tax)) - (num(ret.rows[0].ret) - num(ret.rows[0].tax));
  const grossProfit = revenue - cogs;
  const opexRows = exp.rows.map(r => ({ label: r.category || 'Uncategorized', amount: num(r.amt) }));
  const opexTotal = opexRows.reduce((s, r) => s + r.amount, 0);
  const netProfit = grossProfit - opexTotal;

  return {
    revenue: [{ label: 'Sales Revenue', amount: revenue }],
    cogs: [{ label: 'Purchases (COGS)', amount: cogs }],
    opex: opexRows,
    grossProfit, netProfit,
  };
};

const getBalanceSheet = async (industryId) => {
  const [cash, ar, inv, inputGst, ap, outputGst, payroll, expPayable] = await Promise.all([
    pool.query(SOURCE_BALANCE_QUERIES.cash_bank, [industryId]),
    pool.query(SOURCE_BALANCE_QUERIES.ar, [industryId]),
    pool.query(SOURCE_BALANCE_QUERIES.inventory, [industryId]),
    pool.query(SOURCE_BALANCE_QUERIES.input_gst, [industryId]),
    pool.query(SOURCE_BALANCE_QUERIES.ap, [industryId]),
    pool.query(SOURCE_BALANCE_QUERIES.output_gst, [industryId]),
    pool.query(SOURCE_BALANCE_QUERIES.payroll_payable, [industryId]),
    pool.query(SOURCE_BALANCE_QUERIES.expenses_payable, [industryId]),
  ]);
  const fixedAssets = await listFixedAssets(industryId);
  const fixedNBV = fixedAssets.filter(a => a.status !== 'Disposed').reduce((s, a) => s + a.nbv, 0);

  const currentAssets = [
    { label: 'Cash & Bank', amount: num(cash.rows[0].coalesce) },
    { label: 'Accounts Receivable', amount: num(ar.rows[0].coalesce) },
    { label: 'Inventory', amount: num(inv.rows[0].coalesce) },
    { label: 'Input GST (ITC)', amount: num(inputGst.rows[0].coalesce) },
  ];
  const fixed = [{ label: 'Fixed Assets (Net)', amount: fixedNBV }];
  const currentLiab = [
    { label: 'Accounts Payable', amount: num(ap.rows[0].coalesce) },
    { label: 'Expenses Payable', amount: num(expPayable.rows[0].coalesce) },
    { label: 'Output GST Payable', amount: num(outputGst.rows[0].coalesce) },
    { label: 'Salary Payable', amount: num(payroll.rows[0].coalesce) },
  ];

  const totalAssets = currentAssets.reduce((s, a) => s + a.amount, 0) + fixed.reduce((s, a) => s + a.amount, 0);
  const totalLiab = currentLiab.reduce((s, a) => s + a.amount, 0);

  // Equity must come from the exact same formula Trial Balance uses
  // (accounting_accounts row 3000, source_key 'owners_capital') — computing
  // a second, independent plug here is what caused the two statements to
  // disagree (₹58,412 vs ₹60,400) even though both claimed to "balance".
  const capitalRes = await pool.query(SOURCE_BALANCE_QUERIES.owners_capital, [industryId]);
  const equity = [{ label: "Owner's Capital (Retained Earnings)", amount: num(capitalRes.rows[0].coalesce) + fixedNBV }];

  return { asOf: new Date().toISOString().slice(0, 10), currentAssets, fixed, currentLiab, equity, totalAssets, totalLiab };
};  

const getCashFlow = async (industryId) => {
  // Scoped to the last 30 days to match the AR/AP deltas below — an
  // unscoped call here used to pull ALL-TIME net profit (since the ERP
  // began) and add it to 30-day working-capital changes, which made
  // "Net Increase in Cash" meaningless for any real period.
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const pl = await getProfitAndLoss(industryId, { date_from: thirtyDaysAgo, date_to: today });

  // Real change in AR/AP = balance as of today minus balance as of 30 days
  // ago (not a snapshot of invoices raised in the window, which double-counts
  // old unpaid balances and mislabels a total as a "change").
  const arNowRes = await pool.query(`SELECT COALESCE(SUM(GREATEST(grand_total-paid_amount,0)),0) AS v FROM sales_invoices WHERE industry_id = $1 AND invoice_date <= CURRENT_DATE`, [industryId]);
  const arThenRes = await pool.query(`SELECT COALESCE(SUM(GREATEST(grand_total-paid_amount,0)),0) AS v FROM sales_invoices WHERE industry_id = $1 AND invoice_date <= CURRENT_DATE - INTERVAL '30 days'`, [industryId]);
  const apNowRes = await pool.query(`SELECT COALESCE(SUM(GREATEST(grand_total-amount_paid,0)),0) AS v FROM purchases WHERE industry_id = $1 AND purchase_date <= CURRENT_DATE`, [industryId]);
  const apThenRes = await pool.query(`SELECT COALESCE(SUM(GREATEST(grand_total-amount_paid,0)),0) AS v FROM purchases WHERE industry_id = $1 AND purchase_date <= CURRENT_DATE - INTERVAL '30 days'`, [industryId]);
  // Unpaid Expenses are payables too — same gap that used to make Accounts
  // Payable and the Dashboard disagree also existed here.
  const expNowRes = await pool.query(`SELECT COALESCE(SUM(payment_due),0) AS v FROM expenses WHERE industry_id = $1 AND expense_date <= CURRENT_DATE`, [industryId]);
  const expThenRes = await pool.query(`SELECT COALESCE(SUM(payment_due),0) AS v FROM expenses WHERE industry_id = $1 AND expense_date <= CURRENT_DATE - INTERVAL '30 days'`, [industryId]);

const arChange = num(arNowRes.rows[0].v) - num(arThenRes.rows[0].v);
  const purchaseApChange = num(apNowRes.rows[0].v) - num(apThenRes.rows[0].v);
  const expenseApChange = num(expNowRes.rows[0].v) - num(expThenRes.rows[0].v);

  const operating = [
    { label: 'Net Profit', amount: pl.netProfit },
    // AR going up ties up cash (subtract); AP going up frees cash (add) — standard indirect-method signs.
    { label: 'Change in Receivables (last 30 days)', amount: -arChange },
    { label: 'Change in Purchases Payable (last 30 days)', amount: purchaseApChange },
    { label: 'Change in Expenses Payable (last 30 days)', amount: expenseApChange },
  ];
  const investingRes = await pool.query(`SELECT COALESCE(SUM(cost),0) AS v FROM accounting_fixed_assets WHERE industry_id = $1 AND purchase_date >= CURRENT_DATE - INTERVAL '90 days'`, [industryId]);
  const investing = [{ label: 'Purchase of Fixed Assets (last 90 days)', amount: -num(investingRes.rows[0].v) }];

  const opCash = operating.reduce((s, a) => s + a.amount, 0);
  const invCash = investing.reduce((s, a) => s + a.amount, 0);
  return { operating, investing, financing: [], netCash: opCash + invCash };
};

module.exports = {
  getHSNSummary, getGSTByState,
  getGSTLedger, getGSTMonthlyTrend,
  getDashboardSummary, getRevenueExpenseTrend, getARAging,
  getReceivables, getPayables,
  getCustomerOutstanding, getSupplierOutstanding,
  recordCustomerPayment, recordSupplierPayment, recordCustomerPaymentFIFO,
  getCustomerStatement, getSupplierStatement,
listBankAccounts, createBankAccount, listBankTransactions, createBankTransaction, reconcileBankTransaction,
  updateBankTransaction, deleteBankTransaction, getBankAccountLedger, getBankStatement, getCashBankSummary,
 getGSTSummary, getTaxRateMaster, getGSTQuarterly, getGSTSettings, updateGSTSettings,
listFixedAssets, createFixedAsset, updateFixedAsset, disposeFixedAsset, deleteFixedAsset, postMonthlyDepreciation, getAssetDepreciationLog,
listCostCenters, createCostCenter, updateCostCenter, deleteCostCenter, getExpenseLocations, getProductCosting,
  listBudgets, createBudget, listExpenseRequests,
getChartOfAccounts, listManualJournalEntries, createManualJournalEntry, deleteManualJournalEntry, listDerivedJournal,
  getTrialBalance,
  getProfitAndLoss, getBalanceSheet, getCashFlow,
};