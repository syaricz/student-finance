-- ============================================================
-- Student Finance - seed.sql
-- Jalankan SETELAH schema.sql:
--   mysql -u root -p student_finance < database/seed.sql
-- ============================================================
USE student_finance;

-- 9 kategori default (user_id NULL = global)
INSERT INTO categories (user_id, name, icon, color, is_default) VALUES
  (NULL, 'Makanan & Minuman', '🍔', '#F59E0B', TRUE),
  (NULL, 'Transportasi',      '🚌', '#3B82F6', TRUE),
  (NULL, 'Kos / Sewa',        '🏠', '#8B5CF6', TRUE),
  (NULL, 'Akademik',          '📚', '#10B981', TRUE),
  (NULL, 'Pulsa & Internet',  '📱', '#EC4899', TRUE),
  (NULL, 'Hiburan',           '🎬', '#F97316', TRUE),
  (NULL, 'Belanja',           '🛍️', '#EF4444', TRUE),
  (NULL, 'Kesehatan',         '💊', '#14B8A6', TRUE),
  (NULL, 'Lainnya',           '📦', '#6B7280', TRUE);

-- 4 payment methods
INSERT INTO payment_methods (name, is_default) VALUES
  ('Cash',     TRUE),
  ('Transfer', TRUE),
  ('E-Wallet', TRUE),
  ('Kartu',    TRUE);

-- 1 user admin default
-- Email   : admin@studentfinance.id
-- Password: Admin123!  (bcrypt cost 10) -> WAJIB diganti setelah login pertama
INSERT INTO users (name, email, password_hash, role) VALUES
  ('Admin Finance', 'admin@studentfinance.id',
   '$2b$10$McLSlQ26.VGM8kdkeQB5/.2ghO.YOLeF2jaTxBuNWjxp7vstvIVxS', 'admin');
