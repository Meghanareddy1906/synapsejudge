const LABELS = {
  pending: 'Queued',
  running: 'Running',
  accepted: 'Accepted',
  wrong_answer: 'Wrong Answer',
  time_limit_exceeded: 'Time Limit Exceeded',
  memory_limit_exceeded: 'Memory Limit Exceeded',
  runtime_error: 'Runtime Error',
  compilation_error: 'Compilation Error',
  internal_error: 'Judge Error',
};

export function verdictLabel(verdict) {
  return LABELS[verdict] ?? verdict;
}

export function verdictClass(verdict) {
  if (verdict === 'accepted') return 'verdict-accepted';
  if (verdict === 'pending' || verdict === 'running') return 'verdict-pending';
  if (verdict === 'internal_error') return 'verdict-internal_error';
  return 'verdict-failed';
}

export default function VerdictBadge({ verdict }) {
  const inFlight = verdict === 'pending' || verdict === 'running';
  return (
    <span className={`verdict ${verdictClass(verdict)}`}>
      {inFlight && <span className="spinner" style={{ marginRight: 6, verticalAlign: -2 }} />}
      {verdictLabel(verdict)}
    </span>
  );
}
