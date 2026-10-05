const pool = require('../config/db');
const { budgetStatus } = require('../utils/budgetStatus');

/* ---------- Helper tanggal (tanpa konversi UTC) ---------- */
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// 'YYYY-MM-DD' -> Date lokal (jam 12 siang agar aman dari pergeseran DST)
const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const monthRange = (d) => ({
  start: fmt(new Date(d.getFullYear(), d.getMonth(), 1, 12)),
  end: fmt(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12)),
});

// "Hari ini" bisa dikirim client (?date=YYYY-MM-DD) agar tidak terpengaruh timezone server
const resolveToday = (req) => (req.query.date ? parse(req.query.date) : new Date());

const num = (v) => Number(v) || 0;
const round1 = (n) => Math.round(n * 10) / 10;

// Anggaran bulan tertentu milik user; null jika belum diatur / total 0
async function findBudget(userId, month, year) {
  const [rows] = await pool.query(
    'SELECT id, total_amount FROM budgets WHERE user_id = ? AND month = ? AND year = ?',
    [userId, month, year]
  );
  if (!rows.length || !(num(rows[0].total_amount) > 0)) return null;
  return { id: rows[0].id, total: num(rows[0].total_amount) };
}

// Pengeluaran per kategori dalam rentang tanggal (hanya transaksi belum dihapus)
async function spendingByCategory(userId, start, end) {
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.icon, c.color, SUM(t.amount) AS amount
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     WHERE t.user_id = ? AND t.is_deleted = 0 AND t.type = 'expense'
       AND t.transaction_date >= ? AND t.transaction_date <= ?
     GROUP BY c.id, c.name, c.icon, c.color
     ORDER BY amount DESC, c.id ASC`,
    [userId, start, end]
  );
  return rows.map((r) => ({
    category_id: r.id, name: r.name, icon: r.icon, color: r.color, amount: num(r.amount),
  }));
}

// Alokasi per kategori pada anggaran tertentu (hanya yang > 0)
async function allocations(budgetId) {
  const [rows] = await pool.query(
    `SELECT bc.category_id, bc.allocated_amount, c.name, c.icon, c.color
     FROM budget_categories bc
     JOIN categories c ON c.id = bc.category_id
     WHERE bc.budget_id = ? AND bc.allocated_amount > 0
     ORDER BY bc.category_id ASC`,
    [budgetId]
  );
  return rows.map((r) => ({
    category_id: r.category_id, name: r.name, icon: r.icon, color: r.color,
    allocated: num(r.allocated_amount),
  }));
}

/* ---------- GET /dashboard/summary ---------- */
exports.getSummary = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const today = resolveToday(req);
    const todayStr = fmt(today);
    const { start, end } = monthRange(today);
    const month = today.getMonth() + 1;
    const year = today.getFullYear();

    const [[agg]] = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS month_expense,
         COALESCE(SUM(CASE WHEN type = 'expense' AND transaction_date = ? THEN amount ELSE 0 END), 0) AS today_expense,
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS month_income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN 1 ELSE 0 END), 0) AS expense_count
       FROM transactions
       WHERE user_id = ? AND is_deleted = 0
         AND transaction_date >= ? AND transaction_date <= ?`,
      [todayStr, userId, start, end]
    );
    const monthExpense = num(agg.month_expense);

    const summary = {
      month,
      year,
      date: todayStr,
      total_expense_this_month: monthExpense,
      total_income_this_month: num(agg.month_income),
      expense_this_month: monthExpense, // sama dengan di atas, dipertahankan sesuai contoh Blueprint
      expense_today: num(agg.today_expense),
      transaction_count_this_month: num(agg.expense_count),
      budget_total: null,
      budget_remaining: null,
      budget_percentage: null,
      budget_status: null,
      alerts: [],
    };

    const budget = await findBudget(userId, month, year);
    if (budget) {
      summary.budget_total = budget.total;
      summary.budget_remaining = budget.total - monthExpense; // negatif jika sudah melebihi
      summary.budget_percentage = round1((monthExpense / budget.total) * 100);
      summary.budget_status = budgetStatus(monthExpense, budget.total);

      // Peringatan: total anggaran + tiap kategori yang statusnya bukan "aman"
      const alerts = [];
      if (summary.budget_status !== 'aman') {
        alerts.push({
          scope: 'total', category_id: null, name: 'Anggaran bulan ini', icon: null,
          allocated: budget.total, used: monthExpense,
          percentage: summary.budget_percentage, status: summary.budget_status,
        });
      }
      const [allocs, spent] = await Promise.all([
        allocations(budget.id),
        spendingByCategory(userId, start, end),
      ]);
      const spentMap = new Map(spent.map((s) => [s.category_id, s.amount]));
      allocs.forEach((a) => {
        const used = spentMap.get(a.category_id) || 0;
        const status = budgetStatus(used, a.allocated);
        if (status && status !== 'aman') {
          alerts.push({
            scope: 'category', category_id: a.category_id, name: a.name, icon: a.icon,
            allocated: a.allocated, used,
            percentage: round1((used / a.allocated) * 100), status,
          });
        }
      });
      // Urutan: status paling parah dulu; pada status yang sama, ringkasan total lebih dulu,
      // lalu persentase tertinggi
      const rank = { melebihi: 0, hampir_habis: 1, waspada: 2 };
      summary.alerts = alerts.sort(
        (a, b) =>
          rank[a.status] - rank[b.status] ||
          (a.scope === 'total' ? 0 : 1) - (b.scope === 'total' ? 0 : 1) ||
          b.percentage - a.percentage
      );
    }

    return res.status(200).json(summary);
  } catch (err) {
    next(err);
  }
};

/* ---------- GET /dashboard/chart?period=7d&type=line ---------- */
exports.getChartData = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const type = req.query.type || 'line';
    const period = req.query.period || (type === 'line' ? '7d' : 'month');
    const today = resolveToday(req);

    // Rentang tanggal per period
    let start;
    let end;
    if (period === '7d') {
      start = fmt(addDays(today, -6));
      end = fmt(today);
    } else if (period === '30d') {
      start = fmt(addDays(today, -29));
      end = fmt(today);
    } else {
      const m = monthRange(today);
      start = m.start;
      // Tren harian berhenti di hari ini; distribusi kategori mencakup sebulan penuh (sama dengan kartu ringkasan)
      end = type === 'line' ? fmt(today) : m.end;
    }

    /* --- Line: tren pengeluaran harian, hari tanpa transaksi bernilai 0 --- */
    if (type === 'line') {
      const [rows] = await pool.query(
        `SELECT transaction_date AS day, SUM(amount) AS amount
         FROM transactions
         WHERE user_id = ? AND is_deleted = 0 AND type = 'expense'
           AND transaction_date >= ? AND transaction_date <= ?
         GROUP BY transaction_date`,
        [userId, start, end]
      );
      const byDay = new Map(rows.map((r) => [String(r.day).slice(0, 10), num(r.amount)]));
      const labels = [];
      const values = [];
      for (let d = parse(start); fmt(d) <= end; d = addDays(d, 1)) {
        const key = fmt(d);
        labels.push(key);
        values.push(byDay.get(key) || 0);
      }
      return res.status(200).json({
        type, period, start_date: start, end_date: end,
        labels, values, total: values.reduce((s, v) => s + v, 0),
      });
    }

    /* --- Pie: distribusi pengeluaran per kategori --- */
    if (type === 'pie') {
      const items = await spendingByCategory(userId, start, end);
      const total = items.reduce((s, i) => s + i.amount, 0);
      return res.status(200).json({
        type, period, start_date: start, end_date: end,
        items: items.map((i) => ({ ...i, percentage: total > 0 ? round1((i.amount / total) * 100) : 0 })),
        total,
      });
    }

    /* --- Bar: anggaran vs realisasi per kategori (selalu bulan berjalan) --- */
    const m = monthRange(today);
    const month = today.getMonth() + 1;
    const year = today.getFullYear();
    const budget = await findBudget(userId, month, year);
    const [allocs, spent] = await Promise.all([
      budget ? allocations(budget.id) : [],
      spendingByCategory(userId, m.start, m.end),
    ]);

    // Gabungan: kategori yang dianggarkan DAN kategori yang ada pengeluarannya (agar pengeluaran tanpa anggaran tetap terlihat)
    const merged = new Map();
    allocs.forEach((a) => merged.set(a.category_id, { ...a, used: 0 }));
    spent.forEach((s) => {
      const row = merged.get(s.category_id) || {
        category_id: s.category_id, name: s.name, icon: s.icon, color: s.color, allocated: 0,
      };
      row.used = s.amount;
      merged.set(s.category_id, row);
    });
    const items = [...merged.values()]
      .map((r) => ({
        ...r,
        percentage: r.allocated > 0 ? round1((r.used / r.allocated) * 100) : null,
        status: budgetStatus(r.used, r.allocated),
      }))
      .sort((a, b) => b.allocated - a.allocated || b.used - a.used || a.category_id - b.category_id);

    return res.status(200).json({
      type, period: 'month', month, year, start_date: m.start, end_date: m.end,
      has_budget: Boolean(budget), budget_total: budget ? budget.total : null,
      items,
    });
  } catch (err) {
    next(err);
  }
};
