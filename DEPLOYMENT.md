# 🚀 Easy Deployment: Railway + Inngest Cloud

The easiest way to deploy your news scraper.

---

## Method: Railway (Recommended)

**Why Railway?**
- ✅ Free tier available ($5/month credit)
- ✅ Automatic Docker builds from GitHub
- ✅ One-click deploy
- ✅ Persistent processes (cron jobs work)
- ✅ Easy environment variables

---

## Step 1: Push to GitHub

```bash
# Initialize git if not already
git init
git add .
git commit -m "Initial commit"

# Create GitHub repo and push
gh repo create news-scrapper --private --push
# Or manually: git remote add origin https://github.com/yourusername/news-scrapper.git
# git push -u origin main
```

---

## Step 2: Create Inngest Cloud Account

1. Go to [https://app.inngest.com](https://app.inngest.com)
2. Sign up with GitHub
3. Create app: **"news-scraper"**
4. Go to **Settings → Keys** and copy:
   - **Event Key**: `inngest-xxxxxxx`
   - **Signing Key**: `signkey-xxxxxx`

---

## Step 3: Deploy on Railway

1. Go to [https://railway.app](https://railway.app)
2. Sign up with GitHub
3. Click **"New Project"** → **"Deploy from GitHub Repo"**
4. Select your `news-scrapper` repository
5. Railway auto-detects the Dockerfile ✅

### Add Environment Variables:

In Railway dashboard → **Variables** → Add:

```
DATABASE_URL=postgresql://postgres.xxxxx:password@aws-x-ap-south-1.pooler.supabase.com:6543/postgres
VERCEL_API_KEY=your-vercel-api-key
INNGEST_EVENT_KEY=inngest-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
INNGEST_SIGNING_KEY=signkey-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

6. Click **Deploy** 🚀

---

## Step 4: Get Your Public URL

After Railway deploys:

1. Go to **Settings** → **Networking** → **Generate Domain**
2. You'll get a URL like: `https://news-scrapper-production-xxxx.up.railway.app`

---

## Step 5: Sync with Inngest Cloud

1. Go to [Inngest Dashboard](https://app.inngest.com)
2. Click **Apps** → **Sync New App**
3. Enter your Railway URL:
   ```
   https://news-scrapper-production-xxxx.up.railway.app/api/inngest
   ```
4. Click **Sync**

Inngest will discover your functions:
- ✅ `scrape-news-cycle-v2` (cron every 10 minutes)
- ✅ `generate-article`
- ✅ `send-webhook`

---

## ✅ Done!

Your news scraper is now:
- Running 24/7 on Railway
- Cron jobs managed by Inngest Cloud
- Scalable and reliable

### View Logs:
- **Railway**: Dashboard → Deployments → View Logs
- **Inngest**: app.inngest.com → Functions → View Runs

---

## Costs

| Service | Free Tier |
|---------|-----------|
| Railway | $5/month credit (plenty for this app) |
| Inngest | 25,000 runs/month free |
| Supabase | 500MB database free |

**Total cost: $0** for typical usage 💰

---

## Alternative Platforms

| Platform | Pros | Cons |
|----------|------|------|
| **Railway** ⭐ | Easiest, auto Docker | Limited free tier |
| **Render** | Free tier, simple | Cold starts |
| **Fly.io** | Great Docker support | Slightly complex |
| **DigitalOcean** | Full control | Manual setup |
