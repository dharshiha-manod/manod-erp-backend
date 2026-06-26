/**
 * ====================================================
 * routes/notificationTemplates.js
 * Mount point: /api/notification-templates (register in server.js)
 * ====================================================
 */

const express = require('express');
const router = express.Router();

const authenticateToken = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permission');
const ctrl = require('../controllers/notificationTemplateController');

// ── PERMISSIONS ───────────────────────────────────────────────────────────────
// Define permission levels for different operations
const VIEW_TEMPLATES = [['Settings', 'View notification templates']];
const ADD_TEMPLATES = [['Settings', 'Add notification templates']];
const EDIT_TEMPLATES = [['Settings', 'Edit notification templates']];
const DELETE_TEMPLATES = [['Settings', 'Delete notification templates']];

/**
 * ────────────────────────────────────────────────────────────────────────────
 * CRUD OPERATIONS
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * GET ALL NOTIFICATION TEMPLATES
 * GET /api/notification-templates
 * 
 * Query Parameters:
 *   - search: string (search in template_type and email_subject)
 *   - auto_email: boolean (filter by auto_email flag)
 *   - auto_sms: boolean (filter by auto_sms flag)
 *   - auto_whatsapp: boolean (filter by auto_whatsapp flag)
 * 
 * Response:
 * {
 *   "success": true,
 *   "count": 5,
 *   "templates": [
 *     {
 *       "id": 1,
 *       "template_type": "new_sale",
 *       "email_subject": "Sale Confirmation",
 *       "email_body": "...",
 *       "auto_email": false,
 *       "sms_body": "...",
 *       "auto_sms": false,
 *       "whatsapp_body": "...",
 *       "auto_whatsapp": false,
 *       "created_at": "2024-...",
 *       "updated_at": "2024-..."
 *     },
 *     ...
 *   ]
 * }
 */
router.get('/',
  authenticateToken,
  // requireAnyPermission(VIEW_TEMPLATES),  // Temporarily disabled
  ctrl.getAllTemplates
);

/**
 * GET NOTIFICATION TEMPLATE BY ID
 * GET /api/notification-templates/:id
 * 
 * Response:
 * {
 *   "success": true,
 *   "template": { ... }
 * }
 */
router.get('/:id',
  authenticateToken,
  requireAnyPermission(VIEW_TEMPLATES),
  ctrl.getTemplateById
);

/**
 * GET TEMPLATE BY TYPE
 * GET /api/notification-templates/type/:templateType
 * 
 * Example: /api/notification-templates/type/new_sale
 * 
 * Response:
 * {
 *   "success": true,
 *   "template": { ... }
 * }
 */
router.get('/type/:templateType',
  authenticateToken,
  requireAnyPermission(VIEW_TEMPLATES),
  ctrl.getTemplateByType
);

/**
 * CREATE NEW NOTIFICATION TEMPLATE
 * POST /api/notification-templates
 * 
 * Request Body:
 * {
 *   "template_type": "new_sale",  // Required, unique
 *   "email_subject": "Sale Confirmation - {business_name}",
 *   "email_body": "Dear {contact_name}, Your sale #{invoice_number}...",
 *   "auto_email": false,
 *   "sms_body": "Sale #{invoice_number} confirmed",
 *   "auto_sms": false,
 *   "whatsapp_body": "Sale confirmed: {invoice_number}",
 *   "auto_whatsapp": false
 * }
 * 
 * Note: At least one channel (email_body, sms_body, whatsapp_body) must be provided
 * 
 * Response:
 * {
 *   "success": true,
 *   "message": "Notification template created successfully",
 *   "template": { ... }
 * }
 */
router.post('/',
  authenticateToken,
  requireAnyPermission(ADD_TEMPLATES),
  ctrl.createTemplate
);

/**
 * UPDATE NOTIFICATION TEMPLATE
 * PUT /api/notification-templates/:id
 * 
 * Request Body: (all fields optional for partial updates)
 * {
 *   "email_subject": "Updated Subject",
 *   "email_body": "Updated body...",
 *   "auto_email": true,
 *   "sms_body": "Updated SMS",
 *   "auto_sms": false,
 *   "whatsapp_body": "Updated WhatsApp",
 *   "auto_whatsapp": true
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "message": "Notification template updated successfully",
 *   "template": { ... }
 * }
 */
router.put('/:id',
  authenticateToken,
  requireAnyPermission(EDIT_TEMPLATES),
  ctrl.updateTemplate
);

/**
 * DELETE NOTIFICATION TEMPLATE
 * DELETE /api/notification-templates/:id
 * 
 * (Performs soft delete - marks as deleted without removing from database)
 * 
 * Response:
 * {
 *   "success": true,
 *   "message": "Notification template deleted successfully",
 *   "deleted": { "id": 1, "template_type": "new_sale", "deleted": true }
 * }
 */
router.delete('/:id',
  authenticateToken,
  requireAnyPermission(DELETE_TEMPLATES),
  ctrl.deleteTemplate
);

/**
 * ────────────────────────────────────────────────────────────────────────────
 * SPECIAL OPERATIONS
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * GET ACTIVE TEMPLATES FOR SPECIFIC CHANNEL
 * GET /api/notification-templates/active/:channel
 * 
 * Channel can be: email, sms, whatsapp
 * 
 * Returns all templates where:
 * - The channel is enabled (auto_email=true, auto_sms=true, etc.)
 * - The channel body is configured (not null)
 * 
 * Used by the notification automation engine
 * 
 * Response:
 * {
 *   "success": true,
 *   "channel": "email",
 *   "count": 3,
 *   "templates": [
 *     {
 *       "id": 1,
 *       "template_type": "new_sale",
 *       "email_subject": "...",
 *       "email_body": "...",
 *       ...
 *     },
 *     ...
 *   ]
 * }
 */
router.get('/active/:channel',
  authenticateToken,
  requireAnyPermission(VIEW_TEMPLATES),
  ctrl.getActiveTemplatesByChannel
);

/**
 * UPDATE AUTOMATION SETTINGS
 * PATCH /api/notification-templates/:id/automation
 * 
 * Only updates the auto_* flags without touching template content
 * 
 * Request Body:
 * {
 *   "auto_email": true,
 *   "auto_sms": false,
 *   "auto_whatsapp": true
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "message": "Automation settings updated successfully",
 *   "template": { ... }
 * }
 */
router.patch('/:id/automation',
  authenticateToken,
  requireAnyPermission(EDIT_TEMPLATES),
  ctrl.updateTemplateAutomation
);

module.exports = router;