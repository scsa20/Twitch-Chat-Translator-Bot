# Twitch Chat Translator Bot

## Powered by Microsoft Azure Cognitive Services

A Twitch chat bot that automatically translates users messages to the chosen language.

## Installing

- First clone the repo and then `cd` to the folder.
- Install all the dependicies and packages `yarn install`.
- Create an .env by using ~~the only~~ your favourite text editor `nano .env`
- List of variables:

> **BOT_USERNAME** is the username of the Twitch account.\
> **TWITCH_OAUTH** is the token needed to connect to Twitch chat. You can generate one [here](https://twitchapps.com/tmi/).\
> **TWITCH_OAUTH_FLOW** optional; set to `true` to use the OAuth flow instead of an existing token.\
> **TWITCH_CLIENT_ID** and **TWITCH_CLIENT_SECRET** required when `TWITCH_OAUTH_FLOW=true`.\
> **TWITCH_OAUTH_REDIRECT_URI** optional; the redirect URI for OAuth callback. Defaults to `http://localhost:3000/auth/callback` or `https://localhost:3000/auth/callback` if certificates are configured.\
> **TWITCH_OAUTH_CERT_PATH** and **TWITCH_OAUTH_KEY_PATH** optional; paths to HTTPS certificate and key files for secure local development or production use.\
> **ENCRYPTION_KEY** optional; a 64-character hex string used to encrypt stored OAuth tokens with AES-256-GCM. If not set, a key will be auto-generated and saved to `config/encryption-key.txt` (less secure). For production, set this environment variable to a secure random key.\
> **CHANNEL_NAME** is where you want the bot to run. Supports multiple channels (comma or space separated, e.g., `channel1 channel2` or `channel1,channel2`). Each channel has its own ignore list. Defaults to BOT_USERNAME if not set.\
> **AZURE_SUB_KEY** Read the [prequisites in the Quickstart documentation](https://docs.microsoft.com/en-gb/azure/cognitive-services/translator/quickstart-translator) on how to create a Translator resource in Azure and generate a key. Make sure you set the Region to "Global".

> **PRIMARY_LANG** is the target language you want the bot to translate to. Uses the ISO 639-1 standard. Examples: `en` for English, `ja` for Japanese, `ko` for Korean, `zh-Hans` for Simplified Chinese. Check the [Language Support](https://docs.microsoft.com/en-us/azure/cognitive-services/translator/language-support) doc to see what languages Azure supports and what the code is.\
> **SECONDARY\_ LANG** optional entry. Add this if you want the bot to translate to another language that isn't the primary language. Useful for (semi)-bilingual chat. For example: Assume there's a Japanese VTuber where they have both Japanese and Western fans. The VTuber only understands Japanese. If only `PRIMARY_LANG` is set, non-Japanese messages (for example English) will be translated to Japanese. So the VTuber and Japanese fans can understand it. However, if someone types in Japanese, only the VTuber and other Japanese fans can understand it, leaving the western fans a left out a bit. In this case, `SECONDARY_LANG` can be set to `en` for English. What now happens is that the messages Japanese will be translated to English, so now even the western fans can understand what the other fans are saying.

> **Per-Channel Languages**: For multi-channel setups, you can set channel-specific languages using `PRIMARY_LANG_{CHANNEL}` and `SECONDARY_LANG_{CHANNEL}`, where `{CHANNEL}` is the uppercase channel name (e.g., `PRIMARY_LANG_MYCHANNEL=en`). If not set for a channel, it falls back to the global `PRIMARY_LANG` and `SECONDARY_LANG`.

Obviously, machine translation isn't perfect and probably won't be for a very long time due to how languages work. However, that doesn't mean it's useless. It could be very useful in some streams, depending on what the chat is like.

<details>
  <summary>About the free tier</summary>
  The F1 (Free) tier allows up-to 2M million characters translated per month. From the [FAQ](https://www.microsoft.com/en-us/translator/business/faq/): "A 30-page document has around 17,000 characters; the seven Harry Potter books comprise about 60 million characters." I'm not too good at estimating but I don't think that Twitch chat will exceed the 2 million characters per month.

Though, if you're using this bot and chat is super-active, then 2 million characters _might_ not be enough. In this case, open an issue or contact me on Discord and I'll give this "issue" a higher priority on the TODO list. Nevertheless, Azure won't overcharge you if you're on the F1 tier.

</details>

So the .env should look something like this:

```.env
BOT_USERNAME=faizal01
CHANNEL_NAME=faizal101
TWITCH_OAUTH=oauth:yourouathkeydontshare # Not required if using TWITCH_OAUTH_FLOW
TWITCH_OAUTH_FLOW=true
TWITCH_CLIENT_ID=TwitchClientID # Only if TWITCH_OAUTH_FLOW is set to true
TWITCH_CLIENT_SECRET=TwitchClientSecret # Only if TWITCH_OAUTH_FLOW is set to true
ENCRYPTION_KEY=your64characterhexencryptionkey # Optional, only used when TWITCH_OAUTH_FLOW is set to true
AZURE_SUB_KEY=yoursubkeydontshare
PRIMARY_LANG=en
```

Once you saved the .env, the bot should be good to go. Simply run it by `yarn start`.

## Docker container

To run as a docker container run:

```
docker run -e BOT_USERNAME=your_bot \
           -e TWITCH_OAUTH=oauth:your_token \
           -e CHANNEL_NAME=your_channel \
           -e PRIMARY_LANG=en \
           -e AZURE_SUB_KEY=your_azure_key \
           -v /local/path:/data \
           scsa20/twitch-chat-translator-bot:test
```

## OAuth Setup

### Option 1: Local Only (Not meant for perma deployment)

1. Log into [Twitch Developer Console](https://dev.twitch.tv/console)
2. Click on "Register Your Application"
3. For the Name, set it to whatever you like.
4. For the OAuth Redirect URLs, add: http://localhost:3000/auth/callback
5. Set the Category as Chat Bot.
6. Run the bot with `yarn start`

### Option 2: Use Self-Signed Certificates (Local only) if wanting HTTPS

Generate a self-signed certificate:
```bash
openssl req -nodes -new -x509 -keyout cert.key -out cert.pem -days 365 -subj "/CN=localhost"
```

In `.env`:
```
TWITCH_OAUTH_CERT_PATH=./cert.pem
TWITCH_OAUTH_KEY_PATH=./cert.key
TWITCH_OAUTH_REDIRECT_URI=https://localhost:3000/auth/callback
```

Then register `https://localhost:3000/auth/callback` in your Twitch app settings.

**Note:** Your browser will show a security warning for self-signed certs; click "Advanced" and proceed.

### Behind a Reverse Proxy (Cloudflare, nginx, etc.)

If running the bot behind a reverse proxy like Cloudflare, the bot automatically detects and handles proxy headers:

**Setup:**
1. Configure your proxy to forward requests to the bot server on port 3000
2. Ensure the proxy sets `X-Forwarded-Proto` and `X-Forwarded-Host` headers
3. Use the proxy's public HTTPS URL as your redirect URI:
   ```
   TWITCH_OAUTH_REDIRECT_URI=https://yourdomain.com/auth/callback
   ```
4. Register the same URI in your Twitch app settings

**Example: Cloudflare proxy to internal server**
- Internal server: `http://192.168.2.42:3000`
- Cloudflare domain: `https://twitchtest.sc20.me`
- Redirect URI: `https://twitchtest.sc20.me/auth/callback`

The bot will transparently handle the proxy headers and accept OAuth callbacks through the public domain.

## Token Persistence & Auto-Refresh

When using the OAuth flow (`TWITCH_OAUTH_FLOW=true`), the bot automatically:

1. **Saves the OAuth token** to `config/oauth-token.json` after the first authorization
2. **Reuses the saved token** on subsequent restarts (no need to authorize again)
3. **Auto-refreshes the token** before expiry—checks every 30 minutes and refreshes if needed

### Token File

The token is stored encrypted-adjacent but plain in `config/oauth-token.json`. It contains:
- `accessToken`: The current access token for Twitch API
- `refreshToken`: Used to obtain new access tokens without user interaction
- `expiresAt`: Timestamp when the token expires

### Refresh Behavior

- Tokens are considered expired when within 5 minutes of actual expiry
- Auto-refresh runs every 30 minutes in the background
- If refresh fails, the bot will request new authorization on next restart
- The `config/oauth-token.json` file is automatically updated with new tokens

## Multi-Channel Support

The bot can connect to and translate messages in multiple Twitch channels simultaneously. Each channel has its own independent ignore list.

**Configuration:**
Set `CHANNEL_NAME` to multiple channels (comma or space separated):
```
# Space separated
CHANNEL_NAME=channel1 channel2 channel3

# Or comma separated
CHANNEL_NAME=channel1,channel2,channel3
```

**Per-Channel Ignore Lists:**
Each channel maintains its own ignore list stored in the config folder:
- `config/ignore-users-channel1.json`
- `config/ignore-users-channel2.json`
- etc.

When you use `!ignore add username` in a channel, that user is only ignored in that specific channel.

## Ignore List
Add/remove users to a per-channel ignore list using the following commands. The ignore list prevents the bot from translating messages from specified users in the current channel.

```
!ignore add userName     # Will add user to the current channel's ignore list
!ignore remove userName  # Will remove user from the current channel's ignore list
!ignore list             # List users in the current channel's ignore list
```

**Usage:** Only broadcasters and moderators can manage the ignore list for their channel.

If you're using docker, make sure you use the new docker run to map /data in the container path to your local system (likewise you can also use a docker volume) to ensure the lists are persistent.

## TODO List

Note: The TODO list isn't in order.

- [x] Allow the user to choose what language to translate to
- [x] Implement a user ignore list
- [x] Multi-channel support
- [ ] Implement a language ignore list
- [x] Split the function, one for detect and one to actually translate the message
- [ ] Think of a name of the bot
- [ ] Break message into multiple messages if it's too large
- [x] Allow the bot to translate to multiple languages (useful for (semi)-bilingual chat)
- [ ] Implement a web GUI for configurating the bot

## Contributing

Feel free to create a PR to this repo. You could work on one of the tasks in the TODO list, fix a bug or even implement a feature I haven't considered.
