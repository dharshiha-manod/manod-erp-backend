  // ═══════════════════════════════════════════════════════════════
  // services/sellService.js
  // All DB operations for the Sell module
  // Uses the same `pool` pattern as your other services
  // ═══════════════════════════════════════════════════════════════
// ── NEW CODE ──
  const db = require("../config/database"); // adjust path to match your project
const contactService = require("./contactService");
  const notificationEngine = require("./notificationEngine");

  // ─────────────────────────────────────────────────────────────
  // HELPER — run a query and return rows
  // ─────────────────────────────────────────────────────────────
  const q = (text, params) => db.query(text, params);
  // ── SCHEMA MIGRATION (idempotent) ─────────────────────────────
  // sales_invoices only ever stored the customer's NAME as text, so
  // there was no reliable way to credit/debit that customer's
  // advance_balance. This adds a real FK-style link.
let sellSchemaReady = false;
  const ensureSellSchema = async () => {
    if (sellSchemaReady) return;
    try {
      await q(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS customer_id INTEGER;`);
      await q(`ALTER TABLE pos_sales ADD COLUMN IF NOT EXISTS customer_id INTEGER;`);
      sellSchemaReady = true;
    } catch (err) {
      console.error("sales_invoices schema migration warning:", err.message);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // MAP helpers — snake_case DB → camelCase API response
  // ─────────────────────────────────────────────────────────────
  function mapInvoice(row) {
    if (!row) return null;
    return {
      id:               row.id,
      invoiceNo:        row.invoice_no,
      invoiceDate:      row.invoice_date,
      dueDate:          row.due_date,
      docType:          row.doc_type,
      docStatus:        row.doc_status,
      customer:         row.customer,
      customerId:       row.customer_id,
      customerType:     row.customer_type,
      warehouse:        row.warehouse,
      salesperson:      row.salesperson,
      paymentMethod:    row.payment_method,
      paymentTerms:     row.payment_terms,
      paymentStatus:    row.payment_status,
      paidAmount:       Number(row.paid_amount     || 0),
      subtotal:         Number(row.subtotal        || 0),
      itemDiscountAmt:  Number(row.item_discount_amt || 0),
      globalDiscount:   Number(row.global_discount  || 0),
      taxAmt:           Number(row.tax_amt          || 0),
      shippingAmt:      Number(row.shipping_amt     || 0),
      grandTotal:       Number(row.grand_total      || 0),
      affectsStock:     row.affects_stock,
      notes:            row.notes,
      createdAt:        row.created_at,
      items:            row.items || [],
    };
  }

  function mapItem(row) {
    if (!row) return null;
    return {
      id:        row.id,
      invoiceId: row.invoice_id,
      productId: row.product_id,
      product:   row.product,
      sku:       row.sku,
      qty:       Number(row.qty        || 0),
      unit:      row.unit,
      unitPrice: Number(row.unit_price || 0),
      discount:  Number(row.discount   || 0),
      tax:       Number(row.tax        || 0),
      lineTotal: Number(row.line_total || 0),
    };
  }

 function mapPOSSale(row) {
    if (!row) return null;
    return {
      id:            row.id,
      refNo:         row.ref_no,
      date:          row.date,
      customer:      row.customer,
      customerId:    row.customer_id,
      location:      row.location,
      cashier:       row.cashier,
      paymentMethod: row.payment_method,
      paymentStatus: row.payment_status,
      discount:      Number(row.discount   || 0),
      taxAmt:        Number(row.tax_amt    || 0),
      grandTotal:    Number(row.grand_total || 0),
      affectsStock:  row.affects_stock,
      notes:         row.notes,
      createdAt:     row.created_at,
      items:         row.items || [],
    };
  }

  function mapQuotation(row) {
    if (!row) return null;
    return {
      id:            row.id,
      quotNo:        row.quot_no,
      quotDate:      row.quot_date,
      validUntil:    row.valid_until,
      docStatus:     row.doc_status,
      customer:      row.customer,
      customerType:  row.customer_type || "Walk-In",
      contactPerson: row.contact_person,
      email:         row.email,
      phone:         row.phone,
      salesperson:   row.salesperson,
      warehouse:     row.warehouse,
      globalDisc:    Number(row.global_disc  || 0),
      taxTotal:      Number(row.tax_total    || 0),
      shipping:      Number(row.shipping     || 0),
      grandTotal:    Number(row.grand_total  || 0),
      notes:         row.notes,
      terms:         row.terms,
      createdAt:     row.created_at,
      items:         row.items || [],
    };
  }

  function mapReturn(row) {
    if (!row) return null;
    return {
      id:           row.id,
      returnNo:     row.return_no,
      returnDate:   row.return_date,
      customer:     row.customer,
      invoiceRef:   row.invoice_ref,
      warehouse:    row.warehouse,
      reason:       row.reason,
      docStatus:    row.doc_status,
      taxAmt:       Number(row.tax_amt    || 0),
      grandTotal:   Number(row.grand_total || 0),
      affectsStock: row.affects_stock,
      notes:        row.notes,
      refundStatus: row.refund_status || "Pending",
      refundMethod: row.refund_method,
      refundAmount: Number(row.refund_amount || 0),
      createdAt:    row.created_at,
      items:        row.items || [],
    };
  }

  function mapShipment(row) {
    if (!row) return null;
    return {
      id:                row.id,
      shipmentNo:        row.shipment_no,
      date:              row.date,
      customer:          row.customer,
      invoiceRef:        row.invoice_ref,
      warehouse:         row.warehouse,
      carrier:           row.carrier,
      trackingNo:        row.tracking_no,
      deliveryAddress:   row.delivery_address,
      estimatedDelivery: row.estimated_delivery,
      weight:            row.weight ? Number(row.weight) : null,
      shippingCost:      Number(row.shipping_cost || 0),
      status:            row.status,
      notes:             row.notes,
      createdAt:         row.created_at,
    };
  }

  function mapDiscount(row) {
    if (!row) return null;
    return {
      id:             row.id,
      name:           row.name,
      code:           row.code,
      type:           row.type,
      value:          Number(row.value           || 0),
      appliesTo:      row.applies_to,
      customerGroup:  row.customer_group,
      minOrderAmount: Number(row.min_order_amount || 0),
      maxUses:        row.max_uses,
      usedCount:      row.used_count || 0,
      validFrom:      row.valid_from,
      validTo:        row.valid_to,
      status:         row.status,
      description:    row.description,
      createdAt:      row.created_at,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SALES INVOICES
  // ═══════════════════════════════════════════════════════════════

  async function getAllInvoices(filters = {}) {
    const { status, customer, dateFrom, dateTo, search, limit = 100, offset = 0 } = filters;
    const params = [];
    const where  = [];

    if (status && status !== "All") {
      params.push(status);
      where.push(`si.doc_status = $${params.length}`);
    }
    if (customer) {
      params.push(`%${customer}%`);
      where.push(`si.customer ILIKE $${params.length}`);
    }
    if (dateFrom) {
      params.push(dateFrom);
      where.push(`si.invoice_date >= $${params.length}`);
    }
    if (dateTo) {
      params.push(dateTo);
      where.push(`si.invoice_date <= $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(si.invoice_no ILIKE $${params.length} OR si.customer ILIKE $${params.length})`);
    }

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
    params.push(limit, offset);

    const { rows } = await q(
      `SELECT si.*,
        COALESCE(
          json_agg(sii.* ORDER BY sii.created_at)
          FILTER (WHERE sii.id IS NOT NULL), '[]'
        ) AS items
      FROM sales_invoices si
      LEFT JOIN sales_invoice_items sii ON sii.invoice_id = si.id
      ${whereClause}
      GROUP BY si.id
      ORDER BY si.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return rows.map(r => mapInvoice({ ...r, items: r.items.map(mapItem) }));
  }

  async function getInvoiceById(id) {
    const { rows } = await q(
      `SELECT si.*,
        COALESCE(
          json_agg(sii.* ORDER BY sii.created_at)
          FILTER (WHERE sii.id IS NOT NULL), '[]'
        ) AS items
      FROM sales_invoices si
      LEFT JOIN sales_invoice_items sii ON sii.invoice_id = si.id
      WHERE si.id = $1
      GROUP BY si.id`,
      [id]
    );
    if (!rows[0]) return null;
    return mapInvoice({ ...rows[0], items: rows[0].items.map(mapItem) });
  }

// ── NEW CODE ──
  async function createInvoice(data) {
    await ensureSellSchema();

    const {
      invoiceNo, invoiceDate, dueDate, docType = "Sales Invoice",
      docStatus = "Draft", customer, customerId = null, customerType, warehouse,
      salesperson, paymentMethod, paymentTerms, paymentStatus = "Unpaid",
      paidAmount = 0,
      // Amount the user chose to apply from the customer's existing
      // advance balance toward THIS invoice (from the Sale form).
      useAdvanceAmount = 0,
      subtotal = 0, itemDiscountAmt = 0, globalDiscount = 0,
      taxAmt = 0, shippingAmt = 0, grandTotal = 0,
      affectsStock = false, notes, items = [],
    } = data;

    // ── Apply advance balance toward this invoice, if requested ──
    // Never trust the client-side amount blindly — clamp to what the
    // customer actually has available AND what's still owed.
    let advanceApplied = 0;
    if (customerId && useAdvanceAmount > 0) {
      const contact = await contactService.fetchContactById(customerId);
      const available = Number(contact?.advance_balance || 0);
      const stillDue  = Math.max(0, Number(grandTotal) - Number(paidAmount));
      advanceApplied  = Math.min(Number(useAdvanceAmount), available, stillDue);
      if (advanceApplied > 0) {
        await contactService.adjustAdvanceBalance(customerId, -advanceApplied);
      }
    }
    const finalPaidAmount = Number(paidAmount) + advanceApplied;

    const { rows } = await q(
      `INSERT INTO sales_invoices
        (invoice_no, invoice_date, due_date, doc_type, doc_status,
        customer, customer_id, customer_type, warehouse, salesperson,
        payment_method, payment_terms, payment_status, paid_amount,
        subtotal, item_discount_amt, global_discount,
        tax_amt, shipping_amt, grand_total,
        affects_stock, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      RETURNING *`,
      [invoiceNo, invoiceDate || new Date(), dueDate, docType, docStatus,
      customer, customerId, customerType, warehouse, salesperson,
      paymentMethod, paymentTerms, paymentStatus, finalPaidAmount,
      subtotal, itemDiscountAmt, globalDiscount,
      taxAmt, shippingAmt, grandTotal,
      affectsStock, notes]
    );
    const invoice = rows[0];

    // ── Overpayment → credit the excess back as advance balance ──
    // e.g. customer paid ₹5,000 on a ₹4,200 invoice — the ₹800 difference
    // becomes credit sitting on their account for next time.
    if (customerId) {
      const excess = finalPaidAmount - Number(grandTotal);
      if (excess > 0) {
        await contactService.adjustAdvanceBalance(customerId, excess);
      }
    }


    // Insert line items
    if (items.length > 0) {
      try {
      const cols = "(invoice_id,product_id,product,sku,qty,unit,unit_price,discount,tax,line_total)";
      await q(
        `INSERT INTO sales_invoice_items ${cols} VALUES ${items.map((_,i)=>{
          const b=i*10; return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10})`;
        }).join(",")}`,
    items.flatMap(it => {
          const tax = it.tax ?? 18;
          return [
          invoice.id, null, it.product, it.sku || null,
          it.qty || 1, it.unit || "Pcs", it.unitPrice || 0,
          it.discount || 0, tax,
          ((it.qty||1)*(it.unitPrice||0))*(1-(it.discount||0)/100)*(1+tax/100),
     ];
        })
      );
      } catch (itemErr) {
        console.error("[createInvoice] item insert failed:", itemErr.message);
        throw itemErr;
      }
    }
// Deduct stock if submitted — validate BEFORE deducting, so an
    // over-quantity sale never partially deducts stock then fails midway.
 if (affectsStock && items.length > 0) {
    const isUUID = v => typeof v === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    const resolved = [];
    for (const it of items) {
      let pid = it.productId || it.id;
      if (!isUUID(pid)) {
        const n = parseInt(pid, 10);
        pid = (n && !isNaN(n)) ? n : null;
      }

      let prows = [];
      if (pid) {
        try {
          const result = await q(`SELECT id, name, COALESCE(current_stock,0) AS current_stock FROM products WHERE id = $1`, [pid]);
          prows = result.rows;
        } catch (dbErr) {
          console.error(`[createInvoice] stock lookup query failed for pid=${pid}:`, dbErr.message);
        }
      }

      // Fallback — no usable productId (common for items converted from
      // drafts/quotations, where product_id may not have persisted).
      // Match by exact product name instead so stock still links up.
      if (prows.length === 0 && it.product) {
        try {
          const result = await q(
            `SELECT id, name, COALESCE(current_stock,0) AS current_stock FROM products WHERE name = $1 LIMIT 1`,
            [it.product]
          );
          prows = result.rows;
          if (prows.length > 0) pid = prows[0].id;
        } catch (dbErr) {
          console.error(`[createInvoice] name-fallback stock lookup failed for "${it.product}":`, dbErr.message);
        }
      }

      if (prows.length === 0) {
        console.warn(`[createInvoice] product not found for stock check (id: ${pid}, name: "${it.product}"), skipping deduction`);
        continue;
      }

      const qty = it.qty || 1;
      if (qty > prows[0].current_stock) {
        throw new Error(`Insufficient stock for "${prows[0].name}": current stock is ${prows[0].current_stock}, cannot sell ${qty}`);
      }
      resolved.push({ pid, qty });
    }
  for (const { pid, qty } of resolved) {
      await q(
        `UPDATE products SET current_stock = GREATEST(0, COALESCE(current_stock,0) - $1), updated_at = NOW() WHERE id = $2`,
        [qty, pid]
      );
      notificationEngine.checkAndAlertLowStock(pid).catch(err =>
        console.error(`[createInvoice] low stock check failed for pid=${pid}:`, err.message)
      );
    }
 }

    // Bump the saved Invoice Settings counter forward by 1 so the NEXT
    // invoice generated from Settings gets a fresh number instead of
    // repeating this same one. Best-effort — if it fails, invoice creation
    // itself must still succeed, so this is wrapped and never throws.
    try {
      await q(
        `UPDATE invoice_settings
         SET invoice_start_number = invoice_start_number + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE business_id = 'e4138fb0-00fa-4ab0-b2dd-4f44470b7e93'`
      );
    } catch (counterErr) {
      console.error("[createInvoice] failed to increment invoice number counter:", counterErr.message);
    }

    return getInvoiceById(invoice.id);
  }

  async function updateInvoice(id, data) {
    const fields = [];
    const params = [];

  const allowed = {
      doc_status:     data.docStatus,
      payment_status: data.paymentStatus,
      payment_method: data.paymentMethod,
      paid_amount:    data.paidAmount,   // ← was missing entirely, this is why Due never updated
      customer_type:  data.customerType, // ← your Edit popup lets you change this too, wasn't saved either
      notes:          data.notes,
      salesperson:    data.salesperson,
      grand_total:    data.grandTotal,
    };
    for (const [col, val] of Object.entries(allowed)) {
      if (val !== undefined) {
        params.push(val);
        fields.push(`${col} = $${params.length}`);
      }
    }

    if (fields.length === 0) return getInvoiceById(id);

    params.push(id);
    await q(
      `UPDATE sales_invoices SET ${fields.join(",")} WHERE id = $${params.length}`,
      params
    );
    return getInvoiceById(id);
  }

 async function deleteInvoice(id) {
  // Reverse stock before deleting, if this invoice had deducted stock
  const { rows } = await q(
    `SELECT si.affects_stock,
       COALESCE(json_agg(sii.*) FILTER (WHERE sii.id IS NOT NULL), '[]') AS items
     FROM sales_invoices si
     LEFT JOIN sales_invoice_items sii ON sii.invoice_id = si.id
     WHERE si.id = $1
     GROUP BY si.id`,
    [id]
  );
  const invoice = rows[0];
  if (invoice?.affects_stock) {
    for (const it of invoice.items) {
      const pid = parseInt(it.product_id, 10);
      if (pid && !isNaN(pid)) {
        await q(
          `UPDATE products SET current_stock = COALESCE(current_stock,0) + $1, updated_at = NOW() WHERE id = $2`,
          [it.qty || 1, pid]
        );
      }
    }
  }

  await q("DELETE FROM sales_invoices WHERE id = $1", [id]);
  return { deleted: true };
}

  // ═══════════════════════════════════════════════════════════════
  // POS SALES
  // ═══════════════════════════════════════════════════════════════

  async function getAllPOSSales(filters = {}) {
    const { customer, dateFrom, dateTo, search, limit = 100, offset = 0 } = filters;
    const params = [];
    const where  = [];

    if (customer) {
      params.push(`%${customer}%`);
      where.push(`ps.customer ILIKE $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(ps.ref_no ILIKE $${params.length} OR ps.customer ILIKE $${params.length})`);
    }

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
    params.push(limit, offset);

    const { rows } = await q(
      `SELECT ps.*,
        COALESCE(
          json_agg(psi.* ORDER BY psi.created_at)
          FILTER (WHERE psi.id IS NOT NULL), '[]'
        ) AS items
      FROM pos_sales ps
      LEFT JOIN pos_sale_items psi ON psi.sale_id = ps.id
      ${whereClause}
      GROUP BY ps.id
      ORDER BY ps.created_at DESC
      LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );

    return rows.map(r => mapPOSSale({ ...r, items: r.items }));
  }

  async function getPOSSaleById(id) {
    const { rows } = await q(
      `SELECT ps.*,
        COALESCE(
          json_agg(psi.* ORDER BY psi.created_at)
          FILTER (WHERE psi.id IS NOT NULL), '[]'
        ) AS items
      FROM pos_sales ps
      LEFT JOIN pos_sale_items psi ON psi.sale_id = ps.id
      WHERE ps.id = $1
      GROUP BY ps.id`,
      [id]
    );
    return mapPOSSale(rows[0]);
  }

 async function createPOSSale(data) {
    await ensureSellSchema();

    const {
      refNo, date, customer = "Walk-In Customer", customerId = null, location = "Manod HQ",
      cashier, paymentMethod = "Cash", paymentStatus = "Paid",
      discount = 0, taxAmt = 0, grandTotal = 0,
      affectsStock = true, notes, items = [],
    } = data;

    const { rows } = await q(
      `INSERT INTO pos_sales
        (ref_no, date, customer, customer_id, location, cashier,
        payment_method, payment_status,
        discount, tax_amt, grand_total, affects_stock, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *`,
      [refNo, date || new Date(), customer, customerId, location, cashier,
      paymentMethod, paymentStatus,
      discount, taxAmt, grandTotal, affectsStock, notes]
    );
  const sale = rows[0];

    // Only pass a product_id through if it's actually a valid UUID —
    // otherwise Postgres throws a type-cast error on the uuid column
    // and the whole item insert silently fails, leaving a sale with
    // no items (which is exactly what was happening before this fix).
    const isUUID = v => typeof v === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

    if (items.length > 0) {
      try {
        await q(
          `INSERT INTO pos_sale_items (sale_id, product_id, name, sku, price, qty)
          VALUES ${items.map((_,i)=>`($${i*6+1},$${i*6+2},$${i*6+3},$${i*6+4},$${i*6+5},$${i*6+6})`).join(",")}`,
          items.flatMap(it => {
            const pid = it.productId || it.id;
            return [sale.id, isUUID(pid) ? pid : null, it.name, it.sku || null, it.price || 0, it.qty || 1];
          })
        );
      } catch (itemErr) {
        console.error("[createPOSSale] item insert failed:", itemErr.message);
        throw itemErr; // surface the real error to the controller/response instead of hiding it
      }
    }
    // Deduct stock — validate BEFORE deducting
  if (affectsStock) {
    const resolved = [];
    for (const it of items) {
      const pid = parseInt(it.productId || it.id, 10);
      if (!pid || isNaN(pid)) continue;
      const { rows: prows } = await q(`SELECT name, COALESCE(current_stock,0) AS current_stock FROM products WHERE id = $1`, [pid]);
      if (prows.length === 0) throw new Error(`Product not found (id: ${pid})`);
      const qty = it.qty || 1;
      if (qty > prows[0].current_stock) {
        throw new Error(`Insufficient stock for "${prows[0].name}": current stock is ${prows[0].current_stock}, cannot sell ${qty}`);
      }
      resolved.push({ pid, qty });
    }
  for (const { pid, qty } of resolved) {
      await q(
        `UPDATE products SET current_stock = GREATEST(0, COALESCE(current_stock,0) - $1), updated_at = NOW() WHERE id = $2`,
        [qty, pid]
      );
      notificationEngine.checkAndAlertLowStock(pid).catch(err =>
        console.error(`[createPOSSale] low stock check failed for pid=${pid}:`, err.message)
      );
    }
  }

  return getPOSSaleById(sale.id);
  }

  async function updatePOSSale(id, data) {
    const fields = [];
    const params = [];

    const allowed = {
      payment_status: data.paymentStatus,
      notes:          data.notes,
    };

    for (const [col, val] of Object.entries(allowed)) {
      if (val !== undefined) {
        params.push(val);
        fields.push(`${col} = $${params.length}`);
      }
    }

    if (fields.length === 0) return getPOSSaleById(id);

    params.push(id);
    await q(`UPDATE pos_sales SET ${fields.join(",")} WHERE id = $${params.length}`, params);
    return getPOSSaleById(id);
  }

  async function deletePOSSale(id) {
  // Reverse stock before deleting, since a POS sale normally deducts stock
  const { rows } = await q(
    `SELECT ps.affects_stock,
       COALESCE(json_agg(psi.*) FILTER (WHERE psi.id IS NOT NULL), '[]') AS items
     FROM pos_sales ps
     LEFT JOIN pos_sale_items psi ON psi.sale_id = ps.id
     WHERE ps.id = $1
     GROUP BY ps.id`,
    [id]
  );
  const sale = rows[0];
  if (sale?.affects_stock) {
    for (const it of sale.items) {
      const pid = parseInt(it.product_id, 10);
      if (pid && !isNaN(pid)) {
        await q(
          `UPDATE products SET current_stock = COALESCE(current_stock,0) + $1, updated_at = NOW() WHERE id = $2`,
          [it.qty || 1, pid]
        );
      }
    }
  }

  await q("DELETE FROM pos_sales WHERE id = $1", [id]);
  return { deleted: true };
}
  // ═══════════════════════════════════════════════════════════════
  // QUOTATIONS
  // ═══════════════════════════════════════════════════════════════// ═══════════════════════════════════════════════════════════════
  // QUOTATIONS
  // ═══════════════════════════════════════════════════════════════

  async function getAllQuotations(filters = {}) {
    const { status, search, limit = 100, offset = 0 } = filters;
    const params = [];
    const where  = [];

    if (status && status !== "All") {
      params.push(status);
      where.push(`q.doc_status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(q.quot_no ILIKE $${params.length} OR q.customer ILIKE $${params.length})`);
    }

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
    params.push(limit, offset);

    const { rows } = await q(
      `SELECT q.*,
        COALESCE(
          json_agg(qi.* ORDER BY qi.created_at)
          FILTER (WHERE qi.id IS NOT NULL), '[]'
        ) AS items
      FROM quotations q
      LEFT JOIN quotation_items qi ON qi.quot_id = q.id
      ${whereClause}
      GROUP BY q.id
      ORDER BY q.created_at DESC
      LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );

    return rows.map(r => mapQuotation({ ...r, items: r.items }));
  }

  async function getQuotationById(id) {
    const { rows } = await q(
      `SELECT q.*,
        COALESCE(
          json_agg(qi.* ORDER BY qi.created_at)
          FILTER (WHERE qi.id IS NOT NULL), '[]'
        ) AS items
      FROM quotations q
      LEFT JOIN quotation_items qi ON qi.quot_id = q.id
      WHERE q.id = $1
      GROUP BY q.id`,
      [id]
    );
    return mapQuotation(rows[0]);
  }
  async function createQuotation(data) {
    const {
      quotNo, quotDate, validUntil, docStatus = "Draft",
      customer, customerType = "Walk-In", contactPerson, email, phone,
      salesperson, warehouse, globalDisc = 0,
      taxTotal = 0, shipping = 0, grandTotal = 0,
      notes, terms, affectsStock = false, items = [],
    } = data;

    const { rows } = await q(
      `INSERT INTO quotations
        (quot_no, quot_date, valid_until, doc_status,
        customer, customer_type, contact_person, email, phone,
        salesperson, warehouse, global_disc,
        tax_total, shipping, grand_total,
        notes, terms, affects_stock)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *`,
      [quotNo, quotDate || new Date(), validUntil, docStatus,
      customer, customerType, contactPerson, email, phone,
      salesperson, warehouse, globalDisc,
      taxTotal, shipping, grandTotal,
      notes, terms, affectsStock]
    );
    const quot = rows[0];

   if (items.length > 0) {
      const isUUID = v => typeof v === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
      await q(
        `INSERT INTO quotation_items (quot_id,product_id,product,sku,qty,unit,unit_price,discount,tax,line_total)
        VALUES ${items.map((_,i)=>`($${i*10+1},$${i*10+2},$${i*10+3},$${i*10+4},$${i*10+5},$${i*10+6},$${i*10+7},$${i*10+8},$${i*10+9},$${i*10+10})`).join(",")}`,
        items.flatMap(it => {
          // product_id column is uuid — only pass it through if it's actually
          // a valid UUID, otherwise null (integer product IDs can't be cast)
          const pid = isUUID(it.productId) ? it.productId : null;
          return [
            quot.id, pid, it.product, it.sku || null,
            it.qty || 1, it.unit || "Pcs", it.unitPrice || 0,
            it.discount || 0, it.tax || 18,
            ((it.qty||1)*(it.unitPrice||0))*(1-(it.discount||0)/100)*(1+(it.tax||18)/100),
          ];
        })
      );
    }

    return getQuotationById(quot.id);
  }

  async function updateQuotation(id, data) {
    const { docStatus, notes } = data;
    if (docStatus !== undefined) {
      await q("UPDATE quotations SET doc_status=$1 WHERE id=$2", [docStatus, id]);
    }
    return getQuotationById(id);
  }

  async function deleteQuotation(id) {
    await q("DELETE FROM quotations WHERE id=$1", [id]);
    return { deleted: true };
  }

  // ═══════════════════════════════════════════════════════════════
  // SALES RETURNS
  // ═══════════════════════════════════════════════════════════════

  function mapReturnItem(row) {
    if (!row) return null;
    return {
      id:        row.id,
      returnId:  row.return_id,
      productId: row.product_id,
      product:   row.product,
      sku:       row.sku,
      qty:       Number(row.qty || 0),
      unitPrice: Number(row.unit_price || 0),
    };
  }

  async function getAllReturns(filters = {}) {
    const { limit = 100, offset = 0 } = filters;
    const { rows } = await q(
      `SELECT sr.*,
        COALESCE(
          json_agg(sri.* ORDER BY sri.created_at)
          FILTER (WHERE sri.id IS NOT NULL), '[]'
        ) AS items
      FROM sales_returns sr
      LEFT JOIN sales_return_items sri ON sri.return_id = sr.id
      GROUP BY sr.id
      ORDER BY sr.created_at DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows.map(r => mapReturn({ ...r, items: r.items.map(mapReturnItem) }));
  }

  async function getReturnById(id) {
    const { rows } = await q(
      `SELECT sr.*,
        COALESCE(
          json_agg(sri.* ORDER BY sri.created_at)
          FILTER (WHERE sri.id IS NOT NULL), '[]'
        ) AS items
      FROM sales_returns sr
      LEFT JOIN sales_return_items sri ON sri.return_id = sr.id
      WHERE sr.id = $1
      GROUP BY sr.id`,
      [id]
    );
    if (!rows[0]) return null;
    return mapReturn({ ...rows[0], items: rows[0].items.map(mapReturnItem) });
  }

  async function createReturn(data) {
    const {
      returnNo, returnDate, customer, invoiceRef, warehouse,
      reason, docStatus = "Draft", taxAmt = 0, grandTotal = 0,
      affectsStock = false, notes, items = [],
      refundStatus = "Pending", refundMethod, refundAmount = 0,
    } = data;

    const { rows } = await q(
      `INSERT INTO sales_returns
        (return_no, return_date, customer, invoice_ref, warehouse,
        reason, doc_status, tax_amt, grand_total, affects_stock, notes,
        refund_status, refund_method, refund_amount)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *`,
      [returnNo, returnDate || new Date(), customer, invoiceRef, warehouse,
      reason, docStatus, taxAmt, grandTotal, affectsStock, notes,
      refundStatus, refundMethod, refundAmount]
    );

    const ret = rows[0];

    const isUUID = v => typeof v === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

    if (items.length > 0) {
      await q(
        `INSERT INTO sales_return_items (return_id,product_id,product,sku,qty,unit_price)
        VALUES ${items.map((_,i)=>`($${i*6+1},$${i*6+2},$${i*6+3},$${i*6+4},$${i*6+5},$${i*6+6})`).join(",")}`,
        items.flatMap(it => {
          // product_id column may be uuid — only pass through valid UUIDs,
          // otherwise null (we resolve the real product below by name/id anyway)
          const pid = isUUID(it.productId) ? it.productId : null;
          return [ret.id, pid, it.product||it.name, it.sku || null, it.qty || 0, it.unitPrice || 0];
        })
      );
    }

    // Add back stock if completed
  if (affectsStock) {
    for (const it of items) {
      let pid = it.productId || it.id;
      if (!isUUID(pid)) {
        const n = parseInt(pid, 10);
        pid = (n && !isNaN(n)) ? n : null;
      }

      let prows = [];
      if (pid) {
        try {
          const result = await q(`SELECT id FROM products WHERE id = $1`, [pid]);
          prows = result.rows;
        } catch (dbErr) {
          console.error(`[createReturn] stock lookup failed for pid=${pid}:`, dbErr.message);
        }
      }

      // Fallback — match by product name if id lookup failed/missing
      if (prows.length === 0 && (it.product || it.name)) {
        try {
          const result = await q(`SELECT id FROM products WHERE name = $1 LIMIT 1`, [it.product || it.name]);
          prows = result.rows;
          if (prows.length > 0) pid = prows[0].id;
        } catch (dbErr) {
          console.error(`[createReturn] name-fallback lookup failed for "${it.product||it.name}":`, dbErr.message);
        }
      }

      if (prows.length === 0) {
        console.warn(`[createReturn] product not found for stock addback (id: ${pid}, name: "${it.product||it.name}"), skipping`);
        continue;
      }

      await q(
        `UPDATE products SET current_stock = COALESCE(current_stock,0) + $1, updated_at = NOW() WHERE id = $2`,
        [it.qty || 0, pid]
      );
    }
  }

    return getReturnById(ret.id);
  }
  async function updateReturn(id, data) {
    const existing = await getReturnById(id);
    const wasCompleted = existing?.affectsStock;
    const willBeCompleted = data.docStatus === "Completed";

    const fields = [];
    const params = [];
    const allowed = {
      doc_status:     data.docStatus,
      refund_status:  data.refundStatus,
      refund_method:  data.refundMethod,
      refund_amount:  data.refundAmount,
      notes:          data.notes,
      affects_stock:  data.docStatus !== undefined ? willBeCompleted : undefined,
    };
    for (const [col, val] of Object.entries(allowed)) {
      if (val !== undefined) { params.push(val); fields.push(`${col} = $${params.length}`); }
    }
    if (fields.length > 0) {
      params.push(id);
      await q(`UPDATE sales_returns SET ${fields.join(",")} WHERE id = $${params.length}`, params);
    }

    // Newly marked Completed (wasn't before) — add stock back now
    if (!wasCompleted && willBeCompleted && existing?.items?.length > 0) {
      const isUUID = v => typeof v === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
      for (const it of existing.items) {
        let pid = it.productId || null;
        if (!isUUID(pid)) {
          const n = parseInt(pid, 10);
          pid = (n && !isNaN(n)) ? n : null;
        }
        let prows = [];
        if (pid) {
          const result = await q(`SELECT id FROM products WHERE id = $1`, [pid]);
          prows = result.rows;
        }
        if (prows.length === 0 && it.product) {
          const result = await q(`SELECT id FROM products WHERE name = $1 LIMIT 1`, [it.product]);
          prows = result.rows;
          if (prows.length > 0) pid = prows[0].id;
        }
        if (prows.length === 0) {
          console.warn(`[updateReturn] product not found for stock addback (name: "${it.product}"), skipping`);
          continue;
        }
        await q(
          `UPDATE products SET current_stock = COALESCE(current_stock,0) + $1, updated_at = NOW() WHERE id = $2`,
          [it.qty || 0, pid]
        );
      }
    }

    return getReturnById(id);
  }

  async function deleteReturn(id) {
    await q("DELETE FROM sales_returns WHERE id = $1", [id]);
    return { deleted: true };
  }
  // ═══════════════════════════════════════════════════════════════
  // DRAFTS  (dedicated table — sales_drafts / sales_draft_items)
  // ═══════════════════════════════════════════════════════════════

  function mapDraft(row) {
    if (!row) return null;
    return {
      id:           row.id,
      invoiceNo:    row.draft_no,
      invoiceDate:  row.draft_date,
      date:         row.draft_date,
      customer:     row.customer,
      customerType: row.customer_type,
      warehouse:    row.warehouse,
      salesperson:  row.salesperson,
      notes:        row.notes,
      grandTotal:   Number(row.grand_total || 0),
      createdAt:    row.created_at,
      items:        row.items || [],
    };
  }
  function mapDraftItem(row) {
    if (!row) return null;
    return {
      id:        row.id,
      draftId:   row.draft_id,
      productId: row.product_id,
      product:   row.product,
      name:      row.product,
      sku:       row.sku,
      qty:       Number(row.qty || 0),
      unitPrice: Number(row.unit_price || 0),
    };
  }

  async function getAllDrafts(filters = {}) {
    const { search, limit = 100, offset = 0 } = filters;
    const params = [];
    const where  = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(sd.draft_no ILIKE $${params.length} OR sd.customer ILIKE $${params.length})`);
    }
    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
    params.push(limit, offset);

    const { rows } = await q(
      `SELECT sd.*,
        COALESCE(
          json_agg(sdi.* ORDER BY sdi.created_at)
          FILTER (WHERE sdi.id IS NOT NULL), '[]'
        ) AS items
      FROM sales_drafts sd
      LEFT JOIN sales_draft_items sdi ON sdi.draft_id = sd.id
      ${whereClause}
      GROUP BY sd.id
      ORDER BY sd.created_at DESC
      LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );
    return rows.map(r => mapDraft({ ...r, items: r.items.map(mapDraftItem) }));
  }

  async function getDraftById(id) {
    const { rows } = await q(
      `SELECT sd.*,
        COALESCE(
          json_agg(sdi.* ORDER BY sdi.created_at)
          FILTER (WHERE sdi.id IS NOT NULL), '[]'
        ) AS items
      FROM sales_drafts sd
      LEFT JOIN sales_draft_items sdi ON sdi.draft_id = sd.id
      WHERE sd.id = $1
      GROUP BY sd.id`,
      [id]
    );
    if (!rows[0]) return null;
    return mapDraft({ ...rows[0], items: rows[0].items.map(mapDraftItem) });
  }

  async function createDraft(data) {
    const {
      invoiceNo, invoiceDate, customer, customerType = "Walk-In",
      warehouse = "Manod HQ", salesperson, notes, grandTotal = 0, items = [],
    } = data;

    const { rows } = await q(
      `INSERT INTO sales_drafts
        (draft_no, draft_date, customer, customer_type, warehouse, salesperson, notes, grand_total)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *`,
      [invoiceNo, invoiceDate || new Date(), customer, customerType, warehouse, salesperson, notes, grandTotal]
    );
    const draft = rows[0];

  if (items.length > 0) {
      const isUUID = v => typeof v === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
      await q(
        `INSERT INTO sales_draft_items (draft_id, product_id, product, sku, qty, unit_price)
        VALUES ${items.map((_,i)=>`($${i*6+1},$${i*6+2},$${i*6+3},$${i*6+4},$${i*6+5},$${i*6+6})`).join(",")}`,
        items.flatMap(it => {
          let pid = it.productId || it.id || null;
          if (pid && !isUUID(pid)) {
            const n = parseInt(pid, 10);
            pid = (n && !isNaN(n)) ? n : null;
          }
          return [
            draft.id, pid, it.product || it.name,
            it.sku || null, it.qty || 1, it.unitPrice || 0,
          ];
        })
      );
    }
    return getDraftById(draft.id);
  }

  async function updateDraft(id, data) {
    const fields = [];
    const params = [];
    const allowed = {
      notes:         data.notes,
      salesperson:   data.salesperson,
      customer_type: data.customerType,
    };
    for (const [col, val] of Object.entries(allowed)) {
      if (val !== undefined) { params.push(val); fields.push(`${col} = $${params.length}`); }
    }
    if (fields.length === 0) return getDraftById(id);
    params.push(id);
    await q(`UPDATE sales_drafts SET ${fields.join(",")}, updated_at = now() WHERE id = $${params.length}`, params);
    return getDraftById(id);
  }

  async function deleteDraft(id) {
    await q("DELETE FROM sales_drafts WHERE id = $1", [id]);
    return { deleted: true };
  }
  // ═══════════════════════════════════════════════════════════════
  // SHIPMENTS
  // ═══════════════════════════════════════════════════════════════

  async function getAllShipments(filters = {}) {
    const { status, search, limit = 100, offset = 0 } = filters;
    const params = [];
    const where  = [];

    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(shipment_no ILIKE $${params.length} OR customer ILIKE $${params.length})`);
    }

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
    params.push(limit, offset);

    const { rows } = await q(
      `SELECT * FROM shipments ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );
    return rows.map(mapShipment);
  }

  async function getShipmentById(id) {
    const { rows } = await q("SELECT * FROM shipments WHERE id=$1", [id]);
    return mapShipment(rows[0]);
  }

  async function createShipment(data) {
    const {
      shipmentNo, date, customer, invoiceRef, warehouse,
      carrier, trackingNo, deliveryAddress, estimatedDelivery,
      weight, shippingCost = 0, status = "Pending", notes,
    } = data;

    const { rows } = await q(
      `INSERT INTO shipments
        (shipment_no, date, customer, invoice_ref, warehouse,
        carrier, tracking_no, delivery_address, estimated_delivery,
        weight, shipping_cost, status, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *`,
      [shipmentNo, date || new Date(), customer, invoiceRef, warehouse,
      carrier, trackingNo, deliveryAddress, estimatedDelivery || null,
      weight || null, shippingCost, status, notes]
    );
    return mapShipment(rows[0]);
  }

  async function updateShipment(id, data) {
    const { status, trackingNo, notes } = data;
    const fields = [];
    const params = [];

    if (status)     { params.push(status);    fields.push(`status=$${params.length}`); }
    if (trackingNo) { params.push(trackingNo);fields.push(`tracking_no=$${params.length}`); }
    if (notes)      { params.push(notes);     fields.push(`notes=$${params.length}`); }

    if (fields.length === 0) return getShipmentById(id);
    params.push(id);
    await q(`UPDATE shipments SET ${fields.join(",")} WHERE id=$${params.length}`, params);
    return getShipmentById(id);
  }

  async function deleteShipment(id) {
    await q("DELETE FROM shipments WHERE id=$1", [id]);
    return { deleted: true };
  }

  // ═══════════════════════════════════════════════════════════════
  // DISCOUNTS
  // ═══════════════════════════════════════════════════════════════

  async function getAllDiscounts(filters = {}) {
    const { status, limit = 100, offset = 0 } = filters;
    const params = [];
    const where  = [];

    if (status && status !== "All") {
      params.push(status);
      where.push(`status = $${params.length}`);
    }

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
    params.push(limit, offset);

    const { rows } = await q(
      `SELECT * FROM discounts ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );
    return rows.map(mapDiscount);
  }

  async function getDiscountById(id) {
    const { rows } = await q("SELECT * FROM discounts WHERE id=$1", [id]);
    return mapDiscount(rows[0]);
  }

  async function getDiscountByCode(code) {
    const { rows } = await q(
      "SELECT * FROM discounts WHERE UPPER(code)=UPPER($1) AND status='Active'", [code]
    );
    return mapDiscount(rows[0]);
  }

  async function createDiscount(data) {
    const {
      name, code, type = "Percentage", value = 0,
      appliesTo = "All Products", customerGroup = "All",
      minOrderAmount = 0, maxUses, validFrom, validTo,
      status = "Active", description,
    } = data;

    const { rows } = await q(
      `INSERT INTO discounts
        (name, code, type, value, applies_to, customer_group,
        min_order_amount, max_uses, valid_from, valid_to, status, description)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
      [name, code?.toUpperCase(), type, value, appliesTo, customerGroup,
      minOrderAmount, maxUses || null, validFrom || null, validTo || null,
      status, description]
    );
    return mapDiscount(rows[0]);
  }

  async function updateDiscount(id, data) {
    const { status, name, value } = data;
    const fields = [];
    const params = [];

    if (status) { params.push(status); fields.push(`status=$${params.length}`); }
    if (name)   { params.push(name);   fields.push(`name=$${params.length}`); }
    if (value !== undefined) { params.push(value); fields.push(`value=$${params.length}`); }

    if (fields.length === 0) return getDiscountById(id);
    params.push(id);
    await q(`UPDATE discounts SET ${fields.join(",")} WHERE id=$${params.length}`, params);
    return getDiscountById(id);
  }

  async function deleteDiscount(id) {
    await q("DELETE FROM discounts WHERE id=$1", [id]);
    return { deleted: true };
  }

  // ── Import Sales (CSV) ────────────────────────────────────────
  async function importSalesFromCSV(rows, fileName = "unknown.csv", importedBy = null) {
    let imported = 0;
    const errors = [];

    for (const row of rows) {
      try {
        const invoiceNo = row["Invoice No."] || `IMP-${Date.now()}-${imported}`;
        const existing = await q("SELECT id FROM sales_invoices WHERE invoice_no=$1", [invoiceNo]);
        if (existing.rows.length > 0) continue; // skip duplicates

      await createInvoice({
          invoiceNo,
          invoiceDate:   row["Date"] || new Date(),
          dueDate:       row["Due Date"] || null,
          customer:      row["Customer"] || "Unknown",
          customerType:  row["Customer Type"] || "Walk-In",
          warehouse:     row["Location"] || "Manod HQ",
          paymentMethod: row["Method"] || "Cash",
          paymentStatus: row["Payment Status"] || "Unpaid",
          paidAmount:    Number(row["Amount Paid (Rs.)"]) || 0,
          subtotal:      Number(row["Total (Rs.)"]) || 0,
          grandTotal:    Number(row["Total (Rs.)"]) || 0,
          docStatus:     "Submitted",
          affectsStock:  false,
          items: [],
        });
        imported++;
      } catch (err) {
        errors.push({ row, error: err.message });
      }
    }

    // Write an audit row so every import run shows up in sales_import_logs,
    // regardless of whether it fully succeeded, partially succeeded, or failed.
    const status = errors.length === 0 ? "Completed" : (imported === 0 ? "Failed" : "Partial");
    try {
      await q(
        `INSERT INTO sales_import_logs
          (file_name, imported_by, total_rows, success_rows, failed_rows, status, error_details)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [fileName, importedBy, rows.length, imported, errors.length, status, JSON.stringify(errors)]
      );
    } catch (logErr) {
      console.error("[importSalesFromCSV] failed to write import log:", logErr.message);
    }

    return { imported, errors };
  }
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
    getAllDiscounts, getDiscountById, getDiscountByCode, createDiscount, updateDiscount, deleteDiscount,
    // Import
    importSalesFromCSV,
  };