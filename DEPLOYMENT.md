# Deployment Guide - Soulcomms

## Prerequisites
- GitHub account (github.com/Aura1976sos)
- Git installed locally
- Node.js and pnpm installed

## Step 1: Create GitHub Repository

1. Go to https://github.com/new
2. Enter repository name: **Soulcomms**
3. Choose **Public** (for GitHub Pages to work)
4. Click **Create repository**

## Step 2: Push Code to GitHub

```bash
# In your project directory
git branch -M main
git push -u origin main
```

You'll be prompted to authenticate. Use one of these methods:
- **GitHub Personal Access Token** (recommended for CLI)
- **SSH key** (if configured)

### Generate GitHub Personal Access Token:
1. Go to https://github.com/settings/tokens
2. Click **Generate new token (classic)**
3. Select scopes: `repo`, `workflow`
4. Copy the token and use it as password when git prompts

## Step 3: Enable GitHub Pages

1. Go to https://github.com/Aura1976sos/Soulcomms/settings/pages
2. Under **Source**, select **Deploy from a branch**
3. Select branch: **main**
4. Select folder: **/root**
5. Click **Save**

## Step 4: Configure GitHub Secrets

For CI/CD to access Supabase, add these secrets:

1. Go to https://github.com/Aura1976sos/Soulcomms/settings/secrets/actions
2. Click **New repository secret**
3. Add:
   - Name: `VITE_SUPABASE_URL`
     Value: `https://spb-t4n599sao4ett36b.supabase.opentrust.net`
   - Name: `VITE_SUPABASE_ANON_KEY`
     Value: `eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG41OTlzYW80ZXR0MzZiIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODA1Mjg5MDEsImV4cCI6MjA5NjEwNDkwMX0._aoeJF8XQvS8e5wzj1zJa0wV8oaA2FauCsnnCYTjXQs`

## Step 5: Deploy

Your site will automatically deploy when you push to the `main` branch.

- **GitHub Pages URL**: https://Aura1976sos.github.io/Soulcomms
- Watch deployment: https://github.com/Aura1976sos/Soulcomms/actions

## Custom Domain (Optional)

To use a custom domain like `soulcomms.example.com`:

1. Add DNS CNAME record pointing to `Aura1976sos.github.io`
2. Go to repository **Settings → Pages**
3. Under **Custom domain**, enter your domain
4. Check **Enforce HTTPS**

## Troubleshooting

### Build Fails
- Check `.github/workflows/deploy.yml` for environment setup
- Verify all dependencies in `package.json`

### Page Not Updating
- Wait 5-10 minutes for GitHub Pages to rebuild
- Check Actions tab for deployment errors
- Clear browser cache (Ctrl+Shift+Delete)

### Authentication Issues
- Verify Supabase anon key is correct in secrets
- Check RLS policies allow anonymous reads

## Local Testing Before Deploy

```bash
# Build locally
pnpm run build

# Preview production build
pnpm run preview
```

## Next Steps

1. ✅ Push code to GitHub
2. ✅ Enable GitHub Pages
3. ✅ Add repository secrets
4. ✅ View live at https://Aura1976sos.github.io/Soulcomms
