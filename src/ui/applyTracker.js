// Tracks the panel's Apply requests against what the worker reports running; no DOM, so the races are testable in Node.

// Snapshots set the applied settings and confirm the pending Apply by request id; the worker answers in order, so Reset targets an Apply still in flight.
export function createApplyTracker(initialParams) {
	let applied = initialParams;
	let pending = null; // { requestId, params } for the Apply the worker has not yet reported running
	let lastRequestId = 0;

	return {
		applied: () => applied,
		pending: () => pending,
		apply(params) {
			lastRequestId += 1;
			pending = { requestId: lastRequestId, params };
			return lastRequestId;
		},
		resetTarget: () => pending?.params ?? applied,
		setSpeed(speed) {
			applied = { ...applied, speed };
			if (pending !== null) pending = { ...pending, params: { ...pending.params, speed } };
		},
		failed(requestId) {
			if (pending === null || requestId !== pending.requestId) return false; // request ids start at 1, so a null or missing id never matches
			pending = null;
			return true;
		},
		snapshot({ params, appliedRequest }) {
			applied = params;
			if (pending === null || appliedRequest !== pending.requestId) return false;
			pending = null;
			return true;
		},
	};
}
