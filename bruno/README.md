# Bruno collection — manual API testing

A small [Bruno](https://www.usebruno.com/) collection for exercising the API by
hand. Open Bruno → **Open Collection** → select this `bruno/` folder.

## Before you start

```bash
make up      # brings up db + api + web
make seed    # creates test@example.com / testpassword and 19 sample entries
```

`make up` requires `JWT_SECRET` in `.env` (generate one with `make secret`); the
API refuses to start without it.

## Pick an environment

Two are provided — choose one from the environment selector (top right):

| Environment | `baseUrl` | Notes |
|---|---|---|
| **Local API (8081)** | `http://localhost:8081/api` | Straight to the Go service. Best for API work — takes nginx out of the picture. |
| **Local via nginx (8080)** | `http://localhost:8080/api` | The path the browser app actually uses. |

## How the bearer token works

You do **not** paste a token anywhere:

1. Run **01 Login**. Its post-response script writes the JWT into the `token`
   environment variable:
   ```js
   bru.setEnvVar("token", res.body.token);
   ```
2. The collection sets bearer auth once, in `collection.bru`:
   ```
   auth:bearer {
     token: {{token}}
   }
   ```
3. Every other request is set to `auth: inherit`, so it picks that up
   automatically and sends `Authorization: Bearer <jwt>`.

Tokens last 30 days. When requests start returning 401, re-run **01 Login**.

> If your Bruno version doesn't support `auth: inherit`, add the header
> explicitly to a request instead:
> ```
> headers {
>   Authorization: Bearer {{token}}
> }
> ```

## Suggested run order

| Request | What it proves |
|---|---|
| **01 Login** | Credentials work; captures the token. |
| **02 Get Categories** | The token is accepted, and the category catalogue is seeded. |
| **03 Import Transactions** | The transaction import works end to end — expect `imported: 12`. |
| **04 Import Again (dedup)** | Re-importing is safe — expect `imported: 0, skipped_duplicates: 12`. |

Each request carries assertions, so **Run** on the collection gives a pass/fail
summary rather than something to eyeball.

## Troubleshooting

- **401 on everything** — run 01 Login; check the environment selector is set.
- **Connection refused** — `make up`, then `docker compose ps` to confirm
  `finance-api` is healthy.
- **401 on login itself** — the seed user doesn't exist yet: `make seed`.
- **File not found on the import** — use the file picker on the `file` row in
  the Body tab and select `backend/testdata/frollo_sample.csv`; the stored path
  is relative to this folder and your setup may differ.
- **`imported: 0` on the first import** — the rows are already in the database
  from an earlier run. `make reset-db` for a clean slate (destructive).
