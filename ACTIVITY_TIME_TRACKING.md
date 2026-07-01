# Activity Time Tracking Feature

## Overview

The **Activity Time Tracking** feature automatically tracks how long each participant spends at each activity during your event. It uses **Option 2: Automatic Duration Tracking**, which means:

- Participants check in to activities with a single tap
- When they check in to a new activity, the previous activity's duration is calculated automatically
- No manual checkout is required
- Duration is tracked and available for analytics

---

## How It Works

### Automatic Duration Calculation

```
Timeline:
├─ 1:00 PM - Participant checks in to Movie
├─ 1:45 PM - Participant checks in to Sip & Paint  
│           ↓ Movie automatically closed (45 min duration)
├─ 2:15 PM - Participant checks in to Beauty Station
│           ↓ Sip & Paint automatically closed (30 min duration)
└─ ...
```

### Database Schema

**`activity_participation_time` Table:**
```sql
id                UUID          -- Unique record ID
event_id          UUID          -- Event reference
participant_id    UUID          -- Participant reference
activity_id       UUID          -- Activity reference
checkin_time      TIMESTAMP     -- When participant entered
checkout_time     TIMESTAMP     -- When participant left (auto-set)
duration_minutes  INT           -- Calculated automatically
created_at        TIMESTAMP     -- Record creation time
```

---

## API Functions

### Core Functions (TypeScript Service)

**`recordActivityCheckin(eventId, participantId, activityId, checkinTime?)`**
- Records participant checking in to an activity
- Auto-closes previous activity
- Returns: `{ success, participationId, previousActivityId, previousDurationMinutes }`

```typescript
import { recordActivityCheckin } from '@/lib/activityTimeTracking';

const result = await recordActivityCheckin(
  '9d282cb7-...', // eventId
  'abc123...',     // participantId
  'def456...'      // activityId
);

if (result.success) {
  console.log(`Checked in. Previous activity: ${result.previousActivityId} (${result.previousDurationMinutes} min)`);
}
```

**`recordActivityCheckout(participationId, checkoutTime?)`**
- Manually checkout from an activity (optional)
- Returns: `{ success, durationMinutes, message }`

```typescript
import { recordActivityCheckout } from '@/lib/activityTimeTracking';

const result = await recordActivityCheckout('participation_id_123');
```

**`getParticipantActivitySummary(eventId, participantId)`**
- Get all activities for a participant with total time spent
- Returns: `ParticipantActivitySummary[]`

```typescript
import { getParticipantActivitySummary } from '@/lib/activityTimeTracking';

const summary = await getParticipantActivitySummary(eventId, participantId);
// Returns: [
//   { activity_id: '...', activity_name: 'Movie', total_visits: 1, total_minutes: 45, ... },
//   { activity_id: '...', activity_name: 'Sip & Paint', total_visits: 1, total_minutes: 30, ... }
// ]
```

**`getActivityTimeStatistics(eventId, activityId)`**
- Get time statistics for an activity
- Returns: `ActivityTimeStatistics`

```typescript
import { getActivityTimeStatistics } from '@/lib/activityTimeTracking';

const stats = await getActivityTimeStatistics(eventId, activityId);
// Returns: {
//   total_participants: 150,
//   total_checkins: 180,
//   average_duration_minutes: 42,
//   min_duration_minutes: 5,
//   max_duration_minutes: 120,
//   total_time_hours: 127.5
// }
```

### React Hook

**`useActivityTimeTracking({ eventId, participantId?, activityId? })`**
- React hook for time tracking operations
- Provides: `{ loading, error, checkin, checkout, getParticipantSummary, getActivityStats, getRecords, getActive }`

```typescript
import { useActivityTimeTracking } from '@/hooks/useActivityTimeTracking';

function MyComponent() {
  const { checkin, getParticipantSummary, loading, error } = useActivityTimeTracking({
    eventId: '9d282cb7-...',
    participantId: 'abc123...'
  });

  const handleCheckin = async (activityId: string) => {
    await checkin(participantId, activityId);
  };

  const handleGetSummary = async () => {
    const summary = await getParticipantSummary();
    console.log(summary);
  };

  return (
    <div>
      {loading && <p>Loading...</p>}
      {error && <p>Error: {error}</p>}
      {/* UI here */}
    </div>
  );
}
```

---

## Supabase Functions (RPC)

### `handle_activity_checkin(p_event_id, p_participant_id, p_activity_id, p_checkin_time)`

Records checkin and auto-closes previous activity.

**Parameters:**
- `p_event_id`: Event UUID
- `p_participant_id`: Participant UUID
- `p_activity_id`: Activity UUID
- `p_checkin_time`: Checkin timestamp (default: NOW())

**Returns:**
```json
{
  "success": true,
  "message": "Activity checkin recorded successfully",
  "participation_id": "uuid...",
  "previous_activity_id": "uuid...",
  "previous_duration_minutes": 45
}
```

### `handle_activity_checkout(p_participation_id, p_checkout_time)`

Manually record checkout.

**Parameters:**
- `p_participation_id`: Participation record UUID
- `p_checkout_time`: Checkout timestamp (default: NOW())

**Returns:**
```json
{
  "success": true,
  "message": "Activity checkout recorded successfully",
  "duration_minutes": 45
}
```

### `get_participant_activity_summary(p_event_id, p_participant_id)`

Get all activities and time spent for a participant.

**Returns:**
```json
[
  {
    "activity_id": "uuid...",
    "activity_name": "Movie Sessions",
    "total_visits": 1,
    "total_minutes": 45,
    "last_checkin": "2026-07-01T13:45:00Z",
    "is_currently_active": false
  }
]
```

### `get_activity_time_statistics(p_event_id, p_activity_id)`

Get statistics for an activity.

**Returns:**
```json
{
  "total_participants": 150,
  "total_checkins": 180,
  "average_duration_minutes": 42,
  "min_duration_minutes": 5,
  "max_duration_minutes": 120,
  "total_time_hours": 127.50
}
```

---

## Views

### `v_participant_current_activity`

View showing current active (unchecked-out) activities for each participant.

```sql
SELECT 
  participant_id,
  event_id,
  activity_id,
  activity_name,
  checkin_time,
  duration_minutes  -- Current live duration
FROM v_participant_current_activity
WHERE rn = 1  -- Most recent activity
```

---

## Usage Examples

### Example 1: Track Participant Activity

```typescript
// When participant scans activity QR code
const handleActivityScan = async (participantId: string, activityId: string) => {
  const result = await recordActivityCheckin(
    currentEventId,
    participantId,
    activityId
  );

  if (result.success) {
    // Previous activity auto-closed, show feedback
    if (result.previousActivityId) {
      showNotification(
        `Checked out of previous activity after ${result.previousDurationMinutes} minutes`
      );
    }
  }
};
```

### Example 2: Display Participant Stats

```typescript
// Show how much time participant spent on each activity
const ParticipantStatsCard = ({ participantId }: { participantId: string }) => {
  const { getParticipantSummary, loading } = useActivityTimeTracking({ 
    eventId 
  });
  
  const [summary, setSummary] = useState<ParticipantActivitySummary[]>([]);

  useEffect(() => {
    getParticipantSummary(participantId).then(setSummary);
  }, [participantId]);

  return (
    <div>
      {summary.map(activity => (
        <div key={activity.activity_id}>
          <h4>{activity.activity_name}</h4>
          <p>Visits: {activity.total_visits}</p>
          <p>Time: {formatDuration(activity.total_minutes)}</p>
          {activity.is_currently_active && <p>⏱️ Currently active</p>}
        </div>
      ))}
    </div>
  );
};
```

### Example 3: Activity Analytics Dashboard

```typescript
// Show aggregate statistics for an activity
const ActivityAnalytics = ({ activityId }: { activityId: string }) => {
  const { getActivityStats, loading } = useActivityTimeTracking({
    eventId,
    activityId
  });

  const [stats, setStats] = useState<ActivityTimeStatistics | null>(null);

  useEffect(() => {
    getActivityStats(activityId).then(setStats);
  }, [activityId]);

  if (!stats) return <p>Loading...</p>;

  return (
    <div>
      <p>Participants: {stats.total_participants}</p>
      <p>Total Checkins: {stats.total_checkins}</p>
      <p>Avg Duration: {stats.average_duration_minutes} min</p>
      <p>Total Time: {stats.total_time_hours} hours</p>
    </div>
  );
};
```

---

## Data Retention

- Participation records are created for all events automatically
- Records are linked to events via `event_id` foreign key
- Deleting an event cascades to delete all participation records
- Manually checkout is optional - duration calculated from timestamps anyway

---

## Performance

- Indexes on `event_id`, `participant_id`, `activity_id`, and `checkin_time` for fast queries
- RLS policies ensure users only see their event data
- Computed column `duration_minutes` avoids recalculation

---

## Testing

To test the feature:

1. **Record activity checkin:**
   ```bash
   curl -X POST https://your-supabase.com/functions/v1/handle-activity-checkin \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "p_event_id": "event-id",
       "p_participant_id": "participant-id",
       "p_activity_id": "activity-id"
     }'
   ```

2. **Check current active activities:**
   ```sql
   SELECT * FROM v_participant_current_activity 
   WHERE participant_id = 'xxx';
   ```

3. **View all participation records:**
   ```sql
   SELECT * FROM activity_participation_time 
   WHERE event_id = 'xxx' 
   ORDER BY checkin_time DESC;
   ```

---

## Future Enhancements

- [ ] Offline mode support for time tracking
- [ ] Activity duration limits and warnings
- [ ] Real-time duration display in Activity Recorder
- [ ] Time-based achievements/badges
- [ ] Export time tracking data to CSV
- [ ] Heatmap of activity engagement over time
- [ ] Integration with leaderboards based on time spent
