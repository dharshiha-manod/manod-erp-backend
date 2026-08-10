/**
 * controllers/essentialsController.js
 */

'use strict';

const svc = require('../services/essentialsService');

const getUserId   = (req) => {
  const id = req.user?.id || req.user?.userId || null;
  return id !== null ? String(id) : null;
};
const getUserName = (req) => req.user?.full_name || req.user?.name || req.user?.email?.split('@')[0] || null;

/* ── TO-DO ─────────────────────────────────────────────────────────────── */
const getAllTodos = async (req, res) => {
  try {
    const { assigned_to = '', priority = '', status = '' } = req.query;
    const todos = await svc.fetchAllTodos(getIndustryId(req), { assigned_to, priority, status });
    res.json({ success: true, todos });
  } catch (err) {
    console.error('getAllTodos:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch tasks' });
  }
};
const createTodoCtrl = async (req, res) => {
  try {
    const todo = await svc.createTodo(req.body, getUserId(req), getUserName(req), getIndustryId(req));
    res.status(201).json({ success: true, message: 'Task added', todo });
  } catch (err) {
    console.error('createTodo:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const updateTodoCtrl = async (req, res) => {
  try {
    const todo = await svc.updateTodo(req.params.id, req.body, getUserId(req), getIndustryId(req));
    res.json({ success: true, message: 'Task updated', todo });
  } catch (err) {
    console.error('updateTodo:', err.message);
    res.status(err.message === 'Task not found' ? 404 : 400).json({ success: false, error: err.message });
  }
};

const deleteTodoCtrl = async (req, res) => {
  try {
    const result = await svc.deleteTodo(req.params.id, getIndustryId(req));
    res.json({ success: true, message: 'Task deleted', deleted: result });
  } catch (err) {
    console.error('deleteTodo:', err.message);
    res.status(err.message === 'Task not found' ? 404 : 500).json({ success: false, error: err.message });
  }
};
const getTodoDetailCtrl = async (req, res) => {
  try {
    const todo = await svc.fetchTodoDetail(req.params.id, getIndustryId(req));
    if (!todo) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true, todo });
  } catch (err) {
    console.error('getTodoDetail:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch task detail' });
  }
};

/* ── TO-DO: comments ──────────────────────────────────────────────────── */
const addTodoCommentCtrl = async (req, res) => {
  try {
    const comment = await svc.addTodoComment(req.params.id, req.body, getUserId(req), getIndustryId(req));
    res.status(201).json({ success: true, message: 'Comment added', comment });
  } catch (err) {
    console.error('addTodoComment:', err.message);
    res.status(err.message === 'Task not found' ? 404 : 400).json({ success: false, error: err.message });
  }
};

/* ── TO-DO: attachments ───────────────────────────────────────────────── */
const addTodoAttachmentCtrl = async (req, res) => {
  try {
    const body = { ...req.body };
    if (req.file) {
      body.file_name = body.file_name || req.file.originalname;
      body.file_size = `${(req.file.size / 1048576).toFixed(1)} MB`;
      body.file_url = `/uploads/essentials/${req.file.filename}`;
    }
const attachment = await svc.addTodoAttachment(req.params.id, body, getUserId(req), getIndustryId(req));
    res.status(201).json({ success: true, message: 'Attachment added', attachment });
  } catch (err) {
    console.error('addTodoAttachment:', err.message);
    res.status(err.message === 'Task not found' ? 404 : 400).json({ success: false, error: err.message });
  }
};

const deleteTodoAttachmentCtrl = async (req, res) => {
  try {
    const result = await svc.deleteTodoAttachment(req.params.id, req.params.attachmentId);
    res.json({ success: true, message: 'Attachment deleted', deleted: result });
  } catch (err) {
    console.error('deleteTodoAttachment:', err.message);
    res.status(err.message === 'Attachment not found' ? 404 : 500).json({ success: false, error: err.message });
  }
};

/* ── TO-DO: checklist ─────────────────────────────────────────────────── */
const addChecklistItemCtrl = async (req, res) => {
  try {
    const item = await svc.addChecklistItem(req.params.id, req.body, getIndustryId(req));
    res.status(201).json({ success: true, message: 'Checklist item added', item });
  } catch (err) {
    console.error('addChecklistItem:', err.message);
    res.status(err.message === 'Task not found' ? 404 : 400).json({ success: false, error: err.message });
  }
};

const toggleChecklistItemCtrl = async (req, res) => {
  try {
    const item = await svc.toggleChecklistItem(req.params.id, req.params.itemId, req.body.is_done);
    res.json({ success: true, message: 'Checklist item updated', item });
  } catch (err) {
    console.error('toggleChecklistItem:', err.message);
    res.status(err.message === 'Checklist item not found' ? 404 : 400).json({ success: false, error: err.message });
  }
};

const deleteChecklistItemCtrl = async (req, res) => {
  try {
    const result = await svc.deleteChecklistItem(req.params.id, req.params.itemId);
    res.json({ success: true, message: 'Checklist item deleted', deleted: result });
  } catch (err) {
    console.error('deleteChecklistItem:', err.message);
    res.status(err.message === 'Checklist item not found' ? 404 : 500).json({ success: false, error: err.message });
  }
};

/* ── DOCUMENTS ─────────────────────────────────────────────────────────── */
const getAllDocuments = async (req, res) => {
  try {
    const documents = await svc.fetchAllDocuments(getIndustryId(req));
    res.json({ success: true, documents });
  } catch (err) {
    console.error('getAllDocuments:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch documents' });
  }
};

const createDocumentCtrl = async (req, res) => {
  try {
    const body = { ...req.body };
    // If multer put a file on the request, use it for name/type/size/url.
    if (req.file) {
      body.name = body.name || req.file.originalname;
      body.type = (req.file.originalname.split('.').pop() || 'FILE').toUpperCase();
      body.size = `${(req.file.size / 1048576).toFixed(1)} MB`;
      body.file_url = `/uploads/essentials/${req.file.filename}`;
    }const doc = await svc.createDocument(body, getUserId(req), getIndustryId(req));
    res.status(201).json({ success: true, message: 'Document uploaded', document: doc });
  } catch (err) {
    console.error('createDocument:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const deleteDocumentCtrl = async (req, res) => {
  try {
    const result = await svc.deleteDocument(req.params.id, getIndustryId(req));
    res.json({ success: true, message: 'Document deleted', deleted: result });
  } catch (err) {
    console.error('deleteDocument:', err.message);
    res.status(err.message === 'Document not found' ? 404 : 500).json({ success: false, error: err.message });
  }
};

/* ── MEMOS ─────────────────────────────────────────────────────────────── */
const getIndustryId = (req) => req.industryId || null;

const getAllMemos = async (req, res) => {
  try {
    const { status = '' } = req.query;
    const memos = await svc.fetchAllMemos(getUserId(req), getIndustryId(req), { status });
    res.json({ success: true, memos });
  } catch (err) {
    console.error('getAllMemos:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch memos' });
  }
};

const getMemoDetailCtrl = async (req, res) => {
  try {
    const memo = await svc.fetchMemoDetail(req.params.id, getUserId(req), getIndustryId(req));
    if (!memo) return res.status(404).json({ success: false, error: 'Memo not found' });
    res.json({ success: true, memo });
  } catch (err) {
    console.error('getMemoDetail:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch memo' });
  }
};

const getMemoReadStatsCtrl = async (req, res) => {
  try {
    const stats = await svc.fetchMemoReadStats(req.params.id, getIndustryId(req));
    res.json({ success: true, stats });
  } catch (err) {
    console.error('getMemoReadStats:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch read stats' });
  }
};

const createMemoCtrl = async (req, res) => {
  try {
    const memo = await svc.createMemo(req.body, getUserId(req), getIndustryId(req));
    res.status(201).json({ success: true, message: memo.status === 'Published' ? 'Memo published' : 'Memo saved as draft', memo });
  } catch (err) {
    console.error('createMemo:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const updateMemoCtrl = async (req, res) => {
  try {
    const memo = await svc.updateMemo(req.params.id, req.body, getUserId(req), getIndustryId(req));
    res.json({ success: true, message: 'Memo updated', memo });
  } catch (err) {
    console.error('updateMemo:', err.message);
    res.status(err.message === 'Memo not found' ? 404 : 400).json({ success: false, error: err.message });
  }
};

const publishMemoCtrl = async (req, res) => {
  try {
    const memo = await svc.publishMemo(req.params.id, getUserId(req), getIndustryId(req));
    res.json({ success: true, message: 'Memo published', memo });
  } catch (err) {
    console.error('publishMemo:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const archiveMemoCtrl = async (req, res) => {
  try {
    const memo = await svc.archiveMemo(req.params.id, getUserId(req), getIndustryId(req));
    res.json({ success: true, message: 'Memo archived', memo });
  } catch (err) {
    console.error('archiveMemo:', err.message);
    res.status(err.message === 'Memo not found' ? 404 : 400).json({ success: false, error: err.message });
  }
};

const deleteMemoCtrl = async (req, res) => {
  try {
    const result = await svc.deleteMemo(req.params.id, getIndustryId(req));
    res.json({ success: true, message: 'Memo deleted', deleted: result });
  } catch (err) {
    console.error('deleteMemo:', err.message);
    res.status(err.message === 'Memo not found' ? 404 : 500).json({ success: false, error: err.message });
  }
};

const addMemoAttachmentCtrl = async (req, res) => {
  try {
    if (!req.file) throw new Error('No file uploaded');
    const attachment = await svc.addMemoAttachment(
      req.params.id,
      { file_name: req.file.originalname, file_url: `/uploads/essentials/${req.file.filename}`, file_size: req.file.size },
      getUserId(req),
      getIndustryId(req)
    );
    res.status(201).json({ success: true, attachment });
  } catch (err) {
    console.error('addMemoAttachment:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const deleteMemoAttachmentCtrl = async (req, res) => {
  try {
    const result = await svc.deleteMemoAttachment(req.params.id, req.params.attachmentId, getIndustryId(req));
    res.json({ success: true, deleted: result });
  } catch (err) {
    console.error('deleteMemoAttachment:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const markMemoSeenCtrl = async (req, res) => {
  try {
    const read = await svc.markMemoSeen(req.params.id, getUserId(req));
    res.json({ success: true, read });
  } catch (err) {
    console.error('markMemoSeen:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const acknowledgeMemoCtrl = async (req, res) => {
  try {
    const read = await svc.acknowledgeMemo(req.params.id, getUserId(req));
    res.json({ success: true, message: 'Memo acknowledged', read });
  } catch (err) {
    console.error('acknowledgeMemo:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};  

/* ── REMINDERS ─────────────────────────────────────────────────────────── */
const getAllReminders = async (req, res) => {
  try {
    const reminders = await svc.fetchAllReminders(getIndustryId(req));
    res.json({ success: true, reminders });
  } catch (err) {
    console.error('getAllReminders:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch reminders' });
  }
};

const createReminderCtrl = async (req, res) => {
  try {
const reminder = await svc.createReminder(req.body, getUserId(req), getIndustryId(req));
    res.status(201).json({ success: true, message: 'Reminder added', reminder });
  } catch (err) {
    console.error('createReminder:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const deleteReminderCtrl = async (req, res) => {
  try {
    const result = await svc.deleteReminder(req.params.id, getIndustryId(req));
    res.json({ success: true, message: 'Reminder deleted', deleted: result });
  } catch (err) {
    console.error('deleteReminder:', err.message);
    res.status(err.message === 'Reminder not found' ? 404 : 500).json({ success: false, error: err.message });
  }
};

/* ── MESSAGES ──────────────────────────────────────────────────────────── */
const getContactsCtrl = async (req, res) => {
  try {
    const contacts = await svc.fetchContacts(getUserId(req));
    res.json({ success: true, contacts, myId: getUserId(req) });
  } catch (err) {
    console.error('getContacts:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch contacts' });
  }
};

const getAllMessages = async (req, res) => {
  try {
    const { recipient_id = '' } = req.query;
    const messages = await svc.fetchConversation(getUserId(req), recipient_id);
    res.json({ success: true, messages });
  } catch (err) {
    console.error('getAllMessages:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const createMessageCtrl = async (req, res) => {
  try {
    const message = await svc.createMessage(req.body, getUserId(req));
    res.status(201).json({ success: true, message: 'Message sent', data: message });
  } catch (err) {
    console.error('createMessage:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

/* ── KNOWLEDGE BASE ────────────────────────────────────────────────────── */
const getUserRole   = (req) => req.user?.role || '';
const getUserBranch = (req) => req.user?.branch || '';

/* ── KB Categories ─────────────────────────────────────────── */
const getKbCategories = async (req, res) => {
  try {
    const categories = await svc.fetchKbCategories(getIndustryId(req));
    res.json({ success: true, categories });
  } catch (err) {
    console.error('getKbCategories:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch categories' });
  }
};

const createKbCategoryCtrl = async (req, res) => {
  try {
    const category = await svc.createKbCategory(req.body, getUserId(req), getIndustryId(req));
    res.status(201).json({ success: true, message: 'Category created', category });
  } catch (err) {
    console.error('createKbCategory:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const updateKbCategoryCtrl = async (req, res) => {
  try {
    const category = await svc.updateKbCategory(req.params.id, req.body, getIndustryId(req));
    res.json({ success: true, message: 'Category updated', category });
  } catch (err) {
    console.error('updateKbCategory:', err.message);
    res.status(err.message === 'Category not found' ? 404 : 400).json({ success: false, error: err.message });
  }
};

const deleteKbCategoryCtrl = async (req, res) => {
  try {
    const result = await svc.deleteKbCategory(req.params.id, getIndustryId(req));
    res.json({ success: true, message: 'Category deleted', deleted: result });
  } catch (err) {
    console.error('deleteKbCategory:', err.message);
    res.status(err.message === 'Category not found' ? 404 : 500).json({ success: false, error: err.message });
  }
};

/* ── KB Articles ───────────────────────────────────────────── */
const getAllKb = async (req, res) => {
  try {
    const { search = '', category_id = '', status = '', tag = '', favorites = '' } = req.query;
    const articles = await svc.fetchAllKb(
      getUserId(req), getUserRole(req), getUserBranch(req), getIndustryId(req),
      { search, category_id, status, tag, favorites }
    );
    res.json({ success: true, articles });
  } catch (err) {
    console.error('getAllKb:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch articles' });
  }
};

const getKbDetailCtrl = async (req, res) => {
  try {
    const article = await svc.fetchKbDetail(req.params.id, getUserId(req), getUserRole(req), getUserBranch(req), getIndustryId(req));
    if (!article) return res.status(404).json({ success: false, error: 'Article not found' });
    res.json({ success: true, article });
  } catch (err) {
    console.error('getKbDetail:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch article' });
  }
};

const createKbCtrl = async (req, res) => {
  try {
    const article = await svc.createKb(req.body, getUserId(req), getIndustryId(req));
    res.status(201).json({ success: true, message: article.status === 'Published' ? 'Article published' : 'Article saved as draft', article });
  } catch (err) {
    console.error('createKb:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const updateKbCtrl = async (req, res) => {
  try {
    const article = await svc.updateKb(req.params.id, req.body, getUserId(req), getIndustryId(req));
    res.json({ success: true, message: 'Article updated', article });
  } catch (err) {
    console.error('updateKb:', err.message);
    res.status(err.message === 'Article not found' ? 404 : 400).json({ success: false, error: err.message });
  }
};

const publishKbCtrl = async (req, res) => {
  try {
    const article = await svc.publishKb(req.params.id, getUserId(req), getIndustryId(req));
    res.json({ success: true, message: 'Article published', article });
  } catch (err) {
    console.error('publishKb:', err.message);
    res.status(err.message === 'Article not found or already published' ? 400 : 500).json({ success: false, error: err.message });
  }
};

const archiveKbCtrl = async (req, res) => {
  try {
    const article = await svc.archiveKb(req.params.id, getUserId(req), getIndustryId(req));
    res.json({ success: true, message: 'Article archived', article });
  } catch (err) {
    console.error('archiveKb:', err.message);
    res.status(err.message === 'Article not found' ? 404 : 400).json({ success: false, error: err.message });
  }
};

const deleteKbCtrl = async (req, res) => {
  try {
    const result = await svc.deleteKb(req.params.id, getUserId(req), getIndustryId(req));
    res.json({ success: true, message: 'Article deleted', deleted: result });
  } catch (err) {
    console.error('deleteKb:', err.message);
    res.status(err.message === 'Article not found' ? 404 : 500).json({ success: false, error: err.message });
  }
};

/* ── KB Attachments ────────────────────────────────────────── */
const addKbAttachmentCtrl = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
    const attachment = await svc.addKbAttachment(
      req.params.id,
      { file_name: req.file.originalname, file_url: `/uploads/essentials/${req.file.filename}`, file_size: req.file.size },
      getUserId(req), getIndustryId(req)
    );
    res.status(201).json({ success: true, message: 'File attached', attachment });
  } catch (err) {
    console.error('addKbAttachment:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const deleteKbAttachmentCtrl = async (req, res) => {
  try {
    const result = await svc.deleteKbAttachment(req.params.id, req.params.attachmentId, getUserId(req), getIndustryId(req));
    res.json({ success: true, message: 'Attachment removed', deleted: result });
  } catch (err) {
    console.error('deleteKbAttachment:', err.message);
    res.status(err.message === 'Attachment not found' ? 404 : 400).json({ success: false, error: err.message });
  }
};

/* ── KB Favorites / Views ──────────────────────────────────── */
const toggleKbFavoriteCtrl = async (req, res) => {
  try {
    const result = await svc.toggleKbFavorite(req.params.id, getUserId(req));
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('toggleKbFavorite:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const recordKbViewCtrl = async (req, res) => {
  try {
    const result = await svc.recordKbView(req.params.id, getUserId(req), getIndustryId(req));
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('recordKbView:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const getRecentlyViewedCtrl = async (req, res) => {
  try {
    const articles = await svc.fetchRecentlyViewed(getUserId(req), getIndustryId(req));
    res.json({ success: true, articles });
  } catch (err) {
    console.error('getRecentlyViewed:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch recently viewed' });
  }
};

/* ── KB Versions ───────────────────────────────────────────── */
const getKbVersionsCtrl = async (req, res) => {
  try {
    const versions = await svc.fetchKbVersions(req.params.id, getIndustryId(req));
    res.json({ success: true, versions });
  } catch (err) {
    console.error('getKbVersions:', err.message);
    res.status(err.message === 'Article not found' ? 404 : 500).json({ success: false, error: err.message });
  }
};

const restoreKbVersionCtrl = async (req, res) => {
  try {
    const article = await svc.restoreKbVersion(req.params.id, req.params.versionId, getUserId(req), getIndustryId(req));
    res.json({ success: true, message: 'Version restored', article });
  } catch (err) {
    console.error('restoreKbVersion:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

/* ── KB Tags / Audit / Stats ───────────────────────────────── */
const getKbTagsCtrl = async (req, res) => {
  try {
    const tags = await svc.fetchKbTags(getIndustryId(req));
    res.json({ success: true, tags });
  } catch (err) {
    console.error('getKbTags:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch tags' });
  }
};

const getKbAuditLogCtrl = async (req, res) => {
  try {
    const logs = await svc.fetchKbAuditLog(req.query.article_id || null, getIndustryId(req));
    res.json({ success: true, logs });
  } catch (err) {
    console.error('getKbAuditLog:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch audit log' });
  }
};

const getKbStatsCtrl = async (req, res) => {
  try {
    const stats = await svc.fetchKbStats(getIndustryId(req));
    res.json({ success: true, stats });
  } catch (err) {
    console.error('getKbStats:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
};
  

/* ── SETTINGS ──────────────────────────────────────────────────────────── */
const getSettingsCtrl = async (req, res) => {
  try {
    const settings = await svc.fetchSettings();
    res.json({ success: true, settings });
  } catch (err) {
    console.error('getSettings:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch settings' });
  }
};

const updateSettingsCtrl = async (req, res) => {
  try {
    const settings = await svc.updateSettings(req.body);
    res.json({ success: true, message: 'Settings saved', settings });
  } catch (err) {
    console.error('updateSettings:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

module.exports = {
  getAllTodos, createTodo: createTodoCtrl, updateTodo: updateTodoCtrl, deleteTodo: deleteTodoCtrl,
  getTodoDetail: getTodoDetailCtrl,
  addTodoComment: addTodoCommentCtrl,
  addTodoAttachment: addTodoAttachmentCtrl, deleteTodoAttachment: deleteTodoAttachmentCtrl,
  addChecklistItem: addChecklistItemCtrl, toggleChecklistItem: toggleChecklistItemCtrl, deleteChecklistItem: deleteChecklistItemCtrl,
  getAllDocuments, createDocument: createDocumentCtrl, deleteDocument: deleteDocumentCtrl,
getAllMemos, getMemoDetail: getMemoDetailCtrl, getMemoReadStats: getMemoReadStatsCtrl,
  createMemo: createMemoCtrl, updateMemo: updateMemoCtrl,
  publishMemo: publishMemoCtrl, archiveMemo: archiveMemoCtrl, deleteMemo: deleteMemoCtrl,
  addMemoAttachment: addMemoAttachmentCtrl, deleteMemoAttachment: deleteMemoAttachmentCtrl,
  markMemoSeen: markMemoSeenCtrl, acknowledgeMemo: acknowledgeMemoCtrl,
  getAllReminders, createReminder: createReminderCtrl, deleteReminder: deleteReminderCtrl,
getContacts: getContactsCtrl, getAllMessages, createMessage: createMessageCtrl,
getKbCategories, createKbCategory: createKbCategoryCtrl, updateKbCategory: updateKbCategoryCtrl, deleteKbCategory: deleteKbCategoryCtrl,
  getAllKb, getKbDetail: getKbDetailCtrl,
  createKb: createKbCtrl, updateKb: updateKbCtrl, publishKb: publishKbCtrl, archiveKb: archiveKbCtrl, deleteKb: deleteKbCtrl,
  addKbAttachment: addKbAttachmentCtrl, deleteKbAttachment: deleteKbAttachmentCtrl,
  toggleKbFavorite: toggleKbFavoriteCtrl, recordKbView: recordKbViewCtrl, getRecentlyViewed: getRecentlyViewedCtrl,
  getKbVersions: getKbVersionsCtrl, restoreKbVersion: restoreKbVersionCtrl,
  getKbTags: getKbTagsCtrl, getKbAuditLog: getKbAuditLogCtrl, getKbStats: getKbStatsCtrl,
  getSettings: getSettingsCtrl, updateSettings: updateSettingsCtrl,
};