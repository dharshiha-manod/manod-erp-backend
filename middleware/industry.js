const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const requireIndustry = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, error: 'Access token required', code: 'NO_TOKEN' });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ success: false, error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
    }

    const businessId = payload.business_id || 1;
    const headerIndustryId = req.headers['x-industry-id'];
    let industryId = headerIndustryId ? parseInt(headerIndustryId, 10) : null;

    if (!industryId) {
      const u = await pool.query(`SELECT last_active_industry_id FROM users WHERE id = $1`, [payload.id]);
      industryId = u.rows[0]?.last_active_industry_id || null;
    }

    if (!industryId) {
      return res.status(428).json({
        success: false,
        code: 'NO_INDUSTRY_SELECTED',
        message: 'Please select an Industry workspace in General Settings before continuing.'
      });
    }

    const check = await pool.query(
      `SELECT id FROM industries WHERE id = $1 AND business_id = $2 AND is_active = true`,
      [industryId, businessId]
    );
    if (check.rows.length === 0) {
      return res.status(403).json({ success: false, code: 'INVALID_INDUSTRY', message: 'Selected industry is invalid or no longer available.' });
    }

    req.industryId = industryId;
    next();
  } catch (err) {
    console.error('requireIndustry error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to resolve active industry' });
  }
};

module.exports = requireIndustry;