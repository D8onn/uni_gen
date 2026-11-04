import { createSimulationController } from "./simulationController.js";

const controller = createSimulationController({ post: (message) => self.postMessage(message) });
self.onmessage = (event) => controller.handle(event.data);
