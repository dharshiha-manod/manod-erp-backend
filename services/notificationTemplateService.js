/**
 * ====================================================
 * services/notificationTemplateService.js
 * Database service layer for notification templates
 * ====================================================
 */

'use strict';

const pool = require('../config/database');

const SELECT_COLS = `id, template_type, email_subject, cc_email, bcc_email, email_body, auto_email,
              sms_body, auto_sms, whatsapp_body, auto_whatsapp,
              created_at, updated_at`;

/**
 * FETCH ALL NOTIFICATION TEMPLATES
 */
const fetchAllTemplates = async (filters = {}) => {
  const { search = '', auto_email = '', auto_sms = '', auto_whatsapp = '' } = filters;

  const params = [];
  const where = ['is_deleted = FALSE'];

  if (search) {
    params.push(`%${search}%`);
    where.push(`(template_type ILIKE $${params.length} OR email_subject ILIKE $${params.length})`);
  }
  if (auto_email !== '') {
    params.push(auto_email === 'true');
    where.push(`auto_email = $${params.length}`);
  }
  if (auto_sms !== '') {
    params.push(auto_sms === 'true');
    where.push(`auto_sms = $${params.length}`);
  }
  if (auto_whatsapp !== '') {
    params.push(auto_whatsapp === 'true');
    where.push(`auto_whatsapp = $${params.length}`);
  }

  const whereSql = where.join(' AND ');

  try {
    const result = await pool.query(
      `SELECT ${SELECT_COLS} FROM notification_templates WHERE ${whereSql} ORDER BY template_type ASC`,
      params
    );
    return result.rows;
  } catch (err) {
    console.error('fetchAllTemplates error:', err.message);
    throw new Error(`Failed to fetch notification templates: ${err.message}`);
  }
};

const fetchTemplateById = async (id) => {
  try {
    const result = await pool.query(
      `SELECT ${SELECT_COLS} FROM notification_templates WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error('fetchTemplateById error:', err.message);
    throw new Error(`Failed to fetch notification template: ${err.message}`);
  }
};

/**
 * FETCH TEMPLATE BY TYPE (e.g. 'customer_new_sale')
 * Returns null (not an error) if no row exists yet — the frontend
 * treats that as "unsaved / empty form".
 */
const fetchTemplateByType = async (templateType) => {
  try {
    const result = await pool.query(
      `SELECT ${SELECT_COLS} FROM notification_templates WHERE template_type = $1 AND is_deleted = FALSE`,
      [templateType]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error('fetchTemplateByType error:', err.message);
    throw new Error(`Failed to fetch notification template: ${err.message}`);
  }
};

const createTemplate = async (data) => {
  const {
    template_type,
    email_subject = null,
    cc_email = null,
    bcc_email = null,
    email_body = null,
    auto_email = false,
    sms_body = null,
    auto_sms = false,
    whatsapp_body = null,
    auto_whatsapp = false,
  } = data;

  if (!template_type || !template_type.trim()) {
    throw new Error('Template type is required');
  }

  try {
    const result = await pool.query(
      `INSERT INTO notification_templates
        (template_type, email_subject, cc_email, bcc_email, email_body, auto_email,
         sms_body, auto_sms, whatsapp_body, auto_whatsapp, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING ${SELECT_COLS}`,
      [
        template_type.trim(),
        email_subject || null,
        cc_email || null,
        bcc_email || null,
        email_body || null,
        !!auto_email,
        sms_body || null,
        !!auto_sms,
        whatsapp_body || null,
        !!auto_whatsapp,
      ]
    );
    return result.rows[0];
  } catch (err) {
    if (err.code === '23505') {
      throw new Error(`Template type "${template_type}" already exists`);
    }
    console.error('createTemplate error:', err.message);
    throw new Error(`Failed to create notification template: ${err.message}`);
  }
};

const updateTemplate = async (id, data) => {
  const { email_subject, cc_email, bcc_email, email_body, auto_email, sms_body, auto_sms, whatsapp_body, auto_whatsapp } = data;

  try {
    const checkResult = await pool.query(
      'SELECT id FROM notification_templates WHERE id = $1 AND is_deleted = FALSE',
      [id]
    );
    if (checkResult.rows.length === 0) {
      throw new Error('Notification template not found');
    }

    const result = await pool.query(
      `UPDATE notification_templates
       SET email_subject = $1, cc_email = $2, bcc_email = $3, email_body = $4,
           auto_email = $5, sms_body = $6, auto_sms = $7, whatsapp_body = $8, auto_whatsapp = $9,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $10 AND is_deleted = FALSE
       RETURNING ${SELECT_COLS}`,
      [
        email_subject || null,
        cc_email || null,
        bcc_email || null,
        email_body || null,
        auto_email !== undefined ? !!auto_email : false,
        sms_body || null,
        auto_sms !== undefined ? !!auto_sms : false,
        whatsapp_body || null,
        auto_whatsapp !== undefined ? !!auto_whatsapp : false,
        id,
      ]
    );
    return result.rows[0];
  } catch (err) {
    console.error('updateTemplate error:', err.message);
    throw new Error(err.message.includes('not found') ? err.message : `Failed to update notification template: ${err.message}`);
  }
};

/**
 * UPSERT BY TYPE
 * The frontend saves per-tab without ever knowing an `id` — if a row
 * for this template_type exists it's updated, otherwise it's created.
 */
const upsertTemplateByType = async (templateType, data) => {
  if (!templateType || !templateType.trim()) {
    throw new Error('Template type is required');
  }

  const {
    email_subject = null,
    cc_email = null,
    bcc_email = null,
    email_body = null,
    auto_email = false,
    sms_body = null,
    auto_sms = false,
    whatsapp_body = null,
    auto_whatsapp = false,
  } = data;

  try {
    const result = await pool.query(
      `INSERT INTO notification_templates
        (template_type, email_subject, cc_email, bcc_email, email_body, auto_email,
         sms_body, auto_sms, whatsapp_body, auto_whatsapp, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (template_type)
       DO UPDATE SET
         email_subject  = EXCLUDED.email_subject,
         cc_email       = EXCLUDED.cc_email,
         bcc_email      = EXCLUDED.bcc_email,
         email_body     = EXCLUDED.email_body,
         auto_email     = EXCLUDED.auto_email,
         sms_body       = EXCLUDED.sms_body,
         auto_sms       = EXCLUDED.auto_sms,
         whatsapp_body  = EXCLUDED.whatsapp_body,
         auto_whatsapp  = EXCLUDED.auto_whatsapp,
         is_deleted     = FALSE,
         deleted_at     = NULL,
         updated_at     = CURRENT_TIMESTAMP
       WHERE notification_templates.is_deleted = FALSE OR notification_templates.is_deleted IS NULL
       RETURNING ${SELECT_COLS}`,
      [
        templateType.trim(),
        email_subject || null,
        cc_email || null,
        bcc_email || null,
        email_body || null,
        !!auto_email,
        sms_body || null,
        !!auto_sms,
        whatsapp_body || null,
        !!auto_whatsapp,
      ]
    );
    return result.rows[0];
  } catch (err) {
    console.error('upsertTemplateByType error:', err.message);
    throw new Error(`Failed to save notification template: ${err.message}`);
  }
};

const deleteTemplate = async (id) => {
  try {
    const checkResult = await pool.query(
      'SELECT id FROM notification_templates WHERE id = $1 AND is_deleted = FALSE',
      [id]
    );
    if (checkResult.rows.length === 0) {
      throw new Error('Notification template not found');
    }
    const result = await pool.query(
      `UPDATE notification_templates
       SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, template_type`,
      [id]
    );
    return { id: result.rows[0].id, template_type: result.rows[0].template_type, deleted: true };
  } catch (err) {
    console.error('deleteTemplate error:', err.message);
    throw new Error(err.message.includes('not found') ? err.message : `Failed to delete notification template: ${err.message}`);
  }
};

const getActiveTemplatesByChannel = async (channel) => {
  const validChannels = ['email', 'sms', 'whatsapp'];
  if (!validChannels.includes(channel)) {
    throw new Error(`Invalid channel. Must be one of: ${validChannels.join(', ')}`);
  }

  try {
    let query = '';
    if (channel === 'email') {
      query = `SELECT ${SELECT_COLS} FROM notification_templates WHERE auto_email = TRUE AND email_body IS NOT NULL AND is_deleted = FALSE`;
    } else if (channel === 'sms') {
      query = `SELECT ${SELECT_COLS} FROM notification_templates WHERE auto_sms = TRUE AND sms_body IS NOT NULL AND is_deleted = FALSE`;
    } else {
      query = `SELECT ${SELECT_COLS} FROM notification_templates WHERE auto_whatsapp = TRUE AND whatsapp_body IS NOT NULL AND is_deleted = FALSE`;
    }
    const result = await pool.query(query);
    return result.rows;
  } catch (err) {
    console.error('getActiveTemplatesByChannel error:', err.message);
    throw new Error(`Failed to fetch active templates: ${err.message}`);
  }
};

module.exports = {
  fetchAllTemplates,
  fetchTemplateById,
  fetchTemplateByType,
  createTemplate,
  updateTemplate,
  upsertTemplateByType,
  deleteTemplate,
  getActiveTemplatesByChannel,
};