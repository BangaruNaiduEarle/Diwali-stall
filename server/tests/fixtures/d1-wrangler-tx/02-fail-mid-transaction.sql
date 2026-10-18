PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

INSERT INTO tx_probe (id, label) VALUES (1, 'first');

INSERT INTO tx_probe (id, label) VALUES (1, 'duplicate_pk');

COMMIT;
