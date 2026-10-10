const pool = require('../config/db');
const { levelFromTitle } = require('../utils/threshold');

// created_at memakai zona waktu database (tanpa keterangan zona). Agar umur notifikasi benar di mana pun
// server berada, umur dihitung dari selisih dengan CURRENT_TIMESTAMP database pada query yang sama.
const parseDb = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
};

const SELECT = `SELECT id, type, title, message, is_read, related_id, created_at, CURRENT_TIMESTAMP AS server_now
                FROM notifications`;

const format = (r) => {
  const age = (parseDb(r.server_now) - parseDb(r.created_at)) / 1000;
  return {
    id: r.id,
    type: r.type,
    level: levelFromTitle(r.title), // waspada | hampir_habis | habis | melebihi | null
    title: r.title,
    message: r.message,
    is_read: Boolean(r.is_read),
    related_id: r.related_id,
    created_at: r.created_at,
    age_seconds: Number.isFinite(age) ? Math.max(0, Math.round(age)) : 0,
  };
};

async function unreadCount(userId) {
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND is_read = 0',
    [userId]
  );
  return Number(row.total);
}

/* ---------- GET /notifications?unread=1&page=&limit= ---------- */
exports.getNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const onlyUnread = ['1', 'true'].includes(String(req.query.unread));

    const where = 'WHERE user_id = ?' + (onlyUnread ? ' AND is_read = 0' : '');
    const [[agg]] = await pool.query(`SELECT COUNT(*) AS total FROM notifications ${where}`, [userId]);
    const total = Number(agg.total);

    const [rows] = await pool.query(
      `${SELECT} ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [userId, limit, (page - 1) * limit]
    );

    return res.status(200).json({
      data: rows.map(format),
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
      unread_count: await unreadCount(userId),
    });
  } catch (err) {
    next(err);
  }
};

/* ---------- PUT /notifications/:id/read ---------- */
// Idempoten: menandai notifikasi yang sudah dibaca tetap berhasil.
exports.markAsRead = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const id = Number(req.params.id);

    const [rows] = await pool.query('SELECT id FROM notifications WHERE id = ? AND user_id = ?', [id, userId]);
    if (!rows.length) return res.status(404).json({ message: 'Notifikasi tidak ditemukan' });

    await pool.query('UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?', [id, userId]);
    return res.status(200).json({ id, is_read: true, unread_count: await unreadCount(userId) });
  } catch (err) {
    next(err);
  }
};

/* ---------- PUT /notifications/read-all ---------- */
exports.markAllAsRead = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [r] = await pool.query('UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = 0', [userId]);
    return res.status(200).json({ updated: r.affectedRows, unread_count: 0 });
  } catch (err) {
    next(err);
  }
};
