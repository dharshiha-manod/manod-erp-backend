const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/auditLogController');
const auth = require('../middleware/auth'); // use whatever your existing auth middleware is named
router.get('/', auth, ctrl.listLogs);
router.delete('/:id', auth, ctrl.deleteLog);

module.exports = router;