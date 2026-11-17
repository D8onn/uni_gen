// A small "Help" disclosure for the panels: a summary line that opens to a paragraph of text.

function element(tag, { style, text } = {}, children = []) {
	const node = document.createElement(tag);
	if (style) node.style.cssText = style;
	if (text !== undefined) node.textContent = text;
	node.append(...children);
	return node;
}

// Returns `{ node, setText(text) }`; `node` is a closed `<details>` with `summary` as its label.
export function createHelpDisclosure({ summary, text }) {
	const paragraph = element("p", { text, style: "margin: 4px 0 0; opacity: 0.8; white-space: normal;" });
	const node = element("details", { style: "margin-bottom: 8px;" }, [element("summary", { text: summary, style: "cursor: pointer;" }), paragraph]);
	return {
		node,
		setText(next) {
			paragraph.textContent = next;
		},
	};
}
