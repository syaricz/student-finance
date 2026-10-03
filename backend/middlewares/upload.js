const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB
const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  // Nama file diganti acak: nama asli dari user tidak pernah dipakai di disk
  filename: (req, file, cb) =>
    cb(null, crypto.randomBytes(16).toString('hex') + EXT_BY_MIME[file.mimetype]),
});

const uploader = multer({
  storage,
  limits: { fileSize: MAX_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!EXT_BY_MIME[file.mimetype]) {
      const err = new Error('Bukti harus berformat JPG, PNG, atau PDF');
      err.code = 'INVALID_FILE_TYPE';
      return cb(err);
    }
    cb(null, true);
  },
}).single('attachment');

// Sinkron agar file sudah benar-benar hilang sebelum respons dikirim (jalur ini jarang dipakai)
function removeFile(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (e) {
    /* file sudah tidak ada: abaikan */
  }
}

// Deteksi tipe file dari isi (magic bytes), bukan dari header yang bisa dipalsukan
function detectType(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(8);
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

function reject(res, message) {
  return res.status(400).json({ message, errors: [{ field: 'attachment', message }] });
}

// Middleware: baca multipart (field file bernama "attachment"), validasi ukuran & tipe.
// Request JSON biasa dilewatkan apa adanya.
function upload(req, res, next) {
  uploader(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return reject(res, 'Ukuran bukti maksimal 2MB');
      if (err.code === 'INVALID_FILE_TYPE') return reject(res, err.message);
      if (err instanceof multer.MulterError) {
        return reject(res, 'Unggah gagal: kirim satu file pada field "attachment"');
      }
      return next(err);
    }
    if (req.file) {
      const detected = detectType(req.file.path);
      if (!detected || detected !== req.file.mimetype) {
        removeFile(req.file.path);
        return reject(res, 'Isi file tidak sesuai dengan format JPG, PNG, atau PDF');
      }
      req.file.detectedType = detected;
    }
    next();
  });
}

module.exports = { upload, removeFile, UPLOAD_DIR, MAX_SIZE };
