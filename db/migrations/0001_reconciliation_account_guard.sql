CREATE TRIGGER reconciliation_entries_account_insert
BEFORE INSERT ON reconciliation_entries
WHEN (SELECT account_id FROM reconciliations WHERE id = NEW.reconciliation_id)
  IS NOT (SELECT account_id FROM transactions WHERE id = NEW.transaction_id)
BEGIN
  SELECT RAISE(ABORT, 'Reconciliation entry account mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER reconciliation_entries_account_update
BEFORE UPDATE OF reconciliation_id, transaction_id ON reconciliation_entries
WHEN (SELECT account_id FROM reconciliations WHERE id = NEW.reconciliation_id)
  IS NOT (SELECT account_id FROM transactions WHERE id = NEW.transaction_id)
BEGIN
  SELECT RAISE(ABORT, 'Reconciliation entry account mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER transactions_account_update
BEFORE UPDATE OF account_id ON transactions
WHEN EXISTS (SELECT 1 FROM reconciliation_entries e JOIN reconciliations r ON r.id = e.reconciliation_id
  WHERE e.transaction_id = OLD.id AND r.account_id IS NOT NEW.account_id)
BEGIN
  SELECT RAISE(ABORT, 'Reconciliation entry account mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER reconciliations_account_update
BEFORE UPDATE OF account_id ON reconciliations
WHEN EXISTS (SELECT 1 FROM reconciliation_entries e JOIN transactions t ON t.id = e.transaction_id
  WHERE e.reconciliation_id = OLD.id AND t.account_id IS NOT NEW.account_id)
BEGIN
  SELECT RAISE(ABORT, 'Reconciliation entry account mismatch');
END;
