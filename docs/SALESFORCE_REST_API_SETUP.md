# Salesforce REST API Setup Guide
### Clinical Trial Finder — Lead Integration

This document is for the **Salesforce Administrator**.  
It covers everything needed to connect the Clinical Trial Finder application  
to Salesforce using the REST API so that lead fields like **Gender Identity**,  
**NPI Number**, and **Specialization** populate correctly in the Lead record.

---

## Why We Are Moving to REST API

The current integration uses **Web-to-Lead** (an HTML form POST).  
Web-to-Lead silently ignores any field that is not mapped through a  
generated form in Setup — including `GenderIdentity`.  

The **REST API** uses real Salesforce field API names directly in a JSON  
payload. Every field you send lands exactly in the right place, with  
proper error responses if anything fails.

---

## What Fields Will Be Sent

| Field Label | API Field Name | Field Type | Notes |
|---|---|---|---|
| First Name | `FirstName` | Standard Text | Lead first name |
| Last Name | `LastName` | Standard Text | Lead last name |
| Email | `Email` | Standard Email | Lead email |
| Phone | `Phone` | Standard Phone | Lead phone |
| Company | `Company` | Standard Text | Organisation name |
| Title | `Title` | Standard Text | Physician specialty label |
| Lead Source | `LeadSource` | Standard Picklist | Always "Clinical Trial" |
| Description | `Description` | Standard Long Text | Full context summary |
| **Gender Identity** | **`GenderIdentity`** | **Standard Picklist** | **Male / Female / Nonbinary / Not Listed** |
| NPI Number | `NPI_Number__c` | **Custom Field** | 20-char text |
| Specialization | `Specialization__c` | **Custom Field** | 255-char text |

> Standard fields already exist on the Lead object.  
> Custom fields (`__c` suffix) need to be created — steps below.

---

## Part 1 — Verify Standard Fields

### 1.1 Confirm GenderIdentity Picklist Values

The application sends these exact values. The picklist in Salesforce  
must have **exactly** these values (case-sensitive):

- `Male`
- `Female`
- `Nonbinary`
- `Not Listed`

**Steps to verify / add values:**

1. Go to **Setup** (gear icon → Setup)
2. In the Quick Find box, type **Object Manager** → click it
3. Click **Lead** in the object list
4. Click **Fields & Relationships** in the left menu
5. Search for **GenderIdentity** in the search box
6. Click **GenderIdentity** to open the field
7. Scroll down to **Values** section
8. Confirm these exact values exist: `Male`, `Female`, `Nonbinary`, `Not Listed`
9. If any are missing → click **New** and add them
10. Make sure none are marked **Inactive**

> ⚠️ If the picklist value doesn't match exactly (e.g. "non-binary" vs "Nonbinary"),  
> Salesforce will reject the value and leave the field blank.

---

## Part 2 — Create Custom Fields

You need to create **two custom fields** on the Lead object.

---

### 2.1 Create NPI Number Field

1. Go to **Setup → Object Manager → Lead → Fields & Relationships**
2. Click **New**
3. Select **Text** as the data type → click **Next**
4. Fill in:
   - **Field Label**: `NPI Number`
   - **Length**: `20`
   - **Field Name**: `NPI_Number` ← Salesforce will auto-create API name `NPI_Number__c`
   - **Description**: `National Provider Identifier for the physician`
5. Click **Next** → **Next** → **Save**
6. ✅ Confirm the **API Field Name** shown is: `NPI_Number__c`

---

### 2.2 Create Specialization Field

1. Go to **Setup → Object Manager → Lead → Fields & Relationships**
2. Click **New**
3. Select **Text** as the data type → click **Next**
4. Fill in:
   - **Field Label**: `Specialization`
   - **Length**: `255`
   - **Field Name**: `Specialization` ← Salesforce will auto-create API name `Specialization__c`
   - **Description**: `Physician medical specialization / taxonomy`
5. Click **Next** → **Next** → **Save**
6. ✅ Confirm the **API Field Name** shown is: `Specialization__c`

> **Note:** If custom fields with different names already exist  
> (e.g. `Specialty__c` instead of `Specialization__c`), let the  
> development team know the exact API names and we will update the code to match.

---

## Part 3 — Create a Connected App (for REST API Access)

This gives the application a secure way to authenticate with Salesforce  
without using a personal login session.

### 3.1 Create the Connected App

1. Go to **Setup → App Manager**
2. Click **New Connected App** (top right)
3. Fill in **Basic Information**:
   - **Connected App Name**: `Clinical Trial Finder`
   - **API Name**: `Clinical_Trial_Finder` (auto-filled)
   - **Contact Email**: your admin email
4. Under **API (Enable OAuth Settings)** → check **Enable OAuth Settings**
5. **Callback URL**: enter `https://login.salesforce.com/services/oauth2/success`  
   (this is required but not actually used for the password flow)
6. **Selected OAuth Scopes** — add both:
   - `Access and manage your data (api)`
   - `Perform requests on your behalf at any time (refresh_token, offline_access)`
7. Uncheck **Require Proof Key for Code Exchange (PKCE)**  
   (not needed for server-to-server flow)
8. Check **Enable Client Credentials Flow** — YES
9. Click **Save** → **Continue**

### 3.2 Get the Consumer Key and Secret

After saving:
1. On the Connected App detail page, click **Manage Consumer Details**
2. You may be prompted for identity verification
3. Copy and **securely share** these two values with the development team:
   - **Consumer Key** → this is `SF_CLIENT_ID` in the application config
   - **Consumer Secret** → this is `SF_CLIENT_SECRET` in the application config

---

## Part 4 — Create or Designate an API User

The application needs a Salesforce user account dedicated to API access.

### 4.1 Option A — Use an Existing User (quickest)

If you already have a dedicated integration/API user:
1. Note their **Salesforce login email** → this is `SF_USERNAME`
2. Reset their **security token**: go to their profile → **Reset My Security Token**
   - The token will be emailed to that user's email address
3. `SF_PASSWORD` = their **password** + **security token** concatenated  
   Example: password is `Winter2024!` and token is `xKp9QrT2...`  
   → `SF_PASSWORD = Winter2024!xKp9QrT2...`

### 4.2 Option B — Create a New API User (recommended)

1. Go to **Setup → Users → Users → New User**
2. Fill in:
   - **First Name**: `API`
   - **Last Name**: `Integration`
   - **Email**: a monitored inbox (e.g. `api-integration@yourcompany.com`)
   - **Username**: `api-integration@yourcompany.com.clinicaltrial` (must be unique globally)
   - **User License**: `Salesforce`
   - **Profile**: `Standard User` (or a custom profile with Lead create/edit access)
3. Save → user will receive a welcome email to set password
4. After password is set, reset the security token (Setup → My Personal Information → Reset Security Token)
5. Share **username**, **password + security token**, and `SF_INSTANCE_URL` with the dev team

### 4.3 Assign the Connected App to the API User

1. Go to **Setup → App Manager** → find **Clinical Trial Finder** → click **Manage**
2. Click **Edit Policies**
3. Under **OAuth Policies** → set **Permitted Users** to **Admin approved users are pre-authorized**
4. Save
5. Go back to the Connected App → click **Manage Profiles** or **Manage Permission Sets**
6. Add the profile or permission set of your API user

---

## Part 5 — Add Fields to Lead Page Layout (so they show in the UI)

Even though fields exist on the object, they won't be visible in the Lead  
record UI unless added to the page layout.

1. Go to **Setup → Object Manager → Lead → Page Layouts**
2. Click the layout used by your team (usually **Lead Layout**)
3. In the palette at the top, find **NPI Number** and **Specialization**
4. Drag them to the appropriate section in the layout  
   (e.g. under **Additional Information** next to **GenderIdentity**)
5. Click **Save**

---

## Part 6 — Summary of Values to Share with Development Team

After completing the steps above, share these values securely  
(use a password manager or encrypted message, not plain email):

```
SF_CLIENT_ID       = <Consumer Key from Connected App>
SF_CLIENT_SECRET   = <Consumer Secret from Connected App>
SF_USERNAME        = <API user login email>
SF_PASSWORD        = <API user password + security token (concatenated)>
SF_INSTANCE_URL    = https://yourcompany.my.salesforce.com
```

**How to find your instance URL:**
- Log into Salesforce
- Look at the browser address bar
- It will be something like: `https://aquarient.lightning.force.com`
- The instance URL is: `https://aquarient.my.salesforce.com`
  (replace `lightning.force.com` with `my.salesforce.com`)

---

## Part 7 — What the Development Team Will Do (No Action Needed From You)

For transparency, here is what happens on the code side once credentials are received:

1. Add the 5 env vars (`SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_USERNAME`, `SF_PASSWORD`, `SF_INSTANCE_URL`) to the deployment environment
2. Switch the Salesforce integration from Web-to-Lead to REST API  
   (the new file `backend/services/salesforce_rest_api.py` is already written and ready)
3. The REST API call will:
   - Authenticate using OAuth2 Username-Password flow
   - POST a JSON payload to `/services/data/v59.0/sobjects/Lead/`
   - Field names used: `FirstName`, `LastName`, `Email`, `Phone`, `Company`,  
     `Title`, `LeadSource`, `Description`, `GenderIdentity`,  
     `NPI_Number__c`, `Specialization__c`
4. If `GenderIdentity` is `"Male"` — it will land in the picklist as `Male` ✅
5. If `GenderIdentity` is `"Unknown"` from NPPES — it will be mapped to `"Not Listed"` ✅

---

## Quick Reference — Field API Name Mapping

| What we send | Goes to Salesforce field | Type |
|---|---|---|
| `FirstName` | First Name | Standard |
| `LastName` | Last Name | Standard |
| `Email` | Email | Standard |
| `Phone` | Phone | Standard |
| `Company` | Company | Standard |
| `Title` | Title | Standard |
| `LeadSource` | Lead Source | Standard Picklist |
| `Description` | Description | Standard Long Text |
| `GenderIdentity` | Gender Identity | Standard Picklist ← **THE FIX** |
| `NPI_Number__c` | NPI Number | Custom Text |
| `Specialization__c` | Specialization | Custom Text |

---

*Document prepared by the Clinical Trial Finder development team.*  
*For questions, contact the development team before making changes in Salesforce.*
