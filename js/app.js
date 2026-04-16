import * as login from "./components/login.js"
import * as schedule from "./components/schedule.js"
import * as storage from "./components/storage.js"
import * as installer from "./components/installer.js"
import * as notifications from "./components/notifications.js"
import * as navbar from "./components/navbar.js"
import * as absences from "./components/absences.js"
import * as grades from "./components/grades.js"

installer.promptIfApplicable()

//PWA support
if ("serviceWorker" in navigator) {
	navigator.serviceWorker.register("/sw.js");
}

await storage.init()

navbar.init()

let [ session ] = await login.restoreSession()

if (session) { //user is online and logged in, immediately show schedule
	schedule.load(session)
	absences.load(session)
	grades.load(session)

} else if (navigator.onLine) { //user's session has expired and they're online: prompt login
	session = await login.startLoginProcess()
	schedule.load(session)
	absences.load(session)
	grades.load(session)

} else { //user offline
	notifications.notify("Unable to connect to server — check your connection", "info")

	schedule.load(null)
}