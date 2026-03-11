const screens = {
    schedule: document.getElementById("schedule-screen"),
    absences: document.getElementById("absences-screen"),
    grades: document.getElementById("grades-screen"),
    more: document.getElementById("more-screen"),
}

export function init() {
    document.querySelectorAll(".nav-item").forEach(btn => {
        btn.addEventListener("click", () => {
            const tab = btn.dataset.tab

            // update active button
            document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"))
            btn.classList.add("active")

            // switch screen
            Object.entries(screens).forEach(([name, el]) => {
                if (!el) return
                el.hidden = name !== tab
            })
        })
    })
}