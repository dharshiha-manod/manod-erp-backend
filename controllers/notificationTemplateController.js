/**
 * controllers/notificationTemplateController.js
 */

const pool = require('../config/database');

const getAllTemplates = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM notification_templates WHERE deleted = false ORDER BY created_at DESC'
    );
    res.json({
      success: true,
      count: result.rows.length,
      templates: result.rows
    });
  } catch (err) {
    console.error('Error fetching templates:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch templates' });
  }
};

const getTemplateById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM notification_templates WHERE id = $1 AND deleted = false',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }
    res.json({ success: true, template: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch template' });
  }
};

const getTemplateByType = async (req, res) => {
  try {
    const { templateType } = req.params;
    const result = await pool.query(
      'SELECT * FROM notification_templates WHERE template_type = $1 AND deleted = false',
      [templateType]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }
    res.json({ success: true, template: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch template' });
  }
};

const createTemplate = async (req, res) => {
  try {
    const { template_type, email_subject, email_body, auto_email, sms_body, auto_sms, whatsapp_body, auto_whatsapp } = req.body;
    
    if (!template_type) {
      return res.status(400).json({ success: false, error: 'template_type is required' });
    }

    const result = await pool.query(
      `INSERT INTO notification_templates (template_type, email_subject, email_body, auto_email, sms_body, auto_sms, whatsapp_body, auto_whatsapp, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING *`,
      [template_type, email_subject, email_body, auto_email, sms_body, auto_sms, whatsapp_body, auto_whatsapp]
    );

    res.status(201).json({
      success: true,
      message: 'Notification template created successfully',
      template: result.rows[0]
    });
  } catch (err) {
    console.error('Error creating template:', err);
    res.status(500).json({ success: false, error: 'Failed to create template' });
  }
};

const updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { email_subject, email_body, auto_email, sms_body, auto_sms, whatsapp_body, auto_whatsapp } = req.body;

    const result = await pool.query(
      `UPDATE notification_templates 
       SET email_subject = COALESCE($1, email_subject),
           email_body = COALESCE($2, email_body),
           auto_email = COALESCE($3, auto_email),
           sms_body = COALESCE($4, sms_body),
           auto_sms = COALESCE($5, auto_sms),
           whatsapp_body = COALESCE($6, whatsapp_body),
           auto_whatsapp = COALESCE($7, auto_whatsapp),
           updated_at = NOW()
       WHERE id = $8 AND deleted = false
       RETURNING *`,
      [email_subject, email_body, auto_email, sms_body, auto_sms, whatsapp_body, auto_whatsapp, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    res.json({
      success: true,
      message: 'Notification template updated successfully',
      template: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating template:', err);
    res.status(500).json({ success: false, error: 'Failed to update template' });
  }
};

const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE notification_templates SET deleted = true, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    res.json({
      success: true,
      message: 'Notification template deleted successfully',
      deleted: result.rows[0]
    });
  } catch (err) {
    console.error('Error deleting template:', err);
    res.status(500).json({ success: false, error: 'Failed to delete template' });
  }
};

const getActiveTemplatesByChannel = async (req, res) => {
  try {
    const { channel } = req.params;
    const columnMap = { email: 'auto_email', sms: 'auto_sms', whatsapp: 'auto_whatsapp' };
    const column = columnMap[channel];

    if (!column) {
      return res.status(400).json({ success: false, error: 'Invalid channel' });
    }

    const result = await pool.query(
      `SELECT * FROM notification_templates WHERE ${column} = true AND deleted = false`
    );

    res.json({ success: true, channel, count: result.rows.length, templates: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch active templates' });
  }
};

const updateTemplateAutomation = async (req, res) => {
  try {
    const { id } = req.params;
    const { auto_email, auto_sms, auto_whatsapp } = req.body;

    const result = await pool.query(
      `UPDATE notification_templates 
       SET auto_email = COALESCE($1, auto_email),
           auto_sms = COALESCE($2, auto_sms),
           auto_whatsapp = COALESCE($3, auto_whatsapp),
           updated_at = NOW()
       WHERE id = $4 AND deleted = false
       RETURNING *`,
      [auto_email, auto_sms, auto_whatsapp, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    res.json({
      success: true,
      message: 'Automation settings updated successfully',
      template: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update automation settings' });
  }
};

module.exports = {
  getAllTemplates,
  getTemplateById,
  getTemplateByType,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getActiveTemplatesByChannel,
  updateTemplateAutomation
};