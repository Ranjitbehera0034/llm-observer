import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';
import { API_BASE_URL } from '../config';
type Task = { id: string; title: string; detail: string; source: string; status: string };
export default function Tasks() {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [title, setTitle] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    async function load() {
        const response = await apiFetch(`${API_BASE_URL}/api/tasks`);
        if (!response.ok) throw new Error('Could not load tasks');
        setTasks((await response.json()).data);
    }
    useEffect(() => { load().catch(e => setMessage(e.message)); }, []);
    async function change(path: string, method: string, body: unknown) {
        setBusy(true); setMessage('');
        try {
            const response = await apiFetch(`${API_BASE_URL}/api/tasks${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Could not update tasks');
            if (path === '/collect') setMessage(`Collected ${data.added} new tasks. Existing task status is preserved.`);
            if (path === '') setTitle('');
            await load();
        } catch (e) { setMessage(e instanceof Error ? e.message : 'Request failed'); }
        finally { setBusy(false); }
    }
    return <main className="p-8 max-w-5xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">Task inbox</h1>
        <p className="text-textMuted">Collect local optimizer recommendations and saved AI Analyst advice. Review each suggestion before acting. Collection makes no paid API calls and does not execute code or change your tools.</p>
        <button disabled={busy} onClick={() => change('/collect','POST',{})} className="bg-primary text-white rounded px-4 py-2">Collect recommendations</button>
        <form onSubmit={e => { e.preventDefault(); change('','POST',{ title, detail: '' }); }} className="flex gap-3">
            <input aria-label="Task title" required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="Add a task" className="bg-surface border border-border p-2 rounded flex-1" />
            <button disabled={busy} className="border border-border rounded px-4">Add task</button>
        </form>
        {message && <p role="status">{message}</p>}
        {!tasks.length && <p className="text-textMuted">No tasks yet. Collect recommendations or add your first task.</p>}
        {tasks.map(task => <article key={task.id} className="bg-surface border border-border rounded-lg p-5 space-y-3">
            <div className="flex justify-between gap-4"><h2 className="font-semibold">{task.title}</h2><span className="text-textMuted text-sm">{task.source}</span></div>
            <p className="whitespace-pre-wrap text-textMuted">{task.detail}</p>
            <select aria-label={`Status for ${task.title}`} disabled={busy} value={task.status} onChange={e => change(`/${task.id}`,'PATCH',{status:e.target.value})} className="bg-surface border border-border p-2 rounded">
                <option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="dismissed">Dismissed</option>
            </select>
        </article>)}
    </main>;
}
