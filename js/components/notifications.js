const notificationContainer = document.getElementById("notifications-screen")
const notificationTemplate = document.getElementById("notification-template")

const NOTIFICATION_SHOW_TIME = 3
const NOTIFICATION_COLORS = {
    error: "--error",
    success: "--success",
    info: "--info"
}

export function notify(text, notificationType = "info") {
    const notif = notificationTemplate.content.cloneNode(true)
    const element = notif.querySelector(".notification")

    notif.querySelector(".notification-text").textContent = text
    notif.querySelector(".notification").style.backgroundColor = `var(${NOTIFICATION_COLORS[notificationType]})`
    notificationContainer.appendChild(notif)

    setTimeout(() => {
        element.remove()
    }, NOTIFICATION_SHOW_TIME * 1000)
}