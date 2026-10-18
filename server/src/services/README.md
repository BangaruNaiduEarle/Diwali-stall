# Services

| Module | Purpose |
|--------|---------|
| `money.js` | Integer paise helpers (no float totals) |
| `publicProducts.js` | Public catalogue queries — never joins `private_rates` |
| `adminAllowlist.js` | D1 `admin_users` email check after Access JWT |

| `publicCustomerRequests.js` | Public POST customer request intake (no `private_rates`) |

Quotation admin services arrive in a later phase. Do not seed `private_rates` from frontend `price` or `x4`.
