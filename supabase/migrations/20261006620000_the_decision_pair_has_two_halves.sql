-- THE DECISION PAIR HAS TWO HALVES.
--
-- Q-03's instruction names eight notification types: "sent, paid, signed, deed
-- issued, tenancy start correction, renewal notice, lapse, decline". Wiring
-- the send paths to the matrix turned up a ninth that the product actually
-- sends and the list does not name: APPROVED.
--
-- `notifyReferrer` has four events -- submitted, approved, declined, paid --
-- and the list covers three of them. `decline` is there and its opposite is
-- not, which reads like an omission rather than a decision: Opndoor either
-- tells the referrer the referencing decision or it does not, and the matrix
-- is where that is chosen.
--
-- The alternative was to map `approved` onto an existing cell. Every candidate
-- is wrong in the same way: `signed` is the deed being signed, which happens
-- later and for a different reason, so turning OFF "deed signed" would
-- silently also turn off "approved". A switch that governs something it is not
-- named after is worse than an extra row.
--
-- Defaults and locks follow the existing rule with no special case: everything
-- on for agencies, on for a supplier's referrer, off for a supplier's agent
-- contact (only deed_issued is on for them), and nothing about it is locked.
-- Matt can delete this in one line if he meant the eight literally.

alter table public.notification_settings
  drop constraint if exists notification_settings_type;
alter table public.notification_settings
  add constraint notification_settings_type
  check (notification_type in ('sent','approved','paid','signed','deed_issued',
                               'tenancy_correction','renewal_notice','lapse','decline'));

create or replace function public.notification_types()
returns table(notification_type text, label text, ord int)
language sql immutable as $$
  select * from (values
    ('sent',               'Sent for referencing',    1),
    ('approved',           'Approved',                2),
    ('decline',            'Declined',                3),
    ('paid',               'Fee paid',                4),
    ('signed',             'Deed signed',             5),
    ('deed_issued',        'Deed issued',             6),
    ('tenancy_correction', 'Tenancy start corrected', 7),
    ('renewal_notice',     'Renewal notice',          8),
    ('lapse',              'Lapse (expiry reminder)', 9)
  ) as t(notification_type, label, ord)
$$;
