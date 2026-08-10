const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const ctrl = require('../controllers/industryController');

router.use(authenticateToken);

router.get('/', ctrl.getIndustries);
router.post('/', ctrl.createIndustry);
router.put('/:id', ctrl.updateIndustry);
router.delete('/:id', ctrl.deleteIndustry);
router.post('/set-active', ctrl.setActiveIndustry);

module.exports = router;