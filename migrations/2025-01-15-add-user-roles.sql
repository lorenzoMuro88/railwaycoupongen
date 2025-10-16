-- Migrazione: Aggiunta ruoli utente
-- Data: 2025-01-15
-- Versione: 2025-01-15-user-roles

-- Aggiungi colonna role alla tabella users
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';

-- Aggiungi colonna permissions alla tabella users  
ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT '[]';

-- Crea indice per performance
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Aggiorna utenti esistenti
UPDATE users SET role = 'admin' WHERE username = 'admin';
