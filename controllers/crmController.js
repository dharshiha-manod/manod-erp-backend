/**
 * ====================================================
 * controllers/crmController.js
 * Full CRUD for: Leads, Follow-ups, Campaigns,
 *               Proposals, Templates, Contact Logins
 * Pattern: mirrors stockAdjustmentController.js exactly
 * NOW INDUSTRY-SCOPED — every query filters/stamps industry_id
 * ====================================================
 */
'use strict';
const transporter = require("../services/emailService");


const pool = require('../config/database');
const { logAudit } = require('../services/auditLogService');
const essentialsService = require('../services/essentialsService');

// ─────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────
function fail(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

// ─────────────────────────────────────────────────────────────
// LEADS
// ─────────────────────────────────────────────────────────────

const getLeads = async (req, res) => {
  try {
    const { search = '', stage = '', source = '', assigned = '' } = req.query;
    let query = 'SELECT * FROM crm_leads WHERE industry_id = $1';
    const params = [req.industryId];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (name ILIKE $${params.length} OR mobile ILIKE $${params.length} OR email ILIKE $${params.length} OR company ILIKE $${params.length})`;
    }
    if (stage)    { params.push(stage);    query += ` AND stage = $${params.length}`; }
    if (source)   { params.push(source);   query += ` AND source = $${params.length}`; }
    if (assigned) { params.push(assigned); query += ` AND assigned = $${params.length}`; }

    query += ' ORDER BY created_at DESC';

    const { rows } = await pool.query(query, params);
    res.json({ success: true, leads: rows });
  } catch (err) {
    console.error('getLeads:', err.message);
    fail(res, 500, 'Failed to fetch leads');
  }
};

const getLeadById = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM crm_leads WHERE id = $1 AND industry_id = $2', [req.params.id, req.industryId]);
    if (!rows.length) return fail(res, 404, 'Lead not found');

    const { rows: contactPersons } = await pool.query(
      'SELECT * FROM crm_lead_contact_persons WHERE lead_id = $1 ORDER BY created_at',
      [req.params.id]
    );

    res.json({ success: true, lead: { ...rows[0], contactPersons } });
  } catch (err) {
    fail(res, 500, 'Failed to fetch lead');
  }
};

const createLead = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      name, company, mobile, email,
      location, industry, contact, value,
      source, stage = 'New', assigned, dob, notes,
      status = 'Active', contactType = 'Individual',
      taxNumber, address1, address2, city, state, country, zipCode,
      landmark, streetName, buildingNumber, additionalNumber,
      customFields, contactPersons,
    } = req.body;

    if (!name || !mobile) return fail(res, 400, 'Name and mobile are required');

    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO crm_leads
        (name, company, mobile, email, location, industry, contact, value,
         source, stage, assigned, dob, notes, status, contact_type,
         tax_number, address1, address2, city, state, country, zip_code,
         landmark, street_name, building_number, additional_number, custom_fields, industry_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
               $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
       RETURNING *`,
      [
        name, company, mobile, email, location, industry, contact,
        value || null, source, stage, assigned, dob || null, notes,
        status, contactType,
        taxNumber || null, address1 || null, address2 || null, city || null,
        state || null, country || null, zipCode || null, landmark || null,
        streetName || null, buildingNumber || null, additionalNumber || null,
        JSON.stringify(customFields || {}), req.industryId,
      ]
    );
    const lead = rows[0];

    if (Array.isArray(contactPersons)) {
      for (const cp of contactPersons) {
        if (!cp || (!cp.firstName && !cp.email && !cp.mobile)) continue;
        await client.query(
          `INSERT INTO crm_lead_contact_persons
            (lead_id, prefix, first_name, last_name, email, mobile,
             alt_phone, family_phone, department, designation, commission, allow_login)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            lead.id, cp.prefix || null, cp.firstName || null, cp.lastName || null,
            cp.email || null, cp.mobile || null, cp.altPhone || null,
            cp.familyPhone || null, cp.department || null, cp.designation || null,
            cp.commission || null, !!cp.allowLogin,
          ]
        );
      }
    }

    await client.query('COMMIT');

    const userId = req.user?.id || null;
    const userName = req.user?.name || req.user?.full_name || req.user?.username || req.user?.email || null;
    logAudit({
      userId, userName,
      module: 'CRM',
      action: 'CREATE',
      recordId: lead.id,
      recordLabel: lead.name,
      oldData: null,
      newData: lead,
    }).catch(() => {});

    res.status(201).json({ success: true, message: 'Lead created', lead });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('createLead:', err.message);
    fail(res, 500, 'Failed to create lead');
  } finally {
    client.release();
  }
};

const updateLead = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      name, company, mobile, email,
      location, industry, contact, value,
      source, stage, assigned, dob, notes,
      status, contactType,
      taxNumber, address1, address2, city, state, country, zipCode,
      landmark, streetName, buildingNumber, additionalNumber,
      customFields, contactPersons,
    } = req.body;

    await client.query('BEGIN');

    const { rows: existingRows } = await client.query('SELECT * FROM crm_leads WHERE id = $1 AND industry_id = $2', [req.params.id, req.industryId]);
    const oldData = existingRows[0] || null;
    if (!oldData) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'Lead not found');
    }

    const { rows } = await client.query(
      `UPDATE crm_leads SET
        name=$1, company=$2, mobile=$3, email=$4, location=$5, industry=$6,
        contact=$7, value=$8, source=$9, stage=$10, assigned=$11, dob=$12,
        notes=$13, status=$14, contact_type=$15,
        tax_number=$16, address1=$17, address2=$18, city=$19, state=$20,
        country=$21, zip_code=$22, landmark=$23, street_name=$24,
        building_number=$25, additional_number=$26, custom_fields=$27
       WHERE id=$28 AND industry_id=$29 RETURNING *`,
      [
        name, company, mobile, email, location, industry, contact,
        value || null, source, stage, assigned, dob || null, notes,
        status, contactType,
        taxNumber || null, address1 || null, address2 || null, city || null,
        state || null, country || null, zipCode || null, landmark || null,
        streetName || null, buildingNumber || null, additionalNumber || null,
        JSON.stringify(customFields || {}), req.params.id, req.industryId,
      ]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'Lead not found');
    }
    const lead = rows[0];

    if (Array.isArray(contactPersons)) {
      await client.query('DELETE FROM crm_lead_contact_persons WHERE lead_id = $1', [lead.id]);
      for (const cp of contactPersons) {
        if (!cp || (!cp.firstName && !cp.email && !cp.mobile)) continue;
        await client.query(
          `INSERT INTO crm_lead_contact_persons
            (lead_id, prefix, first_name, last_name, email, mobile,
             alt_phone, family_phone, department, designation, commission, allow_login)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            lead.id, cp.prefix || null, cp.firstName || null, cp.lastName || null,
            cp.email || null, cp.mobile || null, cp.altPhone || null,
            cp.familyPhone || null, cp.department || null, cp.designation || null,
            cp.commission || null, !!cp.allowLogin,
          ]
        );
      }
    }

    await client.query('COMMIT');

    const userId = req.user?.id || null;
    const userName = req.user?.name || req.user?.full_name || req.user?.username || req.user?.email || null;
    logAudit({
      userId, userName,
      module: 'CRM',
      action: 'UPDATE',
      recordId: lead.id,
      recordLabel: lead.name,
      oldData,
      newData: lead,
    }).catch(() => {});

    res.json({ success: true, message: 'Lead updated', lead });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('updateLead:', err.message);
    fail(res, 500, 'Failed to update lead');
  } finally {
    client.release();
  }
};

const deleteLead = async (req, res) => {
  try {
    const { rows: existingRows } = await pool.query('SELECT * FROM crm_leads WHERE id = $1 AND industry_id = $2', [req.params.id, req.industryId]);
    if (!existingRows.length) return fail(res, 404, 'Lead not found');
    const oldData = existingRows[0];

    const { rowCount } = await pool.query('DELETE FROM crm_leads WHERE id = $1 AND industry_id = $2', [req.params.id, req.industryId]);
    if (!rowCount) return fail(res, 404, 'Lead not found');

    const userId = req.user?.id || null;
    const userName = req.user?.name || req.user?.full_name || req.user?.username || req.user?.email || null;
    logAudit({
      userId, userName,
      module: 'CRM',
      action: 'DELETE',
      recordId: req.params.id,
      recordLabel: oldData.name,
      oldData,
      newData: null,
    }).catch(() => {});

    res.json({ success: true, message: 'Lead deleted' });
  } catch (err) {
    fail(res, 500, 'Failed to delete lead');
  }
};

const convertLead = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE crm_leads SET converted=true, converted_date=CURRENT_DATE, stage='Proposal'
       WHERE id=$1 AND industry_id=$2 AND converted=false RETURNING *`,
      [req.params.id, req.industryId]
    );
    if (!rows.length) return fail(res, 404, 'Lead not found or already converted');
    res.json({ success: true, message: 'Lead converted to customer', lead: rows[0] });
  } catch (err) {
    fail(res, 500, 'Failed to convert lead');
  }
};

// ─────────────────────────────────────────────────────────────
// FOLLOW UPS
// ─────────────────────────────────────────────────────────────

const getFollowups = async (req, res) => {
  try {
    const { search = '', status = '', type = '', assigned = '' } = req.query;
    let query = 'SELECT * FROM crm_followups WHERE industry_id = $1';
    const params = [req.industryId];

    if (search) {
      params.push(`%${search}%`);
    query += ` AND (lead_name ILIKE $${params.length} OR title ILIKE $${params.length} OR assigned ILIKE $${params.length})`;
    }
    if (status)   { params.push(status);   query += ` AND status = $${params.length}`; }
    if (type)     { params.push(type);     query += ` AND type = $${params.length}`; }
    if (assigned) { params.push(assigned); query += ` AND assigned = $${params.length}`; }

    query += ' ORDER BY start_time DESC';

    const { rows } = await pool.query(query, params);
  const normalized = rows.map(r => ({
      id:       r.id,
      lead:     r.lead_name,
      title:    r.title,
      status:   r.status,
      type:     r.type,
      category: r.category,
      assigned: r.assigned,
      start:    r.start_time ? r.start_time.toISOString().slice(0, 16) : '',
      end:      r.end_time   ? r.end_time.toISOString().slice(0, 16)   : '',
      desc:     r.description,
    }));
    res.json({ success: true, followups: normalized });
  } catch (err) {
    console.error('getFollowups:', err.message);
    fail(res, 500, 'Failed to fetch follow ups');
  }
};

const createFollowup = async (req, res) => {
  try {
    const { lead, title, status = 'Scheduled', type = 'Call', category, assigned, start, end, desc } = req.body;
    if (!lead || !title) return fail(res, 400, 'Lead and title are required');
    const { rows } = await pool.query(
      `INSERT INTO crm_followups (lead_name, title, status, type, category, assigned, start_time, end_time, description, industry_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [lead, title, status, type, category, assigned, start || null, end || null, desc, req.industryId]
    );
    const followup = rows[0];

    // Auto-create an Essentials Reminder for the assigned employee so the
    // follow-up also shows up as a real reminder, not just a CRM row.
    // Fire-and-forget — never blocks the CRM response.
    if (assigned && start) {
      pool.query(`SELECT id FROM users WHERE full_name = $1 LIMIT 1`, [assigned])
        .then(userResult => {
          const userId = userResult.rows[0]?.id;
          if (!userId) return; // no matching user account — skip silently
        return essentialsService.createReminder(
            {
              name: `Follow-up: ${lead} — ${title}`,
              event_date: String(start).slice(0, 10),
              start_time: String(start).slice(11, 16) || null,
            },
            userId,
            req.industryId
          );
        })
        .catch(err => console.error('[CRM] auto-reminder for follow-up failed:', err.message));
    }

    res.status(201).json({ success: true, message: 'Follow up created', followup });
  } catch (err) {
    console.error('createFollowup:', err.message);
    fail(res, 500, 'Failed to create follow up');
  }
};

const updateFollowup = async (req, res) => {
  try {
    const { lead, title, status, type, category, assigned, start, end, desc } = req.body;
    const { rows } = await pool.query(
      `UPDATE crm_followups SET lead_name=$1, title=$2, status=$3, type=$4, category=$5,
       assigned=$6, start_time=$7, end_time=$8, description=$9
       WHERE id=$10 AND industry_id=$11 RETURNING *`,
      [lead, title, status, type, category, assigned, start || null, end || null, desc, req.params.id, req.industryId]
    );
    if (!rows.length) return fail(res, 404, 'Follow up not found');
    res.json({ success: true, message: 'Follow up updated', followup: rows[0] });
  } catch (err) {
    console.error('updateFollowup:', err.message);
    fail(res, 500, 'Failed to update follow up');
  }
};

const deleteFollowup = async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM crm_followups WHERE id = $1 AND industry_id = $2', [req.params.id, req.industryId]);
    if (!rowCount) return fail(res, 404, 'Follow up not found');
    res.json({ success: true, message: 'Follow up deleted' });
  } catch (err) {
    console.error('deleteFollowup:', err.message);
    fail(res, 500, 'Failed to delete follow up');
  }
};

// ─────────────────────────────────────────────────────────────
// CAMPAIGNS
// ─────────────────────────────────────────────────────────────

const getCampaigns = async (req, res) => {
  try {
    const { search = '', type = '', status = '' } = req.query;
    let query = 'SELECT * FROM crm_campaigns WHERE industry_id = $1';
    const params = [req.industryId];
    if (search) { params.push(`%${search}%`); query += ` AND (name ILIKE $${params.length} OR created_by ILIKE $${params.length})`; }
    if (type)   { params.push(type);   query += ` AND type = $${params.length}`; }
    if (status) { params.push(status); query += ` AND status = $${params.length}`; }
    query += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(query, params);
    const normalized = rows.map(r => ({ ...r, by: r.created_by }));
    res.json({ success: true, campaigns: normalized });
  } catch (err) {
    fail(res, 500, 'Failed to fetch campaigns');
  }
};

const createCampaign = async (req, res) => {
  try {
    const { name, type = 'Email', status = 'Draft', by, recipients = 0 } = req.body;
    if (!name) return fail(res, 400, 'Campaign name is required');
    const { rows } = await pool.query(
      `INSERT INTO crm_campaigns (name, type, status, created_by, recipients, industry_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, type, status, by, recipients, req.industryId]
    );
    res.status(201).json({ success: true, message: 'Campaign created', campaign: rows[0] });
  } catch (err) {
    fail(res, 500, 'Failed to create campaign');
  }
};

const updateCampaign = async (req, res) => {
  try {
    const { name, type, status, createdBy, created_by, recipients, subject, body, cc } = req.body;
    const createdByVal = createdBy || created_by || null;
    const { rows } = await pool.query(
      `UPDATE crm_campaigns SET name=$1, type=$2, status=$3, created_by=$4, recipients=$5, subject=$6, body=$7, cc=$8, updated_at=NOW()
       WHERE id=$9 AND industry_id=$10 RETURNING *`,
      [name, type || 'Email', status || 'Draft', createdByVal, recipients || 0, subject || null, body || null, cc || null, req.params.id, req.industryId]
    );
    if (!rows.length) return fail(res, 404, 'Campaign not found');
    res.json({ success: true, message: 'Campaign updated', campaign: rows[0] });
  } catch (err) {
    fail(res, 500, 'Failed to update campaign');
  }
};

const deleteCampaign = async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM crm_campaigns WHERE id = $1 AND industry_id = $2', [req.params.id, req.industryId]);
    if (!rowCount) return fail(res, 404, 'Campaign not found');
    res.json({ success: true, message: 'Campaign deleted' });
  } catch (err) {
    fail(res, 500, 'Failed to delete campaign');
  }
};

// ─────────────────────────────────────────────────────────────
// PROPOSALS
// ─────────────────────────────────────────────────────────────

const getProposals = async (req, res) => {
  try {
    const { search = '', status = '', sent_by = '' } = req.query;
    let query = 'SELECT * FROM crm_proposals WHERE industry_id = $1';
    const params = [req.industryId];
    if (search)  { params.push(`%${search}%`); query += ` AND (lead ILIKE $${params.length} OR subject ILIKE $${params.length} OR sent_by ILIKE $${params.length})`; }
    if (status)  { params.push(status);  query += ` AND status = $${params.length}`; }
    if (sent_by) { params.push(sent_by); query += ` AND sent_by = $${params.length}`; }
    query += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(query, params);
    const normalized = rows.map(r => ({ ...r, sentBy: r.sent_by }));
    res.json({ success: true, proposals: normalized });
  } catch (err) {
    fail(res, 500, 'Failed to fetch proposals');
  }
};

const createProposal = async (req, res) => {
  try {
    const { lead, subject, sentBy, value = 0, status = 'Draft' } = req.body;
    if (!lead || !subject) return fail(res, 400, 'Lead and subject are required');
    const { rows } = await pool.query(
      `INSERT INTO crm_proposals (lead, subject, sent_by, value, status, industry_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [lead, subject, sentBy, value, status, req.industryId]
    );
    res.status(201).json({ success: true, message: 'Proposal created', proposal: rows[0] });
  } catch (err) {
    fail(res, 500, 'Failed to create proposal');
  }
};

const updateProposal = async (req, res) => {
  try {
    const { lead, subject, sentBy, value, status } = req.body;
    const { rows } = await pool.query(
      `UPDATE crm_proposals SET lead=$1, subject=$2, sent_by=$3, value=$4, status=$5
       WHERE id=$6 AND industry_id=$7 RETURNING *`,
      [lead, subject, sentBy, value, status, req.params.id, req.industryId]
    );
    if (!rows.length) return fail(res, 404, 'Proposal not found');
    res.json({ success: true, message: 'Proposal updated', proposal: rows[0] });
  } catch (err) {
    fail(res, 500, 'Failed to update proposal');
  }
};

const deleteProposal = async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM crm_proposals WHERE id = $1 AND industry_id = $2', [req.params.id, req.industryId]);
    if (!rowCount) return fail(res, 404, 'Proposal not found');
    res.json({ success: true, message: 'Proposal deleted' });
  } catch (err) {
    fail(res, 500, 'Failed to delete proposal');
  }
};

// SEND PROPOSAL — emails the proposal to the lead's saved email and marks it Sent
const sendProposal = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM crm_proposals WHERE id=$1 AND industry_id=$2', [req.params.id, req.industryId]);
    const proposal = rows[0];
    if (!proposal) return fail(res, 404, 'Proposal not found');

    const leadResult = await pool.query(
      'SELECT email FROM crm_leads WHERE name=$1 AND industry_id=$2 LIMIT 1',
      [proposal.lead_name || proposal.lead, req.industryId]
    );
    const toEmail = leadResult.rows[0]?.email;
    if (!toEmail) {
      return fail(res, 400, "This lead has no email address saved. Add one before sending.");
    }

    await transporter.sendMail({
      from: `"Manod Technologies" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      cc: proposal.cc || undefined,
      bcc: proposal.bcc || undefined,
      subject: proposal.subject,
      html: proposal.body,
    });

    const { rows: updated } = await pool.query(
      `UPDATE crm_proposals SET status='Sent', updated_at=NOW() WHERE id=$1 AND industry_id=$2 RETURNING *`,
      [req.params.id, req.industryId]
    );

    res.json({ success: true, message: 'Proposal sent', proposal: updated[0] });
  } catch (err) {
    console.error('sendProposal error:', err.message);
    fail(res, 500, 'Failed to send proposal');
  }
};

// ─────────────────────────────────────────────────────────────
// TEMPLATES
// ─────────────────────────────────────────────────────────────

const getTemplates = async (req, res) => {
  try {
    const { search = '' } = req.query;
    let query = 'SELECT * FROM crm_templates WHERE industry_id = $1';
    const params = [req.industryId];
    if (search) { params.push(`%${search}%`); query += ` AND (name ILIKE $${params.length} OR subject ILIKE $${params.length})`; }
    query += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(query, params);
    const normalized = rows.map(r => ({ ...r, lastUpdated: r.last_updated }));
    res.json({ success: true, templates: normalized });
  } catch (err) {
    fail(res, 500, 'Failed to fetch templates');
  }
};

const createTemplate = async (req, res) => {
  try {
    const { name, subject, description, status = 'Active' } = req.body;
    if (!name || !subject) return fail(res, 400, 'Name and subject are required');
    const { rows } = await pool.query(
      `INSERT INTO crm_templates (name, subject, description, status, industry_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, subject, description, status, req.industryId]
    );
    res.status(201).json({ success: true, message: 'Template created', template: rows[0] });
  } catch (err) {
    fail(res, 500, 'Failed to create template');
  }
};

const updateTemplate = async (req, res) => {
  try {
    const { name, subject, description, status } = req.body;
    const { rows } = await pool.query(
      `UPDATE crm_templates SET name=$1, subject=$2, description=$3, status=$4, last_updated=CURRENT_DATE
       WHERE id=$5 AND industry_id=$6 RETURNING *`,
      [name, subject, description, status, req.params.id, req.industryId]
    );
    if (!rows.length) return fail(res, 404, 'Template not found');
    res.json({ success: true, message: 'Template updated', template: rows[0] });
  } catch (err) {
    fail(res, 500, 'Failed to update template');
  }
};

const deleteTemplate = async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM crm_templates WHERE id = $1 AND industry_id = $2', [req.params.id, req.industryId]);
    if (!rowCount) return fail(res, 404, 'Template not found');
    res.json({ success: true, message: 'Template deleted' });
  } catch (err) {
    fail(res, 500, 'Failed to delete template');
  }
};

// ─────────────────────────────────────────────────────────────
// CONTACT LOGINS
// ─────────────────────────────────────────────────────────────

const getContacts = async (req, res) => {
  try {
    const { search = '' } = req.query;
    let query = 'SELECT * FROM crm_contacts WHERE industry_id = $1';
    const params = [req.industryId];
    if (search) { params.push(`%${search}%`); query += ` AND (first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR email ILIKE $${params.length})`; }
    query += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(query, params);
    const normalized = rows.map(r => ({
      id: r.id, firstName: r.first_name, lastName: r.last_name,
      email: r.email, mobile: r.mobile, department: r.dept, active: r.is_active,
    }));
    res.json({ success: true, contacts: normalized });
  } catch (err) {
    fail(res, 500, 'Failed to fetch contacts');
  }
};

const createContact = async (req, res) => {
  try {
    const { firstName, lastName, email, mobile, department, active = true } = req.body;
    if (!firstName || !email) return fail(res, 400, 'First name and email are required');
    const { rows } = await pool.query(
      `INSERT INTO crm_contacts (first_name, last_name, email, mobile, dept, is_active, industry_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [firstName, lastName, email, mobile, department, active, req.industryId]
    );
    res.status(201).json({ success: true, message: 'Contact created', contact: rows[0] });
  } catch (err) {
    console.error('createContact error:', err);
    fail(res, 500, 'Failed to create contact');
  }
};

const updateContact = async (req, res) => {
  try {
    const { firstName, lastName, email, mobile, department, active } = req.body;
    const { rows } = await pool.query(
      `UPDATE crm_contacts SET first_name=$1, last_name=$2, email=$3, mobile=$4, dept=$5, is_active=$6
       WHERE id=$7 AND industry_id=$8 RETURNING *`,
      [firstName, lastName, email, mobile, department, active, req.params.id, req.industryId]
    );
    if (!rows.length) return fail(res, 404, 'Contact not found');
    res.json({ success: true, message: 'Contact updated', contact: rows[0] });
  } catch (err) {
    console.error('updateContact error:', err);
    fail(res, 500, 'Failed to update contact');
  }
};

const deleteContact = async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM crm_contacts WHERE id = $1 AND industry_id = $2', [req.params.id, req.industryId]);
    if (!rowCount) return fail(res, 404, 'Contact not found');
    res.json({ success: true, message: 'Contact deleted' });
  } catch (err) {
    fail(res, 500, 'Failed to delete contact');
  }
};

// ─────────────────────────────────────────────────────────────
// DASHBOARD STATS
// ─────────────────────────────────────────────────────────────

const getDashboardStats = async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [leads, followups, proposals] = await Promise.all([
      pool.query('SELECT stage, converted FROM crm_leads WHERE industry_id = $1', [req.industryId]),
      pool.query(`SELECT status, DATE(start_time) AS day FROM crm_followups WHERE industry_id = $1`, [req.industryId]),
      pool.query('SELECT status, value FROM crm_proposals WHERE industry_id = $1', [req.industryId]),
    ]);

    const totalLeads     = leads.rows.length;
    const newLeads       = leads.rows.filter(r => r.stage === 'New').length;
    const conversions    = leads.rows.filter(r => r.converted).length;
    const pipelineValue  = proposals.rows.reduce((s, r) => s + Number(r.value || 0), 0);
    const todayFollowups = followups.rows.filter(r => r.day?.toISOString?.().slice(0, 10) === today || String(r.day) === today).length;
    const pendingProposals = proposals.rows.filter(r => r.status === 'Sent').length;

    res.json({
      success: true,
      stats: { totalLeads, newLeads, conversions, pipelineValue, todayFollowups, pendingProposals },
    });
  } catch (err) {
    console.error('getDashboardStats:', err.message);
    fail(res, 500, 'Failed to fetch CRM stats');
  }
};

module.exports = {
  // leads
  getLeads, getLeadById, createLead, updateLead, deleteLead, convertLead,
  // followups
  getFollowups, createFollowup, updateFollowup, deleteFollowup,
  // campaigns
  getCampaigns, createCampaign, updateCampaign, deleteCampaign,
  // proposals
  getProposals, createProposal, updateProposal, deleteProposal, sendProposal,
  // templates
  getTemplates, createTemplate, updateTemplate, deleteTemplate,
  // contacts
  getContacts, createContact, updateContact, deleteContact,
  // dashboard
  getDashboardStats,
};