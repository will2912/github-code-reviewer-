# GitHub Code Reviewer

## 1. Clone the Repository

```powershell
git clone <REPOSITORY_URL>
cd <REPOSITORY_FOLDER>
```

## 2. Create `.env`

Create a `.env` file inside the `/backend` directory.

## 3. Create a GitHub Personal Access Token

1. Open https://github.com/settings/personal-access-tokens
2. Select **Fine-grained tokens** → **Generate new token**.
3. Enter a token name, such as `Code Reviewer`, and set an expiration date.
4. Under **Repository access**, select only the repository you want to review.
5. Configure the required permissions:

   * **Pull requests:** Read access.
   * **Issues:** Read and write access, for posting comments.
   * **Contents:** Read access, if reading repository files.
6. Generate and copy the token.
   Add it to `/backend/.env`:

```dotenv
GITHUB_TOKEN=your_github_token_here
```

## 4. Create an OpenRouter API Key

1. Open https://openrouter.ai/ and sign in or create an account.
2. Visit https://openrouter.ai/settings/keys
3. Create a new API key and copy it.
   Add it to `/backend/.env`:

```dotenv
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

**Important:** Use the exact environment variable names expected by the application. Never commit `.env` or share your API keys.

## 5. Install and Configure ngrok

Install ngrok using PowerShell:

```powershell
winget install ngrok.ngrok
```

If ngrok is already installed, update it if necessary:

```powershell
ngrok update
```

Configure your authentication token from https://dashboard.ngrok.com/:

```powershell
ngrok config add-authtoken <YOUR_NGROK_AUTHTOKEN>
```

Start the tunnel:

```powershell
ngrok http 127.0.0.1:3009
```

Copy the HTTPS forwarding URL displayed by ngrok. Use your own URL; do not copy someone else's URL from an example. Keep ngrok running.
**Note:** Using `127.0.0.1:3009` worked during testing; using only `3009` did not work reliably.

## 6. Start the Application Using Docker

Ensure Docker Desktop is running and `/backend/.env` is configured. Open PowerShell in the `/backend` directory and run:

```powershell
docker compose up --build -d
```

View backend logs:

```powershell
docker compose logs -f backend
```

## 7. Configure the GitHub Webhook

1. Open your GitHub repository and go to **Settings → Webhooks → Add webhook**.
2. Set the **Payload URL** to your ngrok URL followed by `/webhook`:
   `YOUR_NGROK_HTTPS_URL/webhook`
3. Set **Content type** to `application/json`.
4. Select **Pull requests** as the event.
5. Save the webhook.
   **Example:** If ngrok displays `https://example.ngrok-free.app`, use `https://example.ngrok-free.app/webhook`. Replace the example with your actual URL.

## 8. Test the Integration

1. Open or reopen a Pull Request in the configured repository.
2. Check **Settings → Webhooks → Recent Deliveries** on GitHub.
3. Inspect backend logs:

```powershell
docker compose logs -f backend
```
