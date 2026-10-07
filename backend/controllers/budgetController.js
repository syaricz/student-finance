const pool = require('../config/db');
const { budgetStatus } = require('../utils/budgetStatus');
const { toCents } = require('../utils/validators');

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 2 });

const pad = (n) => String(n).padStart(2, '0');
const round1 = (n) => Math.round(n * 10) / 10;
const num = (v) => Number(v) || 0;

// Rentang tanggal sebuah bulan sebagai teks 'YYYY-MM-DD' (tanpa konversi zona waktu)
function monthRange(month, year) {
  const last = new Date(year, month, 0).getDate();
  return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(last)}` };
}

const validationError = (res, field, message) =>
  res.status(400).json({ message: 'Validasi gagal', errors: [{ field, message }] });

const BUDGET_COLUMNS = 'id, user_id, month, year, total_amount, created_at, updated_at';

/* ---------- Bentuk respons: anggaran + realisasi ---------- */
async function hydrate(row) {
  const { start, end } = monthRange(row.month, row.year);

  // Realisasi per kategori yang dianggarkan (hanya pengeluaran, belum dihapus, dalam bulan itu)
  const [cats] = await pool.query(
    `SELECT bc.category_id, c.name, c.icon, c.color, bc.allocated_amount AS allocated,
            COALESCE((SELECT SUM(t.amount) FROM transactions t
                      WHERE t.user_id = ? AND t.category_id = bc.category_id AND t.type = 'expense'
                        AND t.is_deleted = 0 AND t.transaction_date >= ? AND t.transaction_date <= ?), 0) AS used
     FROM budget_categories bc
     JOIN categories c ON c.id = bc.category_id
     WHERE bc.budget_id = ?
     ORDER BY bc.category_id ASC`,
    [row.user_id, start, end, row.id]
  );

  // Total pengeluaran bulan itu, termasuk kategori yang tidak punya alokasi
  const [[agg]] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS used FROM transactions
     WHERE user_id = ? AND type = 'expense' AND is_deleted = 0
       AND transaction_date >= ? AND transaction_date <= ?`,
    [row.user_id, start, end]
  );

  const total = num(row.total_amount);
  const totalUsed = num(agg.used);
  const totalCents = toCents(total);

  let allocatedCents = 0;
  let usedInAllocated = 0;
  const categories = cats.map((r) => {
    const allocated = num(r.allocated);
    const used = num(r.used);
    allocatedCents += toCents(allocated);
    usedInAllocated += used;
    return {
      category_id: r.category_id,
      name: r.name,
      icon: r.icon,
      color: r.color,
      allocated,
      used,
      remaining: (toCents(allocated) - toCents(used)) / 100, // negatif bila melebihi
      percentage: allocated > 0 ? round1((used / allocated) * 100) : null,
      status: budgetStatus(used, allocated),
    };
  });

  return {
    id: row.id,
    month: row.month,
    year: row.year,
    total_amount: total,
    total_used: totalUsed,
    remaining: (totalCents - toCents(totalUsed)) / 100,
    percentage: total > 0 ? round1((totalUsed / total) * 100) : null,
    status: budgetStatus(totalUsed, total),
    allocated_total: allocatedCents / 100,
    unallocated: (totalCents - allocatedCents) / 100, // bagian anggaran yang belum dibagi ke kategori
    unbudgeted_used: Math.max(0, (toCents(totalUsed) - toCents(usedInAllocated)) / 100), // belanja di kategori tanpa alokasi
    categories,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function findByMonth(userId, month, year) {
  const [rows] = await pool.query(
    `SELECT ${BUDGET_COLUMNS} FROM budgets WHERE user_id = ? AND month = ? AND year = ?`,
    [userId, month, year]
  );
  return rows[0] || null;
}

async function findOwned(userId, id) {
  const [rows] = await pool.query(`SELECT ${BUDGET_COLUMNS} FROM budgets WHERE id = ? AND user_id = ?`, [id, userId]);
  return rows[0] || null;
}

/* ---------- Validasi alokasi (aturan bisnis #11 dan #12) ---------- */
async function checkAllocations(userId, totalAmount, categories) {
  const list = Array.isArray(categories) ? categories : [];

  const seen = new Set();
  for (let i = 0; i < list.length; i += 1) {
    const id = Number(list[i].category_id);
    if (seen.has(id)) {
      return { field: `categories[${i}].category_id`, message: 'Kategori yang sama tidak boleh dialokasikan dua kali' };
    }
    seen.add(id);
  }

  if (list.length) {
    const ids = [...seen];
    const [rows] = await pool.query(
      `SELECT id FROM categories WHERE id IN (${ids.map(() => '?').join(',')}) AND (user_id IS NULL OR user_id = ?)`,
      [...ids, userId]
    );
    const valid = new Set(rows.map((r) => Number(r.id)));
    const badIndex = list.findIndex((c) => !valid.has(Number(c.category_id)));
    if (badIndex >= 0) {
      return { field: `categories[${badIndex}].category_id`, message: 'Kategori tidak valid' };
    }
  }

  // Total alokasi tidak boleh melebihi total anggaran (dihitung dalam sen agar tepat)
  const totalCents = toCents(totalAmount);
  const allocatedCents = list.reduce((sum, c) => sum + toCents(c.allocated_amount), 0);
  if (allocatedCents > totalCents) {
    return {
      field: 'categories',
      message: `Total alokasi kategori (${rupiah.format(allocatedCents / 100)}) melebihi total anggaran (${rupiah.format(totalCents / 100)})`,
    };
  }
  return null;
}

async function insertAllocations(conn, budgetId, categories) {
  for (const c of categories || []) {
    await conn.query(
      'INSERT INTO budget_categories (budget_id, category_id, allocated_amount) VALUES (?, ?, ?)',
      [budgetId, Number(c.category_id), String(c.allocated_amount).trim()]
    );
  }
}

/* ---------- GET /budgets?month=&year= ---------- */
// Belum ada anggaran untuk bulan itu -> 200 dengan body null (keadaan normal, bukan error)
exports.getBudget = async (req, res, next) => {
  try {
    const now = new Date();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const year = Number(req.query.year) || now.getFullYear();

    const row = await findByMonth(req.user.id, month, year);
    return res.status(200).json(row ? await hydrate(row) : null);
  } catch (err) {
    next(err);
  }
};

/* ---------- POST /budgets ---------- */
exports.createBudget = async (req, res, next) => {
  let conn;
  try {
    const userId = req.user.id;
    const month = Number(req.body.month);
    const year = Number(req.body.year);
    const { total_amount: total, categories } = req.body;

    if (await findByMonth(userId, month, year)) {
      return res.status(409).json({
        message: `Anggaran ${MONTHS[month - 1]} ${year} sudah ada. Ubah lewat edit anggaran.`,
      });
    }
    const bad = await checkAllocations(userId, total, categories);
    if (bad) return validationError(res, bad.field, bad.message);

    conn = await pool.getConnection();
    let id;
    try {
      await conn.beginTransaction();
      const [r] = await conn.query(
        'INSERT INTO budgets (user_id, month, year, total_amount) VALUES (?, ?, ?, ?)',
        [userId, month, year, String(total).trim()]
      );
      id = r.insertId;
      await insertAllocations(conn, id, categories);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    }

    return res.status(201).json(await hydrate(await findOwned(userId, id)));
  } catch (err) {
    // Dua permintaan bersamaan untuk bulan yang sama: unique (user_id, month, year) menolak yang kedua
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Anggaran untuk bulan tersebut sudah ada' });
    }
    next(err);
  } finally {
    if (conn) conn.release();
  }
};

/* ---------- PUT /budgets/:id ---------- */
// Mengganti total dan seluruh alokasi kategori. Bulan & tahun tidak dapat diubah.
exports.updateBudget = async (req, res, next) => {
  let conn;
  try {
    const userId = req.user.id;
    const id = Number(req.params.id);
    const { total_amount: total, categories } = req.body;

    const existing = await findOwned(userId, id);
    if (!existing) return res.status(404).json({ message: 'Anggaran tidak ditemukan' });

    if (req.body.month && Number(req.body.month) !== existing.month) {
      return validationError(res, 'month', 'Bulan anggaran tidak dapat diubah');
    }
    if (req.body.year && Number(req.body.year) !== existing.year) {
      return validationError(res, 'year', 'Tahun anggaran tidak dapat diubah');
    }

    const bad = await checkAllocations(userId, total, categories);
    if (bad) return validationError(res, bad.field, bad.message);

    conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        'UPDATE budgets SET total_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
        [String(total).trim(), id, userId]
      );
      await conn.query('DELETE FROM budget_categories WHERE budget_id = ?', [id]);
      await insertAllocations(conn, id, categories);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    }

    return res.status(200).json(await hydrate(await findOwned(userId, id)));
  } catch (err) {
    next(err);
  } finally {
    if (conn) conn.release();
  }
};

/* ---------- DELETE /budgets/:id ---------- */
// Alokasi kategori ikut terhapus; transaksi tidak terpengaruh.
exports.deleteBudget = async (req, res, next) => {
  let conn;
  try {
    const userId = req.user.id;
    const id = Number(req.params.id);

    if (!(await findOwned(userId, id))) {
      return res.status(404).json({ message: 'Anggaran tidak ditemukan' });
    }

    conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM budget_categories WHERE budget_id = ?', [id]);
      await conn.query('DELETE FROM budgets WHERE id = ? AND user_id = ?', [id, userId]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    }
    return res.status(200).json({ message: 'Anggaran berhasil dihapus' });
  } catch (err) {
    next(err);
  } finally {
    if (conn) conn.release();
  }
};
