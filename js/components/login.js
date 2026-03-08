import * as untis from "../untis.js";
import * as notifications from "./notifications.js"

const loginScreen = document.getElementById("login-screen")
const urlInput = document.getElementById("login-server")
const schoolInput = document.getElementById("login-school")
const userInput = document.getElementById("login-user")
const passInput = document.getElementById("login-pass")
const loginButton = document.getElementById("login-submit")

let resolveLogin = null;

export function startLoginProcess() {
    loginScreen.hidden = false

    return new Promise(resolve => {
        resolveLogin = resolve;
    });
}

function login(session) {
    untis.saveSession(session);
    loginScreen.hidden = true
    resolveLogin(session);

    notifications.notify("Successfully logged in.", "success")
}

async function onSubmit() {
    let session;
    try {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
            notifications.notify("Please enable notifications.", "error")
            return
        }

        session = await untis.login(
            urlInput.value,
            schoolInput.value,
            userInput.value,
            passInput.value,
        );

        login(session)

    } catch {
        notifications.notify("Login failed. Check your credentials.", "error")
    }
}

loginButton.addEventListener("click", onSubmit)