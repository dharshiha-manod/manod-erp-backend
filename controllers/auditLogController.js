const auditLogService = require('../services/auditLogService');

const listLogs = async (req, res) => {
  try {
    const result = await auditLogService.fetchLogs(req.query);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const deleteLog = async (req, res) => {
  try {
    const deleted = await auditLogService.deleteLog(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Log not found' });
    res.json({ success: true, deleted });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

module.exports = { listLogs, deleteLog };