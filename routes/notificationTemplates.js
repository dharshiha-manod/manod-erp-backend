/**
 * ====================================================
 * routes/notificationTemplates.js
 * Mount point: /api/notification-templates (already registered in server.js)
 * ====================================================
 */

const express = require('express');
const router = express.Router();

const authenticateToken = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permission');
const ctrl = require('../controllers/notificationTemplateController');

// ── PERMISSIONS ───────────────────────────────────────────────────────────────
// NOTE: there is no dedicated "notification templates" permission row in the
// DB — access is gated the same way the Notifications menu item itself is
// gated in featurePermissionMap.js (FEATURES.NOTIFICATIONS), i.e. any of the
// existing Settings permissions. Admin always bypasses via requireAnyPermission.
const SETTINGS_ACCESS = [
  ['Settings', 'Access business settings'],
  ['Settings', 'Access invoice settings'],
  ['Settings', 'Access barcode settings'],
  ['Settings', 'Access printers'],
];

/**
 * GET ALL NOTIFICATION TEMPLATES
 * GET /api/notification-templates
 */
router.get('/', authenticateToken, requireAnyPermission(SETTINGS_ACCESS), ctrl.getAllTemplates);

/**
 * GET TEMPLATE BY TYPE  (used by the frontend to load a tab's form)
 * GET /api/notification-templates/type/:templateType
 * Always returns 200 with an empty shell if nothing's saved yet.
 */
router.get('/type/:templateType', authenticateToken, requireAnyPermission(SETTINGS_ACCESS), ctrl.getTemplateByType);

/**
 * SAVE (UPSERT) TEMPLATE BY TYPE  (used by the frontend Save button)
 * PUT /api/notification-templates/type/:templateType
 * Body: { email_subject, cc_email, bcc_email, email_body, auto_email,
 *          sms_body, auto_sms, whatsapp_body, auto_whatsapp }
 */
router.put('/type/:templateType', authenticateToken, requireAnyPermission(SETTINGS_ACCESS), ctrl.upsertTemplateByType);

/**
 * GET NOTIFICATION TEMPLATE BY ID
 * GET /api/notification-templates/:id
 */
router.get('/:id', authenticateToken, requireAnyPermission(SETTINGS_ACCESS), ctrl.getTemplateById);

/**
 * CREATE NEW NOTIFICATION TEMPLATE
 * POST /api/notification-templates
 */
router.post('/', authenticateToken, requireAnyPermission(SETTINGS_ACCESS), ctrl.createTemplate);

/**
 * UPDATE NOTIFICATION TEMPLATE BY ID
 * PUT /api/notification-templates/:id
 */
router.put('/:id', authenticateToken, requireAnyPermission(SETTINGS_ACCESS), ctrl.updateTemplate);

/**
 * DELETE NOTIFICATION TEMPLATE (soft delete)
 * DELETE /api/notification-templates/:id
 */
router.delete('/:id', authenticateToken, requireAnyPermission(SETTINGS_ACCESS), ctrl.deleteTemplate);

/**
 * GET ACTIVE TEMPLATES FOR A CHANNEL (used by the automation engine)
 * GET /api/notification-templates/active/:channel
 */
router.get('/active/:channel', authenticateToken, requireAnyPermission(SETTINGS_ACCESS), ctrl.getActiveTemplatesByChannel);

/**
 * UPDATE AUTOMATION FLAGS ONLY
 * PATCH /api/notification-templates/:id/automation
 */
router.patch('/:id/automation', authenticateToken, requireAnyPermission(SETTINGS_ACCESS), ctrl.updateTemplateAutomation);

module.exports = router;