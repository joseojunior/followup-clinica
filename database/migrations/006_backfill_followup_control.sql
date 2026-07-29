-- Retroalimenta apenas envios comprovados no histórico próprio.
BEGIN;

WITH sent_summary AS (
  SELECT e.lead_id,
    COUNT(*)::int AS sent_count,
    MAX(m.sent_at) AS last_sent_at
  FROM followup.messages m
  JOIN followup.enrollments e ON e.id = m.enrollment_id
  WHERE m.state = 'sent' AND e.lead_id IS NOT NULL
  GROUP BY e.lead_id
), last_sent AS (
  SELECT DISTINCT ON (e.lead_id) e.lead_id, m.id AS message_id
  FROM followup.messages m
  JOIN followup.enrollments e ON e.id = m.enrollment_id
  WHERE m.state = 'sent' AND e.lead_id IS NOT NULL
  ORDER BY e.lead_id, m.sent_at DESC, m.created_at DESC
)
UPDATE followup.lead_followup_control control
SET followup_count = summary.sent_count,
  control_stage = GREATEST(control.control_stage, summary.sent_count),
  last_followup_at = summary.last_sent_at,
  last_message_id = latest.message_id
FROM sent_summary summary
JOIN last_sent latest ON latest.lead_id = summary.lead_id
WHERE control.lead_id = summary.lead_id;

WITH latest_enrollment AS (
  SELECT DISTINCT ON (lead_id) lead_id, state, next_send_at, completed_at
  FROM followup.enrollments
  WHERE lead_id IS NOT NULL
  ORDER BY lead_id, created_at DESC
)
UPDATE followup.lead_followup_control control
SET control_status = CASE enrollment.state
    WHEN 'active' THEN 'in_progress'
    WHEN 'completed' THEN 'completed'
    WHEN 'paused' THEN 'paused'
    WHEN 'blocked' THEN 'blocked'
    ELSE control.control_status
  END,
  next_followup_at = enrollment.next_send_at,
  completed_at = enrollment.completed_at
FROM latest_enrollment enrollment
WHERE control.lead_id = enrollment.lead_id;

COMMIT;
