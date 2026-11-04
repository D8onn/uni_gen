import assert from "node:assert/strict";
import test from "node:test";
import { createInspection, isEditing, shouldClearOnKey } from "../src/ui/inspection.js";

function createHarness() {
	const calls = [];
	const inspection = createInspection({
		planet: { setSelectedCell: (cellId) => calls.push(["planet", cellId]) },
		client: { inspect: (cellId) => calls.push(["worker", cellId]) },
	});
	return { inspection, calls };
}

test("selecting a cell highlights it and asks the worker for it, in step", () => {
	const { inspection, calls } = createHarness();
	assert.equal(inspection.selected, null);
	assert.equal(inspection.select(12), true);
	assert.equal(inspection.selected, 12);
	assert.deepEqual(calls, [["planet", 12], ["worker", 12]]);
	assert.equal(inspection.select(40), true);
	assert.equal(inspection.selected, 40);
	assert.deepEqual(calls.slice(2), [["planet", 40], ["worker", 40]]);
});

test("selecting the selected cell again does nothing, so its details are not cleared and refetched", () => {
	const { inspection, calls } = createHarness();
	inspection.select(7);
	calls.length = 0;
	assert.equal(inspection.select(7), false);
	assert.deepEqual(calls, []);
	assert.equal(inspection.selected, 7);
});

test("clearing the selection stops the highlight and the inspection, and clearing again does nothing", () => {
	const { inspection, calls } = createHarness();
	assert.equal(inspection.select(null), false, "nothing was selected");
	assert.deepEqual(calls, []);
	inspection.select(3);
	calls.length = 0;
	assert.equal(inspection.select(null), true);
	assert.deepEqual(calls, [["planet", null], ["worker", null]]);
	assert.equal(inspection.selected, null);
	assert.equal(inspection.select(null), false);
});

test("the panel accepts only cell messages about the selected cell", () => {
	const { inspection } = createHarness();
	assert.equal(inspection.accepts({ type: "cell", cellId: 5 }), false, "nothing is selected yet");
	assert.equal(inspection.accepts({ type: "cell", cellId: null }), false, "a malformed message is not about the cleared selection");
	inspection.select(5);
	assert.equal(inspection.accepts({ type: "cell", cellId: 5 }), true);
	assert.equal(inspection.accepts({ type: "cell", cellId: 6 }), false, "a late message about an earlier cell");
	assert.equal(inspection.accepts({ type: "snapshot", cellId: 5 }), false);
	assert.equal(inspection.accepts({ type: "error", message: "x" }), false);
	inspection.select(null);
	assert.equal(inspection.accepts({ type: "cell", cellId: 5 }), false, "a message that arrives after Close");
});

test("form fields and editable elements are editing; everything else is not", () => {
	for (const tagName of ["INPUT", "SELECT", "TEXTAREA"]) assert.equal(isEditing({ tagName }), true, tagName);
	assert.equal(isEditing({ tagName: "DIV", isContentEditable: true }), true);
	for (const target of [{ tagName: "BODY" }, { tagName: "CANVAS" }, { tagName: "BUTTON" }, { tagName: "DIV", isContentEditable: false }, null, undefined]) {
		assert.equal(isEditing(target), false, JSON.stringify(target));
	}
});

test("Escape clears the selection unless it is pressed in a field", () => {
	assert.equal(shouldClearOnKey({ key: "Escape", target: { tagName: "BODY" } }), true);
	assert.equal(shouldClearOnKey({ key: "Escape", target: { tagName: "CANVAS" } }), true);
	assert.equal(shouldClearOnKey({ key: "Escape", target: { tagName: "BUTTON" } }), true);
	for (const tagName of ["INPUT", "SELECT", "TEXTAREA"]) assert.equal(shouldClearOnKey({ key: "Escape", target: { tagName } }), false, tagName);
	assert.equal(shouldClearOnKey({ key: "Escape", target: { tagName: "DIV", isContentEditable: true } }), false);
	assert.equal(shouldClearOnKey({ key: "Enter", target: { tagName: "BODY" } }), false);
	assert.equal(shouldClearOnKey({ key: "a", target: null }), false);
});
