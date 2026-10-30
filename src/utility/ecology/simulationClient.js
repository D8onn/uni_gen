// Main-thread handle on the simulation worker.

/**
 * Starts the worker. `subscribe(listener)` replays the latest snapshot (or the latest error while
 * there is none), then calls `listener(message)` with every `snapshot` or `error` message the worker posts.
 */
export function createSimulationClient() {
	const worker = new Worker(new URL("./simulation.worker.js", import.meta.url), { type: "module" });
	const listeners = new Set();
	let latestSnapshot = null;
	let latestError = null;

	function dispatch(message) {
		if (message.type === "snapshot") latestSnapshot = message;
		else latestError = message;
		for (const listener of listeners) listener(message);
	}

	worker.onmessage = (event) => dispatch(event.data);
	worker.onerror = (event) => dispatch({ type: "error", message: event.message || "The simulation worker failed." });

	return {
		subscribe(listener) {
			listeners.add(listener);
			const replay = latestSnapshot ?? latestError;
			if (replay !== null) listener(replay);
			return () => listeners.delete(listener);
		},
		configure: (params) => worker.postMessage({ type: "configure", params }),
		reset: () => worker.postMessage({ type: "reset" }),
		play: () => worker.postMessage({ type: "play" }),
		pause: () => worker.postMessage({ type: "pause" }),
		step: (ticks = 1) => worker.postMessage({ type: "step", ticks }),
		setSpeed: (ticksPerSecond) => worker.postMessage({ type: "speed", ticksPerSecond }),
		terminate: () => worker.terminate(),
	};
}
