/**
 * Blocking questions dialog (Phase 6).
 *
 * Shown when the compiler returns questions that block correct execution.
 * The user's answers are fed back into the pipeline for re-compilation.
 * Capped at 2 rounds.
 */

export interface BlockingQuestionsDialogProps {
  questions: string[];
  round: number;
  onSubmit: (answers: string[]) => void;
  onCancel: () => void;
}

export function BlockingQuestionsDialog({
  questions,
  round,
  onSubmit,
  onCancel,
}: BlockingQuestionsDialogProps) {
  const answers: string[] = new Array(questions.length).fill('');

  return (
    <div className="space-y-6 rounded-lg border border-amber-200 bg-amber-50 p-6">
      <div>
        <h3 className="text-lg font-semibold text-amber-900">
          Blocking questions (round {round} of 2)
        </h3>
        <p className="mt-1 text-sm text-amber-700">
          The compiler needs more information before it can produce a complete
          task. Answer the questions below to continue.
        </p>
      </div>

      <div className="space-y-4">
        {questions.map((q, i) => (
          <label key={i} className="grid gap-1 text-sm">
            <span className="font-medium text-amber-800">{q}</span>
            <input
              className="w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              placeholder="Your answer..."
              onChange={(e) => {
                answers[i] = e.target.value;
              }}
            />
          </label>
        ))}
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => onSubmit(answers.filter((a) => a.trim() !== ''))}
          className="rounded-md bg-amber-900 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800"
        >
          Submit answers
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
