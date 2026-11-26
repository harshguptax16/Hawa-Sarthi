# Security Specification & Invariants — Hawa Sarthi Firestore

## 1. Data Invariants
1. **Strict Ownership (`/users/{userId}`)**: A user profile document can only be read, created, or updated by the verified user whose `request.auth.uid == userId` and `incoming().uid == request.auth.uid`. No user can read or list another user's profile.
2. **Subcollection Master Gate (`/users/{userId}/impactLogs/{dateId}` & `/users/{userId}/chatMessages/{messageId}`)**: Both subcollections require `request.auth.uid == userId`, `exists(/databases/$(database)/documents/users/$(userId))`, and `incoming().uid == request.auth.uid`.
3. **Immutable Audit & Ownership Fields**: `uid` and `createdAt` (or `dateId` on `impactLogs`) are immutable once written. All `createdAt` and `updatedAt` timestamps must strictly equal `request.time`.
4. **No PII Leakage**: Emails, phone numbers, and street addresses are never stored on `users/{userId}` or `communityPledges/{pledgeId}`.
5. **Bounded Arrays & Strings**: `joinedPledges` is capped at 20 items, `completedIds` at 30 items, `text` at 8000 chars, and all path IDs must match `^[a-zA-Z0-9_\-]+$` with length `<= 128`.
6. **Verified Community Pledges (`/communityPledges/{pledgeId}`)**: Only signed-in users with `email_verified == true` can read or create pledges, `incoming().uid` must match `request.auth.uid`, and only the owner can delete or update their pledge.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Identity Spoofing on Profile Create**: User A tries to write `/users/userB` with `uid: "userB"`.
2. **UID Field Tampering**: User A writes `/users/userA` with `uid: "userB"`.
3. **Ghost / Shadow Field Injection**: User A includes `"isAdmin": true` or `"role": "moderator"` in `/users/userA`.
4. **Timestamp Forgery**: User A supplies a past ISO string or client Date for `updatedAt` / `createdAt` instead of `request.time`.
5. **Unverified Email Write**: Authenticated user with `email_verified: false` tries to create a `CommunityPledge`.
6. **Cross-User Subcollection Read**: User A attempts `get` or `list` on `/users/userB/chatMessages`.
7. **Orphaned Subcollection Write**: User A attempts to write `/users/userA/impactLogs/2026-11-25` before `/users/userA` exists (or with mismatched `dateId`).
8. **ID Poisoning**: Attacker targets `/communityPledges/` with a 500-character ID or invalid characters (`../../admin`).
9. **Resource Exhaustion / 1MB String**: Attacker submits a 20,000-character `text` field in `chatMessages`.
10. **Unbounded Array Attack**: Attacker submits 100 strings in `completedIds` or `joinedPledges`.
11. **Pledge Hijack Update**: User B attempts to `update` or `delete` User A's `CommunityPledge`.
12. **Immutable Field Mutation**: User A attempts to change `createdAt` or `uid` on an existing `ChatMessageDoc`.
