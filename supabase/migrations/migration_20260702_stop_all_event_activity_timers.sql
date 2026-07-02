-- Stop all active timers for a single event only
CREATE OR REPLACE FUNCTION stop_all_event_activity_timers(
  p_event_id UUID,
  p_checkout_time TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  stopped_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_stopped_count INT := 0;
BEGIN
  UPDATE activity_participation_time
  SET
    checkout_time = p_checkout_time,
    updated_at = NOW()
  WHERE event_id = p_event_id
    AND checkout_time IS NULL;

  GET DIAGNOSTICS v_stopped_count = ROW_COUNT;

  RETURN QUERY SELECT
    true,
    'Stopped active timers for selected event',
    v_stopped_count;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT
    false,
    'Error: ' || SQLERRM,
    0;
END;
$$;
