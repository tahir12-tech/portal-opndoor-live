/* THE SHIPPED SENDER IS no-reply@opndoor.co.
 *
 * Matt, 2026-10-01: "Every email is sent from no-reply@opndoor.co (display
 * name 'opndoor') ... The sender address is a setting, not hardcoded."
 *
 * WHY THIS IS A FILE TEST AND NOT A DATABASE ONE. The pgTAP file next to it
 * asserts the BEHAVIOUR -- an admin may change it, a bad one is refused,
 * only an admin may. It cannot assert the VALUE, because dev's is
 * deliberately different: opndoor.co is not verified in Resend yet, so dev
 * sends from onboarding@resend.dev and a live-shaped address would send
 * nothing at all. That divergence is the whole reason the sender became a
 * setting, so a test forbidding it would be testing against the feature.
 *
 * What must stay true in every environment is what a FRESH one is seeded
 * with -- live included, when the migrations are applied there. That is a
 * fact about the file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = join(process.cwd(),
  'supabase/migrations/20261007280000_the_sender_address_is_a_setting.sql');
const sql = readFileSync(MIGRATION, 'utf8');

describe('the seeded sender', () => {
  it('is the address and display name Matt named', () => {
    expect(sql).toContain("values ('email_from', 'opndoor <no-reply@opndoor.co>'");
  });

  /* THE HYPHEN IS THE POINT. The old default was noreply@opndoor.co, a
     DIFFERENT mailbox -- and on a domain where neither is verified, the
     difference between an email arriving and not. */
  it('spelled no-reply, not noreply', () => {
    /* THE SEED STATEMENT, not the whole file: the migration's own prose
       names the old `noreply@` to explain the difference, and a
       file-wide search finds that explanation. */
    const seed = /values \('email_from', '([^']+)'/.exec(sql)?.[1] ?? '';
    expect(seed).toContain('no-reply@opndoor.co');
    expect(seed).not.toMatch(/[^-]noreply@/);
  });

  /* AND IT DOES NOT OVERWRITE AN ENVIRONMENT THAT HAS ALREADY CHOSEN.
     Dev holds the Resend sandbox sender; a re-apply must leave it. */
  it('and does not overwrite an environment that has already set one', () => {
    expect(sql).toMatch(/on conflict \(key\) do nothing/);
  });
});

describe('the mailer', () => {
  const mailer = readFileSync(join(process.cwd(), 'supabase/functions/_shared/mailer.ts'), 'utf8');

  /* THE ORDER MATTERS AND IS EASY TO INVERT: the setting must beat the
     environment, or an EMAIL_FROM left behind on live would silently win
     over what an admin changes and nobody would know why. */
  /* THREE SOURCES, IN AN ORDER THAT IS EASY TO GET WRONG. The setting is
     what an admin changes; the env var exists so a deployment can send
     before anybody can sign in to set it; the literal exists so an email
     is never unsendable. */
  it('reads the setting, with the env var and a literal behind it', () => {
    expect(mailer).toContain('rpc/email_from');
    expect(mailer).toContain('EMAIL_FROM_ENV');
    expect(mailer).toContain('opndoor <no-reply@opndoor.co>');
  });

  /* AND THE HANDOVER SAYS TO LEAVE THE ENV VAR UNSET ON LIVE, because it
     WINS over the setting: an EMAIL_FROM left behind there would silently
     beat whatever an admin changes, and nobody would know why. */
  it('and the handover tells Balal to leave EMAIL_FROM unset on live', () => {
    const handover = readFileSync(join(process.cwd(), 'docs/HANDOVER-BALAL.md'), 'utf8');
    expect(handover).toMatch(/`EMAIL_FROM` is \*\*unset\*\* on live/);
  });

  /* NO REPLY-TO ON ANYTHING. Matt revised his own instruction the same
     day: a Reply-To would be a third answer to "where does a reply go",
     contradicting the no-reply address it was sent from. */
  it('sets no Reply-To header at all', () => {
    expect(mailer).not.toMatch(/^\s*reply_to:/m);
  });
});
