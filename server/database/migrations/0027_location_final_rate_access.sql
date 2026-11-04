-- Explicit, read-only Final Rate access for a single stall/season membership.
-- Existing Admin memberships remain denied. Owner/Super Admin access is role-based.
ALTER TABLE location_members ADD COLUMN can_view_final_rate INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(can_view_final_rate) = 'integer' AND can_view_final_rate IN (0, 1));
