-- Ensure analytics and summary functions include active activity sessions

CREATE OR REPLACE FUNCTION get_participant_activity_summary(
  p_event_id UUID,
  p_participant_id UUID
)
RETURNS TABLE (
  activity_id UUID,
  activity_name TEXT,
  total_visits INT,
  total_minutes INT,
  last_checkin TIMESTAMP WITH TIME ZONE,
  is_currently_active BOOLEAN
)
LANGUAGE SQL
SECURITY DEFINER
AS $$
SELECT
  apt.activity_id,
  a.name,
  COUNT(*)::INT as total_visits,
  COALESCE(
    SUM(
      GREATEST(
        0,
        EXTRACT(EPOCH FROM (COALESCE(apt.checkout_time, NOW()) - apt.checkin_time))::INT / 60
      )
    ),
    0
  )::INT as total_minutes,
  MAX(apt.checkin_time) as last_checkin,
  EXISTS (
    SELECT 1
    FROM activity_participation_time active_apt
    WHERE active_apt.event_id = p_event_id
      AND active_apt.participant_id = p_participant_id
      AND active_apt.activity_id = apt.activity_id
      AND active_apt.checkout_time IS NULL
  ) as is_currently_active
FROM activity_participation_time apt
LEFT JOIN activities a ON a.id = apt.activity_id
WHERE apt.event_id = p_event_id
  AND apt.participant_id = p_participant_id
GROUP BY apt.activity_id, a.name
ORDER BY total_minutes DESC;
$$;

CREATE OR REPLACE FUNCTION get_activity_time_statistics(
  p_event_id UUID,
  p_activity_id UUID
)
RETURNS TABLE (
  total_participants INT,
  total_checkins INT,
  average_duration_minutes INT,
  min_duration_minutes INT,
  max_duration_minutes INT,
  total_time_hours NUMERIC
)
LANGUAGE SQL
SECURITY DEFINER
AS $$
SELECT
  COUNT(DISTINCT participant_id)::INT as total_participants,
  COUNT(*)::INT as total_checkins,
  AVG(
    GREATEST(
      0,
      EXTRACT(EPOCH FROM (COALESCE(checkout_time, NOW()) - checkin_time))::INT / 60
    )
  )::INT as average_duration_minutes,
  MIN(
    GREATEST(
      0,
      EXTRACT(EPOCH FROM (COALESCE(checkout_time, NOW()) - checkin_time))::INT / 60
    )
  )::INT as min_duration_minutes,
  MAX(
    GREATEST(
      0,
      EXTRACT(EPOCH FROM (COALESCE(checkout_time, NOW()) - checkin_time))::INT / 60
    )
  )::INT as max_duration_minutes,
  ROUND(
    SUM(
      GREATEST(
        0,
        EXTRACT(EPOCH FROM (COALESCE(checkout_time, NOW()) - checkin_time))::INT / 60
      )
    )::NUMERIC / 60,
    2
  ) as total_time_hours
FROM activity_participation_time
WHERE event_id = p_event_id
  AND activity_id = p_activity_id;
$$;
