import * as notifications from "./notifications.js"

const installScreen = document.querySelector("#install-screen")

let installPrompt = null

window.addEventListener('beforeinstallprompt', e => {
    console.log("Installable!")

    e.preventDefault()
    installPrompt = e
})

export async function promptIfApplicable() {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    const isInstalled = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true

    if (!isMobile || isInstalled) return;

    installScreen.hidden = false
}

document.querySelector("#install-screen-button").addEventListener("click", async () => {
    if (!installPrompt) {
        notifications.notify("Something went wrong! Reload.", "error")
        return
    }

    installPrompt.prompt()

    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') {
        notifications.notify("Successfully installed!")
    }

    installPrompt = null
})

document.querySelector("#install-screen-browser").addEventListener("click", () => {
    installScreen.hidden = true
})