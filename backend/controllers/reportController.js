const pool = require('../config/db');

// Batas baris pada rincian laporan. Jika lebih banyak, `truncated: true` dan ringkasan tetap memakai angka lengkap.
const MAX_DETAIL_ROWS = 10000;

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const pad = (n) => String(n).padStart(2, '0');
const num = (v) => Number(v) || 0;
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

/* ---------- Tanggal (teks 'YYYY-MM-DD', tanpa konversi zona waktu) ---------- */
const parseDay = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
// Jumlah hari, kedua ujung dihitung (1 Jan - 31 Jan = 31 hari)
const daysInclusive = (from, to) => Math.round((parseDay(to) - parseDay(from)) / 86400000) + 1;

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ---------- Filter bersama ---------- */
// Laporan hanya memuat pengeluaran milik user yang belum dihapus. Rentang memakai BETWEEN (kedua ujung ikut).
function buildFilter(userId, start, end, categoryId) {
  const where = [
    't.user_id = ?',
    't.is_deleted = 0',
    "t.type = 'expense'",
    't.transaction_date BETWEEN ? AND ?',
  ];
  const params = [userId, start, end];
  if (categoryId) {
    where.push('t.category_id = ?');
    params.push(categoryId);
  }
  return { sql: where.join(' AND '), params };
}

const categoryIdOf = (req) => (req.query.category_id ? Number(req.query.category_id) : null);

/* ---------- GET /reports/summary?start_date&end_date[&category_id][&date] ---------- */
exports.getSummary = async (req, res, next) => {
  try {
    const start = req.query.start_date;
    const end = req.query.end_date;
    const categoryId = categoryIdOf(req);
    const today = req.query.date || todayLocal(); // "hari ini" menurut browser (opsional)
    const f = buildFilter(req.user.id, start, end, categoryId);

    const [[agg]] = await pool.query(
      `SELECT COALESCE(SUM(t.amount), 0) AS total, COUNT(*) AS cnt FROM transactions t WHERE ${f.sql}`,
      f.params
    );
    const total = round2(num(agg.total));

    // Kategori dengan pengeluaran terbesar pada rentang ini
    const [top] = await pool.query(
      `SELECT c.id, c.name, c.icon, c.color, SUM(t.amount) AS total
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE ${f.sql}
       GROUP BY c.id, c.name, c.icon, c.color
       ORDER BY total DESC, c.id ASC
       LIMIT 1`,
      f.params
    );

    // Rata-rata per hari = total / jumlah hari. Bila rentang berakhir di masa depan
    // (mis. "bulan ini" pada tanggal 10), hanya hari yang sudah berjalan yang dihitung.
    const daysInRange = daysInclusive(start, end);
    const effectiveEnd = end < today ? end : today;
    const daysElapsed = effectiveEnd >= start ? daysInclusive(start, effectiveEnd) : 0;

    return res.status(200).json({
      start_date: start,
      end_date: end,
      category_id: categoryId,
      total_expense: total,
      transaction_count: Number(agg.cnt),
      days_in_range: daysInRange,
      days_elapsed: daysElapsed,
      average_per_day: daysElapsed > 0 ? round2(total / daysElapsed) : 0,
      top_category: top.length
        ? {
            category_id: top[0].id,
            name: top[0].name,
            icon: top[0].icon,
            color: top[0].color,
            amount: round2(num(top[0].total)),
            percentage: total > 0 ? round1((num(top[0].total) / total) * 100) : 0,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
};

/* ---------- GET /reports/monthly?year=2025[&category_id] ---------- */
// Selalu 12 bulan (bulan tanpa pengeluaran bernilai 0) agar siap dipakai untuk tabel/grafik.
exports.getMonthlyReport = async (req, res, next) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const categoryId = categoryIdOf(req);
    const f = buildFilter(req.user.id, `${year}-01-01`, `${year}-12-31`, categoryId);

    const [rows] = await pool.query(
      `SELECT SUBSTR(t.transaction_date, 1, 7) AS ym, SUM(t.amount) AS total, COUNT(*) AS cnt
       FROM transactions t
       WHERE ${f.sql}
       GROUP BY ym`,
      f.params
    );
    const byMonth = new Map(rows.map((r) => [String(r.ym), r]));

    let yearTotal = 0;
    let yearCount = 0;
    const months = MONTHS.map((name, i) => {
      const r = byMonth.get(`${year}-${pad(i + 1)}`);
      const total = r ? round2(num(r.total)) : 0;
      const count = r ? Number(r.cnt) : 0;
      yearTotal += total;
      yearCount += count;
      return { month: i + 1, name, total, transaction_count: count };
    });

    return res.status(200).json({
      year,
      category_id: categoryId,
      total_expense: round2(yearTotal),
      transaction_count: yearCount,
      months,
    });
  } catch (err) {
    next(err);
  }
};

/* ---------- GET /reports/category?start_date&end_date[&category_id] ---------- */
exports.getCategoryReport = async (req, res, next) => {
  try {
    const start = req.query.start_date;
    const end = req.query.end_date;
    const categoryId = categoryIdOf(req);
    const f = buildFilter(req.user.id, start, end, categoryId);

    const [rows] = await pool.query(
      `SELECT c.id, c.name, c.icon, c.color, SUM(t.amount) AS total, COUNT(*) AS cnt
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE ${f.sql}
       GROUP BY c.id, c.name, c.icon, c.color
       ORDER BY total DESC, c.id ASC`,
      f.params
    );

    const grand = rows.reduce((s, r) => s + num(r.total), 0);
    return res.status(200).json({
      start_date: start,
      end_date: end,
      category_id: categoryId,
      total_expense: round2(grand),
      transaction_count: rows.reduce((s, r) => s + Number(r.cnt), 0),
      items: rows.map((r) => ({
        category_id: r.id,
        name: r.name,
        icon: r.icon,
        color: r.color,
        total: round2(num(r.total)),
        transaction_count: Number(r.cnt),
        percentage: grand > 0 ? round1((num(r.total) / grand) * 100) : 0,
      })),
    });
  } catch (err) {
    next(err);
  }
};

/* ---------- GET /reports/transactions?start_date&end_date[&category_id] ---------- */
// Rincian transaksi untuk tabel laporan dan ekspor. Memakai filter yang SAMA dengan summary/category
// (hanya pengeluaran, belum dihapus, BETWEEN), sehingga totalnya selalu cocok dengan ringkasan.
exports.getTransactionsDetail = async (req, res, next) => {
  try {
    const start = req.query.start_date;
    const end = req.query.end_date;
    const categoryId = categoryIdOf(req);
    const f = buildFilter(req.user.id, start, end, categoryId);

    const [[agg]] = await pool.query(
      `SELECT COALESCE(SUM(t.amount), 0) AS total, COUNT(*) AS cnt FROM transactions t WHERE ${f.sql}`,
      f.params
    );

    const [rows] = await pool.query(
      `SELECT t.id, t.transaction_date, t.description, t.notes, t.amount,
              c.id AS category_id, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
              pm.id AS payment_method_id, pm.name AS payment_method_name
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
       WHERE ${f.sql}
       ORDER BY t.transaction_date ASC, t.id ASC
       LIMIT ?`,
      [...f.params, MAX_DETAIL_ROWS]
    );

    const count = Number(agg.cnt);
    return res.status(200).json({
      start_date: start,
      end_date: end,
      category_id: categoryId,
      total_expense: round2(num(agg.total)),
      transaction_count: count,
      returned_count: rows.length,
      truncated: count > rows.length,
      max_rows: MAX_DETAIL_ROWS,
      data: rows.map((r) => ({
        id: r.id,
        transaction_date: r.transaction_date,
        description: r.description,
        notes: r.notes,
        amount: round2(num(r.amount)),
        category: { id: r.category_id, name: r.category_name, icon: r.category_icon, color: r.category_color },
        payment_method: r.payment_method_id ? { id: r.payment_method_id, name: r.payment_method_name } : null,
      })),
    });
  } catch (err) {
    next(err);
  }
};
