const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { UPLOAD_DIR, removeFile } = require('../middlewares/upload');

// Whitelist kolom sort -> mencegah SQL injection lewat parameter ?sort=
const SORTS = {
  date_desc: 't.transaction_date DESC, t.id DESC',
  date_asc: 't.transaction_date ASC, t.id ASC',
  amount_desc: 't.amount DESC, t.id DESC',
  amount_asc: 't.amount ASC, t.id ASC',
};

const SELECT_BASE = `
  SELECT t.id, t.type, t.amount, t.description, t.notes, t.transaction_date,
         t.created_at, t.updated_at,
         t.category_id, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
         t.payment_method_id, pm.name AS payment_method_name,
         (SELECT COUNT(*) FROM attachments a WHERE a.transaction_id = t.id) AS attachment_count
  FROM transactions t
  JOIN categories c ON c.id = t.category_id
  LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id`;

/* ---------- Helper ---------- */
const format = (r) => ({
  id: r.id,
  type: r.type,
  amount: Number(r.amount),
  description: r.description,
  notes: r.notes,
  transaction_date: r.transaction_date,
  category: {
    id: r.category_id,
    name: r.category_name,
    icon: r.category_icon,
    color: r.category_color,
  },
  payment_method: r.payment_method_id
    ? { id: r.payment_method_id, name: r.payment_method_name }
    : null,
  attachment_count: Number(r.attachment_count || 0),
  created_at: r.created_at,
  updated_at: r.updated_at,
});

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const discard = (req) => req.file && removeFile(req.file.path);

const fieldError = (res, field, message) =>
  res.status(400).json({ message: 'Validasi gagal', errors: [{ field, message }] });

const truthy = (v) => v === true || v === 'true' || v === '1' || v === 'on';

// Satu transaksi milik user (belum dihapus) beserta daftar bukti
async function fetchOne(userId, id) {
  const [rows] = await pool.query(
    `${SELECT_BASE} WHERE t.id = ? AND t.user_id = ? AND t.is_deleted = 0`,
    [id, userId]
  );
  if (!rows.length) return null;

  const tx = format(rows[0]);
  const [atts] = await pool.query(
    'SELECT id, file_type, file_size, created_at FROM attachments WHERE transaction_id = ? ORDER BY id',
    [id]
  );
  tx.attachments = atts;
  return tx;
}

// Kategori harus milik user / default, metode pembayaran harus ada
async function checkRelations(userId, categoryId, paymentMethodId) {
  const [cat] = await pool.query(
    'SELECT id FROM categories WHERE id = ? AND (user_id IS NULL OR user_id = ?)',
    [categoryId, userId]
  );
  if (!cat.length) return { field: 'category_id', message: 'Kategori tidak valid' };

  const [pm] = await pool.query('SELECT id FROM payment_methods WHERE id = ?', [paymentMethodId]);
  if (!pm.length) return { field: 'payment_method_id', message: 'Metode pembayaran tidak valid' };
  return null;
}

/* ---------- GET /transactions ---------- */
exports.getTransactions = async (req, res, next) => {
  try {
    const q = req.query;
    const page = Number(q.page) || 1;
    const limit = Number(q.limit) || 10;
    const sort = SORTS[q.sort] ? q.sort : 'date_desc';

    // Aturan bisnis #1: user hanya melihat transaksi miliknya; soft delete tidak ikut
    const where = ['t.user_id = ?', 't.is_deleted = 0'];
    const params = [req.user.id];

    if (q.search) {
      // '!' sebagai escape agar karakter % dan _ dicari apa adanya
      where.push("t.description LIKE ? ESCAPE '!'");
      params.push('%' + String(q.search).replace(/[!%_]/g, '!$&') + '%');
    }
    if (q.category_id) {
      where.push('t.category_id = ?');
      params.push(Number(q.category_id));
    }
    if (q.payment_method_id) {
      where.push('t.payment_method_id = ?');
      params.push(Number(q.payment_method_id));
    }
    if (q.start_date) {
      where.push('t.transaction_date >= ?');
      params.push(q.start_date);
    }
    if (q.end_date) {
      where.push('t.transaction_date <= ?');
      params.push(q.end_date);
    }
    const whereSql = where.join(' AND ');

    const [[agg]] = await pool.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(t.amount), 0) AS total_amount
       FROM transactions t WHERE ${whereSql}`,
      params
    );
    const total = Number(agg.total);

    const [rows] = await pool.query(
      `${SELECT_BASE} WHERE ${whereSql} ORDER BY ${SORTS[sort]} LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit]
    );

    return res.status(200).json({
      data: rows.map(format),
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
      summary: { total_amount: Number(agg.total_amount) },
    });
  } catch (err) {
    next(err);
  }
};

/* ---------- GET /transactions/:id ---------- */
exports.getTransactionById = async (req, res, next) => {
  try {
    const tx = await fetchOne(req.user.id, Number(req.params.id));
    if (!tx) return res.status(404).json({ message: 'Transaksi tidak ditemukan' });
    return res.status(200).json(tx);
  } catch (err) {
    next(err);
  }
};

/* ---------- POST /transactions ---------- */
exports.createTransaction = async (req, res, next) => {
  let conn;
  try {
    const b = req.body;
    const userId = req.user.id;

    const bad = await checkRelations(userId, Number(b.category_id), Number(b.payment_method_id));
    if (bad) {
      discard(req);
      return fieldError(res, bad.field, bad.message);
    }

    conn = await pool.getConnection();
    let id;
    try {
      await conn.beginTransaction();
      const [r] = await conn.query(
        `INSERT INTO transactions
           (user_id, category_id, payment_method_id, type, amount, description, notes, transaction_date)
         VALUES (?, ?, ?, 'expense', ?, ?, ?, ?)`,
        [
          userId,
          Number(b.category_id),
          Number(b.payment_method_id),
          String(b.amount).trim(),
          b.description,
          b.notes || null,
          b.transaction_date || today(),
        ]
      );
      id = r.insertId;
      if (req.file) {
        await conn.query(
          'INSERT INTO attachments (transaction_id, file_path, file_type, file_size) VALUES (?, ?, ?, ?)',
          [id, req.file.filename, req.file.detectedType, req.file.size]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      discard(req);
      throw e;
    }

    return res.status(201).json(await fetchOne(userId, id));
  } catch (err) {
    next(err);
  } finally {
    if (conn) conn.release();
  }
};

/* ---------- PUT /transactions/:id ---------- */
exports.updateTransaction = async (req, res, next) => {
  let conn;
  try {
    const b = req.body;
    const userId = req.user.id;
    const id = Number(req.params.id);

    const existing = await fetchOne(userId, id);
    if (!existing) {
      discard(req);
      return res.status(404).json({ message: 'Transaksi tidak ditemukan' });
    }

    const bad = await checkRelations(userId, Number(b.category_id), Number(b.payment_method_id));
    if (bad) {
      discard(req);
      return fieldError(res, bad.field, bad.message);
    }

    const replaceAttachment = Boolean(req.file) || truthy(b.remove_attachment);
    let oldFiles = [];

    conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE transactions
         SET category_id = ?, payment_method_id = ?, amount = ?, description = ?,
             notes = ?, transaction_date = ?
         WHERE id = ? AND user_id = ? AND is_deleted = 0`,
        [
          Number(b.category_id),
          Number(b.payment_method_id),
          String(b.amount).trim(),
          b.description,
          b.notes || null,
          b.transaction_date || existing.transaction_date,
          id,
          userId,
        ]
      );

      if (replaceAttachment) {
        const [olds] = await conn.query('SELECT file_path FROM attachments WHERE transaction_id = ?', [id]);
        oldFiles = olds.map((r) => r.file_path);
        await conn.query('DELETE FROM attachments WHERE transaction_id = ?', [id]);
      }
      if (req.file) {
        await conn.query(
          'INSERT INTO attachments (transaction_id, file_path, file_type, file_size) VALUES (?, ?, ?, ?)',
          [id, req.file.filename, req.file.detectedType, req.file.size]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      discard(req);
      throw e;
    }

    // File lama baru dihapus setelah database berhasil di-commit
    oldFiles.forEach((f) => removeFile(path.join(UPLOAD_DIR, path.basename(f))));

    return res.status(200).json(await fetchOne(userId, id));
  } catch (err) {
    next(err);
  } finally {
    if (conn) conn.release();
  }
};

/* ---------- DELETE /transactions/:id (soft delete) ---------- */
exports.deleteTransaction = async (req, res, next) => {
  try {
    const [r] = await pool.query(
      'UPDATE transactions SET is_deleted = TRUE WHERE id = ? AND user_id = ? AND is_deleted = 0',
      [Number(req.params.id), req.user.id]
    );
    if (!r.affectedRows) {
      return res.status(404).json({ message: 'Transaksi tidak ditemukan' });
    }
    return res.status(200).json({ message: 'Transaksi berhasil dihapus' });
  } catch (err) {
    next(err);
  }
};

/* ---------- GET /transactions/:id/attachments/:attachmentId ---------- */
// File bukti hanya bisa diambil pemilik transaksi (tidak ada folder uploads publik)
exports.getAttachment = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.file_path, a.file_type
       FROM attachments a
       JOIN transactions t ON t.id = a.transaction_id
       WHERE a.id = ? AND a.transaction_id = ? AND t.user_id = ? AND t.is_deleted = 0`,
      [Number(req.params.attachmentId), Number(req.params.id), req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Bukti tidak ditemukan' });

    // basename mencegah path traversal
    const file = path.join(UPLOAD_DIR, path.basename(rows[0].file_path));
    if (!fs.existsSync(file)) {
      return res.status(404).json({ message: 'File bukti tidak ditemukan di server' });
    }

    res.set({
      'Content-Type': rows[0].file_type,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=300',
    });
    return res.sendFile(file);
  } catch (err) {
    next(err);
  }
};

exports.SORTS = SORTS;
