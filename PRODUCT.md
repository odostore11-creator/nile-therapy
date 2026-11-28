# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Doctors (physiotherapists):** about ten home-visit physiotherapists in Greater Cairo and the Sharqia area. They use the portal **on their phones**, between home visits, to log the session they just did, see their upcoming visits, and take open patients near them. They should need almost no training.
- **Founders:** three co-founders, who are also physiotherapists and treat patients themselves (Dr. Mostafa Ismail, Dr. Abdelrahman Sameh, Dr. Ahmed Nader). They use it **on a laptop and on their phones** to run the business: assign patients, watch the team's work, check money, and see what changed.
- **Partners:** referring hospitals, clinics and doctors who send patients in and follow their progress.
- **Technical team:** the two people who built and run the portal. They have a narrow account (notes, logins, errors, usage) and no access to patient data.

## Product Purpose

Nile Therapy brings physiotherapy to the patient's home. The portal is its internal operating system: every booking from the public website (niletherapy.org), every partner referral and every visit ends up here, gets a doctor, and becomes a logged session with a fee.

Success means all four of these:
- **Visits are logged the same day**, so patient records, doctor activity and money are always right.
- **No patient waits.** Every website booking or referral gets a doctor quickly; if nobody takes one within 2 hours, the founders are alerted.
- **Founders see everything at a glance:** who is working, how many sessions, what is owed, what changed and who changed it.
- **It is easy for doctors:** it works in Arabic on an ordinary phone with almost no training.

## Positioning

Built around home visits in Egypt. Patients are routed by where they live: each doctor has coverage areas drawn on a map, and a booking goes to the doctor whose area it falls in (or the nearest one), with a daily limit per doctor. The same tool is used by the people who treat the patients and the people who run the company.

## Operating Context

- Live at https://niletherapyport.site (static site on GitHub Pages; data, logins and rules in Supabase).
- Doctors work on the move, often on mobile data, so the portal keeps unsent work as a draft and sends it when the connection comes back.
- Bookings arrive from the public website's form, from partners (with an optional PDF), or are created by founders on the coverage map.
- Founders assign, reassign and cancel patients; doctors take open patients near them; visits become sessions when done.
- Email alerts go to the founders for new bookings and referrals, plus a weekly summary. Emails never contain the patient's name, phone or complaint.

## Capabilities and Constraints

- Roles: founders (admin), doctors, partners, technical team. One login form for everyone; the account decides what they see.
- Arabic and English are **equally important**; every screen exists in both, Arabic right-to-left.
- Who can see and change what is enforced in the database (row-level security), not only in the interface. Doctors see only their own patients and visits; the technical team never sees patient data.
- Every add, edit and delete of sessions, visits and doctor profiles is kept in a change history. Founders can restore deleted items and undo the latest edit.
- Doctors cannot change their own password; a founder or the technical team resets it.
- No secrets in the front end or in the repository.

## Brand Commitments

- Name: Nile Therapy / نايل ثيرابي. Logo files in `public/` (logo-full.png, logo-mark.png). Tagline on the login page: "Care that moves with the river." / «رعاية تتدفق مع النيل.»
- Founders' profile photos: `public/img/people/<username>.jpg`.

## Evidence on Hand

- The real doctor roster with phones, working hours and status (from the founders' sheet), stored in the portal.
- Real sessions logged since September 2026 (older ones imported), and visits since November 2026.
- No patient testimonials, outcome statistics or case studies exist yet. Do not invent them.

## Product Principles

1. **Phone first for doctors.** Logging a session must be quick with one thumb, between two visits, on a weak connection.
2. **Nothing gets lost.** Drafts survive a bad connection, history keeps every change, and deleted items can be restored.
3. **The right person sees the right thing.** Patient data stays with the founders and the treating doctor, and the database enforces it.
4. **Arabic and English as equals.** No screen is finished until it works in both directions.
5. **Founders decide, the system suggests.** Auto-assignment proposes; founders can always override it.
