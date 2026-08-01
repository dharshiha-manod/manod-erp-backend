/**
 * ====================================================
 * services/hrmService.js
 * All database queries for the HRM module.
 * Uses the same pool pattern as purchaseService.js
 * ====================================================
 */
const pool = require('../config/database');
const { types } = require('pg');
const bankIntegrationService = require('./bankIntegrationService');
const { logAudit } = require('./auditLogService');
const notificationService = require('./notificationService');
const salesTargetsService = require('./salesTargetsService');

// Prevent node-postgres from converting DATE columns into JS Date objects.
// JS Date objects are timezone-sensitive and can silently shift the
// calendar day backward/forward depending on the server's local timezone.
// Keeping raw 'YYYY-MM-DD' strings avoids that entirely.
types.setTypeParser(1082, (val) => val);

// ── SELF-HEALING SCHEMA (adds missing payroll_group_id columns) ──
// NEW
let hrmSchemaReady = false;

// Seeds the 7 default leave types from the company policy spec, exactly
// once. Uses WHERE NOT EXISTS keyed on name/leave_code so it's safe to
// call on every boot without ever creating duplicates.
async function seedDefaultLeaveTypes() {
  const defaults = [
    { name: 'Casual Leave',      leave_code: 'CL',  description: 'Short-notice personal leave for everyday needs.',
      max_count: 12, is_paid: true,  carry_forward: false, max_carry_forward_days: 0,
      requires_document: false, min_days_requiring_attachment: 0, allow_half_day: true,
      allow_negative_balance: false, affects_payroll: false, count_as_present: true,  count_as_absent: false },
    { name: 'Sick Leave',        leave_code: 'SL',  description: 'Leave for illness or medical needs. A supporting medical document may be required per company policy.',
      max_count: 12, is_paid: true,  carry_forward: false, max_carry_forward_days: 0,
      requires_document: true,  min_days_requiring_attachment: 3, allow_half_day: true,
      allow_negative_balance: false, affects_payroll: false, count_as_present: true,  count_as_absent: false },
    { name: 'Earned Leave',      leave_code: 'EL',  description: 'Accrued annual leave that can be carried forward.',
      max_count: 15, is_paid: true,  carry_forward: true,  max_carry_forward_days: 15,
      requires_document: false, min_days_requiring_attachment: 0, allow_half_day: true,
      allow_negative_balance: false, affects_payroll: false, count_as_present: true,  count_as_absent: false },
    { name: 'Comp Off',          leave_code: 'CO',  description: 'Compensatory leave earned for working on an off-day/holiday.',
      max_count: 0,  is_paid: true,  carry_forward: false, max_carry_forward_days: 0,
      requires_document: false, min_days_requiring_attachment: 0, allow_half_day: true,
      allow_negative_balance: false, affects_payroll: false, count_as_present: true,  count_as_absent: false },
    { name: 'Maternity Leave',   leave_code: 'ML',  description: 'Leave for childbirth and postnatal care, per company/legal policy.',
      max_count: 0,  is_paid: true,  carry_forward: false, max_carry_forward_days: 0,
      requires_document: true,  min_days_requiring_attachment: 0, allow_half_day: false,
      allow_negative_balance: false, affects_payroll: false, count_as_present: true,  count_as_absent: false },
    { name: 'Paternity Leave',   leave_code: 'PL',  description: 'Leave for a new father around childbirth, per company/legal policy.',
      max_count: 0,  is_paid: true,  carry_forward: false, max_carry_forward_days: 0,
      requires_document: false, min_days_requiring_attachment: 0, allow_half_day: false,
      allow_negative_balance: false, affects_payroll: false, count_as_present: true,  count_as_absent: false },
    { name: 'Leave Without Pay', leave_code: 'LOP', description: 'Unpaid leave, typically used once other leave balances are exhausted.',
      max_count: 0,  is_paid: false, carry_forward: false, max_carry_forward_days: 0,
      requires_document: false, min_days_requiring_attachment: 0, allow_half_day: true,
      allow_negative_balance: true,  affects_payroll: true,  count_as_present: false, count_as_absent: true },
  ];

  for (const d of defaults) {
    await pool.query(
      `INSERT INTO hrm_leave_types
         (name, leave_code, description, max_count, interval, is_paid,
          monthly_accrual, carry_forward, max_carry_forward_days,
          requires_approval, requires_document, min_days_requiring_attachment,
          allow_half_day, allow_negative_balance, deduct_from_balance,
          affects_payroll, count_as_present, count_as_absent, active)
       SELECT $1,$2,$3,$4,'None',$5,
              0,$6,$7,
              TRUE,$8,$9,
              $10,$11,TRUE,
              $12,$13,$14,TRUE
       WHERE NOT EXISTS (
         SELECT 1 FROM hrm_leave_types WHERE name = $1 OR (leave_code IS NOT NULL AND leave_code = $2)
       )`,
      [
        d.name, d.leave_code, d.description, d.max_count, d.is_paid,
        d.carry_forward, d.max_carry_forward_days,
        d.requires_document, d.min_days_requiring_attachment,
        d.allow_half_day, d.allow_negative_balance,
        d.affects_payroll, d.count_as_present, d.count_as_absent,
      ]
    );
  }
}

// NEW
async function ensureHrmSchema() {
  if (hrmSchemaReady) return;
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS payroll_group_id INTEGER REFERENCES hrm_payroll_groups(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE hrm_employees ADD COLUMN IF NOT EXISTS payroll_group_id INTEGER REFERENCES hrm_payroll_groups(id) ON DELETE SET NULL;`);
    // Enable Login feature — links a non-login hrm_employees row to the
    // users row created for it, and back again, so we can tell who's converted.
    await pool.query(`ALTER TABLE hrm_employees ADD COLUMN IF NOT EXISTS linked_user_id UUID REFERENCES users(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS linked_employee_id INTEGER REFERENCES hrm_employees(id) ON DELETE SET NULL;`);
// Leave notifications — employee_seen already exists in prod DB; kept here so fresh DBs self-heal too.
    await pool.query(`ALTER TABLE hrm_leaves ADD COLUMN IF NOT EXISTS employee_seen BOOLEAN DEFAULT TRUE;`);
    await pool.query(`ALTER TABLE hrm_leaves ADD COLUMN IF NOT EXISTS approver_name VARCHAR(255);`);
    await pool.query(`ALTER TABLE hrm_leaves ADD COLUMN IF NOT EXISTS approver_remarks TEXT;`);
    // Paid vs unpaid leave types, for payroll LOP calculation.
 // NEW
    // Paid vs unpaid leave types, for payroll LOP calculation.
    await pool.query(`ALTER TABLE hrm_leave_types ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT TRUE;`);
    // Leave Type master enhancement — additive columns only, all default
    // to values that preserve today's behavior (paid leave, present,
    // no accrual/carry-forward, approval required). Existing rows and
    // existing payroll/attendance logic keep working unchanged.
    await pool.query(`ALTER TABLE hrm_leave_types ADD COLUMN IF NOT EXISTS leave_code VARCHAR(10);`);
    await pool.query(`ALTER TABLE hrm_leave_types ADD COLUMN IF NOT EXISTS description TEXT;`);
    await pool.query(`ALTER TABLE hrm_leave_types ADD COLUMN IF NOT EXISTS monthly_accrual NUMERIC(5,2) DEFAULT 0;`);
    await pool.query(`ALTER TABLE hrm_leave_types ADD COLUMN IF NOT EXISTS carry_forward BOOLEAN DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE hrm_leave_types ADD COLUMN IF NOT EXISTS max_carry_forward_days INTEGER DEFAULT 0;`);
    await pool.query(`ALTER TABLE hrm_leave_types ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN DEFAULT TRUE;`);
    await pool.query(`ALTER TABLE hrm_leave_types ADD COLUMN IF NOT EXISTS requires_document BOOLEAN DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE hrm_leave_types ADD COLUMN IF NOT EXISTS min_days_requiring_attachment INTEGER DEFAULT 0;`);
    await pool.query(`ALTER TABLE hrm_leave_types ADD COLUMN IF NOT EXISTS allow_half_day BOOLEAN DEFAULT TRUE;`);
    await pool.query(`ALTER TABLE hrm_leave_types ADD COLUMN IF NOT EXISTS allow_negative_balance BOOLEAN DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE hrm_leave_types ADD COLUMN IF NOT EXISTS deduct_from_balance BOOLEAN DEFAULT TRUE;`);
    // affects_payroll is the new explicit driver for LOP deduction.
    // Backfilled from is_paid so existing types keep behaving exactly
    // as before (Paid=TRUE -> affects_payroll=FALSE, i.e. no deduction).
    await pool.query(`ALTER TABLE hrm_leave_types ADD COLUMN IF NOT EXISTS affects_payroll BOOLEAN;`);
    await pool.query(`UPDATE hrm_leave_types SET affects_payroll = NOT is_paid WHERE affects_payroll IS NULL;`);
    await pool.query(`ALTER TABLE hrm_leave_types ALTER COLUMN affects_payroll SET DEFAULT FALSE;`);
   await pool.query(`ALTER TABLE hrm_leave_types ADD COLUMN IF NOT EXISTS count_as_present BOOLEAN DEFAULT TRUE;`);
    await pool.query(`ALTER TABLE hrm_leave_types ADD COLUMN IF NOT EXISTS count_as_absent BOOLEAN DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE hrm_leave_types ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;`);
    // Holiday module enhancement — additive columns only, all default to
    // values that preserve today's behavior (no type/active filtering
    // existed before, so existing rows just become type=NULL, active=TRUE).
    await pool.query(`ALTER TABLE hrm_holidays ADD COLUMN IF NOT EXISTS holiday_type VARCHAR(30) DEFAULT 'Company Holiday';`);
    await pool.query(`ALTER TABLE hrm_holidays ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;`);
    // Sales Target module enhancement — additive, multi-metric columns.
    await pool.query(`ALTER TABLE hrm_sales_targets ADD COLUMN IF NOT EXISTS order_target INTEGER DEFAULT 0;`);
    await pool.query(`ALTER TABLE hrm_sales_targets ADD COLUMN IF NOT EXISTS order_achieved INTEGER DEFAULT 0;`);
    await pool.query(`ALTER TABLE hrm_sales_targets ADD COLUMN IF NOT EXISTS customer_target INTEGER DEFAULT 0;`);
    await pool.query(`ALTER TABLE hrm_sales_targets ADD COLUMN IF NOT EXISTS customer_achieved INTEGER DEFAULT 0;`);
    await pool.query(`ALTER TABLE hrm_sales_targets ADD COLUMN IF NOT EXISTS collection_target NUMERIC(14,2) DEFAULT 0;`);
    await pool.query(`ALTER TABLE hrm_sales_targets ADD COLUMN IF NOT EXISTS collection_achieved NUMERIC(14,2) DEFAULT 0;`);
    await pool.query(`ALTER TABLE hrm_sales_targets ADD COLUMN IF NOT EXISTS remarks TEXT;`);
    await pool.query(`ALTER TABLE hrm_sales_targets ADD COLUMN IF NOT EXISTS employee_id VARCHAR(255);`);
    await pool.query(`ALTER TABLE hrm_sales_targets ADD COLUMN IF NOT EXISTS employee_source VARCHAR(20) DEFAULT 'user';`);
    // ── SHARED NOTIFICATIONS TABLE ──────────────────────────────
    // One centralized table for every module's in-app bell (Leave,
    // Holiday, Sales Target, Attendance, Payroll, Approvals, ...).
    // Existing hrm_leaves.employee_seen mechanism is untouched and
    // keeps working exactly as before — this is purely additive.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hrm_notifications (
        id               SERIAL PRIMARY KEY,
        recipient_id     VARCHAR(255) NOT NULL,
        recipient_source VARCHAR(20)  DEFAULT 'user',
        module           VARCHAR(50)  NOT NULL,
        event_type       VARCHAR(50)  NOT NULL,
        title            TEXT NOT NULL,
        message          TEXT,
        record_id        INTEGER,
        seen             BOOLEAN DEFAULT FALSE,
        created_at       TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_hrm_notifications_recipient ON hrm_notifications(recipient_id, recipient_source, seen);`);
    await seedDefaultLeaveTypes();
    hrmSchemaReady = true;
  } catch (err) {
    console.error('hrm schema migration warning:', err.message);
    hrmSchemaReady = true;
  }
}

// ── AUTO REF GENERATORS ──────────────────────────────────────

async function nextLeaveRef() {
  const { rows } = await pool.query(
    `SELECT reference_no FROM hrm_leaves ORDER BY id DESC LIMIT 1`
  );
  if (!rows.length) return 'LEV-2026-001';
  const last = parseInt(rows[0].reference_no.replace('LEV-2026-', '')) || 0;
  return `LEV-2026-${String(last + 1).padStart(3, '0')}`;
}

async function nextPayrollRef() {
  const { rows } = await pool.query(
    `SELECT reference_no FROM hrm_payroll ORDER BY id DESC LIMIT 1`
  );
  if (!rows.length) return 'PAY-2026-001';
  const last = parseInt(rows[0].reference_no.replace('PAY-2026-', '')) || 0;
  return `PAY-2026-${String(last + 1).padStart(3, '0')}`;
}

// ── DEPARTMENTS ──────────────────────────────────────────────

async function fetchDepartments() {
  const { rows } = await pool.query(
    `SELECT id, dept_code, name, description, created_at FROM hrm_departments ORDER BY id`
  );
  return rows;
}

async function createDepartment({ name, description }, userId, userName) {
  if (!name) throw new Error('Department name is required');
  const code = 'DEPT-' + name.slice(0, 4).toUpperCase().replace(/\s/g, '');
  const { rows } = await pool.query(
    `INSERT INTO hrm_departments (dept_code, name, description)
     VALUES ($1, $2, $3) RETURNING *`,
    [code, name, description || null]
  );
  const dept = rows[0];
  logAudit({ userId, userName, module: 'HRM Departments', action: 'CREATE', recordId: dept.id, recordLabel: dept.name, oldData: null, newData: dept }).catch(() => {});
  return dept;
}

async function updateDepartment(id, { name, description, dept_code }, userId, userName) {
  const existing = await pool.query(`SELECT * FROM hrm_departments WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Department not found');
  const oldData = existing.rows[0];

  const { rows } = await pool.query(
    `UPDATE hrm_departments SET name=$1, description=$2, dept_code=COALESCE($3, dept_code), updated_at=NOW()
     WHERE id=$4 RETURNING *`,
    [name, description, dept_code || null, id]
  );
  if (!rows.length) throw new Error('Department not found');
  const dept = rows[0];
  logAudit({ userId, userName, module: 'HRM Departments', action: 'UPDATE', recordId: id, recordLabel: dept.name, oldData, newData: dept }).catch(() => {});
  return dept;
}

async function deleteDepartment(id, userId, userName) {
  const existing = await pool.query(`SELECT * FROM hrm_departments WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Department not found');
  const oldData = existing.rows[0];
  await pool.query(`DELETE FROM hrm_departments WHERE id=$1`, [id]);
  logAudit({ userId, userName, module: 'HRM Departments', action: 'DELETE', recordId: id, recordLabel: oldData.name, oldData, newData: null }).catch(() => {});
}

// ── DESIGNATIONS ─────────────────────────────────────────────

async function fetchDesignations() {
  const { rows } = await pool.query(
    `SELECT id, name, description, created_at FROM hrm_designations ORDER BY id`
  );
  return rows;
}

async function createDesignation({ name, description }, userId, userName) {
  if (!name) throw new Error('Designation name is required');
  const { rows } = await pool.query(
    `INSERT INTO hrm_designations (name, description)
     VALUES ($1, $2) RETURNING *`,
    [name, description || null]
  );
  const desig = rows[0];
  logAudit({ userId, userName, module: 'HRM Designations', action: 'CREATE', recordId: desig.id, recordLabel: desig.name, oldData: null, newData: desig }).catch(() => {});
  return desig;
}

async function updateDesignation(id, { name, description }, userId, userName) {
  const existing = await pool.query(`SELECT * FROM hrm_designations WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Designation not found');
  const oldData = existing.rows[0];

  const { rows } = await pool.query(
    `UPDATE hrm_designations SET name=$1, description=$2, updated_at=NOW()
     WHERE id=$3 RETURNING *`,
    [name, description, id]
  );
  if (!rows.length) throw new Error('Designation not found');
  const desig = rows[0];
  logAudit({ userId, userName, module: 'HRM Designations', action: 'UPDATE', recordId: id, recordLabel: desig.name, oldData, newData: desig }).catch(() => {});
  return desig;
}

async function deleteDesignation(id, userId, userName) {
  const existing = await pool.query(`SELECT * FROM hrm_designations WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Designation not found');
  const oldData = existing.rows[0];
  await pool.query(`DELETE FROM hrm_designations WHERE id=$1`, [id]);
  logAudit({ userId, userName, module: 'HRM Designations', action: 'DELETE', recordId: id, recordLabel: oldData.name, oldData, newData: null }).catch(() => {});
}

// ── LEAVE TYPES ──────────────────────────────────────────────

// NEW
async function fetchLeaveTypes() {
  await ensureHrmSchema();
  const { rows } = await pool.query(
    `SELECT id, name, leave_code, description, max_count, interval,
            COALESCE(is_paid, TRUE) AS is_paid,
            COALESCE(monthly_accrual, 0) AS monthly_accrual,
            COALESCE(carry_forward, FALSE) AS carry_forward,
            COALESCE(max_carry_forward_days, 0) AS max_carry_forward_days,
            COALESCE(requires_approval, TRUE) AS requires_approval,
            COALESCE(requires_document, FALSE) AS requires_document,
            COALESCE(min_days_requiring_attachment, 0) AS min_days_requiring_attachment,
            COALESCE(allow_half_day, TRUE) AS allow_half_day,
            COALESCE(allow_negative_balance, FALSE) AS allow_negative_balance,
            COALESCE(deduct_from_balance, TRUE) AS deduct_from_balance,
            COALESCE(affects_payroll, NOT COALESCE(is_paid, TRUE)) AS affects_payroll,
            COALESCE(count_as_present, TRUE) AS count_as_present,
            COALESCE(count_as_absent, FALSE) AS count_as_absent,
            COALESCE(active, TRUE) AS active,
            created_at
     FROM hrm_leave_types ORDER BY id`
  );
  return rows;
}

async function createLeaveType(body, userId, userName) {
  await ensureHrmSchema();
  const {
    name, leave_code, description, max_count, interval, is_paid,
    monthly_accrual, carry_forward, max_carry_forward_days,
    requires_approval, requires_document, min_days_requiring_attachment,
    allow_half_day, allow_negative_balance, deduct_from_balance,
    affects_payroll, count_as_present, count_as_absent, active,
  } = body;
  if (!name) throw new Error('Leave type name is required');
  const paid = is_paid === undefined ? true : !!is_paid;
  const { rows } = await pool.query(
    `INSERT INTO hrm_leave_types
       (name, leave_code, description, max_count, interval, is_paid,
        monthly_accrual, carry_forward, max_carry_forward_days,
        requires_approval, requires_document, min_days_requiring_attachment,
        allow_half_day, allow_negative_balance, deduct_from_balance,
        affects_payroll, count_as_present, count_as_absent, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING *`,
    [
      name, leave_code || null, description || null, max_count || 0, interval || 'None', paid,
      monthly_accrual || 0, !!carry_forward, max_carry_forward_days || 0,
      requires_approval === undefined ? true : !!requires_approval,
      !!requires_document, min_days_requiring_attachment || 0,
      allow_half_day === undefined ? true : !!allow_half_day,
      !!allow_negative_balance,
      deduct_from_balance === undefined ? true : !!deduct_from_balance,
      affects_payroll === undefined ? !paid : !!affects_payroll,
      count_as_present === undefined ? true : !!count_as_present,
      !!count_as_absent,
      active === undefined ? true : !!active,
    ]
  );
  const lt = rows[0];
  logAudit({ userId, userName, module: 'HRM Leave Types', action: 'CREATE', recordId: lt.id, recordLabel: lt.name, oldData: null, newData: lt }).catch(() => {});
  return lt;
}

async function updateLeaveType(id, body, userId, userName) {
  await ensureHrmSchema();
  const existing = await pool.query(`SELECT * FROM hrm_leave_types WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Leave type not found');
  const oldData = existing.rows[0];
  const {
    name, leave_code, description, max_count, interval, is_paid,
    monthly_accrual, carry_forward, max_carry_forward_days,
    requires_approval, requires_document, min_days_requiring_attachment,
    allow_half_day, allow_negative_balance, deduct_from_balance,
    affects_payroll, count_as_present, count_as_absent, active,
  } = body;

  const { rows } = await pool.query(
    `UPDATE hrm_leave_types SET
       name=$1, leave_code=$2, description=$3, max_count=$4, interval=$5,
       is_paid = COALESCE($6, is_paid),
       monthly_accrual=$7, carry_forward=$8, max_carry_forward_days=$9,
       requires_approval=$10, requires_document=$11, min_days_requiring_attachment=$12,
       allow_half_day=$13, allow_negative_balance=$14, deduct_from_balance=$15,
       affects_payroll=$16, count_as_present=$17, count_as_absent=$18, active=$19,
       updated_at=NOW()
     WHERE id=$20 RETURNING *`,
    [
      name, leave_code || null, description || null, max_count, interval,
      is_paid === undefined ? null : !!is_paid,
      monthly_accrual || 0, !!carry_forward, max_carry_forward_days || 0,
      requires_approval === undefined ? true : !!requires_approval,
      !!requires_document, min_days_requiring_attachment || 0,
      allow_half_day === undefined ? true : !!allow_half_day,
      !!allow_negative_balance,
      deduct_from_balance === undefined ? true : !!deduct_from_balance,
      affects_payroll === undefined ? !is_paid : !!affects_payroll,
      count_as_present === undefined ? true : !!count_as_present,
      !!count_as_absent,
      active === undefined ? true : !!active,
      id,
    ]
  );
// NEW — nothing. Just delete it. The first updateLeaveType (right above it,
// which already updates all 19 fields) is what remains and now actually runs.
  if (!rows.length) throw new Error('Leave type not found');
  const lt = rows[0];
  logAudit({ userId, userName, module: 'HRM Leave Types', action: 'UPDATE', recordId: id, recordLabel: lt.name, oldData, newData: lt }).catch(() => {});
  return lt;
}

async function deleteLeaveType(id, userId, userName) {
  const existing = await pool.query(`SELECT * FROM hrm_leave_types WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Leave type not found');
  const oldData = existing.rows[0];
  await pool.query(`DELETE FROM hrm_leave_types WHERE id=$1`, [id]);
  logAudit({ userId, userName, module: 'HRM Leave Types', action: 'DELETE', recordId: id, recordLabel: oldData.name, oldData, newData: null }).catch(() => {});
}

// ── LEAVES ───────────────────────────────────────────────────

async function fetchLeaves({ status = '', employee = '', date_from = '', date_to = '' } = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (status)    { conditions.push(`status = $${idx++}`);       values.push(status); }
  if (employee)  { conditions.push(`employee_name ILIKE $${idx++}`); values.push(`%${employee}%`); }
  if (date_from) { conditions.push(`start_date >= $${idx++}`);  values.push(date_from); }
  if (date_to)   { conditions.push(`end_date <= $${idx++}`);    values.push(date_to); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM hrm_leaves ${where} ORDER BY id DESC`, values
  );
  return rows;
}

async function createLeave({ leave_type_id, leave_type_name, employee_name, start_date, end_date, reason }, createdBy, userName) {
  if (!employee_name || !start_date || !end_date)
    throw new Error('Employee, start date and end date are required');

  const ref = await nextLeaveRef();
  const { rows } = await pool.query(
    `INSERT INTO hrm_leaves
       (reference_no, leave_type_id, leave_type_name, employee_name, start_date, end_date, reason, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'Pending',$8) RETURNING *`,
    [ref, leave_type_id || null, leave_type_name || '', employee_name, start_date, end_date, reason || '', createdBy || null]
  );
  const leave = rows[0];
  logAudit({ userId: createdBy, userName, module: 'HRM Leaves', action: 'CREATE', recordId: leave.id, recordLabel: leave.reference_no, oldData: null, newData: leave }).catch(() => {});
  return leave;
}

async function updateLeaveStatus(id, status, userId, userName, remarks) {
  await ensureHrmSchema();
  const allowed = ['Pending', 'Approved', 'Rejected'];
  if (!allowed.includes(status)) throw new Error('Invalid status');
  const existing = await pool.query(`SELECT * FROM hrm_leaves WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Leave not found');
  const oldData = existing.rows[0];

  // employee_seen resets to FALSE only when HR actually resolves the
  // request (Approved/Rejected) — that's what triggers the "you have
  // an update" badge in My Space. Re-marking Pending doesn't notify.
  // approver_name is stamped only on Approved/Rejected too, so it always
  // reflects who actually made the decision (not who last edited it).
const { rows } = await pool.query(
    `UPDATE hrm_leaves
     SET status=$1::varchar, approver_remarks=COALESCE($2, approver_remarks),
         approver_name = CASE WHEN $1::varchar IN ('Approved','Rejected') THEN $4 ELSE approver_name END,
         employee_seen = CASE WHEN $1::varchar IN ('Approved','Rejected') THEN FALSE ELSE employee_seen END,
         updated_at=NOW()
     WHERE id=$3 RETURNING *`,
    [status, remarks || null, id, userName || null]
  );
 // NEW
  if (!rows.length) throw new Error('Leave not found');
  const leave = rows[0];
  logAudit({ userId, userName, module: 'HRM Leaves', action: 'UPDATE', recordId: id, recordLabel: leave.reference_no, oldData, newData: leave }).catch(() => {});
  syncAttendanceForLeave(leave).catch(e => console.error('attendance sync warning:', e.message));
  return leave;
}
async function updateLeave(id, data, userId, userName) {
  const { leave_type_name, employee_name, start_date, end_date, reason, status } = data;
  const existing = await pool.query(`SELECT * FROM hrm_leaves WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Leave not found');
  const oldData = existing.rows[0];

  const { rows } = await pool.query(
    `UPDATE hrm_leaves
     SET leave_type_name=$1, employee_name=$2, start_date=$3, end_date=$4, reason=$5, status=$6, updated_at=NOW()
     WHERE id=$7 RETURNING *`,
    [leave_type_name, employee_name, start_date, end_date, reason, status, id]
  );
  if (!rows.length) throw new Error('Leave not found');
  const leave = rows[0];
  logAudit({ userId, userName, module: 'HRM Leaves', action: 'UPDATE', recordId: id, recordLabel: leave.reference_no, oldData, newData: leave }).catch(() => {});
  return leave;
}

async function deleteLeave(id, userId, userName) {
  const existing = await pool.query(`SELECT * FROM hrm_leaves WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Leave not found');
  const oldData = existing.rows[0];
  await pool.query(`DELETE FROM hrm_leaves WHERE id=$1`, [id]);
  logAudit({ userId, userName, module: 'HRM Leaves', action: 'DELETE', recordId: id, recordLabel: oldData.reference_no, oldData, newData: null }).catch(() => {});
}

// ── SHIFTS ───────────────────────────────────────────────────

async function fetchShifts() {
  const { rows } = await pool.query(
    `SELECT id, name, shift_type, start_time, end_time, holiday_day FROM hrm_shifts ORDER BY id`
  );
  return rows;
}

async function createShift({ name, shift_type, start_time, end_time, holiday_day }, userId, userName) {
  if (!name || !start_time || !end_time) throw new Error('Name, start time and end time are required');
  const { rows } = await pool.query(
    `INSERT INTO hrm_shifts (name, shift_type, start_time, end_time, holiday_day)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [name, shift_type || 'Fixed shift', start_time, end_time, holiday_day || null]
  );
  const shift = rows[0];
  logAudit({ userId, userName, module: 'HRM Shifts', action: 'CREATE', recordId: shift.id, recordLabel: shift.name, oldData: null, newData: shift }).catch(() => {});
  return shift;
}

async function updateShift(id, data, userId, userName) {
  const { name, shift_type, start_time, end_time, holiday_day } = data;
  const existing = await pool.query(`SELECT * FROM hrm_shifts WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Shift not found');
  const oldData = existing.rows[0];

  const { rows } = await pool.query(
    `UPDATE hrm_shifts SET name=$1, shift_type=$2, start_time=$3, end_time=$4, holiday_day=$5, updated_at=NOW()
     WHERE id=$6 RETURNING *`,
    [name, shift_type, start_time, end_time, holiday_day, id]
  );
  if (!rows.length) throw new Error('Shift not found');
  const shift = rows[0];
  logAudit({ userId, userName, module: 'HRM Shifts', action: 'UPDATE', recordId: id, recordLabel: shift.name, oldData, newData: shift }).catch(() => {});
  return shift;
}

async function deleteShift(id, userId, userName) {
  const existing = await pool.query(`SELECT * FROM hrm_shifts WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Shift not found');
  const oldData = existing.rows[0];
  await pool.query(`DELETE FROM hrm_shifts WHERE id=$1`, [id]);
  logAudit({ userId, userName, module: 'HRM Shifts', action: 'DELETE', recordId: id, recordLabel: oldData.name, oldData, newData: null }).catch(() => {});
}

// ── ATTENDANCE ───────────────────────────────────────────────

async function fetchAttendance({ date_from, date_to, employee, status, date_filter } = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  const today = new Date().toISOString().split('T')[0];

  // Resolve quick filter to actual date range
  if (date_filter && date_filter !== 'All' && date_filter !== 'Custom') {
    const now = new Date();
    let from, to;
    if (date_filter === 'Today') {
      from = to = today;
    } else if (date_filter === 'Yesterday') {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      from = to = y.toISOString().split('T')[0];
    } else if (date_filter === 'This Week') {
      const day = now.getDay();
      const mon = new Date(now); mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      from = mon.toISOString().split('T')[0]; to = today;
    } else if (date_filter === 'This Month') {
      from = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
      to = today;
    } else if (date_filter === 'Last Month') {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const le = new Date(now.getFullYear(), now.getMonth(), 0);
      from = lm.toISOString().split('T')[0];
      to   = le.toISOString().split('T')[0];
    }
    if (from) {
      conditions.push(`attendance_date >= $${idx++}`); values.push(from);
      conditions.push(`attendance_date <= $${idx++}`); values.push(to);
    }
  } else {
    if (date_from) { conditions.push(`attendance_date >= $${idx++}`); values.push(date_from); }
    if (date_to)   { conditions.push(`attendance_date <= $${idx++}`); values.push(date_to); }
    if (!date_from && !date_to && (!date_filter || date_filter === 'Today')) {
      // Default: today
      conditions.push(`attendance_date = $${idx++}`); values.push(today);
    }
  }

  if (employee && employee !== 'All') {
    conditions.push(`employee_name = $${idx++}`); values.push(employee);
  }
  if (status && status !== 'All') {
    conditions.push(`status = $${idx++}`); values.push(status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM hrm_attendance ${where} ORDER BY attendance_date DESC, id DESC`, values
  );
  return rows;
}

// NEW
async function computeAttendanceStatus(nowHHMM) {
  const { rows } = await pool.query(
    `SELECT work_start_time, late_grace_minutes FROM hrm_settings WHERE id = 1`
  );
  const row = rows[0] || {};
  const startTime = row.work_start_time || '09:00';
  const graceMin  = Number.isFinite(Number(row.late_grace_minutes)) ? Number(row.late_grace_minutes) : 15;

  const [sh, sm] = String(startTime).slice(0, 5).split(':').map(Number);
  const graceDate = new Date(0, 0, 0, sh, sm + graceMin);
  const graceThreshold = `${String(graceDate.getHours()).padStart(2, '0')}:${String(graceDate.getMinutes()).padStart(2, '0')}`;

  return nowHHMM > graceThreshold ? 'Late' : 'Present';
}

async function clockIn({ employee_name, employee_id, department, note }, createdBy, userName) {
  const today = new Date().toISOString().split('T')[0];
  const now   = new Date().toTimeString().slice(0, 5);

  const status = await computeAttendanceStatus(now);

  const { rows } = await pool.query(
    `INSERT INTO hrm_attendance (employee_name, employee_id, attendance_date, clock_in, status, department, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (employee_name, attendance_date)
     DO UPDATE SET clock_in=$4, status=$5, note=$7, updated_at=NOW()
     RETURNING *`,
    [employee_name || 'Admin', employee_id || null, today, now, status, department || 'Admin', note || '']
  );
  const rec = rows[0];
  logAudit({ userId: createdBy, userName, module: 'HRM Attendance', action: 'CREATE', recordId: rec.id, recordLabel: rec.employee_name, oldData: null, newData: rec }).catch(() => {});
  return rec;
}
async function clockOut(id, userId, userName) {
  const existing = await pool.query(`SELECT * FROM hrm_attendance WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Attendance record not found');
  const oldData = existing.rows[0];

  const now = new Date().toTimeString().slice(0, 5);
  const { rows } = await pool.query(
    `UPDATE hrm_attendance SET clock_out=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
    [now, id]
  );
  if (!rows.length) throw new Error('Attendance record not found');
  const rec = rows[0];
  logAudit({ userId, userName, module: 'HRM Attendance', action: 'UPDATE', recordId: id, recordLabel: rec.employee_name, oldData, newData: rec }).catch(() => {});
  return rec;
}

async function fetchAttendanceStats() {
  const today = new Date().toISOString().split('T')[0];
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status='Present') AS present,
       COUNT(*) FILTER (WHERE status='Late')    AS late,
       COUNT(*) FILTER (WHERE status='Absent')  AS absent,
       COUNT(*) FILTER (WHERE status='On Leave') AS on_leave
     FROM hrm_attendance
     WHERE attendance_date = $1`,
    [today]
  );
  return rows[0];
}

async function createAttendanceRecord({ employee_name, employee_id, attendance_date, clock_in, clock_out, status, department, note, shift_name }, userId, userName) {
  if (!employee_name || !attendance_date || !status) throw new Error('Employee, date and status are required');

  const existing = await pool.query(
    `SELECT id FROM hrm_attendance WHERE employee_name = $1 AND attendance_date = $2`,
    [employee_name, attendance_date]
  );

  let rec;
  if (existing.rows.length) {
    const { rows } = await pool.query(
      `UPDATE hrm_attendance
         SET clock_in=$1, clock_out=$2, status=$3, department=$4, note=$5, shift_name=$6, updated_at=NOW()
       WHERE id=$7
       RETURNING *`,
      [clock_in || null, clock_out || null, status, department || null, note || '', shift_name || null, existing.rows[0].id]
    );
    rec = rows[0];
    logAudit({ userId, userName, module: 'HRM Attendance', action: 'UPDATE', recordId: rec.id, recordLabel: rec.employee_name, oldData: null, newData: rec }).catch(() => {});
  } else {
    const { rows } = await pool.query(
      `INSERT INTO hrm_attendance (employee_name, employee_id, attendance_date, clock_in, clock_out, status, department, note, shift_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [employee_name, employee_id || null, attendance_date, clock_in || null, clock_out || null, status, department || null, note || '', shift_name || null]
    );
    rec = rows[0];
    logAudit({ userId, userName, module: 'HRM Attendance', action: 'CREATE', recordId: rec.id, recordLabel: rec.employee_name, oldData: null, newData: rec }).catch(() => {});
  }

  return rec;
}
async function updateAttendanceRecord(id, data, userId, userName) {
  const { employee_name, attendance_date, clock_in, clock_out, status, department, shift_name } = data;
  const existing = await pool.query(`SELECT * FROM hrm_attendance WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Attendance record not found');
  const oldData = existing.rows[0];

  const { rows } = await pool.query(
    `UPDATE hrm_attendance SET employee_name=$1, attendance_date=$2, clock_in=$3, clock_out=$4, status=$5, department=$6, shift_name=$7, updated_at=NOW()
     WHERE id=$8 RETURNING *`,
    [employee_name, attendance_date, clock_in || null, clock_out || null, status, department || null, shift_name || null, id]
  );
  if (!rows.length) throw new Error('Attendance record not found');
  const rec = rows[0];
  logAudit({ userId, userName, module: 'HRM Attendance', action: 'UPDATE', recordId: id, recordLabel: rec.employee_name, oldData, newData: rec }).catch(() => {});
  return rec;
}

async function deleteAttendanceRecord(id, userId, userName) {
  const existing = await pool.query(`SELECT * FROM hrm_attendance WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Attendance record not found');
  const oldData = existing.rows[0];
  await pool.query(`DELETE FROM hrm_attendance WHERE id=$1`, [id]);
  logAudit({ userId, userName, module: 'HRM Attendance', action: 'DELETE', recordId: id, recordLabel: oldData.employee_name, oldData, newData: null }).catch(() => {});
}

// ── PAYROLL ──────────────────────────────────────────────────

async function fetchPayrolls({ status = '', employee = '', month_year = '' } = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (status)     { conditions.push(`status = $${idx++}`);            values.push(status); }
  if (employee)   { conditions.push(`employee_name ILIKE $${idx++}`); values.push(`%${employee}%`); }
  if (month_year) { conditions.push(`month_year = $${idx++}`);        values.push(month_year); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM hrm_payroll ${where} ORDER BY id DESC`, values
  );
  return rows;
}

async function createPayroll({ employee_name, employee_id, department, designation, month_year, net_salary }, createdBy, userName) {
  if (!employee_name || !month_year) throw new Error('Employee and month/year are required');
  const ref = await nextPayrollRef();
  const { rows } = await pool.query(
    `INSERT INTO hrm_payroll
       (reference_no, employee_name, employee_id, department, designation, month_year, net_salary, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'Pending',$8) RETURNING *`,
    [ref, employee_name, employee_id || null, department || '—', designation || '—', month_year, net_salary || 0, createdBy || null]
  );
  const payroll = rows[0];
  logAudit({ userId: createdBy, userName, module: 'HRM Payroll', action: 'CREATE', recordId: payroll.id, recordLabel: payroll.reference_no, oldData: null, newData: payroll }).catch(() => {});
  return payroll;
}

// ── PAYROLL PROCESSING ENGINE ────────────────────────────────
// NEW
async function fetchEligibleEmployeesForRun(monthYear) {
  await ensureHrmSchema();
  const { rows } = await pool.query(
    `SELECT u.id::text AS id, u.full_name, u.email, u.payroll_group_id, pg.name AS payroll_group_name, 'user' AS source
     FROM users u
     JOIN hrm_payroll_groups pg ON pg.id = u.payroll_group_id
     WHERE u.payroll_group_id IS NOT NULL
       AND u.id::text NOT IN (
         SELECT employee_id::text FROM hrm_payroll
         WHERE month_year = $1 AND employee_id IS NOT NULL AND employee_source = 'user'
       )
     UNION ALL
     SELECT e.id::text AS id, e.full_name, NULL AS email, e.payroll_group_id, pg.name AS payroll_group_name, 'employee' AS source
     FROM hrm_employees e
     JOIN hrm_payroll_groups pg ON pg.id = e.payroll_group_id
     WHERE e.payroll_group_id IS NOT NULL
       AND e.linked_user_id IS NULL
       AND e.id::text NOT IN (
         SELECT employee_id::text FROM hrm_payroll
         WHERE month_year = $1 AND employee_id IS NOT NULL AND employee_source = 'employee'
       )
    ORDER BY full_name`,
    [monthYear]
  );
  return rows;
}
async function computeEmployeePayroll(employeeId, source = 'user', monthYear = null) {
  await ensureHrmSchema();
  const table = source === 'employee' ? 'hrm_employees' : 'users';
  const empRes = await pool.query(
  `SELECT t.id, t.full_name, ${source === 'employee' ? 'NULL' : 't.email'} AS email, t.department, t.designation,
          t.basic_salary, t.payroll_group_id, pg.name AS payroll_group_name
   FROM ${table} t
   LEFT JOIN hrm_payroll_groups pg ON pg.id = t.payroll_group_id
   WHERE t.id = $1`,
  [employeeId]
);
  const emp = empRes.rows[0];
  if (!emp) throw new Error('Employee not found');
  if (!emp.payroll_group_id) throw new Error('Employee has no assigned Payroll Group');

  const compRes = await pool.query(
    `SELECT pc.id, pc.description, pc.component_type, pc.calc_method, pc.amount
     FROM hrm_payroll_group_components gc
     JOIN hrm_pay_components pc ON pc.id = gc.pay_component_id
     WHERE gc.payroll_group_id = $1 AND pc.status = 'Active'
     ORDER BY pc.id`,
    [emp.payroll_group_id]
  );

const overrideRes = await pool.query(
    `SELECT pay_component_id, override_amount FROM hrm_employee_component_overrides WHERE employee_id::text = $1 AND employee_source = $2`,
    [String(employeeId), source]
  );
  const overrideMap = Object.fromEntries(overrideRes.rows.map(o => [o.pay_component_id, Number(o.override_amount)]));

let grossEarnings = 0;
  const earningComponents = compRes.rows.filter(c => c.component_type === 'Earning');
  const items = [];

  const hasBasicSalaryComponent = earningComponents.some(
    c => c.calc_method !== 'Percentage' && /basic\s*salary/i.test(c.description || '')
  );
  if (!hasBasicSalaryComponent && Number(emp.basic_salary) > 0) {
    const baseAmt = Number(emp.basic_salary);
    grossEarnings += baseAmt;
    items.push({ component_id: null, component_name: 'Basic Salary', component_type: 'Earning', amount: baseAmt });
  }

  for (const c of earningComponents) {
    const amt = overrideMap[c.id] != null ? overrideMap[c.id] : Number(c.amount || 0);
    let value = c.calc_method === 'Percentage' ? 0 : amt; // percentage earnings resolved below (need base)
    if (c.calc_method !== 'Percentage') {
      grossEarnings += value;
      items.push({ component_id: c.id, component_name: c.description, component_type: 'Earning', amount: value });
    }
  }
  // Second pass: percentage-based earnings (e.g. bonus % of basic) applied against gross so far
  for (const c of earningComponents) {
    if (c.calc_method === 'Percentage') {
      const pct = overrideMap[c.id] != null ? overrideMap[c.id] : Number(c.amount || 0);
      const value = Math.round((grossEarnings * pct) / 100 * 100) / 100;
      grossEarnings += value;
      items.push({ component_id: c.id, component_name: c.description, component_type: 'Earning', amount: value });
    }
  }

 let totalDeductions = 0;
  const deductionComponents = compRes.rows.filter(c => c.component_type === 'Deduction');
  for (const c of deductionComponents) {
    const raw = overrideMap[c.id] != null ? overrideMap[c.id] : Number(c.amount || 0);
    const value = c.calc_method === 'Percentage'
      ? Math.round((grossEarnings * raw) / 100 * 100) / 100
      : raw;
    totalDeductions += value;
    items.push({ component_id: c.id, component_name: c.description, component_type: 'Deduction', amount: value });
  }

// Absent-day deduction — only applied when a monthYear is passed in
  // (i.e. during an actual payroll run/preview, not other callers of
  // this function). Reads hrm_attendance rows already written by
  // HR's Attendance page AND ESS clock-in/markAbsentees — same table.
  if (monthYear) {
    const absentDays = await countAbsentDays(employeeId, source, monthYear);
    if (absentDays > 0) {
      const perDayRate = await getPerDayRate(grossEarnings);
      const absentDeduction = Math.round(perDayRate * absentDays * 100) / 100;
      totalDeductions += absentDeduction;
      items.push({
        component_id: null,
        component_name: `Absent Deduction (${absentDays} day${absentDays > 1 ? 's' : ''})`,
        component_type: 'Deduction',
        amount: absentDeduction,
      });
    }

    // Unpaid Leave / LOP deduction — separate from Absent, driven purely
    // by Leave Type config (is_paid = FALSE). Paid leave types (Casual,
    // Sick, Earned, etc. by default) never trigger this. Additive only:
    // does not change the Absent-day block above.
    const unpaidLeaveDays = await countUnpaidLeaveDays(employeeId, source, monthYear);
    if (unpaidLeaveDays > 0) {
      const perDayRate = await getPerDayRate(grossEarnings);
      const lopDeduction = Math.round(perDayRate * unpaidLeaveDays * 100) / 100;
      totalDeductions += lopDeduction;
      items.push({
        component_id: null,
        component_name: `Unpaid Leave Deduction (${unpaidLeaveDays} day${unpaidLeaveDays > 1 ? 's' : ''})`,
 component_type: 'Deduction',
        amount: lopDeduction,
      });
    }
// Sales commission — calculated per the target's own type (Sales
    // Amount % vs Orders/Customers fixed incentive). See
    // calculateSalesCommission() below.
    // Use whichever "Basic Salary" amount actually landed on this payslip
    // (could be the employee record OR a fixed Pay Component named
    // "Basic Salary" in the payroll group) — not the raw employee field,
    // which may be 0 when a group-level component overrides it.
    const basicSalaryItem = items.find(
      it => it.component_type === 'Earning' && /basic\s*salary/i.test(it.component_name || '')
    );
    const basicSalaryForCommission = basicSalaryItem ? Number(basicSalaryItem.amount) : grossEarnings;
    const commission = await calculateSalesCommission(employeeId, source, monthYear, basicSalaryForCommission);
    if (commission && commission.amount > 0) {
      grossEarnings += commission.amount;
      items.push({
        component_id: null,
        component_name: commission.label,
        component_type: 'Earning',
        amount: commission.amount,
      });
    }
  }

  const netSalary = Math.round((grossEarnings - totalDeductions) * 100) / 100;

  return {
    employee: emp,
    source,
    items,
    grossEarnings,
    totalDeductions,
    netSalary,
  };
}

// ── SALES COMMISSION (used by payroll run/preview) ──────────────
// Reuses the existing Sales Target's "type" (Sales Amount vs Number of
// Orders vs Number of Customers), inferred the same way the Sales
// Targets page already infers it: whichever *_target column is > 0.
// - Sales Amount targets: commission_pct is a PERCENTAGE, applied to the
//   live achieved sales amount for that month.
// - Orders / Customers targets: commission_pct is treated as a FIXED
//   incentive amount, paid only once the target is fully achieved
//   (achieved >= target).
async function calculateSalesCommission(employeeId, source, monthYear, basicSalary) {
  if (!employeeId || !monthYear) return null;

const { rows } = await pool.query(
    `SELECT * FROM hrm_sales_targets
     WHERE employee_id::text = $1 AND employee_source = $2 AND TRIM(month_year) = TRIM($3)
     ORDER BY id DESC LIMIT 1`,
    [String(employeeId), source, monthYear]
  );
  if (!rows.length) return null;

  const [target] = await salesTargetsService.enrichTargets(rows);
  const commissionPct = Number(target.commission_pct) || 0;
  if (commissionPct <= 0) return null;

  const isOrderTarget = Number(target.order_target) > 0;
  const isCustomerTarget = Number(target.customer_target) > 0;

  if (isOrderTarget || isCustomerTarget) {
    // Orders/Customers → commission_pct is a PERCENTAGE OF BASIC SALARY,
    // paid only once the target is fully achieved (no fixed-amount field exists).
    const targetVal = isOrderTarget ? Number(target.order_target) : Number(target.customer_target);
    const achievedVal = isOrderTarget ? Number(target.order_achieved) : Number(target.customer_achieved);
    if (targetVal > 0 && achievedVal >= targetVal) {
      const base = Number(basicSalary) || 0;
      const amount = Math.round((base * commissionPct) / 100 * 100) / 100;
      if (amount <= 0) return null;
      return { amount, label: `Sales Incentive (${target.month_year})` };
    }
    return null;
  }

  // Sales Amount → commission_pct is a % of the achieved sales amount
  const achievedAmount = Number(target.achieved_amount) || 0;
  if (achievedAmount <= 0) return null;
  const commissionAmt = Math.round((achievedAmount * commissionPct) / 100 * 100) / 100;
  return { amount: commissionAmt, label: `Sales Commission (${target.month_year})` };
}

async function runPayrollForEmployee(employeeId, monthYear, createdBy, userName, source = 'user') {
  const calc = await computeEmployeePayroll(employeeId, source, monthYear);
  const ref = await nextPayrollRef();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const payrollRes = await client.query(
      `INSERT INTO hrm_payroll
         (reference_no, employee_name, employee_id, employee_source, department, designation, month_year,
          net_salary, gross_salary, total_deductions, status, payroll_group_id, created_by)
       VALUES ($1,$2,$3::text,$4,$5,$6,$7,$8,$9,$10,'Pending',$11,$12) RETURNING *`,
      [
        ref, calc.employee.full_name, String(employeeId), source,
        calc.employee.department || '—', calc.employee.designation || '—',
        monthYear, calc.netSalary, calc.grossEarnings, calc.totalDeductions,
        calc.employee.payroll_group_id, createdBy || null,
      ]
    );
    const payrollId = payrollRes.rows[0].id;

    for (const item of calc.items) {
      await client.query(
        `INSERT INTO hrm_payroll_items (payroll_id, component_id, component_name, component_type, amount)
         VALUES ($1,$2,$3,$4,$5)`,
        [payrollId, item.component_id, item.component_name, item.component_type, item.amount]
      );
    }
    await client.query('COMMIT');
    const payroll = payrollRes.rows[0];
    logAudit({ userId: createdBy, userName, module: 'HRM Payroll', action: 'CREATE', recordId: payroll.id, recordLabel: payroll.reference_no, oldData: null, newData: payroll }).catch(() => {});
    return payroll;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
async function runPayrollBulk(employeeEntries, monthYear, createdBy, userName) {
  // employeeEntries: array of ids (legacy, source defaults to 'user')
  //                 OR array of { id, source } objects (new: mixed users + employees)
  const results = [];
  const errors = [];
  for (const entry of employeeEntries) {
    const id     = typeof entry === 'object' ? entry.id : entry;
    const source = typeof entry === 'object' ? (entry.source || 'user') : 'user';
    try {
      const rec = await runPayrollForEmployee(id, monthYear, createdBy, userName, source);
      results.push(rec);
    } catch (e) {
      errors.push({ employee_id: id, error: e.message });
    }
  }
  return { created: results, errors };
}
async function fetchPayrollItems(payrollId) {
  const { rows } = await pool.query(
    `SELECT id, component_id, component_name, component_type, amount
     FROM hrm_payroll_items WHERE payroll_id = $1 ORDER BY id`,
    [payrollId]
  );
  return rows;
}
async function updatePayroll(id, data, userId, userName) {
  const { employee_name, department, designation, month_year, net_salary, status } = data;

  const before = await pool.query(`SELECT * FROM hrm_payroll WHERE id = $1`, [id]);
  if (!before.rows.length) throw new Error('Payroll not found');
  const oldData = before.rows[0];
  const prevStatus = oldData.status;

  const { rows } = await pool.query(
    `UPDATE hrm_payroll
     SET employee_name=$1, department=$2, designation=$3, month_year=$4, net_salary=$5, status=$6, updated_at=NOW()
     WHERE id=$7 RETURNING *`,
    [employee_name, department, designation, month_year, net_salary, status, id]
  );
  if (!rows.length) throw new Error('Payroll not found');
  const payroll = rows[0];

  logAudit({ userId, userName, module: 'HRM Payroll', action: 'UPDATE', recordId: id, recordLabel: payroll.reference_no, oldData, newData: payroll }).catch(() => {});

  // Auto-mirror the salary payout into Cash & Bank only on the transition
  // into 'Paid' — re-saving an already-Paid record won't double-post.
  if (status === 'Paid' && prevStatus !== 'Paid') {
    bankIntegrationService.safeRecord({
      sourceModule: 'Payroll',
      sourceId: payroll.id,
      sourceEvent: 'salary-payment',
      txnType: 'Debit',
      amount: payroll.net_salary,
      paymentMethod: 'Bank Transfer',
      description: `Salary payment — ${payroll.employee_name} (${payroll.month_year})`,
      txnDate: new Date(),
    }).catch(() => {});
  }

  return payroll;
}

async function deletePayroll(id, userId, userName) {
  const existing = await pool.query(`SELECT * FROM hrm_payroll WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Payroll not found');
  const oldData = existing.rows[0];
  await pool.query(`DELETE FROM hrm_payroll WHERE id=$1`, [id]);
  logAudit({ userId, userName, module: 'HRM Payroll', action: 'DELETE', recordId: id, recordLabel: oldData.reference_no, oldData, newData: null }).catch(() => {});
}

// ── PAY COMPONENTS ───────────────────────────────────────────
async function fetchPayComponents() {
  const { rows } = await pool.query(
    `SELECT id, description, component_type, amount, calc_method, status, applicable_from FROM hrm_pay_components ORDER BY id`
  );
  return rows;
}

async function createPayComponent({ description, component_type, amount, calc_method, status, applicable_from }, userId, userName) {
  if (!description) throw new Error('Description is required');
  const { rows } = await pool.query(
    `INSERT INTO hrm_pay_components (description, component_type, amount, calc_method, status, applicable_from)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [description, component_type || 'Earning', amount || 0, calc_method || 'Fixed', status || 'Active', applicable_from || null]
  );
  const comp = rows[0];
  logAudit({ userId, userName, module: 'HRM Pay Components', action: 'CREATE', recordId: comp.id, recordLabel: comp.description, oldData: null, newData: comp }).catch(() => {});
  return comp;
}

async function updatePayComponent(id, data, userId, userName) {
  const { description, component_type, amount, calc_method, status, applicable_from } = data;
  const existing = await pool.query(`SELECT * FROM hrm_pay_components WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Pay component not found');
  const oldData = existing.rows[0];

  const { rows } = await pool.query(
    `UPDATE hrm_pay_components SET description=$1, component_type=$2, amount=$3, calc_method=$4, status=$5, applicable_from=$6, updated_at=NOW()
     WHERE id=$7 RETURNING *`,
    [description, component_type, amount, calc_method, status, applicable_from, id]
  );
  if (!rows.length) throw new Error('Pay component not found');
  const comp = rows[0];
  logAudit({ userId, userName, module: 'HRM Pay Components', action: 'UPDATE', recordId: id, recordLabel: comp.description, oldData, newData: comp }).catch(() => {});
  return comp;
}

async function deletePayComponent(id, userId, userName) {
  const existing = await pool.query(`SELECT * FROM hrm_pay_components WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Pay component not found');
  const oldData = existing.rows[0];
  await pool.query(`DELETE FROM hrm_pay_components WHERE id=$1`, [id]);
  logAudit({ userId, userName, module: 'HRM Pay Components', action: 'DELETE', recordId: id, recordLabel: oldData.description, oldData, newData: null }).catch(() => {});
}

// ── PAYROLL GROUPS ───────────────────────────────────────────

async function fetchPayrollGroups() {
  const { rows } = await pool.query(
    `SELECT id, name, pay_schedule, employee_count, description, created_at FROM hrm_payroll_groups ORDER BY id`
  );
  return rows;
}

async function createPayrollGroup({ name, pay_schedule, employee_count, description }, userId, userName) {
  if (!name) throw new Error('Group name is required');
  const { rows } = await pool.query(
    `INSERT INTO hrm_payroll_groups (name, pay_schedule, employee_count, description)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, pay_schedule || 'Monthly', employee_count || 0, description || '']
  );
  const group = rows[0];
  logAudit({ userId, userName, module: 'HRM Payroll Groups', action: 'CREATE', recordId: group.id, recordLabel: group.name, oldData: null, newData: group }).catch(() => {});
  return group;
}

async function updatePayrollGroup(id, data, userId, userName) {
  const { name, pay_schedule, employee_count, description } = data;
  const existing = await pool.query(`SELECT * FROM hrm_payroll_groups WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Payroll group not found');
  const oldData = existing.rows[0];

  const { rows } = await pool.query(
    `UPDATE hrm_payroll_groups SET name=$1, pay_schedule=$2, employee_count=$3, description=$4, updated_at=NOW()
     WHERE id=$5 RETURNING *`,
    [name, pay_schedule, employee_count, description, id]
  );
  if (!rows.length) throw new Error('Payroll group not found');
  const group = rows[0];
  logAudit({ userId, userName, module: 'HRM Payroll Groups', action: 'UPDATE', recordId: id, recordLabel: group.name, oldData, newData: group }).catch(() => {});
  return group;
}

async function deletePayrollGroup(id, userId, userName) {
  const existing = await pool.query(`SELECT * FROM hrm_payroll_groups WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Payroll group not found');
  const oldData = existing.rows[0];
  await pool.query(`DELETE FROM hrm_payroll_groups WHERE id=$1`, [id]);
  logAudit({ userId, userName, module: 'HRM Payroll Groups', action: 'DELETE', recordId: id, recordLabel: oldData.name, oldData, newData: null }).catch(() => {});
}
// ── EMPLOYEES (non-login staff for Payroll/Attendance/Leave) ──

// NEW
async function fetchEmployees() {
  await ensureHrmSchema();
  const { rows } = await pool.query(
    `SELECT id::text AS id, full_name, department, designation, basic_salary, salary_period,
            phone, status, payroll_group_id, created_at, 'employee' AS source,
            linked_user_id::text AS linked_user_id
     FROM hrm_employees
     WHERE linked_user_id IS NULL
     UNION ALL
     SELECT id::text AS id, full_name, department, designation, basic_salary, salary_period,
            phone, status, payroll_group_id, created_at, 'user' AS source,
            NULL AS linked_user_id
     FROM users
     ORDER BY source, created_at`
  );
  return rows;
}
async function createEmployee({ full_name, department, designation, basic_salary, salary_period, phone, status }, userId, userName) {
  if (!full_name) throw new Error('Full name is required');
  const { rows } = await pool.query(
    `INSERT INTO hrm_employees (full_name, department, designation, basic_salary, salary_period, phone, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [full_name, department || null, designation || null, basic_salary || 0, salary_period || 'Per Month', phone || null, status || 'active']
  );
  const emp = rows[0];
  logAudit({ userId, userName, module: 'HRM Employees', action: 'CREATE', recordId: emp.id, recordLabel: emp.full_name, oldData: null, newData: emp }).catch(() => {});
  return emp;
}
// ── ENABLE LOGIN FOR AN EXISTING EMPLOYEE ───────────────────
// Creates a users row PREFILLED from the Employee's own fields —
// never asks HR to re-type name/department/designation — and links
// both records together. Refuses if the Employee already has a login.
// NEW
async function enableEmployeeLogin(employeeId, { email, password }, userId, userName) {
  await ensureHrmSchema();
  const empRes = await pool.query(`SELECT * FROM hrm_employees WHERE id=$1`, [employeeId]);
  if (!empRes.rows.length) throw new Error('Employee not found');
  const emp = empRes.rows[0];

  if (emp.linked_user_id) throw new Error('This employee already has a linked login account.');
  if (!email || !password) throw new Error('Email and password are required');

  const dupe = await pool.query(`SELECT id FROM users WHERE email=$1`, [email]);
  if (dupe.rows.length) throw new Error('Email already in use by another account');

  const bcrypt = require('bcryptjs');
  const hashedPassword = await bcrypt.hash(password, 10);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userRes = await client.query(
      `INSERT INTO users (email, password_hash, full_name, phone, role, department, designation,
                           basic_salary, salary_period, status, linked_employee_id)
       VALUES ($1,$2,$3,$4,'employee',$5,$6,$7,$8,'active',$9)
       RETURNING id, email, full_name, department, designation`,
      [email, hashedPassword, emp.full_name, emp.phone, emp.department, emp.designation,
       emp.basic_salary, emp.salary_period, employeeId]
    );
    const newUser = userRes.rows[0];

    await client.query(`UPDATE hrm_employees SET linked_user_id=$1, updated_at=NOW() WHERE id=$2`, [newUser.id, employeeId]);

    // Carry the employee's payroll and sales-target history forward into
    // the new login account, so My Space isn't empty after conversion.
    // Old rows were stored as employee_id=<hrm_employees.id>, source='employee';
    // they now belong to employee_id=<new user UUID>, source='user'.
    await client.query(
      `UPDATE hrm_payroll SET employee_id=$1::text, employee_source='user'
       WHERE employee_id=$2::text AND employee_source='employee'`,
      [newUser.id, String(employeeId)]
    );
    await client.query(
      `UPDATE hrm_sales_targets SET employee_id=$1::text, employee_source='user'
       WHERE employee_id=$2::text AND employee_source='employee'`,
      [newUser.id, String(employeeId)]
    );

    await client.query('COMMIT');

    logAudit({ userId, userName, module: 'HRM Employees', action: 'UPDATE', recordId: employeeId, recordLabel: `${emp.full_name} (login enabled)`, oldData: emp, newData: { ...emp, linked_user_id: newUser.id } }).catch(() => {});
    return newUser;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function updateEmployee(id, data, userId, userName) {
  const { full_name, department, designation, basic_salary, salary_period, phone, status } = data;
  const existing = await pool.query(`SELECT * FROM hrm_employees WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Employee not found');
  const oldData = existing.rows[0];

  const { rows } = await pool.query(
    `UPDATE hrm_employees SET full_name=$1, department=$2, designation=$3, basic_salary=$4, salary_period=$5, phone=$6, status=$7, updated_at=NOW()
     WHERE id=$8 RETURNING *`,
    [full_name, department, designation, basic_salary, salary_period, phone, status, id]
  );
  if (!rows.length) throw new Error('Employee not found');
  const emp = rows[0];
  logAudit({ userId, userName, module: 'HRM Employees', action: 'UPDATE', recordId: id, recordLabel: emp.full_name, oldData, newData: emp }).catch(() => {});
  return emp;
}

async function deleteEmployee(id, userId, userName) {
  const existing = await pool.query(`SELECT * FROM hrm_employees WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Employee not found');
  const oldData = existing.rows[0];
  await pool.query(`DELETE FROM hrm_employees WHERE id=$1`, [id]);
  logAudit({ userId, userName, module: 'HRM Employees', action: 'DELETE', recordId: id, recordLabel: oldData.full_name, oldData, newData: null }).catch(() => {});
}
async function fetchEmployeesWithGroups() {
  await ensureHrmSchema();
  const { rows } = await pool.query(
    `SELECT u.id::text AS id, u.full_name, u.email, u.payroll_group_id, pg.name AS payroll_group_name, 'user' AS source
     FROM users u
     LEFT JOIN hrm_payroll_groups pg ON pg.id = u.payroll_group_id
     UNION ALL
     SELECT e.id::text AS id, e.full_name, NULL AS email, e.payroll_group_id, pg.name AS payroll_group_name, 'employee' AS source
     FROM hrm_employees e
     LEFT JOIN hrm_payroll_groups pg ON pg.id = e.payroll_group_id
     ORDER BY full_name`
  );
  return rows;
}

async function assignPayrollGroup(entityId, payrollGroupId, source = 'user') {
  await ensureHrmSchema();
  const table = source === 'employee' ? 'hrm_employees' : 'users';
  const { rows } = await pool.query(
    `UPDATE ${table} SET payroll_group_id=$1 WHERE id=$2 RETURNING id, full_name, payroll_group_id`,
    [payrollGroupId || null, entityId]
  );
  if (!rows.length) throw new Error('Employee not found');

  // Keep the group's employee_count in sync across BOTH tables
  await pool.query(
    `UPDATE hrm_payroll_groups SET employee_count = (
       (SELECT COUNT(*) FROM users WHERE payroll_group_id = hrm_payroll_groups.id) +
       (SELECT COUNT(*) FROM hrm_employees WHERE payroll_group_id = hrm_payroll_groups.id)
     )`
  );

  return rows[0];
}

async function fetchGroupComponents(groupId) {
  const { rows } = await pool.query(
    `SELECT pc.id, pc.description, pc.component_type, pc.calc_method, pc.amount, pc.status
     FROM hrm_payroll_group_components gc
     JOIN hrm_pay_components pc ON pc.id = gc.pay_component_id
     WHERE gc.payroll_group_id = $1
     ORDER BY pc.id`,
    [groupId]
  );
  return rows;
}

async function setGroupComponents(groupId, componentIds) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM hrm_payroll_group_components WHERE payroll_group_id=$1`, [groupId]);
    if (Array.isArray(componentIds) && componentIds.length) {
      const values = componentIds.map((_, i) => `($1, $${i + 2})`).join(',');
      await client.query(
        `INSERT INTO hrm_payroll_group_components (payroll_group_id, pay_component_id) VALUES ${values}`,
        [groupId, ...componentIds]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return fetchGroupComponents(groupId);
}

// ── HOLIDAYS ─────────────────────────────────────────────────

// NEW CODE
async function fetchHolidays() {
  const { rows } = await pool.query(
    `SELECT id, name, start_date, end_date, duration, location, note, holiday_type, active
     FROM hrm_holidays ORDER BY start_date`
  );
  return rows;
}
async function createHoliday({ name, start_date, end_date, location, note, holiday_type }, userId, userName) {
  if (!name || !start_date || !end_date) throw new Error('Name and dates are required');
  const s = new Date(start_date), e = new Date(end_date);
  const days = Math.max(1, Math.round((e - s) / 86400000) + 1);
  const duration = `${days} day${days > 1 ? 's' : ''}`;
  const { rows } = await pool.query(
    `INSERT INTO hrm_holidays (name, start_date, end_date, duration, location, note, holiday_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name, start_date, end_date, duration, location || 'All Locations', note || '', holiday_type || 'Company Holiday']
  );
  const holiday = rows[0];
  logAudit({ userId, userName, module: 'HRM Holidays', action: 'CREATE', recordId: holiday.id, recordLabel: holiday.name, oldData: null, newData: holiday }).catch(() => {});

  notificationService.notifyAllActiveUsers({
    module: 'Holiday', eventType: 'holiday_created', recordId: holiday.id,
    title: `New holiday added: ${holiday.name}`,
    message: `🔔 ${holiday.holiday_type || 'Company Holiday'} on ${String(holiday.start_date).slice(0,10)}${holiday.end_date !== holiday.start_date ? ` – ${String(holiday.end_date).slice(0,10)}` : ''}${holiday.location && holiday.location !== 'All Locations' ? ` (${holiday.location})` : ''}.`,
  }).catch(() => {});

  return holiday;
}

async function updateHoliday(id, data, userId, userName) {
  const { name, start_date, end_date, location, note, holiday_type } = data;
  const existing = await pool.query(`SELECT * FROM hrm_holidays WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Holiday not found');
  const oldData = existing.rows[0];

  const s = new Date(start_date), e = new Date(end_date);
  const days = Math.max(1, Math.round((e - s) / 86400000) + 1);
  const { rows } = await pool.query(
    `UPDATE hrm_holidays SET name=$1, start_date=$2, end_date=$3, duration=$4, location=$5, note=$6, holiday_type=COALESCE($7, holiday_type), updated_at=NOW()
     WHERE id=$8 RETURNING *`,
    [name, start_date, end_date, `${days} day${days > 1 ? 's' : ''}`, location, note, holiday_type || null, id]
  );
  if (!rows.length) throw new Error('Holiday not found');
  const holiday = rows[0];
  logAudit({ userId, userName, module: 'HRM Holidays', action: 'UPDATE', recordId: id, recordLabel: holiday.name, oldData, newData: holiday }).catch(() => {});

  notificationService.notifyAllActiveUsers({
    module: 'Holiday', eventType: 'holiday_updated', recordId: holiday.id,
    title: `Holiday updated: ${holiday.name}`,
    message: `🔔 ${holiday.name} has been updated — now ${String(holiday.start_date).slice(0,10)}${holiday.end_date !== holiday.start_date ? ` – ${String(holiday.end_date).slice(0,10)}` : ''}.`,
  }).catch(() => {});

  return holiday;
}

async function deleteHoliday(id, userId, userName) {
  const existing = await pool.query(`SELECT * FROM hrm_holidays WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Holiday not found');
  const oldData = existing.rows[0];
  await pool.query(`DELETE FROM hrm_holidays WHERE id=$1`, [id]);
  logAudit({ userId, userName, module: 'HRM Holidays', action: 'DELETE', recordId: id, recordLabel: oldData.name, oldData, newData: null }).catch(() => {});

  // Clear any lingering "holiday added/updated" notifications for this
  // deleted holiday so employees don't see a dead "View" link.
  pool.query(
    `DELETE FROM hrm_notifications WHERE module = 'Holiday' AND record_id = $1`,
    [id]
  ).catch(() => {});
}
// NEW CODE — insert after deleteHoliday()

// ── MY HOLIDAYS (ESS) ────────────────────────────────────────
// Read-only for employees. Only returns active, upcoming (or
// currently running) holidays — no past holidays cluttering the view.
async function fetchMyHolidays() {
  const { rows } = await pool.query(
    `SELECT id, name, start_date, end_date, duration, location, note, holiday_type
     FROM hrm_holidays
     WHERE active IS NOT FALSE
       AND end_date >= CURRENT_DATE - INTERVAL '1 day'
     ORDER BY start_date`
  );
  return rows;
}
// ── SALES TARGETS ────────────────────────────────────────────

async function fetchSalesTargets({ month_year = '' } = {}) {
  const where = month_year ? `WHERE month_year = $1` : '';
  const values = month_year ? [month_year] : [];
  const { rows } = await pool.query(
    `SELECT * FROM hrm_sales_targets ${where} ORDER BY id`, values
  );
  // Live-calculate achievement from sales_invoices — read-only, no writes
  // to sales_invoices or any Sell-module table.
  return await salesTargetsService.enrichTargets(rows);
}

async function createSalesTarget({
  employee_name, target_amount, commission_pct, month_year,
  order_target, customer_target, collection_target, remarks,
  employee_id, employee_source,
}, userId, userName) {
const hasTarget = Number(target_amount) > 0 || Number(order_target) > 0 || Number(customer_target) > 0;
if (!employee_name || !hasTarget) throw new Error('Employee and at least one target value are required');
  const { rows } = await pool.query(
    `INSERT INTO hrm_sales_targets
       (employee_name, target_amount, commission_pct, month_year,
        order_target, customer_target, collection_target, remarks,
        employee_id, employee_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [employee_name, target_amount, commission_pct || 0, month_year || '',
     order_target || 0, customer_target || 0, collection_target || 0, remarks || null,
     employee_id || null, employee_source || 'user']
  );
  const target = rows[0];
  logAudit({ userId, userName, module: 'HRM Sales Targets', action: 'CREATE', recordId: target.id, recordLabel: target.employee_name, oldData: null, newData: target }).catch(() => {});
  // Notify the assigned employee — non-blocking, matches leave-notification style.
  if (target.employee_id) {
    notificationService.notifyUser({
      recipientId: target.employee_id, recipientSource: target.employee_source || 'user',
      module: 'Sales Target', eventType: 'target_assigned', recordId: target.id,
      title: 'A new sales target has been assigned',
      message: `Target for ${target.month_year || 'this period'}: ₹${Number(target.target_amount).toLocaleString('en-IN')}.`,
    }).catch(() => {});
  }
  return target;
}

async function updateSalesTarget(id, data, userId, userName) {
  const {
    employee_name, target_amount, commission_pct, month_year, achieved_amount,
    order_target, order_achieved, customer_target, customer_achieved,
    collection_target, collection_achieved, remarks,
  } = data;
  const existing = await pool.query(`SELECT * FROM hrm_sales_targets WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Sales target not found');
  const oldData = existing.rows[0];

  const { rows } = await pool.query(
    `UPDATE hrm_sales_targets SET
       employee_name=$1, target_amount=$2, commission_pct=$3, month_year=$4, achieved_amount=$5,
       order_target=COALESCE($6, order_target), order_achieved=COALESCE($7, order_achieved),
       customer_target=COALESCE($8, customer_target), customer_achieved=COALESCE($9, customer_achieved),
       collection_target=COALESCE($10, collection_target), collection_achieved=COALESCE($11, collection_achieved),
       remarks=COALESCE($12, remarks), updated_at=NOW()
     WHERE id=$13 RETURNING *`,
    [employee_name, target_amount, commission_pct, month_year, achieved_amount || 0,
     order_target ?? null, order_achieved ?? null, customer_target ?? null, customer_achieved ?? null,
     collection_target ?? null, collection_achieved ?? null, remarks ?? null, id]
  );
  if (!rows.length) throw new Error('Sales target not found');
  const target = rows[0];
  logAudit({ userId, userName, module: 'HRM Sales Targets', action: 'UPDATE', recordId: id, recordLabel: target.employee_name, oldData, newData: target }).catch(() => {});
  // Notify employee — non-blocking. Distinguish "completed" vs plain "updated".
  if (target.employee_id) {
    const pct = Number(target.target_amount) > 0 ? (Number(target.achieved_amount) / Number(target.target_amount)) * 100 : 0;
    const oldPct = Number(oldData.target_amount) > 0 ? (Number(oldData.achieved_amount) / Number(oldData.target_amount)) * 100 : 0;
    if (pct >= 100 && oldPct < 100) {
      notificationService.notifyUser({
        recipientId: target.employee_id, recipientSource: target.employee_source || 'user',
        module: 'Sales Target', eventType: 'target_completed', recordId: target.id,
        title: `You achieved ${Math.round(pct)}% of your target 🎉`,
        message: `${target.month_year || 'This period'}'s target has been completed.`,
      }).catch(() => {});
    } else {
      notificationService.notifyUser({
        recipientId: target.employee_id, recipientSource: target.employee_source || 'user',
        module: 'Sales Target', eventType: 'target_updated', recordId: target.id,
        title: 'Your sales target has been updated',
        message: `${target.month_year || 'This period'}: ₹${Number(target.target_amount).toLocaleString('en-IN')}.`,
      }).catch(() => {});
    }
  }
  return target;
}

async function deleteSalesTarget(id, userId, userName) {
  const existing = await pool.query(`SELECT * FROM hrm_sales_targets WHERE id=$1`, [id]);
  if (!existing.rows.length) throw new Error('Sales target not found');
  const oldData = existing.rows[0];
  await pool.query(`DELETE FROM hrm_sales_targets WHERE id=$1`, [id]);
  logAudit({ userId, userName, module: 'HRM Sales Targets', action: 'DELETE', recordId: id, recordLabel: oldData.employee_name, oldData, newData: null }).catch(() => {});
}


// ── MY SALES TARGET (ESS) ────────────────────────────────────
async function fetchMySalesTarget(userId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (month_year) *
     FROM hrm_sales_targets
     WHERE employee_id = $1 AND (employee_source = 'user' OR employee_source IS NULL)
     ORDER BY month_year DESC, id DESC`,
    [String(userId)]
  );
  return rows;
}
// ── DASHBOARD STATS ──────────────────────────────────────────

// ── SETTINGS ─────────────────────────────────────────────────

async function fetchSettings() {
  const { rows } = await pool.query(
    `SELECT * FROM hrm_settings WHERE id = 1`
  );
  if (!rows.length) throw new Error('Settings not found');
  return rows[0];
}

async function updateSettings(data, userId, userName) {
  const {
    work_days_per_week, work_hours_per_day, overtime_rate_multiplier,
    currency, payslip_note, leave_approval, attendance_mode,
    leave_prefix, max_casual_leave_days, auto_approval_after_days, auto_approval_enabled, leave_instructions,
    payroll_cycle, payroll_date, payroll_currency,
    work_start_time, work_end_time, late_grace_minutes,
  } = data;

  const before = await pool.query(`SELECT * FROM hrm_settings WHERE id = 1`);
  const oldData = before.rows[0] || null;

  const { rows } = await pool.query(
    `UPDATE hrm_settings SET
       work_days_per_week       = COALESCE($1,  work_days_per_week),
       work_hours_per_day       = COALESCE($2,  work_hours_per_day),
       overtime_rate_multiplier = COALESCE($3,  overtime_rate_multiplier),
       currency                 = COALESCE($4,  currency),
       payslip_note             = COALESCE($5,  payslip_note),
       leave_approval           = COALESCE($6,  leave_approval),
       attendance_mode          = COALESCE($7,  attendance_mode),
       leave_prefix             = COALESCE($8,  leave_prefix),
       max_casual_leave_days    = COALESCE($9,  max_casual_leave_days),
       auto_approval_after_days = COALESCE($10, auto_approval_after_days),
       auto_approval_enabled    = COALESCE($11, auto_approval_enabled),
       leave_instructions       = COALESCE($12, leave_instructions),
       payroll_cycle            = COALESCE($13, payroll_cycle),
       payroll_date             = COALESCE($14, payroll_date),
       payroll_currency         = COALESCE($15, payroll_currency),
       work_start_time          = COALESCE($16, work_start_time),
       work_end_time            = COALESCE($17, work_end_time),
       late_grace_minutes       = COALESCE($18, late_grace_minutes),
       updated_at = NOW()
     WHERE id = 1
     RETURNING *`,
    [
      work_days_per_week ?? null, work_hours_per_day ?? null, overtime_rate_multiplier ?? null,
      currency ?? null, payslip_note ?? null, leave_approval ?? null, attendance_mode ?? null,
      leave_prefix ?? null, max_casual_leave_days ?? null, auto_approval_after_days ?? null, auto_approval_enabled ?? null, leave_instructions ?? null,
      payroll_cycle ?? null, payroll_date ?? null, payroll_currency ?? null,
      work_start_time ?? null, work_end_time ?? null, late_grace_minutes ?? null,
    ]
  );
  if (!rows.length) throw new Error('Settings not found');
  const settings = rows[0];
  logAudit({ userId, userName, module: 'HRM Settings', action: 'UPDATE', recordId: settings.id, recordLabel: 'HRM Settings', oldData, newData: settings }).catch(() => {});
  return settings;
}
// ── DASHBOARD STATS ──────────────────────────────────────────
async function fetchDashboardStats() {
  const today = new Date().toISOString().split('T')[0];

  const [attStats, leaveStats, payStats] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status='Present')  AS present,
         COUNT(*) FILTER (WHERE status='Late')     AS late,
         COUNT(*) FILTER (WHERE status='Absent')   AS absent,
         COUNT(*) FILTER (WHERE status='On Leave') AS on_leave
       FROM hrm_attendance WHERE attendance_date = $1`,
      [today]
    ),
    pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status='Pending')  AS pending,
         COUNT(*) FILTER (WHERE status='Approved') AS approved
       FROM hrm_leaves`
    ),
    pool.query(
      `SELECT
         COUNT(*)                                  AS total_payrolls,
         COUNT(*) FILTER (WHERE status='Paid')     AS paid,
         COUNT(*) FILTER (WHERE status='Pending')  AS pending,
         COALESCE(SUM(net_salary),0)               AS total_payout
       FROM hrm_payroll`
    ),
  ]);

  return {
    attendance: attStats.rows[0],
    leaves:     leaveStats.rows[0],
    payroll:    payStats.rows[0],
  };
}

// ════════════════════════════════════════════════════════════
// EMPLOYEE SELF-SERVICE (ESS)
// Every function below is scoped strictly to a single employee_id
// (always taken from the verified JWT, never trusted from the
// request body). These are additive — no existing function above
// is modified or reused in a way that changes its behavior.
// ════════════════════════════════════════════════════════════

// ── MY PROFILE ────────────────────────────────────────────────
async function fetchMyProfile(userId) {
  const { rows } = await pool.query(
    `SELECT id, email, full_name, phone, role, department, designation,
            dob, gender, marital_status, permanent_address, current_address
     FROM users WHERE id = $1`,
    [userId]
  );
  if (!rows.length) throw new Error('Profile not found');
  return rows[0];
}

// Only these fields are allowed to be self-edited — matches the
// existing MyProfile.jsx-allowed fields. Anything else (role,
// department, designation, salary, etc.) is intentionally excluded.
async function updateMyProfile(userId, { phone, dob, gender, marital_status, permanent_address, current_address }) {
  const { rows } = await pool.query(
    `UPDATE users
     SET phone=COALESCE($1,phone), dob=COALESCE($2,dob), gender=COALESCE($3,gender),
         marital_status=COALESCE($4,marital_status),
         permanent_address=COALESCE($5,permanent_address),
         current_address=COALESCE($6,current_address),
         updated_at=NOW()
     WHERE id=$7
     RETURNING id, email, full_name, phone, role, department, designation,
               dob, gender, marital_status, permanent_address, current_address`,
    [phone || null, dob || null, gender || null, marital_status || null,
     permanent_address || null, current_address || null, userId]
  );
  if (!rows.length) throw new Error('Profile not found');
  return rows[0];
}

// ── MY ATTENDANCE ────────────────────────────────────────────
async function fetchMyAttendance(userId, { date_from, date_to } = {}) {
  const conditions = [`employee_id = $1`];
  const values = [String(userId)];
  let idx = 2;
  if (date_from) { conditions.push(`attendance_date >= $${idx++}`); values.push(date_from); }
  if (date_to)   { conditions.push(`attendance_date <= $${idx++}`); values.push(date_to); }
  const { rows } = await pool.query(
    `SELECT * FROM hrm_attendance WHERE ${conditions.join(' AND ')} ORDER BY attendance_date DESC, id DESC`,
    values
  );
  return rows;
}

async function fetchMyAttendanceStats(userId) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status='Present') AS present,
       COUNT(*) FILTER (WHERE status='Late')    AS late,
       COUNT(*) FILTER (WHERE status='Absent')  AS absent,
       COUNT(*) FILTER (WHERE status='On Leave') AS on_leave,
       COUNT(*)                                  AS total_records
     FROM hrm_attendance WHERE employee_id = $1`,
    [String(userId)]
  );
  return rows[0];
}

// Self clock-in always uses the verified JWT id — a client can never
// pass a different employee_id to clock in on someone else's behalf.

async function clockInSelf(userId, fullName, department, note, shift_name) {
  const today = new Date().toISOString().split('T')[0];
  const now   = new Date().toTimeString().slice(0, 5);
  const status = await computeAttendanceStatus(now);

  const { rows } = await pool.query(
    `INSERT INTO hrm_attendance (employee_name, employee_id, employee_source, attendance_date, clock_in, status, department, note, shift_name)
     VALUES ($1,$2,'user',$3,$4,$5,$6,$7,$8)
     ON CONFLICT (employee_id, attendance_date)
     DO UPDATE SET clock_in=$4, status=$5, note=$7, shift_name=$8, updated_at=NOW()
     RETURNING *`,
    [fullName || 'Employee', String(userId), today, now, status, department || null, note || '', shift_name || null]
  );
  return rows[0];
}
async function clockOutSelf(userId, recordId) {
  const existing = await pool.query(
    `SELECT * FROM hrm_attendance WHERE id=$1 AND employee_id=$2`,
    [recordId, String(userId)]
  );
  if (!existing.rows.length) throw new Error('Attendance record not found');

  const now = new Date().toTimeString().slice(0, 5);
  const { rows } = await pool.query(
    `UPDATE hrm_attendance SET clock_out=$1, updated_at=NOW() WHERE id=$2 AND employee_id=$3 RETURNING *`,
    [now, recordId, userId]
  );
  return rows[0];
}

// ── MY LEAVE ─────────────────────────────────────────────────
async function fetchMyLeaves(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM hrm_leaves WHERE employee_id = $1 AND employee_source = 'user' ORDER BY id DESC`,
    [String(userId)]
  );
  return rows;
}


async function fetchMyLeaveBalance(userId) {
  await ensureHrmSchema();
  const types = await pool.query(`SELECT id, name, max_count FROM hrm_leave_types WHERE COALESCE(active, TRUE) = TRUE ORDER BY id`);
  const used = await pool.query(
    `SELECT leave_type_name, COALESCE(SUM(end_date::date - start_date::date + 1),0) AS days_used
     FROM hrm_leaves
     WHERE employee_id = $1 AND employee_source = 'user' AND status = 'Approved'
     GROUP BY leave_type_name`,
    [String(userId)]
  );
  const usedMap = Object.fromEntries(used.rows.map(u => [u.leave_type_name, Number(u.days_used)]));
  return types.rows.map(t => ({
    leave_type_id: t.id,
    leave_type_name: t.name,
    max_count: t.max_count,
    used: usedMap[t.name] || 0,
    remaining: Math.max(0, Number(t.max_count) - (usedMap[t.name] || 0)),
  }));
}

async function applyMyLeave(userId, fullName, { leave_type_name, start_date, end_date, reason }) {
  if (!leave_type_name || !start_date || !end_date)
    throw new Error('Leave type, start date and end date are required');

  const ref = await nextLeaveRef();
  const { rows } = await pool.query(
    `INSERT INTO hrm_leaves
       (reference_no, leave_type_name, employee_name, employee_id, employee_source, start_date, end_date, reason, status, created_by)
     VALUES ($1,$2,$3,$4,'user',$5,$6,$7,'Pending',$8) RETURNING *`,
    [ref, leave_type_name, fullName || 'Employee', String(userId), start_date, end_date, reason || '', String(userId)]
  );
  const leave = rows[0];
  logAudit({ userId, userName: fullName, module: 'ESS Leaves', action: 'CREATE', recordId: leave.id, recordLabel: leave.reference_no, oldData: null, newData: leave }).catch(() => {});
  return leave;
}

// Cancel is only allowed while still Pending — once HR/Manager has
// approved or rejected it, the employee can no longer self-cancel.
// This mirrors "existing rules" since there is no other cancel path today.
async function cancelMyLeave(userId, leaveId) {
  const existing = await pool.query(
    `SELECT * FROM hrm_leaves WHERE id=$1 AND employee_id=$2 AND employee_source='user'`,
    [leaveId, String(userId)]
  );
  if (!existing.rows.length) throw new Error('Leave request not found');
  if (existing.rows[0].status !== 'Pending')
    throw new Error('Only pending leave requests can be cancelled');

  const { rows } = await pool.query(
    `UPDATE hrm_leaves SET status='Rejected', updated_at=NOW() WHERE id=$1 AND employee_id=$2 RETURNING *`,
    [leaveId, String(userId)]
  );
  return rows[0];
}

// ── MY PAYROLL / PAYSLIPS ───────────────────────────────────
// ── MY LEAVE NOTIFICATIONS ──────────────────────────────────
// Reuses hrm_leaves.employee_seen — no new table. Returns only
// leaves that were just resolved (Approved/Rejected) and not yet
// acknowledged by the employee. This is the My Space bell feed.
async function fetchMyLeaveNotifications(userId) {
  await ensureHrmSchema();
  const { rows } = await pool.query(
    `SELECT id, reference_no, leave_type_name, start_date, end_date, status,
            approver_name, approver_remarks, updated_at
     FROM hrm_leaves
     WHERE employee_id = $1 AND employee_source = 'user'
       AND status IN ('Approved','Rejected') AND employee_seen = FALSE
     ORDER BY updated_at DESC`,
    [String(userId)]
  );
  return rows;
}

async function markLeaveNotificationSeen(userId, leaveId) {
  const { rows } = await pool.query(
    `UPDATE hrm_leaves SET employee_seen = TRUE
     WHERE id=$1 AND employee_id=$2 AND employee_source='user' RETURNING id, employee_seen`,
    [leaveId, String(userId)]
  );
  if (!rows.length) throw new Error('Leave notification not found');
  return rows[0];
}

async function fetchMyPayroll(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM hrm_payroll WHERE employee_id = $1 AND employee_source = 'user' ORDER BY id DESC`,
    [userId]
  );
  return rows;
}

// Ownership-checked wrapper around the existing fetchPayrollItems —
// confirms the payroll record actually belongs to this employee
// before returning its line items.
async function fetchMyPayrollItems(userId, payrollId) {
  const owned = await pool.query(
    `SELECT id FROM hrm_payroll WHERE id=$1 AND employee_id=$2 AND employee_source='user'`,
    [payrollId, userId]
  );
  if (!owned.rows.length) throw new Error('Payslip not found');
  return fetchPayrollItems(payrollId);
}
// Counts Absent days for one employee within a given month_year ("YYYY-MM"),
// using the SAME hrm_attendance rows HR/ESS already write to.
async function countAbsentDays(employeeId, employeeSource, monthYear) {
  const [year, month] = monthYear.split('-');
  const monthStart = `${year}-${month}-01`;
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS absent_days
     FROM hrm_attendance a
     WHERE a.employee_id = $1 AND a.employee_source = $2
       AND a.status = 'Absent'
       AND a.attendance_date >= $3::date
       AND a.attendance_date < ($3::date + INTERVAL '1 month')
       -- Exclude days already covered by an approved unpaid-leave (LOP) record.
       -- syncAttendanceForLeave() marks those same days 'Absent' in hrm_attendance
       -- (because the leave type has count_as_absent = TRUE), and they are already
       -- charged separately via countUnpaidLeaveDays()'s "Unpaid Leave Deduction".
       -- Without this exclusion the same day was deducted twice.
       AND NOT EXISTS (
         SELECT 1 FROM hrm_leaves l
         LEFT JOIN hrm_leave_types lt
           ON (l.leave_type_id IS NOT NULL AND lt.id = l.leave_type_id)
           OR (l.leave_type_id IS NULL AND lt.name = l.leave_type_name)
         WHERE l.employee_id = a.employee_id AND l.employee_source = a.employee_source
           AND l.status = 'Approved'
           AND COALESCE(lt.affects_payroll, NOT COALESCE(lt.is_paid, TRUE)) = TRUE
           AND a.attendance_date >= l.start_date::date
           AND a.attendance_date <= l.end_date::date
       )`,
    [String(employeeId), employeeSource, monthStart]
  );
  return rows[0].absent_days;
}

// Counts days of APPROVED leave that fall in this month whose leave type
// is configured as unpaid (is_paid = FALSE), clipped to the month's bounds.
// Paid leave types (the default) never reach this — they cost nothing,
// exactly as before this change. Joins by leave_type_id when present,
// falls back to matching by name for older rows that predate the FK.
async function countUnpaidLeaveDays(employeeId, employeeSource, monthYear) {
  await ensureHrmSchema();
  const [year, month] = monthYear.split('-');
  const monthStart = `${year}-${month}-01`;
 const { rows } = await pool.query(
    `SELECT l.start_date, l.end_date
     FROM hrm_leaves l
     LEFT JOIN hrm_leave_types lt
       ON (l.leave_type_id IS NOT NULL AND lt.id = l.leave_type_id)
       OR (l.leave_type_id IS NULL AND lt.name = l.leave_type_name)
     WHERE l.employee_id = $1 AND l.employee_source = $2
       AND l.status = 'Approved'
       AND COALESCE(lt.affects_payroll, NOT COALESCE(lt.is_paid, TRUE)) = TRUE
       AND l.start_date < ($3::date + INTERVAL '1 month')
       AND l.end_date >= $3::date`,
    [String(employeeId), employeeSource, monthStart]
  );
  const monthStartDate = new Date(monthStart);
  const monthEndDate = new Date(monthStartDate);
  monthEndDate.setMonth(monthEndDate.getMonth() + 1);

  let totalDays = 0;
  for (const r of rows) {
    const s = new Date(r.start_date) < monthStartDate ? monthStartDate : new Date(r.start_date);
    const e = new Date(r.end_date) >= monthEndDate ? new Date(monthEndDate.getTime() - 86400000) : new Date(r.end_date);
    const days = Math.round((e - s) / 86400000) + 1;
    if (days > 0) totalDays += days;
  }
  return totalDays;
}
// Per-day rate = gross earnings ÷ working days per month, using the
// existing hrm_settings.work_days_per_week (falls back to 5/week ≈ 22/month).
async function getPerDayRate(grossEarnings) {
  const { rows } = await pool.query(`SELECT work_days_per_week FROM hrm_settings LIMIT 1`);
  const perWeek = rows[0]?.work_days_per_week || 5;
  const perMonth = Math.round(perWeek * 4.33); // avg weeks/month
  return perMonth > 0 ? grossEarnings / perMonth : 0;
}
// Syncs hrm_attendance for each day of an approved leave, driven by the
// leave type's count_as_present/count_as_absent flags. Never overwrites
// a real clock-in (Present/Late) — only fills days that are blank or
// were wrongly marked Absent, so it can't clobber genuine attendance data.
async function syncAttendanceForLeave(leave) {
  if (leave.status !== 'Approved') return;
  const typeRes = await pool.query(
    `SELECT count_as_present, count_as_absent FROM hrm_leave_types
     WHERE id = $1 OR name = $2 LIMIT 1`,
    [leave.leave_type_id, leave.leave_type_name]
  );
  const lt = typeRes.rows[0] || { count_as_present: true, count_as_absent: false };
  const attStatus = lt.count_as_absent ? 'Absent' : (lt.count_as_present ? 'On Leave' : 'On Leave');

  const start = new Date(leave.start_date);
  const end = new Date(leave.end_date);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    await pool.query(
      `INSERT INTO hrm_attendance (employee_name, employee_id, employee_source, attendance_date, status)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (employee_name, attendance_date)
       DO UPDATE SET status = $5
       WHERE hrm_attendance.status NOT IN ('Present','Late')`,
      [leave.employee_name, leave.employee_id, leave.employee_source || 'user', dateStr, attStatus]
    );
  }
}

module.exports = {
  // Departments
  fetchDepartments, createDepartment, updateDepartment, deleteDepartment,
  // Designations
  fetchDesignations, createDesignation, updateDesignation, deleteDesignation,
  // Leave Types
  fetchLeaveTypes, createLeaveType, updateLeaveType, deleteLeaveType,
  // Leaves
  fetchLeaves, createLeave, updateLeave, updateLeaveStatus, deleteLeave,
  // Shifts
  fetchShifts, createShift, updateShift, deleteShift,
  // Attendance
fetchAttendance, clockIn, clockOut, fetchAttendanceStats,
  createAttendanceRecord, updateAttendanceRecord, deleteAttendanceRecord,
  // Payroll
  fetchPayrolls, createPayroll, updatePayroll, deletePayroll,
  fetchEligibleEmployeesForRun, computeEmployeePayroll, runPayrollForEmployee, runPayrollBulk, fetchPayrollItems,
// Pay Components
  fetchPayComponents, createPayComponent, updatePayComponent, deletePayComponent,
// Payroll Groups
  fetchPayrollGroups, createPayrollGroup, updatePayrollGroup, deletePayrollGroup,
fetchGroupComponents, setGroupComponents,
  fetchEmployeesWithGroups, assignPayrollGroup,
  // Employees (non-login)
  fetchEmployees, createEmployee, updateEmployee, deleteEmployee, enableEmployeeLogin,
 // Holidays
  fetchHolidays, createHoliday, updateHoliday, deleteHoliday, fetchMyHolidays,
  // Sales Targets
  fetchSalesTargets, createSalesTarget, updateSalesTarget, deleteSalesTarget, fetchMySalesTarget,
  fetchSettings, updateSettings,
  // Dashboard
  fetchDashboardStats,
// Employee Self-Service (ESS)
  fetchMyProfile, updateMyProfile,
  fetchMyAttendance, fetchMyAttendanceStats, clockInSelf, clockOutSelf,
  fetchMyLeaves, fetchMyLeaveBalance, applyMyLeave, cancelMyLeave,
  fetchMyLeaveNotifications, markLeaveNotificationSeen,
  fetchMyPayroll, fetchMyPayrollItems,
};