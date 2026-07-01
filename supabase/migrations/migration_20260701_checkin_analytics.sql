-- Create check_in_hourly_analytics table to store hourly check-in distribution by event
create table if not exists check_in_hourly_analytics (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  hour integer not null check (hour >= 0 and hour < 24),
  check_in_count integer not null default 0,
  created_at timestamp default now(),
  updated_at timestamp default now(),
  unique (event_id, hour)
);

-- Create RLS policy
alter table check_in_hourly_analytics enable row level security;

create policy "view_check_in_analytics" on check_in_hourly_analytics
  for select using (true);

create policy "staff_manage_check_in_analytics" on check_in_hourly_analytics
  for all using (
    auth.uid() in (
      select user_id from staff_profiles 
      where role in ('admin', 'event_admin')
    )
  );

-- Create indexes
create index check_in_hourly_analytics_event_id on check_in_hourly_analytics(event_id);
create index check_in_hourly_analytics_hour on check_in_hourly_analytics(hour);
