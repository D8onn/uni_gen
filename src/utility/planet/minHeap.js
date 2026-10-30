// Binary min-heap ordered by priority, then id, so equal priorities pop in a deterministic order.
export function createMinHeap() {
	const entries = [];

	function isBefore(a, b) {
		return a.priority < b.priority || (a.priority === b.priority && a.id < b.id);
	}

	return {
		get size() {
			return entries.length;
		},
		push(id, priority) {
			const entry = { id, priority };
			entries.push(entry);
			let index = entries.length - 1;
			while (index > 0) {
				const parent = Math.floor((index - 1) / 2);
				if (!isBefore(entry, entries[parent])) break;
				entries[index] = entries[parent];
				index = parent;
			}
			entries[index] = entry;
		},
		pop() {
			const first = entries[0];
			const last = entries.pop();
			if (entries.length === 0) return first;

			let index = 0;
			while (index * 2 + 1 < entries.length) {
				let child = index * 2 + 1;
				if (child + 1 < entries.length && isBefore(entries[child + 1], entries[child])) {
					child++;
				}
				if (!isBefore(entries[child], last)) break;
				entries[index] = entries[child];
				index = child;
			}
			entries[index] = last;
			return first;
		},
	};
}
