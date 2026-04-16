import * as untis from '../untis.js'
import * as notifications from './notifications.js'

const screen = document.getElementById('grades-screen')
const list = document.getElementById('grades-list')

const subjectTemplate = document.getElementById('grade-subject-template')
const entryTemplate = document.getElementById('grade-entry-template')


function average(grades) {
    if (!grades.length) return null
    const sum = grades.reduce((acc, g) => acc + (g.markValue ?? 0), 0)
    return (sum / grades.length).toFixed(1)
}

function renderSubjectCard(subjectData) {
    const card    = subjectTemplate.content.cloneNode(true).firstElementChild
    const entries = card.querySelector('.grade-entries')

    card.querySelector('.grade-subject-name').textContent    = subjectData.subject
    card.querySelector('.grade-subject-teacher').textContent = subjectData.teachers || 'No teacher'

    const avg = average(subjectData.grades)
    const avgEl = card.querySelector('.grade-subject-avg')
    avgEl.textContent = avg ?? '—'
    if (!avg) avgEl.classList.add('no-grades')

    if (subjectData.grades.length === 0) {
        const empty = document.createElement('p')
        empty.className = 'grade-no-entries'
        empty.textContent = 'No grades yet'
        entries.appendChild(empty)
    } else {
        const sorted = [...subjectData.grades].sort((a, b) => b.date - a.date)
        for (const g of sorted) {
            const entry = entryTemplate.content.cloneNode(true).firstElementChild

            entry.querySelector('.grade-entry-mark').textContent = g.mark
            entry.querySelector('.grade-entry-type').textContent = g.type
            entry.querySelector('.grade-entry-date').textContent = g.date
                ? g.date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
                : '—'

            const textEl = entry.querySelector('.grade-entry-text')
            if (g.text) {
                textEl.textContent = g.text
                textEl.hidden = false
            }

            entries.appendChild(entry)
        }
    }

    card.querySelector('.grade-subject-header').addEventListener('click', () => {
        card.classList.toggle('expanded')
        entries.hidden = !entries.hidden
    })

    return card
}

export async function load(session) {
    list.textContent = ''

    if (!session) {
        list.innerHTML = `<p style="color:var(--muted-text)">Sign in to view grades.</p>`
        return
    }

    try {
        const grades = await untis.getGrades(session)
        const withGrades    = grades.filter(s => s.grades.length > 0)
        const withoutGrades = grades.filter(s => s.grades.length === 0)

        screen.querySelector(".loader").hidden = true

        for (const s of [...withGrades, ...withoutGrades]) {
            list.appendChild(renderSubjectCard(s))
        }

        if (grades.length === 0) {
            list.innerHTML = `<p style="color:var(--muted-text)">No grades found.</p>`
        }
    } catch (e) {
        notifications.notify('Failed to load grades', 'error')
    }
}