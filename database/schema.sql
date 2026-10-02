-- ============================================================
-- Student Finance - schema.sql
-- Jalankan: mysql -u root -p < database/schema.sql
-- ============================================================
CREATE DATABASE IF NOT EXISTS student_finance
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE student_finance;

-- 7.1 users
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('user','admin') NOT NULL DEFAULT 'user',
  avatar_url    VARCHAR(255) NULL DEFAULT NULL,
  currency      VARCHAR(10) NOT NULL DEFAULT 'IDR',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

-- 7.2 categories (user_id NULL = kategori default global)
CREATE TABLE IF NOT EXISTS categories (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NULL DEFAULT NULL,
  name       VARCHAR(100) NOT NULL,
  icon       VARCHAR(50) NULL DEFAULT NULL,
  color      VARCHAR(20) NULL DEFAULT '#6B7280',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_categories_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 7.3 payment_methods
CREATE TABLE IF NOT EXISTS payment_methods (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(50) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- 7.4 transactions
CREATE TABLE IF NOT EXISTS transactions (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED NOT NULL,
  category_id       BIGINT UNSIGNED NOT NULL,
  payment_method_id BIGINT UNSIGNED NULL DEFAULT NULL,
  type              ENUM('expense','income') NOT NULL DEFAULT 'expense',
  amount            DECIMAL(15,2) NOT NULL,
  description       VARCHAR(255) NOT NULL,
  notes             TEXT NULL,
  transaction_date  DATE NOT NULL,
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tx_user_date (user_id, transaction_date),
  KEY idx_tx_user_category (user_id, category_id),
  CONSTRAINT fk_tx_user     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tx_category FOREIGN KEY (category_id) REFERENCES categories(id),
  CONSTRAINT fk_tx_payment  FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE SET NULL,
  CONSTRAINT chk_tx_amount  CHECK (amount > 0)
) ENGINE=InnoDB;

-- 7.5 attachments
CREATE TABLE IF NOT EXISTS attachments (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  transaction_id BIGINT UNSIGNED NOT NULL,
  file_path      VARCHAR(255) NOT NULL,
  file_type      VARCHAR(50) NOT NULL,
  file_size      INT NOT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_att_tx FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 7.6 budgets
CREATE TABLE IF NOT EXISTS budgets (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  month        TINYINT NOT NULL,
  year         SMALLINT NOT NULL,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_budget_user_month_year (user_id, month, year),
  CONSTRAINT fk_budget_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_budget_month CHECK (month BETWEEN 1 AND 12)
) ENGINE=InnoDB;

-- 7.7 budget_categories
CREATE TABLE IF NOT EXISTS budget_categories (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  budget_id        BIGINT UNSIGNED NOT NULL,
  category_id      BIGINT UNSIGNED NOT NULL,
  allocated_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bc_budget_category (budget_id, category_id),
  CONSTRAINT fk_bc_budget   FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE,
  CONSTRAINT fk_bc_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 7.8 notifications
CREATE TABLE IF NOT EXISTS notifications (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  type       ENUM('budget_warning','budget_exceeded','reminder','monthly_summary') NOT NULL,
  title      VARCHAR(150) NOT NULL,
  message    TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  related_id BIGINT UNSIGNED NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notif_user_read (user_id, is_read),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 7.9 audit_logs (opsional)
CREATE TABLE IF NOT EXISTS audit_logs (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NULL DEFAULT NULL,
  action     VARCHAR(100) NOT NULL,
  entity     VARCHAR(50) NOT NULL,
  entity_id  BIGINT UNSIGNED NULL DEFAULT NULL,
  old_value  JSON NULL,
  new_value  JSON NULL,
  ip_address VARCHAR(45) NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
