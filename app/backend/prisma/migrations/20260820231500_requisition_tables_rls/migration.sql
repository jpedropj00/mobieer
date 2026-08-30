-- Gestium accesses these tables exclusively through the authenticated backend.
-- Keep them unavailable to Supabase Data API roles, matching the existing project policy.
ALTER TABLE "RequisitionHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RequisitionAttachment" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "RequisitionHistory" FROM anon;
    REVOKE ALL ON TABLE "RequisitionAttachment" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "RequisitionHistory" FROM authenticated;
    REVOKE ALL ON TABLE "RequisitionAttachment" FROM authenticated;
  END IF;
END $$;
