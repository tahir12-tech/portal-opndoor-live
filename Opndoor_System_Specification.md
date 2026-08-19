# Opndoor — Tenant Referencing & Guarantee Platform
## System Specification for Rebuild

**Version:** 1.2 (reconstructed from integration documentation)
**Purpose:** Authoritative build specification for reconstructing the Opndoor platform. Written to be fed directly to an AI coding agent as the source of truth for a from-scratch reimplementation.

---

## 0. How to use this document

This spec describes an **existing production system** (`admin.opndoor.co`) so it can be rebuilt to functional parity. It is written as a contract, not a tutorial: every endpoint, payload, status value and conditional field rule below is derived from the supplied integration documents and the confirmed vendor decisions, not invented.

A short number of items are **provisioned at go-live** rather than designed now — third-party API keys, check IDs and vendor-specific parameters that each provider (Yoti, Kreditz, LIB, Stripe) supplies when the integration is activated. These are collected in §13 so they are not lost; they are configuration, not open design questions.

Terminology:
- **Opndoor** — the system being rebuilt.
- **LIB** — *Lettings in a Box*, the external referencing engine and system of record for the reference decision.
- **Tenant / Applicant** — the individual being referenced.
- **Guarantor** — a third party required when a reference passes only on condition of a guarantor.

---

## 1. System overview and the core architectural principle

Opndoor is a **white-labelled tenant-referencing and rent-guarantee front-end and orchestration layer**. It is *not* the referencing decision engine. The decision engine is LIB.

The single most important design fact — and the one most likely to be lost in a naïve rebuild — is this:

> For the self-serve and agent flows, the tenant experiences a fully Opndoor-branded journey (interface, dashboard, tabs, emails). Underneath, Opndoor calls the identity and financial-verification vendors **directly, but authenticated with LIB-supplied credentials** — so the structured vendor results land in **LIB's own vendor accounts / portal**, not in Opndoor. Opndoor then separately pushes the collected **form data and uploaded files** into LIB via the sync API. The tenant never sees LIB; to them it is Opndoor end to end.

**Consequence for the data flow — read carefully:** the structured Yoti and Kreditz outputs do **not** travel through Opndoor's `save_all_tenant_data` payload, and must not be added to it. They are already LIB's, because the checks ran on LIB's vendor accounts. Opndoor's sync carries only (a) the form data and (b) applicant-*uploaded* files (bank statement PDF, P60, proof of address, signature) — the manual/alternate path used when an applicant cannot link. This is exactly why the documented payload has `bank_statement_file`/`fileDataBankStatement` fields but no Kreditz or Yoti result fields: it was never meant to carry them.

Responsibilities split cleanly:

**Opndoor owns:** the branded UI, account/auth, the multi-step application form, two payment events, the **triggering** of identity verification (Yoti) and financial verification (Kreditz) *under LIB's credentials*, collection of applicant-uploaded documents, e-signature orchestration, policy-document delivery, and all inbound/outbound API plumbing to LIB and third parties.

**LIB owns:** the Yoti and Kreditz **vendor accounts and their structured outputs** (Opndoor merely initiates the sessions against them), the TransUnion credit check, the full reference assessment, the human admin review, and the Pass / Fail / Pass-with-guarantor decision. LIB returns the decision and the generated reference reports to Opndoor.

Get this boundary wrong and you will rebuild a referencing engine Opndoor does not contain.

### 1.1 Where each check actually runs

| Check | Vendor | Runs at | Trigger |
|---|---|---|---|
| Identity, liveness, AML, PEP, sanctions | **Yoti** | Opndoor | "ID Verification" tab |
| Open-banking account verification (**VeriBank**) | **Kreditz** | Opndoor | "Financials" tab (see §3.5 decision rule) |
| Payroll / income verification (**VeriPay** / "Open Payroll") | **Kreditz** | Opndoor | "Financials" tab (see §3.5 decision rule) |
| Manual financial fallback | — | Opndoor | Tenant uploads statement instead of VeriBank/VeriPay |
| **Credit check** | **TransUnion** | **LIB** | On receipt of `save_all_tenant_data` |
| Full reference assessment + decision | — | **LIB** | Admin review after data sync |

`VeriBank` and `VeriPay` are Opndoor's branded names for Kreditz products. Treat them as Kreditz integrations — but note the Kreditz (and Yoti) **calls are made under LIB-supplied credentials**, so their structured results are LIB's from the moment they are produced and are not returned into the Opndoor→LIB sync (§1, §7.1).

---

## 2. Actors and external systems

**Actors:** self-serve Tenant, Letting Agent, Landlord, Guarantor, Third-Party Referrer (API consumer), LIB (system-to-system), Opndoor admin.

**External systems Opndoor integrates with:**
1. **LIB** — bidirectional REST (Opndoor calls LIB's `CRMApi`; LIB calls Opndoor's `GuarantorApi`). LIB provisions its credentials and any check IDs required by its API at go-live.
2. **Yoti** — identity / liveness / AML / PEP / sanctions. Opndoor calls Yoti's API **directly but authenticated with LIB-supplied credentials**; results land in LIB's Yoti account, not in Opndoor. LIB supplies the credentials and any check ID at go-live (§7.5).
3. **Kreditz** — VeriBank (open banking) + VeriPay / Open Payroll (payroll/income). Opndoor calls Kreditz's API **directly but authenticated with LIB-supplied credentials**; results land in LIB's Kreditz account, not in Opndoor. LIB supplies the credentials, check ID and required parameters at go-live (§7.6). The decision rule for which product (or manual upload) applies is in §3.5.
4. **Stripe** — payment processor. Two payment events exist: the **eligibility payment** and the **guarantee fee** (§3.2, §3.7, §7.7).
5. **E-signature** — **currently an in-house signature capture** (canvas capture producing raw `.png` signature assets carried as base64 in the payloads). The rebuild should **integrate PandaDoc** in place of the in-house mechanism, while retaining the in-house capture as the current documented state until PandaDoc is live (§7.7).
6. **Email / transactional mail** — verification codes, create-password links, payment links, signature links, policy delivery.

---

## 3. Entry Point 1 — Web Signup (self-serve tenant)

### 3.1 Account creation
1. Collect: title, gender, first name, last name, email, mobile number.
2. Send email verification code; user confirms email.
3. User sets and confirms a password.
4. User logs into the **tenant dashboard**.

### 3.2 Eligibility payment gate
Before any profile detail beyond account creation can be completed, the tenant must make an **eligibility payment via Stripe**. Profile completion is locked until this clears. The amount is a configurable value.

### 3.3 Dashboard information architecture
Top-level tabs, in order:
1. **Basic Information** (active by default)
2. **ID Verification**
3. **Financials**
4. **Upload Documents**
5. **Payment for Guarantee**
6. **Guarantee Document**

**Basic Information** contains sequential sub-tabs; each unlocks the next only on completion:
`Pending Details → Basic Information → Address → Income → Nationality → Declaration`

### 3.4 Form specification

The complete field tree, including every conditional branch, is defined below. It is reconstructed from both the process document and the field-mapping spreadsheet. **Where the two sources conflict, the process document wins** (the spreadsheet contains labelling defects — see §13).

#### Pending Details
*Rental property details:* property address, postcode, monthly rent, tenancy start date. (Lat/lng are captured/derived for the property and carried in the LIB sync.)
*Agent or landlord details:* choose **Private Landlord** or **Letting Agent**.
- Private Landlord → title, first name, last name, email, contact number.
- Letting Agent → letting agency name, email, contact number.

This choice determines **who provides the final signature** later (see §3.7).

#### Basic Information
Title; first name; last name; other names/aliases (Yes/No → if Yes, maiden/previous name); mobile number; date of birth.
Adverse-credit branch — "Any adverse credit in the last 6 years?" (Yes/No). If **Yes**:
- CCJs/Decrees? (Yes/No) → if Yes: number, total combined value, date of most recent.
- Ever bankrupt/sequestrated? (Yes/No) → if Yes: date of latest.
- Any IVAs/Trust Deeds? (Yes/No) → if Yes: date entered, total monetary value.

#### Address — **3 years of address history required**
Coverage is computed from *moved-in month/year*; if the current address does not cover 3 years, repeat the block for each prior address until 3 years is covered.

"Do you currently live in the UK?" (Yes/No).
- **Yes** → postcode lookup + select address → flat number, house number, house name, address line 1, address line 2, town/city, county, postcode.
- **No** → manual entry of the same fields, plus country.

Then, for each address:
- **Type of residency:** (1) Renting from landlord/letting agent, (2) Council/social/housing association, (3) Living with family/friends, (4) Student accommodation, (5) Homeowner, (6) Other.
- Moved-in month, moved-in year.
- Proof-of-address type + upload (current address only).
- **Rental-arrears question** — shown only for residency types **1, 2, 4, 6** ("Renting", "Council", "Student accommodation", "Other"): "Any rental arrears in the past 3 years?" (Yes/No/Not applicable) → if Yes: free-text detail.
- **Additional information/comments** — shown only when residency type = **Other**.

#### Income — employment/income type drives the field set
Selector options: (1) Permanent employee, (2) Self-employed / business owner, (3) Contract worker, (4) Temporary employee, (5) Retired, (6) Homemaker, (7) Unemployed / other income, (8) Zero-hours employee, (9) Student.

Field matrix by type:

- **Permanent (1):** employer business name; employer address in UK? (Yes→postcode lookup / No→manual); start date; referee name; referee business email + confirm; referee telephone; salary basis (Annual → basic annual salary | Hourly → basic hourly rate + guaranteed weekly hours); upload bank statement; probationary period? (Yes → length); subject to disciplinary action? (Yes/No/Don't know — no downstream fields); employment likely to continue? (Yes/No/Don't know — no downstream fields).
- **Self-employed (2):** start date; have an accountant? Yes → accountant name; accountant address in UK? (Yes→lookup / No→manual); referee name; referee business email + confirm; referee telephone; salary basis (Annual/Hourly as above); upload bank statement. No → confirm total annual income; upload last 2 years' tax returns; upload bank statement.
- **Contract (3):** as Permanent, plus **contract end date**, plus **job title/position**.
- **Temporary (4):** as Contract, but **no bank-statement upload**.
- **Retired (5):** start date; total pension income; upload most recent P60 / DWP pension award letter; upload bank statement.
- **Homemaker (6):** start date only.
- **Unemployed / other income (7):** start date only.
- **Zero-hours (8):** start date; employer business name; employer address in UK? (Yes/No); job title/position; referee name; referee business email + confirm; referee telephone; salary basis (Annual/Hourly); upload bank statement; probationary period? (Yes → length); disciplinary action? (Yes/No/Don't know); employment likely to continue? (Yes/No/Don't know).
- **Student (9):** start date only.

**Add Additional Income** (repeatable): type selector = Second Job, Bonus, Commission, Overtime, Pension, Working Tax Credit, Child Tax Credit, DLA/PIP, Child Maintenance, Bursary, Stipends, Sponsorship, Carers Allowance, Housing Benefit, Income Support, Job-seekers Allowance, Universal Credit, Student Loan.
- **Second Job** → repeats the full employment/income block above.
- **Any other type** → guaranteed/not guaranteed; additional income amount; frequency (Weekly/Monthly/Annually).

#### Nationality
Single field: nationality.

#### Declaration
Free-text "anything else about your application?"; tenancy start date; signature.

### 3.5 Verification stages (post Basic Information)

1. **ID Verification** — Yoti (liveness + document + AML/PEP/sanctions).

2. **Financials** — the applicant is verified through Kreditz (VeriBank / VeriPay) or, where they cannot link, by manual upload. The routing rule is:
   - **VeriBank (open banking):** the default path — the applicant links their bank account for verification.
   - **Manual bank-statement upload:** used when the applicant is **overseas or otherwise cannot link a bank account**. The uploaded statement substitutes for the open-banking link.
   - **VeriPay / Open Payroll:** used when the applicant is **employed on PAYE only** (payroll link), **or** when the applicant **receives Universal Credit and needs to evidence that income**.

3. **Upload Documents** — any documents still outstanding.

### 3.6 Sync to LIB
On tenant signature, Opndoor POSTs the collected **form data and applicant-uploaded files** to LIB (`CRMApi/save_all_tenant_data`, §7.1). It does **not** include Yoti or Kreditz structured results — those already sit in LIB's vendor accounts because the checks ran under LIB's credentials (§1). LIB runs the **TransUnion** credit check and full reference (correlating its own Yoti/Kreditz results with the synced application), an admin reviews, and LIB returns a **Pass / Fail** (and where relevant **Pass with guarantor**) decision.

### 3.7 Decision, guarantee payment, signature, policy
1. On **Pass**, the **Payment for Guarantee** tab activates; the tenant pays the **guarantee fee via Stripe**. The guarantee fee is **equal to one month's rent**.
2. **Final signature routing:**
   - Private Landlord selected in Pending Details → signature request emailed to the **landlord**.
   - Letting Agent selected → the **agent** provides the final signature.
3. Once the final signature is captured, the **Policy Document** is generated and delivered to the tenant (Guarantee Document tab).

---

## 4. Entry Point 2 — Agent (agent adds applicant)

### 4.1 Agent add-applicant form
Initial fields: title, first name, middle name, last name, email, phone, rental property (dropdown of existing properties **or** create new).

On an existing property, the system lists landlords already linked to it and offers **Add New Owner**:
- Managed by Private Landlord → title, first name, last name, email, contact number.
- Managed by Agent → letting agency name, email, contact number.

Then: monthly rent, applicant share percentage, applicant share amount, tenancy start date.

### 4.2 Handover to tenant
A create-password email is sent. Tenant logs in and pays the **eligibility payment via Stripe**. **"Pending Details" is auto-marked complete** (the agent supplied it). All remaining tabs are completed by the tenant exactly as in the signup flow (§3), including the same two-payment structure (eligibility + guarantee).

### 4.3 Signature routing (shared rule for Signup + Agent)
If an **Agency / Letting Agent** was selected during onboarding, the **final signature must be provided by the agent** to create the Policy Document. If not, the signature request goes to the **landlord**. This rule governs both Entry Point 1 and Entry Point 2.

---

## 5. Entry Point 3 — Via Lettings (guarantor-required)

This flow is **inbound from LIB** and carries **no Opndoor-side checks**. It is triggered when a reference LIB already completed returns "Pass with guarantor" (or otherwise requires the guarantor/payment-and-sign path).

### 5.1 Inbound trigger
LIB calls Opndoor: `POST {OPNDOOR_BASE}/GuarantorApi/save_guarantor_user_data` (§7.3). Auth: `Authorization: Basic base64(agency_secret_token)` — the `agency_secret_token` is provisioned to LIB and **stored on Opndoor's side** to authenticate the request.

The payload is the full reference result: tenant identity, agency identity (`company_id`, `agency_id`, `agency_number`, `agency_name`), reference metadata (`reference_case`, `reference_date`, `tenant_reference_number`, `overall_status`), the generated documents (**TransUnion report**, summary report, review summary report — each as filename + base64), the check breakdown (`applicant`, `identification`, `employment`, `residency`, `affordability`, `credit_check`, `review_credit_check`, each with `_condition`/`_note`), property + landlord details, financial terms, and **`table_id`** — the key that links back to the correct LIB record for later updates.

### 5.2 Guarantor / pay-and-sign process
No verification is run. Opndoor:
1. Persists the inbound record keyed on `table_id`.
2. Emails the user a **Stripe payment link** for the **single guarantee fee (one month's rent)**; user pays.
3. Emails a **signature link**; user reviews the policy and signs.
4. Emails the **landlord** a final-signature link; landlord signs.
5. Generates the **Policy Document** and makes it available to the user.

This flow has **only one payment** — the guarantee fee. There is no eligibility payment.

### 5.3 Update back to LIB
Opndoor POSTs the outcome to LIB: `POST {LIB_API_URL}/CRMApi/update_gurantor_required_user_detail` (§7.2) with `TableID`, `CompanyID`, `AgencyID`, `UserID`, `TenantID`, `PolicyDocument` (name), `PolicyDocument_Base64`, `PaymentStatus`. The **same call is reissued when the policy start date is updated**.

> Note the endpoint spelling is `update_gurantor_required_user_detail` (misspelled "gurantor") in the source. Preserve the exact string — LIB's route depends on it.

---

## 6. Entry Point 4 — Via Third-Party API (pre-referenced applicants)

Third-party referrers submit **already-referenced** applicants. Applications land under the **"Via API"** tab. No ID or financial verification is run; a lightweight **eligibility engine** gates them, then pay-and-sign proceeds.

### 6.1 Submit
`POST {BASE_URL}/ApplicationApi/submit`, `Authorization: Bearer {APIKEY}` (APIKEY issued by Opndoor to the third party). Body is a batch: `applications[]`, each with `applicant`, `property`, `landlord`, `financial`, `income` objects (§7.4). Response returns per-applicant `applicant_id` + `eligibility_status`.

### 6.2 Eligibility engine (deterministic)
Assessed on submit:
1. **Rent basis:** use `financial.share_amount` if provided, else `financial.rental_amount` (monthly).
2. **Credit:** if `income.credit_score` is present, it must be **≥ 519**. If absent/blank (e.g. foreign applicant with no UK file), the credit rule **does not apply**.
3. **Income (non-students):** monthly-equivalent income (`income.total_income` ÷ 12) must be **≥ 1.5 × monthly rent basis**.
4. **Students:** income rule **waived**; credit rule still applies only if a score is present.
5. **Outcome:** `Eligible` or `Not eligible`, with reason stored on the record.

**Implementation note:** the submit payload's `income.employment_type` example set does not include "Student" and there is no explicit `is_student` flag. Determine how the third-party feed signals a student before wiring the student waiver, so the rule is deterministic rather than assumed.

### 6.3 Pay-and-sign
If eligible: **Stripe payment email for the single guarantee fee (one month's rent)** → applicant pays → policy-document email → applicant reads and signs → landlord final-signature email → landlord signs → policy document generated for both parties and exposed on the application record. Like Entry Point 3, this flow has **only the guarantee fee** — no eligibility payment.

### 6.4 Read endpoints
- `GET {BASE_URL}/ApplicationApi/applications` — list (returns `total` + `data[]`; empty = `total:0, data:[]`).
- `GET {BASE_URL}/ApplicationApi/applications/{id}` — single record; includes `status` (Pending/Passed), `payment_status` (Pending/Paid), `guarantee_start_date`, `landlord_signature_date`, `policy_document_base64` (final deed).

---

## 7. Integration contracts

> All payloads below are reproduced from the source integration documents. Field names, casing and endpoint spellings are contractual — do not "tidy" them.

### 7.1 Opndoor → LIB: sync tenant on signature
```
POST {API_URL}/CRMApi/save_all_tenant_data
Content-Type: application/json
Authorization: Basic base64(API_EMAIL:API_PASSWORD:API_TOKEN)
```
- `API_URL` = LIB base URL; `API_EMAIL`/`API_PASSWORD`/`API_TOKEN` = letting-agency credentials + agency secret token, **provided by LIB**.
- Body: top-level tenant object with nested `Property` (→ `Detail` with lat/lng, `LandlordProperty`, `Landlord`), `Tenant` (adverse-credit flags: CCJs, bankruptcy, IVAs; `dob`; `marital_status`), `Income[]` (per-employment-type fields incl. accountant, pension, additional-income variants; document filenames + `fileData*` base64), `RightToRent`, `Address[]` (3-year history with proof, arrears, move-in dates), plus `TenantSignature` (base64) and `SourceBaseURL`.
- Success response returns LIB-side IDs: `UserID`, `PropertyID`, `LandlordID`, `TenantID`, `IncomeIDs{}`, `status:"SUCCESS"`. Persist these mappings — they are the join keys to LIB.
- Fail: `{ status:"error"|"FAIL", message }`.
- **Payload boundary:** this call carries form data + applicant-*uploaded* files only. It contains **no Yoti/Kreditz structured result fields, and none should be added** — those results are already in LIB's vendor accounts (§1). Do not "complete" the payload with vendor outputs; that would be a design error, not a fix.

### 7.2 Opndoor → LIB: guarantor-required / policy update
```
POST {API_URL}/CRMApi/update_gurantor_required_user_detail
Content-Type: application/json
Authorization: Basic base64(API_EMAIL:API_PASSWORD:API_TOKEN)
```
Body: `{ TableID, CompanyID, AgencyID, UserID, TenantID, PolicyDocument, PolicyDocument_Base64, PaymentStatus }`.
Success: `{ response:"SUCCESS", message }`. Fail: `{ response:"FAIL", message }`. Reissued on policy-start-date update.

### 7.3 LIB → Opndoor: guarantor-required trigger (inbound)
```
POST {OPNDOOR_BASE}/GuarantorApi/save_guarantor_user_data
Content-Type: application/json
Authorization: Basic base64(agency_secret_token)
```
Body as described in §5.1 (includes `table_id`, `overall_status`, TransUnion + summary + review-summary reports as name + base64, full check breakdown, property/landlord/financial terms).
Response to LIB: `{ status:"success", message:"User sent to guarantor successfully." }` / `{ status:"error", message }`.

### 7.4 Third-party → Opndoor: application API (inbound)
```
POST {BASE_URL}/ApplicationApi/submit
Authorization: Bearer {APIKEY}
Content-Type: application/json
```
Body: `{ applications: [ { applicant{...}, property{...}, landlord{...}, financial{ rental_amount, share_percent, share_amount }, income{ credit_score, employment_type, employer_*, total_income, additional_income, additional_income_frequency } } ] }`.
Success: `{ status:true, message, application_ids:[{ applicant_id, applicant_name, applicant_email, eligibility_status }] }`.
Invalid: `{ status:false, message:"Invalid payload" }`.
Reads: `GET /ApplicationApi/applications`, `GET /ApplicationApi/applications/{id}` (§6.4).

### 7.5 Yoti (identity / AML / PEP / sanctions)
Opndoor calls **Yoti's API directly, authenticated with LIB-supplied credentials**. Opndoor does **not** hold its own Yoti contract. **LIB** supplies the credentials and the check ID / parameters at go-live; the check runs under LIB's Yoti account and the structured result is delivered into **LIB**, not returned into the Opndoor→LIB sync. Opndoor's responsibility is to initiate the session and render the branded ID-verification stage. This is a hard gate on the signup and agent flows — do not stub past it.

### 7.6 Kreditz (VeriBank open banking + VeriPay / Open Payroll)
Opndoor calls **Kreditz's API directly, authenticated with LIB-supplied credentials**, for both VeriBank (open banking) and VeriPay / Open Payroll. Opndoor does **not** hold its own Kreditz contract. **LIB** supplies the credentials, check ID and required parameters at go-live; the check runs under LIB's Kreditz account and the structured result is delivered into **LIB**, not returned into the Opndoor→LIB sync. The routing between VeriBank, VeriPay and manual upload is the decision rule in §3.5 (open-banking link by default; manual statement — which *is* forwarded to LIB as an uploaded file — when the applicant is overseas or cannot link; payroll when PAYE-only or evidencing Universal Credit).

### 7.7 Payments (Stripe) and e-signature
- **Processor: Stripe.** Two payment types exist across the platform:
  - **Eligibility payment** — Entry Points **1 and 2** only, taken before profile completion (configurable amount).
  - **Guarantee fee** — all flows that reach a policy; **equal to one month's rent**.
- **Per-entry-point payment structure:**
  - **Entry Point 1 (Signup)** and **Entry Point 2 (Agent):** two payments — eligibility payment, then guarantee fee.
  - **Entry Point 3 (Via Lettings)** and **Entry Point 4 (Via API):** a **single guarantee fee (one month's rent)**; no eligibility payment.
- **E-signature:** the platform **currently uses an in-house signature capture** (canvas capture; raw `.png` + base64). The rebuild should **integrate PandaDoc** to replace it, retaining the in-house capture as the documented current state until PandaDoc is live.

---

## 8. Canonical data model (minimum viable schema)

Derive tables from the LIB sync payload as the canonical shape:

- **users** — auth (email, hashed password, email_confirmed), title, gender, name parts, mobile, entry_point (`signup|agent|lettings|api`), account state, LIB `UserID` mapping.
- **applications** — links user↔property↔landlord; `reference_case`, `reference_type`, tenancy terms (start date, length, rental_amount, share_percentage, share_amount), overall status, LIB `table_id`/`TenantID`/`PropertyID`/`LandlordID` mappings, `payment_status`, signature dates, policy document.
- **tenants (referencing profile)** — adverse-credit block (CCJs count/value/date, bankruptcy date, IVAs date/value), dob, marital_status.
- **incomes** — one row per income source; all employment-type-dependent fields + `additional_income_*`; document references; `is_active`.
- **addresses** — 3-year history rows; residency type, proof, arrears, move-in month/year, in/out-UK flag.
- **right_to_rent** — category + nationality id.
- **properties** — address, `Detail` (house/postcode/city/lat/lng), property number.
- **landlords** — identity + address; link type (existing/new).
- **agencies** — company_id, agency_id, agency_number, agency_name, stored `agency_secret_token`.
- **documents** — typed file store (bank statement, tax return, P60, proof of address, TransUnion report, summary/review reports, policy document, signatures); store the filename and the binary; base64 is a transport encoding, not a storage format.
- **payments** — one row per Stripe payment; type (`eligibility|guarantee`), amount, status, Stripe reference, linked application.
- **third_party_api_keys** — issued Bearer keys, per `company_id`/`api_key_id`.
- **integration_events / audit** — every inbound/outbound LIB and vendor call, keyed on `table_id` and LIB IDs, for reconciliation.

---

## 9. Application state machine

Statuses observed in the source (implement as an explicit enum-backed state machine, not scattered booleans):

- **Overall application status:** `Pending` → `Passed` (LIB decision; `Failed` also reachable). LIB may also return **"Pass with guarantor"**, which routes into the guarantor flow (§5).
- **Payment status:** `Pending` → `Paid`, tracked **separately for the eligibility and guarantee payments** (model both; note Entry Points 3 and 4 carry only the guarantee payment).
- **Eligibility status (API flow):** `Eligible` / `Not eligible` / `Min criteria not met` / `Payment requested`.
- **Signature milestones:** tenant signature date → landlord/agent `landlord_signature_date` → policy document generated (`guarantee_start_date` set).

Transitions are gated: eligibility payment unlocks profile (flows 1–2); LIB Pass unlocks the guarantee payment; the guarantee payment unlocks signature; the final signature generates the policy document.

---

## 10. Authentication and security

Three distinct auth schemes coexist — all must be implemented:
1. **Opndoor → LIB:** HTTP Basic, `base64(email:password:token)` — a **triple-segment** credential, not standard user:pass. Implement exactly.
2. **LIB → Opndoor (inbound guarantor):** HTTP Basic, `base64(agency_secret_token)` — single stored secret per agency.
3. **Third-party → Opndoor:** `Bearer {APIKEY}`, per-consumer keys.

Plus: tenant/agent session auth (email + password, email-verification step), signed single-use links for payment and signature emails, Stripe webhook signature verification for payment confirmation, and secure handling of the large volume of PII and financial documents flowing through the system. All document transport uses base64 in JSON — enforce request-size limits and stream large payloads.

---

## 11. Environments and configuration

The source shows **three different hosts** — do not hard-code any:
- `admin.opndoor.co` — production admin/API host.
- `tenant.opndoor.sandboxwirewand.com` — tenant-facing / sandbox host (`SourceBaseURL` in the sync payload).
- `BASE_URL` / `API_URL` — placeholders for the third-party and LIB base URLs respectively.

Externalise: `OPNDOOR_BASE`, `API_URL` (LIB), LIB credentials (`API_EMAIL`, `API_PASSWORD`, `API_TOKEN`), per-agency `agency_secret_token`, **LIB-supplied Yoti credentials + check-id**, **LIB-supplied Kreditz credentials + check-id** (Opndoor holds no independent Yoti/Kreditz contract), Stripe keys/webhook secret, PandaDoc credentials, and the third-party `APIKEY` registry.

---

## 12. Stack

**Observed:** the endpoint convention `{host}/ControllerApi/method` (e.g. `CRMApi/save_all_tenant_data`, `GuarantorApi/save_guarantor_user_data`, `ApplicationApi/submit`) is the signature of a **CodeIgniter-style PHP application** with controller-method routing. If the objective is byte-for-byte parity of the public API surface, preserve these exact route strings regardless of the framework chosen.

**Recommendation for a rebuild:** you are not obliged to inherit CodeIgniter. A modern PHP (Laravel) or equivalent stack can expose the same route strings via explicit route definitions while giving you a cleaner domain model, queueing for the many outbound vendor/LIB calls, and first-class handling of the large base64 document payloads. Whatever the framework, keep the four entry points as separate bounded contexts sharing one canonical application/data model, and put every external call (Yoti, Kreditz, Stripe, PandaDoc, LIB) behind an interface so vendors can be swapped without touching the core.

---

## 13. Provisioning at go-live and known documentation defects

**Provisioned at go-live (configuration/secrets, not design unknowns):**
1. **Yoti (under LIB's account)** — **LIB-supplied** credentials, check ID, and check definition. Opndoor calls Yoti directly with these; it holds no independent Yoti contract, and Yoti results go to LIB (§7.5).
2. **Kreditz (under LIB's account)** — **LIB-supplied** credentials, check ID and parameters for VeriBank and VeriPay / Open Payroll. Opndoor calls Kreditz directly with these; it holds no independent Kreditz contract, and Kreditz results go to LIB (§7.6).
3. **LIB** — `API_EMAIL` / `API_PASSWORD` / `API_TOKEN`, per-agency `agency_secret_token`, and any check ID LIB's API requires.
4. **Stripe** — API keys and webhook signing secret.
5. **PandaDoc** — credentials/template configuration for the e-signature migration.
6. **Third-party APIKEY registry** — Bearer keys issued to referrers.

**Known documentation defects (trust the process document, not the spreadsheet):**
7. The spreadsheet labels a probationary-period branch ("length of the probationary period") under a question titled *"Are you subject to disciplinary action?"*. Per the process document, the child field *length of probationary period* belongs to the **"probationary period? (Yes/No)"** question; disciplinary action is a separate Yes/No/Don't-know with **no** downstream field. Implement per the process document.
8. The spreadsheet mislabels income type **8** as *"Unemployed or other income"*. Type 8 is **Zero-hours employee** (type 7 is Unemployed/other income). Implement per the process/selector list.
9. Endpoint spelling `update_gurantor_required_user_detail` is misspelled but **contractual** — preserve it exactly (§5.3).

**Implementation note to resolve:**
10. **API-flow "student" determination** (§6.2) — the submit payload has no `is_student` field and no "Student" value in the `employment_type` example set. Confirm how the third-party feed signals a student before wiring the income waiver, so the eligibility engine stays deterministic.

---

## 14. Suggested build sequence

1. Canonical data model + migrations (§8) and the state machine (§9).
2. Auth (all three schemes, §10) and environment config (§11).
3. Entry Point 1 form engine with full conditional logic (§3.4–3.5) — the largest single piece.
4. LIB outbound sync (§7.1) + ID-mapping persistence.
5. Entry Point 3 inbound (§7.3) + LIB update (§7.2) — self-contained, good early win.
6. Entry Point 4 submit + eligibility engine + reads (§6, §7.4) — deterministic once the student signal (§13.10) is settled.
7. Entry Point 2 agent flow (§4) — reuses most of Entry Point 1.
8. Stripe payments (eligibility + guarantee, §7.7) with webhook confirmation.
9. Vendor integrations (Yoti, Kreditz) — direct calls under **LIB-supplied credentials** — once those credentials/check-ids are provisioned (§13). Results go to LIB, not into the sync payload. Build behind interfaces from day one so this step is additive, not surgical.
10. E-signature: in-house capture first (current state), then PandaDoc integration.
11. Policy-document generation + delivery.
12. Admin/reconciliation views over the integration-events log.

---

*End of specification. Every flow, contract and rule above is buildable as written; §13 lists only the keys/parameters provisioned at go-live and the source-document defects to implement around.*
