  /**
   * services/essentialsService.js
   * Mirrors the style of services/expenseService.js
   */

  'use strict';

  const pool = require('../config/database');

  // ── SELF-HEALING UUID USER-ID COLUMNS ───────────────────────────────────
  // users.id is UUID everywhere in this project. A handful of essentials_*
  // columns that reference a user (created_by, published_by, updated_by,
  // uploaded_by, edited_by, user_id) were originally created as INTEGER.
  // Any query that JOINs/compares them against users.id or a request param
  // (which arrives as a uuid string) then fails with "operator does not
  // exist: uuid = integer" / "invalid input syntax for type integer" — this
  // is the exact cause of the /memos and /kb "Failed to fetch" 500s.
  // This converts any such column still typed INTEGER to UUID, once per
  // boot, per table+column — safe to re-run (no-op once already uuid).
  // Same approach as the one-off scripts/fix-essentials-published-by-uuid.js,
  // generalized and wired in automatically so it self-heals on every boot
  // instead of requiring a manual `node scripts/...` step.
  const fixUuidUserColumns = async (targets) => {
    for (const { table, column } of targets) {
      try {
        const { rows } = await pool.query(
          `SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
          [table, column]
        );
        const currentType = rows[0]?.data_type;
        if (!currentType || currentType === 'uuid') continue;
        await pool.query(
          `ALTER TABLE ${table} ALTER COLUMN ${column} TYPE UUID USING NULLIF(${column}::text, '')::uuid`
        );
        console.log(`✅ [essentialsService] Converted ${table}.${column} from ${currentType} to uuid`);
      } catch (e) {
        console.error(`⚠️ [essentialsService] Could not convert ${table}.${column} to uuid (non-fatal):`, e.message);
      }
    }
  };

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

  const fetchAllTodos = async (industryId, filters = {}) => {
    const {
      assigned_to = '', priority = '', status = '',
      task_type = '', assigned_to_id = '', link_type = '', link_id = '',
    } = filters;
    const params = [industryId];
    const where = ['t.industry_id = $1'];

    // legacy free-text filter kept for backward compatibility
    if (assigned_to)    { params.push(assigned_to);    where.push(`assigned_to = $${params.length}`); } 
    if (priority)        { params.push(priority);       where.push(`priority = $${params.length}`); }
    if (status)          { params.push(status);         where.push(`status = $${params.length}`); }
    if (task_type)        { params.push(task_type);       where.push(`task_type = $${params.length}`); }
    if (assigned_to_id)   { params.push(assigned_to_id);   where.push(`assigned_to_id = $${params.length}`); }
    if (link_type)         { params.push(link_type);         where.push(`link_type = $${params.length}`); }
    if (link_id)           { params.push(link_id);           where.push(`link_id = $${params.length}`); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT t.*,
              au.full_name AS assigned_to_name,
              ab.full_name AS assigned_by_name,
              (SELECT COUNT(*) FROM essentials_todo_comments c WHERE c.todo_id = t.id)    AS comment_count,
              (SELECT COUNT(*) FROM essentials_todo_attachments a WHERE a.todo_id = t.id) AS attachment_count,
              (SELECT COUNT(*) FROM essentials_todo_checklist cl WHERE cl.todo_id = t.id) AS checklist_total,
              (SELECT COUNT(*) FROM essentials_todo_checklist cl WHERE cl.todo_id = t.id AND cl.is_done) AS checklist_done
        FROM essentials_todos t
        LEFT JOIN users au ON au.id = t.assigned_to_id
        LEFT JOIN users ab ON ab.id = t.assigned_by_id
        ${whereSql}
        ORDER BY t.id DESC`,
      params
    );
    return result.rows;
  };

  const fetchTodoById = async (id, industryId) => {
    const result = await pool.query(
      `SELECT t.*, au.full_name AS assigned_to_name, ab.full_name AS assigned_by_name
        FROM essentials_todos t
        LEFT JOIN users au ON au.id = t.assigned_to_id
        LEFT JOIN users ab ON ab.id = t.assigned_by_id
        WHERE t.id = $1 AND t.industry_id = $2`,
      [id, industryId]
    );
    return result.rows[0] || null;
  };

  // Full detail bundle for the task drawer: task + comments + attachments + checklist + history
  const fetchTodoDetail = async (id, industryId) => {
    const todo = await fetchTodoById(id, industryId);
    if (!todo) return null;
    const [comments, attachments, checklist, history] = await Promise.all([
      pool.query(
        `SELECT c.*, u.full_name AS author_name
          FROM essentials_todo_comments c LEFT JOIN users u ON u.id = c.created_by
          WHERE c.todo_id = $1 ORDER BY c.id ASC`, [id]
      ),
      pool.query(`SELECT * FROM essentials_todo_attachments WHERE todo_id = $1 ORDER BY id DESC`, [id]),
      pool.query(`SELECT * FROM essentials_todo_checklist WHERE todo_id = $1 ORDER BY sort_order ASC, id ASC`, [id]),
      pool.query(
        `SELECT h.*, u.full_name AS changed_by_name
          FROM essentials_todo_history h LEFT JOIN users u ON u.id = h.changed_by
          WHERE h.todo_id = $1 ORDER BY h.id DESC`, [id]
      ),
    ]);

    return {
      ...todo,
      comments: comments.rows,
      attachments: attachments.rows,
      checklist: checklist.rows,
      history: history.rows,
    };
  };
  const createTodo = async (data, userId, userName, industryId) => {
    const {
      task, description, assigned_to, priority = 'Medium', status = 'Not Started',
      start_date, end_date, hours,
      task_type = 'Personal', assigned_to_id, progress = 0,
      is_recurring = false, recurrence_rule, recurrence_until,
      link_type, link_id, link_label, checklist,
    } = data;

    if (!task || !task.trim()) throw new Error('Task name is required');
    if (is_recurring && !recurrence_rule) throw new Error('Recurrence rule is required for recurring tasks');

    const taskId = await generateTaskId();
    const result = await pool.query(
      `INSERT INTO essentials_todos
        (task_id, task, description, assigned_to, assigned_by, priority, status,
          start_date, end_date, hours, added_by, task_type, assigned_to_id, assigned_by_id,
          progress, is_recurring, recurrence_rule, recurrence_until,
          link_type, link_id, link_label, industry_id, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW(),NOW())
      RETURNING *`,
      [taskId, task, description || null, assigned_to || null, data.assigned_by || userName || null,
      priority, status, start_date || null, end_date || null, hours || null, userId,
      task_type, assigned_to_id || null, userId,
      Number(progress) || 0, !!is_recurring, is_recurring ? recurrence_rule : null, is_recurring ? (recurrence_until || null) : null,
      link_type || null, link_id || null, link_label || null, industryId]
    );
    const todo = result.rows[0];

    // optional checklist seeded at creation time
    if (Array.isArray(checklist) && checklist.length) {
      const values = [];
      const params = [];
      checklist.forEach((item, i) => {
        const text = typeof item === 'string' ? item : item.item;
        if (!text || !text.trim()) return;
        params.push(todo.id, text, i);
        values.push(`($${params.length - 2}, $${params.length - 1}, $${params.length})`);
      });
      if (values.length) {
        await pool.query(
          `INSERT INTO essentials_todo_checklist (todo_id, item, sort_order) VALUES ${values.join(',')}`,
          params
        );
      }
    }

    await pool.query(
      `INSERT INTO essentials_todo_history (todo_id, field, old_value, new_value, changed_by)
      VALUES ($1,'created',NULL,$2,$3)`,
      [todo.id, status, userId]
    );

    return todo;
  };

  const updateTodo = async (id, data, userId, industryId) => {
    const existing = await fetchTodoById(id, industryId);
    if (!existing) throw new Error('Task not found');

    const fields = [
      'task', 'description', 'assigned_to', 'assigned_by', 'priority', 'status', 'start_date', 'end_date', 'hours',
      'task_type', 'assigned_to_id', 'progress', 'is_recurring', 'recurrence_rule', 'recurrence_until',
      'link_type', 'link_id', 'link_label',
    ];
    const sets = [];
    const params = [];
    fields.forEach((f) => {
      if (data[f] !== undefined) {
        params.push(data[f] === '' ? null : data[f]);
        sets.push(`${f} = $${params.length}`);
      }
    });
  if (sets.length === 0) return existing;
    params.push(id, industryId);
    sets.push('updated_at = NOW()');

    const result = await pool.query(
      `UPDATE essentials_todos SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND industry_id = $${params.length} RETURNING *`,
      params
    );
    const updated = result.rows[0];

    // history: log meaningful field changes (status/priority/assignee/progress)
    const tracked = ['status', 'priority', 'assigned_to_id', 'progress'];
    for (const f of tracked) {
      if (data[f] !== undefined && String(data[f]) !== String(existing[f])) {
        await pool.query(
          `INSERT INTO essentials_todo_history (todo_id, field, old_value, new_value, changed_by)
          VALUES ($1,$2,$3,$4,$5)`,
          [id, f, existing[f] != null ? String(existing[f]) : null, data[f] != null ? String(data[f]) : null, userId || null]
        );
      }
    }

    // completing a recurring task spawns the next occurrence
    if (data.status === 'Completed' && existing.status !== 'Completed' && updated.is_recurring) {
      await spawnNextRecurrence(updated);
    }

    return updated;
  };

  const spawnNextRecurrence = async (todo) => {
    if (!todo.end_date) return null;
    const step = { Daily: 1, Weekly: 7, Monthly: 30, Yearly: 365 }[todo.recurrence_rule];
    if (!step) return null;

    const next = new Date(todo.end_date);
    next.setDate(next.getDate() + step);
    if (todo.recurrence_until && next > new Date(todo.recurrence_until)) return null;

    const taskId = await generateTaskId();
    const result = await pool.query(
      `INSERT INTO essentials_todos
        (task_id, task, description, assigned_to, assigned_by, priority, status,
          start_date, end_date, hours, added_by, task_type, assigned_to_id, assigned_by_id,
          progress, is_recurring, recurrence_rule, recurrence_until,
          link_type, link_id, link_label, parent_task_id, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,'Not Started',$7,$8,$9,$10,$11,$12,$13,0,$14,$15,$16,$17,$18,$19,$20,NOW(),NOW())
      RETURNING *`,
      [taskId, todo.task, todo.description, todo.assigned_to, todo.assigned_by, todo.priority,
      next.toISOString().slice(0, 10), next.toISOString().slice(0, 10), todo.hours, todo.added_by,
      todo.task_type, todo.assigned_to_id, todo.assigned_by_id,
      todo.is_recurring, todo.recurrence_rule, todo.recurrence_until,
      todo.link_type, todo.link_id, todo.link_label, todo.id]
    );
    return result.rows[0];
  };

  const deleteTodo = async (id, industryId) => {
    const result = await pool.query(`DELETE FROM essentials_todos WHERE id = $1 AND industry_id = $2 RETURNING id`, [id, industryId]);
    if (result.rows.length === 0) throw new Error('Task not found');
    return result.rows[0];
  };

  /* ── Comments ─────────────────────────────────────────────────────────── */
  const addTodoComment = async (todoId, data, userId, industryId) => {
    const { comment } = data;
    if (!comment || !comment.trim()) throw new Error('Comment text is required');
    const todo = await fetchTodoById(todoId, industryId);
    if (!todo) throw new Error('Task not found');

    const result = await pool.query(
      `INSERT INTO essentials_todo_comments (todo_id, comment, created_by, created_at)
      VALUES ($1,$2,$3,NOW()) RETURNING *`,
      [todoId, comment, userId]
    );
    const withName = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [userId]);
    return { ...result.rows[0], author_name: withName.rows[0]?.full_name };
  };

  /* ── Attachments ──────────────────────────────────────────────────────── */
  const addTodoAttachment = async (todoId, data, userId, industryId) => {
    const { file_name, file_url, file_size } = data;
    if (!file_name || !file_url) throw new Error('File name and URL are required');
    const todo = await fetchTodoById(todoId, industryId);
    if (!todo) throw new Error('Task not found');

    const result = await pool.query(
      `INSERT INTO essentials_todo_attachments (todo_id, file_name, file_url, file_size, uploaded_by, created_at)
      VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
      [todoId, file_name, file_url, file_size || null, userId]
    );
    return result.rows[0];
  };

  const deleteTodoAttachment = async (todoId, attachmentId) => {
    const result = await pool.query(
      `DELETE FROM essentials_todo_attachments WHERE id = $1 AND todo_id = $2 RETURNING id`,
      [attachmentId, todoId]
    );
    if (result.rows.length === 0) throw new Error('Attachment not found');
    return result.rows[0];
  };

  /* ── Checklist ────────────────────────────────────────────────────────── */
  const addChecklistItem = async (todoId, data, industryId) => {
    const { item } = data;
    if (!item || !item.trim()) throw new Error('Checklist item text is required');
    const todo = await fetchTodoById(todoId, industryId);
    if (!todo) throw new Error('Task not found');

    const countRes = await pool.query(`SELECT COUNT(*) FROM essentials_todo_checklist WHERE todo_id = $1`, [todoId]);
    const result = await pool.query(
      `INSERT INTO essentials_todo_checklist (todo_id, item, sort_order, created_at)
      VALUES ($1,$2,$3,NOW()) RETURNING *`,
      [todoId, item, Number(countRes.rows[0].count) || 0]
    );
    return result.rows[0];
  };

  const toggleChecklistItem = async (todoId, itemId, is_done) => {
    const result = await pool.query(
      `UPDATE essentials_todo_checklist SET is_done = $1 WHERE id = $2 AND todo_id = $3 RETURNING *`,
      [!!is_done, itemId, todoId]
    );
    if (result.rows.length === 0) throw new Error('Checklist item not found');
    return result.rows[0];
  };

  const deleteChecklistItem = async (todoId, itemId) => {
    const result = await pool.query(
      `DELETE FROM essentials_todo_checklist WHERE id = $1 AND todo_id = $2 RETURNING id`,
      [itemId, todoId]
    );
    if (result.rows.length === 0) throw new Error('Checklist item not found');
    return result.rows[0];
  };

  /* ────────────────────────────────────────────────────────────
    DOCUMENTS
  ──────────────────────────────────────────────────────────── */
  const fetchAllDocuments = async (industryId) => {
    const result = await pool.query(`SELECT * FROM essentials_documents WHERE industry_id = $1 ORDER BY id DESC`, [industryId]);
    return result.rows;
  };

  const createDocument = async (data, userId, industryId) => {
    const { name, description, type, size, file_url } = data;
    if (!name || !name.trim()) throw new Error('File name is required');

    const result = await pool.query(
      `INSERT INTO essentials_documents (name, description, type, size, file_url, uploaded_by, industry_id, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
      [name, description || null, (type || 'FILE').toUpperCase(), size || null, file_url || null, userId, industryId]
    );
    return result.rows[0];
  };

  const deleteDocument = async (id, industryId) => {
    const result = await pool.query(`DELETE FROM essentials_documents WHERE id = $1 AND industry_id = $2 RETURNING id`, [id, industryId]);
    if (result.rows.length === 0) throw new Error('Document not found');
    return result.rows[0];
  };

  /* ────────────────────────────────────────────────────────────
    MEMOS — Enterprise: Draft/Published/Archived, targeting by
    company/branch/department/role/team/employee, read +
    acknowledgement tracking, scheduled publish, attachments,
    full industry isolation.
  ──────────────────────────────────────────────────────────── */
  let memoSchemaReady = false;
  const ensureMemoSchema = async () => {
    if (memoSchemaReady) return;
    // Base table must exist before industryService's ALTER-ADD-industry_id
    // sweep runs (same pattern as essentials_kb_articles below).
  await pool.query(`
      CREATE TABLE IF NOT EXISTS essentials_memos (
        id          SERIAL PRIMARY KEY,
        industry_id INTEGER,
        heading     VARCHAR(255) NOT NULL,
        body        TEXT,
        created_by  UUID,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    // industry_id itself is also swept by industryService.ensureIndustrySchema()
    // (essentials_memos is registered in ISOLATED_TABLES) — this CREATE is
    // just here to guarantee the table exists first, same order-independence
    // pattern as essentials_kb_articles.
    await pool.query(`ALTER TABLE essentials_memos ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'Draft';`);
    await pool.query(`ALTER TABLE essentials_memos ADD COLUMN IF NOT EXISTS publish_at TIMESTAMP;`);
    await pool.query(`ALTER TABLE essentials_memos ADD COLUMN IF NOT EXISTS published_at TIMESTAMP;`);
    await pool.query(`ALTER TABLE essentials_memos ADD COLUMN IF NOT EXISTS published_by UUID;`);
    await pool.query(`ALTER TABLE essentials_memos ADD COLUMN IF NOT EXISTS updated_by UUID;`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS essentials_memo_targets (
        id           SERIAL PRIMARY KEY,
        memo_id      INTEGER NOT NULL REFERENCES essentials_memos(id) ON DELETE CASCADE,
        target_type  VARCHAR(20) NOT NULL, -- company | branch | department | team | role | employee
        target_value TEXT,                 -- NULL for 'company'
        created_at   TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_memo_targets_memo_id ON essentials_memo_targets(memo_id);`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS essentials_memo_attachments (
        id          SERIAL PRIMARY KEY,
        memo_id     INTEGER NOT NULL REFERENCES essentials_memos(id) ON DELETE CASCADE,
        file_name   VARCHAR(255) NOT NULL,
        file_url    TEXT NOT NULL,
        file_size   BIGINT,
        uploaded_by UUID,
        created_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS essentials_memo_reads (
        id              SERIAL PRIMARY KEY,
        memo_id         INTEGER NOT NULL REFERENCES essentials_memos(id) ON DELETE CASCADE,
        user_id         UUID NOT NULL,
        seen_at         TIMESTAMP,
        acknowledged_at TIMESTAMP,
        UNIQUE(memo_id, user_id)
      );
    `);

    // Self-heal columns on installs where these tables already existed with
    // the old INTEGER types (this is the actual fix for the live "Failed to
    // fetch memos" 500 — see fixUuidUserColumns comment above).
    await fixUuidUserColumns([
      { table: 'essentials_memos',             column: 'created_by' },
      { table: 'essentials_memos',             column: 'published_by' },
      { table: 'essentials_memos',             column: 'updated_by' },
      { table: 'essentials_memo_attachments',  column: 'uploaded_by' },
      { table: 'essentials_memo_reads',        column: 'user_id' },
    ]);

    memoSchemaReady = true;
  };

  // Reused in both "which memos can this user see" and "resolve audience for
  // notifications" — a target row matches a user u if:
  const MEMO_AUDIENCE_MATCH = `(
    mt.target_type = 'company'
    OR (mt.target_type = 'branch'     AND mt.target_value = u.branch)
    OR (mt.target_type = 'department' AND mt.target_value = u.department)
    OR (mt.target_type = 'team'       AND mt.target_value = u.department)
    OR (mt.target_type = 'role'       AND LOWER(mt.target_value) = LOWER(u.role))
    OR (mt.target_type = 'employee'   AND mt.target_value = u.id::text)
  )`;
  // NOTE: there's no separate "teams" table in the current schema, so 'team'
  // targeting matches on users.department for now. If/when a real hrm_teams
  // table exists, swap that one line — nothing else needs to change.

  const fetchAllMemos = async (userId, industryId, filters = {}) => {
    await ensureMemoSchema();
    const { status = '' } = filters;
    const params = [industryId, userId];
    let statusSql = '';
    if (status) { params.push(status); statusSql = `AND m.status = $${params.length}`; }

    // Creator sees their own memo in any status (so they can manage Drafts).
    // Everyone else sees a memo once it's Published AND they match a target.
    const result = await pool.query(
      `SELECT m.*,
              cb.full_name AS created_by_name,
              pb.full_name AS published_by_name,
              (SELECT COUNT(*) FROM essentials_memo_attachments a WHERE a.memo_id = m.id) AS attachment_count,
              (SELECT COUNT(*) FROM essentials_memo_reads r WHERE r.memo_id = m.id AND r.seen_at IS NOT NULL) AS read_count,
              (SELECT COUNT(*) FROM essentials_memo_reads r WHERE r.memo_id = m.id AND r.acknowledged_at IS NOT NULL) AS ack_count,
              mr.seen_at AS my_seen_at, mr.acknowledged_at AS my_acknowledged_at
        FROM essentials_memos m
        LEFT JOIN users cb ON cb.id = m.created_by
        LEFT JOIN users pb ON pb.id = m.published_by
        LEFT JOIN essentials_memo_reads mr ON mr.memo_id = m.id AND mr.user_id = $2
        WHERE m.industry_id = $1
          AND (
            m.created_by = $2::uuid
            OR (m.status = 'Published' AND EXISTS (
                  SELECT 1 FROM essentials_memo_targets mt
                  JOIN users u ON u.id = $2::uuid
                  WHERE mt.memo_id = m.id AND ${MEMO_AUDIENCE_MATCH}
                ))
          )
          ${statusSql}
        ORDER BY COALESCE(m.published_at, m.created_at) DESC, m.id DESC`,
      params
    );
    return result.rows;
  };

  const fetchMemoDetail = async (id, userId, industryId) => {
    await ensureMemoSchema();
    const memoRes = await pool.query(
      `SELECT m.*, cb.full_name AS created_by_name, pb.full_name AS published_by_name
        FROM essentials_memos m
        LEFT JOIN users cb ON cb.id = m.created_by
        LEFT JOIN users pb ON pb.id = m.published_by
        WHERE m.id = $1 AND m.industry_id = $2`,
      [id, industryId]
    );
    const memo = memoRes.rows[0];
    if (!memo) return null;

    const [targets, attachments] = await Promise.all([
      pool.query(`SELECT * FROM essentials_memo_targets WHERE memo_id = $1 ORDER BY id ASC`, [id]),
      pool.query(`SELECT * FROM essentials_memo_attachments WHERE memo_id = $1 ORDER BY id DESC`, [id]),
    ]);
    return { ...memo, targets: targets.rows, attachments: attachments.rows };
  };

  // Resolves a memo's targets into the concrete users (within its industry).
  const resolveMemoAudience = async (memoId, industryId) => {
    const result = await pool.query(
      `SELECT DISTINCT u.id, u.full_name, u.email
        FROM users u
        JOIN essentials_memo_targets mt ON mt.memo_id = $1
        WHERE u.industry_id = $2 AND u.status = 'active' AND ${MEMO_AUDIENCE_MATCH}`,
      [memoId, industryId]
    );
    return result.rows;
  };

  // Creator-facing dashboard: who has/hasn't seen + acknowledged.
  const fetchMemoReadStats = async (id, industryId) => {
    await ensureMemoSchema();
    const audience = await resolveMemoAudience(id, industryId);
    const reads = await pool.query(
      `SELECT user_id, seen_at, acknowledged_at FROM essentials_memo_reads WHERE memo_id = $1`, [id]
    );
    const readMap = new Map(reads.rows.map(r => [String(r.user_id), r]));
    return audience.map(u => ({
      user_id: u.id,
      full_name: u.full_name,
      email: u.email,
      seen_at: readMap.get(String(u.id))?.seen_at || null,
      acknowledged_at: readMap.get(String(u.id))?.acknowledged_at || null,
    }));
  };

  const setMemoTargets = async (memoId, targets = []) => {
    await pool.query(`DELETE FROM essentials_memo_targets WHERE memo_id = $1`, [memoId]);
    if (!Array.isArray(targets) || targets.length === 0) return;
    const values = [];
    const params = [];
    targets.forEach((t) => {
      const type = (typeof t === 'string' ? t : t.target_type) || '';
      const value = typeof t === 'string' ? null : (t.target_value ?? null);
      if (!['company', 'branch', 'department', 'team', 'role', 'employee'].includes(type)) return;
      params.push(memoId, type, value != null ? String(value) : null);
      values.push(`($${params.length - 2}, $${params.length - 1}, $${params.length})`);
    });
    if (values.length) {
      await pool.query(
        `INSERT INTO essentials_memo_targets (memo_id, target_type, target_value) VALUES ${values.join(',')}`,
        params
      );
    }
  };

  // Fire-and-forget in-app notification — same hrm_notifications table your
  // NotificationBell already reads, via the existing notificationService.
  const notifyMemoAudience = async (memo) => {
    try {
      const notificationService = require('./notificationService');
      const audience = await resolveMemoAudience(memo.id, memo.industry_id);
      await notificationService.notifyUsers(
        audience.map(u => ({ id: u.id, source: 'user' })),
        {
          module: 'memos',
          eventType: 'memo_published',
          title: `New memo: ${memo.heading}`,
          message: (memo.description || '').slice(0, 200),
          recordId: memo.id,
        }
      );
    } catch (err) {
      console.error('[essentialsService] memo publish notification failed:', err.message);
    }
  };

  const createMemo = async (data, userId, industryId) => {
    await ensureMemoSchema();
    if (!industryId) throw new Error('No active industry workspace selected');
    const { heading, description, targets, status = 'Draft', publish_at } = data;
    if (!heading || !heading.trim()) throw new Error('Heading is required');

    const immediatePublish = status === 'Published' && !publish_at;
    const finalStatus = immediatePublish ? 'Published' : (publish_at ? 'Draft' : (status === 'Published' ? 'Published' : 'Draft'));

const result = await pool.query(
    `INSERT INTO essentials_memos
       (heading, description, created_by, industry_id, status, publish_at, published_at, published_by, created_at, updated_at)
     VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8::uuid,NOW(),NOW()) RETURNING *`,
    [heading, description || null, userId, industryId, finalStatus,
     publish_at || null,
     immediatePublish ? new Date() : null,
     immediatePublish ? userId : null]
  );
    const memo = result.rows[0];
    await setMemoTargets(memo.id, targets);
    if (immediatePublish) await notifyMemoAudience(memo);

    return fetchMemoDetail(memo.id, userId, industryId);
  };

  const updateMemo = async (id, data, userId, industryId) => {
    await ensureMemoSchema();
    const existing = (await pool.query(
      `SELECT * FROM essentials_memos WHERE id = $1 AND industry_id = $2`, [id, industryId]
    )).rows[0];
    if (!existing) throw new Error('Memo not found');

    const { heading, description, targets, publish_at } = data;
    if (!heading || !heading.trim()) throw new Error('Heading is required');

    await pool.query(
      `UPDATE essentials_memos
          SET heading = $1, description = $2, publish_at = $3, updated_by = $4, updated_at = NOW()
        WHERE id = $5 AND industry_id = $6`,
      [heading, description || null, publish_at || null, userId, id, industryId]
    );
    if (targets !== undefined) await setMemoTargets(id, targets);
    return fetchMemoDetail(id, userId, industryId);
  };

  const publishMemo = async (id, userId, industryId) => {
    await ensureMemoSchema();
    const result = await pool.query(
      `UPDATE essentials_memos
          SET status = 'Published', published_at = NOW(), published_by = $1, updated_at = NOW()
        WHERE id = $2 AND industry_id = $3 AND status <> 'Published' RETURNING *`,
      [userId, id, industryId]
    );
    if (result.rows.length === 0) throw new Error('Memo not found or already published');
    const memo = result.rows[0];
    await notifyMemoAudience(memo);
    return memo;
  };

  const archiveMemo = async (id, userId, industryId) => {
    const result = await pool.query(
      `UPDATE essentials_memos SET status = 'Archived', updated_by = $1, updated_at = NOW()
        WHERE id = $2 AND industry_id = $3 RETURNING *`,
      [userId, id, industryId]
    );
    if (result.rows.length === 0) throw new Error('Memo not found');
    return result.rows[0];
  };

  const deleteMemo = async (id, industryId) => {
    const result = await pool.query(
      `DELETE FROM essentials_memos WHERE id = $1 AND industry_id = $2 RETURNING id`, [id, industryId]
    );
    if (result.rows.length === 0) throw new Error('Memo not found');
    return result.rows[0];
  };

  const addMemoAttachment = async (memoId, data, userId, industryId) => {
    await ensureMemoSchema();
    const memo = await pool.query(`SELECT id FROM essentials_memos WHERE id = $1 AND industry_id = $2`, [memoId, industryId]);
    if (memo.rows.length === 0) throw new Error('Memo not found');
    const { file_name, file_url, file_size } = data;
    if (!file_name || !file_url) throw new Error('File name and URL are required');
    const result = await pool.query(
      `INSERT INTO essentials_memo_attachments (memo_id, file_name, file_url, file_size, uploaded_by, created_at)
      VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
      [memoId, file_name, file_url, file_size || null, userId]
    );
    return result.rows[0];
  };

  const deleteMemoAttachment = async (memoId, attachmentId, industryId) => {
    const memo = await pool.query(`SELECT id FROM essentials_memos WHERE id = $1 AND industry_id = $2`, [memoId, industryId]);
    if (memo.rows.length === 0) throw new Error('Memo not found');
    const result = await pool.query(
      `DELETE FROM essentials_memo_attachments WHERE id = $1 AND memo_id = $2 RETURNING id`,
      [attachmentId, memoId]
    );
    if (result.rows.length === 0) throw new Error('Attachment not found');
    return result.rows[0];
  };

  const markMemoSeen = async (memoId, userId) => {
    await ensureMemoSchema();
    const result = await pool.query(
      `INSERT INTO essentials_memo_reads (memo_id, user_id, seen_at)
      VALUES ($1,$2,NOW())
      ON CONFLICT (memo_id, user_id) DO UPDATE SET seen_at = COALESCE(essentials_memo_reads.seen_at, NOW())
      RETURNING *`,
      [memoId, userId]
    );
    return result.rows[0];
  };

  const acknowledgeMemo = async (memoId, userId) => {
    await ensureMemoSchema();
    const result = await pool.query(
      `INSERT INTO essentials_memo_reads (memo_id, user_id, seen_at, acknowledged_at)
      VALUES ($1,$2,NOW(),NOW())
      ON CONFLICT (memo_id, user_id) DO UPDATE
        SET seen_at = COALESCE(essentials_memo_reads.seen_at, NOW()), acknowledged_at = NOW()
      RETURNING *`,
      [memoId, userId]
    );
    return result.rows[0];
  };

  // Scheduled sweep — wired into server.js the same way as
  // hrmService.autoMarkAbsentees() / manufacturingService.autoFinishOverdueWorkOrders().
  const runScheduledMemoPublish = async () => {
    await ensureMemoSchema();
    const due = await pool.query(
      `SELECT * FROM essentials_memos WHERE status = 'Draft' AND publish_at IS NOT NULL AND publish_at <= NOW()`
    );
    for (const memo of due.rows) {
      const result = await pool.query(
        `UPDATE essentials_memos SET status = 'Published', published_at = NOW(), published_by = COALESCE(published_by, created_by)
          WHERE id = $1 RETURNING *`,
        [memo.id]
      );
      const published = result.rows[0];
      await notifyMemoAudience(published);
      console.log(`[Memos] Scheduled-published memo #${published.id} "${published.heading}"`);
    }
    return due.rows.length;
  };
  /* ────────────────────────────────────────────────────────────
    REMINDERS
  ──────────────────────────────────────────────────────────── */
  const fetchAllReminders = async (industryId) => {
    const result = await pool.query(`SELECT * FROM essentials_reminders WHERE industry_id = $1 ORDER BY event_date ASC`, [industryId]);
    return result.rows;
  };

  const createReminder = async (data, userId, industryId) => {
    const { name, event_date, start_time, end_time, repeat_type = 'One time' } = data;
    if (!name || !name.trim() || !event_date) throw new Error('Name and date are required');

    const result = await pool.query(
      `INSERT INTO essentials_reminders (name, event_date, start_time, end_time, repeat_type, created_by, industry_id, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
      [name, event_date, start_time || null, end_time || null, repeat_type, userId, industryId]
    );
    return result.rows[0];
  };

  const deleteReminder = async (id, industryId) => {
    const result = await pool.query(`DELETE FROM essentials_reminders WHERE id = $1 AND industry_id = $2 RETURNING id`, [id, industryId]);
    if (result.rows.length === 0) throw new Error('Reminder not found');
    return result.rows[0];
  };
  /* ────────────────────────────────────────────────────────────
    MESSAGES
  ──────────────────────────────────────────────────────────── */
  const fetchContacts = async (myId) => {
    const result = await pool.query(
      `SELECT id, full_name, email, department, role, branch
        FROM users WHERE id != $1 ORDER BY full_name ASC`,
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
    KNOWLEDGE BASE — Enterprise: Categories, Tags, Attachments,
    Favorites, Recently Viewed, Role/Branch visibility, Draft/
    Published status, Version history, Audit logs, Related
    articles, Article stats. Full industry isolation.
  ──────────────────────────────────────────────────────────── */
  let kbSchemaReady = false;
  const ensureKbSchema = async () => {
    if (kbSchemaReady) return;

    // Categories
    await pool.query(`
      CREATE TABLE IF NOT EXISTS essentials_kb_categories (
        id          SERIAL PRIMARY KEY,
        industry_id INTEGER,
        name        VARCHAR(150) NOT NULL,
        description TEXT,
        parent_id   INTEGER REFERENCES essentials_kb_categories(id) ON DELETE SET NULL,
        sort_order  INTEGER DEFAULT 0,
        created_by  INTEGER,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_kb_categories_industry ON essentials_kb_categories(industry_id);`);

    // Articles — base table must exist before industryService's
    // ALTER-ADD-industry_id sweep runs, so we CREATE IT here too
    // (ADD COLUMN IF NOT EXISTS is idempotent either order).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS essentials_kb_articles (
        id            SERIAL PRIMARY KEY,
        industry_id   INTEGER,
        title         VARCHAR(255) NOT NULL,
        content       TEXT,
        category_id   INTEGER REFERENCES essentials_kb_categories(id) ON DELETE SET NULL,
        visibility    VARCHAR(20)  NOT NULL DEFAULT 'Public',
        status        VARCHAR(20)  NOT NULL DEFAULT 'Draft',
        created_by    UUID,
        updated_by    UUID,
        published_at  TIMESTAMP,
        published_by  UUID,
        view_count    INTEGER DEFAULT 0,
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW()
      );
    `);
    // Extra columns for installs where essentials_kb_articles already existed
    // (basic version) — safe no-ops if already present.
    await pool.query(`ALTER TABLE essentials_kb_articles ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES essentials_kb_categories(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE essentials_kb_articles ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'Draft';`);
  await pool.query(`ALTER TABLE essentials_kb_articles ADD COLUMN IF NOT EXISTS updated_by UUID;`);
    await pool.query(`ALTER TABLE essentials_kb_articles ADD COLUMN IF NOT EXISTS published_at TIMESTAMP;`);
    await pool.query(`ALTER TABLE essentials_kb_articles ADD COLUMN IF NOT EXISTS published_by UUID;`);
    await pool.query(`ALTER TABLE essentials_kb_articles ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_kb_articles_industry ON essentials_kb_articles(industry_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_kb_articles_category ON essentials_kb_articles(category_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_kb_articles_status ON essentials_kb_articles(status);`);

    // Full-text search index (falls back silently to ILIKE search if the
    // extension/setup isn't available on a given Postgres install).
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_kb_articles_search
          ON essentials_kb_articles
          USING GIN (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,'')));
      `);
    } catch (e) {
      console.error('[essentialsService] KB search index warning (non-fatal):', e.message);
    }

    // Tags (industry-scoped, unique by name per industry)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS essentials_kb_tags (
        id          SERIAL PRIMARY KEY,
        industry_id INTEGER,
        name        VARCHAR(80) NOT NULL,
        created_at  TIMESTAMP DEFAULT NOW(),
        UNIQUE(industry_id, name)
      );
    `);

    // Article <-> Tag mapping
    await pool.query(`
      CREATE TABLE IF NOT EXISTS essentials_kb_article_tags (
        article_id INTEGER NOT NULL REFERENCES essentials_kb_articles(id) ON DELETE CASCADE,
        tag_id     INTEGER NOT NULL REFERENCES essentials_kb_tags(id) ON DELETE CASCADE,
        PRIMARY KEY (article_id, tag_id)
      );
    `);

    // Attachments
    await pool.query(`
      CREATE TABLE IF NOT EXISTS essentials_kb_attachments (
        id          SERIAL PRIMARY KEY,
        article_id  INTEGER NOT NULL REFERENCES essentials_kb_articles(id) ON DELETE CASCADE,
        file_name   VARCHAR(255) NOT NULL,
        file_url    TEXT NOT NULL,
        file_size   BIGINT,
        uploaded_by INTEGER,
        created_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    // Role visibility (which roles can see this article, beyond the
    // simple Public/Private/Team `visibility` field). Empty = all roles.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS essentials_kb_article_roles (
        article_id INTEGER NOT NULL REFERENCES essentials_kb_articles(id) ON DELETE CASCADE,
        role       VARCHAR(80) NOT NULL,
        PRIMARY KEY (article_id, role)
      );
    `);

    // Branch visibility. Empty = all branches.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS essentials_kb_article_branches (
        article_id INTEGER NOT NULL REFERENCES essentials_kb_articles(id) ON DELETE CASCADE,
        branch     VARCHAR(120) NOT NULL,
        PRIMARY KEY (article_id, branch)
      );
    `);

    // Version history — snapshot on every update.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS essentials_kb_versions (
        id          SERIAL PRIMARY KEY,
        article_id  INTEGER NOT NULL REFERENCES essentials_kb_articles(id) ON DELETE CASCADE,
        version_no  INTEGER NOT NULL,
        title       VARCHAR(255) NOT NULL,
        content     TEXT,
        edited_by   INTEGER,
        created_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_kb_versions_article ON essentials_kb_versions(article_id);`);

    // Favorites (per-user)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS essentials_kb_favorites (
        article_id INTEGER NOT NULL REFERENCES essentials_kb_articles(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (article_id, user_id)
      );
    `);

    // Recently viewed (per-user)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS essentials_kb_views (
        id         SERIAL PRIMARY KEY,
        article_id INTEGER NOT NULL REFERENCES essentials_kb_articles(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL,
        viewed_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_kb_views_user ON essentials_kb_views(user_id, viewed_at DESC);`);

    // Audit log (create / update / publish / archive / delete / attach etc.)
  await pool.query(`
      CREATE TABLE IF NOT EXISTS essentials_kb_audit_log (
        id          SERIAL PRIMARY KEY,
        article_id  INTEGER,
        industry_id INTEGER,
        action      VARCHAR(40) NOT NULL,
        details     TEXT,
        user_id     UUID,
        created_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_kb_audit_article ON essentials_kb_audit_log(article_id);`);

    // Self-heal columns on installs where these tables already existed with
    // the old INTEGER types (this is the actual fix for the live "Failed to
    // fetch articles" 500 — see fixUuidUserColumns comment above).
    await fixUuidUserColumns([
      { table: 'essentials_kb_categories', column: 'created_by' },
      { table: 'essentials_kb_articles',   column: 'created_by' },
      { table: 'essentials_kb_articles',   column: 'updated_by' },
      { table: 'essentials_kb_articles',   column: 'published_by' },
      { table: 'essentials_kb_attachments',column: 'uploaded_by' },
      { table: 'essentials_kb_versions',   column: 'edited_by' },
      { table: 'essentials_kb_favorites',  column: 'user_id' },
      { table: 'essentials_kb_views',      column: 'user_id' },
      { table: 'essentials_kb_audit_log',  column: 'user_id' },
    ]);

    kbSchemaReady = true;
  };  

  const kbAudit = async (articleId, industryId, action, details, userId) => {
    try {
      await pool.query(
        `INSERT INTO essentials_kb_audit_log (article_id, industry_id, action, details, user_id, created_at)
        VALUES ($1,$2,$3,$4,$5,NOW())`,
        [articleId, industryId, action, details || null, userId || null]
      );
    } catch (e) {
      console.error('[essentialsService] kbAudit failed (non-fatal):', e.message);
    }
  };

  // Role visibility check helper — a Private/role-gated article is
  // visible if either no roles are set (=> everyone) or the user's role
  // is in the list. Same pattern for branch.
  const KB_VISIBILITY_MATCH = `(
    a.visibility = 'Public'
    OR a.created_by = $2::uuid
    OR (
      NOT EXISTS (SELECT 1 FROM essentials_kb_article_roles r WHERE r.article_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM essentials_kb_article_branches b WHERE b.article_id = a.id)
    )
    OR EXISTS (
        SELECT 1 FROM essentials_kb_article_roles r
        WHERE r.article_id = a.id AND LOWER(r.role) = LOWER($3)
      )
    OR EXISTS (
        SELECT 1 FROM essentials_kb_article_branches b
        WHERE b.article_id = a.id AND b.branch = $4
      )
  )`;

  const setKbTags = async (articleId, industryId, tagNames = []) => {
    await pool.query(`DELETE FROM essentials_kb_article_tags WHERE article_id = $1`, [articleId]);
    if (!Array.isArray(tagNames) || tagNames.length === 0) return;
    for (const raw of tagNames) {
      const name = String(raw || '').trim();
      if (!name) continue;
      const tag = await pool.query(
        `INSERT INTO essentials_kb_tags (industry_id, name, created_at)
        VALUES ($1,$2,NOW())
        ON CONFLICT (industry_id, name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id`,
        [industryId, name]
      );
      await pool.query(
        `INSERT INTO essentials_kb_article_tags (article_id, tag_id) VALUES ($1,$2)
        ON CONFLICT DO NOTHING`,
        [articleId, tag.rows[0].id]
      );
    }
  };

  const setKbRoles = async (articleId, roles = []) => {
    await pool.query(`DELETE FROM essentials_kb_article_roles WHERE article_id = $1`, [articleId]);
    if (!Array.isArray(roles) || roles.length === 0) return;
    const values = [];
    const params = [];
    roles.forEach((role) => {
      if (!role) return;
      params.push(articleId, String(role));
      values.push(`($${params.length - 1}, $${params.length})`);
    });
    if (values.length) {
      await pool.query(
        `INSERT INTO essentials_kb_article_roles (article_id, role) VALUES ${values.join(',')} ON CONFLICT DO NOTHING`,
        params
      );
    }
  };

  const setKbBranches = async (articleId, branches = []) => {
    await pool.query(`DELETE FROM essentials_kb_article_branches WHERE article_id = $1`, [articleId]);
    if (!Array.isArray(branches) || branches.length === 0) return;
    const values = [];
    const params = [];
    branches.forEach((branch) => {
      if (!branch) return;
      params.push(articleId, String(branch));
      values.push(`($${params.length - 1}, $${params.length})`);
    });
    if (values.length) {
      await pool.query(
        `INSERT INTO essentials_kb_article_branches (article_id, branch) VALUES ${values.join(',')} ON CONFLICT DO NOTHING`,
        params
      );
    }
  };

  const fetchArticleTagsMap = async (articleIds) => {
    if (!articleIds.length) return {};
    const result = await pool.query(
      `SELECT at.article_id, t.name
        FROM essentials_kb_article_tags at
        JOIN essentials_kb_tags t ON t.id = at.tag_id
        WHERE at.article_id = ANY($1::int[])`,
      [articleIds]
    );
    const map = {};
    result.rows.forEach(r => {
      if (!map[r.article_id]) map[r.article_id] = [];
      map[r.article_id].push(r.name);
    });
    return map;
  };

  /* ── Categories ────────────────────────────────────────────── */
  const fetchKbCategories = async (industryId) => {
    await ensureKbSchema();
    const result = await pool.query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM essentials_kb_articles a WHERE a.category_id = c.id AND a.industry_id = c.industry_id) AS article_count
        FROM essentials_kb_categories c
        WHERE c.industry_id = $1
        ORDER BY c.sort_order ASC, c.name ASC`,
      [industryId]
    );
    return result.rows;
  };

  const createKbCategory = async (data, userId, industryId) => {
    await ensureKbSchema();
    const { name, description, parent_id, sort_order } = data;
    if (!name || !name.trim()) throw new Error('Category name is required');
    const result = await pool.query(
      `INSERT INTO essentials_kb_categories (industry_id, name, description, parent_id, sort_order, created_by, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW()) RETURNING *`,
      [industryId, name, description || null, parent_id || null, sort_order || 0, userId]
    );
    return result.rows[0];
  };

  const updateKbCategory = async (id, data, industryId) => {
    await ensureKbSchema();
    const { name, description, parent_id, sort_order } = data;
    if (!name || !name.trim()) throw new Error('Category name is required');
    const result = await pool.query(
      `UPDATE essentials_kb_categories
          SET name = $1, description = $2, parent_id = $3, sort_order = $4, updated_at = NOW()
        WHERE id = $5 AND industry_id = $6 RETURNING *`,
      [name, description || null, parent_id || null, sort_order || 0, id, industryId]
    );
    if (result.rows.length === 0) throw new Error('Category not found');
    return result.rows[0];
  };

  const deleteKbCategory = async (id, industryId) => {
    const result = await pool.query(
      `DELETE FROM essentials_kb_categories WHERE id = $1 AND industry_id = $2 RETURNING id`,
      [id, industryId]
    );
    if (result.rows.length === 0) throw new Error('Category not found');
    return result.rows[0];
  };

  /* ── Articles ──────────────────────────────────────────────── */
  const fetchAllKb = async (userId, userRole, userBranch, industryId, filters = {}) => {
    await ensureKbSchema();
    const { search = '', category_id = '', status = '', tag = '', favorites = '' } = filters;
    const params = [industryId, userId, userRole || '', userBranch || ''];
    const where = [`a.industry_id = $1`, KB_VISIBILITY_MATCH];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(a.title ILIKE $${params.length} OR a.content ILIKE $${params.length})`);
    }
    if (category_id) { params.push(category_id); where.push(`a.category_id = $${params.length}`); }
    if (status)      { params.push(status);      where.push(`a.status = $${params.length}`); }
    if (tag) {
      params.push(tag);
      where.push(`EXISTS (SELECT 1 FROM essentials_kb_article_tags at JOIN essentials_kb_tags t ON t.id = at.tag_id WHERE at.article_id = a.id AND t.name = $${params.length})`);
    }
  if (favorites === 'true' || favorites === true) {
  where.push(`EXISTS (SELECT 1 FROM essentials_kb_favorites f WHERE f.article_id = a.id AND f.user_id = $2)`);
    }

    const result = await pool.query(
      `SELECT a.*,
              cb.full_name AS created_by_name,
              cat.name AS category_name,
              (SELECT COUNT(*) FROM essentials_kb_attachments att WHERE att.article_id = a.id) AS attachment_count,
              (SELECT COUNT(*) FROM essentials_kb_versions v WHERE v.article_id = a.id) AS version_count,
        EXISTS (SELECT 1 FROM essentials_kb_favorites f WHERE f.article_id = a.id AND f.user_id = $2) AS is_favorite
        FROM essentials_kb_articles a
        LEFT JOIN users cb ON cb.id = a.created_by
        LEFT JOIN essentials_kb_categories cat ON cat.id = a.category_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.id DESC`,
      params
    );

    const tagsMap = await fetchArticleTagsMap(result.rows.map(r => r.id));
    return result.rows.map(r => ({ ...r, tags: tagsMap[r.id] || [] }));
  };

  const fetchKbDetail = async (id, userId, userRole, userBranch, industryId) => {
    await ensureKbSchema();
    const params = [id, industryId, userId, userRole || '', userBranch || ''];
    const articleRes = await pool.query(
      `SELECT a.*, cb.full_name AS created_by_name, pb.full_name AS published_by_name, cat.name AS category_name
        FROM essentials_kb_articles a
        LEFT JOIN users cb ON cb.id = a.created_by
        LEFT JOIN users pb ON pb.id = a.published_by
        LEFT JOIN essentials_kb_categories cat ON cat.id = a.category_id
        WHERE a.id = $1 AND a.industry_id = $2
          AND (a.visibility = 'Public' OR a.created_by = $3
              OR (NOT EXISTS (SELECT 1 FROM essentials_kb_article_roles r WHERE r.article_id = a.id)
                  AND NOT EXISTS (SELECT 1 FROM essentials_kb_article_branches b WHERE b.article_id = a.id))
              OR EXISTS (SELECT 1 FROM essentials_kb_article_roles r WHERE r.article_id = a.id AND LOWER(r.role) = LOWER($4))
              OR EXISTS (SELECT 1 FROM essentials_kb_article_branches b WHERE b.article_id = a.id AND b.branch = $5))`,
      params
    );
    const article = articleRes.rows[0];
    if (!article) return null;

    const [tags, roles, branches, attachments, related] = await Promise.all([
      pool.query(`SELECT t.name FROM essentials_kb_article_tags at JOIN essentials_kb_tags t ON t.id = at.tag_id WHERE at.article_id = $1`, [id]),
      pool.query(`SELECT role FROM essentials_kb_article_roles WHERE article_id = $1`, [id]),
      pool.query(`SELECT branch FROM essentials_kb_article_branches WHERE article_id = $1`, [id]),
      pool.query(`SELECT * FROM essentials_kb_attachments WHERE article_id = $1 ORDER BY id DESC`, [id]),
      pool.query(
        `SELECT a2.id, a2.title
          FROM essentials_kb_articles a2
          JOIN essentials_kb_article_tags at2 ON at2.article_id = a2.id
          WHERE a2.industry_id = $1 AND a2.id != $2 AND a2.status = 'Published'
            AND at2.tag_id IN (SELECT tag_id FROM essentials_kb_article_tags WHERE article_id = $2)
          GROUP BY a2.id, a2.title
          ORDER BY COUNT(*) DESC
          LIMIT 5`,
        [industryId, id]
      ),
    ]);

    return {
      ...article,
      tags: tags.rows.map(r => r.name),
      roles: roles.rows.map(r => r.role),
      branches: branches.rows.map(r => r.branch),
      attachments: attachments.rows,
      related: related.rows,
    };
  };

  const createKb = async (data, userId, industryId) => {
    await ensureKbSchema();
    if (!industryId) throw new Error('No active industry workspace selected');
    const { title, content, visibility = 'Public', status = 'Draft', category_id, tags, roles, branches } = data;
    if (!title || !title.trim()) throw new Error('Title is required');

    const finalStatus = status === 'Published' ? 'Published' : 'Draft';
    const result = await pool.query(
      `INSERT INTO essentials_kb_articles
        (title, content, visibility, status, category_id, created_by, industry_id, published_at, published_by, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW()) RETURNING *`,
      [title, content || null, visibility, finalStatus, category_id || null, userId, industryId,
      finalStatus === 'Published' ? new Date() : null,
      finalStatus === 'Published' ? userId : null]
    );
    const article = result.rows[0];

    await setKbTags(article.id, industryId, tags);
    await setKbRoles(article.id, roles);
    await setKbBranches(article.id, branches);

    // First version snapshot
    await pool.query(
      `INSERT INTO essentials_kb_versions (article_id, version_no, title, content, edited_by, created_at)
      VALUES ($1,1,$2,$3,$4,NOW())`,
      [article.id, title, content || null, userId]
    );

    await kbAudit(article.id, industryId, 'create', `Article "${title}" created (${finalStatus})`, userId);
    return fetchKbDetail(article.id, userId, null, null, industryId);
  };

  const updateKb = async (id, data, userId, industryId) => {
    await ensureKbSchema();
    const existing = (await pool.query(
      `SELECT * FROM essentials_kb_articles WHERE id = $1 AND industry_id = $2`, [id, industryId]
    )).rows[0];
    if (!existing) throw new Error('Article not found');

    const { title, content, visibility, category_id, tags, roles, branches } = data;
    if (!title || !title.trim()) throw new Error('Title is required');

    const result = await pool.query(
      `UPDATE essentials_kb_articles
          SET title = $1, content = $2, visibility = $3, category_id = $4, updated_by = $5, updated_at = NOW()
        WHERE id = $6 AND industry_id = $7 RETURNING *`,
      [title, content || null, visibility || existing.visibility, category_id ?? existing.category_id, userId, id, industryId]
    );

    if (tags !== undefined)     await setKbTags(id, industryId, tags);
    if (roles !== undefined)    await setKbRoles(id, roles);
    if (branches !== undefined) await setKbBranches(id, branches);

    // Version snapshot only if title/content actually changed
    if (existing.title !== title || (existing.content || '') !== (content || '')) {
      const lastVer = await pool.query(
        `SELECT COALESCE(MAX(version_no),0) AS v FROM essentials_kb_versions WHERE article_id = $1`, [id]
      );
      await pool.query(
        `INSERT INTO essentials_kb_versions (article_id, version_no, title, content, edited_by, created_at)
        VALUES ($1,$2,$3,$4,$5,NOW())`,
        [id, lastVer.rows[0].v + 1, title, content || null, userId]
      );
    }

    await kbAudit(id, industryId, 'update', `Article "${title}" updated`, userId);
    return fetchKbDetail(id, userId, null, null, industryId);
  };

  const publishKb = async (id, userId, industryId) => {
    await ensureKbSchema();
    const result = await pool.query(
      `UPDATE essentials_kb_articles
          SET status = 'Published', published_at = NOW(), published_by = $1, updated_at = NOW()
        WHERE id = $2 AND industry_id = $3 AND status <> 'Published' RETURNING *`,
      [userId, id, industryId]
    );
    if (result.rows.length === 0) throw new Error('Article not found or already published');
    await kbAudit(id, industryId, 'publish', `Article published`, userId);
    return result.rows[0];
  };

  const archiveKb = async (id, userId, industryId) => {
    await ensureKbSchema();
    const result = await pool.query(
      `UPDATE essentials_kb_articles SET status = 'Archived', updated_by = $1, updated_at = NOW()
        WHERE id = $2 AND industry_id = $3 RETURNING *`,
      [userId, id, industryId]
    );
    if (result.rows.length === 0) throw new Error('Article not found');
    await kbAudit(id, industryId, 'archive', `Article archived`, userId);
    return result.rows[0];
  };

  const deleteKb = async (id, userId, industryId) => {
    const result = await pool.query(
      `DELETE FROM essentials_kb_articles WHERE id = $1 AND industry_id = $2 RETURNING id, title`, [id, industryId]
    );
    if (result.rows.length === 0) throw new Error('Article not found');
    await kbAudit(id, industryId, 'delete', `Article "${result.rows[0].title}" deleted`, userId);
    return result.rows[0];
  };

  /* ── Attachments ───────────────────────────────────────────── */
  const addKbAttachment = async (articleId, data, userId, industryId) => {
    await ensureKbSchema();
    const article = await pool.query(`SELECT id FROM essentials_kb_articles WHERE id = $1 AND industry_id = $2`, [articleId, industryId]);
    if (article.rows.length === 0) throw new Error('Article not found');
    const { file_name, file_url, file_size } = data;
    if (!file_name || !file_url) throw new Error('File name and URL are required');
    const result = await pool.query(
      `INSERT INTO essentials_kb_attachments (article_id, file_name, file_url, file_size, uploaded_by, created_at)
      VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
      [articleId, file_name, file_url, file_size || null, userId]
    );
    await kbAudit(articleId, industryId, 'attach', `Attached "${file_name}"`, userId);
    return result.rows[0];
  };

  const deleteKbAttachment = async (articleId, attachmentId, userId, industryId) => {
    const article = await pool.query(`SELECT id FROM essentials_kb_articles WHERE id = $1 AND industry_id = $2`, [articleId, industryId]);
    if (article.rows.length === 0) throw new Error('Article not found');
    const result = await pool.query(
      `DELETE FROM essentials_kb_attachments WHERE id = $1 AND article_id = $2 RETURNING id`,
      [attachmentId, articleId]
    );
    if (result.rows.length === 0) throw new Error('Attachment not found');
    await kbAudit(articleId, industryId, 'detach', `Removed attachment #${attachmentId}`, userId);
    return result.rows[0];
  };

  /* ── Favorites ─────────────────────────────────────────────── */
  const toggleKbFavorite = async (articleId, userId) => {
    await ensureKbSchema();
    const existing = await pool.query(
      `SELECT 1 FROM essentials_kb_favorites WHERE article_id = $1 AND user_id = $2`, [articleId, userId]
    );
    if (existing.rows.length > 0) {
      await pool.query(`DELETE FROM essentials_kb_favorites WHERE article_id = $1 AND user_id = $2`, [articleId, userId]);
      return { favorited: false };
    }
    await pool.query(
      `INSERT INTO essentials_kb_favorites (article_id, user_id, created_at) VALUES ($1,$2,NOW())`,
      [articleId, userId]
    );
    return { favorited: true };
  };

  /* ── Recently viewed + view stats ─────────────────────────────*/
  const recordKbView = async (articleId, userId, industryId) => {
    await ensureKbSchema();
    await pool.query(
      `UPDATE essentials_kb_articles SET view_count = view_count + 1 WHERE id = $1 AND industry_id = $2`,
      [articleId, industryId]
    );
    if (userId) {
      await pool.query(
        `INSERT INTO essentials_kb_views (article_id, user_id, viewed_at) VALUES ($1,$2,NOW())`,
        [articleId, userId]
      );
    }
    return { ok: true };
  };

  const fetchRecentlyViewed = async (userId, industryId, limit = 8) => {
    await ensureKbSchema();
    const result = await pool.query(
      `SELECT DISTINCT ON (a.id) a.id, a.title, a.status, v.viewed_at
        FROM essentials_kb_views v
        JOIN essentials_kb_articles a ON a.id = v.article_id
        WHERE v.user_id = $1 AND a.industry_id = $2
        ORDER BY a.id, v.viewed_at DESC`,
      [userId, industryId]
    );
    return result.rows
      .sort((a, b) => new Date(b.viewed_at) - new Date(a.viewed_at))
      .slice(0, limit);
  };

  /* ── Version history ───────────────────────────────────────── */
  const fetchKbVersions = async (articleId, industryId) => {
    await ensureKbSchema();
    const owner = await pool.query(`SELECT id FROM essentials_kb_articles WHERE id = $1 AND industry_id = $2`, [articleId, industryId]);
    if (owner.rows.length === 0) throw new Error('Article not found');
    const result = await pool.query(
      `SELECT v.*, u.full_name AS edited_by_name
        FROM essentials_kb_versions v
        LEFT JOIN users u ON u.id = v.edited_by
        WHERE v.article_id = $1
        ORDER BY v.version_no DESC`,
      [articleId]
    );
    return result.rows;
  };

  const restoreKbVersion = async (articleId, versionId, userId, industryId) => {
    await ensureKbSchema();
    const version = (await pool.query(
      `SELECT * FROM essentials_kb_versions WHERE id = $1 AND article_id = $2`, [versionId, articleId]
    )).rows[0];
    if (!version) throw new Error('Version not found');

    return updateKb(articleId, { title: version.title, content: version.content }, userId, industryId);
  };

  /* ── Tags list + Audit log ─────────────────────────────────── */
  const fetchKbTags = async (industryId) => {
    await ensureKbSchema();
    const result = await pool.query(
      `SELECT t.*, (SELECT COUNT(*) FROM essentials_kb_article_tags at WHERE at.tag_id = t.id) AS article_count
        FROM essentials_kb_tags t WHERE t.industry_id = $1 ORDER BY t.name ASC`,
      [industryId]
    );
    return result.rows;
  };

  const fetchKbAuditLog = async (articleId, industryId) => {
    await ensureKbSchema();
    const params = [industryId];
    let where = `industry_id = $1`;
    if (articleId) { params.push(articleId); where += ` AND article_id = $${params.length}`; }
    const result = await pool.query(
      `SELECT l.*, u.full_name AS user_name
        FROM essentials_kb_audit_log l
        LEFT JOIN users u ON u.id = l.user_id
        WHERE ${where}
        ORDER BY l.id DESC LIMIT 200`,
      params
    );
    return result.rows;
  };

  /* ── Stats ─────────────────────────────────────────────────── */
  const fetchKbStats = async (industryId) => {
    await ensureKbSchema();
    const result = await pool.query(
      `SELECT
          COUNT(*) FILTER (WHERE status = 'Published') AS published_count,
          COUNT(*) FILTER (WHERE status = 'Draft')      AS draft_count,
          COUNT(*) FILTER (WHERE status = 'Archived')   AS archived_count,
          COALESCE(SUM(view_count),0)                   AS total_views
      FROM essentials_kb_articles WHERE industry_id = $1`,
      [industryId]
    );
    const top = await pool.query(
      `SELECT id, title, view_count FROM essentials_kb_articles
        WHERE industry_id = $1 ORDER BY view_count DESC LIMIT 5`,
      [industryId]
    );
    return { ...result.rows[0], top_articles: top.rows };
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
    fetchAllTodos, fetchTodoById, fetchTodoDetail, createTodo, updateTodo, deleteTodo,
    // todo comments / attachments / checklist
    addTodoComment,
    addTodoAttachment, deleteTodoAttachment,
    addChecklistItem, toggleChecklistItem, deleteChecklistItem,
    // documents
    fetchAllDocuments, createDocument, deleteDocument,
  // memos
    fetchAllMemos, fetchMemoDetail, fetchMemoReadStats,
    createMemo, updateMemo, publishMemo, archiveMemo, deleteMemo,
    addMemoAttachment, deleteMemoAttachment,
    markMemoSeen, acknowledgeMemo, runScheduledMemoPublish,
    // reminders
    fetchAllReminders, createReminder, deleteReminder,
    // messages
    fetchContacts, fetchConversation, createMessage,
  // kb
    ensureKbSchema,
    fetchKbCategories, createKbCategory, updateKbCategory, deleteKbCategory,
    fetchAllKb, fetchKbDetail, createKb, updateKb, publishKb, archiveKb, deleteKb,
    addKbAttachment, deleteKbAttachment,
    toggleKbFavorite, recordKbView, fetchRecentlyViewed,
    fetchKbVersions, restoreKbVersion,
    fetchKbTags, fetchKbAuditLog, fetchKbStats,
    // settings
    fetchSettings, updateSettings,
  };