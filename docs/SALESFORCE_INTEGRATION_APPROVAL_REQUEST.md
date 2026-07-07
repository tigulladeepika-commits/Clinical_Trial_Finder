# Salesforce Integration — Approval & Requirements Request

**To:** Manager / Salesforce Administrator  
**From:** Development Team (Python Backend)  
**Date:** July 6, 2026  
**Subject:** Approval to Switch Salesforce Lead Integration from Web-to-Lead → REST API

---

## 1. Background — Current Problem

We currently use **Salesforce Web-to-Lead** (HTML form POST) to create Lead records
from the Clinical Trial Finder application.

We have recently added new fields to our lead capture:
- **Gender Identity**
- **NPI Number**
- **Specialization**

**NPI Number** and **Specialization** are working correctly and showing up in Salesforce.

**Gender Identity is NOT showing up** in the Salesforce Lead record's picklist field,
even though the value is being sent correctly from our application.

### Root Cause
Web-to-Lead silently ignores any field that is not mapped via a generated
form configuration in Salesforce Setup. The `GenderIdentity` field is being
dropped without any error or warning on our side — which is why the value
appears only in the Description text but not in the actual Gender Identity
picklist field on the Lead record.

---

## 2. Proposed Solution — Salesforce REST API

We are proposing to switch from **Web-to-Lead** to the **Salesforce REST API**
for creating Lead records.

This is the approach recommended by the Salesforce documentation and by our
admin. We have already written the new Python code for this — it is ready
and waiting for approval and credentials.

### How It Works (Simple Overview)

```
Step 1 — Our app authenticates with Salesforce
         → Salesforce returns a session token

Step 2 — Our app sends lead data as JSON to Salesforce API
         → POST /services/data/v59.0/sobjects/Lead/

Step 3 — Salesforce creates the Lead record with all fields populated
         → Returns the new Lead ID as confirmation
```

### Why REST API Fixes the Problem

With REST API, we use **actual Salesforce field API names** directly in our
JSON payload. No form mapping, no generated field IDs needed.

So instead of:
```
Web-to-Lead: Salesforce silently drops "GenderIdentity" → field stays blank
```

We get:
```
REST API: We send "GenderIdentity": "Male" → picklist field shows "Male" ✅
```

---

## 3. Fields We Will Send to Salesforce

Below are all the fields our application will send when a lead is created.

| Field Label | Salesforce API Name | Type | Example Value |
|---|---|---|---|
| First Name | `FirstName` | Standard | `Mustafa` |
| Last Name | `LastName` | Standard | `Ahmed` |
| Email | `Email` | Standard | `mahmed@uabmc.edu` |
| Phone | `Phone` | Standard | `(205) 934-4011` |
| Company | `Company` | Standard | `Individual Physicians` |
| Title | `Title` | Standard | `Internal Medicine` |
| Lead Source | `LeadSource` | Standard Picklist | `Clinical Trial` |
| Description | `Description` | Standard Long Text | Full context summary |
| **Gender Identity** | **`GenderIdentity`** | **Standard Picklist** | **`Male`** |
| NPI Number | `NPI_Number__c` | Custom Text Field | `1306093588` |
| Specialization | `Specialization__c` | Custom Text Field | `Internal Medicine` |

> **Note:** Fields marked "Standard" already exist on the Salesforce Lead object.
> Fields marked "Custom" need to be created in Salesforce (details in Section 5).

---

## 4. What We Need from the Salesforce Admin

We need **5 credential values** to connect our application to Salesforce.
These come from two things the admin needs to set up:

### 4.1 — A Connected App in Salesforce
A Connected App is how Salesforce allows external applications to connect
securely via the API. Once created, it provides:

| What We Need | Where It Comes From | Env Variable Name |
|---|---|---|
| Consumer Key | Connected App settings | `SF_CLIENT_ID` |
| Consumer Secret | Connected App settings | `SF_CLIENT_SECRET` |

### 4.2 — A Salesforce API User
A user account the application will use to authenticate. Once ready:

| What We Need | Where It Comes From | Env Variable Name |
|---|---|---|
| Login Username | API user's email/login | `SF_USERNAME` |
| Password + Security Token | User's password + token (combined) | `SF_PASSWORD` |
| Instance URL | Your Salesforce org URL | `SF_INSTANCE_URL` |

> **SF_PASSWORD** = the user's Salesforce password with the security token
> appended directly to the end.
> Example: if password is `Winter2024!` and security token is `xKp9ABC`
> then `SF_PASSWORD = Winter2024!xKp9ABC`

> **SF_INSTANCE_URL** example: `https://yourcompany.my.salesforce.com`

---

## 5. What the Salesforce Admin Needs to Create

### 5.1 — Verify GenderIdentity Picklist Values

The `GenderIdentity` field already exists on the Lead object. We just need
to confirm the picklist has **exactly these values** (our code maps to these):

- `Male`
- `Female`
- `Nonbinary`
- `Not Listed`

**Steps to check:**
> Setup → Object Manager → Lead → Fields & Relationships → GenderIdentity
> → scroll to Values section → confirm all four values exist and are Active

---

### 5.2 — Create NPI Number Custom Field

> Setup → Object Manager → Lead → Fields & Relationships → New

| Setting | Value |
|---|---|
| Data Type | Text |
| Field Label | `NPI Number` |
| Length | `20` |
| Field Name | `NPI_Number` |
| API Name (auto-generated) | `NPI_Number__c` |

---

### 5.3 — Create Specialization Custom Field

> Setup → Object Manager → Lead → Fields & Relationships → New

| Setting | Value |
|---|---|
| Data Type | Text |
| Field Label | `Specialization` |
| Length | `255` |
| Field Name | `Specialization` |
| API Name (auto-generated) | `Specialization__c` |

> ⚠️ **Important:** If these fields already exist with different API names
> (e.g. `Specialty__c` instead of `Specialization__c`), please let us know
> the exact API names and we will update our code to match — no need to create
> duplicate fields.

---

### 5.4 — Create Connected App

> Setup → App Manager → New Connected App

| Setting | Value |
|---|---|
| Connected App Name | `Clinical Trial Finder` |
| Enable OAuth Settings | ✅ Yes |
| Callback URL | `https://login.salesforce.com/services/oauth2/success` |
| OAuth Scopes | `api` and `refresh_token, offline_access` |
| Permitted Users | Admin approved users are pre-authorized |

After saving, go to **Manage Consumer Details** to get the **Consumer Key**
and **Consumer Secret**.

---

### 5.5 — Set Up API User

Either use an existing integration/API user or create a new one:

> Setup → Users → Users → New User

- Assign a profile that has **Lead: Create and Edit** permissions
- Reset the Security Token: Setup → My Personal Information → Reset My Security Token
  (the token will be emailed to the user)
- Share the username, password, and security token with the dev team

---

### 5.6 — Add New Fields to Lead Page Layout (so they appear in the UI)

> Setup → Object Manager → Lead → Page Layouts → Lead Layout

Drag `NPI Number`, `Specialization`, and confirm `Gender Identity` is visible
in the layout. Save.

---

## 6. What We Will Do on Our Side (No Action Needed From Admin)

For full transparency, here is what the development team will handle:

- ✅ Python code for REST API integration is already written and ready
- ✅ OAuth2 authentication (get token → cache → auto-refresh on expiry)
- ✅ JSON payload builder with correct Salesforce field names
- ✅ Gender Identity normalisation (M/F/U from NPPES → Male/Female/Not Listed)
- ✅ Error handling and logging
- Once we receive the 5 credentials → add them to deployment environment
- Once admin confirms Salesforce setup is done → swap the integration (est. 15 mins)
- Test end-to-end with a sample lead and confirm Gender Identity populates

---

## 7. Summary — What We Are Asking For

| # | Action | Who | Status |
|---|---|---|---|
| 1 | Approve REST API approach | Manager | **Pending approval** |
| 2 | Verify GenderIdentity picklist values | Salesforce Admin | Pending |
| 3 | Create `NPI_Number__c` custom field | Salesforce Admin | Pending |
| 4 | Create `Specialization__c` custom field | Salesforce Admin | Pending |
| 5 | Create Connected App → share Consumer Key + Secret | Salesforce Admin | Pending |
| 6 | Set up API user → share Username + Password + Token | Salesforce Admin | Pending |
| 7 | Share Instance URL | Salesforce Admin | Pending |
| 8 | Add new fields to Lead page layout | Salesforce Admin | Pending |
| 9 | Integrate + test end-to-end | Dev Team | Ready to start |

---

## 8. Questions or Concerns?

If there are any questions about the approach, the fields being sent, or
the credentials needed, please reach out to the development team before
proceeding.

We are happy to jump on a call to walk through any of the steps above.

---

*Prepared by: Development Team*
*Application: Clinical Trial Finder — Salesforce Lead Integration*
