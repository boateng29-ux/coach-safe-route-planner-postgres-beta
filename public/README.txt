Coach Safe Driver V2.3.1 — Public Route Data

CONFIRMED ISSUE

Driver V2 loaded its HTML and JavaScript, but app.js requested:

  /api/driver-v2/route/:id

The /api namespace is protected by operator authentication, so the public
driver page received:

  {"error":"Please sign in again."}

FIX

Driver V2 now requests:

  /driver-v2/data/:id

This is a public, read-only endpoint that returns only the approved route data.
Protected operator APIs remain unchanged.

INSTALL

1. Extract this ZIP into the project root.
2. Run:

   node .\install-driver-v2.3.1-public-data.mjs
   node --check .\server.js
   node --check .\public\driver-v2\app.js

3. Confirm the new endpoint exists:

   Select-String -Path .\server.js `
     -Pattern "COACH_SAFE_DRIVER_V231_PUBLIC_DATA|driver-v2/data" `
     -Context 1,2

4. Commit and deploy:

   git add server.js public/driver-v2
   git commit -m "Make Driver V2 approved route data public"
   git push origin main

5. After Render deploys, test the data endpoint directly:

   https://coach.point2point.site/driver-v2/data/YOUR_ROUTE_ID

Expected result:
- JSON route data

It must not return:
- Please sign in again

6. Open the Driver V2 page with a fresh asset version:

   https://coach.point2point.site/driver-v2/route/YOUR_ROUTE_ID?v=231
