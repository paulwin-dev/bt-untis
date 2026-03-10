import * as untis from "./untis.js";
import * as login from "./components/login.js"
import * as schedule from "./components/schedule.js"
import * as storage from "./components/storage.js"
import * as installer from "./components/installer.js"
import * as notifications from "./components/notifications.js"

installer.promptIfApplicable()

//PWA support
if ("serviceWorker" in navigator) {
	navigator.serviceWorker.register("/sw.js");
}

await storage.init()

let [ session ] = await login.restoreSession()

if (session) { //user is online and logged in, immediately show schedule
	await schedule.load(session)

} else if (navigator.onLine) { //user's session has expired and they're online: prompt login
	session = await login.startLoginProcess()
	await schedule.load(session)

} else { //user offline
	notifications.notify("Unable to connect to server — check your connection", "info")

	await schedule.load(null)
}


/*if (!session && !navigator.onLine) {
	notifications.notify("You're offline — showing cached data", "info")

	await schedule.load(null)
} else if (!session) {
	session = await login.startLoginProcess()
	await schedule.load(session)
} else {
	await schedule.load(session)
}*/