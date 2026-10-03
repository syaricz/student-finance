const pool = require('../config/db');

const COLUMNS = 'id, user_id, name, icon, color, is_default, created_at';
const DEFAULT_COLOR = '#6B7280';

const format = (row) => ({
  id: row.id,
  user_id: row.user_id,
  name: row.name,
  icon: row.icon,
  color: row.color,
  is_default: Boolean(row.is_default),
  created_at: row.created_at,
});

// Kategori yang boleh dilihat user: default global (user_id NULL) + miliknya sendiri
async function findVisible(userId, id) {
  const [rows] = await pool.query(
    `SELECT ${COLUMNS} FROM categories WHERE id = ? AND (user_id IS NULL OR user_id = ?)`,
    [id, userId]
  );
  return rows[0] || null;
}

// Nama tidak boleh kembar dengan kategori default maupun kategori user sendiri
async function nameExists(userId, name, excludeId) {
  const [rows] = await pool.query(
    'SELECT id FROM categories WHERE (user_id IS NULL OR user_id = ?) AND name = ? AND id <> ? LIMIT 1',
    [userId, name, excludeId || 0]
  );
  return rows.length > 0;
}

const isLocked = (category) => Boolean(category.is_default) || category.user_id === null;

// GET /api/v1/categories
exports.getCategories = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT ${COLUMNS} FROM categories
       WHERE user_id IS NULL OR user_id = ?
       ORDER BY is_default DESC, id ASC`,
      [req.user.id]
    );
    return res.status(200).json(rows.map(format));
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/categories
exports.createCategory = async (req, res, next) => {
  try {
    const { name, icon, color } = req.body;

    if (await nameExists(req.user.id, name)) {
      return res.status(409).json({ message: 'Kategori dengan nama tersebut sudah ada' });
    }

    const [result] = await pool.query(
      'INSERT INTO categories (user_id, name, icon, color, is_default) VALUES (?, ?, ?, ?, FALSE)',
      [req.user.id, name, icon || null, color || DEFAULT_COLOR]
    );
    const [rows] = await pool.query(`SELECT ${COLUMNS} FROM categories WHERE id = ?`, [
      result.insertId,
    ]);
    return res.status(201).json(format(rows[0]));
  } catch (err) {
    next(err);
  }
};

// PUT /api/v1/categories/:id
exports.updateCategory = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, icon, color } = req.body;

    const category = await findVisible(req.user.id, id);
    if (!category) {
      return res.status(404).json({ message: 'Kategori tidak ditemukan' });
    }
    if (isLocked(category)) {
      return res.status(403).json({ message: 'Kategori default tidak dapat diubah' });
    }
    if (await nameExists(req.user.id, name, id)) {
      return res.status(409).json({ message: 'Kategori dengan nama tersebut sudah ada' });
    }

    const newIcon = icon === undefined ? category.icon : icon || null;
    const newColor = color || category.color;

    await pool.query('UPDATE categories SET name = ?, icon = ?, color = ? WHERE id = ? AND user_id = ?', [
      name,
      newIcon,
      newColor,
      id,
      req.user.id,
    ]);

    const [rows] = await pool.query(`SELECT ${COLUMNS} FROM categories WHERE id = ?`, [id]);
    return res.status(200).json(format(rows[0]));
  } catch (err) {
    next(err);
  }
};

// DELETE /api/v1/categories/:id
exports.deleteCategory = async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const category = await findVisible(req.user.id, id);
    if (!category) {
      return res.status(404).json({ message: 'Kategori tidak ditemukan' });
    }
    // Aturan bisnis #9: kategori default tidak dapat dihapus user
    if (isLocked(category)) {
      return res.status(403).json({ message: 'Kategori default tidak dapat dihapus' });
    }

    // Transaksi (termasuk yang di-soft delete) masih mengacu ke kategori ini lewat foreign key
    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) AS total FROM transactions WHERE category_id = ?',
      [id]
    );
    if (Number(total) > 0) {
      return res.status(409).json({
        message: 'Kategori masih dipakai oleh transaksi, jadi tidak dapat dihapus',
      });
    }

    await pool.query('DELETE FROM categories WHERE id = ? AND user_id = ?', [id, req.user.id]);
    return res.status(200).json({ message: 'Kategori berhasil dihapus' });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({
        message: 'Kategori masih dipakai oleh transaksi, jadi tidak dapat dihapus',
      });
    }
    next(err);
  }
};
