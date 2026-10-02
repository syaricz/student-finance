# Student Finance

Sistem Informasi Pencatatan dan Manajemen Pengeluaran Keuangan Mahasiswa Berbasis Web.

> "Kelola Uang Saku, Kendalikan Masa Depan."

## Tech Stack
- Frontend: HTML5 + Bootstrap 5 (CDN) + Vanilla JavaScript (ES6)
- Backend: Node.js + Express
- Database: MySQL / MariaDB (mysql2)
- Auth: JWT + bcryptjs
- Chart & Export: Chart.js, jsPDF + jspdf-autotable, SheetJS

## Struktur Folder
```
student-finance/
├── backend/     # REST API (Node.js + Express)
├── frontend/    # Halaman HTML, CSS, JS
├── database/    # schema.sql, seed.sql
├── docs/        # API.md, ERD.png, USER_GUIDE.md, DEPLOYMENT.md
├── .gitignore
└── README.md
```

## Cara Menjalankan (diisi seiring pengembangan)
1. Backend: `cd backend && npm install && npm run dev`
2. Database: import `database/schema.sql` lalu `database/seed.sql`
3. Frontend: buka `frontend/index.html` dengan Live Server

## Backup Manual
Snapshot kode disalin ke folder backup (Google Drive/OneDrive) di akhir setiap fase.
Format nama: `student-finance_fase-X_YYYY-MM-DD`

## Catatan Perubahan (Changelog)
| Tanggal | Fase | Perubahan |
|---------|------|-----------|
| _isi tanggal_ | 0.2 | Struktur folder lokal dibuat |
