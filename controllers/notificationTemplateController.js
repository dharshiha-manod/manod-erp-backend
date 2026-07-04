/**
 * controllers/notificationTemplateController.js
 */

const svc = require('../services/notificationTemplateService');

const getAllTemplates = async (req, res) => {
  try {
    const templates = await svc.fetchAllTemplates(req.query);
    res.json({ success: true, count: templates.length, templates });
  } catch (err) {
    console.error('Error fetching templates:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch templates' });
  }
};

const getTemplateById = async (req, res) => {
  try {
    const template = await svc.fetchTemplateById(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }
    res.json({ success: true, template });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch template' });
  }
};

const getTemplateByType = async (req, res) => {
  try {
    const template = await svc.fetchTemplateByType(req.params.templateType);
    // 404 here would force the frontend to special-case "new" templates —
    // instead return an empty shell so the form just renders blank.
    if (!template) {
      return res.json({
        success: true,
        template: {
          id: null,
          template_type: req.params.templateType,
          email_subject: '',
          cc_email: '',
          bcc_email: '',
          email_body: '',
          auto_email: false,
          sms_body: '',
          auto_sms: false,
          whatsapp_body: '',
          auto_whatsapp: false,
        },
      });
    }
    res.json({ success: true, template });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch template' });
  }
};

const createTemplate = async (req, res) => {
  try {
    const template = await svc.createTemplate(req.body);
    res.status(201).json({ success: true, message: 'Notification template created successfully', template });
  } catch (err) {
    console.error('Error creating template:', err.message);
    const status = /required|already exists|At least one/.test(err.message) ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

const updateTemplate = async (req, res) => {
  try {
    const template = await svc.updateTemplate(req.params.id, req.body);
    res.json({ success: true, message: 'Notification template updated successfully', template });
  } catch (err) {
    console.error('Error updating template:', err.message);
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

/**
 * SAVE (UPSERT) BY TYPE
 * PUT /api/notification-templates/type/:templateType
 * This is what the Notification Templates page's Save button calls —
 * no need to know a row id, one type = one row.
 */
const upsertTemplateByType = async (req, res) => {
  try {
    const template = await svc.upsertTemplateByType(req.params.templateType, req.body);
    res.json({ success: true, message: 'Notification template saved successfully', template });
  } catch (err) {
    console.error('Error saving template:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

const deleteTemplate = async (req, res) => {
  try {
    const deleted = await svc.deleteTemplate(req.params.id);
    res.json({ success: true, message: 'Notification template deleted successfully', deleted });
  } catch (err) {
    console.error('Error deleting template:', err.message);
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

const getActiveTemplatesByChannel = async (req, res) => {
  try {
    const templates = await svc.getActiveTemplatesByChannel(req.params.channel);
    res.json({ success: true, channel: req.params.channel, count: templates.length, templates });
  } catch (err) {
    const status = err.message.includes('Invalid channel') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

const updateTemplateAutomation = async (req, res) => {
  try {
    const { auto_email, auto_sms, auto_whatsapp } = req.body;
    const existing = await svc.fetchTemplateById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }
    const template = await svc.updateTemplate(req.params.id, {
      ...existing,
      auto_email: auto_email !== undefined ? auto_email : existing.auto_email,
      auto_sms: auto_sms !== undefined ? auto_sms : existing.auto_sms,
      auto_whatsapp: auto_whatsapp !== undefined ? auto_whatsapp : existing.auto_whatsapp,
    });
    res.json({ success: true, message: 'Automation settings updated successfully', template });
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
  upsertTemplateByType,
  deleteTemplate,
  getActiveTemplatesByChannel,
  updateTemplateAutomation,
};