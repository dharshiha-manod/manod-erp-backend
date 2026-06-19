const express = require('express');
const router  = express.Router();
const roleController = require('../controllers/roleController');

// Permissions route MUST come before /:id
router.get('/permissions', roleController.getAllPermissions);

router.get('/',       roleController.getAllRoles);
router.get('/:id',    roleController.getRoleById);
router.post('/',      roleController.createRole);
router.put('/:id',    roleController.updateRole);
router.delete('/:id', roleController.deleteRole);

module.exports = router;