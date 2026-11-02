# Melo

**Closer, even from afar.**

Melo is a private, mobile-first messaging app for a circle of exactly four people.

## Current implementation

- Light-first, responsive chat interface with soft white surfaces and teal accents.
- Firebase Authentication: Google sign-in, email/password sign-in, and password reset.
- Firestore real-time group chat at `rooms/the-four/messages`.
- Membership gate: only users with an admin-created `members/{uid}` document whose `active` field is `true` can access messages.
- No public sign-up form. Create email/password accounts from Firebase Console, or let the four intended people sign in with Google once and then approve their UIDs.

## Firebase setup

1. In Firebase Authentication, enable **Google** and **Email/Password**.
2. Under Authentication → Settings → Authorized domains, add `4ksh2574.github.io`.
3. Create a Cloud Firestore database.
4. In Firestore Rules, publish the contents of `firestore.rules`.
5. Each intended member must sign in once. Find their UID in Firebase Authentication → Users.
6. In Firestore Data, create a collection named `members`. For each of the four approved UIDs, create a document whose document ID is exactly that UID, with field `active` (boolean) set to `true`.
7. Do not create membership documents for anyone else. Do not enable public account creation or share admin credentials.

Email/password users must first be created by the project owner in Authentication → Users → Add user. Google users can complete Google sign-in, but remain in the pending screen until their UID is approved.

## Deployment

Enable GitHub Pages from the `main` branch and root folder. Expected URL: `https://4ksh2574.github.io/Melo/`.

## Current limits

This is the first connected foundation: authentication, approval gating, and one real-time group chat. Direct messages, attachments, voice notes, reactions, edits/deletes, typing indicators, read receipts, notifications, and ephemeral updates are not implemented yet. Do not treat the app as fully featured until those are added and tested.

The Firebase web config is included in the frontend. Firebase web API keys identify the project; security comes from Authentication and Firestore Rules, not from hiding this config. Never put service-account keys or private credentials in this repository.
