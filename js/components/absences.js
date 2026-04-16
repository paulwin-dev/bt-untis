import * as untis from "../untis.js"

const capitalize = str => str.charAt(0).toUpperCase() + str.slice(1);

const absencesContainer = document.getElementById("absences-list")
const absenceTemplate = document.getElementById("absences-item-template")

let absences

function renderAbsence(data) {
    const node = absenceTemplate.content.cloneNode(true)
    const element = node.querySelector(".absence-item")

    element.querySelector(".absence-item-title").textContent = data.date.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    })

    element.querySelector(".absence-item-time").textContent = `${data.startStr} - ${data.endStr}`
    element.querySelector(".absence-item-reason").textContent = data.reason
    element.querySelector(".absence-item-note").textContent = data.text ?? "No note"

    if (data.text == "") {
        element.querySelector(".absence-item-data-note").hidden = true
    }

    let className = data.isExcused ? "excused" : "unexcused"
    if (data.excuseStatus === null) className = "open"

    element.querySelector(".absence-item-status-badge").textContent = capitalize(className)

    element.classList.add(className)
    absencesContainer.appendChild(node)
}

export async function load(session) {
    absences = await untis.getAbsences(session)
    
    for (const absence of absences.reverse()) {
        renderAbsence(absence)
    }
}