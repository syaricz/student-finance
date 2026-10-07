// Validator uang yang dipakai bersama (transaksi, anggaran).
// Aturan: wajib, angka, > 0, maksimal 2 desimal, muat di DECIMAL(15,2).

const MAX_MONEY = 9999999999999.99;

/**
 * Untuk express-validator: body('amount').custom(validateMoney('Nominal'))
 * @param {string} label nama field pada pesan error
 */
function validateMoney(label) {
  return function (value) {
    if (value === undefined || value === null || String(value).trim() === '') {
      throw new Error(`${label} wajib diisi`);
    }
    const s = String(value).trim();
    const n = Number(s);
    if (!Number.isFinite(n)) throw new Error(`${label} harus berupa angka`);
    if (n <= 0) throw new Error(`${label} harus lebih dari 0`);
    if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`${label} maksimal 2 angka desimal`);
    if (n > MAX_MONEY) throw new Error(`${label} terlalu besar`);
    return true;
  };
}

// Rupiah -> sen (bilangan bulat), supaya penjumlahan tidak terkena galat desimal (0.1 + 0.2)
const toCents = (v) => Math.round(Number(String(v).trim()) * 100);

module.exports = { validateMoney, toCents, MAX_MONEY };
