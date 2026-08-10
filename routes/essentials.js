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
router.get('/todos/:id',    authenticateToken, ctrl.getTodoDetail);
router.put('/todos/:id',    authenticateToken, ctrl.updateTodo);
router.delete('/todos/:id', authenticateToken, ctrl.deleteTodo);

// To-Do comments
router.post('/todos/:id/comments', authenticateToken, ctrl.addTodoComment);

// To-Do attachments (reuses the same 25MB upload config as Documents)
router.post('/todos/:id/attachments',                  authenticateToken, upload.single('file'), ctrl.addTodoAttachment);
router.delete('/todos/:id/attachments/:attachmentId',  authenticateToken, ctrl.deleteTodoAttachment);

// To-Do checklist
router.post('/todos/:id/checklist',                authenticateToken, ctrl.addChecklistItem);
router.put('/todos/:id/checklist/:itemId',          authenticateToken, ctrl.toggleChecklistItem);
router.delete('/todos/:id/checklist/:itemId',       authenticateToken, ctrl.deleteChecklistItem);

// ── Documents ────────────────────────────────────────────────────────────
router.get('/documents',        authenticateToken, ctrl.getAllDocuments);
router.post('/documents',       authenticateToken, upload.single('file'), ctrl.createDocument);
router.delete('/documents/:id', authenticateToken, ctrl.deleteDocument);

// ── Memos ────────────────────────────────────────────────────────────────
// (req.industryId comes from the requireIndustry middleware mounted on
// this whole router in server.js — see app.use('/api/essentials', ...))
router.get('/memos',                                    authenticateToken, ctrl.getAllMemos);
router.get('/memos/:id',                                 authenticateToken, ctrl.getMemoDetail);
router.get('/memos/:id/read-stats',                       authenticateToken, ctrl.getMemoReadStats);
router.post('/memos',                                    authenticateToken, ctrl.createMemo);
router.put('/memos/:id',                                  authenticateToken, ctrl.updateMemo);
router.post('/memos/:id/publish',                         authenticateToken, ctrl.publishMemo);
router.post('/memos/:id/archive',                         authenticateToken, ctrl.archiveMemo);
router.delete('/memos/:id',                               authenticateToken, ctrl.deleteMemo);
router.post('/memos/:id/attachments',                     authenticateToken, upload.single('file'), ctrl.addMemoAttachment);
router.delete('/memos/:id/attachments/:attachmentId',     authenticateToken, ctrl.deleteMemoAttachment);
router.post('/memos/:id/seen',                            authenticateToken, ctrl.markMemoSeen);
router.post('/memos/:id/acknowledge',                     authenticateToken, ctrl.acknowledgeMemo);

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
// GET /api/essentials/kb?search=stock&category_id=&status=&tag=&favorites=true
router.get('/kb/categories',           authenticateToken, ctrl.getKbCategories);
router.post('/kb/categories',          authenticateToken, ctrl.createKbCategory);
router.put('/kb/categories/:id',       authenticateToken, ctrl.updateKbCategory);
router.delete('/kb/categories/:id',    authenticateToken, ctrl.deleteKbCategory);

router.get('/kb/tags',       authenticateToken, ctrl.getKbTags);
router.get('/kb/recent',     authenticateToken, ctrl.getRecentlyViewed);
router.get('/kb/audit-log',  authenticateToken, ctrl.getKbAuditLog);
router.get('/kb/stats',      authenticateToken, ctrl.getKbStats);

// ── Knowledge Base ───────────────────────────────────────────────────────
// GET /api/essentials/kb?search=stock&category_id=&status=&tag=&favorites=true
// NOTE: these fixed-path routes (categories, tags, recent, audit-log, stats)
// must stay ABOVE /kb/:id — otherwise Express treats "categories" etc. as
// an :id value and routes to the wrong handler.
router.get('/kb/categories',           authenticateToken, ctrl.getKbCategories);
router.post('/kb/categories',          authenticateToken, ctrl.createKbCategory);
router.put('/kb/categories/:id',       authenticateToken, ctrl.updateKbCategory);
router.delete('/kb/categories/:id',    authenticateToken, ctrl.deleteKbCategory);

router.get('/kb/tags',       authenticateToken, ctrl.getKbTags);
router.get('/kb/recent',     authenticateToken, ctrl.getRecentlyViewed);
router.get('/kb/audit-log',  authenticateToken, ctrl.getKbAuditLog);
router.get('/kb/stats',      authenticateToken, ctrl.getKbStats);

router.get('/kb',        authenticateToken, ctrl.getAllKb);
router.get('/kb/:id',    authenticateToken, ctrl.getKbDetail);
router.post('/kb',       authenticateToken, ctrl.createKb);
router.put('/kb/:id',    authenticateToken, ctrl.updateKb);
router.delete('/kb/:id', authenticateToken, ctrl.deleteKb);
router.post('/kb/:id/publish', authenticateToken, ctrl.publishKb);
router.post('/kb/:id/archive', authenticateToken, ctrl.archiveKb);

router.post('/kb/:id/attachments',                  authenticateToken, upload.single('file'), ctrl.addKbAttachment);
router.delete('/kb/:id/attachments/:attachmentId',  authenticateToken, ctrl.deleteKbAttachment);

router.post('/kb/:id/favorite', authenticateToken, ctrl.toggleKbFavorite);
router.post('/kb/:id/view',     authenticateToken, ctrl.recordKbView);

router.get('/kb/:id/versions',              authenticateToken, ctrl.getKbVersions);
router.post('/kb/:id/versions/:versionId/restore', authenticateToken, ctrl.restoreKbVersion);
router.post('/kb/:id/publish', authenticateToken, ctrl.publishKb);
router.post('/kb/:id/archive', authenticateToken, ctrl.archiveKb);

router.post('/kb/:id/attachments',                  authenticateToken, upload.single('file'), ctrl.addKbAttachment);
router.delete('/kb/:id/attachments/:attachmentId',  authenticateToken, ctrl.deleteKbAttachment);

router.post('/kb/:id/favorite', authenticateToken, ctrl.toggleKbFavorite);
router.post('/kb/:id/view',     authenticateToken, ctrl.recordKbView);

router.get('/kb/:id/versions',              authenticateToken, ctrl.getKbVersions);
router.post('/kb/:id/versions/:versionId/restore', authenticateToken, ctrl.restoreKbVersion);

// ── Settings (singleton) ─────────────────────────────────────────────────
router.get('/settings', authenticateToken, ctrl.getSettings);
router.put('/settings', authenticateToken, ctrl.updateSettings);

module.exports = router;