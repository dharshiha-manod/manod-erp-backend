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

// Prevent node-postgres from converting DATE columns into JS Date objects.
// JS Date objects are timezone-sensitive and can silently shift the
// calendar day backward/forward depending on the server's local timezone.
// Keeping raw 'YYYY-MM-DD' strings avoids that entirely.
types.setTypeParser(1082, (val) => val);

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

async function createDepartment({ name, description }) {
  if (!name) throw new Error('Department name is required');
  const code = 'DEPT-' + name.slice(0, 4).toUpperCase().replace(/\s/g, '');
  const { rows } = await pool.query(
    `INSERT INTO hrm_departments (dept_code, name, description)
     VALUES ($1, $2, $3) RETURNING *`,
    [code, name, description || null]
  );
  return rows[0];
}

async function updateDepartment(id, { name, description, dept_code }) {
  const { rows } = await pool.query(
    `UPDATE hrm_departments SET name=$1, description=$2, dept_code=COALESCE($3, dept_code), updated_at=NOW()
     WHERE id=$4 RETURNING *`,
    [name, description, dept_code || null, id]
  );
  if (!rows.length) throw new Error('Department not found');
  return rows[0];
}

async function deleteDepartment(id) {
  await pool.query(`DELETE FROM hrm_departments WHERE id=$1`, [id]);
}

// ── DESIGNATIONS ─────────────────────────────────────────────

async function fetchDesignations() {
  const { rows } = await pool.query(
    `SELECT id, name, description, created_at FROM hrm_designations ORDER BY id`
  );
  return rows;
}

async function createDesignation({ name, description }) {
  if (!name) throw new Error('Designation name is required');
  const { rows } = await pool.query(
    `INSERT INTO hrm_designations (name, description)
     VALUES ($1, $2) RETURNING *`,
    [name, description || null]
  );
  return rows[0];
}

async function updateDesignation(id, { name, description }) {
  const { rows } = await pool.query(
    `UPDATE hrm_designations SET name=$1, description=$2, updated_at=NOW()
     WHERE id=$3 RETURNING *`,
    [name, description, id]
  );
  if (!rows.length) throw new Error('Designation not found');
  return rows[0];
}

async function deleteDesignation(id) {
  await pool.query(`DELETE FROM hrm_designations WHERE id=$1`, [id]);
}

// ── LEAVE TYPES ──────────────────────────────────────────────

async function fetchLeaveTypes() {
  const { rows } = await pool.query(
    `SELECT id, name, max_count, interval, created_at FROM hrm_leave_types ORDER BY id`
  );
  return rows;
}

async function createLeaveType({ name, max_count, interval }) {
  if (!name) throw new Error('Leave type name is required');
  const { rows } = await pool.query(
    `INSERT INTO hrm_leave_types (name, max_count, interval)
     VALUES ($1, $2, $3) RETURNING *`,
    [name, max_count || 0, interval || 'None']
  );
  return rows[0];
}

async function updateLeaveType(id, { name, max_count, interval }) {
  const { rows } = await pool.query(
    `UPDATE hrm_leave_types SET name=$1, max_count=$2, interval=$3, updated_at=NOW()
     WHERE id=$4 RETURNING *`,
    [name, max_count, interval, id]
  );
  if (!rows.length) throw new Error('Leave type not found');
  return rows[0];
}

async function deleteLeaveType(id) {
  await pool.query(`DELETE FROM hrm_leave_types WHERE id=$1`, [id]);
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

async function createLeave({ leave_type_id, leave_type_name, employee_name, start_date, end_date, reason }, createdBy) {
  if (!employee_name || !start_date || !end_date)
    throw new Error('Employee, start date and end date are required');

  const ref = await nextLeaveRef();
  const { rows } = await pool.query(
    `INSERT INTO hrm_leaves
       (reference_no, leave_type_id, leave_type_name, employee_name, start_date, end_date, reason, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'Pending',$8) RETURNING *`,
    [ref, leave_type_id || null, leave_type_name || '', employee_name, start_date, end_date, reason || '', createdBy || null]
  );
  return rows[0];
}

async function updateLeaveStatus(id, status) {
  const allowed = ['Pending', 'Approved', 'Rejected'];
  if (!allowed.includes(status)) throw new Error('Invalid status');
  const { rows } = await pool.query(
    `UPDATE hrm_leaves SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
    [status, id]
  );
  if (!rows.length) throw new Error('Leave not found');
  return rows[0];
}

async function updateLeave(id, data) {
  const { leave_type_name, employee_name, start_date, end_date, reason, status } = data;
  const { rows } = await pool.query(
    `UPDATE hrm_leaves
     SET leave_type_name=$1, employee_name=$2, start_date=$3, end_date=$4, reason=$5, status=$6, updated_at=NOW()
     WHERE id=$7 RETURNING *`,
    [leave_type_name, employee_name, start_date, end_date, reason, status, id]
  );
  if (!rows.length) throw new Error('Leave not found');
  return rows[0];
}

async function deleteLeave(id) {
  await pool.query(`DELETE FROM hrm_leaves WHERE id=$1`, [id]);
}

// ── SHIFTS ───────────────────────────────────────────────────

async function fetchShifts() {
  const { rows } = await pool.query(
    `SELECT id, name, shift_type, start_time, end_time, holiday_day FROM hrm_shifts ORDER BY id`
  );
  return rows;
}

async function createShift({ name, shift_type, start_time, end_time, holiday_day }) {
  if (!name || !start_time || !end_time) throw new Error('Name, start time and end time are required');
  const { rows } = await pool.query(
    `INSERT INTO hrm_shifts (name, shift_type, start_time, end_time, holiday_day)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [name, shift_type || 'Fixed shift', start_time, end_time, holiday_day || null]
  );
  return rows[0];
}

async function updateShift(id, data) {
  const { name, shift_type, start_time, end_time, holiday_day } = data;
  const { rows } = await pool.query(
    `UPDATE hrm_shifts SET name=$1, shift_type=$2, start_time=$3, end_time=$4, holiday_day=$5, updated_at=NOW()
     WHERE id=$6 RETURNING *`,
    [name, shift_type, start_time, end_time, holiday_day, id]
  );
  if (!rows.length) throw new Error('Shift not found');
  return rows[0];
}

async function deleteShift(id) {
  await pool.query(`DELETE FROM hrm_shifts WHERE id=$1`, [id]);
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

async function clockIn({ employee_name, employee_id, department, note }, createdBy) {
  const today = new Date().toISOString().split('T')[0];
  const now   = new Date().toTimeString().slice(0, 5);

  // Determine status (late if after 09:30)
  const status = now > '09:30' ? 'Late' : 'Present';

  const { rows } = await pool.query(
    `INSERT INTO hrm_attendance (employee_name, employee_id, attendance_date, clock_in, status, department, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (employee_name, attendance_date)
     DO UPDATE SET clock_in=$4, status=$5, note=$7, updated_at=NOW()
     RETURNING *`,
    [employee_name || 'Admin', employee_id || null, today, now, status, department || 'Admin', note || '']
  );
  return rows[0];
}
async function clockOut(id) {
  const now = new Date().toTimeString().slice(0, 5);
  const { rows } = await pool.query(
    `UPDATE hrm_attendance SET clock_out=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
    [now, id]
  );
  if (!rows.length) throw new Error('Attendance record not found');
  return rows[0];
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

async function createAttendanceRecord({ employee_name, employee_id, attendance_date, clock_in, clock_out, status, department, note, shift_name }) {
  if (!employee_name || !attendance_date || !status) throw new Error('Employee, date and status are required');
  const { rows } = await pool.query(
    `INSERT INTO hrm_attendance (employee_name, employee_id, attendance_date, clock_in, clock_out, status, department, note, shift_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (employee_name, attendance_date)
     DO UPDATE SET clock_in=$4, clock_out=$5, status=$6, department=$7, note=$8, shift_name=$9, updated_at=NOW()
     RETURNING *`,
    [employee_name, employee_id || null, attendance_date, clock_in || null, clock_out || null, status, department || null, note || '', shift_name || null]
  );
  return rows[0];
}
async function updateAttendanceRecord(id, data) {
  const { employee_name, attendance_date, clock_in, clock_out, status, department, shift_name } = data;
  const { rows } = await pool.query(
    `UPDATE hrm_attendance SET employee_name=$1, attendance_date=$2, clock_in=$3, clock_out=$4, status=$5, department=$6, shift_name=$7, updated_at=NOW()
     WHERE id=$8 RETURNING *`,
    [employee_name, attendance_date, clock_in || null, clock_out || null, status, department || null, shift_name || null, id]
  );
  if (!rows.length) throw new Error('Attendance record not found');
  return rows[0];
}

async function deleteAttendanceRecord(id) {
  await pool.query(`DELETE FROM hrm_attendance WHERE id=$1`, [id]);
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

async function createPayroll({ employee_name, employee_id, department, designation, month_year, net_salary }, createdBy) {
  if (!employee_name || !month_year) throw new Error('Employee and month/year are required');
  const ref = await nextPayrollRef();
  const { rows } = await pool.query(
    `INSERT INTO hrm_payroll
       (reference_no, employee_name, employee_id, department, designation, month_year, net_salary, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'Pending',$8) RETURNING *`,
    [ref, employee_name, employee_id || null, department || '—', designation || '—', month_year, net_salary || 0, createdBy || null]
  );
  return rows[0];
}

// ── PAYROLL PROCESSING ENGINE ────────────────────────────────

async function fetchEligibleEmployeesForRun(monthYear) {
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.payroll_group_id, pg.name AS payroll_group_name
     FROM users u
     JOIN hrm_payroll_groups pg ON pg.id = u.payroll_group_id
     WHERE u.payroll_group_id IS NOT NULL
       AND u.id NOT IN (
         SELECT employee_id FROM hrm_payroll
         WHERE month_year = $1 AND employee_id IS NOT NULL
       )
     ORDER BY u.full_name`,
    [monthYear]
  );
  return rows;
}

async function computeEmployeePayroll(employeeId) {
  const empRes = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.payroll_group_id, pg.name AS payroll_group_name
     FROM users u
     LEFT JOIN hrm_payroll_groups pg ON pg.id = u.payroll_group_id
     WHERE u.id = $1`,
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
    `SELECT pay_component_id, override_amount FROM hrm_employee_component_overrides WHERE employee_id = $1`,
    [employeeId]
  );
  const overrideMap = Object.fromEntries(overrideRes.rows.map(o => [o.pay_component_id, Number(o.override_amount)]));

  let grossEarnings = 0;
  const earningComponents = compRes.rows.filter(c => c.component_type === 'Earning');
  const items = [];

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

  const netSalary = Math.round((grossEarnings - totalDeductions) * 100) / 100;

  return {
    employee: emp,
    items,
    grossEarnings,
    totalDeductions,
    netSalary,
  };
}

async function runPayrollForEmployee(employeeId, monthYear, createdBy) {
  const calc = await computeEmployeePayroll(employeeId);
  const ref = await nextPayrollRef();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const payrollRes = await client.query(
      `INSERT INTO hrm_payroll
         (reference_no, employee_name, employee_id, department, designation, month_year,
          net_salary, gross_salary, total_deductions, status, payroll_group_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Pending',$10,$11) RETURNING *`,
      [
        ref, calc.employee.full_name, employeeId, '—', '—', monthYear,
        calc.netSalary, calc.grossEarnings, calc.totalDeductions,
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
    return payrollRes.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function runPayrollBulk(employeeIds, monthYear, createdBy) {
  const results = [];
  const errors = [];
  for (const id of employeeIds) {
    try {
      const rec = await runPayrollForEmployee(id, monthYear, createdBy);
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

async function updatePayroll(id, data) {
  const { employee_name, department, designation, month_year, net_salary, status } = data;

  const before = await pool.query(`SELECT status FROM hrm_payroll WHERE id = $1`, [id]);
  const prevStatus = before.rows[0]?.status;

  const { rows } = await pool.query(
    `UPDATE hrm_payroll
     SET employee_name=$1, department=$2, designation=$3, month_year=$4, net_salary=$5, status=$6, updated_at=NOW()
     WHERE id=$7 RETURNING *`,
    [employee_name, department, designation, month_year, net_salary, status, id]
  );
  if (!rows.length) throw new Error('Payroll not found');
  const payroll = rows[0];

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

async function deletePayroll(id) {
  await pool.query(`DELETE FROM hrm_payroll WHERE id=$1`, [id]);
}

// ── PAY COMPONENTS ───────────────────────────────────────────
async function fetchPayComponents() {
  const { rows } = await pool.query(
    `SELECT id, description, component_type, amount, calc_method, status, applicable_from FROM hrm_pay_components ORDER BY id`
  );
  return rows;
}

async function createPayComponent({ description, component_type, amount, calc_method, status, applicable_from }) {
  if (!description) throw new Error('Description is required');
  const { rows } = await pool.query(
    `INSERT INTO hrm_pay_components (description, component_type, amount, calc_method, status, applicable_from)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [description, component_type || 'Earning', amount || 0, calc_method || 'Fixed', status || 'Active', applicable_from || null]
  );
  return rows[0];
}

async function updatePayComponent(id, data) {
  const { description, component_type, amount, calc_method, status, applicable_from } = data;
  const { rows } = await pool.query(
    `UPDATE hrm_pay_components SET description=$1, component_type=$2, amount=$3, calc_method=$4, status=$5, applicable_from=$6, updated_at=NOW()
     WHERE id=$7 RETURNING *`,
    [description, component_type, amount, calc_method, status, applicable_from, id]
  );
  if (!rows.length) throw new Error('Pay component not found');
  return rows[0];
}

async function deletePayComponent(id) {
  await pool.query(`DELETE FROM hrm_pay_components WHERE id=$1`, [id]);
}

// ── PAYROLL GROUPS ───────────────────────────────────────────

async function fetchPayrollGroups() {
  const { rows } = await pool.query(
    `SELECT id, name, pay_schedule, employee_count, description, created_at FROM hrm_payroll_groups ORDER BY id`
  );
  return rows;
}

async function createPayrollGroup({ name, pay_schedule, employee_count, description }) {
  if (!name) throw new Error('Group name is required');
  const { rows } = await pool.query(
    `INSERT INTO hrm_payroll_groups (name, pay_schedule, employee_count, description)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, pay_schedule || 'Monthly', employee_count || 0, description || '']
  );
  return rows[0];
}

async function updatePayrollGroup(id, data) {
  const { name, pay_schedule, employee_count, description } = data;
  const { rows } = await pool.query(
    `UPDATE hrm_payroll_groups SET name=$1, pay_schedule=$2, employee_count=$3, description=$4, updated_at=NOW()
     WHERE id=$5 RETURNING *`,
    [name, pay_schedule, employee_count, description, id]
  );
  if (!rows.length) throw new Error('Payroll group not found');
  return rows[0];
}

async function deletePayrollGroup(id) {
  await pool.query(`DELETE FROM hrm_payroll_groups WHERE id=$1`, [id]);
}

async function fetchEmployeesWithGroups() {
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.payroll_group_id, pg.name AS payroll_group_name
     FROM users u
     LEFT JOIN hrm_payroll_groups pg ON pg.id = u.payroll_group_id
     ORDER BY u.full_name`
  );
  return rows;
}

async function assignPayrollGroup(userId, payrollGroupId) {
  const { rows } = await pool.query(
    `UPDATE users SET payroll_group_id=$1 WHERE id=$2 RETURNING id, full_name, email, payroll_group_id`,
    [payrollGroupId || null, userId]
  );
  if (!rows.length) throw new Error('Employee not found');

  // Keep the group's employee_count in sync
  await pool.query(
    `UPDATE hrm_payroll_groups SET employee_count = (
       SELECT COUNT(*) FROM users WHERE payroll_group_id = hrm_payroll_groups.id
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

async function fetchHolidays() {
  const { rows } = await pool.query(
    `SELECT id, name, start_date, end_date, duration, location, note FROM hrm_holidays ORDER BY start_date`
  );
  return rows;
}

async function createHoliday({ name, start_date, end_date, location, note }) {
  if (!name || !start_date || !end_date) throw new Error('Name and dates are required');
  const s = new Date(start_date), e = new Date(end_date);
  const days = Math.max(1, Math.round((e - s) / 86400000) + 1);
  const duration = `${days} day${days > 1 ? 's' : ''}`;
  const { rows } = await pool.query(
    `INSERT INTO hrm_holidays (name, start_date, end_date, duration, location, note)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [name, start_date, end_date, duration, location || 'All Locations', note || '']
  );
  return rows[0];
}

async function updateHoliday(id, data) {
  const { name, start_date, end_date, location, note } = data;
  const s = new Date(start_date), e = new Date(end_date);
  const days = Math.max(1, Math.round((e - s) / 86400000) + 1);
  const { rows } = await pool.query(
    `UPDATE hrm_holidays SET name=$1, start_date=$2, end_date=$3, duration=$4, location=$5, note=$6, updated_at=NOW()
     WHERE id=$7 RETURNING *`,
    [name, start_date, end_date, `${days} day${days > 1 ? 's' : ''}`, location, note, id]
  );
  if (!rows.length) throw new Error('Holiday not found');
  return rows[0];
}

async function deleteHoliday(id) {
  await pool.query(`DELETE FROM hrm_holidays WHERE id=$1`, [id]);
}

// ── SALES TARGETS ────────────────────────────────────────────

async function fetchSalesTargets({ month_year = '' } = {}) {
  const where = month_year ? `WHERE month_year = $1` : '';
  const values = month_year ? [month_year] : [];
  const { rows } = await pool.query(
    `SELECT * FROM hrm_sales_targets ${where} ORDER BY id`, values
  );
  return rows;
}

async function createSalesTarget({ employee_name, target_amount, commission_pct, month_year }) {
  if (!employee_name || !target_amount) throw new Error('Employee and target amount are required');
  const { rows } = await pool.query(
    `INSERT INTO hrm_sales_targets (employee_name, target_amount, commission_pct, month_year)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [employee_name, target_amount, commission_pct || 0, month_year || '']
  );
  return rows[0];
}

async function updateSalesTarget(id, data) {
  const { employee_name, target_amount, commission_pct, month_year, achieved_amount } = data;
  const { rows } = await pool.query(
    `UPDATE hrm_sales_targets SET employee_name=$1, target_amount=$2, commission_pct=$3, month_year=$4, achieved_amount=$5, updated_at=NOW()
     WHERE id=$6 RETURNING *`,
    [employee_name, target_amount, commission_pct, month_year, achieved_amount || 0, id]
  );
  if (!rows.length) throw new Error('Sales target not found');
  return rows[0];
}

async function deleteSalesTarget(id) {
  await pool.query(`DELETE FROM hrm_sales_targets WHERE id=$1`, [id]);
}

// ── DASHBOARD STATS ──────────────────────────────────────────
// NEW
// ── SETTINGS ─────────────────────────────────────────────────

async function fetchSettings() {
  const { rows } = await pool.query(
    `SELECT * FROM hrm_settings WHERE id = 1`
  );
  if (!rows.length) throw new Error('Settings not found');
  return rows[0];
}

async function updateSettings(data) {
  const {
    work_days_per_week, work_hours_per_day, overtime_rate_multiplier,
    currency, payslip_note, leave_approval, attendance_mode,
    leave_prefix, max_casual_leave_days, auto_approval_after_days, auto_approval_enabled, leave_instructions,
    payroll_cycle, payroll_date, payroll_currency,
    work_start_time, work_end_time, late_grace_minutes,
  } = data;

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
  return rows[0];
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
  // Holidays
fetchHolidays, createHoliday, updateHoliday, deleteHoliday,
  // Sales Targets
 fetchSalesTargets, createSalesTarget, updateSalesTarget, deleteSalesTarget,
   fetchSettings, updateSettings,
  // Dashboard
  fetchDashboardStats,
};