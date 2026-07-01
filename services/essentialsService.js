/**
 * services/essentialsService.js
 * Mirrors the style of services/expenseService.js
 */

'use strict';

const pool = require('../config/database');

/* ────────────────────────────────────────────────────────────
   TO-DO
──────────────────────────────────────────────────────────── */
const generateTaskId = async () => {
  const result = await pool.query(
    `SELECT task_id FROM essentials_todos ORDER BY id DESC LIMIT 1`
  );
  let next = 1;
  if (result.rows.length > 0) {
    const lastNum = parseInt(String(result.rows[0].task_id).replace(/\D/g, ''), 10);
    if (!isNaN(lastNum)) next = lastNum + 1;
  }
  return `TASK-${String(next).padStart(3, '0')}`;
};

const fetchAllTodos = async (filters = {}) => {
  const { assigned_to = '', priority = '', status = '' } = filters;
  const params = [];
  const where = [];

  if (assigned_to) { params.push(assigned_to); where.push(`assigned_to = $${params.length}`); }
  if (priority)    { params.push(priority);    where.push(`priority = $${params.length}`); }
  if (status)      { params.push(status);      where.push(`status = $${params.length}`); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT * FROM essentials_todos ${whereSql} ORDER BY id DESC`, params
  );
  return result.rows;
};

const fetchTodoById = async (id) => {
  const result = await pool.query(`SELECT * FROM essentials_todos WHERE id = $1`, [id]);
  return result.rows[0] || null;
};

const createTodo = async (data, userId, userName) => {
  const {
    task, description, assigned_to, priority = 'Medium', status = 'Not Started',
    start_date, end_date, hours,
  } = data;

  if (!task || !task.trim()) throw new Error('Task name is required');

  const taskId = await generateTaskId();
  const result = await pool.query(
    `INSERT INTO essentials_todos
       (task_id, task, description, assigned_to, assigned_by, priority, status,
        start_date, end_date, hours, added_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
     RETURNING *`,
    [taskId, task, description || null, assigned_to || null, data.assigned_by || userName || null,
     priority, status, start_date || null, end_date || null, hours || null, userId]
  );
  return result.rows[0];
};

const updateTodo = async (id, data) => {
  const existing = await fetchTodoById(id);
  if (!existing) throw new Error('Task not found');

  const fields = ['task', 'description', 'assigned_to', 'assigned_by', 'priority', 'status', 'start_date', 'end_date', 'hours'];
  const sets = [];
  const params = [];
  fields.forEach((f) => {
    if (data[f] !== undefined) {
      params.push(data[f] === '' ? null : data[f]);
      sets.push(`${f} = $${params.length}`);
    }
  });
  if (sets.length === 0) return existing;
  params.push(id);
  sets.push('updated_at = NOW()');

  const result = await pool.query(
    `UPDATE essentials_todos SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return result.rows[0];
};

const deleteTodo = async (id) => {
  const result = await pool.query(`DELETE FROM essentials_todos WHERE id = $1 RETURNING id`, [id]);
  if (result.rows.length === 0) throw new Error('Task not found');
  return result.rows[0];
};

/* ────────────────────────────────────────────────────────────
   DOCUMENTS
──────────────────────────────────────────────────────────── */
const fetchAllDocuments = async () => {
  const result = await pool.query(`SELECT * FROM essentials_documents ORDER BY id DESC`);
  return result.rows;
};

const createDocument = async (data, userId) => {
  const { name, description, type, size, file_url } = data;
  if (!name || !name.trim()) throw new Error('File name is required');

  const result = await pool.query(
    `INSERT INTO essentials_documents (name, description, type, size, file_url, uploaded_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
    [name, description || null, (type || 'FILE').toUpperCase(), size || null, file_url || null, userId]
  );
  return result.rows[0];
};

const deleteDocument = async (id) => {
  const result = await pool.query(`DELETE FROM essentials_documents WHERE id = $1 RETURNING id`, [id]);
  if (result.rows.length === 0) throw new Error('Document not found');
  return result.rows[0];
};

/* ────────────────────────────────────────────────────────────
   MEMOS
──────────────────────────────────────────────────────────── */
const fetchAllMemos = async () => {
  const result = await pool.query(`SELECT * FROM essentials_memos ORDER BY id DESC`);
  return result.rows;
};

const createMemo = async (data, userId) => {
  const { heading, description } = data;
  if (!heading || !heading.trim()) throw new Error('Heading is required');

  const result = await pool.query(
    `INSERT INTO essentials_memos (heading, description, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,NOW(),NOW()) RETURNING *`,
    [heading, description || null, userId]
  );
  return result.rows[0];
};

const updateMemo = async (id, data) => {
  const { heading, description } = data;
  if (!heading || !heading.trim()) throw new Error('Heading is required');

  const result = await pool.query(
    `UPDATE essentials_memos SET heading = $1, description = $2, updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [heading, description || null, id]
  );
  if (result.rows.length === 0) throw new Error('Memo not found');
  return result.rows[0];
};

const deleteMemo = async (id) => {
  const result = await pool.query(`DELETE FROM essentials_memos WHERE id = $1 RETURNING id`, [id]);
  if (result.rows.length === 0) throw new Error('Memo not found');
  return result.rows[0];
};

/* ────────────────────────────────────────────────────────────
   REMINDERS
──────────────────────────────────────────────────────────── */
const fetchAllReminders = async () => {
  const result = await pool.query(`SELECT * FROM essentials_reminders ORDER BY event_date ASC`);
  return result.rows;
};

const createReminder = async (data, userId) => {
  const { name, event_date, start_time, end_time, repeat_type = 'One time' } = data;
  if (!name || !name.trim() || !event_date) throw new Error('Name and date are required');

  const result = await pool.query(
    `INSERT INTO essentials_reminders (name, event_date, start_time, end_time, repeat_type, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
    [name, event_date, start_time || null, end_time || null, repeat_type, userId]
  );
  return result.rows[0];
};

const deleteReminder = async (id) => {
  const result = await pool.query(`DELETE FROM essentials_reminders WHERE id = $1 RETURNING id`, [id]);
  if (result.rows.length === 0) throw new Error('Reminder not found');
  return result.rows[0];
};

/* ────────────────────────────────────────────────────────────
   MESSAGES
──────────────────────────────────────────────────────────── */
const fetchContacts = async (myId) => {
  const result = await pool.query(
    `SELECT id, full_name, email FROM users WHERE id != $1 ORDER BY full_name ASC`,
    [myId]
  );
  return result.rows;
};

const fetchConversation = async (myId, otherId) => {
  if (!otherId) throw new Error('recipient_id is required');
  const result = await pool.query(
    `SELECT m.*, u.full_name AS sender_name
     FROM essentials_messages m
     JOIN users u ON u.id = m.sender_id
     WHERE (m.sender_id = $1 AND m.recipient_id = $2)
        OR (m.sender_id = $2 AND m.recipient_id = $1)
     ORDER BY m.id ASC`,
    [myId, otherId]
  );
  return result.rows;
};

const createMessage = async (data, userId) => {
  const { text, recipient_id } = data;
  if (!text || !text.trim()) throw new Error('Message text is required');
  if (!recipient_id) throw new Error('recipient_id is required');

  const result = await pool.query(
    `INSERT INTO essentials_messages (sender_id, recipient_id, message, created_at)
     VALUES ($1,$2,$3,NOW()) RETURNING *`,
    [userId, recipient_id, text]
  );
  const withName = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [userId]);
  return { ...result.rows[0], sender_name: withName.rows[0]?.full_name };
};
/* ────────────────────────────────────────────────────────────
   KNOWLEDGE BASE
──────────────────────────────────────────────────────────── */
const fetchAllKb = async (search = '') => {
  const params = [];
  let whereSql = '';
  if (search) {
    params.push(`%${search}%`);
    whereSql = `WHERE title ILIKE $1 OR content ILIKE $1`;
  }
  const result = await pool.query(
    `SELECT * FROM essentials_kb_articles ${whereSql} ORDER BY id DESC`, params
  );
  return result.rows;
};

const createKb = async (data, userId) => {
  const { title, content, visibility = 'Public' } = data;
  if (!title || !title.trim()) throw new Error('Title is required');

  const result = await pool.query(
    `INSERT INTO essentials_kb_articles (title, content, visibility, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,NOW(),NOW()) RETURNING *`,
    [title, content || null, visibility, userId]
  );
  return result.rows[0];
};

const updateKb = async (id, data) => {
  const { title, content, visibility } = data;
  if (!title || !title.trim()) throw new Error('Title is required');

  const result = await pool.query(
    `UPDATE essentials_kb_articles
     SET title = $1, content = $2, visibility = $3, updated_at = NOW()
     WHERE id = $4 RETURNING *`,
    [title, content || null, visibility || 'Public', id]
  );
  if (result.rows.length === 0) throw new Error('Article not found');
  return result.rows[0];
};

const deleteKb = async (id) => {
  const result = await pool.query(`DELETE FROM essentials_kb_articles WHERE id = $1 RETURNING id`, [id]);
  if (result.rows.length === 0) throw new Error('Article not found');
  return result.rows[0];
};

/* ────────────────────────────────────────────────────────────
   SETTINGS (singleton row, id = 1)
──────────────────────────────────────────────────────────── */
const fetchSettings = async () => {
  const result = await pool.query(`SELECT * FROM essentials_settings WHERE id = 1`);
  return result.rows[0] || null;
};

const updateSettings = async (data) => {
  const fields = [
    'leave_prefix', 'max_leave_days', 'auto_approve_after', 'auto_approval', 'leave_instructions',
    'payroll_cycle', 'payroll_date', 'currency', 'work_start', 'work_end', 'late_grace',
  ];
  const sets = [];
  const params = [];
  fields.forEach((f) => {
    if (data[f] !== undefined) {
      params.push(data[f] === '' ? null : data[f]);
      sets.push(`${f} = $${params.length}`);
    }
  });
  if (sets.length === 0) return fetchSettings();
  sets.push('updated_at = NOW()');

  const result = await pool.query(
    `UPDATE essentials_settings SET ${sets.join(', ')} WHERE id = 1 RETURNING *`,
    params
  );
  return result.rows[0];
};

module.exports = {
  // todos
  fetchAllTodos, fetchTodoById, createTodo, updateTodo, deleteTodo,
  // documents
  fetchAllDocuments, createDocument, deleteDocument,
  // memos
  fetchAllMemos, createMemo, updateMemo, deleteMemo,
  // reminders
  fetchAllReminders, createReminder, deleteReminder,
  // messages
  fetchContacts, fetchConversation, createMessage,
  // kb
  fetchAllKb, createKb, updateKb, deleteKb,
  // settings
  fetchSettings, updateSettings,
};