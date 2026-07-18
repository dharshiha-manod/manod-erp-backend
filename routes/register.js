const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const ctrl = require('../controllers/registerController');

router.get('/open', authenticateToken, ctrl.getOpenShift);
router.post('/open', authenticateToken, ctrl.openShift);
router.post('/:id/close', authenticateToken, ctrl.closeShift);
router.post('/:id/cash-movement', authenticateToken, ctrl.addCashMovement);

module.exports = router;