/**
 * ====================================================
 * CONTACT CONTROLLER
 * Suppliers / Customers / Customer Groups / Import
 * ====================================================
 */

const contactService = require('../services/contactService');

// ── GET ALL CONTACTS (paginated, filterable) ──
const getAllContacts = async (req, res) => {
  try {
    const {
      page = 1, limit = 25, search = '', mobile = '', city = '',
      payTerm = '', customerGroupId = '', dateFrom = '', dateTo = '',
      contactType = '',
    } = req.query;

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const { rows, total } = await contactService.fetchAllContacts({
      contactType, search, mobile, city, payTerm, customerGroupId, dateFrom, dateTo,
      limit: parseInt(limit, 10), offset,
    });

    res.status(200).json({
      success: true,
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / parseInt(limit, 10)),
      contacts: rows,
    });
  } catch (err) {
    console.error('❌ Get All Contacts Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch contacts' });
  }
};

// ── GET SINGLE CONTACT ──
const getContactById = async (req, res) => {
  try {
    const contact = await contactService.fetchContactById(req.params.id);
    if (!contact) return res.status(404).json({ success: false, error: 'Contact not found' });
    res.status(200).json({ success: true, contact });
  } catch (err) {
    console.error('❌ Get Contact By ID Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch contact' });
  }
};

// ── CREATE CONTACT ──
const createContact = async (req, res) => {
  try {
    if (!req.body.mobile || !String(req.body.mobile).trim()) {
      return res.status(400).json({ success: false, error: 'Mobile is required' });
    }
    const contact = await contactService.createContact(req.body);
    console.log('✅ Contact created:', contact.contact_id);
    res.status(201).json({ success: true, message: 'Contact created successfully', contact });
  } catch (err) {
    console.error('❌ Create Contact Error:', err.message);
    res.status(400).json({ success: false, error: err.message || 'Failed to create contact' });
  }
};

// ── UPDATE CONTACT ──
const updateContact = async (req, res) => {
  try {
    const contact = await contactService.updateContact(req.params.id, req.body);
    console.log('✅ Contact updated:', contact.contact_id);
    res.status(200).json({ success: true, message: 'Contact updated successfully', contact });
  } catch (err) {
    console.error('❌ Update Contact Error:', err.message);
    const status = err.message === 'Contact not found' ? 404 : 400;
    res.status(status).json({ success: false, error: err.message || 'Failed to update contact' });
  }
};

// ── DELETE CONTACT ──
const deleteContact = async (req, res) => {
  try {
    const contact = await contactService.deleteContact(req.params.id);
    console.log('✅ Contact deleted:', contact.contact_id);
    res.status(200).json({ success: true, message: 'Contact deleted successfully', contact });
  } catch (err) {
    console.error('❌ Delete Contact Error:', err.message);
    const status = err.message === 'Contact not found' ? 404 : 500;
    res.status(status).json({ success: false, error: err.message || 'Failed to delete contact' });
  }
};

// ── DASHBOARD STATS ──
const getStats = async (req, res) => {
  try {
    const stats = await contactService.getContactStats();
    res.status(200).json({ success: true, stats });
  } catch (err) {
    console.error('❌ Get Contact Stats Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
  }
};

// ── IMPORT CONTACTS (rows pre-parsed on frontend or via multer+csv-parser) ──
const importContacts = async (req, res) => {
  try {
    const rows = req.body.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'No rows to import' });
    }
    const result = await contactService.bulkImportContacts(rows);
    res.status(200).json({ success: true, message: 'Import completed', ...result });
  } catch (err) {
    console.error('❌ Import Contacts Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to import contacts' });
  }
};

// ── CUSTOMER GROUPS ──
const getAllGroups = async (req, res) => {
  try {
    const groups = await contactService.fetchAllGroups();
    res.status(200).json({ success: true, groups });
  } catch (err) {
    console.error('❌ Get Groups Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch customer groups' });
  }
};

const createGroup = async (req, res) => {
  try {
    const group = await contactService.createGroup(req.body);
    res.status(201).json({ success: true, message: 'Customer group created', group });
  } catch (err) {
    console.error('❌ Create Group Error:', err.message);
    const status = err.message.includes('already exists') ? 409 : 400;
    res.status(status).json({ success: false, error: err.message || 'Failed to create group' });
  }
};

const updateGroup = async (req, res) => {
  try {
    const group = await contactService.updateGroup(req.params.id, req.body);
    res.status(200).json({ success: true, message: 'Customer group updated', group });
  } catch (err) {
    console.error('❌ Update Group Error:', err.message);
    let status = 400;
    if (err.message === 'Group not found') status = 404;
    if (err.message.includes('already exists')) status = 409;
    res.status(status).json({ success: false, error: err.message || 'Failed to update group' });
  }
};

const deleteGroup = async (req, res) => {
  try {
    const group = await contactService.deleteGroup(req.params.id);
    res.status(200).json({ success: true, message: 'Customer group deleted', group });
  } catch (err) {
    console.error('❌ Delete Group Error:', err.message);
    const status = err.message === 'Group not found' ? 404 : 500;
    res.status(status).json({ success: false, error: err.message || 'Failed to delete group' });
  }
};

// ── NEW: pricing info for Sales/POS auto-detect ──
const getCustomerPricingInfo = async (req, res) => {
  try {
    const info = await contactService.fetchCustomerPricingInfo(req.params.id);
    if (!info) return res.status(404).json({ success: false, error: 'Contact not found' });
    res.status(200).json({ success: true, pricing: info });
  } catch (err) {
    console.error('❌ Get Customer Pricing Info Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch pricing info' });
  }
};

module.exports = {
  getAllContacts,
  getContactById,
  createContact,
  updateContact,
  deleteContact,
  getStats,
  importContacts,
  getAllGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  getCustomerPricingInfo,
};