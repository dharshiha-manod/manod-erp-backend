/**
 * ====================================================
 * SELLING PRICE GROUP CONTROLLER
 * ====================================================
 */

const {
  fetchAllGroups, fetchGroupById, createGroup, updateGroup, deleteGroup,
} = require('../services/sellingPriceGroupService');

const getAllGroups = async (req, res) => {
  try {
    const { page = 1, limit = 25, search = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { groups, total } = await fetchAllGroups({ search, limit: parseInt(limit), offset });

    res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
      groups
    });
  } catch (err) {
    console.error('❌ Get All Selling Price Groups Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch selling price groups' });
  }
};

const getGroupById = async (req, res) => {
  try {
    const group = await fetchGroupById(req.params.id);
    if (!group) return res.status(404).json({ success: false, error: 'Selling price group not found' });
    res.status(200).json({ success: true, group });
  } catch (err) {
    console.error('❌ Get Selling Price Group Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch selling price group' });
  }
};

const addGroup = async (req, res) => {
  try {
    const group = await createGroup(req.body);
    console.log('✅ Selling price group created:', group.name);
    res.status(201).json({ success: true, message: 'Selling price group created successfully', group });
  } catch (err) {
    console.error('❌ Create Selling Price Group Error:', err.message);
    const status = err.message.includes('required') || err.message.includes('already') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

const editGroup = async (req, res) => {
  try {
    const group = await updateGroup(req.params.id, req.body);
    console.log('✅ Selling price group updated:', group.name);
    res.status(200).json({ success: true, message: 'Selling price group updated successfully', group });
  } catch (err) {
    console.error('❌ Update Selling Price Group Error:', err.message);
    const status = err.message.includes('not found') ? 404 : err.message.includes('already') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

const removeGroup = async (req, res) => {
  try {
    const group = await deleteGroup(req.params.id);
    console.log('✅ Selling price group deleted:', group.name);
    res.status(200).json({ success: true, message: 'Selling price group deleted successfully', group });
  } catch (err) {
    console.error('❌ Delete Selling Price Group Error:', err.message);
    const status = err.message.includes('not found') ? 404 : err.message.includes('Cannot delete') ? 409 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

module.exports = {
  getAllGroups, getGroupById, addGroup, editGroup, removeGroup,
};