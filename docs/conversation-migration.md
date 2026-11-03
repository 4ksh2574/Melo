# Melo conversation migration

## New Firestore model

- `conversations/{conversationId}` stores conversation metadata.
- `conversations/{conversationId}/messages/{messageId}` stores new text messages.
- A direct conversation uses the deterministic ID formed from the two Firebase UIDs in sorted order, joined with `__`.
- A private group uses a Firestore-generated document ID and contains 2–4 distinct approved member UIDs, including its creator.
- The permanent group uses the fixed ID `the-four`, title `The Four`, exactly four approved member UIDs, and `isPermanent: true`.

Message documents contain `uid`, `text`, and `createdAt`, with optional `expiresAt` for disappearing messages. The rules enforce the signed-in sender, non-empty text up to 4,000 characters, a server timestamp, and a future expiry timestamp when supplied. Conversation documents may also contain `disappearingAfterSeconds`.

## Legacy data protection

The migration is additive. It does not delete or rewrite existing records.

- Existing direct-message documents in `chats/{sortedUidA__sortedUidB}/messages` remain readable by their two members.
- Existing The Four messages in `rooms/the-four/messages` remain readable by approved members.
- The React app reads old and new message paths together for the relevant conversation.
- All new messages are written only to the new `conversations` path.
- The legacy `chats` and `rooms` rules are retained for backward compatibility with the currently deployed site.

No bulk copy is required for this release. Personal nicknames are stored locally per device. Links are extracted from text messages; media and document uploads are not implemented in this milestone. Browser screenshot blocking is unavailable, and a Safety Number cannot be provided until end-to-end encryption exists. Disappearing messages are hidden at expiry while a chat is open and deleted by a member's client; if everyone stays offline, deletion waits until someone opens the conversation again. This is not a server-side guaranteed deletion schedule.

## Security properties

- Only approved members can read a conversation or its messages.
- Direct conversations are deterministic and do not require a follow relationship.
- Group creation requires 2–4 unique approved members and the creator must be included.
- The Four can only be created at its fixed document ID with four approved members.
- Message edits and conversation deletes are denied. Members may update only the allow-listed disappearing-message duration. A member may delete a message only after its `expiresAt` timestamp has passed.
- Unmatched collections remain denied by the catch-all rule.

## Rollout checklist

1. Review the `firestore.rules` file on the `react-typescript-migration` branch.
2. Before testing the new app against the live Firebase project, publish those rules in Firebase Console → Firestore Database → Rules. Do not deploy the React app while the old rules are active; the new conversation paths will be denied.
3. Keep the current GitHub Pages deployment on `main` until the React build and phone-based sign-in/chat tests pass.
4. Test a direct chat without following, a two-person custom group, a three-person group, a four-person group, and The Four.
5. Verify that old direct messages and old The Four messages still appear.
6. Only after those checks should the migration pull request be merged and GitHub Pages switched to the React build.

## Automated tests

The repository includes Firestore Emulator tests in `tests/firestore.rules.test.mjs`. Run them with `npm run test:rules` (requires Node.js 24 and Java 21 for the current test toolchain). The GitHub Actions migration workflow runs the production build and the emulator test suite on branch pushes and pull requests.

## Test matrix

| Case | Expected result |
| --- | --- |
| Approved member opens another approved member's DM | Allowed without following |
| Unapproved account tries to read a conversation | Denied |
| Group has 2, 3, or 4 distinct approved members | Allowed |
| Group has fewer than 2, more than 4, or duplicate members | Denied |
| Group creator is not in memberIds | Denied |
| The Four contains exactly 4 approved members | Allowed at `conversations/the-four` |
| The Four has fewer than 4 members or a different title | Denied |
| Non-member reads a message | Denied |
| Message is empty, longer than 4,000 chars, or has a mismatched UID | Denied |
| Expiry duration is one of the supported values and is changed by a member | Allowed |
| Message has a valid future expiry timestamp | Allowed |
| Message deletion is attempted before expiry or by a non-member | Denied |
| Message deletion is attempted after expiry by a member | Allowed |
| Existing legacy history is read | Allowed under the legacy membership rules |
| Legacy message records are deleted or overwritten by migration | Never performed |
