const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const pool = require('../config/database');

// GET all selling-price-group prices for one product
router.get('/:productId', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT product_id, selling_price_group_id, selling_price
       FROM product_selling_prices
       WHERE product_id = $1`,
      [req.params.productId]
    );
    res.status(200).json({ success: true, prices: result.rows });
  } catch (err) {
    console.error('❌ Get Product Selling Prices Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch product selling prices' });
  }
});

module.exports = router;