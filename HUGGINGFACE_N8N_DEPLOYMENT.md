# Deploying n8n to Hugging Face Spaces (Free 24/7 Hosting)

Follow these steps to host your n8n instance for free on Hugging Face. It will run 24/7 without going to sleep.

---

### Step 1: Create a Hugging Face Account & Space
1. Go to [Hugging Face](https://huggingface.co/) and create a free account.
2. Once logged in, click your profile icon in the top right and select **"New Space"**.
3. Configure the Space settings:
   - **Space Name**: `getgo-n8n` (or any name you like)
   - **License**: `mit` (or choose any)
   - **Select the Space SDK**: Click **Docker**
   - **Choose a Docker Template**: Click **Blank**
   - **Space Hardware**: Keep it on the free **CPU Basic (Free - 16GB RAM, 2 vCPUs)**
   - **Visibility**: Set to **Public** (required for the free tier so your app can reach it)
4. Click **Create Space** at the bottom.

---

### Step 2: Create and Upload the Dockerfile
Hugging Face will show a page waiting for you to add files. You only need to create one single file:
1. Click the **Files** tab at the top of your new Space page, then click **Add file** -> **Create a new file**.
2. Name the file exactly:
   ```text
   Dockerfile
   ```
3. Paste the following line in the editor:
   ```dockerfile
   FROM n8nio/n8n:latest
   ENV N8N_PORT=7860
   ```
4. Click **Commit new file to main** at the bottom of the page.

*Hugging Face will automatically start building your container. This takes about 1-2 minutes. Once finished, you will see a green **"Running"** status at the top!*

---

### Step 3: Access your n8n Instance
1. Click the **App** tab on your Space page.
2. You will see the n8n setup wizard! Follow the prompts to create your owner account.
3. Import your existing workflow or recreate the workflow:
   - **Webhook method**: `POST`
   - **Webhook path**: `customer-support`
   - **Authentication**: `None`
   - **Respond**: `Using 'Respond to Webhook' Node`
   - **AI Agent Prompt**: `{{ $('Webhook').item.json.body.message }}`
   - **MongoDB Memory Session Key**: `{{ $('Webhook').item.json.body.sessionId }}`

---

### Step 4: Link your GetGo App to the New Webhook
Now, retrieve the public URL of your new n8n instance:
1. On your Hugging Face Space page, click the three dots (`...`) in the top-right corner and select **"Embed this Space"**.
2. Look for the **Direct URL** (it looks like `https://username-getgo-n8n.hf.space`).
3. Copy that URL and append `/webhook/customer-support` to it. For example:
   ```text
   https://username-getgo-n8n.hf.space/webhook/customer-support
   ```
4. Open your project's [.env](file:///c:/Users/prade/OneDrive/Desktop/CODING/WEB%20DEVELOPMENT/nodejs/GetGO/GetGo/server/.env) file and update the webhook URL:
   ```ini
   N8N_WEBHOOK_URL=https://username-getgo-n8n.hf.space/webhook/customer-support
   ```
5. Recreate your local Docker containers to apply the new URL:
   ```bash
   docker compose up -d --force-recreate
   ```

You are all set! Your customer support agent will now run 24/7 in the cloud completely for free!
