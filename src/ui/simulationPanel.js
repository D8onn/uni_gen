// Control panel for the browser simulation: settings that mirror the URL, playback buttons, and live statistics.
import { DIVERGENCE_HELP, groupLines } from "./groupLines.js";
import { createApplyTracker } from "./applyTracker.js";
import { createDisclosure, createHelpDisclosure } from "./helpDisclosure.js";
import { LIMIT_KINDS } from "../utility/ecology/habitat.js";
import { getViewLegend } from "../utility/planet/cellViews.js";
import { needsStopAt } from "../utility/ecology/stopCondition.js";
import {
	ADVANCED_SETTINGS,
	effectiveSettings,
	MAX_FOUNDERS,
	MAX_SPEED,
	refillForSpecies,
	SPECIES_NAMES,
	toSearchParams,
	validateSimulationParams,
} from "../utility/ecology/simulationParams.js";

const PANEL_STYLE = `
	position: fixed; top: 12px; right: 12px; width: 240px; max-height: calc(100vh - 24px); overflow-y: auto; padding: 12px; box-sizing: border-box;
	font: 12px/1.4 monospace; color: #dfeaf2; background: rgba(7, 17, 26, 0.85);
	border: 1px solid #2c4258; border-radius: 6px;
`;
const FIELD_STYLE = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;";
const INPUT_STYLE = "width: 110px; box-sizing: border-box; font: inherit;";
const BUTTON_STYLE = "flex: 1; font: inherit; cursor: pointer;";
const STOP_LABELS = { none: "none", tick: "at tick", extinct: "extinct", "count-above": "count above", "count-below": "count below" };
const STOPPED_TEXT = { tick: "target tick reached", extinct: "population extinct", count: "count passed its limit" };

function element(tag, { style, text, ...properties } = {}, children = []) {
	const node = Object.assign(document.createElement(tag), properties);
	if (style) node.style.cssText = style;
	if (text !== undefined) node.textContent = text;
	node.append(...children);
	return node;
}

function sum(values) {
	return Object.values(values).reduce((total, value) => total + value, 0);
}

/**
 * Adds the panel to the page. `params` are the settings the simulation was started with, and `views`
 * is a view controller (`list` of views; `select(id)` applies one and returns its legend; `setShowEmptyLand` sets the region view's option; the organism markers
 * can be shown or hidden, and their size is reported through `onMarkers`).
 * Apply restarts the simulation with the entered settings, which count as applied once the worker reports running them; changing the seed reloads the page
 * because the globe is built for one seed. Reset restarts with the last applied settings, or with an Apply still in flight, which the worker runs first.
 */
export function createSimulationPanel({ client, params, views }) {
	const tracker = createApplyTracker(params);
	let lastUrlQuery = toSearchParams(params).toString(); // the page loads with this URL, so it is not rewritten until it changes
	let shownSpecies = params.species; // the species whose defaults the advanced fields were last filled from
	let running = false;
	let stopRequestId = null; // the latest stop-condition request, whose rejection puts the applied condition back in the row

	const inputs = {
		seed: element("input", { type: "number", min: 0, max: 0xffffffff, step: 1, style: INPUT_STYLE }),
		founders: element("input", { type: "number", min: 0, max: MAX_FOUNDERS, step: 1, style: INPUT_STYLE }),
		species: element("select", { style: INPUT_STYLE }, SPECIES_NAMES.map((name) => element("option", { value: name, text: name }))),
		dispersal: element("input", { type: "number", min: 0, max: 1, step: "any", style: INPUT_STYLE }),
		speed: element("input", { type: "number", min: 1, max: MAX_SPEED, step: 1, style: INPUT_STYLE }),
	};
	const labels = { seed: "Seed", founders: "Founders", species: "Species", dispersal: "Dispersal", speed: "Ticks/sec" };
	const fields = Object.entries(inputs).map(([name, input]) =>
		element("label", { style: FIELD_STYLE }, [element("span", { text: labels[name] }), input])
	);
	const advancedInputs = Object.fromEntries(
		ADVANCED_SETTINGS.map(({ name, kind }) => {
			const { min, max } = LIMIT_KINDS[kind];
			const range = Number.isFinite(max) ? { min, max } : { min };
			return [name, element("input", { type: "number", ...range, step: kind === "count" ? 1 : "any", title: name, style: INPUT_STYLE })];
		})
	);
	const advancedGroup = (group, heading) => [
		element("div", { text: heading, style: "margin: 6px 0 4px; opacity: 0.8;" }),
		...ADVANCED_SETTINGS.filter((setting) => setting.group === group).map(({ name, label }) =>
			element("label", { style: FIELD_STYLE }, [element("span", { text: label }), advancedInputs[name]])
		),
	];
	const advanced = createDisclosure({ summary: "Advanced", children: [...advancedGroup("species", "Species"), ...advancedGroup("habitat", "Habitat")] });

	const stopSelect = element(
		"select",
		{ title: "stop", style: "width: 92px; box-sizing: border-box; font: inherit;" },
		Object.entries(STOP_LABELS).map(([value, text]) => element("option", { value, text }))
	);
	const stopAtInput = element("input", { type: "number", min: 0, step: 1, title: "stopAt", style: "width: 60px; box-sizing: border-box; font: inherit;" });
	const stopRow = element("label", { style: FIELD_STYLE }, [
		element("span", { text: "Stop when" }),
		element("span", { style: "display: flex; gap: 4px;" }, [stopSelect, stopAtInput]),
	]);

	const playButton = element("button", { type: "button", text: "Play", style: BUTTON_STYLE });
	const stepButton = element("button", { type: "button", text: "Step", style: BUTTON_STYLE });
	const resetButton = element("button", { type: "button", text: "Reset", style: BUTTON_STYLE });
	const applyButton = element("button", { type: "submit", text: "Apply", style: BUTTON_STYLE });
	const rows = (...buttons) => element("div", { style: "display: flex; gap: 6px; margin-bottom: 6px;" }, buttons);
	const message = element("div", { role: "alert", style: "color: #ff9c8f; min-height: 1.4em; margin-bottom: 4px;" });
	const stats = element("pre", { style: "margin: 0; font: inherit; white-space: pre-wrap;" });

	const viewSelect = element("select", { style: INPUT_STYLE }, views.list.map(({ id, label }) => element("option", { value: id, text: label })));
	const legend = element("div", { style: "min-height: 36px; margin-bottom: 8px;" });

	function showLegend(viewLegend) {
		legend.replaceChildren();
		if (viewLegend.swatches) {
			const swatches = viewLegend.swatches.map(({ label, color }) =>
				element("div", { style: "display: flex; align-items: center; gap: 4px;" }, [
					element("span", { style: `flex: none; width: 10px; height: 10px; background: ${color};` }),
					element("span", { text: label }),
				])
			);
			legend.append(element("div", { text: viewLegend.title }), element("div", { style: "display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px;" }, swatches));
			return;
		}
		if (viewLegend.note) {
			legend.append(element("div", { text: viewLegend.title }), element("div", { text: viewLegend.note, style: "opacity: 0.8;" }));
			return;
		}
		const bar = element("div", { style: `height: 10px; border-radius: 2px; background: linear-gradient(to right, ${viewLegend.stops.join(", ")});` });
		const ends = element("div", { style: "display: flex; justify-content: space-between;" }, [
			element("span", { text: viewLegend.low }),
			element("span", { text: viewLegend.high }),
		]);
		legend.append(element("div", { text: `${viewLegend.title} (unitless)` }), bar, ends);
	}
	const viewHelp = createHelpDisclosure({ summary: "Help", text: "" });
	const emptyLandToggle = element("input", { type: "checkbox" });
	const emptyLandRow = element("label", { style: FIELD_STYLE }, [element("span", { text: "Show empty land" }), emptyLandToggle]);
	emptyLandToggle.addEventListener("change", () => views.setShowEmptyLand(emptyLandToggle.checked));
	function showViewHelp(viewId) {
		const view = views.list.find(({ id }) => id === viewId);
		viewHelp.setText(view.help);
		emptyLandRow.style.display = view.emptyLandOption ? "flex" : "none";
	}
	viewSelect.addEventListener("change", () => {
		showLegend(views.select(viewSelect.value));
		showViewHelp(viewSelect.value);
	});

	const markerToggle = element("input", { type: "checkbox", checked: true });
	const markerNote = element("span", { style: "opacity: 0.8;" });
	markerToggle.addEventListener("change", () => views.setMarkersVisible(markerToggle.checked));
	views.onMarkers(({ unit, shown, organisms }) => {
		markerNote.textContent = organisms === 0 ? "none" : `${shown} \u00d7 ${unit}`;
	});

	// Apply and its error stay at the bottom of the panel while the fields above scroll, so Apply is reachable with Advanced open.
	const applyBar = element("div", { style: "position: sticky; bottom: -12px; background: #07111a; margin: 0 -12px; padding: 6px 12px 12px;" }, [
		rows(resetButton, applyButton),
		message,
	]);
	const form = element("form", { noValidate: true }, [
		...fields,
		advanced,
		stopRow,
		rows(playButton, stepButton),
		applyBar,
		stats,
		createHelpDisclosure({ summary: "Divergence T/M", text: DIVERGENCE_HELP }).node,
	]);
	const panel = element("section", { style: PANEL_STYLE }, [
		element("strong", { text: "Simulation", style: "display: block; margin-bottom: 8px;" }),
		element("label", { style: FIELD_STYLE }, [element("span", { text: "View" }), viewSelect]),
		legend,
		viewHelp.node,
		emptyLandRow,
		element("label", { style: FIELD_STYLE }, [element("span", { text: "Organisms" }), element("span", {}, [markerNote, " ", markerToggle])]),
		form,
	]);
	document.body.appendChild(panel);

	function showAdvanced(values) {
		for (const [name, input] of Object.entries(advancedInputs)) input.value = values[name];
	}

	function syncStopInput() {
		stopAtInput.disabled = !needsStopAt(stopSelect.value);
	}

	function showStop(values) {
		stopSelect.value = values.stop ?? "none";
		stopAtInput.value = values.stopAt ?? "";
		syncStopInput();
	}

	function showParams(values) {
		for (const [name, input] of Object.entries(inputs)) input.value = values[name];
		showAdvanced(effectiveSettings(values));
		showStop(values);
		shownSpecies = values.species;
	}

	// The row's condition; a blank stopAt is left undefined so validation names it.
	function readStop() {
		const stop = stopSelect.value;
		const raw = stopAtInput.value.trim();
		return { stop, stopAt: needsStopAt(stop) && raw !== "" ? Number(raw) : undefined };
	}

	function readParams() {
		const entered = {};
		for (const [name, input] of Object.entries(inputs)) {
			if (input.value.trim() === "") throw new RangeError(`${labels[name]} must not be empty.`);
			entered[name] = name === "species" ? input.value : Number(input.value);
		}
		for (const { name, label } of ADVANCED_SETTINGS) {
			const { value } = advancedInputs[name];
			if (value.trim() === "") throw new RangeError(`${label} must not be empty.`);
			entered[name] = Number(value);
		}
		Object.assign(entered, readStop());
		return validateSimulationParams(entered);
	}

	function updateUrl(values) {
		const query = toSearchParams(values).toString();
		if (query === lastUrlQuery) return;
		lastUrlQuery = query;
		window.history.replaceState(null, "", `${window.location.pathname}?${query}`);
	}

	function attempt(action) {
		try {
			message.textContent = "";
			action();
		} catch (error) {
			message.textContent = error.message;
		}
	}

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		attempt(() => {
			const next = readParams();
			if (next.seed !== tracker.applied().seed) {
				window.location.assign(`${window.location.pathname}?${toSearchParams(next)}`);
				return;
			}
			client.configure(next, tracker.apply(next));
		});
	});
	// Choosing a species fills the advanced settings whose default depends on the species with its defaults, without applying them.
	inputs.species.addEventListener("change", () => {
		const shown = Object.fromEntries(Object.entries(advancedInputs).map(([name, input]) => [name, input.value]));
		showAdvanced(refillForSpecies(shown, shownSpecies, inputs.species.value));
		shownSpecies = inputs.species.value;
	});
	resetButton.addEventListener("click", () => {
		showParams(tracker.resetTarget());
		message.textContent = "";
		client.reset();
	});
	playButton.addEventListener("click", () => (running ? client.pause() : client.play()));
	stepButton.addEventListener("click", () => client.step(1));
	// A stop-condition change applies at once without a restart; the row keeps what was typed unless the worker rejects it.
	function sendStop() {
		const { stop, stopAt } = readStop();
		if (needsStopAt(stop) && stopAt === undefined) return; // waits for a value rather than sending a condition that cannot be valid
		message.textContent = "";
		stopRequestId = tracker.nextRequestId();
		client.stopWhen(stop, stopAt, stopRequestId);
	}
	stopSelect.addEventListener("change", () => {
		syncStopInput();
		sendStop();
	});
	stopAtInput.addEventListener("change", sendStop);
	inputs.speed.addEventListener("change", () =>
		attempt(() => {
			const { speed } = validateSimulationParams({ ...tracker.applied(), speed: Number(inputs.speed.value) });
			tracker.setSpeed(speed);
			updateUrl(tracker.applied());
			client.setSpeed(speed);
		})
	);

	function render({ running: isRunning, ticksPerSecond, stopped, extinctTick, summary, groups }) {
		running = isRunning;
		playButton.textContent = running ? "Pause" : "Play";
		const { lastTick, totals } = summary;
		stats.textContent = [
			...(extinctTick !== null ? [`Extinct at tick ${extinctTick}`] : []),
			`Tick        ${summary.tick}${running ? ` (${ticksPerSecond.toFixed(1)}/s)` : ""}`,
			...(stopped !== null && !running ? [`Stopped at tick ${stopped.tick} (${STOPPED_TEXT[stopped.reason]})`] : []),
			`Organisms   ${summary.count}`,
			`Biomass     ${summary.totalBiomass.toFixed(1)}`,
			`Cells       ${summary.occupiedCells}`,
			`Births      ${lastTick.births} (total ${totals.births})`,
			`Deaths      ${sum(lastTick.deaths)} (total ${sum(totals.deaths)})`,
			...groupLines(groups),
		].join("\n");
	}

	showLegend(getViewLegend(viewSelect.value));
	showViewHelp(viewSelect.value);
	showParams(tracker.applied());
	client.subscribe((event) => {
		if (event.type === "snapshot") {
			if (tracker.snapshot(event)) message.textContent = "";
			updateUrl(tracker.applied());
			render(event);
		} else {
			// The worker rejected the pending Apply, so it keeps the applied settings and so do the inputs.
			if (event.type === "error" && tracker.failed(event.requestId)) showParams(tracker.applied());
			// The worker rejected the latest stop condition, so the row shows the one still running.
			if (event.type === "error" && stopRequestId !== null && event.requestId === stopRequestId) {
				showStop(tracker.applied());
				stopRequestId = null;
			}
			message.textContent = event.message;
		}
	});
	return panel;
}
