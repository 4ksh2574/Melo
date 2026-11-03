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
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
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
