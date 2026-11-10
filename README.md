# SanjanaIAS — UPSC Study Intelligence

A ₹0, source-grounded UPSC current affairs platform. Built as a static frontend with a Supabase backend and automated news collection via GitHub Actions.

## 🚀 Features
- **Automated News:** Collects from 14+ official and news RSS feeds hourly.
- **UPSC Classification:** Auto-tags news to GS Papers and regions (World, India, Telangana).
- **7-Day Auto-Pruning:** Automatically deletes news older than 7 days (curated seeds stay forever).
- **User Accounts:** Username/password signup with security questions for password recovery.
- **Isolated Data:** Bookmarks, notes, and Mains drafts are securely synced per-user via Supabase Row Level Security (RLS).
- **Prep Tools:** Daily Briefing, AI Tutor (grounded in local data), Prelims MCQs, and Mains practice.

## 🛠️ Tech Stack
- **Frontend:** HTML5, CSS3, Vanilla JavaScript (Single-file `app.js`).
- **Database & Auth:** Supabase (PostgreSQL + RLS).
- **Automation:** GitHub Actions (Cron) + Node.js collector script.
- **Hosting:** vercel.

## ⚙️ Setup Instructions

### 1. Database Setup (Supabase)
1. Create a free project at [Supabase](https://supabase.com).
2. Go to **SQL Editor** and run the SQL scripts provided in the project documentation to create the `topics`, `profiles`, `bookmarks`, `notes`, `mains_drafts`, `revision_entries`, and `progress` tables. Ensure RLS policies are applied.

### 2. Edge Function (Password Reset)
1. Go to **Edge Functions** in Supabase.
2. Click **Deploy a new function** → **Via Editor**.
3. Name it `reset-password`, paste the provided Deno code, and click **Deploy**.
4. Go to settings and turn **Verify JWT** to **OFF**.

### 3. Frontend Configuration
1. Open `app.js` and find:
   ```javascript
   var SUPABASE_URL = '';
   var SUPABASE_ANON_KEY = '';#
