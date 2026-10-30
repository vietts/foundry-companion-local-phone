import { test } from "node:test";
import assert from "node:assert/strict";
import { newPassword, qrTarget, uniqueUserName } from "../scripts/app/live-data.mjs";

test("qrTarget without a login page opens Foundry's join page", () => {
  const url = qrTarget({ loginUrl: "", joinUrl: "https://vtt.example/join", userId: "u1", password: "x" });
  assert.equal(url, "https://vtt.example/join");
});

test("qrTarget puts user and password in the fragment of the login page", () => {
  const url = new URL(qrTarget({ loginUrl: "/accesso/", joinUrl: "https://vtt.example/join", userId: "u1", password: "a&b=c" }));
  assert.equal(url.origin + url.pathname, "https://vtt.example/accesso/");
  assert.equal(url.search, "");
  const params = new URLSearchParams(url.hash.slice(1));
  assert.equal(params.get("u"), "u1");
  assert.equal(params.get("p"), "a&b=c");
});

test("qrTarget keeps an absolute login page as is", () => {
  const url = qrTarget({ loginUrl: "https://vtt.example/accesso/", joinUrl: "https://vtt.example/join", userId: "u1", password: "p" });
  assert.equal(url, "https://vtt.example/accesso/#u=u1&p=p");
});

test("qrTarget adds the character's name and a local portrait for the login page", () => {
  const url = new URL(qrTarget({ loginUrl: "/accesso/", joinUrl: "https://vtt.example/join", userId: "u1", password: "p", name: "Kaelin Sottobosco", img: "worlds/w/kaelin.webp" }));
  const params = new URLSearchParams(url.hash.slice(1));
  assert.equal(params.get("n"), "Kaelin Sottobosco");
  assert.equal(params.get("i"), "worlds/w/kaelin.webp");
});

test("qrTarget leaves out portraits from elsewhere", () => {
  for (const img of ["https://cdn.example/a.webp", "//cdn.example/a.webp", "data:image/png;base64,AAAA", "x".repeat(121)]) {
    const url = new URL(qrTarget({ loginUrl: "/accesso/", joinUrl: "https://vtt.example/join", userId: "u1", password: "p", img }));
    assert.equal(new URLSearchParams(url.hash.slice(1)).get("i"), null, img.slice(0, 30));
  }
});

test("newPassword has the requested length and no ambiguous characters", () => {
  const pw = newPassword(40);
  assert.equal(pw.length, 40);
  assert.doesNotMatch(pw, /[0O1lI]/);
});

test("uniqueUserName adds a number when the name is taken", () => {
  assert.equal(uniqueUserName("Khari", new Set()), "Khari");
  assert.equal(uniqueUserName("Khari", new Set(["Khari"])), "Khari (2)");
  assert.equal(uniqueUserName("Khari", new Set(["Khari", "Khari (2)"])), "Khari (3)");
});
