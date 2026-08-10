/**
 * ====================================================
 * CONTACT CONTROLLER
 * Suppliers / Customers / Customer Groups / Import
 * UPDATED: Industry Workspace Isolation — every call now
 * scoped to req.industryId (set by requireIndustry middleware,
 * mounted on /api/contacts in server.js).
 * ====================================================
 */

const contactService = require('../services/contactService');
const accountingService = require('../services/accountingService');
const reportService = require('../services/reportService');

const getAllContacts = async (req, res) => {
  try {
    const {
      page = 1, limit = 25, search = '', mobile = '', city = '',
      payTerm = '', customerGroupId = '', dateFrom = '', dateTo = '',
      contactType = '',
    } = req.query;

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const { rows, total } = await contactService.fetchAllContacts(req.industryId, {
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

const getContactById = async (req, res) => {
  try {
    const contact = await contactService.fetchContactById(req.industryId, req.params.id);
    if (!contact) return res.status(404).json({ success: false, error: 'Contact not found' });
    res.status(200).json({ success: true, contact });
  } catch (err) {
    console.error('❌ Get Contact By ID Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch contact' });
  }
};

const createContact = async (req, res) => {
  try {
    if (!req.body.mobile || !String(req.body.mobile).trim()) {
      return res.status(400).json({ success: false, error: 'Mobile is required' });
    }
    const contact = await contactService.createContact(req.industryId, req.body);
    res.status(201).json({ success: true, message: 'Contact created successfully', contact });
  } catch (err) {
    console.error('❌ Create Contact Error:', err.message);
    res.status(400).json({ success: false, error: err.message || 'Failed to create contact' });
  }
};

const updateContact = async (req, res) => {
  try {
    const contact = await contactService.updateContact(req.industryId, req.params.id, req.body);
    res.status(200).json({ success: true, message: 'Contact updated successfully', contact });
  } catch (err) {
    console.error('❌ Update Contact Error:', err.message);
    const status = err.message === 'Contact not found' ? 404 : 400;
    res.status(status).json({ success: false, error: err.message || 'Failed to update contact' });
  }
};

const deleteContact = async (req, res) => {
  try {
    const contact = await contactService.deleteContact(req.industryId, req.params.id);
    res.status(200).json({ success: true, message: 'Contact deleted successfully', contact });
  } catch (err) {
    console.error('❌ Delete Contact Error:', err.message);
    const status = err.message === 'Contact not found' ? 404 : 500;
    res.status(status).json({ success: false, error: err.message || 'Failed to delete contact' });
  }
};

const getStats = async (req, res) => {
  try {
    const stats = await contactService.getContactStats(req.industryId);
    res.status(200).json({ success: true, stats });
  } catch (err) {
    console.error('❌ Get Contact Stats Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
  }
};

const importContacts = async (req, res) => {
  try {
    const rows = req.body.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'No rows to import' });
    }
    const result = await contactService.bulkImportContacts(req.industryId, rows);
    res.status(200).json({ success: true, message: 'Import completed', ...result });
  } catch (err) {
    console.error('❌ Import Contacts Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to import contacts' });
  }
};

const getAllGroups = async (req, res) => {
  try {
    const groups = await contactService.fetchAllGroups(req.industryId);
    res.status(200).json({ success: true, groups });
  } catch (err) {
    console.error('❌ Get Groups Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch customer groups' });
  }
};

const createGroup = async (req, res) => {
  try {
    const group = await contactService.createGroup(req.industryId, req.body);
    res.status(201).json({ success: true, message: 'Customer group created', group });
  } catch (err) {
    console.error('❌ Create Group Error:', err.message);
    const status = err.message.includes('already exists') ? 409 : 400;
    res.status(status).json({ success: false, error: err.message || 'Failed to create group' });
  }
};

const updateGroup = async (req, res) => {
  try {
    const group = await contactService.updateGroup(req.industryId, req.params.id, req.body);
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
    const group = await contactService.deleteGroup(req.industryId, req.params.id);
    res.status(200).json({ success: true, message: 'Customer group deleted', group });
  } catch (err) {
    console.error('❌ Delete Group Error:', err.message);
    const status = err.message === 'Group not found' ? 404 : 500;
    res.status(status).json({ success: false, error: err.message || 'Failed to delete group' });
  }
};

const getCustomerPricingInfo = async (req, res) => {
  try {
    const info = await contactService.fetchCustomerPricingInfo(req.industryId, req.params.id);
    if (!info) return res.status(404).json({ success: false, error: 'Contact not found' });
    res.status(200).json({ success: true, pricing: info });
  } catch (err) {
    console.error('❌ Get Customer Pricing Info Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch pricing info' });
  }
};

// ── Real outstanding (Receivable/Payable), driven by opening_balance +
// actual invoice/purchase/payment transactions — see accountingService's
// getCustomerOutstanding / getSupplierOutstanding (single source of truth
// also used by Sell's credit-limit check, Reports, and Statements). ────────
const getOutstanding = async (req, res) => {
  try {
    const contact = await contactService.fetchContactById(req.industryId, req.params.id);
    if (!contact) return res.status(404).json({ success: false, error: 'Contact not found' });

    const result = {};
    if (contact.contact_type === 'Customers' || contact.contact_type === 'Both') {
      result.customer = await accountingService.getCustomerOutstanding(req.industryId, req.params.id);
    }
    if (contact.contact_type === 'Suppliers' || contact.contact_type === 'Both') {
      result.supplier = await accountingService.getSupplierOutstanding(req.industryId, req.params.id);
    }
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('❌ Get Outstanding Error:', err.message);
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch outstanding' });
  }
};

const getStatement = async (req, res) => {
  try {
    const contact = await contactService.fetchContactById(req.industryId, req.params.id);
    if (!contact) return res.status(404).json({ success: false, error: 'Contact not found' });

    const side = req.query.side || (contact.contact_type === 'Suppliers' ? 'supplier' : 'customer');
    const statement = side === 'supplier'
      ? await accountingService.getSupplierStatement(req.industryId, req.params.id)
      : await accountingService.getCustomerStatement(req.industryId, req.params.id);

    res.status(200).json({ success: true, statement });
  } catch (err) {
    console.error('❌ Get Statement Error:', err.message);
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch statement' });
  }
};

// ── Record a standalone customer/supplier payment (opening balance
// settlement, lump-sum/advance collection) — real transaction, mirrored
// into Cash & Bank via bankIntegrationService, same as existing
// Sell/Purchase payment flows. ─────────────────────────────────────────────
const recordPayment = async (req, res) => {
  try {
    const contact = await contactService.fetchContactById(req.industryId, req.params.id);
    if (!contact) return res.status(404).json({ success: false, error: 'Contact not found' });

    const direction = req.body.direction
      || (contact.contact_type === 'Suppliers' ? 'out' : 'in');

    const result = direction === 'out'
      ? await accountingService.recordSupplierPayment(req.industryId, req.params.id, req.body, req.user?.id, req.user?.name)
      : await accountingService.recordCustomerPayment(req.industryId, req.params.id, req.body, req.user?.id, req.user?.name);

    res.status(201).json({ success: true, ...result });
  } catch (err) {
    console.error('❌ Record Payment Error:', err.message);
    res.status(400).json({ success: false, error: err.message || 'Failed to record payment' });
  }
};

// ── Sales-side standalone customer payment with FIFO invoice allocation ────
// Distinct from recordPayment above (generic opening-balance/advance
// collector). This is the dedicated Sales flow: applies the payment across
// the customer's open invoices oldest-first, writes per-invoice allocation
// rows, and updates each invoice's paid_amount/payment_status atomically.
const recordSalesPayment = async (req, res) => {
  try {
    const contact = await contactService.fetchContactById(req.industryId, req.params.id);
    if (!contact) return res.status(404).json({ success: false, error: 'Contact not found' });
    if (contact.contact_type === 'Suppliers') {
      return res.status(400).json({ success: false, error: 'This contact is a Supplier — use the supplier payment flow' });
    }

    const result = await accountingService.recordCustomerPaymentFIFO(
      req.industryId, req.params.id, req.body, req.user?.id, req.user?.name
    );

    res.status(201).json({ success: true, ...result });
  } catch (err) {
    console.error('❌ Record Sales Payment (FIFO) Error:', err.message);
    const status = err.message === 'Customer not found' ? 404 : 400;
    res.status(status).json({ success: false, error: err.message || 'Failed to record payment' });
  }
};

const getLedger = async (req, res) => {
  try {
    const ledger = await reportService.getContactLedger(req.industryId, req.params.id);
    if (!ledger) return res.status(404).json({ success: false, error: 'Contact not found' });
    res.status(200).json({ success: true, ...ledger });
  } catch (err) {
    console.error('❌ Get Contact Ledger Error:', err.message);
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch ledger' });
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
  getOutstanding,
  getStatement,
  recordPayment,
  recordSalesPayment,
  getLedger,
};    