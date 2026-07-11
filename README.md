# Coach Safe Route Planner – Driver Assignment Notification Upgrade

This upgrade adds copyable driver assignment notifications for the live operator beta.

## Added

- Driver assignment message preview inside each saved route card.
- **Copy WhatsApp/SMS message** button.
- **Open WhatsApp** button.
- Message includes route, driver link, route pack link, vehicle details, risk score and warning summary.
- Improved confirmation after route status/driver assignment is saved.

## Files changed

Copy these files into your existing Git project and replace the current versions:

- `public/app.js`
- `public/styles.css`
- `README.md`

## Deploy

```powershell
cd "$env:USERPROFILE\Downloads\coach-safe-route-planner-postgres-beta\coach-safe-route-planner-postgres-beta"
git add public/app.js public/styles.css README.md
git commit -m "Add driver assignment notification messages"
git push
```

Render should redeploy automatically.

## Test

1. Log in at `https://coach.point2point.site`.
2. Open **Saved routes**.
3. Assign a driver and save status/driver.
4. Click **Copy WhatsApp/SMS message**.
5. Paste it into WhatsApp/SMS/email.
6. Click **Open WhatsApp** and confirm the message opens for review before sending.

The app does not send the message automatically. It prepares it for operator review during beta testing.
