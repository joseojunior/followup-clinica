BEGIN;

CREATE TABLE IF NOT EXISTS followup.sender_dispatch_slots (
  sender_id uuid PRIMARY KEY REFERENCES followup.senders(id) ON DELETE CASCADE,
  next_available_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS sender_dispatch_slots_set_updated_at ON followup.sender_dispatch_slots;
CREATE TRIGGER sender_dispatch_slots_set_updated_at
  BEFORE UPDATE ON followup.sender_dispatch_slots
  FOR EACH ROW EXECUTE FUNCTION followup.set_updated_at();

COMMIT;
