// Disclosures for the panels: a summary line that opens to its children, and a "Help" one that opens to a paragraph of text.

function element(tag, { style, text } = {}, children = []) {
	const node = document.createElement(tag);
	if (style) node.style.cssText = style;
	if (text !== undefined) node.textContent = text;
	node.append(...children);
	return node;
}

// Returns a closed `<details>` with `summary` as its label and `children` below it.
export function createDisclosure({ summary, children = [], style = "margin-bottom: 8px;" }) {
	return element("details", { style }, [element("summary", { text: summary, style: "cursor: pointer;" }), ...children]);
}

// Returns `{ node, setText(text) }`; `node` is a closed `<details>` with `summary` as its label.
export function createHelpDisclosure({ summary, text }) {
	const paragraph = element("p", { text, style: "margin: 4px 0 0; opacity: 0.8; white-space: normal;" });
	const node = createDisclosure({ summary, children: [paragraph] });
	return {
		node,
		setText(next) {
			paragraph.textContent = next;
		},
	};
}
