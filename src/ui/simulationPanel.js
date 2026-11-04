// Control panel for the browser simulation: settings that mirror the URL, playback buttons, and live statistics.
import {
	MAX_FOUNDERS,
	MAX_SPEED,
	SPECIES_NAMES,
	toSearchParams,
	validateSimulationParams,
} from "../utility/ecology/simulationParams.js";

const PANEL_STYLE = `
	position: fixed; top: 12px; right: 12px; width: 240px; padding: 12px; box-sizing: border-box;
	font: 12px/1.4 monospace; color: #dfeaf2; background: rgba(7, 17, 26, 0.85);
	border: 1px solid #2c4258; border-radius: 6px;
`;
const FIELD_STYLE = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;";
const INPUT_STYLE = "width: 110px; box-sizing: border-box; font: inherit;";
const BUTTON_STYLE = "flex: 1; font: inherit; cursor: pointer;";

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
 * Adds the panel to the page. `params` are the settings the simulation was started with.
 * Apply restarts the simulation with the entered settings; changing the seed reloads the page
 * because the globe is built for one seed. Reset restarts with the last applied settings.
 */
export function createSimulationPanel({ client, params }) {
	let applied = params;
	let running = false;

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

	const playButton = element("button", { type: "button", text: "Play", style: BUTTON_STYLE });
	const stepButton = element("button", { type: "button", text: "Step", style: BUTTON_STYLE });
	const resetButton = element("button", { type: "button", text: "Reset", style: BUTTON_STYLE });
	const applyButton = element("button", { type: "submit", text: "Apply", style: BUTTON_STYLE });
	const rows = (...buttons) => element("div", { style: "display: flex; gap: 6px; margin-bottom: 6px;" }, buttons);
	const message = element("div", { role: "alert", style: "color: #ff9c8f; min-height: 1.4em; margin-bottom: 4px;" });
	const stats = element("pre", { style: "margin: 0; font: inherit; white-space: pre-wrap;" });

	const form = element("form", { noValidate: true }, [
		...fields,
		rows(playButton, stepButton),
		rows(resetButton, applyButton),
		message,
		stats,
	]);
	const panel = element("section", { style: PANEL_STYLE }, [
		element("strong", { text: "Simulation", style: "display: block; margin-bottom: 8px;" }),
		form,
	]);
	document.body.appendChild(panel);

	function showParams(values) {
		for (const [name, input] of Object.entries(inputs)) input.value = values[name];
	}

	function readParams() {
		const entered = {};
		for (const [name, input] of Object.entries(inputs)) {
			if (input.value.trim() === "") throw new RangeError(`${labels[name]} must not be empty.`);
			entered[name] = name === "species" ? input.value : Number(input.value);
		}
		return validateSimulationParams(entered);
	}

	function updateUrl(values) {
		window.history.replaceState(null, "", `${window.location.pathname}?${toSearchParams(values)}`);
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
			if (next.seed !== applied.seed) {
				window.location.assign(`${window.location.pathname}?${toSearchParams(next)}`);
				return;
			}
			applied = next;
			updateUrl(applied);
			client.configure(applied);
		});
	});
	resetButton.addEventListener("click", () => {
		showParams(applied);
		message.textContent = "";
		client.reset();
	});
	playButton.addEventListener("click", () => (running ? client.pause() : client.play()));
	stepButton.addEventListener("click", () => client.step(1));
	inputs.speed.addEventListener("change", () =>
		attempt(() => {
			const { speed } = validateSimulationParams({ ...applied, speed: Number(inputs.speed.value) });
			applied = { ...applied, speed };
			updateUrl(applied);
			client.setSpeed(speed);
		})
	);

	function render({ running: isRunning, ticksPerSecond, summary }) {
		running = isRunning;
		playButton.textContent = running ? "Pause" : "Play";
		const { lastTick, totals } = summary;
		stats.textContent = [
			`Tick        ${summary.tick}${running ? ` (${ticksPerSecond.toFixed(1)}/s)` : ""}`,
			`Organisms   ${summary.count}`,
			`Biomass     ${summary.totalBiomass.toFixed(1)}`,
			`Cells       ${summary.occupiedCells}`,
			`Births      ${lastTick.births} (total ${totals.births})`,
			`Deaths      ${sum(lastTick.deaths)} (total ${sum(totals.deaths)})`,
		].join("\n");
	}

	showParams(applied);
	client.subscribe((event) => {
		if (event.type === "snapshot") render(event);
		else message.textContent = event.message;
	});
	return panel;
}
