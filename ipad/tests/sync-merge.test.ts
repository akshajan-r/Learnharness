import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { decideFile, ledgerLines, mergeJson, mergeLedger } from "../src/sync/merge.ts";

const h = (s: string) => createHash("sha256").update(s).digest("hex");
const set = (...lines: string[]) => new Set(lines.map(h));

describe("mergeLedger", () => {
	it("first sync: union, local order then remote additions", () => {
		assert.deepEqual(mergeLedger(set(), ["a", "b"], ["c", "a"], h), ["a", "b", "c"]);
	});
	it("keeps additions from both sides", () => {
		assert.deepEqual(mergeLedger(set("a"), ["a", "l"], ["a", "r"], h), ["a", "l", "r"]);
	});
	it("propagates removals from either side", () => {
		assert.deepEqual(mergeLedger(set("a", "b", "c"), ["a", "c"], ["a", "b"], h), ["a"]);
	});
	it("a remote record's defining line stays before its appends", () => {
		const out = mergeLedger(set("x"), ["x"], ["x", '{"id":"n1","v":1}', '{"id":"n1","alias":2}'], h);
		assert.deepEqual(out, ["x", '{"id":"n1","v":1}', '{"id":"n1","alias":2}']);
	});
	it("duplicate identical lines collapse", () => {
		assert.deepEqual(mergeLedger(set(), ["a", "a"], ["a"], h), ["a"]);
	});
	it("ledgerLines drops blanks and trims", () => {
		assert.deepEqual(ledgerLines('{"a":1}\n\n {"b":2} \n'), ['{"a":1}', '{"b":2}']);
	});
});

describe("mergeJson", () => {
	it("takes the side that changed", () => {
		assert.deepEqual(mergeJson({ v: 1 }, { v: 1 }, { v: 2 }, true), { v: 2 });
		assert.deepEqual(mergeJson({ v: 1 }, { v: 3 }, { v: 1 }, false), { v: 3 });
	});
	it("merges objects per key, including additions and removals", () => {
		const base = { placements: { a: 1, b: 1 } };
		const local = { placements: { a: 1, b: 1, c: 1 } };
		const remote = { placements: { a: 1 } };
		assert.deepEqual(mergeJson(base, local, remote, true), { placements: { a: 1, c: 1 } });
	});
	it("merges arrays of {id} objects per id", () => {
		const base = { folders: [{ id: "f1", name: "One" }] };
		const local = { folders: [{ id: "f1", name: "Uno" }, { id: "f2", name: "Two" }] };
		const remote = { folders: [{ id: "f1", name: "One" }, { id: "f3", name: "Three" }] };
		assert.deepEqual(mergeJson(base, local, remote, false), { folders: [{ id: "f1", name: "Uno" }, { id: "f2", name: "Two" }, { id: "f3", name: "Three" }] });
	});
	it("both changed the same value: preferLocal decides", () => {
		assert.deepEqual(mergeJson({ v: 1 }, { v: 2 }, { v: 3 }, true), { v: 2 });
		assert.deepEqual(mergeJson({ v: 1 }, { v: 2 }, { v: 3 }, false), { v: 3 });
	});
});

describe("decideFile", () => {
	it("unchanged, one-sided edits, and new files", () => {
		assert.equal(decideFile("x", "x", "x").kind, "same");
		assert.equal(decideFile("x", "y", "x").kind, "upload");
		assert.equal(decideFile("x", "x", "y").kind, "download");
		assert.equal(decideFile(undefined, "y", undefined).kind, "upload");
		assert.equal(decideFile(undefined, undefined, "y").kind, "download");
	});
	it("deletions propagate only over unchanged copies", () => {
		assert.equal(decideFile("x", undefined, "x").kind, "delete-remote");
		assert.equal(decideFile("x", "x", undefined).kind, "delete-local");
		assert.equal(decideFile("x", undefined, "y").kind, "download");
		assert.equal(decideFile("x", "y", undefined).kind, "upload");
	});
	it("both edited differently is a conflict; identical edits are not", () => {
		assert.equal(decideFile("x", "y", "z").kind, "conflict");
		assert.equal(decideFile("x", "y", "y").kind, "same");
		assert.equal(decideFile(undefined, "y", "z").kind, "conflict");
	});
});
