// Status penggunaan anggaran (Blueprint bagian 4.E "Threshold")
//   0-70%   : aman
//   71-90%  : waspada
//   91-100% : hampir_habis
//   > 100%  : melebihi
// Dipakai dashboard sekarang, dan akan dipakai logika notifikasi di langkah 2.4.

const STATUS_LABELS = {
  aman: 'Aman',
  waspada: 'Waspada',
  hampir_habis: 'Hampir Habis',
  melebihi: 'Melebihi Anggaran',
};

// Warna sesuai Design System
const STATUS_COLORS = {
  aman: '#108981',
  waspada: '#F59E0B',
  hampir_habis: '#F97316',
  melebihi: '#EF4444',
};

/**
 * @param {number} used      pengeluaran terpakai
 * @param {number} allocated anggaran (harus > 0)
 * @returns {string|null}    kunci status, atau null jika anggaran tidak valid
 */
function budgetStatus(used, allocated) {
  if (!(allocated > 0)) return null;
  // "Melebihi" ditentukan dari angka sebenarnya, bukan angka yang dibulatkan
  if (used > allocated) return 'melebihi';
  // Batas lain memakai persentase bulat, sama seperti yang ditampilkan ke user
  const rounded = Math.round((used / allocated) * 100);
  if (rounded >= 91) return 'hampir_habis';
  if (rounded >= 71) return 'waspada';
  return 'aman';
}

module.exports = { budgetStatus, STATUS_LABELS, STATUS_COLORS };
