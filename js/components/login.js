import * as untis from "../untis.js";
import * as notifications from "./notifications.js"

const loginScreen = document.getElementById("login-screen")
const urlInput = document.getElementById("login-server")
const schoolInput = document.getElementById("login-school")
const userInput = document.getElementById("login-user")
const passInput = document.getElementById("login-pass")
const loginButton = document.getElementById("login-submit")
const rememberLoginCheck = document.getElementById("login-remember-check")

let resolveLogin = null;

export async function getStayLoggedInValue() {
    return localStorage.getItem("remember_login") == "true"
}

export async function restoreSession() {
    let session

    try { session = await untis.restoreSession() } catch {} //wrap in try catch to make sure that if the server is ever offline it still shows offline data

    if (session) {
        return [session]
    }

    const savedSession = untis.getCachedSesion()
    if (!getStayLoggedInValue() || !savedSession || !savedSession.password) {
        return [null]
    }

    console.log("Logging in with saved credentials because remember me is set to true.")

    try {
        return [await untis.login(savedSession.server, savedSession.school, savedSession.username, savedSession.password)]
    } catch {
        return [null, true]
    }
}

export function startLoginProcess() {
    loginScreen.hidden = false

    return new Promise(resolve => {
        resolveLogin = resolve;
    });
}

function login(session, password) {
    if (rememberLoginCheck.checked) {
        localStorage.setItem("remember_login", "true")
    }

    const rememberLogin = localStorage.getItem("remember_login") == "true"

    untis.saveSession(session, rememberLogin ? password : null);
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

        login(session, passInput.value)

    } catch {
        notifications.notify("Login failed. Check your credentials.", "error")
    }
}

loginButton.addEventListener("click", onSubmit)