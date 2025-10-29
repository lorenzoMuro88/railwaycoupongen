-- Aggiunge il campo expiry_date alla tabella campaigns per gestire la scadenza automatica
ALTER TABLE campaigns ADD COLUMN expiry_date DATETIME;
