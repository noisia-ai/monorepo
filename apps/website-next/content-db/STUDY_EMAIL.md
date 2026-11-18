# The emails of a study

A `registro` study sends two emails, both from `STUDY_FROM_EMAIL` (`estudios@hey.noisia.ai`).

| Email | When | Code |
|---|---|---|
| The code | The reader leaves name, email and company | `src/lib/content/study-code-email.ts`, sent by `unlock/route.ts` |
| The access link | The reader types the right code | `src/lib/content/study-email.ts`, sent by `unlock/verify/route.ts` |

The verify route also sends a plain "Registro: …" note for each new reader.

## Where replies and notes go

| Variable | What | Falls back to |
|---|---|---|
| `STUDY_FROM_EMAIL` | Sender of both emails. It must be on a domain verified in Resend (today only `hey.noisia.ai`; `noisia.ai` answers 403). | `Noisia <estudios@hey.noisia.ai>` |
| `STUDY_REPLY_TO` | Where a reader's reply to the access email lands (the email invites them to answer). One or more, comma-separated. | `WORKSHOP_TO_EMAIL` |
| `STUDY_NOTIFY_TO` | Who gets the "Registro" note. One or more. | `STUDY_REPLY_TO` |
| `LEADS_CC` | Copied on every lead note: the "Registro" note and the workshop form. One or more. | nobody |

**Since 18 Nov 2026, while hola@noisia.ai is restored in Google Workspace** (it bounces):
- leads go to ferdi@, with brandhon@ in copy;
- `STUDY_REPLY_TO` is both of them;
- the public addresses of the site live in `src/lib/contact.ts`: contact to ferdi@ and privacy requests to david@, each with brandhon@ in copy.
When hola@ works again, point both places back to it.

The values live in Railway, not in the repo. `WORKSHOP_TO_EMAIL` stays with the workshop form.
Before pointing either variable at a new address, check in Resend's log that a test message to it
is `delivered`, not `bounced`.

## The design

It follows the Data API email system (`packages/pitch-kit/NOTIFICATIONS.md` §2):
- A white 600 px card on `#f4f4f4`, with Google Sans and light mode forced.
- Tables and inline styles, a VML button for Outlook, and always a plain-text version.

The access email reads top to bottom:
1. The logo and a short greeting.
2. The study's banner.
3. Method, period and slide count in small capitals, then the title and the dek.
4. Up to two key figures as tiles, taken from `stats` in `estudio.json`.
5. The black button.
6. The personal link written out, in case the button does not work.
7. The invitation to reply, then the footer.

**Images go inside the email (CID), never by URL.**
- The logo is `cid:noisia`, embedded from `email-logo.ts`.
- The banner is `cid:study`.
- The reason: Outlook.com, Hotmail and many company clients block remote images until the reader
  allows them. That is why the first version of the email showed no picture.
- Every `<img>` carries an alt text and a text color, so a blocked image still reads.

## The banner

`pnpm content:study` renders `email-banner.jpg` from the study's image (`imagen.png`):
- It is a 1040 × 560 JPEG, shown at 520 × 280.
- The image is flattened on white. Email clients show transparency as black, and classic Outlook
  does not show webp.
- The person melts into the white with `multiply`, over a faint cyan (`#009CA8`) and red
  (`#D91441`) aura. Here the brand's neon is glow, never a fill (`packages/kb/Design.md`).
- A study without an image sends the email without a banner.
- The loader also keeps `email.jpg`, the 2:3 thumbnail of the first emails, so emails already sent
  keep showing it.

To change the banner of a published study, load it again with `pnpm content:study <folder>`. It keeps
its status and its version goes up.
