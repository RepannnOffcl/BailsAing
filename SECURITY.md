# Security

Jangan commit folder `auth/` ke Git. Credential/session state setara dengan secret akses akun dan harus diperlakukan seperti private key.

Aktifkan log minimal di production dan jangan mencetak isi session, identity key, Signal key, atau plaintext message.

Untuk laporan vulnerability, buka issue privat melalui mekanisme keamanan repository yang lu pakai sebelum publish npm.
