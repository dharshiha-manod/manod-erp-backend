/**
 * ====================================================
 * services/notificationTemplateService.js
 * Database service layer for notification templates
 * ====================================================
 */

'use strict';

const pool = require('../config/database');

/**
 * FETCH ALL NOTIFICATION TEMPLATES
 * Returns all notification templates with optional filtering
 */
const fetchAllTemplates = async (filters = {}) => {
  const { search = '', auto_email = '', auto_sms = '', auto_whatsapp = '' } = filters;
  
  const params = [];
  const where = ['is_deleted = FALSE'];
  
  // Search filter
  if (search) {
    params.push(`%${search}%`);
    where.push(
      `(template_type ILIKE $${params.length} OR email_subject ILIKE $${params.length})`
    );
    // Note: we need to add the same param twice for ILIKE
    params.push(`%${search}%`);
  }
  
  // Auto-email filter
  if (auto_email !== '') {
    params.push(auto_email === 'true');
    where.push(`auto_email = $${params.length}`);
  }
  
  // Auto-SMS filter
  if (auto_sms !== '') {
    params.push(auto_sms === 'true');
    where.push(`auto_sms = $${params.length}`);
  }
  
  // Auto-WhatsApp filter
  if (auto_whatsapp !== '') {
    params.push(auto_whatsapp === 'true');
    where.push(`auto_whatsapp = $${params.length}`);
  }
  
  const whereSql = where.join(' AND ');
  
  try {
    const result = await pool.query(
      `SELECT id, template_type, email_subject, email_body, auto_email,
              sms_body, auto_sms, whatsapp_body, auto_whatsapp,
              created_at, updated_at
       FROM notification_templates
       WHERE ${whereSql}
       ORDER BY template_type ASC`,
      params
    );
    
    return result.rows;
  } catch (err) {
    console.error('fetchAllTemplates error:', err.message);
    throw new Error(`Failed to fetch notification templates: ${err.message}`);
  }
};

/**
 * FETCH SINGLE NOTIFICATION TEMPLATE BY ID
 */
const fetchTemplateById = async (id) => {
  try {
    const result = await pool.query(
      `SELECT id, template_type, email_subject, email_body, auto_email,
              sms_body, auto_sms, whatsapp_body, auto_whatsapp,
              created_at, updated_at
       FROM notification_templates
       WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );
    
    return result.rows[0] || null;
  } catch (err) {
    console.error('fetchTemplateById error:', err.message);
    throw new Error(`Failed to fetch notification template: ${err.message}`);
  }
};

/**
 * FETCH TEMPLATE BY TYPE (e.g., 'new_sale', 'payment_received')
 * Useful for loading a template by its business event type
 */
const fetchTemplateByType = async (templateType) => {
  try {
    const result = await pool.query(
      `SELECT id, template_type, email_subject, email_body, auto_email,
              sms_body, auto_sms, whatsapp_body, auto_whatsapp,
              created_at, updated_at
       FROM notification_templates
       WHERE template_type = $1 AND is_deleted = FALSE`,
      [templateType]
    );
    
    return result.rows[0] || null;
  } catch (err) {
    console.error('fetchTemplateByType error:', err.message);
    throw new Error(`Failed to fetch notification template: ${err.message}`);
  }
};

/**
 * CREATE NEW NOTIFICATION TEMPLATE
 * Stores template with all channel configurations
 * 
 * Data structure expected:
 * {
 *   template_type: string (unique identifier like 'new_sale')
 *   email_subject: string (with {tags})
 *   email_body: string (HTML or plain text with {tags})
 *   auto_email: boolean
 *   sms_body: string (with {tags})
 *   auto_sms: boolean
 *   whatsapp_body: string (with {tags})
 *   auto_whatsapp: boolean
 * }
 */
const createTemplate = async (data) => {
  const {
    template_type,
    email_subject = null,
    email_body = null,
    auto_email = false,
    sms_body = null,
    auto_sms = false,
    whatsapp_body = null,
    auto_whatsapp = false,
  } = data;
  
  // Validate required fields
  if (!template_type || !template_type.trim()) {
    throw new Error('Template type is required');
  }
  
  // At least one channel must be configured
  if (!email_body && !sms_body && !whatsapp_body) {
    throw new Error('At least one notification channel (email, SMS, or WhatsApp) must be configured');
  }
  
  try {
    const result = await pool.query(
      `INSERT INTO notification_templates
        (template_type, email_subject, email_body, auto_email, 
         sms_body, auto_sms, whatsapp_body, auto_whatsapp, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, template_type, email_subject, email_body, auto_email,
                 sms_body, auto_sms, whatsapp_body, auto_whatsapp,
                 created_at, updated_at`,
      [
        template_type.trim(),
        email_subject || null,
        email_body || null,
        auto_email || false,
        sms_body || null,
        auto_sms || false,
        whatsapp_body || null,
        auto_whatsapp || false,
      ]
    );
    
    return result.rows[0];
  } catch (err) {
    // Handle unique constraint violation
    if (err.code === '23505') {
      throw new Error(`Template type "${template_type}" already exists`);
    }
    console.error('createTemplate error:', err.message);
    throw new Error(`Failed to create notification template: ${err.message}`);
  }
};

/**
 * UPDATE NOTIFICATION TEMPLATE
 * Updates an existing template by ID
 */
const updateTemplate = async (id, data) => {
  const {
    email_subject,
    email_body,
    auto_email,
    sms_body,
    auto_sms,
    whatsapp_body,
    auto_whatsapp,
  } = data;
  
  // At least one channel must be configured
  if (!email_body && !sms_body && !whatsapp_body) {
    throw new Error('At least one notification channel (email, SMS, or WhatsApp) must be configured');
  }
  
  try {
    // First check if template exists
    const checkResult = await pool.query(
      'SELECT id FROM notification_templates WHERE id = $1 AND is_deleted = FALSE',
      [id]
    );
    
    if (checkResult.rows.length === 0) {
      throw new Error('Notification template not found');
    }
    
    // Update template
    const result = await pool.query(
      `UPDATE notification_templates
       SET email_subject = $1,
           email_body = $2,
           auto_email = $3,
           sms_body = $4,
           auto_sms = $5,
           whatsapp_body = $6,
           auto_whatsapp = $7,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 AND is_deleted = FALSE
       RETURNING id, template_type, email_subject, email_body, auto_email,
                 sms_body, auto_sms, whatsapp_body, auto_whatsapp,
                 created_at, updated_at`,
      [
        email_subject || null,
        email_body || null,
        auto_email !== undefined ? auto_email : false,
        sms_body || null,
        auto_sms !== undefined ? auto_sms : false,
        whatsapp_body || null,
        auto_whatsapp !== undefined ? auto_whatsapp : false,
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
 * DELETE NOTIFICATION TEMPLATE (Soft Delete)
 * Marks template as deleted without removing from database
 */
const deleteTemplate = async (id) => {
  try {
    // Check if template exists
    const checkResult = await pool.query(
      'SELECT id FROM notification_templates WHERE id = $1 AND is_deleted = FALSE',
      [id]
    );
    
    if (checkResult.rows.length === 0) {
      throw new Error('Notification template not found');
    }
    
    // Soft delete
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

/**
 * GET ACTIVE TEMPLATES FOR SPECIFIC CHANNELS
 * Returns templates where a specific channel is enabled and auto-send is ON
 * Useful for the automation engine
 */
const getActiveTemplatesByChannel = async (channel) => {
  // channel can be: 'email', 'sms', or 'whatsapp'
  const validChannels = ['email', 'sms', 'whatsapp'];
  
  if (!validChannels.includes(channel)) {
    throw new Error(`Invalid channel. Must be one of: ${validChannels.join(', ')}`);
  }
  
  try {
    let query = '';
    if (channel === 'email') {
      query = `SELECT * FROM notification_templates 
               WHERE auto_email = TRUE AND email_body IS NOT NULL AND is_deleted = FALSE`;
    } else if (channel === 'sms') {
      query = `SELECT * FROM notification_templates 
               WHERE auto_sms = TRUE AND sms_body IS NOT NULL AND is_deleted = FALSE`;
    } else if (channel === 'whatsapp') {
      query = `SELECT * FROM notification_templates 
               WHERE auto_whatsapp = TRUE AND whatsapp_body IS NOT NULL AND is_deleted = FALSE`;
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
  deleteTemplate,
  getActiveTemplatesByChannel,
};