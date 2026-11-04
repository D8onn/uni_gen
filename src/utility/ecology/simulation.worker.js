import { createSimulationController } from "./simulationController.js";

const controller = createSimulationController({ post: (message, transfer) => self.postMessage(message, transfer) });
self.onmessage = (event) => controller.handle(event.data);
