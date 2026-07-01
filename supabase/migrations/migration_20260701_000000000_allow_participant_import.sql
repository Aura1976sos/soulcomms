-- Allow the app to import participants through the authenticated client.
-- This is a temporary migration for bulk data migration.

DROP POLICY IF EXISTS "participants_insert" ON participants;

CREATE POLICY "participants_insert"
  ON participants FOR INSERT
  TO authenticated
  WITH CHECK (true);
