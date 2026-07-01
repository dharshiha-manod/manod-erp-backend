/**
 * ====================================================
 * routes/essentials.js
 * Mount point: /api/essentials  (register in server.js)
 * ====================================================
 *
 * These routes only require a valid login (authenticateToken).
 * There's no granular permission group for Essentials sub-resources
 * in the current permission map, so — unlike Expenses/Purchases — we
 * don't gate with requireAnyPermission here. If you later add DB
 * permissions like ("Essentials", "Add To Do's"), swap in
 * requireAnyPermission(...) the same way routes/expenses.js does.
 */

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');

const authenticateToken = require('../middleware/auth');
const ctrl               = require('../controllers/essentialsController');

// ── File upload (Documents tab) ─────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'essentials');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB cap

// ── To-Do ────────────────────────────────────────────────────────────────
router.get('/todos',        authenticateToken, ctrl.getAllTodos);
router.post('/todos',       authenticateToken, ctrl.createTodo);
router.put('/todos/:id',    authenticateToken, ctrl.updateTodo);
router.delete('/todos/:id', authenticateToken, ctrl.deleteTodo);

// ── Documents ────────────────────────────────────────────────────────────
router.get('/documents',        authenticateToken, ctrl.getAllDocuments);
router.post('/documents',       authenticateToken, upload.single('file'), ctrl.createDocument);
router.delete('/documents/:id', authenticateToken, ctrl.deleteDocument);

// ── Memos ────────────────────────────────────────────────────────────────
router.get('/memos',        authenticateToken, ctrl.getAllMemos);
router.post('/memos',       authenticateToken, ctrl.createMemo);
router.put('/memos/:id',    authenticateToken, ctrl.updateMemo);
router.delete('/memos/:id', authenticateToken, ctrl.deleteMemo);

// ── Reminders ────────────────────────────────────────────────────────────
router.get('/reminders',        authenticateToken, ctrl.getAllReminders);
router.post('/reminders',       authenticateToken, ctrl.createReminder);
router.delete('/reminders/:id', authenticateToken, ctrl.deleteReminder);

// ── Messages ─────────────────────────────────────────────────────────────
// GET /api/essentials/messages?recipient=Admin
router.get('/contacts',  authenticateToken, ctrl.getContacts);
router.get('/messages',  authenticateToken, ctrl.getAllMessages);
router.post('/messages', authenticateToken, ctrl.createMessage);

// ── Knowledge Base ───────────────────────────────────────────────────────
// GET /api/essentials/kb?search=stock
router.get('/kb',        authenticateToken, ctrl.getAllKb);
router.post('/kb',       authenticateToken, ctrl.createKb);
router.put('/kb/:id',    authenticateToken, ctrl.updateKb);
router.delete('/kb/:id', authenticateToken, ctrl.deleteKb);

// ── Settings (singleton) ─────────────────────────────────────────────────
router.get('/settings', authenticateToken, ctrl.getSettings);
router.put('/settings', authenticateToken, ctrl.updateSettings);

module.exports = router;