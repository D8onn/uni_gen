// Message handling and pacing for the simulation worker; the worker file only forwards messages here.
import { createSimulation } from "./simulation.js";
import { MAX_SPEED } from "./simulationParams.js";

const SLICE_MS = 40; // longest run of ticks before the loop yields to incoming messages
const LOOP_DELAY_MS = 10;
const SNAPSHOT_INTERVAL_MS = 100;
const RATE_WINDOW_MS = 1000;

/**
 * Handles `configure` {params}, `reset`, `play`, `pause`, `step` {ticks}, and `speed` {ticksPerSecond} messages.
 * Every outcome is posted back as `snapshot` {params, running, ticksPerSecond, summary} or `error` {message}.
 * `now`, `schedule`, and `cancel` are injectable so tests can drive the clock.
 */
export function createSimulationController({
	post,
	poleToPoleCells = 80,
	now = () => performance.now(),
	schedule = setTimeout,
	cancel = clearTimeout,
}) {
	const simulation = createSimulation({ poleToPoleCells });
	let configured = false;
	let speed = 1;
	let running = false;
	let timer = null;
	let lastTime = 0;
	let due = 0; // ticks owed at the chosen speed
	let lastPost = 0;
	let rateStart = 0;
	let rateTicks = 0;
	let ticksPerSecond = 0;

	function postSnapshot() {
		lastPost = now();
		const { params, summary } = simulation.snapshot();
		post({ type: "snapshot", params: { ...params, speed }, running, ticksPerSecond, summary });
	}

	function stop() {
		running = false;
		ticksPerSecond = 0;
		if (timer !== null) cancel(timer);
		timer = null;
	}

	function countTicks(ticks, time) {
		rateTicks += ticks;
		if (time - rateStart >= RATE_WINDOW_MS) {
			ticksPerSecond = (rateTicks * 1000) / (time - rateStart);
			rateStart = time;
			rateTicks = 0;
		}
	}

	function loop() {
		timer = null;
		if (!running) return;
		try {
			const start = now();
			due = Math.min(due + ((start - lastTime) * speed) / 1000, speed);
			lastTime = start;
			let ticks = 0;
			while (due >= 1 && now() - start < SLICE_MS) {
				simulation.step(1);
				due -= 1;
				ticks += 1;
			}
			countTicks(ticks, now());
			if (now() - lastPost >= SNAPSHOT_INTERVAL_MS) postSnapshot();
			timer = schedule(loop, LOOP_DELAY_MS);
		} catch (error) {
			stop();
			post({ type: "error", message: error.message });
		}
	}

	function requireConfigured() {
		if (!configured) throw new Error("The simulation has not been configured.");
	}

	const handlers = {
		configure({ params }) {
			stop();
			simulation.configure(params);
			configured = true;
			speed = params.speed;
		},
		reset() {
			requireConfigured();
			stop();
			simulation.reset();
		},
		play() {
			requireConfigured();
			if (running) return;
			running = true;
			lastTime = now();
			rateStart = lastTime;
			rateTicks = 0;
			due = 0;
			timer = schedule(loop, 0);
		},
		pause() {
			stop();
		},
		step({ ticks = 1 }) {
			requireConfigured();
			stop();
			simulation.step(ticks);
		},
		speed({ ticksPerSecond: value }) {
			if (!Number.isInteger(value) || value < 1 || value > MAX_SPEED) {
				throw new RangeError(`speed must be an integer from 1 to ${MAX_SPEED} ticks per second.`);
			}
			speed = value;
		},
	};

	return {
		handle(message) {
			try {
				const handler = Object.hasOwn(handlers, message?.type) ? handlers[message.type] : null;
				if (handler === null) throw new RangeError(`Unknown message type: ${message?.type}.`);
				handler(message);
			} catch (error) {
				post({ type: "error", message: error.message });
			}
			if (configured) postSnapshot();
		},
	};
}
