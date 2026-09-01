// Runs server-side on Vercel — the Todoist token lives only here, in an environment
// variable, and is never sent to or visible from the browser. The front-end calls this
// endpoint instead of talking to Todoist (or Anthropic's API) directly.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { description, dueDate } = req.body || {};
  const token = process.env.TODOIST_API_TOKEN;

  if (!token) {
    return res.status(500).json({ error: "TODOIST_API_TOKEN is not configured" });
  }
  if (!description) {
    return res.status(400).json({ error: "Missing task description" });
  }

  try {
    // Find the "Screens" project's ID by name, so tasks land in the right place
    // regardless of what internal ID that project happens to have.
    const projectsRes = await fetch("https://api.todoist.com/api/v1/projects", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!projectsRes.ok) {
      const errText = await projectsRes.text();
      return res.status(projectsRes.status).json({ error: `Couldn't fetch projects: ${errText}` });
    }
    const projectsData = await projectsRes.json();
    const projects = Array.isArray(projectsData) ? projectsData : (projectsData.results || projectsData.items || []);
    const screensProject = projects.find((p) => (p.name || "").toLowerCase() === "screens");

    if (!screensProject) {
      return res.status(404).json({ error: 'No project named "Screens" found in your Todoist account' });
    }

    const taskBody = { content: description, project_id: screensProject.id };
    if (dueDate) taskBody.due_date = dueDate;

    const taskRes = await fetch("https://api.todoist.com/api/v1/tasks", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(taskBody),
    });

    if (!taskRes.ok) {
      const errText = await taskRes.text();
      return res.status(taskRes.status).json({ error: `Couldn't create task: ${errText}` });
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
