// Warmup app entry. Mounts the React component into `#ryu-plugin-root` the host
// document provides. `window.ryu` is installed inline by the Path B host bootstrap
// (injected into <head>) BEFORE this module runs, so the first effect's
// `window.ryu.warmup.detect()` call is queued until the host port arrives.

import {
	markCompanionAppRoot,
	subscribeCompanionTheme,
} from "@ryu/app-host/companion-theme";
import { RyuAppShell } from "@ryu/blocks/companion/app-ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./tailwind.css";
import { App } from "./App.tsx";

subscribeCompanionTheme();
const container = document.getElementById("ryu-plugin-root");
if (container) {
	markCompanionAppRoot(container);
	createRoot(container).render(
		<StrictMode>
			<RyuAppShell>
				<App />
			</RyuAppShell>
		</StrictMode>
	);
}
