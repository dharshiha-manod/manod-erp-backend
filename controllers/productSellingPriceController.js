/**
 * ====================================================
 * PRODUCT SELLING PRICE CONTROLLER
 * ====================================================
 */

const {
  fetchPricesByProduct, upsertPrices, deletePrice,
} = require('../services/productSellingPriceService');

const getPricesForProduct = async (req, res) => {
  try {
    const prices = await fetchPricesByProduct(req.params.productId);
    res.status(200).json({ success: true, prices });
  } catch (err) {
    console.error('❌ Get Product Selling Prices Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch product selling prices' });
  }
};

const setPricesForProduct = async (req, res) => {
  try {
    const { prices } = req.body;
    const updated = await upsertPrices(req.params.productId, prices || []);
    console.log(`✅ Selling prices updated for product ${req.params.productId}`);
    res.status(200).json({ success: true, message: 'Selling prices updated successfully', prices: updated });
  } catch (err) {
    console.error('❌ Set Product Selling Prices Error:', err.message);
    const status = err.message.includes('required') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

const removePrice = async (req, res) => {
  try {
    const deleted = await deletePrice(req.params.productId, req.params.groupId);
    if (!deleted) return res.status(404).json({ success: false, error: 'Price entry not found' });
    res.status(200).json({ success: true, message: 'Price entry removed' });
  } catch (err) {
    console.error('❌ Delete Product Selling Price Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to remove price entry' });
  }
};

module.exports = {
  getPricesForProduct, setPricesForProduct, removePrice,
};