# Operator Payment System — Product Specification & Integration Guide

**Version:** 1.0  
**Date:** April 2026  
**Product:** Pullman Bus · Operator Payment Dashboard  
**Prepared by:** Technology Team

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture & Responsibilities](#2-architecture--responsibilities)
3. [User Roles](#3-user-roles)
4. [Supervisor View — KonnectPro](#4-supervisor-view--konnectpro)
5. [Operator (Owner) View — KonnectPro](#5-operator-owner-view--konnectpro)
6. [Accountant View — app.pasajebus](#6-accountant-view--apppasajebus)
7. [Data Flows & State Machine](#7-data-flows--state-machine)
8. [API Reference](#8-api-reference)
9. [Financial Logic](#9-financial-logic)
10. [Shared Infrastructure](#10-shared-infrastructure)

---

## 1. System Overview

The Operator Payment System manages the end-to-end process of calculating, approving, and recording payments to bus operators (empresarios) for services rendered through Pullman Bus.

The process works as follows:

1. Operators run bus services that are tracked in **Konnect Pro**
2. A **Supervisor** reviews the daily production figures and approves or rejects payments per operator per day
3. An **Accountant** sees approved payments and records the bank transfer for each one
4. **Operators** can log in at any time to see their own payment status, production figures, and download a payment receipt

The system is currently a standalone web app deployed at `https://pago-terceros.vercel.app`. This document describes how to integrate each user-facing view into the corresponding internal platform.

---

## 2. Architecture & Responsibilities

### Integration map

| View | Current location | Target platform | Team responsible |
|---|---|---|---|
| **Supervisor** | pago-terceros.vercel.app | **KonnectPro** | KonnectPro team |
| **Operator (Owner)** | pago-terceros.vercel.app | **KonnectPro** | KonnectPro team |
| **Accountant** | pago-terceros.vercel.app | **app.pasajebus** | PasajeBus team |

### Shared backend

All three views consume the same API endpoints. The backend can be:
- **Option A:** Kept as Vercel Serverless Functions (current) — all platforms call the same API
- **Option B:** Migrated to Ruby on Rails inside one of the existing platforms — see `RAILS_INTEGRATION.md`

The recommended approach for a clean integration is **Option A** in the short term: keep the API on Vercel and embed each view inside its target platform via an iframe or by replicating the frontend code. In the medium term, migrate the backend to Rails as described in `RAILS_INTEGRATION.md`.

### Shared storage

All platforms share the same data store:

| Data | Storage | Key |
|---|---|---|
| Approvals (by operator + day) | Upstash Redis | `pullman_approvals_v2` |
| Activity log | Upstash Redis | `pullman_activity_v1` |
| Operator accounts | Upstash Redis | `pullman_operators_v1` |
| Payment receipts | Browser localStorage | `pb_payments_v2` |

> ⚠️ Payment receipts are currently stored in the browser's localStorage. This means they are tied to the device and browser where the accountant works. **For production, this must be migrated to Redis or a database.** See Section 8 for the recommended schema.

---

## 3. User Roles

The system has three roles. Each role sees a completely different interface.

### 3.1 Supervisor

- Internal Pullman Bus employee responsible for verifying and approving operator payments
- Has full visibility of all operators
- Can approve, reject, and re-approve payments
- Can create and delete operator (owner) accounts
- Can view the full activity log
- **Cannot** record bank transfers (deposit step)

### 3.2 Operator / Owner (Empresario)

- The bus owner — external user, not a Pullman employee
- Can only see their own data (filtered by their ENT code)
- Can select a date range and view their services, production figures, and payment status
- Can download a PDF payment statement
- **Cannot** see other operators' data
- **Cannot** approve or reject anything

### 3.3 Accountant (Contable)

- Internal Pullman Bus finance employee
- Can see all operators with approved payments
- Records the bank transfer (enters the transfer reference number)
- Can view receipts of past deposits
- **Cannot** approve or reject payments (that is the supervisor's responsibility)
- **Cannot** see the activity log or manage operator accounts

### Credential management

| Role | Where credentials are stored | Who manages them |
|---|---|---|
| Supervisor | Environment variables (`SUPERVISOR_USER`, `SUPERVISOR_PASS`) | System administrator |
| Accountant | Environment variables (`CONTABLE_USER`, `CONTABLE_PASS`) | System administrator |
| Operator | Upstash Redis (`pullman_operators_v1`) | Supervisor — via the Operator Accounts panel |

---

## 4. Supervisor View — KonnectPro

### Where to integrate

This view should live inside the KonnectPro platform, accessible to Pullman Bus supervisors from the main navigation. Suggested menu entry: **"Operator Payments"** under the Finance or Operations section.

### What the supervisor sees on login

The system automatically loads today's date range and applies the **"Pending"** filter, so the supervisor immediately sees only the operators that require attention — no manual searching needed.

---

### 4.1 Header

The header contains the following controls from left to right:

| Element | Description |
|---|---|
| **Pullman Bus logo / brand** | Visual identity, not interactive |
| **Username + role badge** | Shows who is logged in and their role ("Supervisor" in blue) |
| **FROM date input** | Start of the date range to query |
| **TO date input** | End of the date range. Cannot be earlier than FROM |
| **Load button (⟳)** | Fetches data from Konnect Pro for the selected range and loads approvals from Redis |
| **✓ Approve All button** | Approves all pending days for all visible operators in one action (see 4.4) |
| **⏱ Activity button** | Opens the activity log panel (see 4.5) |
| **👥 Operators button** | Opens the operator account management panel (see 4.6) |
| **ES / EN toggle** | Switches the UI language between Spanish and English. Persists in localStorage |
| **⎋ Sign out** | Triggers the session summary modal before logging out (see 4.7) |

---

### 4.2 Summary Bar

Displayed below the header after data is loaded. Shows aggregated totals for all operators currently visible (respects active filters).

| Column | Description |
|---|---|
| **Total Production** | Sum of gross production across all services in the range |
| **Commission** | Sum of commissions deducted by Pullman Bus |
| **Expenses** | Sum of operational expenses (pending — column not yet in Konnect API) |
| **Aramco** | Sum of fuel charges from Aramco API (shows $0 until API is connected) |
| **Total to Pay** | `totalNeto (Konnect) − Aramco` — the actual amount operators will receive |
| **Operators** | Number of operators currently visible (respects filters) |
| **Services** | Total number of individual trips/services in the range |
| **Period** | The date range currently loaded (e.g. `15/03/2026 → 20/03/2026`) |

---

### 4.3 Toolbar / Filters

Below the summary bar, above the operator list.

| Element | Description |
|---|---|
| **Search input** | Filters the operator list in real time by name, ENT code, or tax ID (RUT) |
| **All** filter pill | Shows all operators regardless of payment status |
| **Pending** pill | Shows only operators with at least one day pending approval *(default on login)* |
| **Approved** pill | Shows operators where all days in the range are approved |
| **Partial** pill | Shows operators with a mix of statuses (some approved, some pending or rejected) |
| **Rejected** pill | Shows operators where all days are rejected |
| **Paid** pill | Shows operators where all days have been deposited |
| **Hide without trips toggle** | When on, hides operators that have zero services in the selected range |

---

### 4.4 Operator Cards

Each operator appears as a card. Cards are collapsed by default; clicking anywhere on the card header expands it.

#### Card header (collapsed state)

| Element | Description |
|---|---|
| **Initials avatar** | First letter of first and last name, colored in brand coral |
| **Operator name** | Full name as it appears in Konnect Pro |
| **ENT code** | The operator's unique identifier (e.g. ENT-03041) |
| **Tax ID (RUT)** | The operator's tax identification number |
| **Service count** | Number of services in the selected range (highlighted in blue if > 0) |
| **⚠ Overdue badge** | Appears in amber if there are days with pending payment that are earlier than today |
| **Production** | Gross production total for the range |
| **Commission** | Commission total for the range |
| **Expenses** | Expenses total (shows — until Konnect provides the column) |
| **Aramco** | Aramco charges total (shows — until API is connected) |
| **Total to Pay** | Final net amount = totalNeto − Aramco |
| **Services count** | Number of services (same as above, shown again in stats) |
| **Status badge** | Overall status: Pending / Approved / Partial / Rejected / Paid |
| **Deposit range button** | *(Visible to accountant only — see Section 6)* |

#### Card expanded state (day breakdown)

When a card is expanded, a section per day appears. Each day shows:

| Element | Description |
|---|---|
| **Date** | The date of services (DD/MM/YYYY) |
| **Prod.** | Gross production for that day |
| **Expenses** | Expenses for that day (— until available) |
| **Aramco** | Aramco charge for that day (shown in red if > 0) |
| **Total** | Final net for that day = dayNeto − dayAramco |
| **Svc** | Number of services on that day |
| **Status badge** | Per-day status: Pending / Approved / Rejected / Paid |

#### Supervisor action buttons (per day)

| Status | Buttons shown | What they do |
|---|---|---|
| Pending | **✓ Approve** + **✕ Reject** | Opens a confirmation modal, then saves the decision to Redis |
| Approved | **Reject** + info "Approved by [name]" | Allows reversing an approval if a mistake was made |
| Rejected | **Approve** | Allows approving after a previous rejection |
| Paid | "✓ Deposited" label | No actions — payment is final |

Each approval/rejection is saved to Redis with the key `ENT-XXXXX__YYYY-MM-DD` and includes who made the decision and when.

#### Service detail table (within each day)

Clicking any day section expands a ▶ chevron and shows a table of individual services:

| Column | Data source |
|---|---|
| Time | Departure time |
| Route | Origin → Destination |
| Service | Full service name from Konnect |
| Bus · Plate | Bus number and license plate |
| Status | Konnect status (Recaudado / Completados / etc.) |
| Seats | Seats sold at the branch (Sucursal) |
| Production | Gross production for this service |
| Commission | Commission for this service |
| Net Total | Net for this service (included in totalNeto) |

A totals row appears at the bottom of each day's table.

---

### 4.5 Approve All Button

When the supervisor clicks **✓ Approve All**:

1. The system scans all visible operators for days with `pending` status
2. A confirmation modal appears showing:
   - How many payments will be approved
   - The total amount across all of them
3. If confirmed, the system approves each pending day sequentially, saving each to Redis
4. A toast notification confirms how many were approved
5. The cards re-render to reflect the new statuses

This button is only visible to supervisors and only when there are pending payments in the current view.

---

### 4.6 Activity Log Panel

The **⏱ Activity** button opens a slide-in panel from the right showing the last 100 actions logged across all users.

Each entry shows:

| Field | Description |
|---|---|
| **Icon** | ✓ green for approved, ✕ red for rejected, 💳 blue for paid/deposited |
| **Operator name + ENT code** | Who the action was performed for |
| **Status badge** | Approved / Rejected / Deposited |
| **Date of service** | Which day's payment was affected |
| **Amount** | The net amount involved |
| **Performed by** | Username of who took the action |
| **Timestamp** | Date and time the action was recorded |

The log stores a maximum of 500 entries (oldest are dropped automatically). It is **shared** between supervisor and accountant — all actions from both roles appear here.

---

### 4.7 Operator Account Management Panel

The **👥 Operators** button (supervisor only) opens a panel to manage operator login accounts.

#### Create operator account form

| Field | Description |
|---|---|
| **Username** | The login username the operator will use |
| **Password** | The operator's password (stored in Redis — recommend changing to hashed in production) |
| **ENT Code** | Must match exactly the ENT-XXXXX code in Konnect Pro (e.g. ENT-03041) |
| **Full Name** | Must match the "Razón Social" (company name) as it appears in Konnect Pro reports. This is used to filter the operator's services |

Click **Create account** to save. The operator can log in immediately.

#### Operator list

Shows all existing operator accounts with their name, ENT code, and username. Each has a **Remove** button that deletes the account from Redis after a confirmation modal.

---

### 4.8 Session Summary (Logout)

When the supervisor clicks **⎋ Sign out**, a modal appears showing a summary of today's activity before closing the session:

| Section | Description |
|---|---|
| **✓ Approved today** | How many operators were approved in this session and the total amount |
| **✕ Rejected today** | How many operators were rejected |
| **⚠ Still pending** | How many operators still have unapproved days (warning if > 0) |

Buttons: **Cancel** (stays logged in) or **Sign out** (clears session and returns to login).

---

## 5. Operator (Owner) View — KonnectPro

### Where to integrate

This view should be available inside KonnectPro for authenticated bus owner users. Suggested entry point: a dedicated **"My Payments"** or **"Payment Status"** section visible only to users with the operator role.

Alternatively, operators can access it via a separate URL with their own login (the current `/` route of the standalone app already handles this).

---

### 5.1 Header

| Element | Description |
|---|---|
| **Pullman Bus branding** | Logo and "Operator Portal" subtitle |
| **Operator name** | The operator's full name (center of header) |
| **ENT code** | Their unique operator code (below the name) |
| **FROM / TO date inputs** | Select the date range to view |
| **Load button (⟳)** | Fetches services for this operator in the selected range |
| **⬇ PDF button** | Generates and downloads a PDF payment statement (see 5.5) |
| **ES / EN toggle** | Language switcher |
| **⎋ Sign out** | Logs out immediately (no summary modal for operators) |

---

### 5.2 Summary Cards

Five cards displayed at the top:

| Card | Value | Color |
|---|---|---|
| **Gross Production** | Total revenue from all services in the range | Dark (neutral) |
| **Commission** | Amount retained by Pullman Bus | Red |
| **Fuel (Aramco)** | Fuel charges to be deducted | Red |
| **Total to Receive** | `totalNeto − Aramco` — highlighted card in green | Green |
| **Services** | Number of services in the range | Blue |

Below Gross Production and Total to Receive, a comparison badge shows the percentage change vs. the equivalent previous period (e.g. if viewing 5 days, it compares to the 5 days before):

- `+X% vs prev` in green — production increased
- `-X% vs prev` in red — production decreased

---

### 5.3 Payment Status by Day

A list of all days in the selected range that have services, showing the payment progress:

#### Day row (collapsed)

| Element | Description |
|---|---|
| **▶ chevron** | Click to expand/collapse the service detail table for that day |
| **Date** | DD/MM/YYYY |
| **Prod.** | Gross production for the day |
| **Net** | Net amount for the day (after commission and Aramco) |
| **Svc** | Number of services on that day |
| **Status badge** | Pending / Approved / Rejected / Paid |
| **Ref: XXXXXXXXX** | *(Only when Paid)* The bank transfer reference number recorded by the accountant |
| **✓ Approved by [name]** | *(Only when Approved)* Who approved it and their username |

#### Day row (expanded — ▼)

Shows a table with one row per service:

| Column | Description |
|---|---|
| Time | Departure time |
| Route | Origin → Destination |
| Service | Full service description |
| Bus · Plate | Bus unit and license plate |
| Status | Konnect status |
| Seats | Seats sold |
| Production | Gross for this service |
| Commission | Commission for this service |
| Net Total | Net for this service |

A totals row appears at the bottom of the table.

---

### 5.4 Period Metrics

Three metric cards in the right column:

| Metric | How calculated |
|---|---|
| **Most used bus** | The bus (unit number + plate) that appears in the most services in the range |
| **Most productive route** | The Origin → Destination pair with the highest total net revenue |
| **Avg seats sold / service** | Total seats sold ÷ total number of services |

---

### 5.5 Daily Net Revenue Chart

A line chart showing net revenue per day across the selected range. The X axis shows dates, the Y axis shows amounts in CLP. A green area fill makes trends easy to read at a glance.

---

### 5.6 PDF Payment Statement

Clicking **⬇ PDF** generates a PDF document in the browser (no server required, uses jsPDF) and downloads it automatically. The filename format is:

```
PullmanBus_ENT-XXXXX_YYYY-MM-DD_to_YYYY-MM-DD.pdf
```

The PDF contains:

#### Page 1

| Section | Content |
|---|---|
| **Header bar** | Coral background with "PULLMAN BUS" title and "Operator Payment Statement" subtitle, plus print date |
| **Operator info** | Operator name, ENT code, and selected period |
| **Financial summary box** | Four columns: Gross Production / Commission / Fuel (Aramco) / Total to Receive — with service count |
| **Payment status by day** | One row per day: date, service count, production, net amount, status pill (color coded), transfer reference if paid |
| **Service detail table** | All services: date, time, origin→destination, bus, status, seats, production, commission, net total (max 40 rows, with "...and N more" note if exceeded) |
| **Footer** | "Pullman Bus · Confidential · Page X/Y" on every page |

---

## 6. Accountant View — app.pasajebus

### Where to integrate

This view should live inside **app.pasajebus** under the admin section, accessible to finance users. Suggested navigation entry: **"Operator Payments"** under Finance or Accounting.

The accountant view is essentially the same dashboard as the supervisor view, but with all approval controls removed and deposit controls enabled. The key difference: **the accountant records transfers, the supervisor approves them.**

---

### 6.1 Header

Same layout as the supervisor header, with these differences:

| Element | Accountant behavior |
|---|---|
| **Role badge** | Shows "Contable" (in orange) instead of "Supervisor" |
| **✓ Approve All** | **Hidden** — accountants cannot approve |
| **👥 Operators** | **Hidden** — accountants cannot manage accounts |
| **⏱ Activity** | Visible — accountants can view the log |

---

### 6.2 Summary Bar

Same as supervisor — shows totals for all visible operators.

---

### 6.3 Filters

Same filter pills as supervisor, with one behavioral difference:

**On login, the default filter is "Approved"** — the accountant immediately sees only operators with approved payments ready to deposit. No manual filtering needed.

---

### 6.4 Operator Cards

Same card structure as supervisor view. In the card header, when there are approved-but-not-yet-deposited days:

#### "Deposit Range" button (card header, collapsed state)

A blue **"Deposit approved"** button appears in the card header when one or more days are approved and not yet deposited. Clicking it:

1. Opens a confirmation modal showing:
   - How many days will be deposited
   - The total amount across all approved days
   - The list of dates
2. A required field: **Transfer / Reference Number** — the bank transfer ID
3. Clicking **Confirm deposit** saves all days as paid, each with the same reference number, the accountant's username, who approved it, and a timestamp

#### Per-day deposit button (expanded state)

Inside each expanded day, if that day is approved, the accountant sees:

| Element | Description |
|---|---|
| **✓ [supervisor name]** | Reminder of who approved this day |
| **Deposit button** | Opens the deposit confirmation modal for this single day |

The deposit modal for a single day includes:
- The operator name
- The date
- The net amount (formatted prominently in green)
- A note showing who approved it
- A required **Transfer / Reference Number** field

#### After depositing — "View receipt ↗" button

Once a day is marked as paid, the per-day button changes to **"View receipt ↗"**. Clicking it opens a detail modal showing:

| Field | Content |
|---|---|
| Operator | Name of the operator |
| Service date | The date of services paid |
| Total paid | The final net amount deposited |
| Konnect Net | The totalNeto from Konnect (before Aramco deduction) |
| Aramco deduction | The Aramco charge that was subtracted (if any) |
| Transfer No. | The bank reference number entered by the accountant |
| Deposited by | The accountant's username |
| Approved by | The supervisor's username |
| Deposit date | Date and time the deposit was recorded |

---

### 6.5 Session Summary (Logout)

When the accountant clicks **⎋ Sign out**, a summary modal shows:

| Section | Description |
|---|---|
| **💳 Deposited today** | How many deposits were recorded in this session and the total amount |
| **⏳ Approved but not deposited** | How many operators still have approved-but-undeposited days (reminder to check before leaving) |

If everything is deposited, the second row does not appear. Buttons: **Cancel** or **Sign out**.

---

## 7. Data Flows & State Machine

### Payment lifecycle per operator per day

```
                    SUPERVISOR                         ACCOUNTANT
                        │                                   │
Services exist    ──► PENDING ──► [Approve] ──► APPROVED ──► [Deposit + Ref#] ──► PAID
in Konnect               │                          │
                    [Reject]                   [Reject]
                         │                          │
                       REJECTED ◄──────────────────┘
                         │
                    [Re-approve]
                         │
                       APPROVED ──► ...
```

**Rules:**
- Only supervisors can move: `pending → approved`, `approved → rejected`, `rejected → approved`
- Only accountants can move: `approved → paid`
- `paid` is a terminal state — no further actions are possible on a paid day
- Approvals are stored in Redis (shared, real-time)
- Payment records are stored in localStorage (device-local — migrate to Redis for production)

### Key identifiers

All records use the composite key format:

```
{ownerCode}__{YYYY-MM-DD}
Examples:
  ENT-03041__2026-03-23
  ENT-03028__2026-04-01
```

---

## 8. API Reference

All views consume the same 5 endpoints. The base URL depends on where the backend is deployed (current: `https://pago-terceros.vercel.app`).

All endpoints (except `/api/auth`) require the header:
```
X-Session-Token: <JWT>
```

---

### POST `/api/auth`

**Purpose:** Validates credentials and returns a JWT token with the user's role.

**Request body:**
```json
{ "username": "supervisor", "password": "secret" }
```

**Response:**
```json
{
  "ok": true,
  "token": "<jwt>",
  "role": "supervisor",
  "ownerCode": null,
  "operatorName": null
}
```

For operator accounts, `ownerCode` and `operatorName` are populated:
```json
{
  "ok": true,
  "token": "<jwt>",
  "role": "empresario",
  "ownerCode": "ENT-03041",
  "operatorName": "Jetsur"
}
```

JWT payload includes: `sub` (username), `role`, `iat`, `exp` (8 hours), and optionally `ownerCode` and `operatorName`.

---

### GET `/api/proxy?path=<konnect_path>`

**Purpose:** Forwards requests to Konnect Pro without exposing API keys to the browser.

**How it works:** The `path` parameter is URL-encoded and contains the full Konnect endpoint including its query string. The server adds the Konnect credentials and forwards the request.

**Allowed paths (whitelist):**
```
/api/v2/users
/api/v2/reports/render_report/
```

Any other path returns 403.

**Used for:**
- Fetching the list of operators: `GET /api/v2/users?page=N&items=25&filter_user_type=1&filter_user_type=3`
- Fetching service reports: `GET /api/v2/reports/render_report/1532?page_limit=0-500&date_range=4&from_date=DD/MM/YYYY&to_date=DD/MM/YYYY&date_wise=1`

**Important Konnect parameters:**
- `date_range=4` — fixed value that activates date-filter mode. Must not change.
- `from_date` / `to_date` — format `DD/MM/YYYY`, no double URL-encoding
- `page_limit=0-500` — returns up to 500 rows per request. Auto-paginates if total > 500.

---

### GET `/api/approvals`

**Purpose:** Returns all approval records from Redis.

**Response:**
```json
{
  "ok": true,
  "approvals": {
    "ENT-03041__2026-03-23": { "status": "approved", "by": "supervisor", "at": "2026-03-23T14:30:00Z" },
    "ENT-03041__2026-03-24": { "status": "rejected", "by": "supervisor", "at": "2026-03-24T09:00:00Z" }
  }
}
```

### POST `/api/approvals`

**Purpose:** Creates or updates an approval record. **Supervisor only.**

**Request body:**
```json
{ "key": "ENT-03041__2026-03-23", "action": "approved" }
```

Valid actions: `"approved"`, `"rejected"`, `"pending"`

---

### GET `/api/activity?limit=100`

**Purpose:** Returns the last N activity log entries, newest first.

**Response:**
```json
{
  "ok": true,
  "entries": [
    {
      "action": "approved",
      "code": "ENT-03041",
      "isoDate": "2026-03-23",
      "amount": "$71,750",
      "name": "Jetsur",
      "by": "supervisor",
      "role": "supervisor",
      "at": "2026-03-23T14:30:00Z"
    }
  ]
}
```

### POST `/api/activity`

**Purpose:** Appends an action to the log. Called automatically by the frontend on every approve, reject, and deposit action.

---

### GET `/api/aramco?from=YYYY-MM-DD&to=YYYY-MM-DD`

**Purpose:** Returns Aramco fuel charges per operator per day.

**Current state:** Returns empty data (stub) until the Aramco API is connected.

**Expected response when connected:**
```json
{
  "ok": true,
  "data": {
    "ENT-03041__2026-03-23": 12500,
    "ENT-03041__2026-03-24": 8000
  },
  "source": "aramco_api"
}
```

**To connect the real API:** Set `ARAMCO_API_URL` and `ARAMCO_API_TOKEN` environment variables. The server will call `GET {ARAMCO_API_URL}/charges?from={from}&to={to}` and expects an array of `{ ownerCode, date, amount }` objects.

---

### GET/POST/DELETE `/api/operators`

**Purpose:** Manages operator login accounts. **Supervisor only.**

- `GET /api/operators` — returns list of all operator accounts (passwords excluded)
- `POST /api/operators` — creates an account: `{ username, password, ownerCode, name }`
- `DELETE /api/operators?username=X` — removes an account

---

## 9. Financial Logic

All financial calculations happen in the **browser** (frontend). The backend only stores and retrieves data.

### Formula

```
Total to Pay = totalNeto (from Konnect) − Aramco charge
```

### Data sources

| Field | Source | Notes |
|---|---|---|
| `produccion` | Konnect `data_body[16]` | Gross production |
| `comision` | Konnect `data_body[17]` | Commission retained by Pullman |
| `gastos` | Konnect `data_body[?]` | **Pending** — column not yet in Konnect API |
| `totalNeto` | Konnect `data_body[18]` | Net after commission. Already includes expenses when Konnect adds the column |
| `aramco` | `/api/aramco` response | External charge per operator per day |
| **Final Total** | `totalNeto − aramco` | Amount the operator receives |

### When Konnect adds the expenses column

1. Update `COL.gastos` in `script.js` with the correct column index
2. Uncomment the line `gastos += parseMoney(r[COL.gastos])` in the `calcStats()` function
3. No other changes required — the UI already displays the field

### Comparison vs previous period

When the operator loads a date range of N days, the system automatically fetches the N days immediately before the range start and calculates the percentage change in gross production and net total. This powers the `+X% vs prev` badges.

---

## 10. Shared Infrastructure

### Environment variables

| Variable | Used by | Description |
|---|---|---|
| `APP_SECRET` | All endpoints | JWT signing secret. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SUPERVISOR_USER` | `/api/auth` | Supervisor username |
| `SUPERVISOR_PASS` | `/api/auth` | Supervisor password |
| `CONTABLE_USER` | `/api/auth` | Accountant username |
| `CONTABLE_PASS` | `/api/auth` | Accountant password |
| `KONNECT_BEARER_TOKEN` | `/api/proxy` | Konnect Pro bearer token (expires — must be rotated when it does) |
| `KONNECT_API_KEY` | `/api/proxy` | `QHH79qF2fsWEx98pvNeZpQ` |
| `UPSTASH_REDIS_REST_URL` | `/api/approvals`, `/api/activity`, `/api/operators` | Auto-injected by Vercel when Upstash is connected |
| `UPSTASH_REDIS_REST_TOKEN` | Same | Auto-injected |
| `ARAMCO_API_URL` | `/api/aramco` | Base URL of Aramco API — leave empty until available |
| `ARAMCO_API_TOKEN` | `/api/aramco` | Auth token for Aramco API — leave empty until available |

### Rotating the Konnect bearer token

When the Konnect token expires, data loading will fail with an authentication error. To update it:

1. Obtain a new bearer token from Konnect Pro (login → developer tools → copy the Authorization header)
2. Go to Vercel → Settings → Environment Variables → `KONNECT_BEARER_TOKEN` → Edit
3. Paste the new token → Save
4. Go to Deployments → latest → Redeploy

### Rotating APP_SECRET (emergency)

If credentials are compromised:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Update `APP_SECRET` in Vercel → Redeploy. This immediately invalidates all active sessions across all roles.

### Recommended production upgrades

| Item | Current state | Recommended |
|---|---|---|
| Payment receipts | Browser localStorage | Redis or database (cross-device) |
| Operator passwords | Plaintext in Redis | Bcrypt-hashed |
| Sessions | JWT in sessionStorage | Same (acceptable for internal tools) |
| Konnect token rotation | Manual | Automated refresh or alert when nearing expiry |
| Aramco integration | Stub ($0) | Connect real API once endpoint is available |
