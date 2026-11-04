// Panel for the clicked cell: its world data and, from the worker, its habitat and organisms, kept current as ticks advance.
import { describeCell } from "./cellDescription.js";

const PANEL_STYLE = `
	position: fixed; left: 12px; bottom: 12px; width: 300px; max-height: 60vh; overflow-y: auto; padding: 12px; box-sizing: border-box;
	font: 12px/1.4 monospace; color: #dfeaf2; background: rgba(7, 17, 26, 0.85);
	border: 1px solid #2c4258; border-radius: 6px; display: none;
`;
const ROW_STYLE = "display: flex; justify-content: space-between;";
const COLUMN_LABELS = { biomass: "mass", temperatureOptimum: "temp", moistureOptimum: "moist" };

function element(tag, { style, text, ...properties } = {}, children = []) {
	const node = Object.assign(document.createElement(tag), properties);
	if (style) node.style.cssText = style;
	if (text !== undefined) node.textContent = text;
	node.append(...children);
	return node;
}

/**
 * Clicking a cell selects it (a click on empty space, Escape, or Close clears it): the planet outlines it, the worker is
 * asked to inspect it (`client.inspect`), and the panel redraws with each `cell` message that follows every snapshot.
 */
export function createCellInspector({ planet, client }) {
	let selected = null;
	const title = element("strong");
	const close = element("button", { type: "button", text: "Close", style: "font: inherit; cursor: pointer;" });
	const body = element("div", { style: "margin-top: 8px;" });
	const panel = element("section", { style: PANEL_STYLE }, [
		element("div", { style: ROW_STYLE }, [title, close]),
		body,
	]);
	document.body.appendChild(panel);

	function select(cellId) {
		selected = cellId;
		planet.setSelectedCell(cellId);
		client.inspect(cellId);
		panel.style.display = cellId === null ? "none" : "block";
		if (cellId !== null) render(null);
	}

	function render(data) {
		const description = describeCell(planet.world.cells[selected], data);
		title.textContent = description.title;
		body.replaceChildren(
			...description.rows.map(([label, value]) => element("div", { style: ROW_STYLE }, [element("span", { text: label }), element("span", { text: value })]))
		);
		if (description.organisms === null) return;
		const { count, traits, list } = description.organisms;
		body.append(element("div", { text: `Organisms: ${count}`, style: "margin-top: 8px;" }));
		if (traits !== null) {
			for (const [name, { mean, sd }] of Object.entries(traits)) {
				body.append(element("div", { style: ROW_STYLE }, [element("span", { text: name }), element("span", { text: `${mean.toFixed(2)} ± ${sd.toFixed(2)}` })]));
			}
		}
		if (list.length === 0) return;
		const header = ["id", "age", "biomass", ...Object.keys(traits)];
		const table = element("table", { style: "width: 100%; margin-top: 4px; border-collapse: collapse; table-layout: fixed;" }, [
			element("tr", {}, header.map((name) => element("th", { text: COLUMN_LABELS[name] ?? name, style: "text-align: right; font-weight: normal; opacity: 0.7;" }))),
			...list.map((organism) =>
				element("tr", {}, [
					organism.id,
					organism.age,
					organism.biomass.toFixed(2),
					...Object.keys(traits).map((name) => organism[name].toFixed(2)),
				].map((value) => element("td", { text: String(value), style: "text-align: right;" })))
			),
		]);
		body.append(table);
	}

	planet.onCellClick((cellId) => select(cellId));
	close.addEventListener("click", () => select(null));
	window.addEventListener("keydown", (event) => event.key === "Escape" && selected !== null && select(null));
	client.subscribe((message) => {
		if (message.type === "cell" && message.cellId === selected) render(message);
	});
	return panel;
}
