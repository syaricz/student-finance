require('dotenv').config();
const app = require('./app');
const { testConnection } = require('./config/db');

const PORT = process.env.PORT || 3000;

if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET belum diisi di file .env');
  process.exit(1);
}

(async () => {
  await testConnection();
  app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
  });
})();
