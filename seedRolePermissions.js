/**
 * ============================================================
 * seedRolePermissions.js
 *
 * One-off script to apply sensible DEFAULT permission sets to
 * your EXISTING roles. Uses your existing roleService.updateRole
 * function only — no schema changes, no new tables, no renamed
 * or removed roles, no new permission system.
 *
 * WHAT THIS DOES:
 *  1. Reads your existing roles (by role_name) via roleService.getAllRoles()
 *  2. Reads your existing permissions via roleService.getAllPermissions()
 *  3. For each role name below, builds a "Group::Name" permission array
 *     using ONLY permission strings that already exist in your DB
 *  4. Calls roleService.updateRole(id, sameName, permissionKeys)
 *     -- this replaces that role's permission set (your updateRole
 *     already does a DELETE + re-INSERT under one transaction)
 *
 * WHAT THIS DOES NOT DO:
 *  - Does not create roles. If a role name below doesn't exist in
 *    your `roles` table, it is SKIPPED and logged, not created.
 *  - Does not touch role_name (never renames).
 *  - Does not modify the `permissions` table.
 *  - Does not delete any role.
 *
 * USAGE:
 *   node seedRolePermissions.js            (dry run - prints only)
 *   node seedRolePermissions.js --apply    (actually writes changes)
 * ============================================================
 */

const roleService = require('./services/roleService');// adjust path to match your project structure

// ------------------------------------------------------------
// Permission group shorthand helpers.
// These reference the exact group/item strings from your
// DEFAULT_PERMISSIONS in Roles.jsx. If your `permissions` table
// uses different casing/wording, this script silently skips any
// key that isn't found (insertPermissions already does this via
// the SELECT ... WHERE group_name = $1 AND name = $2 check).
// ------------------------------------------------------------

const GROUPS = {
  User: ["View user", "Add user", "Edit user", "Delete user"],
  Roles: ["View role", "Add Role", "Edit Role", "Delete role"],
  Supplier: ["View all supplier", "View own supplier", "Add supplier", "Edit supplier", "Delete supplier"],
  Customer: ["View all customer", "View own customer", "Add customer", "Edit customer", "Delete customer"],
  Product: ["View product", "Add product", "Edit product", "Delete product", "Add Opening Stock", "View Purchase Price"],
  Purchase: ["View all Purchase", "View own Purchase", "Add purchase", "Edit purchase", "Delete purchase", "Add purchase payment", "Edit purchase payment", "Delete purchase payment", "Update Status"],
  StockAdjustment: ["View all stock adjustment", "View own stock adjustment", "Add stock adjustment", "Edit stock adjustment", "Delete stock adjustment"],
  StockTransfer: ["View all stock transfer", "View own stock transfer", "Add stock transfer", "Edit stock transfer", "Delete stock transfer"],
  POS: ["View POS sell", "Add POS sell", "Edit POS sell", "Delete POS sell", "Add/Edit Payment", "Print Invoice"],
  Sell: ["View all sell", "View own sell only", "Add Sell", "Update Sell", "Delete Sell", "Add sell payment", "Edit sell payment", "Delete sell payment", "Add/Edit/Delete Discount", "Access all sell return", "Access own sell return"],
  Draft: ["View all drafts", "View own drafts", "Edit draft", "Delete draft"],
  Quotation: ["View all quotations", "View own quotations", "Edit quotation", "Delete quotation"],
  Shipments: ["Access all shipments", "Access own shipments", "Access pending shipments only"],
  CashRegister: ["View cash register", "Close cash register"],
  Brand: ["View brand", "Add brand", "Edit brand", "Delete brand"],
  TaxRate: ["View tax rate", "Add tax rate", "Edit tax rate", "Delete tax rate"],
  Unit: ["View unit", "Add unit", "Edit unit", "Delete unit"],
  Category: ["View category", "Add category", "Edit category", "Delete category"],
  Report: ["View purchase & sell report", "View Tax report", "View Supplier & Customer report", "View expense report", "View profit/loss report", "View stock report, stock adjustment report & stock expiry report", "View trending product report", "View register report", "View sales representative report", "View product stock value"],
  Settings: ["Access business settings", "Access barcode settings", "Access invoice settings", "Access printers"],
  Expense: ["Access all expenses", "View own expense only", "Add Expense", "Edit Expense", "Delete Expense"],
  Home: ["View Home data"],
  Account: ["Access Accounts", "Edit account transaction", "Delete account transaction"],
  Crm: ["Access all follow up", "Access own follow up", "Access all leads", "Access own leads", "Access all campaigns", "Access own campaigns", "Access contact login", "Access sources", "Access life stage", "Access proposal"],
  Essentials: ["Add/Edit/View/Delete leave type", "Add/Edit/View/Delete all leave", "Add/View own leave", "Approve Leave", "Add/Edit/View/Delete all attendance", "View own attendance", "Allow users to enter their own attendance from web", "Allow users to enter their own attendance from api", "View Pay Component", "Add Pay Component", "Add/Edit/View/Delete department", "Add/Edit/View/Delete designation", "View all Payroll", "Add Payroll", "Edit Payroll", "Delete Payroll", "Assign To Do's to others", "Add To Do's", "Edit To Do's", "Delete To Do's", "Create Message", "View Message", "Access Sales Targets"],
  Manufacturing: ["View Recipe", "Add Recipe", "Edit Recipe", "Access Production"],
  Accounting: ["View Accounting Dashboard", "Access General Ledger", "Access Receivables/Payables", "Access Cash & Bank", "Access GST & Tax", "Manage Fixed Assets", "Manage Cost Centers & Budgets", "Access Financial Statements", "Post Journal Entries"],
};

// Build "Group::Item" keys for a whole group (F = full access)
function full(groupKey) {
  return GROUPS[groupKey].map((item) => `${groupKey}::${item}`);
}

// Build keys for specific items only
function only(groupKey, items) {
  return items.map((item) => `${groupKey}::${item}`);
}

// View-only helper: picks items that start with "View" / "Access" (read-leaning)
function viewOnly(groupKey) {
  return GROUPS[groupKey]
    .filter((item) => /^(view|access)/i.test(item) && !/manage|post|assign/i.test(item))
    .map((item) => `${groupKey}::${item}`);
}

// ------------------------------------------------------------
// ROLE → PERMISSION KEY ARRAYS
// Each entry: exact existing role_name -> array of "Group::Item" keys
// Adjust the role_name strings on the left if your DB spells them
// differently (e.g. spacing/casing) -- they must match exactly.
// ------------------------------------------------------------

const ROLE_DEFAULTS = {
  "Super Admin": Object.keys(GROUPS).flatMap(full),
  "Administrator": Object.keys(GROUPS).flatMap(full),
  "Admin": Object.keys(GROUPS)
    .filter((g) => g !== "Settings")
    .flatMap(full)
    .concat(viewOnly("Settings")),

  "Manager": [
    ...viewOnly("User"),
    ...full("Supplier"), ...full("Customer"), ...full("Product"),
    ...full("Purchase"), ...full("StockAdjustment"), ...full("StockTransfer"),
    ...full("POS"), ...full("Sell"), ...full("Draft"), ...full("Quotation"),
    ...full("Shipments"), ...full("CashRegister"),
    ...viewOnly("Brand"), ...viewOnly("TaxRate"), ...viewOnly("Unit"), ...viewOnly("Category"),
    ...only("Report", ["View purchase & sell report", "View expense report", "View profit/loss report"]),
    ...full("Expense"), ...full("Account"), ...full("Crm"), ...full("Essentials"),
    ...full("Manufacturing"), ...full("Accounting"),
  ],

  "User": [
    ...viewOnly("Supplier"),
    ...only("Customer", ["View own customer", "Add customer", "Edit customer"]),
    ...only("Product", ["View product"]),
    ...only("Purchase", ["View own Purchase", "Add purchase"]),
    ...only("POS", ["View POS sell", "Add POS sell"]),
    ...only("Sell", ["View own sell only", "Add Sell"]),
    ...only("Draft", ["View own drafts"]),
    ...only("Quotation", ["View own quotations"]),
    ...viewOnly("Brand"), ...viewOnly("TaxRate"), ...viewOnly("Unit"), ...viewOnly("Category"),
    ...only("Report", ["View own expense only"]),
    ...only("Expense", ["View own expense only"]),
    ...only("Crm", ["Access own follow up"]),
    ...only("Home", ["View Home data"]),
  ],

  "Viewer": Object.keys(GROUPS).flatMap((g) => viewOnly(g)),

  "Employee": [
    ...only("Home", ["View Home data"]),
    ...only("Essentials", [
      "Add/View own leave", "View own attendance",
      "Allow users to enter their own attendance from web",
      "Add To Do's",
    ]),
    ...only("Expense", ["View own expense only"]),
  ],

  // ── Sales ──
  "Sales Manager": [
    ...viewOnly("Supplier"),
    ...full("Customer"), ...viewOnly("Product"),
    ...full("POS"), ...full("Sell"), ...full("Draft"), ...full("Quotation"),
    ...full("Shipments"),
    ...only("Report", ["View purchase & sell report", "View sales representative report", "View trending product report"]),
    ...full("Crm"),
  ],
  "Sales Executive": [
    ...only("Customer", ["View own customer", "Add customer", "Edit customer"]),
    ...only("Product", ["View product"]),
    ...only("Sell", ["View own sell only", "Add Sell", "Update Sell"]),
    ...only("Draft", ["View own drafts", "Edit draft"]),
    ...only("Quotation", ["View own quotations", "Edit quotation"]),
    ...only("StockAdjustment", ["View own stock adjustment"]),
    ...only("Crm", ["Access own follow up", "Access own leads"]),
    ...only("Report", ["View sales representative report"]),
  ],
  "Sales Commission Agent": [
    ...only("Sell", ["View own sell only", "Commission agent can view their own sell"]),
    ...only("Shipments", ["Access own shipments", "Commission agent can access their own shipments"]),
    ...only("Report", ["View sales representative report"]),
  ],

  // ── Purchase ──
  "Purchase Manager": [
    ...full("Supplier"), ...full("Purchase"),
    ...viewOnly("Product"),
    ...only("Report", ["View purchase & sell report", "View Supplier & Customer report"]),
  ],
  "Purchase Executive": [
    ...only("Supplier", ["View own supplier", "Add supplier"]),
    ...only("Purchase", ["View own Purchase", "Add purchase"]),
    ...only("Product", ["View product"]),
    ...only("StockAdjustment", ["View own stock adjustment"]),
  ],
  "Supplier Manager": [
    ...full("Supplier"),
    ...viewOnly("Product"),
    ...only("Report", ["View Supplier & Customer report"]),
  ],

  // ── Inventory ──
  "Warehouse Manager": [
    ...full("Product"), ...full("StockAdjustment"), ...full("StockTransfer"),
    ...only("Report", ["View stock report, stock adjustment report & stock expiry report"]),
  ],
  "Store Keeper": [
    ...only("Product", ["View product", "Add Opening Stock"]),
    ...only("StockAdjustment", ["View own stock adjustment", "Add stock adjustment"]),
    ...only("StockTransfer", ["View own stock transfer", "Add stock transfer"]),
  ],
  "Dispatch Manager": [
    ...only("Product", ["View product"]),
    ...only("StockTransfer", ["View own stock transfer"]),
    ...full("Shipments"),
  ],
  "Logistics Manager": [
    ...full("StockTransfer"),
    ...full("Shipments"),
  ],

  // ── Manufacturing ──
  "Production Manager": [
    ...full("Manufacturing"),
    ...only("Product", ["View product"]),
  ],
  "Production Supervisor": [
    ...only("Manufacturing", ["Access Production"]),
  ],
  "Quality Control Manager": [
    ...only("Manufacturing", ["View Recipe", "Add Recipe", "Edit Recipe"]),
  ],
  "Quality Inspector": [
    ...only("Manufacturing", ["View Recipe"]),
  ],

  // ── Finance ──
  "Finance Manager": [
    ...full("Accounting"), ...full("Account"), ...full("CashRegister"),
    ...only("Report", ["View expense report", "View profit/loss report", "View Tax report"]),
    ...full("Expense"),
  ],
  "Accounts Manager": [
    ...only("Accounting", ["View Accounting Dashboard", "Access General Ledger", "Access Receivables/Payables", "Access Financial Statements"]),
    ...only("Account", ["Access Accounts", "Edit account transaction"]),
    ...viewOnly("CashRegister"),
    ...only("Report", ["View profit/loss report"]),
  ],
  "Accountant": [
    ...only("Accounting", ["Post Journal Entries", "Access GST & Tax"]),
    ...only("Account", ["Access Accounts", "Edit account transaction"]),
    ...only("Report", ["View Tax report", "View profit/loss report"]),
  ],
  "Cashier": [
    ...only("POS", ["View POS sell", "Add POS sell", "Add/Edit Payment", "Print Invoice"]),
    ...only("Sell", ["View own sell only", "Add sell payment"]),
    ...full("CashRegister"),
    ...only("Accounting", ["Access Cash & Bank"]),
  ],

  // ── HR ──
  "HR Executive": [
    ...only("Essentials", [
      "Add/Edit/View/Delete leave type", "Add/Edit/View/Delete all leave", "Approve Leave",
      "Add/Edit/View/Delete all attendance",
      "Add/Edit/View/Delete department", "Add/Edit/View/Delete designation",
      "View Pay Component", "Add Pay Component",
      "View all Payroll", "Add Payroll", "Edit Payroll",
      "Assign To Do's to others", "Add To Do's", "Edit To Do's",
      "Create Message", "View Message",
    ]),
  ],

  // ── CRM & Support ──
  "Customer Support": [
    ...only("Customer", ["View all customer"]),
    ...only("Sell", ["View all sell"]),
    ...full("Crm"),
  ],

  // ── Marketing ──
  "Marketing Manager": [
    ...only("Customer", ["View all customer"]),
    ...only("Product", ["View product"]),
    ...only("Sell", ["View all sell"]),
    ...only("Report", ["View trending product report"]),
    ...full("Crm"),
  ],

  // ── Audit ──
  "Auditor": Object.keys(GROUPS).flatMap((g) => viewOnly(g)).concat(
    only("Report", GROUPS.Report) // Auditor gets ALL report views, since reports are inherently read-only
  ),
};

// ------------------------------------------------------------
// RUNNER
// ------------------------------------------------------------

async function run() {
  const apply = process.argv.includes('--apply');

  const existingRoles = await roleService.getAllRoles(); // [{id, name, ...}]
  const roleByName = new Map(existingRoles.map((r) => [r.name.trim().toLowerCase(), r]));

  const results = { updated: [], skipped: [] };

  for (const [roleName, permissionKeys] of Object.entries(ROLE_DEFAULTS)) {
    const match = roleByName.get(roleName.trim().toLowerCase());

    if (!match) {
      results.skipped.push(roleName);
      continue;
    }

    // De-duplicate keys
    const uniqueKeys = [...new Set(permissionKeys)];

    console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'} → "${match.name}" (id ${match.id}): ${uniqueKeys.length} permissions`);

    if (apply) {
      try {
        // Reuses existing updateRole -- same role name, new permission set
        await roleService.updateRole(match.id, match.name, uniqueKeys);
        results.updated.push(match.name);
      } catch (err) {
        console.error(`  ERROR updating "${match.name}":`, err.message);
      }
    }
  }

  console.log('\n============================================================');
  console.log(`Roles matched in DB: ${results.updated.length || (Object.keys(ROLE_DEFAULTS).length - results.skipped.length)}`);
  if (results.skipped.length) {
    console.log(`Roles NOT found in DB (skipped, not created):`);
    results.skipped.forEach((r) => console.log(`  - ${r}`));
  }
  if (!apply) {
    console.log('\nThis was a DRY RUN. No changes were written.');
    console.log('Re-run with: node seedRolePermissions.js --apply');
  }
  console.log('============================================================\n');

  process.exit(0);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});