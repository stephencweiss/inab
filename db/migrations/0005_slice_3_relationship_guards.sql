CREATE TRIGGER budget_card_kind_insert BEFORE INSERT ON budget_categories
WHEN NEW.card_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id=NEW.card_account_id AND kind='credit')
BEGIN SELECT RAISE(ABORT,'credit account required'); END;
--> statement-breakpoint
CREATE TRIGGER budget_card_kind_update BEFORE UPDATE ON budget_categories
WHEN NEW.card_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id=NEW.card_account_id AND kind='credit')
BEGIN SELECT RAISE(ABORT,'credit account required'); END;
--> statement-breakpoint
CREATE TRIGGER budget_account_kind_update BEFORE UPDATE OF kind ON accounts
WHEN NEW.kind <> 'credit' AND EXISTS (SELECT 1 FROM budget_categories WHERE card_account_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'credit account required'); END;
--> statement-breakpoint
CREATE TRIGGER budget_transfer_membership_insert BEFORE INSERT ON budget_transfers
WHEN EXISTS (SELECT 1 FROM budget_transfers WHERE from_transaction_id IN (NEW.from_transaction_id,NEW.to_transaction_id) OR to_transaction_id IN (NEW.from_transaction_id,NEW.to_transaction_id))
OR EXISTS (SELECT 1 FROM budget_events WHERE transaction_id IN (NEW.from_transaction_id,NEW.to_transaction_id))
BEGIN SELECT RAISE(ABORT,'duplicate transfer membership'); END;
--> statement-breakpoint
CREATE TRIGGER budget_transfer_membership_update BEFORE UPDATE ON budget_transfers
WHEN EXISTS (SELECT 1 FROM budget_transfers WHERE id<>OLD.id AND (from_transaction_id IN (NEW.from_transaction_id,NEW.to_transaction_id) OR to_transaction_id IN (NEW.from_transaction_id,NEW.to_transaction_id)))
OR EXISTS (SELECT 1 FROM budget_events WHERE transaction_id IN (NEW.from_transaction_id,NEW.to_transaction_id))
BEGIN SELECT RAISE(ABORT,'duplicate transfer membership'); END;
--> statement-breakpoint
CREATE TRIGGER budget_event_membership_insert BEFORE INSERT ON budget_events
WHEN EXISTS (SELECT 1 FROM budget_transfers WHERE from_transaction_id=NEW.transaction_id OR to_transaction_id=NEW.transaction_id)
OR (NEW.transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transactions WHERE id=NEW.transaction_id AND account_id=NEW.account_id AND cents=NEW.cents))
BEGIN SELECT RAISE(ABORT,'invalid budget transaction link'); END;
--> statement-breakpoint
CREATE TRIGGER budget_event_membership_update BEFORE UPDATE ON budget_events
WHEN EXISTS (SELECT 1 FROM budget_transfers WHERE from_transaction_id=NEW.transaction_id OR to_transaction_id=NEW.transaction_id)
BEGIN SELECT RAISE(ABORT,'invalid budget transaction link'); END;
