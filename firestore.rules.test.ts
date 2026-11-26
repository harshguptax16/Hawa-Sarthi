/**
 * Payload-First Security Test Suite (Dirty Dozen Invariants)
 * Verifies that all 12 adversarial payloads fail validation against Hawa Sarthi Firestore rules.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  path: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: { uid: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Cross-user profile write',
    path: '/users/userB',
    operation: 'create',
    auth: { uid: 'userA', email_verified: true },
    payload: { uid: 'userB', displayName: 'Spoof', selectedCity: 'New Delhi', theme: 'light' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Mismatched uid inside own profile',
    path: '/users/userA',
    operation: 'create',
    auth: { uid: 'userA', email_verified: true },
    payload: { uid: 'userB', displayName: 'Spoof', selectedCity: 'New Delhi', theme: 'light' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Shadow field injection (isAdmin)',
    path: '/users/userA',
    operation: 'create',
    auth: { uid: 'userA', email_verified: true },
    payload: { uid: 'userA', displayName: 'Harsh', selectedCity: 'New Delhi', theme: 'light', isAdmin: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Client-forged timestamp',
    path: '/communityPledges/pledge_1',
    operation: 'create',
    auth: { uid: 'userA', email_verified: true },
    payload: {
      uid: 'userA',
      authorName: 'Harsh',
      city: 'New Delhi',
      category: 'Carpool',
      title: 'School Carpool',
      note: 'Join our morning group',
      createdAt: '2020-01-01T00:00:00Z',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Unverified email write',
    path: '/communityPledges/pledge_2',
    operation: 'create',
    auth: { uid: 'userA', email_verified: false },
    payload: {
      uid: 'userA',
      authorName: 'Harsh',
      city: 'New Delhi',
      category: 'Carpool',
      title: 'School Carpool',
      note: 'Join our morning group',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Cross-user chatMessages list',
    path: '/users/userB/chatMessages',
    operation: 'list',
    auth: { uid: 'userA', email_verified: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Mismatched dateId on impactLogs',
    path: '/users/userA/impactLogs/2026-11-25',
    operation: 'create',
    auth: { uid: 'userA', email_verified: true },
    payload: {
      uid: 'userA',
      dateId: '2026-01-01',
      city: 'New Delhi',
      completedIds: [],
      pm25ReductionPct: 10,
      co2SavedGrams: 500,
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'ID poisoning > 128 chars',
    path: `/communityPledges/${'x'.repeat(200)}`,
    operation: 'create',
    auth: { uid: 'userA', email_verified: true },
    payload: { uid: 'userA', authorName: 'Harsh', city: 'New Delhi', category: 'Zero-Burn', title: 'Test', note: 'Test' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Oversized chat message > 8000 chars',
    path: '/users/userA/chatMessages/msg_1',
    operation: 'create',
    auth: { uid: 'userA', email_verified: true },
    payload: {
      uid: 'userA',
      role: 'user',
      personaRole: 'General',
      model: 'gemini-4-hydrogen',
      text: 'a'.repeat(9000),
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Unbounded array > 30 items in completedIds',
    path: '/users/userA/impactLogs/2026-11-25',
    operation: 'create',
    auth: { uid: 'userA', email_verified: true },
    payload: {
      uid: 'userA',
      dateId: '2026-11-25',
      city: 'New Delhi',
      completedIds: Array.from({ length: 40 }, (_, i) => `step_${i}`),
      pm25ReductionPct: 20,
      co2SavedGrams: 1000,
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Non-owner pledge deletion',
    path: '/communityPledges/pledge_owned_by_A',
    operation: 'delete',
    auth: { uid: 'userB', email_verified: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Immutable createdAt mutation',
    path: '/users/userA/chatMessages/msg_1',
    operation: 'update',
    auth: { uid: 'userA', email_verified: true },
    payload: { uid: 'userA', text: 'Modified', createdAt: 'NEW_TIME' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
];
