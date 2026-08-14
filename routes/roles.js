const express = require('express');
const router  = express.Router();
const authenticateToken = require('../middleware/auth');
const requireIndustry = require('../middleware/industry');
const { requirePermission } = require('../middleware/permission');
const roleController = require('../controllers/roleController');

// Permissions route MUST come before /:id
router.get('/permissions', authenticateToken, requireIndustry, requirePermission('Roles', 'View role'), roleController.getAllPermissions);

router.get('/',       authenticateToken, requireIndustry, requirePermission('Roles', 'View role'),   roleController.getAllRoles);
router.get('/:id',    authenticateToken, requireIndustry, requirePermission('Roles', 'View role'),   roleController.getRoleById);
router.post('/',      authenticateToken, requireIndustry, requirePermission('Roles', 'Add Role'),    roleController.createRole);
router.put('/:id',    authenticateToken, requireIndustry, requirePermission('Roles', 'Edit Role'),   roleController.updateRole);
router.delete('/:id', authenticateToken, requireIndustry, requirePermission('Roles', 'Delete role'), roleController.deleteRole);

module.exports = router;