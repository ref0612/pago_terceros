# Pullman Bus · Operator Payment Dashboard

Web dashboard for managing and processing commission payments to bus operators.  
Built with Vanilla JS + Vercel Serverless Functions + Upstash Redis.

**Live:** https://pago-terceros.vercel.app  
**Repo:** https://github.com/ref0612/pago_terceros

---

## Project Structure

```
pago_terceros/
├── index.html          ← Full UI (login + app)
├── script.js           ← Frontend logic (~1100 lines)
├── i18n.js             ← ES / EN translations
├── style.css           ← PasajeBus Finance theme (light, DM Sans)
├── package.json
├── vercel.json         ← Vercel config + security headers
├── .env.example        ← Environment variables template
├── .gitignore
└── api/
    ├── auth.js         ← POST /api/auth → issues JWT with role
    ├── proxy.js        ← GET  /api/proxy → secure forward to Konnect Pro
    ├── approvals.js    ← GET/POST /api/approvals → Upstash Redis
    ├── activity.js     ← GET/POST /api/activity → action log
    └── aramco.js       ← GET /api/aramco → stub ready to connect
```

---

## Environment Variables

Set in Vercel → Settings → Environment Variables:

| Variable | Description | Required |
|---|---|---|
| `APP_SECRET` | JWT signing secret — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | ✅ |
| `SUPERVISOR_USER` | Supervisor login username | ✅ |
| `SUPERVISOR_PASS` | Supervisor login password | ✅ |
| `CONTABLE_USER` | Accountant login username | ✅ |
| `CONTABLE_PASS` | Accountant login password | ✅ |
| `KONNECT_BEARER_TOKEN` | Konnect Pro bearer token | ✅ |
| `KONNECT_API_KEY` | `QHH79qF2fsWEx98pvNeZpQ` | ✅ |
| `UPSTASH_REDIS_REST_URL` | Auto-injected when connecting Upstash in Vercel Storage | ✅ |
| `UPSTASH_REDIS_REST_TOKEN` | Auto-injected when connecting Upstash in Vercel Storage | ✅ |
| `ARAMCO_API_URL` | Aramco API base URL — leave empty until available | ⏳ |
| `ARAMCO_API_TOKEN` | Aramco API token — leave empty until available | ⏳ |
| `APP_USER` / `APP_PASS` | Legacy — treated as accountant role (backwards compatibility) | — |

### Generate APP_SECRET

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Initial Setup

### 1. Connect Upstash Redis in Vercel

1. Vercel → your project → **Storage** tab
2. Click **Create Database** → **Upstash** → **Upstash for Redis**
3. Name: `pullman-approvals` → **Create**
4. Connect to project → Vercel automatically injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
5. **Redeploy** for the variables to take effect

### 2. Add remaining environment variables

Vercel → Settings → Environment Variables → add each variable from the table above.

### 3. Redeploy

Deployments → latest deploy → `···` → **Redeploy**

---

## Security Architecture

```
BROWSER → /api/auth          → HS256 JWT, 8h duration, includes role
BROWSER → /api/proxy?path=…  → forwards to Konnect (API keys never reach the browser)
BROWSER → /api/approvals     → read/write to Upstash Redis
BROWSER → /api/activity      → action log in Upstash Redis
BROWSER → /api/aramco        → stub / real API when available
```

- Konnect bearer token is **never** exposed to the browser
- JWT signed with `APP_SECRET`, validated on every endpoint
- Path whitelist on proxy (anti-SSRF)
- Only supervisors can POST to `/api/approvals`

---

## Roles & Approval Flow

### Supervisor
- On login: automatically loads **today's pending payments**
- Can **approve** or **reject** per day per operator
- Can **approve all** pending items in the current range with one click
- Sees urgency badge ⚠ when there are overdue days awaiting approval
- On logout: session summary showing approvals/rejections for the day

### Accountant
- On login: automatically loads **approved payments ready to deposit**
- Can **deposit** per day (requires transfer reference number) or by full range
- Receipt is saved and clickable to view full details
- On logout: session summary showing deposits made and any pending items

### Day-level States

```
pending → approved → paid
         ↘ rejected → (can return to pending via re-approval)
```

---

## Data Structures (Upstash Redis)

### Approvals — key: `pullman_approvals_v2`

```json
{
  "ENT-03041__2026-03-23": { "status": "approved", "by": "supervisor", "at": "ISO" },
  "ENT-03041__2026-03-24": { "status": "rejected", "by": "supervisor", "at": "ISO" }
}
```

### Activity Log — key: `pullman_activity_v1`

```json
[
  {
    "action": "approved",
    "code": "ENT-03041",
    "isoDate": "2026-03-23",
    "amount": "$71,750",
    "name": "Patricio Aguilera Torres",
    "by": "supervisor",
    "role": "supervisor",
    "at": "2026-03-23T14:30:00.000Z"
  }
]
```

Max 500 entries (circular buffer).

### Payments — browser `localStorage` key: `pb_payments_v2`

```json
{
  "ENT-03041__2026-03-23": {
    "status": "paid",
    "transferRef": "123456789",
    "name": "Patricio Aguilera Torres",
    "amount": "$71,750",
    "amountKonnect": "$71,750",
    "amountAramco": "$0",
    "date": "2026-03-23",
    "by": "contable",
    "approvedBy": "supervisor",
    "at": "2026-03-23T16:00:00.000Z",
    "rangeDeposit": false
  }
}
```

> ⚠️ Payments are stored in the browser's localStorage. For cross-device persistence in production, migrate to Upstash using the same pattern as `approvals.js`.

---

## Konnect Pro Endpoints (via proxy)

| Endpoint | Purpose |
|---|---|
| `GET /api/v2/users?page=N&items=25&filter_user_type=1&filter_user_type=3` | Paginated list of operators (ENT-XXXXX) |
| `GET /api/v2/reports/render_report/1532?page_limit=0-500&date_range=4&from_date=DD/MM/YYYY&to_date=DD/MM/YYYY&date_wise=1` | Services within a date range |

**Critical parameters:**
- `date_range=4` — fixed value, activates date-filter mode (does NOT represent number of days)
- `from_date` / `to_date` — `DD/MM/YYYY` format, no double-encoding
- `page_limit=0-500` — row index range, fetches up to 500 in one request
- Auto-paginates if `total_records_count > 500`

---

## Financial Formula

```
Final Total = totalNeto (Konnect) − Aramco
```

- `totalNeto` from Konnect already has commission and expenses deducted
- **Expenses (Gastos):** pending Konnect column — uncomment in `COL` and `calcStats()` once Konnect adds it
- **Aramco:** per operator per day from external API — connect via `api/aramco.js`

### Column Map (`COL` in script.js)

```js
{ fecha:0, hora:1, origen:2, destino:3, ruta:4, servicio:5, estado:6,
  bus:7, patente:8, totalAsientos:9, rut:10, razonSocial:11,
  asientosSuc:12, recaudSuc:13, asientosCam:14, recaudCam:15,
  produccion:16, comision:17, totalNeto:18 }
// gastos: pending index — uncomment when Konnect adds the column
```

---

## Pending Dev Tasks

### Aramco API integration
1. Add `ARAMCO_API_URL` and `ARAMCO_API_TOKEN` to Vercel environment variables
2. Edit `api/aramco.js` at the section marked `TODO`
3. Expected API contract:
   ```json
   [{ "ownerCode": "ENT-XXXXX", "date": "YYYY-MM-DD", "amount": 12500 }]
   ```

### Konnect expenses column
When Konnect adds the expenses column to `data_body`:
1. Set the column index in `COL.gastos` in `script.js`
2. Uncomment `gastos += parseMoney(r[COL.gastos])` in `calcStats()`

### Persistent payments (cross-device)
Deposits are currently stored in browser localStorage. To support multiple devices in production:
- Create a new Upstash key `pullman_payments_v2`
- Build a `api/payments.js` endpoint following the same pattern as `approvals.js`

---

## Internationalization (ES / EN)

The `ES | EN` toggle in the header switches the entire UI language instantly.
The selected language is persisted in `localStorage`.

To add a new language:
1. Add a translations object in `i18n.js` under `TRANSLATIONS`
2. Add a `.lang-btn` button in `index.html`

---

## Common Errors

| Error | Cause | Fix |
|---|---|---|
| `KV not configured` | Upstash not connected to project | See Setup → step 1 |
| `Session invalid or expired` | JWT expired (8h) or `APP_SECRET` changed | Log in again |
| `Incorrect credentials` | Typo or extra spaces in env vars | Check vars in Vercel → Settings → Environment Variables |
| Infinite spinner on load | Konnect bearer token expired | Get new token from Konnect Pro, update `KONNECT_BEARER_TOKEN`, redeploy |
| Approvals not saving | Upstash write failed | Check `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` |

---

## Rotating Credentials

If you suspect a leak:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Update in Vercel → Environment Variables → `APP_SECRET` → Save → Redeploy.
This immediately invalidates **all active sessions**.