const express = require('express');
const router = express.Router();

const authenticateToken = require('../middleware/auth');
const pool = require('../config/database');

// ── Leads ────────────────────────────────────────────────────
router.get('/leads', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM crm_leads ORDER BY created_at DESC');
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/leads/:id', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM crm_leads WHERE id=$1', [req.params.id]);
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/leads', authenticateToken, async (req, res) => {
  try {
    const { name, mobile, email, company, source, stage, assigned, dob, notes } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO crm_leads (name,mobile,email,company,source,stage,assigned,dob,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, mobile, email||null, company||null, source||null, stage||'New', assigned||null, dob||null, notes||null]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/leads/:id', authenticateToken, async (req, res) => {
  try {
    const { name, mobile, email, company, source, stage, assigned, dob, notes } = req.body;
    const { rows } = await pool.query(
      `UPDATE crm_leads SET name=$1,mobile=$2,email=$3,company=$4,source=$5,
       stage=$6,assigned=$7,dob=$8,notes=$9,updated_at=NOW() WHERE id=$10 RETURNING *`,
      [name, mobile, email||null, company||null, source||null, stage, assigned||null, dob||null, notes||null, req.params.id]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/leads/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM crm_leads WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/leads/:id/convert', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE crm_leads SET converted=true, converted_date=CURRENT_DATE, stage='Proposal', updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Follow-ups ───────────────────────────────────────────────
router.get('/followups', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM crm_followups ORDER BY created_at DESC');
    const data = rows.map(r => ({
      id:       r.id,
      lead:     r.lead      || r.lead_name  || '',
      title:    r.title,
      status:   r.status,
      type:     r.type,
      category: r.category,
      assigned: r.assigned,
      start:    r.start_time ? new Date(r.start_time).toISOString().slice(0, 16) : '',
      end:      r.end_time   ? new Date(r.end_time).toISOString().slice(0, 16)   : '',
      desc:     r.description || '',
    }));
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/followups', authenticateToken, async (req, res) => {
  try {
    const { lead, lead_name, title, status, type, category, assigned,
            start, start_time, end, end_time, desc, description } = req.body;
    const leadVal  = lead  || lead_name  || null;
    const startVal = start || start_time || null;
    const endVal   = end   || end_time   || null;
    const descVal  = desc  || description || null;

    // Try inserting with 'lead' column first, fallback column name handled by DB schema
    const { rows } = await pool.query(
      `INSERT INTO crm_followups (lead_name,title,status,type,category,assigned,start_time,end_time,description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [leadVal, title, status||'Scheduled', type||'Call', category||'call',
       assigned||null, startVal, endVal, descVal]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    // If lead_name column doesn't exist, try 'lead'
    try {
      const { lead, lead_name, title, status, type, category, assigned,
              start, start_time, end, end_time, desc, description } = req.body;
      const { rows } = await pool.query(
        `INSERT INTO crm_followups (lead,title,status,type,category,assigned,start_time,end_time,description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [lead||lead_name, title, status||'Scheduled', type||'Call', category||'call',
         assigned||null, start||start_time||null, end||end_time||null, desc||description||null]
      );
      res.json({ success: true, data: rows[0] });
    } catch (err2) { res.status(500).json({ error: err2.message }); }
  }
});

router.put('/followups/:id', authenticateToken, async (req, res) => {
  try {
    const { lead, lead_name, title, status, type, category, assigned,
            start, start_time, end, end_time, desc, description } = req.body;
    const leadVal  = lead  || lead_name  || null;
    const startVal = start || start_time || null;
    const endVal   = end   || end_time   || null;
    const descVal  = desc  || description || null;
    const { rows } = await pool.query(
      `UPDATE crm_followups SET lead_name=$1,title=$2,status=$3,type=$4,category=$5,
       assigned=$6,start_time=$7,end_time=$8,description=$9 WHERE id=$10 RETURNING *`,
      [leadVal, title, status, type, category, assigned||null, startVal, endVal, descVal, req.params.id]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/followups/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM crm_followups WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Campaigns ────────────────────────────────────────────────
router.get('/campaigns', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM crm_campaigns ORDER BY created_at DESC');
    const data = rows.map(r => ({
      ...r,
      by:   r.by || r.created_by,
      date: r.date || (r.created_at ? new Date(r.created_at).toISOString().slice(0,10) : null),
    }));
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/campaigns', authenticateToken, async (req, res) => {
  try {
    const { name, type, status, by, created_by, recipients } = req.body;
    const createdByVal = by || created_by || null;
    const { rows } = await pool.query(
      `INSERT INTO crm_campaigns (name,type,status,created_by,recipients)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, type||'Email', status||'Draft', createdByVal, recipients||0]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Proposals ────────────────────────────────────────────────
router.get('/proposals', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM crm_proposals ORDER BY created_at DESC');
    const data = rows.map(r => ({
      ...r,
      lead:   r.lead   || r.lead_name || '',
      sentBy: r.sentBy || r.sent_by   || '',
      date:   r.date   || (r.created_at ? new Date(r.created_at).toISOString().slice(0,10) : ''),
    }));
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/proposals', authenticateToken, async (req, res) => {
  try {
    const { lead, lead_name, subject, sentBy, sent_by, value, status } = req.body;
    const leadVal   = lead   || lead_name || null;
    const sentByVal = sentBy || sent_by   || null;
    const { rows } = await pool.query(
      `INSERT INTO crm_proposals (lead_name,subject,sent_by,value,status)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [leadVal, subject, sentByVal, value||0, status||'Draft']
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/proposals/:id', authenticateToken, async (req, res) => {
  try {
    const { lead, lead_name, subject, sentBy, sent_by, value, status } = req.body;
    const leadVal   = lead   || lead_name || null;
    const sentByVal = sentBy || sent_by   || null;
    const { rows } = await pool.query(
      `UPDATE crm_proposals SET lead_name=$1,subject=$2,sent_by=$3,value=$4,status=$5
       WHERE id=$6 RETURNING *`,
      [leadVal, subject, sentByVal, value||0, status, req.params.id]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/proposals/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM crm_proposals WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Templates ────────────────────────────────────────────────
router.get('/templates', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM crm_templates ORDER BY updated_at DESC');
    const data = rows.map(r => ({
      ...r,
      lastUpdated: r.lastUpdated || r.last_updated ||
                   (r.updated_at ? new Date(r.updated_at).toISOString().slice(0,10) : null),
    }));
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/templates', authenticateToken, async (req, res) => {
  try {
    const { name, subject, description, status } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO crm_templates (name,subject,description,status)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, subject, description||null, status||'Active']
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/templates/:id', authenticateToken, async (req, res) => {
  try {
    const { name, subject, description, status } = req.body;
    const { rows } = await pool.query(
      `UPDATE crm_templates SET name=$1,subject=$2,description=$3,status=$4,updated_at=NOW()
       WHERE id=$5 RETURNING *`,
      [name, subject, description||null, status, req.params.id]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/templates/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM crm_templates WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Contacts ─────────────────────────────────────────────────
router.get('/contacts', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM crm_contacts ORDER BY created_at DESC');
    const data = rows.map(r => ({
      ...r,
      firstName: r.firstName || r.first_name  || '',
      lastName:  r.lastName  || r.last_name   || '',
      active:    r.active    !== undefined ? r.active : r.is_active,
    }));
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/contacts', authenticateToken, async (req, res) => {
  try {
    const { firstName, first_name, lastName, last_name,
            email, mobile, dept, active, is_active } = req.body;
    const firstNameVal = firstName || first_name || null;
    const lastNameVal  = lastName  || last_name  || null;
    const activeVal    = active !== undefined ? active : (is_active !== undefined ? is_active : true);
    const { rows } = await pool.query(
      `INSERT INTO crm_contacts (first_name,last_name,email,mobile,dept,is_active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [firstNameVal, lastNameVal, email, mobile||null, dept||null, activeVal]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/contacts/:id', authenticateToken, async (req, res) => {
  try {
    const { firstName, first_name, lastName, last_name,
            email, mobile, dept, active, is_active } = req.body;
    const firstNameVal = firstName || first_name || null;
    const lastNameVal  = lastName  || last_name  || null;
    const activeVal    = active !== undefined ? active : (is_active !== undefined ? is_active : true);
    const { rows } = await pool.query(
      `UPDATE crm_contacts SET first_name=$1,last_name=$2,email=$3,mobile=$4,dept=$5,is_active=$6
       WHERE id=$7 RETURNING *`,
      [firstNameVal, lastNameVal, email, mobile||null, dept||null, activeVal, req.params.id]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/contacts/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM crm_contacts WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Dashboard stats ──────────────────────────────────────────
router.get('/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    const [leads, followups, proposals] = await Promise.all([
      pool.query('SELECT stage, converted FROM crm_leads'),
      pool.query('SELECT status FROM crm_followups'),
      pool.query('SELECT status, value FROM crm_proposals'),
    ]);
    res.json({ success: true, leads: leads.rows, followups: followups.rows, proposals: proposals.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;