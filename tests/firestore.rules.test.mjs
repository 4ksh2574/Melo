import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

const projectId = "demo-melo-rules";
const activeUids = ["u1", "u2", "u3", "u4"];
let testEnv;

function userDb(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

async function seedMembers() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    for (const uid of activeUids) {
      await setDoc(doc(database, "members", uid), { active: true });
    }
  });
}

before(async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedMembers();
});

after(async () => {
  await testEnv?.cleanup();
});

test("approved members can open a direct chat without following", async () => {
  const database = userDb("u1");
  // The app checks a deterministic ID before creating its conversation document.
  await assertSucceeds(getDoc(doc(database, "conversations/u1__u2")));
  await assertSucceeds(setDoc(doc(database, "conversations/u1__u2"), {
    type: "direct",
    memberIds: ["u1", "u2"],
    createdBy: "u1",
    createdAt: serverTimestamp(),
  }));
  await assertSucceeds(addDoc(collection(userDb("u2"), "conversations/u1__u2/messages"), {
    uid: "u2",
    text: "Hello",
    createdAt: serverTimestamp(),
  }));
});

test("a non-member cannot read a private conversation or its messages", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await setDoc(doc(database, "conversations/u1__u2"), {
      type: "direct",
      memberIds: ["u1", "u2"],
      createdBy: "u1",
      createdAt: new Date(),
    });
    await setDoc(doc(database, "conversations/u1__u2/messages/m1"), {
      uid: "u1",
      text: "Private",
      createdAt: new Date(),
    });
  });
  await assertSucceeds(getDoc(doc(userDb("u1"), "conversations/u1__u2")));
  await assertFails(getDoc(doc(userDb("u3"), "conversations/u1__u2")));
  await assertFails(getDoc(doc(userDb("u3"), "conversations/u1__u2/messages/m1")));
});

test("private groups accept 2, 3, or 4 distinct approved members", async () => {
  const database = userDb("u1");
  const groups = [
    { id: "group-two", memberIds: ["u1", "u2"] },
    { id: "group-three", memberIds: ["u1", "u2", "u3"] },
    { id: "group-four", memberIds: ["u1", "u2", "u3", "u4"] },
  ];
  for (const group of groups) {
    await assertSucceeds(setDoc(doc(database, "conversations/" + group.id), {
      type: "group",
      title: group.id,
      memberIds: group.memberIds,
      createdBy: "u1",
      createdAt: serverTimestamp(),
    }));
  }
});

test("groups reject duplicates, unapproved users, and a creator outside the group", async () => {
  const database = userDb("u1");
  const payload = (memberIds) => ({
    type: "group",
    title: "Invalid group",
    memberIds,
    createdBy: "u1",
    createdAt: serverTimestamp(),
  });
  await assertFails(setDoc(doc(database, "conversations/duplicate"), payload(["u1", "u1"])));
  await assertFails(setDoc(doc(database, "conversations/unapproved"), payload(["u1", "u5"])));
  await assertFails(setDoc(doc(database, "conversations/not-creator"), payload(["u2", "u3"])));
  await assertFails(setDoc(doc(database, "conversations/too-many"), payload(["u1", "u2", "u3", "u4", "u5"])));
});

test("The Four requires its fixed ID, title, permanent flag, and four approved members", async () => {
  const database = userDb("u1");
  // The permanent group is also checked before first-time initialization.
  await assertSucceeds(getDoc(doc(database, "conversations/the-four")));
  await assertSucceeds(setDoc(doc(database, "conversations/the-four"), {
    type: "group",
    title: "The Four",
    memberIds: ["u1", "u2", "u3", "u4"],
    createdBy: "u1",
    createdAt: serverTimestamp(),
    isPermanent: true,
  }));
});

test("The Four rejects incomplete or incorrectly named groups", async () => {
  const database = userDb("u1");
  await assertFails(setDoc(doc(database, "conversations/the-four"), {
    type: "group",
    title: "The Four",
    memberIds: ["u1", "u2", "u3"],
    createdBy: "u1",
    createdAt: serverTimestamp(),
    isPermanent: true,
  }));
  await assertFails(setDoc(doc(database, "conversations/not-the-four"), {
    type: "group",
    title: "The Four",
    memberIds: ["u1", "u2", "u3", "u4"],
    createdBy: "u1",
    createdAt: serverTimestamp(),
    isPermanent: true,
  }));
});

test("messages enforce sender identity and non-empty 4,000-character limit", async () => {
  const database = userDb("u1");
  await assertSucceeds(setDoc(doc(database, "conversations/u1__u2"), {
    type: "direct",
    memberIds: ["u1", "u2"],
    createdBy: "u1",
    createdAt: serverTimestamp(),
  }));
  const messages = collection(database, "conversations/u1__u2/messages");
  await assertFails(addDoc(messages, {
    uid: "u2",
    text: "Impersonated sender",
    createdAt: serverTimestamp(),
  }));
  await assertFails(addDoc(messages, {
    uid: "u1",
    text: "",
    createdAt: serverTimestamp(),
  }));
  await assertFails(addDoc(messages, {
    uid: "u1",
    text: "x".repeat(4001),
    createdAt: serverTimestamp(),
  }));
});


test("conversation members can update only supported disappearing-message durations", async () => {
  const data = userDb("u1");
  await assertSucceeds(setDoc(doc(data, "conversations/u1__u2"), {
    type: "direct",
    memberIds: ["u1", "u2"],
    createdBy: "u1",
    createdAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(doc(data, "conversations/u1__u2"), {
    disappearingAfterSeconds: 3600,
  }));
  await assertFails(updateDoc(doc(data, "conversations/u1__u2"), {
    disappearingAfterSeconds: 123,
  }));
  await assertFails(updateDoc(doc(data, "conversations/u1__u2"), {
    title: "Changed title",
  }));
  await assertFails(updateDoc(doc(userDb("u3"), "conversations/u1__u2"), {
    disappearingAfterSeconds: 300,
  }));
});

test("only expired messages can be cleaned up by conversation members", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await setDoc(doc(database, "conversations/u1__u2"), {
      type: "direct",
      memberIds: ["u1", "u2"],
      createdBy: "u1",
      createdAt: new Date(),
    });
    await setDoc(doc(database, "conversations/u1__u2/messages/expired"), {
      uid: "u2",
      text: "Expired",
      createdAt: new Date(),
      expiresAt: Timestamp.fromMillis(Date.now() - 60_000),
    });
    await setDoc(doc(database, "conversations/u1__u2/messages/not-expired"), {
      uid: "u2",
      text: "Still active",
      createdAt: new Date(),
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });
  });
  await assertSucceeds(deleteDoc(doc(userDb("u1"), "conversations/u1__u2/messages/expired")));
  await assertFails(deleteDoc(doc(userDb("u1"), "conversations/u1__u2/messages/not-expired")));
  await assertFails(deleteDoc(doc(userDb("u3"), "conversations/u1__u2/messages/not-expired")));
});

test("new messages may carry a valid future expiry timestamp", async () => {
  const data = userDb("u1");
  await assertSucceeds(setDoc(doc(data, "conversations/u1__u2"), {
    type: "direct",
    memberIds: ["u1", "u2"],
    createdBy: "u1",
    createdAt: serverTimestamp(),
  }));
  await assertSucceeds(addDoc(collection(data, "conversations/u1__u2/messages"), {
    uid: "u1",
    text: "This will expire",
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
  }));
  await assertFails(addDoc(collection(data, "conversations/u1__u2/messages"), {
    uid: "u1",
    text: "Already expired",
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() - 60_000),
  }));
});

test("legacy direct-message and The Four history remain readable", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await setDoc(doc(database, "chats/u1__u2"), {
      memberIds: ["u1", "u2"],
      createdAt: new Date(),
    });
    await setDoc(doc(database, "chats/u1__u2/messages/old-direct"), {
      uid: "u2",
      text: "Old direct message",
      createdAt: new Date(),
    });
    await setDoc(doc(database, "rooms/the-four/messages/old-four"), {
      uid: "u3",
      displayName: "Member Three",
      text: "Old group message",
      createdAt: new Date(),
    });
  });
  await assertSucceeds(getDoc(doc(userDb("u1"), "chats/u1__u2/messages/old-direct")));
  await assertSucceeds(getDoc(doc(userDb("u1"), "rooms/the-four/messages/old-four")));
  await assertFails(getDoc(doc(userDb("u4"), "chats/u1__u2/messages/old-direct")));
});
