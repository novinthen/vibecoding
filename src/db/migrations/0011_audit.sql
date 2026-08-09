-- Migration 0011 — AdminAuditLog: editorial/administrative change history.
--
-- Records important editorial and admin actions (Story merge/split, summary
-- correction, source authority change, source disable, alias change, editorial
-- boost, ...). The target is polymorphic (target_type + target_id) and there are
-- deliberately NO foreign keys to targets: audit rows must survive even after the
-- objects they describe are removed. This log is never cascaded.

CREATE TABLE admin_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid,
  actor_identifier text,
  action      text NOT NULL,
  target_type text,
  target_id   uuid,
  before      jsonb,
  after       jsonb,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Access path: audit trail for a specific target object.
CREATE INDEX admin_audit_log_target_idx ON admin_audit_log (target_type, target_id);
CREATE INDEX admin_audit_log_created_at_idx ON admin_audit_log (created_at DESC);
