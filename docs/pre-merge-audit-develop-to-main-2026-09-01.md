# Pre-merge audit: `develop` → `main` (production)

**Date:** 1 September 2026  
**Auditor:** Cursor (agent review of git history and diffs; no automated test run)  
**Purpose:** Decide whether merging `develop` into `main` is safe for production.

This document covers three repos that must be considered together:

| Repo | Path | Role |
|---|---|---|
| **LWMServer** | `C:\Users\souki\OneDrive\Bureau\eyaa\LWMServer` | API / production backend |
| **client-lwm** | `C:\Users\souki\OneDrive\Bureau\eyaa\client-lwm` | Public website |
| **bo-lwm** | `C:\Dev\bo-lwm` | Back office |

---

## Verdict

**Not safe to merge as-is.**

| Repo | Ahead of `main` | Merge to prod? |
|---|---|---|
| **LWMServer** | 11 commits | **Hold** until the conversion CSV is removed from git and the public site is deployed in the same window |
| **client-lwm** | 12 commits | **Hold** until paired with LWMServer; revert the LAN `.env` change so it cannot affect a local/prod mix-up |
| **bo-lwm** | ~367 commits | **Do not merge in this release.** Separate, larger audit required |

Coupon, Meta ads, and SEO item-description work on **server + public site** are aligned with each other. The remaining issues are operational (CSV in git, coupon migration, BO size), not “the coupon APIs don’t match.”

**Do not push any repo to `main` until the blockers in section 4 are done.**

---

## 1. Scope of this audit

Checked:

- Branch tips vs `origin/main` (fetched 1 Sep 2026)
- Commit lists and file diffs `origin/main...origin/develop`
- Auth on new SEO routes
- Exit-intent coupon client/server pairing
- Checkout coupon vs 10% stacking
- Accidental secrets / PII in the diff
- Whether BO `develop` is the same size of change

Not checked:

- Full test suite / staging smoke test
- Production env vars (`SEO_AGENT_ENABLED`, Claude, GSC, Meta Pixel IDs)
- Live unused exit-intent coupons currently in MongoDB

---

## 2. LWMServer (`develop` vs `main`)

**Status:** `develop` = `origin/develop` @ `18a2a75`, working tree clean.  
**`main`:** `b980b68` (21 Aug 2026) — “Add Paid Search Terms Analytics”.  
**Diff size:** 37 files, +1616 / −136.

### 2.1 Commits to merge

| Date | Hash | Summary |
|---|---|---|
| 24 Aug | `feeb6fa` | Do not stack Outside/AnyTime 10% with a coupon |
| 24 Aug | `3cd6358` | SEO indexation / GSC inspect |
| 24 Aug | `23ea760` | SEO URL normalisation for inspect |
| 24 Aug | `0ae97c2` | SEO blog draft from a free-form idea |
| 25 Aug | `16e64e3` | GA4 traffic sync + Direct source |
| 25 Aug | `e5d901d` | Microsoft offline conversions timezone |
| 26 Aug | `c9669b9` | Meta ads (`fbclid`) |
| 27 Aug | `ed26909` | Teach free email domains from Business Customers |
| 28 Aug | `00742b8` | Exit-intent: 5-minute clock after scratch |
| 1 Sep | `ff84728` | SEO item description generate/apply + conversion CSV (accidental) |
| 1 Sep | `18a2a75` | Merge `develop` into itself |

### 2.2 What is fine to ship (after blockers)

- **Coupon / 10% no-stack** on price calc, invoices, payment emails. Checkout on the public site does the same.
- **`fbclid` stored on tasks/quotes.** Client already appends it on checkout and quote.
- **GA4 Direct sync** is a **script**, not a new cron. It will not run by itself on deploy.
- **Free-email-domain** PATCH is Admin-authenticated (`isAuth` + `checkRole('Admin')`).
- **SEO generate / apply / idea drafts / URL inspect** are Admin-only (`routes/seo.js`). Claude off → 503, no stub copy.
- **Apply overwrites live `StandardItem.description`.** Intended. Not a draft. Admins can change live catalogue copy.

### 2.3 Findings (LWMServer)

#### Blocker — Microsoft Click IDs committed to git

- **File:** `exports/microsoft-offline-conversions-2026-08-25.csv`
- **Introduced in:** `ff84728` (bundled with SEO item descriptions)
- **Risk:** Advertising click IDs in the repository. Should not go to `main`.
- **Action:** Remove the file from the branch; add `exports/` (or `*.csv` under exports) to `.gitignore`. Keep generating the file locally / on the server only.

#### Blocker — Exit-intent behaviour change

Unused public codes used to last **24 hours**. After this deploy:

- New codes expire **5 minutes** after mint/reveal.
- `Coupon.validateCoupon` rejects exit-intent codes with `mintedForIp` set and `revealedAt` missing (“not been unlocked yet”).
- Codes already issued (24h, never scratched in the new UI) will fail at checkout until the visitor scratches again (reuse path starts the 5-minute clock).

**Must deploy public site `develop` in the same window** (site first, or both at once). Server-only deploy will break the current prod popup.

#### Watch — Live catalogue writes

`POST /seo/agent/item-descriptions/:id/apply` writes the live item description. Preview is not persisted until Apply. Confirm Admins know this before using it in prod.

#### Not a merge blocker

- `POST /coupons/` still has no `isAuth` — **pre-existing**, not introduced in this delta.
- `GET /tasks/business-customers` still unauthenticated on the route file — **pre-existing**.
- Keyword highlighting requires Claude to return keywords that actually appear in the text; otherwise generate fails (explicit, no fallback).

---

## 3. client-lwm (`develop` vs `main`)

**Status:** `develop` = `origin/develop` @ `6c13192`.  
**Diff size:** 20 files, +2428 / −889.

### 3.1 Commits to merge

| Date | Hash | Summary |
|---|---|---|
| 24 Aug | `4431d1c` | 10% does not stack with coupons |
| 26 Aug | `d5ca9c3` | Meta Pixel conversion tracking |
| 28 Aug | `d7f8a50` | Exit-intent scratch/reveal, path gating |
| 31 Aug | `3e6b81b` | Popup only for non-direct (ads/referrer) traffic |
| 31 Aug | `946fb53` | UK postcode / M25 check on checkout and quote |
| 1 Sep | `129232d` | Fix Microsoft UET purchase conversions never sent |
| 1 Sep | `ec74684` | Google Ads enhanced conversions user-data keys |
| 1 Sep | `83c1ed5` | Mobile idle for popup 15s → 30s |
| — | merge commits | `develop` merged into itself |

### 3.2 Pairing with LWMServer — **aligned**

| Server | Public site |
|---|---|
| `GET /api/coupons/exit-intent/status` | Called when the popup opens (does not mint) |
| `POST /api/coupons/exit-intent` | Called on **scratch**; 5-minute clock starts |
| `POST /api/coupons/exit-intent/reveal` | **Unused** on the site. Fine: mint-on-scratch sets `revealedAt` |
| Coupon vs 10% | Checkout skips time discount when a coupon is applied |
| `fbclid` on task/quote | `appendMetaAdsClickIdsToFormData` on checkout and quote |

Exit-intent popup is limited to home + services and **marketing traffic** (UTM / gclid / fbclid / msclkid / external referrer). Direct URL/bookmark visitors do not see it.

### 3.3 Findings (client-lwm)

#### Hold — `.env` points at a LAN API

Diff vs `main` changes:

- from `VITE_API_BASE_URL="http://localhost:3000"`
- to `VITE_API_BASE_URL="http://192.168.1.73:3000"`

Production builds should use CI / host env, not this file. Still **do not merge this change**; revert to localhost (or leave `main` as-is) so nobody ships a LAN URL by mistake.

#### Product (not a code bug)

- M25 postcode restriction goes live with this merge. Confirm that is intended for prod.
- Sitemap.xml is a large rewrite in the same delta.

#### Pairing risk

If **only** the site is merged, it will call `/exit-intent/status` which **does not exist on current prod API** → popup errors.  
If **only** the server is merged, current prod site still mints on the old 24h model against the new 5-minute rules → checkout/popup breakage.

---

## 4. Required before merge

1. **LWMServer:** delete `exports/microsoft-offline-conversions-2026-08-25.csv` from `develop` (and stop tracking `exports/`).
2. **client-lwm:** revert `.env` `VITE_API_BASE_URL` off `192.168.1.73`.
3. **Deploy order:** public site + API in the **same window** (prefer site then API, or both together). Do not leave one on `main` and the other on `develop` behaviour.
4. **Optional but recommended:** in Mongo, unused exit-intent coupons with `mintedForIp` and no `revealedAt` — either leave them to fail until re-scratch, or backfill `revealedAt` / keep old 24h `expiresAt` for codes already in the wild.
5. **BO:** do **not** include `bo-lwm` `develop` → `main` in this release.

---

## 5. bo-lwm (out of this release)

`develop` is about **367 commits** ahead of `main`. It includes SEO item-description UI (needed later for the new API), plus routes, tipping, live tracker, analytics, and more.

Shipping BO `develop` now is a **different, much larger production event**. Audit it separately. Until then, old BO still works with the new API for additive SEO endpoints (they simply won’t show the new screens). Exit-intent and checkout live on the **public site**, not BO.

---

## 6. Suggested production test plan (after blockers, before/just after merge)

- [ ] Popup does **not** appear on a direct visit to `/`
- [ ] Paid/referred visit: popup → scratch → code visible → 5-minute timer
- [ ] Paste code at checkout; 20% applies; Outside/AnyTime 10% does **not** also apply
- [ ] Second scratch same IP within 24h: already-claimed message
- [ ] Checkout / quote from a `fbclid=` URL stores `fbclid` on the task
- [ ] M25 postcode: invalid postcode blocked; in-area still books
- [ ] Payment success: Microsoft UET and Meta Pixel purchase fire once
- [ ] BO (current prod): existing pages still load (SEO Apply not required for this release)
- [ ] Confirm production client build API host is the real API, not `192.168.1.73`

---

## 7. Summary table

| Finding | Severity | Repo | Merge impact |
|---|---|---|---|
| Conversion CSV with Microsoft Click IDs in git | High | LWMServer | **Block** until removed |
| Exit-intent 24h → 5 min; must pair with public site | High | LWMServer + client-lwm | **Block** unpaired merge |
| Client `.env` LAN API URL | Medium | client-lwm | **Block** that file from `main` |
| Existing unused 24h codes fail until re-scratch | Medium | both | Accept or backfill |
| Apply writes live catalogue descriptions | Low (ops) | LWMServer | Document for Admins |
| BO `develop` is ~367 commits | High if included | bo-lwm | **Exclude** from this merge |
| Coupon/10% no-stack, fbclid, SEO Admin APIs | OK | paired repos | Safe once blockers cleared |

**After items 1–3 in section 4:** merging **LWMServer `develop` and client-lwm `develop` into their respective `main` branches together is the intended production release.** Merging either alone, or merging **bo-lwm `develop`**, is **not** safe.
