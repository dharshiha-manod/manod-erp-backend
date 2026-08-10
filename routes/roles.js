const express = require('express');
const router  = express.Router();
const authenticateToken = require('../middleware/auth');
const requireIndustry = require('../middleware/industry');
const roleController = require('../controllers/roleController');

// Permissions route MUST come before /:id
router.get('/permissions', authenticateToken, requireIndustry, roleController.getAllPermissions);

router.get('/',       authenticateToken, requireIndustry, roleController.getAllRoles);
router.get('/:id',    authenticateToken, requireIndustry, roleController.getRoleById);
router.post('/',      authenticateToken, requireIndustry, roleController.createRole);
router.put('/:id',    authenticateToken, requireIndustry, roleController.updateRole);
router.delete('/:id', authenticateToken, requireIndustry, roleController.deleteRole);

module.exports = router;