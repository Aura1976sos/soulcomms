#!/bin/bash
# Apply migrations to Supabase database using REST API

SUPABASE_URL="https://spb-t4n599sao4ett36b.supabase.opentrust.net"
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkZmpsdW91amJ4bXZ5ZG9qZ3J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mjg5Njk1MCwiZXhwIjoyMDk4NDcyOTUwfQ.tzr75W5-jmAMRsBGOoWxllW3CY8LPQ_HkEa2aLaWIFY"

echo "Reading combined migrations..."
SQL=$(cat combined_migrations.sql)

# Create a JavaScript payload to execute the SQL via rpc
cat > /tmp/exec_migrations.json << EOF
{
  "sql": "$SQL"
}
EOF

echo "Executing migrations..."
curl -X POST \
  "${SUPABASE_URL}/rest/v1/rpc/exec_sql" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d @/tmp/exec_migrations.json

echo ""
echo "Done!"
