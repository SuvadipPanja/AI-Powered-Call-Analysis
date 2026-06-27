# Test Accounts

Run the seed script to create/reset all test users:

```bash
cd backend
node seed-test-users.js
```

## Working Credentials

| Login ID   | Username   | Password         | Role         | Security Question  | Answer |
|------------|------------|------------------|--------------|--------------------|--------|
| SUPER001   | superadmin | SuperAdmin@2026  | Super Admin  | Favorite color     | Blue   |
| TL001      | teamlead1  | TeamLead@2026    | Team Leader  | Favorite color     | Red    |
| AGT001     | agent1     | Agent@2026       | Agent        | Favorite game      | Chess  |
| MGR001     | manager1   | Manager@2026     | Manager      | First pet's name   | Buddy  |

## Login instructions

1. Open the login page
2. Enter **Login ID** (e.g. `AGT001`) or **Username** (e.g. `agent1`) in the User ID field
3. Enter the **Password**
4. Select the matching **Security Question** from the dropdown
5. Type the **Answer** (case-insensitive)
6. Complete the CAPTCHA and click **Sign in**
