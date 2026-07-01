/**
 * controllers/essentialsController.js
 */

'use strict';

const svc = require('../services/essentialsService');

const getUserId   = (req) => req.user?.id || req.user?.userId || null;
const getUserName = (req) => req.user?.full_name || req.user?.name || req.user?.email?.split('@')[0] || null;

/* ── TO-DO ─────────────────────────────────────────────────────────────── */
const getAllTodos = async (req, res) => {
  try {
    const { assigned_to = '', priority = '', status = '' } = req.query;
    const todos = await svc.fetchAllTodos({ assigned_to, priority, status });
    res.json({ success: true, todos });
  } catch (err) {
    console.error('getAllTodos:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch tasks' });
  }
};

const createTodoCtrl = async (req, res) => {
  try {
    const todo = await svc.createTodo(req.body, getUserId(req), getUserName(req));
    res.status(201).json({ success: true, message: 'Task added', todo });
  } catch (err) {
    console.error('createTodo:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const updateTodoCtrl = async (req, res) => {
  try {
    const todo = await svc.updateTodo(req.params.id, req.body);
    res.json({ success: true, message: 'Task updated', todo });
  } catch (err) {
    console.error('updateTodo:', err.message);
    res.status(err.message === 'Task not found' ? 404 : 400).json({ success: false, error: err.message });
  }
};

const deleteTodoCtrl = async (req, res) => {
  try {
    const result = await svc.deleteTodo(req.params.id);
    res.json({ success: true, message: 'Task deleted', deleted: result });
  } catch (err) {
    console.error('deleteTodo:', err.message);
    res.status(err.message === 'Task not found' ? 404 : 500).json({ success: false, error: err.message });
  }
};

/* ── DOCUMENTS ─────────────────────────────────────────────────────────── */
const getAllDocuments = async (req, res) => {
  try {
    const documents = await svc.fetchAllDocuments();
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
    }
    const doc = await svc.createDocument(body, getUserId(req));
    res.status(201).json({ success: true, message: 'Document uploaded', document: doc });
  } catch (err) {
    console.error('createDocument:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const deleteDocumentCtrl = async (req, res) => {
  try {
    const result = await svc.deleteDocument(req.params.id);
    res.json({ success: true, message: 'Document deleted', deleted: result });
  } catch (err) {
    console.error('deleteDocument:', err.message);
    res.status(err.message === 'Document not found' ? 404 : 500).json({ success: false, error: err.message });
  }
};

/* ── MEMOS ─────────────────────────────────────────────────────────────── */
const getAllMemos = async (req, res) => {
  try {
    const memos = await svc.fetchAllMemos();
    res.json({ success: true, memos });
  } catch (err) {
    console.error('getAllMemos:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch memos' });
  }
};

const createMemoCtrl = async (req, res) => {
  try {
    const memo = await svc.createMemo(req.body, getUserId(req));
    res.status(201).json({ success: true, message: 'Memo added', memo });
  } catch (err) {
    console.error('createMemo:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const updateMemoCtrl = async (req, res) => {
  try {
    const memo = await svc.updateMemo(req.params.id, req.body);
    res.json({ success: true, message: 'Memo updated', memo });
  } catch (err) {
    console.error('updateMemo:', err.message);
    res.status(err.message === 'Memo not found' ? 404 : 400).json({ success: false, error: err.message });
  }
};

const deleteMemoCtrl = async (req, res) => {
  try {
    const result = await svc.deleteMemo(req.params.id);
    res.json({ success: true, message: 'Memo deleted', deleted: result });
  } catch (err) {
    console.error('deleteMemo:', err.message);
    res.status(err.message === 'Memo not found' ? 404 : 500).json({ success: false, error: err.message });
  }
};

/* ── REMINDERS ─────────────────────────────────────────────────────────── */
const getAllReminders = async (req, res) => {
  try {
    const reminders = await svc.fetchAllReminders();
    res.json({ success: true, reminders });
  } catch (err) {
    console.error('getAllReminders:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch reminders' });
  }
};

const createReminderCtrl = async (req, res) => {
  try {
    const reminder = await svc.createReminder(req.body, getUserId(req));
    res.status(201).json({ success: true, message: 'Reminder added', reminder });
  } catch (err) {
    console.error('createReminder:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const deleteReminderCtrl = async (req, res) => {
  try {
    const result = await svc.deleteReminder(req.params.id);
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
const getAllKb = async (req, res) => {
  try {
    const { search = '' } = req.query;
    const articles = await svc.fetchAllKb(search);
    res.json({ success: true, articles });
  } catch (err) {
    console.error('getAllKb:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch articles' });
  }
};

const createKbCtrl = async (req, res) => {
  try {
    const article = await svc.createKb(req.body, getUserId(req));
    res.status(201).json({ success: true, message: 'Article published', article });
  } catch (err) {
    console.error('createKb:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const updateKbCtrl = async (req, res) => {
  try {
    const article = await svc.updateKb(req.params.id, req.body);
    res.json({ success: true, message: 'Article updated', article });
  } catch (err) {
    console.error('updateKb:', err.message);
    res.status(err.message === 'Article not found' ? 404 : 400).json({ success: false, error: err.message });
  }
};

const deleteKbCtrl = async (req, res) => {
  try {
    const result = await svc.deleteKb(req.params.id);
    res.json({ success: true, message: 'Article deleted', deleted: result });
  } catch (err) {
    console.error('deleteKb:', err.message);
    res.status(err.message === 'Article not found' ? 404 : 500).json({ success: false, error: err.message });
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
  getAllDocuments, createDocument: createDocumentCtrl, deleteDocument: deleteDocumentCtrl,
  getAllMemos, createMemo: createMemoCtrl, updateMemo: updateMemoCtrl, deleteMemo: deleteMemoCtrl,
  getAllReminders, createReminder: createReminderCtrl, deleteReminder: deleteReminderCtrl,
getContacts: getContactsCtrl, getAllMessages, createMessage: createMessageCtrl,
  getAllKb, createKb: createKbCtrl, updateKb: updateKbCtrl, deleteKb: deleteKbCtrl,
  getSettings: getSettingsCtrl, updateSettings: updateSettingsCtrl,
};