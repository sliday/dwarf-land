ALTER TABLE dwarf_sponsorships ADD COLUMN claim_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dwarf_sponsorships_claim_token
ON dwarf_sponsorships(claim_token)
WHERE claim_token IS NOT NULL;
