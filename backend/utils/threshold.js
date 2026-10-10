// Logika threshold anggaran + pembuatan notifikasi (Blueprint bagian 8 "Threshold Logic" dan 17)
//
// Tingkat notifikasi (dihitung dari pengeluaran bulan itu vs alokasi):
//   waspada       pemakaian sudah >= 70%   (peringatan dini, TC-10) sampai sekitar 90%
//   hampir_habis  di atas ~90%, belum 100%
//   habis         tepat 100%
//   melebihi      di atas 100%             (type budget_exceeded)
// Warna status di UI tetap memakai tabel Blueprint (lihat budgetStatus.js); perbedaannya hanya
// pada peringatan dini: tepat 70% masih "Aman" di warna, tetapi sudah memicu notifikasi pertama.
//
// Aturan bisnis #10: setiap tingkat hanya dinotifikasikan SEKALI per cakupan per bulan.
// Kunci unik = (user_id, related_id = id anggaran bulan itu, title). Title memuat tingkat + nama
// kategori, sehingga tiap kategori punya notifikasinya sendiri.

const pool = require('../config/db');
const { budgetStatus } = require('./budgetStatus');
const { toCents } = require('./validators');

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const percentText = (n) => n.toLocaleString('id-ID', { maximumFractionDigits: 1 });
const pad = (n) => String(n).padStart(2, '0');
const num = (v) => Number(v) || 0;

const LEVELS = {
  waspada: { type: 'budget_warning', title: 'Waspada' },
  hampir_habis: { type: 'budget_warning', title: 'Hampir Habis' },
  habis: { type: 'budget_warning', title: 'Anggaran Habis' },
  melebihi: { type: 'budget_exceeded', title: 'Anggaran Terlampaui' },
};

// Kebalikannya: dari awalan title ke tingkat (dipakai API notifikasi untuk memberi warna)
const LEVEL_BY_TITLE = Object.keys(LEVELS).reduce((acc, key) => {
  acc[LEVELS[key].title] = key;
  return acc;
}, {});
const levelFromTitle = (title) => LEVEL_BY_TITLE[String(title || '').split(' · ')[0]] || null;

/**
 * Tingkat notifikasi untuk pemakaian `used` dari anggaran `allocated`.
 * @returns {'waspada'|'hampir_habis'|'habis'|'melebihi'|null} null = belum perlu notifikasi
 */
function notificationLevel(used, allocated) {
  if (!(allocated > 0)) return null;
  const usedC = toCents(used);
  const allocC = toCents(allocated);

  if (usedC > allocC) return 'melebihi';
  if (usedC === allocC) return 'habis';

  const status = budgetStatus(used, allocated); // aman | waspada | hampir_habis
  if (status === 'hampir_habis' || status === 'waspada') return status;
  // Peringatan dini: tepat 70% (bilangan bulat, tanpa galat desimal) sudah dianggap "waspada"
  return usedC * 100 >= allocC * 70 ? 'waspada' : null;
}

function buildMessage(level, scopeText, period, used, allocated) {
  const amounts = `${rupiah.format(used)} dari ${rupiah.format(allocated)}`;
  const pct = percentText(Math.round((used / allocated) * 1000) / 10);
  switch (level) {
    case 'waspada':
      return `Pengeluaran ${scopeText} pada ${period} sudah ${pct}% dari anggaran (${amounts}). Hati-hati!`;
    case 'hampir_habis':
      return `Pengeluaran ${scopeText} pada ${period} sudah ${pct}% terpakai (${amounts}). Sisa ${rupiah.format(allocated - used)}.`;
    case 'habis':
      return `Anggaran ${scopeText} pada ${period} sudah habis (${amounts}).`;
    default:
      return `Pengeluaran ${scopeText} pada ${period} melebihi anggaran sebesar ${rupiah.format(used - allocated)} (${amounts}). Segera evaluasi.`;
  }
}

// Sisipkan notifikasi hanya jika belum ada (satu pernyataan SQL: cek + insert)
async function insertOnce(userId, budgetId, level, title, message) {
  const [r] = await pool.query(
    `INSERT INTO notifications (user_id, type, title, message, related_id)
     SELECT ?, ?, ?, ?, ? FROM (SELECT 1) AS d
     WHERE NOT EXISTS (
       SELECT 1 FROM notifications WHERE user_id = ? AND related_id = ? AND title = ?
     )`,
    [userId, LEVELS[level].type, title, message, budgetId, userId, budgetId, title]
  );
  return r.affectedRows > 0;
}

/**
 * Periksa threshold anggaran setelah sebuah transaksi dibuat/diubah, lalu buat notifikasi bila perlu.
 * Memeriksa dua cakupan: alokasi kategori transaksi itu, dan total anggaran bulan itu.
 * @param {number} userId
 * @param {number} categoryId
 * @param {string} dateStr tanggal transaksi 'YYYY-MM-DD' (menentukan bulan anggaran)
 * @returns {Promise<Array>} notifikasi yang BARU dibuat (kosong bila tidak ada)
 */
async function checkBudgetThreshold(userId, categoryId, dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr || '');
  if (!m) return [];
  const year = Number(m[1]);
  const month = Number(m[2]);

  const [budgets] = await pool.query(
    'SELECT id, total_amount FROM budgets WHERE user_id = ? AND month = ? AND year = ?',
    [userId, month, year]
  );
  if (!budgets.length) return []; // tidak ada anggaran bulan itu: tidak ada yang dipantau
  const budget = budgets[0];

  const last = new Date(year, month, 0).getDate();
  const start = `${year}-${pad(month)}-01`;
  const end = `${year}-${pad(month)}-${pad(last)}`;
  const period = `${MONTHS[month - 1]} ${year}`;
  const created = [];

  async function notify(scope, level, label, scopeText, used, allocated, catId) {
    const title = `${LEVELS[level].title} · ${label}`;
    const message = buildMessage(level, scopeText, period, used, allocated);
    if (await insertOnce(userId, budget.id, level, title, message)) {
      created.push({ scope, category_id: catId, level, type: LEVELS[level].type, title, message });
    }
  }

  // 1. Alokasi kategori transaksi ini
  const [bc] = await pool.query(
    `SELECT bc.allocated_amount AS allocated, c.name
     FROM budget_categories bc JOIN categories c ON c.id = bc.category_id
     WHERE bc.budget_id = ? AND bc.category_id = ?`,
    [budget.id, categoryId]
  );
  if (bc.length && num(bc[0].allocated) > 0) {
    const [[row]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS used FROM transactions
       WHERE user_id = ? AND category_id = ? AND type = 'expense' AND is_deleted = 0
         AND transaction_date >= ? AND transaction_date <= ?`,
      [userId, categoryId, start, end]
    );
    const used = num(row.used);
    const allocated = num(bc[0].allocated);
    const level = notificationLevel(used, allocated);
    if (level) await notify('category', level, bc[0].name, `kategori ${bc[0].name}`, used, allocated, categoryId);
  }

  // 2. Total anggaran bulan itu (semua kategori)
  const total = num(budget.total_amount);
  if (total > 0) {
    const [[row]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS used FROM transactions
       WHERE user_id = ? AND type = 'expense' AND is_deleted = 0
         AND transaction_date >= ? AND transaction_date <= ?`,
      [userId, start, end]
    );
    const used = num(row.used);
    const level = notificationLevel(used, total);
    if (level) await notify('total', level, 'Total anggaran', 'total', used, total, null);
  }

  return created;
}

module.exports = { checkBudgetThreshold, notificationLevel, levelFromTitle, LEVELS };
