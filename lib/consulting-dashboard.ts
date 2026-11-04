import "server-only";
import { getFollowupPool } from "@/lib/followup-db";
import type { ConsultingDashboard, DashboardFilters } from "@/lib/consulting-dashboard-core";

// Aggregate the complete period in SQL, not the 100-row settings preview. Never select identity secrets.
export const consultingDashboardSql=`WITH base AS MATERIALIZED (
  SELECT e.id,e.unit,e.event_type,e.occurred_at,e.chat_hash,e.value,
    (e.is_synthetic OR e.test_state<>'new') AS is_test,
    CASE WHEN e.event_type IN ('payment_pending','payment_confirmed') THEN 'internal'
      WHEN e.is_synthetic OR e.test_state<>'new' THEN CASE WHEN e.test_state='new' THEN 'test_ready' ELSE e.test_state END
      ELSE e.production_state END AS state,
    CASE WHEN e.is_synthetic OR e.test_state<>'new' THEN e.test_result ELSE e.production_result END AS result,
    CASE WHEN e.is_synthetic OR e.test_state<>'new' THEN CASE WHEN e.test_state='new' THEN 0 ELSE 1 END ELSE e.production_attempts END AS attempts,
    i.encrypted_ctwa IS NOT NULL AS has_ctwa,i.source_id,COALESCE(i.attribution,'{}'::jsonb) AS attribution,
    (e.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS day
  FROM followup.consulting_meta_events e
  JOIN followup.consulting_meta_events i ON i.id=COALESCE(e.conversation_id,e.id) AND i.unit=e.unit
  WHERE ($1='all' OR e.unit=$1)
    AND e.occurred_at>=(((now() AT TIME ZONE 'America/Sao_Paulo')::date-($2::int-1))::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND e.occurred_at<=now()
    AND CASE WHEN $3='tests' THEN e.is_synthetic OR e.test_state<>'new' ELSE NOT e.is_synthetic AND e.test_state='new' END
), filtered AS MATERIALIZED (
  SELECT * FROM base WHERE ($4='all' OR
    ($4='accepted' AND state='accepted') OR ($4='pending' AND state IN ('queued','preparing','sending','test_ready')) OR
    ($4='attention' AND state IN ('failed','unknown')) OR ($4='no_ctwa' AND NOT has_ctwa) OR
    ($4='excluded' AND state='excluded') OR ($4='internal' AND state='internal'))
    AND ($5='all' OR event_type=$5) AND ($6='' OR day::text=$6)
    AND ($7='' OR strpos(lower(id::text),lower($7))>0 OR strpos(substr(chat_hash,1,8),lower($7))>0 OR strpos(COALESCE(source_id,''),$7)>0)
), daily_counts AS (
  SELECT day,count(*)::int AS received,count(*) FILTER(WHERE state='accepted')::int AS accepted,
    count(*) FILTER(WHERE state IN ('failed','unknown'))::int AS attention FROM base GROUP BY day
), daily AS (
  SELECT d.day::date::text AS day,COALESCE(c.received,0) AS received,COALESCE(c.accepted,0) AS accepted,COALESCE(c.attention,0) AS attention
  FROM generate_series((now() AT TIME ZONE 'America/Sao_Paulo')::date-($2::int-1),(now() AT TIME ZONE 'America/Sao_Paulo')::date,interval '1 day') d(day)
  LEFT JOIN daily_counts c ON c.day=d.day::date ORDER BY d.day
), stages AS (
  SELECT event_type AS stage,count(*)::int AS events,count(DISTINCT (unit,chat_hash))::int AS conversations FROM base GROUP BY event_type
), campaigns AS (
  SELECT unit,source_id AS "sourceId",attribution->>'utm_campaign' AS campaign,count(*)::int AS events,
    count(*) FILTER(WHERE state='accepted')::int AS accepted FROM base GROUP BY unit,source_id,attribution->>'utm_campaign' ORDER BY events DESC,unit,source_id NULLS LAST,campaign NULLS LAST LIMIT 8
), unit_counts AS (
  SELECT unit,count(*)::int AS received,count(*) FILTER(WHERE state='accepted')::int AS accepted,
    count(*) FILTER(WHERE state IN ('failed','unknown'))::int AS attention FROM base GROUP BY unit
), units AS (
  SELECT s.unit,s.production_enabled,s.production_enabled_at,COALESCE(c.received,0) AS received,COALESCE(c.accepted,0) AS accepted,COALESCE(c.attention,0) AS attention
  FROM followup.consulting_meta_settings s LEFT JOIN unit_counts c USING(unit) ORDER BY s.unit
), page AS (
  SELECT id,unit,event_type,occurred_at,substr(chat_hash,1,8) AS reference,value::text,state,is_test,has_ctwa,attempts,source_id,attribution,result
  FROM filtered ORDER BY occurred_at DESC,id DESC LIMIT 25 OFFSET $8::int
)
SELECT jsonb_build_object('updatedAt',now(),
  'summary',(SELECT jsonb_build_object('received',count(*),'accepted',count(*) FILTER(WHERE state='accepted'),
    'pending',count(*) FILTER(WHERE state IN ('queued','preparing','sending','test_ready')),'attention',count(*) FILTER(WHERE state IN ('failed','unknown')),
    'excluded',count(*) FILTER(WHERE state='excluded'),'noCtwa',count(*) FILTER(WHERE NOT has_ctwa),
    'purchaseValue',COALESCE(sum(value) FILTER(WHERE event_type='appointment_confirmed' AND state='accepted'),0)) FROM base),
  'daily',(SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY day),'[]'::jsonb) FROM daily d),
  'stages',(SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM stages s),
  'campaigns',(SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY events DESC,unit,"sourceId",campaign),'[]'::jsonb) FROM campaigns c),
  'units',(SELECT COALESCE(jsonb_agg(to_jsonb(u) ORDER BY unit),'[]'::jsonb) FROM units u),
  'total',(SELECT count(*) FROM filtered),'events',(SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY occurred_at DESC,id DESC),'[]'::jsonb) FROM page p)) AS data`;

export async function consultingDashboard(filters:DashboardFilters):Promise<ConsultingDashboard> {
  const {unit,days,scope,status,stage,day,search,page}=filters;
  const result=await getFollowupPool().query(consultingDashboardSql,[unit,days,scope,status,stage,day,search,(page-1)*25]);
  return result.rows[0].data;
}
