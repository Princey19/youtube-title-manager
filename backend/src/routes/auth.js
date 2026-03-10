import express from "express";
import { createOAuthClient } from "../config/youtubeClient.js";
import Token from "../models/Token.js";

const router = express.Router();

// Scopes for managing YouTube content
const SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];
console.log("CLIENT ID:", process.env.YOUTUBE_CLIENT_ID);
router.get("/url", (req, res) => {
  const oAuth2Client = createOAuthClient();
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    redirect_uri: process.env.YOUTUBE_REDIRECT_URI,
  });
  res.json({ url: authUrl });
});

router.get("/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) {
      return res.status(400).send("Missing code parameter");
    }
    const oAuth2Client = createOAuthClient();
    const { tokens } = await oAuth2Client.getToken(code);

    await Token.updateOne(
      { provider: "google" },
      {
        $set: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiryDate: tokens.expiry_date,
          tokenType: tokens.token_type,
          scope: Array.isArray(tokens.scope)
            ? tokens.scope.join(" ")
            : tokens.scope,
        },
      },
      { upsert: true },
    );

    res.send(
      "YouTube authorization successful. You can close this window and return to the internal tool.",
    );
  } catch (err) {
    console.error("OAuth callback error", err);
    res.status(500).send("OAuth callback failed");
  }
});

export default router;
