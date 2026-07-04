// ═══════════════════════════════════════════════════════════════
// controllers/sellController.js
// ═══════════════════════════════════════════════════════════════
const sellService = require("../services/sellService");
const multer      = require("multer");
const csv         = require("csv-parse/sync");

// multer — memory storage for CSV upload
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Response helpers ──────────────────────────────────────────
const ok    = (res, data, meta = {}) => res.status(200).json({ success: true, ...meta, data });
const created = (res, data)          => res.status(201).json({ success: true, data });
const notFound= (res, msg = "Not found") => res.status(404).json({ success: false, message: msg });
const err   = (res, e, msg = "Server error") => {
  console.error("[SellController]", msg, e?.message || e);
  res.status(500).json({ success: false, message: msg, error: e?.message });
};

// ═══════════════════════════════════════════════════════════════
// SALES INVOICES
// ═══════════════════════════════════════════════════════════════

const getAllInvoices = async (req, res) => {
  try {
    const filters = {
      status:   req.query.status,
      customer: req.query.customer,
      dateFrom: req.query.dateFrom,
      dateTo:   req.query.dateTo,
      search:   req.query.search,
      limit:    Number(req.query.limit)  || 100,
      offset:   Number(req.query.offset) || 0,
    };
    const data = await sellService.getAllInvoices(filters);
    ok(res, data, { total: data.length });
  } catch (e) { err(res, e, "Failed to get invoices"); }
};

const getInvoiceById = async (req, res) => {
  try {
    const data = await sellService.getInvoiceById(req.params.id);
    if (!data) return notFound(res, "Invoice not found");
    ok(res, data);
  } catch (e) { err(res, e, "Failed to get invoice"); }
};

const createInvoice = async (req, res) => {
  try {
    const data = await sellService.createInvoice(req.body);
    created(res, data);
  } catch (e) {
    if (e.code === "23505") // unique violation
      return res.status(409).json({ success: false, message: "Invoice number already exists" });
    err(res, e, "Failed to create invoice");
  }
};

const updateInvoice = async (req, res) => {
  try {
    const data = await sellService.updateInvoice(req.params.id, req.body);
    ok(res, data);
  } catch (e) { err(res, e, "Failed to update invoice"); }
};

const deleteInvoice = async (req, res) => {
  try {
    await sellService.deleteInvoice(req.params.id);
    ok(res, { deleted: true });
  } catch (e) { err(res, e, "Failed to delete invoice"); }
};

// ═══════════════════════════════════════════════════════════════
// POS SALES
// ═══════════════════════════════════════════════════════════════

const getAllPOSSales = async (req, res) => {
  try {
    const data = await sellService.getAllPOSSales({
      customer: req.query.customer,
      search:   req.query.search,
      limit:    Number(req.query.limit)  || 100,
      offset:   Number(req.query.offset) || 0,
    });
    ok(res, data, { total: data.length });
  } catch (e) { err(res, e, "Failed to get POS sales"); }
};

const getPOSSaleById = async (req, res) => {
  try {
    const data = await sellService.getPOSSaleById(req.params.id);
    if (!data) return notFound(res, "POS sale not found");
    ok(res, data);
  } catch (e) { err(res, e, "Failed to get POS sale"); }
};
const createPOSSale = async (req, res) => {
  try {
    const data = await sellService.createPOSSale(req.body);
    created(res, data);
  } catch (e) {
    if (e.code === "23505")
      return res.status(409).json({ success: false, message: "Reference number already exists" });
    err(res, e, "Failed to create POS sale");
  }
};

const updatePOSSale = async (req, res) => {
  try {
    const data = await sellService.updatePOSSale(req.params.id, req.body);
    ok(res, data);
  } catch (e) { err(res, e, "Failed to update POS sale"); }
};

const deletePOSSale = async (req, res) => {
  try {
    await sellService.deletePOSSale(req.params.id);
    ok(res, { deleted: true });
  } catch (e) { err(res, e, "Failed to delete POS sale"); }
};

// ═══════════════════════════════════════════════════════════════
// QUOTATIONS
// ═══════════════════════════════════════════════════════════════

const getAllQuotations = async (req, res) => {
  try {
    const data = await sellService.getAllQuotations({
      status: req.query.status,
      search: req.query.search,
      limit:  Number(req.query.limit)  || 100,
      offset: Number(req.query.offset) || 0,
    });
    ok(res, data, { total: data.length });
  } catch (e) { err(res, e, "Failed to get quotations"); }
};

const getQuotationById = async (req, res) => {
  try {
    const data = await sellService.getQuotationById(req.params.id);
    if (!data) return notFound(res, "Quotation not found");
    ok(res, data);
  } catch (e) { err(res, e, "Failed to get quotation"); }
};

const createQuotation = async (req, res) => {
  try {
    const data = await sellService.createQuotation(req.body);
    created(res, data);
  } catch (e) {
    if (e.code === "23505")
      return res.status(409).json({ success: false, message: "Quotation number already exists" });
    err(res, e, "Failed to create quotation");
  }
};

const updateQuotation = async (req, res) => {
  try {
    const data = await sellService.updateQuotation(req.params.id, req.body);
    ok(res, data);
  } catch (e) { err(res, e, "Failed to update quotation"); }
};

const deleteQuotation = async (req, res) => {
  try {
    await sellService.deleteQuotation(req.params.id);
    ok(res, { deleted: true });
  } catch (e) { err(res, e, "Failed to delete quotation"); }
};

// ═══════════════════════════════════════════════════════════════
// SALES RETURNS
// ═══════════════════════════════════════════════════════════════

const getAllReturns = async (req, res) => {
  try {
    const data = await sellService.getAllReturns({
      limit:  Number(req.query.limit)  || 100,
      offset: Number(req.query.offset) || 0,
    });
    ok(res, data, { total: data.length });
  } catch (e) { err(res, e, "Failed to get returns"); }
};

const getReturnById = async (req, res) => {
  try {
    const data = await sellService.getReturnById(req.params.id);
    if (!data) return notFound(res, "Return not found");
    ok(res, data);
  } catch (e) { err(res, e, "Failed to get return"); }
};

const createReturn = async (req, res) => {
  try {
    const data = await sellService.createReturn(req.body);
    created(res, data);
  } catch (e) {
    if (e.code === "23505")
      return res.status(409).json({ success: false, message: "Return number already exists" });
    err(res, e, "Failed to create return");
  }
};
const updateReturn = async (req, res) => {
  try {
    const data = await sellService.updateReturn(req.params.id, req.body);
    ok(res, data);
  } catch (e) { err(res, e, "Failed to update return"); }
};

const deleteReturn = async (req, res) => {
  try {
    await sellService.deleteReturn(req.params.id);
    ok(res, { deleted: true });
  } catch (e) { err(res, e, "Failed to delete return"); }
};
// ═══════════════════════════════════════════════════════════════
// DRAFTS
// ═══════════════════════════════════════════════════════════════

const getAllDrafts = async (req, res) => {
  try {
    const data = await sellService.getAllDrafts({
      search: req.query.search,
      limit:  Number(req.query.limit)  || 100,
      offset: Number(req.query.offset) || 0,
    });
    ok(res, data, { total: data.length });
  } catch (e) { err(res, e, "Failed to get drafts"); }
};

const getDraftById = async (req, res) => {
  try {
    const data = await sellService.getDraftById(req.params.id);
    if (!data) return notFound(res, "Draft not found");
    ok(res, data);
  } catch (e) { err(res, e, "Failed to get draft"); }
};

const createDraft = async (req, res) => {
  try {
    const data = await sellService.createDraft(req.body);
    created(res, data);
  } catch (e) { err(res, e, "Failed to create draft"); }
};

const updateDraft = async (req, res) => {
  try {
    const data = await sellService.updateDraft(req.params.id, req.body);
    ok(res, data);
  } catch (e) { err(res, e, "Failed to update draft"); }
};

const deleteDraft = async (req, res) => {
  try {
    await sellService.deleteDraft(req.params.id);
    ok(res, { deleted: true });
  } catch (e) { err(res, e, "Failed to delete draft"); }
};
// ═══════════════════════════════════════════════════════════════
// SHIPMENTS
// ═══════════════════════════════════════════════════════════════

const getAllShipments = async (req, res) => {
  try {
    const data = await sellService.getAllShipments({
      status: req.query.status,
      search: req.query.search,
      limit:  Number(req.query.limit)  || 100,
      offset: Number(req.query.offset) || 0,
    });
    ok(res, data, { total: data.length });
  } catch (e) { err(res, e, "Failed to get shipments"); }
};

const getShipmentById = async (req, res) => {
  try {
    const data = await sellService.getShipmentById(req.params.id);
    if (!data) return notFound(res, "Shipment not found");
    ok(res, data);
  } catch (e) { err(res, e, "Failed to get shipment"); }
};

const createShipment = async (req, res) => {
  try {
    const data = await sellService.createShipment(req.body);
    created(res, data);
  } catch (e) {
    if (e.code === "23505")
      return res.status(409).json({ success: false, message: "Shipment number already exists" });
    err(res, e, "Failed to create shipment");
  }
};

const updateShipment = async (req, res) => {
  try {
    const data = await sellService.updateShipment(req.params.id, req.body);
    ok(res, data);
  } catch (e) { err(res, e, "Failed to update shipment"); }
};

const deleteShipment = async (req, res) => {
  try {
    await sellService.deleteShipment(req.params.id);
    ok(res, { deleted: true });
  } catch (e) { err(res, e, "Failed to delete shipment"); }
};

// ═══════════════════════════════════════════════════════════════
// DISCOUNTS
// ═══════════════════════════════════════════════════════════════

const getAllDiscounts = async (req, res) => {
  try {
    const data = await sellService.getAllDiscounts({
      status: req.query.status,
      limit:  Number(req.query.limit)  || 100,
      offset: Number(req.query.offset) || 0,
    });
    ok(res, data, { total: data.length });
  } catch (e) { err(res, e, "Failed to get discounts"); }
};

const getDiscountById = async (req, res) => {
  try {
    const data = await sellService.getDiscountById(req.params.id);
    if (!data) return notFound(res, "Discount not found");
    ok(res, data);
  } catch (e) { err(res, e, "Failed to get discount"); }
};

const validateDiscountCode = async (req, res) => {
  try {
    const { code } = req.params;
    const data = await sellService.getDiscountByCode(code);
    if (!data) return notFound(res, "Discount code not found or inactive");
    ok(res, data);
  } catch (e) { err(res, e, "Failed to validate discount"); }
};

const createDiscount = async (req, res) => {
  try {
    const data = await sellService.createDiscount(req.body);
    created(res, data);
  } catch (e) {
    if (e.code === "23505")
      return res.status(409).json({ success: false, message: "Discount code already exists" });
    err(res, e, "Failed to create discount");
  }
};

const updateDiscount = async (req, res) => {
  try {
    const data = await sellService.updateDiscount(req.params.id, req.body);
    ok(res, data);
  } catch (e) { err(res, e, "Failed to update discount"); }
};

const deleteDiscount = async (req, res) => {
  try {
    await sellService.deleteDiscount(req.params.id);
    ok(res, { deleted: true });
  } catch (e) { err(res, e, "Failed to delete discount"); }
};

// ═══════════════════════════════════════════════════════════════
// IMPORT SALES (CSV)
// ═══════════════════════════════════════════════════════════════

const importSales = [
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

      const text = req.file.buffer.toString("utf-8");
      let rows;
      try {
        rows = csv.parse(text, { columns: true, skip_empty_lines: true, trim: true });
      } catch (parseErr) {
        return res.status(400).json({ success: false, message: "Invalid CSV format", error: parseErr.message });
      }

      if (!rows || rows.length === 0)
        return res.status(400).json({ success: false, message: "CSV file is empty or has no data rows" });

     const result = await sellService.importSalesFromCSV(rows, req.file.originalname, req.user?.id || null);
      ok(res, result, {
        message: `Import complete: ${result.imported} records imported${result.errors.length ? `, ${result.errors.length} skipped` : ""}`,
        imported: result.imported,
      });
    } catch (e) { err(res, e, "Import failed"); }
  }
];

module.exports = {
  // Invoices
  getAllInvoices, getInvoiceById, createInvoice, updateInvoice, deleteInvoice,
  // POS
  getAllPOSSales, getPOSSaleById, createPOSSale, updatePOSSale, deletePOSSale,
  // Quotations
  getAllQuotations, getQuotationById, createQuotation, updateQuotation, deleteQuotation,
  // Drafts
  getAllDrafts, getDraftById, createDraft, updateDraft, deleteDraft,
  // Returns
  // Returns
  getAllReturns, getReturnById, createReturn, updateReturn, deleteReturn,
  // Shipments
  getAllShipments, getShipmentById, createShipment, updateShipment, deleteShipment,
  // Discounts
  getAllDiscounts, getDiscountById, validateDiscountCode, createDiscount, updateDiscount, deleteDiscount,
  // Import
  importSales,
};