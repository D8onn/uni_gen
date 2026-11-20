// When a run pauses itself: at a tick, on extinction, or when the organism count passes a limit; the simulation checks it after every tick.

export const STOP_KINDS = ["none", "tick", "extinct", "count-above", "count-below"];
export const STOP_REASON = { tick: "tick", extinct: "extinct", "count-above": "count", "count-below": "count" };

export function needsStopAt(stop) {
	return stop === "tick" || stop === "count-above" || stop === "count-below";
}

// Checks the condition's shape and that it can ever fire for `founders`; returns the clean `{ stop, stopAt }` fields, or `{}` for `none`, or throws a RangeError naming the setting.
export function validateStopCondition(stop = "none", stopAt, { founders }) {
	if (!STOP_KINDS.includes(stop)) throw new RangeError(`stop must be one of: ${STOP_KINDS.join(", ")}.`);
	if (!needsStopAt(stop)) {
		if (stopAt !== undefined) throw new RangeError(`stopAt must be left out when stop is ${stop}.`);
		if (stop === "none") return {};
		if (founders === 0) throw new RangeError("stop=extinct needs at least one founder.");
		return { stop };
	}
	const least = stop === "tick" ? 1 : 0;
	if (!Number.isSafeInteger(stopAt) || stopAt < least) throw new RangeError(`stopAt must be an integer of ${least} or more when stop is ${stop}.`);
	return { stop, stopAt };
}

// Conditions fire only on the tick they become true, so one that already holds (or a tick already passed) is rejected rather than never firing.
export function assertStopSettable(stop = "none", stopAt, { tick, count }) {
	if (stop === "tick" && stopAt <= tick) throw new RangeError(`stopAt ${stopAt} is not after the current tick ${tick}.`);
	if (stop === "extinct" && count === 0) throw new RangeError("The population is already extinct.");
	if (stop === "count-above" && count > stopAt) throw new RangeError(`The count ${count} is already above ${stopAt}.`);
	if (stop === "count-below" && count < stopAt) throw new RangeError(`The count ${count} is already below ${stopAt}.`);
}

export function stopHolds(stop, stopAt, { tick, count }) {
	if (stop === "tick") return tick === stopAt;
	if (stop === "extinct") return count === 0;
	if (stop === "count-above") return count > stopAt;
	if (stop === "count-below") return count < stopAt;
	return false;
}
