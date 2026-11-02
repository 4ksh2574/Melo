# Melo

Melo is a private, Instagram-inspired social and messaging space for exactly four approved members.

## Current features
- Google and email/password sign-in, plus password reset.
- Instagram-inspired home feed layout, Stories-style member row, Explore, Inbox and Profile navigation.
- Discover the other approved members and follow/unfollow them.
- Direct messages unlock after you follow a member.
- Real-time one-to-one messaging and the existing group conversation foundation.
- Firestore membership checks and follow-gated chat rules.

## Firebase setup
1. Enable Google and Email/Password in Authentication.
2. Add `4ksh2574.github.io` to Authentication → Settings → Authorized domains.
3. Publish `firestore.rules` in Firestore → Rules.
4. Each intended person must sign in once. In Authentication → Users, copy each UID.
5. In Firestore, create a `members` document for each of the four UIDs, with `active` (boolean) = `true`. Add optional `displayName` and `username` string fields to show their preferred names.
6. Do not create member records for anyone else. Email/password accounts must be created by the project owner in Authentication → Users → Add user. Google sign-in users remain pending until their UID is approved.

## Deploy
GitHub Pages: `main` branch, root folder. URL: https://4ksh2574.github.io/Melo/

## Notes
The visual layout is an original Melo design inspired by familiar social-app patterns, not an exact reproduction of Instagram. The current feed uses a welcome panel; post creation, Stories uploads, media sharing, profile editing, follow requests/private-account approval, notifications and richer chat tools are future work. Follow currently means a member can initiate a DM after following another approved member; the followed member can reply in that thread.
