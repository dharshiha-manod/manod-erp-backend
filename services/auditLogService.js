const pool = require('../config/database');

const logAudit = async ({ businessId, userId, userName, module, action, recordId, recordLabel, oldData, newData, ip }) => {
  try {
    await pool.query(
      `INSERT INTO audit_logs (business_id, user_id, user_name, module, action, record_id, record_label, old_data, new_data, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [businessId||null, userId||null, userName||null, module, action, recordId?String(recordId):null,
       recordLabel||null, oldData?JSON.stringify(oldData):null, newData?JSON.stringify(newData):null, ip||null]
    );
  } catch (err) {
    console.error('[auditLog] failed:', err.message); // never throws — logging must never break the real action
  }
};

const fetchLogs = async (filters = {}) => {
  const { page=1, limit=25, module='', action='', user_id='', date_from='', date_to='' } = filters;
  const offset = (parseInt(page,10)-1) * parseInt(limit,10);
  const params = []; const wheres = [];
  if (module)   { params.push(module);   wheres.push(`module = $${params.length}`); }
  if (action)   { params.push(action);   wheres.push(`action = $${params.length}`); }
  if (user_id)  { params.push(user_id);  wheres.push(`user_id = $${params.length}`); }
  if (date_from){ params.push(date_from);wheres.push(`created_at >= $${params.length}`); }
  if (date_to)  { params.push(date_to);  wheres.push(`created_at <= $${params.length}`); }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const total = await pool.query(`SELECT COUNT(*) FROM audit_logs ${where}`, params);
  params.push(parseInt(limit,10)); params.push(offset);
  const rows = await pool.query(
    `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`, params
  );
  return { rows: rows.rows, total: parseInt(total.rows[0].count,10) };
};

const deleteLog = async (id) => {
  const { rows } = await pool.query(`DELETE FROM audit_logs WHERE id = $1 RETURNING id`, [id]);
  return rows[0] || null;
};

module.exports = { logAudit, fetchLogs, deleteLog };