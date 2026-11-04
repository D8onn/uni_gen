// Which cell is being inspected, and when to stop, without touching the page.

// True for a form field or editable element, where keys belong to the field.
export function isEditing(target) {
	return ["INPUT", "SELECT", "TEXTAREA"].includes(target?.tagName) || target?.isContentEditable === true;
}

// Escape clears the selection, except when it is pressed to cancel an edit in a field.
export function shouldClearOnKey(event) {
	return event.key === "Escape" && !isEditing(event.target);
}

/**
 * Tracks the selected cell and keeps the planet and the worker in step with it. `select(cellId)` (null clears) returns
 * false, and does nothing, when that cell is already selected; `accepts(message)` is true for the worker's `cell`
 * message about the selected cell, so a late message about an earlier one is ignored.
 */
export function createInspection({ planet, client }) {
	let selected = null;
	return {
		get selected() {
			return selected;
		},
		select(cellId) {
			if (cellId === selected) return false;
			selected = cellId;
			planet.setSelectedCell(cellId);
			client.inspect(cellId);
			return true;
		},
		accepts: (message) => message.type === "cell" && selected !== null && message.cellId === selected,
	};
}
