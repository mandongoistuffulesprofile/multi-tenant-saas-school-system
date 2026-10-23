-- 0008_payment_channel_unique.sql — a paybill/till belongs to exactly one school.
--
-- Without this, two schools that happen to register the same shortcode would
-- make callback tenant resolution nondeterministic.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_channel_active_shortcode
    ON school_payment_channels (shortcode_or_account)
    WHERE status = 'ACTIVE';
