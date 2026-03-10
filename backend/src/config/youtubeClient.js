import { google } from "googleapis";
import Token from "../models/Token.js";

// const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REDIRECT_URI } =
//   process.env;

// if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REDIRECT_URI) {
//   console.warn("YouTube OAuth environment variables are not fully set.");
// }

export function createOAuthClient() {
  console.log("CLIENT ID:", process.env.YOUTUBE_CLIENT_ID);
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI,
  );
}

export async function getAuthorizedYoutubeClient() {
  const oAuth2Client = createOAuthClient();

  const tokenDoc = await Token.findOne({ provider: "google" }).lean();
  if (!tokenDoc || !tokenDoc.refreshToken) {
    throw new Error(
      "No stored refresh token found. Please complete OAuth flow.",
    );
  }

  oAuth2Client.setCredentials({
    access_token: tokenDoc.accessToken,
    refresh_token: tokenDoc.refreshToken,
    expiry_date: tokenDoc.expiryDate,
    token_type: tokenDoc.tokenType,
    scope: tokenDoc.scope,
  });

  // Ensure refresh works and save new tokens if rotated
  oAuth2Client.on("tokens", async (tokens) => {
    if (!tokens) return;
    await Token.updateOne(
      { provider: "google" },
      {
        $set: {
          accessToken: tokens.access_token || tokenDoc.accessToken,
          refreshToken: tokens.refresh_token || tokenDoc.refreshToken,
          expiryDate: tokens.expiry_date || tokenDoc.expiryDate,
          tokenType: tokens.token_type || tokenDoc.tokenType,
          scope: tokens.scope || tokenDoc.scope,
        },
      },
      { upsert: true },
    );
  });

  const youtube = google.youtube({
    version: "v3",
    auth: oAuth2Client,
  });
  const response = await youtube.channels.list({
    part: "snippet",
    mine: true,
  });

  return youtube;
}
