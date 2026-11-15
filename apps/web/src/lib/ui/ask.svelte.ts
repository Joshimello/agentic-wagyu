// The docked Ask panel is one conversation shared by every page. Pages open it
// and hand it a question; the panel owns sending and polling.
export const askPanel = $state({
  open: false,
  queue: [] as { question: string; projectId?: string }[],
  /** A project the panel should switch to the next time it opens. */
  focus: undefined as string | undefined,
});

export function askAbout(projectId: string) {
  askPanel.focus = projectId;
  askPanel.open = true;
}

export function askInPanel(question: string, projectId?: string) {
  askPanel.open = true;
  askPanel.queue.push({ question, projectId });
}

export const nextMeetingQuestion =
  'Prepare me for the next meeting on this project. Give a short brief with four parts: Recap (decisions in force and why), Progress (status of each commitment, separating claimed from verified), To do (who owes what and by when), and Needs clarification (missing owners, dates, criteria or conflicts). Keep each point to one sentence.';
