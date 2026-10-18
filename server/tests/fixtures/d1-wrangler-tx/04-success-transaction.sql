PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

INSERT INTO tx_probe (id, label) VALUES (10, 'a');
INSERT INTO tx_probe (id, label) VALUES (11, 'b');
INSERT INTO tx_probe (id, label) VALUES (12, 'c');

COMMIT;
